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
  /** Die Punkte sind schon die YoY-Rate in Prozent. Der Indexstand steht hier nicht. */
  reading?: "yoy";
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
  /** Übernommen von der Reihe. `yoy`: `value` ist die YoY-Rate in Prozent. */
  reading?: "yoy";
  relevance: number;
  reason: string;
  components: PodcastDriverComponents;
}

/**
 * Nur Schwellen, die sich nicht aus der Reihe selbst ergeben.
 * minHistoryForZ / minHistoryForPercentile: Sample-Varianz und ein Rang
 * innerhalb einer Verteilung brauchen eine Stichprobe. Acht Punkte sind die
 * kleinste Größe, bei der ein einzelner Historienpunkt unter einem Siebtel
 * der Stichprobe bleibt. Darunter ist der z-Score n/a, nicht ein Ersatzwert.
 * minHistoryForChange: eine Änderung braucht zwei Punkte.
 * zScale: der z-Score ist schon in Sigmas der eigenen Reihe. Die Stauchung
 * bezieht sich auf ein Sigma. Eine zweite Volatilität würde dieselbe Reihe
 * doppelt zählen.
 * sigmaFloor: darunter ist die Streuung numerischer Staub, der z-Score wäre
 * nicht mehr die Reihe.
 * Gewichte, maxDrivers und changeScale stehen hier nicht. Die leitet
 * rankPodcastDrivers aus den Scores und aus der eigenen Änderungshistorie ab.
 */
export const PODCAST_DRIVER_PARAMS = {
  minHistoryForZ: 8,
  minHistoryForPercentile: 8,
  minHistoryForChange: 2,
  zScale: 1,
  sigmaFloor: 1e-12,
};

export interface PodcastDriverWeights {
  zScore: number;
  percentileDeviation: number;
  changeRate: number;
}

export interface PodcastDriverParams {
  minHistoryForZ: number;
  minHistoryForPercentile: number;
  minHistoryForChange: number;
  zScale: number;
  sigmaFloor: number;
  /** Nur ein Override. Fehlt er, kommen die Gewichte aus der Stichprobengröße. */
  weights?: PodcastDriverWeights;
  /** Nur ein Override. Fehlt er, schneidet der Ellbogen der Relevanz. */
  maxDrivers?: number;
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

/**
 * Typische absolute Änderungsrate der Reihe, ohne den letzten Schritt.
 * Median, damit ein einzelner Sprung in der Historie die Skala nicht setzt.
 * Ein Median von 0 oder keine vorherige Änderung: null, kein Ersatzwert.
 */
export function changeScaleFromSeries(values: number[]): { scale: number | null; sample: number } {
  const changes: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    const previous = values[i - 1];
    const current = values[i];
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) continue;
    const rate = Math.abs((current - previous) / previous);
    if (Number.isFinite(rate)) changes.push(rate);
  }
  if (!changes.length) return { scale: null, sample: 0 };
  const sorted = changes.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
  if (!(median > 0)) return { scale: null, sample: changes.length };
  return { scale: median, sample: changes.length };
}

/**
 * Wie viele der absteigend sortierten Scores bleiben.
 * Mindestens drei Scores, sonst gibt es keinen zweiten Abstand und keinen Ellbogen.
 * Bei einem positiven größten Abstand: Schnitt hinter diesem Ellbogen.
 * Sind alle Abstände 0, gibt es keine Stufe. Dann bleiben Scores über dem Median.
 * Liegt keiner darüber, bleiben alle, weil ein Schnitt ohne Stufe willkürlich wäre.
 */
