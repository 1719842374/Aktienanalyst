/**
 * sector-data.ts
 * Pure sector/industry classification and defaults — no Express dependency.
 * Extracted from routes.ts (commit 1b386991) — zero logic changes.
 */

import type { Risk } from "../shared/schema";

// === Effective Sector Classification ===
export function getEffectiveSector(
  sector: string, industry: string, description: string
): { sector: string; industry: string; isHybrid: boolean; hybridNote: string } {
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
    if (phrase.includes("\\")) return new RegExp(phrase, "i").test(desc);
    return desc.includes(phrase);
  });

  const descLower = desc;
  const rawIndustryLower = ind;
  if (sector === 'Financial Services' && (
    descLower.includes('semiconductor') || descLower.includes('power semiconductor') ||
    descLower.includes('microcontroller') || descLower.includes('microchip') ||
    rawIndustryLower.includes('semiconductor') ||
    (rawIndustryLower.includes('fintech') && descLower.includes('chip'))
  )) {
    return { sector: 'Technology', industry: 'Semiconductors', isHybrid: false, hybridNote: '' };
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
    desc.includes('power semiconductor') || desc.includes('microchip') || ind.includes('semiconductor');

  // BUGFIX (live gefunden bei Xiaomi/XIACY, 04.08.2026): Die urspruengliche
  // Pruefung feuerte, sobald IRGENDEINE der generischen fintechPhrases (u.a.
  // "payment", "banking", "lending", "credit") IRGENDWO im Beschreibungstext
  // vorkam — unabhaengig davon, ob Fintech das Kerngeschaeft oder nur ein
  // Nebensegment ist. Xiaomis Beschreibung nennt "internet finance, consumer
  // lending, virtual banking ... electronic payment solutions" als EINE von
  // vielen Nebenaktivitaeten neben dem dominanten Smartphone-/IoT-Geschaeft —
  // das reichte, um den gesamten Sektor faelschlich auf "Financial Services /
  // FinTech" umzuklassifizieren. Das ist kein Xiaomi-Spezialfall: JEDES Tech-
  // Unternehmen mit einem Zahlungs-Nebengeschaeft (z.B. Apple Pay/Apple Card,
  // Samsung Pay) waere betroffen gewesen.
  //
  // Fix: (a) Hardware/Elektronik-Kernbegriffe haben Vorrang — wenn die
  // Beschreibung frueh und deutlich Hardware/Consumer-Electronics als
  // Kerngeschaeft nennt, greift die Fintech-Umklassifizierung NICHT, selbst
  // wenn spaeter ein Fintech-Nebensegment erwaehnt wird. (b) Die Fintech-
  // Phrasen muessen mehrfach vorkommen ODER explizit als "core business"/
  // "primarily"-Formulierung auftreten, nicht nur als beliebige Woerter
  // irgendwo im Fliesstext — ein einzelner beilaeufiger Treffer reicht nicht.
  const hardwareCorePhrases = [
    "smartphone", "consumer electronics", "iot", "hardware manufactur",
    "semiconductor", "chip design", "electronic devices", "mobile device",
  ];
  const hasHardwareCore = hardwareCorePhrases.some(p => desc.includes(p));

  const fintechPhrases = ["payment", "fintech", "buy now pay later", "bnpl", "merchant finance",
    "banking", "deposit", "lending", "credit", "consumer finance", "super app",
    "marketplace platform", "peer to peer payment"];
  const fintechMatchCount = fintechPhrases.filter(p => desc.includes(p)).length;
  const hasDominantFintechPhrase = /(primarily|core business|principally)[^.]{0,60}(fintech|payment|banking|lending)/.test(desc)
    || /(fintech|payment|banking|lending)[^.]{0,60}(primarily|core business|principally)/.test(desc);
  const hasFinTechCore = !hasHardwareCore && (fintechMatchCount >= 3 || hasDominantFintechPhrase);
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
export function getSectorDefaults(sector: string, industry: string): {
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
  if (s.includes("tech")) return { waccScenarios: { kons: 10.5, avg: 9.0, opt: 7.5 }, growthAssumptions: { g1: 15, g2: 10, terminal: 3 }, cycleClass: "Secular Growth", politicalCycle: "Low sensitivity – tech regulation risk moderate", sectorMaxDrawdown: 35, sectorAvgPE: 28, sectorAvgForwardPE: 24, sectorAvgEVEBITDA: 20, sectorAvgPEG: 1.5, sectorAvgPS: 6.0, sectorAvgPB: 8.0, sectorEPSGrowth: 15 };
  if (s.includes("health")) return { waccScenarios: { kons: 9.5, avg: 8.5, opt: 7.0 }, growthAssumptions: { g1: 10, g2: 7, terminal: 3 }, cycleClass: "Defensive / Non-Cyclical", politicalCycle: "High – healthcare policy, drug pricing reform", sectorMaxDrawdown: 25, sectorAvgPE: 22, sectorAvgForwardPE: 19, sectorAvgEVEBITDA: 15, sectorAvgPEG: 1.8, sectorAvgPS: 4.5, sectorAvgPB: 4.0, sectorEPSGrowth: 12 };
  if (s.includes("financ")) return { waccScenarios: { kons: 11.0, avg: 9.5, opt: 8.0 }, growthAssumptions: { g1: 8, g2: 5, terminal: 2.5 }, cycleClass: "Cyclical – Interest Rate Sensitive", politicalCycle: "High – banking regulation, monetary policy", sectorMaxDrawdown: 45, sectorAvgPE: 14, sectorAvgForwardPE: 13, sectorAvgEVEBITDA: 10, sectorAvgPEG: 1.3, sectorAvgPS: 3.0, sectorAvgPB: 1.5, sectorEPSGrowth: 8 };
  if (s.includes("energy")) return { waccScenarios: { kons: 12.0, avg: 10.0, opt: 8.5 }, growthAssumptions: { g1: 5, g2: 3, terminal: 2 }, cycleClass: "Deep Cyclical – Commodity Linked", politicalCycle: "Very High – energy policy, ESG mandates", sectorMaxDrawdown: 55, sectorAvgPE: 12, sectorAvgForwardPE: 11, sectorAvgEVEBITDA: 6, sectorAvgPEG: 1.0, sectorAvgPS: 1.2, sectorAvgPB: 1.8, sectorEPSGrowth: 5 };
  if (s.includes("consumer") && (s.includes("discr") || s.includes("cycl"))) {
    const i = industry.toLowerCase();
    const isLuxury = i.includes("luxury") || i.includes("apparel") || i.includes("fashion");
    if (isLuxury) return { waccScenarios: { kons: 9.5, avg: 8.0, opt: 6.5 }, growthAssumptions: { g1: 8, g2: 6, terminal: 2.5 }, cycleClass: "Cyclical – Luxury / Aspirational Spend", politicalCycle: "Moderate – tariffs, China demand, wealth effects", sectorMaxDrawdown: 40, sectorAvgPE: 25, sectorAvgForwardPE: 22, sectorAvgEVEBITDA: 16, sectorAvgPEG: 1.8, sectorAvgPS: 2.5, sectorAvgPB: 5.0, sectorEPSGrowth: 10 };
    return { waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 }, growthAssumptions: { g1: 12, g2: 8, terminal: 3 }, cycleClass: "Cyclical – Consumer Spending", politicalCycle: "Moderate – tariffs, consumer confidence", sectorMaxDrawdown: 40, sectorAvgPE: 24, sectorAvgForwardPE: 21, sectorAvgEVEBITDA: 16, sectorAvgPEG: 1.4, sectorAvgPS: 1.5, sectorAvgPB: 4.0, sectorEPSGrowth: 10 };
  }
  if (s.includes("consumer") && (s.includes("stapl") || s.includes("defens"))) return { waccScenarios: { kons: 8.5, avg: 7.5, opt: 6.5 }, growthAssumptions: { g1: 5, g2: 4, terminal: 2.5 }, cycleClass: "Defensive – Consumer Staples", politicalCycle: "Low – essential goods, moderate regulatory risk", sectorMaxDrawdown: 20, sectorAvgPE: 22, sectorAvgForwardPE: 20, sectorAvgEVEBITDA: 15, sectorAvgPEG: 2.2, sectorAvgPS: 2.0, sectorAvgPB: 5.5, sectorEPSGrowth: 6 };
  if (s.includes("commun")) return { waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 }, growthAssumptions: { g1: 10, g2: 7, terminal: 2.5 }, cycleClass: "Secular Growth / Communication", politicalCycle: "Moderate – content regulation, antitrust", sectorMaxDrawdown: 35, sectorAvgPE: 20, sectorAvgForwardPE: 17, sectorAvgEVEBITDA: 12, sectorAvgPEG: 1.4, sectorAvgPS: 2.0, sectorAvgPB: 3.5, sectorEPSGrowth: 10 };
  if (s.includes("industrial")) return { waccScenarios: { kons: 10.5, avg: 9.0, opt: 7.5 }, growthAssumptions: { g1: 8, g2: 5, terminal: 2.5 }, cycleClass: "Cyclical – Capex Cycle", politicalCycle: "Moderate – infrastructure spending, trade policy", sectorMaxDrawdown: 40, sectorAvgPE: 20, sectorAvgForwardPE: 18, sectorAvgEVEBITDA: 13, sectorAvgPEG: 1.5, sectorAvgPS: 3.0, sectorAvgPB: 2.0, sectorEPSGrowth: 5 };
  if (s.includes("real estate")) return { waccScenarios: { kons: 9.5, avg: 8.0, opt: 6.5 }, growthAssumptions: { g1: 5, g2: 3, terminal: 2 }, cycleClass: "Cyclical – Rate Sensitive", politicalCycle: "Moderate – housing policy, zoning", sectorMaxDrawdown: 45, sectorAvgPE: 35, sectorAvgForwardPE: 33, sectorAvgEVEBITDA: 20, sectorAvgPEG: 2.0, sectorAvgPS: 8.0, sectorAvgPB: 2.5, sectorEPSGrowth: 4 };
  if (s.includes("util")) return { waccScenarios: { kons: 8.0, avg: 7.0, opt: 6.0 }, growthAssumptions: { g1: 4, g2: 3, terminal: 2 }, cycleClass: "Defensive – Regulated", politicalCycle: "Moderate – utility regulation, clean energy mandates", sectorMaxDrawdown: 20, sectorAvgPE: 18, sectorAvgForwardPE: 16.5, sectorAvgEVEBITDA: 12, sectorAvgPEG: 2.5, sectorAvgPS: 3.0, sectorAvgPB: 3.0, sectorEPSGrowth: 8 };
  if (s.includes("material") || s.includes("mining") || s.includes("metal") || s.includes("steel") || s.includes("chemical") || s.includes("basic")) return { waccScenarios: { kons: 12.0, avg: 10.0, opt: 8.0 }, growthAssumptions: { g1: 5, g2: 3, terminal: 2 }, cycleClass: "Deep Cyclical – Commodity Linked", politicalCycle: "High – commodity prices, environmental regulation, trade tariffs", sectorMaxDrawdown: 60, sectorAvgPE: 14, sectorAvgForwardPE: 12, sectorAvgEVEBITDA: 8, sectorAvgPEG: 1.2, sectorAvgPS: 1.5, sectorAvgPB: 1.8, sectorEPSGrowth: 5 };
  return { waccScenarios: { kons: 10.0, avg: 8.5, opt: 7.0 }, growthAssumptions: { g1: 10, g2: 6, terminal: 2.5 }, cycleClass: "Mixed Cyclical", politicalCycle: "Moderate – general policy exposure", sectorMaxDrawdown: 35, sectorAvgPE: 20, sectorAvgForwardPE: 18, sectorAvgEVEBITDA: 14, sectorAvgPEG: 1.5, sectorAvgPS: 1.5, sectorAvgPB: 2.5, sectorEPSGrowth: 7 };
}

