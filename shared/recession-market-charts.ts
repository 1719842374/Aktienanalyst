/**
 * WORK_RECESSION_MARKET_CHARTS — pure window, vol, PEG and FINRA math.
 * PEG here is PE / g with g in percent. It does not call the Lynch scorer.
 */
import { z } from "zod";

export const SERIES_FLOOR = "1999-01-01";
export const VOL_Y_MAX = 90;
export const VOL_MARK_RADIUS = 20;
export const VOL_MARK_MIN = 35;
export const RSI_WARMUP_BARS = 80;
export const RSI_PERIOD = 14;

export const MARKET_WINDOWS = ["1Y", "3Y", "5Y", "10Y", "MAX"] as const;
export type MarketWindow = (typeof MARKET_WINDOWS)[number];

export const WINDOW_TRADING_DAYS: Record<Exclude<MarketWindow, "MAX">, number> = {
  "1Y": 252,
  "3Y": 756,
  "5Y": 1260,
  "10Y": 2520,
};

/** Monthly FINRA points that belong on the selected chart. 5Y stays 60 months. */
export const WINDOW_MONTHS: Record<Exclude<MarketWindow, "MAX">, number> = {
  "1Y": 12,
  "3Y": 36,
  "5Y": 60,
  "10Y": 120,
};

export const CHART_BOOKS = [
  {
    id: "SPY",
    etf: "SPY",
    indexFallback: "^GSPC",
    name: "S&P 500",
    volId: "VIXCLS",
    volKind: "implied",
    fredStart: "1990-01-01",
    bandsAnalog: false,
  },
  {
    id: "QQQ",
    etf: "QQQ",
    indexFallback: "^NDX",
    name: "Nasdaq-100",
    volId: "VXNCLS",
    volKind: "implied",
    fredStart: "2001-01-01",
    bandsAnalog: false,
  },
  {
    id: "VGK",
    etf: "VGK",
    indexFallback: "FEZ",
    name: "STOXX Europe 600",
    volId: "^V2TX",
    volKind: "implied",
    fredStart: null,
    bandsAnalog: true,
  },
  {
    id: "ASHR",
    etf: "ASHR",
    indexFallback: null,
    name: "CSI 300 / Shanghai-A",
    volId: "realized20",
    volKind: "realized",
    fredStart: null,
    bandsAnalog: true,
  },
] as const;

export type ChartMarketId = (typeof CHART_BOOKS)[number]["id"];
export type VolKind = "implied" | "realized";

export function parseMarketWindow(raw: unknown): MarketWindow {
  const s = String(raw ?? "5Y").toUpperCase();
  if (s === "1Y" || s === "3Y" || s === "5Y" || s === "10Y" || s === "MAX") return s;
  return "5Y";
}

export function chartBookById(id: string) {
  const u = id.toUpperCase();
  return CHART_BOOKS.find((b) => b.id === u) ?? null;
}

export function addDaysIso(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Calendar start for the FMP pull. MAX is floored at 1999; shorter windows keep RSI warmup. */
export function ohlcvFetchFrom(window: MarketWindow, todayIso: string): string {
  if (window === "MAX") return SERIES_FLOOR;
  const days = WINDOW_TRADING_DAYS[window] + RSI_WARMUP_BARS + RSI_PERIOD;
  return addDaysIso(todayIso, -Math.ceil(days * 1.7));
}

export function sliceByWindow<T extends { date: string }>(rowsAsc: T[], window: MarketWindow): T[] {
  const floored = rowsAsc.filter((r) => r.date >= SERIES_FLOOR);
  if (!floored.length) return [];
  if (window === "MAX") return floored;
  return floored.slice(-WINDOW_TRADING_DAYS[window]);
}

/**
 * MAX x-axis starts at max(1999-01-01, first point). Earlier VIX history stays out of MAX.
 */
export function maxWindowStart(seriesStart: string | null): string {
  if (!seriesStart || seriesStart < SERIES_FLOOR) return SERIES_FLOOR;
  return seriesStart;
}

export function volBandLabel(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  if (v > 40) return "Extreme Fear";
  if (v >= 30) return "Fear";
  if (v >= 20) return "Normal";
  return "Complacency";
}

export interface VolPoint {
  date: string;
  value: number;
}

/** Local peak: V_t = max(V_{t-20..t+20}) and V > 35. Ties keep the first bar only. */
export function localVolMaxima(
  vol: VolPoint[],
  radius = VOL_MARK_RADIUS,
  threshold = VOL_MARK_MIN,
): VolPoint[] {
  const marks: VolPoint[] = [];
  for (let i = 0; i < vol.length; i++) {
    const v = vol[i].value;
    if (!(v > threshold)) continue;
    const a = Math.max(0, i - radius);
    const b = Math.min(vol.length - 1, i + radius);
    let max = -Infinity;
    let first = i;
    for (let j = a; j <= b; j++) {
      if (vol[j].value > max) {
        max = vol[j].value;
        first = j;
      }
    }
    if (v === max && first === i) marks.push(vol[i]);
  }
  return marks;
}

/** 20-session realized vol, annualized percent. Sample stdev of log returns. */
export function realizedVol20(closes: { date: string; close: number }[]): VolPoint[] {
  const out: VolPoint[] = [];
  for (let i = 20; i < closes.length; i++) {
    const rets: number[] = [];
    for (let j = i - 19; j <= i; j++) {
      const left = closes[j - 1]?.close;
      const right = closes[j]?.close;
      if (!(left > 0) || !(right > 0)) continue;
      rets.push(Math.log(right / left));
    }
    if (rets.length < 15) continue;
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
    const ann = Math.sqrt(Math.max(0, variance) * 252) * 100;
    if (Number.isFinite(ann)) out.push({ date: closes[i].date, value: ann });
  }
  return out;
}

export function roundTo(n: number | null, digits: number): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export interface EpsPrint {
  date: string;
  eps: number;
}

/** TTM = sum of the last 4 prints on or before asOf. Previous TTM is the four before that. */
export function ttmEpsAt(prints: EpsPrint[], asOf: string): { ttm: number | null; prevTtm: number | null } {
  const rows = prints
    .filter((p) => p.date <= asOf && Number.isFinite(p.eps))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 4) return { ttm: null, prevTtm: null };
  const sum = (xs: EpsPrint[]) => xs.reduce((s, x) => s + x.eps, 0);
  const ttm = sum(rows.slice(-4));
  const prev = rows.slice(-8, -4);
  return { ttm, prevTtm: prev.length === 4 ? sum(prev) : null };
}

/** (E_t - E_{t-4q}) / E_{t-4q} in percent (17.8, not 0.178). */
export function epsYoyPercent(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * PEG = PE / g, g in percent.
 * Equivalent to PE / (g_decimal * 100). g <= 0 → null.
 * PEG > 3 with positive g is expensive per unit of growth.
 */
export function pegFromPeAndGrowth(pe: number | null, gPercent: number | null): number | null {
  if (pe == null || !Number.isFinite(pe) || pe <= 0) return null;
  if (gPercent == null || !Number.isFinite(gPercent) || gPercent <= 0) return null;
  return pe / gPercent;
}

export interface ValuationInput {
  price: number | null;
  ttmEps: number | null;
  prevTtmEps: number | null;
  epsNtm: number | null;
  allowForward: boolean;
  keyMetricsPe: number | null;
}

export type PegKind = "formula" | "vendor";

export interface ValuationCore {
  pe: number | null;
  peFwd: number | null;
  peg: number | null;
  pegFwd: number | null;
  pegKind: PegKind | null;
  pegFwdKind: PegKind | null;
  epsYoy: number | null;
  gCons: number | null;
  pegExpensive: boolean;
  pegFwdExpensive: boolean;
  note: string | null;
}

/** Vendor PEG is a ratio from the payload, not PE / g. The line has to say so. */
export function pegDisplaySuffix(kind: PegKind | null): string {
  return kind === "vendor" ? " (Vendor-Ratio)" : "";
}

export function valuationFromParts(input: ValuationInput): ValuationCore {
  const epsYoyRaw = epsYoyPercent(input.ttmEps, input.prevTtmEps);
  // keyMetricsPe is a vendor multiple. It is never the formula PE.
  void input.keyMetricsPe;
  let peRaw: number | null = null;
  if (input.price != null && input.price > 0 && input.ttmEps != null && input.ttmEps > 0) {
    peRaw = input.price / input.ttmEps;
  }

  let peFwdRaw: number | null = null;
  let gConsRaw: number | null = null;
  let note: string | null = null;
  if (input.allowForward && input.price != null && input.price > 0 && input.epsNtm != null && input.epsNtm > 0) {
    peFwdRaw = input.price / input.epsNtm;
    if (input.ttmEps != null && input.ttmEps > 0) {
      gConsRaw = ((input.epsNtm - input.ttmEps) / input.ttmEps) * 100;
    }
  } else if (!input.allowForward) {
    note = "Forward-Konsens nur am letzten Handelstag (kein Punkt-in-Zeit-Schätzer).";
  }

  const pegRaw = pegFromPeAndGrowth(peRaw, epsYoyRaw);
  const pegFwdRaw = pegFromPeAndGrowth(peFwdRaw, gConsRaw);
  return {
    pe: roundTo(peRaw, 2),
    peFwd: roundTo(peFwdRaw, 2),
    peg: roundTo(pegRaw, 2),
    pegFwd: roundTo(pegFwdRaw, 2),
    pegKind: pegRaw != null ? "formula" : null,
    pegFwdKind: pegFwdRaw != null ? "formula" : null,
    epsYoy: roundTo(epsYoyRaw, 2),
    gCons: roundTo(gConsRaw, 2),
    pegExpensive: pegRaw != null && pegRaw > 3,
    pegFwdExpensive: pegFwdRaw != null && pegFwdRaw > 3,
    note,
  };
}

function finiteNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function positiveNum(v: unknown): number | null {
  const n = finiteNum(v);
  return n != null && n > 0 ? n : null;
}

/**
 * Stable ratios use priceToEarningsRatio. Stable key-metrics often has no peRatio.
 * 0 and missing fields stay null — they are not a valuation.
 */
export function peFromMetricsRow(row: unknown): number | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return positiveNum(r.priceToEarningsRatio)
    ?? positiveNum(r.priceEarningsRatio)
    ?? positiveNum(r.priceToEarningsRatioTTM)
    ?? positiveNum(r.peRatio)
    ?? positiveNum(r.pe)
    ?? positiveNum(r.peRatioTTM);
}

