/**
 * server/sector-rotation.ts — Sprint C1 P0 (WORK_SEKTORROTATIONS_RAT.md)
 */
import type { DailyBar } from "./history-fallback";
import type { RecessionAnalysis } from "./recession";

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

function mean(xs: number[]): number {
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

export type RecessionLike = Pick<RecessionAnalysis, "indicators" | "subgroups" | "nyFedValue" | "interpretation">
  | {
      indicators?: Array<{ name: string; zone?: string; rawScore?: number; weightedScore?: number }>;
      subgroups?: Array<{ name: string; probability?: number }>;
      nyFedValue?: number | null;
      interpretation?: string;
    };

function subgroupProb(rec: RecessionLike, name: string): number | null {
  const sg = rec.subgroups?.find(s => s.name === name);
  const p = sg && typeof (sg as { probability?: number }).probability === "number"
    ? (sg as { probability: number }).probability
    : null;
  return p != null && isFinite(p) ? p : null;
}

function indicatorZone(rec: RecessionLike, namePart: string): string {
  const ind = rec.indicators?.find(i => i.name.includes(namePart));
  return ind?.zone ?? "";
}

function zoneLooks(zone: string, re: RegExp): boolean {
  return re.test(zone);
}

/**
 * Mappt Recession-Dashboard → Zyklusphase (WORK §2.4). Kein hardcodierter String.
 * Fehlende Subgroups → Spätkonjunktur mit niedriger Konfidenz.
 */
export function mapPhaseFromRecession(rec: RecessionLike): { phase: CyclePhase; phaseConfidence: number } {
  const p3 = subgroupProb(rec, "recession_coincident");
  const p6 = subgroupProb(rec, "recession_leading");
  const p12 = subgroupProb(rec, "recession_full");
  const pSent = subgroupProb(rec, "correction_sentiment");

  const sahmTriggered = zoneLooks(indicatorZone(rec, "Sahm"), /ausgel[oö]st/i);
  const yieldInverted = zoneLooks(indicatorZone(rec, "Zinskurve"), /invertiert/i);
  const creditStress = zoneLooks(indicatorZone(rec, "Kreditspreads"), /stress|erh[oö]ht/i);
  const pmiContraction = zoneLooks(indicatorZone(rec, "PMI"), /kontraktion/i);
  const ratesOrStressRising = yieldInverted || creditStress;

  const hasAnyProb = p3 != null || p6 != null || p12 != null;
  if (!hasAnyProb && !sahmTriggered && !pmiContraction) {
    return { phase: "Spätkonjunktur", phaseConfidence: 0.3 };
  }

  const c3 = p3 ?? 50;
  const c6 = p6 ?? 50;
  const c12 = p12 ?? 50;
  const cSent = pSent;

  if (sahmTriggered || pmiContraction || c3 >= 55) {
    const conf = clamp(Math.max(c3, c12) / 100, 0.5, 0.95);
    return { phase: "Abschwung", phaseConfidence: Math.round(conf * 100) / 100 };
  }

  if (c3 < 40 && (c12 >= 45 || (cSent != null && cSent >= 50))) {
    const conf = clamp((Math.max(c12, cSent ?? 0) - c3) / 80 + 0.45, 0.4, 0.85);
    return { phase: "Frühzyklus", phaseConfidence: Math.round(conf * 100) / 100 };
  }

  if (c6 >= c3 + 10 || (ratesOrStressRising && c3 < 55 && c6 >= 40)) {
    const conf = clamp(Math.max(c6, cSent ?? 50) / 100, 0.4, 0.9);
    return { phase: "Spätkonjunktur", phaseConfidence: Math.round(conf * 100) / 100 };
  }

  if (c3 < 40 && c12 < 50) {
    if (ratesOrStressRising) {
      const conf = clamp(0.45 + ((cSent ?? 50) / 200), 0.4, 0.8);
      return { phase: "Spätkonjunktur", phaseConfidence: Math.round(conf * 100) / 100 };
    }
    const conf = clamp(1 - c12 / 100, 0.45, 0.9);
    return { phase: "Hochkonjunktur", phaseConfidence: Math.round(conf * 100) / 100 };
  }

  if (ratesOrStressRising || (cSent != null && cSent >= 50) || c6 >= 50) {
    return { phase: "Spätkonjunktur", phaseConfidence: 0.5 };
  }
  return { phase: "Hochkonjunktur", phaseConfidence: 0.5 };
}

export interface SectorRotationSectorInput {
  id: string;
  vol60d?: number | null;
  betaSpx?: number | null;
  maxDd12m?: number | null;
  pe?: number | null;
  pe10y?: number | null;
  return6M?: number | null;
}

export interface SectorRotationInput {
  asOf?: string;
  recession: RecessionLike;
  sectors: SectorRotationSectorInput[];
}

export interface SectorRotationRow {
  id: string;
  label: string;
  etf: string;
  risk: number;
  valuation: ValuationLabelOrFallback;
  pe: number | null;
  pe10y: number | null;
  attractiveness: number;
  return6M: number | null;
  phaseFit: number;
}

export interface SectorRotationResult {
  asOf: string;
  phase: CyclePhase;
  phaseConfidence: number;
  sectors: SectorRotationRow[];
  recommendations: Record<CyclePhase, string[]>;
  dataQuality: {
    etfCoverage: number;
    pe10yCoverage: number;
    source: "fmp+etf";
  };
}

export function computeSectorRotation(input: SectorRotationInput): SectorRotationResult {
  const { phase, phaseConfidence } = mapPhaseFromRecession(input.recession);
  const byId = new Map(input.sectors.map(s => [s.id, s]));

  const ordered = ETF_PROXY_MAP.map(proxy => {
    const raw = byId.get(proxy.id);
    return {
      proxy,
      vol60d: raw?.vol60d ?? null,
      betaSpx: raw?.betaSpx ?? null,
      maxDd12m: raw?.maxDd12m ?? null,
      pe: raw?.pe ?? null,
      pe10y: raw?.pe10y ?? null,
      return6M: raw?.return6M ?? null,
    };
  });

  const volZ = zscore(ordered.map(s => s.vol60d));
  const betaZ = zscore(ordered.map(s => s.betaSpx));
  const ddZ = zscore(ordered.map(s => s.maxDd12m));
  const returns = ordered.map(s => s.return6M);

  let pe10yCoverage = 0;
  let etfCoverage = 0;

  const sectors: SectorRotationRow[] = ordered.map((s, i) => {
    const risk = riskFromZ(volZ[i], betaZ[i], ddZ[i]);
    const val = valuationFromPe(s.pe, s.pe10y);
    if (val.hasPe10y) pe10yCoverage += 1;
    if (s.vol60d != null || s.return6M != null || s.betaSpx != null || s.maxDd12m != null) etfCoverage += 1;

    const mom = 1 + 4 * percentileRank(s.return6M ?? 0, returns);
    const fit = phaseFitScore(s.proxy.label, phase);
    const attractiveness = attractivenessScore(valueScore(val.peRatio), mom, fit);

    return {
      id: s.proxy.id,
      label: s.proxy.label,
      etf: s.proxy.etf,
      risk,
      valuation: val.label,
      pe: s.pe != null && isFinite(s.pe) ? s.pe : null,
      pe10y: val.hasPe10y ? s.pe10y as number : null,
      attractiveness,
      return6M: s.return6M != null && isFinite(s.return6M) ? s.return6M : null,
      phaseFit: fit,
    };
  });

  const asOf = input.asOf && /^\d{4}-\d{2}-\d{2}/.test(input.asOf)
    ? input.asOf.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return {
    asOf,
    phase,
    phaseConfidence,
    sectors,
    recommendations: {
      Frühzyklus: [...PHASE_PREFERRED.Frühzyklus],
      Hochkonjunktur: [...PHASE_PREFERRED.Hochkonjunktur],
      Spätkonjunktur: [...PHASE_PREFERRED.Spätkonjunktur],
      Abschwung: [...PHASE_PREFERRED.Abschwung],
    },
    dataQuality: { etfCoverage, pe10yCoverage, source: "fmp+etf" },
  };
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (isFinite(n) && n > 0) return n;
  }
  return null;
}

