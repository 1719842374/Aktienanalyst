/**
 * withBackoff.ts
 * --------------
 * Exponential Backoff with Jitter for FMP / external API calls.
 *
 * Supports:
 * - Equal Jitter (default, good compromise)
 * - Decorrelated Jitter (AWS-style, very robust against Thundering Herd)
 *
 * Spec: WORK_VALUECHAIN_SECTOR_ROTATION.md
 */

export type JitterStrategy = "equal" | "decorrelated" | "full" | "none";

export interface BackoffOptions {
  /** Base delay in ms (default 1000) */
  baseDelayMs?: number;
  /** Cap on delay in ms (default 16000) */
  maxDelayMs?: number;
  /** Max retry attempts after the first failure (default 4) */
  maxRetries?: number;
  /** Jitter strategy (default "equal") */
  jitter?: JitterStrategy;
  /** Custom predicate: return true if the error is retryable */
  retryOn?: (err: unknown) => boolean;
}

const defaultRetryOn = (err: unknown): boolean => {
  const anyErr = err as any;
  const status = anyErr?.status ?? anyErr?.response?.status;
  // Retry on rate-limit, gateway errors, or network failures (no status)
  return status === 429 || status === 503 || status === 502 || status == null;
};

function computeDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: JitterStrategy,
  previousDelay: number
): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);

  switch (jitter) {
    case "none":
      return exp;

    case "full":
      // Full Jitter: random(0, exp)
      return Math.random() * exp;

    case "decorrelated":
      // Decorrelated Jitter (AWS): random(base, previousDelay * 3)
      // First attempt uses exp as previousDelay seed
      const seed = previousDelay > 0 ? previousDelay : exp;
      return Math.min(
        maxDelayMs,
        Math.random() * (seed * 3 - baseDelayMs) + baseDelayMs
      );

    case "equal":
    default:
      // Equal Jitter: exp/2 + random(0, exp/2)  ≈ 50–100% of exp
      // Slightly wider variant used in practice: 70–130%
      return exp * (0.7 + Math.random() * 0.6);
  }
}

/**
 * Wraps an async function with exponential backoff + jitter.
 *
 * @example
 * const profile = await withExponentialBackoff(() => fmpProfile(ticker));
 * const data = await withExponentialBackoff(() => fmpIncome(ticker), {
 *   jitter: "decorrelated",
 *   maxRetries: 5,
 * });
 */
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions = {}
): Promise<T> {
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 16_000;
  const maxRetries = opts.maxRetries ?? 4;
  const jitter = opts.jitter ?? "equal";
  const retryOn = opts.retryOn ?? defaultRetryOn;

  let attempt = 0;
  let previousDelay = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!retryOn(err) || attempt >= maxRetries) {
        throw err;
      }

      const delay = computeDelay(
        attempt,
        baseDelayMs,
        maxDelayMs,
        jitter,
        previousDelay
      );
      previousDelay = delay;

      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