/** PEG and forward PE only when the payload actually carries those fields. */
export function pegFieldsFromMetricsRow(row: unknown): { peg: number | null; pegFwd: number | null; peFwd: number | null } {
  if (!row || typeof row !== "object") return { peg: null, pegFwd: null, peFwd: null };
  const r = row as Record<string, unknown>;
  return {
    peg: positiveNum(r.priceToEarningsGrowthRatio) ?? positiveNum(r.priceToEarningsGrowthRatioTTM),
    pegFwd: positiveNum(r.forwardPriceToEarningsGrowthRatio) ?? positiveNum(r.forwardPriceToEarningsGrowthRatioTTM),
    peFwd: positiveNum(r.forwardPE) ?? positiveNum(r.forwardPriceToEarningsRatio),
  };
}

/** Quarterly income EPS. Stable rows use epsDiluted; older rows use epsdiluted. */
export function epsPrintFromRow(row: unknown): EpsPrint | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const date = String(r.date ?? r.fillingDate ?? r.filingDate ?? "").slice(0, 10);
  const eps = finiteNum(r.epsDiluted) ?? finiteNum(r.epsdiluted) ?? finiteNum(r.eps) ?? finiteNum(r.netIncomePerShare);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || eps == null) return null;
  return { date, eps };
}

/**
 * Quarterly /stable/ratios netIncomePerShare is that quarter's EPS, not TTM.
 * FY rows are a full year and must not be summed as four quarters.
 * netIncomePerShareTTM is never read here.
 */
export function epsPrintFromRatioQuarter(row: unknown): EpsPrint | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const period = String(r.period ?? "").toUpperCase();
  if (period === "FY" || period === "ANNUAL" || period === "YEAR") return null;
  const date = String(r.date ?? "").slice(0, 10);
  const eps = finiteNum(r.netIncomePerShare);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || eps == null) return null;
  return { date, eps };
}

/** One TTM EPS from /stable/ratios-ttm. Do not sum it and do not treat it as a quarter. */
export function ttmEpsFromRatiosTtmRow(row: unknown): number | null {
  const raw = Array.isArray(row) ? row[0] : row;
  if (!raw || typeof raw !== "object") return null;
  return positiveNum((raw as Record<string, unknown>).netIncomePerShareTTM);
}

function rowSymbol(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  return String((row as Record<string, unknown>).symbol ?? "");
}

/** An ETF symbol is not an index EPS. A missing symbol stays usable for the index call that fetched the row. */
function isIndexRow(row: unknown): boolean {
  const symbol = rowSymbol(row);
  if (!symbol) return true;
  return symbol.startsWith("^");
}

/**
 * TTM EPS from GET /stable/key-metrics-ttm on the same index symbol as the price.
 * peRatioTTM and earningsYieldTTM are vendor multiples, not an EPS.
 * A row whose symbol is an ETF is ignored.
 */
export function ttmEpsFromKeyMetricsTtmRow(row: unknown): number | null {
  const raw = Array.isArray(row) ? row[0] : row;
  if (!raw || typeof raw !== "object" || !isIndexRow(raw)) return null;
  return positiveNum((raw as Record<string, unknown>).netIncomePerShareTTM);
}

/**
 * Index Quote field `eps` on the same object as `price`.
 * GET /stable/quote. The vendor field `pe` is not an EPS.
 * `eps` on an ETF quote is not a share EPS.
 */
export function epsFromIndexQuote(quote: unknown): number | null {
  const raw = Array.isArray(quote) ? quote[0] : quote;
  if (!raw || typeof raw !== "object" || !isIndexRow(raw)) return null;
  return positiveNum((raw as Record<string, unknown>).eps);
}

/** Documented ETF info is expense ratio, AUM and NAV. Those are not a share EPS. */
export function etfInfoHasShareEps(info: unknown): boolean {
  const raw = Array.isArray(info) ? info[0] : info;
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return positiveNum(r.eps) != null
    || positiveNum(r.epsDiluted) != null
    || positiveNum(r.netIncomePerShare) != null
    || positiveNum(r.netIncomePerShareTTM) != null;
}

/** Reported quarter from /stable/earnings. Estimates are not treated as actuals. */
export function epsPrintFromEarningsRow(row: unknown): EpsPrint | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const date = String(r.date ?? "").slice(0, 10);
  const eps = finiteNum(r.epsActual) ?? finiteNum(r.actualEarningResult);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || eps == null) return null;
  return { date, eps };
}

export function ntmEpsFromEstimateRows(raw: unknown, asOf: string): number | null {
  if (!Array.isArray(raw)) return null;
  const rows: { date: string; eps: number }[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? "").slice(0, 10);
    const eps = positiveNum(r.epsAvg)
      ?? positiveNum(r.estimatedEpsAvg)
      ?? positiveNum(r.estimatedEpsDiluted)
      ?? positiveNum(r.estimatedEps);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || eps == null) continue;
    rows.push({ date, eps });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = rows.find((r) => r.date >= asOf);
  return (upcoming ?? rows[rows.length - 1])?.eps ?? null;
}

export interface FmpValuationRows {
  price: number | null;
  asOf: string;
  allowForward: boolean;
  /** Share EPS of the same instrument as `price`. */
  incomeRows: unknown[];
  earningsRows: unknown[];
  /** Quarterly /stable/ratios rows. netIncomePerShare is one quarter. */
  ratioQuarterRows?: unknown[];
  /** /stable/ratios-ttm. netIncomePerShareTTM is already a TTM, not a quarter. */
  ratiosTtmRow?: unknown;
  /**
   * Kept so a caller can pass index statements beside an ETF price.
   * They are ignored. Index EPS is not divided into the ETF price, and its YoY
   * is not attached to the ETF line.
   */
  indexIncomeRows?: unknown[];
  indexEarningsRows?: unknown[];
  /** Vendor PEG fields only. priceToEarningsRatio is not a formula PE. */
  ratiosRow: unknown;
  keyMetricsRow: unknown;
  estimateRows: unknown[];
}

function printsFrom(rows: unknown[] | undefined, fromEarnings: boolean): EpsPrint[] {
  const list = rows ?? [];
  return fromEarnings
    ? list.map(epsPrintFromEarningsRow).filter((x): x is EpsPrint => x != null)
    : list.map(epsPrintFromRow).filter((x): x is EpsPrint => x != null);
}

