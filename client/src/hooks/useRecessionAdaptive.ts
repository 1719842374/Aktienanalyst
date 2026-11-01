/**
 * Future_7/8. useQuery ohne eigene queryFn → Default-Fetcher in client/src/lib/queryClient.ts
 * → GET /api/analyze-recession/adaptive. Nur Anzeige, kein Score.
 */
import { useQuery } from "@tanstack/react-query";
import { RECESSION_ADAPTIVE_PARAMS, type RecessionAdaptiveResponse } from "@shared/recession-adaptive";

export function useRecessionAdaptive() {
  return useQuery<RecessionAdaptiveResponse | null>({
    queryKey: ["/api/analyze-recession/adaptive"],
    staleTime: RECESSION_ADAPTIVE_PARAMS.cacheTtlMs,
  });
}
