/**
 * GET /api/watchlist — "Zuletzt analysiert" chips on the welcome screen (client/src/pages/Dashboard.tsx:640,
 * reads data.tickers[] with ticker / lastPrice). GET /api/cache — cache overview (admin/debug).
 *
 * REGRESSION-FIX (11.10.2026): both were dropped from routes.ts by 57189dd (16.07.2026). The old GET read
 * .cache/watchlist.json, which only POST /api/watchlist wrote (not restored, no client caller) and which
 * Render's ephemeral disk loses on every restart. Now derived read-only from the SQLite disk cache
 * (diskCacheList + diskCacheGet): the most recently analysed tickers, newest first.
 */
import type { Express } from "express";
import { diskCacheList, diskCacheGet } from "./disk-cache";

export type WatchlistEntry = { ticker: string; addedAt: string; lastPrice?: number; companyName?: string };
type ListRow = { ticker: string; cachedAt: string; ageMinutes: number; sizeKB: number };

export const WATCHLIST_MAX = 20;
const MEMO_MS = 60_000;

/** Cache key → bare ticker. Plain keys ("MSFT") and analyze keys ("analyze:MSFT:…"); peer and other keys are skipped. */
export function tickerFromCacheKey(key: string): string | null {
  if (!key) return null;
  if (key.startsWith("analyze:")) {
    if (key.includes(":peers:")) return null;
    const t = key.split(":")[1];
    return t ? t.toUpperCase() : null;
  }
  return /^[A-Z0-9.\-^=]{1,15}$/i.test(key) ? key.toUpperCase() : null;
}

export function buildWatchlist(
  rows: ListRow[],
  get: (key: string) => any | null,
  max = WATCHLIST_MAX,
): { tickers: WatchlistEntry[] } {
  const newest = new Map<string, ListRow & { key: string }>();
  for (const r of rows) {
    const t = tickerFromCacheKey(r.ticker);
    if (!t) continue;
    const prev = newest.get(t);
    if (!prev || r.ageMinutes < prev.ageMinutes) newest.set(t, { ...r, key: r.ticker });
  }
  const top = Array.from(newest.entries()).sort((a, b) => a[1].ageMinutes - b[1].ageMinutes).slice(0, max);
  const tickers = top.map(([ticker, r]) => {
    let data: any = null;
    try { data = get(r.key); } catch { data = null; }
    const price = Number(data?.currentPrice);
    return {
      ticker,
      addedAt: r.cachedAt,
      lastPrice: Number.isFinite(price) && price > 0 ? price : undefined,
      companyName: typeof data?.companyName === "string" ? data.companyName : undefined,
    };
  });
  return { tickers };
}

export function registerWatchlistRoutes(
  app: Express,
  deps: { list?: () => ListRow[]; get?: (key: string) => any | null; now?: () => number } = {},
): void {
  const list = deps.list ?? diskCacheList;
  const get = deps.get ?? diskCacheGet;
  const now = deps.now ?? Date.now;
  let memo: { at: number; body: { tickers: WatchlistEntry[] } } | null = null;

  app.get("/api/watchlist", (_req, res) => {
    try {
      if (!memo || now() - memo.at > MEMO_MS) memo = { at: now(), body: buildWatchlist(list(), get) };
      res.json(memo.body);
    } catch {
      res.json({ tickers: [] });
    }
  });

  app.get("/api/cache", (_req, res) => {
    try {
      const items = list().slice().sort((a, b) => a.ageMinutes - b.ageMinutes);
      res.json({ cached: items.length, items });
    } catch {
      res.json({ cached: 0, items: [] });
    }
  });
}