// === Generate risks ===
export function generateRisks(sector: string, beta: number, govExposure: number): Risk[] {
  const risks: Risk[] = [];
  const s = sector.toLowerCase();

  risks.push({ name: "Macro Recession / Demand Shock", category: "Correlated", ew: 20, impact: Math.round(15 + beta * 5), expectedDamage: 0 });
  risks.push({ name: "Earnings Miss / Guidance Cut", category: "Binary", ew: 25, impact: 15, expectedDamage: 0 });
  risks.push({ name: "Multiple Compression (Rising Rates)", category: "Gradual", ew: 30, impact: Math.round(10 + beta * 3), expectedDamage: 0 });

  if (s.includes("tech")) {
    risks.push({ name: "Regulatory / Antitrust Action", category: "Binary", ew: 15, impact: 20, expectedDamage: 0 });
    risks.push({ name: "Tech Disruption / Competitive Shift", category: "Gradual", ew: 20, impact: 25, expectedDamage: 0 });
  } else if (s.includes("health")) {
    risks.push({ name: "Drug Pricing Reform / Patent Cliff", category: "Binary", ew: 25, impact: 20, expectedDamage: 0 });
  } else if (s.includes("financ")) {
    risks.push({ name: "Credit Quality Deterioration", category: "Gradual", ew: 20, impact: 25, expectedDamage: 0 });
  } else if (s.includes("energy")) {
    risks.push({ name: "Commodity Price Collapse", category: "Binary", ew: 20, impact: 35, expectedDamage: 0 });
  } else if (s.includes("consumer") && (s.includes("cycl") || s.includes("discr"))) {
    risks.push({ name: "Consumer Spending Slowdown / China Weakness", category: "Gradual", ew: 30, impact: 20, expectedDamage: 0 });
    risks.push({ name: "Brand Dilution / Competitive Shift", category: "Gradual", ew: 15, impact: 15, expectedDamage: 0 });
  } else {
    risks.push({ name: "Competitive Pressure / Margin Erosion", category: "Gradual", ew: 25, impact: 15, expectedDamage: 0 });
  }

  if (govExposure > 20) {
    risks.push({ name: "Government Contract / Policy Dependency", category: "Gradual", ew: 30, impact: Math.round(govExposure * 0.5), expectedDamage: 0 });
  }

  for (const r of risks) r.expectedDamage = +(r.ew / 100 * r.impact).toFixed(2);
  return risks;
}

