/**
 * valuechain-redis-ratelimit.ts
 * ------------------------------
 * Rang 9: optional Redis rate limit in front of the local FMP backoff.
 *
 * Spec (Offen_WORK_VALUECHAIN_SECTOR_ROTATION.md §2):
 *   - Fixed window: INCR + EXPIRE on `fmp:ratelimit:{minute}` (TTL 120s)
 *   - Concurrency gate: INCR/DECR on `fmp:concurrency` (TTL 120s)
 *   - Default budget 450 calls/minute (inside the 300–600 example)
 *   - Default concurrency 6 (inside 5–8)
 *
 * Active only when VALUECHAIN_REDIS_URL or REDIS_URL is set. No secret is
 * required. A missing URL, a blank URL, or an unreachable Redis falls open
 * to the existing in-process limiter for the rest of the process so a
 * downed optional Redis does not stall every ticker.
 */

import Redis from "ioredis";
import type { ValueChainRateLimitMode } from "../client/src/lib/valueChainTypes";

export const FMP_REDIS_BUDGET_PER_MIN_DEFAULT = 450;
export const FMP_REDIS_CONCURRENCY_DEFAULT = 6;
export const FMP_REDIS_WINDOW_TTL_SEC = 120;
export const FMP_REDIS_CONCURRENCY_TTL_SEC = 120;

const CONCURRENCY_KEY = "fmp:concurrency";

let client: Redis | null = null;
let connectAttempt: Promise<Redis | null> | null = null;
let unavailable = false;

export function fmpFixedWindowKey(now: Date = new Date()): string {
  const minute = Math.floor(now.getTime() / 60_000);
  return `fmp:ratelimit:${minute}`;
}

export function redisUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env.VALUECHAIN_REDIS_URL || env.REDIS_URL || "").trim();
  return raw.length > 0 ? raw : null;
}

export function readRedisBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.VALUECHAIN_FMP_REDIS_BUDGET_PER_MIN;
  if (raw == null || String(raw).trim() === "") return FMP_REDIS_BUDGET_PER_MIN_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return FMP_REDIS_BUDGET_PER_MIN_DEFAULT;
  return Math.floor(n);
}

export function readRedisConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.VALUECHAIN_FMP_REDIS_CONCURRENCY;
  if (raw == null || String(raw).trim() === "") return FMP_REDIS_CONCURRENCY_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return FMP_REDIS_CONCURRENCY_DEFAULT;
  return Math.floor(n);
}

export function fixedWindowExceeded(count: number, budget: number): boolean {
  return count > budget;
}

export function concurrencyExceeded(active: number, max: number): boolean {
  return active > max;
}

export function valueChainRateLimitMode(): ValueChainRateLimitMode {
  if (!redisUrlFromEnv() || unavailable) return "in-process";
  return "redis";
}

export interface ValueChainRedisPermit {
  mode: ValueChainRateLimitMode;
  limited: boolean;
  release: () => Promise<void>;
}

const noopRelease = async (): Promise<void> => {};

function inProcessPermit(): ValueChainRedisPermit {
  return { mode: "in-process", limited: false, release: noopRelease };
}

function warnRedis(message: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  console.warn(`[ValueChain-Redis] ${message}: ${detail}`);
}

async function getClient(): Promise<Redis | null> {
  const url = redisUrlFromEnv();
  if (!url || unavailable) return null;
  if (client && client.status === "ready") return client;
  if (!connectAttempt) {
    connectAttempt = (async () => {
      const created = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 800,
        commandTimeout: 1000,
        retryStrategy: () => null,
      });
      created.on("error", () => {
        /* connection errors are handled at the call site */
      });
      try {
        await created.connect();
        client = created;
        return created;
      } catch (err) {
        unavailable = true;
        warnRedis("optional limiter unavailable, using in-process", err);
        try {
          created.disconnect();
        } catch {
          /* already closed */
        }
        client = null;
        return null;
      }
    })();
  }
  return connectAttempt;
}

/**
 * Take one fixed-window slot and one concurrency slot.
 * `limited: true` means the caller must skip the FMP call and must not cache
 * that skip. `release` returns the concurrency slot (not the window count).
 */
export async function acquireValueChainRedisPermit(): Promise<ValueChainRedisPermit> {
  const redis = await getClient();
  if (!redis) return inProcessPermit();

  const budget = readRedisBudget();
  const maxConc = readRedisConcurrency();
  const windowKey = fmpFixedWindowKey();

  try {
    const windowCount = await redis.incr(windowKey);
    if (windowCount === 1) await redis.expire(windowKey, FMP_REDIS_WINDOW_TTL_SEC);
    if (fixedWindowExceeded(windowCount, budget)) {
      await redis.decr(windowKey);
      return { mode: "redis", limited: true, release: noopRelease };
    }

    const active = await redis.incr(CONCURRENCY_KEY);
    if (active === 1) await redis.expire(CONCURRENCY_KEY, FMP_REDIS_CONCURRENCY_TTL_SEC);
    if (concurrencyExceeded(active, maxConc)) {
      await redis.decr(CONCURRENCY_KEY);
      await redis.decr(windowKey);
      return { mode: "redis", limited: true, release: noopRelease };
    }

    return {
      mode: "redis",
      limited: false,
      release: async () => {
        try {
          await redis.decr(CONCURRENCY_KEY);
        } catch (err) {
          warnRedis("concurrency release failed", err);
        }
      },
    };
  } catch (err) {
    unavailable = true;
    warnRedis("optional limiter failed open", err);
    try {
      redis.disconnect();
    } catch {
      /* already closed */
    }
    client = null;
    connectAttempt = null;
    return inProcessPermit();
  }
}

/** Test-only. Drops the singleton so env changes take effect. */
export function resetValueChainRedisForTests(): void {
  unavailable = false;
  connectAttempt = null;
  if (client) {
    try {
      client.disconnect();
    } catch {
      /* ignore */
    }
  }
  client = null;
}
