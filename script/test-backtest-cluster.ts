/**
 * script/test-backtest-cluster.ts — Sprint B3 Phase 3 Akzeptanztest,
 * WORK_SIGNAL_BACKTEST.md §7.3 (exaktes Zahlenbeispiel Median vs. Mean) +
 * Ticket Punkt 8.
 *
 * Regressions-Anker: die 12 Avoid-Returns aus §7.3
 *   -42, -18, -11, -9, -6, -4, -2, +1, +3, +8, +14, +48
 * MUESSEN median=-3.0 und mean=-1.5 ergeben (Standard-Median: Mittelwert der
 * beiden mittleren Werte bei gerader Anzahl). Buy-Seite: median=+5.0,
 * mean=+9.2 (aus §7.3 uebernommen). Daraus folgt:
 *   δ_med  = -3.0 - 5.0  = -8.0pp
 *   δ_mean = -1.5 - 9.2  = -10.7pp
 *
 * Zusaetzlich: End-to-End-Test der drei Cluster-Stufen (clusterByMonthSignal
 * -> monthlyDeltas -> foldDelta -> headlinePitch) mit denselben 24 Events
 * (12 Avoid + 12 Buy in einem Monat), um zu beweisen, dass die Pipeline
 * dieselben Zahlen produziert wie die direkten median()/mean()-Aufrufe.
 *
 * Ausfuehren: npx tsx script/test-backtest-cluster.ts
 */
import {
  median,
  mean,
  clusterByMonthSignal,
  monthlyDeltas,
  foldDelta,
  headlinePitch,
  MIN_N_SIGNAL_PER_MONTH,
  type SignalReturnEvent,
} from "../server/backtest/cluster";
import type { SignalV1 } from "../server/backtest/types";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("=== §7.3-Fixture: Median vs. Mean (reine Funktionen) ===");

// §7.3: 12 Avoid-Returns (Dezimal statt Prozent hier egal, solange konsistent
// -- wir nutzen die Prozentwerte direkt als "Return in Prozentpunkten", exakt
// wie im Spec-Beispiel notiert, um 1:1 gegen die dort gedruckten Zahlen zu
// pruefen).
const avoidReturns = [-42, -18, -11, -9, -6, -4, -2, 1, 3, 8, 14, 48];
const buyReturns_synthetic = (() => {
  // §7.3 nennt fuer die Buy-Seite nur die Aggregate (median=+5.0, mean=+9.2),
  // nicht die 12 Einzelwerte. Wir konstruieren 12 Buy-Returns, die GENAU
  // median=5.0 und mean=9.2 ergeben (Summe = 12*9.2 = 110.4), damit der
  // End-to-End-Cluster-Test dieselben δ-Werte reproduziert wie das reine
  // Aggregat-Beispiel. Konstruktion: 11 Werte symmetrisch um 5.0 verteilt,
  // 12. Wert so gewaehlt, dass Summe/Median exakt stimmen.
  // gerade Anzahl (12) -> Median = Mittelwert der beiden mittleren Werte.
  // Wir waehlen sortiert: [-20,-10,-5,0,2,4,6,8,10,20,30, x] mit den 6.
  // und 7. Werten (Index 5,6 0-basiert nach Sortierung) im Mittel = 5.0.
  const base = [-20, -10, -5, 0, 2, 4, 6, 8, 10, 20, 30];
  // aktuelle Summe der 11 Basiswerte:
  const sumBase = base.reduce((s, v) => s + v, 0); // = 45
  // wir brauchen 6. und 7. Wert (nach Sortierung, 0-indiziert 5 und 6) im
  // Mittel = 5.0 -> aktuell sortiert: [-20,-10,-5,0,2,4,6,8,10,20,30]
  // Position 5 (0-idx) = 4, Position 6 = 6 -> Einfuegen eines 12. Werts
  // zwischen 4 und 6 verschiebt die Mittelpositionen. Einfacher: Wir waehlen
  // den 12. Wert x so, dass die Gesamtsumme = 110.4 UND x liegt so, dass die
  // sortierte Mitte exakt 5.0 ergibt. x = 110.4 - 45 = 65.4 -> testen:
  const x = 110.4 - sumBase;
  const arr = [...base, x];
  return arr;
})();

const mAvoid = median(avoidReturns);
const meanAvoid = mean(avoidReturns);
check("§7.3 Avoid-Median = -3.0", mAvoid === -3, `got ${mAvoid}`);
check("§7.3 Avoid-Mean = -1.5", Math.abs((meanAvoid ?? NaN) - (-1.5)) < 1e-9, `got ${meanAvoid}`);

const mBuy = median(buyReturns_synthetic);
const meanBuy = mean(buyReturns_synthetic);
check("Synthetische Buy-Seite: Median = 5.0 (konstruiert, um §7.3-Aggregat zu matchen)", Math.abs((mBuy ?? NaN) - 5.0) < 1e-9, `got ${mBuy}`);
check("Synthetische Buy-Seite: Mean = 9.2 (konstruiert, um §7.3-Aggregat zu matchen)", Math.abs((meanBuy ?? NaN) - 9.2) < 1e-6, `got ${meanBuy}`);

const deltaMedianExpected = mAvoid! - mBuy!; // -3.0 - 5.0 = -8.0
const deltaMeanExpected = meanAvoid! - meanBuy!; // -1.5 - 9.2 = -10.7
check("δ_med = -8.0pp (§7.3)", Math.abs(deltaMedianExpected - (-8.0)) < 1e-9, `got ${deltaMedianExpected}`);
check("δ_mean = -10.7pp (§7.3)", Math.abs(deltaMeanExpected - (-10.7)) < 1e-6, `got ${deltaMeanExpected}`);

