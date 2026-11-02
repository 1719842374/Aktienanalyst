/**
 * Gold Miner-Breakeven: Spot gegen AISC, Zonen aus der eigenen Multiple-Historie.
 *
 * Kette: server/data/gold-aisc.json → buildGoldAiscSeries → loadGoldAiscSeries
 * → GET /api/analyze-gold (historicalPrices + aiscLine) → buildGoldMinerZone
 * → GoldAnalysis.aiscZone → GoldDashboard. Nur Anzeige, `inScore: false`.
 *
 * Schwellen am Tag d stammen nur aus Multiple-Werten ≤ d (kein Lookahead).
 * P20 / P50 / P90 sind Perzentil-Ränge (benannte Parameter); die Multiple-Grenzen
 * sind adaptiv. Median = P50. z-Score = (letztes Multiple − Mittel) / Stichproben-σ
 * der vorherigen Werte. `multiple < 1` (Spot unter AISC) ist die harte Kostengrenze.
 * Euphorie gilt ab P90, aber nur wenn P90 über dem Median liegt — sonst wäre eine
 * konstante Stichprobe vollständig Euphorie.
 * Die BTC-Miner-Rechnung bleibt unberührt; die Glättung (Fenster 7, Mehrheit)
 * ist hier lokal nachgebaut.
 */
import type { GoldAiscSeries, GoldMinerZone, GoldMinerZoneName, GoldMinerZonePoint } from "./schema";
import { goldAiscStepAt } from "./gold-aisc";

export const GOLD_MINER_ZONE_MIN_OBS = 120;
export const GOLD_MINER_P_LOW_RANK = 20;
export const GOLD_MINER_P_HIGH_RANK = 50;
/** Oberes Perzentil. Euphorie nur, wenn dieser Wert streng über dem Median liegt. */
export const GOLD_MINER_P_EUPH_RANK = 90;
/** Stichproben-σ braucht mindestens zwei Werte (Nenner n−1). */
export const GOLD_MINER_Z_MIN_HISTORY = 2;
const SMOOTH_WINDOW = 7;
const MAX_POINTS = 800;