// === Government exposure estimation ===
export function estimateGovExposure(sector: string, industry: string, description: string): { exposure: number; detail: string } {
  const desc = description.toLowerCase();
  const ind = industry.toLowerCase();
  const sect = sector.toLowerCase();

  if (ind.includes("defense") || ind.includes("aerospace")) return { exposure: 60, detail: "Defense/Aerospace – high government contract dependency" };
  if (desc.includes("government") && desc.includes("contract")) return { exposure: 35, detail: "Significant government contract exposure noted in description" };
  if (ind.includes("drug manufacturers") || ind.includes("pharma")) return { exposure: 35, detail: "Pharma/Drug Manufacturer – US-Umsatz betroffen von Medicare Part D, Medicaid-Rabatte, IRA-Preisverhandlungen. Regulatorisches Preisrisiko." };
  if (ind.includes("health") && (desc.includes("medicare") || desc.includes("medicaid") || desc.includes("insulin") || desc.includes("diabetes") || desc.includes("obesity"))) return { exposure: 30, detail: "Healthcare mit Medicare/Medicaid-Exposure – Preisregulierungsrisiko (IRA, Medicaid Rebates)" };
  if (ind.includes("biotechnology")) return { exposure: 25, detail: "Biotech – FDA-Abhängigkeit und potenzielle Preisregulierung bei Blockbuster-Medikamenten" };
  if (ind.includes("health care plan") || ind.includes("managed health")) return { exposure: 40, detail: "Managed Healthcare – direkte Abhängigkeit von Medicare/Medicaid-Erstattungssätzen" };
  if (ind.includes("construction") || (ind.includes("infrastructure") && !sect.includes("tech"))) return { exposure: 25, detail: `${sector} sector – moderate public spending exposure` };
  if (sect.includes("utilities")) return { exposure: 20, detail: "Utilities – regulierte Preisgestaltung, Abhängigkeit von Energiepolitik" };
  return { exposure: 5, detail: "Minimal direct government revenue dependency" };
}

