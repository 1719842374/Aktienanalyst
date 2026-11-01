/**
 * Generisches Ranking für die Podcast-Probe.
 * Welche Reihe ein Key Driver ist, entscheidet die eigene Historie
 * (z-Score, Perzentil, Änderungsrate). Es gibt keine Themenliste.
 * Fehlende Komponenten bleiben null und erscheinen als „n/a — …“, nie als 0.
 */

export interface PodcastPoint {
  date: string;
  value: number;
}

export interface PodcastSeriesInput {
  id: string;
  label: string;
  source: string;
  channels: string[];
  unit: string | null;
  points: PodcastPoint[];
  citation: string | null;
}

export interface PodcastGap {
  channel: string;
  label: string;
  status: string;
}

export interface PodcastDriverComponents {
  zScore: number | null;
  percentile: number | null;
  changeRate: number | null;
}

export interface RankedDriver {
  rank: number;
  id: string;
  label: string;
  source: string;
  channels: string[];
  value: number;
  unit: string | null;
  asOf: string;
  citation: string | null;
  relevance: number;
  reason: string;
  components: PodcastDriverComponents;
}

/**
 * Gewichte und Fenster. Gleiche Gewichte, damit kein Kanal vorab wichtiger ist.
 * zScale und changeScale stauchen die Beträge auf 0…1, sonst dominiert die
 * Einheit der Änderungsrate den z-Score.
 */
export const PODCAST_DRIVER_PARAMS = {
  minHistoryForZ: 8,
  minHistoryForPercentile: 8,
  minHistoryForChange: 2,
  weights: {
    zScore: 1,
    percentileDeviation: 1,
    changeRate: 1,
  },
  maxDrivers: 5,
  zScale: 1,
  changeScale: 0.05,
  sigmaFloor: 1e-12,
};

export interface PodcastDriverParams {
  minHistoryForZ: number;
  minHistoryForPercentile: number;
  minHistoryForChange: number;
  weights: { zScore: number; percentileDeviation: number; changeRate: number };
  maxDrivers: number;
  zScale: number;
  changeScale: number;
  sigmaFloor: number;
}

function cleanPoints(points: PodcastPoint[]): PodcastPoint[] {
  const byDate = new Map<string, number>();
  for (const point of points ?? []) {
    if (!point || typeof point.date !== "string" || !Number.isFinite(point.value)) continue;
    const date = point.date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    byDate.set(date, point.value);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));
}

/** Sample-z (n−1) des letzten Werts gegen die früheren Punkte. Ohne Streuung: null. */
export function sampleZ(latest: number, history: number[], sigmaFloor: number): number | null {
  if (history.length < 2 || history.some(value => !Number.isFinite(value)) || !Number.isFinite(latest)) return null;
  const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
  const variance = history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (history.length - 1);
  const sigma = Math.sqrt(variance);
  if (!(sigma > sigmaFloor)) return null;
  const z = (latest - mean) / sigma;
  return Number.isFinite(z) ? z : null;
}

/** Mid-rank Perzentil in 0…1. Leere Stichprobe ist null, nicht 0,5. */
export function percentileOf(value: number, population: number[]): number | null {
  if (!population.length || !Number.isFinite(value)) return null;
  const less = population.filter(item => item < value).length;
  const equal = population.filter(item => item === value).length;
  return (less + 0.5 * equal) / population.length;
}

export function changeAgainstPrevious(latest: number, previous: number): number | null {
  if (!Number.isFinite(latest) || !Number.isFinite(previous) || previous === 0) return null;
  const rate = (latest - previous) / Math.abs(previous);
  return Number.isFinite(rate) ? rate : null;
}

function squash(magnitude: number, scale: number): number {
  if (!(scale > 0) || !Number.isFinite(magnitude)) return 0;
  return magnitude / (magnitude + scale);
}

