/**
 * Quartals-Surprises für die Earnings-Ampel.
 * Kette: EarningsAmpelBlock → dieses Hook → apiRequest GET /api/earnings-markers/:ticker
 * → server/earnings-markers-route → loadEarningsMarkers → buildEarningsMarkers → FMP.
 * Dieselbe Query-Key wie das Kurs-Chart, damit ein Abruf beiden Anzeigen reicht.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { EarningsMarkerSet } from "@shared/earnings-markers";

export interface EarningsMarkersPayload extends EarningsMarkerSet {
  ticker: string;
  source: string;
  note: string | null;
}

export function useEarningsMarkers(ticker: string | null) {
  return useQuery({
    queryKey: ["earnings-markers", ticker],
    enabled: Boolean(ticker),
    queryFn: async (): Promise<EarningsMarkersPayload> => {
      const res = await apiRequest("GET", `/api/earnings-markers/${encodeURIComponent(ticker ?? "")}`);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text.trim() || `HTTP ${res.status}`);
      }
      return res.json() as Promise<EarningsMarkersPayload>;
    },
  });
}
