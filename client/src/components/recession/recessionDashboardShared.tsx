// Types matching the backend response
export interface IndicatorResult {
  name: string;
  group: "recession" | "correction";
  subgroup: string;
  value: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  maxWeighted: number;
  zone: string;
  source: string;
  description: string;
  available?: boolean;
  /** Set when the crowd leg is the VIX substitute or a crypto print, not live CNN. */
  proxy?: boolean;
}

export interface SubgroupResult {
  name: string;
  label: string;
  horizon: string;
  indicators: string[];
  netScore: number;
  maxScore: number;
  probability: number;
  formula: string;
  nyFedAnchor?: number;
  finalProbability?: number;
}

export interface FazitSection {
  title: string;
  emoji: string;
  text: string;
}

/** Mirrors server/recession-bridge.ts. Rendered only through fazit.sections. */
export interface RecessionBridgeView {
  rates: {
    dgs10: number | null;
    dfii10: number | null;
    t10yie: number | null;
    dff: number | null;
    zReal: number | null;
    zBe: number | null;
    zWei: number | null;
    identityGap: number | null;
  };
  oil: {
    wti: number | null;
    deltaWti4w: number | null;
    zOil: number | null;
    corr20d: number | null;
    deltaGas8w: number | null;
    passCPI: number | null;
    passBE: number | null;
    shock: boolean;
  };
  flags: {
    rateTight: boolean;
    stagflationWedge: boolean;
    shock: boolean;
  };
}

export interface RecessionDriverCard {
  id: string;
  title: string;
  text: string;
  reason: string;
}

export interface RecessionDrivers {
  status: "unauffällig" | "drivers" | "empty";
  lines: string[];
  cards: RecessionDriverCard[];
}

export interface SahmControlRowView {
  date: string;
  computed: number | null;
  fred: number;
  absDiff: number | null;
}

/** Regional Sahm board. These rows are not part of the 17-indicator net. */
export interface SahmRegionBoard {
  region: "US" | "EZ" | "JP";
  label: string;
  source: string;
  value: string;
  zone: string;
  level: number | null;
  s: number;
  raw: number;
  available: boolean;
  triggered: boolean;
  n: number;
  controlOk?: boolean;
  control?: SahmControlRowView[];
  computedLevel: number | null;
  computedS: number;
  computedRaw: number;
  computedAvailable: boolean;
  computedValue: string;
}

export interface RecessionAnalysis {
  date: string;
  asOf?: string;
  schemaVersion?: number;
  indicators: IndicatorResult[];
  subgroups: SubgroupResult[];
  nyFedValue: number | null;
  googleTrendsAvailable: boolean;
  topDrivers: string[];
  interpretation: string;
  drivers?: RecessionDrivers;
  fazit?: { summary: string; riskLevel: string; sections: FazitSection[] };
  sources: { name: string; url: string }[];
  bridge?: RecessionBridgeView;
  sahmRegions?: SahmRegionBoard[];
}

/** „Stand“ only when the response day is this UTC day. */
export function showRecessionStand(asOf: string | null | undefined, todayIso: string): boolean {
  return typeof asOf === "string" && asOf.length > 0 && asOf === todayIso;
}

/**
 * RECPROUSM156N is already percent. Prefer the series over a stored anchor so a
 * stale ×10 figure cannot override the live print.
 */
export function displayedNyFedAnchorPct(nyFedValue: number | null, nyFedAnchor?: number): number | null {
  if (typeof nyFedValue === "number" && Number.isFinite(nyFedValue)) return nyFedValue;
  if (typeof nyFedAnchor === "number" && Number.isFinite(nyFedAnchor)) return nyFedAnchor;
  return null;
}

// Color helpers
export function getProbColor(p: number): string {
  if (p >= 70) return "text-red-500";
  if (p >= 50) return "text-orange-500";
  if (p >= 30) return "text-yellow-500";
  return "text-emerald-500";
}

export function getProbBg(p: number): string {
  if (p >= 70) return "bg-red-500/10 border-red-500/30";
  if (p >= 50) return "bg-orange-500/10 border-orange-500/30";
  if (p >= 30) return "bg-yellow-500/10 border-yellow-500/30";
  return "bg-emerald-500/10 border-emerald-500/30";
}

export function getProbLabel(p: number): string {
  if (p >= 70) return "Hoch";
  if (p >= 50) return "Moderat";
  if (p >= 30) return "Niedrig";
  return "Sehr niedrig";
}

export function getScoreColor(score: number): string {
  if (score >= 4) return "text-red-500";
  if (score >= 2) return "text-orange-500";
  if (score > 0) return "text-yellow-500";
  if (score === 0) return "text-muted-foreground";
  if (score >= -2) return "text-emerald-500";
  return "text-emerald-600";
}

export function getScoreBg(score: number): string {
  if (score >= 4) return "bg-red-500/15";
  if (score >= 2) return "bg-orange-500/15";
  if (score > 0) return "bg-yellow-500/15";
  if (score === 0) return "bg-muted/30";
  if (score >= -2) return "bg-emerald-500/10";
  return "bg-emerald-500/15";
}

export function getGaugeColor(p: number): string {
  if (p >= 70) return "#ef4444";
  if (p >= 50) return "#f97316";
  if (p >= 30) return "#eab308";
  return "#10b981";
}
