/**
 * StageNode.tsx
 * -------------
 * React-Flow custom node for a Value Chain stage (Upstream / Midstream / Downstream).
 *
 * Shows: stage name, type, company count, aggregated market cap,
 * and optional CAPEX intensity badge.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { StageNodeData } from "@/lib/valueChainTypes";
import { formatCapexIntensity } from "@/lib/valueChainTypes";

function formatMarketCap(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "–";
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${value.toFixed(0)}`;
}

const stageTypeColors: Record<string, string> = {
  upstream: "border-blue-500/60 bg-blue-950/40",
  midstream: "border-cyan-500/60 bg-cyan-950/40",
  downstream: "border-emerald-500/60 bg-emerald-950/40",
};

function StageNodeComponent({ data }: NodeProps & { data: StageNodeData }) {
  const colorClass = stageTypeColors[data.stageType] ?? "border-slate-500/60 bg-slate-900/40";

  return (
    <div
      className={`min-w-[220px] max-w-[280px] rounded-xl border-2 ${colorClass} px-4 py-3 shadow-lg backdrop-blur-sm`}
    >
      {/* Input handle (left) */}
      <Handle type="target" position={Position.Left} className="!bg-cyan-400 !w-2.5 !h-2.5" />

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
          <div className="shrink-0 rounded-md bg-slate-800/80 px-2 py-1 text-[10px] text-amber-300">
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

      {/* Output handle (right) */}
      <Handle type="source" position={Position.Right} className="!bg-cyan-400 !w-2.5 !h-2.5" />
    </div>
  );
}

export const StageNode = memo(StageNodeComponent);
