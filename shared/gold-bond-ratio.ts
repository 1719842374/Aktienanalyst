/**
 * FW-17 — Gold/Bond als Kursverhältnis GC=F / TLT.
 * Perzentil und z kommen aus der gemeinsamen Tagesreihe, nicht aus einer festen
 * Kauf-/Verkaufsschwelle. Kein Score.
 */

export const GOLD_BOND_PARAMS = {
  /** Yahoo-Chart-Fenster. Die Verteilung ist genau diese gelieferte Reihe. */
  range: "2y",
  interval: "1d",
  /**
   * Unter dieser Zahl gemeinsamer Tage sind Perzentil und z nicht belastbar.
   * Das Verhältnis des letzten gemeinsamen Tages bleibt trotzdem sichtbar.
   */
  minPointsForDistribution: 60,
  cacheTtlMs: 10 * 60 * 1000,
  goldSymbol: "GC=F",
  bondSymbol: "TLT",
} as const;

export interface DatedClose {
  date: string;
  close: number;
}

export interface GoldBondPoint {
  date: string;
  ratio: number;
  gold: number;
  bond: number;
}

export interface GoldBondSnapshot {
  ratio: number | null;
  gold: number | null;
  bond: number | null;
  asOf: string | null;
  /** Mid-Rank-Perzentil der eigenen Reihe, 0–100. null = nicht belastbar. */
  percentile: number | null;
  /** Sample-z (n−1) des letzten Verhältnisses in der eigenen Reihe. */
  z: number | null;
  points: number;
  source: string;
  unavailableReason: string | null;
  distributionReason: string | null;
}

const SOURCE = `Yahoo ${GOLD_BOND_PARAMS.goldSymbol} / ${GOLD_BOND_PARAMS.bondSymbol}`;

function positive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

/** Mid-Rank, gleiche Konvention wie percentileRank (Anteil 0–1). */
function midrank(value: number, population: readonly number[]): number {
  let less = 0;
  let equal = 0;
  for (const v of population) {
    if (v < value) less += 1;
    else if (v === value) equal += 1;
  }
  return (less + 0.5 * equal) / population.length;
}

function sampleZ(value: number, population: readonly number[]): number | null {
  if (population.length < 2) return null;
  const mean = population.reduce((s, v) => s + v, 0) / population.length;
  const variance = population.reduce((s, v) => s + (v - mean) ** 2, 0) / (population.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return null;
  return (value - mean) / sd;
}

export function alignGoldBond(gold: readonly DatedClose[], bond: readonly DatedClose[]): GoldBondPoint[] {
  const bondByDate = new Map<string, number>();
  for (const row of bond) {
    if (positive(row.close) && /^\d{4}-\d{2}-\d{2}$/.test(row.date)) bondByDate.set(row.date, row.close);
  }
  const out: GoldBondPoint[] = [];
  for (const row of gold) {
    const bondClose = bondByDate.get(row.date);
    if (!positive(row.close) || bondClose == null) continue;
    out.push({ date: row.date, gold: row.close, bond: bondClose, ratio: row.close / bondClose });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function goldBondSnapshot(gold: readonly DatedClose[] | null, bond: readonly DatedClose[] | null): GoldBondSnapshot {
  const base = {
    ratio: null, gold: null, bond: null, asOf: null, percentile: null, z: null, points: 0,
    source: SOURCE, unavailableReason: null as string | null, distributionReason: null as string | null,
  };
  if (gold == null) return { ...base, unavailableReason: `n/a — Gold-Kurs (Yahoo ${GOLD_BOND_PARAMS.goldSymbol}) fehlt` };
  if (bond == null) return { ...base, unavailableReason: `n/a — Anleihekurs (Yahoo ${GOLD_BOND_PARAMS.bondSymbol}) fehlt` };
  const points = alignGoldBond(gold, bond);
  if (points.length === 0) {
    return { ...base, unavailableReason: "n/a — keine gemeinsamen Handelstage" };
  }
  const last = points[points.length - 1];
  const ratios = points.map(p => p.ratio);
  const enough = points.length >= GOLD_BOND_PARAMS.minPointsForDistribution;
  const z = enough ? sampleZ(last.ratio, ratios) : null;
  return {
    ratio: last.ratio,
    gold: last.gold,
    bond: last.bond,
    asOf: last.date,
    percentile: enough ? midrank(last.ratio, ratios) * 100 : null,
    z,
    points: points.length,
    source: SOURCE,
    unavailableReason: null,
    distributionReason: enough
      ? (z == null ? "n/a — keine Streuung in der Gold/Bond-Reihe" : null)
      : `n/a — zu wenige gemeinsame Tage (${points.length} < ${GOLD_BOND_PARAMS.minPointsForDistribution})`,
  };
}

/** Yahoo-Chart-JSON (v8) → Tagesschlüsse. Leer oder unlesbar → null. */
export function closesFromYahooChart(json: unknown): DatedClose[] | null {
  const result = (json as { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }> } }> } })?.chart?.result?.[0];
  const ts = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(closes) || ts.length === 0) return null;
  const out: DatedClose[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = closes[i];
    const stamp = ts[i];
    if (typeof stamp !== "number" || !positive(close ?? NaN)) continue;
    out.push({ date: new Date(stamp * 1000).toISOString().slice(0, 10), close: close as number });
  }
  return out.length > 0 ? out : null;
}
