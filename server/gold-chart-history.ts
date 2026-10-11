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

/**
 * FMP-Fenster nacheinander laden. Ein leeres Fenster ist das normale Ende der
 * Historie; ein Fehler mitten in der Reihe heisst: was davor kam, ist gueltig,
 * aber die Historie ist UNVOLLSTAENDIG (darf nicht 6 h gecacht werden).
 */
export async function fetchFmpChunks(
  windows: Array<{ from: string; to: string }>,
  fetchWindow: (from: string, to: string) => Promise<any[]>,
): Promise<{ chunks: any[][]; failedWindow: { from: string; to: string; error: string } | null }> {
  const chunks: any[][] = [];
  for (const w of windows) {
    let rows: any[];
    try {
      rows = await fetchWindow(w.from, w.to);
    } catch (e: any) {
      return { chunks, failedWindow: { ...w, error: String(e?.message ?? e).substring(0, 120) } };
    }
    if (!rows || rows.length === 0) break;
    chunks.push(rows);
  }
  return { chunks, failedWindow: null };
}

export const CHART_HISTORY_TTL_MS = 6 * 60 * 60 * 1000;
/** Unvollstaendige Historie hoechstens 10 min halten, dann neu versuchen. */
export const CHART_HISTORY_INCOMPLETE_TTL_MS = 10 * 60 * 1000;

/**
 * Cache mit In-Flight-Sperre: gleichzeitige erste Anfragen teilen sich EINEN
 * Ladevorgang. Vollstaendige Antworten gelten 6 h, unvollstaendige (oder mit
 * `shortCache`, z. B. FMP-Fehler bei Yahoo-Anzeige) 10 min,
 * Fehler werden nicht gecacht.
 */
export function createChartHistoryCache<T extends { incomplete?: boolean; shortCache?: boolean }>(
  load: () => Promise<T>,
  now: () => number = Date.now,
) {
  let cached: { at: number; body: T } | null = null;
  let inFlight: Promise<T> | null = null;
  return {
    get(): Promise<T> {
      if (cached) {
        const ttl = cached.body.incomplete || cached.body.shortCache ? CHART_HISTORY_INCOMPLETE_TTL_MS : CHART_HISTORY_TTL_MS;
        if (now() - cached.at < ttl) return Promise.resolve(cached.body);
      }
      if (inFlight) return inFlight;
      inFlight = load()
        .then(body => { cached = { at: now(), body }; return body; })
        .finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}
