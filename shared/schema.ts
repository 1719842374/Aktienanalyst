import { z } from "zod";

// === Request Schema ===
export const analyzeRequestSchema = z.object({
  ticker: z.string().min(1).max(32).toUpperCase(),  // 32 deckt internationale Ticker ab: BAJAJ-AUTO.NS, 600519.SS, 0700.HK, etc.
  useLLM: z.boolean().optional().default(false), // KI-Katalysatoren toggle
  force: z.boolean().optional().default(false), // Bypass cache and re-fetch live data
  // Auftrag 09.08.2026 ("Peer-Liste nachziehbar"): manuelle Peer-Ergaenzung/
  // -Entfernung, additiv zur Auto-Peer-Auswahl. Kein Ticker-Hardcode im Core --
  // der User kann JEDEN fehlenden Wettbewerber nachziehen (z.B. LLY bei NVO),
  // nicht nur einen vordefinierten. Leere/fehlende Listen -> unveraendertes
  // Verhalten (reine Auto-Auswahl wie bisher).
  peerOverrides: z.object({
    add: z.array(z.string().min(1).max(20)).max(8).optional().default([]),
    remove: z.array(z.string().min(1).max(20)).max(8).optional().default([]),
  }).optional(),
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
  segmentGrowth: number | null; // Segment YoY growth % — null = keine Vorjahreszahl (NIEMALS 0 als Platzhalter)
  segmentShare: number; // % of total company revenue
  tamSize: number | null; // TAM for this segment in $B — null wenn unmatched (A1 Qualitaetstor)
  tamLabel: string | null; // e.g. "Global Cloud Computing" — null wenn unmatched
  tamCAGR: number | null; // Industry CAGR for this segment — null wenn unmatched
  marketShare: number | null; // Segment revenue / TAM % — null wenn unmatched
  outperforming: boolean | null; // Segment growing faster than its TAM CAGR? null wenn unmatched/keine Wachstumsrate
  /** A1: true nur wenn ein TAM_ALIASES-Eintrag den Segmentnamen getroffen hat (kein desc-Fallback mehr). */
  matched?: boolean;
  /** A1: Segment-Marktanteil > TAM_SHARE_WARN (25%) — Hinweis-Badge, keine harte Fehlermeldung. */
  shareWarning?: boolean;
}

export interface TAMAnalysis {
  tamTotal: number | null; // Weighted total TAM in $B — null wenn quality==='unreliable' oder coveragePct<=0
  tamLabel: string; // Primary TAM label
  tamCAGR: number | null; // Weighted average industry CAGR % — null wenn tamTotal null ist
  companyGrowth: number; // Company revenue growth %
  companyRevenue: number; // Company revenue in $B
  marketShare: number | null; // Company share of weighted TAM in % — null wenn tamTotal null ist
  tamSource: string; // Source description
  outperforming: boolean | null; // Company growing faster than weighted TAM CAGR? null wenn tamCAGR null ist
  segments?: TAMSegment[]; // Per-segment TAM breakdown (if revenue segments available)
  /** Umsatzgewichtetes Wachstum aus den ECHTEN Segment-YoY-Raten. null = keine Segment-Vorjahresdaten. */
  segmentWeightedGrowth?: number | null;
  /** Anteil des Umsatzes (%), fuer den eine echte Segment-Wachstumsrate vorliegt (Abdeckung der Gewichtung). */
  segmentGrowthCoveragePct?: number;
  /** A1 Qualitaetstor (assessTamQuality): 'ok' | 'weak' | 'unreliable'. Fehlt bei aelteren Cache-Eintraegen. */
  quality?: 'ok' | 'weak' | 'unreliable';
  /** A1: Anzahl unterschiedlicher TAM-Labels unter den gematchten Segmenten. */
  distinctLabels?: number;
  /** A1: Umsatzanteil (%) mit matched===true — Basis fuer das Qualitaetstor. */
  coveragePct?: number;
  /** A1: mindestens ein Segment hat marketShare > TAM_SHARE_WARN (25%). */
  shareWarning?: boolean;
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
  /** Return on Invested Capital in % (FMP returnOnInvestedCapital × 100). null = nicht berechenbar. */
  roic?: number | null;
  /** Fiskaljahr der ROIC-Zahl, z.B. "2025" — zeigt Datenaktualität in der UI. */
  roicFiscalYear?: string | null;
  /** Auftrag 05.08.2026: arithmetischer Durchschnitt der ROIC-Werte der letzten
   *  bis zu 5 Geschaeftsjahre (nur Jahre mit echtem numerischem Wert, negative
   *  Werte/0 zaehlen normal). null, wenn < 3 Jahre verfuegbar — UI zeigt dann
   *  "n/a", niemals 0 %. */
  roic5Y?: number | null;
  /** Anzahl der Jahre, die tatsaechlich in roic5Y eingeflossen sind (0, 3, 4 oder 5) — fuer den UI-Tooltip. */
  roic5YYearsUsed?: number;
}

export type WarningSeverity = 'critical' | 'warning' | 'info';

export interface ConsistencyWarning {
  id: string; // e.g. 'dcf-implausible', 'margin-mismatch'
  severity: WarningSeverity;
  title: string;
  detail: string;
}

export interface EpsDataPoint {
  year: number; // e.g. 2020, 2021, ...
  eps: number;
  isEstimate: boolean; // true for forward estimates
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
    /** Peer-Durchschnitt des ROIC (FY), in %. Additiv — war zuvor bereits in
     *  news-peers.ts befuellt, aber nicht im Schema deklariert. */
    roic?: number | null;
    /** Peer-Durchschnitt des ROIC 5Y, in %. Auftrag 05.08.2026. */
    roic5Y?: number | null;
  };
  sectorMedian: { // Damodaran sector medians
    pe: number | null;
    peg: number | null;
    ps: number | null;
    pb: number | null;
    epsGrowth: number | null;
    sectorName: string;
  };
  // EPS history for chart
  epsHistory?: EpsDataPoint[]; // Subject's historical + estimated EPS
  peerAvgEpsHistory?: EpsDataPoint[]; // Peer average EPS (where available)
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

export interface CatalystDeepDive {
  unternehmenskontext: string;   // Warum dieser Katalysator für dieses Unternehmen spezifisch relevant ist
  posHerleitung: string;         // Begründung der PoS% - unternehmensspezifische Faktoren
  bewertungsauswirkung: string;  // Konkrete Auswirkung auf Umsatz, Margen, FCF oder DCF
  marktumfeld: string;           // Externe Treiber: Wettbewerb, Regulation, Macro-Kontext
  risiken: string;               // Konkrete Risiken die diesen Katalysator verhindern könnten
  unterschaetzt: boolean;        // Ist Brutto-Upside unterschaetzt gegenueber Konsensus?
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
  deepDive?: CatalystDeepDive; // LLM-generated per-catalyst deep dive (Section 15)
  // News-Sentiment linkage
  newsSentiment?: 'bullish' | 'bearish' | 'neutral' | 'mixed'; // Aggregated news sentiment for this catalyst
  newsCount?: number; // Number of news items linked to this catalyst
  tags?: string[]; // Optional tags e.g. ["gov-spending", "capex-tailwind"]
  posAdjustment?: number; // PoS adjustment from news sentiment (e.g. +5 or -5)
  posOriginal?: number; // Original PoS before news adjustment

  // WORK_REVERSE_DCF_BRIDGE.md Teil 3 — additive Fiscal-/Program-Felder.
  // Generischer string statt Fix-Enum (Spezifikation: "keine Fixnamen-Enum-Beschraenkung noetig").
  type?: 'fiscal' | 'capacity' | string;
  confidence?: 'low' | 'medium' | 'high';
  source?: { url: string; publishedAt: string; snippet: string };
  status?: 'announced' | 'legislated' | 'funded' | 'deploying' | 'expired';
  probability?: number; // 0-1
  addressableVolume?: number; // USD, adressierbares Programmvolumen (falls quantifizierbar)
  epsImpact?: number; // $ pro Aktie, analog server/regulatory.ts Muster
  startYear?: number;
  endYear?: number;

  // Auftrag 08.08.2026 ("Live-These + Thesis-Score + Katalysatoren"): explizites
  // Flag statt Heuristik (z.B. llmModelUsed leer) -- eindeutig fuer UI, These-
  // Generierung und Baustein-E-Deckelung. true = Template-/Fallback-Katalysator
  // (generateCatalysts()), false = firmenspezifischer LLM-Output
  // (generateCatalystsAndMatchNews()).
  generic?: boolean;
}

export interface Risk {
  name: string;
  category: "Binary" | "Gradual" | "Correlated";
  ew: number; // Expected probability %
  impact: number; // Impact %
  expectedDamage: number; // Expected damage % (calculated)
  explanation?: RiskExplanation; // Optional LLM-generated deep-dive
}

export interface RiskExplanation {
  kontext: string;               // 1. Risiko-Kontext: Warum relevant?
  gewichtungsBegrundung: string; // 2. Begruendung EW% & Impact%
  bewertungsAuswirkung: string;  // 3. Auswirkungen auf Bewertung (DCF, Margen, FCF)
  mitigation: string;            // 4. Gegenmassnahmen / Mitigation
  gesamtEinschaetzung: string;   // 5. Gesamteinschaetzung Kritikalitaet
  unterschaetzt: boolean;        // Ist das Risiko im Expected Damage unterschaetzt?
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
  sector?: string;
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
  growth?: number | null; // YoY growth % — null = keine Vorjahreszahl berichtet (NIEMALS 0 als Platzhalter)
  prevRevenue?: number;   // Umsatz der Vergleichsperiode (Nachvollziehbarkeit der YoY-Rate)
  // NEW (Segment-Fallback-Pipeline, 2026-08): provenance metadata so the UI can
  // show "Quelle: FMP" vs. "Quelle: 10-K FY2025" instead of a silent number.
  // Optional + additive — never renames/removes the fields above.
  source?: "fmp" | "sec" | "curated"; // where this row's numbers came from
  fiscalYear?: string;     // e.g. "FY2025" or "2025-06-30" — reporting period label
  // Management-Score-Fix (05.08.2026): Umsatzanteil (%) dieses Segments in der
  // VORPERIODE — noetig fuer ΔSegment-Anteil (S_Segment.S_Share). undefined,
  // wenn keine Vorperiode gefunden wurde (kein Fake-0).
  prevPercentage?: number;
  yoyChangePercent?: number; // YoY revenue change in % (distinct from `growth`, which some
                              // older callers already populate with a slightly different basis)
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
  peg?: number | null;
  lynchClass?: string;      // 'slow_grower' | 'stalwart' | 'fast_grower' | 'cyclical' | 'turnaround' | 'asset_play'
  lynchPEGBasis?: string;   // Erklärung welche Methode verwendet wurde
  evEbitda: number;
  beta5Y: number;
  fcfTTM: number;
  fcfMargin: number;
  /** A3 (WORK_SECTION4_DATA_BUGS.md §4): false wenn weder freeCashFlow noch
   * OCF-|capex| in irgendeiner der bis zu 3 Cashflow-Perioden einen
   * plausiblen (!=0) Wert ergaben -- UI kann dann n/a statt $0 anzeigen. */
  fcfAvailable?: boolean;
  /** Datenaktualität Section 1: nächster bestätigter FMP-Earnings-Termin. */
  nextEarningsDate?: string | null;
  nextEarningsTime?: string;
  nextEarningsIsEstimate?: boolean;
  lastReportedQuarter?: string | null;
  /** FCF-Yield nach derselben FCF-TTM/Market-Cap-Definition wie Section 1. */
  fcfYield?: number | null;
  fcfYieldYoyPp?: number | null;
  fcfYieldYoyAvailable?: boolean;
  fcfMarginYoyPp?: number | null;
  fcfMarginYoyAvailable?: boolean;
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
  sectorAvgForwardPE: number;
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
      capexWarning?: string;
    };
    health: 'Excellent' | 'Good' | 'Moderate' | 'Weak' | 'Critical';
    healthReasons: string[];
  };

  // TAM Analysis
  tamAnalysis?: TAMAnalysis;

  /** Scoring-Pipeline-Ergebnis (WORK_SCORING_VORLAGE.md §0 + §17) — serverseitig
   * aus echten Analyse-Daten berechnet (server/scoring-integration.ts). Optional:
   * fehlt bei alten Cache-Einträgen, die vor der Verdrahtung erzeugt wurden. */
  scoring?: {
    finalScore: number;
    rawScore: number;
    qualityScore: number;
    trendMultiplier: number;
    cappedBy: string | null;
    gates: Array<{ id: string; active: boolean; cap: number; severity: string; rationale: string }>;
    gateInputs: {
      impliedGrowthPercent: number | null;
      realizedGrowth8QPercent: number | null;
      realizedGrowthMethod: string;
      realizedGrowthQuartersUsed: number;
      marginDeltaYoYPp: number | null;
      relativeGrowthDeltaYoYPp: number | null;
      inventoryDaysDeltaYoYPct: number | null;
    };
    fiscal: { qualifies: boolean; evPercent: number; reasons: string[] };
    conflictTexts: string[];
  };

  /** Sprint D3 (WORK_REVERSE_DCF_BRIDGE.md Teil 3, §3.2–§3.6) — additiver,
   * separater Fiscal-DCF-Overlay auf den FORWARD-FCF-Pfad. Befuellt NUR wenn
   * ein qualifizierendes Fiskalprogramm (status ∈ {legislated,funded,deploying},
   * confidence=high, isProgramActive) UND eine belastbare, dokumentierte
   * companyShare/volumeUsdBn-Quelle vorliegen — sonst bleibt dieses Feld
   * undefined (KEIN geratener Wert, Zahlen-Prinzip). Beeinflusst NIEMALS
   * invDcfValue/crvValue/dcfFairValue/impliedGStar (§3.4 "Reverse-DCF bleibt
   * clean") — rein additive UI-Zusatzinfo (FV base | FV fiscal | g* | Gate). */
  fiscalOverlay?: {
    fvBase: number;
    fvFiscal: number;
    programIds: string[];
    totalDeltaFcfYear1: number;
    gateSoftened: boolean;
  };

  // For investment thesis
  moatRating: string;
  governmentExposure: number;
  beta?: number; // 5Y beta estimate
  growthThesis: string;
  growthThesisFingerprint?: string; // fingerprint of inputs used — used for stale-thesis detection
  growthThesisGeneratedAt?: string; // ISO-Timestamp: wann die aktuelle These generiert (oder aus Fingerprint-Cache uebernommen) wurde
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

  /** Sprint B1 (WORK_DATA_PROVIDERS.md §5, additiv): woher die geladene
   *  Kurshistorie stammt. 'fmp' = volle Historie von FMP allein.
   *  'fmp+yahoo' / 'fmp+stooq' = FMP-Basis + Alt-Provider hat Luecken
   *  gefuellt/nach links verlaengert (z.B. weil der FMP-Plan nur 5 Jahre
   *  liefert, der UI-Timeframe aber 10Y anfordert). Optional: fehlt bei
   *  alten Cache-Eintraegen vor diesem Ticket. */
  historyDataSource?: 'fmp' | 'fmp+yahoo' | 'fmp+stooq' | 'fmp+alt';

  /** true, wenn selbst nach Alt-Provider-Fallback nicht genug Historie fuer
   *  den urspruenglich gewuenschten Zeitraum vorhanden war (ehrliche
   *  Kennzeichnung statt Kuenstlich-Verlaengern/Interpolieren, siehe Ticket-
   *  Regel "Zahlen-Prinzip"). Optional, additiv. */
  historyTruncated?: boolean;

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
  // Auftrag 09.08.2026 ("Peer-Liste nachziehbar"): spiegelt die tatsaechlich
  // angewendeten User-Overrides zurueck, damit die UI den Add/Remove-Zustand
  // korrekt vorbelegen kann (z.B. nach einem Seiten-Reload mit demselben Request).
  activePeerOverrides?: { add: string[]; remove: string[] };
  llmMode?: boolean; // Whether LLM-powered catalysts were used
  consistencyWarnings?: ConsistencyWarning[];
  dataTimestamp?: string; // ISO date when data was fetched
  _cached?: boolean; // True if served from server cache
  _cacheAge?: number; // Cache age in minutes
  _cacheDate?: string; // ISO date when data was cached
  _cachedAt?: string; // ISO timestamp when this analysis was originally computed (set on save)
  _useLLM?: boolean; // LLM mode of the cached entry
  // NEW: Geographic segments (Umsatzanteil nach Regionen)
  geoSegments?: RevenueSegment[];

  // NEW (Segment-Fallback-Pipeline, 2026-08): explains WHERE revenueSegments came
  // from and what to render when it's empty. Additive-only, see server/sec-segments.ts
  // and server/analyze-route.ts for the fallback chain (FMP -> SEC EDGAR 10-K/20-F -> none).
  revenueSegmentsSource?: "fmp" | "sec" | "curated" | "none";
  // Human-readable message shown in the UI ONLY when revenueSegments is empty
  // (e.g. "Segmentreporting nicht in den letzten 10-K/20-F enthalten" or
  // "Unternehmen berichtet nur geografisch"). Never a generic "N/A".
  revenueSegmentsMessage?: string;
}

