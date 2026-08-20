/**
 * Lokaler Storage für Watchlist-Portfolio (P2) und Researcher-Portfolios (P3).
 *
 * P2/P3 speichern bewusst nur Ticker plus optionale Metadaten. Es gibt weder
 * qty noch Entry-Preis; die Gewichtung wird erst in einer späteren Phase über
 * die bestehende Portfolio-Engine berechnet.
 */
import type { WatchlistEntry as SharedWatchlistEntry } from "../../../../shared/schema";

export type WatchlistEntry = SharedWatchlistEntry;
export type WatchlistSource = WatchlistEntry["source"];
export type PortfolioRegion = NonNullable<WatchlistEntry["region"]>;

const STORAGE_KEY = "aktienanalyst_watchlist_v1";
const RESEARCHER_SOURCE: WatchlistSource = "researcher";

function getStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isResearcherEntry(source: WatchlistSource): boolean {
  return source === RESEARCHER_SOURCE;
}

function normalizeSource(source: unknown): WatchlistSource {
  // Migration des vor dieser Spezifikation verwendeten Werts "analysis".
  if (source === "analysis") return "dashboard";
  return ["manual", "researcher", "screener", "dashboard", "btc"].includes(String(source))
    ? source as WatchlistSource
    : "manual";
}

function normalizeRegion(region: unknown): PortfolioRegion | undefined {
  // Migration des früheren Regionswerts "USA".
  if (region === "USA") return "US";
  return ["US", "EU", "ASIA", "MIXED"].includes(String(region))
    ? region as PortfolioRegion
    : undefined;
}

/**
 * Rein regelbasierte Einordnung. Ein expliziter Researcher-Kontext hat Vorrang;
 * es wird ausdrücklich kein LLM für die Zuordnung verwendet.
 */
export function inferRegion(
  ticker: string,
  context?: { region?: string },
): PortfolioRegion {
  if (context?.region != null) {
    const region = context.region.trim().toUpperCase();
    if (region === "US" || region === "USA") return "US";
    if (region === "EU") return "EU";
    if (region === "ASIA" || region === "CHINA/ASIA" || region === "CHINA-ASIA") return "ASIA";
    return "MIXED";
  }

  const normalized = ticker.trim().toUpperCase();
  if (!normalized) return "MIXED";
  if (/\.(DE|PA|MI|AS)$/.test(normalized)) return "EU";
  if (/\.(T|HK|KS|TW|SS|SZ)$/.test(normalized)) return "ASIA";
  if (/^[A-Z]{1,5}(?:\.[A-Z])?$/.test(normalized)) return "US";
  return "MIXED";
}

function normalizeStoredEntry(value: unknown): WatchlistEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const ticker = typeof raw.ticker === "string" ? raw.ticker.trim().toUpperCase() : "";
  if (!ticker) return null;

  const source = normalizeSource(raw.source);
  return {
    ticker,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : undefined,
    addedAt: typeof raw.addedAt === "string" ? raw.addedAt : new Date().toISOString(),
    source,
    score: raw.score != null && Number.isFinite(Number(raw.score)) ? Number(raw.score) : null,
    // P2 braucht keine Region. Bestehende P2-Einträge werden beim Laden
    // absichtlich auf das neue, optionale Datenmodell migriert.
    region: isResearcherEntry(source)
      ? (normalizeRegion(raw.region) ?? inferRegion(ticker))
      : undefined,
  };
}

export function loadWatchlist(): WatchlistEntry[] {
  try {
    const raw = getStorage()?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(normalizeStoredEntry).filter((entry): entry is WatchlistEntry => entry !== null)
      : [];
  } catch {
    return [];
  }
}

export function saveWatchlist(entries: WatchlistEntry[]): void {
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify(entries));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("aktienanalyst-watchlist-changed"));
    }
  } catch {
    // localStorage kann im privaten Modus oder bei Quota-Überschreitung
    // fehlschlagen; der aufrufende UI-Zustand soll dadurch nicht abstürzen.
  }
}

/**
 * Fügt einen Eintrag genau einmal je Portfolio-Kategorie hinzu:
 * P2 (alle Quellen außer researcher) und P3 (researcher) dürfen denselben
 * Ticker jeweils einmal enthalten, innerhalb ihrer Kategorie aber nicht doppelt.
 */
export function addToWatchlist(
  entry: Omit<WatchlistEntry, "addedAt">,
): { added: boolean; reason?: string } {
  const ticker = entry.ticker.trim().toUpperCase();
  if (!ticker) return { added: false, reason: "empty" };

  const source = normalizeSource(entry.source);
  const entries = loadWatchlist();
  const sameCategory = isResearcherEntry(source);
  if (entries.some((existing) =>
    existing.ticker === ticker && isResearcherEntry(existing.source) === sameCategory,
  )) {
    return { added: false, reason: "duplicate" };
  }

  const normalized: WatchlistEntry = {
    ticker,
    name: entry.name,
    addedAt: new Date().toISOString(),
    source,
    score: entry.score ?? null,
    region: isResearcherEntry(source)
      ? (normalizeRegion(entry.region) ?? inferRegion(ticker))
      : undefined,
  };
  saveWatchlist([...entries, normalized]);
  return { added: true };
}

export function bulkAddToWatchlist(
  items: Array<{ ticker: string; name?: string; score?: number | null }>,
  source: WatchlistEntry["source"],
): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;
  for (const item of items) {
    if (addToWatchlist({ ...item, source }).added) added += 1;
    else skipped += 1;
  }
  return { added, skipped };
}

/**
 * Kompatibilitätsadapter für die bereits vorhandene Cross-Page-Bridge.
 * Neue Aufrufer sollen addToWatchlist verwenden.
 */
export function addWatchlistEntry(entry: Omit<WatchlistEntry, "addedAt">): boolean {
  return addToWatchlist(entry).added;
}

export function removeWatchlistEntry(
  ticker: string,
  source?: WatchlistSource,
): void {
  const upper = ticker.trim().toUpperCase();
  const keepResearcherCategory = source == null ? null : isResearcherEntry(source);
  saveWatchlist(loadWatchlist().filter((entry) =>
    entry.ticker !== upper ||
    (keepResearcherCategory != null && isResearcherEntry(entry.source) !== keepResearcherCategory),
  ));
}

export function clearWatchlist(): void {
  saveWatchlist([]);
}

export function groupResearcherByRegion(
  entries: WatchlistEntry[],
): Record<PortfolioRegion, WatchlistEntry[]> {
  const groups: Record<PortfolioRegion, WatchlistEntry[]> = {
    US: [],
    EU: [],
    ASIA: [],
    MIXED: [],
  };
  for (const entry of entries) {
    if (entry.source === RESEARCHER_SOURCE) {
      groups[entry.region ?? "MIXED"].push(entry);
    }
  }
  return groups;
}
