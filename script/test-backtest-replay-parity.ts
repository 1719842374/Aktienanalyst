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
import type { Catalyst } from "../shared/schema";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
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

  // (b) "Replay"-Pfad — Phase 1 (server/backtest/replay.ts).
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

  // deriveSignalV1() darf mit fehlendem invDcf/CRV (Phase 0+1-Scope, siehe
  // replay.ts-Kommentar) NICHT halluzinieren -- muss `null` liefern
  // ("kein Signal"), solange dataComplete.overall = false ist.
  const signal = deriveSignalV1({
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
    `${fx.ticker}: deriveSignalV1() = null solange invDcf/CRV fehlen (dataComplete.overall=${snapshot.dataComplete.overall})`,
    signal === null && !snapshot.dataComplete.overall
  );

  console.log(`  ℹ️  Score=${live.finalScore} (raw=${live.rawScore}) cappedBy=${live.cappedBy ?? "-"} fiscal.qualifies=${live.fiscal.qualifies} dcfApplicable=${snapshot.dcfApplicable}`);
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

console.log(`\n${failed === 0 ? "✅ Alle Tests bestanden" : `❌ ${failed} Test(s) fehlgeschlagen`}`);
process.exit(failed === 0 ? 0 : 1);
