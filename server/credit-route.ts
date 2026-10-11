import type { Express, Request, Response } from "express";
import {
  CREDIT_SERIES_ID, CREDIT_SOURCE_LABEL, CREDIT_SOURCE_URL,
  creditStressSignal, parseFredCsv, type CreditSpreadResponse,
} from "../shared/credit";

/**
 * GET /api/credit-spread/market — FRED BAA10Y (fredgraph.csv, ohne Key) für das
 * Credit-Overlay (Sektion 12) und den Fazit-Hinweis. Nicht tickerabhängig: ein Markt-Aggregat.
 * 12h-Memory-Cache; leere Antworten werden nicht gecacht (wie dividend-route).
 */
const CACHE_MS = 12 * 60 * 60 * 1000;
let cache: { at: number; body: CreditSpreadResponse } | null = null;

export async function fetchFredCsv(seriesId: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`, { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

export async function loadMarketCreditSpread(deps: { fetchCsv: (id: string) => Promise<string | null> } = { fetchCsv: fetchFredCsv }): Promise<CreditSpreadResponse> {
  const points = parseFredCsv(await deps.fetchCsv(CREDIT_SERIES_ID));
  return {
    seriesId: CREDIT_SERIES_ID,
    source: CREDIT_SOURCE_LABEL,
    sourceUrl: CREDIT_SOURCE_URL,
    points,
    stress: creditStressSignal(points),
    note: points.length ? null : "FRED nicht erreichbar oder leer",
  };
}

/** Cached loader (also used by the PDF export). */
export async function getMarketCreditSpread(): Promise<CreditSpreadResponse> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.body;
  const body = await loadMarketCreditSpread();
  if (body.points.length > 0) cache = { at: Date.now(), body };
  return body;
}

export function registerCreditRoute(app: Express): void {
  app.get("/api/credit-spread/market", async (_req: Request, res: Response) => {
    res.json(await getMarketCreditSpread());
  });
}
