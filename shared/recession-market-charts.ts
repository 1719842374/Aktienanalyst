/**
 * Contract for GET /api/analyze-recession/markets (no region) and ?date=.
 * Valuation math lives here so the click factpack does not go through the stock PEG scorer.
 * g is a decimal in the formula (0.178); the API exposes g in percent (17.8).
 */

export const MARKET_WINDOWS = ["1Y", "3Y", "5Y", "10Y", "MAX"] as const;
export type MarketWindow = (typeof MARKET_WINDOWS)[number];

export const WINDOW_TRADING_DAYS: Record<Exclude<MarketWindow, "MAX">, number> = {
  "1Y": 252,
  "3Y": 756,
  "5Y": 1260,
  "10Y": 2520,
};

/** MAX window starts at the later of this floor and the series start. */
export const MAX_FLOOR = "1999-01-01";

export const VOL_Y_MAX = 90;
export const VOL_MARK_RADIUS = 20;
export const VOL_MARK_MIN = 35;

export const RECESSION_CHART_MARKETS = [
  {
    id: "spy",
    etf: "SPY",
    volId: "VIXCLS",
    volKind: "implied",
    volSince: "1990",
    label: "US Broad",
    indexName: "S&P 500",
    bandScope: "calibrated",
    leverage: true,
  },
  {
    id: "qqq",
    etf: "QQQ",
    volId: "VXNCLS",
    volKind: "implied",
    volSince: "2001",
    label: "US Growth",
    indexName: "Nasdaq-100",
    bandScope: "calibrated",
    leverage: false,
  },
  {
    id: "vgk",
    etf: "VGK",
    volId: "^V2TX",
    volKind: "implied",
    volSince: "1999",
    label: "Europa",
    indexName: "STOXX Europe 600",
    bandScope: "analog",
    leverage: false,
  },
  {
    id: "ashr",
    etf: "ASHR",
    volId: "realized20",
    volKind: "realized",
    volSince: "2013",
    label: "Asien",
    indexName: "CSI 300 / Shanghai-A",
    bandScope: "analog",
    leverage: false,
  },
] as const;

export type RecessionChartMarketId = (typeof RECESSION_CHART_MARKETS)[number]["id"];
export type VolKind = "implied" | "realized";
export type BandScope = "calibrated" | "analog";

export interface RecessionOhlcvBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  hist: number | null;
}

export interface RecessionVolPoint {
  date: string;
  value: number;
}

export interface RecessionMarketSnapshot {
  pe: number | null;
  peFwd: number | null;
  peg: number | null;
  pegFwd: number | null;
  epsYoy: number | null;
  rsi: number | null;
  macdHist: number | null;
}

export interface RecessionFactpack extends RecessionMarketSnapshot {
  date: string;
  proxy: "ETF-Proxy";
  price: number | null;
  volume: number | null;
  gEps: number | null;
  gCons: number | null;
  epsTtm: number | null;
  epsFwd: number | null;
  macd: number | null;
  signal: number | null;
  pegExpensive: boolean;
  pegFwdExpensive: boolean;
  epsBasis: "ttm-4q" | "annual" | null;
  note: string | null;
}

export interface RecessionLeveragePoint {
  date: string;
  billions: number;
}

export interface RecessionLeverage {
  source: "FINRA";
  unit: "Mrd. $";
  latestBillions: number | null;
  asOf: string | null;
  yoyPercent: number | null;
  z5y: number | null;
  elevated: boolean;
  series: RecessionLeveragePoint[];
}

export interface RecessionChartMarket {
  id: RecessionChartMarketId;
  label: string;
  indexName: string;
  etf: string;
  volId: string;
  volKind: VolKind;
  volSince: string;
  bandScope: BandScope;
  ohlcv: RecessionOhlcvBar[];
  vol: RecessionVolPoint[];
  volMarks: RecessionVolPoint[];
  volYMax: typeof VOL_Y_MAX;
  volLatest: number | null;
  volBand: string;
  volNote: string | null;
  snapshot: RecessionMarketSnapshot;
  leverage: RecessionLeverage | null;
  leverageNote: string | null;
}

export interface RecessionMarketsResponse {
  asOf: string | null;
  window: MarketWindow;
  markets: RecessionChartMarket[];
}

export interface RecessionFactpackResponse {
  asOf: string | null;
  window: MarketWindow;
  id: RecessionChartMarketId;
  etf: string;
  date: string;
  factpack: RecessionFactpack;
}

export function normalizeMarketWindow(raw: string): MarketWindow {
  const w = raw.toUpperCase();
  return (MARKET_WINDOWS as readonly string[]).includes(w) ? (w as MarketWindow) : "5Y";
}

export function chartMarketById(idOrEtf: string): (typeof RECESSION_CHART_MARKETS)[number] | null {
  const key = idOrEtf.trim().toLowerCase();
  return RECESSION_CHART_MARKETS.find(m => m.id === key || m.etf.toLowerCase() === key) ?? null;
}

