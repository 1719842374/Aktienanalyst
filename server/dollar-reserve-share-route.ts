/**
 * GET /api/macro/dollar-reserve-share — F1-39 auf dem Rezessions-Dashboard (Future_1_Work.md Z.461).
 * Kette: fetchDollarReserveShare (server/dollar-reserve-share.ts, IMF COFER) → dollarReserveShareTrend.
 * Nur Anzeige, kein Score. Nicht erreichbar → available false + Grund, nie 0.
 * Cache nur bei verfügbarem Wert, TTL aus DOLLAR_RESERVE_SHARE_PARAMS (Quartalsdaten).
 */
import type { Express, Request, Response } from "express";
import {
  DOLLAR_RESERVE_SHARE_PARAMS,
  dollarReserveShareTrend,
  type DollarReserveShareResponse,
} from "../shared/dollar-reserve-share";
import { fetchDollarReserveShare } from "./dollar-reserve-share";

export async function loadDollarReserveShare(
  deps: { fetchShare?: typeof fetchDollarReserveShare } = {},
): Promise<DollarReserveShareResponse> {
  const fetchShare = deps.fetchShare ?? fetchDollarReserveShare;
  try {
    const { result } = await fetchShare();
    if (!result.available) {
      return { source: "IMF COFER", available: false, reason: result.reason, trend: null, trendReason: null };
    }
    const trend = dollarReserveShareTrend(result.series);
    return {
      source: "IMF COFER",
      available: true,
      latestPeriod: result.latestPeriod,
      latestPct: result.latestPct,
      quarters: result.quarters,
      trend: trend.trend,
      trendReason: trend.reason,
    };
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, DOLLAR_RESERVE_SHARE_PARAMS.maxReasonChars);
    return { source: "IMF COFER", available: false, reason: `IMF COFER: ${message}`, trend: null, trendReason: null };
  }
}

let cache: { at: number; body: DollarReserveShareResponse } | null = null;

export async function getDollarReserveShare(
  opts: { now?: number; load?: () => Promise<DollarReserveShareResponse> } = {},
): Promise<DollarReserveShareResponse> {
  const now = opts.now ?? Date.now();
  if (cache && now - cache.at < DOLLAR_RESERVE_SHARE_PARAMS.cacheTtlMs) return cache.body;
  const body = await (opts.load ?? loadDollarReserveShare)();
  if (body.available) cache = { at: now, body };
  return body;
}

/** Nur für Tests. */
export function resetDollarReserveShareCache(): void {
  cache = null;
}

export function registerDollarReserveShareRoute(
  app: Express,
  opts: { load?: () => Promise<DollarReserveShareResponse> } = {},
): void {
  app.get("/api/macro/dollar-reserve-share", async (_req: Request, res: Response) => {
    try {
      res.json(await getDollarReserveShare({ load: opts.load }));
    } catch (err) {
      if (!res.headersSent) {
        const message = String((err as Error)?.message ?? err).slice(0, DOLLAR_RESERVE_SHARE_PARAMS.maxReasonChars);
        res.json({
          source: "IMF COFER",
          available: false,
          reason: `IMF COFER: ${message}`,
          trend: null,
          trendReason: null,
        });
      }
    }
  });
}
