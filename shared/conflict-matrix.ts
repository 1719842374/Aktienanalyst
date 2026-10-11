/**
 * Future_Work §8 "Fazit-Sektion als Konfliktmatrix": a vector of five dimensions with an explicit
 * divergence flag. Display only. Reads values the Summary already computes; no score, no rating change.
 * Missing input → "n/a" (not counted), never a filler value.
 */

import { buildDefaultDCFParams, calculateFCFFDCF, calculateReverseDCF } from "./valuation-signal";
import { sumUpsideGb } from "./bias-fixes";

export type ConflictSignal = "positiv" | "neutral" | "negativ" | "n/a";

export interface ConflictCell {
  id: "quality" | "trend" | "reverseDcf" | "technical" | "catalysts";
  label: string;
  signal: ConflictSignal;
  value: string;
  basis: string;
}

export interface ConflictMatrix {
  cells: ConflictCell[];
  positives: number;
  negatives: number;
  /** At least one positive AND one negative dimension. */
  divergent: boolean;
  summary: string;
}

export interface ConflictInputs {
  qualityScore: number | null | undefined;
  marginDeltaYoYPp: number | null | undefined;
  relativeGrowthDeltaYoYPp: number | null | undefined;
  reverseDcfRating: string | null | undefined;
  impliedGrowth: number | null | undefined;
  technical: { priceAboveMA200?: boolean; ma50AboveMA200?: boolean; macdAboveZero?: boolean; macdRising?: boolean } | null | undefined;
  catalystUpsidePct: number | null | undefined;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pp = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} pp`;

export function qualitySignal(q: number | null | undefined): ConflictSignal {
  if (!fin(q)) return "n/a";
  // QUALITY_SCORE_MAP (server/scoring-integration.ts): Good 68 / Moderate 55 / Weak 42.
  if (q >= 65) return "positiv";
  if (q < 50) return "negativ";
  return "neutral";
}

export function trendSignal(margin: number | null | undefined, relGrowth: number | null | undefined): ConflictSignal {
  const xs = [margin, relGrowth].filter(fin);
  if (xs.length === 0) return "n/a";
  if (xs.every(x => x > 0)) return "positiv";
  if (xs.every(x => x < 0)) return "negativ";
  return "neutral";
}

/** calculateReverseDCF ratings (shared/valuation-signal.ts): negativ / realistic / sportlich / unrealistic / n/a. */
export function reverseDcfSignal(rating: string | null | undefined): ConflictSignal {
  switch (rating) {
    case "negativ":
    case "realistic": return "positiv";
    case "sportlich": return "neutral";
    case "unrealistic": return "negativ";
    default: return "n/a";
  }
}

/** Same four conditions as the TA Ampel (Sektion Technische Analyse). */
export function technicalSignal(t: ConflictInputs["technical"]): { signal: ConflictSignal; score: number | null } {
  if (!t) return { signal: "n/a", score: null };
  const score = [t.priceAboveMA200, t.ma50AboveMA200, t.macdAboveZero, t.macdRising].filter(Boolean).length;
  return { signal: score >= 3 ? "positiv" : score <= 1 ? "negativ" : "neutral", score };
}

export function catalystSignal(upside: number | null | undefined): ConflictSignal {
  if (!fin(upside)) return "n/a";
  if (upside >= 10) return "positiv";
  if (upside < 3) return "negativ";
  return "neutral";
}

export function buildConflictMatrix(i: ConflictInputs): ConflictMatrix {
  const tech = technicalSignal(i.technical);
  const trendParts = [
    fin(i.marginDeltaYoYPp) ? `Marge ${pp(i.marginDeltaYoYPp)}` : null,
    fin(i.relativeGrowthDeltaYoYPp) ? `Wachstum vs. Peers ${pp(i.relativeGrowthDeltaYoYPp)}` : null,
  ].filter(Boolean);
  const cells: ConflictCell[] = [
    { id: "quality", label: "Qualität (fundamental)", signal: qualitySignal(i.qualityScore),
      value: fin(i.qualityScore) ? `${i.qualityScore}` : "n/a", basis: "Scoring qualityScore (Health + Moat), ≥65 / <50" },
    { id: "trend", label: "Trend / Delta", signal: trendSignal(i.marginDeltaYoYPp, i.relativeGrowthDeltaYoYPp),
      value: trendParts.length ? trendParts.join(" · ") : "n/a", basis: "Margen-Δ YoY und Wachstum vs. Peers, beide gleichgerichtet" },
    { id: "reverseDcf", label: "Reverse DCF", signal: reverseDcfSignal(i.reverseDcfRating),
      value: i.reverseDcfRating && i.reverseDcfRating !== "n/a" ? `g* ${fin(i.impliedGrowth) ? i.impliedGrowth.toFixed(1) : "?"}% · ${i.reverseDcfRating}` : "n/a",
      basis: "eingepreistes Wachstum g* vs. Referenz" },
    { id: "technical", label: "Technik-Regime", signal: tech.signal,
      value: tech.score == null ? "n/a" : `${tech.score}/4`, basis: "Kurs>MA200, MA50>MA200, MACD>0, MACD↑" },
    { id: "catalysts", label: "Katalysatoren-EW", signal: catalystSignal(i.catalystUpsidePct),
      value: fin(i.catalystUpsidePct) ? `+${i.catalystUpsidePct.toFixed(1)}%` : "n/a", basis: "Σ gewichtete positive GB, ≥10% / <3%" },
  ];
  const positives = cells.filter(c => c.signal === "positiv").length;
  const negatives = cells.filter(c => c.signal === "negativ").length;
  const divergent = positives > 0 && negatives > 0;
  const name = (s: ConflictSignal) => cells.filter(c => c.signal === s).map(c => c.label).join(", ");
  const summary = divergent
    ? `Divergenz: ${name("positiv")} positiv, aber ${name("negativ")} negativ.`
    : positives > 0 ? `Gleichgerichtet positiv (${positives}/5).`
    : negatives > 0 ? `Gleichgerichtet negativ (${negatives}/5).`
    : "Kein klares Signal.";
  return { cells, positives, negatives, divergent, summary };
}

/** Loose view of the analysis: old cache entries can lack scoring, gateInputs or technicalIndicators. */
export interface ConflictSource {
  scoring?: { qualityScore?: number | null; gateInputs?: { marginDeltaYoYPp?: number | null; relativeGrowthDeltaYoYPp?: number | null } | null } | null;
  technicalIndicators?: { currentStatus?: ConflictInputs["technical"] } | null;
}

/** One place that reads the analysis, with ?. along every chain. Shared by UI and PDF export. */
export function conflictInputsFromAnalysis(
  data: ConflictSource | null | undefined,
  reverseDcf: { rating?: string | null; impliedGrowth?: number | null } | null | undefined,
  catalystUpsidePct: number | null | undefined,
): ConflictInputs {
  return {
    qualityScore: data?.scoring?.qualityScore,
    marginDeltaYoYPp: data?.scoring?.gateInputs?.marginDeltaYoYPp,
    relativeGrowthDeltaYoYPp: data?.scoring?.gateInputs?.relativeGrowthDeltaYoYPp,
    reverseDcfRating: reverseDcf?.rating,
    impliedGrowth: reverseDcf?.impliedGrowth,
    technical: data?.technicalIndicators?.currentStatus,
    catalystUpsidePct,
  };
}

/**
 * Server path (PDF export): rebuild the same inputs the Summary UI uses from the raw analysis.
 * Reverse DCF = calculateReverseDCF with the WACC of calculateFCFFDCF(buildDefaultDCFParams(data)),
 * identical to SummarySection. Catalysts = sumUpsideGb (same as calculateCatalystUpside). Any failure → n/a.
 */
/**
 * Reverse DCF exactly like SummarySection: calculateReverseDCF with the WACC of
 * calculateFCFFDCF(buildDefaultDCFParams(data)). Shared by the matrix and PDF section 14. Failure → null.
 */
export function reverseDcfFromAnalysis(data: any): { impliedGrowth: number; rating: string; referenceGrowth: number } | null {
  try {
    const wacc = calculateFCFFDCF(buildDefaultDCFParams(data)).wacc;
    return calculateReverseDCF({
      currentPrice: data.currentPrice,
      fcfBase: data.fcfTTM,
      wacc,
      sharesOutstanding: data.sharesOutstanding,
      netDebt: (data.totalDebt ?? 0) - (data.cashEquivalents ?? 0),
      fcfHaircut: data.fcfHaircut ?? 0,
      sectorG1: data.sectorProfile?.growthAssumptions?.g1 ?? 0,
      epsGrowthNext5Y: data.epsGrowth5Y ?? 0,
    });
  } catch {
    return null;
  }
}

export function conflictMatrixFromAnalysis(data: any): ConflictMatrix {
  const reverseDcf = reverseDcfFromAnalysis(data);
  const catalysts = Array.isArray(data?.catalysts) ? sumUpsideGb(data.catalysts) : null;
  return buildConflictMatrix(conflictInputsFromAnalysis(data, reverseDcf, catalysts));
}
