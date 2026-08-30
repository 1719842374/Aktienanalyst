/**
 * server/sector-rotation-math.ts — C1 P0 map/zscore/metrics/scores
 */
import type { DailyBar } from "./history-fallback";

export type CyclePhase = "Frühzyklus" | "Hochkonjunktur" | "Spätkonjunktur" | "Abschwung";
export type ValuationLabel = "Teuer" | "Angemessen" | "Attraktiv";
export const VALUATION_FALLBACK = "n.v." as const;
export type ValuationLabelOrFallback = ValuationLabel | typeof VALUATION_FALLBACK;

export interface EtfProxy {
  id: string;
  label: string;
  etf: string;
  sectorDefaultKey: string;
}

export const ETF_PROXY_MAP: readonly EtfProxy[] = [
  { id: "technology",     label: "Technologie",           etf: "XLK", sectorDefaultKey: "Technology" },
  { id: "communication",  label: "Kommunikationsdienste", etf: "XLC", sectorDefaultKey: "Communication Services" },
  { id: "discretionary",  label: "Konsumzyklik",          etf: "XLY", sectorDefaultKey: "Consumer Cyclical" },
  { id: "industrials",    label: "Industrie",             etf: "XLI", sectorDefaultKey: "Industrials" },
  { id: "financials",     label: "Finanzen",              etf: "XLF", sectorDefaultKey: "Financials" },
  { id: "energy",         label: "Energie",               etf: "XLE", sectorDefaultKey: "Energy" },
  { id: "healthcare",     label: "Gesundheitswesen",      etf: "XLV", sectorDefaultKey: "Healthcare" },
  { id: "staples",        label: "Konsumdefensiv",        etf: "XLP", sectorDefaultKey: "Consumer Staples" },
  { id: "utilities",      label: "Versorger",             etf: "XLU", sectorDefaultKey: "Utilities" },
];

export const PHASE_PREFERRED: Record<CyclePhase, readonly string[]> = {
  Frühzyklus:     ["Industrie", "Technologie", "Konsumzyklik"],
  Hochkonjunktur: ["Technologie", "Kommunikationsdienste", "Finanzen"],
  Spätkonjunktur: ["Gesundheitswesen", "Konsumdefensiv", "Energie"],
  Abschwung:      ["Gesundheitswesen", "Versorger", "Konsumdefensiv"],
};

export const SPX_PROXY_ETF = "SPY";
export const SECTOR_ROTATION_CACHE_TAB = "sector-rotation";

