/**
 * Earnings Yield (EBIT / EV) und ROIC als Anzeige-Serien.
 * Kein Score, kein Rating. Fehlende Werte bleiben null mit Grund, nie 0.
 * Schwellen der Achse kommen aus der Serie (Quartile), Gewichte sind benannt.
 */

export const EARNINGS_YIELD_SOURCE = "FMP income-statement + enterprise-values";
export const ROIC_SOURCE = "FMP key-metrics returnOnInvestedCapital";

/** Polster, wenn eine Serie keinen Streu (IQR und Spanne 0) hat. Benannter Anzeige-Parameter. */
export const FLAT_SERIES_PAD_SHARE = 0.05;

export interface FundamentalPoint {
  date: string;
  value: number | null;
  note: string | null;
}

export interface EarningsYieldResponse {
  symbol: string;
  points: FundamentalPoint[];
  source: string;
  note: string | null;
}

export interface RoicSeriesResponse {
  symbol: string;
  points: FundamentalPoint[];
  source: string;
  note: string | null;
}

export interface FundJoinPoint {
  date: string;
  earningsYieldPct: number | null;
  roicPct: number | null;
  peerRoicPct: number | null;
  /** Peer-Kurs auf den Median des Basiskurses gezogen. null = nicht gezeichnet. */
  peerPriceIndexed: number | null;
  peerPriceRaw: number | null;
}

export function finiteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function earningsYieldPct(ebit: number | null, enterpriseValue: number | null): { value: number | null; note: string | null } {
  if (ebit == null || !Number.isFinite(ebit)) return { value: null, note: "n/a — EBIT fehlt" };
  if (enterpriseValue == null || !Number.isFinite(enterpriseValue) || enterpriseValue <= 0) {
    return { value: null, note: "n/a — Enterprise Value fehlt oder nicht positiv" };
  }
  return { value: (ebit / enterpriseValue) * 100, note: null };
}

/** Perzentil einer aufsteigend sortierten Stichprobe. p = 0 … 1. */
export function quantileSorted(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = Math.min(sorted.length - 1, Math.max(0, p * (sorted.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function medianOf(values: number[]): number | null {
  const xs = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  return quantileSorted(xs, 0.5);
}

/**
 * Rechte %-Achse. Spanne aus der Serie, Polster = halber Interquartilsabstand.
 * Keine feste Untergrenze und kein Ersatz durch 0.
 */
export function percentAxisDomain(values: Array<number | null | undefined>): [number, number] {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return [0, 1];
  const lo = xs[0];
  const hi = xs[xs.length - 1];
  const q1 = quantileSorted(xs, 0.25) ?? lo;
  const q3 = quantileSorted(xs, 0.75) ?? hi;
  const iqr = q3 - q1;
  const span = hi - lo;
  const med = quantileSorted(xs, 0.5) ?? lo;
  const pad = iqr > 0 ? iqr / 2 : span > 0 ? span / 2 : (Math.abs(med) * FLAT_SERIES_PAD_SHARE || 1);
  return [lo - pad, hi + pad];
}

export function medianIndexScale(subjectCloses: number[], peerCloses: number[]): { scale: number | null; note: string | null } {
  const subject = medianOf(subjectCloses.filter(v => v > 0));
  const peer = medianOf(peerCloses.filter(v => v > 0));
  if (subject == null || peer == null || peer === 0) {
    return { scale: null, note: "n/a — Median von Kurs oder Peer-Kurs fehlt" };
  }
  return { scale: subject / peer, note: null };
}

function asofLatest<T extends { date: string }>(sorted: T[], date: string, cursor: { i: number; last: T | null }): T | null {
  while (cursor.i < sorted.length && sorted[cursor.i].date <= date) {
    cursor.last = sorted[cursor.i];
    cursor.i += 1;
  }
  return cursor.last;
}

/**
 * Jahreswerte (Earnings Yield, ROIC) liegen per As-of auf dem letzten Stichtag
 * bis zum Kurstag. Peer-Kurse ebenso, die gezeichnete Höhe ist der Median-Index.
 * priceDates müssen aufsteigend sein.
 */
export function joinFundamentalsOntoPrices(
  priceDates: string[],
  args: {
    earningsYield: FundamentalPoint[] | null;
    roic: FundamentalPoint[] | null;
    peerRoic: FundamentalPoint[] | null;
    peerBars: { date: string; close: number }[] | null;
    subjectCloses: number[];
    showEarningsYield: boolean;
    showRoic: boolean;
    showPeerRoic: boolean;
    showPeerPrice: boolean;
  },
): FundJoinPoint[] {
  const dates = [...priceDates].sort((a, b) => a.localeCompare(b));
  const ey = (args.showEarningsYield ? args.earningsYield ?? [] : []).filter(p => p.date).sort((a, b) => a.date.localeCompare(b.date));
  const roic = (args.showRoic ? args.roic ?? [] : []).filter(p => p.date).sort((a, b) => a.date.localeCompare(b.date));
  const peerRoic = (args.showPeerRoic ? args.peerRoic ?? [] : []).filter(p => p.date).sort((a, b) => a.date.localeCompare(b.date));
  const bars = (args.showPeerPrice ? args.peerBars ?? [] : [])
    .filter(b => b.date && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const scale = args.showPeerPrice ? medianIndexScale(args.subjectCloses, bars.map(b => b.close)) : { scale: null, note: null };
  const cEy = { i: 0, last: null as FundamentalPoint | null };
  const cRoic = { i: 0, last: null as FundamentalPoint | null };
  const cPeerRoic = { i: 0, last: null as FundamentalPoint | null };
  const cPx = { i: 0, last: null as { date: string; close: number } | null };
  return dates.map(date => {
    const eyHit = asofLatest(ey, date, cEy);
    const roicHit = asofLatest(roic, date, cRoic);
    const peerRoicHit = asofLatest(peerRoic, date, cPeerRoic);
    const pxHit = asofLatest(bars, date, cPx);
    const indexed = pxHit && scale.scale != null ? pxHit.close * scale.scale : null;
    return {
      date,
      earningsYieldPct: eyHit?.value ?? null,
      roicPct: roicHit?.value ?? null,
      peerRoicPct: peerRoicHit?.value ?? null,
      peerPriceIndexed: indexed,
      peerPriceRaw: pxHit?.close ?? null,
    };
  });
}

export function latestFinite(points: FundamentalPoint[] | null | undefined): { value: number | null; note: string | null } {
  if (!points || points.length === 0) return { value: null, note: null };
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.value != null && Number.isFinite(p.value)) return { value: p.value, note: null };
  }
  const noted = [...points].reverse().find(p => p.note);
  return { value: null, note: noted?.note ?? "n/a — keine belastbare Beobachtung" };
}
