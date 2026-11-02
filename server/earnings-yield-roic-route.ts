/**
 * GET /api/chart/earnings-yield/:symbol und GET /api/chart/roic/:symbol.
 * Nur Anzeige. analyze-route wird nicht berührt. Fehlendes = n/a, nie 0.
 * Earnings Yield = Quartals-EPS (TTM rechnet der Chart je Kerze). ROIC point-in-time
 * ab dem Filing-Datum. .DE (Xetra) kommt von Yahoo, ohne FMP-Call.
 * Andere Ticker: FMP, bei 402 oder leerer Serie Yahoo.
 * 6h-Memory-Cache nur bei mindestens einem belastbaren Punkt.
 */
import type { Express, Request, Response } from "express";
import type { EarningsYieldResponse, FundamentalPoint, RoicSeriesResponse } from "../shared/schema";
import {
  EARNINGS_YIELD_FORMULA,
  EARNINGS_YIELD_SOURCE,
  FUNDAMENTAL_ANNUAL_LIMIT,
  FUNDAMENTAL_QUARTER_LIMIT,
  ROIC_ANNUAL_FORMULA,
  ROIC_ANNUAL_LABEL,
  annualizedRoicSeries,
  earningsYieldPct,
  finiteNumber,
  type EpsQuarter,
  type RoicPeriod,
  type TtmPrint,
} from "../shared/earnings-yield-roic";
import { YAHOO_EPS_ASOF_NOTE, YAHOO_TS_EPS_SOURCE, type ReportedSeries } from "../shared/yahoo-fundamental-series";
import { extractRoicPercentFromRow, sanitizeRoic } from "./news-peers";
import {
  fmpEnterpriseValues,
  fmpIncomeStatement,
  fmpIncomeStatementQuarterly,
  fmpKeyMetrics,
  fmpKeyMetricsQuarterly,
  fmpProfile,
  fmpRatios,
  fmpRatiosQuarterly,
  fmpSearchTicker,
} from "./fmp";
import { loadYahooFundamentalBundle, type YahooSeriesBundle } from "./yahoo-fundamental-fallback";
import { isGermanXetraTicker } from "./yahoo-fetcher";
import { registerPeerPriceRoute } from "./chart-peer-price-route";
import {
  MAX_LISTING_CANDIDATES,
  profileHitFromRow,
  resolveGermanListing,
  searchHitFromRow,
  type FmpProfileHit,
  type FmpSearchHit,
  type FmpSymbolResolution,
} from "./fmp-listing-resolve";

export const FUNDAMENTAL_CACHE_MS = 6 * 60 * 60 * 1000;
const ROIC_DECIMAL_FIELDS = ["returnOnInvestedCapital"] as const;

type Row = Record<string, unknown>;

export interface FundamentalDeps {
  income: (symbol: string, limit: number) => Promise<unknown>;
  enterpriseValues: (symbol: string, limit: number) => Promise<unknown>;
  keyMetrics: (symbol: string, limit: number) => Promise<unknown>;
  incomeQuarterly?: (symbol: string, limit: number) => Promise<unknown>;
  keyMetricsQuarterly?: (symbol: string, limit: number) => Promise<unknown>;
  ratios?: (symbol: string, limit: number) => Promise<unknown>;
  ratiosQuarterly?: (symbol: string, limit: number) => Promise<unknown>;
  /** Kostenlose Ersatzquelle bei FMP 402 oder leerer Serie. Nicht für .DE. */
  yahooBundle?: (symbol: string, years: number) => Promise<YahooSeriesBundle>;
  /** .DE: Suche und Profil, um das FMP-Symbol datengetrieben zu finden. */
  search?: (query: string) => Promise<FmpSearchHit[]>;
  profile?: (symbol: string) => Promise<FmpProfileHit>;
}

