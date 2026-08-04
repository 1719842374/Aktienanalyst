/**
 * Tests fuer server/scoring-integration.ts — die Verdrahtung der Scoring-
 * Pipeline (WORK_SCORING_VORLAGE.md §0 + §17) mit der echten Aktienanalyse.
 *
 * Prueft:
 *  1. Drift-Schutz: calcRealizedGrowth8QServer (Server-Spiegel) verhaelt sich
 *     identisch zu calculateRealizedGrowth8Q (Client, WORK_REVERSE_DCF_BRIDGE
 *     TEIL 1) — gleiche Eingaben, gleiche Ergebnisse.
 *  2. deriveGateInputs: echte Ableitung aus Analyse-Rohdaten (Margen-Delta,
 *     Peer-Delta, Inventory-Delta) inkl. null-Verhalten bei fehlenden Daten.
 *  3. mapQualityScore / mapTrendMultiplier: dokumentierte Mapping-Tabelle.
 *  4. Nike-2023-Fixture DURCH DIE PRODUKTIVE INTEGRATION (buildScoringForAnalysis
 *     mit AnalysisScoringContext statt direkt konstruierten GateInputs):
 *     schwaches 8Q-Wachstum aus echten Quartalszahlen-Arrays, Margenbruch aus
 *     Income-Statements, Share-Loss aus Peer-Wachstum → Score ≤ 55.
 *
 * Ausfuehren: npx tsx script/test-scoring-integration.ts
 */
import {
  calcRealizedGrowth8QServer,
  deriveGateInputs,
  mapQualityScore,
  mapTrendMultiplier,
  buildScoringForAnalysis,
  QUALITY_SCORE_MAP,
  TREND_RULES,
  type AnalysisScoringContext,
} from "../server/scoring-integration";
import { calculateRealizedGrowth8Q } from "../client/src/lib/calculations";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n=== 1. Drift-Schutz: Server-Spiegel === Client-Original ===");
{
  const cases: Array<number[] | null> = [
    // 16 Quartale, sauberes Wachstum
    [100, 102, 104, 106, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130],
    // exakt 8 Quartale (QoQ-Fallback)
    [100, 103, 106, 109, 112, 115, 118, 121],
    // 12 Quartale (QoQ-Fallback mit mehr Daten)
    [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111],
    // zu wenig
    [100, 105, 110],
    // null
    null,
    // mit unbrauchbaren Werten dazwischen
    [100, 0, 104, -5, 108, 110, 112, 114, 116, 118, 120, 122, 124, 126, 128, 130, 132, 134],
  ];
  for (const [i, input] of cases.entries()) {
    const server = calcRealizedGrowth8QServer(input);
    const client = calculateRealizedGrowth8Q(input);
    const same =
      server.method === client.method &&
      server.quartersUsed === client.quartersUsed &&
      ((server.realizedGrowth8Q === null && client.realizedGrowth8Q === null) ||
        (server.realizedGrowth8Q !== null && client.realizedGrowth8Q !== null &&
         Math.abs(server.realizedGrowth8Q - client.realizedGrowth8Q) < 1e-9));
    check(`Fall ${i + 1}: identisches Ergebnis (${server.method}, ${server.realizedGrowth8Q?.toFixed(2) ?? "null"})`, same,
      `server=${JSON.stringify(server)} client=${JSON.stringify(client)}`);
  }
}

