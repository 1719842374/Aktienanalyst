import type { Express, Request, Response } from "express";
import type { Treasury10YResponse } from "../shared/schema";
import { TREASURY10Y_SERIES_ID, TREASURY10Y_SOURCE_LABEL, TREASURY10Y_SOURCE_URL, normalizeTreasury10YPoints } from "../shared/treasury10y";
import { fetchFredCsv, fredCsvObservations } from "./fred-csv";

/**
 * GET /api/treasury-10y/market — FRED DGS10 (fredgraph.csv, ohne Key, volle Historie) für das
 * 10Y-Overlay der Technischen Analyse (A3, Offen_WORK_BUFFETT_ASIA_10Y.md §3). Nicht tickerabhängig.
 * Muster und Fehlerverhalten wie server/credit-route.ts (#253): Parse-Kern server/fred-csv.ts,
 * 12h-Memory-Cache, leere Antworten werden nicht gecacht. Fehler, Throw oder Timeout → gleiche Form
 * wie leere Daten (points [], Notiz), Antwort spätestens nach TREASURY10Y_ROUTE_DEADLINE_MS.
 * Kein Score, kein Fazit — die Analyse-Route wird nicht berührt.
 */
const CACHE_MS = 12 * 60 * 60 * 1000;
/** Obergrenze je Anfrage: FRED-Budget (20 s) + Puffer, wie CREDIT_ROUTE_DEADLINE_MS. */
export const TREASURY10Y_ROUTE_DEADLINE_MS = 25000;
let cache: { at: number; body: Treasury10YResponse } | null = null;

type FetchCsv = (id: string) => Promise<string | null>;

/** Dieselbe Form wie „keine Daten“: points [], Notiz. Wird nie gecacht. */
export function emptyTreasury10Y(note: string): Treasury10YResponse {
  return {
    seriesId: TREASURY10Y_SERIES_ID,
    source: TREASURY10Y_SOURCE_LABEL,
    sourceUrl: TREASURY10Y_SOURCE_URL,
    points: [],
    note,
  };
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 160);
}

/** Wie in credit-route.ts: löst nach ms mit onTimeout auf, bei Reject mit onError; später Fehler wird geschluckt. */
function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => T, onError: (err: unknown) => T): Promise<T> {
  return new Promise<T>(resolve => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(onTimeout()); } }, ms);
    timer.unref?.();
    p.then(
      v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      err => { if (!done) { done = true; clearTimeout(timer); resolve(onError(err)); } },
    );
  });
}

export async function loadMarketTreasury10Y(
  deps: { fetchCsv: FetchCsv } = { fetchCsv: id => fetchFredCsv(id) },
): Promise<Treasury10YResponse> {
  let csv: string | null;
  try {
    csv = await deps.fetchCsv(TREASURY10Y_SERIES_ID);
  } catch (err) {
    return emptyTreasury10Y(`FRED-Abruf fehlgeschlagen: ${errorText(err)}`);
  }
  const points = normalizeTreasury10YPoints(fredCsvObservations(csv));
  if (points.length === 0) return emptyTreasury10Y("FRED nicht erreichbar oder leer");
  return {
    seriesId: TREASURY10Y_SERIES_ID,
    source: TREASURY10Y_SOURCE_LABEL,
    sourceUrl: TREASURY10Y_SOURCE_URL,
    points,
    note: null,
  };
}

/**
 * Cache-Lesen + Laden mit Deadline. Wirft nie: Fehler/Throw/Timeout → emptyTreasury10Y, kein Cache.
 * load/deadlineMs/now sind für Tests injizierbar.
 */
export async function getMarketTreasury10Y(
  opts: { now?: number; load?: () => Promise<Treasury10YResponse>; deadlineMs?: number } = {},
): Promise<Treasury10YResponse> {
  const now = opts.now ?? Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.body;
  const deadlineMs = opts.deadlineMs ?? TREASURY10Y_ROUTE_DEADLINE_MS;
  let body: Treasury10YResponse;
  try {
    body = await withDeadline(
      Promise.resolve().then(() => (opts.load ?? loadMarketTreasury10Y)()),
      deadlineMs,
      () => emptyTreasury10Y(`FRED-Abruf Timeout (${Math.round(deadlineMs / 1000)} s)`),
      err => emptyTreasury10Y(`FRED-Abruf fehlgeschlagen: ${errorText(err)}`),
    );
  } catch (err) {
    body = emptyTreasury10Y(`FRED-Abruf fehlgeschlagen: ${errorText(err)}`);
  }
  if (body && Array.isArray(body.points) && body.points.length > 0) cache = { at: now, body };
  return body;
}

/** Nur für Tests: Memory-Cache leeren. */
export function resetTreasury10YCache(): void {
  cache = null;
}

export function registerTreasury10YRoute(
  app: Express,
  opts: { load?: () => Promise<Treasury10YResponse>; deadlineMs?: number } = {},
): void {
  app.get("/api/treasury-10y/market", async (_req: Request, res: Response) => {
    try {
      res.json(await getMarketTreasury10Y({ load: opts.load, deadlineMs: opts.deadlineMs }));
    } catch (err) {
      // getMarketTreasury10Y wirft nicht; letzte Sicherung gegen Unhandled Rejection im Handler.
      if (!res.headersSent) res.json(emptyTreasury10Y(`FRED-Abruf fehlgeschlagen: ${errorText(err)}`));
    }
  });
}
