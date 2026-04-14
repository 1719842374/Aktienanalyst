import { z } from "zod";

// === Request Schema ===
export const analyzeRequestSchema = z.object({
  ticker: z.string().min(1).max(10).toUpperCase(),
});

export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

// === Response Types ===
export interface AnalystPT {
  median: number;
  high: number;
  low: number;
  count: number;
}

export interface Ratings {
  buy: number;
  hold: number;
  sell: number;
}

export interface HistoricalPrice {
  date: string;
  close: number;
}

export interface TAMSegment {
  segmentName: string; // e.g. "Intelligent Cloud"
  segmentRevenue: number; // Segment revenue in $B
  segmentGrowth: number; // Segment YoY growth %
  segmentShare: number; // % of total company revenue
  tamSize: number; // TAM for this segment in $B
  tamLabel: string; // e.g. "Global Cloud Computing"
  tamCAGR: number; // Industry CAGR for this segment
  marketShare: number; // Segment revenue / TAM %
  outperforming: boolean; // Segment growing faster than its TAM CAGR?
}

export interface TAMAnalysis {
  tamTotal: number; // Weighted total TAM in $B
  tamLabel: string; // Primary TAM label
  tamCAGR: number; // Weighted average industry CAGR %
  companyGrowth: number; // Company revenue growth %
  companyRevenue: number; // Company revenue in $B
  marketShare: number; // Company share of weighted TAM in %
  tamSource: string; // Source description
  outperforming: boolean; // Company growing faster than weighted TAM CAGR?
  segments?: TAMSegment[]; // Per-segment TAM breakdown (if revenue segments available)
}

export interface PeerCompany {
  ticker: string;
  name: string;
  pe: number | null;
  peg: number | null;
  ps: number | null; // Price/Sales
  pb: number | null; // Price/Book
  epsGrowth1Y: number | null; // EPS Growth 1Y %
  epsGrowth5Y: number | null; // EPS Growth 5Y CAGR %
  marketCap: number | null;
  revenueGrowth: number | null;
}

export interface PeerComparison {
  subject: PeerCompany; // The analyzed stock itself
  peers: PeerCompany[]; // 4-6 competitor peers
  peerAvg: {
    pe: number | null;
    peg: number | null;
    ps: number | null;
    pb: number | null;
    epsGrowth1Y: number | null;
    epsGrowth5Y: number | null;
  };
  sectorMedian: { // Damodaran sector medians
    pe: number | null;
    peg: number | null;
    ps: number | null;
    pb: number | null;
    epsGrowth: number | null;
    sectorName: string;
  };
}

export interface NewsItem {
  title: string;
  source: string;
  pubDate: string; // ISO date string
  url: string;
  relativeTime: string; // e.g. "vor 2 Std.", "vor 3 Tagen"
  sentiment?: 'bullish' | 'bearish' | 'neutral'; // LLM-scored
  sentimentScore?: number; // -1.0 (very bearish) to +1.0 (very bullish)
  matchedCatalyst?: string; // Name of the catalyst this news relates to (K1-K5)
  matchedCatalystIdx?: number; // Index of matched catalyst (0-4)
}

export interface Catalyst {
  name: string;
  timeline: string;
  pos: number; // Probability of Success %
  bruttoUpside: number; // Gross upside %
  einpreisungsgrad: number; // Pricing-in degree %
  nettoUpside: number; // Net upside (calculated)
  gb: number; // Weighted contribution (calculated)
  context?: string; // Business-model-specific context text explaining what needs to happen
  // News-Sentiment linkage
  newsSentiment?: 'bullish' | 'bearish' | 'neutral' | 'mixed'; // Aggregated news sentiment for this catalyst
  newsCount?: number; // Number of news items linked to this catalyst
  posAdjustment?: number; // PoS adjustment from news sentiment (e.g. +5 or -5)
  posOriginal?: number; // Original PoS before news adjustment
}

export interface Risk {
  name: string;
  category: "Binary" | "Gradual" | "Correlated";
  ew: number; // Expected probability %
  impact: number; // Impact %
  expectedDamage: number; // Expected damage % (calculated)
}

export interface DCFScenario {
  name: string;
  wacc: number;
  g1: number;
  g2: number;
  terminalG: number;
  fcfBase: number;
  haircut: number;
  result: number;
}

