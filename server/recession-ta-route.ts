/**
 * GET /api/analyze-recession/ta?region=US|EU|AS — WORK_RECESSION_TA_CHART.
 * OHLCV of the regional ETF (SPY / VGK / ASHR) + macro overlays (VIX/VSTOXX,
 * yield curve, credit spread). Display only — no score input. Each series
 * fails soft: error string + empty points, the chart hides that overlay.
 */
import type { Express, Request, Response } from "express";
import { fmpHistoricalPrices, isFmpAvailable } from "./fmp";
import { fetchFredVolSeries, fetchVstoxxVol } from "./recession-markets";
import { realizedVol20 } from "../shared/recession-market-charts";
import {
  RECESSION_TA_BOOKS,
  diffSeries,
  normalizeBars,
  parseTaRegion,
  type MacroSeriesPayload,
  type MacroSeriesSpec,
  type RecessionTaBar,
  type RecessionTaRegion,
  type RecessionTaResponse,
} from "../shared/recession-ta";

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<RecessionTaRegion, { ts: number; data: RecessionTaResponse }>();

function isoYearsAgo(n: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

async function yahooBars(symbol: string): Promise<RecessionTaBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d`;
  // range=max silently downgrades to monthly bars; period1/period2 keeps daily.
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "Mozilla/5.0 (Aktienanalyst)" },
  });
  if (!resp.ok) throw new Error(`Yahoo HTTP ${resp.status}`);
  const json: any = await resp.json();
  const r = json?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const rows = ts.map((t, i) => ({
    date: new Date(t * 1000).toISOString().slice(0, 10),
    open: q.open?.[i],
    high: q.high?.[i],
    low: q.low?.[i],
    close: q.close?.[i],
    volume: q.volume?.[i],
  }));
  return normalizeBars(rows);
}

export async function loadEtfBars(
  symbol: string,
): Promise<{ bars: RecessionTaBar[]; source: "fmp" | "yahoo" | null; error: string | null }> {
  const errs: string[] = [];
  if (isFmpAvailable()) {
    try {
      const bars = normalizeBars(await fmpHistoricalPrices(symbol, isoYearsAgo(30)));
      if (bars.length > 250) return { bars, source: "fmp", error: null };
      errs.push(`FMP: ${bars.length} Bars`);
    } catch (e: any) {
      errs.push(`FMP: ${String(e?.message ?? e).slice(0, 80)}`);
    }
  } else {
    errs.push("FMP nicht konfiguriert");
  }
  try {
    const bars = await yahooBars(symbol);
    if (bars.length > 250) return { bars, source: "yahoo", error: null };
    errs.push(`Yahoo: ${bars.length} Bars`);
  } catch (e: any) {
    errs.push(`Yahoo: ${String(e?.message ?? e).slice(0, 80)}`);
  }
  return { bars: [], source: null, error: errs.join(" · ") };
}

async function loadSeries(
  region: RecessionTaRegion,
  spec: MacroSeriesSpec,
  bars: RecessionTaBar[],
): Promise<MacroSeriesPayload> {
  const base = { id: spec.id, label: spec.label, unit: spec.unit, frequency: spec.frequency };
  const cosd = isoYearsAgo(30);
  try {
    let points: { date: string; value: number }[] = [];
    let source = spec.fred.join(" − ");
    if (spec.id === "vol" && region === "AS") {
      points = realizedVol20(bars.map(b => ({ date: b.date, close: b.close })));
      source = "Realized Vol 20T aus ASHR-Schlusskursen";
    } else if (spec.id === "vol" && region === "EU") {
      const today = new Date().toISOString().slice(0, 10);
      const v = await fetchVstoxxVol(cosd, today);
      points = v.vol;
      source = v.source === "stoxx" ? "STOXX V2TX" : v.source === "fmp" ? "FMP ^V2TX" : "V2TX";
      if (!points.length) return { ...base, source, points: [], error: v.stoxxErr || "VSTOXX nicht verfügbar" };
    } else if (spec.fred.length === 2) {
      const [a, b] = await Promise.all(spec.fred.map(id => fetchFredVolSeries(id, cosd)));
      points = diffSeries(a, b);
      source = `FRED ${spec.fred[0]} − ${spec.fred[1]}`;
    } else {
      points = await fetchFredVolSeries(spec.fred[0], cosd);
      source = `FRED ${spec.fred[0]}`;
    }
    if (!points.length) return { ...base, source, points: [], error: "keine Daten" };
    return { ...base, source, points, error: null };
  } catch (e: any) {
    return { ...base, source: spec.fred.join(" − "), points: [], error: String(e?.message ?? e).slice(0, 120) };
  }
}

export async function buildRecessionTa(region: RecessionTaRegion): Promise<RecessionTaResponse> {
  const book = RECESSION_TA_BOOKS[region];
  const etf = await loadEtfBars(book.etf);
  const specs = Object.values(book.series).filter((s): s is MacroSeriesSpec => !!s);
  const series = await Promise.all(specs.map(s => loadSeries(region, s, etf.bars)));
  return {
    region,
    label: book.label,
    etf: book.etf,
    ohlcv: etf.bars,
    ohlcvSource: etf.source,
    ohlcvError: etf.error,
    series,
  };
}

export function registerRecessionTaRoute(app: Express) {
  app.get("/api/analyze-recession/ta", async (req: Request, res: Response) => {
    const region = parseTaRegion(req.query.region);
    const hit = cache.get(region);
    if (hit && Date.now() - hit.ts < TTL_MS) return res.json(hit.data);
    try {
      const data = await buildRecessionTa(region);
      // Only pin complete payloads; partial ones retry on the next request.
      if (data.ohlcv.length > 0 && data.series.every(s => !s.error)) cache.set(region, { ts: Date.now(), data });
      res.json(data);
    } catch (err: any) {
      console.error("[RECESSION-TA]", err?.message);
      // n/a instead of 5xx: the section renders its own empty state.
      res.json({
        region,
        label: RECESSION_TA_BOOKS[region].label,
        etf: RECESSION_TA_BOOKS[region].etf,
        ohlcv: [],
        ohlcvSource: null,
        ohlcvError: String(err?.message ?? err).slice(0, 120),
        series: [],
      } satisfies RecessionTaResponse);
    }
  });
}
