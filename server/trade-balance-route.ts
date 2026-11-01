import type { Express, Request, Response } from "express";
import { TRADE_BALANCE_SERIES_ID, TRADE_BALANCE_SOURCE_LABEL, tradeBalanceToGdp, type TradeBalanceResponse } from "../shared/trade-balance";
import { fetchFredCsv, fredCsvObservations } from "./fred-csv";

/**
 * GET /api/analyze-recession/trade-balance — F1-38: US-Handelsbilanz/BIP für das Buffett-Panel.
 * FRED BOPGSTB + GDP über den bestehenden fredgraph-Kern (server/fred-csv.ts, wie credit-route.ts), kein neuer Anbieter.
 * Eigene Route, damit die Buffett-Antwort (/api/analyze-recession/buffett) byte-identisch bleibt.
 * Nur Anzeige: kein Score, kein Fazit, analyze-route unberührt. Fehlt eine Reihe → value null + Grund (n/a), nie geraten.
 * 12h-Cache nur bei Wert; Fehler werden nicht gecacht.
 */
const CACHE_MS = 12 * 60 * 60 * 1000;
let cache: { at: number; body: TradeBalanceResponse } | null = null;

type FetchCsv = (id: string, cosd: string) => Promise<string | null>;

export async function loadTradeBalance(deps: { fetchCsv: FetchCsv } = { fetchCsv: (id, cosd) => fetchFredCsv(id, cosd) }): Promise<TradeBalanceResponse> {
  const base = { seriesId: TRADE_BALANCE_SERIES_ID, source: TRADE_BALANCE_SOURCE_LABEL };
  let bopCsv: string | null = null;
  let gdpCsv: string | null = null;
  try {
    [bopCsv, gdpCsv] = await Promise.all([deps.fetchCsv(TRADE_BALANCE_SERIES_ID, "2020-01-01"), deps.fetchCsv("GDP", "2020-01-01")]);
  } catch (err) {
    return { ...base, value: null, reason: `FRED-Abruf fehlgeschlagen: ${String((err as Error)?.message ?? err).slice(0, 160)}` };
  }
  const bop = fredCsvObservations(bopCsv);
  const gdp = fredCsvObservations(gdpCsv);
  if (bop.length === 0) return { ...base, value: null, reason: `FRED ${TRADE_BALANCE_SERIES_ID} nicht erreichbar oder leer` };
  if (gdp.length === 0) return { ...base, value: null, reason: "FRED GDP nicht erreichbar oder leer" };
  const r = tradeBalanceToGdp(bop, gdp);
  return { ...base, value: r.value, reason: r.reason };
}

export async function getTradeBalance(opts: { now?: number; load?: () => Promise<TradeBalanceResponse> } = {}): Promise<TradeBalanceResponse> {
  const now = opts.now ?? Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.body;
  const body = await (opts.load ?? loadTradeBalance)();
  if (body.value) cache = { at: now, body };
  return body;
}

/** Nur für Tests. */
export function resetTradeBalanceCache(): void {
  cache = null;
}

export function registerTradeBalanceRoute(app: Express, opts: { load?: () => Promise<TradeBalanceResponse> } = {}): void {
  app.get("/api/analyze-recession/trade-balance", async (_req: Request, res: Response) => {
    try {
      res.json(await getTradeBalance({ load: opts.load }));
    } catch (err) {
      if (!res.headersSent) {
        res.json({ seriesId: TRADE_BALANCE_SERIES_ID, source: TRADE_BALANCE_SOURCE_LABEL, value: null, reason: `Fehler: ${String((err as Error)?.message ?? err).slice(0, 160)}` });
      }
    }
  });
}
