/**
 * Gold Miner-Breakeven: Spot gegen AISC, Zonen aus der eigenen Multiple-Historie.
 *
 * Kette: server/data/gold-aisc.json → buildGoldAiscSeries → loadGoldAiscSeries
 * → GET /api/analyze-gold (historicalPrices + aiscLine) → buildGoldMinerZone
 * → GoldAnalysis.aiscZone → GoldDashboard. Nur Anzeige, `inScore: false`.
 *
 * Schwellen am Tag d stammen nur aus Multiple-Werten ≤ d (kein Lookahead).
 * P20 / P50 sind Perzentil-Ränge (Design-Default); die Multiple-Grenzen sind
 * adaptiv. `multiple < 1` (Spot unter AISC) ist die harte Kostengrenze, keine
 * kalibrierte Zonen-Zahl. Die Euphorie-Zone ≥ P90 wird nicht klassifiziert
 * (`thresholds.euph` bleibt null) — ja/nein entscheidet Philip.
 * Die BTC-Punktetabelle (Puell, Hash Ribbon) bleibt unberührt. Die Bänder
 * (Glättung Fenster 7, Segmente, Farben) kommen aus miner-zone-bands.ts,
 * derselben Logik wie Section 13.
 */
import type { GoldAiscSeries, GoldMinerZone, GoldMinerZoneName, GoldMinerZonePoint } from "./schema";
import { goldAiscStepAt } from "./gold-aisc";
import { MINER_ZONE_SMOOTH_WINDOW, buildMinerZoneBandSegments, smoothMinerZoneBands } from "./miner-zone-bands";

export const GOLD_MINER_ZONE_MIN_OBS = 120;
export const GOLD_MINER_P_LOW_RANK = 20;
export const GOLD_MINER_P_HIGH_RANK = 50;
/** Design-Default aus der Spec. Wird nicht als Zonengrenze angewendet. */
export const GOLD_MINER_P_EUPH_RANK = 90;
/**
 * Obergrenze der ausgelieferten Punkte. 10 Jahre Handelstage aus /api/analyze-gold
 * (~2520) bleiben vollständig, damit 3M nicht auf eine ausgedünnte Linie fällt.
 * Der Score rechnet immer auf der vollen Stichprobe, vor dem Ausdünnen.
 */
export const GOLD_MINER_ZONE_MAX_POINTS = 4000;
const MAX_POINTS = GOLD_MINER_ZONE_MAX_POINTS;

const NA_SHORT_HISTORY = "Historie < 120 Handelstage";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface GoldMinerZoneOptions {
  /** Obergrenze der ausgelieferten Punkte. Default GOLD_MINER_ZONE_MAX_POINTS. */
  maxPoints?: number;
}

/**
 * Perzentilwert, linear interpoliert (PERCENTILE.INC):
 * Index = (rank/100) × (n−1). `rank` ist 0…100.
 */
export function percentileValue(sorted: readonly number[], rank: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (rank / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Perzentil-Rang von x in einer aufsteigend sortierten Stichprobe, 0…100.
 * 0 = niedrigster Wert, 100 = höchster. Inverse zur linearen Interpolation.
 * Liegt die ganze Stichprobe auf einem Wert, ist der Rang 50 (kein Spannweite).
 */
export function percentileRank(sorted: readonly number[], x: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1 || sorted[0] === sorted[n - 1]) {
    if (x < sorted[0]) return 0;
    if (x > sorted[0]) return 100;
    return n === 1 ? 0 : 50;
  }
  if (x <= sorted[0]) return 0;
  if (x >= sorted[n - 1]) return 100;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  const prev = lo - 1;
  const span = sorted[lo] - sorted[prev];
  const frac = span === 0 ? 0 : (x - sorted[prev]) / span;
  return ((prev + frac) / (n - 1)) * 100;
}

function insertSorted(sorted: number[], value: number): void {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  sorted.splice(lo, 0, value);
}

/** Kapitulation unter 1× oder unter P20. Übergang bis P50. Darüber profitabel. Keine Euphorie. */
function classifyMultiple(multiple: number, pLow: number, pHigh: number): GoldMinerZoneName {
  if (multiple < 1 || multiple < pLow) return "capitulation";
  if (multiple < pHigh) return "transition";
  return "profitable";
}

function thinPoints(points: readonly GoldMinerZonePoint[], max: number): GoldMinerZonePoint[] {
  if (points.length <= max) return points.slice();
  const step = (points.length - 1) / (max - 1);
  const idxs: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < max; i++) {
    const idx = Math.round(i * step);
    if (seen.has(idx)) continue;
    seen.add(idx);
    idxs.push(idx);
  }
  return idxs.map(i => points[i]);
}

function clipSegments(segments: GoldMinerZone["segments"], keptDates: readonly string[]): GoldMinerZone["segments"] {
  const out: GoldMinerZone["segments"] = [];
  for (const seg of segments) {
    const inside = keptDates.filter(d => d >= seg.x1 && d <= seg.x2);
    if (inside.length === 0) continue;
    const next = { x1: inside[0], x2: inside[inside.length - 1], zone: seg.zone };
    const last = out[out.length - 1];
    if (last && last.zone === next.zone) last.x2 = next.x2;
    else out.push(next);
  }
  return out;
}

