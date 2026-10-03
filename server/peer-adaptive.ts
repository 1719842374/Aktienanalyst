/**
 * Offen_WORK_PEER_ADAPTIVE.md — 2-Hop peer set.
 *
 * A Seeds = fmpPeers(subject), already in the analyze bundle.
 * B 2-Hop = fmpPeers of the first 5 seeds, cached 7 days under peers2hop:{TICKER}.
 * C unique(A ∪ B) without the subject.
 * D same industry or same sector, cap band, existing luxury-vs-auto rule.
 * E exact industry, then |log cap| ascending, then description/segment token overlap.
 * F first 5. +/- overrides are applied by the caller after this, up to 8.
 * Curated map only when F is empty. It is not extended here.
 *
 * A missing or >7-day cache entry is the refresh (budget: hops only then).
 * A fresh entry makes no fmpPeers calls on the hot path.
 * LLM ticker strings are not candidates. Searched competition names join the
 * pool and still have to pass D.
 */
import { diskResearcherGetWithTtl, diskResearcherSet } from "./disk-cache";
import { fmpProfile } from "./fmp";
import {
  CURATED_PEER_FALLBACK,
  isIndustryCompatible,
  isPeerMarketCapWithinBand,
  normaliseIndustry,
} from "./news-peers";

export const PEERS_2HOP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PEERS_2HOP_SEED_LIMIT = 5;
export const PEER_SET_TAKE = 5;

const TOKEN_STOPWORDS = new Set(["inc", "group", "the", "company"]);

export interface AdaptivePeerProfile {
  symbol: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  description: string;
  segmentNames?: string[];
}

export interface HopCacheRow {
  symbols: string[];
  storedAt: number;
}

export interface AdaptivePeerResolution {
  tickers: string[];
  hopCalls: number;
}

const hopMemory = new Map<string, HopCacheRow>();

export function clearPeerHopMemoryForTests(): void {
  hopMemory.clear();
}

export function peers2HopCacheKey(ticker: string): string {
  return `peers2hop:${ticker.trim().toUpperCase()}`;
}

export function isPeers2HopFresh(storedAt: number, now: number, ttlMs = PEERS_2HOP_TTL_MS): boolean {
  if (!Number.isFinite(storedAt) || !Number.isFinite(now)) return false;
  const age = now - storedAt;
  return age >= 0 && age <= ttlMs;
}

export function peerTokens(description: string, segmentNames: string[] = []): Set<string> {
  const raw = `${description ?? ""} ${(segmentNames ?? []).join(" ")}`.toLowerCase();
  const out = new Set<string>();
  for (const part of raw.split(/[^a-z0-9-]+/)) {
    const token = part.replace(/^-+|-+$/g, "");
    if (token.length < 5 || TOKEN_STOPWORDS.has(token)) continue;
    out.add(token);
  }
  return out;
}

export function tokenOverlap(left: Set<string>, right: Set<string>): number {
  let count = 0;
  left.forEach((token) => { if (right.has(token)) count += 1; });
  return count;
}

function asSymbol(raw: unknown): string {
  if (typeof raw === "string") return raw.trim().toUpperCase();
  if (raw && typeof raw === "object" && "symbol" in raw) {
    return String((raw as { symbol?: unknown }).symbol ?? "").trim().toUpperCase();
  }
  return "";
}

