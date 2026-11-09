/**
 * Preset-Schnitte des Aktien-TA-Charts in Handelstagen.
 * TechnicalChart (Fenster A) und die Gold-Miner-Sektion schneiden dieselbe
 * Anzahl letzter Punkte ab, nicht Kalendertage.
 * Max ist die ganze Reihe (nur über rangePresets bzw. die Miner-Buttons).
 */
export const TIME_RANGE_CUTOFF = {
  "3M": 63, "6M": 126, "1Y": 252, "2Y": 504, "3Y": 756, "5Y": 1260, "10Y": 2520,
  "Max": Number.MAX_SAFE_INTEGER,
} as const;

export type TimeRange = keyof typeof TIME_RANGE_CUTOFF;

/** Letzte `TIME_RANGE_CUTOFF[range]` Punkte. Max bzw. eine kürzere Serie = alles. */
export function slicePresetWindow<T>(points: readonly T[], range: TimeRange): T[] {
  const cutoff = TIME_RANGE_CUTOFF[range];
  return points.slice(-Math.min(cutoff, points.length));
}
