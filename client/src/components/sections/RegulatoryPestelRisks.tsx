import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { apiRequest } from "../../lib/queryClient";
import type { StockAnalysis } from "../../../../shared/schema";

interface PestelRisks {
  political: string[];
  legal: string[];
  badgeOnly: string[];
}

interface Cached {
  pestelRisks?: PestelRisks;
  gate?: { cap: number; severity: string; rationale: string } | null;
}

/**
 * Liest Disk-Cache (24h) — kein LLM. Füllt sich nach POST /api/regulatory.
 * Miss ist { cached:false } und kein Fehler. queryKey dedupt die zwei Mounts
 * (Moat-Sektion und PESTEL-Sektion).
 */
export function RegulatoryPestelRisks({ data }: { data: StockAnalysis }) {
  const q = useQuery({
    queryKey: ["regulatory-cached", data.ticker],
    queryFn: async (): Promise<Cached | null> => {
      const res = await apiRequest("GET", `/api/regulatory/cached/${encodeURIComponent(data.ticker)}`);
      if (!res.ok) return null;
      const json = (await res.json()) as Cached & { cached?: boolean };
      if (json?.cached === false) return null;
      return json;
    },
  });
  const cached = q.data ?? null;

  const risks = cached?.pestelRisks;
  const empty =
    !risks ||
    (risks.political.length === 0 && risks.legal.length === 0 && risks.badgeOnly.length === 0);
  if (empty && !cached?.gate) return null;

  return (
    <div className="rounded-lg border border-border/50 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Scale className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          PESTEL-Risks aus Regulatory-Matrix ({data.ticker})
        </span>
      </div>
      {cached?.gate && (
        <div className="text-[11px] text-amber-500">
          Gate Cap {cached.gate.cap} ({cached.gate.severity}): {cached.gate.rationale}
        </div>
      )}
      {risks?.political.length ? (
        <div>
          <div className="text-[10px] font-bold uppercase text-foreground/70">Political</div>
          <ul className="list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">
            {risks.political.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {risks?.legal.length ? (
        <div>
          <div className="text-[10px] font-bold uppercase text-foreground/70">Legal</div>
          <ul className="list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">
            {risks.legal.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {risks?.badgeOnly.length ? (
        <div className="text-[10px] text-slate-400">
          Badge: {risks.badgeOnly.join(" · ")}
        </div>
      ) : null}
    </div>
  );
}
