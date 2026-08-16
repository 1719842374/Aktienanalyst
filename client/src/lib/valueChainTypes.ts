/**
 * valueChainTypes.ts
 * ------------------
 * TypeScript interfaces for the Industry Value Chain feature
 * (React-Flow nodes + CAPEX intensity).
 *
 * Spec: WORK_VALUECHAIN_SECTOR_ROTATION.md
 * Status: Implementation phase – define nodes first, then CAPEX intensity.
 */

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

export type StageType = "upstream" | "midstream" | "downstream";

export type ValuationFlag = "cheap" | "fair" | "expensive" | "n/a";

export type Region = "US" | "EU" | "ASIA" | "GLOBAL";

export interface ValueChainCompany {
  ticker: string;
  name: string;
  marketCap: number | null;
  sector: string;
  industry: string;
  performance1Y?: number | null;
  valuationFlag?: ValuationFlag;
  /** Number of significant 13F holders (from star-investor screener) */
  institutionalHolders13F?: number;
  topHolders?: string[];
  starInvestorFlag?: boolean;
  /** Capex / Revenue (TTM), 0–1 scale or percent */
  capexIntensity?: number | null;
  logoUrl?: string;
  validated: boolean;
}

export interface ValueChainStage {
  stageId: string;
  stageName: string;
  stageType: StageType;
  description?: string;
  companies: ValueChainCompany[];
  /** Aggregated metrics (computed client- or server-side) */
  aggregatedMarketCap?: number | null;
  /** Median or weighted-average Capex intensity of companies in this stage */
  avgCapexIntensity?: number | null;
  companyCount?: number;
}

export interface ValueChainRequest {
  industry: string;
  minMarketCap?: number; // default 1_000_000_000
  region?: Region;
  force?: boolean;
  include13F?: boolean;
  includeCapex?: boolean;
}

export interface ValueChainResponse {
  industry: string;
  region: string;
  stages: ValueChainStage[];
  generatedAt: string;
  cacheHit: boolean;
  llmValidated: boolean;
  notes?: string[];
}

// ---------------------------------------------------------------------------
// React-Flow specific node data
// ---------------------------------------------------------------------------

/** Data payload for a Stage (header) node */
export interface StageNodeData extends Record<string, unknown> {
  stageId: string;
  stageName: string;
  stageType: StageType;
  description?: string;
  companyCount: number;
  aggregatedMarketCap?: number | null;
  avgCapexIntensity?: number | null;
}

/** Data payload for a Company node */
export interface CompanyNodeData extends Record<string, unknown> {
  ticker: string;
  name: string;
  marketCap: number | null;
  performance1Y?: number | null;
  valuationFlag?: ValuationFlag;
  institutionalHolders13F?: number;
  starInvestorFlag?: boolean;
  capexIntensity?: number | null;
  logoUrl?: string;
  validated: boolean;
}

/** React-Flow node type discriminator */
export type ValueChainNodeType = "stage" | "company";

// ---------------------------------------------------------------------------
// CAPEX intensity helpers (pure)
// ---------------------------------------------------------------------------

/**
 * Capex intensity = |Capex| / Revenue (both TTM).
 * Returns null if inputs invalid.
 */
export function computeCapexIntensity(
  capex: number | null | undefined,
  revenue: number | null | undefined
): number | null {
  if (
    capex == null ||
    revenue == null ||
    !Number.isFinite(capex) ||
    !Number.isFinite(revenue) ||
    revenue <= 0
  ) {
    return null;
  }
  // Capex is often reported negative in cash-flow statements
  return Math.abs(capex) / revenue;
}

/**
 * Aggregate Capex intensity for a stage.
 * Uses median of valid company intensities (robust).
 */
export function aggregateStageCapexIntensity(
  companies: ValueChainCompany[]
): number | null {
  const values = companies
    .map((c) => c.capexIntensity)
    .filter((v): v is number => v != null && Number.isFinite(v));

  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Format intensity as percent string */
export function formatCapexIntensity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}
