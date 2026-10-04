import { useQuery } from "@tanstack/react-query";
import { apiErrorFromResponse } from "@/lib/apiError";
import {
  factpackSchema,
  marketsResponseSchema,
  type MarketFactpack,
  type MarketsResponse,
  type MarketWindow,
} from "@shared/recession-market-charts";

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

export function useRecessionMarketCharts(window: MarketWindow) {
  return useQuery({
    queryKey: ["recession-market-charts", window],
    queryFn: async (): Promise<MarketsResponse> => {
      const res = await fetch(`/api/analyze-recession/markets?window=${window}`);
      if (!res.ok) throw await apiErrorFromResponse(res);
      const parsed = marketsResponseSchema.safeParse(await readJson(res));
      if (!parsed.success) throw new Error("Unerwartete Antwort der Markt-Charts");
      return parsed.data;
    },
    staleTime: 30 * 60 * 1000,
  });
}

export function useRecessionMarketFactpack(
  etf: string | null,
  date: string | null,
  window: MarketWindow,
) {
  return useQuery({
    queryKey: ["recession-market-factpack", etf, date, window],
    enabled: Boolean(etf && date),
    queryFn: async (): Promise<MarketFactpack> => {
      const params = new URLSearchParams({
        etf: etf ?? "",
        date: date ?? "",
        window,
      });
      const res = await fetch(`/api/analyze-recession/markets?${params.toString()}`);
      if (!res.ok) throw await apiErrorFromResponse(res);
      const parsed = factpackSchema.safeParse(await readJson(res));
      if (!parsed.success) throw new Error("Unerwartetes Factpack");
      return parsed.data;
    },
    staleTime: 30 * 60 * 1000,
  });
}
