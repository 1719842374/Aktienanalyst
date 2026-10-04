/**
 * valueChainFlow.ts
 * -----------------
 * Rang 7–8: pure layout for the additive @xyflow/react stage flow.
 * Turns the existing ValueChainStage[] into stage nodes, the largest
 * companies per stage, and custom edges. Does not replace the CSS cards.
 *
 * Spec: Offen_WORK_VALUECHAIN_SECTOR_ROTATION.md
 */

import type { CompanyNodeData, StageNodeData, ValueChainStage } from "./valueChainTypes";

export const VALUE_CHAIN_FLOW_COMPANY_CAP = 3;

const COLUMN_X = 320;
const COMPANY_Y0 = 168;
const COMPANY_DY = 96;

export type ValueChainEdgeKind = "flow" | "member";

export interface ValueChainEdgeData extends Record<string, unknown> {
  kind: ValueChainEdgeKind;
  label: string;
  /** Stage-to-stage edges animate. Member edges stay still. */
  animate: boolean;
}

export interface ValueChainFlowNode {
  id: string;
  type: "stage" | "company";
  position: { x: number; y: number };
  data: StageNodeData | CompanyNodeData;
}

export interface ValueChainFlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  type: "valueChain";
  animated: boolean;
  data: ValueChainEdgeData;
}

export interface ValueChainFlowGraph {
  nodes: ValueChainFlowNode[];
  edges: ValueChainFlowEdge[];
}

function stageData(stage: ValueChainStage): StageNodeData {
  return {
    stageId: stage.stageId,
    stageName: stage.stageName,
    stageType: stage.stageType,
    description: stage.description,
    companyCount: stage.companyCount ?? stage.companies.length,
    aggregatedMarketCap: stage.aggregatedMarketCap,
    avgCapexIntensity: stage.avgCapexIntensity,
  };
}

function companyData(company: ValueChainStage["companies"][number]): CompanyNodeData {
  return {
    ticker: company.ticker,
    name: company.name,
    marketCap: company.marketCap,
    performance1Y: company.performance1Y,
    valuationFlag: company.valuationFlag,
    institutionalHolders13F: company.institutionalHolders13F,
    starInvestorFlag: company.starInvestorFlag,
    capexIntensity: company.capexIntensity,
    logoUrl: company.logoUrl,
    validated: company.validated,
  };
}

/**
 * Build the flow graph from API stages. Stage order is the array order
 * (upstream → midstream → downstream as returned). Missing stages are not
 * invented: consecutive present stages are linked.
 */
export function buildValueChainFlow(stages: ValueChainStage[]): ValueChainFlowGraph {
  const nodes: ValueChainFlowNode[] = [];
  const edges: ValueChainFlowEdge[] = [];

  stages.forEach((stage, index) => {
    const x = index * COLUMN_X;
    nodes.push({
      id: stage.stageId,
      type: "stage",
      position: { x, y: 0 },
      data: stageData(stage),
    });

    const shown = stage.companies.slice(0, VALUE_CHAIN_FLOW_COMPANY_CAP);
    shown.forEach((company, companyIndex) => {
      const companyId = `${stage.stageId}:${company.ticker}`;
      nodes.push({
        id: companyId,
        type: "company",
        position: { x, y: COMPANY_Y0 + companyIndex * COMPANY_DY },
        data: companyData(company),
      });
      edges.push({
        id: `member:${stage.stageId}:${company.ticker}`,
        source: stage.stageId,
        target: companyId,
        sourceHandle: "members",
        targetHandle: "in",
        type: "valueChain",
        animated: false,
        data: {
          kind: "member",
          label: company.ticker,
          animate: false,
        },
      });
    });

    if (index === 0) return;
    const previous = stages[index - 1];
    edges.push({
      id: `flow:${previous.stageId}->${stage.stageId}`,
      source: previous.stageId,
      target: stage.stageId,
      sourceHandle: "out",
      targetHandle: "in",
      type: "valueChain",
      animated: true,
      data: {
        kind: "flow",
        label: `${previous.stageName} → ${stage.stageName}`,
        animate: true,
      },
    });
  });

  return { nodes, edges };
}
