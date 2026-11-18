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

/**
 * Peer-Kurs über dieselbe Historie wie der Hauptchart (FMP, dann Yahoo/Stooq),
 * für das Von/Bis der geladenen Kerzen. Nicht /api/ohlcv: das klemmt auf 5 Jahre.
 */
export function usePeerPriceBars(symbol: string, enabled: boolean, from: string, to: string) {
  const ticker = cleanSymbol(symbol);
  const spanOk = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  return useQuery<PeerPriceBars | null>({
    queryKey: ["/api/chart/peer-price", ticker, from, to],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/chart/peer-price/${encodeURIComponent(ticker)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      if (!res.ok) {
        return { bars: [], note: `n/a — Peer-Kurs nicht geladen (${res.status})` };
      }
      const body = await res.json() as { bars?: { date?: string; close?: number }[]; note?: string | null };
      const bars = Array.isArray(body?.bars)
        ? body.bars
          .map(row => ({ date: String(row?.date ?? "").slice(0, 10), close: Number(row?.close) }))
          .filter(row => row.date && Number.isFinite(row.close) && row.close > 0)
        : [];
      return { bars, note: bars.length === 0 ? (body?.note ?? "n/a — Peer-Kurs ohne gültige Schlüsse") : (body?.note ?? null) };
    },
    enabled: enabled && ticker.length > 0 && spanOk,
    staleTime: STALE_MS,
  });
}