// ─── NEW (WORK_PORTFOLIO.md — Virtuelles Portfolio, additive-only) ─────────────
// Eigenstaendige, komplett neue Interfaces fuer das Virtuelle-Portfolio-Feature.
// Beruehren KEINE bestehenden Typen (Catalyst, Risk, StockAnalysis etc.).
// Siehe WORK_PORTFOLIO.md Kapitel A.2 fuer das normative Datenmodell.

/** Ein Kandidat fuer die virtuelle Buy-Liste / das Portfolio (WORK_PORTFOLIO.md §A.2/§A.3). */
export interface PortfolioCandidate {
  ticker: string;
  score: number; // 0-100, Scoring-Ergebnis
  conviction: "high" | "medium" | "low";
  mu?: number; // erwartete annualisierte Rendite (Dezimal, z.B. 0.12 = 12%)
  beta?: number;
  price: number;
  status: "active" | "excluded" | "pending";
  source: "researcher" | "manual" | "both";
}

/** Container fuer das virtuelle Portfolio inkl. Benchmark/rf/Kapitalbasis (WORK_PORTFOLIO.md §A.2). */
export interface VirtualPortfolio {
  candidates: PortfolioCandidate[];
  benchmark: string; // z.B. "SPY", "^GSPC"
  rf: number; // risikofreier Zins, Dezimal p.a.
  capitalBase: number; // Gesamtkapital K in EUR/USD
}

