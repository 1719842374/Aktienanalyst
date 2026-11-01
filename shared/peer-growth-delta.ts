/**
 * Relatives Wachstum: Subjekt minus Peer-Median.
 * Dieselbe Regel wie deriveGateInputs (mindestens zwei echte Peer-Raten, Median, eine Nachkommastelle).
 */
export const PEER_GROWTH_MEDIAN_MIN_COUNT = 2;

export function peerRevenueGrowthDeltaPp(
  subjectGrowth: number | null,
  peerGrowths: Array<number | null> | null | undefined,
): number | null {
  const peerVals = (peerGrowths ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (
    peerVals.length < PEER_GROWTH_MEDIAN_MIN_COUNT
    || typeof subjectGrowth !== "number"
    || !Number.isFinite(subjectGrowth)
  ) return null;
  const sorted = [...peerVals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const peerMedian = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return +(subjectGrowth - peerMedian).toFixed(2);
}
