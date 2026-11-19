/**
 * Anzeige-Median für Sektion 9, wenn tamAnalysis.tamCAGR fehlt.
 * Quelle: peerComparison.peers[].revenueGrowth aus server/news-peers.ts
 * (YoY von FMP revenuePerShare, schon in Prozent — Währung kürzt sich).
 * Kein Cap, keine Schwelle, fehlende Werte zählen nicht als 0.
 * Nicht an Score, Rating, Entry oder Ampel anschließen.
 */

export const PEER_REVENUE_MEDIAN_LABEL = "Median Peer-Umsatzwachstum YoY · FMP";

export interface PeerRevenueGrowthInput {
  ticker?: string | null;
  revenueGrowth?: number | null;
}

export interface PeerRevenueGrowthMedian {
  value: number;
  n: number;
  label: typeof PEER_REVENUE_MEDIAN_LABEL;
}

export function medianPeerRevenueYoY(
  subjectTicker: string | null | undefined,
  peers: readonly PeerRevenueGrowthInput[] | null | undefined,
): PeerRevenueGrowthMedian | null {
  const subject = (subjectTicker ?? "").trim().toUpperCase();
  const values: number[] = [];
  for (const peer of peers ?? []) {
    const ticker = (peer?.ticker ?? "").trim().toUpperCase();
    if (subject && ticker === subject) continue;
    const growth = peer?.revenueGrowth;
    if (typeof growth !== "number" || !Number.isFinite(growth)) continue;
    values.push(growth);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const value = values.length % 2 === 0
    ? (values[mid - 1] + values[mid]) / 2
    : values[mid];
  return { value, n: values.length, label: PEER_REVENUE_MEDIAN_LABEL };
}
