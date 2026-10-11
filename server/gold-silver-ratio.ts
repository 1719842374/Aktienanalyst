/**
 * JOB 17: Gold/Silber-Ratio (GCUSD / SIUSD, FMP-Quotes). Nur Anzeige auf /gold, kein Score-Eingang:
 * eigene Route, /api/analyze-gold bleibt unberührt.
 */
import type { Express } from "express";
import { fmpQuote } from "./fmp";

export interface GoldSilverRatio {
  ratio: number | null;
  gold: number | null;
  silver: number | null;
  /** ISO-Zeitpunkt der älteren der beiden Quotes (null wenn unbekannt). */
  asOf: string | null;
  source: string;
  unavailableReason: string | null;
}

export const GOLD_SILVER_SOURCE = "FMP Quote GCUSD / SIUSD";
export const GOLD_SILVER_CACHE_TTL_MS = 10 * 60 * 1000;

type Quote = { price?: unknown; timestamp?: unknown } | null | undefined;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const ts = (q: Quote): number | null => {
  const t = num(q?.timestamp);
  if (t == null) return null;
  return t < 1e12 ? t * 1000 : t; // FMP liefert Unix-Sekunden
};

export function computeGoldSilverRatio(goldQ: Quote, silverQ: Quote): GoldSilverRatio {
  const gold = num(goldQ?.price);
  const silver = num(silverQ?.price);
  const times = [ts(goldQ), ts(silverQ)].filter((t): t is number => t != null);
  const asOf = gold != null && silver != null && times.length === 2 ? new Date(Math.min(...times)).toISOString() : null;
  if (gold == null || silver == null) {
    return {
      ratio: null, gold, silver, asOf: null, source: GOLD_SILVER_SOURCE,
      unavailableReason: gold == null && silver == null ? "keine Quotes" : gold == null ? "GCUSD fehlt" : "SIUSD fehlt",
    };
  }
  return { ratio: gold / silver, gold, silver, asOf, source: GOLD_SILVER_SOURCE, unavailableReason: null };
}

export function registerGoldSilverRatioRoute(
  app: Express,
  deps: { quote: (symbol: string) => Promise<Quote>; now?: () => number } = { quote: fmpQuote },
) {
  const now = deps.now ?? Date.now;
  let cache: { at: number; value: GoldSilverRatio } | null = null;
  let inFlight: Promise<GoldSilverRatio> | null = null;
  app.get("/api/gold-silver-ratio", async (_req, res) => {
    if (cache && now() - cache.at < GOLD_SILVER_CACHE_TTL_MS) return res.json(cache.value);
    try {
      inFlight ??= (async () => {
        const [g, s] = await Promise.all([deps.quote("GCUSD").catch(() => null), deps.quote("SIUSD").catch(() => null)]);
        const value = computeGoldSilverRatio(g, s);
        // n/a nicht lange halten: nur vollständige Werte cachen
        if (value.ratio != null) cache = { at: now(), value };
        return value;
      })().finally(() => { inFlight = null; });
      res.json(await inFlight);
    } catch (e: any) {
      res.json({ ratio: null, gold: null, silver: null, asOf: null, source: GOLD_SILVER_SOURCE, unavailableReason: String(e?.message || e) });
    }
  });
}
