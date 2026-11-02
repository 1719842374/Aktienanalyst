/**
 * Gewinnwachstum und Growth Gap auf /recession.
 * queryKey ist die URL: der Default-Fetcher in client/src/lib/queryClient.ts hängt sie zusammen.
 */
import { useQuery } from "@tanstack/react-query";
import { GROWTH_GAP_PARAMS, type GrowthIndex, type RecessionGrowthBody } from "@shared/recession-growth";

export function useRecessionGrowth(index: GrowthIndex) {
  const plot = useQuery<RecessionGrowthBody | null>({
    queryKey: ["/api/recession/earnings-growth", index],
    staleTime: GROWTH_GAP_PARAMS.cacheTtlMs,
  });
  const gap = useQuery<RecessionGrowthBody | null>({
    queryKey: ["/api/recession/growth-gap", index],
    staleTime: GROWTH_GAP_PARAMS.cacheTtlMs,
  });
  return { plot, gap };
}
