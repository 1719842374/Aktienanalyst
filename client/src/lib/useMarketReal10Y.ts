import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "./queryClient";
import { real10yHistoryPath, type Real10YMacroHistory } from "./real10yOverlay";

/**
 * Real10Y (FRED DFII10) für die Technische Analyse: GET /api/analyze-btc/real10y-history (server/btc-macro.ts
 * fetchReal10YHistory, derselbe FRED-Fetcher wie der BTC-Chart, aber ohne M2SL). Läuft nur, solange der Chip an ist und ein
 * Startdatum (ältester Kurstag) bekannt ist. Standard-Fetcher (API_BASE, HTML-Guard → null = n/a);
 * HTTP 502 der Route → Fehler → n/a. Muster: useMarketTreasury10Y.
 */
export function useMarketReal10Y(startDate: string | null, enabled: boolean) {
  return useQuery<Real10YMacroHistory | null>({
    queryKey: [real10yHistoryPath(startDate ?? "")],
    queryFn: getQueryFn<Real10YMacroHistory | null>({ on401: "throw" }),
    enabled: enabled && !!startDate,
    // Server-Cache der Route: 5 min (server/btc-routes.ts CACHE_TTL_MS).
    staleTime: 5 * 60 * 1000,
  });
}