export function clamp(x: number, lo: number, hi: number): number {
  if (!isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Sample-zscore (n-1). Non-finite → 0. n<2 or sd=0 → all 0. */
export function zscore(values: Array<number | null | undefined>): number[] {
  const finite = values.filter((v): v is number => typeof v === "number" && isFinite(v));
  if (finite.length < 2) return values.map(() => 0);
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
  const variance = finite.reduce((s, v) => s + (v - mean) ** 2, 0) / (finite.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return values.map(() => 0);
  return values.map(v => (typeof v === "number" && isFinite(v) ? (v - mean) / sd : 0));
}

/** Mid-rank percentile: (#{v < x} + 0.5 * #{v === x}) / n. Empty → 0.5. */
export function percentileRank(value: number, population: Array<number | null | undefined>): number {
  const finite = population.filter((v): v is number => typeof v === "number" && isFinite(v));
  if (finite.length === 0 || !isFinite(value)) return 0.5;
  const less = finite.filter(v => v < value).length;
  const equal = finite.filter(v => v === value).length;
  return (less + 0.5 * equal) / finite.length;
}

export function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function stdevSample(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function covarianceSample(xs: number[], ys: number[]): number | null {
  if (xs.length < 2 || xs.length !== ys.length) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += (xs[i] - mx) * (ys[i] - my);
  return s / (xs.length - 1);
}

export interface SectorPriceMetrics {
  vol60d: number | null;
  betaSpx: number | null;
  maxDd12m: number | null;
  return6M: number | null;
  lastDate: string | null;
}

function closesOf(bars: DailyBar[]): { date: string; close: number }[] {
  return bars
    .filter(b => typeof b.close === "number" && isFinite(b.close) && b.close > 0 && typeof b.date === "string")
    .map(b => ({ date: b.date, close: b.close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev > 0) out.push(closes[i] / prev - 1);
  }
  return out;
}

function maxDrawdownAbs(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0];
  let maxDd = 0;
  for (const c of closes) {
    if (c > peak) peak = c;
    if (peak > 0) {
      const dd = (peak - c) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

export function metricsFromBars(sectorBars: DailyBar[], spxBars: DailyBar[]): SectorPriceMetrics {
  const sector = closesOf(sectorBars);
  const spx = closesOf(spxBars);
  const empty: SectorPriceMetrics = { vol60d: null, betaSpx: null, maxDd12m: null, return6M: null, lastDate: null };
  if (sector.length < 5) return empty;

  const sectorCloses = sector.map(s => s.close);
  const lastDate = sector[sector.length - 1].date;

  const volWindow = sectorCloses.slice(-61);
  const vol60d = volWindow.length >= 21 ? stdevSample(dailyReturns(volWindow)) : stdevSample(dailyReturns(sectorCloses));

  const ddWindow = sectorCloses.slice(-252);
  const maxDd12m = maxDrawdownAbs(ddWindow.length >= 20 ? ddWindow : sectorCloses);

  const lookback6m = Math.min(126, sectorCloses.length - 1);
  const start6 = sectorCloses[sectorCloses.length - 1 - lookback6m];
  const end6 = sectorCloses[sectorCloses.length - 1];
  const return6M = start6 > 0 ? end6 / start6 - 1 : null;

  let betaSpx: number | null = null;
  if (spx.length >= 21) {
    const spxByDate = new Map(spx.map(s => [s.date, s.close]));
    const alignedS: number[] = [];
    const alignedM: number[] = [];
    for (let i = 1; i < sector.length; i++) {
      const d0 = sector[i - 1].date;
      const d1 = sector[i].date;
      const m0 = spxByDate.get(d0);
      const m1 = spxByDate.get(d1);
      if (m0 && m1 && m0 > 0 && sector[i - 1].close > 0) {
        alignedS.push(sector[i].close / sector[i - 1].close - 1);
        alignedM.push(m1 / m0 - 1);
      }
    }
    const n = Math.min(60, alignedS.length);
    if (n >= 20) {
      const s = alignedS.slice(-n);
      const m = alignedM.slice(-n);
      const cov = covarianceSample(s, m);
      const varM = covarianceSample(m, m);
      if (cov != null && varM != null && varM > 0) betaSpx = cov / varM;
    }
  }

  return { vol60d, betaSpx, maxDd12m, return6M, lastDate };
}

export function valuationFromPe(pe: number | null, pe10y: number | null): {
  label: ValuationLabelOrFallback;
  peRatio: number | null;
  hasPe10y: boolean;
} {
  if (pe == null || !isFinite(pe) || pe <= 0 || pe10y == null || !isFinite(pe10y) || pe10y <= 0) {
    return { label: VALUATION_FALLBACK, peRatio: null, hasPe10y: false };
  }
  const peRatio = pe / pe10y;
  if (peRatio > 1.15) return { label: "Teuer", peRatio, hasPe10y: true };
  if (peRatio < 0.90) return { label: "Attraktiv", peRatio, hasPe10y: true };
  return { label: "Angemessen", peRatio, hasPe10y: true };
}

export function valueScore(peRatio: number | null): number {
  const ratio = peRatio != null && isFinite(peRatio) ? peRatio : 1;
  return 5 - 4 * clamp((ratio - 0.7) / 0.8, 0, 1);
}

export function phaseFitScore(label: string, phase: CyclePhase): number {
  return PHASE_PREFERRED[phase].includes(label) ? 5 : 1;
}

export function riskFromZ(volZ: number, betaZ: number, ddZ: number): number {
  const riskRaw = 0.40 * volZ + 0.35 * betaZ + 0.25 * ddZ;
  return clamp(Math.round(3 + riskRaw), 1, 5);
}

export function attractivenessScore(valScore: number, momScore: number, phaseFit: number): number {
  return round1(0.40 * valScore + 0.30 * momScore + 0.30 * phaseFit);
}
