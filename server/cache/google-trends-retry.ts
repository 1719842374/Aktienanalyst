/**
 * F3-04: bounded retry with exponential backoff for the SerpApi Google Trends call.
 * Every attempt costs SerpApi quota, so the budget is small:
 * - at most 3 attempts, delays 1 s then 2 s (capped at 4 s),
 * - retry only on 429, 5xx or a transport failure (status 0),
 * - an empty timeline / error body with HTTP 200 or another 4xx is not retried,
 * - after a run that ends on 429/5xx/timeout, SerpApi is not asked again for 15 min
 *   (one module-wide cooldown, so parallel or back-to-back requests cannot start a retry storm).
 * - F3-04b: total budget 15 s across all attempts incl. backoff; each attempt's timeout shrinks to the
 *   remaining budget. Retry-After (seconds or HTTP-date) on 429/503 is honoured only inside the budget;
 *   a longer Retry-After means no retry and the cooldown applies.
 * On final failure the caller gets null and keeps the existing path: last good print inside 48 h,
 * otherwise googleReading(null) → N/A with the "nicht verfügbar" notice. No substitute values.
 */
import { parseSerpApiGoogleTrends, type ParsedSerpApiTrends } from "./google-trends-cache";

export const GOOGLE_TRENDS_MAX_ATTEMPTS = 3;
export const GOOGLE_TRENDS_BACKOFF_BASE_MS = 1000;
export const GOOGLE_TRENDS_BACKOFF_CAP_MS = 4000;
export const GOOGLE_TRENDS_COOLDOWN_MS = 15 * 60 * 1000;
/** Total wall-clock budget for all attempts plus waits. */
export const GOOGLE_TRENDS_TOTAL_BUDGET_MS = 15_000;
/** Per-attempt timeout ceiling (unchanged from the single call). */
export const GOOGLE_TRENDS_ATTEMPT_TIMEOUT_MS = 12_000;
/** An attempt needs at least this much budget left (curl --max-time works in whole seconds). */
export const GOOGLE_TRENDS_MIN_ATTEMPT_MS = 1_000;

export interface SerpApiHttpResult {
  /** HTTP status; 0 for timeout or transport failure. */
  status: number;
  body: string;
  /** Raw Retry-After header, if any. */
  retryAfter?: string;
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

/** Retry-After → ms (delta-seconds or HTTP-date). Null when absent or unparseable. */
export function parseRetryAfterMs(raw: string | undefined, nowMs: number): number | null {
  if (raw == null) return null;
  const v = raw.trim();
  if (v === "") return null;
  if (/^\d+$/.test(v)) return parseInt(v, 10) * 1000;
  const at = Date.parse(v);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - nowMs);
}

export function fetchGoogleTrendsWithRetry(
  fetchOnce: (timeoutMs: number) => SerpApiHttpResult,
  sleep: (ms: number) => void,
  now: () => number = Date.now,
): GoogleTrendsRetryOutcome {
  if (now() < cooldownUntil) return { parsed: null, attempts: 0, reason: "cooldown" };
  if (inFlight) return { parsed: null, attempts: 0, reason: "busy" };
  inFlight = true;
  try {
    const started = now();
    const remaining = () => GOOGLE_TRENDS_TOTAL_BUDGET_MS - (now() - started);
    let attempts = 0;
    let reason = "empty";
    while (attempts < GOOGLE_TRENDS_MAX_ATTEMPTS) {
      const left = remaining();
      if (left < GOOGLE_TRENDS_MIN_ATTEMPT_MS) {
        reason = attempts === 0 ? "budget" : `${reason}+budget`;
        break;
      }
      attempts++;
      const res = fetchOnce(Math.min(GOOGLE_TRENDS_ATTEMPT_TIMEOUT_MS, left));
      if (isRetryableStatus(res.status)) {
        reason = `http-${res.status}`;
        if (attempts >= GOOGLE_TRENDS_MAX_ATTEMPTS) break;
        const ra = res.status === 429 || res.status === 503 ? parseRetryAfterMs(res.retryAfter, now()) : null;
        const wait = ra ?? googleTrendsBackoffMs(attempts);
        // The wait plus a minimal next attempt must fit in the budget, otherwise give up now.
        if (wait + GOOGLE_TRENDS_MIN_ATTEMPT_MS > remaining()) {
          reason = ra != null ? `${reason}+retry-after-over-budget` : `${reason}+budget`;
          break;
        }
        sleep(wait);
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