const NA_SHORT_HISTORY = "Historie < 120 Handelstage";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface GoldMinerZoneOptions {
  /** Obergrenze der ausgelieferten Punkte. Default 800. */
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

/**
 * Kapitulation unter 1× oder unter P20. Euphorie ab P90, sofern P90 über dem Median liegt.
 * Übergang bis P50. Darüber profitabel.
 */
function classifyMultiple(multiple: number, pLow: number, pHigh: number, pEuph: number): GoldMinerZoneName {
  if (multiple < 1 || multiple < pLow) return "capitulation";
  if (pEuph > pHigh && multiple >= pEuph) return "euphoria";
  if (multiple < pHigh) return "transition";
  return "profitable";
}

/** Mittel und Stichproben-σ (n−1). σ = 0 oder zu wenig Werte → null, kein Ersatz. */
export function goldMinerSampleSigma(values: readonly number[]): { mean: number; sigma: number } | null {
  if (values.length < GOLD_MINER_Z_MIN_HISTORY) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const sigma = Math.sqrt(variance);
  if (!(sigma > 0) || !Number.isFinite(mean)) return null;
  return { mean, sigma };
}

/** Mehrheits-Zone über ein Fenster. null bleibt null. Gleichstand: zuerst gesehene Zone. */
function smoothZones(zones: readonly (GoldMinerZoneName | null)[], window: number): (GoldMinerZoneName | null)[] {
  return zones.map((z, i) => {
    if (z == null) return null;
    const slice = zones.slice(Math.max(0, i - window + 1), i + 1).filter((x): x is GoldMinerZoneName => x != null);
    if (slice.length === 0) return z;
    const order: GoldMinerZoneName[] = [];
    const counts: Partial<Record<GoldMinerZoneName, number>> = {};
    for (const s of slice) {
      if (counts[s] == null) order.push(s);
      counts[s] = (counts[s] ?? 0) + 1;
    }
    let best: GoldMinerZoneName = z;
    let bestCount = -1;
    for (const zone of order) {
      const count = counts[zone] ?? 0;
      if (count > bestCount) {
        best = zone;
        bestCount = count;
      }
    }
    return best;
  });
}

function buildSegments(dates: readonly string[], smoothed: readonly (GoldMinerZoneName | null)[]): GoldMinerZone["segments"] {
  const segments: GoldMinerZone["segments"] = [];
  let current: GoldMinerZone["segments"][number] | null = null;
  for (let i = 0; i < dates.length; i++) {
    const zone = smoothed[i];
    if (zone == null) {
      current = null;
      continue;
    }
    if (current && current.zone === zone) current.x2 = dates[i];
    else {
      current = { x1: dates[i], x2: dates[i], zone };
      segments.push(current);
    }
  }
  return segments;
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
      const pEuph = percentileValue(expanding, GOLD_MINER_P_EUPH_RANK);
      rawZones[i] = classifyMultiple(multiple, pLow, pHigh, pEuph);
    }
  }
  for (let i = 0; i < points.length; i++) {
    if (rawZones[i] != null) points[i] = { ...points[i], zone: rawZones[i] };
  }

  const smoothed = smoothZones(rawZones, SMOOTH_WINDOW);
  let segments = buildSegments(points.map(p => p.date), smoothed);
  const delivered = thinPoints(points, maxPoints);
  if (delivered.length !== points.length) {
    segments = clipSegments(segments, delivered.map(p => p.date));
  }

  const allSorted = multiples.slice().sort((a, b) => a - b);
  const low = enough ? percentileValue(allSorted, GOLD_MINER_P_LOW_RANK) : null;
  const high = enough ? percentileValue(allSorted, GOLD_MINER_P_HIGH_RANK) : null;
  const euph = enough ? percentileValue(allSorted, GOLD_MINER_P_EUPH_RANK) : null;

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

  const history = multiples.slice(0, -1);
  const spread = latest ? goldMinerSampleSigma(history) : null;
  const zScore = latest && spread ? (latest.multiple - spread.mean) / spread.sigma : null;

  const thresholds: GoldMinerZone["thresholds"] = {
    pLowRank: GOLD_MINER_P_LOW_RANK,
    pHighRank: GOLD_MINER_P_HIGH_RANK,
    pEuphRank: GOLD_MINER_P_EUPH_RANK,
    low,
    high,
    median: high,
    euph,
    sigma: spread?.sigma ?? null,
    zScore: zScore != null && Number.isFinite(zScore) ? zScore : null,
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
 * Schneidet Zonenflächen auf die Daten des sichtbaren Fensters.
 * x1/x2 liegen danach auf einem gelieferten Datum, sonst zeichnet die Kategorie-Achse nichts.
 * `only` filtert eine Zone (Kapitulations-Overlay im TA-Chart).
 */
export function clipGoldZoneSegments(
  segments: readonly { x1: string; x2: string; zone: GoldMinerZoneName }[],
  dates: readonly string[],
  only?: GoldMinerZoneName,
): { x1: string; x2: string; zone: GoldMinerZoneName }[] {
  if (dates.length === 0) return [];
  const first = dates[0];
  const last = dates[dates.length - 1];
  const has = new Set(dates);
  const snap = (date: string, forward: boolean) => {
    if (has.has(date)) return date;
    if (forward) return dates.find(item => item >= date) ?? last;
    for (let i = dates.length - 1; i >= 0; i--) if (dates[i] <= date) return dates[i];
    return first;
  };
  const out: { x1: string; x2: string; zone: GoldMinerZoneName }[] = [];
  for (const seg of segments) {
    if (only && seg.zone !== only) continue;
    if (seg.x2 < first || seg.x1 > last) continue;
    const x1 = snap(seg.x1 < first ? first : seg.x1, true);
    const x2 = snap(seg.x2 > last ? last : seg.x2, false);
    if (x1 > x2) continue;
    const prev = out[out.length - 1];
    if (prev && prev.zone === seg.zone && prev.x2 >= x1) prev.x2 = x2;
    else out.push({ x1, x2, zone: seg.zone });
  }
  return out;
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
