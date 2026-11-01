/**
 * F10-04 / F10-31 (Gold-GIS) und FW-21 / FW-22 / FW-24 (QE/QT).
 * Philip hat noch nicht entschieden. Nur diese Anzeige, keine Bänder, kein Gate, kein GIS.
 */
export const PHILIP_PENDING_TEXT = "n/a — Philip-Entscheidung offen";

export interface GoldPhilipPendingSlot {
  id: "gold-gis" | "gold-qe-qt";
  title: string;
  text: typeof PHILIP_PENDING_TEXT;
  detail: string;
}

export interface GoldPhilipPendingResponse {
  affectsScore: false;
  gis: GoldPhilipPendingSlot;
  qeQt: GoldPhilipPendingSlot;
}

export function philipPendingResponse(): GoldPhilipPendingResponse {
  return {
    affectsScore: false,
    gis: {
      id: "gold-gis",
      title: "Gold-GIS",
      text: PHILIP_PENDING_TEXT,
      detail: "Kreuze (±1) und der Layer-Score bleiben außerhalb des GIS.",
    },
    qeQt: {
      id: "gold-qe-qt",
      title: "QE/QT",
      text: PHILIP_PENDING_TEXT,
      detail: "Bänder, Gold/WALCL-Verhältnis und Gate GOLD_QE_QT_REGIME sind nicht geschaltet.",
    },
  };
}