/** Ergebnis eines Basket-Gewichtungslaufs (Modus A/B/C) inkl. Sharpe-Vergleich (WORK_PORTFOLIO.md Kapitel B/C). */
export interface BasketResult {
  mode: "A" | "B" | "C" | "kelly-only";
  rows: Array<{
    ticker: string;
    weight: number;
    amount: number;
    sharpeSingle: number | null;
  }>;
  sharpePortfolio: number | null;
  sharpeEqualWeight: number | null;
}

/** Kelly-Sizing-Ergebnis fuer EINEN Einzeltitel bezogen auf Gesamtkapital K (WORK_PORTFOLIO.md Kapitel D). */
export interface KellySizing {
  fStar: number;
  fHalf: number;
  fCapped: number;
  amount: number;
}

/**
 * Ein Eintrag der lokalen Watchlist für das Watchlist-Portfolio (P2) bzw.
 * Researcher-Portfolio (P3). Eigenständig und additiv: P1 verwendet weiterhin
 * ausschließlich PortfolioPosition aus client/src/lib/portfolio/positions.ts.
 */
export interface WatchlistEntry {
  ticker: string;
  name?: string;
  addedAt: string; // ISO
  source: "manual" | "researcher" | "screener" | "dashboard" | "btc";
  score?: number | null;
  /** Nur für P3-/Researcher-Einträge relevant. */
  region?: "US" | "EU" | "ASIA" | "MIXED";
}