export function sliceTradingWindow<T extends { date: string }>(rows: T[], window: MarketWindow): T[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return [];
  if (window === "MAX") {
    const seriesStart = sorted[0].date;
    const start = seriesStart > MAX_FLOOR ? seriesStart : MAX_FLOOR;
    return sorted.filter(r => r.date >= start);
  }
  return sorted.slice(-WINDOW_TRADING_DAYS[window]);
}

/** V_t = max(V_{t-radius ... t+radius}) and V > threshold. One mark per plateau. */
export function localVolMaxima(
  vol: RecessionVolPoint[],
  radius = VOL_MARK_RADIUS,
  threshold = VOL_MARK_MIN,
): RecessionVolPoint[] {
  const out: RecessionVolPoint[] = [];
  for (let i = 0; i < vol.length; i++) {
    const v = vol[i].value;
    if (!(v > threshold)) continue;
    const lo = Math.max(0, i - radius);
    const hi = Math.min(vol.length - 1, i + radius);
    let max = -Infinity;
    for (let j = lo; j <= hi; j++) if (vol[j].value > max) max = vol[j].value;
    if (v !== max) continue;
    if (i > lo && vol[i - 1].value === v) continue;
    out.push(vol[i]);
  }
  return out;
}

/** 20-session realized vol, annualized percent. */
export function realizedVol20(closes: { date: string; close: number }[]): RecessionVolPoint[] {
  const out: RecessionVolPoint[] = [];
  for (let i = 20; i < closes.length; i++) {
    const rets: number[] = [];
    for (let j = i - 19; j <= i; j++) {
      const a = closes[j - 1]?.close;
      const b = closes[j]?.close;
      if (!(a > 0) || !(b > 0)) continue;
      rets.push(Math.log(b / a));
    }
    if (rets.length < 15) continue;
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    const var_ = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
    const ann = Math.sqrt(Math.max(0, var_) * 252) * 100;
    if (Number.isFinite(ann)) out.push({ date: closes[i].date, value: ann });
  }
  return out;
}

/**
 * PEG = PE / (gDecimal * 100). gDecimal 0.178 → denominator 17.8.
 * n/a when PE or g is not strictly positive.
 */
export function pegFromDecimalGrowth(pe: number | null, gDecimal: number | null): number | null {
  if (pe == null || gDecimal == null) return null;
  if (!Number.isFinite(pe) || !Number.isFinite(gDecimal)) return null;
  if (!(pe > 0) || !(gDecimal > 0)) return null;
  const denom = gDecimal * 100;
  if (!(denom > 0)) return null;
  return pe / denom;
}

export interface EpsPrint {
  date: string;
  eps: number;
}

export interface FactpackMathInput {
  date: string;
  price: number | null;
  volume: number | null;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  macdHist: number | null;
  quarters: EpsPrint[];
  annual: EpsPrint[];
  estimates: EpsPrint[];
}

