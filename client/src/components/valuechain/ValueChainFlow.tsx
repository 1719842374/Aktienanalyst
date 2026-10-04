/**
 * ValueChainFlow.tsx
 * ------------------
 * Rang 7–9 UI. Additive @xyflow/react canvas above the CSS card row.
 * The cards in StageColumn stay the full chain. This graph shows the
 * stages, custom edges between them, edge animation, and the active
 * rate-limit mode (Redis only when configured).
 */

import { useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildValueChainFlow } from "@/lib/valueChainFlow";
import type { ValueChainRateLimitMode, ValueChainStage } from "@/lib/valueChainTypes";
import { valueChainEdgeTypes, valueChainNodeTypes } from "./nodeTypes";

interface ValueChainFlowProps {
  stages: ValueChainStage[];
  rateLimitMode?: ValueChainRateLimitMode;
  onCompanyClick?: (ticker: string) => void;
}

export function ValueChainFlow({
  stages,
  rateLimitMode = "in-process",
  onCompanyClick,
}: ValueChainFlowProps) {
  const graph = useMemo(() => buildValueChainFlow(stages), [stages]);
  const modeLabel = rateLimitMode === "redis" ? "Redis" : "In-Process";

  return (
    <section className="mb-6" aria-label="Wertschöpfungskette als Flussdiagramm" data-testid="valuechain-flow">
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .valuechain-flow .react-flow__edge.animated .react-flow__edge-path {
            animation: none;
            stroke-dasharray: none;
          }
        }
      `}</style>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">Stufenfluss</h2>
          <p className="max-w-xl text-[11px] leading-snug text-slate-400">
            Eigene Kanten zwischen den Stufen, animiert in Flussrichtung. Angezeigt werden die
            Stufen und die drei größten Firmen je Stufe. Die Karten darunter bleiben die
            vollständige Kette.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[10px]" data-testid="valuechain-ranks-7-9">
          <span
            className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-cyan-200"
            data-testid="valuechain-rank-7"
          >
            Rang 7 · Custom Edges
          </span>
          <span
            className="rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-cyan-200"
            data-testid="valuechain-rank-8"
          >
            Rang 8 · Animation
          </span>
          <span
            className="rounded-full border border-white/10 bg-slate-800/80 px-2 py-1 text-slate-300"
            data-testid="valuechain-rank-9"
          >
            Rang 9 · Rate-Limit: {modeLabel}
          </span>
        </div>
      </div>
      <div className="valuechain-flow h-[420px] w-full overflow-hidden rounded-2xl border border-white/5 bg-[#070b14] md:h-[480px]">
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={valueChainNodeTypes}
          edgeTypes={valueChainEdgeTypes}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          colorMode="dark"
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.3}
          maxZoom={1.5}
          defaultEdgeOptions={{
            type: "valueChain",
            markerEnd: { type: MarkerType.ArrowClosed, color: "#22d3ee", width: 18, height: 18 },
          }}
          onNodeClick={(_, node) => {
            if (node.type === "company" && typeof node.data?.ticker === "string") {
              onCompanyClick?.(node.data.ticker);
            }
          }}
        >
          <Background color="#1e293b" gap={18} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
}
