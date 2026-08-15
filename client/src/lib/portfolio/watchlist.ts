/**
 * Watchlist-Portfolio (P2) + Researcher-Portfolio-Einträge (P3)
 * WORK_RESEARCHER_PORTFOLIO.md — Storage + Region-Inferenz.
 *
 * P2/P3 brauchen KEINE qty/entry — nur Ticker + Metadaten.
 * Gewichtung läuft über engine/pipeline (WORK_PORTFOLIO).
 */

export type WatchlistSource = "manual" | "analysis" | "screener" | "researcher" | "btc";
export type PortfolioRegion = "USA" | "EU" | "ASIA" | "MIXED" | "UNKNOWN";

export interface WatchlistEntry {
  ticker: string;
  name?: string;
  addedAt: string;
  source: WatchlistSource;
  region: PortfolioRegion;
  score?: number | null;
}

const STORAGE_KEY = "aktienanalyst_watchlist_v1";

export function inferRegion(ticker: string): PortfolioRegion {
  const t = ticker.trim().toUpperCase();
  if (!t) return "UNKNOWN";
  if (/\.(HK|SS|SZ|T|TYO|KS|KQ)$/i.test(t) || /^(99|60|30)\d{4}/.test(t)) return "ASIA";
  if (/\.(DE|F|PA|AS|BR|MI|MC|ST|HE|CO|OL|LS|SW|VI)$/i.test(t)) return "EU";
  if (/\.(L|LN)$/i.test(t)) return "EU";
  if (/^[A-Z]{1,5}(\.[A-Z])?$/.test(t)) return "USA";
  return "MIXED";
}

export function loadWatchlist(): WatchlistEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e: any) => e && typeof e.ticker === "string" && e.ticker.trim())
      .map((e: any) => ({
        ticker: String(e.ticker).toUpperCase(),
        name: e.name ? String(e.name) : undefined,
        addedAt: typeof e.addedAt === "string" ? e.addedAt : new Date().toISOString(),
        source: (["manual", "analysis", "screener", "researcher", "btc"].includes(e.source) ? e.source : "manual") as WatchlistSource,
        region: (["USA", "EU", "ASIA", "MIXED", "UNKNOWN"].includes(e.region) ? e.region : inferRegion(e.ticker)) as PortfolioRegion,
        score: e.score != null && Number.isFinite(Number(e.score)) ? Number(e.score) : null,
      }));
  } catch {
    return [];
  }
}

export function saveWatchlist(entries: WatchlistEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    window.dispatchEvent(new CustomEvent("aktienanalyst-watchlist-changed"));
  } catch {
    /* quota / private mode */
  }
}

export function addWatchlistEntry(partial: {
  ticker: string;
  name?: string;
  source?: WatchlistSource;
  region?: PortfolioRegion;
  score?: number | null;
}): boolean {
  const ticker = partial.ticker.trim().toUpperCase();
  if (!ticker) return false;
  const list = loadWatchlist();
  if (list.some(e => e.ticker === ticker)) return false;
  const entry: WatchlistEntry = {
    ticker,
    name: partial.name,
    addedAt: new Date().toISOString(),
    source: partial.source ?? "manual",
    region: partial.region ?? inferRegion(ticker),
    score: partial.score ?? null,
  };
  saveWatchlist([...list, entry]);
  return true;
}

export function removeWatchlistEntry(ticker: string): void {
  const upper = ticker.trim().toUpperCase();
  saveWatchlist(loadWatchlist().filter(e => e.ticker !== upper));
}

export function clearWatchlist(): void {
  saveWatchlist([]);
}

export function groupResearcherByRegion(entries: WatchlistEntry[]): Record<PortfolioRegion, WatchlistEntry[]> {
  const researcher = entries.filter(e => e.source === "researcher");
  const groups: Record<PortfolioRegion, WatchlistEntry[]> = {
    USA: [], EU: [], ASIA: [], MIXED: [], UNKNOWN: [],
  };
  for (const e of researcher) {
    groups[e.region]?.push(e);
  }
  return groups;
}
