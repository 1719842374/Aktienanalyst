/**
 * GET /api/chart/earnings-yield/:symbol und GET /api/chart/roic/:symbol.
 * Nur Anzeige. analyze-route wird nicht berührt. Fehlendes = n/a, nie 0.
 * 6h-Memory-Cache nur bei mindestens einem belastbaren Punkt.
 */
import type { Express, Request, Response } from "express";
import type { EarningsYieldResponse, FundamentalPoint, RoicSeriesResponse } from "../shared/schema";
import { earningsYieldPct, finiteNumber } from "../shared/earnings-yield-roic";
import { extractRoicPercentFromRow } from "./news-peers";
import { fmpEnterpriseValues, fmpIncomeStatement, fmpKeyMetrics } from "./fmp";

export const FUNDAMENTAL_CACHE_MS = 6 * 60 * 60 * 1000;
const SERIES_LIMIT = 6;

type Row = Record<string, unknown>;

export interface FundamentalDeps {
  income: (symbol: string, limit: number) => Promise<unknown>;
  enterpriseValues: (symbol: string, limit: number) => Promise<unknown>;
  keyMetrics: (symbol: string, limit: number) => Promise<unknown>;
}

const defaultDeps: FundamentalDeps = {
  income: (symbol, limit) => fmpIncomeStatement(symbol, limit),
  enterpriseValues: (symbol, limit) => fmpEnterpriseValues(symbol, limit),
  keyMetrics: (symbol, limit) => fmpKeyMetrics(symbol, limit),
};

let eyCache = new Map<string, { at: number; body: EarningsYieldResponse }>();
let roicCache = new Map<string, { at: number; body: RoicSeriesResponse }>();

export function resetFundamentalCacheForTests(): void {
  eyCache = new Map();
  roicCache = new Map();
}

export function isChartSymbol(raw: string): boolean {
  return /^[A-Z0-9.]{1,15}$/.test(raw.trim().toUpperCase());
}

function asRows(raw: unknown): Row[] {
  if (Array.isArray(raw)) return raw.filter(r => r && typeof r === "object") as Row[];
  return [];
}

function dateOf(row: Row): string | null {
  const d = typeof row.date === "string" ? row.date.slice(0, 10) : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

function yearOf(date: string): string {
  return date.slice(0, 4);
}

function ebitOf(row: Row): { value: number | null; field: string | null } {
  const ebit = finiteNumber(row.ebit);
  if (ebit != null) return { value: ebit, field: "ebit" };
  const op = finiteNumber(row.operatingIncome);
  if (op != null) return { value: op, field: "operatingIncome" };
  return { value: null, field: null };
}

function evOf(row: Row): number | null {
  return finiteNumber(row.enterpriseValue) ?? finiteNumber(row.enterpriseValueTTM);
}

export function buildEarningsYieldPoints(incomeRaw: unknown, evRaw: unknown, metricsRaw: unknown): { points: FundamentalPoint[]; note: string | null } {
  const income = asRows(incomeRaw);
  const evByYear = new Map<string, number>();
  for (const row of asRows(evRaw)) {
    const date = dateOf(row);
    const ev = evOf(row);
    if (date && ev != null && ev > 0 && !evByYear.has(yearOf(date))) evByYear.set(yearOf(date), ev);
  }
  let evSource = "enterprise-values";
  if (evByYear.size === 0) {
    evSource = "key-metrics";
    for (const row of asRows(metricsRaw)) {
      const date = dateOf(row);
      const ev = evOf(row);
      if (date && ev != null && ev > 0 && !evByYear.has(yearOf(date))) evByYear.set(yearOf(date), ev);
    }
  }
  if (income.length === 0) {
    return { points: [], note: "n/a — Income Statement leer" };
  }
  const points: FundamentalPoint[] = [];
  for (const row of income) {
    const date = dateOf(row);
    if (!date) continue;
    const ebit = ebitOf(row);
    const ev = evByYear.get(yearOf(date)) ?? null;
    const y = earningsYieldPct(ebit.value, ev);
    points.push({
      date,
      value: y.value,
      note: y.value == null
        ? y.note
        : (evSource === "key-metrics" ? "Enterprise Value aus key-metrics (enterprise-values leer)" : null),
    });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  const any = points.some(p => p.value != null);
  return {
    points,
    note: any ? null : (points.find(p => p.note)?.note ?? "n/a — Earnings Yield nicht berechenbar"),
  };
}

export function buildRoicPoints(metricsRaw: unknown): { points: FundamentalPoint[]; note: string | null } {
  const rows = asRows(metricsRaw);
  if (rows.length === 0) return { points: [], note: "n/a — key-metrics leer" };
  const points: FundamentalPoint[] = [];
  for (const row of rows) {
    const date = dateOf(row);
    if (!date) continue;
    const value = extractRoicPercentFromRow(row);
    points.push({
      date,
      value,
      note: value == null ? "n/a — ROIC fehlt oder unplausibel" : null,
    });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));
  const any = points.some(p => p.value != null);
  return { points, note: any ? null : "n/a — ROIC fehlt oder unplausibel" };
}

function errorNote(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `n/a — Abruf fehlgeschlagen: ${msg.slice(0, 160)}`;
}

export async function loadEarningsYield(symbol: string, deps: FundamentalDeps = defaultDeps, now = Date.now()): Promise<EarningsYieldResponse> {
  const hit = eyCache.get(symbol);
  if (hit && now - hit.at < FUNDAMENTAL_CACHE_MS) return hit.body;
  try {
    const [income, ev, metrics] = await Promise.all([
      deps.income(symbol, SERIES_LIMIT).catch(() => []),
      deps.enterpriseValues(symbol, SERIES_LIMIT).catch(() => []),
      deps.keyMetrics(symbol, SERIES_LIMIT).catch(() => []),
    ]);
    const built = buildEarningsYieldPoints(income, ev, metrics);
    const body: EarningsYieldResponse = { symbol, points: built.points, source: "FMP income-statement + enterprise-values", note: built.note };
    if (built.points.some(p => p.value != null)) eyCache.set(symbol, { at: now, body });
    return body;
  } catch (err) {
    return { symbol, points: [], source: "FMP income-statement + enterprise-values", note: errorNote(err) };
  }
}

export async function loadRoicSeries(symbol: string, deps: FundamentalDeps = defaultDeps, now = Date.now()): Promise<RoicSeriesResponse> {
  const hit = roicCache.get(symbol);
  if (hit && now - hit.at < FUNDAMENTAL_CACHE_MS) return hit.body;
  try {
    const metrics = await deps.keyMetrics(symbol, SERIES_LIMIT);
    const built = buildRoicPoints(metrics);
    const body: RoicSeriesResponse = { symbol, points: built.points, source: "FMP key-metrics", note: built.note };
    if (built.points.some(p => p.value != null)) roicCache.set(symbol, { at: now, body });
    return body;
  } catch (err) {
    return { symbol, points: [], source: "FMP key-metrics", note: errorNote(err) };
  }
}

export function registerEarningsYieldRoicRoutes(app: Express, deps: FundamentalDeps = defaultDeps): void {
  app.get("/api/chart/earnings-yield/:symbol", async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol ?? "").trim().toUpperCase();
    if (!isChartSymbol(symbol)) return res.status(400).json({ error: "ticker ungültig" });
    res.json(await loadEarningsYield(symbol, deps));
  });
  app.get("/api/chart/roic/:symbol", async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol ?? "").trim().toUpperCase();
    if (!isChartSymbol(symbol)) return res.status(400).json({ error: "ticker ungültig" });
    res.json(await loadRoicSeries(symbol, deps));
  });
}
