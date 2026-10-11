/**
 * W7 — Volle Adaptivität (Future_Work.md „Volle Adaptivität im Aktien-Scoring“, Philip 11.10.2026).
 * Eine Funktion für App (S17) und PDF: computeAdaptiveScore → normierter Score [-1, 1] → Rating.
 * Generisch, kein Ticker-Hardcode.
 */

export interface Signal {
  id: string;
  /** Gruppe für die Dämpfung: "valuation" wird bei starker Technik gedämpft. */
  group: "valuation" | "technical" | "moat" | "risk" | "quality" | "other";
  direction: 1 | -1 | 0;
  /** 0–1 */
  strength: number;
  label: string;
}

/** Spec §3: Start fest 0,35–0,45; Kalibrierung offline (script/calibrate-damping.ts). Spec §5 nutzt 0,4. */
export const ADAPTIVE_CONFIG = {
  dampingFactor: 0.4,
  dampingThreshold: 0.5,
  lowBetaMax: 0.7,
  lowBetaTechCut: 0.6,
  lowBetaStrength: 0.3,
  /**
   * Fallback-Stärke für binäre Faktoren ohne eigene Verteilung (keine Historie im Analyse-JSON):
   * 0,5 = Mitte der Skala 0–1, also weder schwach noch stark. Ersetzt, sobald z-Scores je Faktor vorliegen.
   */
  binaryFallbackStrength: 0.5,
} as const;

export function toStrength(z: number): number {
  return Math.min(1, Math.abs(z) / 2.5);
}

export function technicalStrength(t: { deathCross: boolean; belowMA200: boolean; macdNeg: boolean; rslWeak: boolean }): Signal {
  const raw = (t.deathCross ? 1 : 0) * 0.4 + (t.belowMA200 ? 1 : 0) * 0.3 + (t.macdNeg ? 1 : 0) * 0.2 + (t.rslWeak ? 1 : 0) * 0.1;
  const strength = Math.min(1, raw);
  const parts = [t.deathCross && "Death Cross", t.belowMA200 && "Kurs < MA200", t.macdNeg && "MACD < 0", t.rslWeak && "RSL schwach"].filter(Boolean);
  return {
    id: "technical", group: "technical",
    direction: raw > 0.5 ? -1 : 1,
    strength,
    label: `Technik-Stärke ${strength.toFixed(2)}${parts.length ? ` (${parts.join(", ")})` : ""}`,
  };
}

/** Moat-Skala im Repo: computeRuleBasedMoat-Score (≈ −2…4,5 inkl. KI-Delta; Wide ≥ 3, Narrow ≥ 1). Auf 0–5 geklemmt. */
export function moatStrength(moatScore: number): Signal {
  const m = Math.max(0, Math.min(5, moatScore));
  const z = (m - 2.5) / 1.5;
  return {
    id: "moat", group: "moat",
    direction: z > 0 ? 1 : -1,
    strength: toStrength(z),
    label: `Moat-Score ${moatScore.toFixed(1)} (z ${z.toFixed(2)})`,
  };
}

export function lowBetaSignal(beta: number, techStrength: number): Signal | null {
  if (!(Number.isFinite(beta) && beta < ADAPTIVE_CONFIG.lowBetaMax)) return null;
  return {
    id: "lowBeta", group: "risk",
    direction: techStrength > ADAPTIVE_CONFIG.lowBetaTechCut ? -1 : 1,
    strength: ADAPTIVE_CONFIG.lowBetaStrength,
    label: `Beta ${beta.toFixed(2)} < ${ADAPTIVE_CONFIG.lowBetaMax}${techStrength > ADAPTIVE_CONFIG.lowBetaTechCut ? " bei starker Technik-Schwäche — kein Defensiv-Plus" : " — defensiv"}`,
  };
}

export function deriveBaseWeights(signals: Signal[]): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const s of signals) weights[s.id] = 0.8 + s.strength * 0.7;
  return weights;
}

export type AdaptiveScore = {
  score: number; // net/max ∈ [-1, 1]
  net: number;
  max: number;
  dampened: boolean;
  weights: Record<string, number>;
};

export function computeAdaptiveScore(signals: Signal[], dampingFactor: number = ADAPTIVE_CONFIG.dampingFactor): AdaptiveScore {
  const weights = deriveBaseWeights(signals);
  const tech = signals.find(s => s.id === "technical");
  const damp = !!tech && tech.strength > ADAPTIVE_CONFIG.dampingThreshold;
  let net = 0, max = 0;
  for (const s of signals) {
    let w = weights[s.id];
    if (damp && s.group === "valuation") w *= (1 - tech!.strength * dampingFactor);
    weights[s.id] = w;
    net += s.direction * s.strength * w;
    max += w;
  }
  return { score: max > 0 ? net / max : 0, net, max, dampened: damp, weights };
}

/**
 * Mapping normierter Score → Rating. Symmetrische Bänder um 0:
 * ≥ +0,15 ATTRAKTIV · ≥ +0,05 LEICHT ATTRAKTIV · > −0,05 NEUTRAL · > −0,15 UNATTRAKTIV · sonst STARK UNATTRAKTIV.
 * Begründung: Ein binärer Faktor trägt ±0,5·w; bei ~15 Signalen entspricht ein Netto-Überhang von ~2 Faktoren ≈ 0,05–0,07,
 * ~4 Faktoren ≈ 0,13–0,15 — dieselbe Abstufung wie die bisherigen Zählschwellen (±2 / ±4).
 */
export function adaptiveRating(score: number): { rating: string; color: "green" | "amber" | "red" } {
  if (score >= 0.15) return { rating: "ATTRAKTIV", color: "green" };
  if (score >= 0.05) return { rating: "LEICHT ATTRAKTIV", color: "green" };
  if (score > -0.05) return { rating: "NEUTRAL", color: "amber" };
  if (score > -0.15) return { rating: "UNATTRAKTIV", color: "red" };
  return { rating: "STARK UNATTRAKTIV", color: "red" };
}

/** Binärer Faktor aus der Fazit-Liste → Signal mit dokumentierter Fallback-Stärke. */
export function binarySignal(id: string, group: Signal["group"], direction: 1 | -1, label: string): Signal {
  return { id, group, direction, strength: ADAPTIVE_CONFIG.binaryFallbackStrength, label };
}
