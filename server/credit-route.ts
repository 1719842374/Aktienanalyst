import type { Express, Request, Response } from "express";
import type { CreditSpreadResponse } from "../shared/schema";
import { CREDIT_SOURCE_LABEL, CREDIT_SOURCE_URL, creditStressSignal, normalizeCreditPoints } from "../shared/credit";
import { BAA10Y_SERIES_ID, fetchFredCsv, fredCsvObservations } from "./fred-csv";

/**
 * GET /api/credit-spread/market — FRED BAA10Y (fredgraph.csv, ohne Key, volle Historie) für das
 * Credit-Overlay der Technischen Analyse (JOB A1). Nicht tickerabhängig: ein Markt-Aggregat.
 * Parse-Kern geteilt mit dem Rezessions-Slot (server/fred-csv.ts).
 * 12h-Memory-Cache; leere Antworten werden nicht gecacht (wie dividend-route).
 * Fehler, Throw oder Timeout beim FRED-Abruf → gleiche Form wie leere Daten (points [], stress null,
 * Notiz), kein Cache, Antwort spätestens nach CREDIT_ROUTE_DEADLINE_MS (Nachzug #253).
 * Kein Score, kein Fazit — die Analyse-Route wird nicht berührt.
 */
const CACHE_MS = 12 * 60 * 60 * 1000;
/** Obergrenze je Anfrage: FRED-Budget (20 s) + Puffer. Danach antwortet die Route mit n/a, nie hängend. */
export const CREDIT_ROUTE_DEADLINE_MS = 25000;
let cache: { at: number; body: CreditSpreadResponse } | null = null;

type FetchCsv = (id: string) => Promise<string | null>;

/** Dieselbe Form wie „keine Daten“: points [], stress null, Notiz. Wird nie gecacht. */
export function emptyCreditSpread(note: string): CreditSpreadResponse {
  return {
    seriesId: BAA10Y_SERIES_ID,
    source: CREDIT_SOURCE_LABEL,
    sourceUrl: CREDIT_SOURCE_URL,
    points: [],
    stress: null,
    note,
  };
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 160);
}

/**
 * Löst nach ms mit onTimeout auf, bei Reject mit onError; der Timer hält den Prozess nicht am Leben.
 * Ein später Fehler von p (nach der Deadline) wird geschluckt — keine Unhandled Rejection.
 */
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

export async function loadMarketCreditSpread(
  deps: { fetchCsv: FetchCsv } = { fetchCsv: id => fetchFredCsv(id) },
): Promise<CreditSpreadResponse> {
  let csv: string | null;
  try {
    csv = await deps.fetchCsv(BAA10Y_SERIES_ID);
  } catch (err) {
    return emptyCreditSpread(`FRED-Abruf fehlgeschlagen: ${errorText(err)}`);
  }
  const points = normalizeCreditPoints(fredCsvObservations(csv));
  if (points.length === 0) return emptyCreditSpread("FRED nicht erreichbar oder leer");
  return {
    seriesId: BAA10Y_SERIES_ID,
    source: CREDIT_SOURCE_LABEL,
    sourceUrl: CREDIT_SOURCE_URL,
    points,
    stress: creditStressSignal(points),
    note: null,
  };
}

/**
 * Cache-Lesen + Laden mit Deadline. Wirft nie: Fehler/Throw/Timeout → emptyCreditSpread, kein Cache.
 * load/deadlineMs/now sind für Tests injizierbar.
 */
export async function getMarketCreditSpread(
  opts: { now?: number; load?: () => Promise<CreditSpreadResponse>; deadlineMs?: number } = {},
): Promise<CreditSpreadResponse> {
  const now = opts.now ?? Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.body;
  const deadlineMs = opts.deadlineMs ?? CREDIT_ROUTE_DEADLINE_MS;
  let body: CreditSpreadResponse;
  try {
    body = await withDeadline(
      Promise.resolve().then(() => (opts.load ?? loadMarketCreditSpread)()),
      deadlineMs,
      () => emptyCreditSpread(`FRED-Abruf Timeout (${Math.round(deadlineMs / 1000)} s)`),
      err => emptyCreditSpread(`FRED-Abruf fehlgeschlagen: ${errorText(err)}`),
    );
  } catch (err) {
    body = emptyCreditSpread(`FRED-Abruf fehlgeschlagen: ${errorText(err)}`);
  }
  if (body && Array.isArray(body.points) && body.points.length > 0) cache = { at: now, body };
  return body;
}

/** Nur für Tests: Memory-Cache leeren. */
export function resetCreditSpreadCache(): void {
  cache = null;
}

export function registerCreditRoute(
  app: Express,
  opts: { load?: () => Promise<CreditSpreadResponse>; deadlineMs?: number } = {},
): void {
  app.get("/api/credit-spread/market", async (_req: Request, res: Response) => {
    try {
      res.json(await getMarketCreditSpread({ load: opts.load, deadlineMs: opts.deadlineMs }));
    } catch (err) {
      // getMarketCreditSpread wirft nicht; letzte Sicherung gegen Unhandled Rejection im Handler.
      if (!res.headersSent) res.json(emptyCreditSpread(`FRED-Abruf fehlgeschlagen: ${errorText(err)}`));
    }
  });
}
