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
import { convertSegmentRowsToUsd, fmpSegmentationRows, isFmpAvailable, type FmpSegmentRow } from "./fmp";
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
export const SEGMENT_GAP_PROMPT_VERSION = "n36-gap-p5";
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
  /** Standard ist convertSegmentRowsToUsd aus #505. Tests setzen einen Kurs, ohne das Netz zu rufen. */
  convertSegments?: (rows: FmpSegmentRow[]) => Promise<FmpSegmentRow[]>;
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
  parentsUsd?: ReadonlyArray<{ name: string; revenueUsd: number | null }>;
  fxNote?: string | null;
}): string {
  const closed = (rows: string[]) => (rows.length > 0 ? rows.slice(0, 24).join(" | ") : "keine");
  const industryEcho = input.industry || input.sector || "";
  const parentLine = (input.parentsUsd ?? []).length > 0
    ? (input.parentsUsd ?? []).map((row) => (
      row.revenueUsd != null && row.revenueUsd > 0 ? `${row.name} ${row.revenueUsd} USD` : `${row.name} n/a`
    )).join(" | ")
    : "n/a";
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
    "Währung der Elternumsätze: USD.",
    `Elternumsätze in USD: ${parentLine}.`,
    input.fxNote ? input.fxNote : "",
    "shareOfParentPct ist der Anteil am Elternsegment in Prozent. Die Zahl nur zusammen mit source, die Firma, Dokumenttyp und Jahr nennt, sonst null. Nie 0.",
    "revenue ist der Umsatz des Unterpostens in USD. currency ist USD. Eine andere Währung wird nicht umgerechnet und nicht als Anteil verwendet.",
    "basis nennt die Lücke und darf nicht leer sein.",
    `Antwortform: {"companyEcho":"${input.companyName}","industryEcho":"${industryEcho}","children":[{"parent":"","name":"","owner":"${input.companyName}","currency":"USD","revenue":null,"shareOfParentPct":null,"growthPct":null,"basis":"Begründung","source":null}]}.`,
  ].filter((line) => line.length > 0).join("\n");
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
      const childCurrency = currencyOnRows(bucket.rows, child.name);
      const parentUsd = parentRevenue.get(fold(parent)) ?? null;
      const item = toGapItem(parent, bucket.kind, child, parentUsd, companyName, childCurrency);
      if (
        child.revenue != null && child.revenue > 0
        && parentUsd != null
        && childCurrency !== "USD"
        && item.shareOrigin !== "fact"
        && concreteSource(item.basis, companyName)
      ) {
        notes.push(`n/a — Währung passt nicht zur Elternzeile: ${child.name}`);
      }
      enriched.push(item);
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

function rowYear(row: Record<string, unknown>): number {
  const year = row.fiscalYear;
  if (typeof year === "number" && Number.isInteger(year)) return year;
  if (typeof year === "string" && /^\d{4}/.test(year)) return Number(year.slice(0, 4));
  const date = typeof row.date === "string" ? row.date : "";
  if (/^\d{4}/.test(date)) return Number(date.slice(0, 4));
  return 0;
}

function reportedCurrencyOf(raw: unknown[]): string {
  if (!Array.isArray(raw)) return "";
  let bestYear = -1;
  let code = "";
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.period === "string" && /^Q[1-4]$/i.test(rec.period.trim())) continue;
    const reported = typeof rec.reportedCurrency === "string" ? rec.reportedCurrency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(reported)) continue;
    const year = rowYear(rec);
    if (year >= bestYear) {
      bestYear = year;
      code = reported;
    }
  }
  return code;
}

/** Rohe Segmentzahlen in die Form, die convertSegmentRowsToUsd aus #505 erwartet. */
function segmentRowsForUsd(raw: unknown[]): FmpSegmentRow[] {
  const currency = reportedCurrencyOf(raw);
  const rows: FmpSegmentRow[] = [];
  for (const name of segmentNamesFromFmpRows(raw)) {
    const revenue = reportedParentRevenue(raw, name);
    if (revenue == null || !(revenue > 0)) continue;
    rows.push({
      name,
      revenue,
      percentage: 0,
      growth: null,
      ...(currency ? { reportedCurrency: currency } : {}),
    });
  }
  return rows;
}

