/**
 * server/sector-rotation-score.ts — C1 P0 phase + computeSectorRotation
 */
import type { RecessionAnalysis } from "./recession";
import {
  ETF_PROXY_MAP,
  PHASE_PREFERRED,
  VALUATION_FALLBACK,
  clamp,
  zscore,
  percentileRank,
  valuationFromPe,
  valueScore,
  phaseFitScore,
  riskFromZ,
  attractivenessScore,
  type CyclePhase,
  type ValuationLabelOrFallback,
} from "./sector-rotation-math";

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
  const cSent = pSent; // missing sentiment must NOT look like elevated stress

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
