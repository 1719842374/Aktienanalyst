/**
 * Konzentrations-/Klumpenrisiko-Kennzahlen — Virtuelles Portfolio.
 *
 * Auftrag 10.08.2026, Folge-Ticket Punkt 1 ("Implementiere HHI-, Effective-N-
 * und Korrelations-Warnungen"). Reine, generische Funktionen ohne Ticker-
 * Hardcodes — arbeiten ausschließlich auf den Gewichten/der Kovarianzmatrix,
 * die bereits von engine.ts berechnet wurden.
 *
 * Zweck: "optimierte" Gewichte können trotz Max-Sharpe/Risk-Parity/Score-Tilt
 * de facto klumpen (z.B. wenn 2 von 3 Titeln stark korreliert sind, oder wenn
 * die Gewichte auf wenige Positionen konzentriert sind). HHI/Effective-N und
 * Ø-Korrelation machen das sichtbar, OHNE die Gewichte selbst zu verändern —
 * reine Diagnostik/Warnung, kein neuer Optimierungs-Modus.
 */

export interface ConcentrationResult {
  hhi: number; // Herfindahl-Hirschman-Index = Σ w_i², Bereich (1/n, 1]
  effectiveN: number; // 1/HHI — "wie viele gleich gewichtete Positionen entspricht das faktisch"
  avgPairwiseCorrelation: number | null; // Ø paarweise Korrelation aus Σ, null wenn n<2 oder Σ fehlt
  maxPairwiseCorrelation: number | null;
  flags: string[];
}

const EFFECTIVE_N_WARNING_RATIO = 0.6; // Effective-N < 60% von n → Warnung ("klumpt trotz n Titeln")
const AVG_CORRELATION_WARNING = 0.7; // Ø-Korrelation > 0.7 → "hohe Gleichlaufquote"
const MAX_CORRELATION_WARNING = 0.9; // einzelnes Paar > 0.9 → nahezu redundante Positionen

/**
 * HHI + Effective-N aus einem Gewichtsvektor (Σw=1 erwartet, aber robust
 * gegen leichte Abweichungen durch Normalisierung).
 */
export function computeHHI(weights: number[]): { hhi: number; effectiveN: number } {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0 || sum <= 1e-12) return { hhi: 1, effectiveN: weights.length > 0 ? 1 : 0 };
  const normalized = weights.map(w => Math.max(0, w) / sum);
  const hhi = normalized.reduce((s, w) => s + w * w, 0);
  const effectiveN = hhi > 1e-12 ? 1 / hhi : normalized.length;
  return { hhi, effectiveN };
}

/**
 * Ø und Max paarweise Korrelation aus der Kovarianzmatrix Σ (n≥2 vorausgesetzt).
 * Korrelation_ij = Σ_ij / (σ_i · σ_j). Diagonale (i=j) wird ausgeschlossen.
 */
export function computeCorrelationStats(Sigma: number[][]): { avg: number | null; max: number | null } {
  const n = Sigma.length;
  if (n < 2) return { avg: null, max: null };
  const sigma = Sigma.map((row, i) => Math.sqrt(Math.max(row[i], 0)));
  const correlations: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sigma[i] < 1e-12 || sigma[j] < 1e-12) continue;
      const corr = Sigma[i][j] / (sigma[i] * sigma[j]);
      correlations.push(Math.max(-1, Math.min(1, corr))); // numerische Ausreißer clippen
    }
  }
  if (correlations.length === 0) return { avg: null, max: null };
  const avg = correlations.reduce((s, c) => s + c, 0) / correlations.length;
  const max = Math.max(...correlations);
  return { avg, max };
}

/**
 * Zusammenfassende Funktion: HHI/Effective-N aus den CAPM-Zielgewichten +
 * Korrelationsstatistik aus Σ, inkl. verständlicher deutscher Warn-Flags.
 * Reine Diagnostik — verändert keine Gewichte.
 */
export function assessConcentration(weights: number[], Sigma: number[][]): ConcentrationResult {
  const { hhi, effectiveN } = computeHHI(weights);
  const { avg, max } = computeCorrelationStats(Sigma);
  const n = weights.length;
  const flags: string[] = [];

  if (n >= 2 && effectiveN < n * EFFECTIVE_N_WARNING_RATIO) {
    flags.push(`Effective-N=${effectiveN.toFixed(2)} deutlich unter der nominalen Titelzahl (${n}) — die Zielgewichte klumpen trotz ${n} Positionen auf wenige Treiber.`);
  }
  if (avg != null && avg > AVG_CORRELATION_WARNING) {
    flags.push(`Ø-Korrelation der Positionen hoch (${(avg * 100).toFixed(0)}%) — geringer Diversifikationsnutzen trotz mehrerer Titel.`);
  }
  if (max != null && max > MAX_CORRELATION_WARNING && n > 2) {
    flags.push(`Mindestens ein Titelpaar ist mit ${(max * 100).toFixed(0)}% nahezu redundant korreliert.`);
  }

  return { hhi, effectiveN, avgPairwiseCorrelation: avg, maxPairwiseCorrelation: max, flags };
}
