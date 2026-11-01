/**
 * Peer-Durchschnitt aus news-peers.ts fetchPeerComparisonFromTickers.
 * Grenzen sind die dort bisher inline stehenden Filter, jetzt benannt, damit der
 * Nachlade-Pfad und der volle Analyse-Pfad dieselbe Formel nutzen.
 */
export const PEER_AVG_ROIC_ABS_CAP = 100;

export const PEER_AVG_BOUNDS = {
  pe: { lo: 0, hi: 500 },
  peg: { lo: 0, hi: 20 },
  ps: { lo: 0, hi: 100 },
  pb: { lo: 0, hi: 200 },
  epsGrowth: { lo: -100, hi: 300 },
} as const;

export interface PeerAvgInput {
  pe: number | null;
  peg: number | null;
  ps: number | null;
  pb: number | null;
  epsGrowth1Y: number | null;
  epsGrowth5Y: number | null;
  roic?: number | null;
  roic5Y?: number | null;
}

export interface PeerAvg {
  pe: number | null;
  peg: number | null;
  ps: number | null;
  pb: number | null;
  epsGrowth1Y: number | null;
  epsGrowth5Y: number | null;
  roic: number | null;
  roic5Y: number | null;
}

function avg(values: Array<number | null | undefined>, lo = -1000, hi = 1000): number | null {
  const valid = values.filter((value): value is number => value != null && !Number.isNaN(value) && Number.isFinite(value) && value > lo && value < hi);
  return valid.length > 0 ? +(valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(2) : null;
}

function sanitizeRoic(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct) || Math.abs(pct) > PEER_AVG_ROIC_ABS_CAP) return null;
  return pct;
}

export function peerAvgFromPeers(peers: readonly PeerAvgInput[]): PeerAvg {
  const validPeers = peers.filter(peer => peer.pe !== null || peer.ps !== null || peer.pb !== null);
  return {
    pe: avg(validPeers.map(peer => peer.pe), PEER_AVG_BOUNDS.pe.lo, PEER_AVG_BOUNDS.pe.hi),
    peg: avg(validPeers.map(peer => peer.peg), PEER_AVG_BOUNDS.peg.lo, PEER_AVG_BOUNDS.peg.hi),
    ps: avg(validPeers.map(peer => peer.ps), PEER_AVG_BOUNDS.ps.lo, PEER_AVG_BOUNDS.ps.hi),
    pb: avg(validPeers.map(peer => (peer.pb && peer.pb > 0 ? peer.pb : null)), PEER_AVG_BOUNDS.pb.lo, PEER_AVG_BOUNDS.pb.hi),
    epsGrowth1Y: avg(validPeers.map(peer => peer.epsGrowth1Y), PEER_AVG_BOUNDS.epsGrowth.lo, PEER_AVG_BOUNDS.epsGrowth.hi),
    epsGrowth5Y: avg(validPeers.map(peer => peer.epsGrowth5Y), PEER_AVG_BOUNDS.epsGrowth.lo, PEER_AVG_BOUNDS.epsGrowth.hi),
    roic: avg(validPeers.map(peer => sanitizeRoic(peer.roic))),
    roic5Y: avg(validPeers.map(peer => sanitizeRoic(peer.roic5Y))),
  };
}
