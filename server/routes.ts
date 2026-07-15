import type { Express } from "express";
import { createServer, type Server } from "http";

// FMP-Budget-Tracker: 750 Calls/Tag (Free-Tier), 13 Calls/Analyse = max 57 Analysen/Tag
const FMP_DAILY_LIMIT = 750;
const FMP_WARN_THRESHOLD = 600;
let fmpCallsToday = 0;
let fmpCallsDate = new Date().toDateString();
export function trackFmpCall(count = 1) {
  const today = new Date().toDateString();
  if (today !== fmpCallsDate) { fmpCallsToday = 0; fmpCallsDate = today; }
  fmpCallsToday += count;
  if (fmpCallsToday === FMP_WARN_THRESHOLD)
    console.warn(`[FMP-BUDGET] ⚠ ${fmpCallsToday}/${FMP_DAILY_LIMIT} Calls — noch ${FMP_DAILY_LIMIT-fmpCallsToday} (~${Math.floor((FMP_DAILY_LIMIT-fmpCallsToday)/13)} Analysen)`);
  return fmpCallsToday;
}
export function getFmpBudgetStatus() {
  const today = new Date().toDateString();
  if (today !== fmpCallsDate) { fmpCallsToday = 0; fmpCallsDate = today; }
  const remaining = FMP_DAILY_LIMIT - fmpCallsToday;
  return { ok: remaining > 0, today: fmpCallsToday, limit: FMP_DAILY_LIMIT, remaining, analyses: Math.floor(remaining/13) };
}
import { analyzeRequestSchema, type StockAnalysis, type Catalyst, type Risk, type OHLCVPoint, type TechnicalIndicators, type MoatAssessment, type PorterForce, type CatalystReasoning, type CurrencyInfo, type PESTELAnalysis, type PESTELFactor, type PESTELFactorItem, type MacroCorrelations, type MacroCorrelation, type RevenueSegment } from "../shared/schema";
import { execSync } from "child_process";
import { generateCatalystsAndMatchNews, generateRiskExplanations, generateCatalystDeepDives, CapexTailwindContext, generateGrowthThesis, growthThesisFingerprint, generateCompanySpecificRisks, generatePolicyContext } from "./llm-openrouter";
import {
  isFmpAvailable, fmpBatchQuote, fmpProfile, fmpIncomeStatement, fmpCashFlow,
  fmpBalanceSheet, fmpHistoricalPrices, fmpAnalystEstimates, fmpGrades, fmpPriceTarget,
  fmpSegments, fmpPeers, fmpRatios, fmpKeyMetrics, fmpQuote,
} from "./fmp";

// Sleep helper
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Cache LLM-mode compatibility check.
function cacheLLMModeMatches(cachedUseLLM: boolean | undefined | null, requestedUseLLM: boolean): boolean {
  if (cachedUseLLM === undefined || cachedUseLLM === null) return true;
  return cachedUseLLM === requestedUseLLM;
}