export function driverKeepCount(scores: number[]): { count: number; method: "ellbogen" | "median" | "alle" } {
  if (scores.length < 3) return { count: scores.length, method: "alle" };
  const sorted = scores.slice().sort((a, b) => b - a);
  let bestGap = 0;
  let elbowAt = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i]! - sorted[i + 1]!;
    if (gap > bestGap) {
      bestGap = gap;
      elbowAt = i;
    }
  }
  if (bestGap > 0) return { count: elbowAt + 1, method: "ellbogen" };
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const above = sorted.filter(score => score > median).length;
  if (above > 0) return { count: above, method: "median" };
  return { count: sorted.length, method: "alle" };
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
    const volatility = changeScaleFromSeries(points.map(point => point.value));

    const override = params.weights;
    const zWeight = z == null ? 0 : (override ? override.zScore : history.length);
    const percentileWeight = percentile == null ? 0 : (override ? override.percentileDeviation : points.length);
    const changeWeight = change == null || volatility.scale == null
      ? 0
      : (override ? override.changeRate : volatility.sample);

    const parts: Array<{ weight: number; score: number }> = [];
    if (z != null && zWeight > 0) {
      parts.push({ weight: zWeight, score: squash(Math.abs(z), params.zScale) });
    }
    if (percentile != null && percentileWeight > 0) {
      parts.push({
        weight: percentileWeight,
        score: Math.abs(percentile - 0.5) * 2,
      });
    }
    if (change != null && volatility.scale != null && changeWeight > 0) {
      parts.push({ weight: changeWeight, score: squash(Math.abs(change), volatility.scale) });
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
    if (series.reading === "yoy") {
      reason.push(`YoY ${formatNum(latest.value)} % zum Stand ${latest.date}`);
      if (change != null && volatility.scale != null) {
        reason.push(`Relative Änderung dieser YoY-Rate gegen den vorherigen Punkt: ${formatNum(change * 100)} Prozent des vorherigen YoY-Werts, gerechnet als (aktueller YoY − vorheriger YoY) / |vorheriger YoY|. Das ist nicht die Inflationsrate. Skala Median ${formatNum(volatility.scale * 100)} Prozent aus ${volatility.sample} früheren Änderungen`);
      } else if (previous.value === 0) reason.push("Relative Änderung dieser YoY-Rate n/a — Vorwert ist 0");
      else if (change != null) reason.push("Relative Änderung dieser YoY-Rate n/a — eigene Volatilität nicht bestimmbar");
      else reason.push("Relative Änderung dieser YoY-Rate n/a — Vorwert fehlt");
    } else if (change != null && volatility.scale != null) {
      reason.push(`Änderungsrate ${formatNum(change * 100)} Prozent gegen den vorherigen Punkt, Skala Median ${formatNum(volatility.scale * 100)} Prozent aus ${volatility.sample} früheren Änderungen`);
    } else if (previous.value === 0) reason.push("Änderungsrate n/a — Vorwert ist 0");
    else if (change != null) reason.push("Änderungsrate n/a — eigene Volatilität nicht bestimmbar");
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
      reading: series.reading,
      citation: series.citation,
      relevance,
      reason: reason.join(". "),
      components: { zScore: z, percentile, changeRate: change },
    });
  }

  drivers.sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id));
  const adaptive = driverKeepCount(drivers.map(driver => driver.relevance));
  const cap = params.maxDrivers != null
    ? Math.min(adaptive.count, Math.max(0, params.maxDrivers))
    : adaptive.count;
  const kept = drivers.slice(0, cap);
  const cutReason = adaptive.method === "ellbogen"
    ? "gemessen, unter dem Ellbogen der Relevanz"
    : adaptive.method === "median"
      ? "gemessen, nicht über dem Median der Relevanz"
      : "gemessen, hinter dem benannten Override";
  for (const extra of drivers.slice(kept.length)) {
    skipped.push({
      channel: extra.channels.join("+") || "reihe",
      label: extra.label,
      status: params.maxDrivers != null && adaptive.count > params.maxDrivers ? "gemessen, hinter dem benannten Override" : cutReason,
    });
  }
  kept.forEach((driver, index) => { driver.rank = index + 1; });
  return { drivers: kept, skipped };
}
