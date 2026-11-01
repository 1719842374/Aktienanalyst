import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { CROSS_MODULE_QUERY_KEYS } from "@shared/cross-module-refresh";
import { queryClient } from "@/lib/queryClient";
import {
  CROSS_MODULE_INITIAL_UPDATED_AT,
  invalidateCrossModuleQueries,
  isCrossModulePending,
  runCrossModuleSlot,
  subscribeCrossModulePending,
  type CrossModuleRefreshResult,
} from "@/lib/crossModuleRefresh";

const idle = (slot: CrossModuleRefreshResult["slot"]): CrossModuleRefreshResult => ({ phase: "idle", slot });

/**
 * Immer gemountet unter dem QueryClient. Die drei Queries bleiben ruhig
 * (staleTime Infinity, initialData), bis der Refresh-Button sie invalidiert.
 * Dann ruft jede Query ihre API-Route auf.
 */
export function CrossModuleRefreshHost() {
  useQuery({
    queryKey: CROSS_MODULE_QUERY_KEYS.analyze,
    queryFn: () => runCrossModuleSlot("analyze"),
    staleTime: Infinity,
    gcTime: Infinity,
    initialData: idle("analyze"),
    initialDataUpdatedAt: CROSS_MODULE_INITIAL_UPDATED_AT,
  });
  useQuery({
    queryKey: CROSS_MODULE_QUERY_KEYS.researcher,
    queryFn: () => runCrossModuleSlot("researcher"),
    staleTime: Infinity,
    gcTime: Infinity,
    initialData: idle("researcher"),
    initialDataUpdatedAt: CROSS_MODULE_INITIAL_UPDATED_AT,
  });
  useQuery({
    queryKey: CROSS_MODULE_QUERY_KEYS.portfolio,
    queryFn: () => runCrossModuleSlot("portfolio"),
    staleTime: Infinity,
    gcTime: Infinity,
    initialData: idle("portfolio"),
    initialDataUpdatedAt: CROSS_MODULE_INITIAL_UPDATED_AT,
  });
  return null;
}

export function CrossModuleRefreshButton({
  className,
  label = "Alle aktualisieren",
  testId = "button-cross-module-refresh",
}: {
  className?: string;
  label?: string;
  testId?: string;
}) {
  const pending = useSyncExternalStore(subscribeCrossModulePending, isCrossModulePending, () => false);
  return (
    <button
      type="button"
      data-testid={testId}
      title="Aktualisiert Analyse, Researcher und Portfolio gemeinsam über die API. Kann Credits verbrauchen. Keine Score-Änderung."
      disabled={pending}
      onClick={() => { void invalidateCrossModuleQueries(queryClient); }}
      className={className}
    >
      <RefreshCw className={`w-3.5 h-3.5 ${pending ? "animate-spin" : ""}`} />
      <span>{pending ? "Aktualisiere…" : label}</span>
    </button>
  );
}
