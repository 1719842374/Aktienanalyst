import { useQuery } from "@tanstack/react-query";
import type { CompanyCreditMetricsResponse } from "@shared/credit-risk";
import { getQueryFn } from "./queryClient";

/**
 * Kreditrisiko-Karte (Sektion 10): GET /api/credit-risk/company/:ticker (FMP-GuV → Zinsdeckung).
 * Standard-Fetcher aus queryClient (API_BASE, HTML-Guard → null = n/a). Muster: useMarketCreditSpread.
 */
export function useCompanyCreditMetrics(ticker: string | null | undefined) {
  return useQuery<CompanyCreditMetricsResponse | null>({
    queryKey: [`/api/credit-risk/company/${encodeURIComponent(ticker ?? "")}`],
    queryFn: getQueryFn<CompanyCreditMetricsResponse | null>({ on401: "throw" }),
    enabled: !!ticker,
    staleTime: 12 * 60 * 60 * 1000,
  });
}
