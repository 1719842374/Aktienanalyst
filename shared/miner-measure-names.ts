/**
 * FW-12 — nur die Namen der zwei schon berechneten Maße.
 * inCapitulation (server/btc-miner.ts, MA30 < MA60) und minerZone.zone
 * (classifyMinerZone) bleiben getrennte Formeln. Nichts wird umgerechnet.
 */

export type MinerZoneName = "capitulation" | "transition" | "profitable" | "euphoria";

export const MINER_ZONE_LABEL: Record<MinerZoneName, string> = {
  capitulation: "Miner-Kapitulation",
  transition: "Übergang",
  profitable: "Profitabel",
  euphoria: "Euphorie",
};

export interface MinerMeasureCopy {
  hashRibbonLabel: string;
  hashRibbonValue: string;
  minerZoneLabel: string;
  minerZoneValue: string;
  diverge: boolean;
  note: string;
}

const NOTE = "Hash-Ribbon ist nur MA30 gegen MA60. Die Miner-Zone ist der Mehrfaktoren-Score. Formeln unverändert.";

export function describeMinerMeasures(input: {
  inCapitulation: boolean | null;
  crossoverSignal: boolean | null;
  minerZone: MinerZoneName | null;
}): MinerMeasureCopy {
  const hashRibbonValue = input.inCapitulation == null
    ? "n/a — Hash-Ribbon nicht geliefert"
    : input.crossoverSignal
      ? "Kaufsignal — MA30 kreuzte MA60 von unten"
      : input.inCapitulation
        ? "Hash-Ribbon-Kapitulation — nur MA30 unter MA60"
        : "keine Hash-Ribbon-Kapitulation — MA30 nicht unter MA60";
  const minerZoneValue = input.minerZone == null
    ? "n/a — Miner-Zone nicht gesetzt (kein Preis im Request)"
    : MINER_ZONE_LABEL[input.minerZone];
  const diverge = input.inCapitulation != null && input.minerZone != null && (
    (input.inCapitulation && input.minerZone !== "capitulation")
    || (!input.inCapitulation && input.minerZone === "capitulation")
  );
  return {
    hashRibbonLabel: "Hash-Ribbon (inCapitulation)",
    hashRibbonValue,
    minerZoneLabel: "Miner-Zone (minerZone.zone)",
    minerZoneValue,
    diverge,
    note: diverge ? `Die zwei Maße fallen auseinander. ${NOTE}` : NOTE,
  };
}
