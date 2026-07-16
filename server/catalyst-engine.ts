/**
 * catalyst-engine.ts
 * Catalyst generation, einpreisungsgrad calculation, Lynch classification.
 * Extracted from routes.ts (commit 1b386991) — zero logic changes.
 */

import type { Catalyst } from "../shared/schema";

// === Reverse-DCF helpers ===
export function calcImpliedGStar(params: { price: number; sharesOutstanding: number; netDebt: number; fcf: number; wacc: number }): number | null {
  const { price, sharesOutstanding, netDebt, fcf, wacc } = params;
  const ev = price * sharesOutstanding + netDebt;
  if (!(ev > 0) || !isFinite(ev) || !(wacc > 0)) return null;
  const impliedGrowth = (wacc / 100 - fcf / ev) * 100;
  return isFinite(impliedGrowth) ? impliedGrowth : null;
}

export function calcEinpreisungsgrad(params: {
  bruttoUpside: number; price: number; sharesOutstanding: number;
  netDebt: number; fcf: number; wacc: number;
  revenueGrowth: number; catalystType?: string;
}): number {
  const { bruttoUpside, price, sharesOutstanding, netDebt, fcf, wacc, revenueGrowth, catalystType } = params;
  const gStar = calcImpliedGStar({ price, sharesOutstanding, netDebt, fcf, wacc });
  if (gStar !== null && bruttoUpside > 0) {
    const einpreisungsgrad = Math.max(0, gStar) / bruttoUpside;
    return Math.round(Math.max(0.15, Math.min(0.70, einpreisungsgrad)) * 100);
  }
  const growthFactor = Math.min(revenueGrowth / 30, 1.0);
  const baseRate: Record<string, number> = {
    growth:  35 + Math.round(growthFactor * 20),
    margin:  30 + Math.round(growthFactor * 15),
    product: 25 + Math.round(growthFactor * 15),
    ai:      45 + Math.round(growthFactor * 20),
    macro:   35,
  };
  return baseRate[catalystType || 'growth'] ?? 35;
}

// === Lynch Classification ===
export type LynchClass = 'slow_grower' | 'stalwart' | 'fast_grower' | 'cyclical' | 'turnaround' | 'asset_play';

export function classifyLynch(params: {
  epsGrowth5Y: number; revenueGrowth: number; sector: string; industry: string;
  dividendYield: number; fcfMargin: number; pe: number; forwardPE: number; pbRatio?: number;
}): LynchClass {
  const { epsGrowth5Y, revenueGrowth, sector, industry, dividendYield, pe, forwardPE, pbRatio = 0 } = params;
  const growthRate = epsGrowth5Y > 0 ? epsGrowth5Y : revenueGrowth;
  const sectorLower = (sector + ' ' + industry).toLowerCase();
  const isCyclicalSector = ['semiconductor', 'energy', 'oil', 'gas', 'material', 'chemical', 'steel', 'mining', 'auto', 'automotive', 'chip'].some(s => sectorLower.includes(s));
  const hasCyclicalPEPattern = pe > 0 && forwardPE > 0 && pe / forwardPE > 1.5;
  const isHealthcareSector = sectorLower.includes('health') || sectorLower.includes('pharma') || sectorLower.includes('biotech');
  if (!isHealthcareSector && (isCyclicalSector || hasCyclicalPEPattern)) return 'cyclical';
  if (pbRatio > 0 && pbRatio < 1.5 && pe > 0) return 'asset_play';
  if (pe <= 0 && forwardPE > 0) return 'turnaround';
  if (epsGrowth5Y < -15 && forwardPE > 0 && forwardPE < 40) return 'turnaround';
  if (growthRate >= 20) return 'fast_grower';
  if (growthRate < 5 || (growthRate < 8 && dividendYield > 2)) return 'slow_grower';
  return 'stalwart';
}