console.log("\n=== 2. deriveGateInputs aus echten Analyse-Rohdaten ===");
{
  const ctx: AnalysisScoringContext = {
    impliedGStar: 9.5,
    quarterlyRevenueChronological: [100, 101, 102, 103, 104, 105, 106, 107, 100, 101, 102, 103, 104, 105, 106, 107],
    annualIncome: [
      { revenue: 51000, operatingIncome: 5600 },  // FY0: 10.98% Marge
      { revenue: 50000, operatingIncome: 7100 },  // FY-1: 14.2% Marge → Delta -3.22pp
    ],
    annualBalance: [{ inventory: 9500 }, { inventory: 7800 }], // +21.8%
    subjectRevenueGrowth: 2.0,
    peerRevenueGrowths: [8.0, 5.0, null, 9.0],   // Median der echten Werte [5,8,9]: 8.0
  };
  const gi = deriveGateInputs(ctx);
  check("impliedGrowthPercent durchgereicht (9.5)", gi.impliedGrowthPercent === 9.5);
  check("realizedGrowth8Q = 0 % (identische 8Q-Bloecke, yoy_8q)", gi.realizedGrowth8QPercent === 0 && gi.realizedGrowthMethod === "yoy_8q");
  check("marginDeltaYoYPp = -3.22pp (10.98 - 14.2)", gi.marginDeltaYoYPp === -3.22, String(gi.marginDeltaYoYPp));
  check("relativeGrowthDeltaYoYPp = -6.0pp (2.0 - Median[5,8,9]=8.0)", gi.relativeGrowthDeltaYoYPp === -6.0, String(gi.relativeGrowthDeltaYoYPp));
  check("inventoryDaysDeltaYoYPct = +21.8 %", gi.inventoryDaysDeltaYoYPct === 21.8, String(gi.inventoryDaysDeltaYoYPct));
}
{
  // Fehlende Daten → null, kein Fake
  const gi = deriveGateInputs({
    impliedGStar: null, quarterlyRevenueChronological: null,
    annualIncome: null, annualBalance: null,
    subjectRevenueGrowth: null, peerRevenueGrowths: null,
  });
  check("alle Inputs fehlen → alle Ableitungen null (kein Fake-Default)",
    gi.impliedGrowthPercent === null && gi.realizedGrowth8QPercent === null &&
    gi.marginDeltaYoYPp === null && gi.relativeGrowthDeltaYoYPp === null &&
    gi.inventoryDaysDeltaYoYPct === null);
  check("nur 1 Peer mit Wert → relativeGrowthDelta null (min. 2 echte Peers)",
    deriveGateInputs({
      impliedGStar: 5, quarterlyRevenueChronological: null, annualIncome: null,
      annualBalance: null, subjectRevenueGrowth: 3, peerRevenueGrowths: [7, null, null],
    }).relativeGrowthDeltaYoYPp === null);
}
{
  // BUGFIX-Regressionstest (live gefunden bei TSLA, generisches Problem —
  // nicht ticker-spezifisch): ein einzelner extremer Ausreisser-Peer (z.B.
  // Spin-off-/Sondereffekt-Jahr) darf den Mittelwert NICHT verzerren. Median
  // ist robust: [3, 4, 5, 2684.3] hat Median 4.5, nicht den vom Ausreisser
  // dominierten Mittelwert 674.1.
  const withOutlier = deriveGateInputs({
    impliedGStar: 5, quarterlyRevenueChronological: null, annualIncome: null,
    annualBalance: null, subjectRevenueGrowth: -2.9,
    peerRevenueGrowths: [-28.9, 1.2, 2684.3, 19.7, -25.2], // echte TSLA-Peer-Fixture
  });
  check(
    `Ausreisser-Robustheit: Median statt Mittelwert (Median[-28.9,-25.2,1.2,19.7,2684.3]=1.2 → Delta -4.1pp, NICHT -533pp)`,
    withOutlier.relativeGrowthDeltaYoYPp !== null && Math.abs(withOutlier.relativeGrowthDeltaYoYPp - (-4.1)) < 0.01,
    String(withOutlier.relativeGrowthDeltaYoYPp)
  );
}

console.log("\n=== 3. Mapping-Tabellen ===");
{
  check("Excellent + Wide = 88", mapQualityScore("Excellent", "Wide") === 88);
  check("Good + Narrow = 72", mapQualityScore("Good", "Narrow") === 72);
  check("Moderate + None = 55", mapQualityScore("Moderate", "None") === 55);
  check("Critical ohne Moat = 28", mapQualityScore("Critical", "None") === 28);
  check("unbekannte health → Moderate-Default (55)", mapQualityScore(undefined, undefined) === QUALITY_SCORE_MAP.Moderate);
  check("Aufwaertstrend = 1.1", mapTrendMultiplier({ priceAboveMA200: true, ma50AboveMA200: true }) === TREND_RULES.UPTREND);
  check("Abwaertstrend = 0.9", mapTrendMultiplier({ priceAboveMA200: false, ma50AboveMA200: false }) === TREND_RULES.DOWNTREND);
  check("gemischt = 1.0", mapTrendMultiplier({ priceAboveMA200: true, ma50AboveMA200: false }) === TREND_RULES.NEUTRAL);
  check("keine Indikatoren = 1.0", mapTrendMultiplier(null) === TREND_RULES.NEUTRAL);
}

