/**
 * Verteilungsmaße für adaptive Schwellen (Median, Perzentil, z-Score, Peer-Position).
 * Leere oder konstante Reihen liefern null — nie einen Ersatzwert.
 */

export function finiteNumbers(values: readonly number[]): number[] {
  return values.filter(v => Number.isFinite(v));
}

export function median(values: readonly number[]): number | null {
  const xs = finiteNumbers(values).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid];
}

/** p in 0..100, lineare Interpolation auf der sortierten Stichprobe. */
export function percentile(values: readonly number[], p: number): number | null {
  const xs = finiteNumbers(values).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const clamped = Math.min(100, Math.max(0, p));
  const idx = (clamped / 100) * (xs.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}

export function mean(values: readonly number[]): number | null {
  const xs = finiteNumbers(values);
  if (xs.length === 0) return null;
  return xs.reduce((sum, v) => sum + v, 0) / xs.length;
}

/** Stichproben-Standardabweichung (n − 1). n < 2 oder sd = 0 → null. */
export function sampleSd(values: readonly number[]): number | null {
  const xs = finiteNumbers(values);
  if (xs.length < 2) return null;
  const m = xs.reduce((sum, v) => sum + v, 0) / xs.length;
  const variance = xs.reduce((sum, v) => sum + (v - m) ** 2, 0) / (xs.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? sd : null;
}

export function zScore(value: number | null, values: readonly number[]): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const m = mean(values);
  const sd = sampleSd(values);
  if (m == null || sd == null) return null;
  return (value - m) / sd;
}

/** Anteil der Vergleichswerte ≤ value, Skala 0–100. */
export function peerPercentile(value: number | null, values: readonly number[]): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const xs = finiteNumbers(values);
  if (xs.length === 0) return null;
  return (xs.filter(v => v <= value).length / xs.length) * 100;
}

/**
 * Quartilgrenzen der beobachteten Stichprobe.
 * 25 und 75 sind die Definition von Q1/Q3, keine gefittete Geschäfts-Schwelle.
 */
export const QUARTILE = { lowPct: 25, highPct: 75 } as const;

export type QuartileBand = "low" | "mid" | "high";

export function quartileBand(pct: number | null): QuartileBand | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct <= QUARTILE.lowPct) return "low";
  if (pct >= QUARTILE.highPct) return "high";
  return "mid";
}
