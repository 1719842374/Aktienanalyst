import type { Express, Request, Response } from "express";
import { fmpHistoricalPrices, isFmpAvailable } from "./fmp";
import { rsiWilder, rsiZone, macd1269, combineRsiMacd } from "../shared/tech-rsi";

export const MARKET_BOOKS = {
  US: { etf: "SPY", volId: "VIXCLS", volKind: "implied" as const, label: "S&P 500 (SPY)" },
  EU: { etf: "VGK", volId: "V2TX", volKind: "implied" as const, label: "Europa STOXX (VGK)" },
  AS: { etf: "ASHR", volId: "realized20", volKind: "realized" as const, label: "China A (ASHR)" },
} as const;

export type RegionId = keyof typeof MARKET_BOOKS;

const WINDOW_DAYS: Record<string, number> = {
  "1Y": 252,
  "3Y": 756,
  "5Y": 1260,
  "10Y": 2520,
  MAX: 7000,
};

const RSI_PERIOD = 14;
const WARMUP = 80;

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseClose(row: any): { date: string; close: number; volume?: number } | null {
  const date = String(row?.date || row?.Date || "").slice(0, 10);
  const close = Number(row?.close ?? row?.adjClose ?? row?.price);
  const volume = Number(row?.volume);
  if (!date || !Number.isFinite(close)) return null;
  return { date, close, volume: Number.isFinite(volume) ? volume : undefined };
}

export async function buildRegionMarket(region: RegionId, window: string) {
  const book = MARKET_BOOKS[region];
  const days = WINDOW_DAYS[window] || WINDOW_DAYS["5Y"];
  const to = new Date().toISOString().slice(0, 10);
  const from = addDays(to, -(days + WARMUP + RSI_PERIOD));

  const raw = await fmpHistoricalPrices(book.etf, from, to);
  const rows = (Array.isArray(raw) ? raw : [])
    .map(parseClose)
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const closes = rows.map(r => r.close);
  const rsi = rsiWilder(closes, RSI_PERIOD);
  const macd = macd1269(closes);
  const cut = Math.max(0, rows.length - days);
  const series = rows.slice(cut).map((r, i) => {
    const idx = i + cut;
    const m = macd[idx] || { macd: null, signal: null, hist: null };
    return {
      date: r.date,
      close: r.close,
      volume: r.volume ?? null,
      rsi: rsi[idx],
      macd: m.macd,
      signal: m.signal,
      hist: m.hist,
    };
  });

  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const lastRsi = last?.rsi ?? null;
  const combo = combineRsiMacd(
    lastRsi,
    last?.macd ?? null,
    last?.signal ?? null,
    last?.hist ?? null,
    prev?.hist ?? null,
  );
  return {
    region,
    label: book.label,
    etf: book.etf,
    window,
    asOf: last?.date ?? null,
    rsiPeriod: RSI_PERIOD,
    rsi: lastRsi,
    rsiZone: rsiZone(lastRsi),
    macd: last?.macd ?? null,
    signal: last?.signal ?? null,
    hist: last?.hist ?? null,
    combo,
    points: series.length,
    series,
  };
}

let marketCache: { key: string; ts: number; data: any } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000;

export function registerRecessionMarketRoutes(app: Express) {
  app.get("/api/analyze-recession/markets", async (req: Request, res: Response) => {
    const regionRaw = String(req.query.region || "US").toUpperCase();
    const region = (regionRaw === "EU" || regionRaw === "AS" ? regionRaw : "US") as RegionId;
    const windowRaw = String(req.query.window || "5Y").toUpperCase();
    const window = WINDOW_DAYS[windowRaw] ? windowRaw : "5Y";
    const key = `v2:${region}:${window}`;

    if (marketCache && marketCache.key === key && Date.now() - marketCache.ts < TTL_MS) {
      return res.json(marketCache.data);
    }
    if (!isFmpAvailable()) {
      return res.status(503).json({ error: "FMP nicht konfiguriert", region, window });
    }
    try {
      const data = await buildRegionMarket(region, window);
      marketCache = { key, ts: Date.now(), data };
      res.json(data);
    } catch (err: any) {
      console.error("[RECESSION-MARKETS]", err?.message);
      res.status(500).json({ error: err?.message || "markets failed", region, window });
    }
  });
}