export function calcLynchPEG(params: {
  lynchClass: LynchClass; pe: number; forwardPE: number;
  epsGrowth5Y: number; epsGrowthFwd: number; revenueGrowth: number;
  dividendYield: number; epsPeak?: number; epsTrough?: number; price?: number;
}): { peg: number | null; pegBasis: string } {
  const { lynchClass, pe, forwardPE, epsGrowth5Y, epsGrowthFwd, revenueGrowth, dividendYield, epsPeak, epsTrough, price } = params;
  switch (lynchClass) {
    case 'fast_grower':
    case 'turnaround': {
      const growth = epsGrowthFwd > 0 ? epsGrowthFwd : (epsGrowth5Y > 0 ? epsGrowth5Y : revenueGrowth);
      if (forwardPE > 0 && growth > 0) return { peg: +(forwardPE / growth).toFixed(2), pegBasis: 'Forward P/E ÷ Fwd EPS Growth' };
      return { peg: null, pegBasis: 'Kein posit. Wachstum' };
    }
    case 'cyclical': {
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
      const basePE = forwardPE > 0 ? forwardPE : pe;
      const baseGrowth = epsGrowthFwd > 0 ? epsGrowthFwd : (epsGrowth5Y > 0 ? epsGrowth5Y : revenueGrowth);
      const totalReturn = baseGrowth + dividendYield;
      if (basePE > 0 && totalReturn > 0) return { peg: +(basePE / totalReturn).toFixed(2), pegBasis: 'PEGY = Fwd P/E ÷ (Fwd EPS Growth + Dividende)' };
      return { peg: null, pegBasis: 'PEGY nicht berechenbar' };
    }
    default: {
      const bestPE = forwardPE > 0 ? forwardPE : pe;
      const bestGrowth = epsGrowthFwd > 0 ? epsGrowthFwd : epsGrowth5Y > 0 ? epsGrowth5Y : revenueGrowth;
      const basis = forwardPE > 0 && epsGrowthFwd > 0 ? 'Forward P/E ÷ Fwd EPS Growth' : forwardPE > 0 ? 'Forward P/E ÷ Revenue Growth' : 'P/E ÷ 5Y EPS CAGR';
      if (bestPE > 0 && bestGrowth > 0) return { peg: +(bestPE / bestGrowth).toFixed(2), pegBasis: basis };
      return { peg: null, pegBasis: 'Nicht berechenbar' };
    }
  }
}

