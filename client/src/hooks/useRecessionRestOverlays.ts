import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

/**
 * Buffett-Quote der bestehenden Route GET /api/analyze-recession/buffett (server/buffett-route.ts).
 * Nur solange der Chip an ist. Cache wie die Route (15 min). Kein Score.
 */
export interface BuffettOverlayBody {
  region?: string;
  asOf?: string | null;
  sources?: { id: string; role: string }[];
  points?: { date: string; ratio: number }[];
  note?: string | null;
  error?: string;
}

export function useRecessionBuffettOverlay(region: "US" | "EU" | "CN", enabled: boolean) {
  const path = `/api/analyze-recession/buffett?region=${region}`;
  return useQuery<BuffettOverlayBody | null>({
    queryKey: [path],
    queryFn: getQueryFn<BuffettOverlayBody | null>({ on401: "throw" }),
    enabled,
    // server/buffett-route.ts CACHE_MS.
    staleTime: 15 * 60 * 1000,
  });
}

export function buffettSourceIds(body: BuffettOverlayBody | null | undefined): string {
  return (body?.sources ?? []).map(s => s.id).filter(Boolean).join(", ");
}
