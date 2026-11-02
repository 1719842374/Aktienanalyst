/**
 * Routing-Ticker .DE → FMP-Symbol über Suche und Profil.
 * XETRA-Treffer und gleiche ISIN entscheiden. Keine feste Ticker-Tabelle.
 */
import { fmpProfile, fmpSearchTicker } from "./fmp";

export const XETRA_EXCHANGE = /xetra/i;
/** Obergrenze der Profil-Abrufe je Auflösung. */
export const MAX_LISTING_CANDIDATES = 8;
/** Namensabgleich erst ab mehr als 3 Zeichen. Kürzere Reste treffen zu oft zufällig. */
const NAME_MATCH_MIN_CHARS = 3;

export interface FmpSearchHit {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  isin: string | null;
}

export interface FmpProfileHit {
  symbol: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  isin: string | null;
  ok: boolean;
}

export interface FmpSymbolResolution {
  requested: string;
  fmpSymbol: string;
  currency: string | null;
  exchange: string | null;
  isin: string | null;
  /** Sichtbare Quelle, inkl. Auflösungsweg. */
  source: string;
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function isXetra(exchange: string | null): boolean {
  return !!exchange && XETRA_EXCHANGE.test(exchange);
}

function namesMatch(a: string | null, b: string | null): boolean {
  const left = (a ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const right = (b ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return left.length > NAME_MATCH_MIN_CHARS && right.length > NAME_MATCH_MIN_CHARS && (left.includes(right) || right.includes(left));
}

function describe(hit: { symbol: string; exchange: string | null; currency: string | null; isin: string | null }, why: string): string {
  const bits = [
    why,
    hit.exchange ? `Börse ${hit.exchange}` : null,
    hit.isin ? `ISIN ${hit.isin}` : null,
    hit.currency ? `Währung ${hit.currency}` : null,
  ].filter((part): part is string => !!part);
  return `FMP ${hit.symbol} (${bits.join(", ")})`;
}

/**
 * Wählt das FMP-Symbol zu einem .DE-Routing-Ticker.
 * 1. Profil des Routing-Tickers, wenn es lädt und XETRA ist.
 * 2. Anderes geladenes Profil mit derselben ISIN wie ein XETRA-Treffer.
 * 3. Genau ein Namensgleicher, wenn keine ISIN vorliegt. Sonst kein Treffer.
 */
export function pickFmpListing(requested: string, hits: FmpSearchHit[], profiles: FmpProfileHit[]): FmpSymbolResolution | null {
  const want = norm(requested);
  const xetraHits = hits.filter(hit => isXetra(hit.exchange) || norm(hit.symbol) === want);
  const xetraIsins = new Set(
    [...xetraHits, ...profiles.filter(profile => profile.ok && (isXetra(profile.exchange) || norm(profile.symbol) === want))]
      .map(row => norm(row.isin))
      .filter(isin => isin.length > 0),
  );
  const ready = profiles.filter(profile => profile.ok && norm(profile.symbol).length > 0);
  const direct = ready.find(profile => norm(profile.symbol) === want);
  if (direct && (isXetra(direct.exchange) || !direct.exchange)) {
    return {
      requested: want,
      fmpSymbol: norm(direct.symbol),
      currency: direct.currency,
      exchange: direct.exchange,
      isin: direct.isin,
      source: describe(direct, `Profil zu ${want}`),
    };
  }
  const byIsin = ready.find(profile => norm(profile.isin).length > 0 && xetraIsins.has(norm(profile.isin)) && norm(profile.symbol) !== want);
  if (byIsin) {
    return {
      requested: want,
      fmpSymbol: norm(byIsin.symbol),
      currency: byIsin.currency,
      exchange: byIsin.exchange,
      isin: byIsin.isin,
      source: describe(byIsin, `statt ${want}, gleiche ISIN wie XETRA`),
    };
  }
  const xetraProfile = ready.find(profile => isXetra(profile.exchange));
  if (xetraProfile) {
    return {
      requested: want,
      fmpSymbol: norm(xetraProfile.symbol),
      currency: xetraProfile.currency,
      exchange: xetraProfile.exchange,
      isin: xetraProfile.isin,
      source: describe(xetraProfile, `XETRA-Profil`),
    };
  }
  const xetraName = xetraHits.find(hit => hit.name)?.name ?? null;
  const byName = ready.filter(profile => namesMatch(profile.name, xetraName));
  if (byName.length === 1) {
    const only = byName[0];
    return {
      requested: want,
      fmpSymbol: norm(only.symbol),
      currency: only.currency,
      exchange: only.exchange,
      isin: only.isin,
      source: describe(only, `statt ${want}, gleicher Name, ISIN nicht im XETRA-Treffer`),
    };
  }
  return null;
}

export function searchHitFromRow(row: { symbol?: string; name?: string; currency?: string; exchange?: string; exchangeFullName?: string; isin?: string }): FmpSearchHit | null {
  const symbol = norm(row.symbol);
  if (!symbol) return null;
  return {
    symbol,
    name: row.name?.trim() || null,
    currency: row.currency?.trim() || null,
    exchange: (row.exchange || row.exchangeFullName || "").trim() || null,
    isin: row.isin?.trim() || null,
  };
}

export function profileHitFromRow(symbol: string, row: unknown, ok: boolean): FmpProfileHit {
  const rec = row && typeof row === "object" ? row as Record<string, unknown> : {};
  const text = (key: string) => typeof rec[key] === "string" && (rec[key] as string).trim() ? (rec[key] as string).trim() : null;
  return {
    symbol: norm(text("symbol") ?? symbol),
    name: text("companyName") ?? text("name"),
    currency: text("currency"),
    exchange: text("exchangeShortName") ?? text("exchange") ?? text("exchangeFullName"),
    isin: text("isin"),
    ok,
  };
}

let listingCache = new Map<string, { at: number; body: FmpSymbolResolution }>();
const LISTING_CACHE_MS = 6 * 60 * 60 * 1000;

export function resetFmpListingCacheForTests(): void {
  listingCache = new Map();
}

export async function resolveGermanListing(
  symbol: string,
  search: (query: string) => Promise<FmpSearchHit[]>,
  profile: (symbol: string) => Promise<FmpProfileHit>,
  now = Date.now(),
): Promise<FmpSymbolResolution | null> {
  const want = norm(symbol);
  const hit = listingCache.get(want);
  if (hit && now - hit.at < LISTING_CACHE_MS) return hit.body;
  const root = want.replace(/\.DE$/, "");
  const queries = root && root !== want ? [want, root] : [want];
  const found: FmpSearchHit[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const rows = await search(query);
    for (const row of rows) {
      const key = norm(row.symbol);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      found.push(row);
      if (found.length >= MAX_LISTING_CANDIDATES) break;
    }
    if (found.length >= MAX_LISTING_CANDIDATES) break;
  }
  const profiles: FmpProfileHit[] = [];
  for (const row of found) {
    profiles.push(await profile(row.symbol));
    if (profiles.length >= MAX_LISTING_CANDIDATES) break;
  }
  const picked = pickFmpListing(want, found, profiles);
  if (picked) listingCache.set(want, { at: now, body: picked });
  return picked;
}

export async function resolveGermanListingDefault(symbol: string): Promise<FmpSymbolResolution | null> {
  return resolveGermanListing(
    symbol,
    async (query) => {
      const rows = await fmpSearchTicker(query, MAX_LISTING_CANDIDATES);
      return rows.map(searchHitFromRow).filter((row): row is FmpSearchHit => row != null);
    },
    async (sym) => {
      try {
        const row = await fmpProfile(sym);
        return profileHitFromRow(sym, row, !!row);
      } catch {
        return profileHitFromRow(sym, null, false);
      }
    },
  );
}
