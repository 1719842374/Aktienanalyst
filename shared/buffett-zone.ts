/**
 * Offen_WORK_BUFFETT_ASIA_10Y §1 — Einordnung des Buffett-Indikators über die
 * Abweichung vom historischen Trend in Standardabweichungen (wie die
 * Trendbänder ±1σ/±2σ im Rezessions-Panel). Nur Anzeige, kein Score.
 */
export type BuffettZoneId = "strong_over" | "over" | "fair" | "under";

export interface BuffettZone {
  id: BuffettZoneId;
  label: string;
  tone: "red" | "orange" | "green" | "sky";
}

export function buffettZone(zScore: number | null | undefined): BuffettZone | null {
  if (zScore == null || !Number.isFinite(zScore)) return null;
  if (zScore >= 2) return { id: "strong_over", label: "stark überbewertet", tone: "red" };
  if (zScore >= 1) return { id: "over", label: "überbewertet", tone: "orange" };
  if (zScore > -1) return { id: "fair", label: "fair", tone: "green" };
  return { id: "under", label: "unterbewertet", tone: "sky" };
}

export function formatSigma(z: number): string {
  const s = z >= 0 ? "+" : "−";
  return `${s}${Math.abs(z).toFixed(1).replace(".", ",")} σ`;
}
