/**
 * Unit-Tests fuer client/src/lib/portfolio/positions.ts (Auftrag 10.08.2026,
 * "Portfolio UX (CAPM/Kelly) + Peer-Add/Remove Fix", Teil A).
 *
 * Ausfuehren: npx tsx script/test-portfolio-positions.ts
 */
import {
  computePositionPerformance, computeClosedPositionPerformance, computeMarketValue,
  computePortfolioWeights, computePortfolioKPIs, computePortfolioPerformanceSeries,
  makePosition, suggestConvictionFromScore, type PortfolioPosition,
} from "../client/src/lib/portfolio/positions";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// === computePositionPerformance ===

// 1. LONG-Performance (Adidas-Beispiel aus dem Referenz-Screenshot: 143.80 -> 164.75 = +14.57%)
const adidasPerf = computePositionPerformance(143.80, 164.75, "long");
check("computePositionPerformance: LONG Adidas-Beispiel ≈ +14.57%", adidasPerf != null && Math.abs(adidasPerf - 0.1457) < 0.001, `perf=${adidasPerf}`);

// 2. SHORT-Performance ist invertiert (fallender Kurs = Gewinn bei Short)
const shortPerf = computePositionPerformance(100, 80, "short");
check("computePositionPerformance: SHORT bei fallendem Kurs = positive Performance", shortPerf != null && shortPerf > 0, `perf=${shortPerf}`);
const shortLoss = computePositionPerformance(100, 120, "short");
check("computePositionPerformance: SHORT bei steigendem Kurs = negative Performance", shortLoss != null && shortLoss < 0, `perf=${shortLoss}`);

// 3. Fehlender/ungueltiger Kurs -> null (NIEMALS 0 als Platzhalter)
check("computePositionPerformance: null lastPrice -> null (kein Fake-0)", computePositionPerformance(100, null, "long") === null);
check("computePositionPerformance: negativer lastPrice -> null", computePositionPerformance(100, -5, "long") === null);
check("computePositionPerformance: 0 entryPrice -> null (Division durch 0 vermieden)", computePositionPerformance(0, 100, "long") === null);

// === computeClosedPositionPerformance ===

// 4. Geschlossene Position nutzt Exit-Preis, nicht Live-Preis
const closedPos = makePosition({ entryPrice: 100, exitPrice: 130, side: "long", status: "closed" });
check("computeClosedPositionPerformance: nutzt exitPrice", Math.abs((computeClosedPositionPerformance(closedPos) ?? NaN) - 0.3) < 1e-9, `perf=${computeClosedPositionPerformance(closedPos)}`);
const noExitPos = makePosition({ entryPrice: 100, exitPrice: null, status: "closed" });
check("computeClosedPositionPerformance: fehlender exitPrice -> null", computeClosedPositionPerformance(noExitPos) === null);

// === computeMarketValue ===

// 5. Marktwert = qty * lastPrice
check("computeMarketValue: qty*price", computeMarketValue(10, 50) === 500);
check("computeMarketValue: fehlender Preis -> null", computeMarketValue(10, null) === null);
check("computeMarketValue: qty<=0 -> null", computeMarketValue(0, 50) === null);

// === computePortfolioWeights ===

// 6. Gewichte summieren sich zu ~100% bei vollstaendigen Kursen
const posA = makePosition({ ticker: "AAPL", qty: 10, entryPrice: 150, side: "long" });
const posB = makePosition({ ticker: "MSFT", qty: 5, entryPrice: 300, side: "long" });
const weights = computePortfolioWeights([posA, posB], { AAPL: 160, MSFT: 320 });
const totalWeight = weights.reduce((sum, w) => sum + (w.weight ?? 0), 0);
check("computePortfolioWeights: Gewichte summieren zu ≈100%", Math.abs(totalWeight - 1) < 0.001, `total=${totalWeight}`);

// 7. Geschlossene Positionen fliessen NICHT in die Gewichte ein
const closedForWeights = makePosition({ ticker: "NVO", qty: 3, entryPrice: 80, status: "closed" });
const weightsWithClosed = computePortfolioWeights([posA, closedForWeights], { AAPL: 160, NVO: 90 });
check("computePortfolioWeights: geschlossene Positionen ausgeschlossen", weightsWithClosed.length === 1 && weightsWithClosed[0].position.ticker === "AAPL", JSON.stringify(weightsWithClosed.map(w => w.position.ticker)));

// 8. Fehlender Kurs -> weight=null fuer diese Position, kein Crash
const weightsMissingPrice = computePortfolioWeights([posA, posB], { AAPL: 160 }); // MSFT-Kurs fehlt
const msftWeight = weightsMissingPrice.find(w => w.position.ticker === "MSFT");
check("computePortfolioWeights: fehlender Kurs -> weight=null (kein Fake-Gewicht)", msftWeight?.weight === null, JSON.stringify(msftWeight));

