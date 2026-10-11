import { useQuery } from "@tanstack/react-query";
import type { DividendHistoryResponse } from "@shared/dividends";
import { dividendKpiDisplay } from "./dividendKpi";

/** One query for /api/dividends/:ticker, shared by the TA overlay (Section 12) and the Div.-Yield KPI (Section 1 + Section 4). */
export function useDividendHistory(ticker: string | null | undefined, enabled = true) {
  return useQuery<DividendHistoryResponse>({
    queryKey: ["dividends", ticker],
    enabled: enabled && !!ticker,
    staleTime: 12 * 60 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(`/api/dividends/${encodeURIComponent(String(ticker))}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
  });
}

/** JOB 20: Div.-Yield-Anzeige aus derselben Query + Funktion für Section 1 und Section 4. */
export function useDividendKpi(data: Parameters<typeof dividendKpiDisplay>[0] & { ticker: string }) {
  const q = useDividendHistory(data.ticker);
  return dividendKpiDisplay(data, q.data);
}
