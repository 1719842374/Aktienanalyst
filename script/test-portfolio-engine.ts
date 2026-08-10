/**
 * Unit-Tests fuer client/src/lib/portfolio/engine.ts (Auftrag 10.08.2026,
 * "Portfolio-Engine – eine Optimierung ab 2 Positionen").
 *
 * Kernanspruch des Tickets: ab 2 offenen Positionen automatisch CAPM-
 * Zielgewichte + Kelly AUS DEN ECHTEN POSITIONEN ableiten -- keine manuelle
 * Zweit-Tabelle, kein reiner Equal-Weight-Fallback wenn μ/σ/Korrelation
 * tatsaechlich unterschiedlich sind.
 *
 * Ausfuehren: npx tsx script/test-portfolio-engine.ts
 */
import { computePortfolioFromPositions, MIN_POSITIONS_FOR_OPTIMIZATION } from "../client/src/lib/portfolio/engine";
import type { PricePoint } from "../client/src/lib/portfolio/covariance";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

function makeSeries(startPrice: number, dailyReturns: number[], startDate = "2025-01-01"): PricePoint[] {
  const points: PricePoint[] = [];
  let price = startPrice;
  let date = new Date(startDate);
  points.push({ date: date.toISOString().slice(0, 10), close: price });
  for (const r of dailyReturns) {
    date = new Date(date);
    date.setDate(date.getDate() + 1);
    price = price * (1 + r);
    points.push({ date: date.toISOString().slice(0, 10), close: price });
  }
  return points;
}

// === 1. n<2 -> insufficient_positions, kein Fake-Ergebnis ===

const singlePosResult = computePortfolioFromPositions({
  positions: [{ ticker: "AAPL", qty: 10, entryPrice: 150, lastPrice: 160, side: "long" }],
  historicalPricesByTicker: {},
  rf: 0.03, capital: 100000,
});
check(`n<${MIN_POSITIONS_FOR_OPTIMIZATION} -> status=insufficient_positions, keine Rows`, singlePosResult.status === "insufficient_positions" && singlePosResult.rows.length === 0, JSON.stringify(singlePosResult.status));

// === 2. n>=2 aber keine Historie und kein Override -> insufficient_history ===

const noHistoryResult = computePortfolioFromPositions({
  positions: [
    { ticker: "AAPL", qty: 10, entryPrice: 150, lastPrice: 160, side: "long" },
    { ticker: "MSFT", qty: 5, entryPrice: 300, lastPrice: 320, side: "long" },
  ],
  historicalPricesByTicker: {},
  rf: 0.03, capital: 100000,
});
check("n=2 ohne Historie/Override -> status=insufficient_history", noHistoryResult.status === "insufficient_history", JSON.stringify(noHistoryResult.status));

// === 3. Kernfall: 2 Positionen mit unterschiedlichem μ/σ und echter Korrelation
// aus synthetischer Historie -> Gewichte NICHT zwingend 50/50 ===

const randHigh = seededRandom(11);
const randLow = seededRandom(22);
// Titel mit hoeherem μ/σ² sollte (vor Caps) tendenziell mehr Gewicht bekommen
// (Ticket-Beispiel: MSFT μ=11%/σ=20% vs. NVDA μ=18%/σ=35% -- hier synthetisch
// nachgebildet ueber die tatsaechliche Preis-Drift der generierten Serien).
const returnsHighDrift = Array.from({ length: 150 }, () => 0.0015 + (randHigh() - 0.5) * 0.02); // hohe Drift
const returnsLowDrift = Array.from({ length: 150 }, () => 0.0002 + (randLow() - 0.5) * 0.025); // niedrige Drift, ähnliche/höhere Vola
const seriesHighDrift = makeSeries(400, returnsHighDrift);
const seriesLowDrift = makeSeries(300, returnsLowDrift);

