/**
 * server/backtest/costs.ts — Sprint B3 Phase 3 (T1/T2 Cluster + Walk-Forward,
 * WORK_SIGNAL_BACKTEST.md §8 "Transaktionskosten (cost_v1)" + §2.2
 * ("server/backtest/costs.ts — cost_v1 Cap-Buckets") + Ticket Punkt 5.
 *
 * Saetze EXAKT aus §8.2 uebernommen (Retail DACH, Version eingefroren):
 *
 *   commission_bp: 0
 *   half_spread_bp: mega(>100e9 USD)=1.5, large(10e9-100e9)=3, mid(1e9-10e9)=12
 *   slippage_bp: mega/large=2, mid=5
 *   fx_rt_bp_us_in_eur_depot: 8 (optional Flag)
 *
 * §8.1: T1 Gate-Lift = 0 bp (kein Kostenmodul aufrufen). T2 Kohorte = 1x
 * Entry (half spread + slippage), ausweisen. T3 Policy = Round-Turn voll
 * (NICHT Teil dieses Tickets — T3 ist Phase 5).
 *
 * Ticket-Akzeptanzkriterium: "cost_v1 nur in T2-Nebenzeile (nicht in T1)" —
 * diese Datei liefert daher NUR die reinen Bucket-/Satz-Funktionen; ob ein
 * Aufrufer sie in T1 oder T2 verwendet, entscheidet evaluate.ts (T1 ruft
 * diese Datei bewusst NICHT auf).
 */

export type CapBucket = "mega" | "large" | "mid";

/** Cap-Bucket-Grenzen laut §8.2 (USD). Titel < 1e9 sind laut §5.1
 *  CAP_FLOOR_USD ohnehin nicht im Universum — daher kein "small"-Bucket. */
export function capBucket(capUsd: number): CapBucket | null {
  if (!isFinite(capUsd) || capUsd <= 0) return null;
  if (capUsd > 100e9) return "mega";
  if (capUsd >= 10e9) return "large";
  if (capUsd >= 1e9) return "mid";
  return null; // unter CAP_FLOOR_USD -- ausserhalb des Kostenmodells, kein Raten
}

export interface CostV1Rates {
  commissionBp: number;
  halfSpreadBp: number;
  slippageBp: number;
}

const HALF_SPREAD_BP: Record<CapBucket, number> = {
  mega: 1.5,
  large: 3,
  mid: 12,
};

const SLIPPAGE_BP: Record<CapBucket, number> = {
  mega: 2,
  large: 2,
  mid: 5,
};

export const FX_ROUND_TURN_BP_US_IN_EUR_DEPOT = 8; // optionales Flag, §8.2

/** cost_v1-Saetze fuer einen gegebenen Cap-Bucket. commission_bp ist immer 0
 *  (§8.2: "Zero-aehnlich, Ticket >= 500€"). */
export function costV1RatesForBucket(bucket: CapBucket): CostV1Rates {
  return {
    commissionBp: 0,
    halfSpreadBp: HALF_SPREAD_BP[bucket],
    slippageBp: SLIPPAGE_BP[bucket],
  };
}

/**
 * T2-Entry-Kosten (§8.1: "1x Entry (half spread + slippage), ausweisen").
 * EIN Entry, KEIN Round-Turn (das ist T3, hier nicht gebaut). Rueckgabe in
 * Basispunkten UND als Dezimal-Fraktion (fuer direkte Return-Subtraktion).
 */
export interface T2EntryCostResult {
  bucket: CapBucket;
  entryCostBp: number;
  entryCostFraction: number; // z.B. 0.0005 = 5bp
  breakdown: CostV1Rates;
}
export function t2EntryCost(capUsd: number): T2EntryCostResult | null {
  const bucket = capBucket(capUsd);
  if (!bucket) return null;
  const rates = costV1RatesForBucket(bucket);
  const entryCostBp = rates.commissionBp + rates.halfSpreadBp + rates.slippageBp;
  return {
    bucket,
    entryCostBp,
    entryCostFraction: entryCostBp / 10000,
    breakdown: rates,
  };
}

/** Round-Turn-Kosten je Bucket (§8.2-Tabelle: Mega 7bp, Large 10bp, Mid 34bp)
 *  — additiv hier bereitgestellt fuer Referenz/Tests, obwohl Round-Turn erst
 *  in T3 (Phase 5, NICHT Teil dieses Tickets) tatsaechlich verwendet wird. */
export function roundTurnCostBp(bucket: CapBucket): number {
  const rates = costV1RatesForBucket(bucket);
  return 2 * (rates.commissionBp + rates.halfSpreadBp + rates.slippageBp);
}
