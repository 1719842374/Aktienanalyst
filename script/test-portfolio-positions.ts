/**
 * Unit-Tests fuer client/src/lib/portfolio/positions.ts
 * Ausfuehren: npx tsx script/test-portfolio-positions.ts
 */
import {
  computePositionPerformance, computeClosedPositionPerformance, computeMarketValue,
  computePortfolioWeights, computePortfolioKPIs, computePortfolioPerformanceSeries,
  rebasePerformanceSeries, timeframeCutoffIso,
  makePosition, suggestConvictionFromScore, type PortfolioPosition,
} from "../client/src/lib/portfolio/positions";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const adidasPerf = computePositionPerformance(143.80, 164.75, "long");
check("computePositionPerformance: LONG Adidas-Beispiel ≈ +14.57%", adidasPerf != null && Math.abs(adidasPerf - 0.1457) < 0.001, `perf=${adidasPerf}`);
const shortPerf = computePositionPerformance(100, 80, "short");
check("computePositionPerformance: SHORT bei fallendem Kurs = positive Performance", shortPerf != null && shortPerf > 0, `perf=${shortPerf}`);
const shortLoss = computePositionPerformance(100, 120, "short");
check("computePositionPerformance: SHORT bei steigendem Kurs = negative Performance", shortLoss != null && shortLoss < 0, `perf=${shortLoss}`);
check("computePositionPerformance: null lastPrice -> null (kein Fake-0)", computePositionPerformance(100, null, "long") === null);
check("computePositionPerformance: negativer lastPrice -> null", computePositionPerformance(100, -5, "long") === null);
check("computePositionPerformance: 0 entryPrice -> null", computePositionPerformance(0, 100, "long") === null);

const closedPos = makePosition({ entryPrice: 100, exitPrice: 130, side: "long", status: "closed" });
check("computeClosedPositionPerformance: nutzt exitPrice", Math.abs((computeClosedPositionPerformance(closedPos) ?? NaN) - 0.3) < 1e-9);
const noExitPos = makePosition({ entryPrice: 100, exitPrice: null, status: "closed" });
check("computeClosedPositionPerformance: fehlender exitPrice -> null", computeClosedPositionPerformance(noExitPos) === null);

check("computeMarketValue: qty*price", computeMarketValue(10, 50) === 500);
check("computeMarketValue: fehlender Preis -> null", computeMarketValue(10, null) === null);
check("computeMarketValue: qty<=0 -> null", computeMarketValue(0, 50) === null);

const posA = makePosition({ ticker: "AAPL", qty: 10, entryPrice: 150, side: "long" });
const posB = makePosition({ ticker: "MSFT", qty: 5, entryPrice: 300, side: "long" });
const weights = computePortfolioWeights([posA, posB], { AAPL: 160, MSFT: 320 });
const totalWeight = weights.reduce((sum, w) => sum + (w.weight ?? 0), 0);
check("computePortfolioWeights: Gewichte summieren zu ≈100%", Math.abs(totalWeight - 1) < 0.001, `total=${totalWeight}`);
const closedForWeights = makePosition({ ticker: "NVO", qty: 3, entryPrice: 80, status: "closed" });
const weightsWithClosed = computePortfolioWeights([posA, closedForWeights], { AAPL: 160, NVO: 90 });
check("computePortfolioWeights: geschlossene Positionen ausgeschlossen", weightsWithClosed.length === 1 && weightsWithClosed[0].position.ticker === "AAPL");
const weightsMissingPrice = computePortfolioWeights([posA, posB], { AAPL: 160 });
const msftWeight = weightsMissingPrice.find(w => w.position.ticker === "MSFT");
check("computePortfolioWeights: fehlender Kurs -> weight=null", msftWeight?.weight === null);