function bestQuarterPrints(input: FmpValuationRows): EpsPrint[] {
  const ranked = [
    { rank: 0, rows: printsFrom(input.incomeRows, false) },
    { rank: 1, rows: printsFrom(input.earningsRows, true) },
    {
      rank: 2,
      rows: (input.ratioQuarterRows ?? [])
        .map(epsPrintFromRatioQuarter)
        .filter((x): x is EpsPrint => x != null),
    },
  ];
  const positiveTtm = (rows: EpsPrint[]) => {
    const block = ttmEpsAt(rows, input.asOf);
    return block.ttm != null && block.ttm > 0;
  };
  const full = ranked.filter((c) => c.rows.length >= 8 && positiveTtm(c.rows)).sort((a, b) => a.rank - b.rank);
  if (full.length) return full[0].rows;
  const partial = ranked.filter((c) => c.rows.length >= 4 && positiveTtm(c.rows)).sort((a, b) => a.rank - b.rank);
  return partial[0]?.rows ?? [];
}

/**
 * PE, forward PE, EPS YoY, PEG and forward PEG from one instrument.
 * Price and EPS must already be in the same unit. A vendor PEG fills a gap
 * only when g itself is missing, and only on the latest bar.
 */
export function valuationFromFmpRows(input: FmpValuationRows): ValuationCore {
  void input.indexIncomeRows;
  void input.indexEarningsRows;
  const prints = bestQuarterPrints(input);
  const block = ttmEpsAt(prints, input.asOf);
  let ttm = block.ttm;
  let prev = block.prevTtm;
  if (prints.length < 4 && input.allowForward) {
    const snap = ttmEpsFromRatiosTtmRow(input.ratiosTtmRow);
    if (snap != null) {
      ttm = snap;
      prev = null;
    }
  }
  const ntm = input.allowForward ? ntmEpsFromEstimateRows(input.estimateRows, input.asOf) : null;
  const core = valuationFromParts({
    price: input.price,
    ttmEps: ttm,
    prevTtmEps: prev,
    epsNtm: ntm,
    allowForward: input.allowForward,
    keyMetricsPe: null,
  });
  if (!input.allowForward) return core;

  const extra = pegFieldsFromMetricsRow(input.ratiosRow);
  const ttmExtra = pegFieldsFromMetricsRow(input.ratiosTtmRow);
  const keyExtra = pegFieldsFromMetricsRow(input.keyMetricsRow);
  let peg = core.peg;
  let pegKind = core.pegKind;
  if (peg == null && core.epsYoy == null) {
    const vendor = extra.peg ?? ttmExtra.peg ?? keyExtra.peg;
    if (vendor != null) {
      peg = vendor;
      pegKind = "vendor";
    }
  }
  let pegFwd = core.pegFwd;
  let pegFwdKind = core.pegFwdKind;
  if (pegFwd == null && core.gCons == null) {
    const vendor = extra.pegFwd ?? ttmExtra.pegFwd ?? keyExtra.pegFwd;
    if (vendor != null) {
      pegFwd = vendor;
      pegFwdKind = "vendor";
    }
  }
  return {
    ...core,
    peg: roundTo(peg, 2),
    pegFwd: roundTo(pegFwd, 2),
    pegKind,
    pegFwdKind,
    pegExpensive: pegKind === "formula" && peg != null && peg > 3,
    pegFwdExpensive: pegFwdKind === "formula" && pegFwd != null && pegFwd > 3,
  };
}

export interface IndexValuationInput {
  /** Price of the index, never the ETF close. */
  indexPrice: number | null;
  /** Present so a caller cannot silently divide it into the index EPS. Ignored. */
  etfPrice: number | null;
  quote: unknown;
  keyMetricsTtmRow: unknown;
  estimateRows: unknown[];
  /** Sector or industry snapshot `{ pe }`. A vendor multiple. Ignored. */
  sectorPeRow: unknown;
  asOf: string;
  allowForward: boolean;
}

/**
 * Index price / index EPS only when that EPS uses the same divisor as the price index.
 * Quote `eps` and key-metrics-ttm `netIncomePerShareTTM` are not that divisor.
 * The Vier-Märkte line does not call this. It uses the constituent aggregate.
 * Quote `pe`, key-metrics `peRatioTTM` and sector-pe `pe` are not the result.
 */
export function valuationFromIndexSources(input: IndexValuationInput): ValuationCore {
  void input.etfPrice;
  void input.sectorPeRow;
  const fromMetrics = ttmEpsFromKeyMetricsTtmRow(input.keyMetricsTtmRow);
  const fromQuote = epsFromIndexQuote(input.quote);
  const ttm = fromMetrics ?? fromQuote;
  const indexEstimates = input.estimateRows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const symbol = String((row as Record<string, unknown>).symbol ?? "");
    return !symbol || symbol.startsWith("^");
  });
  const ntm = input.allowForward ? ntmEpsFromEstimateRows(indexEstimates, input.asOf) : null;
  return valuationFromParts({
    price: input.indexPrice,
    ttmEps: ttm,
    prevTtmEps: null,
    epsNtm: ntm,
    allowForward: input.allowForward,
    keyMetricsPe: peFromMetricsRow(input.keyMetricsTtmRow) ?? peFromMetricsRow(input.quote) ?? peFromMetricsRow(input.sectorPeRow),
  });
}

/** Names the index calls that did not yield a same-unit EPS. A vendor `pe` is named and not used. */
export function indexValuationNotes(symbol: string, quote: unknown, keyMetricsTtmRow: unknown): string[] {
  const notes: string[] = [];
  const quoteCall = `GET /stable/quote?symbol=${symbol}`;
  if (quote == null) notes.push(`${quoteCall} leer`);
  else if (epsFromIndexQuote(quote) == null) {
    notes.push(`${quoteCall} ohne eps`);
    if (peFromMetricsRow(quote) != null) notes.push(`${quoteCall} pe ist kein Kurs/EPS`);
  }
  const kmCall = `GET /stable/key-metrics-ttm?symbol=${symbol}`;
  if (ttmEpsFromKeyMetricsTtmRow(keyMetricsTtmRow) == null) {
    notes.push(keyMetricsTtmRow ? `${kmCall} ohne netIncomePerShareTTM` : `${kmCall} leer`);
  }
  return notes;
}

export interface IndexMember {
  symbol: string;
  cik: string | null;
}

export interface QuarterlyNetIncomePrint {
  symbol: string;
  date: string;
  netIncome: number;
  reportedCurrency: string | null;
}

export interface ConstituentFacts {
  symbol: string;
  cik: string | null;
  marketCap: number | null;
  netIncomeTtm: number | null;
  netIncomePrevTtm: number | null;
  netIncomeFwd: number | null;
  reportedCurrency: string | null;
  /** This member's own statements cannot be summed. */
  broken: string | null;
}

export interface ConstituentAggregateInput {
  constituents: ConstituentFacts[];
  /** ETF close. Ignored. It is not the numerator. */
  etfClose: number | null;
  /** Index level. Ignored unless EPS shares that index's divisor, which this path does not assume. */
  indexLevel: number | null;
  /** Vendor pe, peRatioTTM, priceToEarningsRatio, or a sector snapshot pe. Ignored. */
  vendorPe: number | null;
  allowForward: boolean;
  /**
   * False when the only caps on hand are not the as-of caps.
   * Combined with marketCapUnavailable, PE stays empty instead of using today's cap.
   */
  useCurrentMarketCap: boolean;
  /** When set, PE stays empty and this sentence is the reason. */
  marketCapUnavailable: string | null;
}

export interface ConstituentAggregateResult {
  core: ValuationCore;
  peReasons: string[];
  /** Without the "EPS YoY n/a:" prefix. */
  yoyReason: string | null;
  /** Without the "PEG n/a:" prefix. Null when g<=0 so the caller can use its own g<=0 line. */
  pegReason: string | null;
  /** Without the "fwd n/a:" prefix. */
  fwdReason: string | null;
  /** Who entered the sum, and who was left out. Present even when the ratio is a number. */
  coverageNote: string | null;
}

/**
 * Forward net income is per name on analyst-estimates (`netIncomeAvg`).
 * The stable catalog has no analyst-estimates bulk and no index-level estimate.
 * Hundreds of per-name calls are not fired.
 */
export const ANALYST_ESTIMATES_BULK_MISSING =
  "GET /stable/analyst-estimates?symbol={Name}&period=annual Feld netIncomeAvg; kein GET /stable/analyst-estimates-bulk und keine Index-Schätzung";

export interface AggregateLine {
  label: string;
  methodNote: string | null;
  /** Set when no real index membership endpoint exists. */
  blocked: string | null;
}

/**
 * N-PORT position fields are not the ratio.
 * `valUsd` / `pctVal` are the fund's holding. `balance` is a share count.
 * `cik` on every row is the fund filer.
 */
