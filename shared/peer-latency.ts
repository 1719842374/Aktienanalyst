/**
 * Timeout und Ladehinweis je Route.
 * Mit Messungen: hohes Perzentil (PEER_LATENCY_PERCENTILE) mal PEER_LATENCY_SAFETY_FACTOR.
 * Der Median mal 1 bricht die langsamere Hälfte ab. Der Faktor ist > 1, damit ein Call
 * in der Nähe des Perzentils durchläuft. Kein Floor und kein Cap auf der Millisekunden-Zahl.
 * Ohne Messung: der Worst-Case des jeweiligen Providers, sonst läuft der Spinner ohne Abbruch.
 */
export type PeerLatencyRoute = "peer-append" | "peer-na-fill";

/** P90. Liegt über dem Median, damit nicht jeder zweite Call an der Grenze stirbt. */
export const PEER_LATENCY_PERCENTILE = 0.9;

/** Aufschlag über dem Perzentil. Muss > 1 bleiben. */
export const PEER_LATENCY_SAFETY_FACTOR = 1.5;

/**
 * server/fmp.ts fmpFetch: AbortSignal.timeout(15000).
 * Ein einzelner FMP-Call gibt nach dieser Zeit auf und retried.
 */
export const FMP_PROVIDER_TIMEOUT_MS = 15_000;

/** server/fmp.ts FMP_CONFIG.maxRetries, Default 2. */
export const FMP_PROVIDER_MAX_RETRIES = 2;

/** server/fmp.ts Backoff 500 * 2^attempt zwischen den Versuchen. */
export const FMP_PROVIDER_RETRY_BASE_MS = 500;

/**
 * openai/client.js DEFAULT_TIMEOUT. server/llm-openrouter.ts erzeugt den Client ohne eigenes timeout,
 * also gilt dieser Wert pro LLM-Request. Ein Timeout wirft und fällt nicht in die Modellkette.
 */
export const LLM_PROVIDER_TIMEOUT_MS = 600_000;

/** Ein FMP-Call inklusive der Retries, die der Server noch abwartet. */
export function fmpProviderWorstCaseMs(
  timeoutMs = FMP_PROVIDER_TIMEOUT_MS,
  maxRetries = FMP_PROVIDER_MAX_RETRIES,
  retryBaseMs = FMP_PROVIDER_RETRY_BASE_MS,
): number {
  let total = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    total += timeoutMs;
    if (attempt < maxRetries) total += retryBaseMs * 2 ** attempt;
  }
  return total;
}

/** peer-append wartet nur auf FMP. */
export const PEER_APPEND_FIRST_CALL_TIMEOUT_MS = fmpProviderWorstCaseMs();

/** peer-na-fill wartet erst auf das LLM, danach auf FMP. */
export const PEER_NA_FILL_FIRST_CALL_TIMEOUT_MS = LLM_PROVIDER_TIMEOUT_MS + fmpProviderWorstCaseMs();

const FIRST_CALL_TIMEOUT_MS: Record<PeerLatencyRoute, number> = {
  "peer-append": PEER_APPEND_FIRST_CALL_TIMEOUT_MS,
  "peer-na-fill": PEER_NA_FILL_FIRST_CALL_TIMEOUT_MS,
};

const pools: Record<PeerLatencyRoute, number[]> = {
  "peer-append": [],
  "peer-na-fill": [],
};

export function clearPeerCallSamples(route?: PeerLatencyRoute): void {
  if (route) {
    pools[route].length = 0;
    return;
  }
  pools["peer-append"].length = 0;
  pools["peer-na-fill"].length = 0;
}

export function peerCallSamples(route: PeerLatencyRoute): readonly number[] {
  return pools[route].slice();
}

export function recordPeerCallMs(route: PeerLatencyRoute, ms: number): void {
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) pools[route].push(ms);
}

export function percentileMs(samplesMs: readonly number[], percentile = PEER_LATENCY_PERCENTILE): number | null {
  const sorted = samplesMs.filter(ms => typeof ms === "number" && Number.isFinite(ms) && ms > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const rank = percentile * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

export function peerTimeoutFromSamples(
  samplesMs: readonly number[],
  fallbackMs: number,
  percentile = PEER_LATENCY_PERCENTILE,
  safetyFactor = PEER_LATENCY_SAFETY_FACTOR,
): number {
  const percentileValue = percentileMs(samplesMs, percentile);
  if (percentileValue == null) return fallbackMs;
  return percentileValue * safetyFactor;
}

export function peerTimeoutMs(route: PeerLatencyRoute): number {
  return peerTimeoutFromSamples(pools[route], FIRST_CALL_TIMEOUT_MS[route]);
}

export function peerTimeoutAbortText(timeoutMs: number): string {
  return `Timeout: Server hat nicht innerhalb von ${Math.round(timeoutMs / 1000)}s geantwortet`;
}

export function peerLoadingLabel(route: PeerLatencyRoute): string {
  const timeout = peerTimeoutMs(route);
  const seconds = timeout / 1000;
  const shown = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  if (pools[route].length === 0) return `Peer wird geladen… Abbruch nach ${shown}s`;
  return `Peer wird geladen… typisch bis ${shown}s`;
}
