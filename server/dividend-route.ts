import type { Express, Request, Response } from "express";
import { fmpDividends } from "./fmp";
import {
  parseFmpDividends,
  parseYahooDividends,
  parseFmpDividendCurrency,
  parseYahooDividendCurrency,
  type DividendEvent,
  type DividendHistoryResponse,
} from "../shared/dividends";

/**
 * GET /api/dividends/:ticker — dividend history for the TA overlay.
 * FMP first, Yahoo v8 chart (events=div) only when FMP has nothing. Both empty → events: [].
 */

const CACHE_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; body: DividendHistoryResponse }>();
const TICKER_RE = /^[A-Z0-9.\-^=]{1,15}$/;

export function normalizeDividendTicker(raw: unknown): string | null {
  const t = String(raw ?? "").trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

type YahooDivs = DividendEvent[] & { currency?: string | null };

async function yahooDividends(ticker: string): Promise<YahooDivs> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=max&interval=1mo&events=div`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0" } });
    if (!resp.ok) return [];
    const json = await resp.json();
    const out: YahooDivs = parseYahooDividends(json);
    out.currency = parseYahooDividendCurrency(json);
    return out;
  } catch {
    return [];
  }
}

export async function loadDividendHistory(
  ticker: string,
  deps: { fmp: (t: string) => Promise<unknown>; yahoo: (t: string) => Promise<YahooDivs> } = {
    fmp: fmpDividends,
    yahoo: yahooDividends,
  },
): Promise<DividendHistoryResponse> {
  let fmpNote: string | null = null;
  try {
    const raw = await deps.fmp(ticker);
    const events = parseFmpDividends(raw);
    if (events.length > 0) return { ticker, source: "fmp", events, note: null, currency: parseFmpDividendCurrency(raw) };
    fmpNote = "FMP ohne Dividenden";
  } catch (err: any) {
    fmpNote = `FMP-Fehler${err?.fmpStatus ? ` HTTP ${err.fmpStatus}` : ""}`;
  }
  const y = await deps.yahoo(ticker);
  if (y.length > 0) return { ticker, source: "yahoo", events: [...y], note: `${fmpNote}, Yahoo-Fallback`, currency: y.currency ?? null };
  return { ticker, source: "none", events: [], note: `${fmpNote}, Yahoo ohne Dividenden` };
}

export function registerDividendRoute(app: Express): void {
  app.get("/api/dividends/:ticker", async (req: Request, res: Response) => {
    const ticker = normalizeDividendTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: "Ungültiger Ticker" });
    const hit = cache.get(ticker);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body);
    const body = await loadDividendHistory(ticker);
    // Empty results are not cached, so a transient upstream miss does not stick for 12 h.
    if (body.events.length > 0) cache.set(ticker, { at: Date.now(), body });
    res.json(body);
  });
}
