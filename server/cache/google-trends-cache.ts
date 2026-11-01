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
  /** Tagespunkte der SerpApi-Timeline, nur für die Anzeige. Der Score nutzt weiter `value`. */
  points?: { date: string; value: number }[];
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
let lastMiss: { kind: GoogleTrendsMissKind; httpStatus: number | null } | null = null;

export function resetGoogleTrendsCache(): void {
  memory = null;
  lastMiss = null;
}

export function readGoogleTrendsCache(): GoogleTrendsCacheEntry | null {
  if (!memory) return null;
  return {
    value: memory.value,
    timestamp: memory.timestamp,
    source: memory.source,
    ...(memory.points?.length ? { points: memory.points.map(p => ({ date: p.date, value: p.value })) } : {}),
  };
}

export function writeGoogleTrendsCache(entry: GoogleTrendsCacheEntry): void {
  memory = {
    value: entry.value,
    timestamp: entry.timestamp,
    source: entry.source,
    ...(entry.points?.length ? { points: entry.points.map(p => ({ date: p.date, value: p.value })) } : {}),
  };
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
  fetched: { value: number; source: string; points?: { date: string; value: number }[] } | null,
  cached: GoogleTrendsCacheEntry | null,
  now: number,
): AcceptedGoogleTrends {
  if (fetched && Number.isFinite(fetched.value)) {
    return {
      value: fetched.value,
      source: fetched.source,
      ageHours: 0,
      isStale: false,
      store: {
        value: fetched.value,
        source: fetched.source,
        timestamp: now,
        ...(fetched.points?.length ? { points: fetched.points } : {}),
      },
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

function trendPointDate(point: { timestamp?: unknown; date?: unknown } | null): string | null {
  const ts = typeof point?.timestamp === "number" ? point.timestamp : Number(point?.timestamp);
  if (Number.isFinite(ts) && ts > 1_000_000_000) return new Date(ts * 1000).toISOString().slice(0, 10);
  const text = typeof point?.date === "string" ? point.date.trim() : "";
  const match = text.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!match) return null;
  const months: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const month = months[match[1]];
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) return null;
  return `${match[3]}-${month}-${String(day).padStart(2, "0")}`;
}

/** Dieselbe Timeline wie der 7d-Ø, mit Datum. Ein Body ohne Druck ist null. Der Score-Wert ändert sich nicht. */
export function parseSerpApiTrendPoints(raw: string): { date: string; value: number }[] | null {
  if (!parseSerpApiGoogleTrends(raw)) return null;
  let parsed: { interest_over_time?: { timeline_data?: unknown } };
  try { parsed = JSON.parse(raw) as typeof parsed; } catch { return null; }
  const timeline = parsed.interest_over_time?.timeline_data;
  if (!Array.isArray(timeline)) return null;
  const out: { date: string; value: number }[] = [];
  for (const point of timeline) {
    const row = point as { timestamp?: unknown; date?: unknown; values?: Array<{ extracted_value?: unknown; value?: unknown }> } | null;
    const cell = row?.values?.[0];
    const num = finitePoint(cell?.extracted_value ?? cell?.value);
    const date = trendPointDate(row);
    if (num == null || !date) continue;
    out.push({ date, value: num });
  }
  return out.length ? out : null;
}

/**
 * F3-04 / F4-05. Nur HTTP 429 wird wiederholt. Leere Timeline und Timeout
 * kosten keinen zweiten SerpApi-Call. Die Pausen sind Parameter, kein Streuwert.
 * Retry-After der Antwort gewinnt, gedeckelt, damit die Analyse nicht stehen bleibt.
 */
export const GOOGLE_TRENDS_BACKOFF = {
  maxAttempts: 3,
  baseMs: 400,
  factor: 2,
  capMs: 2000,
} as const;

export type GoogleTrendsMissKind = "no_key" | "rate_limit" | "timeout" | "empty" | "error" | "stale_cache";

export interface SerpApiAttempt {
  status: number | null;
  body: string;
  retryAfterMs: number | null;
}

export interface TrendsFetchOutcome {
  ok: boolean;
  body: string | null;
  kind: GoogleTrendsMissKind | null;
  httpStatus: number | null;
  attempts: number;
  delaysMs: number[];
}

export function classifySerpApiAttempt(
  attempt: SerpApiAttempt,
): { ok: true } | { ok: false; kind: GoogleTrendsMissKind; httpStatus: number | null } {
  if (attempt.status === 429) return { ok: false, kind: "rate_limit", httpStatus: 429 };
  if (attempt.status == null || attempt.status === 0) return { ok: false, kind: "timeout", httpStatus: attempt.status };
  if (attempt.status >= 400) return { ok: false, kind: "error", httpStatus: attempt.status };
  if (!parseSerpApiGoogleTrends(attempt.body)) return { ok: false, kind: "empty", httpStatus: attempt.status };
  return { ok: true };
}

/** Wartezeit vor dem nächsten Versuch. retryIndex 0 ist die erste Pause. */
export function trendsBackoffDelayMs(retryIndex: number, retryAfterMs: number | null): number {
  const exponential = Math.min(
    GOOGLE_TRENDS_BACKOFF.capMs,
    GOOGLE_TRENDS_BACKOFF.baseMs * GOOGLE_TRENDS_BACKOFF.factor ** retryIndex,
  );
  if (retryAfterMs != null && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(GOOGLE_TRENDS_BACKOFF.capMs, retryAfterMs);
  }
  return exponential;
}

/** Ruft SerpApi so oft auf, wie der Backoff erlaubt. Der Score wertet das Ergebnis separat. */
export function collectTrendsFetch(input: {
  call: () => SerpApiAttempt;
  sleep: (ms: number) => void;
  maxAttempts?: number;
}): TrendsFetchOutcome {
  const max = input.maxAttempts ?? GOOGLE_TRENDS_BACKOFF.maxAttempts;
  const delaysMs: number[] = [];
  let kind: GoogleTrendsMissKind = "error";
  let httpStatus: number | null = null;
  let attempts = 0;
  for (let i = 0; i < max; i++) {
    attempts = i + 1;
    const attempt = input.call();
    const classified = classifySerpApiAttempt(attempt);
    if (classified.ok) {
      return { ok: true, body: attempt.body, kind: null, httpStatus: attempt.status, attempts, delaysMs };
    }
    kind = classified.kind;
    httpStatus = classified.httpStatus;
    if (kind !== "rate_limit" || i >= max - 1) break;
    const delay = trendsBackoffDelayMs(i, attempt.retryAfterMs);
    delaysMs.push(delay);
    input.sleep(delay);
  }
  return { ok: false, body: null, kind, httpStatus, attempts, delaysMs };
}

export function googleTrendsMissPhrase(kind: GoogleTrendsMissKind, httpStatus: number | null): string {
  switch (kind) {
    case "no_key": return "SerpApi-Schlüssel fehlt";
    case "rate_limit": return "SerpApi-Limit (429)";
    case "timeout": return "SerpApi-Timeout";
    case "empty": return "SerpApi lieferte keine Timeline";
    case "error": return httpStatus != null ? `SerpApi-Fehler (HTTP ${httpStatus})` : "SerpApi-Fehler";
    case "stale_cache": return "letzter Wert älter als 48 h";
  }
}

/** Anzeigetext, wenn nichts innerhalb 48 h gewertet werden darf. Kein erfundener Index. */
export function googleTrendsClosedLabel(kind: GoogleTrendsMissKind, httpStatus: number | null, cacheExpired: boolean): string {
  const phrase = googleTrendsMissPhrase(kind, httpStatus);
  if (kind === "no_key" || kind === "stale_cache") return `n/a — ${phrase}`;
  if (cacheExpired) return `n/a — letzter Wert älter als 48 h (${phrase})`;
  return `n/a — ${phrase}, kein Wert innerhalb 48 h`;
}

/** Neben dem letzten gültigen Wert. Das Gewicht der Zone bleibt der bestehende Parameter. */
export function googleTrendsFetchNote(kind: GoogleTrendsMissKind, httpStatus: number | null): string {
  return `Abruf: ${googleTrendsMissPhrase(kind, httpStatus)}. Letzter gültiger Wert, Gewicht unverändert.`;
}

export function writeGoogleTrendsMiss(kind: GoogleTrendsMissKind, httpStatus: number | null): void {
  lastMiss = { kind, httpStatus };
}

export function readGoogleTrendsMiss(): { kind: GoogleTrendsMissKind; httpStatus: number | null } | null {
  return lastMiss ? { kind: lastMiss.kind, httpStatus: lastMiss.httpStatus } : null;
}

export function clearGoogleTrendsMiss(): void {
  lastMiss = null;
}
