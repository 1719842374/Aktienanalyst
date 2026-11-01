/**
 * GET /api/credit-fundamentals/:ticker — F1-20/F1-21.
 * Debt/Equity und Zinsdeckung aus den vorhandenen FMP-Ratios (/stable/ratios).
 * Kette: Route → loadCreditFundamentals → parseCreditRatioRows / creditMetricReading (shared/credit.ts).
 * Nur Anzeige. Kein Score, kein CRV, analyze-route bleibt unberührt. Kein CDS.
 * Fehler und leere Lieferungen → n/a mit Grund, nicht gecacht, nie 0 als Ersatz.
 */
import type { Express, Request, Response } from "express";
import type { CreditFundamentalsResponse, CreditMetricReading } from "../shared/schema";
import {
  CREDIT_STANCE_PARAMS,
  CREDIT_TICKER_RE,
  creditMetricReading,
  parseCreditRatioRows,
} from "../shared/credit";
import { fmpRatios } from "./fmp";

const CACHE_MS = 12 * 60 * 60 * 1000;

type FetchRatios = (symbol: string, limit: number) => Promise<unknown>;

let cache = new Map<string, { at: number; body: CreditFundamentalsResponse }>();

export function resetCreditFundamentalsCache(): void {
  cache = new Map();
}

function naReading(reason: string): CreditMetricReading {
  return { value: null, asOf: null, unavailable: reason, percentile: null, zScore: null, sampleSize: 0, basis: null, stance: null };
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 160);
}

export function normalizeCreditTicker(raw: string): string | null {
  const ticker = raw.trim().toUpperCase();
  return CREDIT_TICKER_RE.test(ticker) ? ticker : null;
}

export function cleanCreditPeers(peers: readonly string[] | undefined, self: string): string[] {
  const out: string[] = [];
  for (const raw of peers ?? []) {
    const ticker = normalizeCreditTicker(raw);
    if (!ticker || ticker === self || out.includes(ticker)) continue;
    out.push(ticker);
    if (out.length >= CREDIT_STANCE_PARAMS.maxPeers) break;
  }
  return out;
}

function unavailableBody(ticker: string, reason: string): CreditFundamentalsResponse {
  return {
    ticker,
    source: "FMP ratios",
    debtToEquity: naReading(reason),
    interestCoverage: naReading(reason),
    note: reason,
  };
}

export async function loadCreditFundamentals(
  ticker: string,
  opts: { peers?: string[]; fetchRatios?: FetchRatios } = {},
): Promise<CreditFundamentalsResponse> {
  const symbol = normalizeCreditTicker(ticker) ?? ticker.trim().toUpperCase();
  const fetchRatios = opts.fetchRatios ?? ((s, limit) => fmpRatios(s, limit));
  const peers = cleanCreditPeers(opts.peers, symbol);
  let rows: unknown;
  try {
    rows = await fetchRatios(symbol, CREDIT_STANCE_PARAMS.historyLimit);
  } catch (err) {
    return unavailableBody(symbol, errorText(err));
  }
  const parsed = parseCreditRatioRows(rows);
  const peerDebt: number[] = [];
  const peerCoverage: number[] = [];
  for (const peer of peers) {
    try {
      const peerRows = await fetchRatios(peer, CREDIT_STANCE_PARAMS.peerRowLimit);
      const peerParsed = parseCreditRatioRows(peerRows);
      if (peerParsed.debtToEquity.value != null) peerDebt.push(peerParsed.debtToEquity.value);
      if (peerParsed.interestCoverage.value != null) peerCoverage.push(peerParsed.interestCoverage.value);
    } catch {
      // Ein Peer ohne Lieferung fällt aus der Stichprobe, kein Ersatzwert.
    }
  }
  const bothMissing = parsed.debtToEquity.value == null && parsed.interestCoverage.value == null;
  return {
    ticker: symbol,
    source: "FMP ratios",
    debtToEquity: creditMetricReading({
      value: parsed.debtToEquity.value,
      asOf: parsed.debtToEquity.asOf,
      unavailable: parsed.debtToEquity.unavailable,
      ownHistory: parsed.debtToEquity.history,
      peers: peerDebt,
      direction: "riskUp",
    }),
    interestCoverage: creditMetricReading({
      value: parsed.interestCoverage.value,
      asOf: parsed.interestCoverage.asOf,
      unavailable: parsed.interestCoverage.unavailable,
      ownHistory: parsed.interestCoverage.history,
      peers: peerCoverage,
      direction: "riskDown",
    }),
    note: bothMissing ? (parsed.debtToEquity.unavailable ?? parsed.interestCoverage.unavailable) : null,
  };
}

export async function getCreditFundamentals(
  ticker: string,
  opts: { peers?: string[]; fetchRatios?: FetchRatios; now?: number } = {},
): Promise<CreditFundamentalsResponse> {
  const symbol = normalizeCreditTicker(ticker);
  if (!symbol) return unavailableBody(ticker.trim().toUpperCase(), "Ticker ungültig");
  const peers = cleanCreditPeers(opts.peers, symbol);
  const key = `${symbol}|${peers.join(",")}`;
  const now = opts.now ?? Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.body;
  const body = await loadCreditFundamentals(symbol, { peers, fetchRatios: opts.fetchRatios });
  if (body.debtToEquity.value != null || body.interestCoverage.value != null) cache.set(key, { at: now, body });
  return body;
}

export function registerCreditFundamentalsRoute(
  app: Express,
  opts: { fetchRatios?: FetchRatios } = {},
): void {
  app.get("/api/credit-fundamentals/:ticker", async (req: Request, res: Response) => {
    const ticker = String(req.params.ticker ?? "");
    if (!normalizeCreditTicker(ticker)) {
      res.status(404).json({ error: "Ticker fehlt" });
      return;
    }
    const peers = String(req.query.peers ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    try {
      res.json(await getCreditFundamentals(ticker, { peers, fetchRatios: opts.fetchRatios }));
    } catch (err) {
      if (!res.headersSent) res.json(unavailableBody(ticker.trim().toUpperCase(), errorText(err)));
    }
  });
}
