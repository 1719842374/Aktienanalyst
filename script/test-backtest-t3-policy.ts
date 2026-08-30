/**
 * script/test-backtest-t3-policy.ts — Sprint B3 Phase 5b, Ticket-Punkt 6
 * ("Neues Testskript script/test-backtest-t3-policy.ts: synthetisches
 * Portfolio mit bekannten Signal-Wechseln, verifiziert Rebalance-Trigger
 * (|Δw|>2pp), Kosten-Bucket-Zuordnung (mega/large/mid nach Marktkap. via
 * capBucket() aus costs.ts), Gross-vs-Net-Differenz").
 *
 * SYNTHETISCH = keine Live-FMP-Calls, keine echten Ticker-Kursreihen — nur
 * handgebaute T3TickerSignalAtQuarter[][]-Fixtures mit BEKANNTEN
 * Erwartungswerten, damit jede Assertion exakt (nicht nur "plausibel")
 * geprueft werden kann. KEIN LLM, KEINE echten Ticker-Hardcodes im
 * Sinne von §4.3 (die hier verwendeten Symbole "AAA"/"BBB"/... sind reine
 * Test-Fixture-Labels, kein Bezug zu echten Firmen/Gates).
 *
 * Aufruf: npx tsx script/test-backtest-t3-policy.ts
 */
import {
  simulateT3Policy,
  buildTargetWeights,
  computeT3Trades,
  T3_MAX_TITLES,
  T3_REBALANCE_THRESHOLD_PP,
  type T3TickerSignalAtQuarter,
} from "../server/backtest/t3-policy";
import { capBucket, roundTurnCostBp } from "../server/backtest/costs";

let failures = 0;
function assertClose(label: string, actual: number, expected: number, eps = 1e-9): void {
  if (Math.abs(actual - expected) > eps) {
    failures++;
    console.error(`❌ ${label}: erwartet ${expected}, erhalten ${actual}`);
  } else {
    console.log(`✅ ${label}: ${actual}`);
  }
}
function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    failures++;
    console.error(`❌ ${label}: erwartet ${String(expected)}, erhalten ${String(actual)}`);
  } else {
    console.log(`✅ ${label}: ${String(actual)}`);
  }
}
function assertTrue(label: string, cond: boolean): void {
  if (!cond) {
    failures++;
    console.error(`❌ ${label}: Bedingung falsch`);
  } else {
    console.log(`✅ ${label}`);
  }
}

console.log("=== Test 1: capBucket()-Zuordnung (mega/large/mid) — Referenzwerte aus costs.ts ===");
assertEqual("capBucket(150e9) = mega", capBucket(150e9), "mega");
assertEqual("capBucket(50e9) = large", capBucket(50e9), "large");
assertEqual("capBucket(5e9) = mid", capBucket(5e9), "mid");
assertEqual("capBucket(0.5e9) = null (< CAP_FLOOR_USD)", capBucket(0.5e9), null);
assertClose("roundTurnCostBp(mega) = 7bp", roundTurnCostBp("mega"), 7);
assertClose("roundTurnCostBp(large) = 10bp", roundTurnCostBp("large"), 10);
assertClose("roundTurnCostBp(mid) = 34bp", roundTurnCostBp("mid"), 34);

