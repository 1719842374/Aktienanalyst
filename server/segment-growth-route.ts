/**
 * GET /api/segment-growth/:ticker
 *
 * Lücken-Wachstum für Geschäfts- und Regionensegmente.
 * Schreibt nicht in den Analyze-Cache und nicht in den Score.
 * Fakt-YoY aus dem gleichen Jahresnamen bleibt in /api/analyze; hier nur
 * „berechnet“ und begründetes n/a.
 */
import type { Express, Request, Response } from "express";
import {
  annotateMissingSegmentGrowth,
  snapshotsFromFmpRows,
  type SegmentGrowthAnnotation,
  type StatementYear,
} from "../shared/segment-growth-calc";
import {
  fmpBalanceSheet,
  fmpCashFlow,
  fmpIncomeStatement,
  fmpSegmentationRows,
  isFmpAvailable,
  promoteNonGeoRowsToBusiness,
} from "./fmp";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { fetchSecBusinessSegments } from "./sec-segments";
import { curatedSegmentNames } from "./curated-product-segments";
import {
  KI_UNAVAILABLE,
  SEGMENT_CHILDREN_ROUTE,
  SEGMENT_UNKNOWN,
  childrenFromFmpRows,
  reportedParentRevenue,
  resolveSegmentChildren,
  reviewKiChildren,
  segmentNamesFromFmpRows,
  type SegmentChildrenResult,
} from "../shared/segment-children";

const CACHE_MS = 15 * 60 * 1000;
const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,31}$/i;

interface CacheBody {
  ticker: string;
  business: SegmentGrowthAnnotation[];
  geographic: SegmentGrowthAnnotation[];
  source: string;
}

const cache = new Map<string, { at: number; body: CacheBody }>();

export function resetSegmentGrowthCacheForTests(): void {
  cache.clear();
}

const CHILDREN_CACHE_MS = 24 * 60 * 60 * 1000;
const CHILDREN_ERROR_CACHE_MS = 60 * 1000;
const CHILDREN_CACHE_MAX = 400;
export const SEGMENT_CHILDREN_KI_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_MAX = 20;
const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const childCache = new Map<string, { at: number; ttl: number; body: SegmentChildrenResult }>();
const rateBuckets = new Map<string, number[]>();

export function resetSegmentChildrenGuardsForTests(): void {
  childCache.clear();
  rateBuckets.clear();
}

export function takeSegmentChildrenSlot(ip: string, now: number, max: number, windowMs: number): boolean {
  const recent = (rateBuckets.get(ip) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= max) {
    rateBuckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  return true;
}

function yearKey(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const rec = row as { date?: unknown; fiscalYear?: unknown; calendarYear?: unknown };
  if (typeof rec.date === "string" && rec.date.length >= 4) return rec.date.slice(0, 10);
  if (rec.fiscalYear != null) return String(rec.fiscalYear);
  if (rec.calendarYear != null) return String(rec.calendarYear);
  return "";
}

function revenueOf(row: unknown): number | null {
  if (!row || typeof row !== "object") return null;
  const n = Number((row as { revenue?: unknown }).revenue);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function statementYearsFromFmp(income: unknown, cashflow: unknown, balance: unknown): StatementYear[] {
  const map = new Map<string, StatementYear>();
  const take = (rows: unknown, field: "income" | "cashflow" | "balance") => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const key = yearKey(row);
      const revenue = revenueOf(row);
      if (!key || revenue == null) continue;
      const year = map.get(key) ?? { periodKey: key };
      year[field] = revenue;
      map.set(key, year);
    }
  };
  take(income, "income");
  take(cashflow, "cashflow");
  take(balance, "balance");
  return Array.from(map.values()).sort((a, b) => b.periodKey.localeCompare(a.periodKey)).slice(0, 2);
}

