import { useQuery } from "@tanstack/react-query";
import type { EarningsYieldResponse, RoicSeriesResponse } from "@shared/schema";
import { apiRequest, getQueryFn } from "./queryClient";

const STALE_MS = 6 * 60 * 60 * 1000;

function cleanSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** GET /api/chart/earnings-yield/:symbol — nur solange der Chip an ist. */
export function useEarningsYield(symbol: string, enabled: boolean) {
  const ticker = cleanSymbol(symbol);
  return useQuery<EarningsYieldResponse | null>({
    queryKey: ["/api/chart/earnings-yield", ticker],
    queryFn: getQueryFn<EarningsYieldResponse | null>({ on401: "throw" }),
    enabled: enabled && ticker.length > 0,
    staleTime: STALE_MS,
  });
}

/** GET /api/chart/roic/:symbol — nur solange der Chip an ist. */
export function useRoicSeries(symbol: string, enabled: boolean) {
  const ticker = cleanSymbol(symbol);
  return useQuery<RoicSeriesResponse | null>({
    queryKey: ["/api/chart/roic", ticker],
    queryFn: getQueryFn<RoicSeriesResponse | null>({ on401: "throw" }),
    enabled: enabled && ticker.length > 0,
    staleTime: STALE_MS,
  });
}

export interface PeerPriceBars {
  bars: { date: string; close: number }[];
  note: string | null;
}

/** Peer-Kurs über den bestehenden OHLCV-Fetcher. Kein neuer Datenanbieter. */
export function usePeerPriceBars(symbol: string, enabled: boolean) {
  const ticker = cleanSymbol(symbol);
  return useQuery<PeerPriceBars | null>({
    queryKey: ["/api/ohlcv", "peer-price", ticker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/ohlcv?tickers=${encodeURIComponent(ticker)}`);
      if (!res.ok) {
        return { bars: [], note: `n/a — Peer-Kurs nicht geladen (${res.status})` };
      }
      const body = await res.json();
      const rows = body?.bars?.[ticker];
      const bars = Array.isArray(rows)
        ? rows
          .map((r: { date?: string; close?: number }) => ({ date: String(r?.date ?? "").slice(0, 10), close: Number(r?.close) }))
          .filter((r: { date: string; close: number }) => r.date && Number.isFinite(r.close) && r.close > 0)
        : [];
      return { bars, note: bars.length === 0 ? "n/a — Peer-Kurs ohne gültige Schlüsse" : null };
    },
    enabled: enabled && ticker.length > 0,
    staleTime: STALE_MS,
  });
}