function roundTo(n: number | null, digits: number): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function sumEps(rows: EpsPrint[]): number {
  return rows.reduce((s, r) => s + r.eps, 0);
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

function pickForwardEps(estimates: EpsPrint[], asOf: string): number | null {
  const future = estimates
    .filter(e => e.date > asOf && e.eps > 0 && Number.isFinite(e.eps))
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = future[0];
  if (!next) return null;
  if (monthsBetween(asOf, next.date) > 18) return null;
  return next.eps;
}

export function buildEtfFactpack(input: FactpackMathInput): RecessionFactpack {
  const quarters = input.quarters
    .filter(q => q.date <= input.date && Number.isFinite(q.eps))
    .sort((a, b) => a.date.localeCompare(b.date));
  const annual = input.annual
    .filter(q => q.date <= input.date && Number.isFinite(q.eps))
    .sort((a, b) => a.date.localeCompare(b.date));

  let epsTtm: number | null = null;
  let gDecimal: number | null = null;
  let epsBasis: RecessionFactpack["epsBasis"] = null;
  const notes: string[] = [];

  if (quarters.length >= 4) {
    epsTtm = sumEps(quarters.slice(-4));
    epsBasis = "ttm-4q";
    if (quarters.length >= 8) {
      const prev = sumEps(quarters.slice(-8, -4));
      gDecimal = prev > 0 ? (epsTtm - prev) / prev : null;
    } else if (quarters.length >= 5) {
      const prevQ = quarters[quarters.length - 5].eps;
      const lastQ = quarters[quarters.length - 1].eps;
      gDecimal = prevQ > 0 ? (lastQ - prevQ) / prevQ : null;
    }
  } else if (annual.length >= 1) {
    epsTtm = annual[annual.length - 1].eps;
    epsBasis = "annual";
    notes.push("EPS aus Jahres-key-metrics, nicht aus vier Quartalen.");
    if (annual.length >= 2) {
      const prev = annual[annual.length - 2].eps;
      gDecimal = prev > 0 ? (epsTtm - prev) / prev : null;
    }
  }

  const price = input.price != null && input.price > 0 ? input.price : null;
  const pe = price != null && epsTtm != null && epsTtm > 0 ? price / epsTtm : null;
  const epsFwd = pickForwardEps(input.estimates, input.date);
  if (input.estimates.length > 0 && epsFwd == null) {
    notes.push("Kein Punkt-in-Time-Konsens für dieses Datum — Forward n/a.");
  }
  const peFwd = price != null && epsFwd != null && epsFwd > 0 ? price / epsFwd : null;
  const gCons = epsTtm != null && epsTtm > 0 && epsFwd != null && epsFwd > 0 ? (epsFwd / epsTtm) - 1 : null;
  const peg = pegFromDecimalGrowth(pe, gDecimal);
  const pegFwd = pegFromDecimalGrowth(peFwd, gCons);

  return {
    date: input.date,
    proxy: "ETF-Proxy",
    price: roundTo(price, 2),
    volume: input.volume,
    pe: roundTo(pe, 2),
    peFwd: roundTo(peFwd, 2),
    peg: roundTo(peg, 2),
    pegFwd: roundTo(pegFwd, 2),
    epsYoy: roundTo(gDecimal == null ? null : gDecimal * 100, 1),
    gEps: roundTo(gDecimal == null ? null : gDecimal * 100, 1),
    gCons: roundTo(gCons == null ? null : gCons * 100, 1),
    epsTtm: roundTo(epsTtm, 4),
    epsFwd: roundTo(epsFwd, 4),
    rsi: roundTo(input.rsi, 1),
    macd: roundTo(input.macd, 4),
    signal: roundTo(input.signal, 4),
    macdHist: roundTo(input.macdHist, 4),
    pegExpensive: peg != null && peg > 3 && gDecimal != null && gDecimal > 0,
    pegFwdExpensive: pegFwd != null && pegFwd > 3 && gCons != null && gCons > 0,
    epsBasis,
    note: notes.length ? notes.join(" ") : null,
  };
}

export function snapshotFromFactpack(f: RecessionFactpack): RecessionMarketSnapshot {
  return {
    pe: f.pe,
    peFwd: f.peFwd,
    peg: f.peg,
    pegFwd: f.pegFwd,
    epsYoy: f.epsYoy,
    rsi: f.rsi,
    macdHist: f.macdHist,
  };
}

export interface MarginDebitPoint {
  date: string;
  millions: number;
}

export interface LeverageStats {
  latestBillions: number | null;
  asOf: string | null;
  yoyPercent: number | null;
  z5y: number | null;
  elevated: boolean;
}

/** YoY of FINRA debit and z of that YoY versus the trailing 60 months. */
export function leverageStats(points: MarginDebitPoint[]): LeverageStats {
  const sorted = [...points]
    .filter(p => Number.isFinite(p.millions) && p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const byMonth = new Map(sorted.map(p => [p.date.slice(0, 7), p.millions]));
  const yoys: { yoy: number }[] = [];
  for (const p of sorted) {
    const [y, m] = p.date.slice(0, 7).split("-");
    const prev = byMonth.get(`${Number(y) - 1}-${m}`);
    if (prev == null || !(prev > 0)) continue;
    yoys.push({ yoy: p.millions / prev - 1 });
  }
  const latest = yoys[yoys.length - 1];
  const window = yoys.slice(-60);
  let z: number | null = null;
  if (latest && window.length >= 12) {
    const mean = window.reduce((s, x) => s + x.yoy, 0) / window.length;
    const variance = window.reduce((s, x) => s + (x.yoy - mean) ** 2, 0) / (window.length - 1);
    const sd = Math.sqrt(Math.max(0, variance));
    z = sd > 0 ? (latest.yoy - mean) / sd : null;
  }
  const last = sorted[sorted.length - 1];
  return {
    latestBillions: last ? last.millions / 1000 : null,
    asOf: last ? last.date.slice(0, 7) : null,
    yoyPercent: latest ? latest.yoy * 100 : null,
    z5y: z,
    elevated: z != null && z > 1,
  };
}

/** FINRA margin-statistics.xlsx sheet XML: column A is YYYY-MM, column B is debit in millions. */
export function parseFinraMarginSheetXml(xml: string): MarginDebitPoint[] {
  const rows: MarginDebitPoint[] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(xml))) {
    const row = match[1];
    const month = row.match(/<c r="A\d+"[^>]*>[\s\S]*?<t>(\d{4}-\d{2})<\/t>/);
    const debit = row.match(/<c r="B\d+"[^>]*>[\s\S]*?<v>([0-9.]+)<\/v>/);
    if (!month || !debit) continue;
    const millions = Number(debit[1]);
    if (!Number.isFinite(millions)) continue;
    rows.push({ date: `${month[1]}-01`, millions });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

export function sliceLeverageSeries(
  points: MarginDebitPoint[],
  windowStart: string | null,
): RecessionLeveragePoint[] {
  return points
    .filter(p => !windowStart || p.date >= windowStart)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(p => ({ date: p.date, billions: p.millions / 1000 }));
}