console.log("\n=== Test 2: buildTargetWeights() — max 15 Titel, Ranking nach Signal, Gleichgewichtung ===");
{
  // 20 Kandidaten: 5x Buy, 5x Accumulate, 10x Hold -> nur top 15 (Buy+Accumulate+5xHold) gewaehlt.
  const candidates: T3TickerSignalAtQuarter[] = [];
  for (let i = 0; i < 5; i++) candidates.push({ ticker: `BUY${i}`, quarterEnd: "2024-03-31", signal: "Buy", capUsd: 50e9, quarterReturn: 0.01 });
  for (let i = 0; i < 5; i++) candidates.push({ ticker: `ACC${i}`, quarterEnd: "2024-03-31", signal: "Accumulate", capUsd: 50e9, quarterReturn: 0.01 });
  for (let i = 0; i < 10; i++) candidates.push({ ticker: `HLD${i}`, quarterEnd: "2024-03-31", signal: "Hold", capUsd: 50e9, quarterReturn: 0.01 });
  // Avoid/Reduce duerfen NIE ins Zielportfolio.
  candidates.push({ ticker: "AVOID1", quarterEnd: "2024-03-31", signal: "Avoid", capUsd: 50e9, quarterReturn: 0.01 });
  candidates.push({ ticker: "REDUCE1", quarterEnd: "2024-03-31", signal: "Reduce", capUsd: 50e9, quarterReturn: 0.01 });

  const weights = buildTargetWeights(candidates);
  assertEqual("buildTargetWeights: genau T3_MAX_TITLES Positionen", weights.size, T3_MAX_TITLES);
  assertTrue("buildTargetWeights: alle 5 Buy-Titel enthalten", [0, 1, 2, 3, 4].every(i => weights.has(`BUY${i}`)));
  assertTrue("buildTargetWeights: alle 5 Accumulate-Titel enthalten", [0, 1, 2, 3, 4].every(i => weights.has(`ACC${i}`)));
  assertTrue("buildTargetWeights: Avoid NIE enthalten", !weights.has("AVOID1"));
  assertTrue("buildTargetWeights: Reduce NIE enthalten", !weights.has("REDUCE1"));
  assertClose("buildTargetWeights: Gleichgewicht 1/15 je Titel", weights.get("BUY0")!, 1 / 15);
  const sum = Array.from(weights.values()).reduce((s, w) => s + w, 0);
  assertClose("buildTargetWeights: Summe aller Gewichte = 1.0", sum, 1.0, 1e-9);
}

console.log("\n=== Test 3: computeT3Trades() — Rebalance nur wenn |Δw| > 2pp ===");
{
  const prev = new Map([
    ["XXX", 0.10], // vorher 10%
    ["YYY", 0.05], // vorher 5%
    ["ZZZ", 0.08], // wird komplett abgebaut (nicht mehr im Ziel)
  ]);
  const target = new Map([
    ["XXX", 0.115], // Δ = +1.5pp -> UNTER Schwelle -> kein Trade
    ["YYY", 0.09], // Δ = +4pp -> UEBER Schwelle -> Trade
    // ZZZ fehlt im Ziel -> Δ = -8pp -> UEBER Schwelle -> Trade (Komplettabbau)
  ]);
  const capByTicker = new Map<string, number | null>([
    ["XXX", 150e9], // mega
    ["YYY", 5e9], // mid
    ["ZZZ", 50e9], // large
  ]);
  const trades = computeT3Trades("2024-03-31", prev, target, capByTicker);
  const byTicker = new Map(trades.map(t => [t.ticker, t]));

  assertClose("XXX: Δw = 1.5pp (unter Schwelle)", byTicker.get("XXX")!.deltaWeightPp, 1.5, 1e-9);
  assertEqual("XXX: NICHT getradet (|Δw|=1.5pp <= 2pp)", byTicker.get("XXX")!.traded, false);
  assertClose("XXX: costPortfolioPp = 0 bei Hold ohne Fill", byTicker.get("XXX")!.costPortfolioPp, 0);

  assertClose("YYY: Δw = 4pp (ueber Schwelle)", byTicker.get("YYY")!.deltaWeightPp, 4, 1e-9);
  assertEqual("YYY: GETRADET (|Δw|=4pp > 2pp)", byTicker.get("YYY")!.traded, true);
  assertEqual("YYY: Bucket = mid", byTicker.get("YYY")!.bucket, "mid");
  assertClose("YYY: Round-Turn-Kosten = 34bp (mid)", byTicker.get("YYY")!.costRtBp, 34);
  // costPortfolioPp = |Δw|/100 * costRtBp/10000 * 100 = 0.04 * 34/10000 * 100 = 0.0136
  assertClose("YYY: costPortfolioPp = 0.0136", byTicker.get("YYY")!.costPortfolioPp, 0.0136, 1e-9);

  assertClose("ZZZ: Δw = -8pp (Komplettabbau, ueber Schwelle)", byTicker.get("ZZZ")!.deltaWeightPp, -8, 1e-9);
  assertEqual("ZZZ: GETRADET (Ausstieg)", byTicker.get("ZZZ")!.traded, true);
  assertEqual("ZZZ: Bucket = large", byTicker.get("ZZZ")!.bucket, "large");
  assertClose("ZZZ: Round-Turn-Kosten = 10bp (large)", byTicker.get("ZZZ")!.costRtBp, 10);
}