console.log("\n=== End-to-End: clusterByMonthSignal -> monthlyDeltas -> foldDelta -> headlinePitch ===");

function buildEvents(returns: number[], signal: SignalV1, asOfMonth: string): SignalReturnEvent[] {
  return returns.map((r, i) => ({
    ticker: `SYN${signal}${i}`,
    asOfMonth,
    signal,
    r,
  }));
}

const month = "2023-08";
const events: SignalReturnEvent[] = [
  ...buildEvents(avoidReturns, "Avoid", month),
  ...buildEvents(buyReturns_synthetic, "Buy", month),
];

const clusters = clusterByMonthSignal(events);
check("clusterByMonthSignal() liefert genau 2 Cluster (1 Monat x 2 Signale)", clusters.length === 2, `got ${clusters.length}`);

const avoidCluster = clusters.find(c => c.signal === "Avoid");
const buyCluster = clusters.find(c => c.signal === "Buy");
check("Avoid-Cluster n=12", avoidCluster?.n === 12, `got ${avoidCluster?.n}`);
check("Buy-Cluster n=12", buyCluster?.n === 12, `got ${buyCluster?.n}`);
check("Avoid-Cluster median = -3.0 (End-to-End)", avoidCluster?.medianReturn === -3, `got ${avoidCluster?.medianReturn}`);
check("Avoid-Cluster mean = -1.5 (End-to-End)", Math.abs((avoidCluster?.meanReturn ?? NaN) - (-1.5)) < 1e-9, `got ${avoidCluster?.meanReturn}`);
check("Buy-Cluster median = 5.0 (End-to-End)", Math.abs((buyCluster?.medianReturn ?? NaN) - 5.0) < 1e-9, `got ${buyCluster?.medianReturn}`);
check("Buy-Cluster mean = 9.2 (End-to-End)", Math.abs((buyCluster?.meanReturn ?? NaN) - 9.2) < 1e-6, `got ${buyCluster?.meanReturn}`);
check("Kein Cluster ist belowMinN (n=12 >= MIN_N_SIGNAL_PER_MONTH=8)", !avoidCluster?.belowMinN && !buyCluster?.belowMinN);

const deltas = monthlyDeltas(clusters);
check("monthlyDeltas() liefert genau 1 Monatsdelta", deltas.length === 1, `got ${deltas.length}`);
const d = deltas[0];
check("Monatsdelta eligible=true (beide Seiten n>=8)", d?.eligible === true);
check("δ_t (Median) = -8.0pp (End-to-End)", Math.abs((d?.deltaMedian ?? NaN) - (-8.0)) < 1e-9, `got ${d?.deltaMedian}`);
check("δ_t (Mean) = -10.7pp (End-to-End)", Math.abs((d?.deltaMean ?? NaN) - (-10.7)) < 1e-6, `got ${d?.deltaMean}`);

const fold = foldDelta(deltas);
check("Δ_Fold (Median) = -8.0pp (Stufe 3, ein Monat -> Median = der eine Wert)", Math.abs((fold.deltaFoldMedian ?? NaN) - (-8.0)) < 1e-9, `got ${fold.deltaFoldMedian}`);
check("Δ_Fold (Mean) = -10.7pp (Stufe 3)", Math.abs((fold.deltaFoldMean ?? NaN) - (-10.7)) < 1e-6, `got ${fold.deltaFoldMean}`);
check("Δ_Fold nEligibleMonths = 1", fold.nEligibleMonths === 1, `got ${fold.nEligibleMonths}`);

const headline = headlinePitch([fold, fold, fold]); // simuliert 3 identische Folds
check("Headline (Median ueber 3 Folds) = -8.0pp", Math.abs((headline.headlineMedian ?? NaN) - (-8.0)) < 1e-9, `got ${headline.headlineMedian}`);
check("Headline (Mean ueber 3 Folds) = -10.7pp (Mean IMMER parallel ausgewiesen, nie alleinige Headline)", Math.abs((headline.headlineMean ?? NaN) - (-10.7)) < 1e-6, `got ${headline.headlineMean}`);

console.log("\n=== Min-n-Regel: n < 8 -> N/A (NICHT 0) ===");
const smallEvents: SignalReturnEvent[] = buildEvents([1, 2, 3, 4, 5], "Avoid", "2024-01"); // n=5 < 8
const smallClusters = clusterByMonthSignal(smallEvents);
check("n=5 (< MIN_N_SIGNAL_PER_MONTH=8) -> belowMinN=true", smallClusters[0]?.belowMinN === true);
check("n=5 -> medianReturn=null (NICHT 0, §7.2 'N/A statt 0')", smallClusters[0]?.medianReturn === null, `got ${smallClusters[0]?.medianReturn}`);
check("n=5 -> meanReturn=null (NICHT 0)", smallClusters[0]?.meanReturn === null, `got ${smallClusters[0]?.meanReturn}`);
check("MIN_N_SIGNAL_PER_MONTH-Konstante = 8 (§4.2)", MIN_N_SIGNAL_PER_MONTH === 8);

console.log("\n=== Ungerade Anzahl (Standard-Median-Sanity-Check) ===");
check("median([1,2,3]) = 2", median([1, 2, 3]) === 2);
check("median([1,2,3,4]) = 2.5", median([1, 2, 3, 4]) === 2.5);
check("median([]) = null (kein Raten bei leerer Liste)", median([]) === null);
check("mean([]) = null", mean([]) === null);

console.log(`\n${failed === 0 ? "✅ ALLE TESTS BESTANDEN" : `❌ ${failed} TEST(S) FEHLGESCHLAGEN`}`);
process.exit(failed === 0 ? 0 : 1);
