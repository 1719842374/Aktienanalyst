/**
 * Cross-Page Bridge: Analyse/Researcher/Screener → P1 Portfolio oder P2 Watchlist
 * ohne Dashboard.tsx zu koppeln (Fragile-File-Registry).
 */

import { makePosition, loadPositionsFromStorage, savePositionsToStorage, type PortfolioPosition } from "./positions";
import { addToWatchlist, type WatchlistSource } from "./watchlist";

const PENDING_P1_KEY = "aktienanalyst_pending_portfolio_add_v1";

export type PendingPortfolioAdd = {
  ticker: string;
  name?: string;
  source?: string;
  at: string;
};

export function addTickerToManualPortfolio(ticker: string, name?: string): { ok: boolean; reason?: string } {
  const upper = ticker.trim().toUpperCase();
  if (!upper) return { ok: false, reason: "empty" };
  const positions = loadPositionsFromStorage();
  if (positions.some(p => p.ticker.toUpperCase() === upper && p.status === "open")) {
    return { ok: false, reason: "duplicate" };
  }
  const next: PortfolioPosition[] = [...positions, makePosition({ ticker: upper, name, qty: 1, entryPrice: 0 })];
  savePositionsToStorage(next);
  try {
    localStorage.setItem(PENDING_P1_KEY, JSON.stringify({ ticker: upper, name, at: new Date().toISOString() } satisfies PendingPortfolioAdd));
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("aktienanalyst-portfolio-positions-changed", { detail: { ticker: upper } }));
  return { ok: true };
}

export function addTickerToWatchlist(
  ticker: string,
  opts?: { name?: string; source?: WatchlistSource; score?: number | null }
): { ok: boolean; reason?: string } {
  const result = addToWatchlist({
    ticker,
    name: opts?.name,
    source: opts?.source ?? "dashboard",
    score: opts?.score,
  });
  return result.added ? { ok: true } : { ok: false, reason: result.reason };
}

export function consumePendingPortfolioAdd(): PendingPortfolioAdd | null {
  try {
    const raw = localStorage.getItem(PENDING_P1_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_P1_KEY);
    return JSON.parse(raw) as PendingPortfolioAdd;
  } catch {
    return null;
  }
}
