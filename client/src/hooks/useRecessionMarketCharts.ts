import { useQuery } from "@tanstack/react-query";
import { apiErrorFromResponse } from "@/lib/apiError";
import type {
  MarketWindow,
  RecessionChartMarketId,
  RecessionFactpackResponse,
  RecessionMarketsResponse,
} from "@shared/recession-market-charts";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw await apiErrorFromResponse(res);
  return res.json() as Promise<T>;
}

/** Windowed four-market payload. Tabs switch client-side; the window refetches. */
export function useRecessionMarketCharts(window: MarketWindow) {
  return useQuery({
    queryKey: ["recession-market-charts", window],
    queryFn: () => getJson<RecessionMarketsResponse>(`/api/analyze-recession/markets?window=${window}`),
    staleTime: 30 * 60 * 1000,
  });
}

/** Lazy click factpack. Valuation is not on the price axis. */
export function useRecessionMarketFactpack(
  id: RecessionChartMarketId | null,
  date: string | null,
  window: MarketWindow,
) {
  return useQuery({
    queryKey: ["recession-market-factpack", id, date, window],
    enabled: Boolean(id && date),
    queryFn: () => getJson<RecessionFactpackResponse>(
      `/api/analyze-recession/markets?window=${window}&id=${id}&date=${date}`,
    ),
    staleTime: 30 * 60 * 1000,
  });
}