function revenuesFromConverted(rows: readonly FmpSegmentRow[]): { revenues: Map<string, number>; fxNote: string | null } {
  const revenues = new Map<string, number>();
  let fxNote: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.fxNaReason) {
      fxNote = row.fxNaReason;
      continue;
    }
    if (row.revenue > 0) revenues.set(fold(row.name), row.revenue);
  }
  return { revenues, fxNote };
}

async function usdParentRevenues(
  productRaw: unknown[],
  regionRaw: unknown[],
  convert: (rows: FmpSegmentRow[]) => Promise<FmpSegmentRow[]>,
): Promise<{ revenues: Map<string, number>; fxNote: string | null }> {
  const product = revenuesFromConverted(await convert(segmentRowsForUsd(productRaw)));
  const region = revenuesFromConverted(await convert(segmentRowsForUsd(regionRaw)));
  region.revenues.forEach((value, key) => {
    if (!product.revenues.has(key)) product.revenues.set(key, value);
  });
  const fxNote = [product.fxNote, region.fxNote].filter((note) => note && note.trim()).join(" ") || null;
  return { revenues: product.revenues, fxNote };
}

function currencyOnRows(rows: readonly unknown[], name: string): string {
  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; currency?: unknown };
    if (clip(row.name, 80) !== name) continue;
    const code = clip(row.currency, 12).toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : "";
  }
  return "";
}

function toGapItem(
  parent: string,
  kind: "product" | "geographic",
  child: SegmentChild,
  parentRevenue: number | null,
  companyName: string,
  childCurrency: string,
): SegmentGapItem {
  let share = child.shareOfParentPct != null && child.shareOfParentPct > 0 ? child.shareOfParentPct : null;
  let shareOrigin: SegmentGapItem["shareOrigin"] = share != null ? "estimate" : null;
  let basis = child.basis ?? "";
  const sourced = concreteSource(basis, companyName);
  if (share != null && !sourced) {
    share = null;
    shareOrigin = null;
  }
  if (
    share == null
    && child.revenue != null && child.revenue > 0
    && parentRevenue != null && parentRevenue > 0
    && sourced
    && childCurrency === "USD"
  ) {
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
      const convert = deps.convertSegments ?? convertSegmentRowsToUsd;
      const usd = await usdParentRevenues(productRaw, regionRaw, convert);
      const parentsUsd = [...products, ...regions].slice(0, 24).map((name) => ({
        name,
        revenueUsd: usd.revenues.get(fold(name)) ?? null,
      }));
      const run = deps.llm ?? callLLMJson;
      if (!deps.llm && !isLLMAvailable()) return res.status(503).json({ error: "n/a — KI nicht erreichbar" });
      let payload: unknown = null;
      try {
        const result = await run({
          systemPrompt: "Antworte nur mit JSON. Schätze nur fehlende Produktlinien und Regionen der genannten Firma. companyEcho muss den Firmennamen enthalten, industryEcho die genannte Branche. parent ist genau eine der genannten Zeichenfolgen. Ein Land ist kein Produkt-Unterposten. Eine Region nur unter dem passenden Regionen-Eltern. Bekannte Namen nicht wiederholen. revenue und currency in USD. Eine Zahl nur mit Quelle, nie 0. Das Label ist KI-Schätzung, kein Override.",
          prompt: segmentGapPrompt({
            ticker,
            companyName: identity.companyName,
            description: identity.description ?? "",
            products,
            regions,
            industry: identity.industry,
            sector: identity.sector,
            parentsUsd,
            fxNote: usd.fxNote,
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
      const reviewed = reviewSegmentGaps(payload, products, regions, identity.companyName, ticker, identity.description ?? "", usd.revenues);
      const reason = [reviewed.reason, usd.fxNote && !(reviewed.reason ?? "").includes(usd.fxNote) ? usd.fxNote : ""]
        .filter((note) => note && note.trim())
        .join(" ") || null;
      const body = { items: reviewed.items, reason };
      const ttl = body.items.length === 0 ? GAP_EMPTY_CACHE_MS : GAP_CACHE_MS;
      rememberGap(key, { at: now, ttl, body });
      return res.json(body);
    } catch {
      return res.status(502).json({ error: "n/a — fehlende Segmente nicht erreichbar" });
    }
  });
}
