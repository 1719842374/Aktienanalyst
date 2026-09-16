export type Ampel = "green" | "yellow" | "red" | "gray";
export type TechLayer = 1 | 2 | 3 | 4 | 5;
export type TickerRole = "leader" | "laggard" | "proxy";

export interface ThesisTicker {
  symbol: string;
  role: TickerRole;
}

export interface CurvePoint {
  t: string;
  pricedInPct: number;
  attention: number;
}

export interface ThesisLabResult {
  id: string;
  thesis: string;
  counterThesis: string;
  techLayer: TechLayer;
  revolutionScore: 0 | 1 | 2 | 3;
  pricedInPct: number;
  infoCurve: Ampel;
  pos: number;
  grossUpsidePct: number;
  netUpsidePct: number;
  gbPct: number;
  valueChainStage: string;
  industryKey: string;
  tickers: ThesisTicker[];
  cyclePhaseFit: number;
  uncertaintyVsRisk: "uncertainty" | "known_cycle" | "mixed";
  dataQuality: "high" | "medium" | "low";
  curvePoints: CurvePoint[];
  sources: string[];
  asOf: string;
  llmUsed: boolean;
}

export interface ThesisFeedResponse {
  asOf: string;
  count: number;
  items: ThesisLabResult[];
}

export const AMPEL_LABEL: Record<Ampel, string> = {
  green: "Vor der Kurve",
  yellow: "Neben der Kurve",
  red: "Hinter der Kurve",
  gray: "Datenlücke",
};
