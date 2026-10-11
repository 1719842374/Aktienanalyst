/**
 * Lange Gold-Chart-Historie fuer die Zeitfenster 10Y und Max (GoldPriceChart).
 *
 * Reine Chart-Daten: /api/analyze-gold, GIS, adaptive Schicht, Modelle und
 * Gates bleiben bei ihrem 10-Jahres-Fenster und werden hier nicht beruehrt.
 * Der Client laedt diese Reihe nur, wenn 10Y oder Max gewaehlt wird.
 *
 * Indikatoren (MA200 hier, MA20/50/100, EMAs, MACD, RSI im Client) werden auf
 * der vollen Reihe gerechnet; erst danach wird fuer die Anzeige ausgeduennt.
 */
import type { GoldPricePoint } from "../shared/gold-schema";
import { enrichGoldChartSeries } from "./gold-chart-series";

export type FredPoint = { date: string; value: number };
export interface RawGoldRow { date: string; close: number; volume?: number | null }

/** FMP liefert hoechstens 5000 Zeilen je Abruf: Fenster zu je `chunkYears` Jahren rueckwaerts ab endDate. */
export function historyWindows(endDate: string, maxYears: number, chunkYears: number): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let to = new Date(`${endDate}T00:00:00Z`);
  const limit = new Date(to); limit.setUTCFullYear(limit.getUTCFullYear() - maxYears);
  while (to > limit) {
    const from = new Date(to); from.setUTCFullYear(from.getUTCFullYear() - chunkYears);
    if (from < limit) from.setTime(limit.getTime());
    out.push({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    to = new Date(from); to.setUTCDate(to.getUTCDate() - 1);
  }
  return out;
}

/** Zeilen aus mehreren Abrufen: gueltige Closes, je Datum einmal, aufsteigend. */
export function mergeGoldRows(chunks: any[][]): RawGoldRow[] {
  const byDate = new Map<string, RawGoldRow>();
  for (const rows of chunks) {
    for (const row of rows ?? []) {
      const date = String(row?.date ?? "").slice(0, 10);
      const close = parseFloat(String(row?.close));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isFinite(close) || close <= 0) continue;
      const volume = parseFloat(String(row?.volume ?? ""));
      byDate.set(date, { date, close, volume: Number.isFinite(volume) ? volume : null });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Laengere Quelle waehlen, ohne zu mischen (Spot und Futures liegen leicht
 * auseinander). FMP bleibt Standard; Yahoo nur, wenn es mehr als ein Jahr
 * frueher beginnt oder FMP leer ist.
 */
export function pickLongerSource(fmp: RawGoldRow[], yahoo: RawGoldRow[]): { rows: RawGoldRow[]; source: string } {
  if (fmp.length === 0) return { rows: yahoo, source: yahoo.length ? "Yahoo GC=F (Futures)" : "keine" };
  if (yahoo.length === 0) return { rows: fmp, source: "FMP GCUSD" };
  const gapDays = (Date.parse(fmp[0].date) - Date.parse(yahoo[0].date)) / 864e5;
  return gapDays > 365 ? { rows: yahoo, source: "Yahoo GC=F (Futures)" } : { rows: fmp, source: "FMP GCUSD" };
}

/** Wie in /api/analyze-gold: MA200 aus den Closes, Real10Y je Datum, dann Overlays und Volumen. */
export function buildGoldChartHistoryPoints(
  rows: RawGoldRow[],
  fred: { real10y: FredPoint[]; dxy: FredPoint[]; t10yie: FredPoint[]; walcl: FredPoint[]; m2: FredPoint[] },
): GoldPricePoint[] {
  const closes = rows.map(r => r.close);
  let points: GoldPricePoint[] = rows.map((r, i) => {
    const idx = i + 1;
    if (idx >= 200) {
      const slice = closes.slice(idx - 200, idx);
      const ma = slice.reduce((a, b) => a + b, 0) / 200;
      return { date: r.date, close: r.close, ma200: Math.round(ma * 100) / 100 };
    }
    return { date: r.date, close: r.close };
  });
  if (fred.real10y.length > 0) {
    const byDate = new Map(fred.real10y.map(p => [p.date, p.value]));
    points = points.map(p => { const v = byDate.get(p.date); return v != null ? { ...p, real10y: v } : p; });
  }
  return enrichGoldChartSeries(points, {
    dxy: fred.dxy, t10yie: fred.t10yie, walcl: fred.walcl, m2: fred.m2,
    volumes: rows.map(r => ({ date: r.date, volume: r.volume ?? NaN })),
  });
}

export type GoldSeriesKey = "close" | "real10y" | "m2Yoy" | "dxy" | "t10yie" | "walcl" | "volume";
/** Erstes/letztes Datum mit echtem Wert je Reihe — fuer ehrliche „ab JJJJ“-Hinweise. */
export function seriesCoverage(points: GoldPricePoint[]): Record<GoldSeriesKey, { from: string; to: string; count: number } | null> {
  const keys: GoldSeriesKey[] = ["close", "real10y", "m2Yoy", "dxy", "t10yie", "walcl", "volume"];
  const out = {} as Record<GoldSeriesKey, { from: string; to: string; count: number } | null>;
  for (const k of keys) {
    const hits = points.filter(p => { const v = (p as any)[k]; return typeof v === "number" && Number.isFinite(v) && (k !== "volume" || v > 0); });
    out[k] = hits.length ? { from: hits[0].date, to: hits[hits.length - 1].date, count: hits.length } : null;
  }
  return out;
}