export function candidateSymbols(subject: string, seeds: readonly unknown[], hops: readonly unknown[]): string[] {
  const subjectSymbol = asSymbol(subject);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...seeds, ...hops]) {
    const symbol = asSymbol(raw);
    if (!symbol || symbol === subjectSymbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

export function topHopSeeds(subject: string, seeds: readonly unknown[], limit = PEERS_2HOP_SEED_LIMIT): string[] {
  return candidateSymbols(subject, seeds, []).slice(0, limit);
}

function isExactIndustry(subjectIndustry: string, candidateIndustry: string): boolean {
  const subjectKey = normaliseIndustry(subjectIndustry);
  const candidateKey = normaliseIndustry(candidateIndustry);
  return subjectKey.length > 0 && subjectKey === candidateKey;
}

function positiveCap(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

/** Profile row → D inputs. Reads mktCap, then marketCap. No extra FMP call. */
export function adaptiveProfileFromFmp(symbol: string, row: unknown): AdaptivePeerProfile | null {
  if (!row || typeof row !== "object") return null;
  const record = row as { sector?: unknown; industry?: unknown; mktCap?: unknown; marketCap?: unknown; description?: unknown };
  const marketCap = Number(record.mktCap ?? record.marketCap);
  return {
    symbol: asSymbol(symbol),
    sector: String(record.sector ?? ""),
    industry: String(record.industry ?? ""),
    marketCap: Number.isFinite(marketCap) && marketCap > 0 ? marketCap : null,
    description: String(record.description ?? ""),
  };
}

export async function loadFmpPeerProfile(symbol: string): Promise<AdaptivePeerProfile | null> {
  try {
    return adaptiveProfileFromFmp(symbol, await fmpProfile(symbol));
  } catch {
    return null;
  }
}

export function buildPeerSetF(input: {
  subject: string;
  subjectSector: string;
  subjectIndustry: string;
  subjectMarketCap: number;
  subjectDescription: string;
  subjectSegmentNames: string[];
  candidates: AdaptivePeerProfile[];
  /** Ignored as a source of symbols. Search results go through searchedCompetition and D. */
  llmSymbols?: string[];
  searchedCompetition?: AdaptivePeerProfile[];
  curatedFallback?: string[] | null;
  limit?: number;
}): string[] {
  const subject = asSymbol(input.subject);
  const limit = input.limit ?? PEER_SET_TAKE;
  const subjectTokens = peerTokens(input.subjectDescription, input.subjectSegmentNames ?? []);
  const bySymbol = new Map<string, AdaptivePeerProfile>();
  for (const profile of [...input.candidates, ...(input.searchedCompetition ?? [])]) {
    const symbol = asSymbol(profile?.symbol);
    if (!symbol || symbol === subject || bySymbol.has(symbol)) continue;
    bySymbol.set(symbol, { ...profile, symbol });
  }

  const ranked: { symbol: string; exact: boolean; distance: number; overlap: number }[] = [];
  bySymbol.forEach((profile) => {
    if (!isIndustryCompatible(input.subjectSector, input.subjectIndustry, profile.sector, profile.industry).ok) return;
    const cap = positiveCap(profile.marketCap);
    if (!isPeerMarketCapWithinBand(cap, input.subjectMarketCap) || cap == null) return;
    ranked.push({
      symbol: profile.symbol,
      exact: isExactIndustry(input.subjectIndustry, profile.industry),
      distance: Math.abs(Math.log(input.subjectMarketCap) - Math.log(cap)),
      overlap: tokenOverlap(subjectTokens, peerTokens(profile.description, profile.segmentNames ?? [])),
    });
  });
  ranked.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.overlap !== b.overlap) return b.overlap - a.overlap;
    return a.symbol.localeCompare(b.symbol);
  });
  if (ranked.length > 0) return ranked.slice(0, limit).map(row => row.symbol);

  const fallback: string[] = [];
  for (const raw of input.curatedFallback ?? []) {
    const symbol = asSymbol(raw);
    if (!symbol || symbol === subject || fallback.includes(symbol)) continue;
    fallback.push(symbol);
  }
  return fallback.slice(0, limit);
}

function readHopCache(key: string, now: number): HopCacheRow | null {
  const memory = hopMemory.get(key);
  if (memory && isPeers2HopFresh(memory.storedAt, now)) return memory;
  if (memory) hopMemory.delete(key);
  const disk = diskResearcherGetWithTtl(key, PEERS_2HOP_TTL_MS, now);
  if (!disk || !Array.isArray(disk.data?.symbols)) return null;
  const row: HopCacheRow = {
    symbols: disk.data.symbols.map((symbol: unknown) => asSymbol(symbol)).filter(Boolean),
    storedAt: disk.storedAt,
  };
  hopMemory.set(key, row);
  return row;
}

