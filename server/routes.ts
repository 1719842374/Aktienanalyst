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
  const fintechPhrases = ["payment", "fintech", "buy now pay later", "bnpl", "merchant finance",
    "banking", "deposit", "lending", "credit", "consumer finance", "super app",
    "marketplace platform", "peer to peer payment"];
  const hasFinTechCore = fintechPhrases.some(p => desc.includes(p));
  if (s.includes("tech") && hasFinTechCore && !hasTechCore) {
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
      sectorAvgPE: 28, sectorAvgEVEBITDA: 20, sectorAvgPEG: 1.5,
      sectorAvgPS: 6.0, sectorAvgPB: 8.0, sectorEPSGrowth: 15,
    };
  } else if (s.includes("health")) {
    return {
      waccScenarios: { kons: 9.5, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 10, g2: 7, terminal: 3 },
      cycleClass: "Defensive / Non-Cyclical",
      politicalCycle: "High – healthcare policy, drug pricing reform",
      sectorMaxDrawdown: 25,
      sectorAvgPE: 22, sectorAvgEVEBITDA: 15, sectorAvgPEG: 1.8,
      sectorAvgPS: 4.5, sectorAvgPB: 4.0, sectorEPSGrowth: 12,
    };
  } else if (s.includes("financ")) {
    return {
      waccScenarios: { kons: 11.0, avg: 9.5, opt: 8.0 },
      growthAssumptions: { g1: 8, g2: 5, terminal: 2.5 },
      cycleClass: "Cyclical – Interest Rate Sensitive",
      politicalCycle: "High – banking regulation, monetary policy",
      sectorMaxDrawdown: 45,
      sectorAvgPE: 14, sectorAvgEVEBITDA: 10, sectorAvgPEG: 1.3,
      sectorAvgPS: 3.0, sectorAvgPB: 1.5, sectorEPSGrowth: 8,
    };
  } else if (s.includes("energy")) {
    return {
      waccScenarios: { kons: 12.0, avg: 10.0, opt: 8.5 },
      growthAssumptions: { g1: 5, g2: 3, terminal: 2 },
      cycleClass: "Deep Cyclical – Commodity Linked",
      politicalCycle: "Very High – energy policy, ESG mandates",
      sectorMaxDrawdown: 55,
      sectorAvgPE: 12, sectorAvgEVEBITDA: 6, sectorAvgPEG: 1.0,
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
        sectorAvgPE: 25, sectorAvgEVEBITDA: 16, sectorAvgPEG: 1.8,
        sectorAvgPS: 2.5, sectorAvgPB: 5.0, sectorEPSGrowth: 10,
      };
    }
    return {
      waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 12, g2: 8, terminal: 3 },
      cycleClass: "Cyclical – Consumer Spending",
      politicalCycle: "Moderate – tariffs, consumer confidence",
      sectorMaxDrawdown: 40,
      sectorAvgPE: 24, sectorAvgEVEBITDA: 16, sectorAvgPEG: 1.4,
      sectorAvgPS: 1.5, sectorAvgPB: 4.0, sectorEPSGrowth: 10,
    };
  } else if (s.includes("consumer") && (s.includes("stapl") || s.includes("defens"))) {
    return {
      waccScenarios: { kons: 8.5, avg: 7.5, opt: 6.5 },
      growthAssumptions: { g1: 5, g2: 4, terminal: 2.5 },
      cycleClass: "Defensive – Consumer Staples",
      politicalCycle: "Low – essential goods, moderate regulatory risk",
      sectorMaxDrawdown: 20,
      sectorAvgPE: 22, sectorAvgEVEBITDA: 15, sectorAvgPEG: 2.2,
      sectorAvgPS: 2.0, sectorAvgPB: 5.5, sectorEPSGrowth: 6,
    };
  } else if (s.includes("commun")) {
    return {
      waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 10, g2: 7, terminal: 2.5 },
      cycleClass: "Secular Growth / Communication",
      politicalCycle: "Moderate – content regulation, antitrust",
      sectorMaxDrawdown: 35,
      sectorAvgPE: 20, sectorAvgEVEBITDA: 12, sectorAvgPEG: 1.4,
      sectorAvgPS: 2.0, sectorAvgPB: 3.5, sectorEPSGrowth: 10,
    };
  } else if (s.includes("industrial")) {
    return {
      waccScenarios: { kons: 10.5, avg: 9.0, opt: 7.5 },
      growthAssumptions: { g1: 8, g2: 5, terminal: 2.5 },
      cycleClass: "Cyclical – Capex Cycle",
      politicalCycle: "Moderate – infrastructure spending, trade policy",
      sectorMaxDrawdown: 40,
      sectorAvgPE: 20, sectorAvgEVEBITDA: 13, sectorAvgPEG: 1.5,
      sectorAvgPS: 3.0, sectorAvgPB: 2.0, sectorEPSGrowth: 5,
    };
  } else if (s.includes("real estate")) {
    return {
      waccScenarios: { kons: 9.5, avg: 8.0, opt: 6.5 },
      growthAssumptions: { g1: 5, g2: 3, terminal: 2 },
      cycleClass: "Cyclical – Rate Sensitive",
      politicalCycle: "Moderate – housing policy, zoning",
      sectorMaxDrawdown: 45,
      sectorAvgPE: 35, sectorAvgEVEBITDA: 20, sectorAvgPEG: 2.0,
      sectorAvgPS: 8.0, sectorAvgPB: 2.5, sectorEPSGrowth: 4,
    };
  } else if (s.includes("util")) {
    return {
      waccScenarios: { kons: 8.0, avg: 7.0, opt: 6.0 },
      growthAssumptions: { g1: 4, g2: 3, terminal: 2 },
      cycleClass: "Defensive – Regulated",
      politicalCycle: "Moderate – utility regulation, clean energy mandates",
      sectorMaxDrawdown: 20,
      sectorAvgPE: 18, sectorAvgEVEBITDA: 12, sectorAvgPEG: 2.5,
      sectorAvgPS: 3.0, sectorAvgPB: 3.0, sectorEPSGrowth: 8,
    };
  } else {
    return {
      waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 },
      growthAssumptions: { g1: 10, g2: 6, terminal: 2.5 },
      cycleClass: "Mixed Cyclical",
      politicalCycle: "Moderate – general policy exposure",
      sectorMaxDrawdown: 35,
      sectorAvgPE: 20, sectorAvgEVEBITDA: 14, sectorAvgPEG: 1.5,
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
    // Step 1: Get peer tickers via finance API
    console.log(`[PEERS] Fetching peers for ${ticker}`);
    const peersResult = callFinanceTool('finance_company_peers', {
      ticker_symbol: ticker,
      query: `Competitors of ${companyName}`,
      action: `Finding peer companies for ${ticker}`,
    });

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
    const ratiosResult = callFinanceTool('finance_company_ratios', {
      ticker_symbols: peerTickers,
      ratio_ids: ratioIds,
    });

    // Also get quotes for live P/E
    const quotesResult = callFinanceTool('finance_quotes', {
      ticker_symbols: peerTickers,
      fields: ['pe', 'marketCap', 'eps', 'price'],
    });

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
        for (const row of rows) {
          const date = row['date'] || '';
          for (const [key, val] of Object.entries(row)) {
            const kl = key.toLowerCase();
            const num = parseFloat(String(val).replace(/[,$%]/g, ''));
            if (isNaN(num)) continue;
            if (kl.includes('price_to_earnings') || kl.includes('p/e')) d.pe = num;
            if (kl.includes('price_to_sales') || kl.includes('p/s')) d.ps = num;
            if (kl.includes('price_to_book') || kl.includes('p/b')) d.pb = num;
            if (kl.includes('market_cap') || kl.includes('marketcap')) d.marketCap = num;
            if (kl.includes('diluted_eps') || kl.includes('eps')) {
              d.eps = num;
              if (date && num !== 0) d.epsHistory.push({ date, eps: num });
            }
          }
        }
      }
    }

    // Parse quotes for live data
    if (quotesResult?.content) {
      const content = typeof quotesResult.content === 'string' ? quotesResult.content : JSON.stringify(quotesResult.content);
      const rows = parseMarkdownTable(content);
      for (const row of rows) {
        const t = (row['Ticker'] || row['ticker'] || row['Symbol'] || '').replace(/[\*]/g, '').trim();
        if (!t) continue;
        if (!peerData.has(t)) peerData.set(t, {});
        const d = peerData.get(t)!;
        for (const [key, val] of Object.entries(row)) {
          const kl = key.toLowerCase();
          const num = parseFloat(String(val).replace(/[,$%B]/g, ''));
          if (kl === 'pe' || kl === 'p/e') d.pe = isNaN(num) ? d.pe : num;
          if (kl.includes('marketcap') || kl.includes('market_cap')) {
            // Handle B/T suffixes
            const raw = String(val).trim();
            if (raw.endsWith('T')) d.marketCap = parseFloat(raw) * 1e12;
            else if (raw.endsWith('B')) d.marketCap = parseFloat(raw) * 1e9;
            else if (!isNaN(num)) d.marketCap = num;
          }
          if (kl === 'eps') d.eps = isNaN(num) ? d.eps : num;
          if (kl === 'price') d.price = isNaN(num) ? null : num;
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
      const subjectRatiosResult = callFinanceTool('finance_company_ratios', {
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
      const estimatesResult = callFinanceTool('finance_estimates', {
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
    return {
      subject,
      peers: validPeers,
      peerAvg: {
        pe: avg(validPeers.map(p => p.pe)),
        peg: avg(validPeers.map(p => p.peg)),
        ps: avg(validPeers.map(p => p.ps)),
        pb: avg(validPeers.map(p => p.pb)),
        epsGrowth1Y: avg(validPeers.map(p => p.epsGrowth1Y)),
        epsGrowth5Y: avg(validPeers.map(p => p.epsGrowth5Y)),
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
async function matchNewsToCatalysts(
  newsItems: { title: string; source: string; pubDate: string; url: string; relativeTime: string; sentiment?: string; sentimentScore?: number; matchedCatalyst?: string; matchedCatalystIdx?: number }[],
  catalysts: Catalyst[],
  ticker: string,
  companyName: string
): Promise<void> {
  if (!newsItems.length || !catalysts.length) return;
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const catalystList = catalysts.map((c, i) => `K${i + 1}: ${c.name}`).join('\n');
    const newsList = newsItems.map((n, i) => `N${i + 1}: "${n.title}" (${n.source}, ${n.relativeTime})`).join('\n');

    const prompt = `You are a financial news analyst. For each news headline below, determine:
1. Sentiment: Is this news bullish, bearish, or neutral for ${companyName} (${ticker}) stock?
2. Sentiment score: -1.0 (very bearish) to +1.0 (very bullish), 0 = neutral
3. Catalyst match: Which catalyst (K1-K${catalysts.length}) does this news relate to? Use "none" if no match.

CATALYSTS:
${catalystList}

NEWS:
${newsList}

Respond with ONLY a JSON array, one object per news item:
[{"idx": 1, "sentiment": "bullish", "score": 0.6, "catalyst": "K1"}, ...]

JSON only, no explanation:`;

    const message = await client.messages.create({
      model: 'claude_sonnet_4_6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = ((message.content[0] as any)?.text || '').trim();
    let jsonStr = text;
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const results = JSON.parse(jsonStr);

    if (!Array.isArray(results)) return;

    // Apply sentiment to news items
    for (const r of results) {
      const newsIdx = (Number(r.idx) || 0) - 1;
      if (newsIdx < 0 || newsIdx >= newsItems.length) continue;
      const item = newsItems[newsIdx];
      item.sentiment = r.sentiment === 'bearish' ? 'bearish' : r.sentiment === 'bullish' ? 'bullish' : 'neutral';
      item.sentimentScore = Math.max(-1, Math.min(1, Number(r.score) || 0));

      // Match catalyst
      const catMatch = String(r.catalyst || 'none').match(/K(\d+)/i);
      if (catMatch) {
        const catIdx = parseInt(catMatch[1]) - 1;
        if (catIdx >= 0 && catIdx < catalysts.length) {
          item.matchedCatalyst = catalysts[catIdx].name;
          item.matchedCatalystIdx = catIdx;
        }
      }
    }

    // Aggregate sentiment per catalyst and adjust PoS
    for (let i = 0; i < catalysts.length; i++) {
      const matchedNews = newsItems.filter(n => n.matchedCatalystIdx === i);
      if (matchedNews.length === 0) continue;

      const avgScore = matchedNews.reduce((sum, n) => sum + (n.sentimentScore || 0), 0) / matchedNews.length;
      const cat = catalysts[i];
      cat.newsCount = matchedNews.length;
      cat.posOriginal = cat.pos;

      // Determine aggregated sentiment
      const bullish = matchedNews.filter(n => n.sentiment === 'bullish').length;
      const bearish = matchedNews.filter(n => n.sentiment === 'bearish').length;
      if (bullish > 0 && bearish > 0) cat.newsSentiment = 'mixed';
      else if (avgScore > 0.2) cat.newsSentiment = 'bullish';
      else if (avgScore < -0.2) cat.newsSentiment = 'bearish';
      else cat.newsSentiment = 'neutral';

      // PoS adjustment: ±3 to ±8 based on average sentiment score
      const adjustment = Math.round(avgScore * 7); // max ±7 points
      cat.posAdjustment = adjustment;
      cat.pos = Math.max(10, Math.min(85, cat.pos + adjustment));

      // Recalculate nettoUpside and gb with adjusted PoS
      cat.nettoUpside = +(cat.bruttoUpside * (1 - cat.einpreisungsgrad / 100)).toFixed(2);
      cat.gb = +(cat.pos / 100 * cat.nettoUpside).toFixed(2);
    }

    console.log(`[NEWS-SENTIMENT] Matched ${newsItems.filter(n => n.sentiment).length} news items to catalysts for ${ticker}`);
  } catch (err: any) {
    console.log(`[NEWS-SENTIMENT] LLM matching failed for ${ticker}: ${err?.message?.substring(0, 200)}`);
  }
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

// === Fallback: Sector-Template Catalysts (used when LLM is unavailable) ===
function generateCatalysts(sector: string, industry: string, growthRate: number, fcfMargin: number, description: string = '', revenue: number = 0): Catalyst[] {
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
    context: generateCatalystContext("Revenue Growth Acceleration", sector, industry, description, growthRate, fcfMargin, revenue),
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
    context: generateCatalystContext("Margin Expansion / Operating Leverage", sector, industry, description, growthRate, fcfMargin, revenue),
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
      context: "",
    });
    catalysts.push({
      name: "Product Cycle / Platform Expansion",
      timeline: "12-24M",
      pos: 45,
      bruttoUpside: 12,
      einpreisungsgrad: 30,
      nettoUpside: 0, gb: 0,
      context: "",
    });
  } else if (s.includes("health")) {
    catalysts.push({
      name: "Pipeline Approval / FDA Catalyst",
      timeline: "6-18M",
      pos: 35,
      bruttoUpside: 25,
      einpreisungsgrad: 20,
      nettoUpside: 0, gb: 0,
      context: "",
    });
    catalysts.push({
      name: "Demographic Tailwind (Aging Population)",
      timeline: "12-36M",
      pos: 70,
      bruttoUpside: 8,
      einpreisungsgrad: 55,
      nettoUpside: 0, gb: 0,
      context: "",
    });
  } else if (s.includes("financ")) {
    catalysts.push({
      name: "Interest Rate Normalization Benefit",
      timeline: "6-12M",
      pos: 50,
      bruttoUpside: 12,
      einpreisungsgrad: 40,
      nettoUpside: 0, gb: 0,
      context: "",
    });
    catalysts.push({
      name: "Capital Return / Buyback Program",
      timeline: "0-12M",
      pos: 65,
      bruttoUpside: 8,
      einpreisungsgrad: 50,
      nettoUpside: 0, gb: 0,
      context: "",
    });
  } else if (s.includes("energy")) {
    catalysts.push({
      name: "Commodity Price Recovery",
      timeline: "6-18M",
      pos: 40,
      bruttoUpside: 20,
      einpreisungsgrad: 25,
      nettoUpside: 0, gb: 0,
      context: "",
    });
    catalysts.push({
      name: "Energy Transition Investment",
      timeline: "12-36M",
      pos: 45,
      bruttoUpside: 15,
      einpreisungsgrad: 20,
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
        einpreisungsgrad: 30,
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "Pricing Power / Brand Elevation",
        timeline: "12-24M",
        pos: 55,
        bruttoUpside: 10,
        einpreisungsgrad: 40,
        nettoUpside: 0, gb: 0,
        context: "",
      });
    } else if (isCasino) {
      catalysts.push({
        name: "iGaming / Online Sports Betting Expansion",
        timeline: "12-24M",
        pos: 50,
        bruttoUpside: 15,
        einpreisungsgrad: 30,
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "New Property Openings / Capacity Expansion",
        timeline: "12-36M",
        pos: 40,
        bruttoUpside: 12,
        einpreisungsgrad: 25,
        nettoUpside: 0, gb: 0,
        context: "",
      });
    } else if (isRestaurant) {
      catalysts.push({
        name: "Same-Store Sales Recovery / Menu Pricing",
        timeline: "6-12M",
        pos: 50,
        bruttoUpside: 10,
        einpreisungsgrad: 40,
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "Unit Growth / Franchise Expansion",
        timeline: "12-24M",
        pos: 45,
        bruttoUpside: 12,
        einpreisungsgrad: 30,
        nettoUpside: 0, gb: 0,
        context: "",
      });
    } else if (isTravel) {
      catalysts.push({
        name: "Travel Demand Recovery / RevPAR Growth",
        timeline: "6-18M",
        pos: 50,
        bruttoUpside: 12,
        einpreisungsgrad: 35,
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "Loyalty Program Monetization",
        timeline: "12-24M",
        pos: 45,
        bruttoUpside: 10,
        einpreisungsgrad: 30,
        nettoUpside: 0, gb: 0,
        context: "",
      });
    } else if (isAuto) {
      catalysts.push({
        name: "EV Transition / New Model Cycle",
        timeline: "12-24M",
        pos: 45,
        bruttoUpside: 15,
        einpreisungsgrad: 35,
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "Supply Chain Normalization / Volume Recovery",
        timeline: "6-18M",
        pos: 50,
        bruttoUpside: 10,
        einpreisungsgrad: 40,
        nettoUpside: 0, gb: 0,
        context: "",
      });
    } else {
      catalysts.push({
        name: "Consumer Confidence Recovery",
        timeline: "6-18M",
        pos: 45,
        bruttoUpside: 12,
        einpreisungsgrad: 35,
        nettoUpside: 0, gb: 0,
        context: "",
      });
      catalysts.push({
        name: "E-Commerce / DTC Growth",
        timeline: "12-24M",
        pos: 50,
        bruttoUpside: 10,
        einpreisungsgrad: 30,
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
      einpreisungsgrad: 30,
      nettoUpside: 0, gb: 0,
      context: "",
    });
    catalysts.push({
      name: "Strategic M&A / Partnerships",
      timeline: "6-18M",
      pos: 30,
      bruttoUpside: 15,
      einpreisungsgrad: 15,
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
import * as fs from 'fs';
import * as path from 'path';
const CACHE_DIR = path.join(process.cwd(), '.cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function getCachedAnalysis(ticker: string): any | null {
  try {
    const file = path.join(CACHE_DIR, `${ticker.replace(/[^a-zA-Z0-9.]/g, '_')}.json`);
    if (!fs.existsSync(file)) return null;
    const stat = fs.statSync(file);
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    data._cached = true;
    data._cacheAge = Math.round((Date.now() - stat.mtimeMs) / 60000); // minutes
    data._cacheDate = new Date(stat.mtimeMs).toISOString();
    return data;
  } catch { return null; }
}

function saveCachedAnalysis(ticker: string, data: any) {
  try {
    const file = path.join(CACHE_DIR, `${ticker.replace(/[^a-zA-Z0-9.]/g, '_')}.json`);
    const toCache = { ...data };
    delete toCache._cached;
    delete toCache._cacheAge;
    delete toCache._cacheDate;
    fs.writeFileSync(file, JSON.stringify(toCache));
  } catch (err: any) {
    console.log(`[CACHE] Failed to save ${ticker}: ${err?.message?.substring(0, 100)}`);
  }
}

export async function registerRoutes(server: Server, app: Express) {
  // Register gold analysis routes
  const { registerGoldRoutes } = await import("./gold-routes");
  registerGoldRoutes(server, app);

  // Register recession analysis routes
  const { registerRecessionRoutes } = await import("./recession");
  registerRecessionRoutes(app);

  // Cache listing endpoint
  app.get("/api/cache", (_req, res) => {
    try {
      const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json') && f !== 'watchlist.json');
      const items = files.map(f => {
        const stat = fs.statSync(path.join(CACHE_DIR, f));
        return {
          ticker: f.replace('.json', ''),
          cachedAt: new Date(stat.mtimeMs).toISOString(),
          ageMinutes: Math.round((Date.now() - stat.mtimeMs) / 60000),
          sizeKB: Math.round(stat.size / 1024),
        };
      });
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
    try {
      const parsed = analyzeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid ticker" });
      }
      const ticker = parsed.data.ticker;
      const useLLM = parsed.data.useLLM === true;
      console.log(`[ANALYZE] Starting analysis for ${ticker}${useLLM ? ' [LLM ON]' : ''}...`);

      // === Parallel API calls ===
      const [quoteResult, profileResult, financialsResult, analystResult, estimatesResult, ohlcvHistResult, segmentsResult, newsResult] = await Promise.all([
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
        // 6. OHLCV 10+ years daily data (for MA200 we need 200+ days, user wants up to 10Y chart)
        (async () => {
          const endDate = new Date().toISOString().split('T')[0];
          const startDate = new Date(Date.now() - 11 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
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
        // 8. News / Key Projects (via Polygon news endpoint)
        (async () => {
          try {
            return callFinanceTool("finance_massive", {
              pathname: `/v2/reference/news`,
              params: { ticker, limit: 10, order: "desc" },
            });
          } catch { return null; }
        })(),
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
        // Try cache before returning 404
        const cached404 = getCachedAnalysis(ticker);
        if (cached404) {
          console.log(`[ANALYZE] No live data for ${ticker}, serving cache (age: ${cached404._cacheAge}min)`);
          return res.json(cached404);
        }
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
      if (useLLM) {
        // LLM-powered company-specific catalysts + news-sentiment matching
        const llmCatalysts = await generateLLMCatalysts(
          ticker, companyName, sector, industry, description,
          revenue, revenueGrowth, fcfMargin, price, pe, marketCap,
          keyProjects, secFilingExcerpts, newsHeadlines
        );
        if (llmCatalysts && llmCatalysts.length >= 3) {
          catalysts = llmCatalysts;
          console.log(`[ANALYZE] Using LLM-generated catalysts for ${ticker}`);
        } else {
          catalysts = generateCatalysts(sector, industry, revenueGrowth, fcfMargin, description, revenue);
          console.log(`[ANALYZE] LLM failed, using sector-template catalysts for ${ticker}`);
        }
        // News-Sentiment-Catalyst Matching (also LLM)
        if (newsItems.length > 0 && catalysts.length > 0) {
          await matchNewsToCatalysts(newsItems, catalysts, ticker, companyName);
        }
      } else {
        // Fast path: sector-template catalysts, no LLM
        catalysts = generateCatalysts(sector, industry, revenueGrowth, fcfMargin, description, revenue);
        console.log(`[ANALYZE] Using sector-template catalysts for ${ticker} (LLM off)`);
      }

      const risks = generateRisks(sector, beta5Y, govExp.exposure);
      // tamAnalysis is computed after revenueSegments are parsed (below)

      // === Growth thesis (enriched with catalyst business model reasoning) ===
      const hybridPrefix = sectorHybridNote ? `⚠️ ${sectorHybridNote} ` : "";
      let growthThesis = "";
      if (revenueGrowth > 20) growthThesis = `Starkes Revenue-Wachstum von ${revenueGrowth.toFixed(1)}% getrieben durch säkulare Nachfrage und Marktexpansion.`;
      else if (revenueGrowth > 10) growthThesis = `Solides Revenue-Wachstum von ${revenueGrowth.toFixed(1)}% mit Spielraum für Operating Leverage und Margenexpansion.`;
      else if (revenueGrowth > 0) growthThesis = `Moderates Revenue-Wachstum von ${revenueGrowth.toFixed(1)}% – Bewertung hängt von Margenverbesserung und Kapitalrückflüssen ab.`;
      else growthThesis = `Revenue rückläufig bei ${revenueGrowth.toFixed(1)}% – benötigt Restrukturierung oder neuen Wachstumsvektor.`;
      growthThesis = hybridPrefix + growthThesis;

      // Add catalyst reasoning to growth thesis
      if (useLLM && catalysts.length > 0 && catalysts[0]?.context) {
        const topCats = catalysts.slice(0, 3).map(c => c.name).join(', ');
        const firstCtx = catalysts[0]?.context ? ' ' + catalysts[0].context.split('.')[0] + '.' : '';
        growthThesis += ` Katalysator: ${topCats}.${firstCtx}`;
      } else {
        // Fallback: generic sector reasoning
        const sLower = sector.toLowerCase();
        if (sLower.includes("tech")) {
          growthThesis += " Katalysator: KI-Integration, Cloud-Expansion und neue Verticals ermöglichen Cross-Selling und höhere Margen.";
        } else if (sLower.includes("health")) {
          growthThesis += " Katalysator: Pipeline-Fortschritte, Biologika-Expansion und demografischer Rückenwind bieten strukturelles Wachstum.";
        } else if (sLower.includes("financ")) {
          growthThesis += " Katalysator: Zinsnormalisierung und Digitalisierung verbessern Net Interest Income.";
        } else if (sLower.includes("energy")) {
          growthThesis += " Katalysator: Energy Security-Investments und Transition-Projekte diversifizieren Umsatz.";
        } else {
          growthThesis += " Katalysator: Strategische Initiativen und operative Effizienzsteigerungen können Margen verbessern.";
        }
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
        pegRatio: +pegRatio.toFixed(2),
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
      // Save to cache on success
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
      res.json(analysis);
    } catch (error: any) {
      console.error("[ANALYZE] Error:", error?.message);
      // Try to serve cached data as fallback
      const cached = getCachedAnalysis(ticker);
      if (cached) {
        console.log(`[ANALYZE] Serving cached data for ${ticker} (age: ${cached._cacheAge}min)`);
        return res.json(cached);
      }
      res.status(500).json({ error: error?.message || "Analysis failed" });
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
        try { execSync("sleep 2", { timeout: 5000 }); } catch {}
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
    for (const h of holdings) {
      if (h.ticker) continue;
      const nameUp = h.name.toUpperCase();
      for (const [key, val] of Object.entries(commonTickers)) {
        if (nameUp.includes(key) || key.includes(nameUp.substring(0, 10))) {
          h.ticker = val;
          break;
        }
      }
    }
  }

  app.get('/api/screener', async (_req, res) => {
    try {
      // Check cache
      if (screenerCache && (Date.now() - screenerCache.timestamp < SCREENER_CACHE_TTL)) {
        console.log('[SCREENER] Returning cached data');
        return res.json(screenerCache.data);
      }

      console.log(`[SCREENER] Fetching 13F holdings from ${STAR_INVESTORS.length} star investors...`);

      // Fetch all 13F holdings in parallel (with rate limiting — SEC allows 10 req/sec)
      const allHoldings: { ticker: string; name: string; value: number; shares: number; investor: string }[] = [];
      for (const inv of STAR_INVESTORS) {
        const holdings = await fetch13FHoldings(inv.cik, inv.name);
        allHoldings.push(...holdings);
        await new Promise(r => setTimeout(r, 200)); // Rate limit: 5/sec
      }

      console.log(`[SCREENER] Total raw holdings: ${allHoldings.length}`);

      // Resolve tickers
      await resolveTickersForHoldings(allHoldings);

      // Aggregate: group by company name, count unique investors, sum values
      const agg = new Map<string, {
        name: string; ticker: string; totalValue: number; totalShares: number;
        investors: Set<string>; investorList: string[];
      }>();
      for (const h of allHoldings) {
        const key = h.name.toUpperCase().substring(0, 20); // Normalize name
        const existing = agg.get(key);
        if (existing) {
          existing.totalValue += h.value;
          existing.totalShares += h.shares;
          existing.investors.add(h.investor);
          if (!existing.investorList.includes(h.investor)) existing.investorList.push(h.investor);
          if (h.ticker && !existing.ticker) existing.ticker = h.ticker;
        } else {
          agg.set(key, {
            name: h.name,
            ticker: h.ticker,
            totalValue: h.value,
            totalShares: h.shares,
            investors: new Set([h.investor]),
            investorList: [h.investor],
          });
        }
      }

      // Convert to sorted array — top holdings by investor count then value
      let results = Array.from(agg.values())
        .filter(h => h.ticker) // Only include stocks with resolved tickers
        .map(h => ({
          ticker: h.ticker,
          name: h.name,
          investorCount: h.investors.size,
          investors: h.investorList,
          totalValue: h.totalValue,
          totalShares: h.totalShares,
        }))
        .sort((a, b) => b.investorCount - a.investorCount || b.totalValue - a.totalValue)
        .slice(0, 30); // Top 30

      // For each stock, run a quick valuation using the finance API
      // Batch tickers for efficiency (finance tools accept multiple tickers)
      console.log(`[SCREENER] Running quick valuation on ${results.length} stocks...`);
      const allTickers = results.map(r => r.ticker);
      let quotesMap: Record<string, any> = {};
      let statsMap: Record<string, any> = {};
      try {
        // Fetch quotes with all key fields for all tickers at once
        const qRes = callFinanceTool('finance_quotes', {
          ticker_symbols: allTickers,
          fields: ['price', 'marketCap', 'pe', 'eps', 'yearLow', 'yearHigh', 'previousClose', 'change', 'changesPercentage', 'volume'],
        });
        if (qRes?.content) {
          const rows = parseMarkdownTable(qRes.content);
          for (const row of rows) {
            const t = row.ticker || row.symbol || '';
            if (t) quotesMap[t] = row;
          }
        }
        // Fetch company profiles for sector, beta, target price, forwardPE
        const pRes = callFinanceTool('finance_company_profile', { ticker_symbols: allTickers });
        if (pRes?.content) {
          const rows = parseMarkdownTable(pRes.content);
          for (const row of rows) {
            const t = row.ticker || row.symbol || '';
            if (t) statsMap[t] = row;
          }
        }
      } catch (batchErr: any) {
        console.error('[SCREENER] Batch fetch error:', batchErr?.message?.substring(0, 100));
      }

      const screenedStocks = [];
      for (const stock of results) {
        try {
          const quote = quotesMap[stock.ticker] || {};
          const profile = statsMap[stock.ticker] || {};

          // Quotes give us price, PE, MCap, yearHigh/Low
          const price = parseNumber(quote.price || quote.previousClose) || 0;
          const pe = parseNumber(quote.pe || profile.pe || profile.trailingPE) || 0;
          const fwdPE = parseNumber(profile.forwardPE || profile.fwdPE) || 0;
          const marketCap = parseNumber(quote.marketCap || profile.marketCap || profile.mktCap) || 0;
          const beta = parseNumber(profile.beta || profile.beta5Y) || 1.2;
          const yearHigh = parseNumber(quote.yearHigh || profile.range?.split('-')?.[1]) || price * 1.3;
          const yearLow = parseNumber(quote.yearLow || profile.range?.split('-')?.[0]) || price * 0.7;
          const targetPrice = parseNumber(profile.targetMeanPrice || profile.analystTargetPrice || profile.dcfDiff) || 0;
          const fcfMargin = parseNumber(profile.freeCashFlowMargin) || 0;
          const sector = profile.sector || profile.industry || 'Unknown';

          // Quick CRV calculation
          // Upside from analyst target, or if unavailable, distance to 52W high as proxy
          let upside = targetPrice > 0 ? ((targetPrice - price) / price) * 100 : 0;
          if (upside === 0 && yearHigh > price) {
            upside = ((yearHigh - price) / price) * 100; // Use 52W high as recovery target
          }
          // Downside from historical drawdown or distance to 52W low
          const drawdownFromHigh = yearHigh > 0 ? ((yearHigh - price) / yearHigh) * 100 : 20;
          const distToLow = price > 0 ? ((price - yearLow) / price) * 100 : 25;
          const worstCase = Math.max(distToLow, beta * 25);
          const crv = worstCase > 0 ? upside / worstCase : 0;

          screenedStocks.push({
            ticker: stock.ticker,
            name: stock.name,
            price,
            marketCap,
            pe,
            forwardPE: fwdPE,
            sector,
            beta,
            investorCount: stock.investorCount,
            investors: stock.investors,
            totalValue: stock.totalValue,
            targetPrice,
            upside: Math.round(upside * 10) / 10,
            downside: Math.round(worstCase * 10) / 10,
            crv: Math.round(crv * 100) / 100,
            crvPass: crv >= 3.0,
            yearHigh,
            yearLow,
            fcfMargin,
          });
        } catch (err: any) {
          console.log(`[SCREENER] Failed to value ${stock.ticker}: ${err?.message?.substring(0, 50)}`);
        }
      }

      // Sort final results by CRV descending
      screenedStocks.sort((a, b) => b.crv - a.crv);

      const result = {
        lastUpdated: new Date().toISOString(),
        totalInvestors: STAR_INVESTORS.length,
        totalHoldings: allHoldings.length,
        screenedStocks,
      };

      screenerCache = { data: result, timestamp: Date.now() };
      console.log(`[SCREENER] Complete. ${screenedStocks.length} stocks screened. ${screenedStocks.filter(s => s.crvPass).length} pass CRV 3:1.`);
      res.json(result);
    } catch (error: any) {
      console.error('[SCREENER] Error:', error?.message);
      res.status(500).json({ error: error?.message || 'Screener failed' });
    }
  });

  return server;
}