// === FMP Fallback Data Fetcher ===
// Fetches all critical data from FMP in parallel — the primary market-data path.
async function getFmpFallbackData(ticker: string): Promise<{
  quote: any;
  profile: any;
  financials: { income: any[]; cashflow: any[]; balanceSheet: any[]; };
  analyst: { priceTarget: any; grades: any[]; estimates: any[]; };
  ohlcv: any[];
  segments: any[];
  peers: any[];
  ratios: any[];
  source: 'fmp';
} | null> {
  if (!isFmpAvailable()) {
    console.warn(`[FMP-FALLBACK] FMP_API_KEY not set — cannot use FMP fallback for ${ticker}`);
    return null;
  }
  console.log(`[FMP-FALLBACK] Fetching data from FMP for ${ticker}...`);
  const t0 = Date.now();
  try {
    const settledAll = await Promise.allSettled([
      fmpBatchQuote([ticker]),
      fmpProfile(ticker),
      fmpIncomeStatement(ticker, 3),
      fmpCashFlow(ticker, 3),
      fmpBalanceSheet(ticker, 1),
      fmpPriceTarget(ticker),
      fmpGrades(ticker, 20),
      fmpAnalystEstimates(ticker, 3),
      fmpHistoricalPrices(ticker,
        new Date(Date.now() - 2 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        new Date().toISOString().split('T')[0]
      ),
      fmpSegments(ticker),
      fmpPeers(ticker),
      fmpRatios(ticker, 3),
      fmpKeyMetrics(ticker, 3),
    ]);
    const get = (res: PromiseSettledResult<any>) =>
      res.status === 'fulfilled' ? res.value : null;
    const [
      quoteRes, profileRes, incomeRes, cashflowRes, balanceSheetRes,
      priceTargetRes, gradesRes, estimatesRes, ohlcvRes,
      segmentsRes, peersRes, ratiosRes, keyMetricsRes
    ] = settledAll;
    const quoteData = get(quoteRes);
    const quote = Array.isArray(quoteData) ? quoteData[0] : quoteData;
    if (!quote?.price) {
      console.warn(`[FMP-FALLBACK] No quote data for ${ticker} from FMP`);
      return null;
    }
    console.log(`[FMP-FALLBACK] OK for ${ticker} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return {
      quote,
      profile: get(profileRes),
      financials: {
        income: get(incomeRes) || [],
        cashflow: get(cashflowRes) || [],
        balanceSheet: get(balanceSheetRes) || [],
      },
      analyst: {
        priceTarget: get(priceTargetRes),
        grades: get(gradesRes) || [],
        estimates: get(estimatesRes) || [],
      },
      ohlcv: get(ohlcvRes) || [],
      segments: get(segmentsRes) || [],
      peers: get(peersRes) || [],
      ratios: get(ratiosRes) || [],
      source: 'fmp',
    };
  } catch (err: any) {
    console.error(`[FMP-FALLBACK] Failed for ${ticker}: ${err?.message?.substring(0, 200)}`);
    return null;
  }
}

// === Parse helpers ===
function parseMarkdownTable(content: string): Record<string, string>[] {
  const lines = content.split("\n");
  const rows: Record<string, string>[] = [];
  let headers: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim());

    if (cells.length === 0) continue;
    if (cells.every(c => /^[-:]+$/.test(c))) continue;

    if (headers.length === 0) {
      headers = cells;
    } else {
      const row: Record<string, string> = {};
      cells.forEach((c, i) => {
        if (headers[i]) row[headers[i]] = c;
      });
      rows.push(row);
    }
  }
  return rows;
}

function parseNumber(s: string | undefined): number {
  if (!s) return 0;
  let cleaned = s.replace(/,/g, "").replace(/\$/g, "").replace(/%/g, "").trim();
  let multiplier = 1;
  if (/[Tt]$/.test(cleaned)) { multiplier = 1e12; cleaned = cleaned.slice(0, -1); }
  else if (/[Bb]$/.test(cleaned)) { multiplier = 1e9; cleaned = cleaned.slice(0, -1); }
  else if (/[Mm]$/.test(cleaned)) { multiplier = 1e6; cleaned = cleaned.slice(0, -1); }
  else if (/[Kk]$/.test(cleaned)) { multiplier = 1e3; cleaned = cleaned.slice(0, -1); }
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    cleaned = "-" + cleaned.slice(1, -1);
  }
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n * multiplier;
}

function parseCSVFromUrl(csvUrl: string): Record<string, string>[] {
  try {
    const csv = execSync(`curl -sL "${csvUrl}"`, { encoding: "utf-8", timeout: 30000, maxBuffer: 50 * 1024 * 1024 });
    const lines = csv.trim().split("\n");
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
    return lines.slice(1).map(line => {
      const cells: string[] = [];
      let current = "";
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes; continue; }
        if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ""; continue; }
        current += ch;
      }
      cells.push(current.trim());
      const row: Record<string, string> = {};
      cells.forEach((c, i) => { if (headers[i]) row[headers[i]] = c; });
      return row;
    });
  } catch {
    return [];
  }
}

// === Effective Sector Classification ===
function getEffectiveSector(sector: string, industry: string, description: string): { sector: string; industry: string; isHybrid: boolean; hybridNote: string } {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();

  const techPhrases = [
    "cloud computing", "cloud platform", "cloud infrastructure", "cloud services",
    "amazon web services", "\\baws\\b", "\\bazure\\b",
    "artificial intelligence", "machine learning",
    "streaming service", "streaming platform", "video streaming",
    "software-as-a-service", "\\bsaas\\b",
    "data center", "digital advertising platform",
  ];
  const hasTechCore = techPhrases.some(phrase => {
    if (phrase.includes("\\")) {
      return new RegExp(phrase, "i").test(desc);
    }
    return desc.includes(phrase);
  });

  const descLower = desc;
  const rawIndustryLower = ind;
  if (sector === 'Financial Services' && (
    descLower.includes('semiconductor') ||
    descLower.includes('power semiconductor') ||
    descLower.includes('microcontroller') ||
    descLower.includes('microchip') ||
    rawIndustryLower.includes('semiconductor') ||
    (rawIndustryLower.includes('fintech') && descLower.includes('chip'))
  )) {
    return {
      sector: 'Technology',
      industry: 'Semiconductors',
      isHybrid: false,
      hybridNote: '',
    };
  }

  if ((s.includes("consumer") && (s.includes("cycl") || s.includes("discr"))) && hasTechCore) {
    return {
      sector: "Technology",
      industry: industry + " / Cloud & Tech Platform",
      isHybrid: true,
      hybridNote: `Reklassifiziert: API meldet "${sector}/${industry}", aber signifikanter Tech/Cloud-Anteil (AWS/Cloud) → Tech-Sektor-Defaults für DCF.`,
    };
  }

  const socialTechPhrases = ["artificial intelligence", "digital advertising", "social network", "search engine", "metaverse"];
  const hasSocialTech = socialTechPhrases.some(p => desc.includes(p));
  if (s.includes("commun") && hasSocialTech) {
    return {
      sector: "Technology",
      industry: industry + " / Tech Platform",
      isHybrid: true,
      hybridNote: `Reklassifiziert: API meldet "${sector}", aber Kerngeschäft ist Tech-Plattform → Tech-Sektor-Defaults.`,
    };
  }

  const isSemiConductorCompany = desc.includes('semiconductor') || desc.includes('microcontroller') ||
    desc.includes('power semiconductor') || desc.includes('microchip') ||
    ind.includes('semiconductor');
  const fintechPhrases = ["payment", "fintech", "buy now pay later", "bnpl", "merchant finance",
    "banking", "deposit", "lending", "credit", "consumer finance", "super app",
    "marketplace platform", "peer to peer payment"];
  const hasFinTechCore = fintechPhrases.some(p => desc.includes(p));
  if (s.includes("tech") && hasFinTechCore && !hasTechCore && !isSemiConductorCompany) {
    return {
      sector: "Financial Services",
      industry: "FinTech / Digital Payments & Super-App",
      isHybrid: true,
      hybridNote: `Reklassifiziert: API meldet "${sector}/${industry}", aber Kerngeschäft ist FinTech/Payments/Marketplace → Financial Services-Defaults.`,
    };
  }

  return { sector, industry, isHybrid: false, hybridNote: "" };
}

// === Sector WACC/Growth defaults ===
function getSectorDefaults(sector: string, industry: string): {
  waccScenarios: { kons: number; avg: number; opt: number };
  growthAssumptions: { g1: number; g2: number; terminal: number };
  cycleClass: string;
  politicalCycle: string;
  sectorMaxDrawdown: number;
  sectorAvgPE: number;
  sectorAvgForwardPE: number;
  sectorAvgEVEBITDA: number;
  sectorAvgPEG: number;
  sectorAvgPS: number;
  sectorAvgPB: number;
  sectorEPSGrowth: number;
} {
  const s = sector.toLowerCase();
  if (s.includes("tech")) {
    return {
      waccScenarios: { kons: 10.5, avg: 9.0, opt: 7.5 },
      growthAssumptions: { g1: 15, g2: 10, terminal: 3 },
      cycleClass: "Secular Growth",
      politicalCycle: "Low sensitivity – tech regulation risk moderate",
      sectorMaxDrawdown: 35,
      sectorAvgPE: 28, sectorAvgForwardPE: 24, sectorAvgEVEBITDA: 20, sectorAvgPEG: 1.5,
      sectorAvgPS: 6.0, sectorAvgPB: 8.0, sectorEPSGrowth: 15,
    };
  } else if (s.includes("health")) {
    return {
      waccScenarios: { kons: 9.5, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 10, g2: 7, terminal: 3 },
      cycleClass: "Defensive / Non-Cyclical",
      politicalCycle: "High – healthcare policy, drug pricing reform",
      sectorMaxDrawdown: 25,
      sectorAvgPE: 22, sectorAvgForwardPE: 19, sectorAvgEVEBITDA: 15, sectorAvgPEG: 1.8,
      sectorAvgPS: 4.5, sectorAvgPB: 4.0, sectorEPSGrowth: 12,
    };
  } else if (s.includes("financ")) {
    return {
      waccScenarios: { kons: 11.0, avg: 9.5, opt: 8.0 },
      growthAssumptions: { g1: 8, g2: 5, terminal: 2.5 },
      cycleClass: "Cyclical – Interest Rate Sensitive",
      politicalCycle: "High – banking regulation, monetary policy",
      sectorMaxDrawdown: 45,
      sectorAvgPE: 14, sectorAvgForwardPE: 13, sectorAvgEVEBITDA: 10, sectorAvgPEG: 1.3,
      sectorAvgPS: 3.0, sectorAvgPB: 1.5, sectorEPSGrowth: 8,
    };
  } else if (s.includes("energy")) {
    return {
      waccScenarios: { kons: 12.0, avg: 10.0, opt: 8.5 },
      growthAssumptions: { g1: 5, g2: 3, terminal: 2 },
      cycleClass: "Deep Cyclical – Commodity Linked",
      politicalCycle: "Very High – energy policy, ESG mandates",
      sectorMaxDrawdown: 55,
      sectorAvgPE: 12, sectorAvgForwardPE: 11, sectorAvgEVEBITDA: 6, sectorAvgPEG: 1.0,
      sectorAvgPS: 1.2, sectorAvgPB: 1.8, sectorEPSGrowth: 5,
    };
  } else if (s.includes("consumer") && (s.includes("discr") || s.includes("cycl"))) {
    const i = industry.toLowerCase();
    const isLuxury = i.includes("luxury") || i.includes("apparel") || i.includes("fashion");
    if (isLuxury) {
      return {
        waccScenarios: { kons: 9.5, avg: 8.0, opt: 6.5 },
        growthAssumptions: { g1: 8, g2: 6, terminal: 2.5 },
        cycleClass: "Cyclical – Luxury / Aspirational Spend",
        politicalCycle: "Moderate – tariffs, China demand, wealth effects",
        sectorMaxDrawdown: 40,
        sectorAvgPE: 25, sectorAvgForwardPE: 22, sectorAvgEVEBITDA: 16, sectorAvgPEG: 1.8,
        sectorAvgPS: 2.5, sectorAvgPB: 5.0, sectorEPSGrowth: 10,
      };
    }
    return {
      waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 12, g2: 8, terminal: 3 },
      cycleClass: "Cyclical – Consumer Spending",
      politicalCycle: "Moderate – tariffs, consumer confidence",
      sectorMaxDrawdown: 40,
      sectorAvgPE: 24, sectorAvgForwardPE: 21, sectorAvgEVEBITDA: 16, sectorAvgPEG: 1.4,
      sectorAvgPS: 1.5, sectorAvgPB: 4.0, sectorEPSGrowth: 10,
    };
  } else if (s.includes("consumer") && (s.includes("stapl") || s.includes("defens"))) {
    return {
      waccScenarios: { kons: 8.5, avg: 7.5, opt: 6.5 },
      growthAssumptions: { g1: 5, g2: 4, terminal: 2.5 },
      cycleClass: "Defensive – Consumer Staples",
      politicalCycle: "Low – essential goods, moderate regulatory risk",
      sectorMaxDrawdown: 20,
      sectorAvgPE: 22, sectorAvgForwardPE: 20, sectorAvgEVEBITDA: 15, sectorAvgPEG: 2.2,
      sectorAvgPS: 2.0, sectorAvgPB: 5.5, sectorEPSGrowth: 6,
    };
  } else if (s.includes("commun")) {
    return {
      waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 10, g2: 7, terminal: 2.5 },
      cycleClass: "Secular Growth / Communication",
      politicalCycle: "Moderate – content regulation, antitrust",
      sectorMaxDrawdown: 35,
      sectorAvgPE: 20, sectorAvgForwardPE: 17, sectorAvgEVEBITDA: 12, sectorAvgPEG: 1.4,
      sectorAvgPS: 2.0, sectorAvgPB: 3.5, sectorEPSGrowth: 10,
    };
  } else if (s.includes("industrial")) {
    return {
      waccScenarios: { kons: 10.5, avg: 9.0, opt: 7.5 },
      growthAssumptions: { g1: 8, g2: 5, terminal: 2.5 },
      cycleClass: "Cyclical – Capex Cycle",
      politicalCycle: "Moderate – infrastructure spending, trade policy",
      sectorMaxDrawdown: 40,
      sectorAvgPE: 20, sectorAvgForwardPE: 18, sectorAvgEVEBITDA: 13, sectorAvgPEG: 1.5,
      sectorAvgPS: 3.0, sectorAvgPB: 2.0, sectorEPSGrowth: 5,
    };
  } else if (s.includes("real estate")) {
    return {
      waccScenarios: { kons: 9.5, avg: 8.0, opt: 6.5 },
      growthAssumptions: { g1: 5, g2: 3, terminal: 2 },
      cycleClass: "Cyclical – Rate Sensitive",
      politicalCycle: "Moderate – housing policy, zoning",
      sectorMaxDrawdown: 45,
      sectorAvgPE: 35, sectorAvgForwardPE: 33, sectorAvgEVEBITDA: 20, sectorAvgPEG: 2.0,
      sectorAvgPS: 8.0, sectorAvgPB: 2.5, sectorEPSGrowth: 4,
    };
  } else if (s.includes("util")) {
    return {
      waccScenarios: { kons: 8.0, avg: 7.0, opt: 6.0 },
      growthAssumptions: { g1: 4, g2: 3, terminal: 2 },
      cycleClass: "Defensive – Regulated",
      politicalCycle: "Moderate – utility regulation, clean energy mandates",
      sectorMaxDrawdown: 20,
      sectorAvgPE: 18, sectorAvgForwardPE: 16.5, sectorAvgEVEBITDA: 12, sectorAvgPEG: 2.5,
      sectorAvgPS: 3.0, sectorAvgPB: 3.0, sectorEPSGrowth: 8,
    };
  } else if (s.includes("material") || s.includes("mining") || s.includes("metal") || s.includes("steel") || s.includes("chemical") || s.includes("basic")) {
    return {
      waccScenarios: { kons: 12.0, avg: 10.0, opt: 8.0 },
      growthAssumptions: { g1: 5, g2: 3, terminal: 2 },
      cycleClass: "Deep Cyclical – Commodity Linked",
      politicalCycle: "High – commodity prices, environmental regulation, trade tariffs",
      sectorMaxDrawdown: 60,
      sectorAvgPE: 14, sectorAvgForwardPE: 12, sectorAvgEVEBITDA: 8, sectorAvgPEG: 1.2,
      sectorAvgPS: 1.5, sectorAvgPB: 1.8, sectorEPSGrowth: 5,
    };
  } else {
    return {
      waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 10, g2: 6, terminal: 2.5 },
      cycleClass: "Mixed Cyclical",
      politicalCycle: "Moderate – general policy exposure",
      sectorMaxDrawdown: 35,
      sectorAvgPE: 20, sectorAvgForwardPE: 18, sectorAvgEVEBITDA: 14, sectorAvgPEG: 1.5,
      sectorAvgPS: 1.5, sectorAvgPB: 2.5, sectorEPSGrowth: 7,
    };
  }
}

// === Generate catalysts from real data ===
function generateCatalystContext(
  catalystName: string, sector: string, industry: string, description: string,
  growthRate: number, fcfMargin: number, revenue: number
): string {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();
  const revB = revenue > 0 ? `$${(revenue / 1e9).toFixed(1)}B` : '';
  const gr = growthRate.toFixed(1);

  const hasCloud = desc.includes('cloud computing') || desc.includes('cloud platform') || desc.includes('cloud services') || desc.includes('azure') || desc.includes('aws');
  const hasAI = desc.includes('artificial intelligence') || desc.includes('machine learning') || desc.includes('copilot') || desc.includes('azure') || desc.includes('openai') || desc.includes('generative ai');
  const hasSaaS = desc.includes('software') || desc.includes('subscription') || desc.includes('saas');
  const hasPharmaPipeline = desc.includes('clinical') || desc.includes('fda') || desc.includes('pipeline') || desc.includes('drug');
  const hasLuxury = ind.includes('luxury') || desc.includes('luxury') || desc.includes('fashion') || desc.includes('premium');
  const hasDefense = desc.includes('defense') || desc.includes('military') || desc.includes('government') || desc.includes('aerospace');
  const hasRetail = desc.includes('retail') || desc.includes('store') || desc.includes('e-commerce') || desc.includes('online');
  const hasEV = desc.includes('electric vehicle') || desc.includes('battery') || desc.includes('ev ');
  const hasStreaming = desc.includes('streaming') || desc.includes('content') || desc.includes('subscriber');
  const hasBank = ind.includes('bank') || desc.includes('banking') || desc.includes('deposit') || desc.includes('loan');
  const hasInsurance = ind.includes('insurance') || desc.includes('insurance') || desc.includes('underwriting');
  const hasOilGas = desc.includes('oil') || desc.includes('gas') || desc.includes('petroleum') || desc.includes('refin');
  const hasRenewable = desc.includes('renewable') || desc.includes('solar') || desc.includes('wind energy');
  const hasLaunch = desc.includes('launch') || desc.includes('rocket') || desc.includes('space');
  const hasSemiconductor = desc.includes('semiconductor') || desc.includes('chip') || desc.includes('wafer') || desc.includes('gpu');

  switch (catalystName) {
    case 'Revenue Growth Acceleration': {
      if (hasCloud && hasAI) return `Cloud- & AI-Monetarisierung müssen organisches Wachstum über ${gr}% hinaus beschleunigen. Voraussetzung: Steigende Adoption von AI-Services (Copilot, AI-APIs), wachsende Cloud-Workloads und Expansion in neue Enterprise-Segmente. Revenue-Basis: ${revB}.`;
      if (hasCloud) return `Cloud-Workload-Migration und Platform-Adoption müssen Wachstum über ${gr}% treiben. Cross-Selling bestehender Enterprise-Kunden und Erschließung neuer Verticals als Hebel. Revenue-Basis: ${revB}.`;
      if (hasSaaS) return `Subscription-Revenue muss durch Net-Expansion (Upselling, Seat-Growth) und Neukundengewinnung beschleunigt werden. Ziel: NRR >120% und organisches Wachstum über ${gr}%. Revenue-Basis: ${revB}.`;
      if (hasPharmaPipeline) return `Pipeline-Fortschritte und neue Indikationen müssen Revenue-Wachstum über ${gr}% beschleunigen. Voraussetzung: Erfolgreiche Phase-3-Daten, FDA-Zulassungen und kommerzielle Launches in Schlüsselmärkten.`;
      if (hasLuxury) return `Organisches Wachstum muss über ${gr}% beschleunigen durch China/Asia-Nachfrageerholung, Preiserhöhungen und Expansion in aufstrebende Luxusmärkte (Indien, Südostasien). Revenue-Basis: ${revB}.`;
      if (hasDefense || hasLaunch) return `Auftragsvolumen und Backlog-Conversion müssen Revenue-Wachstum über ${gr}% treiben. Voraussetzung: Neue Regierungsaufträge, Programmstarts und internationale Expansion. Revenue-Basis: ${revB}.`;
      if (hasSemiconductor) return `Chip-Nachfrage muss durch AI-Infrastruktur-Ausbau, Datacenter-Investments und neue Produktgenerationen Wachstum über ${gr}% beschleunigen. Revenue-Basis: ${revB}.`;
      if (hasRetail) return `Same-Store-Sales und E-Commerce-Penetration müssen organisches Wachstum über ${gr}% treiben. Voraussetzung: Steigende Konsumausgaben und Marktanteilsgewinne. Revenue-Basis: ${revB}.`;
      if (hasBank) return `Zins- und Provisionserträge müssen Revenue-Wachstum über ${gr}% treiben. Voraussetzung: Kreditwachstum, NIM-Expansion und Cross-Selling von Wealth-Management-Produkten.`;
      if (hasOilGas) return `Produktionsvolumen und Commodity-Preise müssen Revenue-Wachstum über ${gr}% ermöglichen. Voraussetzung: Stabile/steigende Ölpreise und Effizienzgewinne in der Förderung.`;
      return `Organisches Revenue-Wachstum muss über ${gr}% beschleunigt werden durch Marktanteilsgewinne, Produktinnovation und geografische Expansion. Revenue-Basis: ${revB}.`;
    }
    case 'Margin Expansion / Operating Leverage': {
      if (hasCloud || hasSaaS) return `FCF-Marge (aktuell ${fcfMargin.toFixed(1)}%) muss durch Operating Leverage steigen: steigende Gross Margins bei Cloud/SaaS-Scale, sinkende S&M/G&A-Ratio und Infrastruktur-Effizienz. Ziel: 200-400bps Margin-Expansion über 2 Jahre.`;
      if (hasLuxury) return `Operative Marge muss durch Pricing Power (Mid-Single-Digit Preiserhöhungen), DTC-Mix-Shift (höhere Margen als Wholesale) und Kostenoptimierung gesteigert werden. FCF-Marge aktuell ${fcfMargin.toFixed(1)}%.`;
      if (hasPharmaPipeline) return `Gross Margin muss durch höheren Anteil patentgeschützter Produkte und Pipeline-Commercialization steigen. FCF-Marge aktuell ${fcfMargin.toFixed(1)}%. Ziel: Skaleneffekte bei R&D-zu-Revenue-Ratio.`;
      if (hasDefense || hasLaunch) return `Margenverbesserung durch Skaleneffekte bei steigender Produktionsrate, höhere Service-/Aftermarket-Anteile und Programm-Reifung (geringere Entwicklungskosten). FCF-Marge aktuell ${fcfMargin.toFixed(1)}%.`;
      if (hasSemiconductor) return `Margin-Expansion durch Produktmix-Shift zu höherwertigen Chips (AI/Datacenter), Skaleneffekte auf neuen Prozesstechnologien und sinkende Stückkosten. FCF-Marge aktuell ${fcfMargin.toFixed(1)}%.`;
      return `Operative Effizienz und Skaleneffekte müssen FCF-Marge (aktuell ${fcfMargin.toFixed(1)}%) verbessern. Hebel: Fixkostendegression bei Umsatzwachstum, Automatisierung und Supply-Chain-Optimierung.`;
    }
    case 'AI / Cloud Adoption Tailwind': {
      if (hasAI && hasCloud) return `AI-Produktsuite (Copilot, AI-APIs, ML-Services) muss Enterprise-Adoption beschleunigen und ARPU erhöhen. Cloud-Migration bestehender On-Premise-Kunden zu höhermargigen Recurring-Revenue-Streams. Voraussetzung: Nachweisbarer ROI bei AI-Investitionen der Kunden.`;
      if (hasCloud) return `Cloud-Plattform muss AI-Workloads als Wachstumstreiber nutzen. Enterprise-Kunden migrieren Legacy-Systeme und adoptieren AI-Services. Voraussetzung: Konkurrenzfähige AI-Modelle und Infrastruktur.`;
      return `AI/ML-Integration in bestehende Produkte erhöht Wertschöpfung und Kundenbindung. Voraussetzung: Erfolgreiche Monetarisierung von AI-Features und steigende Nutzungsintensität.`;
    }
    case 'Product Cycle / Platform Expansion': {
      if (hasCloud) return `Neue Produktgenerationen und Plattform-Erweiterungen (Datenanalyse, Security, DevOps) müssen TAM erweitern. Cross-Platform-Bundling erhöht Switching Costs und sichert langfristige Kundenbeziehungen.`;
      if (hasSaaS) return `Produktportfolio-Erweiterung durch neue Module, vertikale Lösungen und Plattform-Ökosystem. Ziel: Höherer Wallet-Share bei Bestandskunden und Erschließung neuer Segmente.`;
      if (hasSemiconductor) return `Nächste Chip-Generation und Expansion in neue Anwendungsfelder (AI-Inference, Edge Computing, Automotive) müssen TAM signifikant erweitern.`;
      return `Neue Produktzyklen und Plattform-Erweiterungen müssen zusätzliche Umsatzquellen erschließen und bestehende Kundenbeziehungen vertiefen.`;
    }
    case 'Pipeline Approval / FDA Catalyst':
      return `Phase-3-Ergebnisse und FDA-Entscheidungen zu Schlüssel-Kandidaten müssen positiv ausfallen. Erfolgreiche Zulassungen können Revenue-Sprung ermöglichen. Risiko: CRL, Partial Hold oder Labeling-Einschränkungen.`;
    case 'Demographic Tailwind (Aging Population)':
      return `Alternde Bevölkerung in Industrieländern treibt strukturell steigende Gesundheitsausgaben. Voraussetzung: Produktportfolio muss auf chronische Erkrankungen und Prävention ausgerichtet sein.`;
    case 'China / Asia Demand Recovery':
      return `China-Konsum muss sich von aktueller Schwäche erholen. Voraussetzung: Verbessertes Konsumklima, stabiler Immobilienmarkt und Vermögenseffekte. Aspirational Spending in Tier-2/3-Städten als zusätzlicher Treiber.`;
    case 'Pricing Power / Brand Elevation':
      return `Mid-Single-Digit Preiserhöhungen müssen ohne Volumen-Verluste durchgesetzt werden. Voraussetzung: Starke Markenbegehrlichkeit, kontrollierte Distribution und Exklusivitätsstrategie.`;
    case 'Interest Rate Normalization Benefit':
      return `Zinsnormalisierung muss Net Interest Margin verbessern. Voraussetzung: Einlagen-Repricing langsamer als Kredit-Repricing. Kreditnachfrage muss bei moderaten Zinsen anziehen.`;
    case 'Capital Return / Buyback Program':
      return `Aktienrückkaufprogramm und Dividendenerhöhungen müssen EPS-Wachstum über organischem Niveau treiben. Voraussetzung: Starke FCF-Generierung und konservative Kapitalallokation.`;
    case 'Commodity Price Recovery':
      return `Commodity-Preise müssen sich stabilisieren oder erholen. Voraussetzung: Globale Nachfrage-Erholung, Angebotsverknappung oder geopolitische Risikopremien. Breakeven-Analyse als Schlüssel.`;
    case 'Energy Transition Investment':
      return `Investments in Renewables, Carbon Capture oder LNG müssen langfristiges Wachstum jenseits fossiler Brennstoffe sichern. Voraussetzung: Regulatorische Klarheit und wettbewerbsfähige Projektrenditen.`;
    case 'Consumer Confidence Recovery':
      return `Konsumklima muss sich verbessern und diskretionenäre Ausgaben ansteigen. Voraussetzung: Sinkende Inflation, stabiler Arbeitsmarkt und Wealth-Effekte bei steigenden Asset-Preisen.`;
    case 'E-Commerce / DTC Growth':
      return `Direct-to-Consumer-Kanal muss überproportional wachsen und höhere Margen liefern. Voraussetzung: Digitale Kundenerfahrung, Fulfillment-Effizienz und personalisiertes Marketing.`;
    case 'iGaming / Online Sports Betting Expansion':
      return `iGaming- und Online-Sports-Betting-Legalisierung in neuen US-Bundesstaaten muss zusätzliche Umsatzquellen erschließen. Voraussetzung: Regulatorische Genehmigungen, Technologie-Plattform-Skalierung und Marketing-ROI in neuen Märkten. Revenue-Basis: ${revB}.`;
    case 'New Property Openings / Capacity Expansion':
      return `Neue Casino-Standorte, Hotel-Erweiterungen oder Renovierungen müssen Gaming-Revenue und Nicht-Gaming-Revenue (F&B, Hotel, Entertainment) steigern. Voraussetzung: Termingerechte Baufertigstellung, Genehmigungen und regionaler Nachfrage-Support.`;
    case 'Same-Store Sales Recovery / Menu Pricing':
      return `Comparable-Sales müssen durch Traffic-Recovery und strategische Preiserhöhungen steigen. Voraussetzung: Stabile Konsumausgaben, erfolgreiche Menü-Innovation und nicht-inflationsgetriebene Ticket-Steigerung.`;
    case 'Unit Growth / Franchise Expansion':
      return `Netto-Neueröffnungen müssen System-Revenue-Wachstum treiben. Voraussetzung: Verfügbare Franchise-Nehmer, attraktive Unit Economics und Genehmigungen in Zielmärkten.`;
    case 'Travel Demand Recovery / RevPAR Growth':
      return `RevPAR (Revenue per Available Room) muss durch höhere Auslastung und ADR steigen. Voraussetzung: Erholung der Reisenachfrage, Corporate-Travel-Normalisierung und Events-Pipeline.`;
    case 'Loyalty Program Monetization':
      return `Treueprogramm muss höheren Customer Lifetime Value generieren durch Cross-Selling (Kreditkarten, Partner-Deals) und erhöhte Direktbuchungen. Voraussetzung: Wachsende Mitgliederbasis und attraktive Einlöse-Optionen.`;
    case 'EV Transition / New Model Cycle':
      return `EV-Modellpalette muss Marktanteile im wachsenden Elektro-Segment gewinnen. Voraussetzung: Konkurrenzfähige Reichweite, Preis-Leistung und Ladeinfrastruktur-Verfügbarkeit. Neuer Modellzyklus als Volumenhebel.`;
    case 'Supply Chain Normalization / Volume Recovery':
      return `Normalisierung der Lieferketten muss Produktionsvolumen steigern und Auftragsrückstände abbauen. Voraussetzung: Chip-Verfügbarkeit, Logistik-Normalisierung und Lagerbestandsoptimierung.`;
    case 'Market Share Gains':
      return `Marktanteile müssen durch Produktinnovation, Pricing und Distribution ausgebaut werden. Voraussetzung: Wettbewerbsvorteile in Qualität, Service oder Kostenstruktur.`;
    case 'Strategic M&A / Partnerships':
      return `Strategische Akquisitionen oder Partnerschaften müssen Technologie, Marktpräsenz oder Kundenbeziehungen ergänzen. Voraussetzung: Disziplinierte Kapitalallokation und Integrations-Exzellenz.`;
    default:
      return `Katalysator muss sich im Geschäftsmodell-Kontext materialisieren. Voraussetzung: Erfolgreiche Umsetzung der strategischen Prioritäten und günstiges Marktumfeld.`;
  }
}

// === Peer Comparison — uses FMP peers directly (no dead Perplexity Finance calls) ===
async function fetchPeerComparison(
  ticker: string, companyName: string, pe: number, peg: number, revenue: number,
  marketCap: number, revenueGrowth: number, epsGrowth5Y: number
): Promise<{ subject: any; peers: any[]; peerAvg: any } | null> {
  // Peer data comes from fmpPeers() inside getFmpFallbackData — no separate fetch needed here.
  return null;
}

// === Google News RSS Parser ===
async function fetchNewsFromGoogleRSS(ticker: string, companyName: string): Promise<{ title: string; source: string; pubDate: string; url: string; relativeTime: string; lang?: string }[]> {
  const shortName = companyName.replace(/,? (Inc|Corp|Ltd|LLC|plc|SE|NV|SA|AG|Co)\.?.*$/i, '').trim();

  function parseRssItems(xml: string, lang: string, maxItems: number): { title: string; source: string; pubDate: string; url: string; relativeTime: string; lang: string }[] {
    const items: { title: string; source: string; pubDate: string; url: string; relativeTime: string; lang: string }[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
      const itemXml = match[1];
      const titleMatch = itemXml.match(/<title>([^<]+)<\/title>/);
      const linkMatch = itemXml.match(/<link\/?>(\s*)(https?:\/\/[^\s<]+)/);
      const pubDateMatch = itemXml.match(/<pubDate>([^<]+)<\/pubDate>/);

      if (titleMatch) {
        const fullTitle = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        const lastDash = fullTitle.lastIndexOf(' - ');
        const title = lastDash > 0 ? fullTitle.substring(0, lastDash).trim() : fullTitle;
        const source = lastDash > 0 ? fullTitle.substring(lastDash + 3).trim() : 'Google News';
        const pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString();
        const url = linkMatch ? linkMatch[2] : '';

        const diffMs = Date.now() - new Date(pubDate).getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        let relativeTime = '';
        if (diffMins < 60) relativeTime = `vor ${diffMins} Min.`;
        else if (diffHours < 24) relativeTime = `vor ${diffHours} Std.`;
        else if (diffDays === 1) relativeTime = 'gestern';
        else if (diffDays < 30) relativeTime = `vor ${diffDays} Tagen`;
        else relativeTime = `vor ${Math.floor(diffDays / 30)} Mon.`;

        items.push({ title, source, pubDate, url, relativeTime, lang });
      }
    }
    return items;
  }

  async function fetchFeed(url: string, label: string): Promise<string> {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockAnalystPro/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) { console.log(`[NEWS] ${label} returned ${resp.status}`); return ''; }
      return await resp.text();
    } catch (err: any) {
      console.log(`[NEWS] ${label} failed: ${err?.message?.substring(0, 100)}`);
      return '';
    }
  }

  try {
    const enQuery = encodeURIComponent(`${ticker} ${shortName} stock`);
    const enUrl = `https://news.google.com/rss/search?q=${enQuery}&hl=en-US&gl=US&ceid=US:en`;
    const deQuery = encodeURIComponent(`${shortName} Aktie`);
    const deUrl = `https://news.google.com/rss/search?q=${deQuery}&hl=de&gl=DE&ceid=DE:de`;

    console.log(`[NEWS] Fetching EN + DE Google News RSS for ${ticker}`);
    const [enXml, deXml] = await Promise.all([
      fetchFeed(enUrl, `EN-RSS ${ticker}`),
      fetchFeed(deUrl, `DE-RSS ${ticker}`),
    ]);

    const enItems = parseRssItems(enXml, 'en', 5);
    const deItems = parseRssItems(deXml, 'de', 5);

    const allItems = [...enItems, ...deItems];
    const seen = new Set<string>();
    const dedupItems = allItems.filter(item => {
      const norm = item.title.toLowerCase().replace(/[^a-z0-9äöüß]/g, '').substring(0, 40);
      if (seen.has(norm)) return false;
      seen.add(norm);
      return true;
    });

    dedupItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    const result = dedupItems.slice(0, 10);

    const enCount = result.filter(i => i.lang === 'en').length;
    const deCount = result.filter(i => i.lang === 'de').length;
    console.log(`[NEWS] ${ticker}: ${result.length} items (${enCount} EN + ${deCount} DE)`);
    return result;
  } catch (err: any) {
    console.log(`[NEWS] Google News RSS failed for ${ticker}: ${err?.message?.substring(0, 150)}`);
    return [];
  }
}

// === LLM-Powered News-Sentiment-Catalyst Matching ===
async function matchNewsToCatalysts(
  newsItems: { title: string; source: string; pubDate: string; url: string; relativeTime: string; sentiment?: string; sentimentScore?: number; matchedCatalyst?: string; matchedCatalystIdx?: number }[],
  catalysts: Catalyst[],
  _ticker?: string,
  _companyName?: string
): Promise<void> {
  if (!newsItems.length || !catalysts.length) return;

  const BULLISH_WORDS = ['beat','surpass','record','growth','surge','rally','upgrade','buy','outperform','strong','profit','win','award','launch','expand','positive','exceed'];
  const BEARISH_WORDS = ['miss','fall','drop','decline','cut','downgrade','sell','underperform','weak','loss','fine','penalty','recall','delay','concern','risk','layoff','warn'];

  const CATALYST_KEYWORDS: Record<string, string[]> = {
    'revenue': ['revenue','sales','growth','demand','order','backlog','booking'],
    'margin': ['margin','cost','efficiency','operating','leverage','ebitda','profit'],
    'market share': ['market share','competitor','competition','customer','win','contract','displacement'],
    'acquisition': ['acqui','merger','partner','deal','joint venture','alliance','agreement'],
    'ai': ['ai','artificial intelligence','machine learning','automation','cloud','azure','copilot','llm'],
    'product': ['product','launch','platform','cycle','version','upgrade','release','innovation'],
    'defense': ['defense','military','contract','government','pentagon','nato','army','navy'],
    'regulatory': ['fda','epa','sec','regulation','approve','approval','clearance','ruling'],
    'energy': ['energy','solar','wind','battery','ev','electric','renewable','grid','power'],
    'dividend': ['dividend','buyback','repurchase','shareholder','return','capital'],
    'interest rate': ['rate','fed','central bank','interest','yield','monetary'],
    'demographic': ['demographic','aging','population','healthcare','biotech','drug','therapy'],
  };

  const catKeywords: string[][] = catalysts.map(cat => {
    const catName = cat.name.toLowerCase();
    const kws: string[] = catName.split(/[\s/()]+/).filter(w => w.length > 3);
    for (const [key, words] of Object.entries(CATALYST_KEYWORDS)) {
      if (catName.includes(key)) kws.push(...words);
    }
    return kws;
  });

  for (let i = 0; i < newsItems.length; i++) {
    const item = newsItems[i];
    const titleLower = ((item as any).title || (item as any).headline || '').toLowerCase();
    if (!titleLower) continue;

    const bullishHits = BULLISH_WORDS.filter(w => titleLower.includes(w)).length;
    const bearishHits = BEARISH_WORDS.filter(w => titleLower.includes(w)).length;
    const total = bullishHits + bearishHits;
    const rawScore = total > 0 ? (bullishHits - bearishHits) / total : 0;
    item.sentimentScore = Math.max(-1, Math.min(1, rawScore));
    item.sentiment = rawScore > 0.1 ? 'bullish' : rawScore < -0.1 ? 'bearish' : 'neutral';

    let bestCatIdx = -1;
    let bestScore = 0;
    for (let ci = 0; ci < catalysts.length; ci++) {
      const hits = catKeywords[ci].filter(kw => titleLower.includes(kw)).length;
      if (hits > bestScore) { bestScore = hits; bestCatIdx = ci; }
    }
    if (bestCatIdx >= 0 && bestScore >= 1) {
      item.matchedCatalyst = catalysts[bestCatIdx].name;
      item.matchedCatalystIdx = bestCatIdx;
    } else {
      if (Math.abs(rawScore) > 0.3 && catalysts.length > 0) {
        item.matchedCatalyst = catalysts[0].name;
        item.matchedCatalystIdx = 0;
      }
    }
  }

  for (let i = 0; i < catalysts.length; i++) {
    const matched = newsItems.filter(n => n.matchedCatalystIdx === i);
    if (!matched.length) continue;
    const cat = catalysts[i];
    cat.newsCount = matched.length;
    cat.posOriginal = cat.pos;
    const avgScore = matched.reduce((s, n) => s + (n.sentimentScore || 0), 0) / matched.length;
    const bullish = matched.filter(n => n.sentiment === 'bullish').length;
    const bearish = matched.filter(n => n.sentiment === 'bearish').length;
    cat.newsSentiment = (bullish > 0 && bearish > 0) ? 'mixed' : avgScore > 0.2 ? 'bullish' : avgScore < -0.2 ? 'bearish' : 'neutral';
    const adjustment = Math.round(avgScore * 5);
    cat.posAdjustment = adjustment;
    cat.pos = Math.max(10, Math.min(85, cat.pos + adjustment));
    cat.nettoUpside = +(cat.bruttoUpside * (1 - cat.einpreisungsgrad / 100)).toFixed(2);
    cat.gb = +(cat.pos / 100 * cat.nettoUpside).toFixed(2);
  }
  console.log(`[NEWS-MATCH] Keyword-matched ${newsItems.filter(n => n.matchedCatalystIdx != null).length}/${newsItems.length} news items to catalysts`);
}

// === LLM-Powered Company-Specific Catalyst Generation ===
async function generateLLMCatalysts(
  ticker: string, companyName: string, sector: string, industry: string,
  description: string, revenue: number, revenueGrowth: number, fcfMargin: number,
  price: number, pe: number, marketCap: number,
  keyProjects: string[], secFilingExcerpts: string[], newsHeadlines: string[]
): Promise<Catalyst[] | null> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const contextParts: string[] = [];
    contextParts.push(`Company: ${companyName} (${ticker})`);
    contextParts.push(`Sector: ${sector} / ${industry}`);
    contextParts.push(`Description: ${description.substring(0, 800)}`);
    contextParts.push(`Revenue: $${(revenue / 1e9).toFixed(1)}B | Growth: ${revenueGrowth.toFixed(1)}% | FCF Margin: ${fcfMargin.toFixed(1)}%`);
    contextParts.push(`Price: $${price.toFixed(2)} | P/E: ${pe.toFixed(1)} | Market Cap: $${(marketCap / 1e9).toFixed(1)}B`);

    if (keyProjects.length > 0) {
      contextParts.push(`\nKey Projects (from SEC 10-K filing):\n${keyProjects.map(p => `  - ${p}`).join('\n')}`);
    }
    if (secFilingExcerpts.length > 0) {
      contextParts.push(`\nSEC Filing Excerpts:\n${secFilingExcerpts.map(e => `  "${e}"`).join('\n')}`);
    }
    if (newsHeadlines.length > 0) {
      contextParts.push(`\nRecent News:\n${newsHeadlines.map(n => `  - ${n}`).join('\n')}`);
    }

    const prompt = `You are a senior equity research analyst. Based on the company context below, generate exactly 5 company-specific investment catalysts.

IMPORTANT RULES:
- Each catalyst MUST be specific to THIS company — reference actual projects, products, initiatives, markets, or strategic moves
- Do NOT use generic sector catalysts like "Revenue Growth Acceleration" or "Margin Expansion" — those are BANNED
- For each catalyst, use real company-specific names (e.g. "Blue Creek Mine Ramp-up" for HCC, "FSD/Robotaxi Commercialization" for TSLA, "VMware Integration Synergies" for AVGO)
- Quantify where possible using the company data provided
- Think about: What specific projects, product launches, market expansions, regulatory changes, technology deployments, M&A integrations, or business model shifts could move this stock?
- Include at least one downside-aware catalyst (one with lower PoS reflecting genuine uncertainty)

COMPANY CONTEXT:
${contextParts.join('\n')}

Respond with ONLY a JSON array of exactly 5 catalysts. Each catalyst object must have:
{
  "name": "Short catalyst name (max 50 chars, company-specific)",
  "context": "Detailed German explanation (2-3 sentences) explaining WHY this catalyst matters for the company, what the preconditions are, and how it connects to the business model. Use German financial analyst language.",
  "timeline": "e.g. 6-12M, 12-24M, 12-36M",
  "pos": <number 20-80, probability of success with -10-15% safety margin vs. base estimate>,
  "bruttoUpside": <number 5-30, gross upside % if catalyst materializes>,
  "einpreisungsgrad": <number 20-60, how much is already priced in via consensus/forward estimates>
}

JSON array only, no markdown, no explanation:`;

    console.log(`[ANALYZE] Calling LLM for company-specific catalysts: ${ticker}`);
    const message = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = (message.content[0] as any)?.text || '';
    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const rawCatalysts = JSON.parse(jsonStr);

    if (!Array.isArray(rawCatalysts) || rawCatalysts.length < 3) {
      console.log(`[ANALYZE] LLM returned invalid catalyst array for ${ticker}`);
      return null;
    }

    const catalysts: Catalyst[] = rawCatalysts.slice(0, 5).map((c: any) => {
      const pos = Math.max(20, Math.min(80, Number(c.pos) || 50));
      const bruttoUpside = Math.max(3, Math.min(35, Number(c.bruttoUpside) || 10));
      const einpreisungsgrad = Math.max(15, Math.min(65, Number(c.einpreisungsgrad) || 35));
      const nettoUpside = +(bruttoUpside * (1 - einpreisungsgrad / 100)).toFixed(2);
      const gb = +(pos / 100 * nettoUpside).toFixed(2);
      return {
        name: String(c.name || 'Unknown Catalyst').substring(0, 60),
        timeline: String(c.timeline || '12-24M'),
        pos,
        bruttoUpside,
        einpreisungsgrad,
        nettoUpside,
        gb,
        context: String(c.context || ''),
      };
    });

    console.log(`[ANALYZE] LLM catalysts for ${ticker}: ${catalysts.map(c => c.name).join(', ')}`);
    return catalysts;
  } catch (err: any) {
    console.log(`[ANALYZE] LLM catalyst generation failed for ${ticker}: ${err?.message?.substring(0, 200)}`);
    return null;
  }
}
