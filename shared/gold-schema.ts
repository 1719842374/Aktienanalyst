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
}
