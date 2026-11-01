import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { GoldBondSnapshot } from "@shared/gold-bond-ratio";
import { GOLD_BOND_PARAMS } from "@shared/gold-bond-ratio";

/** FW-17: Gold/Bond (GC=F / TLT). Nur Anzeige, kein Score. */

function de(v: number, digits: number): string {
  return v.toFixed(digits).replace(".", ",");
}

export function GoldBondRatioView({ data }: { data: GoldBondSnapshot | null | undefined }) {
  const ratio = data?.ratio ?? null;
  return (
    <div className="bg-card border border-card-border rounded-lg px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="gold-bond-ratio">
      <span className="font-medium text-foreground">Gold/Bond</span>
      <span className="font-mono tabular-nums font-semibold text-amber-500" data-testid="gold-bond-ratio-value">
        {ratio == null ? "n/a" : de(ratio, 2)}
      </span>
      {ratio != null && data?.gold != null && data?.bond != null && (
        <span className="font-mono tabular-nums text-muted-foreground">{de(data.gold, 0)} / {de(data.bond, 2)}</span>
      )}
      <span className="text-[10px] text-muted-foreground" data-testid="gold-bond-ratio-meta">
        {ratio == null
          ? (data?.unavailableReason ?? "n/a — Gold/Bond nicht geladen")
          : data?.percentile == null && data?.z == null
            ? (data?.distributionReason ?? "n/a — Perzentil und z nicht belastbar")
            : `Perzentil ${data?.percentile == null ? "n/a" : `${de(data.percentile, 0)} %`} · z ${data?.z == null ? (data?.distributionReason ?? "n/a") : de(data.z, 2)}`}
        {data?.asOf ? ` · Stand ${data.asOf}` : ""}
        {` · Quelle ${data?.source ?? `Yahoo ${GOLD_BOND_PARAMS.goldSymbol} / ${GOLD_BOND_PARAMS.bondSymbol}`}`}
        {" · nur Anzeige, kein Score"}
      </span>
    </div>
  );
}

export function GoldBondRatioRow() {
  const { data } = useQuery<GoldBondSnapshot | null>({
    queryKey: ["/api/gold-bond-ratio"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/gold-bond-ratio");
        if (!res.ok) return null;
        return res.json();
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  return <GoldBondRatioView data={data} />;
}
