/**
 * Offen_WORK_PEER_ADAPTIVE.md
 *
 * A Seeds = fmpPeers(S) — already in the analyze bundle, not fetched again.
 * B 2-hop = fmpPeers(seed) for the first 5 seeds, cached 7 days.
 * C unique(A ∪ B) without S, plus Search+D names.
 * D industry/sector (isIndustryCompatible) AND cap band AND not luxury-vs-auto.
 * E exact industry, then |log cap|, then description/segment token overlap.
 * F take 5. Curated map only when F is empty. Overrides stay outside, after F.
 * LLM ticker strings are not copied into F.
 */
import { diskResearcherGet, diskResearcherSet } from "./disk-cache";
import { fmpPeers, fmpProfile, fmpSearchTicker } from "./fmp";
import {
  curatedPeerFallbackFor,
  isExactPeerIndustry,
  isIndustryCompatible,
  isPeerMarketCapWithinBand,
} from "./news-peers";

export const PEER_HOP_COUNT = 5;
export const PEER_TAKE = 5;
export const PEER_2HOP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TOKEN_STOPWORDS = new Set(["inc", "group", "the", "company"]);
const CAP_DISTANCE_EPS = 1e-9;

export interface PeerHopCacheEntry {
  bySeed: Record<string, string[]>;
  fetchedAt: number;
}

export interface AdaptiveCandidateProfile {
  ticker: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  description?: string;
  segmentNames?: string[];
}

export interface PeerAdaptiveCallOptions {
  subjectMarketCap?: number;
  subjectDescription?: string;
  subjectSegmentNames?: string[];
  /** Company names, not tickers. Resolved with fmpSearchTicker, then filter D. */
  competitionNames?: string[];
  /** Raw model tickers. Never copied into F. */
  llmSymbols?: string[];
  now?: number;
  fetchPeers?: (ticker: string) => Promise<unknown>;
  fetchProfile?: (ticker: string) => Promise<AdaptiveCandidateProfile | null>;
  searchTicker?: (name: string) => Promise<Array<{ symbol?: string | null }>>;
  readHopCache?: (key: string) => PeerHopCacheEntry | null;
  writeHopCache?: (key: string, entry: PeerHopCacheEntry) => void;
}

export function peer2HopCacheKey(ticker: string): string {
  return `peers2hop:${ticker.trim().toUpperCase()}`;
}

export function descriptionTokens(text: string): string[] {
  const parts = text.toLowerCase().split(/[^a-z0-9-]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const token = part.replace(/^-+|-+$/g, "");
    if (token.length < 5 || TOKEN_STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

export function tickerFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const ticker = value.trim().toUpperCase();
    return ticker || null;
  }
  if (value && typeof value === "object" && "symbol" in value) {
    return tickerFromUnknown((value as { symbol: unknown }).symbol);
  }
  return null;
}

function normalizeTickerList(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const ticker = tickerFromUnknown(item);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
  }
  return out;
}

function normalizeBySeed(raw: Record<string, unknown>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [seed, list] of Object.entries(raw)) {
    const key = seed.trim().toUpperCase();
    if (!key) continue;
    out[key] = normalizeTickerList(list);
  }
  return out;
}

export function topHopSeeds(subject: string, seeds: string[], limit = PEER_HOP_COUNT): string[] {
  const upperSubject = subject.trim().toUpperCase();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of seeds) {
    const ticker = tickerFromUnknown(raw);
    if (!ticker || ticker === upperSubject || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
    if (out.length >= limit) break;
  }
  return out;
}

function tokenSet(description: string | undefined, segmentNames: string[] | undefined): Set<string> {
  const text = [description ?? "", ...(segmentNames ?? [])].join(" ");
  return new Set(descriptionTokens(text));
}

function overlapCount(left: Set<string>, right: Set<string>): number {
  let n = 0;
  for (const token of Array.from(left)) if (right.has(token)) n++;
  return n;
}

function capDistance(subjectMarketCap: number, peerMarketCap: number): number {
  return Math.abs(Math.log(subjectMarketCap) - Math.log(peerMarketCap));
}

