/**
 * JOB 17: Gold/Silber-Ratio. Nur Anzeige auf /gold, kein Score-Eingang:
 * eigene Route, /api/analyze-gold bleibt unberührt.
 * Quellen: FMP Quote GCUSD / SIUSD; fehlt eine, Yahoo GC=F / SI=F (Front-Month-Futures).
 * Ratio nur, wenn Gold und Silber vom selben Tag (UTC) stammen, sonst n/a.
 */
import type { Express } from "express";
import { fmpHistoricalPrices, fmpQuote } from "./fmp";
import { yahooFetch } from "./history-fallback";
import { fetchFmpChunks, historyWindows, mergeGoldRows } from "./gold-chart-history";
import {
  buildGoldSilverRatioHistory,
  FMP_RATIO_SOURCE,
  type GoldSilverRatioHistory,
} from "../shared/gold-silver-ratio";

export interface GoldSilverRatio {
  ratio: number | null;
  gold: number | null;
  silver: number | null;
  /** ISO-Zeitpunkt der älteren der beiden Quotes (null wenn unbekannt). */
  asOf: string | null;
  /** z. B. „FMP GCUSD / Yahoo SI=F“ */
  source: string;
  goldSource: string | null;
  silverSource: string | null;
  unavailableReason: string | null;
}

export const GOLD_SILVER_SOURCE = "FMP Quote GCUSD / SIUSD";
export const GOLD_SILVER_CACHE_TTL_MS = 10 * 60 * 1000;

type Quote = { price?: unknown; timestamp?: unknown; source?: string } | null | undefined;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const ts = (q: Quote): number | null => {
  const t = num(q?.timestamp);
  if (t == null) return null;
  return t < 1e12 ? t * 1000 : t; // FMP/Yahoo liefern Unix-Sekunden
};

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export function computeGoldSilverRatio(goldQ: Quote, silverQ: Quote): GoldSilverRatio {
  const gold = num(goldQ?.price);
  const silver = num(silverQ?.price);
  const goldSource = gold != null ? goldQ?.source ?? "FMP GCUSD" : null;
  const silverSource = silver != null ? silverQ?.source ?? "FMP SIUSD" : null;
  const source = goldSource && silverSource ? `${goldSource} / ${silverSource}` : GOLD_SILVER_SOURCE;
  const base = { gold, silver, source, goldSource, silverSource };
  if (gold == null || silver == null) {
    return {
      ...base, ratio: null, asOf: null,
      unavailableReason: gold == null && silver == null ? "keine Quotes" : gold == null ? "Gold-Quote fehlt" : "Silber-Quote fehlt",
    };
  }
  const tg = ts(goldQ), tsil = ts(silverQ);
  if (tg == null || tsil == null) return { ...base, ratio: null, asOf: null, unavailableReason: "Quote-Datum unbekannt" };
  if (day(tg) !== day(tsil)) {
    return { ...base, ratio: null, asOf: null, unavailableReason: `Datum ungleich (Gold ${day(tg)}, Silber ${day(tsil)})` };
  }
  return { ...base, ratio: gold / silver, asOf: new Date(Math.min(tg, tsil)).toISOString(), unavailableReason: null };
}

/** Yahoo-Chart-Meta (regularMarketPrice/-Time) als Ersatzquelle. */
export async function yahooQuote(symbol: string): Promise<Quote> {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const meta = (await r.json() as any)?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    return { price: meta.regularMarketPrice, timestamp: meta.regularMarketTime, source: `Yahoo ${symbol}` };
  } catch {
    return null;
  }
}

interface Deps {
  quote: (symbol: string) => Promise<Quote>;
  yahoo?: (symbol: string) => Promise<Quote>;
  now?: () => number;
  /** Tageshistorie. Default: dieselbe FMP-/Yahoo-Kette wie die Gold-Chart-Historie. */
  fmpHistorical?: (symbol: string, from?: string, to?: string) => Promise<any[]>;
  yahooBars?: (symbol: string, from: string, to: string) => Promise<Array<{ date: string; close: number }>>;
}

const RATIO_FMP_GOLD = "GCUSD";
const RATIO_FMP_SILVER = "SIUSD";
const RATIO_YAHOO_GOLD = "GC=F";
const RATIO_YAHOO_SILVER = "SI=F";