export const NPORT_POSITION_NOTE =
  "valUsd und pctVal sind die Fondsposition, nicht die Marktkapitalisierung; balance ist die Stückzahl, nicht netIncome; cik ist der Fonds, nicht der Emittent; nur assetCat EC";

function nportAggregateLine(id: string): AggregateLine {
  return {
    label: `Aggregat NPORT ${id}`,
    methodNote: `Mitglieder aus GET /stable/funds/disclosure?symbol=${id}. ${NPORT_POSITION_NOTE}`,
    blocked: null,
  };
}

/** What the Vier-Märkte line computed. Membership is the ETF's N-PORT filing. */
export function aggregateLineForBook(id: string): AggregateLine {
  if (id === "SPY" || id === "QQQ" || id === "VGK" || id === "ASHR") return nportAggregateLine(id);
  return { label: "ETF-Proxy", methodNote: null, blocked: null };
}

const CASH_HOLDING = /^(CASH|USD|US DOLLAR|CASH_USD|BIL|CASH&OTHER|CASH AND OTHER)$/;

function tickerSymbol(raw: unknown): string | null {
  const symbol = String(raw ?? "").trim().toUpperCase();
  if (!symbol || CASH_HOLDING.test(symbol)) return null;
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/.test(symbol)) return null;
  return symbol;
}

/** S&P 500 membership. `cik` lets two share classes share one income statement. */
export function membersFromSp500Rows(rows: unknown[]): IndexMember[] {
  const out: IndexMember[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const symbol = tickerSymbol(r.symbol);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const cik = String(r.cik ?? "").trim();
    out.push({ symbol, cik: cik || null });
  }
  return out;
}

/**
 * Holding tickers only. `marketValue` and `weightPercentage` are not read.
 * `asset` is the holding when `symbol` is the fund.
 */
export function membersFromHoldingRows(rows: unknown[], fundSymbol: string): IndexMember[] {
  const fund = fundSymbol.trim().toUpperCase();
  const out: IndexMember[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const asset = tickerSymbol(r.asset);
    const symbol = tickerSymbol(r.symbol);
    const chosen = asset && asset !== fund ? asset : symbol && symbol !== fund ? symbol : null;
    if (!chosen || seen.has(chosen)) continue;
    seen.add(chosen);
    out.push({ symbol: chosen, cik: null });
  }
  return out;
}

/**
 * Two most recently ended calendar quarters.
 * A filing for the quarter that just ended may not be in yet, so the caller tries the prior one too.
 */
export function nportQuartersFor(asOf: string): { year: number; quarter: 1 | 2 | 3 | 4 }[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (!match) return [];
  let year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  let qIndex = Math.floor((month - 1) / 3);
  const endMonth = (qIndex + 1) * 3;
  const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  if (Date.UTC(year, month - 1, day) < Date.UTC(year, endMonth - 1, endDay)) {
    qIndex -= 1;
    if (qIndex < 0) {
      qIndex = 3;
      year -= 1;
    }
  }
  const out: { year: number; quarter: 1 | 2 | 3 | 4 }[] = [];
  for (let i = 0; i < 2; i++) {
    out.push({ year, quarter: (qIndex + 1) as 1 | 2 | 3 | 4 });
    qIndex -= 1;
    if (qIndex < 0) {
      qIndex = 3;
      year -= 1;
    }
  }
  return out;
}

/**
 * Equity tickers from an N-PORT holding list.
 * The row's `cik` is the fund and is not copied. `valUsd`, `pctVal`, and `balance` are not read.
 */
export function membersFromNportRows(rows: unknown[], fundSymbol: string): IndexMember[] {
  const fund = fundSymbol.trim().toUpperCase();
  const out: IndexMember[] = [];
  const seen = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const assetCat = String(r.assetCat ?? "").trim().toUpperCase();
    if (assetCat !== "EC") continue;
    const payoff = String(r.payoffProfile ?? "").trim().toUpperCase();
    if (payoff === "SHORT") continue;
    const collateral = String(r.isCashCollateral ?? "").trim().toUpperCase();
    if (collateral === "Y" || r.isCashCollateral === true) continue;
    const symbol = tickerSymbol(r.symbol);
    if (!symbol || symbol === fund || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, cik: null });
  }
  return out;
}

/** Company market cap. An ETF holding's marketValue, valUsd, or balance is not this field. */
export function marketCapFromRow(row: unknown): { symbol: string; marketCap: number } | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const symbol = tickerSymbol(r.symbol);
  const marketCap = positiveNum(r.marketCap) ?? positiveNum(r.marketCapitalization) ?? positiveNum(r.mktCap);
  if (!symbol || marketCap == null) return null;
  return { symbol, marketCap };
}

/**
 * Eight fiscal period slots whose calendar quarter has ended on or before asOf.
 * income-statement-bulk is keyed by year and Q1–Q4, then filtered by statement date.
 */
export function bulkQuarterWindow(asOf: string): { year: number; period: "Q1" | "Q2" | "Q3" | "Q4" }[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOf);
  if (!match) return [];
  const year0 = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  let year = year0;
  let qIndex = Math.floor((month - 1) / 3);
  const endMonth = (qIndex + 1) * 3;
  const endDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const asOfUtc = Date.UTC(year, month - 1, day);
  const quarterEnd = Date.UTC(year, endMonth - 1, endDay);
  if (asOfUtc < quarterEnd) {
    qIndex -= 1;
    if (qIndex < 0) {
      qIndex = 3;
      year -= 1;
    }
  }
  const desc: { year: number; period: "Q1" | "Q2" | "Q3" | "Q4" }[] = [];
  for (let i = 0; i < 8; i++) {
    desc.push({ year, period: `Q${qIndex + 1}` as "Q1" | "Q2" | "Q3" | "Q4" });
    qIndex -= 1;
    if (qIndex < 0) {
      qIndex = 3;
      year -= 1;
    }
  }
  return desc.reverse();
}

function isAnnualPeriod(period: string): boolean {
  const p = period.toUpperCase();
  return p === "FY" || p === "ANNUAL" || p === "YEAR";
}

/** One quarterly netIncome. FY rows are a full year and are not a quarter. */
export function quarterlyNetIncomeFromRow(row: unknown): QuarterlyNetIncomePrint | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (isAnnualPeriod(String(r.period ?? ""))) return null;
  const symbol = tickerSymbol(r.symbol);
  const date = String(r.date ?? "").slice(0, 10);
  const netIncome = finiteNum(r.netIncome);
  if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date) || netIncome == null) return null;
  const currency = String(r.reportedCurrency ?? "").trim().toUpperCase();
  return { symbol, date, netIncome, reportedCurrency: currency || null };
}

function parseCsvRecords(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === "\"") inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    header.forEach((h, idx) => {
      if (h) rec[h] = cells[idx] ?? "";
    });
    return rec;
  });
}

/** JSON array or CSV from income-statement-bulk. Optional symbol filter drops every other company. */
export function incomePrintsFromBulkBody(body: string, symbols?: ReadonlySet<string>): QuarterlyNetIncomePrint[] {
  const trimmed = body.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return [];
  let rows: unknown[] = [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) rows = parsed;
    else if (parsed && typeof parsed === "object") rows = [parsed];
  } else {
    rows = parseCsvRecords(trimmed);
  }
  const wanted = new Set<string>();
  if (symbols) symbols.forEach((s) => wanted.add(s.toUpperCase()));
  const filterSymbols = symbols != null;
  const prints: QuarterlyNetIncomePrint[] = [];
  for (const row of rows) {
    const print = quarterlyNetIncomeFromRow(row);
    if (!print) continue;
    if (filterSymbols && !wanted.has(print.symbol)) continue;
    prints.push(print);
  }
  return prints;
}

/**
 * netIncomeAvg on the first annual row dated on or after asOf.
 * epsAvg is not a net income and does not fill this.
 */
export function forwardNetIncomeFromEstimateRows(rows: unknown[], asOf: string): number | null {
  const upcoming: { date: string; netIncome: number }[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (isAnnualPeriod(String(r.period ?? "")) === false && String(r.period ?? "").trim() !== "") {
      const period = String(r.period ?? "").toUpperCase();
      if (period.startsWith("Q")) continue;
    }
    const date = String(r.date ?? "").slice(0, 10);
    const netIncome = finiteNum(r.netIncomeAvg);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < asOf || netIncome == null) continue;
    upcoming.push({ date, netIncome });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0]?.netIncome ?? null;
}