// === computePortfolioKPIs ===

// 9. Bester Performer = argmax der offenen Performance
const posLow = makePosition({ ticker: "LOW", qty: 1, entryPrice: 100, side: "long" });
const posHigh = makePosition({ ticker: "HIGH", qty: 1, entryPrice: 100, side: "long" });
const kpis = computePortfolioKPIs([posLow, posHigh], { LOW: 105, HIGH: 150 });
check("computePortfolioKPIs: bester Performer = HIGH (argmax)", kpis.bestPerformer?.position.ticker === "HIGH", JSON.stringify(kpis.bestPerformer));

// 10. Ø aktive Performance = gleichgewichtetes Mittel
const kpisAvg = computePortfolioKPIs([posLow, posHigh], { LOW: 110, HIGH: 130 }); // +10%, +30% -> avg 20%
check("computePortfolioKPIs: Ø aktive Performance = gleichgewichtetes Mittel", kpisAvg.avgActivePerformance != null && Math.abs(kpisAvg.avgActivePerformance - 0.20) < 0.001, `avg=${kpisAvg.avgActivePerformance}`);

// 11. Realisierter Profit nur aus geschlossenen Positionen
const posClosedGood = makePosition({ ticker: "C1", entryPrice: 100, exitPrice: 120, status: "closed" });
const posClosedBad = makePosition({ ticker: "C2", entryPrice: 100, exitPrice: 90, status: "closed" });
const kpisRealized = computePortfolioKPIs([posLow, posClosedGood, posClosedBad], { LOW: 105 });
check("computePortfolioKPIs: realisierter Profit = Ø(+20%,-10%) = +5%", kpisRealized.avgRealizedPerformance != null && Math.abs(kpisRealized.avgRealizedPerformance - 0.05) < 0.001, `realized=${kpisRealized.avgRealizedPerformance}`);

// 12. Keine offenen Positionen -> KPIs null, kein Crash
const kpisEmpty = computePortfolioKPIs([], {});
check("computePortfolioKPIs: leeres Portfolio -> alle KPIs null", kpisEmpty.avgActivePerformance === null && kpisEmpty.bestPerformer === null && kpisEmpty.avgRealizedPerformance === null);

// === computePortfolioPerformanceSeries ===

// 13. Einfache Zeitreihe mit einer Position
const seriesPositions: PortfolioPosition[] = [makePosition({ ticker: "AAPL", qty: 10, entryPrice: 100, side: "long" })];
const series = computePortfolioPerformanceSeries(seriesPositions, {
  AAPL: [{ date: "2026-01-01", close: 100 }, { date: "2026-01-02", close: 110 }, { date: "2026-01-03", close: 120 }],
});
check("computePortfolioPerformanceSeries: 3 Datenpunkte", series.length === 3, JSON.stringify(series));
check("computePortfolioPerformanceSeries: erster Punkt = 0% (Baseline)", series[0]?.performancePct === 0, JSON.stringify(series[0]));
check("computePortfolioPerformanceSeries: letzter Punkt = +20%", series[2] != null && Math.abs(series[2].performancePct - 0.20) < 0.001, JSON.stringify(series[2]));

// 14. Keine historischen Daten -> leeres Array, kein Crash
check("computePortfolioPerformanceSeries: keine Daten -> []", computePortfolioPerformanceSeries(seriesPositions, {}).length === 0);

// 15. Geschlossene Positionen fliessen nicht in die Serie ein
const closedOnlyPositions: PortfolioPosition[] = [makePosition({ ticker: "AAPL", status: "closed" })];
check("computePortfolioPerformanceSeries: nur geschlossene Positionen -> []", computePortfolioPerformanceSeries(closedOnlyPositions, { AAPL: [{ date: "2026-01-01", close: 100 }] }).length === 0);

// === suggestConvictionFromScore ===

// 16. Score-Baender wie im Ticket spezifiziert (>=80 high, 60-80 medium, sonst low)
check("suggestConvictionFromScore: 85 -> high", suggestConvictionFromScore(85) === "high");
check("suggestConvictionFromScore: 70 -> medium", suggestConvictionFromScore(70) === "medium");
check("suggestConvictionFromScore: 40 -> low", suggestConvictionFromScore(40) === "low");
check("suggestConvictionFromScore: null -> null", suggestConvictionFromScore(null) === null);

console.log(failed === 0 ? `\n✅ Alle Portfolio-Positions-Tests bestanden (23 Checks)` : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
