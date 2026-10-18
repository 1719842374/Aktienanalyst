import { useQuery } from "@tanstack/react-query";
import type { Treasury10YResponse } from "@shared/schema";
import { getQueryFn } from "./queryClient";

/**
 * A3: eine Query für GET /api/treasury-10y/market (FRED DGS10, Marktzins).
 * Läuft nur, solange der Chip in der Technischen Analyse an ist. Nicht tickerabhängig → ein Cache-Eintrag.
 * Über den Standard-Fetcher aus queryClient (API_BASE, HTML-Guard → null = n/a). Muster: useMarketCreditSpread.
 */
export function useMarketTreasury10Y(enabled: boolean) {
  return useQuery<Treasury10YResponse | null>({
    queryKey: ["/api/treasury-10y/market"],
    queryFn: getQueryFn<Treasury10YResponse | null>({ on401: "throw" }),
    enabled,
    staleTime: 12 * 60 * 60 * 1000,
  });
}
