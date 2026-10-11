import { useQuery } from "@tanstack/react-query";
import type { DividendHistoryResponse } from "@shared/dividends";

/** One query for /api/dividends/:ticker, shared by the TA overlay (Section 12) and the Div.-Yield KPI (Section 1). */
export function useDividendHistory(ticker: string | null | undefined, enabled = true) {
  return useQuery<DividendHistoryResponse>({
    queryKey: ["dividends", "v2", ticker],
    enabled: enabled && !!ticker,
    staleTime: 12 * 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/dividends/${encodeURIComponent(String(ticker))}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}