export async function loadSegmentGrowth(ticker: string): Promise<CacheBody> {
  const key = ticker.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  const [productAnnual, productQuarter, geoAnnual, geoQuarter, income, cashflow, balance] = await Promise.all([
    fmpSegmentationRows("product", key, "annual"),
    fmpSegmentationRows("product", key, "quarter"),
    fmpSegmentationRows("geographic", key, "annual"),
    fmpSegmentationRows("geographic", key, "quarter"),
    fmpIncomeStatement(key, 2).catch(() => []),
    fmpCashFlow(key, 2).catch(() => []),
    fmpBalanceSheet(key, 2).catch(() => []),
  ]);
  const statements = statementYearsFromFmp(income, cashflow, balance);
  const body: CacheBody = {
    ticker: key,
    business: annotateMissingSegmentGrowth({
      annual: snapshotsFromFmpRows(productAnnual),
      quarterly: snapshotsFromFmpRows(productQuarter),
      statements,
    }),
    geographic: annotateMissingSegmentGrowth({
      annual: snapshotsFromFmpRows(geoAnnual),
      quarterly: snapshotsFromFmpRows(geoQuarter),
      statements,
    }),
    source: "FMP revenue-product-segmentation, revenue-geographic-segmentation, income-statement, cash-flow-statement, balance-sheet-statement",
  };
  cache.set(key, { at: Date.now(), body });
  return body;
}

export interface SegmentChildrenDeps {
  fmpAvailable: () => boolean;
  raw: (kind: "product" | "geographic", ticker: string) => Promise<unknown[]>;
  ki: (ticker: string, parent: string) => Promise<unknown>;
  names?: (ticker: string, kind: "product" | "geographic") => Promise<string[]>;
  now?: () => number;
  rateLimit?: { max: number; windowMs: number };
}

async function defaultDisplayedNames(ticker: string, kind: "product" | "geographic"): Promise<string[]> {
  const ownRows = await fmpSegmentationRows(kind, ticker, "annual");
  const names = segmentNamesFromFmpRows(ownRows);
  if (kind === "geographic") return names;
  if (names.length === 0) {
    for (const name of curatedSegmentNames(ticker)) names.push(name);
  }
  if (names.length === 0) {
    const sec = await fetchSecBusinessSegments(ticker, ticker).catch(() => null);
    for (const segment of sec?.segments ?? []) {
      if (typeof segment.name === "string" && segment.name.trim()) names.push(segment.name.trim());
    }
  }
  const geoRows = await fmpSegmentationRows("geographic", ticker, "annual");
  const geo = segmentNamesFromFmpRows(geoRows).map((name) => ({ name, revenue: 1 }));
  const business = names.map((name) => ({ name, revenue: 1 }));
  for (const row of promoteNonGeoRowsToBusiness(business, geo)) {
    if (!names.some((name) => name.toLowerCase() === row.name.toLowerCase())) names.push(row.name);
  }
  return names;
}

async function defaultKiChildren(ticker: string, parent: string): Promise<unknown> {
  if (!isLLMAvailable()) return null;
  try {
    const result = await callLLMJson({
      systemPrompt: "Antworte nur mit JSON. Erfinde keine Untersegmente und keine Zahlen. Unbekannt heißt leeres children-Array.",
      prompt: `Ticker ${ticker}. Hauptsegment "${parent}". Nur Untersegmente dieses einen serverseitigen Segmentnamens. Jeder Wert braucht ein Feld basis mit Quelle oder Begründung. Form: {"children":[{"name":"","shareOfParentPct":null,"basis":""}]}. Ohne Beleg: {"children":[]}.`,
      maxTokens: 400,
      temperature: 0,
      signal: AbortSignal.timeout(SEGMENT_CHILDREN_KI_TIMEOUT_MS),
    });
    return result?.data ?? null;
  } catch {
    return null;
  }
}

export function defaultSegmentChildrenDeps(): SegmentChildrenDeps {
  return {
    fmpAvailable: isFmpAvailable,
    raw: (kind, ticker) => fmpSegmentationRows(kind, ticker, "annual"),
    names: defaultDisplayedNames,
    ki: defaultKiChildren,
  };
}

export async function loadSegmentChildren(
  ticker: string,
  parent: string,
  kind: "product" | "geographic",
  deps: SegmentChildrenDeps = defaultSegmentChildrenDeps(),
): Promise<SegmentChildrenResult> {
  const label = parent.trim();
  let raw: unknown[] = [];
  if (deps.fmpAvailable()) {
    try {
      const rows = await deps.raw(kind, ticker);
      raw = Array.isArray(rows) ? rows : [];
    } catch {
      raw = [];
    }
  }
  const fmp = childrenFromFmpRows(raw, label);
  if (fmp.length > 0) return resolveSegmentChildren(label, fmp, []);
  let kiPayload: unknown = null;
  try {
    kiPayload = await deps.ki(ticker, label);
  } catch {
    kiPayload = null;
  }
  if (kiPayload == null) return { parent: label, children: [], reason: KI_UNAVAILABLE };
  return reviewKiChildren(label, kiPayload, reportedParentRevenue(raw, label));
}

