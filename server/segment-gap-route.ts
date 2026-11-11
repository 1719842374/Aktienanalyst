/**
 * POST /api/segment-gaps
 *
 * Fehlende Produktlinien und Regionen, die FMP/SEC nicht führen.
 * Kein Ticker-Hardcoding. Treffer hängen an einem vorhandenen Elternsegment.
 * Top-Level-Summen und FMP-Zeilen bleiben unangetastet. Fehler werden nicht 24 h gecacht.
 */
import type { Express, Request, Response } from "express";
import {
  OUTLINE_MISMATCH,
  OUTLINE_NO_IDENTITY,
  outlineEchoMatches,
  reviewKiChildren,
  segmentNamesFromFmpRows,
  type SegmentChild,
} from "../shared/segment-children";
import { fmpSegmentationRows, isFmpAvailable } from "./fmp";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import {
  loadOutlineIdentity,
  SEGMENT_CHILDREN_KI_TIMEOUT_MS,
  type OutlineIdentity,
} from "./segment-growth-route";

const GAP_CACHE_MS = 24 * 60 * 60 * 1000;
const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,31}$/i;
const gapCache = new Map<string, { at: number; body: SegmentGapResult }>();

export interface SegmentGapItem {
  parent: string;
  kind: "product" | "geographic";
  name: string;
  shareOfParentPct: number | null;
  growthPct: number | null;
  basis: string;
}

export interface SegmentGapResult {
  items: SegmentGapItem[];
  reason: string | null;
}

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
}

export function resetSegmentGapCacheForTests(): void {
  gapCache.clear();
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
}): string {
  const list = (rows: string[]) => (rows.length > 0 ? rows.slice(0, 24).join(", ") : "n/a");
  return [
    "Bekannte Fakten. Diese Namen und Zahlen nicht ersetzen und nicht als neues Top-Level-Segment anlegen.",
    `Ticker ${input.ticker}. Firma: ${input.companyName}.`,
    `Profil: ${clip(input.description, 600) || "n/a"}.`,
    `Geschäftssegmente: ${list(input.products)}.`,
    `Regionen: ${list(input.regions)}.`,
    "Nenne Produktlinien und Regionen, die diese Firma führt und die in den beiden Listen fehlen.",
    "parent ist genau einer der bekannten Namen. Ein bekannter Name kommt nicht noch einmal als Treffer.",
    "Eine Zahl nur, wenn source Firma, Dokumenttyp und Jahr nennt, sonst null. basis nennt die Lücke und darf nicht leer sein.",
    `Antwortform: {"companyEcho":"${input.companyName}","industryEcho":"","children":[{"parent":"","name":"","owner":"${input.companyName}","shareOfParentPct":null,"growthPct":null,"basis":"Begründung","source":null}]}.`,
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
): SegmentGapResult {
  const record = payload && typeof payload === "object" ? payload as { children?: unknown } : {};
  const raw = Array.isArray(record.children) ? record.children : [];
  const known = new Set([...products, ...regions].map(fold));
  const grouped = new Map<string, { kind: "product" | "geographic"; rows: unknown[] }>();
  const notes: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { parent?: unknown };
    const parent = clip(row.parent, 120);
    if (!parent || !known.has(fold(parent))) {
      const name = clip((item as { name?: unknown }).name, 80);
      if (name) notes.push(`n/a — Elternsegment nicht in der Liste: ${name}`);
      continue;
    }
    const kind = regions.some((name) => fold(name) === fold(parent)) && !products.some((name) => fold(name) === fold(parent))
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
    for (const child of reviewed.children) {
      if (known.has(fold(child.name))) continue;
      items.push(toGapItem(parent, bucket.kind, child));
    }
  }
  return { items, reason: notes.filter((note) => note.trim()).join(" ") || null };
}

function toGapItem(parent: string, kind: "product" | "geographic", child: SegmentChild): SegmentGapItem {
  return {
    parent,
    kind,
    name: child.name,
    shareOfParentPct: child.shareOfParentPct,
    growthPct: child.growthPct ?? null,
    basis: child.basis ?? "",
  };
}

export function registerSegmentGapRoute(app: Express, deps: SegmentGapDeps = {}): void {
  app.post("/api/segment-gaps", async (req: Request, res: Response) => {
    const ticker = typeof req.body?.ticker === "string" ? req.body.ticker.trim() : "";
    if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: "ticker fehlt oder ist ungültig" });
    const now = deps.now?.() ?? Date.now();
    const key = ticker.toUpperCase();
    const hit = gapCache.get(key);
    if (hit && now - hit.at < GAP_CACHE_MS) return res.json(hit.body);
    try {
      const identity = deps.identity ? await deps.identity(ticker) : await loadOutlineIdentity(ticker);
      if (!identity?.companyName) return res.json({ items: [], reason: OUTLINE_NO_IDENTITY });
      const available = deps.available ?? isFmpAvailable;
      let products: string[] = [];
      let regions: string[] = [];
      if (available()) {
        const productRows = deps.productRows ? await deps.productRows(ticker) : await fmpSegmentationRows("product", ticker, "annual");
        const regionRows = deps.regionRows ? await deps.regionRows(ticker) : await fmpSegmentationRows("geographic", ticker, "annual");
        products = segmentNamesFromFmpRows(Array.isArray(productRows) ? productRows : []);
        regions = segmentNamesFromFmpRows(Array.isArray(regionRows) ? regionRows : []);
      }
      const run = deps.llm ?? callLLMJson;
      if (!deps.llm && !isLLMAvailable()) return res.status(503).json({ error: "n/a — KI nicht erreichbar" });
      let payload: unknown = null;
      try {
        const result = await run({
          systemPrompt: "Antworte nur mit JSON. Schätze nur fehlende Produktlinien und Regionen der genannten Firma. Bekannte Namen nicht wiederholen. Eine Zahl nur mit Quelle. Das Label ist KI-Schätzung, kein Override.",
          prompt: segmentGapPrompt({
            ticker,
            companyName: identity.companyName,
            description: identity.description ?? "",
            products,
            regions,
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
      const body = reviewSegmentGaps(payload, products, regions, identity.companyName, ticker, identity.description ?? "");
      gapCache.set(key, { at: now, body });
      return res.json(body);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Fehlende Segmente fehlgeschlagen";
      return res.status(502).json({ error: message.slice(0, 200) });
    }
  });
}