const defaultDeps: FundamentalDeps = {
  income: (symbol, limit) => fmpIncomeStatement(symbol, limit),
  enterpriseValues: (symbol, limit) => fmpEnterpriseValues(symbol, limit),
  keyMetrics: (symbol, limit) => fmpKeyMetrics(symbol, limit),
  incomeQuarterly: (symbol, limit) => fmpIncomeStatementQuarterly(symbol, limit),
  keyMetricsQuarterly: (symbol, limit) => fmpKeyMetricsQuarterly(symbol, limit),
  ratios: (symbol, limit) => fmpRatios(symbol, limit),
  ratiosQuarterly: (symbol, limit) => fmpRatiosQuarterly(symbol, limit),
  yahooBundle: (symbol, years) => loadYahooFundamentalBundle(symbol, years),
  search: async (query) => {
    const rows = await fmpSearchTicker(query, MAX_LISTING_CANDIDATES);
    return rows.map(searchHitFromRow).filter((row): row is FmpSearchHit => row != null);
  },
  profile: async (symbol) => {
    try {
      const row = await fmpProfile(symbol);
      return profileHitFromRow(symbol, row, !!row);
    } catch {
      return profileHitFromRow(symbol, null, false);
    }
  },
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

function firstIso(...values: unknown[]): string | null {
  for (const value of values) {
    const text = typeof value === "string" ? value.slice(0, 10) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  }
  return null;
}

function filingMapFromIncome(raw: unknown): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of asRows(raw)) {
    const period = dateOf(row);
    const filing = firstIso(row.filingDate, row.fillingDate, row.acceptedDate);
    if (period && filing && !map.has(period)) map.set(period, filing);
  }
  return map;
}

/** Quartals-EPS nur mit Filing-Datum. Jahreszeilen und Zeilen ohne Filing bleiben draußen. */
export function epsQuartersFromIncomeRows(raw: unknown): { quarters: EpsQuarter[]; note: string | null } {
  const rows = asRows(raw);
  if (rows.length === 0) return { quarters: [], note: "n/a — Income Statement (Quartal) leer" };
  const byPeriod = new Map<string, EpsQuarter>();
  let skippedFiling = 0;
  for (const row of rows) {
    const period = dateOf(row);
    if (!period) continue;
    const kind = String(row.period ?? "").toUpperCase();
    if (kind === "FY" || kind === "ANNUAL" || kind === "YEAR") continue;
    const eps = finiteNumber(row.epsDiluted) ?? finiteNumber(row.epsdiluted) ?? finiteNumber(row.eps);
    if (eps == null) continue;
    const asOf = firstIso(row.filingDate, row.fillingDate, row.acceptedDate);
    if (!asOf) {
      skippedFiling += 1;
      continue;
    }
    const currency = typeof row.reportedCurrency === "string" && row.reportedCurrency.trim() ? row.reportedCurrency.trim() : null;
    const prev = byPeriod.get(period);
    if (!prev || asOf >= prev.asOf) byPeriod.set(period, { periodEnd: period, asOf, eps, currency });
  }
  const quarters = Array.from(byPeriod.values()).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  if (quarters.length === 0) {
    return { quarters: [], note: skippedFiling > 0 ? "n/a — Quartals-EPS ohne Filing-Datum" : "n/a — Quartals-EPS fehlt" };
  }
  return { quarters, note: null };
}

function roicFromRow(row: Row): { value: number | null; field: string | null; note: string | null } {
  for (const field of ROIC_DECIMAL_FIELDS) {
    if (row[field] == null || row[field] === "") continue;
    const raw = finiteNumber(row[field]);
    if (raw == null) return { value: null, field, note: `n/a — ${field} nicht numerisch` };
    const pct = sanitizeRoic(raw * 100);
    const rounded = pct == null ? null : +pct.toFixed(1);
    if (rounded == null) return { value: null, field, note: "n/a — ROIC fehlt oder unplausibel" };
    return { value: rounded, field, note: null };
  }
  if (row.roic != null && row.roic !== "") {
    const raw = finiteNumber(row.roic);
    if (raw == null) return { value: null, field: "roic", note: "n/a — Feld roic nicht numerisch" };
    if (Math.abs(raw) > 1) {
      return { value: null, field: "roic", note: "n/a — Feld roic ist keine Dezimalquote (returnOnInvestedCapital fehlt)" };
    }
    const pct = sanitizeRoic(raw * 100);
    const rounded = pct == null ? null : +pct.toFixed(1);
    if (rounded == null) return { value: null, field: "roic", note: "n/a — ROIC fehlt oder unplausibel" };
    return { value: rounded, field: "roic", note: null };
  }
  return { value: null, field: null, note: "n/a — weder returnOnInvestedCapital noch roic" };
}

