/**
 * robustStats.ts
 * --------------
 * Generische robuste Statistik-Utilities für Finanz-Analysen
 * (Reverse-DCF-Basket, Peer-Vergleiche, Sektor-Mediane etc.).
 *
 * Methoden:
 * - Quantile R-7 (Excel PERCENTILE.INC / NumPy linear) — generisch, kein Hardcode
 * - Winsorisierung (Extreme auf Quantile setzen, n bleibt erhalten)
 * - Winsorized Median (empfohlene Aggregation für Peer-Baskets)
 * - Getrimmter Mittelwert (optionale Alternative)
 *
 * Keine Ticker-/Sektor-Hardcodes. Alle Funktionen sind pure.
 *
 * Spezifikation: WORK_VALUECHAIN_SECTOR_ROTATION.md §5 + Gespräch 17.08.2026
 */

export type FiniteNumberArray = number[];

/**
 * Quantile nach Hyndman-Fan Typ 7 (R-7).
 * Identisch mit Excel PERCENTILE.INC und NumPy method='linear'.
 *
 * Formel: h = p * (n - 1)
 *         Q = sorted[⌊h⌋] * (1 - {h}) + sorted[⌈h⌉] * {h}
 */
export function quantileR7(data: number[], p: number): number {
  if (p < 0 || p > 1 || !Number.isFinite(p)) {
    throw new Error(`p must be in [0, 1], got ${p}`);
  }

  const sorted = data.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = sorted.length;

  if (n === 0) throw new Error("No finite values");
  if (n === 1) return sorted[0];
  if (p === 0) return sorted[0];
  if (p === 1) return sorted[n - 1];

  const h = p * (n - 1);
  const hFloor = Math.floor(h);
  const hCeil = Math.ceil(h);
  const frac = h - hFloor;

  return sorted[hFloor] * (1 - frac) + sorted[hCeil] * frac;
}

/**
 * Winsorisierung: Extreme Werte werden auf die Quantile gesetzt.
 * Beobachtungen bleiben erhalten (n ändert sich nicht).
 *
 * Default: 5 % / 95 % (empfohlen für Peer-Baskets n = 4–15).
 * Bei n < 4 wird unverändert zurückgegeben.
 */
export function winsorize(
  data: number[],
  lower = 0.05,
  upper = 0.95
): number[] {
  if (!(0 <= lower && lower < upper && upper <= 1)) {
    throw new Error(`Invalid bounds: lower=${lower}, upper=${upper}`);
  }

  const clean = data.filter((x) => Number.isFinite(x));
  if (clean.length < 4) return [...clean];

  const qLow = quantileR7(clean, lower);
  const qHigh = quantileR7(clean, upper);

  return clean.map((x) => Math.max(qLow, Math.min(qHigh, x)));
}

/**
 * Empfohlene Aggregationsfunktion für Reverse-DCF-Baskets und Peer-Vergleiche:
 * Median der winsorisierten Werte.
 *
 * @returns null wenn keine endlichen Werte vorhanden
 */
export function winsorizedMedian(
  data: number[],
  lower = 0.05,
  upper = 0.95
): number | null {
  const w = winsorize(data, lower, upper);
  if (w.length === 0) return null;

  const s = [...w].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);

  if (s.length % 2 === 0) {
    return (s[mid - 1] + s[mid]) / 2;
  }
  return s[mid];
}

/**
 * Getrimmter Mittelwert (optionale Alternative).
 * Entfernt den Anteil `proportionToCut` unten und oben.
 * Bei kleinen n oft wirkungslos → Winsorisierung bevorzugen.
 */
export function trimmedMean(
  data: number[],
  proportionToCut = 0.05
): number | null {
  const clean = data.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = clean.length;
  if (n === 0) return null;

  const k = Math.floor(proportionToCut * n);
  if (2 * k >= n) return null; // zu aggressiv

  const trimmed = clean.slice(k, n - k);
  return trimmed.reduce((sum, x) => sum + x, 0) / trimmed.length;
}

/**
 * Convenience: berechnet g_basket für den Reverse-DCF-Vergleich.
 * Gewichtung: 60 % Revenue-CAGR + 40 % EPS-CAGR (winsorized Median).
 * Gibt null zurück, wenn einer der Inputs unbrauchbar ist.
 */
export function computeBasketGrowth(
  revenueCagrs: number[],
  epsCagrs: number[],
  lower = 0.05,
  upper = 0.95
): number | null {
  const gRev = winsorizedMedian(revenueCagrs, lower, upper);
  const gEps = winsorizedMedian(epsCagrs, lower, upper);

  if (gRev == null && gEps == null) return null;
  if (gRev == null) return gEps;
  if (gEps == null) return gRev;

  return 0.6 * gRev + 0.4 * gEps;
}
