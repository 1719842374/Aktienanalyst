/**
 * ValueChainFlowEdge.tsx
 * ----------------------
 * Rang 7–8: custom @xyflow/react edge. Stage-to-stage edges (kind "flow")
 * draw a bezier, a label, and a particle moving along the path. Member
 * edges stay quiet. prefers-reduced-motion drops the particle; the dash
 * animation is disabled by the parent stylesheet.
 */

import { memo, useEffect, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import type { ValueChainEdgeData } from "@/lib/valueChainFlow";

export type ValueChainFlowEdgeType = Edge<ValueChainEdgeData, "valueChain">;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduced;
}

function ValueChainFlowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
}: EdgeProps<ValueChainFlowEdgeType>) {
  const reducedMotion = usePrefersReducedMotion();
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const isFlow = data?.kind === "flow";
  const animate = Boolean(isFlow && data?.animate && !reducedMotion);
  const stroke = isFlow ? "#22d3ee" : "#64748b";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        interactionWidth={16}
        style={{
          stroke,
          strokeWidth: isFlow ? 2 : 1.25,
          ...style,
        }}
      />
      {animate && (
        <circle r="3.5" fill="#a5f3fc" pointerEvents="none">
          <animateMotion dur="2.8s" repeatCount="indefinite" path={edgePath} />
        </circle>
      )}
      {isFlow && data?.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none rounded-full border border-cyan-400/30 bg-slate-950/90 px-2 py-0.5 text-[10px] text-cyan-100"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            data-testid={`valuechain-edge-${id}`}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ValueChainFlowEdge = memo(ValueChainFlowEdgeComponent);