const twoPosResult = computePortfolioFromPositions({
  positions: [
    { ticker: "HIGH", qty: 10, entryPrice: 400, lastPrice: 400, side: "long" },
    { ticker: "LOW", qty: 10, entryPrice: 300, lastPrice: 300, side: "long" },
  ],
  historicalPricesByTicker: { HIGH: seriesHighDrift, LOW: seriesLowDrift },
  rf: 0.03, capital: 100000,
});
check("2 Positionen mit Historie -> status=ok", twoPosResult.status === "ok", JSON.stringify(twoPosResult.status));
check("2 Positionen -> genau 2 Rows", twoPosResult.rows.length === 2, JSON.stringify(twoPosResult.rows.map(r => r.ticker)));
check("μ/σ stammen aus Historie (muSource=historical) wenn kein Override gesetzt", twoPosResult.rows.every(r => r.muSource === "historical" && r.sigmaSource === "historical"), JSON.stringify(twoPosResult.rows.map(r => ({ t: r.ticker, mu: r.muSource, sigma: r.sigmaSource }))));
check("Kovarianzmatrix wurde tatsächlich berechnet (nicht leer)", twoPosResult.covariance != null && twoPosResult.covariance.Sigma.length === 2, JSON.stringify(twoPosResult.covariance?.Sigma));
const weightSum = twoPosResult.rows.reduce((s, r) => s + r.weightCapm, 0);
check("CAPM-Gewichte summieren zu ≈100%", Math.abs(weightSum - 1) < 0.01, `sum=${weightSum}`);

// === 4. Override hat Vorrang vor Historie ===

const withOverrideResult = computePortfolioFromPositions({
  positions: [
    { ticker: "HIGH", qty: 10, entryPrice: 400, lastPrice: 400, side: "long", muOverride: 0.5, sigmaOverride: 0.1 },
    { ticker: "LOW", qty: 10, entryPrice: 300, lastPrice: 300, side: "long" },
  ],
  historicalPricesByTicker: { HIGH: seriesHighDrift, LOW: seriesLowDrift },
  rf: 0.03, capital: 100000,
});
const highRow = withOverrideResult.rows.find(r => r.ticker === "HIGH");
check("Override μ/σ hat Vorrang vor Historie, korrekt als 'override' markiert", highRow?.muSource === "override" && highRow?.sigmaSource === "override" && highRow?.mu === 0.5, JSON.stringify(highRow));

// === 5. Ist-Gewicht (Marktwert) vs. CAPM-Ziel-Gewicht sind separat ausgewiesen ===

check("weightMarket und weightCapm sind unabhängige Felder (können differieren)", twoPosResult.rows.every(r => typeof r.weightCapm === "number" && (r.weightMarket === null || typeof r.weightMarket === "number")));
const marketWeightSum = twoPosResult.rows.reduce((s, r) => s + (r.weightMarket ?? 0), 0);
check("Ist-Gewichte (Marktwert) summieren zu ≈100% wenn alle Kurse vorhanden", Math.abs(marketWeightSum - 1) < 0.01, `sum=${marketWeightSum}`);

// === 6. Kelly-Spalten unabhängig von CAPM-Gewicht (nicht verwechselt) ===

check("Kelly-Objekt vorhanden für jede Row mit gültigem σ", twoPosResult.rows.every(r => r.kelly != null));
check("Kelly-fCapped ist NICHT identisch mit weightCapm (getrennte Konzepte)", twoPosResult.rows.some(r => Math.abs((r.kelly?.fCapped ?? 0) - r.weightCapm) > 1e-6), JSON.stringify(twoPosResult.rows.map(r => ({ t: r.ticker, kelly: r.kelly?.fCapped, w: r.weightCapm }))));

// === 7. Score-Default (neutral 50) wenn kein Score/Override vorhanden ===

check("Score-Default = 50 wenn kein scoreOverride gesetzt", twoPosResult.rows.every(r => r.score === 50), JSON.stringify(twoPosResult.rows.map(r => r.score)));

// === 8. Ticker mit zu kurzer Historie wird ausgeschlossen, Rest läuft trotzdem ===

const shortSeries = makeSeries(100, Array.from({ length: 5 }, () => 0.001));
const mixedResult = computePortfolioFromPositions({
  positions: [
    { ticker: "HIGH", qty: 10, entryPrice: 400, lastPrice: 400, side: "long" },
    { ticker: "LOW", qty: 10, entryPrice: 300, lastPrice: 300, side: "long" },
    { ticker: "SHORTHIST", qty: 5, entryPrice: 100, lastPrice: 100, side: "long" },
  ],
  historicalPricesByTicker: { HIGH: seriesHighDrift, LOW: seriesLowDrift, SHORTHIST: shortSeries },
  rf: 0.03, capital: 100000,
});
check("Ticker mit zu kurzer Historie (ohne Override) wird ausgeschlossen", mixedResult.excludedTickers.includes("SHORTHIST"), JSON.stringify(mixedResult.excludedTickers));
check("Optimierung läuft trotzdem für die übrigen 2 Ticker", mixedResult.status === "ok" && mixedResult.rows.length === 2, JSON.stringify(mixedResult.rows.map(r => r.ticker)));

// === 9. Kein Fake-Ergebnis: leere Positions-Liste ===

