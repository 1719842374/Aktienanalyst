import type { RecessionAnalysis } from "@/components/recession/recessionDashboardShared";
import type { RegionalCatalogs } from "@shared/recession-regions";

/** The catalogs ride on the one POST /api/analyze-recession payload. */
export function useRecessionCatalog(data: RecessionAnalysis | null): RegionalCatalogs | null {
  return data?.regions ?? null;
}