/** Gold- und Silber-Schluss täglich, beide Beine je Anbieter, dann die längere gemeinsame Reihe. */
export async function loadGoldSilverRatioHistory(deps: {
  fmpHistorical: (symbol: string, from?: string, to?: string) => Promise<any[]>;
  yahooBars: (symbol: string, from: string, to: string) => Promise<Array<{ date: string; close: number }>>;
  endDate?: string;
}): Promise<GoldSilverRatioHistory> {
  const endDate = deps.endDate ?? new Date().toISOString().slice(0, 10);
  const windows = historyWindows(endDate, 60, 15);
  const fmpRows = async (symbol: string) => {
    const fetched = await fetchFmpChunks(windows, (from, to) => deps.fmpHistorical(symbol, from, to));
    return mergeGoldRows(fetched.chunks);
  };
  const yahooRows = async (symbol: string) => {
    try {
      const bars = await deps.yahooBars(symbol, "1970-01-01", endDate);
      return mergeGoldRows([bars]);
    } catch {
      return [];
    }
  };
  const [fmpGold, fmpSilver, yahooGold, yahooSilver] = await Promise.all([
    fmpRows(RATIO_FMP_GOLD),
    fmpRows(RATIO_FMP_SILVER),
    yahooRows(RATIO_YAHOO_GOLD),
    yahooRows(RATIO_YAHOO_SILVER),
  ]);
  return buildGoldSilverRatioHistory({ fmpGold, fmpSilver, yahooGold, yahooSilver });
}

async function withFallback(primary: () => Promise<Quote>, fallback: () => Promise<Quote>, label: string): Promise<Quote> {
  const p = await primary().catch(() => null);
  if (num(p?.price) != null) return { ...p, source: p?.source ?? label };
  return fallback().catch(() => null);
}

export function registerGoldSilverRatioRoute(app: Express, deps: Deps = { quote: fmpQuote, yahoo: yahooQuote }) {
  const now = deps.now ?? Date.now;
  const yahoo = deps.yahoo ?? yahooQuote;
  let cache: { at: number; value: GoldSilverRatio } | null = null;
  let inFlight: Promise<GoldSilverRatio> | null = null;
  app.get("/api/gold-silver-ratio", async (_req, res) => {
    if (cache && now() - cache.at < GOLD_SILVER_CACHE_TTL_MS) return res.json(cache.value);
    try {
      inFlight ??= (async () => {
        const [g, s] = await Promise.all([
          withFallback(() => deps.quote("GCUSD"), () => yahoo("GC=F"), "FMP GCUSD"),
          withFallback(() => deps.quote("SIUSD"), () => yahoo("SI=F"), "FMP SIUSD"),
        ]);
        const value = computeGoldSilverRatio(g, s);
        // n/a nicht lange halten: nur vollständige Werte cachen
        if (value.ratio != null) cache = { at: now(), value };
        return value;
      })().finally(() => { inFlight = null; });
      res.json(await inFlight);
    } catch (e: any) {
      res.json({ ratio: null, gold: null, silver: null, asOf: null, source: GOLD_SILVER_SOURCE, goldSource: null, silverSource: null, unavailableReason: String(e?.message || e) });
    }
  });

  const fmpHistorical = deps.fmpHistorical ?? fmpHistoricalPrices;
  const yahooBars = deps.yahooBars ?? ((symbol: string, from: string, to: string) => yahooFetch(symbol, from, to));
  let historyCache: { at: number; value: GoldSilverRatioHistory } | null = null;
  let historyFlight: Promise<GoldSilverRatioHistory> | null = null;
  app.get("/api/gold-silver-ratio/history", async (_req, res) => {
    if (historyCache && now() - historyCache.at < GOLD_SILVER_CACHE_TTL_MS) return res.json(historyCache.value);
    try {
      historyFlight ??= loadGoldSilverRatioHistory({ fmpHistorical, yahooBars })
        .finally(() => { historyFlight = null; });
      const value = await historyFlight;
      if (value.points.length > 0) historyCache = { at: now(), value };
      res.json(value);
    } catch (e: any) {
      res.json({
        points: [],
        source: FMP_RATIO_SOURCE,
        goldSource: null,
        silverSource: null,
        from: null,
        to: null,
        unavailableReason: String(e?.message || e),
      });
    }
  });
}
