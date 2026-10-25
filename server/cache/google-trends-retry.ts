/**
 * F3-04: bounded retry with exponential backoff for the SerpApi Google Trends call.
 * Every attempt costs SerpApi quota, so the budget is small:
 * - at most 3 attempts, delays 1 s then 2 s (capped at 4 s),
 * - retry only on 429, 5xx or a transport failure (status 0),
 * - an empty timeline / error body with HTTP 200 or another 4xx is not retried,
 * - after a run that ends on 429/5xx/timeout, SerpApi is not asked again for 15 min
 *   (one module-wide cooldown, so parallel or back-to-back requests cannot start a retry storm).
 * On final failure the caller gets null and keeps the existing path: last good print inside 48 h,
 * otherwise googleReading(null) → N/A with the "nicht verfügbar" notice. No substitute values.
 */
import { parseSerpApiGoogleTrends, type ParsedSerpApiTrends } from "./google-trends-cache";

export const GOOGLE_TRENDS_MAX_ATTEMPTS = 3;
export const GOOGLE_TRENDS_BACKOFF_BASE_MS = 1000;
export const GOOGLE_TRENDS_BACKOFF_CAP_MS = 4000;
export const GOOGLE_TRENDS_COOLDOWN_MS = 15 * 60 * 1000;

export interface SerpApiHttpResult {
  /** HTTP status; 0 for timeout or transport failure. */
  status: number;
  body: string;
}

export interface GoogleTrendsRetryOutcome {
  parsed: ParsedSerpApiTrends | null;
  attempts: number;
  /** "ok" | "cooldown" | "busy" | "http-<status>" | "empty" */
  reason: string;
}

let cooldownUntil = 0;
let inFlight = false;

export function resetGoogleTrendsRetryState(): void {
  cooldownUntil = 0;
  inFlight = false;
}

export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

/** Delay before attempt n+1 (n = 1-based number of the failed attempt). */
export function googleTrendsBackoffMs(failedAttempt: number): number {
  return Math.min(GOOGLE_TRENDS_BACKOFF_CAP_MS, GOOGLE_TRENDS_BACKOFF_BASE_MS * 2 ** (failedAttempt - 1));
}

export function fetchGoogleTrendsWithRetry(
  fetchOnce: () => SerpApiHttpResult,
  sleep: (ms: number) => void,
  now: () => number = Date.now,
): GoogleTrendsRetryOutcome {
  if (now() < cooldownUntil) return { parsed: null, attempts: 0, reason: "cooldown" };
  if (inFlight) return { parsed: null, attempts: 0, reason: "busy" };
  inFlight = true;
  try {
    let attempts = 0;
    let reason = "empty";
    while (attempts < GOOGLE_TRENDS_MAX_ATTEMPTS) {
      attempts++;
      const res = fetchOnce();
      if (isRetryableStatus(res.status)) {
        reason = `http-${res.status}`;
        if (attempts < GOOGLE_TRENDS_MAX_ATTEMPTS) sleep(googleTrendsBackoffMs(attempts));
        continue;
      }
      const parsed = res.status >= 200 && res.status < 300 ? parseSerpApiGoogleTrends(res.body) : null;
      if (parsed) return { parsed, attempts, reason: "ok" };
      // 200 without a print or a non-retryable 4xx: another call would only burn quota.
      return { parsed: null, attempts, reason: res.status >= 200 && res.status < 300 ? "empty" : `http-${res.status}` };
    }
    cooldownUntil = now() + GOOGLE_TRENDS_COOLDOWN_MS;
    return { parsed: null, attempts, reason };
  } finally {
    inFlight = false;
  }
}
