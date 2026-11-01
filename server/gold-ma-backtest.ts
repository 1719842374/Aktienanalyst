/**
 * F10-33: MA-Kreuz-Backtest auf der Gold-Schlussreihe (FMP GCUSD, sonst Yahoo GC=F).
 * Dieselbe Quellenwahl wie die Chart-Historie. Kein GIS, keine neue Datenquelle.
 */
import { fmpHistoricalPrices } from "./fmp";
import { yahooFetch } from "./history-fallback";
import {
  CHART_HISTORY_TTL_MS,
  fetchFmpChunks,
  historyWindows,
  mergeGoldRows,
  pickLongerSource,
} from "./gold-chart-history";
import { MA_FAST, MA_SLOW } from "./gold-adaptive-score";
import {
  backtestGoldMaCrosses,
  type GoldClosePoint,
  type GoldMaBacktestResponse,
} from "../shared/gold-ma-backtest";

export interface GoldMaBacktestDeps {
  now: () => string;
  fetchFmp: (from: string, to: string) => Promise<any[]>;
  fetchYahoo: (symbol: string, from: string, to: string) => Promise<Array<{ date: string; close: number }>>;
}

let cached: { at: number; body: GoldMaBacktestResponse } | null = null;

export function resetGoldMaBacktestCache(): void {
  cached = null;
}

function unavailable(reason: string, fastPeriod: number, slowPeriod: number): GoldMaBacktestResponse {
  const text = reason.startsWith("n/a") ? reason : `n/a — ${reason}`;
  return {
    affectsScore: false,
    available: false,
    reason: text,
    source: null,
    pointCount: null,
    from: null,
    to: null,
    fastPeriod,
    slowPeriod,
    golden: null,
    death: null,
  };
}

export async function loadGoldCloseSeries(deps: GoldMaBacktestDeps): Promise<{ points: GoldClosePoint[]; source: string }> {
  const endDate = deps.now();
  const fmp = await fetchFmpChunks(historyWindows(endDate, 60, 15), deps.fetchFmp);
  const fmpRows = mergeGoldRows(fmp.chunks);
  let yahooRows: ReturnType<typeof mergeGoldRows> = [];
  try {
    const bars = await deps.fetchYahoo("GC=F", "1970-01-01", endDate);
    yahooRows = mergeGoldRows([bars.map(bar => ({ date: bar.date, close: bar.close }))]);
  } catch (err: any) {
    console.warn(`[GOLD-MA-BACKTEST] Yahoo GC=F: ${err?.message?.substring(0, 120)}`);
  }
  const picked = pickLongerSource(fmpRows, yahooRows);
  return {
    points: picked.rows.map(row => ({ date: row.date, close: row.close })),
    source: picked.rows.length ? picked.source : "",
  };
}

export async function loadGoldMaBacktest(deps?: GoldMaBacktestDeps): Promise<GoldMaBacktestResponse> {
  if (!deps && cached && Date.now() - cached.at < CHART_HISTORY_TTL_MS && cached.body.available) {
    return cached.body;
  }
  const used: GoldMaBacktestDeps = deps ?? {
    now: () => new Date().toISOString().slice(0, 10),
    fetchFmp: (from, to) => fmpHistoricalPrices("GCUSD", from, to),
    fetchYahoo: yahooFetch,
  };
  let series: { points: GoldClosePoint[]; source: string };
  try {
    series = await loadGoldCloseSeries(used);
  } catch (err: any) {
    return unavailable(err?.message?.substring(0, 160) || "Gold-Historie nicht abrufbar", MA_FAST, MA_SLOW);
  }
  if (series.points.length === 0) {
    return unavailable("keine Gold-Historie von FMP oder Yahoo", MA_FAST, MA_SLOW);
  }
  const body: GoldMaBacktestResponse = {
    ...backtestGoldMaCrosses(series.points, MA_FAST, MA_SLOW),
    source: series.source,
  };
  if (!deps && body.available) cached = { at: Date.now(), body };
  return body;
}
