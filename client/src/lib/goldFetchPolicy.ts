import { apiRequest } from "./queryClient";
import { GOLD_FALLBACK_DATA } from "./goldFallbackData";

/** Zusätzliche Versuche nach dem ersten Fehlschlag. Mehr als einer. */
export const GOLD_FETCH_RETRY_COUNT = 3;
/** Wartezeit vor dem ersten Retry; jeder weitere Versuch verdoppelt sie. */
export const GOLD_FETCH_RETRY_BASE_MS = 1000;
/** Obergrenze der Wartezeit zwischen zwei Versuchen. */
export const GOLD_FETCH_RETRY_MAX_MS = 8000;
/** Frische Live-Antwort von /api/analyze-gold. */
export const GOLD_LIVE_STALE_MS = 5 * 60 * 1000;
/** Fallback und Chart-Ladefehler gelten sofort als veraltet und liegen nicht als frischer Cache. */
export const GOLD_FALLBACK_STALE_MS = 0;
/** Abstand, in dem ein Fallback oder ein Chart-Ladefehler im Hintergrund neu geholt wird. */
export const GOLD_FALLBACK_REFETCH_MS = 15_000;

export function goldRetryDelay(attempt: number): number {
  const step = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return Math.min(GOLD_FETCH_RETRY_BASE_MS * 2 ** step, GOLD_FETCH_RETRY_MAX_MS);
}

/** HTTP-Status oder Timeout-Text aus apiRequest, sonst die Fehlermeldung. */
export function goldFailureReason(error: unknown): string {
  const msg = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const http = /^(?:HTTP|Gold-API|Gold-Historie) (\d{3})\b/.exec(msg);
  if (http) return `HTTP ${http[1]}`;
  if (/^Timeout:/i.test(msg)) return msg;
  if (msg) return msg;
  return "Live-API nicht erreichbar";
}

export function isGoldFallbackData(data: { timestamp?: string } | null | undefined): boolean {
  return !!data && data.timestamp === GOLD_FALLBACK_DATA.timestamp;
}

export function goldAnalysisStaleTime(data: { timestamp?: string } | null | undefined): number {
  return isGoldFallbackData(data) ? GOLD_FALLBACK_STALE_MS : GOLD_LIVE_STALE_MS;
}

export function goldAnalysisRefetchInterval(data: { timestamp?: string } | null | undefined): number | false {
  return isGoldFallbackData(data) ? GOLD_FALLBACK_REFETCH_MS : false;
}

export function goldChartHistoryStaleTime(data: { loadError?: string | null; incomplete?: boolean } | null | undefined): number {
  if (data?.loadError) return GOLD_FALLBACK_STALE_MS;
  return data?.incomplete ? 10 * 60 * 1000 : 6 * 60 * 60 * 1000;
}

export function goldChartHistoryRefetchInterval(data: { loadError?: string | null } | null | undefined): number | false {
  return data?.loadError ? GOLD_FALLBACK_REFETCH_MS : false;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type GoldFetchSuccess<T> = { ok: true; data: T };
export type GoldFetchFailure = { ok: false; reason: string };

/**
 * Ein Aufruf, dann GOLD_FETCH_RETRY_COUNT weitere Versuche mit goldRetryDelay.
 * Wirft nicht: der Aufrufer entscheidet, ob Fallback oder Chart-Hinweis.
 * React Query retry bleibt aus, sonst liefe die Schleife doppelt.
 */
export async function fetchGoldWithRetry<T>(
  url: string,
  opts?: {
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    request?: (url: string, timeoutMs: number) => Promise<Response>;
  },
): Promise<GoldFetchSuccess<T> | GoldFetchFailure> {
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const pause = opts?.sleep ?? defaultSleep;
  const request = opts?.request ?? ((target, timeout) => apiRequest("GET", target, undefined, timeout));
  let last: unknown;
  const attempts = GOLD_FETCH_RETRY_COUNT + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await request(url, timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true, data: (await res.json()) as T };
    } catch (err) {
      last = err;
      if (attempt < attempts - 1) await pause(goldRetryDelay(attempt));
    }
  }
  return { ok: false, reason: goldFailureReason(last) };
}