export function selectAdaptivePeerSet(input: {
  subject: string;
  subjectSector: string;
  subjectIndustry: string;
  subjectMarketCap: number;
  subjectDescription?: string;
  subjectSegmentNames?: string[];
  seeds: string[];
  hopBySeed: Record<string, string[]>;
  profiles: AdaptiveCandidateProfile[];
  maxPeers?: number;
  llmSymbols?: string[];
  searchedCompetition?: Array<{ name: string; symbol: string | null }>;
  curatedFallback?: string[];
}): string[] {
  const subject = input.subject.trim().toUpperCase();
  const maxPeers = input.maxPeers ?? PEER_TAKE;
  const hopSeeds = topHopSeeds(subject, input.seeds);
  const hopBySeed = normalizeBySeed(input.hopBySeed);
  const searched: string[] = [];
  for (const hit of input.searchedCompetition ?? []) {
    const symbol = tickerFromUnknown(hit.symbol);
    if (symbol && symbol !== subject && !searched.includes(symbol)) searched.push(symbol);
  }

  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (ticker: string | null) => {
    if (!ticker || ticker === subject || seen.has(ticker)) return;
    seen.add(ticker);
    candidates.push(ticker);
  };
  for (const seed of input.seeds) push(tickerFromUnknown(seed));
  for (const seed of hopSeeds) {
    for (const peer of hopBySeed[seed] ?? []) push(peer);
  }
  for (const symbol of searched) push(symbol);
  // llmSymbols are intentionally not pushed. A graph or Search+D ticker stays.

  const profileByTicker = new Map<string, AdaptiveCandidateProfile>();
  for (const profile of input.profiles) {
    const ticker = tickerFromUnknown(profile.ticker);
    if (!ticker || profileByTicker.has(ticker)) continue;
    profileByTicker.set(ticker, profile);
  }

  const subjectTokens = tokenSet(input.subjectDescription, input.subjectSegmentNames);
  const ranked: Array<{ ticker: string; exact: number; distance: number; overlap: number }> = [];
  for (const ticker of candidates) {
    const profile = profileByTicker.get(ticker);
    if (!profile) continue;
    if (!isIndustryCompatible(input.subjectSector, input.subjectIndustry, profile.sector, profile.industry).ok) continue;
    if (!isPeerMarketCapWithinBand(profile.marketCap, input.subjectMarketCap)) continue;
    const peerTokens = tokenSet(profile.description, profile.segmentNames);
    ranked.push({
      ticker,
      exact: isExactPeerIndustry(input.subjectIndustry, profile.industry) ? 0 : 1,
      distance: capDistance(input.subjectMarketCap, profile.marketCap as number),
      overlap: overlapCount(subjectTokens, peerTokens),
    });
  }

  ranked.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact - b.exact;
    const distanceGap = a.distance - b.distance;
    if (Math.abs(distanceGap) > CAP_DISTANCE_EPS) return distanceGap;
    if (a.overlap !== b.overlap) return b.overlap - a.overlap;
    return a.ticker.localeCompare(b.ticker);
  });

  if (ranked.length > 0) return ranked.slice(0, maxPeers).map(row => row.ticker);

  const fallback: string[] = [];
  const fallbackSeen = new Set<string>();
  for (const raw of input.curatedFallback ?? []) {
    const ticker = tickerFromUnknown(raw);
    if (!ticker || ticker === subject || fallbackSeen.has(ticker)) continue;
    fallbackSeen.add(ticker);
    fallback.push(ticker);
    if (fallback.length >= maxPeers) break;
  }
  return fallback;
}

export async function loadPeerHops(
  subject: string,
  seedsInOrder: string[],
  deps: {
    now?: number;
    readCache: (key: string) => PeerHopCacheEntry | null;
    writeCache: (key: string, entry: PeerHopCacheEntry) => void;
    fetchPeers: (ticker: string) => Promise<unknown>;
  },
): Promise<{ bySeed: Record<string, string[]>; hopCalls: number; cacheHit: boolean }> {
  const now = deps.now ?? Date.now();
  const key = peer2HopCacheKey(subject);
  const cached = deps.readCache(key);
  if (cached && cached.bySeed && typeof cached.fetchedAt === "number" && Number.isFinite(cached.fetchedAt)) {
    const age = now - cached.fetchedAt;
    if (age <= PEER_2HOP_TTL_MS) {
      return { bySeed: normalizeBySeed(cached.bySeed), hopCalls: 0, cacheHit: true };
    }
  }

  const bySeed: Record<string, string[]> = {};
  const seeds = topHopSeeds(subject, seedsInOrder);
  let hopCalls = 0;
  for (const seed of seeds) {
    hopCalls++;
    try {
      bySeed[seed] = normalizeTickerList(await deps.fetchPeers(seed));
    } catch {
      bySeed[seed] = [];
    }
  }
  const entry: PeerHopCacheEntry = { bySeed, fetchedAt: now };
  deps.writeCache(key, entry);
  return { bySeed, hopCalls, cacheHit: false };
}

