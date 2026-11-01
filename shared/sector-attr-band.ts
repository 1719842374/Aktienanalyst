/**
 * Sektor-Ampel aus der aktuellen Peer-Verteilung.
 *
 * Herkunft: Philip 01.11.2026 12:36 — Schwellen aus Perzentil und z-Score der
 * Sektoren untereinander, nicht aus den festen Noten 4,0 / 3,0
 * (WORK_SECTOR_PE_ATTRACTIVITY_REVERSEDCF.md §2). Die Attraktivitätszahl selbst
 * bleibt attractivenessScore() und wird hier nicht verändert.
 *
 * Perzentil: Mid-Rank (#{v < x} + 0.5 · #{v = x}) / n, gleiche Konvention wie
 * percentileRank() in server/sector-rotation-math.ts.
 * Pfeil: Sample-z (n−1) der Δ-Attraktivität gegenüber dem vorherigen
 * Cache-Snapshot, gleiche Konvention wie zscore() dort. Kein Vorwert → kein Pfeil.
 */

export const ATTR_PARAMS = {
  /** Grün ab dem oberen Terzil der Peer-Perzentile (P ≥ 2/3). */
  greenPct: 2 / 3,
  /** Rot bis einschließlich des unteren Terzils (P ≤ 1/3). */
  redPct: 1 / 3,
  /**
   * Unter dieser Stichprobe ist ein Terzil nicht belastbar → Ampel neutral (grau).
   * 3 ist das kleinste n, bei dem drei Bänder unterscheidbar sind.
   * Live-Karte: 9 ETF-Proxies (ETF_PROXY_MAP); Spec-Beispiel n≈11.
   * Der Testfall n=2 liegt darunter.
   */
  minSectors: 3,
  /**
   * Pfeilschwelle als |z| der Δ-Attraktivität über die Sektoren mit Vorwert.
   * 1 = eine Standardabweichung der Veränderung gegenüber dem vorherigen
   * Cache-Snapshot (_cacheAge / letzte gespeicherte Sektorzeilen).
   */
  zArrow: 1,
} as const;

/** Tie-Gewicht im Mid-Rank, analog percentileRank(). */
const MIDRANK_TIE_WEIGHT = 0.5;

export type AttrBand = "green" | "yellow" | "red" | "neutral";
export type AttrTrend = "up" | "down" | "flat" | "none";

export interface SectorAttrInput {
  id: string;
  attractiveness: number | null;
}

export interface SectorAttrAnnotation {
  id: string;
  attrPercentile: number | null;
  attrBand: AttrBand;
  attrTrend: AttrTrend;
  /** Δ attractiveness gegenüber dem Vorwert. null = kein Vorwert oder kein Ist-Wert. */
  attrDelta: number | null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function midrankPercentile(value: number, population: readonly number[]): number {
  let less = 0;
  let equal = 0;
  for (const v of population) {
    if (v < value) less += 1;
    else if (v === value) equal += 1;
  }
  return (less + MIDRANK_TIE_WEIGHT * equal) / population.length;
}

/** Sample-z (n−1). n<2 oder sd=0 → 0 für endliche Werte, null bleibt null. */
function sampleZ(values: ReadonlyArray<number | null>): Array<number | null> {
  const finite = values.filter(isFiniteNumber);
  if (finite.length < 2) return values.map(v => (isFiniteNumber(v) ? 0 : null));
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length;
  const variance = finite.reduce((s, v) => s + (v - mean) ** 2, 0) / (finite.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return values.map(v => (isFiniteNumber(v) ? 0 : null));
  return values.map(v => (isFiniteNumber(v) ? (v - mean) / sd : null));
}

function bandFor(percentile: number | null): AttrBand {
  if (percentile == null) return "neutral";
  if (percentile >= ATTR_PARAMS.greenPct) return "green";
  if (percentile <= ATTR_PARAMS.redPct) return "red";
  return "yellow";
}

/**
 * Ampel + Pfeil für eine Sektorliste. Reine Funktion: Eingaben werden nicht verändert.
 * `previous == null` oder fehlende id → attrTrend "none", attrDelta null (Tooltip „kein Vorwert“).
 * Fehlende attractiveness zählt nicht zur Stichprobe und bleibt neutral.
 */
export function sectorAttrBands(
  sectors: readonly SectorAttrInput[],
  previous: readonly SectorAttrInput[] | null | undefined,
): SectorAttrAnnotation[] {
  const finite = sectors
    .map(s => s.attractiveness)
    .filter(isFiniteNumber);
  const n = finite.length;
  const ranked = n >= ATTR_PARAMS.minSectors;

  const prevById = new Map<string, number>();
  if (previous) {
    for (const p of previous) {
      if (p && isFiniteNumber(p.attractiveness)) prevById.set(p.id, p.attractiveness);
    }
  }

  const deltas: Array<number | null> = sectors.map(s => {
    if (!isFiniteNumber(s.attractiveness)) return null;
    const prev = prevById.get(s.id);
    if (prev == null) return null;
    return s.attractiveness - prev;
  });
  const zs = sampleZ(deltas);

  return sectors.map((s, i) => {
    const value = s.attractiveness;
    const attrPercentile = ranked && isFiniteNumber(value) ? midrankPercentile(value, finite) : null;
    const delta = deltas[i];
    const z = zs[i];
    let attrTrend: AttrTrend = "none";
    if (delta != null && z != null) {
      if (z > ATTR_PARAMS.zArrow) attrTrend = "up";
      else if (z < -ATTR_PARAMS.zArrow) attrTrend = "down";
      else attrTrend = "flat";
    }
    return {
      id: s.id,
      attrPercentile,
      attrBand: bandFor(attrPercentile),
      attrTrend,
      attrDelta: delta,
    };
  });
}
