/**
 * Relativer Peer-Anker für TAM-Schätzungen.
 * Median und Quartile kommen aus den gelieferten YoY-Raten, kein fester Korridor.
 */
import { percentile } from "./segment-growth-calc";

export const PEER_ANCHOR_LIMIT = 5;

export interface PeerGrowthAnchor {
  peerCount: number;
  medianRevenueYoyPct: number | null;
  p25RevenueYoyPct: number | null;
  p75RevenueYoyPct: number | null;
  source: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function peerGrowthAnchorFromYoys(yoys: number[]): PeerGrowthAnchor | null {
  const usable = yoys.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((a, b) => a - b);
  return {
    peerCount: usable.length,
    medianRevenueYoyPct: round1(percentile(sorted, 50)),
    p25RevenueYoyPct: round1(percentile(sorted, 25)),
    p75RevenueYoyPct: round1(percentile(sorted, 75)),
    source: "FMP income-statement Peer-Umsatz-YoY",
  };
}