function defaultReadHopCache(key: string): PeerHopCacheEntry | null {
  const row = diskResearcherGet(key) as { bySeed?: unknown; fetchedAt?: unknown } | null;
  if (!row || !row.bySeed || typeof row.bySeed !== "object" || Array.isArray(row.bySeed)) return null;
  const fetchedAt = Number(row.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return null;
  return { bySeed: normalizeBySeed(row.bySeed as Record<string, unknown>), fetchedAt };
}

function defaultWriteHopCache(key: string, entry: PeerHopCacheEntry): void {
  diskResearcherSet(key, { bySeed: entry.bySeed, fetchedAt: entry.fetchedAt });
}

async function defaultFetchPeers(ticker: string): Promise<unknown> {
  return fmpPeers(ticker);
}

async function defaultFetchProfile(ticker: string): Promise<AdaptiveCandidateProfile | null> {
  try {
    const row = await fmpProfile(ticker);
    if (!row) return null;
    const cap = Number(row.mktCap ?? row.marketCap);
    return {
      ticker,
      sector: String(row.sector ?? ""),
      industry: String(row.industry ?? ""),
      marketCap: Number.isFinite(cap) && cap > 0 ? cap : null,
      description: String(row.description ?? ""),
      segmentNames: [],
    };
  } catch {
    return null;
  }
}

async function defaultSearchTicker(name: string): Promise<Array<{ symbol?: string | null }>> {
  const rows = await fmpSearchTicker(name, 5);
  return rows.map(row => ({ symbol: row.symbol }));
}

export async function resolveAdaptivePeers(args: {
  subjectTicker: string;
  subjectSector: string;
  subjectIndustry: string;
  rawPeerTickers: string[];
  maxPeers?: number;
} & PeerAdaptiveCallOptions): Promise<string[]> {
  const subject = args.subjectTicker.trim().toUpperCase();
  const fetchPeers = args.fetchPeers ?? defaultFetchPeers;
  const fetchProfile = args.fetchProfile ?? defaultFetchProfile;
  const readHopCache = args.readHopCache ?? defaultReadHopCache;
  const writeHopCache = args.writeHopCache ?? defaultWriteHopCache;
  const now = args.now ?? Date.now();

  const loaded = await loadPeerHops(subject, args.rawPeerTickers, {
    now,
    readCache: readHopCache,
    writeCache: writeHopCache,
    fetchPeers,
  });

  let subjectMarketCap = args.subjectMarketCap;
  if (!(typeof subjectMarketCap === "number" && Number.isFinite(subjectMarketCap) && subjectMarketCap > 0)) {
    try {
      const self = await fetchProfile(subject);
      const cap = self?.marketCap;
      subjectMarketCap = typeof cap === "number" && Number.isFinite(cap) ? cap : 0;
    } catch {
      subjectMarketCap = 0;
    }
  }

  const searchedCompetition: Array<{ name: string; symbol: string | null }> = [];
  const names = (args.competitionNames ?? []).map(name => name.trim()).filter(Boolean);
  if (names.length > 0) {
    const searchTicker = args.searchTicker ?? defaultSearchTicker;
    for (const name of names) {
      try {
        const hits = await searchTicker(name);
        const symbol = tickerFromUnknown(hits?.[0]?.symbol ?? null);
        searchedCompetition.push({ name, symbol });
      } catch {
        searchedCompetition.push({ name, symbol: null });
      }
    }
  }

  const hopSeeds = topHopSeeds(subject, args.rawPeerTickers);
  const candidateTickers: string[] = [];
  const seen = new Set<string>();
  const push = (ticker: string | null) => {
    if (!ticker || ticker === subject || seen.has(ticker)) return;
    seen.add(ticker);
    candidateTickers.push(ticker);
  };
  for (const seed of args.rawPeerTickers) push(tickerFromUnknown(seed));
  for (const seed of hopSeeds) {
    for (const peer of loaded.bySeed[seed] ?? []) push(peer);
  }
  for (const hit of searchedCompetition) push(hit.symbol);

  const fetchedProfiles = await Promise.all(candidateTickers.map(async (ticker) => {
    try {
      return await fetchProfile(ticker);
    } catch {
      return null;
    }
  }));
  const profiles: AdaptiveCandidateProfile[] = [];
  candidateTickers.forEach((ticker, index) => {
    const profile = fetchedProfiles[index];
    if (!profile) return;
    const cap = profile.marketCap;
    profiles.push({
      ticker,
      sector: String(profile.sector ?? ""),
      industry: String(profile.industry ?? ""),
      marketCap: typeof cap === "number" && Number.isFinite(cap) ? cap : null,
      description: String(profile.description ?? ""),
      segmentNames: Array.isArray(profile.segmentNames) ? profile.segmentNames.map(name => String(name)) : [],
    });
  });

  const selected = selectAdaptivePeerSet({
    subject,
    subjectSector: args.subjectSector,
    subjectIndustry: args.subjectIndustry,
    subjectMarketCap,
    subjectDescription: args.subjectDescription,
    subjectSegmentNames: args.subjectSegmentNames,
    seeds: normalizeTickerList(args.rawPeerTickers),
    hopBySeed: loaded.bySeed,
    profiles,
    maxPeers: args.maxPeers ?? PEER_TAKE,
    llmSymbols: args.llmSymbols,
    searchedCompetition,
    curatedFallback: curatedPeerFallbackFor(subject),
  });
  console.log(`[PEERS-2HOP] ${subject} cacheHit=${loaded.cacheHit} hopCalls=${loaded.hopCalls} selected=${selected.join(",") || "-"}`);
  return selected;
}