/**
 * ROIC-Punkte nur ab dem Filing-Datum. Das Periodenende allein wäre Look-ahead
 * und wird nicht als Stichtag benutzt. `filings` kommt aus dem Income Statement
 * derselben Periode, wenn die Kennzahlzeile selbst kein Filing trägt.
 */
export function buildPitRoicPoints(raw: unknown, filings: Map<string, string>): { points: FundamentalPoint[]; note: string | null; field: string | null } {
  const rows = asRows(raw);
  if (rows.length === 0) return { points: [], note: "n/a — ROIC-Quelle leer", field: null };
  const staged: Array<FundamentalPoint & { periodEnd: string }> = [];
  let missingFiling = 0;
  let missingValue = 0;
  let field: string | null = null;
  let valueNote: string | null = null;
  for (const row of rows) {
    const period = dateOf(row);
    const parsed = roicFromRow(row);
    if (parsed.field) field = parsed.field;
    if (parsed.value == null) {
      missingValue += 1;
      valueNote = parsed.note;
      continue;
    }
    const asOf = firstIso(row.filingDate, row.fillingDate, row.acceptedDate) ?? (period ? filings.get(period) ?? null : null);
    if (!asOf) {
      missingFiling += 1;
      continue;
    }
    staged.push({ date: asOf, value: parsed.value, note: null, periodEnd: period ?? asOf });
  }
  staged.sort((a, b) => a.date.localeCompare(b.date) || a.periodEnd.localeCompare(b.periodEnd));
  const points = staged.map(({ periodEnd: _period, ...point }) => point);
  if (points.length === 0) {
    const note = missingFiling > 0 && missingValue === 0
      ? "n/a — ROIC ohne Filing-Datum"
      : (valueNote ?? "n/a — ROIC fehlt oder unplausibel");
    return { points: [], note, field };
  }
  return { points, note: null, field };
}

function yieldBody(symbol: string, quarters: EpsQuarter[], source: string, note: string | null, ttmPrints: TtmPrint[] = [], annualEps: TtmPrint[] = []): EarningsYieldResponse {
  return {
    symbol,
    quarters,
    ttmPrints,
    annualEps,
    points: quarters.map(quarter => ({ date: quarter.asOf, value: quarter.eps, note: null })),
    formula: EARNINGS_YIELD_FORMULA,
    source,
    note,
  };
}

function roicBody(symbol: string, points: FundamentalPoint[], source: string, note: string | null, formula = ROIC_ANNUAL_FORMULA, label = ROIC_ANNUAL_LABEL): RoicSeriesResponse {
  return { symbol, points, formula, label, source, note };
}

function pitRoicPeriods(raw: unknown, filings: Map<string, string>): RoicPeriod[] {
  const out: RoicPeriod[] = [];
  for (const row of asRows(raw)) {
    const period = dateOf(row);
    const parsed = roicFromRow(row);
    if (parsed.value == null) continue;
    const asOf = firstIso(row.filingDate, row.fillingDate, row.acceptedDate) ?? (period ? filings.get(period) ?? null : null);
    if (!asOf || !period) continue;
    out.push({ asOf, periodEnd: period, value: parsed.value });
  }
  return out;
}

function runOptional(
  fn: ((symbol: string, limit: number) => Promise<unknown>) | undefined,
  symbol: string,
  limit: number,
): Promise<{ raw: unknown; error: string | null }> {
  if (!fn) return Promise.resolve({ raw: [], error: null });
  return captureCall(() => fn(symbol, limit));
}

async function yahooSeries(symbol: string, deps: FundamentalDeps): Promise<YahooSeriesBundle> {
  const load = deps.yahooBundle ?? defaultDeps.yahooBundle;
  if (!load) {
    const empty: ReportedSeries = { points: [], source: "Yahoo", note: "n/a — Yahoo nicht verfügbar" };
    return { earningsYield: empty, roic: empty, epsQuarters: [], epsNote: "n/a — Yahoo nicht verfügbar", ttmPrints: [], annualEps: [] };
  }
  const body = await load(symbol, FUNDAMENTAL_ANNUAL_LIMIT);
  return {
    ...body,
    epsQuarters: body.epsQuarters ?? [],
    epsNote: body.epsNote ?? null,
    ttmPrints: body.ttmPrints ?? [],
    annualEps: body.annualEps ?? [],
  };
}

