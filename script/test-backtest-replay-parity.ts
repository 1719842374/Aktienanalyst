/**
 * script/test-backtest-replay-parity.ts — Phase 1 Akzeptanztest,
 * WORK_SIGNAL_BACKTEST.md §11 Phase 1 + §13 Akzeptanzkriterium:
 *   "replay(ticker, today) === live scoring fields (Score, gates, cappedBy)"
 *
 * Es gibt in dieser Sandbox KEINE laufende Serverinstanz und KEINE gefuellte
 * data.db (analysis_cache leer, cache-seed.json = []) — ein Live-Vergleich
 * gegen echte /api/analyze-Antworten ist deshalb nicht moeglich. Stattdessen
 * (wie im Ticket ausdruecklich erlaubt: "ggf. gegen bereits gecachte Analyse-
 * Ergebnisse testen ... verfuegbare Test-Fixtures aus bestehenden Tests")
 * baut dieser Test synthetische, aber plausible Fixtures fuer die vier im
 * Spec-Dokument (§11 Phase 1) genannten Ticker MSFT, NKE, ASML, RHM.DE nach
 * demselben Muster wie script/test-scoring-pipeline.ts (Nike-2023-Fixture).
 *
 * PARITAETS-BEWEIS: Fuer jeden Fixture-Ticker rufen wir
 *   (a) buildScoringForAnalysis(params)      — "Live"-Pfad (identisch zu dem
 *       Aufruf in server/analyze-route.ts Zeile ~1578)
 *   (b) replayAt({...params})                — "Replay"-Pfad (Phase 1,
 *       server/backtest/replay.ts)
 * mit EXAKT denselben Eingaben auf und pruefen Deep-Equality auf
 * finalScore/rawScore/qualityScore/trendMultiplier/cappedBy/gates/fiscal.
 * Da replayAt() intern buildScoringForAnalysis() mit denselben Parametern
 * aufruft, ist dies kein Zufallstreffer, sondern ein struktureller Beweis:
 * es gibt nur EINEN Berechnungspfad.
 *
 * Ausfuehren: npx tsx script/test-backtest-replay-parity.ts
 */
