/**
 * GET /api/chart/earnings-yield/:symbol und GET /api/chart/roic/:symbol.
 * Nur Anzeige. analyze-route wird nicht berührt. Fehlendes = n/a, nie 0.
 * .DE (Xetra) kommt von Yahoo, ohne FMP-Call. Andere Ticker: FMP, bei 402 oder leerer Serie Yahoo.
 * 6h-Memory-Cache nur bei mindestens einem belastbaren Punkt.
 */
import type { Express, Request, Response } from "express";
import type { EarningsYieldResponse, FundamentalPoint, RoicSeriesResponse } from "../shared/schema";
import { earningsYieldPct, finiteNumber } from "../shared/earnings-yield-roic";
import type { ReportedSeries } from "../shared/yahoo-fundamental-series";
import { extractRoicPercentFromRow } from "./news-peers";
import { fmpEnterpriseValues, fmpIncomeStatement, fmpKeyMetrics } from "./fmp";
import { loadYahooFundamentalBundle, type YahooSeriesBundle } from "./yahoo-fundamental-fallback";
import { isGermanXetraTicker } from "./yahoo-fetcher";

export const FUNDAMENTAL_CACHE_MS = 6 * 60 * 60 * 1000;
const SERIES_LIMIT = 6;

type Row = Record<string, unknown>;

export interface FundamentalDeps {
  income: (symbol: string, limit: number) => Promise<unknown>;
  enterpriseValues: (symbol: string, limit: number) => Promise<unknown>;
  keyMetrics: (symbol: string, limit: number) => Promise<unknown>;
  /** Kostenlose Ersatzquelle bei FMP 402 oder leerer Serie. */
  yahooBundle?: (symbol: string, years: number) => Promise<YahooSeriesBundle>;
}

const defaultDeps: FundamentalDeps = {
  income: (symbol, limit) => fmpIncomeStatement(symbol, limit),
  enterpriseValues: (symbol, limit) => fmpEnterpriseValues(symbol, limit),
  keyMetrics: (symbol, limit) => fmpKeyMetrics(symbol, limit),
  yahooBundle: (symbol, years) => loadYahooFundamentalBundle(symbol, years),
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

function hasValue(points: FundamentalPoint[]): boolean {
  return points.some(p => p.value != null && Number.isFinite(p.value));
}

async function captureCall(run: () => Promise<unknown>): Promise<{ raw: unknown; error: string | null }> {
  try {
    return { raw: await run(), error: null };
  } catch (err) {
    return { raw: [], error: err instanceof Error ? err.message : String(err) };
  }
}

function joinNotes(a: string | null, b: string | null): string | null {
  const parts = [a, b].filter((n): n is string => !!n);
  return parts.length > 0 ? parts.join(" · ") : null;
}

async function yahooSeries(symbol: string, deps: FundamentalDeps): Promise<YahooSeriesBundle> {
  const load = deps.yahooBundle ?? defaultDeps.yahooBundle;
  if (!load) {
    const empty: ReportedSeries = { points: [], source: "Yahoo", note: "n/a — Yahoo nicht verfügbar" };
    return { earningsYield: empty, roic: empty };
  }
  return load(symbol, SERIES_LIMIT);
}

async function earningsYieldFromYahoo(symbol: string, deps: FundamentalDeps, now: number): Promise<EarningsYieldResponse> {
  const yahoo = await yahooSeries(symbol, deps);
  const series = yahoo.earningsYield;
  const body: EarningsYieldResponse = {
    symbol,
    points: series.points,
    source: series.source,
    note: series.note,
  };
  if (hasValue(body.points)) eyCache.set(symbol, { at: now, body });
  return body;
}

async function roicFromYahoo(symbol: string, deps: FundamentalDeps, now: number): Promise<RoicSeriesResponse> {
  const yahoo = await yahooSeries(symbol, deps);
  const series = yahoo.roic;
  const body: RoicSeriesResponse = {
    symbol,
    points: series.points,
    source: series.source,
    note: series.note,
  };
  if (hasValue(body.points)) roicCache.set(symbol, { at: now, body });
  return body;
}

export async function loadEarningsYield(symbol: string, deps: FundamentalDeps = defaultDeps, now = Date.now()): Promise<EarningsYieldResponse> {
  const hit = eyCache.get(symbol);
  if (hit && now - hit.at < FUNDAMENTAL_CACHE_MS) return hit.body;
  if (isGermanXetraTicker(symbol)) {
    try {
      return await earningsYieldFromYahoo(symbol, deps, now);
    } catch (err) {
      return { symbol, points: [], source: "Yahoo", note: errorNote(err) };
    }
  }
  const fmpSource = "FMP income-statement + enterprise-values";
  try {
    const [income, ev, metrics] = await Promise.all([
      captureCall(() => deps.income(symbol, SERIES_LIMIT)),
      captureCall(() => deps.enterpriseValues(symbol, SERIES_LIMIT)),
      captureCall(() => deps.keyMetrics(symbol, SERIES_LIMIT)),
    ]);
    const built = buildEarningsYieldPoints(income.raw, ev.raw, metrics.raw);
    if (hasValue(built.points)) {
      const body: EarningsYieldResponse = { symbol, points: built.points, source: fmpSource, note: built.note };
      eyCache.set(symbol, { at: now, body });
      return body;
    }
    const fmpNote = income.error ? errorNote(new Error(income.error)) : built.note;
    const yahoo = await yahooSeries(symbol, deps);
    const series = yahoo.earningsYield;
    const body: EarningsYieldResponse = {
      symbol,
      points: series.points,
      source: hasValue(series.points) ? series.source : fmpSource,
      note: hasValue(series.points) ? series.note : joinNotes(fmpNote, series.note),
    };
    if (hasValue(body.points)) eyCache.set(symbol, { at: now, body });
    return body;
  } catch (err) {
    return { symbol, points: [], source: fmpSource, note: errorNote(err) };
  }
}

export async function loadRoicSeries(symbol: string, deps: FundamentalDeps = defaultDeps, now = Date.now()): Promise<RoicSeriesResponse> {
  const hit = roicCache.get(symbol);
  if (hit && now - hit.at < FUNDAMENTAL_CACHE_MS) return hit.body;
  if (isGermanXetraTicker(symbol)) {
    try {
      return await roicFromYahoo(symbol, deps, now);
    } catch (err) {
      return { symbol, points: [], source: "Yahoo", note: errorNote(err) };
    }
  }
  const fmpSource = "FMP key-metrics";
  try {
    const metrics = await captureCall(() => deps.keyMetrics(symbol, SERIES_LIMIT));
    const built = buildRoicPoints(metrics.raw);
    if (hasValue(built.points)) {
      const body: RoicSeriesResponse = { symbol, points: built.points, source: fmpSource, note: built.note };
      roicCache.set(symbol, { at: now, body });
      return body;
    }
    const fmpNote = metrics.error ? errorNote(new Error(metrics.error)) : built.note;
    const yahoo = await yahooSeries(symbol, deps);
    const series = yahoo.roic;
    const body: RoicSeriesResponse = {
      symbol,
      points: series.points,
      source: hasValue(series.points) ? series.source : fmpSource,
      note: hasValue(series.points) ? series.note : joinNotes(fmpNote, series.note),
    };
    if (hasValue(body.points)) roicCache.set(symbol, { at: now, body });
    return body;
  } catch (err) {
    return { symbol, points: [], source: fmpSource, note: errorNote(err) };
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
