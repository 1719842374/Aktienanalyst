import type { Express, Request, Response } from "express";
import type { CreditSpreadResponse } from "../shared/schema";
import { CREDIT_SOURCE_LABEL, CREDIT_SOURCE_URL, creditStressSignal, normalizeCreditPoints } from "../shared/credit";
import { BAA10Y_SERIES_ID, fetchFredCsv, fredCsvObservations } from "./fred-csv";

/**
 * GET /api/credit-spread/market — FRED BAA10Y (fredgraph.csv, ohne Key, volle Historie) für das
 * Credit-Overlay der Technischen Analyse (JOB A1). Nicht tickerabhängig: ein Markt-Aggregat.
 * Parse-Kern geteilt mit dem Rezessions-Slot (server/fred-csv.ts).
 * 12h-Memory-Cache; leere Antworten werden nicht gecacht (wie dividend-route).
 * Kein Score, kein Fazit — die Analyse-Route wird nicht berührt.
 */
const CACHE_MS = 12 * 60 * 60 * 1000;
let cache: { at: number; body: CreditSpreadResponse } | null = null;

export async function loadMarketCreditSpread(
  deps: { fetchCsv: (id: string) => Promise<string | null> } = { fetchCsv: id => fetchFredCsv(id) },
): Promise<CreditSpreadResponse> {
  const points = normalizeCreditPoints(fredCsvObservations(await deps.fetchCsv(BAA10Y_SERIES_ID)));
  return {
    seriesId: BAA10Y_SERIES_ID,
    source: CREDIT_SOURCE_LABEL,
    sourceUrl: CREDIT_SOURCE_URL,
    points,
    stress: creditStressSignal(points),
    note: points.length ? null : "FRED nicht erreichbar oder leer",
  };
}

export async function getMarketCreditSpread(now = Date.now()): Promise<CreditSpreadResponse> {
  if (cache && now - cache.at < CACHE_MS) return cache.body;
  const body = await loadMarketCreditSpread();
  if (body.points.length > 0) cache = { at: now, body };
  return body;
}

export function registerCreditRoute(app: Express): void {
  app.get("/api/credit-spread/market", async (_req: Request, res: Response) => {
    res.json(await getMarketCreditSpread());
  });
}
