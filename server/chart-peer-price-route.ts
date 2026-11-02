/**
 * GET /api/chart/peer-price/:symbol?from=&to=
 * Dieselbe Kurshistorie wie der Hauptchart: FMP, Lücken nach links über Yahoo und dann Stooq.
 * Der Analyse-Handler bleibt unberührt. /api/ohlcv bleibt bei seinem 5-Jahres-Fenster.
 */
import type { Express, Request, Response } from "express";
import { altFetchYahooThenStooq, fetchDailyHistory, type DailyBar } from "./history-fallback";
import { fmpHistoricalPrices } from "./fmp";
import { resolveGermanListingDefault } from "./fmp-listing-resolve";
import { isGermanXetraTicker } from "./yahoo-fetcher";

function isPeerSymbol(raw: string): boolean {
  return /^[A-Z0-9.]{1,15}$/.test(raw.trim().toUpperCase());
}

export interface PeerPriceBar {
  date: string;
  close: number;
}

export interface PeerPriceResponse {
  symbol: string;
  from: string;
  to: string;
  bars: PeerPriceBar[];
  source: string | null;
  note: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function peerPriceFromBars(symbol: string, from: string, to: string, bars: DailyBar[]): PeerPriceResponse {
  const clipped = bars
    .filter(bar => bar.date >= from && bar.date <= to && Number.isFinite(bar.close) && bar.close > 0)
    .map(bar => ({ date: bar.date, close: bar.close }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (clipped.length === 0) {
    return { symbol, from, to, bars: [], source: null, note: "n/a — Peer-Kurs ohne gültige Schlüsse (FMP und Yahoo/Stooq)" };
  }
  const sources = new Set(bars.filter(bar => clipped.some(row => row.date === bar.date)).map(bar => bar.source));
  const source = sources.has("fmp") && (sources.has("yahoo") || sources.has("stooq"))
    ? "FMP + Yahoo/Stooq"
    : sources.has("fmp")
      ? "FMP"
      : sources.has("yahoo")
        ? "Yahoo"
        : sources.has("stooq")
          ? "Stooq"
          : null;
  const note = clipped[0].date > from ? `Peer-Kurs beginnt am ${clipped[0].date}` : null;
  return { symbol, from, to, bars: clipped, source, note };
}

function toDailyBars(raw: unknown): DailyBar[] {
  const rows = Array.isArray(raw) ? raw : [];
  const bars: DailyBar[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { date?: unknown; open?: unknown; high?: unknown; low?: unknown; close?: unknown; volume?: unknown };
    const date = typeof rec.date === "string" ? rec.date.slice(0, 10) : "";
    const close = typeof rec.close === "number" ? rec.close : Number(rec.close);
    if (!ISO.test(date) || !Number.isFinite(close) || close <= 0) continue;
    const open = typeof rec.open === "number" && Number.isFinite(rec.open) ? rec.open : close;
    const high = typeof rec.high === "number" && Number.isFinite(rec.high) ? rec.high : close;
    const low = typeof rec.low === "number" && Number.isFinite(rec.low) ? rec.low : close;
    const volume = typeof rec.volume === "number" && Number.isFinite(rec.volume) ? rec.volume : 0;
    bars.push({ date, open, high, low, close, volume, source: "fmp" });
  }
  return bars;
}

export async function loadPeerPrice(symbol: string, from: string, to: string): Promise<PeerPriceResponse> {
  if (isGermanXetraTicker(symbol)) {
    const listing = await resolveGermanListingDefault(symbol);
    if (!listing) {
      return { symbol, from, to, bars: [], source: "FMP", note: "n/a — kein FMP-Symbol für XETRA aufgelöst" };
    }
    try {
      const bars = toDailyBars(await fmpHistoricalPrices(listing.fmpSymbol, from, to));
      const body = peerPriceFromBars(symbol, from, to, bars);
      return { ...body, source: listing.source, note: body.bars.length === 0 ? `n/a — FMP ohne Kurse für ${listing.fmpSymbol}` : body.note };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { symbol, from, to, bars: [], source: listing.source, note: `n/a — Peer-Kurs nicht geladen: ${message.slice(0, 160)}` };
    }
  }
  const failures: string[] = [];
  const history = await fetchDailyHistory({
    symbol,
    timeframe: "10Y",
    fetchFrom: from,
    fmpFetch: async (start, end) => {
      try {
        return toDailyBars(await fmpHistoricalPrices(symbol, start, end));
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
        return [];
      }
    },
    altFetch: (start, end) => altFetchYahooThenStooq(symbol, start, end),
  }).catch((err: unknown) => {
    failures.push(err instanceof Error ? err.message : String(err));
    return { bars: [] as DailyBar[], source: "", truncated: true };
  });
  const body = peerPriceFromBars(symbol, from, to, history.bars);
  const failure = failures[0];
  if (body.bars.length === 0 && failure) {
    return { ...body, note: `n/a — Peer-Kurs nicht geladen: ${failure.slice(0, 160)}` };
  }
  return body;
}

export function registerPeerPriceRoute(app: Express): void {
  app.get("/api/chart/peer-price/:symbol", async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol ?? "").trim().toUpperCase();
    if (!isPeerSymbol(symbol)) return res.status(400).json({ error: "ticker ungültig" });
    const from = String(req.query.from ?? "").slice(0, 10);
    const to = String(req.query.to ?? "").slice(0, 10);
    if (!ISO.test(from) || !ISO.test(to) || from > to) {
      return res.status(400).json({ error: "from/to ungültig" });
    }
    res.json(await loadPeerPrice(symbol, from, to));
  });
}
