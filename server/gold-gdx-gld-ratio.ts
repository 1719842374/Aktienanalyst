/**
 * FW-16: GDX/GLD-Verhältnis (Goldminen-ETF / Gold-ETF). Nur Anzeige auf /gold,
 * kein Score-Eingang: eigene Route, /api/analyze-gold, GIS und Gold-Score
 * bleiben unberührt. ETFs dienen hier ausschließlich als Preis-Proxy
 * (Minen vs. Metall), nicht als Analyseobjekt im Aktien-Dashboard.
 *
 * Quelle: Yahoo Chart API (v8/finance/chart, range=1y, interval=1d) für GDX und
 * GLD, frei ohne Key. Ratio nur aus Schlusskursen vom selben Handelstag (UTC),
 * sonst n/a mit Grund.
 *
 * Datenfluss: GoldSilverRatioRow → GdxGldRatioRow (useQuery) →
 * GET /api/gdx-gld-ratio → registerGdxGldRatioRoute → yahooChart1y → Yahoo.
 */
import type { Express } from "express";

export interface GdxGldRatio {
  /** letzte Ratio GDX/GLD (Schlusskurse desselben Tages) */
  ratio: number | null;
  gdx: number | null;
  gld: number | null;
  /** Handelstag (YYYY-MM-DD) der letzten gemeinsamen Schlusskurse */
  asOf: string | null;
  /** 1-Jahres-Kontext aus gemeinsamen Handelstagen; null, wenn < MIN_POINTS */
  min1y: number | null;
  max1y: number | null;
  /** Veränderung der Ratio über die Spanne in % */
  change1yPct: number | null;
  /** Lage der aktuellen Ratio in der 1J-Spanne, 0 = Tief, 100 = Hoch */
  rangePct: number | null;
  points: number;
  firstDate: string | null;
  source: string;
  unavailableReason: string | null;
}

export const GDX_GLD_SOURCE = "Yahoo Chart GDX / GLD (Schlusskurse 1J, täglich)";
export const GDX_GLD_CACHE_TTL_MS = 30 * 60 * 1000;
export const GDX_GLD_MIN_POINTS = 20;

type Chart = unknown;

const pos = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Yahoo-Chart → Map Datum → Schlusskurs (nur gültige Werte). */
export function closesByDate(chart: Chart): Map<string, number> {
  const out = new Map<string, number>();
  const r = (chart as any)?.chart?.result?.[0];
  const ts: unknown[] = Array.isArray(r?.timestamp) ? r.timestamp : [];
  const cl: unknown[] = Array.isArray(r?.indicators?.quote?.[0]?.close) ? r.indicators.quote[0].close : [];
  ts.forEach((t, i) => {
    const c = pos(cl[i]);
    if (typeof t !== "number" || !Number.isFinite(t) || c == null) return;
    out.set(new Date(t * 1000).toISOString().slice(0, 10), c);
  });
  return out;
}

const empty = (reason: string, gdx: number | null = null, gld: number | null = null): GdxGldRatio => ({
  ratio: null, gdx, gld, asOf: null, min1y: null, max1y: null, change1yPct: null, rangePct: null,
  points: 0, firstDate: null, source: GDX_GLD_SOURCE, unavailableReason: reason,
});

export function computeGdxGldRatio(gdxChart: Chart, gldChart: Chart): GdxGldRatio {
  const a = closesByDate(gdxChart);
  const b = closesByDate(gldChart);
  if (a.size === 0 && b.size === 0) return empty("keine Kursdaten (GDX und GLD)");
  if (a.size === 0) return empty("GDX-Kurse fehlen");
  if (b.size === 0) return empty("GLD-Kurse fehlen");
  const dates = Array.from(a.keys()).filter(d => b.has(d)).sort();
  if (dates.length === 0) return empty("kein gemeinsamer Handelstag GDX/GLD");
  const series = dates.map(d => a.get(d)! / b.get(d)!);
  const last = dates[dates.length - 1];
  const ratio = series[series.length - 1];
  const base = { ratio, gdx: a.get(last)!, gld: b.get(last)!, asOf: last, points: dates.length, firstDate: dates[0], source: GDX_GLD_SOURCE };
  if (dates.length < GDX_GLD_MIN_POINTS) {
    return { ...base, min1y: null, max1y: null, change1yPct: null, rangePct: null, unavailableReason: `1J-Kontext n/a: nur ${dates.length} gemeinsame Handelstage` };
  }
  const min1y = Math.min(...series);
  const max1y = Math.max(...series);
  return {
    ...base, min1y, max1y,
    change1yPct: (ratio / series[0] - 1) * 100,
    rangePct: max1y > min1y ? ((ratio - min1y) / (max1y - min1y)) * 100 : null,
    unavailableReason: null,
  };
}

export async function yahooChart1y(symbol: string): Promise<Chart> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

interface Deps {
  chart: (symbol: string) => Promise<Chart>;
  now?: () => number;
}

export function registerGdxGldRatioRoute(app: Express, deps: Deps = { chart: yahooChart1y }) {
  const now = deps.now ?? Date.now;
  let cache: { at: number; value: GdxGldRatio } | null = null;
  let inFlight: Promise<GdxGldRatio> | null = null;
  app.get("/api/gdx-gld-ratio", async (_req, res) => {
    if (cache && now() - cache.at < GDX_GLD_CACHE_TTL_MS) return res.json(cache.value);
    try {
      inFlight ??= (async () => {
        const [g, l] = await Promise.all([deps.chart("GDX").catch(() => null), deps.chart("GLD").catch(() => null)]);
        const value = computeGdxGldRatio(g, l);
        // n/a nicht lange halten: nur Werte mit Ratio cachen
        if (value.ratio != null) cache = { at: now(), value };
        return value;
      })().finally(() => { inFlight = null; });
      res.json(await inFlight);
    } catch (e: any) {
      res.json(empty(String(e?.message || e)));
    }
  });
}
