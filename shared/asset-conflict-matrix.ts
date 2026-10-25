/**
 * Konfliktmatrix (Future_Work §8) for the BTC, Gold and Recession dashboards. Same shape and summary as the
 * stock matrix (shared/conflict-matrix.ts). Display only: every cell reads a value the dashboard already has and
 * maps it with the threshold that dashboard already uses. No new source, no score or rating change.
 * Missing or non-finite input → "n/a" (not counted), never a filler value.
 */

import { summarizeConflictCells, technicalSignal, type ConflictCellOf, type ConflictMatrixOf, type ConflictSignal } from "./conflict-matrix";

export type AssetConflictMatrix = ConflictMatrixOf<ConflictCellOf<string>>;

/** Footnote for the asset dashboards (same wording as the stock matrix, without "im Fazit"). */
export const ASSET_CONFLICT_NOTE = "Nur Darstellung: fünf Dimensionen nebeneinander, Divergenz explizit. Rating und Score unverändert. n/a zählt nicht.";

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const signed = (v: number, digits: number) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
const NA: Pick<ConflictCellOf, "signal" | "value"> = { signal: "n/a", value: "n/a" };

/** >0 positiv, <0 negativ, 0 neutral. */
function signSignal(v: number): ConflictSignal {
  return v > 0 ? "positiv" : v < 0 ? "negativ" : "neutral";
}

// ─── BTC ────────────────────────────────────────────────────────────────────────

/** Loose view of BTCAnalysis (client/src/lib/btcAnalysis.ts). Fallback or old data can lack fields. */
export interface BtcConflictSource {
  gis?: number | null;
  powerLaw?: { powerSignal?: number | null; deviationPercent?: number | null } | null;
  gws?: { cycleSignal?: number | null } | null;
  monthsSinceHalving?: number | null;
  bullConditions?: { priceAboveMA200?: boolean; ma50AboveMA200?: boolean; macdAboveZero?: boolean; macdRising?: boolean } | null;
  fearGreedIndex?: number | null;
  fearGreedLabel?: string | null;
}

export function btcConflictMatrix(d: BtcConflictSource | null | undefined): AssetConflictMatrix {
  const gis = d?.gis;
  const ps = d?.powerLaw?.powerSignal;
  const dev = d?.powerLaw?.deviationPercent;
  const cyc = d?.gws?.cycleSignal;
  const msh = d?.monthsSinceHalving;
  const tech = technicalSignal(d?.bullConditions ?? null);
  const fg = d?.fearGreedIndex;
  return summarizeConflictCells<ConflictCellOf<string>>([
    { id: "gis", label: "GIS (Indikatoren)", ...(fin(gis) ? { signal: signSignal(gis), value: gis.toFixed(4) } : NA),
      basis: "gis, Sektion 4: >0 positiv / <0 negativ" },
    { id: "powerLaw", label: "Power-Law", ...(fin(ps) ? { signal: signSignal(ps), value: `Signal ${ps.toFixed(1)}${fin(dev) ? ` · Abw. ${signed(dev, 1)}%` : ""}` } : NA),
      basis: "powerLaw.powerSignal, Sektion 5: >0 unter FV, <0 über Resistance" },
    { id: "cycle", label: "Halving-Zyklus", ...(fin(cyc) ? { signal: signSignal(cyc), value: `Signal ${cyc.toFixed(1)}${fin(msh) ? ` · Monat ${msh}` : ""}` } : NA),
      basis: "gws.cycleSignal, Sektion 6: <12 M ≥0, ≥18 M negativ" },
    { id: "technical", label: "Technik-Regime", signal: tech.signal, value: tech.score == null ? "n/a" : `${tech.score}/4`,
      basis: "bullConditions: Kurs>MA200, MA50>MA200, MACD>0, MACD↑ (wie Fazit 14)" },
    { id: "sentiment", label: "Fear & Greed (konträr)",
      ...(fin(fg) ? { signal: fg < 30 ? "positiv" : fg > 70 ? "negativ" : "neutral", value: `${fg}${d?.fearGreedLabel ? ` (${d.fearGreedLabel})` : ""}` } : NA),
      basis: "fearGreedIndex, GIS-Regel: <30 positiv / >70 negativ" },
  ]);
}

// ─── Gold ───────────────────────────────────────────────────────────────────────

