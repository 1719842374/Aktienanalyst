import { useQuery } from "@tanstack/react-query";
import type { SectorPeResponse } from "@shared/schema";
import { getQueryFn } from "./queryClient";

/** GET /api/researcher/sector-pe — nur Anzeige, kein Score. */
export function useSectorPeDisplay() {
  return useQuery<SectorPeResponse | null>({
    queryKey: ["/api/researcher/sector-pe"],
    queryFn: getQueryFn<SectorPeResponse | null>({ on401: "throw" }),
    staleTime: 6 * 60 * 60 * 1000,
  });
}