// === TAM Analysis ===
//
// A1 (Sprint A, WORK_TAM_SEGMENT_MAPPING.md) — Segment-TAM Qualitaetstor.
// matchSegmentTAMLegacy() ist die urspruengliche Implementierung (Name +
// Konzern-desc-Fallback). Sie bleibt unangetastet und wird weiterhin von
// generateTAMAnalysis() fuer den Konzern-Dummy-Pfad (< 2 Segmente) benutzt.
// matchSegmentTAM() (neu, siehe unten) ist der Soll-Zustand ohne desc-Fallback
// fuer den Segment-Mix-Pfad (>= 2 Segmente) und nutzt TAM_CATALOG/TAM_ALIASES.
export function matchSegmentTAMLegacy(segName: string, desc: string): { tamSize: number; tamLabel: string; tamCAGR: number; tamSource: string } {
  const n = segName.toLowerCase();
  if (n.includes('cloud') || n.includes('azure') || n.includes('aws') || n.includes('infrastructure')) return { tamSize: 1500, tamLabel: 'Global Cloud Computing', tamCAGR: 16, tamSource: 'Gartner/IDC Cloud Forecast' };
  if (n.includes('productiv') || n.includes('office') || n.includes('business process') || n.includes('collaboration')) return { tamSize: 600, tamLabel: 'Global Productivity & Collaboration Software', tamCAGR: 12, tamSource: 'Gartner SaaS/Productivity Forecast' };
  if (n.includes('casino') || n.includes('gambling') || n.includes('wager') || n.includes('slot') || n.includes('sportsbook') || n.includes('igaming') || n.includes('betting') || (n.includes('gaming') && (desc.includes('casino') || desc.includes('gambling') || desc.includes('gaming entertainment') || desc.includes('resort')))) return { tamSize: 700, tamLabel: 'Global Casino & Gaming', tamCAGR: 6, tamSource: 'H2 Gambling Capital / Statista iGaming' };
  if (n.includes('personal comput') || n.includes('windows') || n.includes('device') || n.includes('hardware') || n.includes('surface') || (n.includes('gaming') && !desc.includes('casino') && !desc.includes('gambling'))) return { tamSize: 400, tamLabel: 'Global PC & Gaming Market', tamCAGR: 3, tamSource: 'IDC/Gartner PC & Gaming Forecast' };
  if (n.includes('advertis') || n.includes('search') || n.includes('google services') || n.includes('youtube')) return { tamSize: 1000, tamLabel: 'Global Digital Advertising', tamCAGR: 10, tamSource: 'eMarketer / GroupM' };
  if (n.includes('commerce') || n.includes('retail') || n.includes('stores') || n.includes('online store')) return { tamSize: 6300, tamLabel: 'Global E-Commerce', tamCAGR: 11, tamSource: 'eMarketer / Statista' };
  if (n.includes('subscri') || n.includes('stream') || n.includes('content') || n.includes('media') || n.includes('entertainment')) {
    if ((n.includes('subscri') || n.includes('service')) && (desc.includes('semiconductor') || desc.includes('infrastructure software') || desc.includes('enterprise'))) return { tamSize: 600, tamLabel: 'Global Enterprise & Infrastructure Software', tamCAGR: 12, tamSource: 'Gartner Enterprise SW' };
    return { tamSize: 700, tamLabel: 'Global Streaming & Digital Media', tamCAGR: 9, tamSource: 'PwC Global Entertainment & Media' };
  }
  if (n.includes('auto') || n.includes('vehicle') || n.includes('mobility')) return { tamSize: 3000, tamLabel: 'Global Automotive', tamCAGR: 4, tamSource: 'McKinsey Automotive' };
  if (n.includes('financ') || n.includes('payment') || n.includes('banking') || n.includes('fintech')) return { tamSize: 350, tamLabel: 'Global FinTech', tamCAGR: 18, tamSource: 'BCG/QED FinTech' };
  if (n.includes('pharma') || n.includes('drug') || n.includes('oncol') || n.includes('vaccine') || n.includes('therapeutic')) return { tamSize: 1700, tamLabel: 'Global Pharmaceuticals', tamCAGR: 6, tamSource: 'IQVIA Pharma Forecast' };
  if (n.includes('fashion') || n.includes('leather') || n.includes('luxury') || n.includes('couture') || n.includes('apparel')) return { tamSize: 380, tamLabel: 'Global Personal Luxury Goods', tamCAGR: 6, tamSource: 'Bain / Altagamma' };
  if (n.includes('wine') || n.includes('spirit') || n.includes('champagne') || n.includes('cognac')) return { tamSize: 500, tamLabel: 'Global Premium Wines & Spirits', tamCAGR: 5, tamSource: 'IWSR Drinks Market' };
  if (n.includes('perfum') || n.includes('cosmet') || n.includes('beauty')) return { tamSize: 430, tamLabel: 'Global Prestige Beauty', tamCAGR: 7, tamSource: 'Euromonitor / NPD Beauty' };
  if (n.includes('watch') || n.includes('jewel') || n.includes('horolog')) return { tamSize: 100, tamLabel: 'Global Luxury Watches & Jewelry', tamCAGR: 5, tamSource: 'Bain / Deloitte Swiss Watch' };
  if (n.includes('retail') || n.includes('sephora') || n.includes('selective') || n.includes('dfs')) return { tamSize: 500, tamLabel: 'Global Selective/Specialty Retail', tamCAGR: 6, tamSource: 'Euromonitor Specialty Retail' };
  if (n.includes('semicond') || n.includes('chip') || n.includes('wafer') || n.includes('foundry')) return { tamSize: 850, tamLabel: 'Global Semiconductor', tamCAGR: 12, tamSource: 'WSTS/SIA' };
  if (n.includes('data center') || n.includes('datacenter') || n.includes('ai ') || n.includes('artificial intelligence') || n.includes('networking') || n.includes('infrastructure software')) return { tamSize: 500, tamLabel: 'Global AI/Data Center Infrastructure', tamCAGR: 25, tamSource: 'Gartner/IDC AI Infrastructure' };
  if (n.includes('broadband') || n.includes('wireless') || n.includes('connectivity') || n.includes('fiber')) return { tamSize: 300, tamLabel: 'Global Broadband & Connectivity', tamCAGR: 8, tamSource: "Dell'Oro / Omdia" };
  if (n.includes('storage') || n.includes('enterprise') || n.includes('mainframe') || n.includes('server')) return { tamSize: 250, tamLabel: 'Global Enterprise IT Infrastructure', tamCAGR: 6, tamSource: 'IDC Enterprise IT' };
  if (n.includes('upstream') || n.includes('downstream') || n.includes('refin') || n.includes('exploration')) return { tamSize: 4000, tamLabel: 'Global Energy', tamCAGR: 3, tamSource: 'IEA World Energy' };
  if (n.includes('space') || n.includes('launch') || n.includes('defense') || n.includes('aero')) return { tamSize: 800, tamLabel: 'Global Aerospace & Defense', tamCAGR: 5, tamSource: 'Deloitte A&D' };
  if (n.includes('food') || n.includes('beverage') || n.includes('restaurant') || n.includes('dining') || n.includes('catering')) return { tamSize: 4000, tamLabel: 'Global Foodservice & Restaurants', tamCAGR: 5, tamSource: 'Euromonitor / NRA' };
  if (n.includes('hotel') || n.includes('room') || n.includes('lodging') || n.includes('hospitality')) return { tamSize: 800, tamLabel: 'Global Hotel & Lodging', tamCAGR: 6, tamSource: 'STR / Phocuswright' };
  if (n.includes('management fee') || n.includes('management') || n.includes('service fee')) return { tamSize: 500, tamLabel: 'Global Asset/Property Management', tamCAGR: 5, tamSource: 'Industry Estimate' };
  if (n.includes('online') || n.includes('igaming') || n.includes('digital') || n.includes('interactive')) {
    if (desc.includes('casino') || desc.includes('gambling') || desc.includes('gaming entertainment') || desc.includes('sportsbook')) return { tamSize: 150, tamLabel: 'Global Online Gambling & iGaming', tamCAGR: 12, tamSource: 'H2 Gambling Capital / Statista' };
    return { tamSize: 1000, tamLabel: 'Global Digital Services', tamCAGR: 10, tamSource: 'Industry Estimate' };
  }
  if (desc.includes('cloud') || desc.includes('azure') || desc.includes('aws')) return { tamSize: 1500, tamLabel: 'Global Cloud Computing', tamCAGR: 16, tamSource: 'Gartner/IDC' };
  if (desc.includes('luxury')) return { tamSize: 380, tamLabel: 'Global Personal Luxury Goods', tamCAGR: 6, tamSource: 'Bain / Altagamma' };
  if (desc.includes('casino') || desc.includes('gambling') || desc.includes('gaming entertainment')) return { tamSize: 700, tamLabel: 'Global Casino & Gaming', tamCAGR: 6, tamSource: 'H2 Gambling Capital' };
  if (desc.includes('semiconductor') || desc.includes('chip')) return { tamSize: 850, tamLabel: 'Global Semiconductor', tamCAGR: 12, tamSource: 'WSTS/SIA' };
  if (desc.includes('pharmaceutical') || desc.includes('drug') || desc.includes('therapeutic')) return { tamSize: 1700, tamLabel: 'Global Pharmaceuticals', tamCAGR: 6, tamSource: 'IQVIA' };
  if (desc.includes('infrastructure software') || desc.includes('enterprise software')) return { tamSize: 600, tamLabel: 'Global Enterprise Software', tamCAGR: 12, tamSource: 'Gartner Enterprise SW' };
  return { tamSize: 2000, tamLabel: 'Global Industry', tamCAGR: 5, tamSource: 'Industry Estimate' };
}

