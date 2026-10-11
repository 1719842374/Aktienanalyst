// Peer-Add-Rest: derselbe Analyse-Body für den ersten Call und den _pending-Poll,
// plus localStorage-Persistenz. Normalisierung ist die aus server/peer-cache-key.ts,
// damit der Cache-Key serverseitig stabil bleibt. Kein zweiter Endpoint.
import { normalizePeerOverrides } from "../server/peer-cache-key";

export const PEER_OVERRIDES_STORAGE_PREFIX = "aktienanalyst.peerOverrides.v1:";
export const LAST_ANALYZE_STORAGE_KEY = "aktienanalyst.lastAnalyze.v1";

export interface PeerOverrideLists {
  add: string[];
  remove: string[];
}

export function storageKeyForTicker(ticker: string): string {
  return PEER_OVERRIDES_STORAGE_PREFIX + ticker.trim().toUpperCase();
}

export function normalizeStoredOverrides(
  overrides: { add?: string[] | null; remove?: string[] | null } | null | undefined,
): PeerOverrideLists {
  const normalized = normalizePeerOverrides(overrides);
  return { add: normalized.add, remove: normalized.remove };
}

export function hasPeerOverrideLists(overrides: PeerOverrideLists | null | undefined): boolean {
  return !!overrides && (overrides.add.length > 0 || overrides.remove.length > 0);
}

export function parseStoredOverrides(raw: string | null): PeerOverrideLists {
  if (!raw) return { add: [], remove: [] };
  try {
    const parsed = JSON.parse(raw) as { add?: unknown; remove?: unknown };
    const add = Array.isArray(parsed?.add) ? parsed.add.filter((t): t is string => typeof t === "string") : [];
    const remove = Array.isArray(parsed?.remove) ? parsed.remove.filter((t): t is string => typeof t === "string") : [];
    return normalizeStoredOverrides({ add, remove });
  } catch {
    return { add: [], remove: [] };
  }
}

export function serializeOverrides(overrides: PeerOverrideLists): string {
  return JSON.stringify(normalizeStoredOverrides(overrides));
}

/** POST /api/analyze body. Leere Overrides bleiben weg, damit der Cache-Key ohne Peers-Suffix gilt. */
export function analyzePostBody(args: {
  ticker: string;
  useLLM: boolean;
  force: boolean;
  peerOverrides?: { add?: string[] | null; remove?: string[] | null } | null;
}): { ticker: string; useLLM: boolean; force: boolean; peerOverrides?: PeerOverrideLists } {
  const peerOverrides = normalizeStoredOverrides(args.peerOverrides);
  const body: { ticker: string; useLLM: boolean; force: boolean; peerOverrides?: PeerOverrideLists } = {
    ticker: args.ticker,
    useLLM: args.useLLM,
    force: args.force,
  };
  if (hasPeerOverrideLists(peerOverrides)) body.peerOverrides = peerOverrides;
  return body;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readOverrides(storage: KeyValueStore, ticker: string): PeerOverrideLists {
  return parseStoredOverrides(storage.getItem(storageKeyForTicker(ticker)));
}

export function writeOverrides(storage: KeyValueStore, ticker: string, overrides: PeerOverrideLists): void {
  storage.setItem(storageKeyForTicker(ticker), serializeOverrides(overrides));
}

export function readLastTicker(storage: KeyValueStore): string | null {
  const raw = storage.getItem(LAST_ANALYZE_STORAGE_KEY);
  const ticker = raw?.trim().toUpperCase() ?? "";
  return ticker || null;
}

export function writeLastTicker(storage: KeyValueStore, ticker: string): void {
  const upper = ticker.trim().toUpperCase();
  if (upper) storage.setItem(LAST_ANALYZE_STORAGE_KEY, upper);
}

/**
 * URL-Ticker gewinnt (Deep-Link). Sonst nur nach einem echten Reload den letzten
 * Ticker wieder öffnen, damit die Startseite bei einem frischen Besuch leer bleibt.
 */
export function shouldRestoreLastTicker(args: {
  urlTicker: string | null | undefined;
  navigationType: string;
  lastTicker: string | null;
}): string | null {
  const url = args.urlTicker?.trim().toUpperCase() || null;
  if (url) return url;
  if (args.navigationType === "reload" && args.lastTicker) return args.lastTicker;
  return null;
}

export function safeLocalStorage(): KeyValueStore | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}
