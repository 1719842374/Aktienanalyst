import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { MacroLayer } from "@shared/macro-layer";
import type { IndicatorResult } from "@/components/recession/recessionDashboardShared";

/**
 * F9 Makro-Ebene: schickt die schon geladenen Rezessions-Indikatoren an POST /api/recession/macro-layer.
 * Bei Fallback-Daten (statischer Stand) wird nicht gerechnet → Karte zeigt n/a.
 */
export function useMacroLayer(indicators: IndicatorResult[] | null, enabled: boolean) {
  const payload = (indicators ?? []).map(i => ({
    name: i.name, group: i.group, weightedScore: i.weightedScore, maxWeighted: i.maxWeighted, available: i.available,
  }));
  return useQuery<MacroLayer>({
    queryKey: ["/api/recession/macro-layer", JSON.stringify(payload)],
    enabled: enabled && payload.length > 0,
    staleTime: 30 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/recession/macro-layer", { indicators: payload });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as MacroLayer;
    },
  });
}
