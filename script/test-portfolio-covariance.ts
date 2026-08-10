/**
 * Unit-Tests fuer client/src/lib/portfolio/covariance.ts (Auftrag 10.08.2026,
 * "Portfolio-Engine – eine Optimierung ab 2 Positionen", Teil 1: Kovarianz).
 *
 * Ausfuehren: npx tsx script/test-portfolio-covariance.ts
 */
import { buildCovariance, applyRidge, type PricePoint } from "../client/src/lib/portfolio/covariance";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function makeSyntheticSeries(startPrice: number, dailyReturns: number[], startDate = "2025-01-01"): PricePoint[] {
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

// Deterministischer Pseudo-Zufall (fuer reproduzierbare Test-Fixtures)
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// === Grundfall: 2 perfekt korrelierte Serien (identische Returns) ===

const rand1 = seededRandom(42);
const baseReturns = Array.from({ length: 120 }, () => (rand1() - 0.5) * 0.02); // ~2% taegliche Vola
const identicalSeriesA = makeSyntheticSeries(100, baseReturns);
const identicalSeriesB = makeSyntheticSeries(50, baseReturns); // gleiche Returns, anderer Startpreis

const resultIdentical = buildCovariance({ AAA: identicalSeriesA, BBB: identicalSeriesB });
check("buildCovariance: 2 identische Return-Serien -> beide Ticker aligned", resultIdentical.tickersAligned.length === 2, JSON.stringify(resultIdentical.tickersAligned));
check("buildCovariance: identische Serien -> Korrelation ≈ 1", (() => {
  const [i, j] = [0, 1];
  const cov = resultIdentical.Sigma[i][j];
  const sigmaI = resultIdentical.sigma[i];
  const sigmaJ = resultIdentical.sigma[j];
  const corr = cov / (sigmaI * sigmaJ);
  return Math.abs(corr - 1) < 0.01;
})(), JSON.stringify({ Sigma: resultIdentical.Sigma, sigma: resultIdentical.sigma }));

// === Unkorrelierte Serien (verschiedene Zufallsfolgen) -> Korrelation nahe 0 ===

const rand2 = seededRandom(7);
const rand3 = seededRandom(999);
const returnsX = Array.from({ length: 150 }, () => (rand2() - 0.5) * 0.015);
const returnsY = Array.from({ length: 150 }, () => (rand3() - 0.5) * 0.015);
const seriesX = makeSyntheticSeries(200, returnsX);
const seriesY = makeSyntheticSeries(80, returnsY);

const resultUncorrelated = buildCovariance({ XXX: seriesX, YYY: seriesY });
check("buildCovariance: unabhängige Zufallsserien -> Korrelation deutlich unter 1 (nicht perfekt korreliert)", (() => {
  const cov = resultUncorrelated.Sigma[0][1];
  const corr = cov / (resultUncorrelated.sigma[0] * resultUncorrelated.sigma[1]);
  return Math.abs(corr) < 0.5; // grosszügige Toleranz für Pseudo-Zufall, Kern: keine hohe Korrelation
})(), `corr=${resultUncorrelated.Sigma[0][1] / (resultUncorrelated.sigma[0] * resultUncorrelated.sigma[1])}`);

// === n=1: keine Kovarianzmatrix sinnvoll (nur 1 Ticker) ===

const singleTickerResult = buildCovariance({ SOLO: identicalSeriesA });
check("buildCovariance: n=1 -> genau 1 Ticker aligned, 1x1-Matrix", singleTickerResult.tickersAligned.length === 1 && singleTickerResult.Sigma.length === 1, JSON.stringify(singleTickerResult.tickersAligned));

// === Zu kurze Historie -> Ausschluss statt Raten ===

const shortSeries = makeSyntheticSeries(100, Array.from({ length: 10 }, () => 0.001)); // nur 10 Tage, < MIN_OBSERVATIONS
const resultShort = buildCovariance({ SHORT: shortSeries, LONG: identicalSeriesA });
check("buildCovariance: Ticker mit zu kurzer Historie wird ausgeschlossen (kein Raten)", resultShort.excludedTickers.includes("SHORT"), JSON.stringify(resultShort.excludedTickers));
check("buildCovariance: verbleibender Ticker mit ausreichender Historie bleibt drin", resultShort.tickersAligned.includes("LONG"), JSON.stringify(resultShort.tickersAligned));

// === Keine Daten -> leeres Ergebnis, kein Crash ===

const emptyResult = buildCovariance({});
check("buildCovariance: keine Ticker -> leeres Ergebnis ohne Crash", emptyResult.tickersAligned.length === 0 && emptyResult.Sigma.length === 0);

// === Ridge-Stabilisierung ===

const ridgeTest = applyRidge([[0.04, 0.02], [0.02, 0.04]]);
check("applyRidge: Diagonale wird um ε erhöht", ridgeTest.Sigma[0][0] > 0.04 && ridgeTest.Sigma[1][1] > 0.04, JSON.stringify(ridgeTest));
check("applyRidge: Off-Diagonale unverändert", ridgeTest.Sigma[0][1] === 0.02, JSON.stringify(ridgeTest));
check("applyRidge: ridgeApplied=true, epsilon > 0", ridgeTest.ridgeApplied && ridgeTest.epsilon > 0, JSON.stringify(ridgeTest));

const ridgeEmptyTest = applyRidge([]);
check("applyRidge: leere Matrix -> kein Crash, ridgeApplied=false", !ridgeEmptyTest.ridgeApplied);

// === buildCovariance wendet Ridge automatisch an (immer, konservativ) ===

check("buildCovariance: Ridge wird im Gesamtergebnis angewendet (ridgeApplied=true bei validen Daten)", resultIdentical.ridgeApplied === true);
check("buildCovariance: Flags enthalten Ridge-Hinweis", resultIdentical.flags.some(f => f.includes("Ridge")), JSON.stringify(resultIdentical.flags));

// === mu/sigma-Konsistenz ===

check("buildCovariance: mu-Array hat gleiche Länge wie tickersAligned", resultIdentical.mu.length === resultIdentical.tickersAligned.length);
check("buildCovariance: sigma-Array ist sqrt der Diagonale von Sigma", (() => {
  return resultIdentical.tickersAligned.every((_, i) => Math.abs(resultIdentical.sigma[i] - Math.sqrt(resultIdentical.Sigma[i][i])) < 1e-9);
})());

// === nObs korrekt berechnet (Anzahl gemeinsamer Returns, nicht Preise) ===

check("buildCovariance: nObs = Anzahl Preise - 1 (Returns)", resultIdentical.nObs === identicalSeriesA.length - 1, `nObs=${resultIdentical.nObs}, priceCount=${identicalSeriesA.length}`);

console.log(failed === 0 ? `\n✅ Alle Portfolio-Kovarianz-Tests bestanden (17 Checks)` : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
