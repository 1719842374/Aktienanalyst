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

export interface RecessionAnalysis {
  date: string;
  indicators: IndicatorResult[];
  subgroups: SubgroupResult[];
  nyFedValue: number | null;
  googleTrendsAvailable: boolean;
  topDrivers: string[];
  interpretation: string;
  fazit?: { summary: string; riskLevel: string; sections: FazitSection[] };
  sources: { name: string; url: string }[];
}

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