function printsForSymbol(prints: QuarterlyNetIncomePrint[], symbol: string, asOf: string): {
  ttm: number | null;
  prev: number | null;
  currency: string | null;
  broken: string | null;
} {
  const rows = prints
    .filter((p) => p.symbol === symbol && p.date <= asOf)
    .sort((a, b) => a.date.localeCompare(b.date) || a.netIncome - b.netIncome);
  const byDate = new Map<string, QuarterlyNetIncomePrint>();
  for (const row of rows) {
    const prev = byDate.get(row.date);
    if (prev && prev.netIncome !== row.netIncome) {
      return { ttm: null, prev: null, currency: null, broken: `netIncome am ${row.date} widerspricht sich` };
    }
    byDate.set(row.date, row);
  }
  const unique: QuarterlyNetIncomePrint[] = [];
  byDate.forEach((row) => unique.push(row));
  const currencies = uniqueStrings(unique.map((p) => p.reportedCurrency).filter((c): c is string => Boolean(c)));
  if (currencies.length > 1) {
    return { ttm: null, prev: null, currency: null, broken: "reportedCurrency widerspricht sich" };
  }
  const currency = currencies[0] ?? null;
  const sum = (xs: QuarterlyNetIncomePrint[]) => xs.reduce((s, x) => s + x.netIncome, 0);
  const ttmRows = unique.slice(-4);
  const prevRows = unique.slice(-8, -4);
  return {
    ttm: ttmRows.length === 4 ? sum(ttmRows) : null,
    prev: prevRows.length === 4 ? sum(prevRows) : null,
    currency,
    broken: null,
  };
}

/** One fact per member. Market value is the company cap, never a holding's marketValue. */
export function constituentFactsFromSources(input: {
  members: IndexMember[];
  prints: QuarterlyNetIncomePrint[];
  marketCaps: { symbol: string; marketCap: number }[];
  estimateRows: unknown[];
  asOf: string;
}): ConstituentFacts[] {
  const caps = new Map<string, number>();
  for (const row of input.marketCaps) caps.set(row.symbol.toUpperCase(), row.marketCap);
  const estimates = new Map<string, unknown[]>();
  for (const row of input.estimateRows) {
    if (!row || typeof row !== "object") continue;
    const symbol = tickerSymbol((row as Record<string, unknown>).symbol);
    if (!symbol) continue;
    const list = estimates.get(symbol) ?? [];
    list.push(row);
    estimates.set(symbol, list);
  }
  return input.members.map((member) => {
    const block = printsForSymbol(input.prints, member.symbol, input.asOf);
    return {
      symbol: member.symbol,
      cik: member.cik,
      marketCap: caps.get(member.symbol) ?? null,
      netIncomeTtm: block.ttm,
      netIncomePrevTtm: block.prev,
      netIncomeFwd: forwardNetIncomeFromEstimateRows(estimates.get(member.symbol) ?? [], input.asOf),
      reportedCurrency: block.currency,
      broken: block.broken,
    };
  });
}

function uniqueStrings(values: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const value of values) {
    if (seen[value]) continue;
    seen[value] = true;
    out.push(value);
  }
  return out;
}

function missingNames(label: string, symbols: string[]): string {
  const unique = uniqueStrings(symbols);
  const shown = unique.slice(0, 5).join(", ");
  if (unique.length === 1) return `${label} fehlt für ${shown}`;
  const more = unique.length > 5 ? `, +${unique.length - 5}` : "";
  return `${label} fehlt für ${unique.length} Namen (${shown}${more})`;
}

interface CompanyBucket {
  key: string;
  symbols: string[];
  marketCap: number | null;
  missingCap: string[];
  netIncomeTtm: number | null;
  missingTtm: string[];
  netIncomePrevTtm: number | null;
  missingPrev: string[];
  netIncomeFwd: number | null;
  missingFwd: string[];
  reportedCurrency: string | null;
  broken: string | null;
}

function sameIncome(values: number[]): boolean {
  return values.every((v) => v === values[0]);
}

function companyBuckets(constituents: ConstituentFacts[]): CompanyBucket[] {
  const grouped: { key: string; rows: ConstituentFacts[] }[] = [];
  const indexByKey: Record<string, number> = {};
  for (const row of constituents) {
    const cik = row.cik?.trim() ?? "";
    const key = cik ? `cik:${cik}` : `sym:${row.symbol}`;
    const existing = indexByKey[key];
    if (existing == null) {
      indexByKey[key] = grouped.length;
      grouped.push({ key, rows: [row] });
    } else {
      grouped[existing].rows.push(row);
    }
  }
  const buckets: CompanyBucket[] = [];
  for (const group of grouped) {
    const key = group.key;
    const rows = group.rows;
    const symbols = rows.map((r) => r.symbol);
    const brokenRow = rows.find((r) => r.broken);
    if (brokenRow?.broken) {
      buckets.push({
        key,
        symbols,
        marketCap: null,
        missingCap: [],
        netIncomeTtm: null,
        missingTtm: [],
        netIncomePrevTtm: null,
        missingPrev: [],
        netIncomeFwd: null,
        missingFwd: [],
        reportedCurrency: null,
        broken: `${brokenRow.broken} (${symbols.join(", ")})`,
      });
      continue;
    }
    const currencies = uniqueStrings(rows.map((r) => r.reportedCurrency).filter((c): c is string => Boolean(c)));
    if (currencies.length > 1) {
      buckets.push({
        key,
        symbols,
        marketCap: null,
        missingCap: [],
        netIncomeTtm: null,
        missingTtm: [],
        netIncomePrevTtm: null,
        missingPrev: [],
        netIncomeFwd: null,
        missingFwd: [],
        reportedCurrency: null,
        broken: `reportedCurrency widerspricht sich (${symbols.join(", ")})`,
      });
      continue;
    }
    const fold = (pick: (row: ConstituentFacts) => number | null, label: string): { value: number | null; missing: string[]; broken: string | null } => {
      const present = rows.filter((r) => pick(r) != null);
      const missing = rows.filter((r) => pick(r) == null).map((r) => r.symbol);
      if (!present.length) return { value: null, missing: symbols, broken: null };
      const values = present.map((r) => pick(r) as number);
      if (!sameIncome(values)) {
        return { value: null, missing: [], broken: `${label} widerspricht sich für ${key} (${symbols.join(", ")})` };
      }
      if (rows.length === 1) return { value: missing.length ? null : values[0], missing, broken: null };
      return { value: values[0], missing: [], broken: null };
    };
    const caps = rows.filter((r) => r.marketCap != null && r.marketCap > 0);
    const missingCap = rows.filter((r) => r.marketCap == null || !(r.marketCap > 0)).map((r) => r.symbol);
    const ttm = fold((r) => r.netIncomeTtm, "netIncome TTM");
    const prev = fold((r) => r.netIncomePrevTtm, "Vorjahres-netIncome");
    const fwd = fold((r) => r.netIncomeFwd, "netIncomeAvg");
    const broken = ttm.broken ?? prev.broken ?? fwd.broken;
    buckets.push({
      key,
      symbols,
      marketCap: missingCap.length ? null : caps.reduce((s, r) => s + (r.marketCap as number), 0),
      missingCap,
      netIncomeTtm: ttm.value,
      missingTtm: ttm.missing,
      netIncomePrevTtm: prev.value,
      missingPrev: prev.missing,
      netIncomeFwd: fwd.value,
      missingFwd: fwd.missing,
      reportedCurrency: currencies[0] ?? null,
      broken,
    });
  }
  return buckets;
}

function modalCurrency(buckets: CompanyBucket[]): { currency: string | null; tied: string[] | null } {
  const counts: Record<string, number> = {};
  for (const bucket of buckets) {
    if (!bucket.reportedCurrency) continue;
    counts[bucket.reportedCurrency] = (counts[bucket.reportedCurrency] ?? 0) + 1;
  }
  const keys = Object.keys(counts);
  if (!keys.length) return { currency: null, tied: null };
  let top = 0;
  for (const key of keys) if (counts[key] > top) top = counts[key];
  const leaders = keys.filter((key) => counts[key] === top).sort();
  if (leaders.length > 1) return { currency: null, tied: leaders };
  return { currency: leaders[0], tied: null };
}

function holeList(items: { symbols: string[]; reason: string }[]): string {
  const shown = items.slice(0, 8).map((item) => `${item.symbols.join(", ")} (${item.reason})`);
  const more = items.length > 8 ? `, +${items.length - 8}` : "";
  return `${shown.join("; ")}${more}`;
}

