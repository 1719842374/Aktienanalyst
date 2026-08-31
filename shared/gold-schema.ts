import { z } from "zod";

// === Gold Analysis Types ===

export interface GoldIndicator {
  name: string;
  weight: number;
  score: -1 | 0 | 1;
  value: string;
  details: string;
  thresholds: { bullish: string; neutral: string; bearish: string };
}

export interface GoldFairValue {
  cpiToday: number;
  fv1980: number;
  fv2011: number;
  fvBasis: number;
  premium: number;
  premiumReason: string;
  fvAdj: number;
  support1: number;
  support2: number;
  resistance1: number;
  resistance2: number;
}

export interface MonteCarloResult {
  horizon: string;
  days: number;
  mu: number;
  sigma: number;
  iterations: number;
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
  distribution: { bin: number; count: number }[];
  scenarios?: {
    bullish: number;   // % > 1.10*S0
    neutral: number;   // % 0.90-1.10*S0
    bearish: number;   // % < 0.90*S0
  };
}

export interface GoldCycleAssessment {
  historicalCycles: string;
  currentPhase: string;
  drivers: string[];
  outlook: string;
}

export interface GoldPricePoint {
  date: string;
  close: number;
  ma200?: number;
  /** Real10Y (FRED DFII10, %) am selben Datum — für den Dual-Axis-Chart aus
   * WORK_TEIL7_SCORING.md §7.8.3 ("Gold links vs Real10Y rechts"). Optional,
   * da FRED nur Handelstage liefert und Wochenenden/Feiertage lücken können. */
  real10y?: number;
}

// Punkt 2 (HOCH-Ticket 05.08.2026): gold-realyield-model.ts an gold-routes.ts
// anbinden. Eigenstaendiges Gate-Shape statt Import von server/scoring-gates.ts
// Gate — gold-schema.ts wird auch vom Client importiert (GoldDashboard.tsx,
// goldFallbackData.ts), Server-Module sollen dort nicht reinragen. Strukturell
// identisch zum generischen Gate-Interface in scoring-gates.ts.
export interface GoldModelGate {
  id: string;
  active: boolean;
  cap: number;
  severity: "warn" | "hard";
  rationale: string;
}

export interface GoldRealYieldFairValueResult {
  windowUsed: number;
  alpha: number;
  beta: number;
  correlation: number;
  fairValue: number;
  actualPrice: number;
  premiumPct: number;
  withinFairBand: boolean;
  decoupled: boolean;
}

export interface GoldRealYieldInverseScoreResult {
  windowUsed: number;
  correlation: number | null;
  score: -1 | 0 | 1;
  details: string;
}

export interface GoldRateScenarioPoint {
  shockBp: number;
  shockedReal10Y: number;
  impliedGoldPrice: number;
  impliedChangePct: number;
}

export interface GoldRegimeZoneResult {
  regime: "stress" | "tailwind" | "neutral";
  real10YTrendPp: number;
  rationale: string;
}

/**
 * Punkt 2 (HOCH-Ticket 05.08.2026): additives Response-Feld fuer das neue
 * Real-Yield-Gold-Modell (gold-realyield-model.ts, WORK_TEIL7_SCORING.md
 * §7.8.8). Optional, da FRED-Datenausfall (Real10Y nicht abrufbar) dazu
 * fuehren kann, dass kein Modell-Ergebnis vorliegt — dann bleibt dieses Feld
 * weg statt einen Fake-Default zu zeigen; das alte 1980/2011-Fair-Value-
 * Modell (GoldFairValue oben) bleibt in jedem Fall als Fallback erhalten.
 */
export interface GoldRealYieldModelSummary {
  fairValue: GoldRealYieldFairValueResult | null;
  inverseScore: GoldRealYieldInverseScoreResult;
  scenarios: GoldRateScenarioPoint[];
  regime: GoldRegimeZoneResult | null;
  gates: GoldModelGate[];
  generatedAt: string;
}

// Sprint D5: additive Typen für die optionale 3-Faktor-Vergleichslinie (WORK_TEIL7_SCORING.md
// §6.6). Eigenständig neben GoldRealYieldModelSummary — greift NICHT in dessen Struktur ein.
export interface GoldMultiFactorFairValueResultShape {
  windowUsed: number;
  alpha: number;
  beta1: number;
  beta2: number;
  beta3: number;
  fairValue: number;
  actualPrice: number;
  premiumPct: number;
  signsValid: boolean;
}

export interface GoldMultiFactorModelSummary {
  fairValue: GoldMultiFactorFairValueResultShape | null;
  gate: GoldModelGate;
  generatedAt: string;
}

export interface GoldAnalysis {
  // Section 1: Status
  timestamp: string;
  analysisDate: string;

  // Section 2: Price
  spotPrice: number;
  priceTimestamp: string;
  currency: string;
  changePercent: number;
  yearHigh: number;
  yearLow: number;
  ma200: number;
  deviationFromMA200: number;

  // Section 3: Plausibility checks
  plausibilityChecks: string[];

  // Section 4: Indicators + GIS
  indicators: GoldIndicator[];
  gis: number;
  gisCalculation: string;

  // Section 5: Fair Value
  fairValue: GoldFairValue;

  // Section 6: Monte Carlo
  monteCarlo3M: MonteCarloResult;
  monteCarlo6M: MonteCarloResult;
  monteCarlo12M: MonteCarloResult;

  // Section 7: Probabilistic price estimate
  priceEstimate: {
    threeMonth: { low: number; mid: number; high: number };
    sixMonth: { low: number; mid: number; high: number };
    twelveMonth: { low: number; mid: number; high: number };
  };

  // Section 8: Cycle assessment
  cycleAssessment: GoldCycleAssessment;

  // Section 9: Summary table
  summaryTable: {
    metric: string;
    value: string;
  }[];

  // Section 10: Final assessment
  finalAssessment: string;
  sentiment: "Bullish" | "Neutral" | "Bearish";

  // Section 11: Sources
  sources: string[];

  // Historical price data for chart
  historicalPrices: GoldPricePoint[];

  // RSI
  rsi14: number;

  // Punkt 2 (HOCH-Ticket 05.08.2026): neues Real-Yield-Modell additiv, altes
  // 1980/2011-Modell (fairValue oben) bleibt als Fallback bestehen. null/
  // undefined, wenn FRED Real10Y nicht abrufbar war (kein Fake-Default).
  realYieldModel?: GoldRealYieldModelSummary | null;

  // Sprint D5 (WORK_TEIL7_SCORING.md §6.6): optionale 3-Faktor-Vergleichslinie NEBEN
  // realYieldModel (1-Faktor bleibt Default-Anzeige). null/undefined bei fehlenden
  // WALCL/DXY-Daten oder < 30 vollständigen Datenpunkten (kein Fake-Default).
  multiFactorModel?: GoldMultiFactorModelSummary | null;
}
