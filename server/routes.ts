import type { Express } from "express";
import { createServer, type Server } from "http";
import { analyzeRequestSchema, type StockAnalysis, type Catalyst, type Risk, type OHLCVPoint, type TechnicalIndicators, type MoatAssessment, type PorterForce, type CatalystReasoning, type CurrencyInfo, type PESTELAnalysis, type PESTELFactor, type PESTELFactorItem, type MacroCorrelations, type MacroCorrelation, type RevenueSegment } from "../shared/schema";
import { execSync } from "child_process";

// === Finance API Helper ===
function callFinanceTool(toolName: string, args: Record<string, any>): any {
  try {
    const params = JSON.stringify({ source_id: "finance", tool_name: toolName, arguments: args });
    // Escape single quotes in the JSON string for shell
    const escaped = params.replace(/'/g, "'\\''");
    const result = execSync(`external-tool call '${escaped}'`, {
      timeout: 60000,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(result);
  } catch (err: any) {
    console.error(`Finance API error (${toolName}):`, err?.message?.substring(0, 300));
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
function getEffectiveSector(sector: string, industry: string, description: string): { sector: string; industry: string; isHybrid: boolean; hybridNote: string } {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();

  // AMZN-like: classified as Consumer Cyclical but has major cloud/tech business
  if ((s.includes("consumer") && (s.includes("cycl") || s.includes("discr"))) &&
      (desc.includes("cloud") || desc.includes("aws") || desc.includes("web services") ||
       desc.includes("artificial intelligence") || desc.includes("streaming"))) {
    return {
      sector: "Technology",
      industry: industry + " / Cloud & Tech Platform",
      isHybrid: true,
      hybridNote: `Reklassifiziert: API meldet "${sector}/${industry}", aber signifikanter Tech/Cloud-Anteil (AWS/Cloud) → Tech-Sektor-Defaults für DCF.`,
    };
  }

  // META/GOOG: Communication Services but really tech
  if (s.includes("commun") && (desc.includes("artificial intelligence") || desc.includes("digital advertising") ||
      desc.includes("social") || desc.includes("search engine") || desc.includes("metaverse"))) {
    return {
      sector: "Technology",
      industry: industry + " / Tech Platform",
      isHybrid: true,
      hybridNote: `Reklassifiziert: API meldet "${sector}", aber Kerngeschäft ist Tech-Plattform → Tech-Sektor-Defaults.`,
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
  sectorAvgEVEBITDA: number;
  sectorAvgPEG: number;
} {
  const s = sector.toLowerCase();
  if (s.includes("tech")) {
    return {
      waccScenarios: { kons: 10.5, avg: 9.0, opt: 7.5 },
      growthAssumptions: { g1: 15, g2: 10, terminal: 3 },
      cycleClass: "Secular Growth",
      politicalCycle: "Low sensitivity – tech regulation risk moderate",
      sectorMaxDrawdown: 35,
      sectorAvgPE: 28, sectorAvgEVEBITDA: 20, sectorAvgPEG: 1.5,
    };
  } else if (s.includes("health")) {
    return {
      waccScenarios: { kons: 9.5, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 10, g2: 7, terminal: 3 },
      cycleClass: "Defensive / Non-Cyclical",
      politicalCycle: "High – healthcare policy, drug pricing reform",
      sectorMaxDrawdown: 25,
      sectorAvgPE: 22, sectorAvgEVEBITDA: 15, sectorAvgPEG: 1.8,
    };
  } else if (s.includes("financ")) {
    return {
      waccScenarios: { kons: 11.0, avg: 9.5, opt: 8.0 },
      growthAssumptions: { g1: 8, g2: 5, terminal: 2.5 },
      cycleClass: "Cyclical – Interest Rate Sensitive",
      politicalCycle: "High – banking regulation, monetary policy",
      sectorMaxDrawdown: 45,
      sectorAvgPE: 14, sectorAvgEVEBITDA: 10, sectorAvgPEG: 1.3,
    };
  } else if (s.includes("energy")) {
    return {
      waccScenarios: { kons: 12.0, avg: 10.0, opt: 8.5 },
      growthAssumptions: { g1: 5, g2: 3, terminal: 2 },
      cycleClass: "Deep Cyclical – Commodity Linked",
      politicalCycle: "Very High – energy policy, ESG mandates",
      sectorMaxDrawdown: 55,
      sectorAvgPE: 12, sectorAvgEVEBITDA: 6, sectorAvgPEG: 1.0,
    };
  } else if (s.includes("consumer") && (s.includes("discr") || s.includes("cycl"))) {
    return {
      waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 12, g2: 8, terminal: 3 },
      cycleClass: "Cyclical – Consumer Spending",
      politicalCycle: "Moderate – tariffs, consumer confidence",
      sectorMaxDrawdown: 40,
      sectorAvgPE: 24, sectorAvgEVEBITDA: 16, sectorAvgPEG: 1.4,
    };
  } else if (s.includes("consumer") && (s.includes("stapl") || s.includes("defens"))) {
    return {
      waccScenarios: { kons: 8.5, avg: 7.5, opt: 6.5 },
      growthAssumptions: { g1: 5, g2: 4, terminal: 2.5 },
      cycleClass: "Defensive – Consumer Staples",
      politicalCycle: "Low – essential goods, moderate regulatory risk",
      sectorMaxDrawdown: 20,
      sectorAvgPE: 22, sectorAvgEVEBITDA: 15, sectorAvgPEG: 2.2,
    };
  } else if (s.includes("commun")) {
    return {
      waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 10, g2: 7, terminal: 2.5 },
      cycleClass: "Secular Growth / Communication",
      politicalCycle: "Moderate – content regulation, antitrust",
      sectorMaxDrawdown: 35,
      sectorAvgPE: 20, sectorAvgEVEBITDA: 12, sectorAvgPEG: 1.4,
    };
  } else if (s.includes("industrial")) {
    return {
      waccScenarios: { kons: 10.5, avg: 9.0, opt: 7.5 },
      growthAssumptions: { g1: 8, g2: 5, terminal: 2.5 },
      cycleClass: "Cyclical – Capex Cycle",
      politicalCycle: "Moderate – infrastructure spending, trade policy",
      sectorMaxDrawdown: 40,
      sectorAvgPE: 20, sectorAvgEVEBITDA: 13, sectorAvgPEG: 1.5,
    };
  } else if (s.includes("real estate")) {
    return {
      waccScenarios: { kons: 9.5, avg: 8.0, opt: 6.5 },
      growthAssumptions: { g1: 5, g2: 3, terminal: 2 },
      cycleClass: "Cyclical – Rate Sensitive",
      politicalCycle: "Moderate – housing policy, zoning",
      sectorMaxDrawdown: 45,
      sectorAvgPE: 35, sectorAvgEVEBITDA: 20, sectorAvgPEG: 2.0,
    };
  } else if (s.includes("util")) {
    return {
      waccScenarios: { kons: 8.0, avg: 7.0, opt: 6.0 },
      growthAssumptions: { g1: 4, g2: 3, terminal: 2 },
      cycleClass: "Defensive – Regulated",
      politicalCycle: "Moderate – utility regulation, clean energy mandates",
      sectorMaxDrawdown: 20,
      sectorAvgPE: 18, sectorAvgEVEBITDA: 12, sectorAvgPEG: 2.5,
    };
  } else {
    return {
      waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 10, g2: 6, terminal: 2.5 },
      cycleClass: "Mixed Cyclical",
      politicalCycle: "Moderate – general policy exposure",
      sectorMaxDrawdown: 35,
      sectorAvgPE: 20, sectorAvgEVEBITDA: 14, sectorAvgPEG: 1.5,
    };
  }
}

// === Generate catalysts from real data ===
function generateCatalysts(sector: string, industry: string, growthRate: number, fcfMargin: number): Catalyst[] {
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
    einpreisungsgrad: Math.round(40 + Math.min(30, growthRate)),
    nettoUpside: 0, gb: 0,
  });

  // Margin expansion
  const marginPos = fcfMargin > 20 ? 55 : fcfMargin > 10 ? 45 : 35;
  catalysts.push({
    name: "Margin Expansion / Operating Leverage",
    timeline: "12-24M",
    pos: marginPos,
    bruttoUpside: Math.round(8 + (30 - fcfMargin) * 0.3),
    einpreisungsgrad: 35,
    nettoUpside: 0, gb: 0,
  });

  // Sector-specific catalysts
  if (s.includes("tech")) {
    catalysts.push({
      name: "AI / Cloud Adoption Tailwind",
      timeline: "6-18M",
      pos: 60,
      bruttoUpside: 15,
      einpreisungsgrad: 50,
      nettoUpside: 0, gb: 0,
    });
    catalysts.push({
      name: "Product Cycle / Platform Expansion",
      timeline: "12-24M",
      pos: 45,
      bruttoUpside: 12,
      einpreisungsgrad: 30,
      nettoUpside: 0, gb: 0,
    });
  } else if (s.includes("health")) {
    catalysts.push({
      name: "Pipeline Approval / FDA Catalyst",
      timeline: "6-18M",
      pos: 35,
      bruttoUpside: 25,
      einpreisungsgrad: 20,
      nettoUpside: 0, gb: 0,
    });
    catalysts.push({
      name: "Demographic Tailwind (Aging Population)",
      timeline: "12-36M",
      pos: 70,
      bruttoUpside: 8,
      einpreisungsgrad: 55,
      nettoUpside: 0, gb: 0,
    });
  } else if (s.includes("financ")) {
    catalysts.push({
      name: "Interest Rate Normalization Benefit",
      timeline: "6-12M",
      pos: 50,
      bruttoUpside: 12,
      einpreisungsgrad: 40,
      nettoUpside: 0, gb: 0,
    });
    catalysts.push({
      name: "Capital Return / Buyback Program",
      timeline: "0-12M",
      pos: 65,
      bruttoUpside: 8,
      einpreisungsgrad: 50,
      nettoUpside: 0, gb: 0,
    });
  } else if (s.includes("energy")) {
    catalysts.push({
      name: "Commodity Price Recovery",
      timeline: "6-18M",
      pos: 40,
      bruttoUpside: 20,
      einpreisungsgrad: 25,
      nettoUpside: 0, gb: 0,
    });
    catalysts.push({
      name: "Energy Transition Investment",
      timeline: "12-36M",
      pos: 45,
      bruttoUpside: 15,
      einpreisungsgrad: 20,
      nettoUpside: 0, gb: 0,
    });
  } else {
    catalysts.push({
      name: "Market Share Gains",
      timeline: "12-24M",
      pos: 45,
      bruttoUpside: 12,
      einpreisungsgrad: 30,
      nettoUpside: 0, gb: 0,
    });
    catalysts.push({
      name: "Strategic M&A / Partnerships",
      timeline: "6-18M",
      pos: 30,
      bruttoUpside: 15,
      einpreisungsgrad: 15,
      nettoUpside: 0, gb: 0,
    });
  }

  // Calculate netto and GB
  for (const c of catalysts) {
    c.nettoUpside = +(c.bruttoUpside * (1 - c.einpreisungsgrad / 100)).toFixed(2);
    c.gb = +(c.pos / 100 * c.nettoUpside).toFixed(2);
  }

  return catalysts;
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

  if (ind.includes("defense") || ind.includes("aerospace")) {
    return { exposure: 60, detail: "Defense/Aerospace – high government contract dependency" };
  }
  if (desc.includes("government") && desc.includes("contract")) {
    return { exposure: 35, detail: "Significant government contract exposure noted in description" };
  }
  if (ind.includes("health") && desc.includes("medicare")) {
    return { exposure: 30, detail: "Healthcare with Medicare/Medicaid revenue exposure" };
  }
  if (ind.includes("infrastructure") || ind.includes("construction")) {
    return { exposure: 25, detail: "Infrastructure sector – moderate public spending exposure" };
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
  };
  const region = regionMap[reportedCurrency] || "Global";
  const isEU = ["EUR", "GBP", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK"].includes(reportedCurrency);
  const isAsia = ["CNY", "HKD", "JPY", "KRW", "TWD", "SGD", "INR"].includes(reportedCurrency);
  const isEM = ["CNY", "BRL", "INR", "ZAR", "MXN", "PLN", "CZK"].includes(reportedCurrency);

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

  // SMA calculation
  function sma(data: number[], period: number): (number | null)[] {
    return data.map((_, i) => {
      if (i < period - 1) return null;
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      return sum / period;
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
  marketCap: number, revenueGrowth: number, moatRating: string
): MoatAssessment {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const isLargeCap = marketCap > 50e9;
  const isMegaCap = marketCap > 500e9;

  const forces: PorterForce[] = [];

  // 1. Threat of New Entrants
  if (s.includes("tech") && isMegaCap) {
    forces.push({ name: "Bedrohung durch neue Wettbewerber", rating: "Low", score: 2, reasoning: "Hohe Skaleneffekte, Netzwerkeffekte und Kapitalanforderungen schützen vor Markteintritten. Etablierte Plattformen haben massive switching costs." });
  } else if (s.includes("tech")) {
    forces.push({ name: "Bedrohung durch neue Wettbewerber", rating: "Medium", score: 3, reasoning: "Technologische Innovationen können Eintrittsbarrieren senken. Cloud-basierte Lösungen ermöglichen schnellen Markteintritt." });
  } else if (s.includes("financ")) {
    forces.push({ name: "Bedrohung durch neue Wettbewerber", rating: "Low", score: 2, reasoning: "Regulatorische Anforderungen, Kapitalanforderungen und Vertrauensbarrieren schützen etablierte Institute." });
  } else if (s.includes("energy")) {
    forces.push({ name: "Bedrohung durch neue Wettbewerber", rating: "Low", score: 1, reasoning: "Sehr hohe Kapitalanforderungen, lange Projektlaufzeiten und regulatorische Hürden. Infrastruktur-Moat." });
  } else if (s.includes("health")) {
    forces.push({ name: "Bedrohung durch neue Wettbewerber", rating: "Low", score: 2, reasoning: "FDA-Zulassungsprozesse, Patentschutz und hohe F&E-Kosten bilden starke Eintrittsbarrieren." });
  } else {
    forces.push({ name: "Bedrohung durch neue Wettbewerber", rating: "Medium", score: 3, reasoning: "Moderate Eintrittsbarrieren. Kapitalanforderungen und Brand-Effekte variieren je nach Subsegment." });
  }

  // 2. Bargaining Power of Suppliers
  if (s.includes("tech")) {
    forces.push({ name: "Verhandlungsmacht der Lieferanten", rating: "Low", score: 2, reasoning: "Software-Unternehmen haben geringe Abhängigkeit von einzelnen Lieferanten. Chip-Engpässe sind zyklisch." });
  } else if (s.includes("energy")) {
    forces.push({ name: "Verhandlungsmacht der Lieferanten", rating: "High", score: 4, reasoning: "Hohe Abhängigkeit von Rohstoffen und spezialisierten Zulieferern. OPEC und geopolitische Faktoren erhöhen die Macht." });
  } else if (ind.includes("auto") || ind.includes("vehicle")) {
    forces.push({ name: "Verhandlungsmacht der Lieferanten", rating: "Medium", score: 3, reasoning: "Komplexe Lieferketten mit spezialisierten Zulieferern. Batteriehersteller haben zunehmende Verhandlungsmacht." });
  } else {
    forces.push({ name: "Verhandlungsmacht der Lieferanten", rating: "Medium", score: 3, reasoning: "Moderate Abhängigkeit von Lieferanten. Diversifizierung der Lieferkette als Schlüsselfaktor." });
  }

  // 3. Bargaining Power of Buyers
  if (s.includes("tech") && isMegaCap) {
    forces.push({ name: "Verhandlungsmacht der Kunden", rating: "Low", score: 2, reasoning: "Hohe Wechselkosten, Plattform-Lock-in und Netzwerkeffekte limitieren die Verhandlungsposition der Kunden." });
  } else if (s.includes("consumer")) {
    forces.push({ name: "Verhandlungsmacht der Kunden", rating: "High", score: 4, reasoning: "Endverbraucher sind preissensitiv. Geringe Wechselkosten bei vielen Produktkategorien. Online-Vergleich stärkt Kunden." });
  } else {
    forces.push({ name: "Verhandlungsmacht der Kunden", rating: "Medium", score: 3, reasoning: "Moderate Kundenkonzentration. Enterprise-Kunden haben höhere Verhandlungsmacht als Retail." });
  }

  // 4. Threat of Substitutes
  if (s.includes("tech") && ind.includes("software")) {
    forces.push({ name: "Bedrohung durch Substitute", rating: "Medium", score: 3, reasoning: "Open-Source und neue SaaS-Lösungen können bestehende Produkte substituieren. AI als potenzieller Disruptor." });
  } else if (s.includes("energy")) {
    forces.push({ name: "Bedrohung durch Substitute", rating: "High", score: 4, reasoning: "Erneuerbare Energien substituieren fossile Brennstoffe. Elektrifizierung des Transports. Regulatorischer Druck beschleunigt Transition." });
  } else if (s.includes("health")) {
    forces.push({ name: "Bedrohung durch Substitute", rating: "Low", score: 2, reasoning: "Medizinische Produkte haben wenige direkte Substitute. Patentschutz sichert Marktposition temporär." });
  } else {
    forces.push({ name: "Bedrohung durch Substitute", rating: "Medium", score: 3, reasoning: "Moderate Substitutionsrisiken. Technologische Disruption kann neue Alternativen schaffen." });
  }

  // 5. Competitive Rivalry
  if (isMegaCap) {
    forces.push({ name: "Wettbewerbsintensität", rating: "High", score: 4, reasoning: "Intensiver Wettbewerb zwischen wenigen dominanten Playern. Hohe F&E- und Marketing-Ausgaben. Preiskämpfe in Commoditized-Segmenten." });
  } else if (s.includes("tech")) {
    forces.push({ name: "Wettbewerbsintensität", rating: "High", score: 4, reasoning: "Starke Innovation treibt intensiven Wettbewerb. Winner-takes-most Dynamik. Talent War und R&D-Wettrüsten." });
  } else if (s.includes("util")) {
    forces.push({ name: "Wettbewerbsintensität", rating: "Low", score: 2, reasoning: "Regulierter Markt mit regionalen Monopolen. Stabiler Wettbewerb durch regulierte Renditen." });
  } else {
    forces.push({ name: "Wettbewerbsintensität", rating: "Medium", score: 3, reasoning: "Moderate Wettbewerbsintensität. Marktpositionierung und Brand Equity als Differenzierungsfaktoren." });
  }

  // Moat sources
  const moatSources: string[] = [];
  if (fcfMargin > 25) moatSources.push("Hohe FCF-Marge → Pricing Power");
  if (isMegaCap) moatSources.push("Skaleneffekte / Economies of Scale");
  if (s.includes("tech") && isMegaCap) moatSources.push("Netzwerkeffekte / Platform Lock-in");
  if (s.includes("tech")) moatSources.push("Technologische Überlegenheit / IP");
  if (s.includes("health")) moatSources.push("Patentschutz / FDA-Zulassungen");
  if (s.includes("financ")) moatSources.push("Regulatorische Barrieren / Vertrauen");
  if (s.includes("energy")) moatSources.push("Infrastruktur / Asset-Heavy Moat");
  if (isLargeCap) moatSources.push("Brand Equity / Markenbekanntheit");
  if (revenueGrowth > 15) moatSources.push("Überproportionales Wachstum → Marktanteilsgewinne");

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

export async function registerRoutes(server: Server, app: Express) {
  app.post("/api/analyze", async (req, res) => {
    try {
      const parsed = analyzeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid ticker" });
      }
      const ticker = parsed.data.ticker;
      console.log(`[ANALYZE] Starting analysis for ${ticker}...`);

      // === Parallel API calls ===
      const [quoteResult, profileResult, financialsResult, analystResult, estimatesResult, ohlcvHistResult, segmentsResult] = await Promise.all([
        // 1. Quote
        Promise.resolve(callFinanceTool("finance_quotes", {
          ticker_symbols: [ticker],
          fields: ["price", "currency", "marketCap", "pe", "eps", "change", "changesPercentage", "volume", "avgVolume", "dayLow", "dayHigh", "yearLow", "yearHigh", "previousClose", "dividendYieldTTM"],
        })),
        // 2. Company Profile
        Promise.resolve(callFinanceTool("finance_company_profile", {
          ticker_symbols: [ticker],
          query: `Company profile for ${ticker}`,
          action: `Fetching company profile for ${ticker}`,
        })),
        // 3. Financials (annual) — use current year minus 1 for latest full year
        Promise.resolve(callFinanceTool("finance_financials", {
          ticker_symbols: [ticker],
          period: "annual",
          as_of_fiscal_year: new Date().getFullYear() - 1,
          limit: 3,
          income_statement_metrics: ["revenue", "netIncome", "ebitda", "eps", "epsDiluted", "weightedAverageSharesOutstanding", "operatingIncome", "grossProfit"],
          balance_sheet_metrics: ["totalDebt", "cashAndCashEquivalents", "totalStockholdersEquity", "totalAssets", "totalCurrentAssets", "totalCurrentLiabilities", "netDebt"],
          cash_flow_metrics: ["freeCashFlow", "operatingCashFlow", "capitalExpenditure"],
        })),
        // 4. Analyst Research
        Promise.resolve(callFinanceTool("finance_analyst_research", {
          ticker_symbols: [ticker],
        })),
        // 5. Estimates
        Promise.resolve(callFinanceTool("finance_estimates", {
          ticker_symbols: [ticker],
          period_type: "annual",
        })),
        // 6. OHLCV 5+ years daily data (for MA200 we need 200+ days, user wants up to 5Y chart)
        (async () => {
          const endDate = new Date().toISOString().split('T')[0];
          const startDate = new Date(Date.now() - 5 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const ohlcvResult = callFinanceTool("finance_ohlcv_histories", {
            ticker_symbols: [ticker],
            start_date_yyyy_mm_dd: startDate,
            end_date_yyyy_mm_dd: endDate,
            time_interval: "1day",
            fields: ["open", "high", "low", "close", "volume"],
          });
          return ohlcvResult;
        })(),
        // 7. Revenue Segments (Umsatzanteil nach Produkten/Segmenten)
        Promise.resolve(callFinanceTool("finance_segments", {
          ticker_symbols: [ticker],
          query: "revenue by business segment and geographic breakdown",
          period_type: "annual",
          limit: 2,
        })),
      ]);

      console.log(`[ANALYZE] All API calls completed for ${ticker}`);

      // === Parse Quote ===
      let price = 0, marketCap = 0, pe = 0, eps = 0, currency = "USD", companyName = ticker;
      let change = 0, changePct = 0, volume = 0, avgVolume = 0;
      let dayLow = 0, dayHigh = 0, yearLow = 0, yearHigh = 0, prevClose = 0, divYield = 0;
      let priceTimestamp = new Date().toISOString();

      if (quoteResult?.content) {
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
        return res.status(404).json({ error: `No quote data found for ${ticker}. Please check the ticker symbol.` });
      }

      // === Parse Company Profile ===
      let sector = "Technology", industry = "General", description = "", exchange = "NASDAQ";
      let sectorHybridNote = "";
      if (profileResult?.content) {
        const content = profileResult.content;
        const sectorMatch = content.match(/Sector:\*?\*?\s*(.+)/);
        const industryMatch = content.match(/Industry:\*?\*?\s*(.+)/);
        const descMatch = content.match(/Description:\*?\*?\n([\s\S]+)/);
        if (sectorMatch) sector = sectorMatch[1].trim();
        if (industryMatch) industry = industryMatch[1].trim();
        if (descMatch) description = descMatch[1].trim().substring(0, 2000);
      }

      // Apply effective sector reclassification for hybrid companies (e.g. AMZN, META, GOOG)
      const effectiveSector = getEffectiveSector(sector, industry, description);
      const originalSector = sector;
      const originalIndustry = industry;
      if (effectiveSector.isHybrid) {
        sector = effectiveSector.sector;
        industry = effectiveSector.industry;
        sectorHybridNote = effectiveSector.hybridNote;
        console.log(`[ANALYZE] Sector reclassified: ${originalSector} -> ${sector} (${sectorHybridNote})`);
      }

      // === Parse Financials ===
      let revenue = 0, netIncome = 0, ebitda = 0, fcfTTM = 0, totalDebt = 0, cashEquivalents = 0;
      let sharesOutstanding = 0, operatingIncome = 0, grossProfit = 0;
      let totalEquity = 0, totalAssets = 0, netDebt = 0;
      let revenueGrowth = 0;

      if (financialsResult?.content) {
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

      if (financialsResult?.content) {
        const detected = detectReportedCurrency(financialsResult.content);
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

      if (analystResult?.content) {
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

      if (ohlcvHistResult) {
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
      const pegRatio = epsGrowth5Y > 0 ? pe / epsGrowth5Y : 2;
      const evEbitda = ebitda > 0 ? (marketCap + totalDebt - cashEquivalents) / ebitda : 15;
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

      // === Government exposure ===
      const govExp = estimateGovExposure(sector, industry, description);
      const fcfHaircut = govExp.exposure > 20 ? Math.min(20, Math.round(govExp.exposure * 0.4)) : 0;

      // === RSL (26-week avg ≈ 130 trading days) ===
      const prices26w = closingPrices2Y.slice(-130).map(d => d.close);
      const rslAvg = prices26w.length > 0 ? prices26w.reduce((s, v) => s + v, 0) / prices26w.length : price;
      const rsl = rslAvg > 0 ? (price / rslAvg) * 100 : 100;

      // === Catalysts & Risks ===
      const catalysts = generateCatalysts(sector, industry, revenueGrowth, fcfMargin);
      const risks = generateRisks(sector, beta5Y, govExp.exposure);

      // === Growth thesis (enriched with catalyst business model reasoning) ===
      const hybridPrefix = sectorHybridNote ? `⚠️ ${sectorHybridNote} ` : "";
      let growthThesis = "";
      if (revenueGrowth > 20) growthThesis = `Starkes Revenue-Wachstum von ${revenueGrowth.toFixed(1)}% getrieben durch säkulare Nachfrage und Marktexpansion.`;
      else if (revenueGrowth > 10) growthThesis = `Solides Revenue-Wachstum von ${revenueGrowth.toFixed(1)}% mit Spielraum für Operating Leverage und Margenexpansion.`;
      else if (revenueGrowth > 0) growthThesis = `Moderates Revenue-Wachstum von ${revenueGrowth.toFixed(1)}% – Bewertung hängt von Margenverbesserung und Kapitalrückflüssen ab.`;
      else growthThesis = `Revenue rückläufig bei ${revenueGrowth.toFixed(1)}% – benötigt Restrukturierung oder neuen Wachstumsvektor.`;
      growthThesis = hybridPrefix + growthThesis;

      // Add catalyst business-model reasoning by sector (generic)
      const sLower = sector.toLowerCase();
      const indLower = industry.toLowerCase();
      if (sLower.includes("tech")) {
        if (indLower.includes("software") || indLower.includes("cloud") || indLower.includes("saas")) {
          growthThesis += " Katalysator: Integration von KI-Modulen in bestehende Produktsuite erhöht ARPU und stärkt Kundenbindung (Switching Costs). Cloud-Migration bestehender Enterprise-Kunden → wiederkehrende Umsatzströme mit höheren Bruttomargen (70-85%).";
        } else if (indLower.includes("semiconductor") || indLower.includes("chip")) {
          growthThesis += " Katalysator: KI-Inferenz und Data-Center-Nachfrage treiben ASP-Steigerungen. Technologie-Zyklen ermöglichen periodische Margenerholung bei Kapazitätsanpassung.";
        } else {
          growthThesis += " Katalysator: KI-Integration, Cloud-Plattform-Expansion und neue Verticals ermöglichen Cross-Selling und höhere Margen. Netzwerkeffekte stärken Wettbewerbsposition und reduzieren Kundenabwanderung.";
        }
      } else if (sLower.includes("health")) {
        growthThesis += " Katalysator: Pipeline-Fortschritte (FDA-Approvals), Biologika-Expansion und demografischer Rückenwind (Aging Population) bieten strukturelles Wachstum. Patentschutz sichert Premium-Pricing.";
      } else if (sLower.includes("financ")) {
        growthThesis += " Katalysator: Zinsnormalisierung verbessert Net Interest Income. Digitalisierung (FinTech-Integration, KI-gestützte Risikomodelle) senkt Cost-to-Income Ratio. Aktienrückkäufe stützen EPS-Wachstum.";
      } else if (sLower.includes("energy")) {
        growthThesis += " Katalysator: Energy Security-Investments und Transition-Projekte (LNG, Renewables) diversifizieren Umsatz. Hohe FCF-Generierung bei stabilen Commodity-Preisen ermöglicht Schuldenabbau und Dividendenwachstum.";
      } else if (sLower.includes("consumer") && sLower.includes("discr")) {
        growthThesis += " Katalysator: E-Commerce-Penetration, Direct-to-Consumer-Ausbau und Pricing Power durch Markenstärke. Internationale Expansion in Emerging Markets bietet Volumenwachstum.";
      } else if (sLower.includes("industrial")) {
        growthThesis += " Katalysator: Infrastruktur-Investitionsprogramme (IRA, EU Green Deal), Automatisierung/Robotik-Adoption und Reshoring-Trends erhöhen Auftragsvolumen. Operative Effizienzgewinne durch Digitalisierung.";
      } else if (indLower.includes("auto") || indLower.includes("vehicle")) {
        growthThesis += " Katalysator: Elektrifizierungs-Roadmap, Software-Defined Vehicle (SDV) mit wiederkehrenden Einnahmen, und Plattform-Synergien senken Stückkosten bei steigender Skalierung.";
      } else {
        growthThesis += " Katalysator: Strategische M&A, operative Effizienzsteigerungen und neue Partnerschaften/Projekte können Margen verbessern und neue Umsatzquellen erschließen.";
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
      const moatAssessment = generateMoatAssessment(sector, industry, fcfMargin, marketCap, revenueGrowth, moatRating);

      // === Catalyst Reasoning ===
      const catalystReasoning = generateCatalystReasoning(sector, industry, revenueGrowth, fcfMargin, pe, price, analystPTMedian, rsl);

      // === PESTEL Analysis ===
      const pestelAnalysis = generatePESTELAnalysis(sector, industry, description, beta5Y, govExp.exposure, reportedCurrency);

      // === Macro Correlations (PMI, commodities, indices) ===
      const macroCorrelations = generateMacroCorrelations(sector, industry, description, beta5Y, reportedCurrency);

      // === Revenue Segments (Umsatzanteil nach Produkten) ===
      let revenueSegments: RevenueSegment[] | undefined;
      if (segmentsResult?.content) {
        try {
          const segContent = typeof segmentsResult.content === "string" ? segmentsResult.content : JSON.stringify(segmentsResult.content);

          // Parse the "Column legend" section to get human-readable names for segment keys
          const legendMap: Record<string, string> = {};
          const legendMatch = segContent.match(/Column legend:[\s\S]*?(?=\n\|)/m);
          if (legendMatch) {
            // Pattern: key = Human Readable Name (USD)
            const legendPattern = /([a-z_]+)\s*=\s*([^(,]+?)\s*\(/g;
            let lm;
            while ((lm = legendPattern.exec(legendMatch[0])) !== null) {
              legendMap[lm[1].trim()] = lm[2].trim();
            }
          }

          // Parse the markdown table
          const segTables = parseMarkdownTable(segContent);
          if (segTables.length > 0) {
            const headers = Object.keys(segTables[0]);
            // The table is wide: each row = a fiscal year, columns = segment metrics
            // We need to find revenue columns from the MOST RECENT row
            const revenueColumns = headers.filter(h => /revenue/i.test(h) && h !== 'date' && h !== 'period');

            // Sort rows by date descending to get latest year first
            const sortedRows = [...segTables].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const latestRow = sortedRows[0];
            const prevRow = sortedRows.length > 1 ? sortedRows[1] : null;

            if (latestRow) {
              const segments: RevenueSegment[] = [];
              let totalSegRevenue = 0;

              // Group revenue columns: prefer "post" columns (newer reporting structure)
              // and avoid duplicates from pre/post reporting changes
              const usedNames = new Set<string>();
              // Sort: post_fy columns first, then plain, then pre_fy
              const sortedRevCols = revenueColumns.sort((a, b) => {
                const aPost = /post_fy/i.test(a) ? 0 : /pre_fy/i.test(a) ? 2 : 1;
                const bPost = /post_fy/i.test(b) ? 0 : /pre_fy/i.test(b) ? 2 : 1;
                return aPost - bPost;
              });

              for (const col of sortedRevCols) {
                const rawVal = parseNumber(latestRow[col]);
                if (rawVal <= 0) continue;

                // Get human-readable name from legend, or clean up the column key
                let segName = legendMap[col] || col
                  .replace(/_revenue.*$/i, '')
                  .replace(/_post_fy\d+/i, '')
                  .replace(/_pre_fy\d+/i, '')
                  .replace(/_/g, ' ')
                  .replace(/\b\w/g, c => c.toUpperCase());

                // Remove trailing " Revenue" from legend names
                segName = segName.replace(/\s*Revenue$/i, '').trim();

                // Skip geographic segments (they'll be caught by "united_states" / "other_countries" keys)
                if (/united.states|other.countries|geograph/i.test(col)) continue;

                // Skip duplicates (same segment name from pre/post reporting)
                const normName = segName.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (usedNames.has(normName)) continue;
                usedNames.add(normName);

                // Skip if this is a sub-segment (has a parent segment with higher revenue)
                // We'll filter these out after collecting all
                let growth: number | undefined;
                if (prevRow) {
                  // Try to find matching previous year column
                  // The pre/post naming may differ between years, so try variants
                  const prevVal = parseNumber(prevRow[col]);
                  if (prevVal > 0) {
                    growth = +((rawVal - prevVal) / prevVal * 100).toFixed(1);
                  } else {
                    // Try equivalent col with pre_fy swap
                    const altCol = col.replace(/post_fy\d+/i, m => m.replace('post', 'pre'));
                    const altVal = parseNumber(prevRow[altCol]);
                    if (altVal > 0) growth = +((rawVal - altVal) / altVal * 100).toFixed(1);
                  }
                }

                segments.push({ name: segName, revenue: rawVal, percentage: 0, growth });
                totalSegRevenue += rawVal;
              }

              // Filter: find non-overlapping segment set that sums to ~100% of revenue
              if (segments.length > 0) {
                segments.sort((a, b) => b.revenue - a.revenue);
                const segSum = segments.reduce((s, seg) => s + seg.revenue, 0);

                // Find the best non-overlapping subset using brute-force for small N:
                // Try all subsets of size 2..8 and pick the one whose sum is closest to total revenue
                // For large segments lists, limit to greedy approach
                let bestSet: RevenueSegment[] = segments;
                const targetRev = segSum / 2; // If segments overlap, real total ≈ sum/factor
                // Actually use real total revenue if available
                const realTotal = revenue > 0 ? revenue : segSum;

                if (segSum > realTotal * 1.2 && segments.length <= 20) {
                  // Overlapping segments detected. Find best combination.
                  let bestDiff = Infinity;
                  // Try combinations of 2-6 segments
                  const N = segments.length;
                  for (let size = 2; size <= Math.min(8, N); size++) {
                    // Generate combinations using iterative approach
                    const indices = Array.from({ length: size }, (_, i) => i);
                    while (true) {
                      const comboSum = indices.reduce((s, idx) => s + segments[idx].revenue, 0);
                      const diff = Math.abs(comboSum - realTotal);
                      if (diff < bestDiff) {
                        bestDiff = diff;
                        bestSet = indices.map(idx => segments[idx]);
                      }
                      // Generate next combination
                      let i = size - 1;
                      while (i >= 0 && indices[i] === N - size + i) i--;
                      if (i < 0) break;
                      indices[i]++;
                      for (let j = i + 1; j < size; j++) indices[j] = indices[j - 1] + 1;
                    }
                  }
                }

                // Calculate percentages based on the set's own sum (so they add to ~100%)
                const setTotal = bestSet.reduce((s, seg) => s + seg.revenue, 0);
                for (const seg of bestSet) {
                  seg.percentage = +((seg.revenue / setTotal) * 100).toFixed(1);
                }
                bestSet.sort((a, b) => b.revenue - a.revenue);
                // Filter tiny (<2%) and cap at 8
                revenueSegments = bestSet.filter(s => s.percentage >= 2).slice(0, 8);
                console.log(`[ANALYZE] Parsed ${revenueSegments.length} revenue segments for ${ticker} (from ${segments.length} raw)`);
              }
            }
          }
        } catch (segErr: any) {
          console.error(`[ANALYZE] Segment parsing error:`, segErr?.message?.substring(0, 200));
        }
      }

      // === Structural trends ===
      const structuralTrends = [];
      if (sector.toLowerCase().includes("tech")) {
        structuralTrends.push("AI/ML adoption acceleration", "Cloud migration tailwind", "Digital transformation spend");
      } else if (sector.toLowerCase().includes("health")) {
        structuralTrends.push("Aging demographics", "Biotech innovation cycle", "Healthcare digitization");
      } else if (sector.toLowerCase().includes("financ")) {
        structuralTrends.push("Fintech disruption/adoption", "Rate normalization cycle", "Digital banking shift");
      } else if (sector.toLowerCase().includes("energy")) {
        structuralTrends.push("Energy transition", "Electrification trend", "Energy security focus");
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
        pegRatio: +pegRatio.toFixed(2),
        evEbitda: +evEbitda.toFixed(2),
        beta5Y,
        fcfTTM,
        fcfMargin: +fcfMargin.toFixed(2),
        revenue,
        ebitda,
        netIncome,
        totalDebt,
        cashEquivalents,
        enterpriseValue,

        historicalPrices,

        sectorAvgPE: sectorDefs.sectorAvgPE,
        sectorAvgEVEBITDA: sectorDefs.sectorAvgEVEBITDA,
        sectorAvgPEG: sectorDefs.sectorAvgPEG,

        moatRating,
        governmentExposure: govExp.exposure,
        growthThesis,
        structuralTrends,

        cycleClassification: sectorDefs.cycleClass,
        politicalCycle: sectorDefs.politicalCycle,

        sectorMaxDrawdown: sectorDefs.sectorMaxDrawdown,

        sectorProfile: {
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

        // OHLCV data (send all data — up to 5+ years for extended chart timeframes)
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

        // NEW: Revenue segments
        revenueSegments,
      };

      console.log(`[ANALYZE] Completed analysis for ${ticker}: $${price} (${companyName})`);
      res.json(analysis);
    } catch (error: any) {
      console.error("[ANALYZE] Error:", error?.message);
      res.status(500).json({ error: error?.message || "Analysis failed" });
    }
  });

  return server;
}
