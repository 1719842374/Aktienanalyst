/**
 * GET /api/analyze-recession/google-trends — liest nur den bestehenden Cache
 * (server/cache/google-trends-cache.ts). Kein zweiter Speicher, kein eigener SerpApi-Call.
 * Der Score bleibt scoreGoogleTrends in server/recession.ts. Nur Anzeige, kein Score.
 */
import type { Express, Request, Response } from "express";
import {
  googleTrendsFreshness,
  googleTrendsMissPhrase,
  parseSerpApiTrendPoints,
  readGoogleTrendsCache,
  readGoogleTrendsMiss,
} from "./cache/google-trends-cache";
import { REST_OVERLAY_PARAMS } from "../shared/recession-rest-overlays";

export interface GoogleTrendsOverlayBody {
  source: string;
  points: { date: string; value: number }[];
  asOf: string | null;
  note: string | null;
  ageHours: number | null;
  isStale: boolean;
  /** „n/a — Grund“, wenn der Cache keinen Druck hat. Sonst null. Kein Score. */
  unavailableReason: string | null;
}

export function pointsFromSerp(raw: string): { date: string; value: number }[] {
  return parseSerpApiTrendPoints(raw) ?? [];
}

export function readGoogleTrendsOverlay(now: number): GoogleTrendsOverlayBody {
  const entry = readGoogleTrendsCache();
  if (!entry) {
    const miss = readGoogleTrendsMiss();
    const reason = miss ? googleTrendsMissPhrase(miss.kind, miss.httpStatus) : "Google-Trends-Cache leer";
    return {
      source: "Google-Trends-Cache",
      points: [],
      asOf: null,
      note: reason,
      unavailableReason: `n/a — ${reason}`,
      ageHours: null,
      isStale: false,
    };
  }
  const age = now - entry.timestamp;
  const freshness = age >= 0 ? googleTrendsFreshness(age) : { ageHours: null, isStale: false };
  const asOf = Number.isFinite(entry.timestamp) ? new Date(entry.timestamp).toISOString().slice(0, 10) : null;
  const points = entry.points?.length
    ? entry.points
    : (asOf ? [{ date: asOf, value: entry.value }] : []);
  const note = points.length < REST_OVERLAY_PARAMS.minPoints
    ? "zu wenig Drucke im Cache für einen z-Score"
    : (freshness.isStale ? "Druck älter als 24 h" : null);
  return {
    source: entry.source,
    points,
    asOf,
    note,
    ageHours: freshness.ageHours,
    isStale: freshness.isStale,
    unavailableReason: null,
  };
}

export function registerGoogleTrendsOverlayRoute(app: Express): void {
  app.get("/api/analyze-recession/google-trends", (_req: Request, res: Response) => {
    res.json(readGoogleTrendsOverlay(Date.now()));
  });
}