// === A1: Segment-TAM Qualitaetstor (WORK_TAM_SEGMENT_MAPPING.md, Abschnitte 2-4) ===
//
// Ziel: Segment-TAM ist die Plausibilitaetsbremse fuer DCF-g, nicht eine
// Relativ-Kennzahl. Kein Fallback auf die Konzern-`description` mehr, weil das
// jedes ungemappte Segment (z.B. "Server", "XBOX", "LinkedIn") faelschlich in
// denselben Cloud/Azure-Pool wirft, sobald IRGENDEIN Konzernsegment Cloud
// enthaelt (siehe MSFT-Repro: $896B-Karte war ein Artefakt aus 5x demselben
// $1.500B-Cloud-Dummy). Unmatched -> matched:false, TAM/CAGR/Share null.

/** Schwellen fuer das Qualitaetstor (siehe assessTamQuality()). */
export const TAM_COVERAGE_MIN = 70;      // % Umsatz mit matched TAM
export const TAM_DISTINCT_LABELS_MIN = 2;
export const TAM_SHARE_WARN = 25;        // Segmentumsatz / TAM_i in %

export type TamQuality = 'ok' | 'weak' | 'unreliable';

/**
 * Neue, kleine TAM-Pools fuer Segmente, die sonst faelschlich in Cloud
 * (CLOUD) oder den generischen Konzern-Fallback fallen wuerden. Bewusst
 * konservativ/klein bemessen, damit Share nicht explodiert -- lieber N/A als
 * ein falscher Mini-Markt (siehe Spec 3.2). Bestehende Branchen-Eintraege
 * (Pharma, Semi, Luxury, ...) bleiben unangetastet in matchSegmentTAMLegacy().
 */
export const TAM_CATALOG = {
  CLOUD:            { tamSize: 1500, tamCAGR: 16, tamLabel: 'Global Cloud Computing', tamSource: 'Gartner/IDC Cloud Forecast' },
  PRODUCTIVITY:     { tamSize: 600,  tamCAGR: 12, tamLabel: 'Global Productivity & Collaboration Software', tamSource: 'Gartner SaaS/Productivity Forecast' },
  ENTERPRISE_APPS:  { tamSize: 400,  tamCAGR: 12, tamLabel: 'Global ERP/CRM & Enterprise Applications', tamSource: 'Gartner Enterprise Apps' },
  PC_GAMING:        { tamSize: 400,  tamCAGR: 3,  tamLabel: 'Global PC & Gaming Market', tamSource: 'IDC/Gartner PC & Gaming Forecast' },
  DIGITAL_ADS:      { tamSize: 1000, tamCAGR: 10, tamLabel: 'Global Digital Advertising', tamSource: 'eMarketer / GroupM' },
  TALENT:           { tamSize: 80,   tamCAGR: 8,  tamLabel: 'Global Talent Solutions & Professional Network', tamSource: 'Industry Estimate Recruiting/Talent' },
  ENTERPRISE_IT:    { tamSize: 250,  tamCAGR: 6,  tamLabel: 'Global Enterprise IT Infrastructure', tamSource: 'IDC Enterprise IT' },
  // bestehende Einträge Pharma, Semi, Luxury, Energy, … unverändert lassen (matchSegmentTAMLegacy)
} as const;

/** Normalisiert einen Segmentnamen fuer den Alias-Regex-Vergleich. */
export function normalizeSegmentKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bsegment\b/g, '')
    .trim();
}

/**
 * Alias-Tabelle, getestet gegen normalizeSegmentKey(name). Erstes Match
 * gewinnt -- Reihenfolge ist bewusst: laengster/spezifischster Alias zuerst,
 * generische Substrings danach. "infrastructure" darf NICHT vor Azure/Cloud
 * stehen und Cloud erzwingen, wenn der Name "server" ist. Erweiterbar (neues
 * Objekt anhaengen), Default-Verhalten ohne Treffer = N/A, NICHT Cloud.
 */
export const TAM_ALIASES: Array<{ test: RegExp; catalog: keyof typeof TAM_CATALOG }> = [
  // Cloud / Hyperscale — nur klare Cloud-Woerter
  { test: /\b(azure|aws|amazon web services|google cloud|gcp|intelligent cloud|public cloud)\b/, catalog: 'CLOUD' },
  { test: /\bcloud\b/, catalog: 'CLOUD' },

  // Productivity / M365
  { test: /\b(microsoft 365|office 365|m365|365 commercial|365 consumer)\b/, catalog: 'PRODUCTIVITY' },
  { test: /\b(office|productivity|collaboration|workplace)\b/, catalog: 'PRODUCTIVITY' },

  // Enterprise Apps (nicht Cloud)
  { test: /\b(dynamics|salesforce|erp|crm|business applications)\b/, catalog: 'ENTERPRISE_APPS' },
  { test: /\bbusiness process\b/, catalog: 'ENTERPRISE_APPS' },

  // Legacy server hardware / on-prem — NICHT Azure. Muss VOR der generischen
  // "windows"-Regel stehen, sonst faengt "windows" in "Windows Server" den
  // PC_GAMING/Device-Alias ab, bevor ENTERPRISE_IT drankommt (First-Match).
  // Bewusst NICHT "server" allein -> unmatched (N/A), nicht $250B / 51%
  // (siehe Spec 3.3).
  { test: /\b(windows server|sql server|on[- ]prem)\b/, catalog: 'ENTERPRISE_IT' },
  { test: /\b(mainframe|storage hardware)\b/, catalog: 'ENTERPRISE_IT' },

  // Gaming
  { test: /\b(xbox|playstation|nintendo|console)\b/, catalog: 'PC_GAMING' },
  { test: /\bgaming\b/, catalog: 'PC_GAMING' },

  // OS / Devices
  { test: /\b(windows|surface|personal comput|pc oem)\b/, catalog: 'PC_GAMING' },

  // Ads vs Talent — "linked ?in" deckt sowohl "LinkedIn" als auch die
  // FMP-Schreibweise "Linked In" (mit Leerzeichen) ab.
  { test: /\b(linked ?in|talent|recruiter|jobs network)\b/, catalog: 'TALENT' },
  { test: /\b(advertis|search ads|youtube ads|google services)\b/, catalog: 'DIGITAL_ADS' },
  { test: /\bsearch\b/, catalog: 'DIGITAL_ADS' },
];

/**
 * Soll-Zustand von matchSegmentTAM (Spec 3.4): reine Alias-Regelwerk-Funktion,
 * KEIN Fallback auf Konzern-`desc` mehr. `_desc` bleibt in der Signatur, damit
 * bestehende Aufrufer `matchSegmentTAM(name, desc)` kompilierbar bleiben --
 * der Parameter wird aber ignoriert (deprecated).
 */
