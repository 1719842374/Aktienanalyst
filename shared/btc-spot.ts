/**
 * Tägliche BTC-Spot-Historie.
 *
 * Krypto handelt an jedem Kalendertag. Zehn Jahre sind deshalb 3650 Tage,
 * nicht die 2520 Börsentage der Aktien-TA.
 *
 * blockchain.info `timespan=all` ohne `sampled=false` ist kein Tagesraster:
 * die Antwort vom 2026-11-02 hat 1628 Punkte seit 2009 und im 10-Jahres-Fenster
 * 913 Punkte bei exakt 4 Tagen Abstand. Mit `sampled=false` ist dasselbe
 * Diagramm täglich (6509 Punkte, 3651 davon in den letzten 3650 Tagen).
 */

export const BTC_SPOT_SOURCE_LABEL = "blockchain.info market-price (timespan=all, sampled=false, täglich)";
export const BTC_SPOT_SOURCE_URL =
  "https://api.blockchain.info/charts/market-price?timespan=all&format=json&sampled=false&cors=true";

/**
 * USD-Handelsvolumen derselben Tagesquelle.
 * Binance-Klines liefern höchstens 1000 Tage pro Abruf; zwei Fenster enden
 * dadurch etwa im Mai 2021, wenn der Kurs bis 2010 reicht. trade-volume mit
 * sampled=false ist dasselbe Tagesraster wie der Kurs, ab 2009.
 */
export const BTC_VOLUME_SOURCE_LABEL = "blockchain.info trade-volume (timespan=all, sampled=false, täglich, USD)";
export const BTC_VOLUME_SOURCE_URL =
  "https://api.blockchain.info/charts/trade-volume?timespan=all&format=json&sampled=false&cors=true";

/** Die Volumenreihe darf ein paar Tage hinter dem letzten Kurs zurückliegen. */
export const BTC_VOLUME_MAX_LAG_DAYS = 21;

/** Mindestens zehn Kalenderjahre Tageskurse. */
export const BTC_SPOT_MIN_DAYS = 3650;

export interface BtcSpotPoint {
  date: string;
  price: number;
  /** USD-Handelsvolumen dieses Kalendertags. 0 = gemeldet leer oder kein Treffer. */
  volume?: number;
}

export interface BtcTradeVolumePoint {
  date: string;
  volume: number;
}

export interface BtcSpotCoverage {
  ok: boolean;
  count: number;
  first: string | null;
  last: string | null;
  /** Punkte mit Datum >= letzter Punkt minus 3650 Tage. */
  pointsInTenYears: number;
  /** Kalendertage zwischen dem ersten und dem letzten Punkt dieses Fensters. */
  spanDays: number;
  medianGapDays: number | null;
  reason: string | null;
}

export function normalizeBlockchainMarketPrice(raw: unknown): BtcSpotPoint[] {
  const values = raw && typeof raw === "object" && Array.isArray((raw as { values?: unknown }).values)
    ? (raw as { values: unknown[] }).values
    : [];
  const byDate = new Map<string, number>();
  for (const row of values) {
    if (!row || typeof row !== "object") continue;
    const x = (row as { x?: unknown }).x;
    const y = (row as { y?: unknown }).y;
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (typeof y !== "number" || !Number.isFinite(y) || y <= 0) continue;
    const date = new Date(x * 1000).toISOString().slice(0, 10);
    byDate.set(date, y);
  }
  const points: BtcSpotPoint[] = [];
  byDate.forEach((price, date) => {
    points.push({ date, price });
  });
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return points;
}

/** Gleicher blockchain.info-Chart, y ist USD-Volumen. Null ist ein echter Wert. */
export function normalizeBlockchainTradeVolume(raw: unknown): BtcTradeVolumePoint[] {
  const values = raw && typeof raw === "object" && Array.isArray((raw as { values?: unknown }).values)
    ? (raw as { values: unknown[] }).values
    : [];
  const byDate = new Map<string, number>();
  for (const row of values) {
    if (!row || typeof row !== "object") continue;
    const x = (row as { x?: unknown }).x;
    const y = (row as { y?: unknown }).y;
    if (typeof x !== "number" || !Number.isFinite(x)) continue;
    if (typeof y !== "number" || !Number.isFinite(y) || y < 0) continue;
    const date = new Date(x * 1000).toISOString().slice(0, 10);
    byDate.set(date, y);
  }
  const points: BtcTradeVolumePoint[] = [];
  byDate.forEach((volume, date) => {
    points.push({ date, volume });
  });
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return points;
}

export function attachBtcTradeVolume<T extends { date: string }>(
  prices: readonly T[],
  volumes: readonly BtcTradeVolumePoint[],
): Array<T & { volume: number }> {
  const byDate = new Map<string, number>();
  for (const point of volumes) byDate.set(point.date, point.volume);
  return prices.map((point) => ({
    ...point,
    volume: byDate.get(point.date) ?? 0,
  }));
}

export interface BtcVolumeCoverage {
  ok: boolean;
  priceDays: number;
  matchedDays: number;
  before2021: number;
  matchedBefore2021: number;
  firstPrice: string | null;
  lastPrice: string | null;
  lastVolume: string | null;
  reason: string | null;
}

/**
 * Volumen gilt nur, wenn es den ersten Kurstag trifft, vor 2021 fast jeden
 * Kurstag abdeckt und bis nahe an den letzten Kurs reicht. Eine Reihe, die
 * erst 2021 einsetzt, fällt durch — das ist der abgeschnittene Binance-Stand.
 */
