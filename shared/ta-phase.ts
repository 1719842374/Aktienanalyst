/**
 * Phasenfarbe der Kurslinie in Sektion 12.
 *
 * Dieselbe Vier-Bedingungen-Ampel wie der Kopf (Kurs > MA200, MA50 > MA200,
 * MACD > 0, MACD steigend) und wie technicalSignal in shared/conflict-matrix.ts
 * („Same four conditions as the TA Ampel“):
 *   4/4 buySignal → ATTRAKTIV
 *   2/4 und 3/4   → NEUTRAL
 *   0/4 und 1/4   → VORSICHTIG
 * Fehlende Messgröße an einem Tag → keine Farbe, nicht rot.
 *
 * Death-Cross-Override ist evaluateTechMoatOverride (shared/bias-fixes.ts),
 * dieselbe Funktion wie im Fazit: aktiv stuft ATTRAKTIV auf NEUTRAL ab.
 * Das RSL-Perzentil steckt in diesem Override (Deckelhöhe); die Schwelle
 * RSL < 105 bleibt TECH_MOAT_RSL_THRESHOLD. Kein zweites Ampel-Skript.
 */
import { technicalSignal } from "./conflict-matrix";
import {
  evaluateTechMoatOverride,
  ruleMoatFromAnalysis,
  TECH_MOAT_RSL_WINDOW,
  type RuleMoat,
} from "./bias-fixes";
import { calculateRSL } from "./valuation-signal";
import type { StockAnalysis, TechnicalStatus } from "./schema";

export type TaPhase = "ATTRAKTIV" | "NEUTRAL" | "VORSICHTIG";

export type TaFlags = {
  priceAboveMA200: boolean;
  ma50AboveMA200: boolean;
  macdAboveZero: boolean;
  macdRising: boolean;
};

/** Gleiche Striche wie die bestehende TA-Ampel (grün / gelb / rot). */
export const TA_PHASE_STROKE: Record<TaPhase, string> = {
  ATTRAKTIV: "#22c55e",
  NEUTRAL: "#eab308",
  VORSICHTIG: "#ef4444",
};

/** Badge-Farben wie die Fazit-Ampel (text-emerald / amber / red). */
export const TA_PHASE_BADGE: Record<TaPhase, string> = {
  ATTRAKTIV: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
  NEUTRAL: "border-amber-400/50 bg-amber-500/15 text-amber-400",
  VORSICHTIG: "border-red-500/40 bg-red-500/15 text-red-400",
};

export type TaMoatInput = {
  rule: Pick<RuleMoat, "rating" | "score">;
  llmMoatRating: string | null;
};

export interface ChartAmpel {
  phase: TaPhase | null;
  buyScore: number | null;
  overrideActive: boolean;
  rsl: number | null;
  rslPercentile: number | null;
  detail: string | null;
  contradictsHeader: boolean;
  moat: TaMoatInput | null;
}

export interface PhaseBar {
  date: string;
  close: number;
  ma200?: number;
  ma50?: number;
  macd?: number;
}

export interface PhasePaint {
  _phase: TaPhase | null;
  _phA: number | null;
  _phN: number | null;
  _phV: number | null;
  _phBase: number | null;
}

export function phaseFromTechnical(status: TaFlags | null, deathCrossOverrideActive: boolean): TaPhase | null {
  if (!status) return null;
  const judged = technicalSignal(status);
  if (judged.signal === "n/a" || judged.score == null) return null;
  const buySignal = status.priceAboveMA200 && status.ma50AboveMA200 && status.macdAboveZero && status.macdRising;
  let phase: TaPhase = buySignal ? "ATTRAKTIV" : judged.signal === "negativ" ? "VORSICHTIG" : "NEUTRAL";
  if (phase === "ATTRAKTIV" && deathCrossOverrideActive) phase = "NEUTRAL";
  return phase;
}

/**
 * Widerspruch zum Kopf nur bei gegensätzlicher Polung.
 * 3/4 „fast kaufbereit“ ist NEUTRAL, nicht ATTRAKTIV.
 * 2/4 „neutrales Umfeld“ ist NEUTRAL.
 * 0/4 und 1/4 sind VORSICHTIG.
 */
export function headerContradicts(buyScore: number | null, phase: TaPhase | null): boolean {
  if (buyScore == null || phase == null) return false;
  if (phase === "ATTRAKTIV") return buyScore !== 4;
  if (phase === "VORSICHTIG") return buyScore >= 2;
  return buyScore <= 1 || buyScore >= 4;
}