console.log("\n=== 4. Nike-2023-Fixture durch die PRODUKTIVE Integration ===");
{
  // Dieselbe Nike-Situation wie in test-scoring-pipeline.ts, aber als ROHDATEN
  // (Quartalsumsaetze, Income-Statements, Peer-Wachstum) statt direkt
  // konstruierter GateInputs — genau der Weg, den /api/analyze nimmt.
  // 16 Quartale: erste 8 Summe 12500, letzte 8 Summe 12750 → +2.0% YoY-8Q.
  const nikeQuarterly = [
    1540, 1550, 1560, 1570, 1580, 1560, 1570, 1570,   // aeltere 8Q (Summe 12500)
    1570, 1580, 1590, 1600, 1610, 1590, 1600, 1610,   // letzte 8Q (Summe 12750)
  ];
  const sumOld = nikeQuarterly.slice(0, 8).reduce((s, v) => s + v, 0);
  const sumNew = nikeQuarterly.slice(8).reduce((s, v) => s + v, 0);
  check(`Fixture-Kontrolle: 8Q-YoY = +2.0 % (${(((sumNew - sumOld) / sumOld) * 100).toFixed(1)}%)`,
    Math.abs(((sumNew - sumOld) / sumOld) * 100 - 2.0) < 0.01);

  const result = buildScoringForAnalysis({
    ctx: {
      impliedGStar: 9.5,                                  // Markt preist ~9.5% ein
      quarterlyRevenueChronological: nikeQuarterly,       // → Realized 8Q = +2.0%
      annualIncome: [
        { revenue: 51217, operatingIncome: 5620 },        // ~10.97% (FY2023-artig)
        { revenue: 49107, operatingIncome: 6950 },        // ~14.15% → Delta ≈ -3.2pp
      ],
      annualBalance: [{ inventory: 8454 }, { inventory: 6972 }], // +21.3% (bekannter Lageraufbau)
      subjectRevenueGrowth: 2.0,
      peerRevenueGrowths: [9.0, 4.0, 7.0],                // Peer-Avg 6.67 → Delta -4.67pp
    },
    health: "Good",            // Nike war bilanziell solide — Rohqualitaet hoch
    moatRating: "Wide",        // Marke = Wide Moat → qualityScore 68+8=76
    technicalIndicators: { priceAboveMA200: false, ma50AboveMA200: false }, // 2023: Abwaertstrend
    catalysts: [],             // §17.8: kein Fiscal-Katalysator
    price: 90,
    asOfDate: "2023-09-30",
  });

  check("gapRatio 9.5/2.0 = 4.75 → DCF_REALITY_CHECK aktiv",
    result.gates.find(g => g.id === "DCF_REALITY_CHECK")?.active === true);
  check("Margen-Delta -3.2pp → PRICING_POWER aktiv",
    result.gates.find(g => g.id === "PRICING_POWER")?.active === true);
  check("Realized 2% < 5% UND Peer-Delta -4.67pp → RELATIVE_GROWTH aktiv",
    result.gates.find(g => g.id === "RELATIVE_GROWTH")?.active === true);
  check("Inventory +21.3% > 15% → INVENTORY aktiv",
    result.gates.find(g => g.id === "INVENTORY")?.active === true);
  check("kein Fiscal → keine Milderung", result.fiscal.qualifies === false);
  check(`qualityScore 76 (Good 68 + Wide 8), Trend 0.9 → roh 68.4 (tatsaechlich ${result.rawScore})`,
    result.qualityScore === 76 && result.trendMultiplier === 0.9 && Math.abs(result.rawScore - 68.4) < 0.05);
  check(`§17.8 Nike-Zielwert: finalScore ≤ 55 (tatsaechlich ${result.finalScore})`, result.finalScore <= 55);
  check("gedeckelt durch PRICING_POWER (strengster Cap 55)", result.cappedBy === "PRICING_POWER");
  console.log(`  ℹ️  Nike produktiv: quality=${result.qualityScore} × trend=${result.trendMultiplier} = roh ${result.rawScore} → final ${result.finalScore} (${result.cappedBy})`);
}

console.log(failed === 0 ? "\n✅ Alle Scoring-Integrations-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