export function matchSegmentTAM(
  segName: string,
  _desc?: string // deprecated, ignoriert — kein desc-Fallback mehr (Spec 2.1 #2)
): {
  matched: boolean;
  tamSize: number | null;
  tamLabel: string | null;
  tamCAGR: number | null;
  tamSource: string | null;
} {
  const key = normalizeSegmentKey(segName);
  for (const rule of TAM_ALIASES) {
    if (rule.test.test(key)) {
      const c = TAM_CATALOG[rule.catalog];
      return { matched: true, ...c };
    }
  }
  // KEIN: if (desc.includes('cloud')) … — genau das war der MSFT-Bug.
  return { matched: false, tamSize: null, tamLabel: null, tamCAGR: null, tamSource: null };
}

/**
 * Qualitaetstor fuer die Segment-TAM-Karte (Spec 2.2). Eine Funktion, die von
 * generateTAMAnalysis() UND vom DCF-Kopplungs-Layer gleich ausgewertet wird.
 */
export function assessTamQuality(input: {
  segments: Array<{ matched: boolean; tamLabel: string | null; segmentShare: number; marketShare: number | null }>;
  coveragePct: number; // Umsatzanteil mit matched === true
}): {
  quality: TamQuality;
  distinctLabels: number;
  coveragePct: number;
  highShareFlags: number;
  reasons: string[];
} {
  const matched = input.segments.filter(s => s.matched && s.tamLabel);
  const distinctLabels = new Set(matched.map(s => s.tamLabel as string)).size;
  const highShareFlags = matched.filter(s => (s.marketShare ?? 0) > TAM_SHARE_WARN).length;
  const reasons: string[] = [];

  if (input.coveragePct < TAM_COVERAGE_MIN) reasons.push(`coverage_${input.coveragePct}`);
  if (distinctLabels < TAM_DISTINCT_LABELS_MIN) reasons.push(`distinct_labels_${distinctLabels}`);
  if (highShareFlags > 0) reasons.push(`share_gt_25_x${highShareFlags}`);

  let quality: TamQuality = 'ok';
  if (input.coveragePct < TAM_COVERAGE_MIN || distinctLabels < TAM_DISTINCT_LABELS_MIN) quality = 'unreliable';
  else if (highShareFlags > 0) quality = 'weak';

  return { quality, distinctLabels, coveragePct: input.coveragePct, highShareFlags, reasons };
}

/**
 * DCF-Kopplung (Spec Abschnitt 5): Segment-CAGR darf `g1` nur dann deckeln,
 * wenn dasselbe Qualitaetstor gruen ist. Bei 'weak'/'unreliable': Konzern-g +
 * Reverse DCF, kein Segment-Freibrief fuer ein hoeheres g1.
 */
export function dcfGrowthCapFromTam(tam: {
  quality: TamQuality;
  tamCAGR: number | null;
  companyGrowth: number;
}): { useSegmentCagr: boolean; note: string } {
  if (tam.quality !== 'ok' || tam.tamCAGR == null) {
    return { useSegmentCagr: false, note: 'Konzern-g + Reverse DCF (Segment-TAM unreliable/weak)' };
  }
  return { useSegmentCagr: true, note: 'g1 ≤ max(companyGrowth, tamCAGR + share-shift Begründung)' };
}

