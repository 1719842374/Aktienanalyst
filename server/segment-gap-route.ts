/**
 * POST /api/segment-gaps
 *
 * Fehlende Produktlinien und Regionen, die FMP/SEC nicht führen.
 * Kein Ticker-Hardcoding. Treffer hängen an einem vorhandenen Elternsegment.
 * Top-Level-Summen und FMP-Zeilen bleiben unangetastet.
 * Treffer liegen 24 h im Speicher, leere 200er 60 s. Fehlerantworten werden nicht gecacht.
 */
import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  KI_SUM_EXCEEDS_PARENT,
  OUTLINE_MISMATCH,
  OUTLINE_NO_IDENTITY,
  concreteSource,
  outlineEchoMatches,
  reportedParentRevenue,
  reviewKiChildren,
  segmentNamesFromFmpRows,
  type SegmentChild,
} from "../shared/segment-children";
import {
  isGeographicPlace,
  regionFitsParent,
  type SegmentGapItem,
  type SegmentGapResult,
} from "../shared/segment-gap";
import { fmpSegmentationRows, isFmpAvailable } from "./fmp";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { fetchSecBusinessSegments } from "./sec-segments";
import {
  loadOutlineIdentity,
  SEGMENT_CHILDREN_KI_TIMEOUT_MS,
  type OutlineIdentity,
} from "./segment-growth-route";

export type { SegmentGapItem, SegmentGapResult };

const GAP_CACHE_MS = 24 * 60 * 60 * 1000;
const GAP_EMPTY_CACHE_MS = 60 * 1000;
const GAP_CACHE_MAX = 400;
const DEFAULT_RATE_MAX = 20;
const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,31}$/i;
/** Prompt-Version im Cache-Schlüssel, damit alte Antworten nach einer Prompt-Änderung nicht liegen bleiben. */
export const SEGMENT_GAP_PROMPT_VERSION = "n36-gap-p4";
const gapCache = new Map<string, { at: number; ttl: number; body: SegmentGapResult }>();
const secNameCache = new Map<string, { at: number; ttl: number; names: string[] }>();
const rateBuckets = new Map<string, number[]>();

type Llm = (opts: {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}) => Promise<{ data: unknown; modelUsed?: string } | null>;

export interface SegmentGapDeps {
  available?: () => boolean;
  productRows?: (ticker: string) => Promise<unknown[]>;
  regionRows?: (ticker: string) => Promise<unknown[]>;
  identity?: (ticker: string) => Promise<OutlineIdentity | null>;
  llm?: Llm;
  now?: () => number;
  rateLimit?: { max: number; windowMs: number };
  secSegments?: (ticker: string, companyName: string) => Promise<{ segments: Array<{ name: string }> } | null>;
}

export function resetSegmentGapCacheForTests(): void {
  gapCache.clear();
  secNameCache.clear();
  rateBuckets.clear();
}

export function segmentGapCacheKey(ticker: string, products: readonly string[], regions: readonly string[]): string {
  const names = `p:${products.slice(0, 24).join("\n")}\nr:${regions.slice(0, 24).join("\n")}`;
  const hash = createHash("sha256").update(names).digest("hex");
  return `${SEGMENT_GAP_PROMPT_VERSION}|${ticker.toUpperCase()}|${hash}`;
}

function pruneGapCache(now: number): void {
  const expired: string[] = [];
  gapCache.forEach((entry, key) => {
    if (now - entry.at >= entry.ttl) expired.push(key);
  });
  for (let i = 0; i < expired.length; i++) gapCache.delete(expired[i]);
}

function rememberGap(key: string, entry: { at: number; ttl: number; body: SegmentGapResult }): void {
  if (!gapCache.has(key) && gapCache.size >= GAP_CACHE_MAX) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    gapCache.forEach((cached, cachedKey) => {
      if (cached.at < oldestAt) {
        oldestAt = cached.at;
        oldestKey = cachedKey;
      }
    });
    if (oldestKey) gapCache.delete(oldestKey);
  }
  gapCache.set(key, entry);
}

function cachedSecNames(ticker: string, now: number): string[] | null {
  const entry = secNameCache.get(ticker.toUpperCase());
  if (!entry) return null;
  if (now - entry.at >= entry.ttl) {
    secNameCache.delete(ticker.toUpperCase());
    return null;
  }
  return entry.names;
}

