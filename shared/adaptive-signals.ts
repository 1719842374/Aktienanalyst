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

export function computeAdaptiveScore(
  signals: Signal[], dampingFactor: number = ADAPTIVE_CONFIG.dampingFactor,
  /** W7b: fertige Valuation-Dämpfung (valuationDamping aus Technik+Moat). Ersetzt die Spec-§5-Formel, wenn gesetzt. */
  valuationDampingOverride?: number,
): AdaptiveScore {
  const weights = deriveBaseWeights(signals);
  const tech = signals.find(s => s.id === "technical");
  const d = valuationDampingOverride != null
    ? valuationDampingOverride
    : (tech && tech.strength > ADAPTIVE_CONFIG.dampingThreshold ? tech.strength * dampingFactor : 0);
  const damp = d > 0;
  let net = 0, max = 0;
  for (const s of signals) {
    let w = weights[s.id];
    if (damp && s.group === "valuation") w *= (1 - d);
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
/** NEUTRAL-Band des normierten Scores (aus adaptiveRating). */
export const ADAPTIVE_NEUTRAL_BAND = { low: -0.05, high: 0.05 } as const;

export function adaptiveRating(score: number): { rating: string; color: "green" | "amber" | "red" } {
  if (score >= 0.15) return { rating: "ATTRAKTIV", color: "green" };
  if (score >= ADAPTIVE_NEUTRAL_BAND.high) return { rating: "LEICHT ATTRAKTIV", color: "green" };
  if (score > ADAPTIVE_NEUTRAL_BAND.low) return { rating: "NEUTRAL", color: "amber" };
  if (score > -0.15) return { rating: "UNATTRAKTIV", color: "red" };
  return { rating: "STARK UNATTRAKTIV", color: "red" };
}

/** Binärer Faktor aus der Fazit-Liste → Signal mit dokumentierter Fallback-Stärke. */
export function binarySignal(id: string, group: Signal["group"], direction: 1 | -1, label: string): Signal {
  return { id, group, direction, strength: ADAPTIVE_CONFIG.binaryFallbackStrength, label };
}

// ════════════════════════════════════════════════════════════════════════════
// W7b — Technical Override (Philip 11.10.2026 22:52): adaptive Technik-/Moat-Stärke
// aus der eigenen Kurshistorie, Valuation-Dämpfung und relative Caps.
// ════════════════════════════════════════════════════════════════════════════

export type TechStatusLike = {
  priceAboveMA200?: boolean; ma50AboveMA200?: boolean; macdAboveZero?: boolean;
} | null | undefined;

export type AdaptiveTechnical = Signal & {
  /** Negativ-Stärke 0–1 (0 = keine negative Technik). */
  negStrength: number;
  deathCross: boolean;
  rslWeak: boolean;
  /** "history" = Perzentile aus der eigenen Kurshistorie; "binary" = Fallback (zu wenig Historie). */
  method: "history" | "binary";
  historyDays: number;
  rslNow: number | null;
  rslPercentile: number | null;
};

/** Anteil der Werte ≤ x (0–1). */
export function percentileRank(series: number[], x: number): number {
  if (!series.length) return NaN;
  let n = 0;
  for (const v of series) if (v <= x) n++;
  return n / series.length;
}

/** Mindestlänge für die Historien-Methode: 200 (MA200) + 130 (RSL-Fenster) + ein Jahr Vergleichsreihe. */
export const MIN_HISTORY_DAYS = 200 + 130 + 252;
/** Legacy-RSL-Schwelle aus S9 (nur Fallback ohne Historie). */
export const RSL_WEAK_FALLBACK = 105;

/**
 * Technik-Stärke relativ zur eigenen Historie (rollierend über die gelieferte Kurshistorie):
 * jede Komponente (Death Cross .4, Kurs<MA200 .3, MACD<0 .2, RSL schwach .1, Spec §1) wird mit ihrer
 * Schwere gewichtet = 1 − Perzentil des heutigen Abstands in der eigenen Verteilung.
 * RSL schwach = heutiger RSL unter dem Median der eigenen RSL-Historie.
 * MACD hat keine Historie im Status → binär. Fallback ohne genug Historie: binär, RSL < 105.
 */
export function adaptiveTechnicalStrength(closesChrono: number[], status: TechStatusLike): AdaptiveTechnical | null {
  if (!status) return null;
  const c = closesChrono.filter(v => Number.isFinite(v) && v > 0);
  const deathCross = status.ma50AboveMA200 === false;
  const below = status.priceAboveMA200 === false;
  const macdNeg = status.macdAboveZero === false;
  const sma = (end: number, n: number) => { let s = 0; for (let i = end - n + 1; i <= end; i++) s += c[i]; return s / n; };

  if (c.length >= MIN_HISTORY_DAYS) {
    const gapCross: number[] = [], gap200: number[] = [], rsl: number[] = [];
    for (let t = 329; t < c.length; t++) {
      const m200 = sma(t, 200), m50 = sma(t, 50), a130 = sma(t, 130);
      gapCross.push(m50 / m200 - 1); gap200.push(c[t] / m200 - 1); rsl.push((c[t] / a130) * 100);
    }
    const last = rsl.length - 1;
    const sevCross = 1 - percentileRank(gapCross, gapCross[last]);
    const sev200 = 1 - percentileRank(gap200, gap200[last]);
    const rslPct = percentileRank(rsl, rsl[last]);
    const rslWeak = rslPct < 0.5;
    const raw = (deathCross ? 0.4 * sevCross : 0) + (below ? 0.3 * sev200 : 0) + (macdNeg ? 0.2 : 0) + (rslWeak ? 0.1 * (1 - rslPct) : 0);
    const strength = Math.min(1, raw);
    const neg = deathCross || below ? strength : 0;
    return {
      id: "technical", group: "technical", direction: raw > 0.5 ? -1 : 1, strength, negStrength: neg,
      deathCross, rslWeak, method: "history", historyDays: c.length, rslNow: rsl[last], rslPercentile: rslPct,
      label: `Technik-Stärke ${strength.toFixed(2)} (Historie ${c.length} Tage${deathCross ? `, Death Cross Perzentil ${(100 * (1 - sevCross)).toFixed(0)}` : ""}${below ? ", Kurs < MA200" : ""}${macdNeg ? ", MACD < 0" : ""}${rslWeak ? `, RSL ${rsl[last].toFixed(0)} = Perzentil ${(100 * rslPct).toFixed(0)}` : ""})`,
    };
  }
  // Fallback: binär (Spec-Formel 1:1), RSL aus den letzten 130 Schlüssen, Schwelle wie S9.
  const rslNow = c.length >= 130 ? (c[c.length - 1] / sma(c.length - 1, 130)) * 100 : null;
  const rslWeak = rslNow != null && rslNow < RSL_WEAK_FALLBACK;
  const t = technicalStrength({ deathCross, belowMA200: below, macdNeg, rslWeak });
  return {
    ...t, negStrength: deathCross || below ? t.strength : 0, deathCross, rslWeak, method: "binary",
    historyDays: c.length, rslNow, rslPercentile: null, label: `${t.label} · Fallback binär (nur ${c.length} Tage Historie)`,
  };
}

/** Moat-Negativ-Stärke: moatStrength mit Richtung −1 (Moat < 2,5 auf 0–5). Moat-Historie liegt nicht vor → Fallback z aus dem Score. */
export function moatNegStrength(moatScore: number | null | undefined): number {
  if (moatScore == null || !Number.isFinite(moatScore)) return 0;
  const m = moatStrength(moatScore);
  return m.direction < 0 ? m.strength : 0;
}

/** Repo-Grenze „Wide“ (computeRuleBasedMoat: score ≥ 3). Darunter gilt Moat als nicht solide (Philip: „Moat < 3“). */
export const MOAT_SOLID_MIN = 3;

/**
 * Valuation-Dämpfung aus Technik- und Moat-Negativstärke:
 * d = dampingFactor · (1 − (1 − techNeg)·(1 − moatNeg)), nur wenn Technik negativ ist.
 * Ohne Death Cross/Kurs<MA200 und mit solidem Moat → d = 0 (volle Valuation).
 */
export function valuationDamping(techNeg: number, moatNeg: number, dampingFactor: number = ADAPTIVE_CONFIG.dampingFactor): number {
  if (!(techNeg > 0)) return 0;
  return dampingFactor * (1 - (1 - techNeg) * (1 - Math.max(0, moatNeg)));
}

/** Rating-Band einer Skala: NEUTRAL = [low, high). Caps landen relativ in diesem Band. */
export type NeutralBand = { low: number; high: number };

export type AdaptiveCapResult = { cap: number | null; reasons: string[] };

/**
 * Relative Caps (nicht durch Valuation überschreibbar):
 *  - Technik-Negativ (Death Cross UND RSL schwach): cap = high − (high − low)·techNeg
 *  - Moat-Negativ (Moat < MOAT_SOLID_MIN): cap = high − (high − low)·moatNeg, mindestens knapp unter high
 * Ergebnis: höchstens NEUTRAL; je stärker das Negativsignal, desto tiefer im NEUTRAL-Band.
 */
export function adaptiveCap(band: NeutralBand, tech: AdaptiveTechnical | null, moatScore: number | null | undefined): AdaptiveCapResult {
  const reasons: string[] = [];
  const caps: number[] = [];
  const span = band.high - band.low;
  const below = (x: number) => Math.min(x, band.high - span * 1e-3);
  if (tech && tech.deathCross && tech.rslWeak) {
    caps.push(below(band.high - span * tech.negStrength));
    reasons.push(`Death Cross + schwacher RSL (Technik-Negativstärke ${tech.negStrength.toFixed(2)})`);
  }
  if (moatScore != null && Number.isFinite(moatScore) && moatScore < MOAT_SOLID_MIN) {
    caps.push(below(band.high - span * moatNegStrength(moatScore)));
    reasons.push(`Moat ${moatScore.toFixed(1)} < ${MOAT_SOLID_MIN} (nicht Wide)`);
  }
  return { cap: caps.length ? Math.min(...caps) : null, reasons };
}

/** Kurzbegründung für Summary/PDF. */
export function dampingReason(tech: AdaptiveTechnical | null, moatScore: number | null | undefined, d: number): string | null {
  if (!(d > 0) || !tech) return null;
  const bits: string[] = [];
  if (tech.deathCross) bits.push("Death Cross");
  if (tech.rslWeak) bits.push(`RSL schwach${tech.rslPercentile != null ? ` (Perzentil ${(100 * tech.rslPercentile).toFixed(0)} der eigenen Historie)` : ""}`);
  if (!tech.deathCross) bits.push("Kurs < MA200");
  if (moatScore != null && Number.isFinite(moatScore) && moatScore < MOAT_SOLID_MIN) bits.push(`Moat ${moatScore.toFixed(1)} < ${MOAT_SOLID_MIN}`);
  return `Valuation gedämpft um ${(d * 100).toFixed(0)} %, weil ${bits.join(", ")}.`;
}