function writeHopCache(key: string, row: HopCacheRow): void {
  hopMemory.set(key, row);
  diskResearcherSet(key, { symbols: row.symbols });
}

export async function loadPeerHopSymbols(opts: {
  subject: string;
  seeds: readonly unknown[];
  now?: number;
  cacheGet: (key: string) => HopCacheRow | null;
  cacheSet: (key: string, row: HopCacheRow) => void;
  fmpPeers: (symbol: string) => Promise<readonly unknown[]>;
}): Promise<{ symbols: string[]; calls: number }> {
  const now = opts.now ?? Date.now();
  const key = peers2HopCacheKey(opts.subject);
  const cached = opts.cacheGet(key);
  if (cached && isPeers2HopFresh(cached.storedAt, now) && Array.isArray(cached.symbols)) {
    return { symbols: candidateSymbols(opts.subject, [], cached.symbols), calls: 0 };
  }
  const seeds = topHopSeeds(opts.subject, opts.seeds);
  const lists = await Promise.all(seeds.map(async (seed) => {
    try {
      return await opts.fmpPeers(seed);
    } catch {
      return [];
    }
  }));
  const symbols = candidateSymbols(opts.subject, [], lists.flat());
  opts.cacheSet(key, { symbols, storedAt: now });
  return { symbols, calls: seeds.length };
}

export async function resolveAdaptivePeerTickers(opts: {
  subject: string;
  subjectSector: string;
  subjectIndustry: string;
  subjectMarketCap: number;
  subjectDescription: string;
  subjectSegmentNames: string[];
  seeds: readonly unknown[];
  fmpPeers: (symbol: string) => Promise<readonly unknown[]>;
  loadProfile: (symbol: string) => Promise<AdaptivePeerProfile | null>;
  llmSymbols?: string[];
  searchedCompetition?: AdaptivePeerProfile[];
  curatedFallback?: string[] | null;
  now?: number;
  cacheGet?: (key: string) => HopCacheRow | null;
  cacheSet?: (key: string, row: HopCacheRow) => void;
  limit?: number;
}): Promise<AdaptivePeerResolution> {
  const now = opts.now ?? Date.now();
  const subject = asSymbol(opts.subject);
  const hop = await loadPeerHopSymbols({
    subject,
    seeds: opts.seeds,
    now,
    cacheGet: opts.cacheGet ?? ((key) => readHopCache(key, now)),
    cacheSet: opts.cacheSet ?? writeHopCache,
    fmpPeers: opts.fmpPeers,
  });
  const symbols = candidateSymbols(subject, opts.seeds, hop.symbols);
  const loaded = await Promise.all(symbols.map(async (symbol) => {
    try {
      return await opts.loadProfile(symbol);
    } catch {
      return null;
    }
  }));
  const candidates: AdaptivePeerProfile[] = [];
  for (const profile of loaded) {
    if (!profile) continue;
    const symbol = asSymbol(profile.symbol);
    if (!symbol) continue;
    candidates.push({ ...profile, symbol, marketCap: positiveCap(profile.marketCap) });
  }
  const curatedFallback = opts.curatedFallback !== undefined
    ? opts.curatedFallback
    : (CURATED_PEER_FALLBACK[subject] ?? []);
  return {
    tickers: buildPeerSetF({
      subject,
      subjectSector: opts.subjectSector,
      subjectIndustry: opts.subjectIndustry,
      subjectMarketCap: opts.subjectMarketCap,
      subjectDescription: opts.subjectDescription,
      subjectSegmentNames: opts.subjectSegmentNames,
      candidates,
      llmSymbols: opts.llmSymbols,
      searchedCompetition: opts.searchedCompetition,
      curatedFallback,
      limit: opts.limit,
    }),
    hopCalls: hop.calls,
  };
}
