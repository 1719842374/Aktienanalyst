import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { MINER_PIPELINE_CACHE_MS, type MinerMapResponse } from "@shared/miner-map";

/**
 * GET /api/btc/miner-map (server/routes.ts → server/miner-map.ts).
 * Nur solange der Miner-Layer offen ist. Kein Score.
 */
export function useMinerMap(enabled = true) {
  return useQuery<MinerMapResponse | null>({
    queryKey: ["/api/btc/miner-map"],
    queryFn: getQueryFn<MinerMapResponse | null>({ on401: "throw" }),
    enabled,
    staleTime: MINER_PIPELINE_CACHE_MS,
  });
}
