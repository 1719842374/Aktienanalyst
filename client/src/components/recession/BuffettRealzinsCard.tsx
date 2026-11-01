/**
 * Realzins-adjustierter Buffett auf #/recession, neben dem bestehenden Panel.
 * Zwei bestehende Routen, Rechnung in shared/buffett-realzins.ts. Kein Score.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { SERIES_FLOOR } from "@shared/recession-market-charts";
import { INVENTORY_DEMAND_GAP_PARAMS } from "@shared/inventory-demand-gap";
import { adjustBuffettForRealYield, type RealzinsReading } from "@shared/buffett-realzins";

interface BuffettBody {
  points?: { date: string; ratio: number }[];
  reason?: string;
  error?: string;
}

interface RealBody {
  real10yByDate?: Record<string, number>;
  error?: string;
}

function show(r: RealzinsReading | undefined, digits: number, unit: string): string {
  if (!r || r.value == null) return `n/a — ${r?.reason ?? "nicht geladen"}`;
  const sign = r.value < 0 ? "−" : "";
  return `${sign}${Math.abs(r.value).toFixed(digits).replace(".", ",")}${unit}`;
}

export function BuffettRealzinsCard() {
  const buffett = useQuery({
    queryKey: ["recession-buffett", "US", "realzins"],
    staleTime: INVENTORY_DEMAND_GAP_PARAMS.cacheTtlMs,
    queryFn: async (): Promise<BuffettBody> => {
      const res = await apiRequest("GET", "/api/analyze-recession/buffett?region=US");
      const body = await res.json().catch(() => ({})) as BuffettBody;
      if (!res.ok) throw new Error(String(body.reason ?? body.error ?? `HTTP ${res.status}`));
      return body;
    },
  });
  const real = useQuery({
    queryKey: ["real10y-history", SERIES_FLOOR],
    staleTime: INVENTORY_DEMAND_GAP_PARAMS.cacheTtlMs,
    queryFn: async (): Promise<RealBody> => {
      const res = await apiRequest("GET", `/api/analyze-btc/real10y-history?startDate=${SERIES_FLOOR}`);
      const body = await res.json().catch(() => ({})) as RealBody;
      if (!res.ok) throw new Error(String(body.error ?? `HTTP ${res.status}`));
      return body;
    },
  });

  const model = useMemo(() => {
    if (!buffett.data || !real.data) return null;
    const points = Object.entries(real.data.real10yByDate ?? {}).map(([date, value]) => ({ date, value }));
    return adjustBuffettForRealYield(buffett.data.points ?? [], points);
  }, [buffett.data, real.data]);

  const pending = buffett.isPending || real.isPending;
  const failed = buffett.isError || real.isError;

  return (
    <div className="mt-3 min-w-0 rounded-md border border-border bg-muted/20 p-3" data-testid="buffett-realzins">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">Realzins-Adjustierung (DFII10)</span>
        <span className="text-[9px] text-muted-foreground">kein Score-Einfluss</span>
      </div>
      {pending ? (
        <p className="text-xs text-muted-foreground" data-testid="buffett-realzins-loading">wird geladen …</p>
      ) : failed ? (
        <p className="break-words text-xs" data-testid="buffett-realzins-error">
          n/a — {String((buffett.error as Error)?.message ?? (real.error as Error)?.message ?? "Quelle nicht erreichbar")}
        </p>
      ) : model?.reason ? (
        <p className="break-words text-xs" data-testid="buffett-realzins-na">{model.reason.startsWith("n/a") ? model.reason : `n/a — ${model.reason}`}</p>
      ) : model ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="buffett-realzins-grid">
          <Cell testId="buffett-realzins-raw" label="Buffett raw" value={show(model.latestRaw, 1, " %")} />
          <Cell testId="buffett-realzins-adj" label="Buffett adj" value={show(model.latestAdj, 1, " %")} />
          <Cell testId="buffett-realzins-beta" label="Beta aus der Reihe" value={show(model.beta, 3, "")} />
          <Cell testId="buffett-realzins-real" label="Realzins (Median der Überlappung)" value={`${show(model.latestReal, 2, " %")} · Median ${show(model.realMedian, 2, " %")}`} />
          <Cell
            testId="buffett-realzins-zone"
            label="Lage der adjustierten Reihe"
            value={model.zoneLabel
              ? `${model.zoneLabel} · z ${show(model.z, 2, "")} · Perzentil ${show(model.percentile, 0, "")}`
              : show(model.z, 2, "")}
          />
        </div>
      ) : (
        <p className="text-xs" data-testid="buffett-realzins-na">n/a — keine gemeinsame Reihe</p>
      )}
    </div>
  );
}

function Cell({ testId, label, value }: { testId: string; label: string; value: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="break-words text-xs font-semibold tabular-nums">{value}</div>
    </div>
  );
}
