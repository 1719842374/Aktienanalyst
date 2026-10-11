/**
 * One in-memory layer for the SerpApi Google Trends "Recession" print.
 * Fresh hits (under 12h) skip SerpApi. A 429, empty timeline, or timeout
 * keeps the last good print for 48h. The zone weights are not stored here.
 */

export const GOOGLE_TRENDS_CACHE_KEY = "google-trends-recession";
/** Top of the 6–12h band. At this age the next run asks SerpApi again. */
export const GOOGLE_TRENDS_FRESH_MS = 12 * 60 * 60 * 1000;
/** Future_4: a print older than this is not a market value. */
export const GOOGLE_TRENDS_LAST_GOOD_MS = 48 * 60 * 60 * 1000;
/** Task + Future_4: the UI marks the print veraltet only after this age. */
export const GOOGLE_TRENDS_STALE_AFTER_HOURS = 24;

export interface GoogleTrendsCacheEntry {
  value: number;
  timestamp: number;
  source: string;
}

export interface GoogleTrendsFreshness {
  ageHours: number;
  isStale: boolean;
}

export interface ParsedSerpApiTrends {
  value: number;
  latest: number;
  peak: number;
  source: string;
}

export interface AcceptedGoogleTrends {
  /** Null when nothing inside 48h can be scored. */
  value: number | null;
  source: string;
  ageHours: number | null;
  isStale: boolean;
  /** Set only when SerpApi just returned a finite print. Failures must not refresh the timestamp. */
  store: GoogleTrendsCacheEntry | null;
}

let memory: GoogleTrendsCacheEntry | null = null;

export function resetGoogleTrendsCache(): void {
  memory = null;
}

export function readGoogleTrendsCache(): GoogleTrendsCacheEntry | null {
  return memory ? { ...memory } : null;
}

export function writeGoogleTrendsCache(entry: GoogleTrendsCacheEntry): void {
  memory = { value: entry.value, timestamp: entry.timestamp, source: entry.source };
}

export function googleTrendsFreshness(ageMs: number): GoogleTrendsFreshness {
  const ageHours = Math.round((ageMs / 3_600_000) * 10) / 10;
  return { ageHours, isStale: ageHours > GOOGLE_TRENDS_STALE_AFTER_HOURS };
}

function ageMsOf(entry: GoogleTrendsCacheEntry, now: number): number | null {
  if (!Number.isFinite(entry.timestamp) || !Number.isFinite(entry.value) || !Number.isFinite(now)) return null;
  const age = now - entry.timestamp;
  if (age < 0) return null;
  return age;
}

/** A hit inside the fresh TTL. The caller must not call SerpApi. */
export function freshGoogleTrends(entry: GoogleTrendsCacheEntry | null, now: number): (GoogleTrendsFreshness & { value: number; source: string }) | null {
  if (!entry) return null;
  const age = ageMsOf(entry, now);
  if (age == null || age >= GOOGLE_TRENDS_FRESH_MS) return null;
  return { value: entry.value, source: entry.source, ...googleTrendsFreshness(age) };
}

/**
 * After a SerpApi attempt. `fetched` null means 429, empty timeline, timeout, or a body without a print.
 * The previous entry is returned unchanged when it is still inside 48h.
 */
export function acceptGoogleTrendsFetch(
  fetched: { value: number; source: string } | null,
  cached: GoogleTrendsCacheEntry | null,
  now: number,
): AcceptedGoogleTrends {
  if (fetched && Number.isFinite(fetched.value)) {
    return {
      value: fetched.value,
      source: fetched.source,
      ageHours: 0,
      isStale: false,
      store: { value: fetched.value, source: fetched.source, timestamp: now },
    };
  }
  if (cached) {
    const age = ageMsOf(cached, now);
    if (age != null && age <= GOOGLE_TRENDS_LAST_GOOD_MS) {
      const freshness = googleTrendsFreshness(age);
      return {
        value: cached.value,
        source: cached.source,
        ageHours: freshness.ageHours,
        isStale: freshness.isStale,
        store: null,
      };
    }
  }
  return { value: null, source: "Google Trends (N/A)", ageHours: null, isStale: false, store: null };
}

function finitePoint(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = parseFloat(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/** SerpApi body → 7d average. An error object, HTML, or an empty timeline is a miss. */
export function parseSerpApiGoogleTrends(raw: string): ParsedSerpApiTrends | null {
  if (!raw || raw.includes("<html") || raw.includes("<!DOCTYPE")) return null;
  let parsed: {
    error?: unknown;
    search_metadata?: { status?: unknown };
    interest_over_time?: { timeline_data?: unknown };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed?.error) return null;
  const status = parsed?.search_metadata?.status;
  if (typeof status === "string" && status.toLowerCase() === "error") return null;
  const timeline = parsed?.interest_over_time?.timeline_data;
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  const values: number[] = [];
  for (const point of timeline) {
    const row = point as { values?: Array<{ extracted_value?: unknown; value?: unknown }> } | null;
    const cell = row?.values?.[0];
    const num = finitePoint(cell?.extracted_value ?? cell?.value);
    if (num != null) values.push(num);
  }
  if (values.length === 0) return null;
  const avg = Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * 10) / 10;
  const latest = values[values.length - 1];
  const peak = Math.max(...values);
  return {
    value: avg,
    latest,
    peak,
    source: `Google Trends via SerpApi (7d Ø=${avg}, Latest=${latest}, Peak=${peak})`,
  };
}
