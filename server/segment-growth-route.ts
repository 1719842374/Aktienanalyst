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
} from "./fmp";
import { callLLMJson } from "./llm-openrouter";
import {
  SEGMENT_CHILDREN_ROUTE,
  childrenFromFmpRows,
  childrenFromKiPayload,
  resolveSegmentChildren,
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
}

async function defaultKiChildren(ticker: string, parent: string): Promise<unknown> {
  const result = await callLLMJson({
    systemPrompt: "Antworte nur mit JSON. Erfinde keine Untersegmente und keine Zahlen. Unbekannt heißt leeres children-Array.",
    prompt: `Ticker ${ticker}. Hauptsegment "${parent}". Gib nur Untersegmente dieses Hauptsegments zurück, die du belegen kannst. Form: {"children":[{"name":"","shareOfParentPct":null}]}. Sonst {"children":[]}.`,
    maxTokens: 400,
    temperature: 0,
  });
  return result?.data ?? null;
}

export function defaultSegmentChildrenDeps(): SegmentChildrenDeps {
  return {
    fmpAvailable: isFmpAvailable,
    raw: (kind, ticker) => fmpSegmentationRows(kind, ticker, "annual"),
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
  return resolveSegmentChildren(label, [], childrenFromKiPayload(label, kiPayload));
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
    try {
      return res.json(await loadSegmentChildren(ticker, parent, kind, childrenDeps));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Untersegmente fehlgeschlagen";
      return res.status(502).json({ error: message.slice(0, 200) });
    }
  });
}
