/**
 * valuechain-catalog.ts
 * ----------------------
 * Ticket: tickets/VALUECHAIN_GICS_COVERAGE.md ("Value-Chain-Abdeckung
 * aller 11 GICS-Sektoren").
 *
 * Additive neue Datei (wie im Ticket erlaubt: "splitte in eine neue Datei
 * server/valuechain-catalog.ts wenn das die Lesbarkeit deutlich
 * verbessert"). server/valuechain-routes.ts bleibt der einzige Ort, der
 * diese Datei importiert und `VALUECHAIN_INDUSTRIES` re-exportiert
 * (Kompatibilitaet fuer bestehende Imports).
 *
 * Enthaelt:
 *  - erweiterte IndustryDef-Struktur (gicsSector, stageAliases pro Kette,
 *    excludeKeywords pro Stufe, minMcapUsd, notes)
 *  - alle 6 bestehenden Ketten UNVERAENDERT in ihrer Klassifikations-Logik
 *    (semiconductors nutzt weiterhin die globale STAGE_ALIASES-Reihenfolge
 *    Downstream-zuerst aus valuechain-routes.ts, siehe classifyStage())
 *  - alle neuen Ketten aus Phase 1/2 des Tickets, mit chain-eigenen
 *    stageAliases (Upstream zuerst gepr\u00fcft -- siehe ARCHITEKTUR-Abschnitt
 *    im Ticket: "Filter-Reihenfolge global: 1. Upstream-Keywords zuerst
 *    pruefen ... 2. dann Midstream ... 3. dann Downstream")
 *
 * WICHTIG (Ticket-Vorgabe): die 6 bestehenden Ketten sind vom Gate
 * ausgenommen. Deshalb behalten sie `legacyStageAliases: true` und nutzen
 * weiterhin classifyStage() aus valuechain-routes.ts (Downstream-zuerst),
 * NICHT die neuen chain-eigenen stageAliases. Alle neuen Ketten (Phase
 * 1+2) nutzen die neue Upstream-zuerst-Reihenfolge ueber
 * classifyStageForChain().
 */

export type StageType = "upstream" | "midstream" | "downstream";

export interface StageAliasSet {
  upstream: RegExp[];
  midstream: RegExp[];
  downstream: RegExp[];
}

export interface ExcludeKeywordSet {
  upstream?: RegExp[];
  midstream?: RegExp[];
  downstream?: RegExp[];
}

