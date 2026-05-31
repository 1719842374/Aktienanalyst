import type { Express } from "express";
import { createServer, type Server } from "http";
import { analyzeRequestSchema, type StockAnalysis, type Catalyst, type Risk, type OHLCVPoint, type TechnicalIndicators, type MoatAssessment, type PorterForce, type CatalystReasoning, type CurrencyInfo, type PESTELAnalysis, type PESTELFactor, type PESTELFactorItem, type MacroCorrelations, type MacroCorrelation, type RevenueSegment } from "../shared/schema";
import { execSync } from "child_process";
import { generateCatalystsAndMatchNews, generateRiskExplanations, generateCatalystDeepDives, CapexTailwindContext, generateGrowthThesis, growthThesisFingerprint, generateCompanySpecificRisks } from "./llm-openrouter";
import {
  isFmpAvailable, fmpBatchQuote, fmpProfile, fmpIncomeStatement, fmpCashFlow,
  fmpBalanceSheet, fmpHistoricalPrices, fmpAnalystEstimates, fmpGrades, fmpPriceTarget,
  fmpSegments, fmpPeers, fmpRatios, fmpKeyMetrics,
} from "./fmp";

// === Finance API Helper ===
// Returns either the parsed result, or { __rateLimited: true } on 429,
// or null on any other failure.
function callFinanceTool(toolName: string, args: Record<string, any>): any {
  try {
    const params = JSON.stringify({ source_id: "finance", tool_name: toolName, arguments: args });
    // Escape single quotes in the JSON string for shell
    const escaped = params.replace(/'/g, "'\\''");
    const result = execSync(`external-tool call '${escaped}'`, {
      timeout: 55000, // 55s: chat-first, no proxy cut at 30s (was 25s for published URL)
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    // H1 fix: guard against empty response before JSON.parse
    if (!result?.trim()) {
      console.error(`Finance API empty response (${toolName})`);
      return null;
    }
    return JSON.parse(result);
  } catch (err: any) {
    const msg = err?.message || "";
    // H1 fix: ENOENT = external-tool binary missing — distinct from rate-limit
    if (msg.includes("ENOENT") || msg.includes("not found") || msg.includes("No such file")) {
      console.error(`Finance API CRITICAL: external-tool binary missing (${toolName}) — ${msg.substring(0, 200)}`);
      return { __binaryMissing: true };
    }
    if (msg.includes("RATE_LIMITED") || msg.includes("429")) {
      console.error(`Finance API rate-limited (${toolName})`);
      return { __rateLimited: true };
    }
    if (msg.includes("UNAUTHORIZED") || msg.includes("401")) {
      // 401 typically follows a rate-limit — treat as same backoff signal so we retry.
      console.error(`Finance API unauthorized (${toolName}) — likely token-cooldown after rate-limit`);
      return { __rateLimited: true };
    }
    console.error(`Finance API error (${toolName}):`, msg.substring(0, 300));
    return null;
  }
}

// Sleep helper
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Cache LLM-mode compatibility check.
// - cache._useLLM is `undefined` for analyses saved before the flag was added
//   (legacy caches from mid-April) — we treat those as compatible with BOTH
//   request types so old caches keep working as a fallback.
// - When the flag IS set (true/false), we require strict equality so a KI-on
//   request never gets back a KI-off cache (with sector-template catalysts).
function cacheLLMModeMatches(cachedUseLLM: boolean | undefined | null, requestedUseLLM: boolean): boolean {
  if (cachedUseLLM === undefined || cachedUseLLM === null) return true;
  return cachedUseLLM === requestedUseLLM;
}

// Throttled wrapper: serializes calls behind a small delay to avoid burst-limits,
// and on a 429 (or 401-after-429) backs off and retries up to 2 times with
// exponentially-rising delays. Returns null after exhausting retries so the
// caller's existing null-check still works.
// ── Daily Quota Guard ──────────────────────────────────────────────────────
// Perplexity Finance Connector has a daily limit (~20 full analyses).
// We cap at DAILY_FINANCE_LIMIT *full analyses* (8 calls each) = 160 calls max.
// The guard resets at midnight UTC. Cron jobs do NOT count (they use /api/health).
const DAILY_FINANCE_LIMIT = 18; // leave 2 as buffer; user gets ~18 real analyses/day
let _quotaDate = new Date().toDateString();
let _quotaCount = 0; // counts completed full analyses (not individual tool calls)

function incrementQuota() {
  const today = new Date().toDateString();
  if (today !== _quotaDate) { _quotaDate = today; _quotaCount = 0; } // midnight reset
  _quotaCount++;
  console.log(`[QUOTA] Finance analyses today: ${_quotaCount}/${DAILY_FINANCE_LIMIT}`);
}

function isQuotaExceeded(): boolean {
  const today = new Date().toDateString();
  if (today !== _quotaDate) { _quotaDate = today; _quotaCount = 0; }
  if (_quotaCount >= DAILY_FINANCE_LIMIT) {
    const resetHour = Math.ceil((24 - new Date().getUTCHours()));
    console.warn(`[QUOTA] Daily limit reached (${_quotaCount}/${DAILY_FINANCE_LIMIT}) — reset in ~${resetHour}h`);
    return true;
  }
  return false;
}

function getQuotaStatus() {
  const today = new Date().toDateString();
  if (today !== _quotaDate) { _quotaDate = today; _quotaCount = 0; }
  return { today: _quotaCount, limit: DAILY_FINANCE_LIMIT, remaining: Math.max(0, DAILY_FINANCE_LIMIT - _quotaCount) };
}
// ───────────────────────────────────────────────────────────────────────────

async function callFinanceToolThrottled(
  toolName: string,
  args: Record<string, any>,
  opts: { spacingMs?: number; maxRetries?: number } = {}
): Promise<any> {
  const spacingMs = opts.spacingMs ?? 300;
  const maxRetries = opts.maxRetries ?? 2;
  let attempt = 0;
  while (true) {
    const result = callFinanceTool(toolName, args);
    await sleep(spacingMs);
    if (result && result.__rateLimited) {
      if (attempt < maxRetries) {
        const backoffMs = 4000 * Math.pow(2, attempt); // 4s, 8s
        console.log(`[FINANCE-THROTTLE] ${toolName} rate-limited, backoff ${backoffMs}ms (retry ${attempt + 1}/${maxRetries})`);
        await sleep(backoffMs);
        attempt++;
        continue;
      }
      console.log(`[FINANCE-THROTTLE] ${toolName} still rate-limited after ${maxRetries} retries — giving up`);
      return null;
    }
    return result;
  }
}

// === FMP Fallback Data Fetcher ===
// Fetches all critical data from FMP in parallel when external-tool is unavailable.
// Returns a normalized object matching the shape expected by the analyze handler.
// Used as fallback when: BINARY_MISSING, RATE_LIMITED with no cache, or Railway deploy.
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
    // Fire all FMP calls in parallel — FMP has much higher rate limits than external-tool
    const settledAll = await Promise.allSettled([
      fmpBatchQuote([ticker]),      // 0: quote
      fmpProfile(ticker),           // 1: profile
      fmpIncomeStatement(ticker, 3),// 2: income
      fmpCashFlow(ticker, 3),       // 3: cashflow
      fmpBalanceSheet(ticker, 1),   // 4: balanceSheet
      fmpPriceTarget(ticker),       // 5: priceTarget
      fmpGrades(ticker, 20),        // 6: grades
      fmpAnalystEstimates(ticker, 3),// 7: estimates
      fmpHistoricalPrices(ticker,
        new Date(Date.now() - 2 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        new Date().toISOString().split('T')[0]
      ),                            // 8: ohlcv
      fmpSegments(ticker),          // 9: segments
      fmpPeers(ticker),             // 10: peers
      fmpRatios(ticker, 3),         // 11: ratios
      fmpKeyMetrics(ticker, 3),     // 12: keyMetrics (Layer 4 fix: was imported but never called)
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
        balanceSheet: get(balanceSheetRes) || [], // Bug 1 fix
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
    if (cells.every(c => /^[-:]+$/.test(c))) continue; // separator row

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
  // Handle abbreviated numbers: 1.2B, 500M, 3.5T, 100K
  let multiplier = 1;
  if (/[Tt]$/.test(cleaned)) { multiplier = 1e12; cleaned = cleaned.slice(0, -1); }
  else if (/[Bb]$/.test(cleaned)) { multiplier = 1e9; cleaned = cleaned.slice(0, -1); }
  else if (/[Mm]$/.test(cleaned)) { multiplier = 1e6; cleaned = cleaned.slice(0, -1); }
  else if (/[Kk]$/.test(cleaned)) { multiplier = 1e3; cleaned = cleaned.slice(0, -1); }
  // Handle parentheses for negative: (1234) → -1234
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
      // Simple CSV parse (handles quoted fields)
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
// Some companies are misclassified by data providers (e.g. AMZN = "Consumer Cyclical / Specialty Retail")
// but have major tech/cloud segments. Detect and reclassify based on description keywords.
// IMPORTANT: Use word-boundary-aware matching to avoid false positives (e.g. "Cloudy Bay" wine ≠ "cloud computing").
function getEffectiveSector(sector: string, industry: string, description: string): { sector: string; industry: string; isHybrid: boolean; hybridNote: string } {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();

  // Helper: match whole tech-relevant phrases only (not substrings within brand names)
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

  // Semiconductor companies misclassified as Financial Services by FMP (e.g. IFX.DE, ASML.AS)
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

  // AMZN-like: classified as Consumer Cyclical but has major cloud/tech business
  if ((s.includes("consumer") && (s.includes("cycl") || s.includes("discr"))) && hasTechCore) {
    return {
      sector: "Technology",
      industry: industry + " / Cloud & Tech Platform",
      isHybrid: true,
      hybridNote: `Reklassifiziert: API meldet "${sector}/${industry}", aber signifikanter Tech/Cloud-Anteil (AWS/Cloud) → Tech-Sektor-Defaults für DCF.`,
    };
  }

  // META/GOOG: Communication Services but really tech
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

  // FinTech / Super-App: classified as Tech but core business is payments/finance/marketplace
  // Excluded: semiconductor companies that happen to mention "payment" in their product descriptions
  // (e.g. IFX.DE makes chips *for* payment terminals — not a FinTech company)
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
    // Sub-classify: Luxury vs general consumer cyclical
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
// Generate company-specific catalyst context from description and financials
function generateCatalystContext(
  catalystName: string, sector: string, industry: string, description: string,
  growthRate: number, fcfMargin: number, revenue: number
): string {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();
  const revB = revenue > 0 ? `$${(revenue / 1e9).toFixed(1)}B` : '';
  const gr = growthRate.toFixed(1);

  // Extract key business keywords from description for context
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
    case 'Pipeline Approval / FDA Catalyst': {
      return `Phase-3-Ergebnisse und FDA-Entscheidungen zu Schlüssel-Kandidaten müssen positiv ausfallen. Erfolgreiche Zulassungen können Revenue-Sprung ermöglichen. Risiko: CRL, Partial Hold oder Labeling-Einschränkungen.`;
    }
    case 'Demographic Tailwind (Aging Population)': {
      return `Alternde Bevölkerung in Industrieländern treibt strukturell steigende Gesundheitsausgaben. Voraussetzung: Produktportfolio muss auf chronische Erkrankungen und Prävention ausgerichtet sein.`;
    }
    case 'China / Asia Demand Recovery': {
      return `China-Konsum muss sich von aktueller Schwäche erholen. Voraussetzung: Verbessertes Konsumklima, stabiler Immobilienmarkt und Vermögenseffekte. Aspirational Spending in Tier-2/3-Städten als zusätzlicher Treiber.`;
    }
    case 'Pricing Power / Brand Elevation': {
      return `Mid-Single-Digit Preiserhöhungen müssen ohne Volumen-Verluste durchgesetzt werden. Voraussetzung: Starke Markenbegehrlichkeit, kontrollierte Distribution und Exklusivitätsstrategie.`;
    }
    case 'Interest Rate Normalization Benefit': {
      return `Zinsnormalisierung muss Net Interest Margin verbessern. Voraussetzung: Einlagen-Repricing langsamer als Kredit-Repricing. Kreditnachfrage muss bei moderaten Zinsen anziehen.`;
    }
    case 'Capital Return / Buyback Program': {
      return `Aktienrückkaufprogramm und Dividendenerhöhungen müssen EPS-Wachstum über organischem Niveau treiben. Voraussetzung: Starke FCF-Generierung und konservative Kapitalallokation.`;
    }
    case 'Commodity Price Recovery': {
      return `Commodity-Preise müssen sich stabilisieren oder erholen. Voraussetzung: Globale Nachfrage-Erholung, Angebotsverknappung oder geopolitische Risikopremien. Breakeven-Analyse als Schlüssel.`;
    }
    case 'Energy Transition Investment': {
      return `Investments in Renewables, Carbon Capture oder LNG müssen langfristiges Wachstum jenseits fossiler Brennstoffe sichern. Voraussetzung: Regulatorische Klarheit und wettbewerbsfähige Projektrenditen.`;
    }
    case 'Consumer Confidence Recovery': {
      return `Konsumklima muss sich verbessern und diskretionenäre Ausgaben ansteigen. Voraussetzung: Sinkende Inflation, stabiler Arbeitsmarkt und Wealth-Effekte bei steigenden Asset-Preisen.`;
    }
    case 'E-Commerce / DTC Growth': {
      return `Direct-to-Consumer-Kanal muss überproportional wachsen und höhere Margen liefern. Voraussetzung: Digitale Kundenerfahrung, Fulfillment-Effizienz und personalisiertes Marketing.`;
    }
    case 'iGaming / Online Sports Betting Expansion': {
      return `iGaming- und Online-Sports-Betting-Legalisierung in neuen US-Bundesstaaten muss zusätzliche Umsatzquellen erschließen. Voraussetzung: Regulatorische Genehmigungen, Technologie-Plattform-Skalierung und Marketing-ROI in neuen Märkten. Revenue-Basis: ${revB}.`;
    }
    case 'New Property Openings / Capacity Expansion': {
      return `Neue Casino-Standorte, Hotel-Erweiterungen oder Renovierungen müssen Gaming-Revenue und Nicht-Gaming-Revenue (F&B, Hotel, Entertainment) steigern. Voraussetzung: Termingerechte Baufertigstellung, Genehmigungen und regionaler Nachfrage-Support.`;
    }
    case 'Same-Store Sales Recovery / Menu Pricing': {
      return `Comparable-Sales müssen durch Traffic-Recovery und strategische Preiserhöhungen steigen. Voraussetzung: Stabile Konsumausgaben, erfolgreiche Menü-Innovation und nicht-inflationsgetriebene Ticket-Steigerung.`;
    }
    case 'Unit Growth / Franchise Expansion': {
      return `Netto-Neueröffnungen müssen System-Revenue-Wachstum treiben. Voraussetzung: Verfügbare Franchise-Nehmer, attraktive Unit Economics und Genehmigungen in Zielmärkten.`;
    }
    case 'Travel Demand Recovery / RevPAR Growth': {
      return `RevPAR (Revenue per Available Room) muss durch höhere Auslastung und ADR steigen. Voraussetzung: Erholung der Reisenachfrage, Corporate-Travel-Normalisierung und Events-Pipeline.`;
    }
    case 'Loyalty Program Monetization': {
      return `Treueprogramm muss höheren Customer Lifetime Value generieren durch Cross-Selling (Kreditkarten, Partner-Deals) und erhöhte Direktbuchungen. Voraussetzung: Wachsende Mitgliederbasis und attraktive Einlöse-Optionen.`;
    }
    case 'EV Transition / New Model Cycle': {
      return `EV-Modellpalette muss Marktanteile im wachsenden Elektro-Segment gewinnen. Voraussetzung: Konkurrenzfähige Reichweite, Preis-Leistung und Ladeinfrastruktur-Verfügbarkeit. Neuer Modellzyklus als Volumenhebel.`;
    }
    case 'Supply Chain Normalization / Volume Recovery': {
      return `Normalisierung der Lieferketten muss Produktionsvolumen steigern und Auftragsrückstände abbauen. Voraussetzung: Chip-Verfügbarkeit, Logistik-Normalisierung und Lagerbestandsoptimierung.`;
    }
    case 'Market Share Gains': {
      return `Marktanteile müssen durch Produktinnovation, Pricing und Distribution ausgebaut werden. Voraussetzung: Wettbewerbsvorteile in Qualität, Service oder Kostenstruktur.`;
    }
    case 'Strategic M&A / Partnerships': {
      return `Strategische Akquisitionen oder Partnerschaften müssen Technologie, Marktpräsenz oder Kundenbeziehungen ergänzen. Voraussetzung: Disziplinierte Kapitalallokation und Integrations-Exzellenz.`;
    }
    default:
      return `Katalysator muss sich im Geschäftsmodell-Kontext materialisieren. Voraussetzung: Erfolgreiche Umsetzung der strategischen Prioritäten und günstiges Marktumfeld.`;
  }
}

// === Peer Comparison Fetcher ===
async function fetchPeerComparison(
  ticker: string, companyName: string, pe: number, peg: number, revenue: number,
  marketCap: number, revenueGrowth: number, epsGrowth5Y: number
): Promise<{ subject: any; peers: any[]; peerAvg: any } | null> {
  try {
    // Step 1: Get peer tickers via finance API (throttled like main calls)
    console.log(`[PEERS] Fetching peers for ${ticker}`);
    const peersResult = await callFinanceToolThrottled('finance_company_peers', {
      ticker_symbol: ticker,
      query: `Competitors of ${companyName}`,
      action: `Finding peer companies for ${ticker}`,
    }, { maxRetries: 1 }); // peer fetch is non-critical — fewer retries

    let peerTickers: string[] = [];
    if (peersResult?.content) {
      // Parse peer tickers from markdown/text response
      const content = typeof peersResult.content === 'string' ? peersResult.content : JSON.stringify(peersResult.content);
      // Match ticker symbols (uppercase letters, 1-5 chars, possibly with dots)
      const tickerMatches = content.match(/\b[A-Z]{1,5}(?:\.[A-Z]{1,2})?\b/g) || [];
      // Filter common non-ticker words
      const skipWords = new Set(['THE', 'AND', 'FOR', 'USD', 'ETF', 'CEO', 'CFO', 'IPO', 'NYSE', 'NASDAQ', 'SEC', 'INC', 'LTD', 'LLC', 'NV', 'SA', 'AG', 'PLC', 'SE', 'CO', 'PEER', 'VS', 'EPS', 'PE', 'PEG', ticker]);
      peerTickers = [...new Set(tickerMatches.filter(t => t.length >= 2 && !skipWords.has(t)))].slice(0, 8);
    }

    if (peerTickers.length === 0) {
      console.log(`[PEERS] No peers found for ${ticker}`);
      return null;
    }
    console.log(`[PEERS] Found peers for ${ticker}: ${peerTickers.join(', ')}`);

    // Step 2: Fetch ratios for all peers in one call (including EPS for growth calc)
    const ratioIds = [
      'ratio_price_to_earnings', 'ratio_price_to_sales', 'ratio_price_to_book',
      'ratio_diluted_eps', 'calculated_market_cap',
    ];
    const ratiosResult = await callFinanceToolThrottled('finance_company_ratios', {
      ticker_symbols: peerTickers,
      ratio_ids: ratioIds,
    }, { maxRetries: 1 });

    // Also get quotes for live P/E
    const quotesResult = await callFinanceToolThrottled('finance_quotes', {
      ticker_symbols: peerTickers,
      fields: ['pe', 'marketCap', 'eps', 'price'],
    }, { maxRetries: 1 });

    // Parse ratios — the API returns per-company sections with time-series tables
    // Format: "## TICKER Company Ratios\n| date | ratio_pe | ratio_ps | ratio_pb |\n..."
    const peerData: Map<string, any> = new Map();
    if (ratiosResult?.content) {
      const content = typeof ratiosResult.content === 'string' ? ratiosResult.content : JSON.stringify(ratiosResult.content);
      const sections = content.split(/##\s+/);
      for (const section of sections) {
        if (!section.trim()) continue;
        const headerMatch = section.match(/^([A-Z]{1,6})(?:\.[A-Z]{1,2})?\s/);
        if (!headerMatch) continue;
        const t = headerMatch[1];
        if (!peerData.has(t)) peerData.set(t, { epsHistory: [] as { date: string; eps: number }[] });
        const d = peerData.get(t)!;
        if (!d.epsHistory) d.epsHistory = [];

        const rows = parseMarkdownTable(section);
        // Collect (date, value) pairs per metric so we can pick the MOST RECENT non-zero value
        // (Without this, whichever row iterated last wins, which may be the oldest quarter
        // depending on API sort order → stale P/E, P/S, P/B, Market Cap.)
        const metricBuckets: Record<string, { date: string; value: number }[]> = {
          pe: [], ps: [], pb: [], marketCap: [], eps: [],
        };
        for (const row of rows) {
          const date = row['date'] || '';
          for (const [key, val] of Object.entries(row)) {
            const kl = key.toLowerCase();
            const num = parseFloat(String(val).replace(/[,$%]/g, ''));
            if (isNaN(num)) continue;
            if (kl.includes('price_to_earnings') || kl.includes('p/e')) metricBuckets.pe.push({ date, value: num });
            else if (kl.includes('price_to_sales') || kl.includes('p/s')) metricBuckets.ps.push({ date, value: num });
            else if (kl.includes('price_to_book') || kl.includes('p/b')) metricBuckets.pb.push({ date, value: num });
            else if (kl.includes('market_cap') || kl.includes('marketcap')) metricBuckets.marketCap.push({ date, value: num });
            else if (kl.includes('diluted_eps') || kl.includes('eps')) {
              metricBuckets.eps.push({ date, value: num });
              if (date && num !== 0) d.epsHistory.push({ date, eps: num });
            }
          }
        }
        // Pick the most recent non-zero value for each metric (lexicographic date sort works for YYYY-MM-DD)
        const pickLatest = (bucket: { date: string; value: number }[]): number | undefined => {
          const valid = bucket.filter(x => x.value !== 0 && x.date);
          if (!valid.length) {
            const anyVal = bucket.find(x => x.value !== 0);
            return anyVal?.value;
          }
          valid.sort((a, b) => b.date.localeCompare(a.date));
          return valid[0].value;
        };
        const latestPE = pickLatest(metricBuckets.pe);
        const latestPS = pickLatest(metricBuckets.ps);
        const latestPB = pickLatest(metricBuckets.pb);
        const latestMcap = pickLatest(metricBuckets.marketCap);
        const latestEPS = pickLatest(metricBuckets.eps);
        if (latestPE !== undefined) d.pe = latestPE;
        if (latestPS !== undefined) d.ps = latestPS;
        if (latestPB !== undefined) d.pb = latestPB;
        if (latestMcap !== undefined) d.marketCap = latestMcap;
        if (latestEPS !== undefined) d.eps = latestEPS;
      }
    }

    // Parse quotes for live data — the API returns one `## TICKER Quote` section per symbol,
    // each with its own markdown table. Split by section headers (same strategy as ratios),
    // otherwise parseMarkdownTable would only pick up the first table. Live quotes OVERRIDE
    // the time-series ratio P/E so peer numbers match the latest market price (MSFT, SAP, etc.).
    if (quotesResult?.content) {
      const qContent = typeof quotesResult.content === 'string' ? quotesResult.content : JSON.stringify(quotesResult.content);
      const qSections = qContent.split(/##\s+/);
      for (const section of qSections) {
        if (!section.trim()) continue;
        const qHeader = section.match(/^([A-Z]{1,6})(?:\.[A-Z]{1,2})?\s+Quote/);
        if (!qHeader) continue;
        const t = qHeader[1];
        if (!peerData.has(t)) peerData.set(t, { epsHistory: [] as any[] });
        const d = peerData.get(t)!;
        const qRows = parseMarkdownTable(section);
        for (const row of qRows) {
          for (const [key, val] of Object.entries(row)) {
            const kl = key.toLowerCase();
            const rawStr = String(val).trim();
            const num = parseFloat(rawStr.replace(/[,$%]/g, ''));
            if (kl === 'pe' || kl === 'p/e') {
              if (!isNaN(num) && num > 0) d.pe = num; // live quote PE (overrides stale ratios)
            } else if (kl.includes('marketcap') || kl.includes('market_cap') || kl === 'mktcap') {
              // Support raw numbers (e.g. "3087205672500") and B/T suffixes
              if (rawStr.endsWith('T')) d.marketCap = parseFloat(rawStr) * 1e12;
              else if (rawStr.endsWith('B')) d.marketCap = parseFloat(rawStr) * 1e9;
              else if (!isNaN(num) && num > 0) d.marketCap = num;
            } else if (kl === 'eps') {
              if (!isNaN(num) && num !== 0) d.eps = num; // live EPS
            } else if (kl === 'price') {
              if (!isNaN(num) && num > 0) d.price = num;
            }
          }
        }
      }
    }

    // Step 3: Build peer company objects with EPS growth calculation
    const peers: any[] = [];
    for (const t of peerTickers) {
      const d = peerData.get(t);
      if (!d) continue;
      const peerPE = d.pe || null;

      // Compute EPS Growth 1Y and 5Y from EPS history
      let epsGrowth1Y: number | null = null;
      let epsGrowth5Y_peer: number | null = null;
      const history: { date: string; eps: number }[] = (d.epsHistory || []).filter((h: any) => h.eps > 0);
      if (history.length >= 2) {
        // Sort by date ascending
        history.sort((a: any, b: any) => a.date.localeCompare(b.date));
        const latest = history[history.length - 1];
        const prev = history[history.length - 2];
        // 1Y growth
        if (prev.eps > 0 && latest.eps > 0) {
          epsGrowth1Y = +((latest.eps / prev.eps - 1) * 100).toFixed(1);
        }
        // 5Y CAGR: find EPS from ~5 years ago
        if (history.length >= 3) {
          const targetIdx = Math.max(0, history.length - 6); // ~5Y back
          const old = history[targetIdx];
          const years = Math.max(1, history.length - 1 - targetIdx);
          if (old.eps > 0 && latest.eps > 0) {
            epsGrowth5Y_peer = +(((latest.eps / old.eps) ** (1 / years) - 1) * 100).toFixed(1);
          }
        }
      }

      // PEG = P/E / EPS Growth 5Y
      const growthForPEG = epsGrowth5Y_peer && epsGrowth5Y_peer > 0 ? epsGrowth5Y_peer : (epsGrowth5Y > 0 ? epsGrowth5Y : null);
      const peerPEG = peerPE && growthForPEG && growthForPEG > 0 ? +(peerPE / growthForPEG).toFixed(2) : null;

      peers.push({
        ticker: t,
        name: t,
        pe: peerPE ? +peerPE.toFixed(1) : null,
        peg: peerPEG,
        ps: d.ps ? +d.ps.toFixed(1) : null,
        pb: d.pb ? +d.pb.toFixed(1) : null,
        epsGrowth1Y,
        epsGrowth5Y: epsGrowth5Y_peer,
        marketCap: d.marketCap || null,
        revenueGrowth: null,
      });
    }

    // Filter out peers with no data
    const validPeers = peers.filter(p => p.pe !== null || p.ps !== null || p.pb !== null).slice(0, 6);
    console.log(`[PEERS] Valid peers with data: ${validPeers.length} of ${peers.length} (${validPeers.map(p => p.ticker).join(', ')})`);
    if (validPeers.length === 0) {
      console.log(`[PEERS] All peers had null data. Raw peerData keys: ${[...peerData.keys()].join(', ')}`);
      return null;
    }

    // Step 4: Calculate averages
    const avg = (arr: (number | null)[]): number | null => {
      const valid = arr.filter((v): v is number => v !== null && !isNaN(v) && isFinite(v) && v > 0 && v < 1000);
      return valid.length > 0 ? +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2) : null;
    };

    const ps = revenue > 0 && marketCap > 0 ? +(marketCap / revenue).toFixed(1) : null;
    const subject = {
      ticker, name: companyName,
      pe: pe > 0 ? +pe.toFixed(1) : null,
      peg: peg > 0 ? +peg.toFixed(2) : null,
      ps,
      pb: null as number | null, // Will be filled if we have book value
      epsGrowth1Y: null as number | null, // Will be filled from financial statements
      epsGrowth5Y: epsGrowth5Y > 0 ? +epsGrowth5Y.toFixed(1) : null,
      marketCap,
      revenueGrowth: +revenueGrowth.toFixed(1),
    };

    // Step 5: Fetch subject EPS history + forward estimates for chart
    let epsHistory: { year: number; eps: number; isEstimate: boolean }[] = [];
    let peerAvgEpsHistory: { year: number; eps: number; isEstimate: boolean }[] = [];
    try {
      // Fetch subject historical EPS
      const subjectRatiosResult = await callFinanceToolThrottled('finance_company_ratios', {
        ticker_symbols: [ticker],
        ratio_ids: ['ratio_diluted_eps'],
      });
      if (subjectRatiosResult?.content) {
        const content = typeof subjectRatiosResult.content === 'string' ? subjectRatiosResult.content : JSON.stringify(subjectRatiosResult.content);
        const rows = parseMarkdownTable(content);
        for (const row of rows) {
          const date = row['date'] || '';
          const yearMatch = date.match(/(\d{4})/);
          if (!yearMatch) continue;
          const year = parseInt(yearMatch[1]);
          const epsVal = parseFloat(String(row['ratio_diluted_eps'] || '').replace(/[,$]/g, ''));
          if (!isNaN(epsVal) && epsVal > 0 && year >= 2015) {
            epsHistory.push({ year, eps: +epsVal.toFixed(2), isEstimate: false });
          }
        }
      }

      // Fetch subject forward estimates
      const estimatesResult = await callFinanceToolThrottled('finance_estimates', {
        ticker_symbols: [ticker],
        period_type: 'annual',
      });
      if (estimatesResult?.content) {
        const content = typeof estimatesResult.content === 'string' ? estimatesResult.content : JSON.stringify(estimatesResult.content);
        const rows = parseMarkdownTable(content);
        for (const row of rows) {
          const date = row['date'] || '';
          const yearMatch = date.match(/(\d{4})/);
          if (!yearMatch) continue;
          const year = parseInt(yearMatch[1]);
          const epsVal = parseFloat(String(row['key_stats_diluted_eps'] || '').replace(/[,$]/g, ''));
          if (!isNaN(epsVal) && epsVal > 0) {
            // Only add if not already in history (avoid duplicates)
            if (!epsHistory.some(h => h.year === year)) {
              epsHistory.push({ year, eps: +epsVal.toFixed(2), isEstimate: true });
            }
          }
        }
      }
      epsHistory.sort((a, b) => a.year - b.year);

      // Build peer average EPS history from peerData epsHistory
      if (epsHistory.length > 0) {
        const peerHistories: Map<number, number[]> = new Map();
        for (const p of validPeers) {
          const pd = peerData.get(p.ticker);
          if (!pd?.epsHistory) continue;
          for (const h of pd.epsHistory as { date: string; eps: number }[]) {
            const ym = h.date.match(/(\d{4})/);
            if (!ym) continue;
            const yr = parseInt(ym[1]);
            if (yr < 2015 || h.eps <= 0) continue;
            if (!peerHistories.has(yr)) peerHistories.set(yr, []);
            peerHistories.get(yr)!.push(h.eps);
          }
        }
        // Only include years where we have at least 2 peers
        for (const [yr, vals] of peerHistories) {
          if (vals.length >= 2) {
            const avgEps = +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
            peerAvgEpsHistory.push({ year: yr, eps: avgEps, isEstimate: false });
          }
        }
        peerAvgEpsHistory.sort((a, b) => a.year - b.year);
      }
      console.log(`[PEERS] EPS history: ${epsHistory.length} points (${epsHistory.filter(h => h.isEstimate).length} estimates), peer avg: ${peerAvgEpsHistory.length} points`);
    } catch (epsErr: any) {
      console.log(`[PEERS] EPS history fetch failed: ${epsErr?.message?.substring(0, 150)}`);
    }

    console.log(`[PEERS] Built ${validPeers.length} peer comparisons for ${ticker}`);

    // Exclude base-effect outliers from peer averages: an EPS 1Y growth > +80% or < -60%
    // is almost always a recovery from a write-down year and not representative of organic growth.
    // We still display the raw value per peer in the table, but the aggregate uses only clean observations.
    const cleanEps1Y = (v: number | null) => v != null && v > -60 && v < 80;
    const cleanEps5Y = (v: number | null) => v != null && v > -30 && v < 60;

    return {
      subject,
      peers: validPeers,
      peerAvg: {
        pe: avg(validPeers.map(p => p.pe)),
        peg: avg(validPeers.map(p => p.peg)),
        ps: avg(validPeers.map(p => p.ps)),
        pb: avg(validPeers.map(p => p.pb)),
        epsGrowth1Y: avg(validPeers.filter(p => cleanEps1Y(p.epsGrowth1Y)).map(p => p.epsGrowth1Y)),
        epsGrowth5Y: avg(validPeers.filter(p => cleanEps5Y(p.epsGrowth5Y)).map(p => p.epsGrowth5Y)),
      },
      epsHistory: epsHistory.length > 0 ? epsHistory : undefined,
      peerAvgEpsHistory: peerAvgEpsHistory.length > 0 ? peerAvgEpsHistory : undefined,
    };
  } catch (err: any) {
    console.log(`[PEERS] Peer comparison failed for ${ticker}: ${err?.message?.substring(0, 200)}`);
    return null;
  }
}

// === Google News RSS Parser ===
async function fetchNewsFromGoogleRSS(ticker: string, companyName: string): Promise<{ title: string; source: string; pubDate: string; url: string; relativeTime: string; lang?: string }[]> {
  const shortName = companyName.replace(/,? (Inc|Corp|Ltd|LLC|plc|SE|NV|SA|AG|Co)\.?.*$/i, '').trim();

  // Helper: parse items from a single RSS XML response
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

  // Fetch a single RSS feed
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
    // EN: International English news
    const enQuery = encodeURIComponent(`${ticker} ${shortName} stock`);
    const enUrl = `https://news.google.com/rss/search?q=${enQuery}&hl=en-US&gl=US&ceid=US:en`;

    // DE: German-language news (Finanzen.net, Wallstreet Online, boerse.de, etc.)
    const deQuery = encodeURIComponent(`${shortName} Aktie`);
    const deUrl = `https://news.google.com/rss/search?q=${deQuery}&hl=de&gl=DE&ceid=DE:de`;

    console.log(`[NEWS] Fetching EN + DE Google News RSS for ${ticker}`);
    const [enXml, deXml] = await Promise.all([
      fetchFeed(enUrl, `EN-RSS ${ticker}`),
      fetchFeed(deUrl, `DE-RSS ${ticker}`),
    ]);

    const enItems = parseRssItems(enXml, 'en', 5);
    const deItems = parseRssItems(deXml, 'de', 5);

    // Merge and deduplicate by normalized title similarity
    const allItems = [...enItems, ...deItems];
    const seen = new Set<string>();
    const dedupItems = allItems.filter(item => {
      const norm = item.title.toLowerCase().replace(/[^a-z0-9äöüß]/g, '').substring(0, 40);
      if (seen.has(norm)) return false;
      seen.add(norm);
      return true;
    });

    // Sort by date (newest first), take top 10
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
// Keyword-based news-to-catalyst matching (no LLM needed, always works)
// Used in the non-LLM path so news badges appear in Section 15 even without KI-Analyse
async function matchNewsToCatalysts(
  newsItems: { title: string; source: string; pubDate: string; url: string; relativeTime: string; sentiment?: string; sentimentScore?: number; matchedCatalyst?: string; matchedCatalystIdx?: number }[],
  catalysts: Catalyst[],
  _ticker?: string,
  _companyName?: string
): Promise<void> {
  if (!newsItems.length || !catalysts.length) return;

  // Bullish/bearish keyword scoring
  const BULLISH_WORDS = ['beat','surpass','record','growth','surge','rally','upgrade','buy','outperform','strong','profit','win','award','launch','expand','positive','exceed'];
  const BEARISH_WORDS = ['miss','fall','drop','decline','cut','downgrade','sell','underperform','weak','loss','fine','penalty','recall','delay','concern','risk','layoff','warn'];

  // Catalyst keyword map — maps catalyst name fragments to related news keywords
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

  // Build keyword sets per catalyst from CATALYST_KEYWORDS
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

    // Sentiment scoring via keywords
    const bullishHits = BULLISH_WORDS.filter(w => titleLower.includes(w)).length;
    const bearishHits = BEARISH_WORDS.filter(w => titleLower.includes(w)).length;
    const total = bullishHits + bearishHits;
    const rawScore = total > 0 ? (bullishHits - bearishHits) / total : 0;
    item.sentimentScore = Math.max(-1, Math.min(1, rawScore));
    item.sentiment = rawScore > 0.1 ? 'bullish' : rawScore < -0.1 ? 'bearish' : 'neutral';

    // Match to best catalyst by keyword hits
    let bestCatIdx = -1;
    let bestScore = 0;
    for (let ci = 0; ci < catalysts.length; ci++) {
      const hits = catKeywords[ci].filter(kw => titleLower.includes(kw)).length;
      if (hits > bestScore) { bestScore = hits; bestCatIdx = ci; }
    }
    // Accept match if at least 1 keyword hit (lower threshold for broader coverage)
    if (bestCatIdx >= 0 && bestScore >= 1) {
      item.matchedCatalyst = catalysts[bestCatIdx].name;
      item.matchedCatalystIdx = bestCatIdx;
    } else {
      // Fallback: match based on bullish/bearish sentiment alone — assign to K1 (revenue)
      // This ensures all strong-sentiment news gets linked to at least one catalyst
      if (Math.abs(rawScore) > 0.3 && catalysts.length > 0) {
        item.matchedCatalyst = catalysts[0].name;
        item.matchedCatalystIdx = 0;
      }
    }
  }

  // Aggregate per catalyst
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
    const adjustment = Math.round(avgScore * 5); // max ±5 points (conservative vs LLM ±7)
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
      model: 'claude_sonnet_4_6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = (message.content[0] as any)?.text || '';
    // Parse JSON — handle potential markdown wrapping
    let jsonStr = responseText.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const rawCatalysts = JSON.parse(jsonStr);

    if (!Array.isArray(rawCatalysts) || rawCatalysts.length < 3) {
      console.log(`[ANALYZE] LLM returned invalid catalyst array for ${ticker}`);
      return null;
    }

    // Convert to Catalyst format with calculated fields
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

/**
 * Berechnet den Einpreisungsgrad via Reverse-DCF.
 * Grundidee: Wie viel % Wachstum ist im aktuellen Kurs bereits eingepreist?
 * Je höher das implizite Wachstum vs. dem Catalyst-Upside, desto mehr ist schon drin.
 *
 * Methode:
 * 1. Implied Growth Rate = aus Forward P/E vs. Sektor-Median P/E ableiten
 * 2. Einpreisungsgrad = clamp(impliedGrowth / catalystBruttoUpside, 0.15, 0.70)
 *
 * Fallback wenn keine PE-Daten: Heuristik nach Katalysatorklasse
 */
function calcEinpreisungsgrad(params: {
  bruttoUpside: number;        // z.B. 22 für +22%
  forwardPE: number;           // Forward P/E der Aktie
  sectorMedianPE: number;      // Sektor-Median Forward P/E
  revenueGrowth: number;       // Revenue-Wachstum %
  catalystType?: string;       // "growth"|"margin"|"product"|"ai"|"macro" für Fallback
}): number {
  const { bruttoUpside, forwardPE, sectorMedianPE, revenueGrowth, catalystType } = params;

  // Wenn Forward PE vorhanden: Reverse-DCF Methode
  if (forwardPE > 0 && sectorMedianPE > 0 && bruttoUpside > 0) {
    // Premium über Sektor-Median = bereits eingepreiste Wachstumserwartung
    const pePremium = Math.max(0, (forwardPE - sectorMedianPE) / sectorMedianPE); // z.B. 0.30 = 30% Premium
    // Implied eingepreiste Wachstumserwartung in % (normiert auf catalyst brutto upside)
    // Ein hohes PE-Premium bedeutet: viel ist schon drin
    const impliedPriced = Math.min(pePremium * 100, bruttoUpside * 0.8); // max 80% des Upside
    const einpreisungsgrad = impliedPriced / bruttoUpside; // als Anteil 0-1
    return Math.round(Math.max(0.15, Math.min(0.70, einpreisungsgrad)) * 100); // als %
  }

  // Fallback: Revenue-Growth-basiert (wenn PE nicht verfügbar)
  // Hohes Wachstum → mehr bereits im Kurs eingepreist
  const growthFactor = Math.min(revenueGrowth / 30, 1.0); // normiert auf 30% als "viel"
  const baseRate: Record<string, number> = {
    growth:  35 + Math.round(growthFactor * 20),  // 35-55%
    margin:  30 + Math.round(growthFactor * 15),  // 30-45%
    product: 25 + Math.round(growthFactor * 15),  // 25-40%
    ai:      45 + Math.round(growthFactor * 20),  // 45-65%
    macro:   35,
  };
  return baseRate[catalystType || 'growth'] ?? 35;
}

type LynchClass = 'slow_grower' | 'stalwart' | 'fast_grower' | 'cyclical' | 'turnaround' | 'asset_play';

function classifyLynch(params: {
  epsGrowth5Y: number;
  revenueGrowth: number;
  sector: string;
  industry: string;
  dividendYield: number;
  fcfMargin: number;
  pe: number;
  forwardPE: number;
}): LynchClass {
  const { epsGrowth5Y, revenueGrowth, sector, industry, dividendYield, pe, forwardPE } = params;

  const growthRate = epsGrowth5Y > 0 ? epsGrowth5Y : revenueGrowth;
  const sectorLower = (sector + ' ' + industry).toLowerCase();

  // Cyclicals: Halbleiter, Energie, Rohstoffe, Auto — erkennbar am hohen Trailing PE bei niedrigem Forward PE
  const isCyclicalSector = ['semiconductor', 'energy', 'oil', 'gas', 'material', 'chemical', 'steel', 'mining', 'auto', 'automotive', 'chip'].some(s => sectorLower.includes(s));
  const hasCyclicalPEPattern = pe > 0 && forwardPE > 0 && pe / forwardPE > 1.5; // Trailing >> Forward = Recovery-Erwartung
  if (isCyclicalSector || hasCyclicalPEPattern) return 'cyclical';

  // Turnaround: negative Earnings aber positive Forward-Erwartung
  if (pe <= 0 && forwardPE > 0) return 'turnaround';
  if (pe > 0 && pe > 100 && forwardPE > 0 && forwardPE < 30) return 'turnaround'; // extreme PE-Normalisierung erwartet

  // Fast Growers: >20% EPS oder Revenue-Wachstum
  if (growthRate >= 20) return 'fast_grower';

  // Slow Growers: <5% Wachstum (oft Dividendenzahler)
  if (growthRate < 5 || (growthRate < 8 && dividendYield > 2)) return 'slow_grower';

  // Stalwarts: 5-20% stabiles Wachstum
  return 'stalwart';
}

function calcLynchPEG(params: {
  lynchClass: LynchClass;
  pe: number;
  forwardPE: number;
  epsGrowth5Y: number;
  epsGrowthFwd: number;           // Forward 1Y EPS growth
  revenueGrowth: number;
  dividendYield: number;
  epsPeak?: number;               // für Cyclicals
  epsTrough?: number;             // für Cyclicals
  price?: number;                 // für Cyclicals mid-cycle PE
}): { peg: number | null; pegBasis: string } {
  const { lynchClass, pe, forwardPE, epsGrowth5Y, epsGrowthFwd, revenueGrowth, dividendYield, epsPeak, epsTrough, price } = params;

  switch (lynchClass) {
    case 'fast_grower':
    case 'turnaround': {
      // Forward P/E ÷ Forward EPS Growth (1Y oder 3Y Konsensus)
      const growth = epsGrowthFwd > 0 ? epsGrowthFwd : (epsGrowth5Y > 0 ? epsGrowth5Y : revenueGrowth);
      if (forwardPE > 0 && growth > 0) return { peg: +(forwardPE / growth).toFixed(2), pegBasis: 'Forward P/E ÷ Fwd EPS Growth' };
      return { peg: null, pegBasis: 'Kein posit. Wachstum' };
    }

    case 'cyclical': {
      // Mid-Cycle normalisiertes PE ÷ Forward EPS CAGR
      let normalizedPE = forwardPE > 0 ? forwardPE : pe;
      if (epsPeak && epsPeak > 0 && epsTrough && epsTrough > 0 && price && price > 0) {
        const midCycleEPS = (epsPeak + epsTrough) / 2;
        if (midCycleEPS > 0) normalizedPE = +(price / midCycleEPS).toFixed(1);
      }
      const growth = epsGrowthFwd > 0 ? epsGrowthFwd : revenueGrowth;
      if (normalizedPE > 0 && growth > 0) return { peg: +(normalizedPE / growth).toFixed(2), pegBasis: 'Norm. P/E (Mid-Cycle) ÷ Fwd EPS Growth' };
      return { peg: null, pegBasis: 'Zykliker — PEG eingeschränkt aussagekräftig' };
    }

    case 'slow_grower': {
      // PEGY: Forward P/E ÷ (Fwd EPS Growth + Dividend Yield)
      const basePE = forwardPE > 0 ? forwardPE : pe;
      const baseGrowth = epsGrowthFwd > 0 ? epsGrowthFwd : (epsGrowth5Y > 0 ? epsGrowth5Y : revenueGrowth);
      const totalReturn = baseGrowth + dividendYield;
      if (basePE > 0 && totalReturn > 0) return { peg: +(basePE / totalReturn).toFixed(2), pegBasis: 'PEGY = Fwd P/E ÷ (Fwd EPS Growth + Dividende)' };
      return { peg: null, pegBasis: 'PEGY nicht berechenbar' };
    }

    case 'stalwart':
    default: {
      // Yahoo Finance Standard: Forward P/E ÷ Forward EPS Growth (bevorzugt)
      // Fallback: Forward P/E ÷ Revenue Growth, dann P/E ÷ 5Y EPS CAGR
      const bestPE = forwardPE > 0 ? forwardPE : pe;
      const bestGrowth =
        epsGrowthFwd > 0 ? epsGrowthFwd :
        epsGrowth5Y > 0  ? epsGrowth5Y  :
        revenueGrowth;
      const basis =
        forwardPE > 0 && epsGrowthFwd > 0 ? 'Forward P/E ÷ Fwd EPS Growth' :
        forwardPE > 0                      ? 'Forward P/E ÷ Revenue Growth' :
                                             'P/E ÷ 5Y EPS CAGR';
      if (bestPE > 0 && bestGrowth > 0) return { peg: +(bestPE / bestGrowth).toFixed(2), pegBasis: basis };
      return { peg: null, pegBasis: 'Nicht berechenbar' };
    }
  }
}

// === Fallback: Sector-Template Catalysts (used when LLM is unavailable) ===
function generateCatalysts(sector: string, industry: string, growthRate: number, fcfMargin: number, description: string = '', revenue: number = 0, forwardPE: number = 0, sectorMedianPE: number = 0, revenueGrowth: number = 0): Catalyst[] {
  const catalysts: Catalyst[] = [];
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();

  // Revenue growth catalyst
  const revenuePos = Math.min(85, 40 + growthRate * 2);
  catalysts.push({
    name: "Revenue Growth Acceleration",
    timeline: growthRate > 15 ? "6-12M" : "12-18M",
    pos: Math.round(revenuePos),
    bruttoUpside: Math.round(Math.min(25, 5 + growthRate * 0.8)),
    einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: Math.round(Math.min(25, 5 + growthRate * 0.8)), forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'growth' }),
    nettoUpside: 0, gb: 0,
    context: generateCatalystContext("Revenue Growth Acceleration", sector, industry, description, growthRate, fcfMargin, revenue),
  });

  // Margin expansion
  const marginPos = fcfMargin > 20 ? 55 : fcfMargin > 10 ? 45 : 35;
  catalysts.push({
    name: "Margin Expansion / Operating Leverage",
    timeline: "12-24M",
    pos: marginPos,
    bruttoUpside: Math.round(8 + (30 - fcfMargin) * 0.3),
    einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: Math.round(8 + (30 - fcfMargin) * 0.3), forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'margin' }),
    nettoUpside: 0, gb: 0,
    context: generateCatalystContext("Margin Expansion / Operating Leverage", sector, industry, description, growthRate, fcfMargin, revenue),
  });

  // Sector-specific catalysts
  if (s.includes("tech")) {
    catalysts.push({
      name: "AI / Cloud Adoption Tailwind",
      timeline: "6-18M",
      pos: 60,
      bruttoUpside: 15,
      einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 15, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'ai' }),
      nettoUpside: 0, gb: 0,
      context: "",
    });
    catalysts.push({
      name: "Product Cycle / Platform Expansion",
      timeline: "12-24M",
      pos: 45,
      bruttoUpside: 12,
      einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 12, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'product' }),
      nettoUpside: 0, gb: 0,
      context: "",
    });
  } else if (s.includes("health")) {
    catalysts.push({
      name: "Pipeline Approval / FDA Catalyst",
      timeline: "6-18M",
      pos: 35,
      bruttoUpside: 25,
      einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 25, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'product' }),
      nettoUpside: 0, gb: 0,
      context: "",
    });
    catalysts.push({
      name: "Demographic Tailwind (Aging Population)",
      timeline: "12-36M",
      pos: 70,
      bruttoUpside: 8,
      einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 8, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'macro' }),
      nettoUpside: 0, gb: 0,
      context: "",
    });
  } else if (s.includes("financ")) {
    catalysts.push({
      name: "Interest Rate Normalization Benefit",
      timeline: "6-12M",
      pos: 50,
      bruttoUpside: 12,
      einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 12, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'macro' }),
      nettoUpside: 0, gb: 0,
      context: "",
    });
    catalysts.push({
      name: "Capital Return / Buyback Program",
      timeline: "0-12M",
      pos: 65,
      bruttoUpside: 8,
      einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 8, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'margin' }),
      nettoUpside: 0, gb: 0,
      context: "",
    });
  } else if (s.includes("energy")) {
    catalysts.push({
      name: "Commodity Price Recovery",
      timeline: "6-18M",
      pos: 40,
      bruttoUpside: 20,
      einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 20, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'macro' }),
      nettoUpside: 0, gb: 0,
      context: "",
    });
    catalysts.push({
      name: "Energy Transition Investment",
      timeline: "12-36M",
      pos: 45,
      bruttoUpside: 15,
      einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 15, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'product' }),
      nettoUpside: 0, gb: 0,
      context: "",
    });
  } else if (s.includes("consumer") && (s.includes("cycl") || s.includes("discr"))) {
    const isLuxury = ind.includes("luxury") || ind.includes("apparel") || ind.includes("fashion");
    const isCasino = ind.includes("gambling") || ind.includes("casino") || ind.includes("resort") || description.toLowerCase().includes("casino") || description.toLowerCase().includes("gaming entertainment");
    const isRestaurant = ind.includes("restaurant") || description.toLowerCase().includes("restaurant") || description.toLowerCase().includes("dining");
    const isTravel = ind.includes("travel") || ind.includes("hotel") || ind.includes("leisure") || description.toLowerCase().includes("hotel") || description.toLowerCase().includes("cruise");
    const isAuto = ind.includes("auto") || description.toLowerCase().includes("automobile") || description.toLowerCase().includes("vehicle");
    if (isLuxury) {
      catalysts.push({
        name: "China / Asia Demand Recovery",
        timeline: "6-18M",
        pos: 40,
        bruttoUpside: 15,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 15, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'macro' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "Pricing Power / Brand Elevation",
        timeline: "12-24M",
        pos: 55,
        bruttoUpside: 10,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 10, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'margin' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
    } else if (isCasino) {
      catalysts.push({
        name: "iGaming / Online Sports Betting Expansion",
        timeline: "12-24M",
        pos: 50,
        bruttoUpside: 15,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 15, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'product' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "New Property Openings / Capacity Expansion",
        timeline: "12-36M",
        pos: 40,
        bruttoUpside: 12,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 12, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'growth' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
    } else if (isRestaurant) {
      catalysts.push({
        name: "Same-Store Sales Recovery / Menu Pricing",
        timeline: "6-12M",
        pos: 50,
        bruttoUpside: 10,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 10, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'margin' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "Unit Growth / Franchise Expansion",
        timeline: "12-24M",
        pos: 45,
        bruttoUpside: 12,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 12, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'growth' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
    } else if (isTravel) {
      catalysts.push({
        name: "Travel Demand Recovery / RevPAR Growth",
        timeline: "6-18M",
        pos: 50,
        bruttoUpside: 12,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 12, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'macro' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "Loyalty Program Monetization",
        timeline: "12-24M",
        pos: 45,
        bruttoUpside: 10,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 10, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'product' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
    } else if (isAuto) {
      catalysts.push({
        name: "EV Transition / New Model Cycle",
        timeline: "12-24M",
        pos: 45,
        bruttoUpside: 15,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 15, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'product' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "Supply Chain Normalization / Volume Recovery",
        timeline: "6-18M",
        pos: 50,
        bruttoUpside: 10,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 10, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'macro' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
    } else {
      catalysts.push({
        name: "Consumer Confidence Recovery",
        timeline: "6-18M",
        pos: 45,
        bruttoUpside: 12,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 12, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'macro' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "E-Commerce / DTC Growth",
        timeline: "12-24M",
        pos: 50,
        bruttoUpside: 10,
        einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 10, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'growth' }),
        nettoUpside: 0, gb: 0,
        context: "",
      });
    }
  } else {
    catalysts.push({
      name: "Market Share Gains",
      timeline: "12-24M",
      pos: 45,
      bruttoUpside: 12,
      einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 12, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'growth' }),
      nettoUpside: 0, gb: 0,
      context: "",
    });
    catalysts.push({
      name: "Strategic M&A / Partnerships",
      timeline: "6-18M",
      pos: 30,
      bruttoUpside: 15,
      einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside: 15, forwardPE, sectorMedianPE, revenueGrowth, catalystType: 'product' }),
      nettoUpside: 0, gb: 0,
      context: "",
    });
  }

  // Calculate netto and GB, and fill in context for all catalysts
  for (const c of catalysts) {
    c.nettoUpside = +(c.bruttoUpside * (1 - c.einpreisungsgrad / 100)).toFixed(2);
    c.gb = +(c.pos / 100 * c.nettoUpside).toFixed(2);
    if (!c.context) {
      c.context = generateCatalystContext(c.name, sector, industry, description, growthRate, fcfMargin, revenue);
    }
  }

  return catalysts;
}

// === TAM Analysis ===
// Maps a segment name to a sub-TAM using keyword matching.
function matchSegmentTAM(segName: string, desc: string): { tamSize: number; tamLabel: string; tamCAGR: number; tamSource: string } {
  const n = segName.toLowerCase();
  // Cloud / Infrastructure
  if (n.includes('cloud') || n.includes('azure') || n.includes('aws') || n.includes('infrastructure')) {
    return { tamSize: 1500, tamLabel: 'Global Cloud Computing', tamCAGR: 16, tamSource: 'Gartner/IDC Cloud Forecast' };
  }
  // Productivity / SaaS / Office
  if (n.includes('productiv') || n.includes('office') || n.includes('business process') || n.includes('collaboration')) {
    return { tamSize: 600, tamLabel: 'Global Productivity & Collaboration Software', tamCAGR: 12, tamSource: 'Gartner SaaS/Productivity Forecast' };
  }
  // Casino / Gambling / Resorts (must come BEFORE general 'gaming' match)
  if (n.includes('casino') || n.includes('gambling') || n.includes('wager') || n.includes('slot') || n.includes('sportsbook') || n.includes('igaming') || n.includes('betting') || (n.includes('gaming') && (desc.includes('casino') || desc.includes('gambling') || desc.includes('gaming entertainment') || desc.includes('resort')))) {
    return { tamSize: 700, tamLabel: 'Global Casino & Gaming', tamCAGR: 6, tamSource: 'H2 Gambling Capital / Statista iGaming' };
  }
  // Personal Computing / Hardware / Windows / Video Gaming
  if (n.includes('personal comput') || n.includes('windows') || n.includes('device') || n.includes('hardware') || n.includes('surface') || (n.includes('gaming') && !desc.includes('casino') && !desc.includes('gambling'))) {
    return { tamSize: 400, tamLabel: 'Global PC & Gaming Market', tamCAGR: 3, tamSource: 'IDC/Gartner PC & Gaming Forecast' };
  }
  // Advertising / Search
  if (n.includes('advertis') || n.includes('search') || n.includes('google services') || n.includes('youtube')) {
    return { tamSize: 1000, tamLabel: 'Global Digital Advertising', tamCAGR: 10, tamSource: 'eMarketer / GroupM' };
  }
  // E-commerce / Retail
  if (n.includes('commerce') || n.includes('retail') || n.includes('stores') || n.includes('online store')) {
    return { tamSize: 6300, tamLabel: 'Global E-Commerce', tamCAGR: 11, tamSource: 'eMarketer / Statista' };
  }
  // Subscription / Streaming / Content
  // For tech/semiconductor companies, "subscription" likely means enterprise software, not streaming
  if (n.includes('subscri') || n.includes('stream') || n.includes('content') || n.includes('media') || n.includes('entertainment')) {
    if ((n.includes('subscri') || n.includes('service')) && (desc.includes('semiconductor') || desc.includes('infrastructure software') || desc.includes('enterprise'))) {
      return { tamSize: 600, tamLabel: 'Global Enterprise & Infrastructure Software', tamCAGR: 12, tamSource: 'Gartner Enterprise SW' };
    }
    return { tamSize: 700, tamLabel: 'Global Streaming & Digital Media', tamCAGR: 9, tamSource: 'PwC Global Entertainment & Media' };
  }
  // Automotive
  if (n.includes('auto') || n.includes('vehicle') || n.includes('mobility')) {
    return { tamSize: 3000, tamLabel: 'Global Automotive', tamCAGR: 4, tamSource: 'McKinsey Automotive' };
  }
  // Financial Services / Payments
  if (n.includes('financ') || n.includes('payment') || n.includes('banking') || n.includes('fintech')) {
    return { tamSize: 350, tamLabel: 'Global FinTech', tamCAGR: 18, tamSource: 'BCG/QED FinTech' };
  }
  // Pharma / Drug
  if (n.includes('pharma') || n.includes('drug') || n.includes('oncol') || n.includes('vaccine') || n.includes('therapeutic')) {
    return { tamSize: 1700, tamLabel: 'Global Pharmaceuticals', tamCAGR: 6, tamSource: 'IQVIA Pharma Forecast' };
  }
  // Fashion / Luxury / Apparel
  if (n.includes('fashion') || n.includes('leather') || n.includes('luxury') || n.includes('couture') || n.includes('apparel')) {
    return { tamSize: 380, tamLabel: 'Global Personal Luxury Goods', tamCAGR: 6, tamSource: 'Bain / Altagamma' };
  }
  // Wines & Spirits
  if (n.includes('wine') || n.includes('spirit') || n.includes('champagne') || n.includes('cognac')) {
    return { tamSize: 500, tamLabel: 'Global Premium Wines & Spirits', tamCAGR: 5, tamSource: 'IWSR Drinks Market' };
  }
  // Perfumes & Cosmetics
  if (n.includes('perfum') || n.includes('cosmet') || n.includes('beauty')) {
    return { tamSize: 430, tamLabel: 'Global Prestige Beauty', tamCAGR: 7, tamSource: 'Euromonitor / NPD Beauty' };
  }
  // Watches & Jewelry
  if (n.includes('watch') || n.includes('jewel') || n.includes('horolog')) {
    return { tamSize: 100, tamLabel: 'Global Luxury Watches & Jewelry', tamCAGR: 5, tamSource: 'Bain / Deloitte Swiss Watch' };
  }
  // Selective Retail / DFS
  if (n.includes('retail') || n.includes('sephora') || n.includes('selective') || n.includes('dfs')) {
    return { tamSize: 500, tamLabel: 'Global Selective/Specialty Retail', tamCAGR: 6, tamSource: 'Euromonitor Specialty Retail' };
  }
  // Semiconductor / Chips
  if (n.includes('semicond') || n.includes('chip') || n.includes('wafer') || n.includes('foundry')) {
    return { tamSize: 850, tamLabel: 'Global Semiconductor', tamCAGR: 12, tamSource: 'WSTS/SIA' };
  }
  // Data Center / AI / Networking
  if (n.includes('data center') || n.includes('datacenter') || n.includes('ai ') || n.includes('artificial intelligence') || n.includes('networking') || n.includes('infrastructure software')) {
    return { tamSize: 500, tamLabel: 'Global AI/Data Center Infrastructure', tamCAGR: 25, tamSource: 'Gartner/IDC AI Infrastructure' };
  }
  // Broadband / Connectivity / Wireless
  if (n.includes('broadband') || n.includes('wireless') || n.includes('connectivity') || n.includes('fiber')) {
    return { tamSize: 300, tamLabel: 'Global Broadband & Connectivity', tamCAGR: 8, tamSource: 'Dell\'Oro / Omdia' };
  }
  // Storage / Enterprise Software
  if (n.includes('storage') || n.includes('enterprise') || n.includes('mainframe') || n.includes('server')) {
    return { tamSize: 250, tamLabel: 'Global Enterprise IT Infrastructure', tamCAGR: 6, tamSource: 'IDC Enterprise IT' };
  }
  // Energy / Oil / Gas
  if (n.includes('upstream') || n.includes('downstream') || n.includes('refin') || n.includes('exploration')) {
    return { tamSize: 4000, tamLabel: 'Global Energy', tamCAGR: 3, tamSource: 'IEA World Energy' };
  }
  // Aerospace / Defense / Launch
  if (n.includes('space') || n.includes('launch') || n.includes('defense') || n.includes('aero')) {
    return { tamSize: 800, tamLabel: 'Global Aerospace & Defense', tamCAGR: 5, tamSource: 'Deloitte A&D' };
  }
  // Food & Beverage / Restaurant / Hospitality
  if (n.includes('food') || n.includes('beverage') || n.includes('restaurant') || n.includes('dining') || n.includes('catering')) {
    return { tamSize: 4000, tamLabel: 'Global Foodservice & Restaurants', tamCAGR: 5, tamSource: 'Euromonitor / NRA' };
  }
  // Hotel / Room / Hospitality
  if (n.includes('hotel') || n.includes('room') || n.includes('lodging') || n.includes('hospitality')) {
    return { tamSize: 800, tamLabel: 'Global Hotel & Lodging', tamCAGR: 6, tamSource: 'STR / Phocuswright' };
  }
  // Management Fee / Services
  if (n.includes('management fee') || n.includes('management') || n.includes('service fee')) {
    return { tamSize: 500, tamLabel: 'Global Asset/Property Management', tamCAGR: 5, tamSource: 'Industry Estimate' };
  }
  // Online / iGaming / Digital
  if (n.includes('online') || n.includes('igaming') || n.includes('digital') || n.includes('interactive')) {
    if (desc.includes('casino') || desc.includes('gambling') || desc.includes('gaming entertainment') || desc.includes('sportsbook')) {
      return { tamSize: 150, tamLabel: 'Global Online Gambling & iGaming', tamCAGR: 12, tamSource: 'H2 Gambling Capital / Statista' };
    }
    return { tamSize: 1000, tamLabel: 'Global Digital Services', tamCAGR: 10, tamSource: 'Industry Estimate' };
  }
  // Fallback: use description context
  if (desc.includes('cloud') || desc.includes('azure') || desc.includes('aws')) {
    return { tamSize: 1500, tamLabel: 'Global Cloud Computing', tamCAGR: 16, tamSource: 'Gartner/IDC' };
  }
  if (desc.includes('luxury')) {
    return { tamSize: 380, tamLabel: 'Global Personal Luxury Goods', tamCAGR: 6, tamSource: 'Bain / Altagamma' };
  }
  if (desc.includes('casino') || desc.includes('gambling') || desc.includes('gaming entertainment')) {
    return { tamSize: 700, tamLabel: 'Global Casino & Gaming', tamCAGR: 6, tamSource: 'H2 Gambling Capital' };
  }
  // Industry-aware fallback: when segment name is generic (e.g. "Products", "Services"),
  // use the company description to infer the right TAM
  if (desc.includes('semiconductor') || desc.includes('chip')) {
    return { tamSize: 850, tamLabel: 'Global Semiconductor', tamCAGR: 12, tamSource: 'WSTS/SIA' };
  }
  if (desc.includes('pharmaceutical') || desc.includes('drug') || desc.includes('therapeutic')) {
    return { tamSize: 1700, tamLabel: 'Global Pharmaceuticals', tamCAGR: 6, tamSource: 'IQVIA' };
  }
  if (desc.includes('infrastructure software') || desc.includes('enterprise software')) {
    return { tamSize: 600, tamLabel: 'Global Enterprise Software', tamCAGR: 12, tamSource: 'Gartner Enterprise SW' };
  }
  // Generic fallback
  return { tamSize: 2000, tamLabel: 'Global Industry', tamCAGR: 5, tamSource: 'Industry Estimate' };
}

// Estimates TAM, industry CAGR, and company market share based on sector/industry.
// When revenue segments are available, computes per-segment TAMs for accurate multi-business analysis.
function generateTAMAnalysis(
  sector: string, industry: string, description: string,
  revenue: number, revenueGrowth: number,
  revenueSegments?: any[]
): { tamTotal: number; tamLabel: string; tamCAGR: number; companyGrowth: number; companyRevenue: number; marketShare: number; tamSource: string; outperforming: boolean; segments?: any[] } {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();
  const revB = revenue / 1e9;

  let tamTotal = 0; // in $B
  let tamLabel = '';
  let tamCAGR = 0; // %
  let tamSource = '';

  // Tech sub-sectors
  if (s.includes('tech')) {
    if (desc.includes('cloud') || desc.includes('azure') || desc.includes('aws')) {
      tamTotal = 1500; tamLabel = 'Global Cloud Computing'; tamCAGR = 16; tamSource = 'Gartner/IDC Cloud Forecast 2025-2030';
    } else if (ind.includes('semiconductor') || desc.includes('semiconductor') || desc.includes('chip') || desc.includes('gpu')) {
      tamTotal = 850; tamLabel = 'Global Semiconductor'; tamCAGR = 12; tamSource = 'WSTS/SIA Semiconductor Forecast';
    } else if (ind.includes('software') || desc.includes('saas')) {
      tamTotal = 900; tamLabel = 'Global Enterprise Software'; tamCAGR = 13; tamSource = 'Gartner Enterprise Software Forecast';
    } else if (desc.includes('cybersecurity') || desc.includes('security')) {
      tamTotal = 300; tamLabel = 'Global Cybersecurity'; tamCAGR = 14; tamSource = 'MarketsandMarkets Cybersecurity Forecast';
    } else {
      tamTotal = 5500; tamLabel = 'Global IT Spending'; tamCAGR = 8; tamSource = 'Gartner IT Spending Forecast';
    }
  }
  // Healthcare
  else if (s.includes('health')) {
    if (desc.includes('biotech') || desc.includes('biopharm')) {
      tamTotal = 550; tamLabel = 'Global Biotech/Biopharma'; tamCAGR = 11; tamSource = 'EvaluatePharma / IQVIA';
    } else if (desc.includes('medical device') || desc.includes('diagnostic')) {
      tamTotal = 600; tamLabel = 'Global Medical Devices'; tamCAGR = 7; tamSource = 'Fortune Business Insights MedTech';
    } else if (ind.includes('drug') || desc.includes('pharmaceutical')) {
      tamTotal = 1700; tamLabel = 'Global Pharmaceuticals'; tamCAGR = 6; tamSource = 'IQVIA Pharma Market Forecast';
    } else {
      tamTotal = 12000; tamLabel = 'Global Healthcare'; tamCAGR = 8; tamSource = 'WHO/Deloitte Healthcare Forecast';
    }
  }
  // Financials
  else if (s.includes('financ')) {
    if (ind.includes('bank')) {
      tamTotal = 7000; tamLabel = 'Global Banking Revenue Pool'; tamCAGR = 5; tamSource = 'McKinsey Global Banking Revenue';
    } else if (ind.includes('insurance')) {
      tamTotal = 6000; tamLabel = 'Global Insurance Premiums'; tamCAGR = 4; tamSource = 'Swiss Re Sigma / Allianz';
    } else if (desc.includes('fintech') || desc.includes('payment')) {
      tamTotal = 350; tamLabel = 'Global FinTech'; tamCAGR = 18; tamSource = 'BCG/QED FinTech Report';
    } else {
      tamTotal = 25000; tamLabel = 'Global Financial Services'; tamCAGR = 5; tamSource = 'McKinsey Global Financial Services';
    }
  }
  // Consumer Cyclical
  else if (s.includes('consumer') && (s.includes('cycl') || s.includes('discr'))) {
    if (ind.includes('gambling') || ind.includes('casino') || ind.includes('resort') || desc.includes('casino') || desc.includes('gambling') || desc.includes('gaming entertainment')) {
      tamTotal = 700; tamLabel = 'Global Casino & Gaming'; tamCAGR = 6; tamSource = 'H2 Gambling Capital / Statista iGaming';
    } else if (ind.includes('luxury') || desc.includes('luxury') || desc.includes('fashion')) {
      tamTotal = 380; tamLabel = 'Global Personal Luxury Goods'; tamCAGR = 6; tamSource = 'Bain & Company / Altagamma Luxury Report';
    } else if (desc.includes('auto') || desc.includes('vehicle')) {
      tamTotal = 3000; tamLabel = 'Global Automotive'; tamCAGR = 4; tamSource = 'McKinsey Automotive Revenue Pool';
    } else if (desc.includes('e-commerce') || desc.includes('online retail')) {
      tamTotal = 6300; tamLabel = 'Global E-Commerce'; tamCAGR = 11; tamSource = 'eMarketer / Statista E-Commerce';
    } else if (ind.includes('restaurant') || desc.includes('restaurant') || desc.includes('dining')) {
      tamTotal = 4000; tamLabel = 'Global Restaurant & Foodservice'; tamCAGR = 5; tamSource = 'Euromonitor / NRA Foodservice';
    } else if (ind.includes('travel') || ind.includes('hotel') || ind.includes('leisure') || desc.includes('hotel') || desc.includes('cruise')) {
      tamTotal = 2000; tamLabel = 'Global Travel & Leisure'; tamCAGR = 7; tamSource = 'Phocuswright / Euromonitor Travel';
    } else {
      tamTotal = 15000; tamLabel = 'Global Consumer Discretionary'; tamCAGR = 5; tamSource = 'Euromonitor / McKinsey Consumer';
    }
  }
  // Consumer Staples
  else if (s.includes('consumer') && (s.includes('stapl') || s.includes('defens'))) {
    tamTotal = 9000; tamLabel = 'Global Consumer Staples'; tamCAGR = 4; tamSource = 'Euromonitor Consumer Staples';
  }
  // Energy
  else if (s.includes('energy')) {
    if (desc.includes('renewable') || desc.includes('solar') || desc.includes('wind')) {
      tamTotal = 1200; tamLabel = 'Global Renewable Energy'; tamCAGR = 17; tamSource = 'BloombergNEF Energy Transition';
    } else {
      tamTotal = 4000; tamLabel = 'Global Energy (O&G + Renewables)'; tamCAGR = 3; tamSource = 'IEA World Energy Outlook';
    }
  }
  // Industrials
  else if (s.includes('industrial')) {
    if (desc.includes('aerospace') || desc.includes('defense') || desc.includes('rocket') || desc.includes('launch')) {
      tamTotal = 800; tamLabel = 'Global Aerospace & Defense'; tamCAGR = 5; tamSource = 'Deloitte A&D Industry Outlook';
    } else {
      tamTotal = 5000; tamLabel = 'Global Industrial Goods'; tamCAGR = 4; tamSource = 'McKinsey Industrial Sector Forecast';
    }
  }
  // Communication Services
  else if (s.includes('commun')) {
    if (desc.includes('advertis') || desc.includes('social')) {
      tamTotal = 1000; tamLabel = 'Global Digital Advertising'; tamCAGR = 10; tamSource = 'eMarketer / GroupM Digital Ad Forecast';
    } else {
      tamTotal = 2200; tamLabel = 'Global Media & Entertainment'; tamCAGR = 7; tamSource = 'PwC Global Entertainment & Media';
    }
  }
  // Real Estate
  else if (s.includes('real estate')) {
    tamTotal = 4000; tamLabel = 'Global Commercial Real Estate'; tamCAGR = 4; tamSource = 'CBRE / JLL Real Estate Forecast';
  }
  // Utilities
  else if (s.includes('util')) {
    tamTotal = 2500; tamLabel = 'Global Utilities'; tamCAGR = 4; tamSource = 'IEA / Deloitte Utilities Outlook';
  }
  // Materials
  else if (s.includes('material') || s.includes('basic')) {
    tamTotal = 2000; tamLabel = 'Global Materials & Mining'; tamCAGR = 4; tamSource = 'McKinsey Materials Outlook';
  }
  // Fallback
  else {
    tamTotal = 5000; tamLabel = 'Global Market'; tamCAGR = 5; tamSource = 'IMF / World Bank GDP Growth Estimate';
  }

  // If revenue segments available, compute per-segment TAMs and weighted totals
  if (revenueSegments && revenueSegments.length >= 2) {
    const segTAMs = revenueSegments.map(seg => {
      const match = matchSegmentTAM(seg.name, desc);
      const segRevB = seg.revenue / 1e9;
      const segShare = match.tamSize > 0 ? (segRevB / match.tamSize) * 100 : 0;
      return {
        segmentName: seg.name,
        segmentRevenue: Math.round(segRevB * 10) / 10,
        segmentGrowth: seg.growth,
        segmentShare: seg.percentage,
        tamSize: match.tamSize,
        tamLabel: match.tamLabel,
        tamCAGR: match.tamCAGR,
        marketShare: Math.round(segShare * 100) / 100,
        outperforming: seg.growth > match.tamCAGR,
      };
    });

    // Weighted TAM and CAGR based on segment revenue shares
    const weightedTAM = segTAMs.reduce((sum, seg) => sum + seg.tamSize * (seg.segmentShare / 100), 0);
    const weightedCAGR = segTAMs.reduce((sum, seg) => sum + seg.tamCAGR * (seg.segmentShare / 100), 0);
    const weightedShare = weightedTAM > 0 ? (revB / weightedTAM) * 100 : 0;
    const largestSeg = segTAMs.reduce((a, b) => a.segmentShare > b.segmentShare ? a : b);
    const allSources = [...new Set(segTAMs.map(s => s.tamLabel))].join(' + ');

    return {
      tamTotal: Math.round(weightedTAM),
      tamLabel: `Gewichtet: ${allSources}`,
      tamCAGR: Math.round(weightedCAGR * 10) / 10,
      companyGrowth: revenueGrowth,
      companyRevenue: Math.round(revB * 10) / 10,
      marketShare: Math.round(weightedShare * 100) / 100,
      tamSource: 'Segment-gewichteter TAM aus ' + segTAMs.map(s => s.tamLabel.replace('Global ', '')).join(', '),
      outperforming: revenueGrowth > weightedCAGR,
      segments: segTAMs,
    };
  }

  // Fallback: single TAM based on sector
  const marketShare = tamTotal > 0 ? (revB / tamTotal) * 100 : 0;
  const outperforming = revenueGrowth > tamCAGR;

  return {
    tamTotal,
    tamLabel,
    tamCAGR,
    companyGrowth: revenueGrowth,
    companyRevenue: Math.round(revB * 10) / 10,
    marketShare: Math.round(marketShare * 100) / 100,
    tamSource,
    outperforming,
  };
}

// === Generate risks ===
function generateRisks(sector: string, beta: number, govExposure: number): Risk[] {
  const risks: Risk[] = [];
  const s = sector.toLowerCase();

  // Universal risks
  risks.push({
    name: "Macro Recession / Demand Shock",
    category: "Correlated",
    ew: 20,
    impact: Math.round(15 + beta * 5),
    expectedDamage: 0,
  });

  risks.push({
    name: "Earnings Miss / Guidance Cut",
    category: "Binary",
    ew: 25,
    impact: 15,
    expectedDamage: 0,
  });

  risks.push({
    name: "Multiple Compression (Rising Rates)",
    category: "Gradual",
    ew: 30,
    impact: Math.round(10 + beta * 3),
    expectedDamage: 0,
  });

  // Sector-specific risks
  if (s.includes("tech")) {
    risks.push({
      name: "Regulatory / Antitrust Action",
      category: "Binary",
      ew: 15,
      impact: 20,
      expectedDamage: 0,
    });
    risks.push({
      name: "Tech Disruption / Competitive Shift",
      category: "Gradual",
      ew: 20,
      impact: 25,
      expectedDamage: 0,
    });
  } else if (s.includes("health")) {
    risks.push({
      name: "Drug Pricing Reform / Patent Cliff",
      category: "Binary",
      ew: 25,
      impact: 20,
      expectedDamage: 0,
    });
  } else if (s.includes("financ")) {
    risks.push({
      name: "Credit Quality Deterioration",
      category: "Gradual",
      ew: 20,
      impact: 25,
      expectedDamage: 0,
    });
  } else if (s.includes("energy")) {
    risks.push({
      name: "Commodity Price Collapse",
      category: "Binary",
      ew: 20,
      impact: 35,
      expectedDamage: 0,
    });
  } else if (s.includes("consumer") && (s.includes("cycl") || s.includes("discr"))) {
    risks.push({
      name: "Consumer Spending Slowdown / China Weakness",
      category: "Gradual",
      ew: 30,
      impact: 20,
      expectedDamage: 0,
    });
    risks.push({
      name: "Brand Dilution / Competitive Shift",
      category: "Gradual",
      ew: 15,
      impact: 15,
      expectedDamage: 0,
    });
  } else {
    risks.push({
      name: "Competitive Pressure / Margin Erosion",
      category: "Gradual",
      ew: 25,
      impact: 15,
      expectedDamage: 0,
    });
  }

  // Government exposure risk
  if (govExposure > 20) {
    risks.push({
      name: "Government Contract / Policy Dependency",
      category: "Gradual",
      ew: 30,
      impact: Math.round(govExposure * 0.5),
      expectedDamage: 0,
    });
  }

  // Calculate expected damage
  for (const r of risks) {
    r.expectedDamage = +(r.ew / 100 * r.impact).toFixed(2);
  }

  return risks;
}

// === Government exposure estimation ===
function estimateGovExposure(sector: string, industry: string, description: string): { exposure: number; detail: string } {
  const desc = description.toLowerCase();
  const ind = industry.toLowerCase();
  const sect = sector.toLowerCase();

  if (ind.includes("defense") || ind.includes("aerospace")) {
    return { exposure: 60, detail: "Defense/Aerospace – high government contract dependency" };
  }
  if (desc.includes("government") && desc.includes("contract")) {
    return { exposure: 35, detail: "Significant government contract exposure noted in description" };
  }
  // Drug manufacturers: US revenue exposed to Medicare Part D, Medicaid rebates,
  // IRA drug price negotiation. GLP-1, insulin, oncology all heavily affected.
  if (ind.includes("drug manufacturers") || ind.includes("pharma")) {
    return { exposure: 35, detail: "Pharma/Drug Manufacturer – US-Umsatz betroffen von Medicare Part D, Medicaid-Rabatte, IRA-Preisverhandlungen. Regulatorisches Preisrisiko." };
  }
  if (ind.includes("health") && (desc.includes("medicare") || desc.includes("medicaid") || desc.includes("insulin") || desc.includes("diabetes") || desc.includes("obesity"))) {
    return { exposure: 30, detail: "Healthcare mit Medicare/Medicaid-Exposure – Preisregulierungsrisiko (IRA, Medicaid Rebates)" };
  }
  if (ind.includes("biotechnology")) {
    return { exposure: 25, detail: "Biotech – FDA-Abhängigkeit und potenzielle Preisregulierung bei Blockbuster-Medikamenten" };
  }
  if (ind.includes("health care plan") || ind.includes("managed health")) {
    return { exposure: 40, detail: "Managed Healthcare – direkte Abhängigkeit von Medicare/Medicaid-Erstattungssätzen" };
  }
  if (ind.includes("infrastructure") || ind.includes("construction")) {
    return { exposure: 25, detail: "Infrastructure sector – moderate public spending exposure" };
  }
  if (sect.includes("utilities")) {
    return { exposure: 20, detail: "Utilities – regulierte Preisgestaltung, Abhängigkeit von Energiepolitik" };
  }
  return { exposure: 5, detail: "Minimal direct government revenue dependency" };
}

// === Currency Detection & FX Conversion ===
function detectReportedCurrency(financialsContent: string): string | null {
  // The finance_financials API returns headers like "## Income Statement (EUR)" or "## Balance Sheet (CNY)"
  const match = financialsContent.match(/\(([A-Z]{3})\)/);
  if (match) return match[1];
  // Also try "Currency: EUR" patterns
  const currMatch = financialsContent.match(/[Cc]urrency[:\s]+([A-Z]{3})/);
  if (currMatch) return currMatch[1];
  // Try detecting from unit labels like "in KZT" or "tenge" or "million KZT"
  const unitMatch = financialsContent.match(/(?:in|million|thousands?)\s+([A-Z]{3})/i);
  if (unitMatch) return unitMatch[1].toUpperCase();
  return null;
}

function fetchFXRate(fromCurrency: string, toCurrency: string = "USD"): number | null {
  if (fromCurrency === toCurrency) return 1.0;
  try {
    // Try Polygon forex endpoint for latest rate
    const pair = `C:${fromCurrency}${toCurrency}`;
    const result = callFinanceTool("finance_massive", {
      pathname: `/v2/aggs/ticker/${pair}/prev`,
      params: { adjusted: "true" },
    });
    if (result?.content) {
      const data = typeof result.content === 'string' ? JSON.parse(result.content) : result.content;
      if (data?.results && data.results.length > 0) {
        const rate = data.results[0].c; // close price
        if (rate && rate > 0) {
          console.log(`[FX] ${fromCurrency}/${toCurrency} = ${rate}`);
          return rate;
        }
      }
    }
  } catch (e: any) {
    console.error(`[FX] Polygon error for ${fromCurrency}/${toCurrency}:`, e?.message?.substring(0, 200));
  }

  // Fallback: try finance_quotes with forex pair
  try {
    const quoteResult = callFinanceTool("finance_quotes", {
      ticker_symbols: [`${fromCurrency}${toCurrency}=X`],
      fields: ["price"],
    });
    if (quoteResult?.content) {
      const rows = parseMarkdownTable(quoteResult.content);
      if (rows.length > 0) {
        const rate = parseNumber(rows[0].price);
        if (rate > 0) {
          console.log(`[FX] Fallback ${fromCurrency}/${toCurrency} = ${rate}`);
          return rate;
        }
      }
    }
  } catch (e: any) {
    console.error(`[FX] Fallback error for ${fromCurrency}/${toCurrency}:`, e?.message?.substring(0, 200));
  }

  // Last resort: hardcoded approximate rates (better than nothing)
  const fallbackRates: Record<string, number> = {
    EUR: 1.09, GBP: 1.27, CHF: 1.13, JPY: 0.0067, CNY: 0.138,
    HKD: 0.128, KRW: 0.00074, SEK: 0.096, NOK: 0.094, DKK: 0.146,
    AUD: 0.65, CAD: 0.74, SGD: 0.75, INR: 0.012, BRL: 0.18,
    TWD: 0.031, ZAR: 0.055, MXN: 0.058, PLN: 0.26, CZK: 0.043,
    KZT: 0.00196, TRY: 0.026, ILS: 0.28, THB: 0.029, PHP: 0.017,
    IDR: 0.000061, VND: 0.000039, NGN: 0.00063, EGP: 0.02, ARS: 0.00089,
    CLP: 0.0011, COP: 0.00024, PEN: 0.27, RUB: 0.011, UAH: 0.024,
  };
  if (fallbackRates[fromCurrency]) {
    console.log(`[FX] Using fallback rate for ${fromCurrency}: ${fallbackRates[fromCurrency]}`);
    return fallbackRates[fromCurrency];
  }

  return null;
}

function convertFinancials(
  fxRate: number,
  data: { revenue: number; netIncome: number; ebitda: number; fcfTTM: number;
    totalDebt: number; cashEquivalents: number; totalEquity: number;
    totalAssets: number; netDebt: number; operatingIncome: number;
    grossProfit: number; sharesOutstanding: number }
): typeof data {
  return {
    revenue: data.revenue * fxRate,
    netIncome: data.netIncome * fxRate,
    ebitda: data.ebitda * fxRate,
    fcfTTM: data.fcfTTM * fxRate,
    totalDebt: data.totalDebt * fxRate,
    cashEquivalents: data.cashEquivalents * fxRate,
    totalEquity: data.totalEquity * fxRate,
    totalAssets: data.totalAssets * fxRate,
    netDebt: data.netDebt * fxRate,
    operatingIncome: data.operatingIncome * fxRate,
    grossProfit: data.grossProfit * fxRate,
    sharesOutstanding: data.sharesOutstanding, // shares don't convert
  };
}

// === PESTEL Analysis Generator ===
function generatePESTELAnalysis(
  sector: string, industry: string, description: string,
  beta: number, govExposure: number, reportedCurrency: string
): PESTELAnalysis {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();
  const factors: PESTELFactor[] = [];

  // Determine region from currency
  const regionMap: Record<string, string> = {
    USD: "USA", EUR: "Europa/EU", GBP: "UK", CHF: "Schweiz", JPY: "Japan",
    CNY: "China", HKD: "Hongkong/China", KRW: "Südkorea", TWD: "Taiwan",
    INR: "Indien", BRL: "Brasilien", CAD: "Kanada", AUD: "Australien",
    SEK: "Schweden", NOK: "Norwegen", DKK: "Dänemark", SGD: "Singapur",
    ZAR: "Südafrika", MXN: "Mexiko", PLN: "Polen", CZK: "Tschechien",
    KZT: "Kasachstan/Zentralasien", TRY: "Türkei", RUB: "Russland", ILS: "Israel",
    IDR: "Indonesien", THB: "Thailand", PHP: "Philippinen", VND: "Vietnam",
    NGN: "Nigeria", EGP: "Ägypten", ARS: "Argentinien", CLP: "Chile",
    COP: "Kolumbien", PEN: "Peru", UAH: "Ukraine",
  };
  const region = regionMap[reportedCurrency] || "Global";
  const isEU = ["EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK"].includes(reportedCurrency);
  const isAsia = ["CNY", "HKD", "JPY", "KRW", "TWD", "SGD", "INR", "THB", "PHP", "VND", "IDR"].includes(reportedCurrency);
  const isEM = ["CNY", "BRL", "INR", "ZAR", "MXN", "PLN", "CZK", "KZT", "TRY", "RUB", "IDR", "THB", "PHP", "VND", "NGN", "EGP", "ARS", "COP", "CLP", "PEN", "UAH"].includes(reportedCurrency);

  // Sector-specific detection for stock correlation logic
  const isDefense = ind.includes("aerospace") || ind.includes("defense") || desc.includes("defense") || desc.includes("missile") || desc.includes("military") || desc.includes("raytheon") || desc.includes("lockheed") || desc.includes("northrop");
  const isCyberSec = ind.includes("cyber") || desc.includes("cybersecurity") || desc.includes("crowdstrike") || desc.includes("palo alto");
  const isHealthcare = s.includes("health");
  const isPharma = ind.includes("pharma") || ind.includes("biotech");
  const isRenewable = ind.includes("renew") || ind.includes("solar") || ind.includes("wind") || desc.includes("renewable");
  const isFossil = (s.includes("energy") && !isRenewable) || ind.includes("oil") || ind.includes("gas");
  const isBank = ind.includes("bank") || ind.includes("financ");
  const isRealEstate = s.includes("real estate");
  const isConsumerStaple = s.includes("consumer") && (s.includes("stapl") || s.includes("defensive"));
  const isConsumerDisc = s.includes("consumer") && s.includes("discret");
  const isSemiconductor = ind.includes("semicon") || desc.includes("semiconductor") || desc.includes("chip");
  const isAuto = ind.includes("auto");
  const isUtil = s.includes("util");
  const isInfra = ind.includes("infrastructure") || ind.includes("construction") || desc.includes("infrastructure");
  const isTech = s.includes("tech") || ind.includes("software") || desc.includes("cloud computing") || desc.includes("saas");

  // Helper: derive stock-specific correlation + note for a given factor
  function stockCorr(
    factorKey: string,
    genericImpact: "Positiv" | "Neutral" | "Negativ"
  ): { stockCorrelation: "Positiv" | "Neutral" | "Negativ"; stockCorrelationNote: string } {
    // Defense stocks: geopolitical tension = POSITIVE (higher defense budgets)
    if (isDefense) {
      if (factorKey === "trade") return { stockCorrelation: "Neutral", stockCorrelationNote: "Rüstungsexporte unterliegen Sonderregeln, nicht klassischen Zöllen." };
      if (factorKey === "regulation") return { stockCorrelation: "Neutral", stockCorrelationNote: "Strenge Regulierung schafft hohe Markteintrittsbarrieren → Moat-stärkend." };
      if (factorKey === "govDependency") return { stockCorrelation: "Positiv", stockCorrelationNote: "Steigende Verteidigungsbudgets weltweit (NATO 2%+ BIP-Ziel) = direkter Umsatztreiber." };
      if (factorKey === "interest") return { stockCorrelation: "Neutral", stockCorrelationNote: "Defense-Aufträge sind langfristig, WACC-Sensitivität moderat." };
      if (factorKey === "inflation") return { stockCorrelation: "Positiv", stockCorrelationNote: "Verträge mit Inflationsanpassung, Cost-Plus-Modelle schützen Margen." };
      if (factorKey === "geo") return { stockCorrelation: "Positiv", stockCorrelationNote: "Geopolitische Konflikte → höhere Verteidigungsausgaben → Kurstreiber. Ukraine/Nahost direkt positiv." };
      if (factorKey === "climate") return { stockCorrelation: "Neutral", stockCorrelationNote: "Moderate CO₂-Exponierung, kein primärer Emittent." };
      if (factorKey === "energy") return { stockCorrelation: "Neutral", stockCorrelationNote: "Energiekosten marginal im Gesamtbild." };
      if (factorKey === "ai") return { stockCorrelation: "Positiv", stockCorrelationNote: "AI/Autonome Systeme als Wachstumstreiber in Verteidigungstechnologie (Drohnen, Aufklärung, EW)." };
      if (factorKey === "cyber") return { stockCorrelation: "Positiv", stockCorrelationNote: "Cyber-Bedrohungen treiben Nachfrage nach Cybersecurity-Defense-Lösungen." };
      if (factorKey === "demo") return { stockCorrelation: "Neutral", stockCorrelationNote: "Geringer Einfluss auf Defense-Nachfrage." };
      if (factorKey === "esg") return { stockCorrelation: "Negativ", stockCorrelationNote: "ESG-Ausschlüsse reduzieren Investorenbasis (sin stocks), aber operativ kein Impact." };
    }
    // Cybersecurity stocks: cyber threats = POSITIVE
    if (isCyberSec) {
      if (factorKey === "cyber") return { stockCorrelation: "Positiv", stockCorrelationNote: "Steigende Cyberangriffe = direkte Nachfragesteigerung für Cybersecurity-Produkte." };
      if (factorKey === "regulation") return { stockCorrelation: "Positiv", stockCorrelationNote: "Strengere Datenschutzgesetze erzwingen Security-Investitionen → Umsatztreiber." };
    }
    // Healthcare/Pharma: aging population = POSITIVE
    if (isHealthcare || isPharma) {
      if (factorKey === "demo") return { stockCorrelation: "Positiv", stockCorrelationNote: "Alternde Bevölkerung erhöht Nachfrage nach Gesundheitsleistungen und Pharma-Produkten." };
      if (factorKey === "regulation") return { stockCorrelation: "Negativ", stockCorrelationNote: "Preisregulierung (IRA Drug Pricing) und FDA-Anforderungen drücken auf Margen." };
      if (factorKey === "inflation") return { stockCorrelation: "Neutral", stockCorrelationNote: "Healthcare-Ausgaben relativ preisunelastisch → defensive Qualität." };
    }
    // Banks: interest rates = POSITIVE (NIM expansion)
    if (isBank) {
      if (factorKey === "interest") return { stockCorrelation: "Positiv", stockCorrelationNote: "Höhere Zinsen erweitern Nettozinsmarge (NIM) → direkter Gewinnhebel." };
      if (factorKey === "regulation") return { stockCorrelation: "Negativ", stockCorrelationNote: "Basel III/IV Kapitalanforderungen begrenzen Leverage und ROE." };
    }
    // Real estate: interest rates = NEGATIVE
    if (isRealEstate) {
      if (factorKey === "interest") return { stockCorrelation: "Negativ", stockCorrelationNote: "Steigende Zinsen erhöhen Finanzierungskosten und drücken Immobilienbewertungen." };
    }
    // Consumer Staples: inflation = neutral/resilient, recession = positive
    if (isConsumerStaple) {
      if (factorKey === "inflation") return { stockCorrelation: "Neutral", stockCorrelationNote: "Pricing Power schützt Margen. Basiskonsumgüter relativ preisunelastisch." };
      if (factorKey === "conjuncture") return { stockCorrelation: "Positiv", stockCorrelationNote: "Rezessionsresistent — Basiskonsum bleibt stabil, defensive Qualität als Vorteil." };
    }
    // Consumer Discretionary: recession = NEGATIVE
    if (isConsumerDisc) {
      if (factorKey === "inflation") return { stockCorrelation: "Negativ", stockCorrelationNote: "Kaufkraftverlust reduziert diskretionäre Ausgaben direkt." };
      if (factorKey === "conjuncture") return { stockCorrelation: "Negativ", stockCorrelationNote: "Konjunkturabschwung trifft diskretionären Konsum überproportional." };
    }
    // Technology / Cloud / Platform (AMZN, MSFT, GOOG, META etc.)
    if (isTech) {
      if (factorKey === "interest") return { stockCorrelation: "Negativ", stockCorrelationNote: "Steigende Zinsen komprimieren Growth-Multiples über DCF-Diskontierung → Bewertungsdruck." };
      if (factorKey === "ai") return { stockCorrelation: "Positiv", stockCorrelationNote: "AI-Investitionszyklus treibt Cloud-Nachfrage, neue Revenue-Streams und Produktivitätsgewinne." };
      if (factorKey === "regulation") return { stockCorrelation: "Negativ", stockCorrelationNote: "Kartellrecht, Digital Markets Act und Datenschutzgesetze begrenzen Wachstum und erhöhen Compliance-Kosten." };
      if (factorKey === "trade") return { stockCorrelation: "Negativ", stockCorrelationNote: "US-China Tech-Decoupling limitiert Absatzmärkte. Datenlokalisierung fragmentiert Cloud-Geschäft." };
      if (factorKey === "conjuncture") return { stockCorrelation: "Neutral", stockCorrelationNote: "Enterprise-IT-Budgets zyklisch, aber Cloud-Migration strukturell — Mischeffekt." };
      if (factorKey === "cyber") return { stockCorrelation: "Neutral", stockCorrelationNote: "Cybervorfälle erzeugen Reputationsrisiko, treiben aber auch Security-Umsätze." };
      if (factorKey === "inflation") return { stockCorrelation: "Neutral", stockCorrelationNote: "Hohe Bruttomarge und Pricing Power mildern Inflationseffekte. Cloud-Verträge teils inflationsindexiert." };
      if (factorKey === "esg") return { stockCorrelation: "Neutral", stockCorrelationNote: "Tech profitiert von ESG-Kapitalallokation, aber Energie-Footprint der Rechenzentren steht in der Kritik." };
      if (factorKey === "tax") return { stockCorrelation: "Negativ", stockCorrelationNote: "Global Minimum Tax (Pillar 2) und OECD BEPS schränken Transfer-Pricing-Optimierung ein." };
      if (factorKey === "antitrust") return { stockCorrelation: "Negativ", stockCorrelationNote: "FTC/EU-Kartellverfahren gegen Big Tech — Zerschlagungsrisiko und Bußgelder." };
    }
    // Semiconductors: trade war = NEGATIVE, AI = POSITIVE
    if (isSemiconductor) {
      if (factorKey === "trade") return { stockCorrelation: "Negativ", stockCorrelationNote: "Exportbeschränkungen (CHIPS Act Gegenmaßnahmen, China-Restriktionen) begrenzen Absatzmärkte." };
      if (factorKey === "ai") return { stockCorrelation: "Positiv", stockCorrelationNote: "AI-Boom treibt Nachfrage nach GPUs/Chips massiv → direkter Umsatztreiber." };
    }
    // Renewables: climate regulation = POSITIVE
    if (isRenewable) {
      if (factorKey === "climate") return { stockCorrelation: "Positiv", stockCorrelationNote: "Strengere CO₂-Regulierung beschleunigt Transition → direkte Nachfragesteigerung." };
      if (factorKey === "energy") return { stockCorrelation: "Positiv", stockCorrelationNote: "Energietransition ist Kerngeschäft → Förderungen und Mandate als Rückenwind." };
      if (factorKey === "esg") return { stockCorrelation: "Positiv", stockCorrelationNote: "ESG-Trend kanalisiert Kapitalflüsse → Bewertungspremium für Clean-Energy-Aktien." };
    }
    // Fossil energy: climate = NEGATIVE, high oil price = mixed
    if (isFossil) {
      if (factorKey === "climate") return { stockCorrelation: "Negativ", stockCorrelationNote: "CO₂-Kosten steigen, Stranded-Asset-Risiko für fossile Reserven." };
      if (factorKey === "energy") return { stockCorrelation: "Negativ", stockCorrelationNote: "Langfristig sinkende Nachfrage durch Energietransition → struktureller Gegenwind." };
      if (factorKey === "esg") return { stockCorrelation: "Negativ", stockCorrelationNote: "ESG-Ausschlüsse und Desinvestment reduzieren Investorenbasis und erhöhen Kapitalkosten." };
      if (factorKey === "geo") return { stockCorrelation: "Positiv", stockCorrelationNote: "Geopolitische Spannungen treiben Energiepreise → kurzfristiger Gewinnhebel." };
    }
    // Auto: trade = NEGATIVE, emissions = NEGATIVE
    if (isAuto) {
      if (factorKey === "trade") return { stockCorrelation: "Negativ", stockCorrelationNote: "Autozölle und Lieferkettenunterbrechungen treffen globale Produktionsmodelle direkt." };
      if (factorKey === "climate") return { stockCorrelation: "Negativ", stockCorrelationNote: "Verschärfte Emissionsgrenzwerte erzwingen teure EV-Transformation." };
    }
    // Utilities: interest = NEGATIVE (capital intensive), climate regulation = mixed
    if (isUtil) {
      if (factorKey === "interest") return { stockCorrelation: "Negativ", stockCorrelationNote: "Kapitalintensives Geschäftsmodell → Finanzierungskosten direkter Margen-Impact." };
      if (factorKey === "climate") return { stockCorrelation: isRenewable ? "Positiv" : "Negativ", stockCorrelationNote: isRenewable ? "Renewable Utilities profitieren von Transition-Mandaten." : "Fossile Erzeugung unter Druck durch CO₂-Kosten." };
    }
    // Infrastructure: gov spending = POSITIVE
    if (isInfra) {
      if (factorKey === "govDependency") return { stockCorrelation: "Positiv", stockCorrelationNote: "Infrastruktur-Programme (IIJA, EU Reconstruction) = direkte Auftragspipeline." };
      if (factorKey === "conjuncture") return { stockCorrelation: "Neutral", stockCorrelationNote: "Staatliche Infrastrukturausgaben sind teils antizyklisch." };
    }
    // Default: stock correlation matches generic impact
    return { stockCorrelation: genericImpact, stockCorrelationNote: "Generische Korrelation — Faktor wirkt auf diese Aktie wie auf den Gesamtmarkt." };
  }

  // === 1. POLITICAL ===
  const polFactors: PESTELFactorItem[] = [];
  const tradeImpact: "Positiv" | "Neutral" | "Negativ" = s.includes("tech") || ind.includes("auto") || s.includes("industrial") ? "Negativ" : "Neutral";
  const tradeCorr = stockCorr("trade", tradeImpact);
  polFactors.push({
    name: "Handelspolitik & Zölle",
    impact: tradeImpact,
    stockCorrelation: tradeCorr.stockCorrelation,
    stockCorrelationNote: tradeCorr.stockCorrelationNote,
    severity: isAsia || ind.includes("auto") ? "Hoch" : "Mittel",
    description: isAsia
      ? `Eskalationsrisiko US-China Handelskrieg direkt relevant. Strafzölle und Technologie-Exportbeschränkungen belasten Lieferketten und Marktzugang.`
      : isEU
      ? `EU-US Handelsbeziehungen unter Beobachtung. Mögliche Autozölle und Subventionswettbewerb (IRA vs. EU Green Deal) als Risikofaktoren.`
      : `Moderate Zollrisiken. Protektionismus-Tendenzen könnten Lieferketten und Exportmärkte belasten.`,
  });
  const regImpact: "Positiv" | "Neutral" | "Negativ" = s.includes("tech") || s.includes("financ") || s.includes("health") ? "Negativ" : "Neutral";
  const regCorr = stockCorr("regulation", regImpact);
  polFactors.push({
    name: "Regulierung & Compliance",
    impact: regImpact,
    stockCorrelation: regCorr.stockCorrelation,
    stockCorrelationNote: regCorr.stockCorrelationNote,
    severity: s.includes("tech") && (isEU || isAsia) ? "Hoch" : "Mittel",
    description: isEU
      ? `EU-Regulierung (DSGVO, AI Act, Digital Markets Act) erhöht Compliance-Kosten. Strenge Datenschutz- und Nachhaltigkeitsvorschriften als Kostenfaktor.`
      : isAsia
      ? `Regulatorische Eingriffe der Zentralregierung (v.a. China: Common Prosperity, Antitrust) können abrupt Geschäftsmodelle beeinträchtigen.`
      : `US-Regulierungsumfeld moderat. SEC-Enforcement und sektorspezifische Regulierung (FTC, FDA) als laufendes Risiko.`,
  });
  if (govExposure > 20) {
    const govCorr = stockCorr("govDependency", "Negativ");
    polFactors.push({
      name: "Government Dependency",
      impact: "Negativ",
      stockCorrelation: govCorr.stockCorrelation,
      stockCorrelationNote: govCorr.stockCorrelationNote,
      severity: "Hoch",
      description: `${govExposure}% Staatsauftragsabhängigkeit. Politische Zyklen und Haushaltskürzungen beeinflussen Auftragslage direkt.`,
    });
  }
  // Add geopolitical conflict factor for all stocks (with stock-specific correlation)
  const geoGenericImpact: "Positiv" | "Neutral" | "Negativ" = "Negativ";
  const geoCorr = stockCorr("geo", geoGenericImpact);
  polFactors.push({
    name: "Geopolitische Konflikte",
    impact: geoGenericImpact,
    stockCorrelation: geoCorr.stockCorrelation,
    stockCorrelationNote: geoCorr.stockCorrelationNote,
    severity: isAsia || isEM || isDefense ? "Hoch" : "Mittel",
    description: `Geopolitische Spannungen (Ukraine, Nahost, Taiwan-Straße) erhöhen globale Unsicherheit. Auswirkungen auf Lieferketten, Energiepreise und Risk-Premia.`,
  });
  factors.push({
    category: "Political",
    categoryDE: "Politisch",
    icon: "🏛️",
    factors: polFactors,
    regionalOutlook: isEU
      ? `${region}: EU-Politik geprägt von Green Deal, Verteidigungsausbau und Fragmentierungsrisiken. Europawahlen und nationale Politik beeinflussen Fiskalkurs.`
      : isAsia
      ? `${region}: Geopolitische Spannungen (Taiwan-Frage, Nordkorea) und staatliche Lenkung dominieren. Technologie-Decoupling als strukturelles Risiko.`
      : `${region}: Politische Polarisierung beeinflusst Fiskal- und Regulierungspolitik. Midterm/Wahljahre erhöhen politische Unsicherheit.`,
    exposureRating: govExposure > 20 || isAsia ? "Hoch" : isEU ? "Mittel" : "Niedrig",
  });

  // === 2. ECONOMIC ===
  const ecoFactors: PESTELFactorItem[] = [];
  const intImpact: "Positiv" | "Neutral" | "Negativ" = s.includes("real estate") || s.includes("financ") || s.includes("util") ? "Negativ" : "Neutral";
  const intCorr = stockCorr("interest", intImpact);
  ecoFactors.push({
    name: "Zinsentwicklung",
    impact: intImpact,
    stockCorrelation: intCorr.stockCorrelation,
    stockCorrelationNote: intCorr.stockCorrelationNote,
    severity: "Hoch",
    description: isEU
      ? `EZB-Zinspolitik: Leitzinsen bei ~3.5-4.0%, Tendenz seitwärts bis leicht fallend. Senkungszyklus begonnen, aber langsam. WACC-Entlastung von -0.5% bis -1.0% möglich über 12M.`
      : isAsia && reportedCurrency === "JPY"
      ? `BOJ beendet Negativzinspolitik. Normalisierung treibt JPY-Aufwertung und erhöht Finanzierungskosten japanischer Unternehmen. YCC-Aufhebung als Paradigmenwechsel.`
      : isAsia && reportedCurrency === "CNY"
      ? `PBoC im Lockerungsmodus – Zinssenkungen und Liquiditätsspritzen zur Stützung der Wirtschaft. Immobilienkrise drückt auf Konsumenten- und Unternehmensvertrauen.`
      : `Fed Funds Rate bei ~4.5-5.0%, Markterwartung für 1-2 Senkungen in nächsten 12M. Restriktive Geldpolitik drückt auf Bewertungsmultiples und Finanzierungskosten.`,
  });
  const inflImpact: "Positiv" | "Neutral" | "Negativ" = s.includes("consumer") && s.includes("stapl") ? "Neutral" : "Negativ";
  const inflCorr = stockCorr("inflation", inflImpact);
  ecoFactors.push({
    name: "Inflation & Kaufkraft",
    impact: inflImpact,
    stockCorrelation: inflCorr.stockCorrelation,
    stockCorrelationNote: inflCorr.stockCorrelationNote,
    severity: isEM ? "Hoch" : "Mittel",
    description: isEU
      ? `Eurozone-Inflation ~2.5-3.0%. Energiepreiskomponente rückläufig, aber Kerninflation persistent. Lohndruck durch Arbeitskräftemangel.`
      : isEM
      ? `EM-Inflation volatil, Währungsabwertung importiert Inflation. Kaufkraftverlust drückt auf Konsum und Margen.`
      : `US-Inflation ~3.0-3.5%, über Fed-Ziel. Sticky Services-Inflation verhindert schnelle Lockerung. Margendruckrisiko bei Cost-Push.`,
  });
  const conjImpact: "Positiv" | "Neutral" | "Negativ" = isEM || (isEU && ind.includes("auto")) ? "Negativ" : "Neutral";
  const conjCorr = stockCorr("conjuncture", conjImpact);
  ecoFactors.push({
    name: "Konjunkturausblick",
    impact: conjImpact,
    stockCorrelation: conjCorr.stockCorrelation,
    stockCorrelationNote: conjCorr.stockCorrelationNote,
    severity: isEM ? "Hoch" : "Mittel",
    description: isEU
      ? `EU-Wachstum schwach (~0.5-1.0% BIP). Deutschland in Stagnation, Peripherie stabiler. Manufacturing PMI unter 50. Risiko einer milden Rezession.`
      : isAsia && reportedCurrency === "CNY"
      ? `China-Wachstum ~4.5-5.0% offiziell, real vermutlich niedriger. Immobilienkrise, Deflationsrisiken und Jugendarbeitslosigkeit als strukturelle Probleme.`
      : `US-Wachstum ~2.0% BIP, resilient aber moderierend. Arbeitsmarkt kühlt ab. Soft Landing wahrscheinlichstes Szenario.`,
  });
  const interestOutlook = isEU
    ? "EZB: Leitzins 3.5-4.0%, Tendenz fallend → WACC-Entlastung -0.3-0.8% über 12M. Kapitalkosten sinken moderat."
    : isAsia && ["CNY", "HKD"].includes(reportedCurrency)
    ? "PBoC/HKMA: Lockerungszyklus, Zinsen tendenziell fallend → Kapitalkosten sinken, aber Währungsrisiko (CNY-Abwertung) kann USD-Rendite schmälern."
    : isAsia && reportedCurrency === "JPY"
    ? "BOJ: Normalisierung von Negativzinsen → Kapitalkosten steigen erstmals seit Dekade. JPY-Aufwertung als Gegenwind für Exporteure."
    : "Fed: Restriktiv bei ~4.5-5.0%, 1-2 Senkungen erwartet → WACC-Entlastung -0.3-0.5% über 12M. Vorsichtige Lockerung.";
  const capitalImpact = isEU
    ? "WACC sinkt moderat (-0.3-0.8% p.a.) bei EZB-Senkungen. EUR-Schwäche kann USD-Renditen positiv beeinflussen für US-Investoren."
    : isEM
    ? "EM-Risiko-Premium bleibt erhöht (+1-3% vs. DM). Währungsvolatilität erhöht effektive Kapitalkosten. Country-Risk-Adjustment nötig."
    : "Moderate WACC-Entlastung (-0.3-0.5%) bei Fed-Senkungen. Kapitalkosten bleiben über 2019-2021 Niveaus.";
  factors.push({
    category: "Economic",
    categoryDE: "Ökonomisch",
    icon: "📊",
    factors: ecoFactors,
    regionalOutlook: isEU
      ? `${region}: Schwaches Wachstum, fallende Zinsen, EUR-Schwäche. Industrie-Rezession möglich. Fiskalpolitik durch Schuldenregeln begrenzt.`
      : isAsia
      ? `${region}: Divergierende Geldpolitik. China lockert, Japan strafft. Geopolitik überschattet Wachstumspotenzial.`
      : `${region}: Soft Landing wahrscheinlich. Fed navigiert zwischen Inflation und Wachstum. Arbeitsmarkt normalisiert sich.`,
    exposureRating: s.includes("real estate") || s.includes("financ") || isEM ? "Hoch" : "Mittel",
  });

  // === 3. SOCIAL ===
  const socFactors: PESTELFactorItem[] = [];
  const demoImpact: "Positiv" | "Neutral" | "Negativ" = s.includes("health") ? "Positiv" : ind.includes("auto") || s.includes("consumer") ? "Negativ" : "Neutral";
  const demoCorr = stockCorr("demo", demoImpact);
  socFactors.push({
    name: "Demografischer Wandel",
    impact: demoImpact,
    stockCorrelation: demoCorr.stockCorrelation,
    stockCorrelationNote: demoCorr.stockCorrelationNote,
    severity: isEU || reportedCurrency === "JPY" ? "Hoch" : "Mittel",
    description: isEU || reportedCurrency === "JPY"
      ? `Alternde Bevölkerung → Arbeitskräftemangel, steigende Lohnkosten, sinkende Binnennachfrage für Konsumgüter. Positiv für Healthcare/Pharma.`
      : `Demografische Verschiebungen beeinflussen Arbeitsmärkte und Konsumverhalten. Urbanisierung und Gen-Z-Präferenzen verändern Nachfragemuster.`,
  });
  const esgImpact: "Positiv" | "Neutral" | "Negativ" = s.includes("energy") ? "Negativ" : "Neutral";
  const esgCorr = stockCorr("esg", esgImpact);
  socFactors.push({
    name: "ESG & Nachhaltigkeitsbewusstsein",
    impact: esgImpact,
    stockCorrelation: esgCorr.stockCorrelation,
    stockCorrelationNote: esgCorr.stockCorrelationNote,
    severity: isEU ? "Hoch" : "Mittel",
    description: isEU
      ? `EU-Taxonomie und CSRD-Reporting erhöhen Transparenzanforderungen. Greenwashing-Risiken und ESG-Compliance-Kosten als Zusatzbelastung.`
      : `Wachsendes ESG-Bewusstsein bei Investoren und Konsumenten. Reputationsrisiken bei Nichteinhaltung von Nachhaltigkeitsstandards.`,
  });
  factors.push({
    category: "Social",
    categoryDE: "Sozial",
    icon: "👥",
    factors: socFactors,
    regionalOutlook: isEU
      ? `${region}: Arbeitskräftemangel und Lohninflation als strukturelle Herausforderung. Migration und Skill-Mismatch bremsen Produktivität.`
      : isAsia
      ? `${region}: Urbanisierung treibt Konsum, aber Alterung (Japan, Korea) und Geburtenrückgang (China) als langfristige Bremse.`
      : `${region}: Arbeitsmarkt normalisiert sich. Remote Work und Skill Shifts verändern Produktivitätsmuster.`,
    exposureRating: (isEU || reportedCurrency === "JPY") && (s.includes("consumer") || s.includes("industrial")) ? "Hoch" : "Mittel",
  });

  // === 4. TECHNOLOGICAL ===
  const techFactors: PESTELFactorItem[] = [];
  const aiImpact: "Positiv" | "Neutral" | "Negativ" = s.includes("tech") ? "Positiv" : "Neutral";
  const aiCorr = stockCorr("ai", aiImpact);
  techFactors.push({
    name: "KI / Automatisierung",
    impact: aiImpact,
    stockCorrelation: aiCorr.stockCorrelation,
    stockCorrelationNote: aiCorr.stockCorrelationNote,
    severity: "Hoch",
    description: s.includes("tech")
      ? `AI-Adoption als primärer Wachstumstreiber. Unternehmen mit AI-Monetarisierung profitieren überproportional. Wettlauf um AI-Infrastruktur und Talent.`
      : `AI-Integration erhöht operative Effizienz und senkt Kosten. Automatisierung von Routineprozessen setzt Kapital frei. Disruptions-Risiko für traditionelle Geschäftsmodelle.`,
  });
  const cyberImpact: "Positiv" | "Neutral" | "Negativ" = "Negativ";
  const cyberCorr = stockCorr("cyber", cyberImpact);
  techFactors.push({
    name: "Cybersecurity & Datenschutz",
    impact: cyberImpact,
    stockCorrelation: cyberCorr.stockCorrelation,
    stockCorrelationNote: cyberCorr.stockCorrelationNote,
    severity: s.includes("tech") || s.includes("financ") ? "Hoch" : "Mittel",
    description: `Steigende Cyberangriffe und strengere Datenschutzgesetze erhöhen IT-Sicherheitskosten. Datenverlust kann erhebliche Reputations- und Finanzschäden verursachen.`,
  });
  factors.push({
    category: "Technological",
    categoryDE: "Technologisch",
    icon: "🔬",
    factors: techFactors,
    regionalOutlook: isEU
      ? `${region}: EU investiert in digitale Souveränität. AI Act reguliert als erste Jurisdiktion. Europäische Tech-Champions fehlen → Abhängigkeit von US/Asien.`
      : isAsia
      ? `${region}: Tech-Entkopplung US-China beschleunigt. Eigene Halbleiter- und AI-Ökosysteme werden aufgebaut. Hohe F&E-Investitionen.`
      : `${region}: US als globaler AI-Leader. Massive Capex-Zyklen (Hyperscaler) treiben Semiconductor- und Infrastrukturnachfrage.`,
    exposureRating: s.includes("tech") ? "Hoch" : "Mittel",
  });

  // === 5. ENVIRONMENTAL ===
  const envFactors: PESTELFactorItem[] = [];
  const climImpact: "Positiv" | "Neutral" | "Negativ" = s.includes("energy") || s.includes("industrial") || ind.includes("auto") ? "Negativ" : "Neutral";
  const climCorr = stockCorr("climate", climImpact);
  envFactors.push({
    name: "Klimaregulierung & CO₂-Kosten",
    impact: climImpact,
    stockCorrelation: climCorr.stockCorrelation,
    stockCorrelationNote: climCorr.stockCorrelationNote,
    severity: isEU ? "Hoch" : s.includes("energy") ? "Hoch" : "Mittel",
    description: isEU
      ? `EU ETS und CBAM erhöhen CO₂-Kosten direkt. Green Deal Vorgaben zwingen zu Investitionen in emissionsarme Technologien. Compliance-Kosten steigen progressiv.`
      : `Zunehmende CO₂-Regulierung weltweit. Paris-Ziele erfordern Transformation. Carbon-Kosten steigen als impliziter Kostenfaktor.`,
  });
  const enrgImpact: "Positiv" | "Neutral" | "Negativ" = s.includes("energy") && ind.includes("renew") ? "Positiv" : s.includes("energy") ? "Negativ" : "Neutral";
  const enrgCorr = stockCorr("energy", enrgImpact);
  envFactors.push({
    name: "Energietransition",
    impact: enrgImpact,
    stockCorrelation: enrgCorr.stockCorrelation,
    stockCorrelationNote: enrgCorr.stockCorrelationNote,
    severity: s.includes("energy") || ind.includes("auto") ? "Hoch" : "Mittel",
    description: `Beschleunigte Elektrifizierung und Renewable-Ausbau verändern Energiemärkte. Stranded Asset Risiko für fossile Infrastruktur. Investitionsbedarf in Transition-Technologien.`,
  });
  factors.push({
    category: "Environmental",
    categoryDE: "Umwelt",
    icon: "🌍",
    factors: envFactors,
    regionalOutlook: isEU
      ? `${region}: EU als Vorreiter bei Klimaregulierung. Green Deal und Fit for 55 treiben Transformation. Hohe Compliance-Kosten, aber auch Fördermittel.`
      : isAsia
      ? `${region}: Divergierende Umweltpolitik. China investiert massiv in Renewables, aber Kohleabhängigkeit bleibt. Japan/Korea beschleunigen Dekarbonisierung.`
      : `${region}: IRA-Subventionen stützen Clean Energy. Bipartisan Support für Energiesicherheit. Regulierung weniger stringent als EU.`,
    exposureRating: s.includes("energy") || (isEU && s.includes("industrial")) ? "Hoch" : "Mittel",
  });

  // === 6. LEGAL ===
  const legalFactors: PESTELFactorItem[] = [];
  const antitrustImpact: "Positiv" | "Neutral" | "Negativ" = s.includes("tech") ? "Negativ" : "Neutral";
  const antiCorr = stockCorr("antitrust", antitrustImpact);
  legalFactors.push({
    name: "Kartell- & Wettbewerbsrecht",
    impact: antitrustImpact,
    stockCorrelation: antiCorr.stockCorrelation,
    stockCorrelationNote: antiCorr.stockCorrelationNote,
    severity: s.includes("tech") && isEU ? "Hoch" : "Mittel",
    description: isEU
      ? `EU-Kartellbehörde (DG COMP) aggressiv bei Big Tech. Digital Markets Act und Gatekeeper-Regulierung als Compliance-Risiko.`
      : `Antitrust-Enforcement verstärkt sich global. M&A-Prüfungen werden strenger. Big Tech im Fokus von FTC/DOJ.`,
  });
  const taxCorr = stockCorr("tax", "Negativ" as const);
  legalFactors.push({
    name: "Steuerrecht & Transfer Pricing",
    impact: "Negativ",
    stockCorrelation: taxCorr.stockCorrelation,
    stockCorrelationNote: taxCorr.stockCorrelationNote,
    severity: isEM ? "Hoch" : "Mittel",
    description: `OECD Pillar 2 (Mindeststeuer 15%) reduziert Steueroptimierung. Nationale Digitalsteuern und Transfer-Pricing-Verschärfungen erhöhen effektive Steuerlast.`,
  });
  factors.push({
    category: "Legal",
    categoryDE: "Rechtlich",
    icon: "⚖️",
    factors: legalFactors,
    regionalOutlook: isEU
      ? `${region}: Strengste Regulierungslandschaft weltweit. DSGVO, AI Act, DMA/DSA als umfassendes Regelwerk. Hohe Compliance-Anforderungen.`
      : isAsia
      ? `${region}: Regulatorische Umgebung volatil. China kann abrupt Regeländerungen durchsetzen. Japan/Korea stabiler, aber Bürokratie als Bremse.`
      : `${region}: US-Regulierung moderat, aber steigende Enforcement. Litigation Risk als permanenter Faktor. Sammelklagen und SEC-Prüfungen.`,
    exposureRating: s.includes("tech") && isEU ? "Hoch" : isEM ? "Hoch" : "Mittel",
  });

  // Overall calculation
  const hochCount = factors.filter(f => f.exposureRating === "Hoch").length;
  const overallExposure: "Hoch" | "Mittel" | "Niedrig" = hochCount >= 3 ? "Hoch" : hochCount >= 1 ? "Mittel" : "Niedrig";
  const geoScore = Math.min(10, 3 + hochCount * 1.5 + (isEM ? 2 : 0) + (isAsia ? 1 : 0) + (govExposure > 20 ? 1 : 0));

  const macroSummary = isEU
    ? `Region ${region}: Schwaches BIP-Wachstum (~0.5-1%), EZB senkt Leitzinsen moderat. EUR-Schwäche vs USD. Energiekrise abgeklungen, aber Industrierezession möglich. Kapitalkosten fallend.`
    : isAsia && reportedCurrency === "CNY"
    ? `Region ${region}: BIP ~4.5-5%, Immobilienkrise belastet Sentiment. PBoC lockert. CNY unter Abwertungsdruck. Deflationsrisiko in Binnenwirtschaft. Kapitalkosten fallend, aber Country-Risk-Premium hoch.`
    : isAsia && reportedCurrency === "JPY"
    ? `Region ${region}: BOJ normalisiert Zinspolitik. JPY wertet auf. Deflationsende nach Dekaden. Arbeitsmarkt eng. Kapitalkosten steigen erstmals seit Jahren.`
    : isEM
    ? `Region ${region}: Volatile Währung und Inflation. Wachstum über DM-Niveau aber fragil. Kapitalkosten erhöht durch Sovereign-Spread und FX-Risiko.`
    : `Region USA: BIP ~2%, Soft Landing Szenario. Fed bei ~4.5-5%, 1-2 Senkungen erwartet. Arbeitsmarkt normalisiert sich. Kapitalkosten langsam fallend.`;

  return {
    factors,
    overallExposure,
    macroSummary,
    geopoliticalScore: Math.round(geoScore),
    interestRateOutlook: interestOutlook,
    capitalCostImpact: capitalImpact,
  };
}

// === Technical Analysis: MA + MACD ===
function computeTechnicalIndicators(ohlcvData: OHLCVPoint[]): TechnicalIndicators {
  const closes = ohlcvData.map(d => d.close);
  const n = closes.length;

  // SMA calculation — fills gaps for early data points using partial SMA from available data
  // When i < period-1, computes SMA from all available data points (i+1 points) if at least
  // a minimum threshold is met (50% of period, min 10 points). This ensures MA lines render
  // from early chart data rather than only appearing after 200 days.
  function sma(data: number[], period: number): (number | null)[] {
    const minRequired = Math.max(10, Math.floor(period * 0.5));
    return data.map((_, i) => {
      if (i >= period - 1) {
        // Full SMA with enough data
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += data[j];
        return sum / period;
      }
      // Partial SMA for early data points — use all available data (i+1 points)
      const available = i + 1;
      if (available >= minRequired) {
        let sum = 0;
        for (let j = 0; j <= i; j++) sum += data[j];
        return sum / available;
      }
      return null;
    });
  }

  // EMA calculation
  function ema(data: number[], period: number): (number | null)[] {
    const alpha = 2 / (period + 1);
    const result: (number | null)[] = [];
    // Start EMA from first SMA
    let initialSum = 0;
    for (let i = 0; i < Math.min(period, data.length); i++) {
      initialSum += data[i];
      result.push(null);
    }
    if (data.length < period) return result;
    result[period - 1] = initialSum / period;
    let prev = initialSum / period;
    for (let i = period; i < data.length; i++) {
      const val = alpha * data[i] + (1 - alpha) * prev;
      result.push(val);
      prev = val;
    }
    return result;
  }

  // Compute all MAs
  const ma200 = sma(closes, 200);
  const ma100_sma = sma(closes, 100);
  const ma50_sma = sma(closes, 50);
  const ma20 = sma(closes, 20);
  const ema26 = ema(closes, 26);
  const ema12 = ema(closes, 12);
  const ema9 = ema(closes, 9);

  // MACD = EMA12 - EMA26
  const macdLine: (number | null)[] = closes.map((_, i) => {
    if (ema12[i] === null || ema26[i] === null) return null;
    return ema12[i]! - ema26[i]!;
  });

  // Signal line = EMA9 of MACD
  const macdValues = macdLine.filter(v => v !== null) as number[];
  const signalRaw = ema(macdValues, 9);
  // Map signal back to full array
  const signalLine: (number | null)[] = new Array(n).fill(null);
  let si = 0;
  for (let i = 0; i < n; i++) {
    if (macdLine[i] !== null) {
      signalLine[i] = signalRaw[si] ?? null;
      si++;
    }
  }

  // Histogram = MACD - Signal
  const histogram: (number | null)[] = closes.map((_, i) => {
    if (macdLine[i] === null || signalLine[i] === null) return null;
    return macdLine[i]! - signalLine[i]!;
  });

  // Build MA data points
  const maData = ohlcvData.map((d, i) => ({
    date: d.date,
    close: d.close,
    ma200: ma200[i] !== null ? +ma200[i]!.toFixed(2) : undefined,
    ma100: ma100_sma[i] !== null ? +ma100_sma[i]!.toFixed(2) : undefined,
    ma50: ma50_sma[i] !== null ? +ma50_sma[i]!.toFixed(2) : undefined,
    ma20: ma20[i] !== null ? +ma20[i]!.toFixed(2) : undefined,
    ema26: ema26[i] !== null ? +ema26[i]!.toFixed(2) : undefined,
    ema12: ema12[i] !== null ? +ema12[i]!.toFixed(2) : undefined,
    ema9: ema9[i] !== null ? +ema9[i]!.toFixed(2) : undefined,
  }));

  // Build MACD data points
  const macdData = ohlcvData.map((d, i) => ({
    date: d.date,
    macd: macdLine[i] !== null ? +macdLine[i]!.toFixed(4) : undefined,
    signal: signalLine[i] !== null ? +signalLine[i]!.toFixed(4) : undefined,
    histogram: histogram[i] !== null ? +histogram[i]!.toFixed(4) : undefined,
  }));

  // === Buy/Sell Signals ===
  const signals: { date: string; type: "buy" | "sell"; reason: string; price: number }[] = [];

  for (let i = 1; i < n; i++) {
    // Golden Cross: MA50 crosses above MA200
    if (ma50_sma[i] !== null && ma200[i] !== null && ma50_sma[i - 1] !== null && ma200[i - 1] !== null) {
      if (ma50_sma[i - 1]! <= ma200[i - 1]! && ma50_sma[i]! > ma200[i]!) {
        signals.push({ date: ohlcvData[i].date, type: "buy", reason: "Golden Cross (MA50 > MA200)", price: closes[i] });
      }
      // Death Cross: MA50 crosses below MA200
      if (ma50_sma[i - 1]! >= ma200[i - 1]! && ma50_sma[i]! < ma200[i]!) {
        signals.push({ date: ohlcvData[i].date, type: "sell", reason: "Death Cross (MA50 < MA200)", price: closes[i] });
      }
    }

    // MACD crossovers
    if (macdLine[i] !== null && signalLine[i] !== null && macdLine[i - 1] !== null && signalLine[i - 1] !== null) {
      // MACD crosses above signal = bullish
      if (macdLine[i - 1]! <= signalLine[i - 1]! && macdLine[i]! > signalLine[i]!) {
        signals.push({ date: ohlcvData[i].date, type: "buy", reason: "MACD Bullish Crossover", price: closes[i] });
      }
      // MACD crosses below signal = bearish
      if (macdLine[i - 1]! >= signalLine[i - 1]! && macdLine[i]! < signalLine[i]!) {
        signals.push({ date: ohlcvData[i].date, type: "sell", reason: "MACD Bearish Crossover", price: closes[i] });
      }
    }
  }

  // Current status
  const lastIdx = n - 1;
  const currentAboveMA200 = ma200[lastIdx] !== null && closes[lastIdx] > ma200[lastIdx]!;
  const ma50AboveMA200 = ma50_sma[lastIdx] !== null && ma200[lastIdx] !== null && ma50_sma[lastIdx]! > ma200[lastIdx]!;
  const macdAboveZero = macdLine[lastIdx] !== null && macdLine[lastIdx]! > 0;
  const macdRising = macdLine[lastIdx] !== null && macdLine[lastIdx - 1] !== null && macdLine[lastIdx]! > macdLine[lastIdx - 1]!;

  const buyConditionsMet = currentAboveMA200 && ma50AboveMA200 && macdAboveZero && macdRising;

  return {
    maData,
    macdData,
    signals,
    currentStatus: {
      priceAboveMA200: currentAboveMA200,
      ma50AboveMA200,
      macdAboveZero,
      macdRising,
      buySignal: buyConditionsMet,
      ma200Value: ma200[lastIdx] ?? undefined,
      ma50Value: ma50_sma[lastIdx] ?? undefined,
      macdValue: macdLine[lastIdx] ?? undefined,
      signalValue: signalLine[lastIdx] ?? undefined,
    },
  };
}


// === Porter's Five Forces & Moat Assessment ===
function generateMoatAssessment(
  sector: string, industry: string, fcfMargin: number,
  marketCap: number, revenueGrowth: number, moatRating: string,
  description: string = '', companyName: string = ''
): MoatAssessment {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();
  const isLargeCap = marketCap > 50e9;
  const isMegaCap = marketCap > 500e9;
  // Extract company-specific keywords for Porter reasoning
  const hasPayments = desc.includes('payment') || desc.includes('transaction');
  const hasMarketplace = desc.includes('marketplace') || desc.includes('e-commerce');
  const hasSuperApp = desc.includes('super app') || desc.includes('super-app');
  const hasNetwork = desc.includes('network') || desc.includes('platform') || hasPayments || hasMarketplace;
  const hasSubscription = desc.includes('subscription') || desc.includes('recurring');
  const hasPatents = desc.includes('patent') || desc.includes('fda') || desc.includes('approval');
  const hasRegulated = desc.includes('regulated') || desc.includes('license') || desc.includes('banking');
  const hasEM = desc.includes('kazakhstan') || desc.includes('india') || desc.includes('brazil') || desc.includes('nigeria') || desc.includes('indonesia');
  const name = companyName || 'Das Unternehmen';

  const forces: PorterForce[] = [];

  // 1. Threat of New Entrants — company-specific
  {
    let rating: 'Low' | 'Medium' | 'High' = 'Medium';
    let score = 3;
    let reasoning = '';
    if (hasNetwork || hasSuperApp) {
      rating = 'Low'; score = 2;
      reasoning = `${name} profitiert von Netzwerkeffekten (${hasPayments ? 'Payment-Netzwerk' : ''}${hasMarketplace ? ', Marketplace' : ''}${hasSuperApp ? ', Super-App-Ökosystem' : ''}). Hohe Nutzerbasis und Datenvorsprung erschweren Neueintritten die Nutzerakquisition.`;
    } else if (isMegaCap) {
      rating = 'Low'; score = 2;
      reasoning = `${name} hat als Mega-Cap massive Skaleneffekte. Kapitalanforderungen und Brand-Vorsprung bilden hohe Eintrittsbarrieren.`;
    } else if (hasRegulated || s.includes('financ')) {
      rating = 'Low'; score = 2;
      reasoning = `Regulatorische Lizenz- und Kapitalanforderungen${hasEM ? ' (lokal reguliert)' : ''} schützen ${name} vor schnellem Markteintritt neuer Wettbewerber.`;
    } else if (hasPatents || s.includes('health')) {
      rating = 'Low'; score = 2;
      reasoning = `Patent-/Zulassungsschutz bildet hohe Eintrittsbarrieren für ${name}. Neue Wettbewerber müssen langwierige Genehmigungsprozesse durchlaufen.`;
    } else if (s.includes('energy') || s.includes('industrial')) {
      rating = 'Low'; score = 1;
      reasoning = `Sehr hohe Kapitalanforderungen und lange Projektlaufzeiten schützen ${name}. Infrastruktur-Moat.`;
    } else {
      reasoning = `Moderate Eintrittsbarrieren für ${name}. ${s.includes('tech') ? 'Technologische Innovationen können Barrieren senken.' : 'Kapital- und Markenanforderungen variieren.'}`;
    }
    forces.push({ name: 'Bedrohung durch neue Wettbewerber', rating, score, reasoning });
  }

  // 2. Bargaining Power of Suppliers — company-specific
  {
    let rating: 'Low' | 'Medium' | 'High' = 'Medium';
    let score = 3;
    let reasoning = '';
    if (hasPayments || hasSuperApp || s.includes('financ')) {
      rating = 'Low'; score = 2;
      reasoning = `${name} hat als Plattform geringe Lieferantenabhängigkeit. Primäre Inputs sind Technologie und Regulierung.`;
    } else if (s.includes('tech') && (desc.includes('software') || desc.includes('saas'))) {
      rating = 'Low'; score = 2;
      reasoning = `${name} als Software-Unternehmen hat geringe physische Lieferantenabhängigkeit.`;
    } else if (s.includes('energy') || desc.includes('commodity')) {
      rating = 'High'; score = 4;
      reasoning = `${name} ist stark von Rohstoffpreisen und spezialisierten Zulieferern abhängig.`;
    } else {
      reasoning = `Moderate Lieferantenabhängigkeit für ${name}.`;
    }
    forces.push({ name: 'Verhandlungsmacht der Lieferanten', rating, score, reasoning });
  }

  // 3. Bargaining Power of Buyers — company-specific
  {
    let rating: 'Low' | 'Medium' | 'High' = 'Medium';
    let score = 3;
    let reasoning = '';
    if (hasSuperApp || (hasPayments && hasMarketplace)) {
      rating = 'Low'; score = 2;
      reasoning = `${name} bindet Nutzer über integriertes Ökosystem. Hohe Wechselkosten durch Datenbindung und Convenience.`;
    } else if (hasNetwork || (s.includes('tech') && isMegaCap)) {
      rating = 'Low'; score = 2;
      reasoning = `Plattform-Lock-in und Netzwerkeffekte limitieren Kundenverhandlungsmacht bei ${name}.`;
    } else if (s.includes('consumer') && !ind.includes('luxury')) {
      rating = 'High'; score = 4;
      reasoning = `Endverbraucher von ${name} sind preissensitiv. Geringe Wechselkosten.`;
    } else {
      reasoning = `Moderate Kundenverhandlungsmacht für ${name}.`;
    }
    forces.push({ name: 'Verhandlungsmacht der Kunden', rating, score, reasoning });
  }

  // 4. Threat of Substitutes — company-specific
  {
    let rating: 'Low' | 'Medium' | 'High' = 'Medium';
    let score = 3;
    let reasoning = '';
    if (hasSuperApp) {
      rating = 'Low'; score = 2;
      reasoning = `${name} als Super-App hat geringe Substitutionsgefahr — das Gesamtökosystem ist schwer zu ersetzen.`;
    } else if (hasPatents || s.includes('health')) {
      rating = 'Low'; score = 2;
      reasoning = `Patent-/Zulassungsschutz begrenzt direkte Substitute für ${name}.`;
    } else if (s.includes('energy')) {
      rating = 'High'; score = 4;
      reasoning = `Erneuerbare Energien und Elektrifizierung substituieren zunehmend Produkte von ${name}.`;
    } else {
      reasoning = `Moderate Substitutionsrisiken für ${name}. Technologische Disruption als Risikofaktor.`;
    }
    forces.push({ name: 'Bedrohung durch Substitute', rating, score, reasoning });
  }

  // 5. Competitive Rivalry — company-specific
  {
    let rating: 'Low' | 'Medium' | 'High' = 'Medium';
    let score = 3;
    let reasoning = '';
    if (hasSuperApp && hasEM) {
      rating = 'Medium'; score = 3;
      reasoning = `${name} hat im Heimatmarkt eine dominante Position, internationale Expansion bringt Wettbewerb mit globalen Playern.`;
    } else if (isMegaCap) {
      rating = 'High'; score = 4;
      reasoning = `Intensiver Wettbewerb zwischen ${name} und anderen dominanten Playern. Hohe F&E- und Marketing-Ausgaben.`;
    } else if (s.includes('util')) {
      rating = 'Low'; score = 2;
      reasoning = `${name} operiert in einem regulierten Markt mit begrenztem Wettbewerb.`;
    } else {
      reasoning = `Moderate Wettbewerbsintensität für ${name}. ${revenueGrowth > 20 ? 'Hohes Wachstum deutet auf Differenzierung.' : 'Marktpositionierung als Differenzierungsfaktor.'}`;
    }
    forces.push({ name: 'Wettbewerbsintensität', rating, score, reasoning });
  }

  // Moat sources — company-specific
  const moatSources: string[] = [];
  if (fcfMargin > 25) moatSources.push(`Hohe FCF-Marge (${fcfMargin.toFixed(0)}%) → Pricing Power`);
  if (hasSuperApp) moatSources.push('Super-App-Ökosystem / Multi-Service-Lock-in');
  if (hasNetwork) moatSources.push('Netzwerkeffekte / Plattform-Ökosystem');
  if (hasPayments && hasMarketplace) moatSources.push('Integrierte Payments + Marketplace → Switching Costs');
  if (isMegaCap) moatSources.push('Skaleneffekte / Economies of Scale');
  if (hasPatents || s.includes('health')) moatSources.push('Patentschutz / Zulassungsbarrieren');
  if (hasRegulated || s.includes('financ')) moatSources.push('Regulatorische Lizenzbarrieren');
  if (s.includes('energy')) moatSources.push('Infrastruktur / Asset-Heavy Moat');
  if (isLargeCap && !hasNetwork) moatSources.push('Brand Equity / Markenbekanntheit');
  if (revenueGrowth > 15) moatSources.push(`Starkes Wachstum (${revenueGrowth.toFixed(0)}%) → Marktanteilsgewinne`);

  if (moatSources.length === 0) moatSources.push("Keine eindeutigen Moat-Quellen identifiziert");

  const avgScore = forces.reduce((s, f) => s + f.score, 0) / forces.length;
  let sustainabilityRating = "★★★";
  if (moatRating === "Wide") sustainabilityRating = "★★★★★";
  else if (moatRating === "Narrow-Wide") sustainabilityRating = "★★★★";
  else if (moatRating === "Narrow") sustainabilityRating = "★★★";
  else sustainabilityRating = "★★";

  return {
    overallRating: moatRating,
    moatSources,
    porterForces: forces,
    businessModelStrength: avgScore <= 2.5 ? "Starkes Geschäftsmodell – gut geschützt" :
      avgScore <= 3.5 ? "Solides Geschäftsmodell – moderate Wettbewerbsrisiken" :
      "Exponiertes Geschäftsmodell – hohe Wettbewerbsrisiken",
    sustainabilityRating,
  };
}

// === Geopolitical Risks (generisch für Zyklusanalyse) ===
function generateGeopoliticalRisks(sector: string, industry: string): { event: string; impact: string; exposure: "Hoch" | "Mittel" | "Niedrig" }[] {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const risks: { event: string; impact: string; exposure: "Hoch" | "Mittel" | "Niedrig" }[] = [];

  // Universal geopolitical risks that affect all companies
  risks.push({
    event: "Globale Zollkonflikte / Handelskriege",
    impact: "Erhöhte Inputkosten, gestörte Lieferketten, Nachfragerückgang in Export-Märkten. Margendruckrisiko bei hoher Import-/Exportabhängigkeit.",
    exposure: s.includes("tech") || s.includes("industrial") || s.includes("consumer") || ind.includes("auto") || ind.includes("semiconductor")
      ? "Hoch" : s.includes("util") || s.includes("health") ? "Niedrig" : "Mittel",
  });

  risks.push({
    event: "Konjunkturelle Abkühlung / Rezessionsrisiko",
    impact: "Nachfrageeinbruch, steigende Ausfallraten, Multiple-Kompression. Zyklische Sektoren besonders betroffen. Investitionskürzungen.",
    exposure: s.includes("consumer") && s.includes("discr") ? "Hoch" :
      s.includes("tech") || s.includes("financ") || s.includes("industrial") ? "Hoch" :
      s.includes("health") || s.includes("util") || s.includes("stapl") ? "Niedrig" : "Mittel",
  });

  risks.push({
    event: "Nahostkonflikt / Irankonflikt – Eskalation",
    impact: "Ölpreisschock → steigende Energiekosten, Lieferkettenunterbrechung im Suezkanal, Risk-off-Sentiment an Märkten. Inflation reimportiert.",
    exposure: s.includes("energy") ? "Hoch" :
      s.includes("industrial") || s.includes("transport") || ind.includes("airline") || ind.includes("shipping") ? "Hoch" :
      s.includes("util") || s.includes("health") ? "Niedrig" : "Mittel",
  });

  risks.push({
    event: "China-Taiwan-Spannungen / Chipembargo",
    impact: "Halbleiter-Lieferengpässe, Absatzverlust im China-Markt, Technologie-Entkopplung. Besonders relevant für Unternehmen mit hoher China-Exposure.",
    exposure: s.includes("tech") || ind.includes("semiconductor") || ind.includes("hardware") ? "Hoch" :
      ind.includes("auto") || ind.includes("electronic") ? "Hoch" :
      s.includes("health") || s.includes("util") || s.includes("real estate") ? "Niedrig" : "Mittel",
  });

  risks.push({
    event: "Energiekrise / Versorgungssicherheit",
    impact: "Gaspreisvolatilität, industrielle Produktionseinschränkungen, regulatorische Eingriffe in Energiemärkte. Standortnachteile für energieintensive Industrien.",
    exposure: s.includes("energy") ? "Hoch" :
      s.includes("industrial") || ind.includes("chemical") || ind.includes("material") || ind.includes("mining") ? "Hoch" :
      s.includes("tech") || s.includes("health") ? "Niedrig" : "Mittel",
  });

  risks.push({
    event: "Regulatorische Verschärfung / ESG-Auflagen",
    impact: "Erhöhte Compliance-Kosten, eingeschränkte Geschäftsmodelle (z.B. Daten-/Umweltregulierung), Kapitalallokation in non-productive Assets.",
    exposure: s.includes("tech") || s.includes("energy") || s.includes("financ") ? "Hoch" :
      s.includes("health") || ind.includes("pharma") ? "Hoch" : "Mittel",
  });

  risks.push({
    event: "Zinspolitik / Währungsvolatilität",
    impact: "Höhere Finanzierungskosten, DCF-Abwertung, Druck auf verschuldete Unternehmen. Emerging-Market-Exposure bei USD-Stärke negativ.",
    exposure: s.includes("real estate") || s.includes("financ") ? "Hoch" :
      s.includes("util") ? "Hoch" :
      s.includes("tech") && ind.includes("software") ? "Niedrig" : "Mittel",
  });

  return risks;
}

// === Catalyst Reasoning ===
function generateCatalystReasoning(
  sector: string, industry: string, revenueGrowth: number,
  fcfMargin: number, pe: number, price: number,
  analystPT: number, rsl: number
): CatalystReasoning {
  const s = sector.toLowerCase();
  const drivers: string[] = [];
  const reasons: string[] = [];

  // Valuation angle
  if (analystPT > price * 1.15) {
    reasons.push(`Analyst PT liegt ${((analystPT / price - 1) * 100).toFixed(0)}% über aktuellem Kurs – Consensus sieht signifikantes Upside`);
    drivers.push("Analyst-Consensus-Upside");
  }

  // Growth angle
  if (revenueGrowth > 20) {
    reasons.push(`Revenue Growth von ${revenueGrowth.toFixed(1)}% signalisiert starkes organisches Momentum`);
    drivers.push("Revenue Acceleration");
  } else if (revenueGrowth > 10) {
    reasons.push(`Solides Revenue Growth von ${revenueGrowth.toFixed(1)}% mit Potential für Operating Leverage`);
    drivers.push("Growth + Margin Expansion");
  }

  // Margin angle
  if (fcfMargin > 25) {
    reasons.push(`FCF-Marge von ${fcfMargin.toFixed(1)}% zeigt starke Cash-Generierung und Pricing Power`);
    drivers.push("Cash Flow Strength");
  }

  // Momentum angle
  if (rsl > 110) {
    reasons.push(`RSL > 110 – starkes relatives Momentum signalisiert institutionelles Kaufinteresse`);
    drivers.push("Positives Momentum");
  }

  // Sector-specific
  const ind = industry.toLowerCase();
  if (s.includes("tech")) {
    reasons.push("AI-Monetarisierungszyklus bietet strukturellen Rückenwind für Tech-Plattformen");
    drivers.push("AI / Cloud Tailwind");
  } else if (s.includes("health")) {
    reasons.push("Demografischer Wandel und Biotech-Innovationszyklen treiben langfristige Nachfrage");
    drivers.push("Demographic Tailwind");
  } else if (s.includes("financ")) {
    reasons.push("Zinsnormalisierung verbessert Net Interest Margin und Earnings Power");
    drivers.push("Rate Environment");
  } else if (s.includes("energy")) {
    reasons.push("Energy Security Focus und Transition Investment bieten duales Exposure");
    drivers.push("Energy Transition");
  } else if (s.includes("consumer") && (s.includes("cycl") || s.includes("discr"))) {
    if (ind.includes("luxury") || ind.includes("fashion") || ind.includes("apparel")) {
      reasons.push("Luxusgüter-Nachfrage erholungspotenzial in China/Asien und Premiumisierungs-Trend");
      drivers.push("Luxury Demand Recovery");
    } else {
      reasons.push("Consumer Spending Recovery und E-Commerce-Durchdringung als Wachstumstreiber");
      drivers.push("Consumer Recovery");
    }
  } else if (s.includes("industrial")) {
    reasons.push("Infrastruktur-Investitionszyklen und Automatisierungstrend bieten säkularen Rückenwind");
    drivers.push("Capex Cycle");
  }

  if (reasons.length === 0) {
    reasons.push("Standardbewertungslevel – auf spezifische Katalysatoren achten");
    drivers.push("Sector Rotation");
  }

  const timing = rsl > 105 ? "Momentum spricht für zeitnahen Einstieg" :
    "RSL < 105 – abwarten bis positives Momentum bestätigt wird";

  return {
    whyInteresting: reasons.join(". ") + ".",
    keyDrivers: drivers,
    timingRationale: timing,
  };
}

// === Macro Correlation Generator ===
function generateMacroCorrelations(
  sector: string, industry: string, description: string,
  beta: number, reportedCurrency: string
): MacroCorrelations {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();
  const correlations: MacroCorrelation[] = [];

  const isDefense = ind.includes("defense") || ind.includes("aerospace") || desc.includes("defense") || desc.includes("military");
  const isTech = s.includes("tech");
  const isEnergy = s.includes("energy");
  const isBank = ind.includes("bank") || s.includes("financ");
  const isRealEstate = s.includes("real estate");
  const isConsumer = s.includes("consumer");
  const isIndustrial = s.includes("industrial");
  const isSemiconductor = ind.includes("semicon") || desc.includes("semiconductor") || desc.includes("chip");
  const isCloud = desc.includes("cloud") || desc.includes("aws") || desc.includes("azure");
  const isMining = ind.includes("mining") || ind.includes("metals");
  const isAuto = ind.includes("auto");

  // === INDICES ===
  correlations.push({
    name: "S&P 500",
    category: "Index",
    correlation: "Positiv",
    strength: beta > 1.3 ? "Stark" : beta > 0.7 ? "Moderat" : "Schwach",
    mechanism: `β = ${beta} → Aktie bewegt sich ${beta > 1 ? "überproportional" : "unterproportional"} mit dem Gesamtmarkt. ${beta > 1.3 ? "Hohe Sensitivität bei Markteinbrüchen (Risk-on/off)." : "Moderate Markt-Korrelation."}`,
  });

  correlations.push({
    name: "NASDAQ 100",
    category: "Index",
    correlation: isTech || isSemiconductor || isCloud ? "Positiv" : "Neutral",
    strength: isTech ? "Stark" : "Moderat",
    mechanism: isTech
      ? "Tech-Aktie korreliert stark mit NASDAQ-Momentum. Growth-Rotation und Multiple-Expansion/-Compression wirken direkt."
      : "Moderate Korrelation über allgemeine Risk-on/off-Dynamik. Kein direkter Tech-Index-Treiber.",
  });

  if (isIndustrial || isAuto || isDefense) {
    correlations.push({
      name: "DAX / Euro Stoxx 50",
      category: "Index",
      correlation: "Positiv",
      strength: "Moderat",
      mechanism: "Industrieaktien korrelieren mit europäischer Konjunktur und Exportnachfrage. PMI-Eurozone als Vorlaufindikator.",
    });
  }

  if (desc.includes("china") || desc.includes("asia") || isSemiconductor) {
    correlations.push({
      name: "Hang Seng / CSI 300",
      category: "Index",
      correlation: "Positiv",
      strength: "Moderat",
      mechanism: "China-Exposure über Absatzmärkte oder Lieferketten. Chinesische Stimulus-Maßnahmen wirken als indirekter Kurstreiber.",
    });
  }

  // VIX (inverse for most stocks)
  correlations.push({
    name: "VIX (Volatilitätsindex)",
    category: "Index",
    correlation: "Invers",
    strength: beta > 1.2 ? "Stark" : "Moderat",
    mechanism: `VIX-Spikes signalisieren Risk-off → Abverkauf von Growth/Cyclicals. β=${beta} verstärkt den Effekt. VIX > 30 historisch mit -${Math.round(10 + beta * 8)}% bis -${Math.round(20 + beta * 10)}% Drawdown korreliert.`,
  });

  // === MACRO INDICATORS ===
  correlations.push({
    name: "ISM Manufacturing PMI",
    category: "Macro-Indikator",
    correlation: isIndustrial || isAuto || isSemiconductor ? "Positiv" : isBank ? "Positiv" : isTech && isCloud ? "Neutral" : "Positiv",
    strength: isIndustrial || isSemiconductor ? "Stark" : isTech && isCloud ? "Schwach" : "Moderat",
    mechanism: isIndustrial
      ? "PMI > 50 = Expansion → steigende Auftragseingänge und Capex-Zyklen treiben Industrieaktien direkt."
      : isTech && isCloud
      ? "Cloud/Software-Spending teils unabhängig von Manufacturing PMI. Korrelation über Gesamtkonjunktur aber vorhanden."
      : "PMI als Vorlaufindikator für Konjunktur. PMI-Einbrüche unter 48 signalisieren Rezessionsrisiko für alle Sektoren.",
  });

  correlations.push({
    name: "US 10Y Treasury Yield",
    category: "Macro-Indikator",
    correlation: isTech ? "Invers" : isBank ? "Positiv" : isRealEstate ? "Invers" : "Invers",
    strength: isTech || isRealEstate || isBank ? "Stark" : "Moderat",
    mechanism: isTech
      ? "Steigende Zinsen komprimieren Growth-Multiples (DCF-Diskontierung). 10Y Yield +100bps → ca. -10-15% auf Tech-Bewertungen."
      : isBank
      ? "Höhere Langfristzinsen erweitern Nettozinsmarge (NIM) → direkte EPS-Steigerung. Positiver Effekt bei normaler Zinsstrukturkurve."
      : isRealEstate
      ? "Immobilien-Finanzierungskosten steigen direkt mit 10Y Yield. Cap Rates müssen adjustieren → Bewertungsdruck."
      : "Höhere Zinsen erhöhen WACC und komprimieren Equity-Bewertungen. Moderate Sensitivität bei etablierten Geschäftsmodellen.",
  });

  correlations.push({
    name: "US Consumer Confidence Index",
    category: "Macro-Indikator",
    correlation: isConsumer ? "Positiv" : "Neutral",
    strength: isConsumer ? "Stark" : "Schwach",
    mechanism: isConsumer
      ? "Consumer Confidence direkt korreliert mit diskretionären Ausgaben. Index < 80 historisch mit Retail-Underperformance verbunden."
      : "Indirekter Einfluss über Gesamtkonjunktur. Nicht-Konsumwerte reagieren verzögert und schwächer.",
  });

  correlations.push({
    name: "Fed Funds Rate (Zinserwartungen)",
    category: "Macro-Indikator",
    correlation: isTech || isRealEstate ? "Invers" : isBank ? "Positiv" : "Invers",
    strength: "Stark",
    mechanism: isTech
      ? "Hawkish Fed → höherer Diskontierungssatz → Growth-Derating. Fed-Pivot ist stärkster Einzelkatalysator für Tech-Multiple-Expansion."
      : isBank
      ? "Steigende Kurzfristzinsen erhöhen Deposit-Spreads und NIM. Allerdings: Yield-Curve-Inversion negativ (Kreditrisikoprämie)."
      : "Restriktive Geldpolitik erhöht Kapitalkosten und bremst Investment-Zyklen. Zinssenkungserwartungen wirken als Bewertungshebel.",
  });

  // === COMMODITIES (Energy) ===
  correlations.push({
    name: "WTI Crude Oil (Rohöl)",
    category: "Commodity",
    correlation: isEnergy ? "Positiv" : isAuto || (isConsumer && !ind.includes("stapl")) ? "Invers" : "Neutral",
    strength: isEnergy ? "Stark" : isAuto ? "Moderat" : "Schwach",
    mechanism: isEnergy
      ? "Direkte Umsatz-/Gewinnkorrelation. Rohöl +10% → EBITDA +15-25% bei Upstream-Produzenten. Hedge-Positionen können Korrelation verzögern."
      : isAuto
      ? "Hohe Ölpreise belasten Verbraucher-Budgets und verschieben Kaufentscheidungen. EV-Nachfrage profitiert aber indirekt."
      : "Moderate indirekte Korrelation über Transport-/Energiekosten. Kein primärer Kurstreiber für diesen Sektor.",
  });

  if (isEnergy || isIndustrial || isMining) {
    correlations.push({
      name: "Natural Gas (Henry Hub)",
      category: "Commodity",
      correlation: isEnergy ? "Positiv" : "Neutral",
      strength: isEnergy ? "Moderat" : "Schwach",
      mechanism: isEnergy
        ? "Gaspreis beeinflusst Utility-/LNG-Einnahmen. Saisonale Schwankungen und Geopolitik (Europa-Abhängigkeit) als Volatilitätstreiber."
        : "Indirekter Kosteneinfluss über Energiepreise. Kein primärer Kurstreiber.",
    });
  }

  // === EDELMETALLE (Precious Metals) ===
  correlations.push({
    name: "Gold (XAU)",
    category: "Edelmetall",
    correlation: isMining && (ind.includes("gold") || desc.includes("gold")) ? "Positiv"
      : isTech || isSemiconductor ? "Invers"
      : isBank ? "Invers"
      : "Neutral",
    strength: isMining && (ind.includes("gold") || desc.includes("gold")) ? "Stark"
      : isTech ? "Moderat"
      : "Schwach",
    mechanism: isMining && (ind.includes("gold") || desc.includes("gold"))
      ? "Direkte Korrelation: Gold-Preis × Fördervolumen = Umsatz. Margenhebelung bei steigenden Preisen (Fixkostendegression)."
      : isTech || isSemiconductor
      ? "Gold als Safe-Haven steigt in Risk-off-Phasen, während Tech-Multiples komprimieren → kurzfristig invers. Gold-Rally signalisiert Inflations-/Rezessionssorgen."
      : isBank
      ? "Gold-Stärke korreliert mit Zinsunsicherheit und Vertrauensverlust ins Finanzsystem → negativ für Banken-Sentiment."
      : "Indirekter Hedge-Indikator: Steigendes Gold signalisiert Risikoaversion und potenzielle Umschichtung aus Aktien.",
  });

  correlations.push({
    name: "Silber (XAG)",
    category: "Edelmetall",
    correlation: isMining ? "Positiv"
      : isIndustrial || isSemiconductor ? "Positiv"
      : isTech ? "Neutral"
      : "Neutral",
    strength: isMining ? "Stark" : isIndustrial || isSemiconductor ? "Moderat" : "Schwach",
    mechanism: isMining
      ? "Silber-Mining direkt an Spotpreis gekoppelt. Hybrides Asset: 50% Industrienachfrage (Solar, Elektronik) + 50% Edelmetall-Nachfrage."
      : isIndustrial || isSemiconductor
      ? "Silber als Industriemetall in Elektronik, Solar-PV und Halbleiterfertigung. Steigende Preise signalisieren Tech-Industrienachfrage."
      : "Silber folgt Gold-Trend mit höherer Volatilität (Gold/Silber-Ratio ~80). Schwächerer Safe-Haven als Gold, stärkerer Konjunkturindikator.",
  });

  // === INDUSTRIEMETALLE ===
  correlations.push({
    name: "Kupfer (Dr. Copper)",
    category: "Industriemetall",
    correlation: isMining || isIndustrial || isAuto ? "Positiv"
      : isRealEstate ? "Positiv"
      : isTech && (desc.includes("data center") || desc.includes("infrastructure")) ? "Positiv"
      : "Neutral",
    strength: isMining ? "Stark" : isIndustrial || isAuto ? "Moderat" : "Schwach",
    mechanism: isMining
      ? "Direkte Korrelation mit Kupfer-Spotpreis. Kupfer +10% → Mining-EBITDA +15-30%. Elektrifizierung und AI-Datacenter treiben Langfristnachfrage."
      : isIndustrial || isAuto
      ? "Kupfer als Konjunkturbarometer (\"Dr. Copper\"). Steigende Preise signalisieren starke Industrienachfrage. EV-Produktion benötigt 3-4x mehr Kupfer als Verbrenner."
      : isRealEstate
      ? "Bauindustrie verbraucht ~30% der globalen Kupferproduktion. Kupferpreis-Rallyes korrelieren mit Immobilien-Boom-Phasen."
      : "Kupfer als globaler Konjunkturindikator. Moderate indirekte Korrelation über Wirtschaftswachstum und Investitionszyklen.",
  });

  correlations.push({
    name: "Aluminium (LME)",
    category: "Industriemetall",
    correlation: isIndustrial || isAuto || isMining ? "Positiv" : "Neutral",
    strength: isMining || isAuto ? "Moderat" : "Schwach",
    mechanism: isIndustrial || isAuto
      ? "Aluminium als Key-Input für Automotive (Leichtbau), Verpackung und Bauwesen. Preisanstieg belastet Margen bei Verarbeitern, stützt Produzenten."
      : isMining
      ? "Aluminium-Preis direkt umsatzrelevant für Basismetall-Miner. Energiekosten (Schmelze) als Preistreiber."
      : "Geringe direkte Korrelation. Aluminium reflektiert globale Industriekonjunktur als Hintergrundindikator.",
  });

  if (isTech || isSemiconductor || isIndustrial || isMining || isAuto || desc.includes("battery") || desc.includes("electric")) {
    correlations.push({
      name: "Lithium (Spodumen-Index)",
      category: "Industriemetall",
      correlation: desc.includes("battery") || desc.includes("electric") || desc.includes("lithium") || desc.includes("ev") ? "Positiv" : isMining ? "Positiv" : "Neutral",
      strength: desc.includes("lithium") || desc.includes("battery") ? "Stark" : isMining ? "Moderat" : "Schwach",
      mechanism: desc.includes("battery") || desc.includes("electric")
        ? "Lithium als Schlüsselrohstoff für Batterietechnologie (EV, ESS). Preis-Volatilität beeinflusst BOM-Kosten und Margenentwicklung."
        : isMining
        ? "Lithium-Produzenten direkt an Spotpreis gekoppelt. Zyklische Überkapazitäten vs. struktureller EV-Nachfragetrend."
        : "Lithium als Indikator für EV/Energiewende-Momentum. Preis-Crashs signalisieren Nachfragesorgen im Green-Tech-Sektor.",
    });
  }

  // === CRYPTO ===
  const isCryptoExposed = desc.includes("crypto") || desc.includes("bitcoin") || desc.includes("blockchain") || desc.includes("mining") && s.includes("financ");
  correlations.push({
    name: "Bitcoin (BTC)",
    category: "Crypto",
    correlation: isCryptoExposed ? "Positiv"
      : isTech || isSemiconductor ? "Positiv"
      : isBank ? "Neutral"
      : "Neutral",
    strength: isCryptoExposed ? "Stark"
      : isTech ? "Moderat"
      : "Schwach",
    mechanism: isCryptoExposed
      ? "Direkte Geschäftsmodell-Korrelation mit Kryptomarkt. BTC-Preis treibt Trading-Volumen, Custody-Gebühren und On-Chain-Aktivität."
      : isTech || isSemiconductor
      ? "BTC als Risk-on-Proxy: Korrelation mit NASDAQ/Tech seit 2020 bei ρ ≈ 0.5-0.7. BTC-Crash signalisiert Liquiditäts-/Risiko-Aversions-Shift. BTC-Rally → positive Stimmung für Wachstumswerte."
      : isBank
      ? "Moderate Korrelation: Krypto-Adoption bringt neue Revenue-Streams (Custody, Trading), aber Regulierungsrisiken. BTC-Crash kann Risk-off auslösen."
      : "BTC als globaler Liquiditäts- und Risikoappetit-Indikator. Korrelation mit Aktienmarkt seit 2020 gestiegen (ρ ≈ 0.3-0.5). BTC-Stärke signalisiert Risk-on-Umfeld.",
  });

  // === WÄHRUNG ===
  correlations.push({
    name: "USD Index (DXY)",
    category: "Währung",
    correlation: isEnergy || isMining ? "Invers" : isTech ? "Invers" : "Neutral",
    strength: isEnergy || isMining ? "Stark" : isTech ? "Moderat" : "Moderat",
    mechanism: isEnergy || isMining
      ? "Rohstoffe in USD gepreist → starker USD drückt Nachfrage und Preise. Inverse Korrelation historisch ρ ≈ -0.6 bis -0.8."
      : isTech
      ? "Starker USD belastet internationale Umsätze (>50% Auslandsanteil bei Big Tech). FX-Translation reduziert berichtete Gewinne."
      : "Starker USD belastet Unternehmen mit hohem Auslandsanteil (Umsatz-Translation). Für US-Binnenwirtschaft weniger relevant.",
  });

  correlations.push({
    name: "EUR/USD",
    category: "Währung",
    correlation: desc.includes("europe") || desc.includes("eu") || reportedCurrency === "EUR" ? "Positiv" : "Neutral",
    strength: reportedCurrency === "EUR" ? "Stark" : desc.includes("europe") ? "Moderat" : "Schwach",
    mechanism: reportedCurrency === "EUR"
      ? `Finanzdaten in EUR gemeldet. EUR-Schwäche vs USD reduziert USD-äquivalente Bewertung. EUR/USD -10% → ca. -10% auf Market Cap in USD.`
      : desc.includes("europe")
      ? "Signifikante Europa-Exposure. EUR-Stärke stützt USD-bewertete Umsätze aus EU-Region. ECB-Zinsentscheide als Treiber."
      : "Indirekter Indikator: EUR/USD reflektiert relative Konjunktur USA vs. Europa. Starker EUR signalisiert europäische Stärke.",
  });

  if (desc.includes("china") || desc.includes("asia") || isSemiconductor || desc.includes("yuan") || desc.includes("renminbi")) {
    correlations.push({
      name: "USD/CNY (Yuan)",
      category: "Währung",
      correlation: "Invers",
      strength: desc.includes("china") ? "Moderat" : "Schwach",
      mechanism: "Yuan-Abwertung signalisiert China-Schwäche und Kapitalabflüsse → negativ für China-exponierte Unternehmen. PBoC-Interventionen als Volatilitätstreiber.",
    });
  }

  if (desc.includes("japan") || desc.includes("yen") || ind.includes("auto")) {
    correlations.push({
      name: "USD/JPY (Yen)",
      category: "Währung",
      correlation: isAuto ? "Positiv" : "Neutral",
      strength: isAuto ? "Moderat" : "Schwach",
      mechanism: isAuto
        ? "Schwacher Yen stärkt japanische Wettbewerber (Toyota, Honda). Yen-Stärke reduziert Wettbewerbsdruck für US/EU-Autobauer."
        : "JPY als Carry-Trade-Währung. Yen-Stärke signalisiert Risk-off (Carry-Trade-Unwind). BOJ-Politik als globaler Volatilitätstreiber.",
    });
  }

  if (reportedCurrency !== "USD" && reportedCurrency !== "EUR") {
    const ccyName = reportedCurrency === "GBP" ? "GBP/USD" : `${reportedCurrency}/USD`;
    correlations.push({
      name: ccyName,
      category: "Währung",
      correlation: "Positiv",
      strength: "Stark",
      mechanism: `Finanzdaten in ${reportedCurrency} gemeldet. Währungsabwertung vs USD reduziert USD-äquivalente Gewinne. FX-Hedging kann Effekt mildern.`,
    });
  }

  // Determine overall macro sensitivity
  const strongCount = correlations.filter(c => c.strength === "Stark").length;
  const overallMacroSensitivity: "Hoch" | "Mittel" | "Niedrig" =
    strongCount >= 5 ? "Hoch" : strongCount >= 3 ? "Mittel" : "Niedrig";

  // Key insight
  const primaryCorr = correlations.find(c => c.strength === "Stark" && c.category === "Macro-Indikator") ||
    correlations.find(c => c.strength === "Stark");
  const keyInsight = primaryCorr
    ? `Primärer Makro-Treiber: ${primaryCorr.name} (${primaryCorr.correlation}, ${primaryCorr.strength}). ${primaryCorr.mechanism.split(".")[0]}.`
    : "Moderate Makro-Sensitivität – kein einzelner Indikator dominiert die Kursentwicklung.";

  return { correlations, overallMacroSensitivity, keyInsight };
}

// === Server-Side Analysis Cache ===
// Two-layer cache that must survive container restarts on pplx.app:
//   1. File JSON in .cache/  (fast, legacy)
//   2. SQLite via disk-cache.ts (survives restarts more reliably; 7-day TTL)
import * as fs from 'fs';
import * as path from 'path';
import {
  diskCacheGet,
  diskCacheSet,
  diskCacheDelete,
  diskCacheList,
  diskResearcherGet,
} from './disk-cache';
const CACHE_DIR = path.join(process.cwd(), '.cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function tickerKey(ticker: string): string {
  return ticker.toUpperCase();
}

function getCachedAnalysis(ticker: string): any | null {
  // 1. File cache (fastest)
  try {
    const file = path.join(CACHE_DIR, `${ticker.replace(/[^a-zA-Z0-9.]/g, '_')}.json`);
    if (fs.existsSync(file)) {
      const stat = fs.statSync(file);
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      data._cached = true;
      data._cacheAge = Math.round((Date.now() - stat.mtimeMs) / 60000);
      data._cacheDate = new Date(stat.mtimeMs).toISOString();
      return data;
    }
  } catch {}
  // 2. Disk (SQLite) cache — survives restarts even if .cache dir is wiped
  const fromDisk = diskCacheGet(tickerKey(ticker));
  if (fromDisk) {
    // Warm file cache from disk for next read
    try {
      const file = path.join(CACHE_DIR, `${ticker.replace(/[^a-zA-Z0-9.]/g, '_')}.json`);
      const toWrite = { ...fromDisk };
      delete toWrite._cached;
      delete toWrite._cacheAge;
      delete toWrite._cacheDate;
      delete toWrite._diskCache;
      fs.writeFileSync(file, JSON.stringify(toWrite));
    } catch {}
    return fromDisk;
  }
  return null;
}

function saveCachedAnalysis(ticker: string, data: any) {
  const toCache = { ...data };
  delete toCache._cached;
  delete toCache._cacheAge;
  delete toCache._cacheDate;
  delete toCache._diskCache;
  try {
    const file = path.join(CACHE_DIR, `${ticker.replace(/[^a-zA-Z0-9.]/g, '_')}.json`);
    fs.writeFileSync(file, JSON.stringify(toCache));
  } catch (err: any) {
    console.log(`[CACHE] File save failed for ${ticker}: ${err?.message?.substring(0, 100)}`);
  }
  diskCacheSet(tickerKey(ticker), toCache);
}

export async function registerRoutes(server: Server, app: Express) {
  // Register gold analysis routes
  const { registerGoldRoutes } = await import("./gold-routes");
  registerGoldRoutes(server, app);

  // Register recession analysis routes
  const { registerRecessionRoutes } = await import("./recession");
  registerRecessionRoutes(app);

  // Register Researcher routes (4-tab autonomous research mode)
  const { registerResearcherRoutes } = await import("./researcher");
  registerResearcherRoutes(app);

  // Register Daily Regression Scan (5-ticker calc consistency check)
  const { registerRegressionScanRoutes } = await import("./regression-scan");
  registerRegressionScanRoutes(app);

  // === Ticker/Company-Name Search (autocomplete dropdown) ===
  // === Ticker Autocomplete Search ===
  app.get("/api/search-ticker", async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 1) return res.json({ results: [] });

    try {
      const KEY = process.env.FMP_API_KEY || 'lHc3gAE8V0YuUn48HEnXIHJazR7nI7Cx';
      // Parallel: search by symbol + search by name
      const [symbolRes, nameRes] = await Promise.all([
        fetch(`https://financialmodelingprep.com/stable/search-symbol?query=${encodeURIComponent(q)}&limit=8&apikey=${KEY}`)
          .then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`https://financialmodelingprep.com/stable/search-name?query=${encodeURIComponent(q)}&limit=8&apikey=${KEY}`)
          .then(r => r.ok ? r.json() : []).catch(() => []),
      ]);

      const combined = new Map<string, any>();
      for (const item of [...(Array.isArray(symbolRes) ? symbolRes : []), ...(Array.isArray(nameRes) ? nameRes : [])]) {
        const sym = item.symbol || item.ticker || '';
        if (!sym || sym.length > 20) continue;
        if (!combined.has(sym)) combined.set(sym, item);
      }

      const results = Array.from(combined.values())
        .slice(0, 12)
        .map(item => ({
          ticker: item.symbol || item.ticker || '',
          name: item.name || item.companyName || '',
          exchange: item.exchangeShortName || item.exchange || '',
          type: item.type || '',
        }))
        .filter(r => r.ticker && r.name);

      res.json({ results });
    } catch (e: any) {
      console.error('[SEARCH-TICKER]', e?.message);
      res.json({ results: [] });
    }
  });

  // Cache listing endpoint
  // === /api/health — Runtime dependency check ===
  // Tests all critical subsystems: external-tool CLI, LLM availability, cache dir.
  // Used by the client Warmup-Ping on page load and by the morning monitor cron.
  app.get("/api/health", async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    // 1. external-tool CLI available?
    try {
      const { execSync: exec } = await import("child_process");
      const out = exec("external-tool --version 2>&1 || external-tool call '{\"source_id\":\"ping\"}' 2>&1 || echo 'available'", {
        timeout: 5000, encoding: "utf-8",
      });
      checks.external_tool = { ok: true, detail: out.trim().substring(0, 80) };
    } catch (e: any) {
      // Fallback: just check if binary exists
      try {
        const { execSync: exec2 } = await import("child_process");
        exec2("which external-tool", { timeout: 3000 });
        checks.external_tool = { ok: true, detail: "binary found" };
      } catch {
        checks.external_tool = { ok: false, detail: "external-tool CLI not found — finance API unavailable" };
      }
    }

    // 2. LLM (OpenRouter) configured?
    const hasLLMKey = !!(process.env.OPENROUTER_API_KEY);
    checks.llm = { ok: hasLLMKey, detail: hasLLMKey ? "OPENROUTER_API_KEY set" : "OPENROUTER_API_KEY missing — KI-mode unavailable" };

    // 3. Cache directory writable?
    try {
      const testFile = path.join(CACHE_DIR, "_healthcheck.tmp");
      fs.writeFileSync(testFile, "ok");
      fs.unlinkSync(testFile);
      checks.cache = { ok: true, detail: `${CACHE_DIR} writable` };
    } catch (e: any) {
      checks.cache = { ok: false, detail: `Cache dir not writable: ${e.message}` };
    }

    // 4. Finance API quota — daily counter from soft guard
    const qs = getQuotaStatus();
    checks.quota = { ok: qs.remaining > 0, today: qs.today, limit: qs.limit, remaining: qs.remaining };

    const allOk = Object.values(checks).every(c => c.ok);
    const critical = !checks.external_tool?.ok; // external-tool down = complete outage

    res.status(critical ? 503 : 200).json({
      status: allOk ? "healthy" : critical ? "critical" : "degraded",
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.round(process.uptime()),
      checks,
    });
  });

  app.get("/api/cache", (_req, res) => {
    try {
      const byTicker = new Map<string, { ticker: string; cachedAt: string; ageMinutes: number; sizeKB: number }>();
      // File cache (legacy / hot)
      try {
        const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json') && f !== 'watchlist.json');
        for (const f of files) {
          const stat = fs.statSync(path.join(CACHE_DIR, f));
          const ticker = f.replace('.json', '');
          byTicker.set(ticker.toUpperCase(), {
            ticker,
            cachedAt: new Date(stat.mtimeMs).toISOString(),
            ageMinutes: Math.round((Date.now() - stat.mtimeMs) / 60000),
            sizeKB: Math.round(stat.size / 1024),
          });
        }
      } catch {}
      // Disk (SQLite) cache — adds entries that survived a restart even when .cache was wiped
      for (const entry of diskCacheList()) {
        const key = entry.ticker.toUpperCase();
        if (!byTicker.has(key)) byTicker.set(key, entry);
      }
      const items = Array.from(byTicker.values()).sort((a, b) => a.ageMinutes - b.ageMinutes);
      res.json({ cached: items.length, items });
    } catch { res.json({ cached: 0, items: [] }); }
  });

  // === Watchlist ===
  const WATCHLIST_FILE = path.join(CACHE_DIR, 'watchlist.json');

  app.get("/api/watchlist", (_req, res) => {
    try {
      if (fs.existsSync(WATCHLIST_FILE)) {
        const data = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf-8'));
        return res.json(data);
      }
    } catch {}
    res.json({ tickers: [] });
  });

  app.post("/api/watchlist", (req, res) => {
    try {
      const { ticker, action } = req.body; // action: 'add' | 'remove'
      let list: { tickers: { ticker: string; addedAt: string; lastPrice?: number; companyName?: string }[] } = { tickers: [] };
      if (fs.existsSync(WATCHLIST_FILE)) {
        list = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf-8'));
      }
      if (action === 'add' && ticker) {
        if (!list.tickers.some(t => t.ticker === ticker)) {
          // Get price from cache if available
          const cached = getCachedAnalysis(ticker);
          list.tickers.unshift({
            ticker,
            addedAt: new Date().toISOString(),
            lastPrice: cached?.currentPrice || undefined,
            companyName: cached?.companyName || undefined,
          });
          // Keep max 20
          list.tickers = list.tickers.slice(0, 20);
        }
      } else if (action === 'remove' && ticker) {
        list.tickers = list.tickers.filter(t => t.ticker !== ticker);
      }
      fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(list));
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // === PDF Export (LLM-powered HTML → Playwright PDF) ===
  app.post("/api/export-pdf", async (req, res) => {
    try {
      const analysisData = req.body;
      if (!analysisData?.ticker) return res.status(400).json({ error: 'No analysis data provided' });
      console.log(`[PDF] Generating PDF for ${analysisData.ticker}...`);
      const { generateAnalysisHTML, renderHTMLtoPDF } = await import('./pdf-export');
      const html = await generateAnalysisHTML(analysisData);
      const pdfBuffer = await renderHTMLtoPDF(html);
      console.log(`[PDF] Generated ${(pdfBuffer.length / 1024).toFixed(0)}KB PDF for ${analysisData.ticker}`);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${analysisData.ticker}_Analyse_${new Date().toISOString().slice(0,10)}.pdf"`);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error(`[PDF] Error:`, err?.message?.substring(0, 200));
      res.status(500).json({ error: `PDF generation failed: ${err?.message?.substring(0, 100)}` });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    // Declare ticker outside try{} so catch{} can use it for cache-fallback (C2 fix)
    let ticker = "";
    let useLLM = false;
    // Chat-First: no proxy guard needed — in-chat requests are not cut off at 30s.
    // The analysis runs to completion and returns the full result directly.
    let proxyResponded = false; // kept for compatibility with catch block
    try {
      const parsed = analyzeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid ticker" });
      }
      ticker = parsed.data.ticker;
      useLLM = parsed.data.useLLM === true;
      const force = parsed.data.force === true;

      // === Cache-first (TTL 7 days) ===
      // Reuse the most recent analysis for up to a week, so the user does not
      // burn credits re-analysing the same ticker every time it is opened.
      // Skip when force=true (user clicked "Aktualisieren") or when the LLM mode
      // of the cached entry doesn't match the current request — LLM-augmented
      // analyses must not be served when LLM is off, and vice-versa.
      const ANALYZE_TTL_MIN = 60 * 24 * 7; // 7 days
      if (!force) {
        const cachedFresh = getCachedAnalysis(ticker);
        if (
          cachedFresh &&
          cachedFresh._cacheAge < ANALYZE_TTL_MIN &&
          cacheLLMModeMatches(cachedFresh._useLLM, useLLM)
        ) {
          console.log(`[ANALYZE] Cache HIT for ${ticker} (age: ${cachedFresh._cacheAge}min, useLLM=${useLLM}) — 0 credits`);
          return res.json(cachedFresh);
        }
      }

      // Quote-only refresh: if cache is fresh (< 48h) but user requested force refresh,
      // only update the quote field. Saves 7 Finance API calls (uses only 1).
      const QUOTE_REFRESH_AGE_MS = 48 * 60 * 60 * 1000;
      const cached = force ? getCachedAnalysis(ticker) : null;
      const cacheAgeMs = cached ? (cached._cacheAge ?? Infinity) * 60000 : Infinity;
      if (cached && force && cacheAgeMs < QUOTE_REFRESH_AGE_MS && cacheLLMModeMatches(cached._useLLM, useLLM)) {
        console.log(`[ANALYZE] Quote-only refresh for ${ticker} (cache ${Math.round(cacheAgeMs / 60000)}min old)`);
        try {
          const freshQuote = await callFinanceToolThrottled("finance_quotes", { ticker_symbols: [ticker] });
          let refreshedPrice = 0;
          if (freshQuote?.content) {
            const rows = parseMarkdownTable(freshQuote.content);
            if (rows.length > 0) {
              refreshedPrice = parseNumber(rows[0].price);
            }
          }
          if (refreshedPrice > 0) {
            const refreshed = {
              ...cached,
              currentPrice: refreshedPrice,
              priceTimestamp: new Date().toISOString(),
              _quoteRefreshed: true,
              _cached: true,
            };
            saveCachedAnalysis(String(ticker).toUpperCase(), refreshed);
            return res.json(refreshed);
          }
          if (freshQuote === null) {
            // Rate-limited — return stale cache rather than failing
            return res.json({ ...cached, _quoteStale: true });
          }
        } catch (e: any) {
          if ((e?.message || '').includes('RATE_LIMITED')) {
            return res.json({ ...cached, _quoteStale: true });
          }
          // Other error: fall through to full analysis
        }
      }

      console.log(`[ANALYZE] Starting analysis for ${ticker}${useLLM ? ' [LLM ON]' : ''}${force ? ' [FORCED]' : ''}...`);

      // === Sequential API calls (throttled to avoid burst rate-limits) ===
      // Previous version fired 8 parallel calls which triggered the
      // Perplexity finance proxy's burst-rate-limiter (429). We now space
      // them out by 300ms and retry on 429 with exponential backoff.
      // Total cold-start time goes from ~2-3s to ~5-7s, but we no longer
      // get the cascade of 401s after the first 429.

      // ── Quota Guard: soft-block before making Finance API calls ───────────────
      if (isQuotaExceeded()) {
        const fmpKey = process.env.FMP_API_KEY;
        if (fmpKey) {
          try {
            console.log(`[ANALYZE] Soft quota exceeded — using FMP fallback for ${ticker}`);
            const fmpData = await getFmpFallbackData(String(ticker), fmpKey);
            if (fmpData) return res.json({ ...fmpData, _quotaFallback: true });
          } catch {}
        }
        // Serve stale cache if available — but first refresh generic risks synchronously
        if (cached) {
          const GENERIC_RISK_NAMES = new Set([
            "Macro Recession / Demand Shock", "Earnings Miss / Guidance Cut",
            "Multiple Compression (Rising Rates)", "Regulatory / Antitrust Action",
            "Tech Disruption / Competitive Shift", "Government Contract / Policy Dependency",
            "Competitive Pressure / Margin Erosion", "Drug Pricing Reform / Patent Cliff",
            "Credit Quality Deterioration", "Commodity Price Collapse",
            "Consumer Spending Slowdown / China Weakness", "Brand Dilution / Competitive Shift",
          ]);
          const cachedRisks: any[] = cached.risks || [];
          const hasGenericRisks = cachedRisks.length > 0 && cachedRisks.every((r: any) => GENERIC_RISK_NAMES.has(r.name));
          if (hasGenericRisks && cached.description && cached.catalysts?.length > 0) {
            try {
              const refreshCats = (cached.catalysts || []).filter((c: any) => !c.tags?.includes("capex-tailwind")).slice(0, 2);
              const newRisks = await generateCompanySpecificRisks({
                ticker: String(ticker),
                companyName: String(cached.companyName || ticker),
                description: String(cached.description || ""),
                sector: String(cached.sectorProfile?.sector || cached.sector || "Technology"),
                industry: String(cached.industry || ""),
                revenue: Number(cached.revenue) || 0,
                revenueGrowth: Number(cached.revenueGrowth) || 0,
                fcfMargin: Number(cached.fcfMargin) || 0,
                grossMargin: 0,
                forwardPE: Number(cached.forwardPE) || 0,
                beta: Number(cached.beta) || 1.1,
                governmentExposure: Number(cached.governmentExposure) || 0,
                topCatalysts: refreshCats.map((c: any) => ({ name: c.name, context: c.context || "" })),
                capexContext: null,
                recentNewsHeadlines: (cached.newsItems || []).slice(0, 4).map((n: any) => n.title || ""),
              });
              if (newRisks && newRisks.length >= 3) {
                const freshRisks = newRisks.map((r: any) => ({ ...r, expectedDamage: 0 }));
                const updated = { ...cached, risks: freshRisks };
                saveCachedAnalysis(String(ticker), updated);
                console.log(`[ANALYZE] Quota-path risk refresh for ${ticker}: ${freshRisks.map((r: any) => r.name).join(" | ")}`);
                return res.json({ ...updated, _cached: true, _quoteStale: true, _quotaExceeded: true });
              }
            } catch (e: any) {
              console.warn(`[ANALYZE] Risk refresh failed (quota path) for ${ticker}: ${e?.message}`);
            }
          }
          return res.json({ ...cached, _cached: true, _quoteStale: true, _quotaExceeded: true });
        }
        return res.status(429).json({
          error: `Tägliches Finance-API Kontingent ausgeschöpft (${_quotaCount}/${DAILY_FINANCE_LIMIT} Analysen). Reset nach Mitternacht.`,
          errorCode: 'RATE_LIMITED'
        });
      }
      // ──────────────────────────────────────────────────────────────────

      const t0 = Date.now();
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 11 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Batch 1 (critical path) — quote + profile in parallel
      const [quoteResult, profileResult] = await Promise.all([
        callFinanceToolThrottled("finance_quotes", {
          ticker_symbols: [ticker],
          fields: ["price", "currency", "marketCap", "pe", "eps", "change", "changesPercentage", "volume", "avgVolume", "dayLow", "dayHigh", "yearLow", "yearHigh", "previousClose", "dividendYieldTTM"],
        }),
        callFinanceToolThrottled("finance_company_profile", {
          ticker_symbols: [ticker],
          query: `Company profile for ${ticker}`,
          action: `Fetching company profile for ${ticker}`,
        }),
      ]);

      // Circuit-breaker: if Quote returned null after retries OR binary is missing,
      // try FMP fallback first, then cache, then error.
      const needsFmpFallback = quoteResult?.__binaryMissing || quoteResult === null;
      let fmpData: Awaited<ReturnType<typeof getFmpFallbackData>> = null;

      if (needsFmpFallback) {
        if (quoteResult?.__binaryMissing) {
          console.error(`[ANALYZE] CRITICAL: external-tool binary missing — trying FMP fallback for ${ticker}`);
        } else {
          console.log(`[ANALYZE] external-tool rate-limited — trying FMP fallback for ${ticker}`);
        }

        // Try cache first (fastest)
        const cachedRL = getCachedAnalysis(ticker);
        if (cachedRL && cacheLLMModeMatches(cachedRL._useLLM, useLLM)) {
          console.log(`[ANALYZE] Serving cache for ${ticker} (FMP fallback skipped — fresh cache available)`);
          return res.json(cachedRL);
        }

        // Try FMP fallback
        fmpData = await getFmpFallbackData(ticker);

        if (!fmpData) {
          // No cache, no FMP — return RATE_LIMITED in both cases so the
          // frontend shows the friendly ErrorScreen (not a blank 503).
          // BINARY_MISSING means the finance connector has no token in this
          // sandbox context — treated identically to rate-limit from UX perspective.
          const isBinaryIssue = quoteResult?.__binaryMissing;
          return res.status(429).json({
            error: isBinaryIssue
              ? "Finance-Connector nicht verf\u00fcgbar. Bitte die Seite im Browser \u00f6ffnen (nicht direkt aufrufen) — der Token wird beim n\u00e4chsten Seitenaufruf refreshed."
              : "Tagesquota der Finance-API erreicht. Bitte sp\u00e4ter erneut versuchen (Reset nach Mitternacht).",
            errorCode: "RATE_LIMITED",
          });
        }
        console.log(`[ANALYZE] FMP fallback active for ${ticker} — continuing with FMP data`);
      }
      // Batch 2 (enrichment) — run remaining 6 in parallel
      const [financialsResult, analystResult, estimatesResult, ohlcvHistResult, segmentsResult, newsResult] = await Promise.all([
        callFinanceToolThrottled("finance_financials", {
          ticker_symbols: [ticker],
          period: "annual",
          as_of_fiscal_year: new Date().getFullYear() - 1,
          limit: 3,
          income_statement_metrics: ["revenue", "netIncome", "ebitda", "eps", "epsDiluted", "weightedAverageSharesOutstanding", "operatingIncome", "grossProfit"],
          balance_sheet_metrics: ["totalDebt", "cashAndCashEquivalents", "totalStockholdersEquity", "totalAssets", "totalCurrentAssets", "totalCurrentLiabilities", "netDebt"],
          cash_flow_metrics: ["freeCashFlow", "operatingCashFlow", "capitalExpenditure"],
        }),
        callFinanceToolThrottled("finance_analyst_research", {
          ticker_symbols: [ticker],
        }),
        callFinanceToolThrottled("finance_estimates", {
          ticker_symbols: [ticker],
          period_type: "annual",
        }),
        callFinanceToolThrottled("finance_ohlcv_histories", {
          ticker_symbols: [ticker],
          start_date_yyyy_mm_dd: startDate,
          end_date_yyyy_mm_dd: endDate,
          time_interval: "1day",
          fields: ["open", "high", "low", "close", "volume"],
        }),
        callFinanceToolThrottled("finance_segments", {
          ticker_symbols: [ticker],
          query: "revenue by business segment and geographic breakdown",
          period_type: "annual",
          limit: 2,
        }),
        callFinanceToolThrottled("finance_massive", {
          pathname: `/v2/reference/news`,
          params: { ticker, limit: 10, order: "desc" },
        }, { maxRetries: 0 }),
      ]);

      console.log(`[ANALYZE] All API calls completed for ${ticker} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

      // === Parse Quote ===
      let price = 0, marketCap = 0, pe = 0, eps = 0, currency = "USD", companyName = ticker;
      let change = 0, changePct = 0, volume = 0, avgVolume = 0;
      let dayLow = 0, dayHigh = 0, yearLow = 0, yearHigh = 0, prevClose = 0, divYield = 0;
      let priceTimestamp = new Date().toISOString();

      if (fmpData?.quote) {
        // === FMP Quote Parsing ===
        const q = fmpData.quote;
        price = q.price || 0;
        marketCap = q.marketCap || 0;
        pe = q.pe || 0;
        eps = q.eps || 0;
        companyName = q.name || q.companyName || ticker;
        change = q.change || 0;
        changePct = q.changesPercentage || q.changePercent || 0;
        volume = q.volume || 0;
        avgVolume = q.avgVolume || q.averageVolume || 0;
        dayLow = q.dayLow || q.low || 0;
        dayHigh = q.dayHigh || q.high || 0;
        yearLow = q.yearLow || q["52WeekLow"] || 0;
        yearHigh = q.yearHigh || q["52WeekHigh"] || 0;
        prevClose = q.previousClose || q.previousClosePrice || 0;
        divYield = q.dividendYield || q.dividendYieldTTM || 0;
        currency = q.currency || "USD";
        priceTimestamp = q.timestamp ? new Date(q.timestamp * 1000).toISOString() : new Date().toISOString();
        console.log(`[FMP-QUOTE] ${ticker}: price=$${price}, mktcap=$${(marketCap/1e9).toFixed(1)}B`);
      } else if (quoteResult?.content) {
        // === external-tool Quote Parsing ===
        const rows = parseMarkdownTable(quoteResult.content);
        if (rows.length > 0) {
          const q = rows[0];
          price = parseNumber(q.price);
          marketCap = parseNumber(q.marketCap);
          pe = parseNumber(q.pe);
          eps = parseNumber(q.eps);
          companyName = q.name || ticker;
          change = parseNumber(q.change);
          changePct = parseNumber(q.changesPercentage);
          volume = parseNumber(q.volume);
          avgVolume = parseNumber(q.avgVolume);
          dayLow = parseNumber(q.dayLow);
          dayHigh = parseNumber(q.dayHigh);
          yearLow = parseNumber(q.yearLow);
          yearHigh = parseNumber(q.yearHigh);
          prevClose = parseNumber(q.previousClose);
          divYield = parseNumber(q.dividendYieldTTM);
          priceTimestamp = q.timestamp || new Date().toISOString();
        }
      }

      if (price === 0) {
        // Try cache before returning 404 — prefer compatible LLM mode.
        // Legacy caches without the flag count as compatible to both modes.
        const cached404 = getCachedAnalysis(ticker);
        if (cached404 && cacheLLMModeMatches(cached404._useLLM, useLLM)) {
          console.log(`[ANALYZE] No live data for ${ticker}, serving compatible cache (age: ${cached404._cacheAge}min, cacheUseLLM=${cached404._useLLM}, request=${useLLM})`);
          return res.json(cached404);
        }
        if (cached404) {
          console.log(`[ANALYZE] No live data for ${ticker}; cache exists but useLLM mismatch — not serving stale narrative`);
        }
        // Distinguish: was the quote call rate-limited, or is the ticker actually invalid?
        if (quoteResult === null) {
          // null = retries exhausted on 429/401 — try FMP fallback before surrendering
          const fmpKey = process.env.FMP_API_KEY;
          if (fmpKey && ticker) {
            try {
              console.log(`[ANALYZE] RATE_LIMITED — trying FMP fallback for ${ticker}`);
              const fmpFallbackData = await getFmpFallbackData(String(ticker));
              if (fmpFallbackData) {
                return res.json(fmpFallbackData);
              }
            } catch (fmpErr: any) {
              console.warn(`[ANALYZE] FMP fallback failed: ${fmpErr?.message?.substring(0, 100)}`);
            }
          }
          // If FMP also failed, try disk cache
          const diskFallback = diskCacheGet ? diskCacheGet(String(ticker).toUpperCase()) : null;
          if (diskFallback) {
            // Check if risks are still generic templates — if so, refresh them async
            const GENERIC_RISK_NAMES = new Set([
              "Macro Recession / Demand Shock", "Earnings Miss / Guidance Cut",
              "Multiple Compression (Rising Rates)", "Regulatory / Antitrust Action",
              "Tech Disruption / Competitive Shift", "Government Contract / Policy Dependency",
              "Competitive Pressure / Margin Erosion", "Drug Pricing Reform / Patent Cliff",
              "Credit Quality Deterioration", "Commodity Price Collapse",
              "Consumer Spending Slowdown / China Weakness", "Brand Dilution / Competitive Shift",
            ]);
            const cachedRisks: any[] = diskFallback.risks || [];
            const hasGenericRisks = cachedRisks.length > 0 &&
              cachedRisks.every((r: any) => GENERIC_RISK_NAMES.has(r.name));

            if (hasGenericRisks && diskFallback.description && diskFallback.catalysts?.length > 0) {
              // Synchronous refresh — await so the user gets specific risks on THIS call
              try {
                const refreshCats = (diskFallback.catalysts || []).filter((c: any) => !c.tags?.includes("capex-tailwind")).slice(0, 2);
                const newRisks = await generateCompanySpecificRisks({
                  ticker: String(ticker),
                  companyName: String(diskFallback.companyName || ticker),
                  description: String(diskFallback.description || ""),
                  sector: String(diskFallback.sectorProfile?.sector || diskFallback.sector || "Technology"),
                  industry: String(diskFallback.industry || ""),
                  revenue: Number(diskFallback.revenue) || 0,
                  revenueGrowth: Number(diskFallback.revenueGrowth) || 0,
                  fcfMargin: Number(diskFallback.fcfMargin) || 0,
                  grossMargin: 0,
                  forwardPE: Number(diskFallback.forwardPE) || 0,
                  beta: Number(diskFallback.beta) || 1.1,
                  governmentExposure: Number(diskFallback.governmentExposure) || 0,
                  topCatalysts: refreshCats.map((c: any) => ({ name: c.name, context: c.context || "" })),
                  capexContext: null,
                  recentNewsHeadlines: [],
                });
                if (newRisks && newRisks.length >= 3) {
                  const freshRisks = newRisks.map(r => ({ ...r, expectedDamage: 0 }));
                  const updated = { ...diskFallback, risks: freshRisks };
                  if (diskCacheSet) diskCacheSet(String(ticker).toUpperCase(), updated);
                  console.log(`[ANALYZE] Sync risk refresh for ${ticker}: ${freshRisks.map(r => r.name).join(" | ")}`);
                  return res.json({ ...updated, _quoteStale: true });
                }
              } catch (riskRefreshErr: any) {
                console.warn(`[ANALYZE] Risk refresh failed for ${ticker}: ${riskRefreshErr?.message}`);
              }
            }

            return res.json({ ...diskFallback, _quoteStale: true });
          }
          return res.status(429).json({
            error: `Finance-API Tageslimit und FMP Fallback fehlgeschlagen.`,
            errorCode: "RATE_LIMITED",
          });
        }
        return res.status(404).json({ error: `Keine Quote-Daten für ${ticker} gefunden. Bitte Ticker-Symbol prüfen.` });
      }

      // === Parse Company Profile ===
      let sector = "Technology", industry = "General", description = "", exchange = "NASDAQ";
      let sectorHybridNote = "";
      if (fmpData?.profile) {
        // FMP profile parsing
        const p = fmpData.profile;
        sector = p.sector || "Technology";
        industry = p.industry || "General";
        description = (p.description || "").substring(0, 2000);
        exchange = p.exchange || p.exchangeShortName || "NASDAQ";
        if (!companyName || companyName === ticker) companyName = p.companyName || ticker;
        console.log(`[FMP-PROFILE] ${ticker}: sector=${sector}, industry=${industry}`);
      } else if (profileResult?.content) {
        const content = profileResult.content;
        const sectorMatch = content.match(/Sector:\*?\*?\s*(.+)/);
        const industryMatch = content.match(/Industry:\*?\*?\s*(.+)/);
        const descMatch = content.match(/Description:\*?\*?\n([\s\S]+)/);
        if (sectorMatch) sector = sectorMatch[1].trim();
        if (industryMatch) industry = industryMatch[1].trim();
        if (descMatch) description = descMatch[1].trim().substring(0, 2000);
      }

      // Apply effective sector reclassification for hybrid companies AND misclassified companies (e.g. AMZN, META, IFX.DE)
      const effectiveSector = getEffectiveSector(sector, industry, description);
      const originalSector = sector;
      const originalIndustry = industry;
      if (effectiveSector.sector !== sector || effectiveSector.industry !== industry) {
        sector = effectiveSector.sector;
        industry = effectiveSector.industry;
        sectorHybridNote = effectiveSector.hybridNote;
        if (effectiveSector.sector !== originalSector) {
          console.log(`[ANALYZE] Sector reclassified: ${originalSector}/${originalIndustry} -> ${sector}/${industry} (${sectorHybridNote || 'direct reclassification'})`);
        }
      }

      // === Parse Financials ===
      let revenue = 0, netIncome = 0, ebitda = 0, fcfTTM = 0, totalDebt = 0, cashEquivalents = 0;
      let sharesOutstanding = 0, operatingIncome = 0, grossProfit = 0;
      let totalEquity = 0, totalAssets = 0, netDebt = 0;
      let revenueGrowth = 0;

      if (fmpData?.financials) {
        // === FMP Financials Parsing ===
        const inc = fmpData.financials.income;
        const cf = fmpData.financials.cashflow;
        if (Array.isArray(inc) && inc.length > 0) {
          const i = inc[0];
          revenue = i.revenue || 0;
          netIncome = i.netIncome || 0;
          ebitda = i.ebitda || 0;
          eps = eps || i.eps || i.epsDiluted || 0;
          sharesOutstanding = i.weightedAverageShsOutDil || i.weightedAverageShsOut || 0;
          operatingIncome = i.operatingIncome || 0;
          grossProfit = i.grossProfit || 0;
          if (inc.length >= 2 && inc[0].revenue && inc[1].revenue) {
            revenueGrowth = ((inc[0].revenue - inc[1].revenue) / Math.abs(inc[1].revenue)) * 100;
          }
        }
        if (Array.isArray(cf) && cf.length > 0) {
          const c = cf[0];
          fcfTTM = c.freeCashFlow || (c.operatingCashFlow + (c.capitalExpenditure || 0)) || 0;
          // Bug 1 fix: totalDebt must come from balance sheet, not cash flow statement
          // cashflow.totalDebt is often null — will be overwritten below by balance sheet
          cashEquivalents = c.cashAndCashEquivalents || 0;
        }
        // Bug 1 fix: read totalDebt + totalEquity from balance sheet (correct source)
        const bs = fmpData.financials.balanceSheet;
        if (Array.isArray(bs) && bs.length > 0) {
          const b = bs[0];
          totalDebt = (b.shortTermDebt || 0) + (b.longTermDebt || 0) || b.totalDebt || 0;
          cashEquivalents = cashEquivalents || b.cashAndCashEquivalents || 0;
          totalEquity = b.totalStockholdersEquity || b.totalEquity || 0;
          totalAssets = b.totalAssets || 0;
          netDebt = totalDebt - cashEquivalents;
        }
        console.log(`[FMP-FINANCIALS] ${ticker}: rev=$${(revenue/1e9).toFixed(1)}B, fcf=$${(fcfTTM/1e9).toFixed(1)}B, debt=$${(totalDebt/1e9).toFixed(1)}B, growth=${revenueGrowth.toFixed(1)}%`);
      } else if (financialsResult?.content) {
        // Parse income statement
        const isSections = financialsResult.content.split("## ");
        for (const section of isSections) {
          const rows = parseMarkdownTable(section);
          if (rows.length > 0) {
            const latest = rows[0]; // Most recent
            if (latest.revenue) revenue = parseNumber(latest.revenue);
            if (latest.netIncome) netIncome = parseNumber(latest.netIncome);
            if (latest.ebitda) ebitda = parseNumber(latest.ebitda);
            if (latest.eps && eps === 0) eps = parseNumber(latest.eps);
            if (latest.weightedAverageSharesOutstanding) sharesOutstanding = parseNumber(latest.weightedAverageSharesOutstanding);
            if (latest.operatingIncome) operatingIncome = parseNumber(latest.operatingIncome);
            if (latest.grossProfit) grossProfit = parseNumber(latest.grossProfit);
            if (latest.totalDebt) totalDebt = parseNumber(latest.totalDebt);
            if (latest.cashAndCashEquivalents) cashEquivalents = parseNumber(latest.cashAndCashEquivalents);
            if (latest.totalStockholdersEquity) totalEquity = parseNumber(latest.totalStockholdersEquity);
            if (latest.totalAssets) totalAssets = parseNumber(latest.totalAssets);
            if (latest.netDebt) netDebt = parseNumber(latest.netDebt);
            if (latest.freeCashFlow) fcfTTM = parseNumber(latest.freeCashFlow);
            if (latest.operatingCashFlow) {
              const opCF = parseNumber(latest.operatingCashFlow);
              const capex = parseNumber(latest.capitalExpenditure);
              if (fcfTTM === 0 && opCF !== 0) fcfTTM = opCF + capex; // capex is negative
            }

            // Revenue growth from multi-period data
            if (rows.length >= 2 && rows[0].revenue && rows[1].revenue) {
              const rev0 = parseNumber(rows[0].revenue);
              const rev1 = parseNumber(rows[1].revenue);
              if (rev1 > 0 && rev0 > 0) {
                revenueGrowth = ((rev0 - rev1) / Math.abs(rev1)) * 100;
                console.log(`[ANALYZE] Revenue growth: ${rev0} / ${rev1} = ${revenueGrowth.toFixed(2)}%`);
              }
            }
          }
        }
      }

      // Robust shares outstanding resolution
      // 1. Try weightedAverageSharesOutstanding from financials (already parsed above)
      // 2. Try epsDiluted-based derivation: shares = netIncome / epsDiluted
      if (sharesOutstanding === 0 && netIncome !== 0 && eps !== 0) {
        const derivedShares = Math.abs(Math.round(netIncome / eps));
        if (derivedShares > 1000) { // Sanity: at least 1000 shares
          sharesOutstanding = derivedShares;
          console.log(`[ANALYZE] Shares derived from netIncome/EPS: ${derivedShares}`);
        }
      }
      // 3. Fallback: marketCap / price
      if (sharesOutstanding === 0 && marketCap > 0 && price > 0) {
        sharesOutstanding = Math.round(marketCap / price);
        console.log(`[ANALYZE] Shares derived from marketCap/price: ${sharesOutstanding}`);
      }
      // 4. Log warning if still 0
      if (sharesOutstanding === 0) {
        console.warn(`[ANALYZE] WARNING: sharesOutstanding is 0 for ${ticker} — DCF per-share will be 0!`);
      }
      // 5. Sanity check: shares should give a reasonable market cap (within 5x)
      if (sharesOutstanding > 0 && marketCap > 0) {
        const impliedMCap = sharesOutstanding * price;
        const ratio = impliedMCap / marketCap;
        if (ratio > 5 || ratio < 0.2) {
          console.warn(`[ANALYZE] Shares sanity check FAILED: implied MCap=${impliedMCap}, actual=${marketCap}, ratio=${ratio.toFixed(2)}`);
          // Re-derive from marketCap/price which is most reliable
          sharesOutstanding = Math.round(marketCap / price);
          console.log(`[ANALYZE] Corrected shares to ${sharesOutstanding} via marketCap/price`);
        }
      }
      if (netDebt === 0) {
        netDebt = totalDebt - cashEquivalents;
      }

      // === Currency Detection & Conversion ===
      // Detect reported currency from financials headers (e.g. "(EUR)", "(CNY)")
      let reportedCurrency = "USD";
      let fxRate = 1.0;
      let currencyConverted = false;
      let currencyNote = "";
      let fxPair = "";

      // Fallback: detect currency from description (country-based)
      const descLower = description.toLowerCase();
      const countryToCurrency: Record<string, string> = {
        'kazakhstan': 'KZT', 'almaty': 'KZT', 'kasachstan': 'KZT',
        'türkiye': 'TRY', 'turkey': 'TRY', 'istanbul': 'TRY',
        'russia': 'RUB', 'moscow': 'RUB', 'india': 'INR', 'mumbai': 'INR',
        'brazil': 'BRL', 'são paulo': 'BRL', 'south africa': 'ZAR',
        'mexico': 'MXN', 'nigeria': 'NGN', 'egypt': 'EGP',
        'israel': 'ILS', 'tel aviv': 'ILS', 'indonesia': 'IDR', 'jakarta': 'IDR',
        'argentina': 'ARS', 'buenos aires': 'ARS', 'colombia': 'COP',
        'chile': 'CLP', 'peru': 'PEN', 'philippines': 'PHP', 'manila': 'PHP',
        'thailand': 'THB', 'bangkok': 'THB', 'vietnam': 'VND',
      };
      let descCurrency: string | null = null;
      for (const [keyword, curr] of Object.entries(countryToCurrency)) {
        if (descLower.includes(keyword)) { descCurrency = curr; break; }
      }

      if (financialsResult?.content) {
        let detected = detectReportedCurrency(financialsResult.content);
        // Fallback to description-based currency if not detected from financials
        if (!detected && descCurrency) {
          detected = descCurrency;
          console.log(`[ANALYZE] Currency detected from description (country): ${detected}`);
        }
        if (detected && detected !== "USD") {
          reportedCurrency = detected;
          console.log(`[ANALYZE] Detected reported currency: ${reportedCurrency} (non-USD)`);
          const rate = fetchFXRate(reportedCurrency, "USD");
          if (rate && rate > 0) {
            fxRate = rate;
            fxPair = `${reportedCurrency}/USD`;
            currencyConverted = true;
            currencyNote = `Finanzdaten in ${reportedCurrency} gemeldet. Umgerechnet zu USD mit Kurs ${reportedCurrency}/USD = ${fxRate.toFixed(4)}. Alle DCF-Berechnungen in USD.`;
            console.log(`[ANALYZE] Converting ${reportedCurrency} → USD at rate ${fxRate}`);

            // Convert all financial figures to USD
            const converted = convertFinancials(fxRate, {
              revenue, netIncome, ebitda, fcfTTM, totalDebt, cashEquivalents,
              totalEquity, totalAssets, netDebt, operatingIncome, grossProfit, sharesOutstanding,
            });
            revenue = converted.revenue;
            netIncome = converted.netIncome;
            ebitda = converted.ebitda;
            fcfTTM = converted.fcfTTM;
            totalDebt = converted.totalDebt;
            cashEquivalents = converted.cashEquivalents;
            totalEquity = converted.totalEquity;
            totalAssets = converted.totalAssets;
            netDebt = converted.netDebt;
            operatingIncome = converted.operatingIncome;
            grossProfit = converted.grossProfit;
            // sharesOutstanding stays the same

            console.log(`[ANALYZE] Post-conversion: Revenue=${revenue.toFixed(0)}, FCF=${fcfTTM.toFixed(0)}, Debt=${totalDebt.toFixed(0)}, Cash=${cashEquivalents.toFixed(0)}`);
          } else {
            console.warn(`[ANALYZE] Could not fetch FX rate for ${reportedCurrency}/USD, using raw values`);
            currencyNote = `WARNUNG: Finanzdaten in ${reportedCurrency}, aber kein FX-Kurs verfügbar. DCF-Ergebnisse könnten verzerrt sein.`;
          }
        }
      }

      const currencyInfo = currencyConverted ? {
        reportedCurrency,
        tradingCurrency: "USD",
        fxRate,
        fxPair,
        converted: true,
        note: currencyNote,
      } : undefined;

      // === Parse Analyst Research ===
      let analystPTMedian = price, analystPTHigh = price * 1.3, analystPTLow = price * 0.7, analystCount = 0;
      let ratingsBuy = 0, ratingsHold = 0, ratingsSell = 0;

      // Bug 2 fix: parse FMP analyst data when fmpData is active
      if (fmpData?.analyst) {
        const pt = fmpData.analyst.priceTarget;
        if (pt && typeof pt === 'object') {
          // FMP price-target-consensus: { targetConsensus, targetMedian, targetHigh, targetLow }
          analystPTMedian = pt.targetMedian || pt.targetConsensus || price;
          analystPTHigh = pt.targetHigh || price * 1.3;
          analystPTLow = pt.targetLow || price * 0.7;
        }
        const grades = fmpData.analyst.grades || [];
        for (const g of grades) {
          const grade = (g.newGrade || g.newRating || '').toLowerCase();
          if (grade.includes('buy') || grade.includes('overweight') || grade.includes('outperform')) ratingsBuy++;
          else if (grade.includes('sell') || grade.includes('underweight') || grade.includes('underperform')) ratingsSell++;
          else ratingsHold++;
        }
        analystCount = grades.length;
        // FMP estimates: forward EPS
        const estimates = fmpData.analyst.estimates || [];
        if (estimates.length > 0) {
          const fwdEps = estimates[0]?.estimatedEpsAvg || estimates[0]?.estimatedEpsDilutedAvg;
          if (fwdEps && fwdEps > 0) {
            // will be used below for epsConsensusNextFY
            (fmpData as any).__fwdEps = fwdEps;
          }
        }
        console.log(`[FMP-ANALYST] ${ticker}: PT median=$${analystPTMedian.toFixed(0)}, buy=${ratingsBuy}, hold=${ratingsHold}, sell=${ratingsSell}`);
      } else if (analystResult?.content) {
        const sections = analystResult.content.split("## ");
        for (const section of sections) {
          if (section.includes("Consensus")) {
            const rows = parseMarkdownTable(section);
            if (rows.length > 0) {
              const c = rows[0];
              analystPTMedian = parseNumber(c.median_price_target) || parseNumber(c.avg_price_target) || price;
              analystPTHigh = parseNumber(c.high_price_target) || price * 1.3;
              analystPTLow = parseNumber(c.low_price_target) || price * 0.7;
              analystCount = parseNumber(c.total_ratings) || 0;
              ratingsBuy = parseNumber(c.bullish_count) || 0;
              ratingsHold = parseNumber(c.neutral_count) || 0;
              ratingsSell = parseNumber(c.bearish_count) || 0;
            }
          }
        }
      }

      // === Parse Estimates (forward EPS) ===
      let epsConsensusNextFY = eps * 1.1;
      let epsGrowth5Y = 10;

      // Bug 2 fix: use FMP forward EPS if available
      if (fmpData && (fmpData as any).__fwdEps > 0) {
        epsConsensusNextFY = (fmpData as any).__fwdEps;
      }

      // Bug 3 fix: EUR/GBP/JPY → USD conversion for FMP international tickers
      // FMP reports non-USD financials in local currency — DCF must be in USD
      if (fmpData?.profile) {
        const curr = (fmpData.quote?.currency || fmpData.profile?.currency || 'USD').toUpperCase();
        const fxRates: Record<string, number> = { EUR: 1.08, GBP: 1.27, JPY: 0.0067, CHF: 1.12, CAD: 0.74, AUD: 0.65, HKD: 0.13, CNY: 0.14 };
        const fx = fxRates[curr] ?? 1;
        if (fx !== 1 && curr !== 'USD') {
          console.log(`[FMP-FX] ${ticker}: converting ${curr}→USD (fx=${fx})`);
          revenue *= fx; netIncome *= fx; ebitda *= fx; fcfTTM *= fx;
          grossProfit *= fx; operatingIncome *= fx; totalDebt *= fx;
          cashEquivalents *= fx; netDebt *= fx; totalEquity *= fx; totalAssets *= fx;
          price *= fx; marketCap *= fx; dayLow *= fx; dayHigh *= fx;
          yearLow *= fx; yearHigh *= fx; prevClose *= fx;
          analystPTMedian *= fx; analystPTHigh *= fx; analystPTLow *= fx;
        }
      }

      if (estimatesResult?.content) {
        const rows = parseMarkdownTable(estimatesResult.content);
        if (rows.length > 0) {
          const nextFYEps = parseNumber(rows[0].key_stats_diluted_eps);
          if (nextFYEps > 0) epsConsensusNextFY = nextFYEps;

          // Calculate 5Y growth from estimates
          if (rows.length >= 2) {
            const eps1 = parseNumber(rows[0].key_stats_diluted_eps);
            const epsLast = parseNumber(rows[rows.length - 1].key_stats_diluted_eps);
            if (eps1 > 0 && epsLast > 0) {
              const years = rows.length;
              epsGrowth5Y = ((epsLast / eps1) ** (1 / Math.max(1, years - 1)) - 1) * 100;
            }
          }
        }
      }

      // === Parse OHLCV data from finance_ohlcv_histories ===
      let ohlcvData: OHLCVPoint[] = [];
      let closingPrices2Y: { date: string; close: number }[] = [];

      if (fmpData?.ohlcv && fmpData.ohlcv.length > 0) {
        // === FMP OHLCV Parsing (historical-price-eod/full) ===
        // FMP returns array of { date, open, high, low, close, volume }
        const raw = Array.isArray(fmpData.ohlcv) ? fmpData.ohlcv : (fmpData.ohlcv as any)?.historical || [];
        for (const row of raw) {
          const date = row.date || '';
          const close = row.adjClose || row.close || 0;
          if (date && close > 0) {
            closingPrices2Y.push({ date, close });
            ohlcvData.push({
              date,
              open: row.open || close,
              high: row.high || close,
              low: row.low || close,
              close,
              volume: row.volume || 0,
            });
          }
        }
        // FMP returns newest-first — reverse for chronological order
        closingPrices2Y.reverse();
        ohlcvData.reverse();
        console.log(`[FMP-OHLCV] ${ticker}: ${ohlcvData.length} data points`);
      } else if (ohlcvHistResult) {
        try {
          // The tool returns csv_files with a URL to the full CSV
          const csvFiles = ohlcvHistResult.csv_files;
          if (csvFiles && Array.isArray(csvFiles) && csvFiles.length > 0 && csvFiles[0].url) {
            const csvUrl = csvFiles[0].url;
            console.log(`[ANALYZE] Fetching OHLCV CSV from URL for ${ticker}...`);
            const csvRows = parseCSVFromUrl(csvUrl);
            for (const row of csvRows) {
              const date = (row.date || '').trim();
              const close = parseFloat((row.close || '0').replace(/,/g, ''));
              const open = parseFloat((row.open || row.close || '0').replace(/,/g, ''));
              const high = parseFloat((row.high || row.close || '0').replace(/,/g, ''));
              const low = parseFloat((row.low || row.close || '0').replace(/,/g, ''));
              const volume = Math.round(parseFloat((row.volume || '0').replace(/,/g, '')));
              if (date && !isNaN(close) && close > 0) {
                closingPrices2Y.push({ date, close });
                ohlcvData.push({ date, open: open || close, high: high || close, low: low || close, close, volume });
              }
            }
            console.log(`[ANALYZE] Parsed ${closingPrices2Y.length} OHLCV data points from CSV for ${ticker}`);
          } else if (ohlcvHistResult.content) {
            // Fallback: parse from markdown table if no CSV file
            const rows = parseMarkdownTable(ohlcvHistResult.content);
            for (const row of rows) {
              const date = (row.date || '').trim();
              const close = parseNumber(row.close);
              const open = parseNumber(row.open || row.close);
              const high = parseNumber(row.high || row.close);
              const low = parseNumber(row.low || row.close);
              const volume = Math.round(parseNumber(row.volume));
              if (date && close > 0) {
                closingPrices2Y.push({ date, close });
                ohlcvData.push({ date, open: open || close, high: high || close, low: low || close, close, volume });
              }
            }
            console.log(`[ANALYZE] Parsed ${closingPrices2Y.length} OHLCV data points from markdown for ${ticker}`);
          }
        } catch (e: any) {
          console.error('[ANALYZE] Error parsing OHLCV data:', e?.message);
        }
      }

      // === FMP OHLCV Fallback: wenn Finance-Tool OHLCV leer, direkt FMP abfragen ===
      if (closingPrices2Y.length < 100) {
        try {
          const fmpStart = new Date(Date.now() - 11 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const fmpEnd = new Date().toISOString().split('T')[0];
          const fmpOhlcvUrl = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(ticker)}&from=${fmpStart}&to=${fmpEnd}&apikey=${process.env.FMP_API_KEY || 'lHc3gAE8V0YuUn48HEnXIHJazR7nI7Cx'}`;
          const fmpOhlcvResp = await fetch(fmpOhlcvUrl);
          if (fmpOhlcvResp.ok) {
            const raw = await fmpOhlcvResp.json() as any;
            const rows: any[] = Array.isArray(raw) ? raw : (raw?.historical || []);
            // FMP returns newest-first
            for (const row of [...rows].reverse()) {
              const date = row.date || '';
              const close = row.close || row.adjClose || 0;
              if (date && close > 0) {
                closingPrices2Y.push({ date, close });
                ohlcvData.push({
                  date,
                  open: row.open || close,
                  high: row.high || close,
                  low: row.low || close,
                  close,
                  volume: row.volume || 0,
                });
              }
            }
            console.log(`[FMP-OHLCV-FALLBACK] ${ticker}: fetched ${closingPrices2Y.length} data points`);
          }
        } catch (fmpOhlcvErr: any) {
          console.warn(`[FMP-OHLCV-FALLBACK] ${ticker}: ${fmpOhlcvErr?.message}`);
        }
      }

      // Historical prices for Section 1 display
      const historicalPrices = closingPrices2Y.map(d => ({ date: d.date, close: d.close }));

      // === Compute Technical Indicators ===
      const ohlcvForTA = closingPrices2Y.map(d => ({
        date: d.date,
        open: d.close, high: d.close, low: d.close,
        close: d.close,
        volume: 0,
      }));
      const technicals = ohlcvForTA.length > 30 ? computeTechnicalIndicators(ohlcvForTA) : undefined;

      // === Derived metrics ===
      const fcfMargin = revenue > 0 ? (fcfTTM / revenue) * 100 : 15;
      const forwardPE = epsConsensusNextFY > 0 ? price / epsConsensusNextFY : pe;
      // PEG = Forward P/E ÷ Forward EPS Growth (Yahoo Finance Standard)
      // Fallback chain: fwdPE/fwdGrowth → fwdPE/rev → pe/epsGrowth5Y → 2.0
      const _pegBase   = forwardPE > 0 ? Number(forwardPE) : pe;
      const _pegGrowth = (epsGrowthFwd > 0)
        ? epsGrowthFwd
        : (epsGrowth5Y > 0 ? epsGrowth5Y : revenueGrowth);
      const pegRatio = _pegBase > 0 && _pegGrowth > 0 ? _pegBase / _pegGrowth : 2;
      const evEbitda = ebitda > 0 ? (marketCap + totalDebt - cashEquivalents) / ebitda : 15;

      // Start peer comparison fetch (parallel with remaining computation)
      const peerComparisonPromise = fetchPeerComparison(
        ticker, companyName, pe, pegRatio, revenue, marketCap, revenueGrowth, epsGrowth5Y
      );
      const enterpriseValue = marketCap + totalDebt - cashEquivalents;

      // Beta estimate: improved approach using sector-aware defaults + vol adjustment
      // Pure vol-ratio (stock-vol / market-vol) overestimates beta for large-cap tech with idiosyncratic vol.
      // Better: use sector-default beta, then adjust moderately based on observed volatility.
      const prices = closingPrices2Y.slice(-252).map(d => d.close);
      let beta5Y = 1.0;
      {
        // Sector default betas (more realistic than pure vol ratio)
        const sLow = sector.toLowerCase();
        let sectorBeta = 1.0;
        if (sLow.includes("tech")) sectorBeta = 1.15;
        else if (sLow.includes("consumer") && sLow.includes("cycl")) sectorBeta = 1.10;
        else if (sLow.includes("consumer") && sLow.includes("discr")) sectorBeta = 1.15;
        else if (sLow.includes("financ")) sectorBeta = 1.10;
        else if (sLow.includes("energy")) sectorBeta = 1.20;
        else if (sLow.includes("health")) sectorBeta = 0.85;
        else if (sLow.includes("util")) sectorBeta = 0.55;
        else if (sLow.includes("real estate")) sectorBeta = 0.90;
        else if (sLow.includes("industrial")) sectorBeta = 1.05;
        else if (sLow.includes("commun")) sectorBeta = 0.90;

        if (prices.length > 50) {
          const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
          const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
          const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
          const annualVol = Math.sqrt(variance * 252);
          const volBeta = annualVol / 0.16; // 16% market benchmark
          // Blend: 60% sector default + 40% vol-based, capped [0.5, 2.0]
          beta5Y = +(Math.max(0.5, Math.min(2.0, sectorBeta * 0.6 + volBeta * 0.4))).toFixed(2);
        } else {
          beta5Y = sectorBeta;
        }
        console.log(`[ANALYZE] Beta: sector=${sectorBeta}, calculated=${beta5Y}`);
      }

      // === Sector defaults ===
      const sectorDefs = getSectorDefaults(sector, industry);

      // === Peter Lynch Classification + PEG ===
      const epsGrowthFwd = Number((fmpData as any)?.epsGrowthFwd) > 0
        ? Number((fmpData as any).epsGrowthFwd)
        : (epsConsensusNextFY > 0 && eps > 0 ? (epsConsensusNextFY / eps - 1) * 100 : 0);
      const lynchClass = classifyLynch({
        epsGrowth5Y: Number(epsGrowth5Y) || 0,
        revenueGrowth,
        sector,
        industry,
        dividendYield: Number(divYield) || 0,
        fcfMargin,
        pe,
        forwardPE: Number(forwardPE) || 0,
      });
      const { peg: lynchPEG, pegBasis: lynchPEGBasis } = calcLynchPEG({
        lynchClass,
        pe,
        forwardPE: Number(forwardPE) || 0,
        epsGrowth5Y: Number(epsGrowth5Y) || 0,
        epsGrowthFwd: Number(epsGrowthFwd) || 0,
        revenueGrowth,
        dividendYield: Number(divYield) || 0,
        price,
      });
      console.log(`[ANALYZE] ${ticker} Lynch=${lynchClass} PEG=${lynchPEG} (${lynchPEGBasis})`);

      // === Government exposure ===
      const govExp = estimateGovExposure(sector, industry, description);
      const fcfHaircut = govExp.exposure > 20 ? Math.min(20, Math.round(govExp.exposure * 0.4)) : 0;

      // === RSL (26-week avg ≈ 130 trading days) ===
      const prices26w = closingPrices2Y.slice(-130).map(d => d.close);
      const rslAvg = prices26w.length > 0 ? prices26w.reduce((s, v) => s + v, 0) / prices26w.length : price;
      const rsl = rslAvg > 0 ? (price / rslAvg) * 100 : 100;

      // === SEC 10-K Filing Analysis + Key Projects ===
      let keyProjects: string[] = [];
      let newsHeadlines: string[] = [];
      let secFilingExcerpts: string[] = [];

      // === Fetch News (parallel with SEC 10-K) ===
      const newsItemsPromise = fetchNewsFromGoogleRSS(ticker, companyName);

      try {
        // Step 1: Get CIK from SEC company_tickers.json
        const tickerUpper = ticker.replace(/\..+$/, '').toUpperCase(); // Strip exchange suffix
        const cikResp = await fetch('https://www.sec.gov/files/company_tickers.json', {
          headers: { 'User-Agent': 'StockAnalystPro/1.0 (philip.diaz.rohr@gmail.com)' },
        });
        let cik = '';
        if (cikResp.ok) {
          const cikData = await cikResp.json() as any;
          for (const entry of Object.values(cikData) as any[]) {
            if (entry.ticker === tickerUpper) {
              cik = String(entry.cik_str).padStart(10, '0');
              break;
            }
          }
        }

        if (cik) {
          // Step 2: Get latest 10-K filing
          const submResp = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
            headers: { 'User-Agent': 'StockAnalystPro/1.0 (philip.diaz.rohr@gmail.com)' },
          });
          if (submResp.ok) {
            const submData = await submResp.json() as any;
            const filings = submData?.filings?.recent;
            if (filings) {
              let tenKIdx = -1;
              for (let i = 0; i < (filings.form?.length || 0); i++) {
                if (filings.form[i] === '10-K' || filings.form[i] === '20-F') { tenKIdx = i; break; }
              }
              if (tenKIdx >= 0) {
                const accNum = filings.accessionNumber[tenKIdx].replace(/-/g, '');
                const doc = filings.primaryDocument[tenKIdx];
                const cikNum = cik.replace(/^0+/, '');
                const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNum}/${doc}`;
                console.log(`[ANALYZE] Fetching 10-K from: ${filingUrl}`);

                // Step 3: Fetch and parse the 10-K
                const tenKResp = await fetch(filingUrl, {
                  headers: { 'User-Agent': 'StockAnalystPro/1.0 (philip.diaz.rohr@gmail.com)' },
                });
                if (tenKResp.ok) {
                  const rawHtml = await tenKResp.text();
                  // Strip HTML tags
                  let cleanText = rawHtml.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

                  // Step 4: Extract Business section (Item 1) — first 5000 chars
                  const item1Start = cleanText.toLowerCase().indexOf('item 1.');
                  const item1aStart = cleanText.toLowerCase().indexOf('item 1a.');
                  let businessText = '';
                  if (item1Start > 0 && item1aStart > item1Start) {
                    businessText = cleanText.substring(item1Start, Math.min(item1aStart, item1Start + 8000));
                  } else if (item1Start > 0) {
                    businessText = cleanText.substring(item1Start, item1Start + 8000);
                  }

                  // Step 5: Extract key catalysts via regex patterns
                  const fullText = cleanText.substring(0, 50000); // First 50K chars covers Business + Risk Factors
                  const catalystPatterns = [
                    // Named projects, mines, facilities
                    /([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})\s+(?:mine|project|facility|plant|pipeline|platform)\b/g,
                    // Ramp-ups, expansions, launches
                    /(?:commenced|commencing|ramp[- ]?up|expansion|launched?)\s+(?:operations?|production|longwall)?\s+(?:at|of|for)?\s+(?:the\s+)?([A-Z][a-zA-Z\s]{3,30}?)(?:\s+mine|\s+project|\s+facility|,|\.|in )/g,
                    // Capacity increases
                    /(?:increase|expand|grow)\s+(?:annual |our )?(?:production |nameplate )?capacity\s+(?:up to |by |to )?(?:approximately )?([\d,.]+\s*(?:million|percent|%|metric tons|mtpy))/gi,
                    // Transformational statements
                    /(?:transformational|game[- ]changing|significant|landmark)\s+(?:investment|project|acquisition|expansion)\s+(?:that |which )?([^.]{10,100})/gi,
                  ];

                  for (const pattern of catalystPatterns) {
                    let match;
                    while ((match = pattern.exec(fullText)) !== null && keyProjects.length < 8) {
                      const extracted = (match[1] || match[0]).trim();
                      // Filter: must be meaningful, not generic words
                      const genericWords = /^(Item|Part|Table|Note|Form|This|The |Our |We |In |Preparation|Surface|Underground|Annual|Report|Financial|General|Management|Company|Corporation|Other|Total|Net)$/i;
                      if (extracted.length > 4 && extracted.length < 80 &&
                          !genericWords.test(extracted.trim()) &&
                          !keyProjects.some(p => p.toLowerCase().includes(extracted.toLowerCase().substring(0, 15)))) {
                        keyProjects.push(extracted);
                      }
                    }
                  }

                  // Step 6: Extract key sentences about projects for excerpts
                  const sentences = fullText.split(/\.\s+/);
                  for (const sentence of sentences) {
                    if (secFilingExcerpts.length >= 3) break;
                    const s = sentence.trim();
                    if (s.length > 50 && s.length < 300 &&
                        (s.match(/(?:ramp|expan|commenc|capacity|production.*increas|transform|growth.*driver|new.*mine|new.*facility|new.*plant|new.*project)/i)) &&
                        !s.match(/^(?:Item|Part|Note|Table)/) &&
                        !secFilingExcerpts.some(e => e.substring(0, 30) === s.substring(0, 30))) {
                      secFilingExcerpts.push(s.substring(0, 250) + (s.length > 250 ? '...' : ''));
                    }
                  }

                  console.log(`[ANALYZE] SEC 10-K: Found ${keyProjects.length} key projects, ${secFilingExcerpts.length} excerpts for ${ticker}`);
                }
              }
            }
          }
        } else {
          console.log(`[ANALYZE] CIK not found for ${tickerUpper} (may be non-US stock)`);
        }
      } catch (secErr: any) {
        console.log(`[ANALYZE] SEC 10-K parsing failed: ${secErr?.message?.substring(0, 150)}`);
      }

      // === Collect News + Peers (awaited from parallel fetches) ===
      const newsItems = await newsItemsPromise;
      const peerComparison = await peerComparisonPromise;
      // Populate newsHeadlines for LLM context
      newsHeadlines = newsItems.map(n => `[${n.relativeTime}] ${n.title} (${n.source})`);

      // === Catalysts & Risks ===
      let catalysts: Catalyst[];
      // Track whether the LLM call actually produced usable catalysts.
      // Stays false if useLLM=false OR if the LLM call failed/returned <3 items
      // and we fell back to sector templates. This is what we tag the cache with,
      // so KI-on requests don't get back stale sector-template caches misbranded
      // as LLM-generated.
      let llmActuallyUsed = false;
      // Fallback: avoid empty description reaching LLM prompt
      const safeDescription = (description?.trim() && description.length > 30)
        ? description
        : `${companyName} ist ein Unternehmen aus dem ${sector}-Sektor (${industry}).`;
      if (useLLM) {
        // === Combined LLM call via OpenRouter (Haiku 3.5 by default) ===
        // Replaces the previous two separate Anthropic Sonnet calls
        // (generateLLMCatalysts + matchNewsToCatalysts). Returns 5 catalysts
        // AND news-sentiment matches in ONE round trip. Saves ~80% on credits:
        //   - Old: 2x Sonnet @ ~5.5k tokens ≈ ~10-15 credits
        //   - New: 1x Haiku @ ~3.5k tokens ≈ ~3-4 credits (Haiku is ~3x cheaper)
        const combined = await generateCatalystsAndMatchNews({
          ticker, companyName, sector, industry, description: safeDescription,
          revenue, revenueGrowth, fcfMargin, price, pe, marketCap,
          keyProjects, secFilingExcerpts, newsItems,
        });
        if (combined && combined.catalysts.length >= 3) {
          catalysts = combined.catalysts; // LLM result already has news matching embedded
          llmActuallyUsed = true;
          console.log(`[ANALYZE] Using OpenRouter LLM catalysts for ${ticker} (model=${combined.modelUsed}, tokens=${combined.promptTokens || '?'}+${combined.completionTokens || '?'})`);
        } else {
          catalysts = generateCatalysts(sector, industry, revenueGrowth, fcfMargin, description, revenue, forwardPE, sectorDefs.sectorAvgForwardPE || sectorDefs.sectorAvgPE || 20, revenueGrowth);
          console.log(`[ANALYZE] LLM failed/unavailable, falling back to sector-template catalysts for ${ticker}`);
          // Still do keyword news matching so badges work in Section 15
          if (newsItems.length > 0) await matchNewsToCatalysts(newsItems, catalysts);
        }
      } else {
        // Fast path: sector-template catalysts, no LLM
        catalysts = generateCatalysts(sector, industry, revenueGrowth, fcfMargin, description, revenue, forwardPE, sectorDefs.sectorAvgForwardPE || sectorDefs.sectorAvgPE || 20, revenueGrowth);
        console.log(`[ANALYZE] Using sector-template catalysts for ${ticker} (LLM off)`);
        // Still run keyword-based news matching so newsItems get matchedCatalystIdx
        // even without LLM — this powers the news badges in Section 15
        if (newsItems.length > 0) {
          await matchNewsToCatalysts(newsItems, catalysts);
        }
      }

      // Template risks as fallback (instant) — LLM-specific risks started later after capexCtxForThesis is built
      let risks = generateRisks(sector, beta5Y, govExp.exposure);
      // tamAnalysis is computed after revenueSegments are parsed (below)

      // === growthThesis — LLM-generated, company-specific ===
      // Try LLM first (cheap: ~120 tokens Haiku), fall back to template if unavailable
      const realCats = catalysts.filter(c => !c.tags?.includes("capex-tailwind"));
      const capexCtxForThesis = analyzeCapexContext ? {
        sector: analyzeCapexContext.sector,
        programmes: analyzeCapexContext.programmes,
        rationale: analyzeCapexContext.beneficiaryEntry.rationale,
      } : null;

      let growthThesis = "";
      const coName = companyName || ticker;

      // LLM thesis (runs async, but we await it here — max 180 tokens ≈ $0.00004)
      // Build fingerprint to detect stale cached thesis
      const thesisFingerprint = growthThesisFingerprint({
        revenueGrowth,
        fcfMargin,
        topCatalysts: realCats.slice(0, 2).map(c => ({ name: c.name, context: c.context || "" })),
        capexContext: capexCtxForThesis,
      });
      const cachedFingerprint = cached?.growthThesisFingerprint as string | undefined;
      const thesisIsStale = cachedFingerprint && cachedFingerprint !== thesisFingerprint;
      if (thesisIsStale) {
        console.log(`[GROWTH-THESIS] Stale thesis detected for ${ticker} — fingerprint changed (${cachedFingerprint} → ${thesisFingerprint})`);
      }

      const llmThesis = await generateGrowthThesis({
        ticker,
        companyName: coName,
        description: description || "",
        sector,
        industry,
        revenueGrowth,
        fcfMargin,
        grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
        operatingMargin: revenue > 0 ? (operatingIncome / revenue) * 100 : 0,
        forwardPE: Number(forwardPE) || 0,
        evEbitda: Number(evEbitda) || 0,
        analystPTMedian: Number(analystPTMedian) || 0,
        currentPrice: Number(price) || 0,
        returnOnEquity: totalEquity > 0 ? (netIncome / totalEquity) * 100 : 0,
        topCatalysts: realCats.slice(0, 2).map(c => ({ name: c.name, context: c.context || "" })),
        capexContext: capexCtxForThesis,
      }).catch(() => null);

      if (llmThesis) {
        growthThesis = llmThesis;
      } else {
        // Fallback: template-based (wenn LLM nicht verfügbar)
        if (revenueGrowth > 20) growthThesis = `${coName} wächst mit ${revenueGrowth.toFixed(1)}% überdurchschnittlich stark.`;
        else if (revenueGrowth > 10) growthThesis = `${coName} zeigt solides Wachstum von ${revenueGrowth.toFixed(1)}% (FCF-Marge: ${fcfMargin.toFixed(1)}%).`;
        else if (revenueGrowth > 0) growthThesis = `${coName} wächst moderat mit ${revenueGrowth.toFixed(1)}% — Margenexpansion entscheidend (FCF: ${fcfMargin.toFixed(1)}%).`;
        else growthThesis = `${coName} kämpft mit ${revenueGrowth.toFixed(1)}% Umsatzrückgang — Turnaround oder neuer Wachstumsvektor nötig.`;
        if (realCats.length > 0) growthThesis += ` Kurstreiber: ${realCats.slice(0, 2).map(c => c.name).join(", ")}.`;
      }
      if (hybridPrefix) growthThesis = hybridPrefix + growthThesis;


      // === Capex Tailwind — inject catalyst + enrich growthThesis ===
      if (analyzeCapexContext) {
        const progNames = analyzeCapexContext.programmes.slice(0, 2).join(" & ") || analyzeCapexContext.sector;
        const impactLabel = analyzeCapexContext.impact === "positiv" ? "positiv" : analyzeCapexContext.impact;
        const capexPos = analyzeCapexContext.impact === "positiv" ? 68 : analyzeCapexContext.impact === "neutral" ? 50 : 35;
        const capexCatalyst: Catalyst = {
          name: `Capex Tailwind: ${analyzeCapexContext.sector}`,
          timeline: analyzeCapexContext.timeline,
          pos: capexPos,
          bruttoUpside: analyzeCapexContext.impact === "positiv" ? 18 : 8,
          einpreisungsgrad: analyzeCapexContext.impact === "positiv" ? 45 : 55,
          nettoUpside: 0, gb: 0,
          context: `${analyzeCapexContext.beneficiaryEntry.rationale || companyName + " profitiert direkt von staatlichen Ausgabenprogrammen."} Programme: ${progNames} (${analyzeCapexContext.timeline}, Impact: ${impactLabel}). ${analyzeCapexContext.reasoning.slice(0, 180)}`,
          tags: ["gov-spending", "capex-tailwind"],
        };
        catalysts.unshift(capexCatalyst);
        growthThesis += ` Struktureller Rückenwind durch staatliche Capex-Programme: ${progNames} (${analyzeCapexContext.timeline}, ${analyzeCapexContext.sector}).`;
      }

      // === Company-specific Risks via LLM (runs HERE after capexCtxForThesis + catalysts are ready) ===
      try {
        const specificRisksResult = await generateCompanySpecificRisks({
          ticker,
          companyName: companyName || String(ticker),
          description: description || "",
          sector,
          industry,
          revenue,
          revenueGrowth,
          fcfMargin,
          grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
          forwardPE: Number(forwardPE) || 0,
          beta: beta5Y,
          governmentExposure: govExp.exposure,
          topCatalysts: (catalysts || []).filter((c: any) => !c.tags?.includes("capex-tailwind")).slice(0, 2).map((c: any) => ({ name: c.name, context: c.context || "" })),
          capexContext: capexCtxForThesis,
          recentNewsHeadlines: (newsItems || []).slice(0, 4).map((n: any) => n.title || ""),
        });
        if (specificRisksResult && specificRisksResult.length >= 3) {
          risks = specificRisksResult.map(r => ({ ...r, expectedDamage: 0 }));
          console.log(`[ANALYZE] Company-specific risks for ${ticker}: ${risks.map(r => r.name).join(" | ")}`);
        }
      } catch (specificRiskErr: any) {
        console.warn(`[ANALYZE] Specific risk LLM failed for ${ticker}: ${specificRiskErr?.message}`);
      }

      // === Risk Explanations (LLM Deep-Dive, same as catalyst reasoning) ===
      if (useLLM) {
        try {
          const enrichedRisks = await generateRiskExplanations({
            ticker,
            companyName,
            sector: sector || industry || 'Technology', // already corrected by getEffectiveSector()
            industry,
            description: safeDescription,
            revenue,
            revenueGrowth,
            fcfMargin,
            price,
            pe: pe,
            marketCap,
            governmentExposure: govExp.exposure,
            risks,
            keyProjects: keyProjects.slice(0, 5),
            recentNewsHeadlines: newsHeadlines.slice(0, 5),
          });
          if (enrichedRisks) {
            risks = enrichedRisks;
            console.log(`[ANALYZE] LLM risk explanations applied for ${ticker}`);
          }
        } catch (riskLLMErr: any) {
          console.warn(`[ANALYZE] Risk LLM failed for ${ticker}: ${riskLLMErr?.message || String(riskLLMErr)}`);
        }

        // === Catalyst Deep-Dive Explanations (Section 15) ===
        // After catalysts are generated, enrich each with a 5-point deep-dive
        if (catalysts.length > 0) {
          try {
            // Use sp.sector (sectorProfile-corrected sector) when available
            // to avoid misclassification (e.g. IFX.DE: FMP returns 'Financial Services',
            // but sectorProfile correctly identifies it as 'Technology/Semiconductors')
            const deepDiveSector = sector || industry || 'Technology'; // already corrected by getEffectiveSector()
            const deepDiveAnalystPT = analystPTMedian > 0 ? analystPTMedian : price; // fallback to price if no PT
            const deepDives = await generateCatalystDeepDives({
              ticker, companyName,
              sector: deepDiveSector,
              description: safeDescription,
              revenue, revenueGrowth, fcfMargin, price,
              analystPT: deepDiveAnalystPT,
              catalysts: catalysts.map(c => ({ name: c.name, pos: c.pos, bruttoUpside: c.bruttoUpside, einpreisungsgrad: c.einpreisungsgrad, context: c.context })),
              newsHeadlines: newsHeadlines.slice(0, 4),
            });
            if (deepDives && deepDives.length > 0) {
              catalysts = catalysts.map((c, i) => deepDives[i] ? { ...c, deepDive: deepDives[i].deepDive } : c);
              console.log(`[ANALYZE] Catalyst deep-dives applied for ${ticker}: ${deepDives.length} catalysts`);
            }
          } catch (deepDiveErr: any) {
            console.warn(`[ANALYZE] Catalyst deep-dive LLM failed for ${ticker}: ${deepDiveErr?.message?.substring(0, 100)}`);
          }
        }
      }

      // === Growth thesis (enriched with catalyst business model reasoning) ===
      const hybridPrefix = sectorHybridNote ? `⚠️ ${sectorHybridNote} ` : "";
      // === Capex Fiscal Tailwind Lookup (runs before growthThesis) ===
      let analyzeCapexContext: CapexTailwindContext | null = null;
      try {
        const CAPEX_REGIONS = ["US", "EU", "ASIA"];
        outerCapex: for (const region of CAPEX_REGIONS) {
          const capexData = diskResearcherGet(`capex__${region}`);
          if (!capexData?.sectorExposure) continue;
          for (const sectorEntry of (capexData.sectorExposure as any[])) {
            const beneficiaries: any[] = sectorEntry.listedBeneficiaries || [];
            const match = beneficiaries.find(
              (b: any) => String(b.ticker || "").toUpperCase() === String(ticker).toUpperCase()
            );
            if (match) {
              analyzeCapexContext = {
                sector: sectorEntry.sector || "",
                impact: sectorEntry.impact || "positiv",
                timeline: sectorEntry.timeline || "12-24M",
                reasoning: sectorEntry.reasoning || "",
                programmes: Array.isArray(sectorEntry.programmes) ? sectorEntry.programmes : [],
                beneficiaryEntry: { ticker: match.ticker, name: match.name || companyName, rationale: match.rationale || "" },
              };
              console.log(`[ANALYZE] ${ticker} matched Capex cache: ${region}/${sectorEntry.sector} | programmes: ${analyzeCapexContext.programmes.join(", ")}`);
              break outerCapex;
            }
          }
        }
      } catch (capexLookupErr: any) {
        console.warn(`[ANALYZE] capex lookup error for ${ticker}: ${capexLookupErr?.message}`);
      }


      // === Moat rating ===
      let moatRating = "Narrow";
      if (fcfMargin > 25 && pe > 25) moatRating = "Wide";
      else if (fcfMargin > 15) moatRating = "Narrow-Wide";
      else if (fcfMargin < 5) moatRating = "None";

      // === Max drawdown from history ===
      let maxDrawdown = 0, maxDrawdownYear = "";
      if (closingPrices2Y.length > 100) {
        let peak = 0;
        for (const d of closingPrices2Y) {
          if (d.close > peak) peak = d.close;
          const dd = ((peak - d.close) / peak) * 100;
          if (dd > maxDrawdown) {
            maxDrawdown = dd;
            maxDrawdownYear = d.date.substring(0, 4);
          }
        }
      }

      // === Porter's Five Forces & Moat Assessment ===
      const moatAssessment = generateMoatAssessment(sector, industry, fcfMargin, marketCap, revenueGrowth, moatRating, description, companyName);

      // === Catalyst Reasoning ===
      const catalystReasoning = generateCatalystReasoning(sector, industry, revenueGrowth, fcfMargin, pe, price, analystPTMedian, rsl);

      // === PESTEL Analysis ===
      const pestelAnalysis = generatePESTELAnalysis(sector, industry, description, beta5Y, govExp.exposure, reportedCurrency);

      // === Macro Correlations (PMI, commodities, indices) ===
      const macroCorrelations = generateMacroCorrelations(sector, industry, description, beta5Y, reportedCurrency);

      // === Revenue Segments (Produkte) + Geographic Segments (Regionen) ===
      let revenueSegments: { name: string; revenue: number; percentage: number; growth: number }[] | undefined;
      let geoSegments: { name: string; revenue: number; percentage: number; growth: number }[] | undefined;
      if (segmentsResult?.content) {
        try {
          const segContent = typeof segmentsResult.content === "string" ? segmentsResult.content : JSON.stringify(segmentsResult.content);

          // Parse the "Column legend" section to get human-readable names for segment keys
          const legendMap: Record<string, string> = {};
          const legendMatch = segContent.match(/Column legend:[\s\S]*?(?=\n\|)/m);
          // Detect geographic + aggregate column keys from legend sections
          const geoKeys = new Set<string>();
          const otherKeys = new Set<string>(); // "Other:" section = aggregate/rollup columns
          if (legendMatch) {
            // Pattern: key = Human Readable Name (USD)
            const legendPattern = /([a-z_]+)\s*=\s*([^(,]+?)\s*\(/g;
            let lm;
            while ((lm = legendPattern.exec(legendMatch[0])) !== null) {
              legendMap[lm[1].trim()] = lm[2].trim();
            }
            // Find keys in the "Revenue by Geography" section of legend
            const geoSectionMatch = legendMatch[0].match(/Revenue by Geography:[^\n]*(?:\n[^\n]*?)*/i);
            if (geoSectionMatch) {
              const geoPattern = /([a-z_]+)\s*=/g;
              let gm;
              while ((gm = geoPattern.exec(geoSectionMatch[0])) !== null) {
                geoKeys.add(gm[1].trim());
              }
            }
            // Find keys in the "Other:" section (aggregate/rollup columns)
            const otherSectionMatch = legendMatch[0].match(/Other:[^\n]*(?:\n(?!\s*(?:Revenue|EBIT|Other)[^:]*:)[^\n]*)*/i);
            if (otherSectionMatch) {
              const otherPattern = /([a-z_]+)\s*=/g;
              let om;
              while ((om = otherPattern.exec(otherSectionMatch[0])) !== null) {
                otherKeys.add(om[1].trim());
              }
            }
          }

          // Also detect geo columns by common naming patterns (use ^ or _ prefix to avoid substring false positives like rybelsUS_revenue)
          const isGeoColumn = (col: string): boolean => {
            if (geoKeys.has(col)) return true;
            return /^us_revenue|^eucan|^emea|^apac|^china_revenue|^rest_of_world|^emerging_market|^north_america|^international_revenue|^europe_|^latin_america|^japan_|^asia_|^united_states|^other_countries|geograph|^americas|^japan_revenue|^korea_revenue|^india_revenue|^uk_revenue|^germany_revenue|^middle_east|^africa|^greater_china|^canada_revenue|^australia_revenue/i.test(col);
          };

          // Also detect aggregate/total columns that shouldn't be product segments
          const isAggregateColumn = (col: string): boolean => {
            // Skip rollup/aggregate columns: total_*, and anything from the legend's "Other:" section
            if (otherKeys.has(col)) return true;
            return /^total_/i.test(col);
          };

          // Parse the markdown table
          const segTables = parseMarkdownTable(segContent);
          if (segTables.length > 0) {
            const headers = Object.keys(segTables[0]);
            const revenueColumns = headers.filter(h => /revenue/i.test(h) && h !== 'date' && h !== 'period');

            // Sort rows by date descending to get latest year first
            const sortedRows = [...segTables].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const latestRow = sortedRows[0];
            const prevRow = sortedRows.length > 1 ? sortedRows[1] : null;

            if (latestRow) {
              const productSegs: { name: string; revenue: number; percentage: number; growth: number }[] = [];
              const geoSegs: { name: string; revenue: number; percentage: number; growth: number }[] = [];

              // Sort: post_fy columns first, then plain, then pre_fy
              const sortedRevCols = revenueColumns.sort((a, b) => {
                const aPost = /post_fy/i.test(a) ? 0 : /pre_fy/i.test(a) ? 2 : 1;
                const bPost = /post_fy/i.test(b) ? 0 : /pre_fy/i.test(b) ? 2 : 1;
                return aPost - bPost;
              });

              const usedProductNames = new Set<string>();
              const usedGeoNames = new Set<string>();

              for (const col of sortedRevCols) {
                const rawVal = parseNumber(latestRow[col]);
                if (rawVal <= 0) continue;

                // Clean column key to human-readable name
                let segName = legendMap[col] || col
                  .replace(/_revenue.*$/i, '')
                  .replace(/_post_fy\d+/i, '')
                  .replace(/_pre_fy\d+/i, '')
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, c => c.toUpperCase());
                segName = segName.replace(/\s*Revenue$/i, '').trim();

                // Calculate growth vs previous year
                let growth: number | undefined;
                if (prevRow) {
                  const prevVal = parseNumber(prevRow[col]);
                  if (prevVal > 0) {
                    growth = +((rawVal - prevVal) / prevVal * 100).toFixed(1);
                  } else {
                    const altCol = col.replace(/post_fy\d+/i, m => m.replace('post', 'pre'));
                    const altVal = parseNumber(prevRow[altCol]);
                    if (altVal > 0) growth = +((rawVal - altVal) / altVal * 100).toFixed(1);
                  }
                }

                const seg: { name: string; revenue: number; percentage: number; growth: number } = { name: segName, revenue: rawVal, percentage: 0, growth };
                const normName = segName.toLowerCase().replace(/[^a-z0-9]/g, '');

                if (isGeoColumn(col) && !isAggregateColumn(col)) {
                  // Geographic segment
                  if (!usedGeoNames.has(normName)) {
                    usedGeoNames.add(normName);
                    geoSegs.push(seg);
                  }
                } else if (!isAggregateColumn(col)) {
                  // Product/business segment
                  if (!usedProductNames.has(normName)) {
                    usedProductNames.add(normName);
                    productSegs.push(seg);
                  }
                }
              }

              // === Process product segments ===
              const processBestSet = (segments: { name: string; revenue: number; percentage: number; growth: number }[]): { name: string; revenue: number; percentage: number; growth: number }[] | undefined => {
                if (segments.length === 0) return undefined;
                segments.sort((a, b) => b.revenue - a.revenue);
                const segSum = segments.reduce((s, seg) => s + seg.revenue, 0);
                const realTotal = revenue > 0 ? revenue : segSum;

                let bestSet: { name: string; revenue: number; percentage: number; growth: number }[] = segments;
                // Only apply combo optimization if segment sum is within 3x of revenue
                // (>3x likely indicates currency mismatch, e.g. segments in DKK but revenue in USD)
                if (segSum > realTotal * 1.2 && segSum <= realTotal * 3 && segments.length <= 20) {
                  let bestDiff = Infinity;
                  const N = segments.length;
                  for (let size = 2; size <= Math.min(8, N); size++) {
                    const indices = Array.from({ length: size }, (_, i) => i);
                    while (true) {
                      const comboSum = indices.reduce((s, idx) => s + segments[idx].revenue, 0);
                      const diff = Math.abs(comboSum - realTotal);
                      if (diff < bestDiff) {
                        bestDiff = diff;
                        bestSet = indices.map(idx => segments[idx]);
                      }
                      let i = size - 1;
                      while (i >= 0 && indices[i] === N - size + i) i--;
                      if (i < 0) break;
                      indices[i]++;
                      for (let j = i + 1; j < size; j++) indices[j] = indices[j - 1] + 1;
                    }
                  }
                }
                const setTotal = bestSet.reduce((s, seg) => s + seg.revenue, 0);
                for (const seg of bestSet) {
                  seg.percentage = +((seg.revenue / setTotal) * 100).toFixed(1);
                }
                bestSet.sort((a, b) => b.revenue - a.revenue);
                return bestSet.filter(s => s.percentage >= 2).slice(0, 8);
              };

              revenueSegments = processBestSet(productSegs);

              // === Process geographic segments ===
              // NOTE: Geographic segments may be in the reporting currency (e.g. DKK, EUR)
              // while `revenue` may already be converted to USD. So we do NOT use the combo
              // optimization here. Instead, compute percentages from their own sum.
              if (geoSegs.length > 0) {
                geoSegs.sort((a, b) => b.revenue - a.revenue);
                const geoTotal = geoSegs.reduce((s, seg) => s + seg.revenue, 0);
                for (const seg of geoSegs) {
                  seg.percentage = +((seg.revenue / geoTotal) * 100).toFixed(1);
                }
                geoSegments = geoSegs.filter(s => s.percentage >= 1.5).slice(0, 8);
                console.log(`[ANALYZE] Parsed ${geoSegments.length} geographic segments for ${ticker}`);
              }

              if (revenueSegments) {
                console.log(`[ANALYZE] Parsed ${revenueSegments.length} product segments for ${ticker} (from ${productSegs.length} raw)`);
              }
            }
          }
        } catch (segErr: any) {
          console.error(`[ANALYZE] Segment parsing error:`, segErr?.message?.substring(0, 200));
        }
      }

      // === TAM Analysis (must be AFTER revenueSegments parsing) ===
      const tamAnalysis = generateTAMAnalysis(sector, industry, description, revenue, revenueGrowth, revenueSegments);

      // === Structural trends (derived from effective sector, not hardcoded) ===
      const structuralTrends = [];
      const sLow = sector.toLowerCase();
      const indLow = industry.toLowerCase();
      if (sLow.includes("tech")) {
        structuralTrends.push("AI/ML adoption acceleration", "Cloud migration tailwind", "Digital transformation spend");
      } else if (sLow.includes("health")) {
        structuralTrends.push("Aging demographics", "Biotech innovation cycle", "Healthcare digitization");
      } else if (sLow.includes("financ")) {
        structuralTrends.push("Fintech disruption/adoption", "Rate normalization cycle", "Digital banking shift");
      } else if (sLow.includes("energy")) {
        structuralTrends.push("Energy transition", "Electrification trend", "Energy security focus");
      } else if (sLow.includes("consumer") && (sLow.includes("cycl") || sLow.includes("discr"))) {
        const descLow = description.toLowerCase();
        if (indLow.includes("gambling") || indLow.includes("casino") || descLow.includes("casino") || descLow.includes("gaming entertainment")) {
          structuralTrends.push("iGaming & online sports betting legalization", "Digital transformation of gaming floor", "Loyalty program & database marketing");
        } else if (indLow.includes("luxury") || indLow.includes("apparel") || indLow.includes("fashion")) {
          structuralTrends.push("China/Asia luxury demand recovery", "Premiumization & aspirational spending", "Direct-to-Consumer & digital retail");
        } else if (indLow.includes("auto") || descLow.includes("automobile") || descLow.includes("vehicle")) {
          structuralTrends.push("EV transition acceleration", "Autonomous driving technology", "Connected car & software-defined vehicle");
        } else if (indLow.includes("restaurant") || descLow.includes("restaurant")) {
          structuralTrends.push("Digital ordering & delivery penetration", "Menu price elasticity & value positioning", "Franchise expansion & unit economics");
        } else if (indLow.includes("travel") || indLow.includes("hotel") || descLow.includes("hotel") || descLow.includes("cruise")) {
          structuralTrends.push("Revenge travel & experience economy", "Loyalty ecosystem monetization", "Asset-light franchise model shift");
        } else {
          structuralTrends.push("E-Commerce penetration growth", "Consumer confidence recovery", "DTC channel expansion");
        }
      } else if (sLow.includes("consumer") && (sLow.includes("stapl") || sLow.includes("defens"))) {
        structuralTrends.push("Premiumization in staples", "Emerging market middle class growth", "Health & wellness trend");
      } else if (sLow.includes("industrial")) {
        structuralTrends.push("Infrastructure investment cycle", "Automation & reshoring", "Electrification of industry");
      } else if (sLow.includes("real estate")) {
        structuralTrends.push("Urbanization trend", "Data center / logistics demand", "Interest rate normalization");
      } else if (sLow.includes("util")) {
        structuralTrends.push("Clean energy transition", "Grid modernization", "Regulated returns stability");
      } else if (sLow.includes("commun")) {
        structuralTrends.push("Digital content consumption", "Advertising shift to digital", "5G/Connectivity build-out");
      } else if (sLow.includes("material") || sLow.includes("basic")) {
        structuralTrends.push("Green metals demand (EV/battery)", "Infrastructure super-cycle", "Supply chain reshoring");
      } else {
        structuralTrends.push("Market consolidation", "Operating efficiency gains", "Geographic expansion");
      }

      // === Build response ===
      const analysis: StockAnalysis = {
        ticker,
        companyName,
        exchange,
        sector,
        industry,
        description,
        currentPrice: price,
        priceTimestamp,
        currency: currency || "USD",
        marketCap,
        sharesOutstanding,

        analystPT: {
          median: analystPTMedian,
          high: analystPTHigh,
          low: analystPTLow,
          count: analystCount,
        },
        ratings: {
          buy: ratingsBuy,
          hold: ratingsHold,
          sell: ratingsSell,
        },

        epsTTM: eps,
        epsAdjFY: eps,
        epsConsensusNextFY,
        epsGrowth5Y: +epsGrowth5Y.toFixed(2),

        peRatio: pe,
        forwardPE: +forwardPE.toFixed(2),
        peg: lynchPEG ?? (pegRatio || null),            // Lynch-PEG bevorzugt
        pegRatio: lynchPEG ?? +pegRatio.toFixed(2),     // alias für Frontend, Lynch bevorzugt
        lynchClass,                                      // z.B. "cyclical"
        lynchPEGBasis,                                   // Erklärung der Methode
        evEbitda: +evEbitda.toFixed(2),
        beta5Y,
        fcfTTM,
        fcfMargin: +fcfMargin.toFixed(2),
        revenue,
        ebitda,
        operatingIncome,
        netIncome,
        totalDebt,
        cashEquivalents,
        enterpriseValue,

        historicalPrices,

        sectorAvgPE: sectorDefs.sectorAvgPE,
        sectorAvgForwardPE: sectorDefs.sectorAvgForwardPE,
        sectorAvgEVEBITDA: sectorDefs.sectorAvgEVEBITDA,
        sectorAvgPEG: sectorDefs.sectorAvgPEG,

        // Financial Statements Summary
        financialStatements: (() => {
          const rev = revenue || 1;
          const gm = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
          const om = revenue > 0 ? (operatingIncome / revenue) * 100 : 0;
          const nm = revenue > 0 ? (netIncome / revenue) * 100 : 0;
          const em = revenue > 0 ? (ebitda / revenue) * 100 : 0;
          const dte = totalEquity > 0 ? totalDebt / totalEquity : 0;
          const totalLiab = totalAssets - totalEquity;
          const fcfPS = sharesOutstanding > 0 ? fcfTTM / sharesOutstanding : 0;
          const capex = ebitda > 0 ? Math.abs(ebitda - operatingIncome - fcfTTM) : 0; // approximation
          const ocf = fcfTTM + capex;

          // Health assessment
          const healthReasons: string[] = [];
          let healthScore = 0;
          if (gm > 40) { healthScore += 2; healthReasons.push(`Hohe Bruttomarge (${gm.toFixed(1)}%) → Pricing Power`); }
          else if (gm > 20) { healthScore += 1; healthReasons.push(`Moderate Bruttomarge (${gm.toFixed(1)}%)`); }
          else { healthReasons.push(`Niedrige Bruttomarge (${gm.toFixed(1)}%) → Margendruck`); }

          if (fcfMargin > 20) { healthScore += 2; healthReasons.push(`Starke FCF-Marge (${fcfMargin.toFixed(1)}%) → Cash-Generierung`); }
          else if (fcfMargin > 10) { healthScore += 1; healthReasons.push(`Solide FCF-Marge (${fcfMargin.toFixed(1)}%)`); }
          else if (fcfMargin > 0) { healthReasons.push(`Schwache FCF-Marge (${fcfMargin.toFixed(1)}%)`); }
          else { healthScore -= 1; healthReasons.push(`Negativer FCF → Cash-Burn`); }

          if (dte < 0.5) { healthScore += 2; healthReasons.push(`Sehr niedrige Verschuldung (D/E ${dte.toFixed(2)})`); }
          else if (dte < 1.5) { healthScore += 1; healthReasons.push(`Moderate Verschuldung (D/E ${dte.toFixed(2)})`); }
          else if (dte < 3) { healthReasons.push(`Hohe Verschuldung (D/E ${dte.toFixed(2)}) → Zinsrisiko`); }
          else { healthScore -= 1; healthReasons.push(`Sehr hohe Verschuldung (D/E ${dte.toFixed(2)}) → Insolvenzrisiko`); }

          if (revenueGrowth > 15) { healthScore += 1; healthReasons.push(`Starkes Umsatzwachstum (${revenueGrowth.toFixed(1)}%)`); }
          else if (revenueGrowth < -5) { healthScore -= 1; healthReasons.push(`Rücklaufiger Umsatz (${revenueGrowth.toFixed(1)}%)`); }

          const health = healthScore >= 5 ? 'Excellent' as const : healthScore >= 3 ? 'Good' as const : healthScore >= 1 ? 'Moderate' as const : healthScore >= -1 ? 'Weak' as const : 'Critical' as const;

          return {
            incomeStatement: {
              revenue, revenueGrowth,
              grossProfit, grossMargin: gm,
              operatingIncome, operatingMargin: om,
              netIncome, netMargin: nm,
              ebitda, ebitdaMargin: em,
              eps, epsGrowth: epsGrowth5Y,
            },
            balanceSheet: {
              totalAssets, totalLiabilities: totalLiab, totalEquity,
              cashEquivalents, totalDebt, netDebt,
              debtToEquity: dte, currentRatio: cashEquivalents > 0 ? cashEquivalents / Math.max(totalDebt * 0.3, 1) : 0,
            },
            cashFlow: {
              operatingCashFlow: ocf, capex, fcf: fcfTTM,
              fcfMargin, fcfPerShare: fcfPS,
            },
            health,
            healthReasons,
          };
        })(),

        tamAnalysis,

        moatRating,
        governmentExposure: govExp.exposure,
        growthThesis,
        growthThesisFingerprint: thesisFingerprint,
        structuralTrends,
        keyProjects: keyProjects.length > 0 ? keyProjects : undefined,
        secFilingExcerpts: secFilingExcerpts.length > 0 ? secFilingExcerpts : undefined,
        newsHeadlines: newsHeadlines.length > 0 ? newsHeadlines.slice(0, 7) : undefined,
        newsItems: newsItems.length > 0 ? newsItems.slice(0, 10) : undefined,
        peerComparison: peerComparison ? {
          ...peerComparison,
          subject: {
            ...peerComparison.subject,
            pb: totalEquity > 0 ? +(marketCap / totalEquity).toFixed(1) : null,
            epsGrowth1Y: epsConsensusNextFY > 0 && eps > 0 ? +((epsConsensusNextFY / eps - 1) * 100).toFixed(1) : null,
          },
          sectorMedian: {
            pe: sectorDefs.sectorAvgPE,
            peg: sectorDefs.sectorAvgPEG,
            ps: sectorDefs.sectorAvgPS,
            pb: sectorDefs.sectorAvgPB,
            epsGrowth: sectorDefs.sectorEPSGrowth,
            sectorName: sector,
          },
        } : undefined,

        cycleClassification: sectorDefs.cycleClass,
        politicalCycle: sectorDefs.politicalCycle,

        sectorMaxDrawdown: sectorDefs.sectorMaxDrawdown,

        sectorProfile: {
          sector: sector,  // already corrected by getEffectiveSector()
          cycleClass: sectorDefs.cycleClass,
          politicalCycle: sectorDefs.politicalCycle,
          waccScenarios: sectorDefs.waccScenarios,
          growthAssumptions: sectorDefs.growthAssumptions,
          macroSensitivity: {
            interestUp: { wacc: "+0.5-1.0%", dcf: "-8 to -15%" },
            interestDown: { wacc: "-0.5-1.0%", dcf: "+8 to +15%" },
            fiscalUp: "+3-8% (stimulus benefit)",
            fiscalDown: "-3-8% (austerity drag)",
            geoUp: "+5-10% (trade resolution)",
            geoDown: "-5-15% (conflict escalation)",
          },
          regulatoryNotes: `${sector} sector regulatory environment – monitor policy changes`,
          geopoliticalRisks: generateGeopoliticalRisks(sector, industry),
        },

        catalysts,
        risks,

        govExposureDetail: govExp.detail,
        fcfHaircut,

        maxDrawdownHistory: `${maxDrawdown.toFixed(1)}%`,
        maxDrawdownYear,

        // OHLCV data (send all data — up to 10+ years for extended chart timeframes)
        ohlcvData: ohlcvData.length > 0 ? ohlcvData : undefined,
        technicalIndicators: technicals,

        // NEW: Porter's Five Forces & Moat
        moatAssessment,

        // NEW: Catalyst reasoning
        catalystReasoning,

        // NEW: Currency conversion info
        currencyInfo,

        // NEW: PESTEL analysis
        pestelAnalysis,

        // NEW: Macro correlations
        macroCorrelations,

        // NEW: Revenue segments (Produkte/Segmente)
        revenueSegments,
        // NEW: Geographic segments (Regionen)
        geoSegments,
        // LLM mode flag
        llmMode: useLLM,
        dataTimestamp: new Date().toISOString(),
      };

      // === Consistency Check ===
      const warnings: { id: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string }[] = [];

      // 1. EBIT vs EBITDA sanity
      if (operatingIncome > ebitda && operatingIncome > 0 && ebitda > 0) {
        warnings.push({ id: 'margin-impossible', severity: 'critical', title: 'EBIT > EBITDA', detail: `Operating Income ($${(operatingIncome/1e9).toFixed(1)}B) > EBITDA ($${(ebitda/1e9).toFixed(1)}B) — mathematisch unmöglich. Datenquelle prüfen.` });
      }

      // 2. Operating Margin sanity
      const opMarginCheck = revenue > 0 ? (operatingIncome / revenue) * 100 : 0;
      if (opMarginCheck > 70) {
        warnings.push({ id: 'margin-extreme', severity: 'warning', title: 'EBIT-Margin > 70%', detail: `EBIT-Margin ${opMarginCheck.toFixed(1)}% ist ungewöhnlich hoch. DCF-Fair-Value könnte überschätzt sein.` });
      }

      // 3. Negative FCF
      if (fcfTTM < 0) {
        warnings.push({ id: 'fcf-negative', severity: 'warning', title: 'Negativer Free Cash Flow', detail: `FCF TTM: $${(fcfTTM/1e6).toFixed(0)}M. DCF-Modell basiert auf positiven Cash Flows — Ergebnisse mit Vorsicht interpretieren.` });
      }

      // 4. P/E Extreme (too low may signal earnings peak for cyclicals)
      if (pe > 0 && pe < 5) {
        warnings.push({ id: 'pe-very-low', severity: 'info', title: 'P/E < 5 — möglicher Gewinnhöchststand', detail: `P/E ${pe.toFixed(1)} sehr niedrig. Bei Zyklikern kann das den Gewinnhöhepunkt signalisieren (Lynch-Regel).` });
      }
      if (pe > 100) {
        warnings.push({ id: 'pe-very-high', severity: 'info', title: 'P/E > 100', detail: `P/E ${pe.toFixed(1)} — hohe Wachstumserwartungen eingepreist. Bei Enttäuschung Rückschlagpotenzial.` });
      }

      // 5. Market Cap vs Revenue plausibility
      if (revenue > 0 && marketCap > 0) {
        const psRatio = marketCap / revenue;
        if (psRatio > 30) {
          warnings.push({ id: 'ps-extreme', severity: 'warning', title: `P/S ${psRatio.toFixed(1)} — extrem hoch`, detail: `Market Cap ($${(marketCap/1e9).toFixed(0)}B) / Revenue ($${(revenue/1e9).toFixed(0)}B) = ${psRatio.toFixed(1)}x. Nur gerechtfertigt bei extremem Wachstum.` });
        }
      }

      // 6. Shares outstanding plausibility
      if (sharesOutstanding > 0 && price > 0 && marketCap > 0) {
        const impliedPrice = marketCap / sharesOutstanding;
        if (Math.abs(impliedPrice - price) / price > 0.5) {
          warnings.push({ id: 'shares-mismatch', severity: 'critical', title: 'MarketCap / Shares ≠ Preis', detail: `Implied Price: $${impliedPrice.toFixed(2)} vs. Quoted: $${price.toFixed(2)} — Shares Outstanding oder Market Cap könnten falsch sein.` });
        }
      }

      // 7. No EPS data
      if (eps <= 0) {
        warnings.push({ id: 'eps-missing', severity: 'warning', title: 'Kein EPS verfügbar', detail: 'EPS ist 0 oder negativ. P/E, PEG und DCF-Growth-Berechnungen unzuverlässig.' });
      }

      // 8. Currency mismatch for non-US tickers
      if (ticker.includes('.DE') || ticker.includes('.L') || ticker.includes('.PA') || ticker.includes('.SW')) {
        if (currency === 'USD') {
          warnings.push({ id: 'currency-usd-for-eu', severity: 'info', title: 'EUR-Aktie in USD angezeigt', detail: `${ticker} wird in USD gehandelt (ADR) oder API liefert USD-Daten. Alle Werte in USD.` });
        }
      }

      // 9. Beta extreme
      if (beta5Y > 2.5) {
        warnings.push({ id: 'beta-extreme', severity: 'info', title: `Beta ${beta5Y.toFixed(2)} — sehr volatil`, detail: `Hohe Beta erhöht WACC und drückt DCF-Fair-Value. Monte Carlo Downside-Wahrscheinlichkeit erhöht.` });
      }

      analysis.consistencyWarnings = warnings.length > 0 ? warnings : undefined;
      if (warnings.length > 0) {
        console.log(`[ANALYZE] Consistency warnings for ${ticker}: ${warnings.map(w => w.id).join(', ')}`);
      }

      console.log(`[ANALYZE] Completed analysis for ${ticker}: $${price} (${companyName})`);
      // Save to cache on success — tag with the LLM mode that ACTUALLY succeeded,
      // not just what the user requested. If useLLM=true but LLM failed and we
      // fell back to sector templates, _useLLM is saved as false. That way a
      // future KI-on request will not pick up this cache via cache-first — it'll
      // re-try the LLM path with fresh data.
      (analysis as any)._useLLM = llmActuallyUsed;
      (analysis as any).llmMode = llmActuallyUsed; // also reflected in client-visible field
      (analysis as any)._cachedAt = new Date().toISOString();
      saveCachedAnalysis(ticker, analysis);
      // Auto-add to watchlist
      try {
        let wl: any = { tickers: [] };
        if (fs.existsSync(path.join(CACHE_DIR, 'watchlist.json'))) {
          wl = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'watchlist.json'), 'utf-8'));
        }
        const existing = wl.tickers.findIndex((t: any) => t.ticker === ticker);
        if (existing >= 0) wl.tickers.splice(existing, 1); // move to top
        wl.tickers.unshift({ ticker, addedAt: new Date().toISOString(), lastPrice: price, companyName });
        wl.tickers = wl.tickers.slice(0, 20);
        fs.writeFileSync(path.join(CACHE_DIR, 'watchlist.json'), JSON.stringify(wl));
      } catch {}
      if (!proxyResponded) {
        proxyResponded = true;
        incrementQuota(); // Count this as one successful Finance analysis
        res.json(analysis);
      }
    } catch (error: any) {
      console.error("[ANALYZE] Error:", error?.message);
      // Try to serve cached data as fallback — prefer compatible LLM mode.
      const useLLMCatch = (req.body?.useLLM === true);
      const cached = getCachedAnalysis(ticker);
      if (cached && cacheLLMModeMatches(cached._useLLM, useLLMCatch)) {
        console.log(`[ANALYZE] Serving compatible cached data for ${ticker} (age: ${cached._cacheAge}min)`);
        if (!proxyResponded) { proxyResponded = true; return res.json(cached); }
        return;
      }
      if (!proxyResponded) {
        proxyResponded = true;
        res.status(500).json({ error: error?.message || "Analysis failed" });
      }
    }
  });


  // ============================================================
  // Risk Deep-Dive Explanations Endpoint (on-demand, Section 8)
  // ============================================================
  // Analog zu den Katalysatoren: ein einzelner Grok-Aufruf generiert
  // strukturierte, unternehmensspezifische Erklaerungen fuer jedes Risiko.
  // Kein separates Search-Feature — nur Grok mit Unternehmenskontext.
  // /api/refresh-risks — generate company-specific risks without Finance API
  app.post("/api/refresh-risks", async (req, res) => {
    const { ticker, companyName, description, sector, industry, revenue,
      revenueGrowth, fcfMargin, forwardPE, beta, governmentExposure,
      catalysts, newsItems } = req.body || {};
    if (!ticker || !description || !(catalysts?.length > 0))
      return res.json({ risks: null, reason: "insufficient_data" });
    try {
      const refreshCats = (catalysts || [])
        .filter((c: any) => !c.tags?.includes("capex-tailwind")).slice(0, 2);
      const newRisks = await generateCompanySpecificRisks({
        ticker: String(ticker),
        companyName: String(companyName || ticker),
        description: String(description || ""),
        sector: String(sector || "Technology"),
        industry: String(industry || ""),
        revenue: Number(revenue) || 0,
        revenueGrowth: Number(revenueGrowth) || 0,
        fcfMargin: Number(fcfMargin) || 0,
        grossMargin: 0,
        forwardPE: Number(forwardPE) || 0,
        beta: Number(beta) || 1.1,
        governmentExposure: Number(governmentExposure) || 0,
        topCatalysts: refreshCats.map((c: any) => ({ name: c.name, context: c.context || "" })),
        capexContext: null,
        recentNewsHeadlines: (newsItems || []).slice(0, 4).map((n: any) => n.title || ""),
      });
      if (!newRisks || newRisks.length < 3)
        return res.json({ risks: null, reason: "llm_unavailable" });
      const freshRisks = newRisks.map(r => ({ ...r, expectedDamage: 0 }));
      // Persist to cache
      const existing = diskCacheGet ? diskCacheGet(String(ticker).toUpperCase()) : null;
      if (existing && diskCacheSet) diskCacheSet(String(ticker).toUpperCase(), { ...existing, risks: freshRisks });
      console.log(`[REFRESH-RISKS] ${ticker}: ${freshRisks.map(r => r.name).join(" | ")}`);
      return res.json({ risks: freshRisks, ticker });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message });
    }
  });

  app.post("/api/risk-explanations", async (req, res) => {
    try {
      const { ticker, companyName, sector, industry, description,
              revenue, revenueGrowth, fcfMargin, price, pe, marketCap,
              governmentExposure, risks } = req.body;

      if (!ticker || !Array.isArray(risks) || risks.length === 0) {
        return res.status(400).json({ error: "ticker and risks array required" });
      }

      const sectorStr = String(sector || "");
      const industryStr = String(industry || "");
      const companyStr = String(companyName || ticker);
      const rawDesc = String(description || "");
      const safeDesc = (rawDesc.trim() && rawDesc.length > 30)
        ? rawDesc
        : `${companyStr} ist ein Unternehmen aus dem ${sectorStr || 'Technology'}-Sektor (${industryStr || 'General'}).`;
      const enrichedRisks = await generateRiskExplanations({
        ticker: String(ticker),
        companyName: companyStr,
        sector: sectorStr,
        industry: industryStr,
        description: safeDesc,
        revenue: Number(revenue) || 0,
        revenueGrowth: Number(revenueGrowth) || 0,
        fcfMargin: Number(fcfMargin) || 0,
        price: Number(price) || 0,
        pe: Number(pe) || 0,
        marketCap: Number(marketCap) || 0,
        governmentExposure: Number(governmentExposure) || 0,
        risks: risks as any[],
      });

      if (!enrichedRisks) {
        return res.json({ risks: risks, _llmSkipped: true });
      }

      return res.json({ risks: enrichedRisks });
    } catch (err: any) {
      console.error(`[RISK-EXPLANATIONS] ${err?.message || String(err)}`);
      return res.json({ risks: req.body?.risks || [], _llmSkipped: true });
    }
  });

  // ============================================================
  // Catalyst Enrichment Endpoint (Section 15 — manual KI trigger)
  // ============================================================
  // Re-runs only the LLM catalyst generation + deep-dives using cached
  // analysis data. Lets users trigger company-specific catalysts on demand
  // when initial analysis used sector templates (LLM off or failed).
  app.post("/api/catalyst-enrich", async (req, res) => {
    const { ticker, useLLM = true, force = true } = req.body || {};
    if (!ticker) return res.status(400).json({ error: "ticker required" });
    void useLLM; void force;

    try {
      const cached = getCachedAnalysis(ticker);
      if (!cached) {
        return res.status(404).json({
          error: "No cached analysis for " + ticker + " — run a full analysis first",
        });
      }

      const revenueGrowthVal = Number(
        cached.financialStatements?.incomeStatement?.revenueGrowth ?? 0
      ) || 0;
      const analystPTMedian = Number(cached.analystPT?.median ?? 0) || 0;

      const newsItemsArr = Array.isArray(cached.newsItems) ? cached.newsItems : [];

      // === Capex Fiscal Tailwind Lookup ===
      // Check if this ticker appears in any Researcher Capex sectorExposure.listedBeneficiaries
      // across US, EU, ASIA regions. If found, pass tailwind context to LLM.
      let capexContext: CapexTailwindContext | null = null;
      try {
        const CAPEX_REGIONS = ["US", "EU", "ASIA"];
        outer: for (const region of CAPEX_REGIONS) {
          const capexData = diskResearcherGet(`capex__${region}`);
          if (!capexData?.sectorExposure) continue;
          for (const sectorEntry of capexData.sectorExposure as any[]) {
            const beneficiaries: any[] = sectorEntry.listedBeneficiaries || [];
            const match = beneficiaries.find(
              (b: any) => String(b.ticker || "").toUpperCase() === String(ticker).toUpperCase()
            );
            if (match) {
              capexContext = {
                sector: sectorEntry.sector || "",
                impact: sectorEntry.impact || "positiv",
                timeline: sectorEntry.timeline || "12-24M",
                reasoning: sectorEntry.reasoning || "",
                programmes: Array.isArray(sectorEntry.programmes) ? sectorEntry.programmes : [],
                beneficiaryEntry: { ticker: match.ticker, name: match.name, rationale: match.rationale || "" },
              };
              console.log(`[CATALYST-ENRICH] ${ticker} found as Capex beneficiary in ${region}/${sectorEntry.sector}`);
              break outer;
            }
          }
        }
      } catch (capexErr: any) {
        console.warn(`[CATALYST-ENRICH] capex lookup error: ${capexErr?.message}`);
      }

      const catalystInput = {
        ticker: String(ticker),
        companyName: String(cached.companyName || ticker),
        sector: String(cached.sector || "Technology"),
        industry: String(cached.industry || "General"),
        description: String(cached.description || ""),
        revenue: Number(cached.revenue) || 0,
        revenueGrowth: revenueGrowthVal,
        fcfMargin: Number(cached.fcfMargin) || 0,
        price: Number(cached.currentPrice) || 0,
        pe: Number(cached.peRatio) || 0,
        marketCap: Number(cached.marketCap) || 0,
        analystPTMedian,         // pass through for richer prompt
        governmentExposure: Number(cached.governmentExposure) || 0,
        capexContext,             // fiscal spending tailwind (null if ticker not in Researcher capex cache)
        keyProjects: Array.isArray(cached.keyProjects) ? cached.keyProjects : [],
        secFilingExcerpts: Array.isArray(cached.secFilingExcerpts) ? cached.secFilingExcerpts : [],
        newsItems: newsItemsArr,
      };

      // Fire catalyst call first, then deep-dives in parallel once we have catalyst names
      // Two sequential 30s calls = 60s+ timeout. Solution: run cats first (needed for deep-dive
      // input), then deep-dives immediately after without awaiting cache write.
      const t0 = Date.now();
      const result = await generateCatalystsAndMatchNews(catalystInput);

      if (!result) {
        return res.json({ catalysts: cached.catalysts || [], _llmSkipped: true });
      }

      // Start deep-dive call immediately after catalysts arrive (don't wait for it to finish
      // before sending — we merge and respond as soon as both are ready)
      const deepDivePromise = generateCatalystDeepDives({
        ticker: String(ticker),
        companyName: String(cached.companyName || ticker),
        sector: String(cached.sector || "Technology"),
        description: String(cached.description || ""),
        revenue: Number(cached.revenue) || 0,
        revenueGrowth: revenueGrowthVal,
        fcfMargin: Number(cached.fcfMargin) || 0,
        price: Number(cached.currentPrice) || 0,
        analystPT: analystPTMedian,
        catalysts: result.catalysts.map((c: any) => ({
          name: c.name, pos: c.pos,
          bruttoUpside: c.bruttoUpside,
          einpreisungsgrad: c.einpreisungsgrad,
          context: c.context,
        })),
        newsHeadlines: newsItemsArr.slice(0, 4).map((n: any) => n.title || n.headline || ""),
      }).catch((e: any) => { console.warn(`[CATALYST-ENRICH] deep-dive failed: ${e?.message?.substring(0,100)}`); return null; });

      // Wait for deep-dives but cap at 35s so total stays well under 90s
      const remainingMs = Math.max(5000, 70_000 - (Date.now() - t0));
      const deepDives = await Promise.race([
        deepDivePromise,
        new Promise<null>(r => setTimeout(() => r(null), remainingMs)),
      ]);

      let enrichedCatalysts: any[] = result.catalysts;
      if (deepDives && (deepDives as any[]).length > 0) {
        enrichedCatalysts = result.catalysts.map((cat: any, i: number) => {
          const dd = (deepDives as any[]).find((d: any) => d.idx === i) ||
                     (deepDives as any[])[i];
          return dd ? { ...cat, deepDive: dd.deepDive ?? dd } : cat;
        });
      }

      // Re-inject Capex Tailwind catalyst after LLM (LLM replaces all catalysts, losing the capex tag)
      // Look up capex cache again and prepend if not already present
      if (!enrichedCatalysts.some((c: any) => c.tags?.includes("capex-tailwind"))) {
        try {
          const CAPEX_REGIONS = ["US", "EU", "ASIA"];
          outerCapexEnrich: for (const region of CAPEX_REGIONS) {
            const capexData = diskResearcherGet(`capex__${region}`);
            if (!capexData?.sectorExposure) continue;
            for (const sectorEntry of (capexData.sectorExposure as any[])) {
              const match = (sectorEntry.listedBeneficiaries || []).find(
                (b: any) => String(b.ticker || "").toUpperCase() === String(ticker).toUpperCase()
              );
              if (match) {
                const progNames = (Array.isArray(sectorEntry.programmes) ? sectorEntry.programmes : []).slice(0, 2).join(" & ") || sectorEntry.sector;
                const capexPos = sectorEntry.impact === "positiv" ? 68 : sectorEntry.impact === "neutral" ? 50 : 35;
                const capexCat = {
                  name: `Capex Tailwind: ${sectorEntry.sector || ""}`,
                  timeline: sectorEntry.timeline || "12-24M",
                  pos: capexPos,
                  bruttoUpside: sectorEntry.impact === "positiv" ? 18 : 8,
                  einpreisungsgrad: sectorEntry.impact === "positiv" ? 45 : 55,
                  nettoUpside: 0, gb: 0,
                  context: `${match.rationale || match.name || ""} Programme: ${progNames} (${sectorEntry.timeline || "12-24M"}, Impact: ${sectorEntry.impact || "positiv"}). ${(sectorEntry.reasoning || "").slice(0, 180)}`,
                  tags: ["gov-spending", "capex-tailwind"],
                };
                enrichedCatalysts = [capexCat, ...enrichedCatalysts];
                console.log(`[CATALYST-ENRICH] Re-injected Capex Tailwind for ${ticker}: ${sectorEntry.sector}`);
                break outerCapexEnrich;
              }
            }
          }
        } catch (_) {}
      }

      try {
        const updated = { ...cached, catalysts: enrichedCatalysts };
        delete updated._cached;
        delete updated._cacheAge;
        delete updated._cacheDate;
        (updated as any)._useLLM = true;
        (updated as any).llmMode = true;
        saveCachedAnalysis(String(ticker), updated);
      } catch {}

      return res.json({ catalysts: enrichedCatalysts, modelUsed: result.modelUsed });
    } catch (err: any) {
      console.error(`[CATALYST-ENRICH] ${err?.message || String(err)}`);
      return res.status(500).json({ error: err?.message || String(err) });
    }
  });

  // ============================================================
  // BTC Analysis Endpoint
  // ============================================================
  app.post("/api/analyze-btc", async (_req, res) => {
    try {
      console.log("[BTC] Starting BTC analysis...");

      // --- Box-Muller normal random ---
      function normalRandom(): number {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
      }

      // === 1. Fetch BTC price from CoinGecko ===
      let btcPrice = 0, btcChange24h = 0, btcMarketCap = 0;
      try {
        const cgRaw = execSync(
          `curl -sL "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true"`,
          { encoding: "utf-8", timeout: 30000 }
        );
        const cg = JSON.parse(cgRaw);
        btcPrice = cg?.bitcoin?.usd ?? 0;
        btcChange24h = cg?.bitcoin?.usd_24h_change ?? 0;
        btcMarketCap = cg?.bitcoin?.usd_market_cap ?? 0;
        console.log(`[BTC] Price: $${btcPrice}, 24h: ${btcChange24h.toFixed(2)}%`);
      } catch (e: any) {
        console.error("[BTC] CoinGecko error:", e?.message?.substring(0, 200));
      }

      // Layer 5 fix: btcPrice=0 makes all downstream calculations worthless.
      // Return a clear error instead of serving a broken analysis.
      if (!btcPrice || btcPrice <= 0) {
        return res.status(503).json({
          error: "BTC-Preis konnte nicht abgerufen werden (CoinGecko nicht verf\u00fcgbar oder Rate-Limit). Bitte in 1\u20132 Minuten erneut versuchen.",
          errorCode: "BTC_PRICE_UNAVAILABLE",
        });
      }

      // === 2. Fear & Greed Index ===
      let fearGreedIndex = 50, fearGreedLabel = "Neutral";
      try {
        const fngRaw = execSync(
          `curl -sL "https://api.alternative.me/fng/?limit=1"`,
          { encoding: "utf-8", timeout: 30000 }
        );
        const fng = JSON.parse(fngRaw);
        fearGreedIndex = parseInt(fng?.data?.[0]?.value ?? "50", 10);
        fearGreedLabel = fng?.data?.[0]?.value_classification ?? "Neutral";
        console.log(`[BTC] Fear & Greed: ${fearGreedIndex} (${fearGreedLabel})`);
      } catch (e: any) {
        console.error("[BTC] F&G error:", e?.message?.substring(0, 200));
      }

      // === 3. Fetch DXY ===
      let dxy = 103;
      try {
        const dxyResult = callFinanceTool("get_stock_price", { symbol: "DX-Y.NYB" });
        if (dxyResult) {
          const dxyStr = typeof dxyResult === "string" ? dxyResult : JSON.stringify(dxyResult);
          const dxyMatch = dxyStr.match(/([\d]+\.[\d]+)/);
          if (dxyMatch) dxy = parseFloat(dxyMatch[1]);
        }
        console.log(`[BTC] DXY: ${dxy}`);
      } catch (e: any) {
        console.error("[BTC] DXY error:", e?.message?.substring(0, 200));
      }

      // === 4. Fetch Fed Funds Rate ===
      let fedFundsRate = 5.33;
      try {
        const fredRaw = execSync(
          `curl -sL "https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS&cosd=2024-01-01"`,
          { encoding: "utf-8", timeout: 30000 }
        );
        const fredLines = fredRaw.trim().split("\n");
        if (fredLines.length >= 2) {
          const lastLine = fredLines[fredLines.length - 1];
          const parts = lastLine.split(",");
          if (parts.length >= 2) {
            const val = parseFloat(parts[1]);
            if (!isNaN(val)) fedFundsRate = val;
          }
        }
        console.log(`[BTC] Fed Funds Rate: ${fedFundsRate}%`);
      } catch (e: any) {
        console.error("[BTC] Fed Funds error:", e?.message?.substring(0, 200));
      }

      // === 5. Halving info ===
      const lastHalvingDate = new Date("2024-04-20");
      const now = new Date();
      const monthsSinceHalving = Math.round(
        (now.getTime() - lastHalvingDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
      );
      const cyclePhase = `Mid-Cycle (${monthsSinceHalving}M post-Halving)`;
      console.log(`[BTC] Months since halving: ${monthsSinceHalving}`);

      // === 6. Power-Law calculations ===
      const genesisDate = new Date("2009-01-03");
      const daysSinceGenesis = Math.floor(
        (now.getTime() - genesisDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      const fairValue = 1.0117e-17 * Math.pow(daysSinceGenesis, 5.82);
      const support = fairValue * 0.4;
      const resistance = fairValue * 2.5;
      const deviationPercent = ((btcPrice - fairValue) / fairValue) * 100;
      const daysSixMonths = daysSinceGenesis + 180;
      const fairValue6M = 1.0117e-17 * Math.pow(daysSixMonths, 5.82);

      // Power signal
      let powerSignal: number;
      if (btcPrice > resistance) powerSignal = -1.0;
      else if (btcPrice >= fairValue) powerSignal = 0.0;
      else if (btcPrice >= support) powerSignal = 0.5;
      else powerSignal = 1.0;

      console.log(`[BTC] Power-Law: fair=$${fairValue.toFixed(0)}, dev=${deviationPercent.toFixed(1)}%, signal=${powerSignal}`);

      // === 7. Indicator Scoring ===
      // F&G score
      let fgScore = 0;
      if (fearGreedIndex < 30) fgScore = 1;
      else if (fearGreedIndex > 70) fgScore = -1;

      // Macro score (based on fed funds rate + M2 default)
      let macroScore = 0;
      if (fedFundsRate > 5.0) macroScore = -1;
      else if (fedFundsRate < 3.0) macroScore = 1;

      // DXY score
      let dxyScore = 0;
      if (dxy < 100) dxyScore = 1;
      else if (dxy > 105) dxyScore = -1;

      const indicators = [
        { name: "MVRV Z-Score", value: "N/A (default)", score: 0, weight: 0.20, source: "Default (neutral)" },
        { name: "RSI (Weekly)", value: "N/A (default)", score: 0, weight: 0.15, source: "Default (neutral)" },
        { name: "Fear & Greed", value: `${fearGreedIndex} (${fearGreedLabel})`, score: fgScore, weight: 0.10, source: "alternative.me" },
        { name: "Hashrate Trend", value: "Stable", score: 1, weight: 0.10, source: "Default (stable growth)" },
        { name: "ETF Net Flows", value: "N/A (default)", score: 0, weight: 0.15, source: "Default (neutral)" },
        { name: "Macro (Fed/M2)", value: `FFR ${fedFundsRate}%`, score: macroScore, weight: 0.15, source: "FRED" },
        { name: "DXY", value: `${dxy.toFixed(2)}`, score: dxyScore, weight: 0.15, source: "Yahoo Finance" },
      ].map(ind => ({ ...ind, weighted: ind.score * ind.weight }));

      const gis = indicators.reduce((sum, ind) => sum + ind.weighted, 0);
      const gisCalculation = indicators
        .map(ind => `${ind.name}: ${ind.score} × ${ind.weight} = ${ind.weighted.toFixed(4)}`)
        .join(" + ") + ` = ${gis.toFixed(4)}`;

      console.log(`[BTC] GIS: ${gis.toFixed(4)}`);

      // === 9. Cycle Signal ===
      let cycleSignal: number;
      if (monthsSinceHalving > 24) cycleSignal = -0.5;
      else if (monthsSinceHalving >= 18) cycleSignal = -0.3;
      else if (monthsSinceHalving >= 12) cycleSignal = 0.0;
      else if (monthsSinceHalving >= 6) cycleSignal = 0.3;
      else cycleSignal = 0.5;

      // === 10. GWS ===
      const gwsValue = gis * 0.30 + powerSignal * 0.50 + cycleSignal * 0.20;

      // === 11. μ mapping ===
      let mu: number;
      if (gwsValue > 0.5) mu = 0.0010;
      else if (gwsValue >= 0.2) mu = 0.0005;
      else if (gwsValue >= -0.2) mu = 0.0;
      else if (gwsValue >= -0.5) mu = -0.0005;
      else mu = -0.0010;

      let gwsInterpretation: string;
      if (gwsValue > 0.3) gwsInterpretation = "Bullish – favorable macro, cycle, and valuation signals";
      else if (gwsValue > 0) gwsInterpretation = "Slightly Bullish – mixed signals with positive tilt";
      else if (gwsValue > -0.3) gwsInterpretation = "Neutral to Slightly Bearish – caution warranted";
      else gwsInterpretation = "Bearish – unfavorable conditions across indicators";

      console.log(`[BTC] GWS: ${gwsValue.toFixed(4)}, μ: ${mu}, interpretation: ${gwsInterpretation}`);

      // === 12. Monte Carlo ===
      const sigma = 0.025;
      const sigmaAdj = sigma * (monthsSinceHalving > 18 ? 1.2 : 1.0);
      const S0 = btcPrice;

      function runMonteCarlo(T: number) {
        const results: number[] = [];
        const iterations = 10000;
        for (let i = 0; i < iterations; i++) {
          const Z = normalRandom();
          const ST = S0 * Math.exp((mu - (sigmaAdj * sigmaAdj) / 2) * T + sigmaAdj * Math.sqrt(T) * Z);
          results.push(ST);
        }
        results.sort((a, b) => a - b);
        const p10 = results[Math.floor(iterations * 0.10)];
        const p50 = results[Math.floor(iterations * 0.50)];
        const p90 = results[Math.floor(iterations * 0.90)];
        const mean = results.reduce((s, v) => s + v, 0) / iterations;
        const probBelow = (results.filter(v => v < S0).length / iterations) * 100;
        const probAbove120 = (results.filter(v => v > S0 * 1.2).length / iterations) * 100;
        return { p10, p50, p90, mean, probBelow, probAbove120 };
      }

      const mc3M = runMonteCarlo(90);
      const mc6M = runMonteCarlo(180);
      console.log(`[BTC] MC 3M: P10=$${mc3M.p10.toFixed(0)}, P50=$${mc3M.p50.toFixed(0)}, P90=$${mc3M.p90.toFixed(0)}`);

      // === 13. Categories A-E (3M) ===
      function computeCategories() {
        const iterations = 10000;
        const results: number[] = [];
        for (let i = 0; i < iterations; i++) {
          const Z = normalRandom();
          const ST = S0 * Math.exp((mu - (sigmaAdj * sigmaAdj) / 2) * 90 + sigmaAdj * Math.sqrt(90) * Z);
          results.push(ST);
        }
        let catA = (results.filter(v => v > S0 * 1.30).length / iterations) * 100;
        let catB = (results.filter(v => v > S0 * 1.10 && v <= S0 * 1.30).length / iterations) * 100;
        let catC = (results.filter(v => v >= S0 * 0.90 && v <= S0 * 1.10).length / iterations) * 100;
        let catD = (results.filter(v => v >= S0 * 0.70 && v < S0 * 0.90).length / iterations) * 100;
        let catE = (results.filter(v => v < S0 * 0.70).length / iterations) * 100;

        // Late-cycle adjustment
        if (monthsSinceHalving > 18) {
          const diff = catE * 0.22;
          catE = catE * 0.78;
          catB = catB + diff;
        }

        return [
          { label: "A", range: `> $${(S0 * 1.30).toLocaleString("en-US", { maximumFractionDigits: 0 })} (>+30%)`, probability: Math.round(catA * 10) / 10 },
          { label: "B", range: `$${(S0 * 1.10).toLocaleString("en-US", { maximumFractionDigits: 0 })} – $${(S0 * 1.30).toLocaleString("en-US", { maximumFractionDigits: 0 })} (+10% to +30%)`, probability: Math.round(catB * 10) / 10 },
          { label: "C", range: `$${(S0 * 0.90).toLocaleString("en-US", { maximumFractionDigits: 0 })} – $${(S0 * 1.10).toLocaleString("en-US", { maximumFractionDigits: 0 })} (±10%)`, probability: Math.round(catC * 10) / 10 },
          { label: "D", range: `$${(S0 * 0.70).toLocaleString("en-US", { maximumFractionDigits: 0 })} – $${(S0 * 0.90).toLocaleString("en-US", { maximumFractionDigits: 0 })} (-10% to -30%)`, probability: Math.round(catD * 10) / 10 },
          { label: "E", range: `< $${(S0 * 0.70).toLocaleString("en-US", { maximumFractionDigits: 0 })} (>-30%)`, probability: Math.round(catE * 10) / 10 },
        ];
      }

      const categories = computeCategories();

      // === 14. Extended Historical Prices (1Y, 3Y, 5Y, 10Y) ===
      let allPriceData: { date: string; price: number }[] = [];

      // Helper to fetch CoinGecko range and deduplicate
      function fetchCGRange(fromSec: number, toSec: number): { date: string; price: number }[] {
        try {
          const raw = execSync(
            `curl -sL "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=${fromSec}&to=${toSec}"`,
            { encoding: "utf-8", timeout: 60000, maxBuffer: 50 * 1024 * 1024 }
          );
          const parsed = JSON.parse(raw);
          if (parsed?.prices && Array.isArray(parsed.prices)) {
            const dayMap = new Map<string, number>();
            for (const p of parsed.prices as [number, number][]) {
              const d = new Date(p[0]).toISOString().split("T")[0];
              dayMap.set(d, p[1]);
            }
            return Array.from(dayMap.entries()).map(([date, price]) => ({ date, price }));
          }
        } catch (e: any) {
          console.error("[BTC] CoinGecko range error:", e?.message?.substring(0, 200));
        }
        return [];
      }

      // Fetch in chunks to avoid rate limits: 5Y (CoinGecko range gives daily for >90d)
      const nowSec = Math.floor(Date.now() / 1000);
      // Try 5Y first, then 1Y fallback
      const fiveYearsAgo = nowSec - 5 * 365 * 86400;
      allPriceData = fetchCGRange(fiveYearsAgo, nowSec);
      console.log(`[BTC] CoinGecko 5Y: ${allPriceData.length} data points`);

      // If 5Y failed (rate limited), try just 1Y after a delay
      if (allPriceData.length === 0) {
        await new Promise(r => setTimeout(r, 2000)); // non-blocking rate-limit backoff
        const oneYearAgo = nowSec - 365 * 86400;
        allPriceData = fetchCGRange(oneYearAgo, nowSec);
        console.log(`[BTC] CoinGecko 1Y fallback: ${allPriceData.length} data points`);
      }

      // If still empty, try finance tool
      if (allPriceData.length === 0) {
        try {
          const chart5Y = callFinanceTool("get_stock_chart", { symbol: "BTC-USD", range: "5y", interval: "1d" });
          if (chart5Y) {
            const chartStr = typeof chart5Y === "string" ? chart5Y : JSON.stringify(chart5Y);
            const rows = parseMarkdownTable(chartStr);
            if (rows.length > 0) {
              allPriceData = rows.map(r => ({
                date: r["Date"] || r["date"] || "",
                price: parseNumber(r["Close"] || r["close"] || r["Price"] || r["price"] || "0"),
              })).filter(r => r.date && r.price > 0);
            }
          }
          console.log(`[BTC] Finance fallback: ${allPriceData.length} data points`);
        } catch (e: any) {
          console.error("[BTC] Finance chart error:", e?.message?.substring(0, 200));
        }
      }

      // Sort by date
      allPriceData.sort((a, b) => a.date.localeCompare(b.date));

      // Slice into timeframes
      function filterByYears(data: typeof allPriceData, years: number) {
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - years);
        const cutoffStr = cutoff.toISOString().split("T")[0];
        return data.filter(d => d.date >= cutoffStr);
      }
      const prices1Y = filterByYears(allPriceData, 1);
      const prices3Y = filterByYears(allPriceData, 3);
      const prices5Y = filterByYears(allPriceData, 5);
      const prices10Y = filterByYears(allPriceData, 10);

      // === 15. Calculate MA50, MA200, EMA12, EMA26 on allPriceData ===
      function calcSMA(data: number[], period: number): (number | null)[] {
        const result: (number | null)[] = [];
        for (let i = 0; i < data.length; i++) {
          if (i < period - 1) { result.push(null); continue; }
          let sum = 0;
          for (let j = i - period + 1; j <= i; j++) sum += data[j];
          result.push(sum / period);
        }
        return result;
      }

      function calcEMA(data: number[], period: number): (number | null)[] {
        const result: (number | null)[] = [];
        const k = 2 / (period + 1);
        let ema: number | null = null;
        for (let i = 0; i < data.length; i++) {
          if (i < period - 1) { result.push(null); continue; }
          if (ema === null) {
            // Initial EMA = SMA
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) sum += data[j];
            ema = sum / period;
          } else {
            ema = data[i] * k + ema * (1 - k);
          }
          result.push(ema);
        }
        return result;
      }

      const closePrices = allPriceData.map(d => d.price);
      const ma50 = calcSMA(closePrices, 50);
      const ma200 = calcSMA(closePrices, 200);
      const ema12 = calcEMA(closePrices, 12);
      const ema26 = calcEMA(closePrices, 26);

      // MACD = EMA12 - EMA26
      const macdLine: (number | null)[] = ema12.map((e12, i) => {
        const e26 = ema26[i];
        if (e12 === null || e26 === null) return null;
        return e12 - e26;
      });

      // Signal line = EMA9 of MACD
      const macdValues = macdLine.filter(v => v !== null) as number[];
      const signalRaw = calcEMA(macdValues, 9);
      // Map signal back to full array indices
      let signalIdx = 0;
      const signalLine: (number | null)[] = macdLine.map(v => {
        if (v === null) return null;
        const s = signalRaw[signalIdx++];
        return s;
      });

      // Histogram
      const histogram: (number | null)[] = macdLine.map((m, i) => {
        const s = signalLine[i];
        if (m === null || s === null) return null;
        return m - s;
      });

      // Build technical chart data array
      const technicalChartData = allPriceData.map((d, i) => ({
        date: d.date,
        price: d.price,
        ma50: ma50[i],
        ma200: ma200[i],
        macd: macdLine[i],
        signal: signalLine[i],
        histogram: histogram[i],
      }));

      // === 16. Signal Detection ===
      interface TechSignal {
        date: string;
        type: "BUY" | "SELL";
        reason: string;
        price: number;
      }
      const signals: TechSignal[] = [];

      for (let i = 1; i < technicalChartData.length; i++) {
        const prev = technicalChartData[i - 1];
        const curr = technicalChartData[i];

        // Golden Cross: MA50 crosses above MA200
        if (prev.ma50 !== null && prev.ma200 !== null && curr.ma50 !== null && curr.ma200 !== null) {
          if (prev.ma50 <= prev.ma200 && curr.ma50 > curr.ma200) {
            signals.push({ date: curr.date, type: "BUY", reason: "Golden Cross (MA50 > MA200)", price: curr.price });
          }
          // Death Cross: MA50 crosses below MA200
          if (prev.ma50 >= prev.ma200 && curr.ma50 < curr.ma200) {
            signals.push({ date: curr.date, type: "SELL", reason: "Death Cross (MA50 < MA200)", price: curr.price });
          }
        }

        // MACD Bullish Crossover: MACD crosses above Signal
        if (prev.macd !== null && prev.signal !== null && curr.macd !== null && curr.signal !== null) {
          if (prev.macd <= prev.signal && curr.macd > curr.signal) {
            signals.push({ date: curr.date, type: "BUY", reason: "MACD Bullish Crossover", price: curr.price });
          }
          // MACD Bearish Crossover: MACD crosses below Signal
          if (prev.macd >= prev.signal && curr.macd < curr.signal) {
            signals.push({ date: curr.date, type: "SELL", reason: "MACD Bearish Crossover", price: curr.price });
          }
        }

        // MACD crosses zero line
        if (prev.macd !== null && curr.macd !== null) {
          if (prev.macd <= 0 && curr.macd > 0) {
            signals.push({ date: curr.date, type: "BUY", reason: "MACD über Nulllinie", price: curr.price });
          }
          if (prev.macd >= 0 && curr.macd < 0) {
            signals.push({ date: curr.date, type: "SELL", reason: "MACD unter Nulllinie", price: curr.price });
          }
        }
      }

      // Current technical status (guard against empty data)
      const lastTech = technicalChartData.length > 0 ? technicalChartData[technicalChartData.length - 1] : null;
      const bullConditions = {
        priceAboveMA200: lastTech && lastTech.ma200 !== null ? lastTech.price > (lastTech.ma200 ?? 0) : false,
        ma50AboveMA200: lastTech && lastTech.ma50 !== null && lastTech.ma200 !== null ? (lastTech.ma50 ?? 0) > (lastTech.ma200 ?? 0) : false,
        macdAboveZero: lastTech && lastTech.macd !== null ? (lastTech.macd ?? 0) > 0 : false,
        macdAboveSignal: lastTech && lastTech.macd !== null && lastTech.signal !== null ? (lastTech.macd ?? 0) > (lastTech.signal ?? 0) : false,
      };
      const isBull = bullConditions.priceAboveMA200 && bullConditions.ma50AboveMA200 && bullConditions.macdAboveZero && bullConditions.macdAboveSignal;

      // === 17. Fear & Greed Historical ===
      let fearGreedHistory: { date: string; value: number; classification: string }[] = [];
      try {
        // Get 365 days of F&G history
        const fngHistRaw = execSync(
          `curl -sL "https://api.alternative.me/fng/?limit=365&format=json"`,
          { encoding: "utf-8", timeout: 30000 }
        );
        const fngHist = JSON.parse(fngHistRaw);
        if (fngHist?.data && Array.isArray(fngHist.data)) {
          fearGreedHistory = fngHist.data.map((d: any) => ({
            date: new Date(parseInt(d.timestamp) * 1000).toISOString().split("T")[0],
            value: parseInt(d.value),
            classification: d.value_classification,
          })).reverse(); // oldest first
        }
        console.log(`[BTC] F&G History: ${fearGreedHistory.length} days`);
      } catch (e: any) {
        console.error("[BTC] F&G history error:", e?.message?.substring(0, 200));
      }

      // F&G historical stats
      const fgValues = fearGreedHistory.map(d => d.value);
      const fgAvg30 = fgValues.length >= 30 ? fgValues.slice(-30).reduce((a, b) => a + b, 0) / 30 : null;
      const fgAvg90 = fgValues.length >= 90 ? fgValues.slice(-90).reduce((a, b) => a + b, 0) / 90 : null;
      const fgAvg365 = fgValues.length > 0 ? fgValues.reduce((a, b) => a + b, 0) / fgValues.length : null;
      const fgYearHigh = fgValues.length > 0 ? Math.max(...fgValues) : null;
      const fgYearLow = fgValues.length > 0 ? Math.min(...fgValues) : null;

      console.log(`[BTC] Technical: Bull=${isBull}, Signals=${signals.length}, MA50=$${lastTech?.ma50?.toFixed(0) ?? 'N/A'}, MA200=$${lastTech?.ma200?.toFixed(0) ?? 'N/A'}`);

      // === 8. Cycle Assessment (German) ===
      let positionText: string;
      if (monthsSinceHalving < 12) {
        positionText = `Bitcoin befindet sich ${monthsSinceHalving} Monate nach dem Halving in der frühen Expansionsphase. Historisch gesehen beginnen die stärksten Kursanstiege 12–18 Monate nach dem Halving.`;
      } else if (monthsSinceHalving < 18) {
        positionText = `Bitcoin befindet sich ${monthsSinceHalving} Monate nach dem Halving in der mittleren Zyklusphase. Dies ist historisch die Phase mit dem stärksten Momentum.`;
      } else if (monthsSinceHalving < 24) {
        positionText = `Bitcoin befindet sich ${monthsSinceHalving} Monate nach dem Halving in der späten Expansionsphase. Historisch gesehen nähert sich der Zyklus seinem Höhepunkt.`;
      } else {
        positionText = `Bitcoin befindet sich ${monthsSinceHalving} Monate nach dem Halving in der späten Zyklusphase. Vorsicht ist geboten, da historische Zyklen typischerweise 24–30 Monate nach dem Halving ihren Höhepunkt erreichen.`;
      }

      let entryText: string;
      if (deviationPercent < -30) {
        entryText = `Der aktuelle Preis liegt ${Math.abs(deviationPercent).toFixed(1)}% unter dem Power-Law Fair Value – eine historisch attraktive Einstiegszone.`;
      } else if (deviationPercent < 0) {
        entryText = `Der aktuelle Preis liegt ${Math.abs(deviationPercent).toFixed(1)}% unter dem Power-Law Fair Value – ein leicht unterbewertetes Niveau.`;
      } else if (deviationPercent < 50) {
        entryText = `Der aktuelle Preis liegt ${deviationPercent.toFixed(1)}% über dem Power-Law Fair Value – eine neutrale Bewertungszone.`;
      } else {
        entryText = `Der aktuelle Preis liegt ${deviationPercent.toFixed(1)}% über dem Power-Law Fair Value – zunehmend überbewertetes Territorium. Vorsicht bei Neueinstiegen.`;
      }

      const halvingCatalyst = `Das nächste Halving wird voraussichtlich im April 2028 stattfinden. Die aktuelle Angebotsverknappung durch das letzte Halving (April 2024) wirkt weiterhin als langfristiger Katalysator für den Preis.`;

      // === Build final estimate ===
      const outlook = gwsValue > 0.2 ? "Bullish" : gwsValue > -0.2 ? "Neutral" : "Bearish";
      const threeMonthRange = `$${mc3M.p10.toLocaleString("en-US", { maximumFractionDigits: 0 })} – $${mc3M.p90.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
      const sixMonthRange = `$${mc6M.p10.toLocaleString("en-US", { maximumFractionDigits: 0 })} – $${mc6M.p90.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

      let summary: string;
      if (outlook === "Bullish") {
        summary = `Bitcoin zeigt bullische Signale bei $${btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}. Die Kombination aus Zyklusphase (${monthsSinceHalving}M post-Halving), Power-Law-Bewertung und Makro-Indikatoren deutet auf weiteres Aufwärtspotenzial hin.`;
      } else if (outlook === "Neutral") {
        summary = `Bitcoin handelt bei $${btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })} in einer neutralen Zone. Gemischte Signale aus Zyklusphase, Bewertung und Makro-Umfeld erfordern Geduld.`;
      } else {
        summary = `Bitcoin steht bei $${btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })} unter Druck. Ungünstige Makro-Bedingungen und späte Zyklusphase mahnen zur Vorsicht.`;
      }

      // === Assemble response ===
      const analysis = {
        timestamp: new Date().toISOString(),
        btcPrice,
        btcChange24h,
        btcMarketCap,

        lastHalvingDate: "2024-04-20",
        monthsSinceHalving,
        nextHalvingEstimate: "~April 2028",
        cyclePhase,

        indicators,
        gis,
        gisCalculation,

        powerLaw: {
          daysSinceGenesis,
          fairValue,
          support,
          resistance,
          deviationPercent,
          fairValue6M,
          powerSignal,
        },

        gws: {
          gis,
          powerSignal,
          cycleSignal,
          value: gwsValue,
          mu,
          interpretation: gwsInterpretation,
        },

        monteCarlo: {
          sigma,
          sigmaAdj,
          mu,
          threeMonth: mc3M,
          sixMonth: mc6M,
        },

        categories,

        cycleAssessment: {
          position: positionText,
          entryPoint: entryText,
          halvingCatalyst,
        },

        finalEstimate: {
          threeMonthRange,
          sixMonthRange,
          outlook,
          summary,
        },

        fearGreedIndex,
        fearGreedLabel,

        dxy,
        fedFundsRate,

        // Extended chart data
        chartData: {
          prices1Y,
          prices3Y,
          prices5Y,
          prices10Y,
          allPrices: allPriceData,
        },

        // Technical analysis
        technicalChart: technicalChartData.slice(-365 * 5), // last 5 years for chart
        technicalSignals: signals.slice(-100), // last 100 signals
        bullConditions,
        isBull,
        currentMA50: lastTech?.ma50 ?? null,
        currentMA200: lastTech?.ma200 ?? null,
        currentMACD: lastTech?.macd ?? null,
        currentSignal: lastTech?.signal ?? null,

        // F&G Historical
        fearGreedHistory,
        fearGreedStats: {
          avg30: fgAvg30,
          avg90: fgAvg90,
          avg365: fgAvg365,
          yearHigh: fgYearHigh,
          yearLow: fgYearLow,
        },
      };

      console.log(`[BTC] Analysis complete. Price: $${btcPrice}, GWS: ${gwsValue.toFixed(4)}, Outlook: ${outlook}`);
      res.json(analysis);
    } catch (error: any) {
      console.error("[BTC] Error:", error?.message);
      res.status(500).json({ error: error?.message || "BTC analysis failed" });
    }
  });

  // ============================================================
  // STOCK SCREENER — 13F Star Investor Holdings + Quick Valuation
  // ============================================================

  // Star investor CIKs (SEC EDGAR Central Index Keys)
  const STAR_INVESTORS: { name: string; cik: string }[] = [
    { name: "Berkshire Hathaway (Buffett)", cik: "0001067983" },
    { name: "Bridgewater Associates (Dalio)", cik: "0001350694" },
    { name: "Pershing Square (Ackman)", cik: "0001336528" },
    { name: "Appaloosa Management (Tepper)", cik: "0001656456" },
    { name: "Greenlight Capital (Einhorn)", cik: "0001079114" },
    { name: "Third Point (Loeb)", cik: "0001040273" },
    { name: "Baupost Group (Klarman)", cik: "0001061768" },
    { name: "Viking Global (Halvorsen)", cik: "0001103804" },
    { name: "Coatue Management", cik: "0001535392" },
    { name: "Tiger Global Management", cik: "0001167483" },
    { name: "Druckenmiller (Duquesne Family Office)", cik: "0001536411" },
    { name: "Elliott Management", cik: "0001048445" },
    { name: "ValueAct Capital", cik: "0001345471" },
    { name: "Icahn Enterprises", cik: "0000813762" },
  ];

  // Cache for 13F data (persists for 24 hours)
  let screenerCache: { data: any; timestamp: number } | null = null;
  const SCREENER_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

  // Fetch 13F holdings for a single investor from SEC EDGAR (free, no API key)
  async function fetch13FHoldings(cik: string, investorName: string): Promise<{ ticker: string; name: string; value: number; shares: number; investor: string }[]> {
    try {
      // Fetch the investor's recent filings to find latest 13F
      const submUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
      const resp = await fetch(submUrl, {
        headers: { 'User-Agent': 'StockAnalystPro/1.0 (philip.diaz.rohr@gmail.com)', 'Accept': 'application/json' },
      });
      if (!resp.ok) { console.log(`[SCREENER] Failed to fetch submissions for ${investorName}: ${resp.status}`); return []; }
      const data = await resp.json() as any;

      // Find the most recent 13F-HR filing
      const filings = data.filings?.recent;
      if (!filings) return [];
      let latestIdx = -1;
      for (let i = 0; i < (filings.form?.length || 0); i++) {
        if (filings.form[i] === '13F-HR') { latestIdx = i; break; }
      }
      if (latestIdx === -1) { console.log(`[SCREENER] No 13F-HR found for ${investorName}`); return []; }

      const accNum = filings.accessionNumber[latestIdx].replace(/-/g, '');
      const primaryDoc = filings.primaryDocument[latestIdx];
      const filingDate = filings.filingDate[latestIdx];
      console.log(`[SCREENER] ${investorName}: Latest 13F from ${filingDate}`);

      // Fetch the 13F XML information table
      const infoTableUrl = `https://www.sec.gov/Archives/edgar/data/${cik.replace(/^0+/, '')}/${accNum}`;
      const indexResp = await fetch(infoTableUrl + '/index.json', {
        headers: { 'User-Agent': 'StockAnalystPro/1.0 (philip.diaz.rohr@gmail.com)' },
      });
      if (!indexResp.ok) return [];
      const indexData = await indexResp.json() as any;
      const items = indexData?.directory?.item || [];
      const infoTableFile = items.find((f: any) => f.name?.toLowerCase().includes('infotable') && f.name?.endsWith('.xml'));
      if (!infoTableFile) {
        console.log(`[SCREENER] No infotable XML for ${investorName}`);
        return [];
      }

      const xmlResp = await fetch(`${infoTableUrl}/${infoTableFile.name}`, {
        headers: { 'User-Agent': 'StockAnalystPro/1.0 (philip.diaz.rohr@gmail.com)' },
      });
      if (!xmlResp.ok) return [];
      const xmlText = await xmlResp.text();

      // Parse XML — extract holdings (simple regex parsing, no XML lib needed)
      const holdings: { ticker: string; name: string; value: number; shares: number; investor: string }[] = [];
      const entries = xmlText.split(/<\/infoTable>/i);
      for (const entry of entries) {
        const nameMatch = entry.match(/<nameOfIssuer>([^<]+)/i);
        const cusipMatch = entry.match(/<cusip>([^<]+)/i);
        const valueMatch = entry.match(/<value>(\d+)/i);
        const sharesMatch = entry.match(/<sshPrnamt>(\d+)/i);
        if (nameMatch && valueMatch) {
          holdings.push({
            ticker: '', // Will be resolved later via CUSIP lookup or name
            name: nameMatch[1].trim(),
            value: parseInt(valueMatch[1]) * 1000, // 13F values are in thousands
            shares: sharesMatch ? parseInt(sharesMatch[1]) : 0,
            investor: investorName,
          });
        }
      }
      return holdings;
    } catch (err: any) {
      console.error(`[SCREENER] Error fetching 13F for ${investorName}:`, err?.message?.substring(0, 100));
      return [];
    }
  }

  // Resolve company names to tickers using the finance tool
  async function resolveTickersForHoldings(holdings: { name: string; ticker: string }[]): Promise<void> {
    // Build a lookup of common names → tickers
    const commonTickers: Record<string, string> = {
      'APPLE INC': 'AAPL', 'MICROSOFT CORP': 'MSFT', 'AMAZON COM INC': 'AMZN', 'ALPHABET INC': 'GOOGL',
      'META PLATFORMS INC': 'META', 'NVIDIA CORP': 'NVDA', 'TESLA INC': 'TSLA', 'BERKSHIRE HATHAWAY': 'BRK-B',
      'JPMORGAN CHASE & CO': 'JPM', 'VISA INC': 'V', 'JOHNSON & JOHNSON': 'JNJ', 'WALMART INC': 'WMT',
      'UNITEDHEALTH GROUP': 'UNH', 'PROCTER & GAMBLE': 'PG', 'MASTERCARD INC': 'MA', 'HOME DEPOT INC': 'HD',
      'BANK OF AMERICA': 'BAC', 'CHEVRON CORP': 'CVX', 'ABBVIE INC': 'ABBV', 'PFIZER INC': 'PFE',
      'BROADCOM INC': 'AVGO', 'COSTCO WHOLESALE': 'COST', 'ELI LILLY & CO': 'LLY', 'COCA-COLA CO': 'KO',
      'PEPSICO INC': 'PEP', 'THERMO FISHER': 'TMO', 'CISCO SYSTEMS': 'CSCO', 'WALT DISNEY CO': 'DIS',
      'NETFLIX INC': 'NFLX', 'ADOBE INC': 'ADBE', 'SALESFORCE INC': 'CRM', 'ORACLE CORP': 'ORCL',
      'INTL BUSINESS MACHINES': 'IBM', 'INTEL CORP': 'INTC', 'ADVANCED MICRO DEVICES': 'AMD',
      'QUALCOMM INC': 'QCOM', 'TEXAS INSTRUMENTS': 'TXN', 'APPLIED MATERIALS': 'AMAT',
      'SERVICENOW INC': 'NOW', 'UBER TECHNOLOGIES': 'UBER', 'AIRBNB INC': 'ABNB',
      'SNOWFLAKE INC': 'SNOW', 'PALANTIR TECHNOLOGIES': 'PLTR', 'CROWDSTRIKE': 'CRWD',
      'PALO ALTO NETWORKS': 'PANW', 'DATADOG INC': 'DDOG', 'FORTINET INC': 'FTNT',
      'SHOPIFY INC': 'SHOP', 'BLOCK INC': 'SQ', 'PAYPAL HOLDINGS': 'PYPL',
      'COINBASE GLOBAL': 'COIN', 'ROBINHOOD MARKETS': 'HOOD', 'SOFI TECHNOLOGIES': 'SOFI',
      'GENERAL ELECTRIC': 'GE', 'CATERPILLAR INC': 'CAT', 'DEERE & CO': 'DE',
      'LOCKHEED MARTIN': 'LMT', 'RAYTHEON': 'RTX', 'BOEING CO': 'BA', 'GENERAL MOTORS': 'GM',
      'FORD MOTOR CO': 'F', 'STARBUCKS CORP': 'SBUX', 'MCDONALDS CORP': 'MCD',
      'LIBERTY BROADBAND': 'LBRDA', 'T-MOBILE US INC': 'TMUS', 'CHARTER COMMUNICATIONS': 'CHTR',
      'CITIGROUP INC': 'C', 'WELLS FARGO & CO': 'WFC', 'GOLDMAN SACHS': 'GS', 'MORGAN STANLEY': 'MS',
    };
    // Phase 1: static map lookup (fast, no API call)
    const unresolved: typeof holdings = [];
    for (const h of holdings) {
      if (h.ticker) { unresolved; continue; }
      const nameUp = h.name.toUpperCase();
      let found = false;
      for (const [key, val] of Object.entries(commonTickers)) {
        if (nameUp.includes(key) || key.includes(nameUp.substring(0, 10))) {
          h.ticker = val;
          found = true;
          break;
        }
      }
      if (!found) unresolved.push(h);
    }

    // Phase 2: FMP search-symbol for unresolved holdings (dynamic fallback)
    // Only runs when FMP_API_KEY is set and there are unresolved holdings
    if (unresolved.length > 0 && isFmpAvailable()) {
      console.log(`[13F-RESOLVER] ${unresolved.length} unresolved holdings — trying FMP search`);
      // Process in batches of 5 with 100ms delay to avoid FMP rate limits
      for (let i = 0; i < Math.min(unresolved.length, 30); i++) {
        const h = unresolved[i];
        try {
          // Use first 3 words of company name for better match
          const query = h.name.split(' ').slice(0, 3).join(' ');
          const results = await fmpSearchTicker(query, 3);
          if (results && results.length > 0) {
            // Prefer US exchange results (NYSE, NASDAQ)
            const usResult = results.find((r: any) =>
              r.exchange === 'NASDAQ' || r.exchange === 'NYSE' || r.exchange === 'AMEX'
            ) || results[0];
            if (usResult?.symbol) {
              h.ticker = usResult.symbol;
              console.log(`[13F-RESOLVER] Resolved '${h.name}' → ${h.ticker} via FMP`);
            }
          }
        } catch (_) { /* skip on error */ }
        if (i < Math.min(unresolved.length, 30) - 1) {
          await new Promise(r => setTimeout(r, 120)); // 120ms = ~8 req/sec within FMP free limit
        }
      }
      const resolved = unresolved.filter(h => h.ticker).length;
      console.log(`[13F-RESOLVER] FMP resolved ${resolved}/${Math.min(unresolved.length, 30)} additional tickers`);
    }
  }

  // Static 13F holdings data (Q1 2026) — updated quarterly. Avoids live SEC fetch timeout.
  const STATIC_13F_HOLDINGS: Array<{
    ticker: string;
    name: string;
    investors: string[];
  }> = [
    { ticker: "AAPL",  name: "Apple Inc",            investors: ["Berkshire Hathaway", "BlackRock", "Jane Street"] },
    { ticker: "MSFT",  name: "Microsoft Corp",        investors: ["Pershing Square", "TCI Fund", "Altimeter Capital", "Jane Street"] },
    { ticker: "NVDA",  name: "Nvidia Corp",           investors: ["Altimeter Capital", "BlackRock", "Citadel", "Point72", "Jane Street"] },
    { ticker: "AMZN",  name: "Amazon.com Inc",        investors: ["Pershing Square", "Appaloosa", "Bridgewater", "Citadel"] },
    { ticker: "GOOGL", name: "Alphabet Inc",          investors: ["Himalaya Capital", "Bridgewater", "Coatue", "Appaloosa"] },
    { ticker: "META",  name: "Meta Platforms",        investors: ["Altimeter Capital", "Coatue", "Point72"] },
    { ticker: "TSLA",  name: "Tesla Inc",             investors: ["ARK Investment", "Tudor Investment", "Jane Street"] },
    { ticker: "TSMC",  name: "Taiwan Semiconductor",  investors: ["Altimeter Capital", "Druckenmiller", "TCI Fund", "Appaloosa", "Coatue"] },
    { ticker: "AVGO",  name: "Broadcom Inc",          investors: ["Coatue", "Jane Street"] },
    { ticker: "V",     name: "Visa Inc",              investors: ["TCI Fund", "Berkshire Hathaway"] },
    { ticker: "UNH",   name: "UnitedHealth Group",    investors: ["Altimeter Capital", "Bridgewater"] },
    { ticker: "UBER",  name: "Uber Technologies",     investors: ["Pershing Square", "Altimeter Capital", "Appaloosa"] },
    { ticker: "NOW",   name: "ServiceNow Inc",        investors: ["Altimeter Capital", "Druckenmiller"] },
    { ticker: "AMAT",  name: "Applied Materials",     investors: ["Coatue", "Point72"] },
    { ticker: "LRCX",  name: "Lam Research",          investors: ["Coatue", "Point72"] },
    { ticker: "NTRA",  name: "Natera Inc",            investors: ["Druckenmiller"] },
    { ticker: "GEV",   name: "GE Vernova",            investors: ["Coatue", "TCI Fund"] },
    { ticker: "GE",    name: "GE Aerospace",          investors: ["TCI Fund", "Coatue"] },
    { ticker: "MCO",   name: "Moody's Corp",          investors: ["TCI Fund", "Berkshire Hathaway"] },
    { ticker: "SPGI",  name: "S&P Global",            investors: ["TCI Fund", "Altimeter Capital"] },
    { ticker: "AXP",   name: "American Express",      investors: ["Berkshire Hathaway"] },
    { ticker: "KO",    name: "Coca-Cola",             investors: ["Berkshire Hathaway"] },
    { ticker: "BAC",   name: "Bank of America",       investors: ["Berkshire Hathaway", "Point72"] },
    { ticker: "PLTR",  name: "Palantir Technologies", investors: ["Jane Street", "ARK Investment", "Renaissance"] },
    { ticker: "MU",    name: "Micron Technology",     investors: ["Appaloosa", "Citadel", "Renaissance"] },
    { ticker: "INSM",  name: "Insmed Inc",            investors: ["Druckenmiller"] },
    { ticker: "ANET",  name: "Arista Networks",       investors: ["Point72", "Coatue"] },
    { ticker: "ASML",  name: "ASML Holding",          investors: ["Point72", "Coatue"] },
    { ticker: "BN",    name: "Brookfield Asset Mgmt", investors: ["Pershing Square"] },
    { ticker: "QSR",   name: "Restaurant Brands",     investors: ["Pershing Square"] },
  ];


  app.get('/api/screener', async (_req, res) => {
    try {
      if (screenerCache && (Date.now() - screenerCache.timestamp < SCREENER_CACHE_TTL)) {
        return res.json(screenerCache.data);
      }

      const FMP_KEY = process.env.FMP_API_KEY || 'lHc3gAE8V0YuUn48HEnXIHJazR7nI7Cx';

      // Deduplicate and sort by investor count
      const allTickers = [...new Set(STATIC_13F_HOLDINGS.map(h => h.ticker))];

      // Fetch FMP data per ticker (individual calls — free tier doesn't batch)
      const quotesMap: Record<string, any> = {};
      const statsMap: Record<string, any> = {};
      const CONCURRENCY = 6;

      const fmpFetch = async (sym: string) => {
        try {
          const [qResp, pResp, ptResp, rResp] = await Promise.all([
            fetch(`https://financialmodelingprep.com/stable/quote?symbol=${sym}&apikey=${FMP_KEY}`).catch(() => null),
            fetch(`https://financialmodelingprep.com/stable/profile?symbol=${sym}&apikey=${FMP_KEY}`).catch(() => null),
            fetch(`https://financialmodelingprep.com/stable/price-target-consensus?symbol=${sym}&apikey=${FMP_KEY}`).catch(() => null),
            fetch(`https://financialmodelingprep.com/stable/ratios?symbol=${sym}&limit=1&apikey=${FMP_KEY}`).catch(() => null),
          ]);
          const qData = qResp?.ok ? await qResp.json().catch(() => null) : null;
          const pData = pResp?.ok ? await pResp.json().catch(() => null) : null;
          const ptData = ptResp?.ok ? await ptResp.json().catch(() => null) : null;
          const rData = rResp?.ok ? await rResp.json().catch(() => null) : null;
          const q = Array.isArray(qData) ? qData[0] : qData;
          const p = Array.isArray(pData) ? pData[0] : pData;
          const pt = Array.isArray(ptData) ? ptData[0] : ptData;
          const r = Array.isArray(rData) ? rData[0] : rData;
          if (q) quotesMap[sym] = q;
          statsMap[sym] = { ...(p || {}), ...(pt || {}), ...(r || {}) };
        } catch { /* ignore */ }
      };

      for (let i = 0; i < allTickers.length; i += CONCURRENCY) {
        await Promise.all(allTickers.slice(i, i + CONCURRENCY).map(fmpFetch));
        if (i + CONCURRENCY < allTickers.length) await new Promise(r => setTimeout(r, 300));
      }
      console.log(`[SCREENER] FMP data: quotes=${Object.keys(quotesMap).length} profiles=${Object.keys(statsMap).length}`);

      const screenedStocks = STATIC_13F_HOLDINGS.map(holding => {
        const quote = quotesMap[holding.ticker] || {};
        const profile = statsMap[holding.ticker] || {};
        const parseNum = (v: any) => { const n = parseFloat(String(v ?? '').replace(/[$,%]/g, '')); return isNaN(n) ? 0 : n; };

        const price = parseNum(quote.price || quote.previousClose) || 0;
        const pe = parseNum(profile.priceToEarningsRatio) || parseNum(profile.pe) || 0;
        const marketCap = parseNum(quote.marketCap || profile.marketCap || profile.mktCap) || 0;
        const beta = parseNum(profile.beta) || 1.2;
        const yearHigh = parseNum(quote.yearHigh) || price * 1.3;
        const yearLow = parseNum(quote.yearLow) || price * 0.7;
        const targetPrice = parseNum(profile.targetConsensus) || parseNum(profile.targetMedian) || 0;
        const sector = profile.sector || profile.industry || 'Unknown';

        let upside = targetPrice > 0 ? ((targetPrice - price) / price) * 100 : 0;
        if (upside === 0 && yearHigh > price) upside = ((yearHigh - price) / price) * 100;
        const worstCase = Math.max(beta * 20, price > yearLow ? ((price - yearLow) / price) * 100 : 25);
        const crv = worstCase > 0 ? upside / worstCase : 0;

        return {
          ticker: holding.ticker,
          name: holding.name,
          price,
          marketCap,
          pe,
          forwardPE: 0,
          sector,
          beta,
          investorCount: holding.investors.length,
          investors: holding.investors,
          totalValue: marketCap,
          targetPrice,
          upside: Math.round(upside * 10) / 10,
          downside: Math.round(worstCase * 10) / 10,
          crv: Math.round(crv * 100) / 100,
          crvPass: crv >= 3.0,
          yearHigh,
          yearLow,
          fcfMargin: 0,
        };
      }).sort((a, b) => b.investorCount - a.investorCount || b.crv - a.crv);

      const result = {
        lastUpdated: new Date().toISOString(),
        totalInvestors: STAR_INVESTORS.length,
        totalHoldings: STATIC_13F_HOLDINGS.length,
        screenedStocks,
      };

      screenerCache = { data: result, timestamp: Date.now() };
      console.log(`[SCREENER] Done. ${screenedStocks.filter(s => s.price > 0).length}/${screenedStocks.length} stocks with price data.`);
      res.json(result);
    } catch (error: any) {
      console.error('[SCREENER] Error:', error?.message);
      res.status(500).json({ error: error?.message || 'Screener failed' });
    }
  });

  return server;
}