// === Catalyst Context (sector-template descriptions) ===
export function generateCatalystContext(
  catalystName: string, sector: string, industry: string, description: string,
  growthRate: number, fcfMargin: number, revenue: number
): string {
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
  const hasBank = ind.includes('bank') || desc.includes('banking') || desc.includes('deposit') || desc.includes('loan');
  const hasOilGas = desc.includes('oil') || desc.includes('gas') || desc.includes('petroleum') || desc.includes('refin');
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
    case 'Product Cycle / Platform Expansion':
      if (hasCloud) return `Neue Produktgenerationen und Plattform-Erweiterungen (Datenanalyse, Security, DevOps) müssen TAM erweitern. Cross-Platform-Bundling erhöht Switching Costs und sichert langfristige Kundenbeziehungen.`;
      if (hasSaaS) return `Produktportfolio-Erweiterung durch neue Module, vertikale Lösungen und Plattform-Ökosystem. Ziel: Höherer Wallet-Share bei Bestandskunden und Erschließung neuer Segmente.`;
      if (hasSemiconductor) return `Nächste Chip-Generation und Expansion in neue Anwendungsfelder (AI-Inference, Edge Computing, Automotive) müssen TAM signifikant erweitern.`;
      return `Neue Produktzyklen und Plattform-Erweiterungen müssen zusätzliche Umsatzquellen erschließen und bestehende Kundenbeziehungen vertiefen.`;
    case 'Pipeline Approval / FDA Catalyst': return `Phase-3-Ergebnisse und FDA-Entscheidungen zu Schlüssel-Kandidaten müssen positiv ausfallen. Erfolgreiche Zulassungen können Revenue-Sprung ermöglichen. Risiko: CRL, Partial Hold oder Labeling-Einschränkungen.`;
    case 'Demographic Tailwind (Aging Population)': return `Alternde Bevölkerung in Industrieländern treibt strukturell steigende Gesundheitsausgaben. Voraussetzung: Produktportfolio muss auf chronische Erkrankungen und Prävention ausgerichtet sein.`;
    case 'China / Asia Demand Recovery': return `China-Konsum muss sich von aktueller Schwäche erholen. Voraussetzung: Verbessertes Konsumklima, stabiler Immobilienmarkt und Vermögenseffekte. Aspirational Spending in Tier-2/3-Städten als zusätzlicher Treiber.`;
    case 'Pricing Power / Brand Elevation': return `Mid-Single-Digit Preiserhöhungen müssen ohne Volumen-Verluste durchgesetzt werden. Voraussetzung: Starke Markenbegehrlichkeit, kontrollierte Distribution und Exklusivitätsstrategie.`;
    case 'Interest Rate Normalization Benefit': return `Zinsnormalisierung muss Net Interest Margin verbessern. Voraussetzung: Einlagen-Repricing langsamer als Kredit-Repricing. Kreditnachfrage muss bei moderaten Zinsen anziehen.`;
    case 'Capital Return / Buyback Program': return `Aktienrückkaufprogramm und Dividendenerhöhungen müssen EPS-Wachstum über organischem Niveau treiben. Voraussetzung: Starke FCF-Generierung und konservative Kapitalallokation.`;
    case 'Commodity Price Recovery': return `Commodity-Preise müssen sich stabilisieren oder erholen. Voraussetzung: Globale Nachfrage-Erholung, Angebotsverknappung oder geopolitische Risikopremien. Breakeven-Analyse als Schlüssel.`;
    case 'Energy Transition Investment': return `Investments in Renewables, Carbon Capture oder LNG müssen langfristiges Wachstum jenseits fossiler Brennstoffe sichern. Voraussetzung: Regulatorische Klarheit und wettbewerbsfähige Projektrenditen.`;
    case 'Consumer Confidence Recovery': return `Konsumklima muss sich verbessern und diskretionäre Ausgaben ansteigen. Voraussetzung: Sinkende Inflation, stabiler Arbeitsmarkt und Wealth-Effekte bei steigenden Asset-Preisen.`;
    case 'E-Commerce / DTC Growth': return `Direct-to-Consumer-Kanal muss überproportional wachsen und höhere Margen liefern. Voraussetzung: Digitale Kundenerfahrung, Fulfillment-Effizienz und personalisiertes Marketing.`;
    case 'iGaming / Online Sports Betting Expansion': return `iGaming- und Online-Sports-Betting-Legalisierung in neuen US-Bundesstaaten muss zusätzliche Umsatzquellen erschließen. Voraussetzung: Regulatorische Genehmigungen, Technologie-Plattform-Skalierung und Marketing-ROI in neuen Märkten. Revenue-Basis: ${revB}.`;
    case 'New Property Openings / Capacity Expansion': return `Neue Casino-Standorte, Hotel-Erweiterungen oder Renovierungen müssen Gaming-Revenue und Nicht-Gaming-Revenue (F&B, Hotel, Entertainment) steigern. Voraussetzung: Termingerechte Baufertigstellung, Genehmigungen und regionaler Nachfrage-Support.`;
    case 'Same-Store Sales Recovery / Menu Pricing': return `Comparable-Sales müssen durch Traffic-Recovery und strategische Preiserhöhungen steigen. Voraussetzung: Stabile Konsumausgaben, erfolgreiche Menü-Innovation und nicht-inflationsgetriebene Ticket-Steigerung.`;
    case 'Unit Growth / Franchise Expansion': return `Netto-Neueröffnungen müssen System-Revenue-Wachstum treiben. Voraussetzung: Verfügbare Franchise-Nehmer, attraktive Unit Economics und Genehmigungen in Zielmärkten.`;
    case 'Travel Demand Recovery / RevPAR Growth': return `RevPAR (Revenue per Available Room) muss durch höhere Auslastung und ADR steigen. Voraussetzung: Erholung der Reisenachfrage, Corporate-Travel-Normalisierung und Events-Pipeline.`;
    case 'Loyalty Program Monetization': return `Treueprogramm muss höheren Customer Lifetime Value generieren durch Cross-Selling (Kreditkarten, Partner-Deals) und erhöhte Direktbuchungen. Voraussetzung: Wachsende Mitgliederbasis und attraktive Einlöse-Optionen.`;
    case 'EV Transition / New Model Cycle': return `EV-Modellpalette muss Marktanteile im wachsenden Elektro-Segment gewinnen. Voraussetzung: Konkurrenzfähige Reichweite, Preis-Leistung und Ladeinfrastruktur-Verfügbarkeit. Neuer Modellzyklus als Volumenhebel.`;
    case 'Supply Chain Normalization / Volume Recovery': return `Normalisierung der Lieferketten muss Produktionsvolumen steigern und Auftragsrückstände abbauen. Voraussetzung: Chip-Verfügbarkeit, Logistik-Normalisierung und Lagerbestandsoptimierung.`;
    case 'Market Share Gains': return `Marktanteile müssen durch Produktinnovation, Pricing und Distribution ausgebaut werden. Voraussetzung: Wettbewerbsvorteile in Qualität, Service oder Kostenstruktur.`;
    case 'Strategic M&A / Partnerships': return `Strategische Akquisitionen oder Partnerschaften müssen Technologie, Marktpräsenz oder Kundenbeziehungen ergänzen. Voraussetzung: Disziplinierte Kapitalallokation und Integrations-Exzellenz.`;
    default: return `Katalysator muss sich im Geschäftsmodell-Kontext materialisieren. Voraussetzung: Erfolgreiche Umsetzung der strategischen Prioritäten und günstiges Marktumfeld.`;
  }
}

