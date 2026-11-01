/**
 * Podcast-Transkript, lokal im bestehenden Researcher-Cache.
 * Kein Supabase, keine eigene Tabelle. Zu langer Text wird abgelehnt, nicht gekürzt.
 */

/** Dieselbe Frist wie CACHE_TTL_DAYS in server/disk-cache.ts (7 Tage). */
export const PODCAST_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Obergrenze, darüber n/a statt stiller Kürzung. */
export const PODCAST_TEXT_MAX_CHARS = 20_000;

export function podcastCacheKey(symbol: string): string {
  return `podcast_transcript__${symbol}`;
}

export interface PodcastTranscript {
  symbol: string;
  text: string | null;
  storedAt: string | null;
  reason: string | null;
}

export function emptyTranscript(symbol: string, reason: string): PodcastTranscript {
  return { symbol, text: null, storedAt: null, reason };
}

export function paragraphsOf(text: string): string[] {
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}

export function acceptTranscriptText(text: unknown): { text: string | null; reason: string | null } {
  if (typeof text !== "string" || !text.trim()) return { text: null, reason: "n/a — leeres Transkript" };
  const trimmed = text.trim();
  if (trimmed.length > PODCAST_TEXT_MAX_CHARS) {
    return { text: null, reason: `n/a — Transkript länger als ${PODCAST_TEXT_MAX_CHARS} Zeichen, nicht gespeichert` };
  }
  return { text: trimmed, reason: null };
}