function coverageSentence(label: string, total: number, used: number, holes: { symbols: string[]; reason: string }[]): string {
  const ohne = holes.length ? ` Ohne ${holeList(holes)}.` : "";
  return `${label} ${used}/${total}.${ohne}`;
}

/**
 * Index PE = Σ covered market cap / Σ covered net income.
 * A name that lacks a cap, a TTM, a prior TTM, or the set's currency is left out and named.
 * It does not blank the other names, and it is not filled with a guess.
 * One income statement per company: share classes that share a cik contribute
 * one net income and the sum of their market caps. Averaging constituent P/Es is not this ratio.
 * EPS YoY and PEG use that same covered set. Forward PE is Σ market cap / Σ netIncomeAvg
 * on the names that have netIncomeAvg. There is no estimates bulk, so an unloaded
 * forward stays empty and names that endpoint.
 */
export function valuationFromConstituentAggregates(input: ConstituentAggregateInput): ConstituentAggregateResult {
  void input.etfClose;
  void input.indexLevel;
  void input.vendorPe;
  const buckets = companyBuckets(input.constituents);
  const total = input.constituents.length;
  const peReasons: string[] = [];
  let peRaw: number | null = null;
  let yoyRaw: number | null = null;
  let yoyReason: string | null = null;
  let peFwdRaw: number | null = null;
  let gConsRaw: number | null = null;
  let fwdReason: string | null = null;
  let coverageNote: string | null = null;
  const capsReady = input.useCurrentMarketCap && !input.marketCapUnavailable;

  if (!total) {
    peReasons.push("keine Constituents");
    yoyReason = "keine Constituents";
    if (input.allowForward) fwdReason = "keine Constituents";
  } else {
    const earningsReady = (bucket: CompanyBucket) =>
      !bucket.broken && bucket.netIncomeTtm != null && bucket.netIncomePrevTtm != null;
    const capReady = (bucket: CompanyBucket) =>
      earningsReady(bucket) && bucket.missingCap.length === 0 && bucket.marketCap != null && bucket.marketCap > 0;
    const trailingCandidates = buckets.filter((bucket) => capsReady ? capReady(bucket) : earningsReady(bucket));
    const trailingMode = modalCurrency(trailingCandidates);
    const trailingHoles: { symbols: string[]; reason: string }[] = [];
    const trailing: CompanyBucket[] = [];
    for (const bucket of buckets) {
      if (bucket.broken) {
        trailingHoles.push({ symbols: bucket.symbols, reason: bucket.broken });
        continue;
      }
      if (capsReady && (bucket.missingCap.length || bucket.marketCap == null || !(bucket.marketCap > 0))) {
        trailingHoles.push({
          symbols: bucket.symbols,
          reason: missingNames("Marktkapitalisierung", bucket.missingCap.length ? bucket.missingCap : bucket.symbols),
        });
        continue;
      }
      if (bucket.netIncomeTtm == null) {
        trailingHoles.push({
          symbols: bucket.symbols,
          reason: missingNames("netIncome TTM", bucket.missingTtm.length ? bucket.missingTtm : bucket.symbols),
        });
        continue;
      }
      if (bucket.netIncomePrevTtm == null) {
        trailingHoles.push({
          symbols: bucket.symbols,
          reason: missingNames("Vorjahres-netIncome", bucket.missingPrev.length ? bucket.missingPrev : bucket.symbols),
        });
        continue;
      }
      if (trailingMode.tied) {
        trailingHoles.push({ symbols: bucket.symbols, reason: `reportedCurrency gemischt (${trailingMode.tied.join(", ")})` });
        continue;
      }
      if (trailingMode.currency && bucket.reportedCurrency && bucket.reportedCurrency !== trailingMode.currency) {
        trailingHoles.push({ symbols: bucket.symbols, reason: `reportedCurrency ${bucket.reportedCurrency}` });
        continue;
      }
      trailing.push(bucket);
    }

    const usedSymbols = trailing.reduce((sum, bucket) => sum + bucket.symbols.length, 0);
    if (!capsReady) {
      peReasons.push(input.marketCapUnavailable ?? "Marktkapitalisierung zum Stichtag fehlt");
    } else if (trailingMode.tied) {
      const mixed = `reportedCurrency gemischt (${trailingMode.tied.join(", ")})`;
      peReasons.push(mixed);
      yoyReason = mixed;
    } else if (!trailing.length) {
      peReasons.push("keine Deckung");
      yoyReason = "keine Deckung";
    } else {
      const sumCap = trailing.reduce((sum, bucket) => sum + (bucket.marketCap as number), 0);
      const sumTtm = trailing.reduce((sum, bucket) => sum + (bucket.netIncomeTtm as number), 0);
      const sumPrev = trailing.reduce((sum, bucket) => sum + (bucket.netIncomePrevTtm as number), 0);
      if (!(sumCap > 0) || !(sumTtm > 0)) peReasons.push("Summe netIncome <= 0");
      else peRaw = sumCap / sumTtm;
      if (sumPrev === 0) yoyReason = "Summe Vorjahres-netIncome ist 0";
      else yoyRaw = ((sumTtm - sumPrev) / sumPrev) * 100;
    }
    if (!capsReady && trailingMode.tied) {
      yoyReason = `reportedCurrency gemischt (${trailingMode.tied.join(", ")})`;
    }
    if (!capsReady && !trailingMode.tied && trailing.length) {
      const sumTtm = trailing.reduce((sum, bucket) => sum + (bucket.netIncomeTtm as number), 0);
      const sumPrev = trailing.reduce((sum, bucket) => sum + (bucket.netIncomePrevTtm as number), 0);
      if (sumPrev === 0) yoyReason = "Summe Vorjahres-netIncome ist 0";
      else yoyRaw = ((sumTtm - sumPrev) / sumPrev) * 100;
    }
    coverageNote = coverageSentence("Deckung", total, usedSymbols, trailingHoles);

    if (input.allowForward) {
      const anyFwd = buckets.some((bucket) => bucket.netIncomeFwd != null);
      if (!capsReady) fwdReason = input.marketCapUnavailable ?? "Marktkapitalisierung zum Stichtag fehlt";
      else if (!anyFwd) fwdReason = ANALYST_ESTIMATES_BULK_MISSING;
      else {
        const forwardCandidates = buckets.filter((bucket) =>
          !bucket.broken
          && bucket.missingCap.length === 0
          && bucket.marketCap != null
          && bucket.marketCap > 0
          && bucket.netIncomeTtm != null
          && bucket.netIncomeFwd != null);
        const forwardMode = modalCurrency(forwardCandidates);
        const forwardHoles: { symbols: string[]; reason: string }[] = [];
        const forward: CompanyBucket[] = [];
        for (const bucket of buckets) {
          if (bucket.broken) {
            forwardHoles.push({ symbols: bucket.symbols, reason: bucket.broken });
            continue;
          }
          if (bucket.missingCap.length || bucket.marketCap == null || !(bucket.marketCap > 0)) {
            forwardHoles.push({
              symbols: bucket.symbols,
              reason: missingNames("Marktkapitalisierung", bucket.missingCap.length ? bucket.missingCap : bucket.symbols),
            });
            continue;
          }
          if (bucket.netIncomeTtm == null) {
            forwardHoles.push({
              symbols: bucket.symbols,
              reason: missingNames("netIncome TTM", bucket.missingTtm.length ? bucket.missingTtm : bucket.symbols),
            });
            continue;
          }
          if (bucket.netIncomeFwd == null) {
            forwardHoles.push({
              symbols: bucket.symbols,
              reason: missingNames("netIncomeAvg", bucket.missingFwd.length ? bucket.missingFwd : bucket.symbols),
            });
            continue;
          }
          if (forwardMode.tied) {
            forwardHoles.push({ symbols: bucket.symbols, reason: `reportedCurrency gemischt (${forwardMode.tied.join(", ")})` });
            continue;
          }
          if (forwardMode.currency && bucket.reportedCurrency && bucket.reportedCurrency !== forwardMode.currency) {
            forwardHoles.push({ symbols: bucket.symbols, reason: `reportedCurrency ${bucket.reportedCurrency}` });
            continue;
          }
          forward.push(bucket);
        }
        const forwardUsed = forward.reduce((sum, bucket) => sum + bucket.symbols.length, 0);
        coverageNote += ` ${coverageSentence("Forward-Deckung", total, forwardUsed, forwardHoles)}`;
        if (forwardMode.tied) fwdReason = `reportedCurrency gemischt (${forwardMode.tied.join(", ")})`;
        else if (!forward.length) fwdReason = "keine Forward-Deckung";
        else {
          const sumCap = forward.reduce((sum, bucket) => sum + (bucket.marketCap as number), 0);
          const sumFwd = forward.reduce((sum, bucket) => sum + (bucket.netIncomeFwd as number), 0);
          const sumTtm = forward.reduce((sum, bucket) => sum + (bucket.netIncomeTtm as number), 0);
          if (!(sumCap > 0) || !(sumFwd > 0)) fwdReason = "Summe netIncomeAvg <= 0";
          else {
            peFwdRaw = sumCap / sumFwd;
            if (sumTtm > 0) gConsRaw = ((sumFwd - sumTtm) / sumTtm) * 100;
          }
        }
      }
    }
  }

  const pegRaw = pegFromPeAndGrowth(peRaw, yoyRaw);
  const pegFwdRaw = pegFromPeAndGrowth(peFwdRaw, gConsRaw);
  let pegReason: string | null = null;
  if (pegRaw == null) {
    if (peRaw != null && yoyRaw != null && !(yoyRaw > 0)) pegReason = "g<=0";
    else if (peRaw != null && yoyRaw == null) pegReason = yoyReason ?? "kein EPS-YoY derselben Einheit";
    else if (peRaw == null && yoyRaw != null) pegReason = "kein PE derselben Deckung";
    else pegReason = yoyReason ?? peReasons[0] ?? "kein PE und kein EPS-YoY derselben Deckung";
  }
  const note = input.allowForward ? null : "Forward-Konsens nur am letzten Handelstag (kein Punkt-in-Zeit-Schätzer).";
  return {
    core: {
      pe: roundTo(peRaw, 2),
      peFwd: roundTo(peFwdRaw, 2),
      peg: roundTo(pegRaw, 2),
      pegFwd: roundTo(pegFwdRaw, 2),
      pegKind: pegRaw != null ? "formula" : null,
      pegFwdKind: pegFwdRaw != null ? "formula" : null,
      epsYoy: roundTo(yoyRaw, 2),
      gCons: roundTo(gConsRaw, 2),
      pegExpensive: pegRaw != null && pegRaw > 3,
      pegFwdExpensive: pegFwdRaw != null && pegFwdRaw > 3,
      note,
    },
    peReasons,
    yoyReason,
    pegReason,
    fwdReason,
    coverageNote,
  };
}