// === Sector-Template Catalyst Generator (LLM fallback) ===
export function generateCatalysts(
  sector: string, industry: string, growthRate: number, fcfMargin: number,
  description = '', revenue = 0, price = 0, sharesOutstanding = 0,
  netDebt = 0, fcf = 0, wacc = 0, revenueGrowth = 0
): Catalyst[] {
  const catalysts: Catalyst[] = [];
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();

  const mkCat = (name: string, timeline: string, pos: number, bruttoUpside: number, catalystType: string): Catalyst => ({
    name, timeline, pos, bruttoUpside,
    einpreisungsgrad: calcEinpreisungsgrad({ bruttoUpside, price, sharesOutstanding, netDebt, fcf, wacc, revenueGrowth, catalystType }),
    nettoUpside: 0, gb: 0, context: '',
  });

  catalysts.push(mkCat("Revenue Growth Acceleration", growthRate > 15 ? "6-12M" : "12-18M", Math.round(Math.min(85, 40 + growthRate * 2)), Math.round(Math.min(25, 5 + growthRate * 0.8)), 'growth'));
  const marginPos = fcfMargin > 20 ? 55 : fcfMargin > 10 ? 45 : 35;
  catalysts.push(mkCat("Margin Expansion / Operating Leverage", "12-24M", marginPos, Math.round(8 + (30 - fcfMargin) * 0.3), 'margin'));

  if (s.includes("tech")) {
    catalysts.push(mkCat("AI / Cloud Adoption Tailwind", "6-18M", 60, 15, 'ai'));
    catalysts.push(mkCat("Product Cycle / Platform Expansion", "12-24M", 45, 12, 'product'));
  } else if (s.includes("health")) {
    catalysts.push(mkCat("Pipeline Approval / FDA Catalyst", "6-18M", 35, 25, 'product'));
    catalysts.push(mkCat("Demographic Tailwind (Aging Population)", "12-36M", 70, 8, 'macro'));
  } else if (s.includes("financ")) {
    catalysts.push(mkCat("Interest Rate Normalization Benefit", "6-12M", 50, 12, 'macro'));
    catalysts.push(mkCat("Capital Return / Buyback Program", "0-12M", 65, 8, 'margin'));
  } else if (s.includes("energy")) {
    catalysts.push(mkCat("Commodity Price Recovery", "6-18M", 40, 20, 'macro'));
    catalysts.push(mkCat("Energy Transition Investment", "12-36M", 45, 15, 'product'));
  } else if (s.includes("consumer") && (s.includes("cycl") || s.includes("discr"))) {
    const isLuxury = ind.includes("luxury") || ind.includes("apparel") || ind.includes("fashion");
    const isCasino = ind.includes("gambling") || ind.includes("casino") || ind.includes("resort") || description.toLowerCase().includes("casino") || description.toLowerCase().includes("gaming entertainment");
    const isRestaurant = ind.includes("restaurant") || description.toLowerCase().includes("restaurant") || description.toLowerCase().includes("dining");
    const isTravel = ind.includes("travel") || ind.includes("hotel") || ind.includes("leisure") || description.toLowerCase().includes("hotel") || description.toLowerCase().includes("cruise");
    const isAuto = ind.includes("auto") || description.toLowerCase().includes("automobile") || description.toLowerCase().includes("vehicle");
    if (isLuxury) {
      catalysts.push(mkCat("China / Asia Demand Recovery", "6-18M", 40, 15, 'macro'));
      catalysts.push(mkCat("Pricing Power / Brand Elevation", "12-24M", 55, 10, 'margin'));
    } else if (isCasino) {
      catalysts.push(mkCat("iGaming / Online Sports Betting Expansion", "12-24M", 50, 15, 'product'));
      catalysts.push(mkCat("New Property Openings / Capacity Expansion", "12-36M", 40, 12, 'growth'));
    } else if (isRestaurant) {
      catalysts.push(mkCat("Same-Store Sales Recovery / Menu Pricing", "6-12M", 50, 10, 'margin'));
      catalysts.push(mkCat("Unit Growth / Franchise Expansion", "12-24M", 45, 12, 'growth'));
    } else if (isTravel) {
      catalysts.push(mkCat("Travel Demand Recovery / RevPAR Growth", "6-18M", 50, 12, 'macro'));
      catalysts.push(mkCat("Loyalty Program Monetization", "12-24M", 45, 10, 'product'));
    } else if (isAuto) {
      catalysts.push(mkCat("EV Transition / New Model Cycle", "12-24M", 45, 15, 'product'));
      catalysts.push(mkCat("Supply Chain Normalization / Volume Recovery", "6-18M", 50, 10, 'macro'));
    } else {
      catalysts.push(mkCat("Consumer Confidence Recovery", "6-18M", 45, 12, 'macro'));
      catalysts.push(mkCat("E-Commerce / DTC Growth", "12-24M", 50, 10, 'growth'));
    }
  } else {
    catalysts.push(mkCat("Market Share Gains", "12-24M", 45, 12, 'growth'));
    catalysts.push(mkCat("Strategic M&A / Partnerships", "6-18M", 30, 15, 'product'));
  }

  for (const c of catalysts) {
    c.nettoUpside = +(c.bruttoUpside * (1 - c.einpreisungsgrad / 100)).toFixed(2);
    c.gb = +(c.pos / 100 * c.nettoUpside).toFixed(2);
    if (!c.context) c.context = generateCatalystContext(c.name, sector, industry, description, growthRate, fcfMargin, revenue);
  }
  return catalysts;
}

