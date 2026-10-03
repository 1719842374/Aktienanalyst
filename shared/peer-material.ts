import type { PeerSetStatus } from "./schema";

/**
 * Offen_WORK_PEER_PRICING_POWER.md + Relativ-Sektion in Offen_WORK_PEER_ADAPTIVE.md.
 *
 * peerMaterial = Moat low (None oder Narrow) oder Rivalität hoch.
 * RELATIVE_GROWTH ist nur score-wirksam wenn peerMaterial und |F| ≥ 3.
 * Banner nur wenn das Set material und unvollständig ist (|F| < 3).
 */
export const PEER_SET_MIN = 3;

export const PEER_SET_INCOMPLETE_BANNER =
  "Peer-Set unvollständig — Relativ nicht score-wirksam.";

export interface RivalryForceInput {
  name?: string | null;
  force?: string | null;
  rating?: string | null;
  score?: number | null;
}

/** Wide ist nicht low. Nur die Spec-Menge {None, Narrow}. */
export function isLowMoat(moatRating: string | null | undefined): boolean {
  const rating = (moatRating ?? "").trim().toLowerCase();
  return rating === "none" || rating === "narrow";
}

function isRivalryForce(force: RivalryForceInput): boolean {
  const label = `${force.name ?? ""} ${force.force ?? ""}`.toLowerCase();
  return label.includes("rival");
}

/** Hoch/High oder Threat-Score ≥ 4 (Porter-Band High). */
export function isHighRivalry(forces: RivalryForceInput[] | null | undefined): boolean {
  if (!forces) return false;
  for (const force of forces) {
    if (!isRivalryForce(force)) continue;
    const rating = (force.rating ?? "").trim().toLowerCase();
    if (rating === "high" || rating === "hoch") return true;
    if (typeof force.score === "number" && Number.isFinite(force.score) && force.score >= 4) return true;
  }
  return false;
}

export function isPeerMaterial(
  moatRating: string | null | undefined,
  rivalryHigh: boolean,
): boolean {
  return isLowMoat(moatRating) || rivalryHigh;
}

export function assessPeerSet(input: {
  moatRating: string | null | undefined;
  porterForces?: RivalryForceInput[] | null;
  peerCount: number;
}): PeerSetStatus {
  const peerCount = Number.isFinite(input.peerCount)
    ? Math.max(0, Math.floor(input.peerCount))
    : 0;
  const peerMaterial = isPeerMaterial(input.moatRating, isHighRivalry(input.porterForces));
  const relativeApplies = peerMaterial && peerCount >= PEER_SET_MIN;
  const banner = peerMaterial && peerCount < PEER_SET_MIN ? PEER_SET_INCOMPLETE_BANNER : null;
  return { peerMaterial, peerCount, relativeApplies, banner };
}