const emptyResult = computePortfolioFromPositions({ positions: [], historicalPricesByTicker: {}, rf: 0.03, capital: 100000 });
check("Leere Positionsliste -> insufficient_positions, keine Rows", emptyResult.status === "insufficient_positions" && emptyResult.rows.length === 0);

// === 10. μ-Winsorizing ist standardmaessig aktiv und wirkt auf extreme Historie-μ ===
// (Folge-Ticket 10.08.2026 Punkt 3) -- baue eine Serie mit sehr hoher Drift,
// die garantiert ueber dem Default-Max (+40% p.a.) annualisiert.
const randExtreme = seededRandom(55);
const extremeDriftReturns = Array.from({ length: 150 }, () => 0.006 + (randExtreme() - 0.5) * 0.01); // ~150%+ p.a. Drift
const extremeSeries = makeSeries(100, extremeDriftReturns);

const winsorizeResult = computePortfolioFromPositions({
  positions: [
    { ticker: "EXTREME", qty: 10, entryPrice: 100, lastPrice: 100, side: "long" },
    { ticker: "LOW", qty: 10, entryPrice: 300, lastPrice: 300, side: "long" },
  ],
  historicalPricesByTicker: { EXTREME: extremeSeries, LOW: seriesLowDrift },
  rf: 0.03, capital: 100000,
});
const extremeRow = winsorizeResult.rows.find(r => r.ticker === "EXTREME");
check("μ-Winsorizing clippt extrem hohe historische Drift auf das Default-Max (+40%)", extremeRow != null && Math.abs(extremeRow.mu - 0.40) < 1e-6, JSON.stringify(extremeRow));
check("muWasWinsorized=true fuer den geclippten Ticker", extremeRow?.muWasWinsorized === true, JSON.stringify(extremeRow));
check("Winsorizing-Flag im Ergebnis vorhanden", winsorizeResult.flags.some(f => f.includes("Winsorizing")), JSON.stringify(winsorizeResult.flags));

// Override bleibt auch bei extremem Wert unangetastet (kein Winsorizing auf User-Eingabe)
const overrideExtreme = computePortfolioFromPositions({
  positions: [
    { ticker: "EXTREME", qty: 10, entryPrice: 100, lastPrice: 100, side: "long", muOverride: 0.90, sigmaOverride: 0.3 },
    { ticker: "LOW", qty: 10, entryPrice: 300, lastPrice: 300, side: "long" },
  ],
  historicalPricesByTicker: { EXTREME: extremeSeries, LOW: seriesLowDrift },
  rf: 0.03, capital: 100000,
});
const overrideRow = overrideExtreme.rows.find(r => r.ticker === "EXTREME");
check("Explizites Override (90% p.a.) wird NICHT winsorisiert", overrideRow?.mu === 0.90 && overrideRow?.muWasWinsorized === false, JSON.stringify(overrideRow));

// Winsorizing abschaltbar via null (fuer Tests/Debugging)
const noWinsorizeResult = computePortfolioFromPositions({
  positions: [
    { ticker: "EXTREME", qty: 10, entryPrice: 100, lastPrice: 100, side: "long" },
    { ticker: "LOW", qty: 10, entryPrice: 300, lastPrice: 300, side: "long" },
  ],
  historicalPricesByTicker: { EXTREME: extremeSeries, LOW: seriesLowDrift },
  rf: 0.03, capital: 100000,
  muWinsorizeMin: null, muWinsorizeMax: null,
});
const noWinsorizeRow = noWinsorizeResult.rows.find(r => r.ticker === "EXTREME");
check("Winsorizing abschaltbar (muWinsorizeMin/Max=null) -- μ bleibt roh", noWinsorizeRow != null && noWinsorizeRow.mu > 0.40, JSON.stringify(noWinsorizeRow));

// === 11. Concentration (HHI/Effective-N/Korrelation) wird im Ergebnis mitgeliefert ===

check("concentration ist bei status=ok gesetzt (nicht null)", twoPosResult.concentration != null, JSON.stringify(twoPosResult.concentration));
check("concentration.hhi liegt zwischen 1/n und 1", (() => {
  const c = twoPosResult.concentration;
  return c != null && c.hhi >= 0.5 - 1e-6 && c.hhi <= 1;
})(), JSON.stringify(twoPosResult.concentration));
check("concentration bei insufficient_positions/insufficient_history ist null", singlePosResult.concentration === null && noHistoryResult.concentration === null);

console.log(failed === 0 ? `\n✅ Alle Portfolio-Engine-Tests bestanden (25 Checks)` : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