function rememberSecNames(ticker: string, now: number, names: string[]): void {
  const key = ticker.toUpperCase();
  if (!secNameCache.has(key) && secNameCache.size >= GAP_CACHE_MAX) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    secNameCache.forEach((entry, entryKey) => {
      if (entry.at < oldestAt) {
        oldestAt = entry.at;
        oldestKey = entryKey;
      }
    });
    if (oldestKey) secNameCache.delete(oldestKey);
  }
  secNameCache.set(key, { at: now, ttl: names.length === 0 ? GAP_EMPTY_CACHE_MS : GAP_CACHE_MS, names });
}

function namesFromSecSegments(sec: { segments?: ReadonlyArray<{ name?: unknown }> } | null): string[] {
  const names: string[] = [];
  for (const segment of sec?.segments ?? []) {
    const name = typeof segment.name === "string" ? segment.name.trim() : "";
    if (!name || names.some((current) => current.toLowerCase() === name.toLowerCase())) continue;
    names.push(name);
  }
  return names;
}

function takeGapSlot(ip: string, now: number, max: number, windowMs: number): boolean {
  const recent = (rateBuckets.get(ip) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= max) {
    rateBuckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  return true;
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function segmentGapPrompt(input: {
  ticker: string;
  companyName: string;
  description: string;
  products: string[];
  regions: string[];
  industry?: string;
  sector?: string;
}): string {
  const closed = (rows: string[]) => (rows.length > 0 ? rows.slice(0, 24).join(" | ") : "keine");
  const industryEcho = input.industry || input.sector || "";
  return [
    "Bekannte Fakten. Diese Namen und Zahlen nicht ersetzen und nicht als neues Top-Level-Segment anlegen.",
    `Ticker ${input.ticker}. Firma: ${input.companyName}.`,
    `Branche: ${industryEcho || "n/a"}.`,
    `Profil: ${clip(input.description, 600) || "n/a"}.`,
    `Erlaubte Produkt-Eltern, nur diese Zeichenfolgen: ${closed(input.products)}.`,
    `Erlaubte Regionen-Eltern, nur diese Zeichenfolgen: ${closed(input.regions)}.`,
    "parent ist genau eine dieser Zeichenfolgen. Jeder andere Elternname ist ungültig und wird verworfen.",
    "Nenne Produktlinien und Regionen, die diese Firma führt und die in den beiden Listen fehlen.",
    "Ein bekannter Name kommt nicht noch einmal als Treffer.",
    "Ein Land oder eine Region ist kein Produkt-Unterposten. Eine Region nur unter dem Regionen-Eltern, das sie geografisch enthält, nicht unter einem anderen Land.",
    "shareOfParentPct ist der Anteil am Elternsegment in Prozent. Die Zahl nur zusammen mit source, die Firma, Dokumenttyp und Jahr nennt, sonst null. Nie 0.",
    "revenue nur mit derselben Quelle, in der Währung der Elternzeile. basis nennt die Lücke und darf nicht leer sein.",
    `Antwortform: {"companyEcho":"${input.companyName}","industryEcho":"${industryEcho}","children":[{"parent":"","name":"","owner":"${input.companyName}","revenue":null,"shareOfParentPct":null,"growthPct":null,"basis":"Begründung","source":null}]}.`,
  ].join("\n");
}

function fold(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function reviewSegmentGaps(
  payload: unknown,
  products: readonly string[],
  regions: readonly string[],
  companyName: string,
  ticker: string,
  description: string,
  parentRevenue: ReadonlyMap<string, number> = new Map(),
): SegmentGapResult {
  const record = payload && typeof payload === "object" ? payload as { children?: unknown } : {};
  const raw = Array.isArray(record.children) ? record.children : [];
  const known = new Set([...products, ...regions].map(fold));
  const grouped = new Map<string, { kind: "product" | "geographic"; rows: unknown[] }>();
  const notes: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { parent?: unknown; name?: unknown; shareOfParentPct?: unknown };
    const parent = clip(row.parent, 120);
    const name = clip(row.name, 80);
    if (!parent || !known.has(fold(parent))) {
      if (name) notes.push(`n/a — Elternsegment nicht in der Liste: ${name}`);
      continue;
    }
    if (row.shareOfParentPct === 0 && name) notes.push(`n/a — Anteil 0 verworfen: ${name}`);
    const parentIsRegion = regions.some((region) => fold(region) === fold(parent));
    const parentIsProduct = products.some((product) => fold(product) === fold(parent));
    if (name && isGeographicPlace(name) && !parentIsRegion) {
      notes.push(`n/a — Region nicht als Produkt-Unterposten: ${name}`);
      continue;
    }
    if (name && isGeographicPlace(name) && parentIsRegion && !regionFitsParent(parent, name)) {
      notes.push(`n/a — Region passt nicht unter ${parent}: ${name}`);
      continue;
    }
    const kind: "product" | "geographic" = name && isGeographicPlace(name) && parentIsRegion
      ? "geographic"
      : parentIsRegion && !parentIsProduct
        ? "geographic"
        : "product";
    const bucket = grouped.get(`${kind}:${fold(parent)}`) ?? { kind, rows: [] };
    bucket.rows.push(item);
    grouped.set(`${kind}:${fold(parent)}`, bucket);
  }
  const items: SegmentGapItem[] = [];
  for (const bucket of Array.from(grouped.values())) {
    const parent = clip((bucket.rows[0] as { parent?: unknown }).parent, 120);
    const siblings = [...products, ...regions].filter((name) => fold(name) !== fold(parent));
    const reviewed = reviewKiChildren(parent, { children: bucket.rows }, null, {
      kind: bucket.kind,
      siblings,
      businessNames: products,
      companyName,
      ticker,
      description,
    });
    if (reviewed.reason) notes.push(reviewed.reason);
    const enriched: SegmentGapItem[] = [];
    for (const child of reviewed.children) {
      if (known.has(fold(child.name))) continue;
      enriched.push(toGapItem(parent, bucket.kind, child, parentRevenue.get(fold(parent)) ?? null, companyName));
    }
    const shareSum = enriched.reduce((sum, row) => sum + (row.shareOfParentPct ?? 0), 0);
    if (enriched.some((row) => row.shareOfParentPct != null) && shareSum > 100) {
      notes.push(KI_SUM_EXCEEDS_PARENT);
      continue;
    }
    for (const row of enriched) items.push(row);
  }
  return { items, reason: notes.filter((note) => note.trim()).join(" ") || null };
}

function revenuesFromRows(rows: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const name of segmentNamesFromFmpRows(rows)) {
    const revenue = reportedParentRevenue(rows, name);
    if (revenue != null && revenue > 0) map.set(fold(name), revenue);
  }
  return map;
}

function toGapItem(
  parent: string,
  kind: "product" | "geographic",
  child: SegmentChild,
  parentRevenue: number | null,
  companyName: string,
): SegmentGapItem {
  let share = child.shareOfParentPct != null && child.shareOfParentPct > 0 ? child.shareOfParentPct : null;
  let shareOrigin: SegmentGapItem["shareOrigin"] = share != null ? "estimate" : null;
  let basis = child.basis ?? "";
  const sourced = concreteSource(basis, companyName);
  if (share != null && !sourced) {
    share = null;
    shareOrigin = null;
  }
  if (share == null && child.revenue != null && child.revenue > 0 && parentRevenue != null && parentRevenue > 0 && sourced) {
    const rounded = Math.round((child.revenue / parentRevenue) * 1000) / 10;
    if (rounded > 0 && rounded <= 100) {
      share = rounded;
      shareOrigin = "fact";
      const formula = `Formel: ${child.revenue} / ${parentRevenue}`;
      if (!basis.includes(formula)) basis = `${basis} · ${formula}`;
    }
  }
  return {
    parent,
    kind,
    name: child.name,
    shareOfParentPct: share,
    growthPct: child.growthPct ?? null,
    basis,
    shareOrigin,
  };
}

export function registerSegmentGapRoute(app: Express, deps: SegmentGapDeps = {}): void {
  app.post("/api/segment-gaps", async (req: Request, res: Response) => {
    const ticker = typeof req.body?.ticker === "string" ? req.body.ticker.trim() : "";
    if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: "ticker fehlt oder ist ungültig" });
    const now = deps.now?.() ?? Date.now();
    const limit = deps.rateLimit ?? { max: DEFAULT_RATE_MAX, windowMs: DEFAULT_RATE_WINDOW_MS };
    try {
      const identity = deps.identity ? await deps.identity(ticker) : await loadOutlineIdentity(ticker);
      if (!identity?.companyName) return res.json({ items: [], reason: OUTLINE_NO_IDENTITY });
      const available = deps.available ?? isFmpAvailable;
      let products: string[] = [];
      let regions: string[] = [];
      let productRaw: unknown[] = [];
      let regionRaw: unknown[] = [];
      if (available()) {
        const productRows = deps.productRows ? await deps.productRows(ticker) : await fmpSegmentationRows("product", ticker, "annual");
        const regionRows = deps.regionRows ? await deps.regionRows(ticker) : await fmpSegmentationRows("geographic", ticker, "annual");
        productRaw = Array.isArray(productRows) ? productRows : [];
        regionRaw = Array.isArray(regionRows) ? regionRows : [];
        products = segmentNamesFromFmpRows(productRaw);
        regions = segmentNamesFromFmpRows(regionRaw);
      }
      if (products.length === 0) {
        const cachedNames = cachedSecNames(ticker, now);
        const secNames = cachedNames ?? namesFromSecSegments(
          deps.secSegments
            ? await deps.secSegments(ticker, identity.companyName)
            : await fetchSecBusinessSegments(ticker, identity.companyName),
        );
        if (!cachedNames) rememberSecNames(ticker, now, secNames);
        if (secNames.length > 0) products = secNames;
      }
      const key = segmentGapCacheKey(ticker, products, regions);
      pruneGapCache(now);
      const hit = gapCache.get(key);
      if (hit && now - hit.at < hit.ttl) return res.json(hit.body);
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!takeGapSlot(ip, now, limit.max, limit.windowMs)) {
        return res.status(429).json({ error: "Zu viele Abfragen" });
      }
      if (rateBuckets.size > 2000) {
        const stale: string[] = [];
        rateBuckets.forEach((stamps, stampKey) => {
          const fresh = stamps.filter((at) => now - at < limit.windowMs);
          if (fresh.length === 0) stale.push(stampKey);
          else rateBuckets.set(stampKey, fresh);
        });
        for (let i = 0; i < stale.length; i++) rateBuckets.delete(stale[i]);
      }
      const run = deps.llm ?? callLLMJson;
      if (!deps.llm && !isLLMAvailable()) return res.status(503).json({ error: "n/a — KI nicht erreichbar" });
      let payload: unknown = null;
      try {
        const result = await run({
          systemPrompt: "Antworte nur mit JSON. Schätze nur fehlende Produktlinien und Regionen der genannten Firma. companyEcho muss den Firmennamen enthalten, industryEcho die genannte Branche. parent ist genau eine der genannten Zeichenfolgen. Ein Land ist kein Produkt-Unterposten. Eine Region nur unter dem passenden Regionen-Eltern. Bekannte Namen nicht wiederholen. Eine Zahl nur mit Quelle, nie 0. Das Label ist KI-Schätzung, kein Override.",
          prompt: segmentGapPrompt({
            ticker,
            companyName: identity.companyName,
            description: identity.description ?? "",
            products,
            regions,
            industry: identity.industry,
            sector: identity.sector,
          }),
          maxTokens: 800,
          temperature: 0.2,
          signal: AbortSignal.timeout(SEGMENT_CHILDREN_KI_TIMEOUT_MS),
        });
        payload = result?.data ?? null;
      } catch {
        payload = null;
      }
      if (payload == null) return res.status(503).json({ error: "n/a — KI nicht erreichbar" });
      if (!outlineEchoMatches(payload, identity.companyName, identity.industry, identity.sector)) {
        return res.json({ items: [], reason: OUTLINE_MISMATCH });
      }
      const revenues = revenuesFromRows(productRaw);
      revenuesFromRows(regionRaw).forEach((value, revenueKey) => {
        if (!revenues.has(revenueKey)) revenues.set(revenueKey, value);
      });
      const body = reviewSegmentGaps(payload, products, regions, identity.companyName, ticker, identity.description ?? "", revenues);
      const ttl = body.items.length === 0 ? GAP_EMPTY_CACHE_MS : GAP_CACHE_MS;
      rememberGap(key, { at: now, ttl, body });
      return res.json(body);
    } catch {
      return res.status(502).json({ error: "n/a — fehlende Segmente nicht erreichbar" });
    }
  });
}