async function earningsYieldFromYahoo(symbol: string, deps: FundamentalDeps, now: number): Promise<EarningsYieldResponse> {
  const yahoo = await yahooSeries(symbol, deps);
  const quarters = yahoo.epsQuarters ?? [];
  const prints = yahoo.ttmPrints ?? [];
  const annualEps = yahoo.annualEps ?? [];
  const source = prints.length > 0 || annualEps.length > 0
    ? `${YAHOO_TS_EPS_SOURCE}; trailingDilutedEPS oder Jahres-EPS, wenn das Quartalsfenster nicht steht`
    : YAHOO_TS_EPS_SOURCE;
  const body = quarters.length > 0 || prints.length > 0 || annualEps.length > 0
    ? yieldBody(symbol, quarters, source, yahoo.epsNote, prints, annualEps)
    : yieldBody(symbol, [], source, yahoo.epsNote ?? "n/a — keine Quartals-EPS", prints, annualEps);
  if (body.quarters.length > 0 || body.ttmPrints.length > 0 || body.annualEps.length > 0) eyCache.set(symbol, { at: now, body });
  return body;
}

async function roicFromYahoo(symbol: string, deps: FundamentalDeps, now: number): Promise<RoicSeriesResponse> {
  const yahoo = await yahooSeries(symbol, deps);
  const series = yahoo.roic;
  const body = roicBody(
    symbol,
    series.points,
    series.source,
    hasValue(series.points) ? (series.note ?? YAHOO_EPS_ASOF_NOTE) : series.note,
  );
  if (hasValue(body.points)) roicCache.set(symbol, { at: now, body });
  return body;
}

function finishEy(body: EarningsYieldResponse, listing: FmpSymbolResolution | null): EarningsYieldResponse {
  if (!listing) return body;
  return {
    ...body,
    quarters: body.quarters.map(quarter => quarter.currency ? quarter : { ...quarter, currency: listing.currency }),
    source: `${listing.source}. ${body.source}`,
  };
}

async function germanFmpSymbol(symbol: string, deps: FundamentalDeps, now: number): Promise<{ fetchSymbol: string; listing: FmpSymbolResolution | null; miss: EarningsYieldResponse | null }> {
  if (!isGermanXetraTicker(symbol)) return { fetchSymbol: symbol, listing: null, miss: null };
  if (!deps.search || !deps.profile) {
    return { fetchSymbol: symbol, listing: null, miss: yieldBody(symbol, [], "FMP", "n/a — FMP-Suche für .DE nicht verfügbar") };
  }
  const listing = await resolveGermanListing(symbol, deps.search, deps.profile, now);
  if (!listing) {
    return { fetchSymbol: symbol, listing: null, miss: yieldBody(symbol, [], "FMP", "n/a — kein FMP-Symbol für XETRA aufgelöst (Suche/Profil ohne ISIN- oder Namens-Treffer)") };
  }
  return { fetchSymbol: listing.fmpSymbol, listing, miss: null };
}

export async function loadEarningsYield(symbol: string, deps: FundamentalDeps = defaultDeps, now = Date.now()): Promise<EarningsYieldResponse> {
  const hit = eyCache.get(symbol);
  if (hit && now - hit.at < FUNDAMENTAL_CACHE_MS) return hit.body;
  const german = await germanFmpSymbol(symbol, deps, now);
  if (german.miss) return german.miss;
  const fetchSymbol = german.fetchSymbol;
  try {
    const income = await runOptional(deps.incomeQuarterly, fetchSymbol, FUNDAMENTAL_QUARTER_LIMIT);
    const built = epsQuartersFromIncomeRows(income.raw);
    if (built.quarters.length > 0) {
      const body = finishEy(yieldBody(symbol, built.quarters, EARNINGS_YIELD_SOURCE, built.note, []), german.listing);
      eyCache.set(symbol, { at: now, body });
      return body;
    }
    const fmpNote = income.error ? errorNote(new Error(income.error)) : built.note;
    if (german.listing) {
      const body = finishEy(yieldBody(symbol, [], EARNINGS_YIELD_SOURCE, fmpNote ?? "n/a — FMP ohne Quartals-EPS"), german.listing);
      return body;
    }
    const yahoo = await yahooSeries(symbol, deps);
    const quarters = yahoo.epsQuarters ?? [];
    const prints = yahoo.ttmPrints ?? [];
    const annualEps = yahoo.annualEps ?? [];
    const source = prints.length > 0 || annualEps.length > 0
      ? `${YAHOO_TS_EPS_SOURCE}; trailingDilutedEPS oder Jahres-EPS, wenn das Quartalsfenster nicht steht`
      : YAHOO_TS_EPS_SOURCE;
    const body = quarters.length > 0 || prints.length > 0 || annualEps.length > 0
      ? yieldBody(symbol, quarters, source, yahoo.epsNote, prints, annualEps)
      : yieldBody(symbol, [], EARNINGS_YIELD_SOURCE, joinNotes(fmpNote, yahoo.epsNote), prints, annualEps);
    if (body.quarters.length > 0 || body.ttmPrints.length > 0 || body.annualEps.length > 0) eyCache.set(symbol, { at: now, body });
    return body;
  } catch (err) {
    return yieldBody(symbol, [], EARNINGS_YIELD_SOURCE, errorNote(err));
  }
}

