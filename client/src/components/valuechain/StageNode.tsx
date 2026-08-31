/**
 * StageNode.tsx
 * -------------
 * Statische Karte (KEIN React-Flow-Node mehr — Sprint D6a, Ticket
 * tickets/SPRINT_D6A_VALUECHAIN_DATEN.md, "Explizit NICHT in diesem Ticket":
 * kein Graph-Canvas/React-Flow-Renderer, @xyflow/react wird NICHT installiert).
 *
 * Vorher importierte diese Datei `Handle`/`Position`/`NodeProps` aus
 * `@xyflow/react` — ein Paket, das nie in package.json installiert wurde
 * (tsc-Fehler TS2307 seit Erstellung, bereits Teil der 100-Fehler-Baseline).
 * Diese Umstellung auf eine reine Anzeige-Karte behebt diesen vorbestehenden
 * Fehler zusätzlich, ohne dass eine neue Abhängigkeit hinzukommt.
 *
 * Zeigt: Stage-Name, Typ, Firmenanzahl, aggregierte Marktkapitalisierung,
 * und CAPEX-Intensity-Badge mit Farbe (capexColorClass/capexBorderClass,
 * beide unverändert aus valueChainTypes.ts übernommen).
 */

import { memo } from "react";
import type { StageNodeData } from "@/lib/valueChainTypes";
import { formatCapexIntensity, capexColorClass, capexBorderClass } from "@/lib/valueChainTypes";

function formatMarketCap(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "–";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

const stageTypeColors: Record<string, string> = {
  upstream: "bg-blue-950/40",
  midstream: "bg-cyan-950/40",
  downstream: "bg-emerald-950/40",
};

interface StageNodeProps {
  data: StageNodeData;
}

function StageNodeComponent({ data }: StageNodeProps) {
  const bgClass = stageTypeColors[data.stageType] ?? "bg-slate-900/40";
  // CAPEX-Rahmenfarbe hat Vorrang vor der reinen Stage-Typ-Hintergrundfarbe,
  // sobald avgCapexIntensity befüllt ist (Rang 6 Akzeptanzkriterium: Badge
  // ist nicht durchgängig "n/a").
  const borderClass = capexBorderClass(data.avgCapexIntensity);

  return (
    <div
      className={`min-w-[220px] max-w-[280px] rounded-xl border-2 ${borderClass} ${bgClass} px-4 py-3 shadow-lg backdrop-blur-sm`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400">
            {data.stageType}
          </div>
          <div className="text-sm font-semibold text-white leading-tight mt-0.5">
            {data.stageName}
          </div>
        </div>
        {data.avgCapexIntensity != null && (
          <div
            className={`shrink-0 rounded-md bg-slate-800/80 px-2 py-1 text-[10px] font-semibold ${capexColorClass(data.avgCapexIntensity)}`}
          >
            CAPEX {formatCapexIntensity(data.avgCapexIntensity)}
          </div>
        )}
      </div>

      {data.description && (
        <p className="mt-1.5 text-[11px] text-slate-400 line-clamp-2">{data.description}</p>
      )}

      <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-300">
        <span>{data.companyCount} Firmen</span>
        <span className="text-slate-500">·</span>
        <span>{formatMarketCap(data.aggregatedMarketCap)}</span>
      </div>
    </div>
  );
}

export const StageNode = memo(StageNodeComponent);
