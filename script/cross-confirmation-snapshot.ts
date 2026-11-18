/**
 * Info-Tabelle für Philip. Kein Score, kein neuer App-Pfad.
 * Quelle: Yahoo Chart, unauthentifiziert. Run: npx tsx script/cross-confirmation-snapshot.ts
 */
import { buildFullSeries, maCrossMarkers } from "../client/src/lib/taWindowSeries";
import { VOL_THRESHOLD_K, confirmCrossEvents, hitsLabel, stateLabel } from "../client/src/lib/taCrossConfirmation";
import type { OHLCVPoint } from "../shared/schema";

const TICKERS = ["NVDA", "JPM", "NVO", "TSLA", "KO", "JNJ", "PLTR", "BTC-USD"] as const;

async function yahooBars(symbol: string): Promise<OHLCVPoint[]> {
  const from = "2018-01-01";
  const to = new Date().toISOString().slice(0, 10);
  const period1 = Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000);
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const period2 = Math.floor(end.getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json() as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<Record<string, Array<number | null>>> } }> };
  };
  const result = json.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const out: OHLCVPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = quote.close?.[i];
    if (close == null || !Number.isFinite(close) || !(close > 0)) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    out.push({
      date,
      open: quote.open?.[i] ?? close,
      high: quote.high?.[i] ?? close,
      low: quote.low?.[i] ?? close,
      close,
      volume: quote.volume?.[i] ?? 0,
    });
  }
  return out;
}

function rawStatus(points: ReturnType<typeof buildFullSeries>["points"]): string {
  const last = points[points.length - 1];
  if (!last?.ma50 || !last.ma200) return "n/a — MA fehlt";
  const side = last.ma50 > last.ma200 ? "MA50>MA200" : "MA50<MA200";
  const raw = [...maCrossMarkers(points)].reverse()[0];
  return raw ? `${side}; letzter Roh-Cross ${raw.type} ${raw.date}` : side;
}

function cell(points: ReturnType<typeof buildFullSeries>["points"], k: number): string {
  const view = confirmCrossEvents(points, { k });
  const latest = view.latest;
  const status = latest ? `${latest.type} ${stateLabel(latest.state)} ${hitsLabel(latest.hits)} tau ${latest.date}` : "kein Event";
  return `${status}; Events ${view.events.length}; W/N ${view.whipsaw.w}/${view.whipsaw.n}`;
}

const rows: string[] = [];
rows.push(`Stichtag Lauf: ${new Date().toISOString().slice(0, 10)}`);
rows.push("Quelle: Yahoo Chart v8, täglich, ab 2018-01-01. Relative Stärke n/a (keine Benchmark-Reihe geladen). Live-k = " + VOL_THRESHOLD_K + ".");
rows.push("");
rows.push("| Ticker | letzte Kerze | roh | k=0 | k=0.5 |");
rows.push("| --- | --- | --- | --- | --- |");

for (const symbol of TICKERS) {
  try {
    const bars = await yahooBars(symbol);
    if (bars.length < 200) {
      rows.push(`| ${symbol} | n/a | n/a — nur ${bars.length} Kerzen | n/a | n/a |`);
      continue;
    }
    const series = buildFullSeries(bars);
    const last = series.points[series.points.length - 1]?.date ?? "n/a";
    rows.push(`| ${symbol} | ${last} | ${rawStatus(series.points)} | ${cell(series.points, 0)} | ${cell(series.points, 0.5)} |`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rows.push(`| ${symbol} | n/a | n/a — ${message} | n/a | n/a |`);
  }
}

console.log(rows.join("\n"));
