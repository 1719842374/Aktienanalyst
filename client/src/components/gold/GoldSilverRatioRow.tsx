import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { GdxGldRatioRow } from "@/components/gold/GdxGldRatioRow";

/** JOB 17: Gold/Silber-Ratio als Indikator-Zeile, nur Anzeige (kein Score). */
export interface GoldSilverRatioData {
  ratio: number | null;
  gold: number | null;
  silver: number | null;
  asOf: string | null;
  source: string;
  unavailableReason: string | null;
}

const fmtDate = (iso: string | null) => {
  if (!iso) return "n/a";
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })
    : "n/a";
};

export function GoldSilverRatioView({ data }: { data: GoldSilverRatioData | null | undefined }) {
  const r = data?.ratio ?? null;
  return (
    <div className="bg-card border border-card-border rounded-lg px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="gold-silver-ratio">
      <span className="font-medium text-foreground">Gold/Silber-Ratio</span>
      <span className="font-mono tabular-nums font-semibold text-amber-500" data-testid="gold-silver-ratio-value">
        {r == null ? "n/a" : r.toFixed(1)}
      </span>
      {r != null && data?.gold != null && data?.silver != null && (
        <span className="font-mono tabular-nums text-muted-foreground">${data.gold.toFixed(2)} / ${data.silver.toFixed(2)}</span>
      )}
      <span className="text-[10px] text-muted-foreground">
        Stand {fmtDate(data?.asOf ?? null)} · Quelle {data?.source ?? "FMP Quote GCUSD / SIUSD"}
        {r == null && data?.unavailableReason ? ` · ${data.unavailableReason}` : ""} · nur Anzeige, kein Score
      </span>
    </div>
  );
}

export function GoldSilverRatioRow() {
  const { data } = useQuery<GoldSilverRatioData | null>({
    queryKey: ["/api/gold-silver-ratio"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/gold-silver-ratio");
        if (!res.ok) return null;
        return res.json();
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  // FW-16: GDX/GLD-Zeile direkt darunter (eigene Route, nur Anzeige).
  return <><GoldSilverRatioView data={data} /><GdxGldRatioRow /></>;
}