export function registerSegmentGrowthRoute(app: Express, childrenDeps?: SegmentChildrenDeps): void {
  app.get("/api/segment-growth/:ticker", async (req: Request, res: Response) => {
    const raw = req.params.ticker;
    const ticker = (Array.isArray(raw) ? raw[0] : raw) ?? "";
    if (!TICKER_RE.test(ticker)) {
      return res.status(400).json({ error: "ticker fehlt oder ist ungültig" });
    }
    if (!isFmpAvailable()) {
      return res.status(503).json({
        error: "FMP_API_KEY fehlt",
        ticker: ticker.toUpperCase(),
        business: [],
        geographic: [],
        source: "n/a — FMP_API_KEY fehlt",
      });
    }
    try {
      const body = await loadSegmentGrowth(ticker);
      return res.json(body);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Segment-Wachstum fehlgeschlagen";
      return res.status(502).json({ error: message.slice(0, 200) });
    }
  });

  app.get(`${SEGMENT_CHILDREN_ROUTE}/:ticker`, async (req: Request, res: Response) => {
    const raw = req.params.ticker;
    const ticker = (Array.isArray(raw) ? raw[0] : raw) ?? "";
    const parent = typeof req.query.parent === "string" ? req.query.parent.trim() : "";
    const kind = req.query.kind === "geographic" ? "geographic" : req.query.kind === "product" ? "product" : null;
    if (!TICKER_RE.test(ticker) || !parent || parent.length > 120 || !kind) {
      return res.status(400).json({ error: "ticker, parent oder kind fehlt" });
    }
    const deps = childrenDeps ?? defaultSegmentChildrenDeps();
    const now = deps.now?.() ?? Date.now();
    const limit = deps.rateLimit ?? { max: DEFAULT_RATE_MAX, windowMs: DEFAULT_RATE_WINDOW_MS };
    const cacheKey = `${ticker.toUpperCase()}|${kind}|${parent.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const expired: string[] = [];
    childCache.forEach((entry, key) => {
      if (now - entry.at >= entry.ttl) expired.push(key);
    });
    for (let i = 0; i < expired.length; i++) childCache.delete(expired[i]);
    const hit = childCache.get(cacheKey);
    if (hit && now - hit.at < hit.ttl) return res.json(hit.body);
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!takeSegmentChildrenSlot(ip, now, limit.max, limit.windowMs)) {
      return res.status(429).json({ error: "Zu viele Abfragen" });
    }
    if (rateBuckets.size > 2000) {
      const stale: string[] = [];
      rateBuckets.forEach((stamps, key) => {
        const fresh = stamps.filter((at) => now - at < limit.windowMs);
        if (fresh.length === 0) stale.push(key);
        else rateBuckets.set(key, fresh);
      });
      for (let i = 0; i < stale.length; i++) rateBuckets.delete(stale[i]);
    }
    try {
      const rawRows = deps.fmpAvailable() ? await deps.raw(kind, ticker) : [];
      const listed = deps.names
        ? await deps.names(ticker, kind)
        : segmentNamesFromFmpRows(Array.isArray(rawRows) ? rawRows : []);
      const wanted = parent.toLowerCase().replace(/\s+/g, " ").trim();
      const canonical = listed.find((name) => name.toLowerCase().replace(/\s+/g, " ").trim() === wanted) ?? null;
      if (!canonical) return res.status(400).json({ error: SEGMENT_UNKNOWN });
      const body = await loadSegmentChildren(ticker, canonical, kind, deps);
      const ttl = body.reason === KI_UNAVAILABLE && body.children.length === 0 ? CHILDREN_ERROR_CACHE_MS : CHILDREN_CACHE_MS;
      if (childCache.size >= CHILDREN_CACHE_MAX) {
        let oldestKey: string | null = null;
        let oldestAt = Number.POSITIVE_INFINITY;
        childCache.forEach((entry, key) => {
          if (entry.at < oldestAt) {
            oldestAt = entry.at;
            oldestKey = key;
          }
        });
        if (oldestKey) childCache.delete(oldestKey);
      }
      childCache.set(cacheKey, { at: now, body, ttl });
      return res.json(body);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Untersegmente fehlgeschlagen";
      return res.status(502).json({ error: message.slice(0, 200) });
    }
  });
}
