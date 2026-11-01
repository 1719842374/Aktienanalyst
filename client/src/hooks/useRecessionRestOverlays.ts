import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

/**
 * Buffett-Quote der bestehenden Route GET /api/analyze-recession/buffett (server/buffett-route.ts).
 * Nur solange der Chip an ist. Cache wie die Route (15 min). Kein Score.
 */
export interface BuffettOverlayBody {
  region?: string;
  asOf?: string | null;
  sources?: { id: string; role: string }[];
  points?: { date: string; ratio: number }[];
  note?: string | null;
  error?: string;
}

export function useRecessionBuffettOverlay(region: "US" | "EU" | "CN", enabled: boolean) {
  const path = `/api/analyze-recession/buffett?region=${region}`;
  return useQuery<BuffettOverlayBody | null>({
    queryKey: [path],
    queryFn: getQueryFn<BuffettOverlayBody | null>({ on401: "throw" }),
    enabled,
    // server/buffett-route.ts CACHE_MS.
    staleTime: 15 * 60 * 1000,
  });
}

export function buffettSourceIds(body: BuffettOverlayBody | null | undefined): string {
  return (body?.sources ?? []).map(s => s.id).filter(Boolean).join(", ");
}

/** Shiller CAPE, GET /api/analyze-recession/cape (server/recession-cape-route.ts). Nur bei eingeschaltetem Chip. */
export interface CapeOverlayBody {
  source: string;
  sourceUrl: string;
  points: { date: string; value: number }[];
  note: string | null;
}

export function useRecessionCapeOverlay(enabled: boolean) {
  return useQuery<CapeOverlayBody | null>({
    queryKey: ["/api/analyze-recession/cape"],
    queryFn: getQueryFn<CapeOverlayBody | null>({ on401: "throw" }),
    enabled,
    // server/recession-cape-route.ts CAPE_CACHE_HOURS.
    staleTime: 12 * 60 * 60 * 1000,
  });
}

/** FRED-Reihe über GET /api/analyze-recession/fred-history (server/fred-csv.ts). Nur bei eingeschaltetem Chip. */
export interface FredHistoryBody {
  seriesId: string;
  source: string;
  points: { date: string; value: number }[];
  note: string | null;
}

export function useRecessionFredHistory(series: "T10Y2Y" | "M2SL", enabled: boolean) {
  const path = `/api/analyze-recession/fred-history?series=${series}`;
  return useQuery<FredHistoryBody | null>({
    queryKey: [path],
    queryFn: getQueryFn<FredHistoryBody | null>({ on401: "throw" }),
    enabled,
    // server/recession-fred-history-route.ts FRED_HISTORY_CACHE_HOURS.
    staleTime: 12 * 60 * 60 * 1000,
  });
}

/** Google-Trends-Cache, GET /api/analyze-recession/google-trends. Kein eigener SerpApi-Call. */
export interface GoogleTrendsOverlayBody {
  source: string;
  points: { date: string; value: number }[];
  asOf: string | null;
  note: string | null;
  ageHours: number | null;
  isStale: boolean;
}

export function useRecessionGoogleTrends(enabled: boolean) {
  return useQuery<GoogleTrendsOverlayBody | null>({
    queryKey: ["/api/analyze-recession/google-trends"],
    queryFn: getQueryFn<GoogleTrendsOverlayBody | null>({ on401: "throw" }),
    enabled,
    // Frischfenster des Caches: GOOGLE_TRENDS_FRESH_MS (12 h). Dieselbe Spanne für die Anzeige.
    staleTime: 12 * 60 * 60 * 1000,
  });
}
