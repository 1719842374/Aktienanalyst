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

export function finraLeverage(pointsAsc: MarginPoint[]): LeverageStrip | null {
  if (pointsAsc.length < 13) return null;
  const levels = pointsAsc.map((p) => p.debitMillions);
  const raw = marginYoYAndZ(levels);
  const last = pointsAsc[pointsAsc.length - 1];
  const billions = roundTo(last.debitMillions / 1000, 3);
  if (billions == null) return null;
  return {
    seriesId: "FINRA_MARGIN_DEBIT",
    unit: "Mrd. $",
    asOf: last.date.slice(0, 7),
    billions,
    yoyPct: roundTo(raw.yoyPct, 2),
    z5y: roundTo(raw.z5y, 2),
    high: raw.z5y != null && raw.z5y > 1,
    points: pointsAsc.slice(-60).map((p) => ({
      date: p.date.slice(0, 7),
      billions: roundTo(p.debitMillions / 1000, 3) ?? 0,
    })),
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
