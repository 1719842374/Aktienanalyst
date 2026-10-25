import React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

/**
 * FW-16: GDX/GLD-Verhältnis (Minen vs. Metall) als Indikator-Zeile, nur Anzeige
 * (kein Score). ETFs nur als Preis-Proxy. Datenfluss: GdxGldRatioRow →
 * GET /api/gdx-gld-ratio → server/gold-gdx-gld-ratio.ts → Yahoo Chart GDX/GLD.
 */
export interface GdxGldRatioData {
  ratio: number | null;
  gdx: number | null;
  gld: number | null;
  asOf: string | null;
  min1y: number | null;
  max1y: number | null;
  change1yPct: number | null;
  rangePct: number | null;
  points: number;
  firstDate: string | null;
  source: string;
  unavailableReason: string | null;
}

const fmtDay = (d: string | null) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return "n/a";
  const [y, m, t] = d.split("-");
  return `${t}.${m}.${y}`;
};
const f3 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "n/a" : v.toFixed(3));

export function GdxGldRatioView({ data }: { data: GdxGldRatioData | null | undefined }) {
  const r = data?.ratio ?? null;
  const reason = data == null ? "Endpoint nicht erreichbar" : data.unavailableReason;
  const ch = data?.change1yPct ?? null;
  return (
    <div className="bg-card border border-card-border rounded-lg px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="gdx-gld-ratio">
      <span className="font-medium text-foreground" title="Goldminen-ETF (GDX) geteilt durch Gold-ETF (GLD): steigt, wenn Minen besser laufen als das Metall">GDX/GLD-Verhältnis</span>
      <span className="font-mono tabular-nums font-semibold text-amber-500" data-testid="gdx-gld-ratio-value">{f3(r)}</span>
      {r != null && data?.gdx != null && data?.gld != null && (
        <span className="font-mono tabular-nums text-muted-foreground">${data.gdx.toFixed(2)} / ${data.gld.toFixed(2)}</span>
      )}
      {r != null && (
        <span className="font-mono tabular-nums text-muted-foreground" data-testid="gdx-gld-ratio-range">
          1J: {f3(data?.min1y)}–{f3(data?.max1y)}
          {data?.rangePct != null ? ` · Lage ${data.rangePct.toFixed(0)} %` : " · Lage n/a"}
          {ch != null ? ` · ${ch >= 0 ? "+" : ""}${ch.toFixed(1)} % seit ${fmtDay(data?.firstDate ?? null)}` : ""}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground">
        Stand {fmtDay(data?.asOf ?? null)} (Schluss) · Quelle {data?.source ?? "Yahoo Chart GDX / GLD"}
        {reason ? ` · ${reason}` : ""} · ETFs nur als Preis-Proxy · nur Anzeige, kein Score
      </span>
    </div>
  );
}

export function GdxGldRatioRow() {
  const { data } = useQuery<GdxGldRatioData | null>({
    queryKey: ["/api/gdx-gld-ratio"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/gdx-gld-ratio");
        if (!res.ok) return null;
        return res.json();
      } catch {
        return null;
      }
    },
    staleTime: 10 * 60 * 1000,
    retry: 0,
  });
  return <GdxGldRatioView data={data} />;
}
