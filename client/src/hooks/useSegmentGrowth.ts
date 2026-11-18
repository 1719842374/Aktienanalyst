import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { SegmentGrowthAnnotation } from "@shared/segment-growth-calc";

export interface SegmentGrowthResponse {
  ticker: string;
  business: SegmentGrowthAnnotation[];
  geographic: SegmentGrowthAnnotation[];
  source: string;
  currency?: string | null;
  error?: string;
}

/**
 * GET /api/segment-growth/:ticker über den Query-Client.
 * Nur Anzeige. Der Analyze-Payload und der Score bleiben unverändert.
 */
export function useSegmentGrowth(ticker: string | null | undefined, enabled = true) {
  const symbol = (ticker ?? "").trim();
  return useQuery<SegmentGrowthResponse | null>({
    queryKey: ["/api/segment-growth", symbol],
    queryFn: getQueryFn<SegmentGrowthResponse | null>({ on401: "throw" }),
    enabled: enabled && symbol.length > 0,
    staleTime: 15 * 60 * 1000,
  });
}
