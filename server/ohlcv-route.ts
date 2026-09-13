import type { Express, Request, Response } from "express";
import { fmpHistoricalPrices, isFmpAvailable } from "./fmp";

type Bar = { date: string; close: number };
type Meta = { n: number; first: string | null; last: string | null; truncated: boolean };

const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { ts: number; bars: Bar[] }>();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addYearsIso(iso: string, years: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function clampFromTo(fromRaw: string, toRaw: string): { from: string; to: string } {
  const today = todayIso();
  let to = (toRaw || today).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to) || to > today) to = today;
  const minFrom = addYearsIso(today, -5);
  let from = (fromRaw || minFrom).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || from < minFrom) from = minFrom;
  if (from > to) from = to;
  return { from, to };
}

function normalizeBars(raw: any): Bar[] {
  return (Array.isArray(raw) ? raw : [])
    .map((r: any) => ({
      date: String(r?.date ?? "").slice(0, 10),
      close: Number(r?.close ?? r?.adjClose),
    }))
    .filter((p) => p.date && Number.isFinite(p.close) && p.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function loadBars(ticker: string, from: string, to: string): Promise<Bar[]> {
  const key = `ohlcv:${ticker}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.bars;
  let bars: Bar[] = [];
  try {
    const raw = await fmpHistoricalPrices(ticker, from, to);
    bars = normalizeBars(raw);
  } catch {
    bars = [];
  }
  cache.set(key, { ts: Date.now(), bars });
  return bars;
}

export function registerOhlcvRoute(app: Express) {
  app.get("/api/ohlcv", async (req: Request, res: Response) => {
    const tickers = String(req.query.tickers || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 12);
    const { from, to } = clampFromTo(String(req.query.from || ""), String(req.query.to || ""));

    if (!isFmpAvailable()) {
      return res.status(503).json({ error: "FMP nicht konfiguriert", from, to, source: "fmp", bars: {}, meta: {} });
    }

    const bars: Record<string, Bar[]> = {};
    const meta: Record<string, Meta> = {};
    for (const t of tickers) {
      const series = await loadBars(t, from, to);
      bars[t] = series;
      const first = series[0]?.date ?? null;
      const last = series[series.length - 1]?.date ?? null;
      const truncated = series.length === 0 || (!!first && first > from);
      meta[t] = { n: series.length, first, last, truncated };
    }

    res.json({ from, to, source: "fmp", bars, meta });
  });
}