export async function loadRoicSeries(symbol: string, deps: FundamentalDeps = defaultDeps, now = Date.now()): Promise<RoicSeriesResponse> {
  const hit = roicCache.get(symbol);
  if (hit && now - hit.at < FUNDAMENTAL_CACHE_MS) return hit.body;
  const german = await germanFmpSymbol(symbol, deps, now);
  if (german.miss) return roicBody(symbol, [], "FMP", german.miss.note);
  const fetchSymbol = german.fetchSymbol;
  const fmpSource = german.listing ? german.listing.source : "FMP key-metrics";
  try {
    const [metricsQ, metricsA, ratiosQ, ratiosA, incomeQ, incomeA] = await Promise.all([
      runOptional(deps.keyMetricsQuarterly, fetchSymbol, FUNDAMENTAL_QUARTER_LIMIT),
      captureCall(() => deps.keyMetrics(fetchSymbol, FUNDAMENTAL_ANNUAL_LIMIT)),
      runOptional(deps.ratiosQuarterly, fetchSymbol, FUNDAMENTAL_QUARTER_LIMIT),
      runOptional(deps.ratios, fetchSymbol, FUNDAMENTAL_ANNUAL_LIMIT),
      runOptional(deps.incomeQuarterly, fetchSymbol, FUNDAMENTAL_QUARTER_LIMIT),
      captureCall(() => deps.income(fetchSymbol, FUNDAMENTAL_ANNUAL_LIMIT)),
    ]);
    const quarterFilings = filingMapFromIncome(incomeQ.raw);
    const annualFilings = filingMapFromIncome(incomeA.raw);
    const metricsSeries = annualizedRoicSeries(
      pitRoicPeriods(metricsQ.raw, quarterFilings),
      pitRoicPeriods(metricsA.raw, annualFilings),
    );
    const ratiosSeries = annualizedRoicSeries(
      pitRoicPeriods(ratiosQ.raw, quarterFilings),
      pitRoicPeriods(ratiosA.raw, annualFilings),
    );
    const picked = hasValue(metricsSeries.points) ? metricsSeries : ratiosSeries;
    const pickedSource = hasValue(metricsSeries.points) ? "FMP key-metrics" : "FMP ratios";
    if (hasValue(picked.points)) {
      const source = german.listing ? `${german.listing.source}. ${pickedSource} ${picked.label}` : `${pickedSource} ${picked.label}`;
      const body = roicBody(symbol, picked.points, source, picked.note, picked.formula, picked.label);
      roicCache.set(symbol, { at: now, body });
      return body;
    }
    const fmpNote = joinNotes(
      metricsA.error ? errorNote(new Error(metricsA.error)) : metricsSeries.note,
      metricsQ.error ? errorNote(new Error(metricsQ.error)) : picked.note,
    );
    if (german.listing) return roicBody(symbol, [], fmpSource, fmpNote ?? "n/a — FMP ohne ROIC");
    const yahoo = await yahooSeries(symbol, deps);
    const series = yahoo.roic;
    const body = roicBody(
      symbol,
      series.points,
      hasValue(series.points) ? series.source : fmpSource,
      hasValue(series.points) ? (series.note ?? YAHOO_EPS_ASOF_NOTE) : joinNotes(fmpNote, series.note),
    );
    if (hasValue(body.points)) roicCache.set(symbol, { at: now, body });
    return body;
  } catch (err) {
    return roicBody(symbol, [], fmpSource, errorNote(err));
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
  registerPeerPriceRoute(app);
}
