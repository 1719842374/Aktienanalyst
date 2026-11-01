import { useQuery } from "@tanstack/react-query";
import type { CreditSpreadResponse } from "@shared/schema";
import { getQueryFn } from "./queryClient";

/**
 * JOB A1: eine Query für GET /api/credit-spread/market (FRED BAA10Y, Markt-Aggregat).
 * Läuft nur, solange der Chip in der Technischen Analyse an ist. Nicht tickerabhängig → ein Cache-Eintrag.
 * Über den Standard-Fetcher aus queryClient (API_BASE, HTML-Guard → null = n/a).
 */
export function useMarketCreditSpread(enabled: boolean) {
  return useQuery<CreditSpreadResponse | null>({
    queryKey: ["/api/credit-spread/market"],
    queryFn: getQueryFn<CreditSpreadResponse | null>({ on401: "throw" }),
    enabled,
    staleTime: 12 * 60 * 60 * 1000,
  });
}