/**
 * Baut die Miner-Zone. `series === null` → `null` (ungültige/fehlende AISC-Datei).
 * Unter 120 Handelstagen mit gültigem Multiple: Objekt mit `naReason`, Zonen null.
 * Punkte ohne gültige Stufe behalten den Spot und lassen Multiple/Zone leer (keine Interpolation).
 */
export function buildGoldMinerZone(
  prices: readonly { date: string; close: number }[],
  series: GoldAiscSeries | null,
  opts?: GoldMinerZoneOptions,
): GoldMinerZone | null {
  if (series == null) return null;
  const maxPoints = opts?.maxPoints ?? MAX_POINTS;

  const byDate: Record<string, number> = {};
  for (const row of prices) {
    if (!row || !DATE_RE.test(row.date)) continue;
    if (!(typeof row.close === "number" && Number.isFinite(row.close) && row.close > 0)) continue;
    byDate[row.date] = row.close;
  }
  const dates = Object.keys(byDate).sort();

  const points: GoldMinerZonePoint[] = [];
  const multiples: number[] = [];
  let since: string | null = null;
  for (const date of dates) {
    const spot = byDate[date];
    const step = goldAiscStepAt(series, date);
    if (step?.aisc == null || !(step.aisc > 0)) {
      points.push({ date, spot, aisc: null, multiple: null, marginPct: null, zone: null });
      continue;
    }
    const aisc = step.aisc;
    const multiple = spot / aisc;
    if (since == null) since = date;
    points.push({ date, spot, aisc, multiple, marginPct: (spot - aisc) / spot, zone: null });
    multiples.push(multiple);
  }

  const obs = multiples.length;
  const enough = obs >= GOLD_MINER_ZONE_MIN_OBS;
  const rawZones: (GoldMinerZoneName | null)[] = points.map(() => null);
  if (enough) {
    const expanding: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const multiple = points[i].multiple;
      if (multiple == null) continue;
      insertSorted(expanding, multiple);
      if (expanding.length < GOLD_MINER_ZONE_MIN_OBS) continue;
      const pLow = percentileValue(expanding, GOLD_MINER_P_LOW_RANK);
      const pHigh = percentileValue(expanding, GOLD_MINER_P_HIGH_RANK);
      rawZones[i] = classifyMultiple(multiple, pLow, pHigh);
    }
  }
  for (let i = 0; i < points.length; i++) {
    if (rawZones[i] != null) points[i] = { ...points[i], zone: rawZones[i] };
  }

  const smoothed = smoothMinerZoneBands(rawZones, MINER_ZONE_SMOOTH_WINDOW);
  let segments = buildMinerZoneBandSegments(points.map(p => p.date), smoothed);
  const delivered = thinPoints(points, maxPoints);
  if (delivered.length !== points.length) {
    segments = clipSegments(segments, delivered.map(p => p.date));
  }

  const allSorted = multiples.slice().sort((a, b) => a - b);
  const low = enough ? percentileValue(allSorted, GOLD_MINER_P_LOW_RANK) : null;
  const high = enough ? percentileValue(allSorted, GOLD_MINER_P_HIGH_RANK) : null;

  let latest: GoldMinerZone["latest"] = null;
  if (enough) {
    for (let i = points.length - 1; i >= 0; i--) {
      const point = points[i];
      if (point.multiple == null || point.aisc == null || point.zone == null || point.marginPct == null) continue;
      const step = goldAiscStepAt(series, point.date);
      let score = percentileRank(allSorted, point.multiple);
      if (point.multiple < 1) score = Math.min(score, 10);
      latest = {
        date: point.date,
        spot: point.spot,
        aisc: point.aisc,
        quarter: step?.quarter ?? "",
        multiple: point.multiple,
        marginUsd: point.spot - point.aisc,
        marginPct: point.marginPct,
        score,
        zone: point.zone,
        perCompany: (step?.values ?? []).map(v => ({ company: v.company, aisc: v.aisc })),
      };
      break;
    }
  }

  const thresholds: GoldMinerZone["thresholds"] = {
    pLowRank: 20,
    pHighRank: 50,
    pEuphRank: 90,
    low,
    high,
    euph: null,
    obs,
    since,
  };

  return {
    points: delivered,
    segments,
    thresholds,
    latest,
    naReason: enough ? null : NA_SHORT_HISTORY,
    inScore: false,
  };
}

/**
 * Eigene $/oz-Skala für Spot und AISC, analog zur BTC-Miner-Achse (Spot und
 * Breakeven auf einer Preisachse, nicht bei 0 verankert).
 * Kein Aufschlag ×1,10/×1,15: die Stressbänder des TA-Overlays bleiben draußen.
 */
export function goldMinerPriceDomain(points: readonly { spot: number; aisc: number | null }[]): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    if (typeof point.spot === "number" && Number.isFinite(point.spot) && point.spot > 0) {
      min = Math.min(min, point.spot);
      max = Math.max(max, point.spot);
    }
    if (typeof point.aisc === "number" && Number.isFinite(point.aisc) && point.aisc > 0) {
      min = Math.min(min, point.aisc);
      max = Math.max(max, point.aisc);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return null;
  const pad = Math.max((max - min) * 0.06, max * 0.02);
  return [min - pad, max + pad];
}
