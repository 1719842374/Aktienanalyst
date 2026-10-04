/**
 * nodeTypes.ts
 * ------------
 * @xyflow/react registries for the additive value-chain flow (Rang 7–8).
 * StageColumn does not use these. The CSS card row stays independent.
 */

import type { EdgeTypes, NodeTypes } from "@xyflow/react";
import { CompanyNode } from "./CompanyNode";
import { StageNode } from "./StageNode";
import { ValueChainFlowEdge } from "./ValueChainFlowEdge";

export const valueChainNodeTypes = {
  stage: StageNode,
  company: CompanyNode,
} satisfies NodeTypes;

export const valueChainEdgeTypes = {
  valueChain: ValueChainFlowEdge,
} satisfies EdgeTypes;

export { StageNode, CompanyNode };