export interface SectorProfile {
  cycleClass: string;
  politicalCycle: string;
  waccScenarios: { kons: number; avg: number; opt: number };
  growthAssumptions: { g1: number; g2: number; terminal: number };
  macroSensitivity: {
    interestUp: { wacc: string; dcf: string };
    interestDown: { wacc: string; dcf: string };
    fiscalUp: string;
    fiscalDown: string;
    geoUp: string;
    geoDown: string;
  };
  regulatoryNotes: string;
  geopoliticalRisks?: {
    event: string;
    impact: string;
    exposure: "Hoch" | "Mittel" | "Niedrig";
  }[];
}

// === NEW: OHLCV and Technical Analysis Types ===
export interface OHLCVPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MADataPoint {
  date: string;
  close: number;
  ma200?: number;
  ma100?: number;
  ma50?: number;
  ma20?: number;
  ema26?: number;
  ema12?: number;
  ema9?: number;
}

export interface MACDDataPoint {
  date: string;
  macd?: number;
  signal?: number;
  histogram?: number;
}

export interface TradingSignal {
  date: string;
  type: "buy" | "sell";
  reason: string;
  price: number;
}

export interface TechnicalStatus {
  priceAboveMA200: boolean;
  ma50AboveMA200: boolean;
  macdAboveZero: boolean;
  macdRising: boolean;
  buySignal: boolean;
  ma200Value?: number;
  ma50Value?: number;
  macdValue?: number;
  signalValue?: number;
}

export interface TechnicalIndicators {
  maData: MADataPoint[];
  macdData: MACDDataPoint[];
  signals: TradingSignal[];
  currentStatus: TechnicalStatus;
}

export interface PorterForce {
  name: string;
  rating: "Low" | "Medium" | "High";
  score: number; // 1-5
  reasoning: string;
}

export interface MoatAssessment {
  overallRating: string; // Wide, Narrow, None
  moatSources: string[];
  porterForces: PorterForce[];
  businessModelStrength: string;
  sustainabilityRating: string; // 1-5 stars as text
}

// === Currency Conversion Info ===
export interface CurrencyInfo {
  reportedCurrency: string; // e.g. "EUR", "CNY", "GBP"
  tradingCurrency: string; // usually "USD" for US-listed ADRs
  fxRate: number; // e.g. 1.08 for EUR→USD
  fxPair: string; // e.g. "EURUSD"
  converted: boolean; // true if financials were converted
  note: string; // explanation for user
}

// === PESTEL Analysis ===
export interface PESTELFactorItem {
  name: string;
  impact: "Positiv" | "Neutral" | "Negativ"; // Generic macro impact
  stockCorrelation: "Positiv" | "Neutral" | "Negativ"; // Stock-specific: e.g. defense stock BENEFITS from conflict
  stockCorrelationNote: string; // Short explanation of WHY this is positive/negative for THIS stock
  severity: "Hoch" | "Mittel" | "Niedrig";
  description: string;
}

export interface PESTELFactor {
  category: "Political" | "Economic" | "Social" | "Technological" | "Environmental" | "Legal";
  categoryDE: string; // German label
  icon: string;
  factors: PESTELFactorItem[];
  regionalOutlook: string; // Macro outlook for this category
  exposureRating: "Hoch" | "Mittel" | "Niedrig";
}

export interface PESTELAnalysis {
  factors: PESTELFactor[];
  overallExposure: "Hoch" | "Mittel" | "Niedrig";
  macroSummary: string; // Short macro outlook summary
  geopoliticalScore: number; // 1-10 exposure score
  interestRateOutlook: string; // Zinsen-Ausblick
  capitalCostImpact: string; // Kapitalkosten-Auswirkung
}

export interface CatalystReasoning {
  whyInteresting: string;
  keyDrivers: string[];
  timingRationale: string;
}

// === Revenue Segments ===
export interface RevenueSegment {
  name: string;           // Segment name (e.g. "AWS", "Advertising", "Online Stores")
  revenue: number;        // Revenue in reporting currency
  percentage: number;     // Percentage of total revenue
  growth?: number;        // YoY growth % (optional)
}

// === Macro Correlation Section ===
export interface MacroCorrelation {
  name: string;           // e.g. "ISM Manufacturing PMI", "WTI Crude Oil", "S&P 500"
  category: "Index" | "Commodity" | "Macro-Indikator" | "Währung" | "Edelmetall" | "Industriemetall" | "Crypto";
  correlation: "Positiv" | "Neutral" | "Negativ" | "Invers";
  strength: "Stark" | "Moderat" | "Schwach";
  mechanism: string;      // Why this correlation exists for this stock
  currentLevel?: string;  // Current value of the indicator
}