// === LLM-Powered Company-Specific Catalyst Generation ===
export async function generateLLMCatalysts(
  ticker: string, companyName: string, sector: string, industry: string,
  description: string, revenue: number, revenueGrowth: number, fcfMargin: number,
  price: number, pe: number, marketCap: number,
  keyProjects: string[], secFilingExcerpts: string[], newsHeadlines: string[]
): Promise<Catalyst[] | null> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const contextParts: string[] = [
      `Company: ${companyName} (${ticker})`,
      `Sector: ${sector} / ${industry}`,
      `Description: ${description.substring(0, 800)}`,
      `Revenue: $${(revenue / 1e9).toFixed(1)}B | Growth: ${revenueGrowth.toFixed(1)}% | FCF Margin: ${fcfMargin.toFixed(1)}%`,
      `Price: $${price.toFixed(2)} | P/E: ${pe.toFixed(1)} | Market Cap: $${(marketCap / 1e9).toFixed(1)}B`,
    ];
    if (keyProjects.length > 0) contextParts.push(`\nKey Projects (from SEC 10-K filing):\n${keyProjects.map(p => `  - ${p}`).join('\n')}`);
    if (secFilingExcerpts.length > 0) contextParts.push(`\nSEC Filing Excerpts:\n${secFilingExcerpts.map(e => `  "${e}"`).join('\n')}`);
    if (newsHeadlines.length > 0) contextParts.push(`\nRecent News:\n${newsHeadlines.map(n => `  - ${n}`).join('\n')}`);

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
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
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
      return { name: String(c.name || 'Unknown Catalyst').substring(0, 60), timeline: String(c.timeline || '12-24M'), pos, bruttoUpside, einpreisungsgrad, nettoUpside, gb, context: String(c.context || '') };
    });

    console.log(`[ANALYZE] LLM catalysts for ${ticker}: ${catalysts.map(c => c.name).join(', ')}`);
    return catalysts;
  } catch (err: any) {
    console.log(`[ANALYZE] LLM catalyst generation failed for ${ticker}: ${err?.message?.substring(0, 200)}`);
    return null;
  }
}