/** ETF info and an ETF quote are not an index EPS. Company statements are not named here. */
export function etfValuationNotes(etf: string, fallbackSymbol: string | null, info: unknown): string[] {
  const infoCall = `GET /stable/etf/info?symbol=${etf}`;
  const notes = [
    etfInfoHasShareEps(info)
      ? `${infoCall} eps wird nicht als Share-EPS gelesen`
      : `${infoCall} ohne EPS`,
  ];
  const quoteSymbol = fallbackSymbol && !fallbackSymbol.startsWith("^") ? fallbackSymbol : etf;
  notes.push(`GET /stable/quote?symbol=${quoteSymbol} ist ETF-Kurs, kein Index-EPS`);
  return notes;
}

export interface ValuationInstrument {
  symbol: string;
  role: "etf" | "fallback";
  price: number | null;
  incomeRows: unknown[];
  earningsRows: unknown[];
  ratioQuarterRows: unknown[];
  ratiosTtmRow: unknown;
  vendorRatiosRow: unknown;
  keyMetricsRow: unknown;
  estimateRows: unknown[];
}

function quarterPrintCount(inst: ValuationInstrument): number {
  const positive = (rows: EpsPrint[]) => rows.filter((p) => p.eps > 0).length;
  const income = positive(printsFrom(inst.incomeRows, false));
  const earnings = positive(printsFrom(inst.earningsRows, true));
  const ratios = positive(inst.ratioQuarterRows.map(epsPrintFromRatioQuarter).filter((x): x is EpsPrint => x != null));
  return Math.max(income, earnings, ratios);
}

/**
 * True when this symbol is an index and has a price plus EPS in that same unit.
 * An ETF has no share EPS. Company statements on SPY, QQQ, VGK, ASHR or FEZ do not count.
 */
export function instrumentCanPriceEps(inst: ValuationInstrument): boolean {
  if (!inst.symbol.startsWith("^")) return false;
  if (inst.price == null || !(inst.price > 0)) return false;
  if (quarterPrintCount(inst) >= 4) return true;
  return ttmEpsFromRatiosTtmRow(inst.ratiosTtmRow) != null;
}

/**
 * An index with its own price and EPS wins.
 * An ETF never wins on company-statement EPS, and an index EPS is never paired with the ETF price.
 */
export function pickValuationInstrument(
  etf: ValuationInstrument,
  fallback: ValuationInstrument | null,
): ValuationInstrument {
  if (instrumentCanPriceEps(etf)) return etf;
  if (fallback && instrumentCanPriceEps(fallback)) return fallback;
  return etf;
}

export function valuationLabelFor(inst: ValuationInstrument, chartEtf: string): string {
  if (inst.role === "etf" || inst.symbol.toUpperCase() === chartEtf.toUpperCase()) return "ETF-Proxy";
  if (inst.symbol.startsWith("^")) return `Index ${inst.symbol}`;
  return `ETF ${inst.symbol}`;
}

function barOnOrBefore(row: unknown, asOf: string): { date: string; close: number } | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const date = String(r.date ?? r.Date ?? "").slice(0, 10);
  const close = finiteNum(r.close) ?? finiteNum(r.adjClose) ?? finiteNum(r.price);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > asOf || close == null || !(close > 0)) return null;
  return { date, close };
}

/** Last positive close/adjClose/price on or before asOf. A later session is ignored. */
export function closeFromPriceRows(rows: unknown[], asOf: string): number | null {
  const bars = (Array.isArray(rows) ? rows : [])
    .map((row) => barOnOrBefore(row, asOf))
    .filter((x): x is { date: string; close: number } => x != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return bars.length ? bars[bars.length - 1].close : null;
}

/** Quote `price` for the same symbol. A dated quote after asOf is not that session. */
export function closeFromQuote(quote: unknown, asOf: string): number | null {
  if (!quote || typeof quote !== "object") return null;
  const r = quote as Record<string, unknown>;
  const price = finiteNum(r.price);
  if (price == null || !(price > 0)) return null;
  let date = String(r.date ?? "").slice(0, 10);
  const ts = finiteNum(r.timestamp);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) && ts != null) {
    const ms = ts > 1e12 ? ts : ts * 1000;
    date = new Date(ms).toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date > asOf) return null;
  return price;
}

export interface ValuationGapInput {
  chartEtf: string;
  chosenSymbol: string;
  valuationLabel: string;
  pe: number | null;
  peFwd: number | null;
  epsYoy: number | null;
  peg: number | null;
  pegFwd: number | null;
  gCons: number | null;
  allowForward: boolean;
  etfNotes: string[];
  /** Null when no fallback was loaded. Empty calls still belong in the line. */
  fallbackNotes: string[] | null;
  priceNote: string | null;
  extraNotes: string[];
  fwdNote: string | null;
  /** Replaces the generic YoY gap when the source is a single index TTM. */
  yoyNote?: string | null;
  pegNote?: string | null;
  /** How an aggregate was formed. Shown with the sum, not as Kurs/EPS. */
  methodNote?: string | null;
  /** Covered names and the names left out. Shown even when PE is a number. */
  coverageNote?: string | null;
}