/** Loose view of GoldAnalysis (shared/gold-schema.ts). */
export interface GoldConflictSource {
  gis?: number | null;
  adaptiveScore?: { score?: number | null } | null;
  realYieldModel?: {
    fairValue?: { premiumPct?: number | null; withinFairBand?: boolean | null; decoupled?: boolean | null } | null;
    regime?: { regime?: string | null } | null;
  } | null;
  indicators?: { name: string; score: number; value: string }[] | null;
}

export function goldConflictMatrix(d: GoldConflictSource | null | undefined): AssetConflictMatrix {
  const gis = d?.gis;
  const ad = d?.adaptiveScore?.score;
  const fv = d?.realYieldModel?.fairValue;
  const prem = fv?.premiumPct;
  const regime = d?.realYieldModel?.regime?.regime;
  const techInd = d?.indicators?.find(i => i.name.startsWith("Technisch"));
  const regimeSignal: ConflictSignal | null = regime === "tailwind" ? "positiv" : regime === "stress" ? "negativ" : regime === "neutral" ? "neutral" : null;
  return summarizeConflictCells<ConflictCellOf<string>>([
    { id: "gis", label: "GIS (Indikatoren)", ...(fin(gis) ? { signal: gis >= 0.30 ? "positiv" : gis < 0 ? "negativ" : "neutral", value: gis.toFixed(2) } : NA),
      basis: "gis, Sentiment-Regel: ≥0.30 Bullish / <0 Bearish" },
    { id: "adaptive", label: "Adaptive Schicht", ...(fin(ad) ? { signal: signSignal(ad), value: signed(ad, 2) } : NA),
      basis: "adaptiveScore.score, Sektion 9: >0 positiv / <0 negativ" },
    { id: "realYieldFv", label: "Real-Yield Fair Value",
      ...(fin(prem) ? {
        signal: fv?.withinFairBand ? "neutral" : prem > 0 ? "negativ" : "positiv",
        value: `${signed(prem * 100, 1)}%${fv?.withinFairBand ? " · im Band" : ""}${fv?.decoupled ? " · entkoppelt" : ""}`,
      } : NA),
      basis: "realYieldModel.fairValue.premiumPct, Fair-Band ±10%: darüber negativ, darunter positiv" },
    { id: "regime", label: "Realzins-Regime", ...(regimeSignal ? { signal: regimeSignal, value: regime as string } : NA),
      basis: "realYieldModel.regime: tailwind positiv / stress negativ" },
    { id: "technical", label: "Technik (RSI + 200-DMA)",
      ...(techInd && fin(techInd.score) ? { signal: signSignal(techInd.score), value: techInd.value } : NA),
      basis: "indicators „Technisch (RSI+200DMA)“ score +1 / 0 / −1" },
  ]);
}

// ─── Recession ──────────────────────────────────────────────────────────────────

export interface RecessionSubgroupSource { name: string; label?: string; horizon?: string; probability?: number | null; finalProbability?: number | null }

const RECESSION_DIMENSIONS: { id: string; label: string }[] = [
  { id: "recession_coincident", label: "Rezession Coincident (3M)" },
  { id: "recession_leading", label: "Rezession Leading (6M)" },
  { id: "recession_full", label: "Rezession Vollständig (12M)" },
  { id: "correction_sentiment", label: "Korrektur Sentiment (3-6M)" },
  { id: "correction_full", label: "Korrektur Vollständig (12M)" },
];

/** Probability bands of the interpretation (server/recession.ts): <30 sehr niedrig, ≥50 moderat/hoch. Low risk is positiv. */
export function recessionProbSignal(p: number | null | undefined): ConflictSignal {
  if (!fin(p)) return "n/a";
  if (p < 30) return "positiv";
  if (p >= 50) return "negativ";
  return "neutral";
}

export function recessionConflictMatrix(subgroups: RecessionSubgroupSource[] | null | undefined): AssetConflictMatrix {
  return summarizeConflictCells<ConflictCellOf<string>>(RECESSION_DIMENSIONS.map(({ id, label }) => {
    const sg = subgroups?.find(s => s.name === id);
    const p = fin(sg?.finalProbability) ? sg!.finalProbability : sg?.probability;
    return {
      id, label, signal: recessionProbSignal(p), value: fin(p) ? `${p}%` : "n/a",
      basis: "subgroups[].probability (12M Rezession: finalProbability mit NY-Fed-Anker), <30% positiv / ≥50% negativ",
    };
  }));
}
