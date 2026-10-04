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

export interface ValuationCore {
  pe: number | null;
  peFwd: number | null;
  peg: number | null;
  pegFwd: number | null;
  epsYoy: number | null;
  gCons: number | null;
  pegExpensive: boolean;
  pegFwdExpensive: boolean;
  note: string | null;
}

export function valuationFromParts(input: ValuationInput): ValuationCore {
  const epsYoyRaw = epsYoyPercent(input.ttmEps, input.prevTtmEps);
  let peRaw: number | null = null;
  if (input.price != null && input.price > 0 && input.ttmEps != null && input.ttmEps > 0) {
    peRaw = input.price / input.ttmEps;
  } else if (input.keyMetricsPe != null && input.keyMetricsPe > 0) {
    peRaw = input.keyMetricsPe;
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
  /** ETF share EPS. Safe to divide into the ETF price. */
  incomeRows: unknown[];
  earningsRows: unknown[];
  /**
   * Index EPS is not in ETF-share dollars. It may supply YoY only.
   * It is never divided into the ETF price.
   */
  indexIncomeRows?: unknown[];
  indexEarningsRows?: unknown[];
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

function preferIncome(income: EpsPrint[], earnings: EpsPrint[]): EpsPrint[] {
  if (income.length >= 8) return income;
  return earnings.length > income.length ? earnings : income;
}

/**
 * Latest-bar valuation. ETF income TTM wins over a current ratio.
 * Today's ratio PE is not applied to an older click.
 * Index EPS never becomes the denominator under the ETF price.
 */
export function valuationFromFmpRows(input: FmpValuationRows): ValuationCore {
  const etfPrints = preferIncome(printsFrom(input.incomeRows, false), printsFrom(input.earningsRows, true));
  const indexPrints = preferIncome(
    printsFrom(input.indexIncomeRows, false),
    printsFrom(input.indexEarningsRows, true),
  );
  const priced = ttmEpsAt(etfPrints, input.asOf);
  const growthSource = etfPrints.length >= 8 ? etfPrints : indexPrints.length >= 8 ? indexPrints : etfPrints;
  const growth = ttmEpsAt(growthSource, input.asOf);
  const ntm = input.allowForward ? ntmEpsFromEstimateRows(input.estimateRows, input.asOf) : null;
  const directPe = input.allowForward
    ? peFromMetricsRow(input.ratiosRow) ?? peFromMetricsRow(input.keyMetricsRow)
    : null;
  const core = valuationFromParts({
    price: input.price,
    ttmEps: priced.ttm,
    prevTtmEps: priced.prevTtm,
    epsNtm: ntm,
    allowForward: input.allowForward,
    keyMetricsPe: directPe,
  });
  const epsYoy = core.epsYoy ?? epsYoyPercent(growth.ttm, growth.prevTtm);
  const peg = core.peg ?? pegFromPeAndGrowth(core.pe, epsYoy);
  if (!input.allowForward) {
    return {
      ...core,
      epsYoy: roundTo(epsYoy, 2),
      peg: roundTo(peg, 2),
      pegExpensive: peg != null && peg > 3,
    };
  }
  const extra = pegFieldsFromMetricsRow(input.ratiosRow);
  const keyExtra = pegFieldsFromMetricsRow(input.keyMetricsRow);
  const pegFilled = peg ?? extra.peg ?? keyExtra.peg;
  const peFwd = core.peFwd ?? extra.peFwd ?? keyExtra.peFwd;
  const gCons = core.gCons;
  const pegFwd = core.pegFwd ?? pegFromPeAndGrowth(peFwd, gCons) ?? extra.pegFwd ?? keyExtra.pegFwd;
  return {
    ...core,
    peFwd: roundTo(peFwd, 2),
    peg: roundTo(pegFilled, 2),
    pegFwd: roundTo(pegFwd, 2),
    epsYoy: roundTo(epsYoy, 2),
    pegExpensive: pegFilled != null && pegFilled > 3,
    pegFwdExpensive: pegFwd != null && pegFwd > 3,
  };
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

export const snapshotSchema = z.object({
  pe: z.number().nullable(),
  peFwd: z.number().nullable(),
  peg: z.number().nullable(),
  pegFwd: z.number().nullable(),
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
  valuationLabel: z.literal("ETF-Proxy"),
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
  valuationLabel: z.literal("ETF-Proxy"),
  pe: z.number().nullable(),
  peFwd: z.number().nullable(),
  peg: z.number().nullable(),
  pegFwd: z.number().nullable(),
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