console.log("\n=== Test 4: simulateT3Policy() — Gross-vs-Net über 2 Quartale, bekannte Signal-Wechsel ===");
{
  // Q1: AAA (Buy, mega) + BBB (Buy, mid) je 50%. Kein Vorbestand -> beide Positionen sind NEUE
  // Trades (Δw = 50pp > 2pp), volle Round-Turn-Kosten fallen an.
  // Q2: AAA bleibt Buy (unveraendert -> KEIN Trade, |Δw|=0). BBB faellt auf Avoid
  //     (raus, Δw=-50pp -> Trade) und CCC (Buy, mega) tritt neu ein (Δw=+50pp -> Trade).
  const q1: T3TickerSignalAtQuarter[] = [
    { ticker: "AAA", quarterEnd: "2024-03-31", signal: "Buy", capUsd: 200e9, quarterReturn: 0.05 },
    { ticker: "BBB", quarterEnd: "2024-03-31", signal: "Buy", capUsd: 5e9, quarterReturn: 0.02 },
  ];
  const q2: T3TickerSignalAtQuarter[] = [
    { ticker: "AAA", quarterEnd: "2024-06-30", signal: "Buy", capUsd: 200e9, quarterReturn: 0.03 },
    { ticker: "BBB", quarterEnd: "2024-06-30", signal: "Avoid", capUsd: 5e9, quarterReturn: -0.10 }, // wird verkauft, Return zaehlt nicht mehr (Δw<0, kein Gewicht mehr gehalten)
    { ticker: "CCC", quarterEnd: "2024-06-30", signal: "Buy", capUsd: 200e9, quarterReturn: 0.01 },
  ];

  const report = simulateT3Policy([q1, q2]);
  assertEqual("Report-Status = ok", report.status, "ok");
  assertEqual("2 Quartale simuliert", report.quarters.length, 2);

  const Q1 = report.quarters[0];
  const Q2 = report.quarters[1];

  // --- Q1: beide Titel NEU (Δw=50pp je Titel, GETRADET) ---
  assertEqual("Q1: 2 Trades (beide Neueinstiege)", Q1.nTraded, 2);
  assertClose("Q1: Turnover = 100pp (2x 50pp)", Q1.turnoverPp, 100, 1e-9);
  // Gross Q1 = 0.5*0.05 + 0.5*0.02 = 0.035
  assertClose("Q1: Gross-Return = 3.5%", Q1.grossReturn, 0.035, 1e-9);
  // Kosten Q1: AAA (mega, 7bp) auf 50pp Δw: 0.5 * 7/10000 * 100 = 0.035pp
  //            BBB (mid, 34bp) auf 50pp Δw: 0.5 * 34/10000 * 100 = 0.17pp
  // costPp gesamt = 0.035 + 0.17 = 0.205 (in Portfolio-Prozentpunkten)
  assertClose("Q1: Kosten = 0.205pp", Q1.costPp, 0.205, 1e-9);
  // Net Q1 = Gross - costPp/100 = 0.035 - 0.00205 = 0.03295
  assertClose("Q1: Net-Return = Gross - Kosten/100", Q1.netReturn, 0.035 - 0.00205, 1e-9);
  assertTrue("Q1: Net < Gross (Kosten senken Nettorendite)", Q1.netReturn < Q1.grossReturn);

  // --- Q2: AAA haelt (kein Trade), BBB raus (Trade), CCC neu (Trade) ---
  assertEqual("Q2: 2 Trades (BBB raus, CCC neu) -- AAA unveraendert", Q2.nTraded, 2);
  const aaaTradeQ2 = Q2.trades.find(t => t.ticker === "AAA")!;
  assertEqual("Q2: AAA NICHT getradet (Signal unveraendert Buy->Buy)", aaaTradeQ2.traded, false);
  assertClose("Q2: AAA Δw = 0pp", aaaTradeQ2.deltaWeightPp, 0, 1e-9);
  const bbbTradeQ2 = Q2.trades.find(t => t.ticker === "BBB")!;
  assertEqual("Q2: BBB getradet (Avoid -> raus)", bbbTradeQ2.traded, true);
  const cccTradeQ2 = Q2.trades.find(t => t.ticker === "CCC")!;
  assertEqual("Q2: CCC getradet (neu, Buy)", cccTradeQ2.traded, true);

  // Ziel Q2: nur AAA + CCC sind Buy-eligible (BBB=Avoid ausgeschlossen) -> je 50%.
  // AAA behaelt sein altes Gewicht (0.5, kein Trade), CCC baut auf 0.5 auf.
  // Gross Q2 = 0.5*0.03 (AAA) + 0.5*0.01 (CCC) = 0.02. BBB-Return (-0.10) zaehlt NICHT
  // mehr, da BBB im Q2-Ziel nicht mehr gehalten wird (heldWeights nach Trade = 0).
  assertClose("Q2: Gross-Return = 2.0% (BBB-Verlust nicht mehr im Buch)", Q2.grossReturn, 0.02, 1e-9);
  assertTrue("Q2: Kosten > 0 (2 Trades fielen an)", Q2.costPp > 0);
  assertTrue("Q2: Net < Gross", Q2.netReturn < Q2.grossReturn);

  // --- Equity-Curve: kumulative Verkettung (1+r1)*(1+r2)-1, identisch zur B2-Formel ---
  const expectedCumGross = (1 + Q1.grossReturn) * (1 + Q2.grossReturn) - 1;
  const expectedCumNet = (1 + Q1.netReturn) * (1 + Q2.netReturn) - 1;
  assertClose("Equity-Curve Gross[1] = kumulierte Verkettung", report.equityCurveGross[1], expectedCumGross, 1e-9);
  assertClose("Equity-Curve Net[1] = kumulierte Verkettung", report.equityCurveNet[1], expectedCumNet, 1e-9);
  assertClose("totalReturnGrossPct = Equity-Curve-Endwert * 100", report.totalReturnGrossPct, expectedCumGross * 100, 1e-9);
  assertClose("totalReturnNetPct = Equity-Curve-Endwert * 100", report.totalReturnNetPct, expectedCumNet * 100, 1e-9);
  assertTrue("costDragTotalPct > 0 (Kosten schmaelern Gesamtrendite)", report.costDragTotalPct > 0);
  assertClose("costDragTotalPct = Gross - Net (Total, pp)", report.costDragTotalPct, report.totalReturnGrossPct - report.totalReturnNetPct, 1e-9);
}