export function generateTAMAnalysis(
  sector: string, industry: string, description: string,
  revenue: number, revenueGrowth: number,
  revenueSegments?: any[]
): {
  tamTotal: number | null; tamLabel: string; tamCAGR: number | null; companyGrowth: number;
  companyRevenue: number; marketShare: number | null; tamSource: string; outperforming: boolean | null;
  segments?: any[]; segmentWeightedGrowth?: number | null; segmentGrowthCoveragePct?: number;
  // A1 Qualitaetstor (additiv, siehe assessTamQuality()):
  quality?: TamQuality; distinctLabels?: number; coveragePct?: number; shareWarning?: boolean;
} {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();
  const revB = revenue / 1e9;

  let tamTotal = 0, tamLabel = '', tamCAGR = 0, tamSource = '';

  if (s.includes('tech')) {
    if (desc.includes('cloud') || desc.includes('azure') || desc.includes('aws')) { tamTotal = 1500; tamLabel = 'Global Cloud Computing'; tamCAGR = 16; tamSource = 'Gartner/IDC Cloud Forecast 2025-2030'; }
    else if (ind.includes('semiconductor') || desc.includes('semiconductor') || desc.includes('chip') || desc.includes('gpu')) { tamTotal = 850; tamLabel = 'Global Semiconductor'; tamCAGR = 12; tamSource = 'WSTS/SIA Semiconductor Forecast'; }
    else if (ind.includes('software') || desc.includes('saas')) { tamTotal = 900; tamLabel = 'Global Enterprise Software'; tamCAGR = 13; tamSource = 'Gartner Enterprise Software Forecast'; }
    else if (desc.includes('cybersecurity') || desc.includes('security')) { tamTotal = 300; tamLabel = 'Global Cybersecurity'; tamCAGR = 14; tamSource = 'MarketsandMarkets Cybersecurity Forecast'; }
    else { tamTotal = 5500; tamLabel = 'Global IT Spending'; tamCAGR = 8; tamSource = 'Gartner IT Spending Forecast'; }
  } else if (s.includes('health')) {
    if (desc.includes('biotech') || desc.includes('biopharm')) { tamTotal = 550; tamLabel = 'Global Biotech/Biopharma'; tamCAGR = 11; tamSource = 'EvaluatePharma / IQVIA'; }
    else if (desc.includes('medical device') || desc.includes('diagnostic')) { tamTotal = 600; tamLabel = 'Global Medical Devices'; tamCAGR = 7; tamSource = 'Fortune Business Insights MedTech'; }
    else if (ind.includes('drug') || desc.includes('pharmaceutical')) { tamTotal = 1700; tamLabel = 'Global Pharmaceuticals'; tamCAGR = 6; tamSource = 'IQVIA Pharma Market Forecast'; }
    else { tamTotal = 12000; tamLabel = 'Global Healthcare'; tamCAGR = 8; tamSource = 'WHO/Deloitte Healthcare Forecast'; }
  } else if (s.includes('financ')) {
    if (ind.includes('bank')) { tamTotal = 7000; tamLabel = 'Global Banking Revenue Pool'; tamCAGR = 5; tamSource = 'McKinsey Global Banking Revenue'; }
    else if (ind.includes('insurance')) { tamTotal = 6000; tamLabel = 'Global Insurance Premiums'; tamCAGR = 4; tamSource = 'Swiss Re Sigma / Allianz'; }
    else if (desc.includes('fintech') || desc.includes('payment')) { tamTotal = 350; tamLabel = 'Global FinTech'; tamCAGR = 18; tamSource = 'BCG/QED FinTech Report'; }
    else { tamTotal = 25000; tamLabel = 'Global Financial Services'; tamCAGR = 5; tamSource = 'McKinsey Global Financial Services'; }
  } else if (s.includes('consumer') && (s.includes('cycl') || s.includes('discr'))) {
    if (ind.includes('gambling') || ind.includes('casino') || ind.includes('resort') || desc.includes('casino') || desc.includes('gambling') || desc.includes('gaming entertainment')) { tamTotal = 700; tamLabel = 'Global Casino & Gaming'; tamCAGR = 6; tamSource = 'H2 Gambling Capital / Statista iGaming'; }
    else if (ind.includes('luxury') || desc.includes('luxury') || desc.includes('fashion')) { tamTotal = 380; tamLabel = 'Global Personal Luxury Goods'; tamCAGR = 6; tamSource = 'Bain & Company / Altagamma Luxury Report'; }
    else if (desc.includes('auto') || desc.includes('vehicle')) { tamTotal = 3000; tamLabel = 'Global Automotive'; tamCAGR = 4; tamSource = 'McKinsey Automotive Revenue Pool'; }
    else if (desc.includes('e-commerce') || desc.includes('online retail')) { tamTotal = 6300; tamLabel = 'Global E-Commerce'; tamCAGR = 11; tamSource = 'eMarketer / Statista E-Commerce'; }
    else if (ind.includes('restaurant') || desc.includes('restaurant') || desc.includes('dining')) { tamTotal = 4000; tamLabel = 'Global Restaurant & Foodservice'; tamCAGR = 5; tamSource = 'Euromonitor / NRA Foodservice'; }
    else if (ind.includes('travel') || ind.includes('hotel') || ind.includes('leisure') || desc.includes('hotel') || desc.includes('cruise')) { tamTotal = 2000; tamLabel = 'Global Travel & Leisure'; tamCAGR = 7; tamSource = 'Phocuswright / Euromonitor Travel'; }
    else { tamTotal = 15000; tamLabel = 'Global Consumer Discretionary'; tamCAGR = 5; tamSource = 'Euromonitor / McKinsey Consumer'; }
  } else if (s.includes('consumer') && (s.includes('stapl') || s.includes('defens'))) {
    tamTotal = 9000; tamLabel = 'Global Consumer Staples'; tamCAGR = 4; tamSource = 'Euromonitor Consumer Staples';
  } else if (s.includes('energy')) {
    if (desc.includes('renewable') || desc.includes('solar') || desc.includes('wind')) { tamTotal = 1200; tamLabel = 'Global Renewable Energy'; tamCAGR = 17; tamSource = 'BloombergNEF Energy Transition'; }
    else { tamTotal = 4000; tamLabel = 'Global Energy (O&G + Renewables)'; tamCAGR = 3; tamSource = 'IEA World Energy Outlook'; }
  } else if (s.includes('industrial')) {
    if (desc.includes('aerospace') || desc.includes('defense') || desc.includes('rocket') || desc.includes('launch')) { tamTotal = 800; tamLabel = 'Global Aerospace & Defense'; tamCAGR = 5; tamSource = 'Deloitte A&D Industry Outlook'; }
    else { tamTotal = 5000; tamLabel = 'Global Industrial Goods'; tamCAGR = 4; tamSource = 'McKinsey Industrial Sector Forecast'; }
  } else if (s.includes('commun')) {
    if (desc.includes('advertis') || desc.includes('social')) { tamTotal = 1000; tamLabel = 'Global Digital Advertising'; tamCAGR = 10; tamSource = 'eMarketer / GroupM Digital Ad Forecast'; }
    else { tamTotal = 2200; tamLabel = 'Global Media & Entertainment'; tamCAGR = 7; tamSource = 'PwC Global Entertainment & Media'; }
  } else if (s.includes('real estate')) {
    tamTotal = 4000; tamLabel = 'Global Commercial Real Estate'; tamCAGR = 4; tamSource = 'CBRE / JLL Real Estate Forecast';
  } else if (s.includes('util')) {
    tamTotal = 2500; tamLabel = 'Global Utilities'; tamCAGR = 4; tamSource = 'IEA / Deloitte Utilities Outlook';
  } else if (s.includes('material') || s.includes('mining') || s.includes('metal') || s.includes('steel') || s.includes('chemical') || s.includes('basic')) {
    tamTotal = 1200; tamLabel = 'Global Materials & Mining'; tamCAGR = 3; tamSource = 'BloombergNEF / Wood Mackenzie';
  } else {
    tamTotal = 5000; tamLabel = 'Global Market'; tamCAGR = 5; tamSource = 'IMF / World Bank GDP Growth Estimate';
  }

  if (revenueSegments && revenueSegments.length >= 2) {
    // A2 (WORK_TAM_RESIDUAL_XBOX.md, Abschnitt 2): Residuum-Regel VOR dem
    // Mapping anwenden -- genau EIN Rev-Loch darf als "Other / nicht
    // segmentiert"-Zeile ergaenzt werden, wenn die gemeldeten Segmente nicht
    // auf 100% des Konzernumsatzes summieren. Kein Hardcode: Umsatz kommt aus
    // der Differenz Konzernumsatz - Summe bekannter Segmentumsaetze.
    const knownRevB = revenueSegments.reduce((sum, seg) => sum + (Number(seg.revenue) || 0), 0) / 1e9;
    const knownPct = revenueSegments.reduce((sum, seg) => sum + (Number(seg.percentage) || 0), 0);
    const nHolesRev = revenueSegments.filter(seg => !(Number(seg.revenue) > 0)).length;
    const residualRev = revB - knownRevB;
    const residualMix = 100 - knownPct;

    let segmentsForMapping = revenueSegments;
    if (nHolesRev === 0 && residualMix > 0 && residualMix <= 15) {
      segmentsForMapping = [
        ...revenueSegments,
        {
          name: 'Other / nicht segmentiert',
          revenue: Math.max(0, residualRev) * 1e9,
          percentage: Math.round(residualMix * 100) / 100,
          growth: null,
          __isResidual: true,
        } as any,
      ];
    }
    // nHolesRev >= 2 (oder residualMix ausserhalb 0..15): nichts ableiten --
    // zwei Unbekannte sind nicht loesbar (Spec Abschnitt 2/3).

    const segTAMs = segmentsForMapping.map(seg => {
      const isResidual = (seg as any).__isResidual === true;
      const match = isResidual
        ? { matched: false, tamSize: null, tamLabel: null, tamCAGR: null, tamSource: null }
        : matchSegmentTAM(seg.name);
      const segRevB = seg.revenue / 1e9;
      const marketShare = match.matched && match.tamSize
        ? Math.round((segRevB / match.tamSize) * 10000) / 100
        : null;
      // segmentGrowth kommt aus fmpSegments()/fmpGeoSegments() (echte YoY-Rate
      // aus zwei Perioden). null = keine Vorjahreszahl -> UI zeigt "n/a".
      // NIEMALS auf 0 defaulten -- und NIEMALS aus einer unterbestimmten
      // Gleichung herleiten/invertieren (Xbox-Fall, Spec Abschnitt 3: zwei
      // Unbekannte sind nicht loesbar, das ist so gewollt).
      const segGrowth: number | null =
        !isResidual && typeof seg.growth === 'number' && isFinite(seg.growth) ? seg.growth : null;
      return {
        segmentName: seg.name,
        segmentRevenue: Math.round(segRevB * 10) / 10,
        segmentGrowth: segGrowth,
        segmentShare: seg.percentage,
        matched: match.matched,
        tamSize: match.tamSize,
        tamLabel: match.tamLabel,
        tamCAGR: match.tamCAGR,
        marketShare,
        outperforming: match.matched && segGrowth !== null && match.tamCAGR !== null
          ? segGrowth > match.tamCAGR
          : null,
        shareWarning: marketShare !== null && marketShare > TAM_SHARE_WARN,
      };
    });

    // Gewichtung NUR ueber matched-Zeilen (Spec 3.5), Mix auf Coverage renormiert.
    const matchedForWeight = segTAMs.filter(s => s.matched && s.tamSize && s.segmentShare > 0);
    const coveragePct = Math.round(matchedForWeight.reduce((sum, x) => sum + x.segmentShare, 0) * 100) / 100;

    const quality = assessTamQuality({ segments: segTAMs, coveragePct });

    const weightedTAM = quality.quality === 'unreliable' || coveragePct <= 0
      ? null
      : matchedForWeight.reduce((sum, x) => sum + (x.tamSize as number) * (x.segmentShare / coveragePct), 0);
    const weightedCAGR = quality.quality === 'unreliable' || coveragePct <= 0
      ? null
      : matchedForWeight.reduce((sum, x) => sum + (x.tamCAGR as number) * (x.segmentShare / coveragePct), 0);
    const weightedShare = weightedTAM !== null && weightedTAM > 0 ? (revB / weightedTAM) * 100 : null;

    // QS: gewichtetes Unternehmens-Wachstum aus den ECHTEN Segment-Raten
    // (Gewicht = Umsatzanteil). Segmente ohne Vorjahreszahl werden
    // ausgeschlossen und die Gewichte auf die verbleibende Basis renormiert,
    // damit fehlende Daten das Ergebnis nicht faelschlich Richtung 0 ziehen.
    const growthRows = segTAMs.filter(s => s.segmentGrowth !== null && s.segmentShare > 0);
    const growthWeightBase = growthRows.reduce((sum, s) => sum + s.segmentShare, 0);
    const segmentWeightedGrowth = growthWeightBase > 0
      ? Math.round((growthRows.reduce((sum, s) => sum + (s.segmentGrowth as number) * s.segmentShare, 0) / growthWeightBase) * 10) / 10
      : null;

    const tamSourceLabels = Array.from(new Set(
      matchedForWeight.map(s => (s.tamLabel || '').replace(/^Global /, '')).filter(Boolean)
    ));

    if (quality.quality === 'unreliable') {
      // Spec 3.5 / Abschnitt 4: Karte zeigt keinen (falschen) Konzern-TAM mehr.
      return {
        tamTotal: null,
        tamLabel: 'Segment-TAM unzuverlässig',
        tamCAGR: null,
        companyGrowth: revenueGrowth,
        companyRevenue: Math.round(revB * 10) / 10,
        marketShare: null,
        tamSource: tamSourceLabels.length > 0 ? tamSourceLabels.join(', ') : 'Mapping unvollständig',
        outperforming: null,
        segments: segTAMs,
        segmentWeightedGrowth,
        segmentGrowthCoveragePct: Math.round(growthWeightBase * 10) / 10,
        quality: quality.quality,
        distinctLabels: quality.distinctLabels,
        coveragePct,
        shareWarning: quality.highShareFlags > 0,
      } as any;
    }

    return {
      tamTotal: weightedTAM !== null ? Math.round(weightedTAM) : null,
      tamLabel: tamSourceLabels.length > 0 ? `Gewichtet: ${tamSourceLabels.join(' + ')}` : 'Segment-TAM',
      tamCAGR: weightedCAGR !== null ? Math.round(weightedCAGR * 10) / 10 : null,
      companyGrowth: revenueGrowth,
      companyRevenue: Math.round(revB * 10) / 10,
      marketShare: weightedShare !== null ? Math.round(weightedShare * 100) / 100 : null,
      tamSource: 'Segment-gewichteter TAM aus ' + (tamSourceLabels.length > 0 ? tamSourceLabels.join(', ') : 'n/a'),
      outperforming: weightedCAGR !== null ? revenueGrowth > weightedCAGR : null,
      segments: segTAMs,
      segmentWeightedGrowth,
      segmentGrowthCoveragePct: Math.round(growthWeightBase * 10) / 10,
      quality: quality.quality,
      distinctLabels: quality.distinctLabels,
      coveragePct,
      shareWarning: quality.highShareFlags > 0,
    } as any;
  }

  const marketShare = tamTotal > 0 ? (revB / tamTotal) * 100 : 0;
  // Pfad A (< 2 Segmente): Konzern-Dummy bleibt, aber als quality:'weak' und
  // distinctLabels:1 markiert (Spec 3.5, letzter Satz) -- kein Segment-Mix,
  // also kann das Qualitaetstor nie 'ok' sein.
  return {
    tamTotal, tamLabel, tamCAGR, companyGrowth: revenueGrowth,
    companyRevenue: Math.round(revB * 10) / 10,
    marketShare: Math.round(marketShare * 100) / 100,
    tamSource, outperforming: revenueGrowth > tamCAGR,
    quality: 'weak' as TamQuality,
    distinctLabels: 1,
    coveragePct: 100,
    shareWarning: false,
  } as any;
}