function pickPe(row: Record<string, unknown> | null | undefined): number | null {
  if (!row) return null;
  return numOrNull(row.pe)
    ?? numOrNull(row.peRatio)
    ?? numOrNull(row.peRatioTTM)
    ?? numOrNull(row.priceToEarningsRatio)
    ?? numOrNull(row.priceEarningsRatio)
    ?? numOrNull(row.priceEarningsRatioTTM)
    ?? numOrNull(row.priceToEarnings);
}

/**
 * Live-Orchestrierung. Dynamische Imports, damit Fixture-Tests die Engine
 * ohne FMP/FRED/sector-data laden. sector-data Defaults NUR wenn Live-PE fehlt
 * (zaehlt NICHT als pe10yCoverage).
 */
export async function fetchSectorRotationLive(): Promise<SectorRotationResult> {
  const { altFetchYahooThenStooq, fromDateForTimeframe } = await import("./history-fallback");
  const { fmpRatios, isFmpAvailable } = await import("./fmp");
  const { getSectorDefaults } = await import("./sector-data");
  const { runRecessionAnalysis } = await import("./recession");

  const to = new Date().toISOString().slice(0, 10);
  const from = fromDateForTimeframe("1Y");

  let recession: RecessionLike = { indicators: [], subgroups: [], nyFedValue: null, interpretation: "" };
  try {
    recession = await runRecessionAnalysis();
  } catch (err) {
    console.warn(`[SECTOR-ROTATION] runRecessionAnalysis failed: ${(err as Error)?.message ?? err}`);
  }

  let spxBars: DailyBar[] = [];
  try {
    spxBars = await altFetchYahooThenStooq(SPX_PROXY_ETF, from, to);
  } catch (err) {
    console.warn(`[SECTOR-ROTATION] SPX proxy ${SPX_PROXY_ETF} failed: ${(err as Error)?.message ?? err}`);
  }

  const ohlcv = await Promise.all(ETF_PROXY_MAP.map(async (proxy) => {
    let bars: DailyBar[] = [];
    try {
      bars = await altFetchYahooThenStooq(proxy.etf, from, to);
    } catch (err) {
      console.warn(`[SECTOR-ROTATION] OHLCV ${proxy.etf} failed: ${(err as Error)?.message ?? err}`);
    }
    return { proxy, metrics: metricsFromBars(bars, spxBars) };
  }));

  const fmpOn = isFmpAvailable();
  const PE_BUDGET_MS = 20_000;
  const peStarted = Date.now();

  const perSector = [];
  for (const { proxy, metrics } of ohlcv) {
    let pe: number | null = null;
    let pe10y: number | null = null;

    if (fmpOn && Date.now() - peStarted < PE_BUDGET_MS) {
      try {
        const ratios = await fmpRatios(proxy.etf, 10);
        const rows: Record<string, unknown>[] = Array.isArray(ratios) ? ratios : [];
        const pes = rows.map(r => pickPe(r)).filter((v): v is number => v != null);
        if (pes.length > 0) pe = pes[0];
        if (pes.length >= 5) pe10y = mean(pes);
      } catch { /* live PE optional */ }
    }

    if (pe == null) {
      try {
        const d = getSectorDefaults(proxy.sectorDefaultKey, "");
        pe = numOrNull(d.sectorAvgPE);
      } catch { /* sector-data fallback optional */ }
    }

    perSector.push({
      id: proxy.id,
      vol60d: metrics.vol60d,
      betaSpx: metrics.betaSpx,
      maxDd12m: metrics.maxDd12m,
      pe,
      pe10y,
      return6M: metrics.return6M,
      lastDate: metrics.lastDate,
    });
  }

  const dates = perSector.map(s => s.lastDate).filter((d): d is string => !!d).sort();
  const asOf = dates.length > 0 ? dates[dates.length - 1] : to;

  return computeSectorRotation({ asOf, recession, sectors: perSector });
}