const posLow = makePosition({ ticker: "LOW", qty: 1, entryPrice: 100, side: "long" });
const posHigh = makePosition({ ticker: "HIGH", qty: 1, entryPrice: 100, side: "long" });
const kpis = computePortfolioKPIs([posLow, posHigh], { LOW: 105, HIGH: 150 });
check("computePortfolioKPIs: bester Performer = HIGH", kpis.bestPerformer?.position.ticker === "HIGH");
const kpisAvg = computePortfolioKPIs([posLow, posHigh], { LOW: 110, HIGH: 130 });
check("computePortfolioKPIs: Ø aktive Performance = 20%", kpisAvg.avgActivePerformance != null && Math.abs(kpisAvg.avgActivePerformance - 0.20) < 0.001);
const posClosedGood = makePosition({ ticker: "C1", entryPrice: 100, exitPrice: 120, status: "closed" });
const posClosedBad = makePosition({ ticker: "C2", entryPrice: 100, exitPrice: 90, status: "closed" });
const kpisRealized = computePortfolioKPIs([posLow, posClosedGood, posClosedBad], { LOW: 105 });
check("computePortfolioKPIs: realisierter Profit = +5%", kpisRealized.avgRealizedPerformance != null && Math.abs(kpisRealized.avgRealizedPerformance - 0.05) < 0.001);
const kpisEmpty = computePortfolioKPIs([], {});
check("computePortfolioKPIs: leeres Portfolio -> KPIs null", kpisEmpty.avgActivePerformance === null && kpisEmpty.bestPerformer === null && kpisEmpty.avgRealizedPerformance === null);

const seriesPositions: PortfolioPosition[] = [makePosition({ ticker: "AAPL", qty: 10, entryPrice: 100, side: "long" })];
const series = computePortfolioPerformanceSeries(seriesPositions, {
  AAPL: [{ date: "2026-01-01", close: 100 }, { date: "2026-01-02", close: 110 }, { date: "2026-01-03", close: 120 }],
});
check("computePortfolioPerformanceSeries: 3 Datenpunkte", series.length === 3);
check("computePortfolioPerformanceSeries: erster Punkt = 0%", series[0]?.performancePct === 0);
check("computePortfolioPerformanceSeries: letzter Punkt = +20%", series[2] != null && Math.abs(series[2].performancePct - 0.20) < 0.001);
check("computePortfolioPerformanceSeries: value Start = qty*close", series[0]?.value === 1000);
check("computePortfolioPerformanceSeries: value Ende = qty*close", series[2]?.value === 1200);

const longSeries = computePortfolioPerformanceSeries(seriesPositions, {
  AAPL: [
    { date: "2025-01-01", close: 50 },
    { date: "2026-01-01", close: 100 },
    { date: "2026-01-02", close: 110 },
    { date: "2026-01-03", close: 120 },
  ],
});
const rebased = rebasePerformanceSeries(longSeries, "2026-01-01");
check("rebasePerformanceSeries: erster Punkt = 0%", rebased[0]?.performancePct === 0);
check("rebasePerformanceSeries: letzter Punkt = +20%", rebased[2] != null && Math.abs(rebased[2].performancePct - 0.20) < 0.001);
check("rebasePerformanceSeries: Kombinationskurs bleibt absolut", rebased[0]?.value === 1000 && rebased[2]?.value === 1200);
const now = new Date("2026-09-09T00:00:00Z");
check("timeframeCutoffIso: 1Y liegt vor today", timeframeCutoffIso("1Y", now) < "2026-09-09");
check("timeframeCutoffIso: 2Y liegt vor 1Y", timeframeCutoffIso("2Y", now) < timeframeCutoffIso("1Y", now));
check("timeframeCutoffIso: 6M liegt nach 1Y", timeframeCutoffIso("6M", now) > timeframeCutoffIso("1Y", now));

check("computePortfolioPerformanceSeries: keine Daten -> []", computePortfolioPerformanceSeries(seriesPositions, {}).length === 0);
const closedOnlyPositions: PortfolioPosition[] = [makePosition({ ticker: "AAPL", status: "closed" })];
check("computePortfolioPerformanceSeries: nur geschlossene -> []", computePortfolioPerformanceSeries(closedOnlyPositions, { AAPL: [{ date: "2026-01-01", close: 100 }] }).length === 0);

check("suggestConvictionFromScore: 85 -> high", suggestConvictionFromScore(85) === "high");
check("suggestConvictionFromScore: 70 -> medium", suggestConvictionFromScore(70) === "medium");
check("suggestConvictionFromScore: 40 -> low", suggestConvictionFromScore(40) === "low");
check("suggestConvictionFromScore: null -> null", suggestConvictionFromScore(null) === null);

console.log(failed === 0 ? `\n✅ Alle Portfolio-Positions-Tests bestanden` : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
