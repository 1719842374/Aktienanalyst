/**
 * StageNode.tsx
 * -------------
 * @xyflow/react stage node (Rang 1 Karte, Rang 7 Handles).
 * Die vollständige Kette bleibt die CSS-Spalte in StageColumn.tsx.
 * Dieser Knoten hängt im additiven Stufenfluss (ValueChainFlow).
 *
 * Zeigt: Stage-Name, Typ, Firmenanzahl, aggregierte Marktkapitalisierung,
 * und CAPEX-Intensity-Badge mit Farbe (capexColorClass/capexBorderClass,
 * beide unverändert aus valueChainTypes.ts übernommen).
 */

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { StageNodeData } from "@/lib/valueChainTypes";
import { formatCapexIntensity, capexColorClass, capexBorderClass } from "@/lib/valueChainTypes";

export type StageFlowNode = Node<StageNodeData, "stage">;

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

function StageNodeComponent({ data }: NodeProps<StageFlowNode>) {
  const bgClass = stageTypeColors[data.stageType] ?? "bg-slate-900/40";
  // CAPEX-Rahmenfarbe hat Vorrang vor der reinen Stage-Typ-Hintergrundfarbe,
  // sobald avgCapexIntensity befüllt ist (Rang 6 Akzeptanzkriterium: Badge
  // ist nicht durchgängig "n/a").
  const borderClass = capexBorderClass(data.avgCapexIntensity);

  return (
    <div
      className={`min-w-[220px] max-w-[280px] rounded-xl border-2 ${borderClass} ${bgClass} px-4 py-3 shadow-lg backdrop-blur-sm`}
      data-testid={`flow-stage-${data.stageType}`}
    >
      <Handle type="target" position={Position.Left} id="in" className="!h-2 !w-2 !border-slate-950 !bg-cyan-300" />
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
      <Handle type="source" position={Position.Right} id="out" className="!h-2 !w-2 !border-slate-950 !bg-cyan-300" />
      <Handle type="source" position={Position.Bottom} id="members" className="!h-2 !w-2 !border-slate-950 !bg-slate-400" />
    </div>
  );
}

export const StageNode = memo(StageNodeComponent);