export interface MacroCorrelations {
  correlations: MacroCorrelation[];
  overallMacroSensitivity: "Hoch" | "Mittel" | "Niedrig";
  keyInsight: string;     // One-sentence summary of most important macro relationship
}

export interface StockAnalysis {
  // Section 1: Data & Plausibility
  ticker: string;
  companyName: string;
  exchange: string;
  sector: string;
  industry: string;
  description: string;
  currentPrice: number;
  priceTimestamp: string;
  currency: string;
  marketCap: number;
  sharesOutstanding: number;

  // Analyst data
  analystPT: AnalystPT;
  ratings: Ratings;

  // Earnings
  epsTTM: number;
  epsAdjFY: number;
  epsConsensusNextFY: number;
  epsGrowth5Y: number;

  // Valuation metrics
  peRatio: number;
  forwardPE: number;
  pegRatio: number;
  evEbitda: number;
  beta5Y: number;
  fcfTTM: number;
  fcfMargin: number;
  revenue: number;
  ebitda: number;
  operatingIncome: number;
  netIncome: number;
  totalDebt: number;
  cashEquivalents: number;
  enterpriseValue: number;

  // Historical price data
  historicalPrices: HistoricalPrice[];

  // Sector averages
  sectorAvgPE: number;
  sectorAvgEVEBITDA: number;
  sectorAvgPEG: number;

  // Financial Statements Summary
  financialStatements?: {
    incomeStatement: {
      revenue: number; revenueGrowth: number;
      grossProfit: number; grossMargin: number;
      operatingIncome: number; operatingMargin: number;
      netIncome: number; netMargin: number;
      ebitda: number; ebitdaMargin: number;
      eps: number; epsGrowth: number;
    };
    balanceSheet: {
      totalAssets: number; totalLiabilities: number; totalEquity: number;
      cashEquivalents: number; totalDebt: number; netDebt: number;
      debtToEquity: number; currentRatio: number;
    };
    cashFlow: {
      operatingCashFlow: number; capex: number; fcf: number;
      fcfMargin: number; fcfPerShare: number;
    };
    health: 'Excellent' | 'Good' | 'Moderate' | 'Weak' | 'Critical';
    healthReasons: string[];
  };

  // TAM Analysis
  tamAnalysis?: TAMAnalysis;

  // For investment thesis
  moatRating: string;
  governmentExposure: number;
  growthThesis: string;
  structuralTrends: string[];

  // Cycle info
  cycleClassification: string;
  politicalCycle: string;

  // Sector drawdown for risk calc
  sectorMaxDrawdown: number;

  // Sector profile with WACC, growth, macro sensitivity
  sectorProfile: SectorProfile;

  // Pre-generated catalysts and risks (sector-specific)
  catalysts: Catalyst[];
  risks: Risk[];

  // Government exposure details
  govExposureDetail: string;
  fcfHaircut: number;

  // Historical drawdown reference
  maxDrawdownHistory: string;
  maxDrawdownYear: string;

  // NEW: OHLCV data for interactive chart
  ohlcvData?: OHLCVPoint[];

  // NEW: Technical indicators (MAs, MACD, signals)
  technicalIndicators?: TechnicalIndicators;

  // NEW: Porter's Five Forces & Moat
  moatAssessment?: MoatAssessment;

  // NEW: Catalyst reasoning
  catalystReasoning?: CatalystReasoning;

  // NEW: Currency conversion info (for non-USD reporting companies)
  currencyInfo?: CurrencyInfo;

  // NEW: PESTEL analysis
  pestelAnalysis?: PESTELAnalysis;

  // NEW: Macro correlations (PMI, commodities, indices)
  macroCorrelations?: MacroCorrelations;

  // NEW: Revenue segments (Umsatzanteil nach Produkten/Segmenten)
  revenueSegments?: RevenueSegment[];
  keyProjects?: string[]; // Key projects/expansions from SEC 10-K
  secFilingExcerpts?: string[]; // Key sentences from 10-K about projects
  newsHeadlines?: string[]; // Recent news headlines (legacy)
  // NEW: Structured news items from Google News RSS
  newsItems?: NewsItem[];
  peerComparison?: PeerComparison;
  // NEW: Geographic segments (Umsatzanteil nach Regionen)
  geoSegments?: RevenueSegment[];
}