export function assessBtcTradeVolumeCoverage(
  prices: readonly { date: string }[],
  volumes: readonly { date: string }[],
  maxLagDays: number = BTC_VOLUME_MAX_LAG_DAYS,
): BtcVolumeCoverage {
  const priceDates = prices.map((point) => point.date).sort();
  const volumeDates = new Set(volumes.map((point) => point.date));
  const volumeSorted = [...volumeDates].sort();
  const firstPrice = priceDates[0] ?? null;
  const lastPrice = priceDates[priceDates.length - 1] ?? null;
  const lastVolume = volumeSorted[volumeSorted.length - 1] ?? null;
  const before = priceDates.filter((date) => date < "2021-01-01");
  const matchedBefore2021 = before.filter((date) => volumeDates.has(date)).length;
  const matchedDays = priceDates.filter((date) => volumeDates.has(date)).length;
  const firstCovered = firstPrice != null && volumeDates.has(firstPrice);
  const recent = lastPrice != null && lastVolume != null && lastVolume >= shiftUtcDays(lastPrice, -maxLagDays);
  const earlyRatio = before.length === 0 ? 1 : matchedBefore2021 / before.length;
  const earlyOk = before.length === 0 || (earlyRatio >= 0.95 && matchedBefore2021 >= Math.min(before.length, 1000));
  const overallOk = priceDates.length > 0 && matchedDays / priceDates.length >= 0.95;
  let reason: string | null = null;
  if (!firstPrice || !lastPrice) reason = "BTC-Volumen: keine Kurstage";
  else if (!firstCovered) reason = `BTC-Volumen beginnt nach dem ersten Kurstag ${firstPrice}`;
  else if (!earlyOk) reason = `BTC-Volumen deckt vor 2021 nur ${matchedBefore2021} von ${before.length} Kurstagen`;
  else if (!recent) reason = `BTC-Volumen endet ${lastVolume ?? "nie"}, Kurs endet ${lastPrice}`;
  else if (!overallOk) reason = `BTC-Volumen trifft nur ${matchedDays} von ${priceDates.length} Kurstagen`;
  return {
    ok: reason == null,
    priceDays: priceDates.length,
    matchedDays,
    before2021: before.length,
    matchedBefore2021,
    firstPrice,
    lastPrice,
    lastVolume,
    reason,
  };
}

function utcMs(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function shiftUtcDays(iso: string, days: number): string {
  return new Date(utcMs(iso) + days * 86400000).toISOString().slice(0, 10);
}

function daysBetween(earlier: string, later: string): number {
  return Math.round((utcMs(later) - utcMs(earlier)) / 86400000);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Eine brauchbare 10-Jahres-Reihe hat im Fenster ab dem letzten Punkt
 * mindestens 3650 Tagespunkte und einen Medianabstand von einem Tag.
 * Ein 4-Tage-Raster über zehn Jahre spannt zwar die Kalenderachse, fällt
 * aber bei der Punktzahl durch.
 */
export function assessBtcSpotCoverage(
  points: readonly BtcSpotPoint[],
  minDays: number = BTC_SPOT_MIN_DAYS,
): BtcSpotCoverage {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const last = sorted[sorted.length - 1]?.date ?? null;
  const first = sorted[0]?.date ?? null;
  if (!last || !first) {
    return {
      ok: false,
      count: 0,
      first: null,
      last: null,
      pointsInTenYears: 0,
      spanDays: 0,
      medianGapDays: null,
      reason: "BTC-Spot-Historie leer",
    };
  }
  const cutoff = shiftUtcDays(last, -minDays);
  const inWindow = sorted.filter((point) => point.date >= cutoff && point.date <= last);
  const gaps: number[] = [];
  for (let i = 1; i < inWindow.length; i++) {
    gaps.push(daysBetween(inWindow[i - 1].date, inWindow[i].date));
  }
  const medianGapDays = median(gaps);
  const spanDays = inWindow.length >= 2 ? daysBetween(inWindow[0].date, inWindow[inWindow.length - 1].date) : 0;
  const daily = medianGapDays != null && medianGapDays <= 1;
  const enough = inWindow.length >= minDays && spanDays >= minDays - 1;
  let reason: string | null = null;
  if (!enough || !daily) {
    const gapText = medianGapDays == null ? "kein Abstand" : `Medianabstand ${medianGapDays} Tage`;
    reason = `nur ${inWindow.length} Punkte im 10-Jahres-Fenster (Spanne ${spanDays} Tage, ${gapText}), gebraucht werden ${minDays} Tagespunkte`;
  }
  return {
    ok: enough && daily,
    count: sorted.length,
    first,
    last,
    pointsInTenYears: inWindow.length,
    spanDays,
    medianGapDays,
    reason,
  };
}

export interface BtcChartPriceSlices {
  allPrices?: readonly BtcSpotPoint[] | null;
  prices10Y?: readonly BtcSpotPoint[] | null;
  prices5Y?: readonly BtcSpotPoint[] | null;
  prices3Y?: readonly BtcSpotPoint[] | null;
}

/**
 * Spot-Linie der Miner-Zone. Das Zeitfenster schneidet nur die Anzeige.
 * prices5Y ist kein Ersatz: damit beginnt die Linie bei 10Y etwa fünf Jahre
 * zu spät, während Breakeven und Realized Price weiter zurückreichen.
 */
export function minerSpotPriceSeries(chartData: BtcChartPriceSlices | null | undefined): BtcSpotPoint[] {
  const full = chartData?.allPrices;
  if (!full || full.length === 0) return [];
  return full.map((point) => ({ date: point.date, price: point.price }));
}
