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
 * dadurch etwa im Mai 2021. Das Börsen-trade-volume derselben Quelle ist bis
 * 2012 praktisch 0. estimated-transaction-volume-usd ist täglich und ab
 * August 2010 größer als 0, also über die Kursreihe hinweg vorhanden.
 */
export const BTC_VOLUME_SOURCE_LABEL = "blockchain.info estimated-transaction-volume-usd (timespan=all, sampled=false, täglich, On-Chain-USD)";
export const BTC_VOLUME_SOURCE_URL =
  "https://api.blockchain.info/charts/estimated-transaction-volume-usd?timespan=all&format=json&sampled=false&cors=true";

/** Untere Balkenhöhe eines Tages mit Volumen > 0, damit 2010 neben 2021 sichtbar bleibt. */
export const BTC_VOLUME_BAR_FLOOR = 0.12;

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
 * Volumen gilt nur mit Betrag > 0. Ein Börsenchart, der bis 2012 nur Nullen
 * hat und erst 2013 oder 2021 einsetzt, fällt durch. Der erste positive Tag
 * darf ein paar Tage nach dem ersten Kurs liegen.
 */
export function assessBtcTradeVolumeCoverage(
  prices: readonly { date: string }[],
  volumes: readonly { date: string; volume?: number }[],
  maxLagDays: number = BTC_VOLUME_MAX_LAG_DAYS,
): BtcVolumeCoverage {
  const priceDates = prices.map((point) => point.date).sort();
  const volumeDates = new Set(
    volumes.filter((point) => typeof point.volume === "number" && point.volume > 0).map((point) => point.date),
  );
  // Beleg: volumeDates ist das Set der Tage mit Volumen > 0. Spread bleibt das Set.
  const volumeSorted = [...(volumeDates as unknown as string[])].sort();
  const firstPrice = priceDates[0] ?? null;
  const lastPrice = priceDates[priceDates.length - 1] ?? null;
  const firstVolume = volumeSorted[0] ?? null;
  const lastVolume = volumeSorted[volumeSorted.length - 1] ?? null;
  const before = priceDates.filter((date) => date < "2021-01-01");
  const before2017 = priceDates.filter((date) => date < "2017-01-01");
  const matchedBefore2021 = before.filter((date) => volumeDates.has(date)).length;
  const matchedBefore2017 = before2017.filter((date) => volumeDates.has(date)).length;
  const matchedDays = priceDates.filter((date) => volumeDates.has(date)).length;
  const startedSoon = firstPrice != null && firstVolume != null && firstVolume <= shiftUtcDays(firstPrice, 30);
  const recent = lastPrice != null && lastVolume != null && lastVolume >= shiftUtcDays(lastPrice, -maxLagDays);
  const earlyRatio = before.length === 0 ? 1 : matchedBefore2021 / before.length;
  const earlyOk = before.length === 0 || (earlyRatio >= 0.95 && matchedBefore2021 >= Math.min(before.length, 1000));
  const pre2017Ratio = before2017.length === 0 ? 1 : matchedBefore2017 / before2017.length;
  const pre2017Ok = before2017.length < 365 || pre2017Ratio >= 0.9;
  const overallOk = priceDates.length > 0 && matchedDays / priceDates.length >= 0.95;
  let reason: string | null = null;
  if (!firstPrice || !lastPrice) reason = "BTC-Volumen: keine Kurstage";
  else if (!startedSoon) reason = `BTC-Volumen beginnt ${firstVolume ?? "nie"}, Kurs beginnt ${firstPrice}`;
  else if (!pre2017Ok) reason = `BTC-Volumen vor 2017 nur ${matchedBefore2017} von ${before2017.length} Kurstagen größer als 0`;
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

/**
 * Balkenhöhe 0–1. Logarithmisch, mit einem Boden für jeden Tag > 0.
 * Linear am Maximum verschluckt 2010–2016, weil das On-Chain-Volumen dort
 * ein Bruchteil der späteren Spitzen ist. Der Tooltip bleibt der USD-Betrag.
 */
export function normalizeBtcVolumeBars(volumes: readonly number[], floor = BTC_VOLUME_BAR_FLOOR): number[] {
  const logs: number[] = [];
  for (const volume of volumes) {
    if (volume > 0) logs.push(Math.log10(volume));
  }
  if (logs.length === 0) return volumes.map(() => 0);
  const min = Math.min(...logs);
  const max = Math.max(...logs);
  const span = max - min;
  return volumes.map((volume) => {
    if (!(volume > 0)) return 0;
    if (span === 0) return 1;
    const t = (Math.log10(volume) - min) / span;
    return floor + (1 - floor) * t;
  });
}

export function formatBtcVolumeUsd(volume: number): string {
  if (volume >= 1e9) return `${(volume / 1e9).toFixed(2)}B`;
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(2)}M`;
  if (volume >= 1e3) return `${(volume / 1e3).toFixed(1)}K`;
  return volume.toFixed(0);
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