/** Names every empty same-unit call, including a fallback that could not form a PE. */
export function assembleValuationMissing(input: ValuationGapInput): string | null {
  const aggregate = input.valuationLabel.startsWith("Aggregat ");
  const noIndex = input.valuationLabel.startsWith("kein Index");
  const usedFallback = input.valuationLabel !== "ETF-Proxy";
  const sourceNotes = usedFallback
    ? (input.fallbackNotes ?? [])
    : [...input.etfNotes, ...(input.fallbackNotes ?? [])];
  const gaps: string[] = [];
  if (aggregate) {
    const how = input.methodNote ? ` (${input.methodNote})` : "";
    gaps.push(`${input.valuationLabel}: Summe Marktkapitalisierung / Summe netIncome${how}`);
  } else if (usedFallback && !noIndex) {
    gaps.push(`Formel auf ${input.chosenSymbol} (Kurs und EPS), nicht auf ${input.chartEtf}`);
  }
  if (input.coverageNote) gaps.push(input.coverageNote);
  if (input.pe != null && sourceNotes.length) gaps.push(sourceNotes.join("; "));
  if (input.pe == null) {
    const why = [...sourceNotes, ...input.extraNotes, input.priceNote].filter((x): x is string => Boolean(x));
    gaps.push(why.length ? `PE fehlt: ${why.join("; ")}` : "PE fehlt: kein Kurs und EPS derselben Einheit");
  }
  if (input.epsYoy == null && input.yoyNote) {
    gaps.push(input.yoyNote);
  } else if (input.epsYoy == null && input.pe != null) {
    gaps.push("EPS YoY fehlt: weniger als 8 Quartalsdrucke derselben Einheit");
  } else if (input.epsYoy == null && sourceNotes.length) {
    gaps.push(`EPS YoY fehlt: ${sourceNotes.join("; ")}`);
  }
  if (input.peg == null) {
    if (input.pegNote) gaps.push(input.pegNote);
    else if (input.epsYoy != null && input.epsYoy <= 0) gaps.push("PEG fehlt: g<=0");
    else gaps.push(`PEG fehlt: ${input.pe == null ? "kein PE derselben Deckung" : "kein EPS-YoY derselben Deckung"}`);
  }
  if (input.allowForward && input.peFwd == null) {
    gaps.push(`fwd fehlt: ${input.fwdNote ?? "Feld netIncomeAvg"}`);
  }
  if (input.allowForward && input.pegFwd == null) {
    if (input.gCons != null && input.gCons <= 0) gaps.push("PEG fwd fehlt: g<=0");
    else gaps.push(`PEG fwd fehlt: ${input.fwdNote ?? "Feld netIncomeAvg"}`);
  }
  return gaps.length ? gaps.join(" · ") : null;
}

/** Text for one snapshot field. A number stays a number. A gap names the missing input and does not say n/a. */
export function valuationGapText(missing: string | null | undefined, marker: string): string {
  const fallback = marker.replace(/:\s*$/, "");
  if (!missing) return fallback;
  const hit = missing.split(" · ").find((part) => part.startsWith(marker));
  if (!hit) return fallback;
  const body = hit.slice(marker.length).trim();
  return body || fallback;
}

export interface MarginPoint {
  date: string;
  debitMillions: number;
}

export function marginYoYAndZ(levels: number[]): { yoyPct: number | null; z5y: number | null } {
  const yoys: number[] = [];
  for (let i = 12; i < levels.length; i++) {
    const prev = levels[i - 12];
    const cur = levels[i];
    if (!(prev > 0) || !Number.isFinite(cur)) continue;
    yoys.push(((cur - prev) / prev) * 100);
  }
  if (!yoys.length) return { yoyPct: null, z5y: null };
  const yoyPct = yoys[yoys.length - 1];
  const sample = yoys.slice(-60);
  if (sample.length < 12) return { yoyPct, z5y: null };
  const mean = sample.reduce((s, x) => s + x, 0) / sample.length;
  const variance = sample.reduce((s, x) => s + (x - mean) ** 2, 0) / (sample.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return { yoyPct, z5y: 0 };
  return { yoyPct, z5y: (yoyPct - mean) / sd };
}

export const leverageSchema = z.object({
  seriesId: z.literal("FINRA_MARGIN_DEBIT"),
  unit: z.literal("Mrd. $"),
  asOf: z.string(),
  billions: z.number(),
  yoyPct: z.number().nullable(),
  z5y: z.number().nullable(),
  high: z.boolean(),
  points: z.array(z.object({ date: z.string(), billions: z.number() })),
});

export type LeverageStrip = z.infer<typeof leverageSchema>;

/** Chart points follow the selected window. z5y below stays a 5-year YoY statistic. */
export function marginPointsForWindow(pointsAsc: MarginPoint[], window: MarketWindow): MarginPoint[] {
  const floored = pointsAsc.filter((p) => p.date >= SERIES_FLOOR);
  if (window === "MAX") return floored;
  return floored.slice(-WINDOW_MONTHS[window]);
}

export function finraLeverage(pointsAsc: MarginPoint[], window: MarketWindow = "5Y"): LeverageStrip | null {
  if (pointsAsc.length < 13) return null;
  const levels = pointsAsc.map((p) => p.debitMillions);
  const raw = marginYoYAndZ(levels);
  const last = pointsAsc[pointsAsc.length - 1];
  const billions = roundTo(last.debitMillions / 1000, 3);
  if (billions == null) return null;
  const points = marginPointsForWindow(pointsAsc, window).flatMap((p) => {
    const value = roundTo(p.debitMillions / 1000, 3);
    if (value == null) return [];
    return [{ date: p.date.slice(0, 7), billions: value }];
  });
  return {
    seriesId: "FINRA_MARGIN_DEBIT",
    unit: "Mrd. $",
    asOf: last.date.slice(0, 7),
    billions,
    yoyPct: roundTo(raw.yoyPct, 2),
    z5y: roundTo(raw.z5y, 2),
    high: raw.z5y != null && raw.z5y > 1,
    points,
  };
}

/** FINRA margin debit sits under SPY only. EU and ASHR never receive a clone. */
export function leverageForMarket(id: ChartMarketId, strip: LeverageStrip | null): LeverageStrip | null {
  return id === "SPY" ? strip : null;
}

export function parseFinraMarginSheetXml(xml: string): MarginPoint[] {
  const out: MarginPoint[] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(xml))) {
    const row = match[1];
    const month = row.match(/<t>(\d{4}-\d{2})<\/t>/);
    const debit = row.match(/<c r="B\d+"[^>]*>\s*<v>([0-9.]+)<\/v>/);
    if (!month || !debit) continue;
    const debitMillions = Number(debit[1]);
    if (!Number.isFinite(debitMillions)) continue;
    out.push({ date: `${month[1]}-01`, debitMillions });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export const chartBarSchema = z.object({
  date: z.string(),
  open: z.number().nullable(),
  high: z.number().nullable(),
  low: z.number().nullable(),
  close: z.number(),
  volume: z.number().nullable(),
  rsi: z.number().nullable(),
  macd: z.number().nullable(),
  signal: z.number().nullable(),
  hist: z.number().nullable(),
});

export const pegKindSchema = z.enum(["formula", "vendor"]).nullable();

export const snapshotSchema = z.object({
  pe: z.number().nullable(),
  peFwd: z.number().nullable(),
  peg: z.number().nullable(),
  pegFwd: z.number().nullable(),
  pegKind: pegKindSchema,
  pegFwdKind: pegKindSchema,
  epsYoy: z.number().nullable(),
  rsi: z.number().nullable(),
  macdHist: z.number().nullable(),
  /** Named FMP calls that came back empty for a field that is still n/a. */
  missing: z.string().nullable(),
});

export const marketChartSchema = z.object({
  id: z.enum(["SPY", "QQQ", "VGK", "ASHR"]),
  etf: z.string(),
  name: z.string(),
  volId: z.string(),
  volKind: z.enum(["implied", "realized"]),
  bandsAnalog: z.boolean(),
  volYMax: z.literal(90),
  volNote: z.string().nullable(),
  ohlcv: z.array(chartBarSchema),
  vol: z.array(z.object({ date: z.string(), value: z.number() })),
  marks: z.array(z.object({ date: z.string(), value: z.number() })),
  snapshot: snapshotSchema,
  leverage: leverageSchema.nullable(),
  leverageNote: z.string().nullable(),
  valuationLabel: z.string().min(1),
});

export const marketsResponseSchema = z.object({
  asOf: z.string().nullable(),
  window: z.enum(["1Y", "3Y", "5Y", "10Y", "MAX"]),
  markets: z.array(marketChartSchema).length(4),
});

export const factpackSchema = z.object({
  id: z.enum(["SPY", "QQQ", "VGK", "ASHR"]),
  etf: z.string(),
  date: z.string(),
  close: z.number().nullable(),
  valuationLabel: z.string().min(1),
  pe: z.number().nullable(),
  peFwd: z.number().nullable(),
  peg: z.number().nullable(),
  pegFwd: z.number().nullable(),
  pegKind: pegKindSchema,
  pegFwdKind: pegKindSchema,
  epsYoy: z.number().nullable(),
  gCons: z.number().nullable(),
  rsi: z.number().nullable(),
  macd: z.number().nullable(),
  macdSignal: z.number().nullable(),
  macdHist: z.number().nullable(),
  volume: z.number().nullable(),
  pegExpensive: z.boolean(),
  pegFwdExpensive: z.boolean(),
  note: z.string().nullable(),
});

export type MarketChart = z.infer<typeof marketChartSchema>;
export type MarketsResponse = z.infer<typeof marketsResponseSchema>;
export type MarketFactpack = z.infer<typeof factpackSchema>;
export type ChartBar = z.infer<typeof chartBarSchema>;