function formatNum(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

function channelOf(series: PodcastSeriesInput): string {
  return series.channels.filter(Boolean).join("+") || "reihe";
}

export function rankPodcastDrivers(
  input: PodcastSeriesInput[],
  params: PodcastDriverParams = PODCAST_DRIVER_PARAMS,
): { drivers: RankedDriver[]; skipped: PodcastGap[] } {
  const drivers: RankedDriver[] = [];
  const skipped: PodcastGap[] = [];

  for (const series of input) {
    const points = cleanPoints(series.points);
    const channel = channelOf(series);
    if (points.length < params.minHistoryForChange) {
      const latest = points[points.length - 1];
      const valueText = latest ? formatNum(latest.value) : "ohne Punkt";
      skipped.push({
        channel,
        label: series.label,
        status: `n/a — Historie zu kurz, letzter Wert ${valueText}`,
      });
      continue;
    }

    const latest = points[points.length - 1]!;
    const previous = points[points.length - 2]!;
    const history = points.slice(0, -1).map(point => point.value);
    const z = points.length >= params.minHistoryForZ
      ? sampleZ(latest.value, history, params.sigmaFloor)
      : null;
    const percentile = points.length >= params.minHistoryForPercentile
      ? percentileOf(latest.value, points.map(point => point.value))
      : null;
    const change = points.length >= params.minHistoryForChange
      ? changeAgainstPrevious(latest.value, previous.value)
      : null;

    const parts: Array<{ weight: number; score: number }> = [];
    if (z != null && params.weights.zScore > 0) {
      parts.push({ weight: params.weights.zScore, score: squash(Math.abs(z), params.zScale) });
    }
    if (percentile != null && params.weights.percentileDeviation > 0) {
      parts.push({
        weight: params.weights.percentileDeviation,
        score: Math.abs(percentile - 0.5) * 2,
      });
    }
    if (change != null && params.weights.changeRate > 0) {
      parts.push({ weight: params.weights.changeRate, score: squash(Math.abs(change), params.changeScale) });
    }

    const weightSum = parts.reduce((sum, part) => sum + part.weight, 0);
    const relevance = weightSum > 0 ? parts.reduce((sum, part) => sum + part.weight * part.score, 0) / weightSum : 0;
    const hasSignal = parts.some(part => part.score > 0);
    if (!hasSignal) {
      skipped.push({
        channel,
        label: series.label,
        status: "n/a — keine Streuung in der eigenen Historie",
      });
      continue;
    }

    const reason: string[] = [];
    if (z != null) reason.push(`z-Score ${formatNum(z)} gegen ${history.length} frühere Punkte`);
    else reason.push(`z-Score n/a — Historie ${points.length} Punkte, braucht ${params.minHistoryForZ}`);
    if (percentile != null) reason.push(`Perzentil ${formatNum(percentile * 100)} der eigenen Historie`);
    else reason.push(`Perzentil n/a — Historie ${points.length} Punkte, braucht ${params.minHistoryForPercentile}`);
    if (change != null) reason.push(`Änderungsrate ${formatNum(change * 100)} Prozent gegen den vorherigen Punkt`);
    else if (previous.value === 0) reason.push("Änderungsrate n/a — Vorwert ist 0");
    else reason.push("Änderungsrate n/a — Vorwert fehlt");
    reason.push(`Quelle: ${series.source}`);

    drivers.push({
      rank: 0,
      id: series.id,
      label: series.label,
      source: series.source,
      channels: series.channels,
      value: latest.value,
      unit: series.unit,
      asOf: latest.date,
      citation: series.citation,
      relevance,
      reason: reason.join(". "),
      components: { zScore: z, percentile, changeRate: change },
    });
  }

  drivers.sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id));
  const kept = drivers.slice(0, Math.max(0, params.maxDrivers));
  for (const extra of drivers.slice(kept.length)) {
    skipped.push({
      channel: extra.channels.join("+") || "reihe",
      label: extra.label,
      status: `gemessen, nicht unter den ersten ${params.maxDrivers}`,
    });
  }
  kept.forEach((driver, index) => { driver.rank = index + 1; });
  return { drivers: kept, skipped };
}
