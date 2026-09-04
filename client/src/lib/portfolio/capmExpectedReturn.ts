/**
 * CAPM-Sollrendite (SML) für das virtuelle Portfolio.
 *
 * μ_i = r_f + β_i (μ_m − r_f),  μ_p = Σ w_i μ_i
 * β_i = Cov(r_i, r_m) / Var(r_m) auf gemeinsamer Tages-Schnittmenge mit Benchmark.
 *
 * Nicht EngineRow.mu (historisches Mittel). Kein Netzwerk.
 */
import type { PricePoint } from "./covariance";

const TRADING_DAYS = 252;
const MIN_OBS = 60;

export interface CapmNameRow {
  ticker: string;
  beta: number;
  muCapm: number;
  weight: number;
  nObs: number;
}

export interface CapmExpectedReturnResult {
  available: boolean;
  muPortfolio: number | null;
  muMarket: number | null;
  rf: number;
  benchmark: string;
  nTickersUsed: number;
  rows: CapmNameRow[];
  flags: string[];
}

function simpleReturns(prices: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) out.push(prices[i] / prices[i - 1] - 1);
  }
  return out;
}

function alignPair(
  a: PricePoint[],
  b: PricePoint[],
): { ra: number[]; rb: number[] } {
  const mb = new Map(b.map(p => [p.date, p.close]));
  const pa: number[] = [];
  const pb: number[] = [];
  for (const p of a) {
    const cb = mb.get(p.date);
    if (cb == null || !(p.close > 0) || !(cb > 0)) continue;
    pa.push(p.close);
    pb.push(cb);
  }
  return { ra: simpleReturns(pa), rb: simpleReturns(pb) };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function cov(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (n - 1);
}

export function computeCapmExpectedReturn(opts: {
  tickers: string[];
  weightsByTicker?: Record<string, number | null | undefined>;
  historicalPricesByTicker: Record<string, PricePoint[] | undefined>;
  benchmarkTicker: string;
  benchmarkPrices: PricePoint[] | undefined;
  rfAnnual: number;
}): CapmExpectedReturnResult {
  const flags: string[] = [];
  const bench = (opts.benchmarkTicker || "SPY").trim().toUpperCase();
  const rf = Number.isFinite(opts.rfAnnual) ? opts.rfAnnual : 0;
  const benchSeries = (opts.benchmarkPrices ?? [])
    .filter(p => Number.isFinite(p.close) && p.close > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  if (opts.tickers.length === 0) {
    return { available: false, muPortfolio: null, muMarket: null, rf, benchmark: bench, nTickersUsed: 0, rows: [], flags: ["Keine offenen Positionen."] };
  }
  if (benchSeries.length < MIN_OBS + 1) {
    return {
      available: false, muPortfolio: null, muMarket: null, rf, benchmark: bench, nTickersUsed: 0, rows: [],
      flags: [`Benchmark ${bench}: zu wenig Historie (${benchSeries.length} < ${MIN_OBS + 1} Preise).`],
    };
  }

  const benchRetAll = simpleReturns(benchSeries.map(p => p.close));
  const muMarket = mean(benchRetAll) * TRADING_DAYS;

  const rows: CapmNameRow[] = [];
  for (const raw of opts.tickers) {
    const ticker = raw.trim().toUpperCase();
    if (!ticker || ticker === bench) continue;
    const series = (opts.historicalPricesByTicker[ticker] ?? [])
      .filter(p => Number.isFinite(p.close) && p.close > 0)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    const { ra, rb } = alignPair(series, benchSeries);
    if (ra.length < MIN_OBS) {
      flags.push(`${ticker}: <${MIN_OBS} gemeinsame Tage mit ${bench} — kein β.`);
      continue;
    }
    const vM = cov(rb, rb);
    if (!(vM > 0)) {
      flags.push(`${ticker}: Var(r_m)=0 — kein β.`);
      continue;
    }
    const beta = cov(ra, rb) / vM;
    const muCapm = rf + beta * (muMarket - rf);
    rows.push({ ticker, beta, muCapm, weight: 0, nObs: ra.length });
  }

  if (rows.length === 0) {
    return { available: false, muPortfolio: null, muMarket, rf, benchmark: bench, nTickersUsed: 0, rows: [], flags };
  }

  const rawW = rows.map(r => {
    const w = opts.weightsByTicker?.[r.ticker];
    return w != null && Number.isFinite(w) && w > 0 ? w : 0;
  });
  const sumW = rawW.reduce((s, w) => s + w, 0);
  if (sumW > 0) {
    rows.forEach((r, i) => { r.weight = rawW[i] / sumW; });
  } else {
    const eq = 1 / rows.length;
    rows.forEach(r => { r.weight = eq; });
    flags.push("Keine Marktwerte — Equal-Weight auf Titel mit β.");
  }

  const muPortfolio = rows.reduce((s, r) => s + r.weight * r.muCapm, 0);
  return { available: true, muPortfolio, muMarket, rf, benchmark: bench, nTickersUsed: rows.length, rows, flags };
}
