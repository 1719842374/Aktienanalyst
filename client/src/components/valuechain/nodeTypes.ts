/**
 * nodeTypes.ts
 * ------------
 * React-Flow nodeTypes registry for the Value Chain explorer.
 */

import { StageNode } from "./StageNode";
import { CompanyNode } from "./CompanyNode";

export const valueChainNodeTypes = {
  stage: StageNode,
  company: CompanyNode,
} as const;