console.log("\n=== Test 5: leere Eingabe -> status=insufficient_data, keine Exceptions ===");
{
  const empty = simulateT3Policy([]);
  assertEqual("Leere Zeitreihe: status = insufficient_data", empty.status, "insufficient_data");
  assertEqual("Leere Zeitreihe: 0 Quartale", empty.quarters.length, 0);
}

console.log("\n=== Test 6: fehlender Marktkap.-Wert -> Titel nicht handelbar, kein Kosten-Raten ===");
{
  const q: T3TickerSignalAtQuarter[] = [
    { ticker: "NOCAP", quarterEnd: "2024-03-31", signal: "Buy", capUsd: null, quarterReturn: 0.02 },
    { ticker: "HASCAP", quarterEnd: "2024-03-31", signal: "Buy", capUsd: 50e9, quarterReturn: 0.02 },
  ];
  const weights = buildTargetWeights(q);
  assertTrue("NOCAP (kein capUsd) wird NICHT ins Zielportfolio aufgenommen", !weights.has("NOCAP"));
  assertTrue("HASCAP wird aufgenommen", weights.has("HASCAP"));
}

console.log(`\n=== Ergebnis: ${failures === 0 ? "ALLE TESTS BESTANDEN" : `${failures} FEHLER`} ===`);
console.log(`(Referenzwerte: T3_MAX_TITLES=${T3_MAX_TITLES}, T3_REBALANCE_THRESHOLD_PP=${T3_REBALANCE_THRESHOLD_PP})`);
if (failures > 0) process.exit(1);
