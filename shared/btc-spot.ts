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

/** Mindestens zehn Kalenderjahre Tageskurse. */
export const BTC_SPOT_MIN_DAYS = 3650;

export interface BtcSpotPoint {
  date: string;
  price: number;
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