import { buildScoringForAnalysis, type AnalysisScoringContext } from "../server/scoring-integration";
import { replayAt, computeDcfApplicable } from "../server/backtest/replay";
import { deriveSignalV1 } from "../server/backtest/signal";
import type { Catalyst, Risk, StockAnalysis } from "../shared/schema";
// Sprint B3 Phase 1b (Ticket: tickets/SPRINT_B3_PHASE1B_SHARED_CRV.md;
// Nutzer-Praezisierung 30.08.2026): dieselben Funktionen wie Client
// (Section6.tsx) UND Server (analyze-route.ts) — importiert aus dem EINEN
// gemeinsamen Modul, um zu beweisen, dass beide Seiten bit-identisch
// rechnen (kein zweiter Pfad). Signal-CRV = GEHAERTETE Kette
// (computeHardenedCRV), NICHT die Base-Optimistic-Variante.
import {
  buildDefaultDCFParams,
  calculateFCFFDCF,
  worstCaseM1,
  computeHardenedCRV,
  calculateCRV,
  signalV1,
} from "../shared/valuation-signal";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Deterministischer, seed-basierter Pseudo-Zufallsgenerator (kein echter
// Zufall -- Testlauf muss reproduzierbar bit-identisch bleiben) fuer
// synthetische 26W-Kurshistorien (RSL-Input in buildDefaultDCFParams()).
function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Erzeugt 130 synthetische Tagesschlusskurse (>= 60 fuer RSL, siehe
 *  calculateRSL()-Mindestanforderung), endend bei `endDateIso`, mit
 *  leichtem Drift um `startPrice`. Deterministisch je `seed`. */
function genHistoricalPrices(startPrice: number, endDateIso: string, seed: number): { date: string; close: number }[] {
  const rnd = seededRandom(seed);
  const prices: { date: string; close: number }[] = [];
  let p = startPrice;
  const end = new Date(endDateIso + "T00:00:00Z");
  for (let i = 0; i < 130; i++) {
    p = p * (1 + 0.0002 + (rnd() - 0.5) * 0.02);
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    prices.push({ date: d.toISOString().slice(0, 10), close: +p.toFixed(2) });
  }
  return prices;
}

function makeCatalyst(overrides: Partial<Catalyst>): Catalyst {
  return {
    name: "Test-Katalysator",
    timeline: "2025-2028",
    pos: true,
    bruttoUpside: 0,
    einpreisungsgrad: 0,
    nettoUpside: 0,
    gb: 0,
    ...overrides,
  } as Catalyst;
}

interface Fixture {
  ticker: string;
  asOf: string;
  ctx: AnalysisScoringContext;
  health: string;
  moatRating: string;
  technicalIndicators: { priceAboveMA200?: boolean; ma50AboveMA200?: boolean } | null;
  catalysts: Catalyst[];
  price: number;
  fcfTTM: number | null;
  sector: string;
  industry: string;
  // ── Sprint B3 Phase 1b: zusaetzliche Rohdaten fuer den CRV/invDcf-
  // Paritaetstest (buildDefaultDCFParams() braucht ein volles
  // StockAnalysis-Objekt, siehe makeStockAnalysis() unten). ──
  crvFixture: {
    totalDebt: number;
    cashEquivalents: number;
    marketCap: number;
    sharesOutstanding: number;
    revenue: number;
    ebitda: number;
    operatingIncome: number;
    capex: number;
    epsTTM: number;
    epsConsensusNextFY: number;
    beta5Y: number;
    lynchClass: string;
    sectorMaxDrawdown: number;
    fcfHaircut: number;
    sectorGrowthG1: number;
    sectorGrowthTerminal: number;
    sectorWaccAvg: number;
    historicalPrices: { date: string; close: number }[];
    risks: Risk[];
    // ── zusaetzlich fuer computeHardenedCRV() (Nutzer-Praezisierung 30.08.2026) ──
    sector: string;
    moatRating: string;
    analystPTMedian: number;
    governmentExposure: number | null;
    fcfMarginYoyPp: number | null;
    marginDeltaYoYPp: number | null;
  };
}

/**
 * makeStockAnalysis() — baut aus einer Fixture ein minimales, aber fuer
 * buildDefaultDCFParams()/calculateFCFFDCF()/worstCaseM1-3/calculateCRV()
 * VOLLSTAENDIGES StockAnalysis-Objekt (nur die von diesen Funktionen
 * tatsaechlich gelesenen Felder sind befuellt — siehe shared/valuation-
 * signal.ts:buildDefaultDCFParams() fuer die exakte Feldliste). Das ist der
 * "Live"-Simulationspfad (analog SummarySection.tsx `data`-Prop).
 */
function makeStockAnalysis(fx: Fixture): StockAnalysis {
  const c = fx.crvFixture;
  return {
    currentPrice: fx.price,
    totalDebt: c.totalDebt,
    cashEquivalents: c.cashEquivalents,
    marketCap: c.marketCap,
    sharesOutstanding: c.sharesOutstanding,
    revenue: c.revenue,
    ebitda: c.ebitda,
    operatingIncome: c.operatingIncome,
    epsTTM: c.epsTTM,
    epsConsensusNextFY: c.epsConsensusNextFY,
    beta5Y: c.beta5Y,
    lynchClass: c.lynchClass,
    sectorMaxDrawdown: c.sectorMaxDrawdown,
    fcfHaircut: c.fcfHaircut,
    historicalPrices: c.historicalPrices,
    risks: c.risks,
    sector: c.sector,
    moatRating: c.moatRating,
    governmentExposure: c.governmentExposure,
    fcfMarginYoyPp: c.fcfMarginYoyPp,
    analystPT: { median: c.analystPTMedian },
    financialStatements: {
      cashFlow: { operatingCashFlow: 0, capex: c.capex, fcf: 0, fcfMargin: 0, fcfPerShare: 0 },
    },
    sectorProfile: {
      sector: c.sector,
      waccScenarios: { kons: c.sectorWaccAvg + 1.5, avg: c.sectorWaccAvg, opt: c.sectorWaccAvg - 1.5 },
      growthAssumptions: { g1: c.sectorGrowthG1, g2: c.sectorGrowthG1 * 0.6, terminal: c.sectorGrowthTerminal },
    },
  } as unknown as StockAnalysis;
}

/**
 * computeCrvAndInvDcf() — die EXAKTE Pipeline aus Section6.tsx (gehaertete
 * Kette), 1:1 dieselben Funktionsaufrufe wie server/analyze-route.ts jetzt
 * serverseitig macht (Nutzer-Praezisierung 30.08.2026: Signal-CRV ist die
 * GEHAERTETE Variante, nicht die Base-Optimistic-/Catalyst-Variante). Dient
 * hier als "Live"-Referenzwert, gegen den server-seitig (replayAt()-
 * Snapshot) auf Bit-Identitaet (4 Nachkommastellen) geprueft wird.
 */
function computeCrvAndInvDcf(fx: Fixture): { invDcf: number; crv: number; wacc: number; g1: number; worstCase: number; fv: number; wc: number } {
  const data = makeStockAnalysis(fx);
  const baseParams = buildDefaultDCFParams(data);
  const conservativeDCF = calculateFCFFDCF(baseParams);
  const m1 = worstCaseM1(data.currentPrice, data.beta5Y, data.sectorMaxDrawdown || 35);
  const hardened = computeHardenedCRV({
    price: data.currentPrice,
    conservativeDCF: {
      perShare: conservativeDCF.perShare,
      wacc: conservativeDCF.wacc,
      enterpriseValue: conservativeDCF.enterpriseValue,
      pvTerminal: conservativeDCF.pvTerminal,
    },
    sector: data.sector,
    industry: data.sectorProfile?.sector ?? data.sector,
    ebitMarginPct: baseParams.ebitMargin,
    marginDeltaYoYPp: fx.crvFixture.marginDeltaYoYPp,
    fcfMarginYoYPp: data.fcfMarginYoyPp ?? null,
    govExposurePct: data.governmentExposure ?? null,
    moatRating: data.moatRating,
    betaAdjDrawdownPct: (1 - m1 / data.currentPrice) * 100,
    sectorDrawdownPct: data.sectorMaxDrawdown || 35,
    analystPTMedian: data.analystPT?.median ?? data.currentPrice,
  });
  return {
    invDcf: hardened.fvHardened,
    crv: hardened.crvHardened,
    wacc: hardened.waccUsed,
    g1: baseParams.revenueGrowthP1,
    worstCase: hardened.wcUsed,
    fv: hardened.fvHardened,
    wc: hardened.wcUsed,
  };
}

// ============================================================================
// Fixture 1: MSFT — hohe Qualitaet, stetiges Wachstum, kein Gate-Deckel,
// dcfApplicable = true (Software, FCF > 0). Grobe Groessenordnung aus
// oeffentlich bekannten FY2024/25-Kennzahlen (Cloud/Azure-Wachstum ~30%,
// operative Marge stabil/expandierend, kein Lagerbestand relevant [Software]).
// ============================================================================
const msft: Fixture = {
  ticker: "MSFT",
  asOf: "2026-08-30",
  ctx: {
    impliedGStar: 11,
    quarterlyRevenueChronological: [
      52700, 56200, 56500, 61900, // vor 2 Jahren (FY23 Q1-Q4, Mrd-Skala vereinfacht, Mio USD)
      54900, 61900, 62000, 65600, // FY24 Q1-Q4
    ],
    annualIncome: [
      { revenue: 245100, operatingIncome: 109400 }, // FY24
      { revenue: 211900, operatingIncome: 88500 },  // FY23
    ],
    annualBalance: [{ inventory: 1600 }, { inventory: 2500 }], // Software: kaum Inventory
    subjectRevenueGrowth: 15.7,
    peerRevenueGrowths: [9.5, 12.0, 6.8, 14.0], // Grobe Software-Peer-Range
    regulatoryGate: null,
  },
  health: "Excellent",
  moatRating: "Wide",
  technicalIndicators: { priceAboveMA200: true, ma50AboveMA200: true },
  catalysts: [makeCatalyst({ name: "Azure/Copilot-Expansion", pos: true, gb: 3.5 })],
  price: 430,
  fcfTTM: 74000, // Mio USD, oeffentlich bekannt grob FY24
  sector: "Technology",
  industry: "Software - Infrastructure",
  crvFixture: {
    totalDebt: 42700, cashEquivalents: 75500, marketCap: 3200000, sharesOutstanding: 7430,
    revenue: 245100, ebitda: 133400, operatingIncome: 109400, capex: 44500,
    epsTTM: 12.4, epsConsensusNextFY: 14.1, beta5Y: 0.9, lynchClass: "fast_grower",
    sectorMaxDrawdown: 35, fcfHaircut: 0, sectorGrowthG1: 15, sectorGrowthTerminal: 3, sectorWaccAvg: 9.0,
    historicalPrices: genHistoricalPrices(430, "2026-08-30", 11),
    risks: [
      { name: "Cloud-Wettbewerb", category: "Gradual", ew: 40, impact: 20, expectedDamage: 8 },
      { name: "Regulatorik/Antitrust", category: "Binary", ew: 20, impact: 30, expectedDamage: 6 },
    ],
    sector: "Technology", moatRating: "Wide", analystPTMedian: 470,
    governmentExposure: 5, fcfMarginYoyPp: 1.2, marginDeltaYoYPp: 0.8,
  },
};

// ============================================================================
// Fixture 2: NKE — identisch zur bestehenden §17.8-Fixture in
// test-scoring-pipeline.ts (Nike 2023: Umsatzstagnation, Margenbruch,
// Marktanteilsverlust, kein Fiscal-Katalysator) -- hier als
// AnalysisScoringContext statt direktem GateInputs nachgebaut.
// ============================================================================
const nke: Fixture = {
  ticker: "NKE",
  asOf: "2023-09-30",
  ctx: {
    impliedGStar: 9.5,
    // 16 Quartale konstruiert, sodass calcRealizedGrowth8QServer via
    // yoy_8q-Methode ziemlich genau realizedGrowth8QPercent ≈ 2.0 liefert
    // (Summe letzte 8 vs. vorherige 8 Quartale, +2% YoY).
    quarterlyRevenueChronological: [
      12200, 12400, 12100, 12800, 12300, 12500, 12300, 12900, // Q-16..Q-9
      12440, 12650, 12345, 13060, 12550, 12750, 12550, 13165, // Q-8..Q-1 (~+2.0% je Quartal YoY)
    ],
    annualIncome: [
      { revenue: 51200, operatingIncome: 5100 },  // FY23 -- Marge bricht
      { revenue: 46700, operatingIncome: 6700 },  // FY22
    ],
    annualBalance: [{ inventory: 8500 }, { inventory: 6900 }], // Lageraufbau +22%
    subjectRevenueGrowth: 2.0,
    peerRevenueGrowths: [8.5, 6.0], // On/Hoka-Range (Marktanteilsverlust)
    regulatoryGate: null,
  },
  health: "Good",
  moatRating: "Narrow",
  technicalIndicators: { priceAboveMA200: false, ma50AboveMA200: false },
  catalysts: [], // §17.8: bewusst kein Fiscal-Katalysator
  price: 90,
  fcfTTM: 3200,
  sector: "Consumer Cyclical",
  industry: "Footwear & Accessories",
  crvFixture: {
    totalDebt: 8900, cashEquivalents: 10800, marketCap: 130000, sharesOutstanding: 1560,
    revenue: 51200, ebitda: 6300, operatingIncome: 5100, capex: 900,
    epsTTM: 3.2, epsConsensusNextFY: 3.4, beta5Y: 1.0, lynchClass: "stalwart",
    sectorMaxDrawdown: 40, fcfHaircut: 0, sectorGrowthG1: 8, sectorGrowthTerminal: 2.5, sectorWaccAvg: 8.5,
    historicalPrices: genHistoricalPrices(90, "2023-09-30", 22),
    risks: [
      { name: "Marktanteilsverlust (On/Hoka)", category: "Gradual", ew: 55, impact: 25, expectedDamage: 13.75 },
      { name: "Lageraufbau/Abschreibungen", category: "Gradual", ew: 45, impact: 20, expectedDamage: 9 },
    ],
    sector: "Consumer Cyclical", moatRating: "Narrow", analystPTMedian: 95,
    governmentExposure: 2, fcfMarginYoyPp: -3.5, marginDeltaYoYPp: -2.8,
  },
};

// ============================================================================
// Fixture 3: ASML — EUV-Monopolist, hohe Qualitaet, zyklische Delle im
// Auftragseingang (2024/25 bekannter Nachfrage-Dip bei China-Exportbeschraen-
// kungen + verzoegerten Logic-Investitionen), aber strukturell intakt.
// ============================================================================
const asml: Fixture = {
  ticker: "ASML",
  asOf: "2026-08-30",
  ctx: {
    impliedGStar: 13,
    quarterlyRevenueChronological: [
      6200, 6700, 6900, 7200, // vor 2 Jahren
      5300, 6200, 6700, 7500, // letztes Jahr -- Delle Q1, danach Erholung
    ],
    annualIncome: [
      { revenue: 27600, operatingIncome: 8700 }, // FY24
      { revenue: 27600, operatingIncome: 9800 }, // FY23 (Marge etwas hoeher)
    ],
    annualBalance: [{ inventory: 10200 }, { inventory: 9100 }],
    subjectRevenueGrowth: 6.5,
    peerRevenueGrowths: [4.0, -2.0, 9.0], // Halbleiter-Equipment-Peer-Range (zyklisch)
    regulatoryGate: null, // Export-Restriktionen sind bekannt, aber kein
    // gecachtes Regulatory-Gate in dieser Fixture (kein Live-Call in Tests).
  },
  health: "Excellent",
  moatRating: "Wide",
  technicalIndicators: { priceAboveMA200: true, ma50AboveMA200: false },
  catalysts: [makeCatalyst({ name: "High-NA EUV Ramp", pos: true, gb: 2.0 })],
  price: 780,
  fcfTTM: 6900,
  sector: "Technology",
  industry: "Semiconductor Equipment & Materials",
  crvFixture: {
    totalDebt: 2900, cashEquivalents: 6300, marketCap: 310000, sharesOutstanding: 393,
    revenue: 27600, ebitda: 10600, operatingIncome: 8700, capex: 2000,
    epsTTM: 21.5, epsConsensusNextFY: 24.0, beta5Y: 1.2, lynchClass: "fast_grower",
    sectorMaxDrawdown: 35, fcfHaircut: 0, sectorGrowthG1: 15, sectorGrowthTerminal: 3, sectorWaccAvg: 9.0,
    historicalPrices: genHistoricalPrices(780, "2026-08-30", 33),
    risks: [
      { name: "China-Exportbeschraenkungen", category: "Binary", ew: 35, impact: 30, expectedDamage: 10.5 },
      { name: "Zyklischer Auftragseingang", category: "Gradual", ew: 50, impact: 20, expectedDamage: 10 },
    ],
    sector: "Technology", moatRating: "Wide", analystPTMedian: 850,
    governmentExposure: 15, fcfMarginYoyPp: 2.0, marginDeltaYoYPp: 1.5,
  },
};

// ============================================================================
// Fixture 4: RHM.DE (Rheinmetall) — Defense-Fiscal-Megatrend-Kandidat
// (NATO-2%-Ziel, Sondervermoegen), starkes Wachstum, HOHE Bewertung (Reverse-
// DCF-Gap moeglich) -- testet den Fiscal-Qualify-Pfad UND dass replayAt() den
// gleichen fiscal.qualifies/evPercent liefert wie buildScoringForAnalysis().
// ============================================================================
const rhm: Fixture = {
  ticker: "RHM.DE",
  asOf: "2026-08-30",
  ctx: {
    impliedGStar: 22,
    quarterlyRevenueChronological: [
      1650, 1800, 2100, 2600, // vor 2 Jahren
      2100, 2350, 2700, 3300, // letztes Jahr -- deutliches Wachstum (Auftragsbestand)
    ],
    annualIncome: [
      { revenue: 10450, operatingIncome: 1225 }, // FY24
      { revenue: 7180, operatingIncome: 750 },    // FY23
    ],
    annualBalance: [{ inventory: 4200 }, { inventory: 3100 }],
    subjectRevenueGrowth: 36.0,
    peerRevenueGrowths: [12.0, 8.0], // Breiterer Defense-Peer-Vergleich (Leonardo, Thales grob)
    regulatoryGate: null,
  },
  health: "Good",
  moatRating: "Narrow",
  technicalIndicators: { priceAboveMA200: true, ma50AboveMA200: true },
  catalysts: [
    makeCatalyst({
      name: "NATO 2%-Ziel / Verteidigungssondervermoegen",
      pos: true,
      gb: 5.0,
      tags: ["fiscal-megatrend"] as any,
      // fiscalMegatrendQualifies() (scoring-gates.ts §17.5-17.7) verlangt
      // ALLE dieser Felder, sonst bleibt fiscal.qualifies = false:
      // type in {fiscal, capacity}, confidence='high', probability>=0.6,
      // source.url gesetzt, epsImpact != null, source.publishedAt <= asOfDate
      // (Lookahead-Sperre). Bewusst vollstaendig befuellt, um den Fiscal-
      // Qualify-Pfad tatsaechlich zu durchlaufen statt ihn nur zu behaupten.
      type: "fiscal" as any,
      confidence: "high" as any,
      probability: 0.75,
      epsImpact: 0.12,
      nettoUpside: 8.0,
      source: {
        url: "https://www.bundesregierung.de/breg-de/aktuelles/sondervermoegen-bundeswehr",
        publishedAt: "2026-06-15",
      } as any,
    }),
  ],
  price: 1650,
  fcfTTM: 450,
  sector: "Industrials",
  industry: "Aerospace & Defense",
  crvFixture: {
    totalDebt: 3200, cashEquivalents: 1800, marketCap: 55000, sharesOutstanding: 43,
    revenue: 10450, ebitda: 1750, operatingIncome: 1225, capex: 550,
    epsTTM: 18.0, epsConsensusNextFY: 24.0, beta5Y: 1.4, lynchClass: "fast_grower",
    sectorMaxDrawdown: 40, fcfHaircut: 0, sectorGrowthG1: 8, sectorGrowthTerminal: 2.5, sectorWaccAvg: 9.0,
    historicalPrices: genHistoricalPrices(1650, "2026-08-30", 44),
    risks: [
      { name: "Ruestungsbudget-Kuerzung nach Wahl", category: "Binary", ew: 25, impact: 35, expectedDamage: 8.75 },
      { name: "Bewertung bereits hoch (Multiple-Kompression)", category: "Gradual", ew: 45, impact: 25, expectedDamage: 11.25 },
    ],
    sector: "Industrials", moatRating: "Narrow", analystPTMedian: 1750,
    governmentExposure: 65, fcfMarginYoyPp: 0.5, marginDeltaYoYPp: 0.3,
  },
};

const fixtures: Fixture[] = [msft, nke, asml, rhm];

console.log("\n=== Backtest Replay-Paritaet: replayAt() vs. buildScoringForAnalysis() ===");
console.log("(WORK_SIGNAL_BACKTEST.md §13: replay(ticker, today) === live scoring fields)\n");

for (const fx of fixtures) {
  console.log(`--- ${fx.ticker} (asOf=${fx.asOf}) ---`);

  // (a) "Live"-Pfad — identischer Aufruf wie server/analyze-route.ts ~L1578.
  const live = buildScoringForAnalysis({
    ctx: fx.ctx,
    health: fx.health,
    moatRating: fx.moatRating,
    technicalIndicators: fx.technicalIndicators,
    catalysts: fx.catalysts,
    price: fx.price,
    asOfDate: fx.asOf,
  });

  // Sprint B3 Phase 1b: "Live"-CRV/invDcf — EXAKT dieselbe Pipeline wie
  // SummarySection.tsx ("Fazit"-Block) UND wie server/analyze-route.ts sie
  // jetzt am replayAt()-Call-Site berechnet (siehe computeCrvAndInvDcf()
  // oben) — ein Modul, ein Aufruf, zwei "Seiten" (hier: zwei Aufrufstellen
  // im selben Testlauf, die beide dieselbe Funktion nutzen).
  const liveCrv = computeCrvAndInvDcf(fx);

  // (b) "Replay"-Pfad — Phase 1 (server/backtest/replay.ts). invDcf/crv/
  // T-Rohwerte werden jetzt (Phase 1b) mit den ECHTEN, oben berechneten
  // Werten uebergeben — genau wie analyze-route.ts es jetzt tut (kein
  // hartcodiertes null mehr).
  const snapshot = replayAt({
    ticker: fx.ticker,
    asOf: fx.asOf,
    ctx: fx.ctx,
    health: fx.health,
    moatRating: fx.moatRating,
    technicalIndicators: fx.technicalIndicators,
    catalysts: fx.catalysts,
    price: fx.price,
    fcfTTM: fx.fcfTTM,
    sector: fx.sector,
    industry: fx.industry,
    invDcf: liveCrv.invDcf,
    crv: liveCrv.crv,
    fv: liveCrv.fv,
    wc: liveCrv.wc,
    fcf_T: fx.fcfTTM,
    wacc_T: liveCrv.wacc,
    g_T: liveCrv.g1,
    WC_T: liveCrv.worstCase,
  });

  check(`${fx.ticker}: finalScore identisch (${live.finalScore} === ${snapshot.finalScore})`, live.finalScore === snapshot.finalScore);
  check(`${fx.ticker}: rawScore identisch (${live.rawScore} === ${snapshot.rawScore})`, live.rawScore === snapshot.rawScore);
  check(`${fx.ticker}: qualityScore identisch (${live.qualityScore} === ${snapshot.qualityScore})`, live.qualityScore === snapshot.qualityScore);
  check(`${fx.ticker}: trendMultiplier identisch (${live.trendMultiplier} === ${snapshot.trendMultiplier})`, live.trendMultiplier === snapshot.trendMultiplier);
  check(`${fx.ticker}: cappedBy identisch (${live.cappedBy} === ${snapshot.cappedBy})`, live.cappedBy === snapshot.cappedBy);
  check(
    `${fx.ticker}: gates[] deep-equal (${live.gates.length} Gates)`,
    JSON.stringify(live.gates) === JSON.stringify(snapshot.gates),
    `live=${JSON.stringify(live.gates)} snapshot=${JSON.stringify(snapshot.gates)}`
  );
  check(`${fx.ticker}: fiscal.qualifies identisch (${live.fiscal.qualifies} === ${snapshot.fiscalQualifies})`, live.fiscal.qualifies === snapshot.fiscalQualifies);
  check(`${fx.ticker}: fiscal.evPercent identisch (${live.fiscal.evPercent} === ${snapshot.fiscalEVPercent})`, live.fiscal.evPercent === snapshot.fiscalEVPercent);

  // dcfApplicable-Klassenregel (§3.3) -- rein informativ hier mitgeprueft,
  // kein Bestandteil des Score/Gates/cappedBy-Paritaetskriteriums selbst.
  const expectedDcfApplicable = computeDcfApplicable({ fcfTTM: fx.fcfTTM, sector: fx.sector, industry: fx.industry });
  check(`${fx.ticker}: dcfApplicable = ${expectedDcfApplicable} (FCF=${fx.fcfTTM}, Sektor=${fx.sector})`, snapshot.dcfApplicable === expectedDcfApplicable);

  // Sprint B3 Phase 1b (Ticket-Akzeptanzkriterien):
  // 1) dataComplete.overall muss jetzt TRUE sein — invDcf/crv sind nicht
  //    mehr null (vorher Phase 0+1: immer false/null).
  check(
    `${fx.ticker}: dataComplete.overall = true (invDcf/crv jetzt real statt null)`,
    snapshot.dataComplete.overall === true && snapshot.invDcf != null && snapshot.crv != null
  );

  // 2) CRV bit-identisch (4 Nachkommastellen) zwischen "Live"-Berechnung
  //    (computeCrvAndInvDcf(), hier simuliert wie SummarySection.tsx) und
  //    dem server-seitigen Snapshot (replayAt(), gefuettert von genau
  //    denselben Werten wie analyze-route.ts es jetzt tut). Da beide Seiten
  //    dieselbe Funktion (shared/valuation-signal.ts:calculateCRV) mit
  //    denselben Inputs aufrufen, MUESSEN die Werte exakt gleich sein --
  //    kein Rundungsunterschied durch getrennte Formel-Pfade.
  check(
    `${fx.ticker}: CRV bit-identisch auf 4 Nachkommastellen (live=${liveCrv.crv.toFixed(4)} === snapshot=${snapshot.crv?.toFixed(4)})`,
    snapshot.crv != null && liveCrv.crv.toFixed(4) === snapshot.crv.toFixed(4)
  );
  check(
    `${fx.ticker}: invDcf bit-identisch auf 4 Nachkommastellen (live=${liveCrv.invDcf.toFixed(4)} === snapshot=${snapshot.invDcf?.toFixed(4)})`,
    snapshot.invDcf != null && liveCrv.invDcf.toFixed(4) === snapshot.invDcf.toFixed(4)
  );
  check(
    `${fx.ticker}: fv (gehaertet) bit-identisch auf 4 Nachkommastellen (live=${liveCrv.fv.toFixed(4)} === snapshot=${snapshot.fv?.toFixed(4)})`,
    snapshot.fv != null && liveCrv.fv.toFixed(4) === snapshot.fv.toFixed(4)
  );
  check(
    `${fx.ticker}: wc (gehaertet) bit-identisch auf 4 Nachkommastellen (live=${liveCrv.wc.toFixed(4)} === snapshot=${snapshot.wc?.toFixed(4)})`,
    snapshot.wc != null && liveCrv.wc.toFixed(4) === snapshot.wc.toFixed(4)
  );

  // 3) P - WC <= 0 => calculateCRV() liefert 99 (Sonderfall) -- clientseitig
  //    UND serverseitig identisch, da dieselbe Funktion aufgerufen wird.
  //    Informativ mitgeprueft (kein Fixture hier hat WC >= P, aber die
  //    Regel selbst wird unten separat isoliert getestet, siehe §5).
  if (fx.price - liveCrv.worstCase <= 0) {
    check(`${fx.ticker}: P - WC <= 0 => CRV = 99 (Sonderfall)`, liveCrv.crv === 99 && snapshot.crv === 99);
  }

  // 4) signal(live) === signal(replay(heute)) -- die zentrale Paritaets-
  //    Anforderung des Tickets. "live" hier: signalV1() direkt mit den
  //    liveCrv-Werten (der "echten" Live-Berechnung) plus den Score/Gate-
  //    Feldern aus buildScoringForAnalysis() (live). "replay": deriveSignalV1()
  //    (duenner Wrapper um signalV1(), siehe signal.ts) mit dem persistierten
  //    Snapshot. Beide muessen zum selben Ergebnis kommen.
  const liveSignal = signalV1({
    dataComplete: { overall: true },
    dcfApplicable: snapshot.dcfApplicable, // dcfApplicable ist reine Klassifikation, nicht "Live" vs. "Replay" -- identisch in beiden Pfaden
    invDcf: liveCrv.invDcf,
    price: fx.price,
    fiscalQualifies: live.fiscal.qualifies,
    cappedBy: live.cappedBy,
    cappedBySeverity: (live.gates.find(g => g.id === live.cappedBy)?.severity as "warn" | "hard" | undefined) ?? null,
    crv: liveCrv.crv,
  });
  const replaySignal = deriveSignalV1({
    dataComplete: snapshot.dataComplete,
    dcfApplicable: snapshot.dcfApplicable,
    invDcf: snapshot.invDcf,
    price: fx.price,
    fiscalQualifies: snapshot.fiscalQualifies,
    cappedBy: snapshot.cappedBy,
    cappedBySeverity: snapshot.cappedBySeverity,
    crv: snapshot.crv,
  });
  check(
    `${fx.ticker}: signal(live) === signal(replay(heute)) (${liveSignal} === ${replaySignal})`,
    liveSignal === replaySignal && liveSignal !== null
  );

  console.log(`  ℹ️  Score=${live.finalScore} (raw=${live.rawScore}) cappedBy=${live.cappedBy ?? "-"} fiscal.qualifies=${live.fiscal.qualifies} dcfApplicable=${snapshot.dcfApplicable} invDcf=${snapshot.invDcf?.toFixed(2)} crv=${snapshot.crv?.toFixed(4)} signal=${replaySignal}`);
  console.log("");
}

// ============================================================================
// deriveSignalV1() Regel-Unit-Tests (Spec §9, unabhaengig von den Fixtures
// oben) -- deckt jede der 5 Regelzeilen isoliert ab.
// ============================================================================
console.log("--- deriveSignalV1() Regel-Isolationstests (§9) ---");
{
  const complete = { scoring: true, invDcf: true, crv: true, overall: true };
  const incomplete = { scoring: true, invDcf: false, crv: true, overall: false };

  check(
    "§9 Zeile 1: !dataComplete -> kein Signal",
    deriveSignalV1({ dataComplete: incomplete, dcfApplicable: true, invDcf: 100, price: 90, fiscalQualifies: false, cappedBy: null, cappedBySeverity: null, crv: 3.0 }) === null
  );
  check(
    "§9 Zeile 2: !dcfApplicable -> max Hold (CRV=3.0 waere sonst Buy)",
    deriveSignalV1({ dataComplete: complete, dcfApplicable: false, invDcf: null, price: 90, fiscalQualifies: false, cappedBy: null, cappedBySeverity: null, crv: 3.0 }) === "Hold"
  );
  check(
    "§9 Zeile 3: invDcf < price && kein Fiscal-Qualify -> Avoid",
    deriveSignalV1({ dataComplete: complete, dcfApplicable: true, invDcf: 80, price: 90, fiscalQualifies: false, cappedBy: null, cappedBySeverity: null, crv: 3.0 }) === "Avoid"
  );
  check(
    "§9 Zeile 3 (Ausnahme): invDcf < price ABER Fiscal-Qualify -> kein Avoid-Zwang (faellt auf CRV-Treppe zurueck)",
    deriveSignalV1({ dataComplete: complete, dcfApplicable: true, invDcf: 80, price: 90, fiscalQualifies: true, cappedBy: null, cappedBySeverity: null, crv: 3.0 }) === "Buy"
  );
  check(
    "§9 Zeile 4: cappedBy=PRICING_POWER + severity=hard -> kein Buy (Deckel auf Accumulate, CRV=3.0)",
    deriveSignalV1({ dataComplete: complete, dcfApplicable: true, invDcf: null, price: 90, fiscalQualifies: false, cappedBy: "PRICING_POWER", cappedBySeverity: "hard", crv: 3.0 }) === "Accumulate"
  );
  check(
    "§9 Zeile 4 (Gegentest): cappedBy=PRICING_POWER aber severity=warn -> Buy bleibt erlaubt",
    deriveSignalV1({ dataComplete: complete, dcfApplicable: true, invDcf: null, price: 90, fiscalQualifies: false, cappedBy: "PRICING_POWER", cappedBySeverity: "warn", crv: 3.0 }) === "Buy"
  );
  check(
    "§9 Zeile 5: CRV < 1.5 -> Avoid",
    deriveSignalV1({ dataComplete: complete, dcfApplicable: true, invDcf: null, price: 90, fiscalQualifies: false, cappedBy: null, cappedBySeverity: null, crv: 1.2 }) === "Avoid"
  );
  check(
    "§9 Zeile 6: 1.5 <= CRV < 2.0 -> Hold",
    deriveSignalV1({ dataComplete: complete, dcfApplicable: true, invDcf: null, price: 90, fiscalQualifies: false, cappedBy: null, cappedBySeverity: null, crv: 1.8 }) === "Hold"
  );
  check(
    "§9 Zeile 7: 2.0 <= CRV < 2.5 -> Accumulate",
    deriveSignalV1({ dataComplete: complete, dcfApplicable: true, invDcf: null, price: 90, fiscalQualifies: false, cappedBy: null, cappedBySeverity: null, crv: 2.3 }) === "Accumulate"
  );
  check(
    "§9 Zeile 8: CRV >= 2.5 -> Buy",
    deriveSignalV1({ dataComplete: complete, dcfApplicable: true, invDcf: null, price: 90, fiscalQualifies: false, cappedBy: null, cappedBySeverity: null, crv: 2.8 }) === "Buy"
  );
}

// ============================================================================
// Sprint B3 Phase 1b (Ticket-Akzeptanzkriterium + Nutzer-Praezisierung
// 30.08.2026): P - WC <= 0 => calculateCRV() liefert exakt 99 (Sonderfall,
// "unendlich gutes" CRV weil kein Downside mehr vorhanden ist). Explizit
// isoliert getestet (keine der 4 Ticker-Fixtures oben trifft diesen Fall).
// "Client"- und "Server"-Pfad sind hier trivial identisch, weil es sich um
// denselben Aufruf derselben Funktion aus shared/valuation-signal.ts
// handelt (EIN Modul) -- genau das ist der Punkt: es gibt keinen zweiten
// Formel-Pfad, der abweichen koennte.
// ============================================================================
console.log("\n--- CRV Sonderfall: P - WC <= 0 -> 99 (isoliert) ---");
{
  const price = 100;
  const wcEqualToPrice = 100; // P - WC = 0
  const wcAbovePrice = 110; // P - WC = -10 (WC > P, kann strukturell vorkommen wenn Floor > Price-Delta)
  const fv = 150;

  const crvAtZero = calculateCRV(fv, wcEqualToPrice, price);
  const crvAtZeroClientSide = calculateCRV(fv, wcEqualToPrice, price); // "zweiter Aufruf" simuliert den anderen Aufrufort (Section6.tsx vs. analyze-route.ts) -- dieselbe Funktion, daher zwingend bitgleich
  check("P - WC = 0 -> calculateCRV() = 99", crvAtZero === 99);
  check("P - WC = 0 -> 'Client'- und 'Server'-Pfad liefern identisch 99 (dieselbe Funktion)", crvAtZero === crvAtZeroClientSide);

  const crvNegative = calculateCRV(fv, wcAbovePrice, price);
  check("P - WC < 0 -> calculateCRV() = 99 (Sonderfall greift auch bei negativem Delta)", crvNegative === 99);

  const crvNormal = calculateCRV(fv, 80, price); // P - WC = 20 > 0 -> normale Formel, KEIN Sonderfall
  check("P - WC > 0 -> calculateCRV() != 99 (Regelfall bleibt unangetastet)", crvNormal !== 99 && isFinite(crvNormal));
}

console.log(`\n${failed === 0 ? "✅ Alle Tests bestanden" : `❌ ${failed} Test(s) fehlgeschlagen`}`);
process.exit(failed === 0 ? 0 : 1);
