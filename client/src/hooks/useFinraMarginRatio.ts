import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { marketsResponseSchema, type LeverageStrip } from "@shared/recession-market-charts";

/**
 * Margin-Debt-Ratio für den TA-Toggle.
 * Dieselbe Route wie die FINRA-Karte: GET /api/analyze-recession/markets.
 * Kein zweiter FINRA-Abruf. Nur solange der Chip an ist.
 */
export interface FinraMarginRatioResult {
  leverage: LeverageStrip | null;
  leverageNote: string | null;
}

export function useFinraMarginRatio(enabled: boolean) {
  return useQuery({
    queryKey: ["/api/analyze-recession/markets", "MAX", "margin-ratio"],
    enabled,
    staleTime: 30 * 60 * 1000,
    queryFn: async (): Promise<FinraMarginRatioResult> => {
      const res = await apiRequest("GET", "/api/analyze-recession/markets?window=MAX");
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json() as { error?: unknown };
          if (typeof body?.error === "string" && body.error) detail = body.error;
        } catch {
          /* non-JSON error body */
        }
        throw new Error(detail);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new Error("Antwortform der Markt-Route passt nicht");
      }
      const parsed = marketsResponseSchema.safeParse(body);
      if (!parsed.success) throw new Error("Antwortform der Markt-Route passt nicht");
      const spy = parsed.data.markets.find((market) => market.id === "SPY") ?? null;
      return {
        leverage: spy?.leverage ?? null,
        leverageNote: spy?.leverageNote ?? null,
      };
    },
  });
}