export interface IndustryDef {
  key: string;
  label: string;
  /** GICS-Sektor (2026 MSCI/S&P Taxonomie) fuer die Dropdown-Gruppierung. */
  gicsSector: string;
  fmpSector: string;
  /** Eine oder mehrere FMP-Industries (company-screener wird pro Industry
   *  aufgerufen und die Ergebnisse zusammengefuehrt/dedupliziert). Wird
   *  ignoriert, wenn fmpPairs gesetzt ist. */
  fmpIndustries: string[];
  /** Optional: mehrere (Sektor, Industry)-Paare, falls eine Kette FMP-
   *  Industries aus VERSCHIEDENEN FMP-Sektoren zusammenfuehren muss (z.B.
   *  Renewables: "Solar" liegt unter FMP-Sektor Energy, "Renewable
   *  Utilities"/"Independent Power Producers" liegen unter Utilities).
   *  Wenn gesetzt, hat dies Vorrang vor fmpSector/fmpIndustries. */
  fmpPairs?: Array<{ sector: string; industry: string }>;
  /** true = bestehende (Legacy) Kette, nutzt classifyStage() aus
   *  valuechain-routes.ts (Downstream-zuerst, globale STAGE_ALIASES).
   *  false/undefined = neue Kette, nutzt stageAliases unten
   *  (Upstream-zuerst, chain-eigen). */
  legacy?: boolean;
  /** Nur fuer neue (nicht-legacy) Ketten relevant. */
  stageAliases?: StageAliasSet;
  excludeKeywords?: ExcludeKeywordSet;
  /** Mindest-Marktkapitalisierung fuer den Screener-Call (USD). */
  minMcapUsd?: number;
  /** Kleinerer Kandidaten-Gate-Schwellwert erlaubt (z.B. REIT-Ketten). */
  smallStructural?: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// BESTAND (Ticket: "nicht loeschen, nur Regression pruefen") -- unveraendert
// in Label/FMP-Zuordnung, jetzt zusaetzlich mit gicsSector fuer die
// Dropdown-Gruppierung annotiert. legacy:true => classifyStage() (Downstream
// zuerst) bleibt fuer diese 6 Ketten die alleinige Klassifikationslogik.
// ---------------------------------------------------------------------------
export const LEGACY_INDUSTRIES: IndustryDef[] = [
  { key: "semiconductors", label: "Halbleiter", gicsSector: "Information Technology", fmpSector: "Technology", fmpIndustries: ["Semiconductors"], legacy: true },
  { key: "software-infrastructure", label: "Software-Infrastruktur", gicsSector: "Information Technology", fmpSector: "Technology", fmpIndustries: ["Software - Infrastructure"], legacy: true },
  { key: "oil-gas", label: "Öl & Gas", gicsSector: "Energy", fmpSector: "Energy", fmpIndustries: ["Oil & Gas Integrated"], legacy: true },
  { key: "auto-manufacturers", label: "Automobilhersteller", gicsSector: "Consumer Discretionary", fmpSector: "Consumer Cyclical", fmpIndustries: ["Auto - Manufacturers"], legacy: true },
  { key: "aerospace-defense", label: "Luft- & Raumfahrt / Verteidigung", gicsSector: "Industrials", fmpSector: "Industrials", fmpIndustries: ["Aerospace & Defense"], legacy: true },
  { key: "biotechnology", label: "Biotechnologie", gicsSector: "Health Care", fmpSector: "Healthcare", fmpIndustries: ["Biotechnology"], legacy: true },
];

// ---------------------------------------------------------------------------
// PHASE 1 -- Luecken in schon angefassten Sektoren schliessen
// ---------------------------------------------------------------------------
export const PHASE1_INDUSTRIES: IndustryDef[] = [
  // Health Care / Pharma
  {
    key: "pharma",
    label: "Pharma",
    gicsSector: "Health Care",
    fmpSector: "Healthcare",
    fmpIndustries: ["Drug Manufacturers - General", "Drug Manufacturers - Specialty & Generic", "Biotechnology", "Medical - Instruments & Supplies", "Medical - Diagnostics & Research"],
    stageAliases: {
      // CDMO/API/Fill-Finish-Sprache kommt in FMP-Beschreibungen oft aus
      // der Biotechnology- oder Medical-Instruments/Diagnostics-Kategorie
      // statt aus "Drug Manufacturers" (z.B. Lonza, Catalent, West Pharma,
      // Bio-Techne, Repligen) -- deshalb sind diese Industries oben
      // zusaetzlich in fmpIndustries.
      upstream: [/\b(active pharmaceutical ingredient|api manufactur|drug substance manufactur|small[- ]molecule cdmo|contract development and manufacturing organization|containment and delivery solutions for injectable|bioprocessing technolog|life science reagents|biological drug production|preclinical services)\b/i],
      midstream: [/\b(fill[- ]finish|drug product manufactur|biologics manufactur|sterile fill|aseptic filling|contract (development and )?manufacturing organization for pharma|develops, manufactures,? and (globally )?distribut(es|ion) .{0,20}(injectable|containment)|softgel and oral technolog|clinical research organization|contract research organization|drug development services)\b/i],
      downstream: [/\b(commercialization of (pharmaceutical|human medicines)|discovery, development, .{0,30}commercialization|research, development,? (and|,) commercialization|develops.{0,20}and commercializes|prescription (drugs|medicines)|marketed (drugs|products|portfolio)|global (biopharmaceutical|pharmaceutical) (leader|firm|company|enterprise))\b/i],
    },
    excludeKeywords: {
      downstream: [/\bcomputational (chemistry|biology)\b/i],
    },
    notes: "VERBOT: computational chemistry/biology allein = Downstream (Ticket-Vorgabe). Platform-Biotech ohne vermarktetes Portfolio bleibt Biotech-Kette.",
  },
  // Health Care / Medtech
  {
    key: "medtech",
    label: "Medtech",
    gicsSector: "Health Care",
    fmpSector: "Healthcare",
    fmpIndustries: ["Medical - Devices", "Medical - Instruments & Supplies", "Medical - Diagnostics & Research", "Medical - Distribution", "Medical - Equipment & Services"],
    stageAliases: {
      upstream: [/\b(diagnostic reagent|component (supplier|manufacturer) for medical|imaging component|sensor component|raw material for (medical|diagnostic)|life science(s)? (reagents|research|solutions)|analytical instruments|precision instruments|specialized measurement|scientific instruments|applied chemistry industries)\b/i],
      midstream: [/\b(device (manufactur|maker)|implant manufactur|manufactures (medical|surgical) devices|develops.{0,40}manufactures.{0,40}(devices|implants)|medical technology (enterprise|firm|company)|invents, develops, manufactures|designing, producing, and distributing)\b/i],
      downstream: [/\b(hospital supplier|distributes (medical|surgical)|medtech distributor|distribution of medical devices|distribution of pharmaceutical products|healthcare products and services|sourcing and distribution)\b/i],
    },
    excludeKeywords: {
      downstream: [/\b(health insurance|managed care|health plan)\b/i],
    },
    notes: "Krankenversicherung gehoert NICHT hierher (Financials/Health payer).",
  },
  // Energy / Renewables
  {
    key: "renewables",
    label: "Renewables",
    gicsSector: "Energy",
    fmpSector: "Energy",
    fmpIndustries: ["Solar"],
    // Solar liegt unter FMP-Sektor Energy, Renewable Utilities/IPP liegen
    // unter Utilities -- deshalb fmpPairs statt einzelnem fmpSector.
    fmpPairs: [
      { sector: "Energy", industry: "Solar" },
      { sector: "Utilities", industry: "Renewable Utilities" },
      { sector: "Utilities", industry: "Independent Power Producers" },
      { sector: "Utilities", industry: "Regulated Electric" },
    ],
    stageAliases: {
      upstream: [/\b(wind turbine|solar (module|panel)|photovoltaic \(pv\) solar energy solutions|photovoltaic (module|cell)|polysilicon|silicon wafer|solar (ingot|tracker)|inverter (system|manufactur)|electrical balance of system|solar energy components, including ingots, wafers, cells)\b/i],
      midstream: [/\b(independent power producer|renewable (energy )?developer|epc (contractor|services) for (wind|solar)|develops, (builds|constructs) and operates (wind|solar)|residential solar energy solutions|entire lifecycle)\b/i],
      downstream: [/\b(regulated (electric )?utility|electric (power provider|utility holding company)|generation, transmission,? (and|,) (distribution|delivery)|grid operator|electricity retailer|power purchase agreement offtaker|produce and supply electrical power)\b/i],
    },
    excludeKeywords: {
      upstream: [/\b(oil (major|and gas)|oilfield service)\b/i],
    },
    smallStructural: true,
    notes: "NICHT: Oil major, oilfield service.",
  },
  // Information Technology / Data Center-Cloud
  {
    key: "data-center-cloud",
    label: "Data Center / Cloud",
    gicsSector: "Information Technology",
    fmpSector: "Technology",
    fmpIndustries: ["Computer Hardware"],
    // Bewusst ENG gefasst (nicht "Information Technology Services" -- das
    // zieht IT-Consulting/BPO/Prison-Operator-artige Firmen rein, die
    // keine Data-Center/Cloud-Kernkette sind). REIT - Specialty liegt
    // unter FMP-Sektor Real Estate (Equinix/Digital Realty), Electrical
    // Equipment & Parts liegt unter Industrials (Vertiv/nVent --
    // DC-Power/Cooling-Zulieferer), Internet Content & Information unter
    // Communication Services (Google Cloud/Alphabet) -- deshalb fmpPairs.
    fmpPairs: [
      { sector: "Technology", industry: "Computer Hardware" },
      { sector: "Technology", industry: "Software - Infrastructure" },
      { sector: "Real Estate", industry: "REIT - Specialty" },
      { sector: "Industrials", industry: "Electrical Equipment & Parts" },
      { sector: "Communication Services", industry: "Internet Content & Information" },
    ],
    stageAliases: {
      upstream: [/\b(data center (power|cooling)|generator (systems|sets) for data center|power distribution unit|optical interconnect|server hardware manufactur|digital infrastructure technologies and comprehensive lifecycle|thermal management systems|electrical connection and protective equipment|power management company|energy[- ]efficient solutions for electrical)\b/i],
      midstream: [/\b(data center footprint|colocation (provider|operator)|hyperscale (campus|data center) operator|owns and operates data centers|interconnected ecosystems|owns, acquires, develops, and operates data centers|provides data center)\b/i],
      downstream: [/\b(hyperscaler|infrastructure[- ]as[- ]a[- ]service|amazon web services \(aws\)|intelligent cloud|google cloud, and)\b/i],
    },
    excludeKeywords: {
      upstream: [/\b(gpu design|graphics processing unit design|lithograph)\b/i],
      midstream: [/\btelecom(munications)? carrier\b/i],
    },
    notes: "NICHT NVDA/AMAT/ASML hier reinziehen. NICHT Telecom-Carrier ohne Colocation-Kern.",
  },
  // Materials / Kupfer-Critical
  {
    key: "copper-critical-minerals",
    label: "Kupfer / Critical Minerals",
    gicsSector: "Materials",
    fmpSector: "Basic Materials",
    fmpIndustries: ["Copper", "Industrial Materials", "Aluminum"],
    // Kabel/Draht-Hersteller (Downstream) liegen unter FMP-Sektor
    // Industrials/"Electrical Equipment & Parts" (Prysmian, NKT, Encore
    // Wire, Atkore), nicht unter Basic Materials -- deshalb fmpPairs.
    fmpPairs: [
      { sector: "Basic Materials", industry: "Copper" },
      { sector: "Basic Materials", industry: "Industrial Materials" },
      { sector: "Basic Materials", industry: "Aluminum" },
      { sector: "Industrials", industry: "Electrical Equipment & Parts" },
    ],
    stageAliases: {
      upstream: [/\b(mining.{0,20}exploration|exploration.{0,20}(and|,).{0,20}(extraction|development)|mining enterprise|mining and exploration|mining firm|copper concentrate|bauxite, alumina)\b/i],
      midstream: [/\b(copper smelt|copper refin|copper cathode|copper rod|smelting,? and refining|production and sale of (bauxite|aluminum))\b/i],
      downstream: [/\b(wire (and|&) cable|power cable manufactur|cable manufactur|cables,? cabling systems|electrical building wires and cables|various cables|wiring and electrical|metal service center|diversified metal solutions provider)\b/i],
    },
    excludeKeywords: {
      upstream: [/\bgold[- ]only\b/i],
    },
    notes: "NICHT: gold-only miner.",
  },
  // Materials / Chemie-Stahl (separate von Kupfer)
  {
    key: "chemicals-steel",
    label: "Chemie / Stahl",
    gicsSector: "Materials",
    fmpSector: "Basic Materials",
    fmpIndustries: ["Chemicals", "Chemicals - Specialty", "Steel"],
    // Packaging & Containers liegt unter FMP-Sektor Consumer Cyclical, nicht
    // Basic Materials -- deshalb fmpPairs fuer die Downstream-Packaging-
    // Kandidaten (Sealed Air, Ball, Crown Holdings).
    fmpPairs: [
      { sector: "Basic Materials", industry: "Chemicals" },
      { sector: "Basic Materials", industry: "Chemicals - Specialty" },
      { sector: "Basic Materials", industry: "Steel" },
      { sector: "Consumer Cyclical", industry: "Packaging & Containers" },
    ],
    stageAliases: {
      upstream: [/\b(basic chemicals|industrial gas(es)?|iron ore|coking coal|crude steel mill|steel mill producing crude steel|mining and (mineral )?exploration)\b/i],
      midstream: [/\b(specialty chemical|steel products|flat[- ]rolled steel|steel producer|production and sale of steel|globally integrated steel production|steel manufactur|production, recycling, and fabrication|manufactures a comprehensive range of steel|advanced material solutions|custom formulation services)\b/i],
      downstream: [/\b(coating solutions|paint,? coatings|protective coatings|packaging (solutions|chemical)|aluminum packaging solutions|design, production, and sale of .{0,20}packaging|steel distributor|distributes steel|metal service center|diversified metal solutions provider)\b/i],
    },
    excludeKeywords: {
      upstream: [/\bpharmaceutical (active ingredient|api)\b/i],
    },
    notes: "NICHT: Pharma-API (das ist Pharma-Upstream). Zwei separate Ketten (Kupfer/Chemie-Stahl), nicht gemischt.",
  },
];

// ---------------------------------------------------------------------------
// PHASE 2 -- fehlende GICS-Sektoren ueberhaupt erst anlegen
// ---------------------------------------------------------------------------
export const PHASE2_INDUSTRIES: IndustryDef[] = [
  // Industrials / Shipping-Ports-Logistics
  {
    key: "shipping-ports-logistics",
    label: "Shipping / Ports / Logistics",
    gicsSector: "Industrials",
    fmpSector: "Industrials",
    fmpIndustries: ["Marine Shipping", "Integrated Freight & Logistics", "General Transportation"],
    stageAliases: {
      upstream: [/\b(shipbuild|cargo aircraft lessor|port equipment manufactur)\b/i],
      midstream: [/\b(liner (shipping|operator)|tanker (owner|operator)|owns and operates (a fleet|vessels)|dry bulk carrier)\b/i],
      downstream: [/\b(port terminal operator|third[- ]party logistics|3pl provider|freight forward(er|ing))\b/i],
    },
    excludeKeywords: {
      downstream: [/\b(e[- ]?commerce retailer|online retail(er)?)\b/i],
    },
    notes: "NICHT: Amazon-Retail als Logistics-Downstream.",
  },
  // Communication Services / Telecom-Infra
  {
    key: "telecom-infrastructure",
    label: "Telecom-Infrastruktur",
    gicsSector: "Communication Services",
    fmpSector: "Communication Services",
    fmpIndustries: ["Communication Equipment", "Telecommunications Services", "REIT - Specialty"],
    stageAliases: {
      upstream: [/\b(tower (equipment|construction) (manufactur|supplier)|optical fiber (vendor|manufactur)|radio access network|ran equipment)\b/i],
      midstream: [/\b(tower reit|owns and operates (wireless )?towers|fiber wholesale|wholesale fiber network)\b/i],
      downstream: [/\b(mobile network operator|wireless carrier|cable operator|broadband (provider|internet service))\b/i],
    },
    excludeKeywords: {
      downstream: [/\b(social (media|network)|search engine|advertising platform)\b/i],
    },
    notes: "NICHT: Meta/Google als Telecom-Downstream.",
  },
  // Consumer Staples / Food-Agri
  {
    key: "food-agri",
    label: "Food & Agri",
    gicsSector: "Consumer Staples",
    fmpSector: "Consumer Defensive",
    fmpIndustries: ["Agricultural Inputs", "Farm Products", "Agricultural Farm Products", "Packaged Foods", "Beverages - Non-Alcoholic"],
    stageAliases: {
      upstream: [/\b(seed (producer|company)|fertilizer manufactur|farm equipment manufactur|commodity agri(cultural)? (trading|trader))\b/i],
      midstream: [/\b(food processor|meat packer|packing (plant|company)|beverage bottler|processes and packages)\b/i],
      downstream: [/\b(grocery (retail|store|chain)|foodservice distributor|supermarket operator)\b/i],
    },
    notes: "NICHT: Restaurant-Kette ohne Processor-Mitte erzwingen -- lieber Gate-Fail als 2-Stufen-Fake.",
  },
  // Consumer Discretionary / Luxury-Apparel
  {
    key: "luxury-apparel",
    label: "Luxury / Apparel",
    gicsSector: "Consumer Discretionary",
    fmpSector: "Consumer Cyclical",
    fmpIndustries: ["Luxury Goods", "Apparel - Manufacturers", "Apparel - Footwear & Accessories", "Apparel - Retail"],
    stageAliases: {
      upstream: [/\b(leather (goods|tannery)|textile (manufactur|mill)|cashmere (producer|supplier)|watch mouvement|movement manufactur)\b/i],
      midstream: [/\b(manufactures? in[- ]house|atelier|brand manufactur|in[- ]house production)\b/i],
      downstream: [/\b(maison retail|wholesale luxury|branded apparel retail|operates (boutiques|retail stores)|retail (stores|boutiques) (and|selling))\b/i],
    },
    excludeKeywords: {
      midstream: [/\bfast[- ]fashion\b/i],
    },
    notes: "NICHT: Fast-Fashion ohne Fertigungsstufe als Midstream ausgeben.",
  },
  // Consumer Discretionary / Batterie-EV
  {
    key: "battery-ev",
    label: "Batterie / EV",
    gicsSector: "Consumer Discretionary",
    fmpSector: "Consumer Cyclical",
    fmpIndustries: ["Auto - Manufacturers", "Specialty Chemicals", "Electrical Equipment & Parts"],
    stageAliases: {
      upstream: [/\b(lithium (mining|producer|extraction)|nickel sulfate|cobalt (mining|refin)|cathode (material|manufactur)|anode (material|manufactur)|separator (film|manufactur))\b/i],
      midstream: [/\b(battery cell (manufactur|producer)|gigafactory|battery pack (manufactur|assembly))\b/i],
      downstream: [/\b(electric vehicle (manufactur|maker|oem)|ev (manufacturer|maker)|manufactures? (battery[- ])?electric vehicles)\b/i],
    },
    excludeKeywords: {
      downstream: [/\blegacy (oem|automaker) without (battery|cell) production\b/i],
    },
    notes: "Reine Legacy-OEMs ohne Zelle gehoeren zur Auto-Kette, nicht hier.",
  },
  // Utilities / Generation-Grid-Retail
  {
    key: "utilities-generation-grid-retail",
    label: "Generation / Grid / Retail",
    gicsSector: "Utilities",
    fmpSector: "Utilities",
    fmpIndustries: ["Regulated Electric", "Diversified Utilities", "General Utilities", "Independent Power Producers"],
    stageAliases: {
      upstream: [/\b(power generation equipment|nuclear steam supply|gas turbine manufactur)\b/i],
      midstream: [/\b(regulated (electric )?(generation|transmission)|owns and operates (power plants|generation and transmission)|electric transmission (and|&) distribution)\b/i],
      downstream: [/\b(retail electricity (provider|supplier)|regulated utility retail|distributes electricity to (residential|retail) customers)\b/i],
    },
    excludeKeywords: {
      upstream: [/\b(wind turbine|solar module|solar panel)\b/i],
    },
    notes: "Renewable-OEM bleibt Renewables-Upstream, NICHT Utilities-Upstream.",
  },
  // Financials / Payments-Market-Infra
  {
    key: "payments-market-infra",
    label: "Payments / Market Infrastructure",
    gicsSector: "Financials",
    fmpSector: "Financial Services",
    fmpIndustries: ["Financial - Data & Stock Exchanges", "Financial - Capital Markets", "Financial - Credit Services"],
    stageAliases: {
      upstream: [/\b(card (network|rail) infrastructure|payment processor core|securities exchange matching engine|custody infrastructure)\b/i],
      midstream: [/\b(merchant acquir(er|ing)|clearing house|prime brokerage infrastructure|card scheme|payment network operator)\b/i],
      downstream: [/\b(consumer payments app|broker[- ]dealer (front[- ]end|platform)|neobank|digital banking app)\b/i],
    },
    excludeKeywords: {
      downstream: [/\buniversal bank\b/i],
    },
    minMcapUsd: 1_000_000_000,
    notes: "Capex oft niedrig, Gate 70% gilt trotzdem. NICHT: Universalbank als Downstream von Visa.",
  },
  // Real Estate / REIT-Development
  {
    key: "reit-development",
    label: "REIT / Development",
    gicsSector: "Real Estate",
    fmpSector: "Real Estate",
    fmpIndustries: ["Real Estate - Development", "REIT - Diversified", "REIT - Industrial", "REIT - Office", "REIT - Residential", "REIT - Retail", "Real Estate - Services"],
    stageAliases: {
      upstream: [/\b(land (development|developer)|construction (services )?for (commercial|property)|property construction contractor)\b/i],
      midstream: [/\b(reit (that owns|owner)|owns(,| and) operates.{0,30}(properties|real estate)|rental property portfolio|owns and manages a portfolio)\b/i],
      downstream: [/\b(real estate (brokerage|services) (company|firm)|property (management|services) company)\b/i],
    },
    excludeKeywords: {
      midstream: [/\b(data center reit|hyperscale)\b/i],
    },
    notes: "NICHT Hyperscaler-Cloud hier -- Firma mit GICS Real Estate -> diese Kette, Firma mit GICS IT/Cloud -> Data-Center-Kette.",
  },
];

export const ALL_NEW_INDUSTRIES: IndustryDef[] = [...PHASE1_INDUSTRIES, ...PHASE2_INDUSTRIES];
export const ALL_INDUSTRIES: IndustryDef[] = [...LEGACY_INDUSTRIES, ...ALL_NEW_INDUSTRIES];

/**
 * Stage-Klassifikation fuer neue (nicht-legacy) Ketten: Upstream zuerst,
 * dann Midstream, dann Downstream (Ticket-ARCHITEKTUR-Vorgabe, Punkt 2).
 * Bei excludeKeywords-Treffer in der sonst matchenden Stufe: Stufe verwerfen,
 * naechste Stufe pruefen. Kein Match irgendwo => Default Midstream (gleiche
 * neutrale Fallback-Konvention wie die bestehende classifyStage()).
 */
export function classifyStageForChain(def: IndustryDef, text: string): StageType {
  if (!def.stageAliases) return "midstream";
  const lower = text.toLowerCase();
  const order: StageType[] = ["upstream", "midstream", "downstream"];
  for (const stage of order) {
    const patterns = def.stageAliases[stage] || [];
    const excludes = def.excludeKeywords?.[stage] || [];
    const isExcluded = excludes.some((rx) => rx.test(lower));
    if (isExcluded) continue;
    const isMatch = patterns.some((rx) => rx.test(lower));
    if (isMatch) return stage;
  }
  return "midstream";
}