export function buyScoreFromFlags(status: TaFlags): number {
  return [status.priceAboveMA200, status.ma50AboveMA200, status.macdAboveZero, status.macdRising].filter(Boolean).length;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function flagsFromBar(
  point: { close: number; ma200?: number; ma50?: number; macd?: number },
  prevMacd: number | null,
): TaFlags | null {
  if (!finiteNumber(point.close) || !finiteNumber(point.ma200) || !finiteNumber(point.ma50) || !finiteNumber(point.macd)) return null;
  if (prevMacd == null || !Number.isFinite(prevMacd)) return null;
  return {
    priceAboveMA200: point.close > point.ma200,
    ma50AboveMA200: point.ma50 > point.ma200,
    macdAboveZero: point.macd > 0,
    macdRising: point.macd > prevMacd,
  };
}

function rslAt(closes: readonly number[], index: number): number | null {
  if (index + 1 < TECH_MOAT_RSL_WINDOW) return null;
  const window = closes.slice(index + 1 - TECH_MOAT_RSL_WINDOW, index + 1);
  return calculateRSL(closes[index], window);
}

/** Override-Schalter. Historie leer: Perzentil bleibt leer, active hängt nicht daran. */
export function overrideActiveFor(flags: TaFlags, rsl: number | null, moat: TaMoatInput | null): boolean {
  if (!moat) return false;
  return evaluateTechMoatOverride({
    ma50AboveMA200: flags.ma50AboveMA200,
    rsl,
    historicalPrices: [],
    ruleMoat: moat.rule,
    llmMoatRating: moat.llmMoatRating,
  }).active;
}

export function taMoatInput(data: StockAnalysis): TaMoatInput | null {
  try {
    const rule = ruleMoatFromAnalysis(data);
    return {
      rule: { rating: rule.rating, score: rule.score },
      llmMoatRating: data.moatAssessment?.overallRating ?? data.moatRating ?? null,
    };
  } catch {
    return null;
  }
}

/** Badge heute: currentStatus des Kopfes plus evaluateTechMoatOverride auf der vollen Historie. */
export function chartAmpelFromAnalysis(data: StockAnalysis): ChartAmpel {
  const status: TechnicalStatus | null = data.technicalIndicators?.currentStatus ?? null;
  const moat = taMoatInput(data);
  let overrideActive = false;
  let rsl: number | null = null;
  let rslPercentile: number | null = null;
  let detail: string | null = null;
  if (status && moat) {
    try {
      const prices = Array.isArray(data.historicalPrices) ? data.historicalPrices : [];
      const slice = [...prices]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, TECH_MOAT_RSL_WINDOW)
        .map(p => p.close);
      const price = finiteNumber(data.currentPrice) ? data.currentPrice : Number.NaN;
      const snapshotRsl = calculateRSL(price, slice);
      const ov = evaluateTechMoatOverride({
        ma50AboveMA200: status.ma50AboveMA200,
        rsl: snapshotRsl,
        historicalPrices: prices,
        ruleMoat: moat.rule,
        llmMoatRating: moat.llmMoatRating,
      });
      overrideActive = ov.active;
      rsl = ov.rsl;
      rslPercentile = ov.rslPercentile;
      detail = ov.detail;
    } catch {
      overrideActive = false;
    }
  }
  const phase = status ? phaseFromTechnical(status, overrideActive) : null;
  const buyScore = status ? buyScoreFromFlags(status) : null;
  return {
    phase,
    buyScore,
    overrideActive,
    rsl,
    rslPercentile,
    detail,
    contradictsHeader: headerContradicts(buyScore, phase),
    moat,
  };
}

/** Jeder Handelstag: dieselben Flags, dasselbe RSL-Fenster, derselbe Override-Schalter. */
export function phasesByDate(points: readonly PhaseBar[], moat: TaMoatInput | null): Map<string, TaPhase | null> {
  const closes: number[] = [];
  const out = new Map<string, TaPhase | null>();
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    closes.push(point.close);
    const prev = i > 0 ? points[i - 1].macd : undefined;
    const prevMacd = finiteNumber(prev) ? prev : null;
    const flags = flagsFromBar(point, prevMacd);
    const phase = flags
      ? phaseFromTechnical(flags, overrideActiveFor(flags, rslAt(closes, i), moat))
      : null;
    out.set(point.date, phase);
  }
  return out;
}

/**
 * Segmentweise Close-Felder. Am Farbwechsel tragen beide Farben den Punkt,
 * damit die Linie nicht reißt. Tage ohne Phase bleiben in der Basisfarbe.
 */
export function paintPhaseRows<T extends { date: string; close: number | null }>(
  rows: readonly T[],
  phases: ReadonlyMap<string, TaPhase | null>,
): Array<T & PhasePaint> {
  return rows.map((row, i) => {
    const close = row.close;
    const finite = finiteNumber(close);
    const phase = finite ? (phases.get(row.date) ?? null) : null;
    const prev = i > 0 ? rows[i - 1] : null;
    const prevFinite = prev != null && finiteNumber(prev.close);
    const prevPhase = prevFinite ? (phases.get(prev.date) ?? null) : null;
    const seam = (p: TaPhase) => finite && (phase === p || (phase != null && prevPhase === p));
    return {
      ...row,
      _phase: phase,
      _phA: seam("ATTRAKTIV") ? close : null,
      _phN: seam("NEUTRAL") ? close : null,
      _phV: seam("VORSICHTIG") ? close : null,
      _phBase: finite && (phase == null || prevPhase == null) ? close : null,
    };
  });
}
