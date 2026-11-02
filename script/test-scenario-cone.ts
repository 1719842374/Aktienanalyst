/**
 * Szenario-Kegel (WORK_SCENARIO_CONE_STOCK.md) — reine Visualisierung, kein Score.
 * Run: npx tsx script/test-scenario-cone.ts
 *
 * Fälle: σ = 0, Historie kürzer als volWindowDays, negative Ziele,
 * MSFT / SAP.DE / SHEL.L (GBP) / VOW3.DE starten am letzten Close,
 * fehlende PoS → „PoS n/a“ ohne Prozent, 50/30/20 werden nicht eingesetzt.
 * Score-Baseline (expectOldHead): VOW3 4.735718 / SAP 5.174758 / MSFT 4.058138.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONE_EVENT_LABEL, CONE_FORMULA, CONE_PARAMS, CONE_POS_SOURCE, CONE_PROBABILITY_HINT, CONE_SOURCE, POS_NA, addTradingDays, attachConeSeries, bandZ, buildScenarioCone,
  coneBandPrice, coneDomainValues, conePlotScale, fitLogPriceTrend, horizonTradingDays, separateLabelYs,
  realizedSigmaDaily, scenarioConeFromAnalysis, scenarioProbability, standardNormalCdf, type LabelBox, type ScenarioConeInput,
} from "../client/src/lib/scenarioCone";

const read = (p: string) => readFileSync(p, "utf8");
const json = (p: string) => JSON.parse(read(p));

function yahooCloses(path: string): number[] {
  const r = json(path).chart.result[0];
  return (r.indicators.quote[0].close as (number | null)[]).filter((c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0);
}

function input(over: Partial<ScenarioConeInput> & Pick<ScenarioConeInput, "closes" | "anchorPrice" | "anchorDate">): ScenarioConeInput {
  return {
    gStarPct: null,
    forwardConsensusPrice: null,
    expectedDamagePct: null,
    probabilityBull: null,
    probabilityBase: null,
    probabilityBear: null,
    horizonDays: 10,
    ...over,
  };
}

// Fenster 63 und Quantil-z nur aus CONE_PARAMS. P50 = 0, P10 = −P90.
assert.equal(CONE_PARAMS.volWindowDays, 63);
assert.equal(CONE_PARAMS.volWindowDays, CONE_PARAMS.tradingDaysPerYear / CONE_PARAMS.quartersPerYear);
assert.equal(CONE_PARAMS.quantiles.P10.percentile, 10);
assert.equal(CONE_PARAMS.quantiles.P50.percentile, 50);
assert.equal(CONE_PARAMS.quantiles.P90.percentile, 90);
assert.equal(bandZ("P10"), CONE_PARAMS.quantiles.P10.z);
assert.equal(bandZ("P50"), CONE_PARAMS.quantiles.P50.z);
assert.equal(bandZ("P90"), CONE_PARAMS.quantiles.P90.z);
assert.equal(bandZ("P50"), 0);
assert.equal(bandZ("P10"), -bandZ("P90"));
assert.equal(bandZ("P90"), 1.2815515655446004);
assert.equal(CONE_PARAMS.regressionWindowDays, CONE_PARAMS.tradingDaysPerYear);
assert.equal(CONE_PARAMS.confidence.outer.level, 0.8);
assert.equal(CONE_PARAMS.confidence.inner.level, 0.5);
assert.equal(CONE_PARAMS.confidence.outer.z, bandZ("P90"));
assert.ok(Math.abs(standardNormalCdf(0) - 0.5) < 1e-6);
assert.ok(Math.abs(standardNormalCdf(CONE_PARAMS.confidence.outer.z) - 0.9) < 1e-6);
assert.ok(Math.abs(standardNormalCdf(CONE_PARAMS.confidence.inner.z) - 0.75) < 1e-6);

// σ = 0 → Band klebt auf dem letzten Close, für jeden Horizont.
{
  const last = 123.45;
  const cone = buildScenarioCone(input({
    closes: Array(CONE_PARAMS.volWindowDays + 5).fill(last),
    anchorPrice: last,
    anchorDate: "2026-01-05",
    horizonDays: 15,
  }));
  assert.ok(cone);
  assert.equal(cone.sigmaDaily, 0);
  assert.equal(cone.driftPerDay, 0);
  assert.equal(cone.shortHistory, cone.volSample < CONE_PARAMS.regressionWindowDays);
  assert.equal(cone.points[0].innerLow, last);
  assert.equal(cone.points[0].innerHigh, last);
  assert.equal(cone.points.length, 16);
  assert.equal(cone.points[0].date, "2026-01-05");
  for (const p of cone.points) {
    assert.equal(p.p10, last, `t=${p.t} p10`);
    assert.equal(p.p50, last, `t=${p.t} p50`);
    assert.equal(p.p90, last, `t=${p.t} p90`);
  }
}

// Fenster ist das Ende der Serie: ein Schock davor ändert σ nicht, wenn die letzten N Kurse flach sind.
{
  const closes = [1, 100].concat(Array(CONE_PARAMS.volWindowDays).fill(50));
  const est = realizedSigmaDaily(closes);
  assert.equal(est.sample, CONE_PARAMS.volWindowDays);
  assert.equal(est.shortHistory, false);
  assert.equal(est.sigma, 0);
}

// Kurze Historie (< Fenster): kein Wurf, kein Auffüllen, σ aus den vorhandenen Returns, Start = letzter Close.
{
  const closes = [10, 11, 10.5, 10.2, 10.8];
  const cone = buildScenarioCone(input({
    closes,
    anchorPrice: closes[closes.length - 1],
    anchorDate: "2026-03-02",
    horizonDays: 5,
  }));
  assert.ok(cone);
  assert.equal(cone.shortHistory, true);
  assert.equal(cone.volSample, closes.length);
  assert.ok(cone.volSample < CONE_PARAMS.regressionWindowDays);
  assert.ok(cone.sigmaDaily != null && cone.sigmaDaily > 0);
  assert.equal(cone.points[0].p10, 10.8);
  assert.equal(cone.points[0].p50, 10.8);
  assert.equal(cone.points[0].p90, 10.8);
  assert.equal(cone.points[0].innerLow, 10.8);
  assert.equal(cone.points[0].innerHigh, 10.8);
  assert.equal(cone.points.length, 6);
  const fit = fitLogPriceTrend(closes, closes.length);
  assert.equal(cone.sigmaDaily, fit.residualSigma);
  assert.equal(cone.driftPerDay, fit.slope);
  const t = 4;
  const drift = cone.driftPerDay!;
  assert.ok(Math.abs(cone.points[t].p90 - coneBandPrice(10.8, cone.sigmaDaily!, CONE_PARAMS.confidence.outer.z, t, drift)) < 1e-9);
  assert.ok(Math.abs(cone.points[t].p10 - coneBandPrice(10.8, cone.sigmaDaily!, -CONE_PARAMS.confidence.outer.z, t, drift)) < 1e-9);
  assert.ok(Math.abs(cone.points[t].innerHigh - coneBandPrice(10.8, cone.sigmaDaily!, CONE_PARAMS.confidence.inner.z, t, drift)) < 1e-9);
  assert.ok(Math.abs(cone.points[t].innerLow - coneBandPrice(10.8, cone.sigmaDaily!, -CONE_PARAMS.confidence.inner.z, t, drift)) < 1e-9);
  assert.ok(Math.abs(cone.points[t].p50 - coneBandPrice(10.8, 0, 0, t, drift)) < 1e-9);
}

// Weniger als zwei Kurse → kein σ, kein Vorlauf, Anker bleibt der Close.
{
  const cone = buildScenarioCone(input({ closes: [40], anchorPrice: 40, anchorDate: "2026-04-01", horizonDays: 20 }));
  assert.ok(cone);
  assert.equal(cone.sigmaDaily, null);
  assert.equal(cone.points.length, 1);
  assert.equal(cone.points[0].p50, 40);
}

// Negative Ziele bleiben Zahlen (nicht verworfen, nicht auf 0 geklemmt). PoS fehlt → Label ohne %.
{
  const cone = buildScenarioCone(input({
    closes: Array(10).fill(50),
    anchorPrice: 50,
    anchorDate: "2026-02-02",
    gStarPct: -150,
    forwardConsensusPrice: -5,
    expectedDamagePct: 180,
    horizonDays: 8,
  }));
  assert.ok(cone);
  const bull = cone.markers.find(m => m.id === "bull")!;
  const base = cone.markers.find(m => m.id === "base")!;
  const bear = cone.markers.find(m => m.id === "bear")!;
  assert.equal(bull.price, -5);
  assert.ok(base.price != null && base.price < 0, String(base.price));
  assert.ok(Math.abs(base.price - 50 * (1 + (-150) / CONE_PARAMS.percent)) < 1e-9);
  assert.ok(bear.price != null && bear.price < 0);
  assert.ok(Math.abs(bear.price - 50 * (1 - 180 / CONE_PARAMS.percent)) < 1e-9);
  for (const m of cone.markers) {
    assert.equal(m.probability, null);
    assert.equal(m.posText, POS_NA);
    assert.equal(m.posText.includes("%"), false);
  }
  const samples = coneDomainValues(cone);
  assert.ok(samples.some(v => v < 0));
  assert.equal(samples.includes(0), false);
  const attached = attachConeSeries([{ date: "2026-02-02", close: 50 }], cone);
  assert.equal(attached[0].close, 50);
  assert.equal(attached[0].coneP10, 50);
  assert.equal(attached[attached.length - 1].close, null);
  assert.equal(attached[attached.length - 1].coneBearLabel, "P(≤ Bear-Ziel) PoS n/a");
  assert.equal(String(attached[attached.length - 1].coneBearLabel).includes("%"), false);
}

// Echte PoS nur wenn übergeben. 0 ist eine Zahl, null ist „PoS n/a“. Kein 50/30/20-Default.
{
  const cone = buildScenarioCone(input({
    closes: [20, 21, 22],
    anchorPrice: 22,
    anchorDate: "2026-05-04",
    probabilityBull: 0.227,
    probabilityBase: null,
    probabilityBear: 0,
    horizonDays: 3,
  }));
  assert.ok(cone);
  assert.equal(cone.markers[0].posText, "22.7%");
  assert.equal(cone.markers[1].posText, POS_NA);
  assert.equal(cone.markers[2].posText, "0%");
  assert.equal(cone.markers[1].posText.includes("%"), false);
}

// Horizont = Median der oberen Timeline-Grenze aus der Response. Leer → kein Default.
assert.equal(horizonTradingDays(["6-12M", "12-24M", "6-18M"]), Math.round(18 * CONE_PARAMS.tradingDaysPerYear / CONE_PARAMS.monthsPerYear));
assert.equal(horizonTradingDays(["12-18M", "12-24M", "6-18M", "12-36M"]), Math.round(21 * CONE_PARAMS.tradingDaysPerYear / CONE_PARAMS.monthsPerYear));
assert.equal(horizonTradingDays([]), null);
assert.equal(horizonTradingDays(["keine Angabe"]), null);
{
  const days = addTradingDays("2026-10-09", 5);
  assert.equal(days.length, 5);
  let prev = "2026-10-09";
  for (const d of days) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    assert.ok(wd >= 1 && wd <= 5, d);
    assert.ok(d > prev, d);
    prev = d;
  }
}

// Breite 1 = Historie unangetastet. Zusätzliche Tage verlängern proportional.
assert.equal(conePlotScale(252, 0), 1);
assert.equal(conePlotScale(0, 10), 1);
assert.equal(conePlotScale(252, 126), (252 + 126) / 252);
{
  const same = [{ date: "a", close: 1 }];
  assert.equal(attachConeSeries(same, null), same);
}

function assertDisplayedUnit(cone: { markers: { id: string; probability: number | null; posText: string }[] }) {
  for (const m of cone.markers) {
    if (m.probability == null) {
      assert.equal(m.posText, POS_NA);
      continue;
    }
    assert.ok(m.probability >= 0 && m.probability <= 1, `${m.id} ${m.probability} ${m.posText}`);
  }
}

// MSFT: letzter Close, Bull = Konsens-Kurs, Base = Close·(1+g*), Bear = Close·(1−Schaden).
// Ohne S18-Horizont ist die PoS die Log-Regression und liegt in [0, 1]. Mit S18 übernimmt der Kegel deren Horizont.
{
  const msft = json("script/fixtures/analysis-MSFT.json");
  const last = msft.historicalPrices[msft.historicalPrices.length - 1];
  const cone = scenarioConeFromAnalysis(msft, last);
  assert.ok(cone);
  assert.equal(cone.anchorPrice, last.close);
  assert.equal(cone.anchorDate, last.date);
  assert.equal(cone.points[0].p10, last.close);
  assert.equal(cone.points[0].p50, last.close);
  assert.equal(cone.points[0].p90, last.close);
  assert.equal(cone.shortHistory, false);
  assert.equal(cone.horizonDays, horizonTradingDays(msft.catalysts.map((c: { timeline: string }) => c.timeline)));
  const damage = msft.risks.reduce((s: number, r: { expectedDamage: number }) => s + r.expectedDamage, 0);
  const bull = cone.markers.find(m => m.id === "bull")!;
  const base = cone.markers.find(m => m.id === "base")!;
  const bear = cone.markers.find(m => m.id === "bear")!;
  assert.equal(bull.price, msft.analystPT.median);
  assert.ok(Math.abs(base.price! - last.close * (1 + msft.impliedGStar / CONE_PARAMS.percent)) < 1e-6);
  assert.ok(Math.abs(bear.price! - last.close * (1 - damage / CONE_PARAMS.percent)) < 1e-6);
  assert.equal(cone.formula, CONE_FORMULA);
  assert.equal(cone.source, CONE_SOURCE);
  assert.equal(cone.bandReason, null);
  const catalystHorizon = horizonTradingDays(msft.catalysts.map((c: { timeline: string }) => c.timeline));
  assert.equal(cone.horizonDays, catalystHorizon);
  assert.notEqual(catalystHorizon, 252);
  for (const m of cone.markers) {
    const derived = scenarioProbability(m.id, m.price, last.close, cone.driftPerDay, cone.sigmaDaily, cone.horizonDays);
    assert.equal(m.probability, derived.probability);
    assert.equal(m.sourceLabel, CONE_POS_SOURCE.regression);
    assert.equal(m.fallback, true);
    assert.equal(m.shownHorizon, null);
    assert.match(m.caption, /Fallback/);
    assert.doesNotMatch(m.caption, /S17|Katalysator/);
  }
  assertDisplayedUnit(cone);
  assert.ok(!(cone.markers[0].probability === 0.5 && cone.markers[1].probability === 0.3 && cone.markers[2].probability === 0.2));
  const mcHorizon = (catalystHorizon ?? 0) - 50;
  assert.ok(mcHorizon > 0 && mcHorizon !== catalystHorizon);
  const withMc = scenarioConeFromAnalysis(msft, last, { terminalPrices: [100, 600, 700, 800], horizonDays: mcHorizon });
  assert.ok(withMc);
  assert.equal(withMc.horizonDays, mcHorizon);
  assert.equal(withMc.points.length, mcHorizon + 1);
  const mcBull = withMc.markers.find(m => m.id === "bull")!;
  assert.equal(mcBull.sourceLabel, CONE_POS_SOURCE.monteCarlo);
  assert.equal(mcBull.fallback, false);
  assert.equal(mcBull.shownHorizon, mcHorizon);
  assert.match(mcBull.caption, new RegExp(`${mcHorizon} Handelstage`));
  assert.ok(Math.abs(mcBull.probability! - 0.75) < 1e-9);
  assertDisplayedUnit(withMc);
  const viaResponse = scenarioConeFromAnalysis(
    { ...msft, monteCarlo: { terminalPrices: [100, 600, 700, 800], horizonDays: mcHorizon - 10 } },
    last,
    { terminalPrices: [1, 2, 3], horizonDays: 10 },
  );
  assert.equal(viaResponse!.horizonDays, mcHorizon - 10);
  assert.equal(viaResponse!.points.length, mcHorizon - 9);
  const noHorizon = scenarioConeFromAnalysis(msft, last, { terminalPrices: [100, 600, 700, 800], horizonDays: null });
  assert.equal(noHorizon!.horizonDays, catalystHorizon);
  assert.equal(noHorizon!.markers.find(m => m.id === "bull")!.sourceLabel, CONE_POS_SOURCE.regression);
  const t = 20;
  assert.ok(Math.abs(cone.points[t].p90 - coneBandPrice(last.close, cone.sigmaDaily!, CONE_PARAMS.confidence.outer.z, t, cone.driftPerDay!)) < 1e-6);
  assert.ok(Math.abs(cone.points[t].innerHigh - coneBandPrice(last.close, cone.sigmaDaily!, CONE_PARAMS.confidence.inner.z, t, cone.driftPerDay!)) < 1e-6);
  const attached = attachConeSeries([{ date: last.date, close: last.close }], cone);
  assert.equal(attached[0].coneP50, last.close);
  assert.equal(attached[0].close, last.close);
}

// SHEL.L: GBP-Skala. analystPT.median 0 ist kein Ziel und zieht die Achse nicht auf 0.
{
  const shel = json("script/fixtures/analysis-SHEL.L.json");
  assert.equal(shel.currency, "GBP");
  const last = shel.historicalPrices[shel.historicalPrices.length - 1];
  assert.equal(last.close, 39.38);
  const cone = scenarioConeFromAnalysis(shel, last);
  assert.ok(cone);
  assert.equal(cone.anchorPrice, 39.38);
  assert.equal(cone.points[0].p10, 39.38);
  assert.equal(cone.points[0].p50, 39.38);
  assert.equal(cone.points[0].p90, 39.38);
  const shelBull = cone.markers.find(m => m.id === "bull")!;
  assert.equal(shelBull.price, null);
  assert.equal(shelBull.posText, POS_NA);
  assert.match(shelBull.posReason ?? "", /Forward-Konsens/);
  const samples = coneDomainValues(cone);
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  assert.ok(lo > 1, `Achse auf 0/Pence gezogen: min ${lo}`);
  assert.equal(samples.some(v => v === 0), false);
  assert.ok(hi / 39.38 < 30 && 39.38 / lo < 30, `Spanne ${lo}…${hi} nicht mehr GBP-Kurs`);
  for (const m of cone.markers.filter(x => x.id !== "bull")) {
    assert.ok(m.price != null && m.price > 0);
    assert.equal(m.posReason, null);
    assert.ok(m.posText.endsWith("%"));
    const derived = scenarioProbability(m.id, m.price, 39.38, cone.driftPerDay, cone.sigmaDaily, cone.horizonDays);
    assert.equal(m.probability, derived.probability);
  }
}

// SAP.DE und VOW3.DE: kurze Yahoo-Historie, Kegel startet am letzten Close, Achse bleibt in der Kursgröße.
for (const [ticker, file] of [["SAP.DE", "script/fixtures/yahoo-chart-SAP.DE.json"], ["VOW3.DE", "script/fixtures/yahoo-chart-VOW3.DE.json"]] as const) {
  const closes = yahooCloses(file);
  assert.ok(closes.length < CONE_PARAMS.volWindowDays, `${ticker} fixture sollte kürzer als das Vola-Fenster sein`);
  const last = closes[closes.length - 1];
  const cone = buildScenarioCone(input({
    closes,
    anchorPrice: last,
    anchorDate: "2026-10-16",
    gStarPct: 4,
    forwardConsensusPrice: null,
    expectedDamagePct: 12,
    horizonDays: horizonTradingDays(["6-12M", "12-18M"]),
  }));
  assert.ok(cone, ticker);
  assert.equal(cone.shortHistory, true);
  assert.equal(cone.volSample, closes.length);
  assert.equal(cone.points[0].p10, last);
  assert.equal(cone.points[0].p50, last);
  assert.equal(cone.points[0].p90, last);
  const samples = coneDomainValues(cone);
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  assert.ok(lo > 0 && last / lo < 30 && hi / last < 30, `${ticker} Spanne ${lo}…${hi} bei Close ${last}`);
  const bull = cone.markers.find(m => m.id === "bull")!;
  assert.equal(bull.posText, POS_NA);
  assert.match(bull.posReason ?? "", /Forward-Konsens/);
  for (const m of cone.markers.filter(x => x.id !== "bull")) {
    assert.equal(m.posReason, null, `${ticker} ${m.id} ${m.posReason}`);
    assert.ok(m.posText.endsWith("%"), `${ticker} ${m.id} ${m.posText}`);
  }
}

// Tester-FAIL #359 (NVO, 1440 px): Labels weichen nur um den Fehlbetrag aus Höhe und Pixelabstand aus.
function assertSeparated(items: LabelBox[]) {
  const placed = new Map(separateLabelYs(items).map(p => [p.id, p.yPx]));
  const out = items.map(b => ({ ...b, yPx: placed.get(b.id) ?? b.yPx }));
  for (const b of items) if (b.fixed) assert.equal(placed.get(b.id), b.yPx, `${b.id} bleibt`);
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      const xHit = a.xPx < b.xPx + b.widthPx && b.xPx < a.xPx + a.widthPx;
      if (!xHit) continue;
      const required = (a.heightPx + b.heightPx) / 2;
      assert.ok(Math.abs(a.yPx - b.yPx) + 1e-9 >= required, `${a.id}/${b.id}: ${a.yPx} vs ${b.yPx}, nötig ${required}`);
    }
  }
}
assertSeparated([
  { id: "bull", xPx: 0, widthPx: 80, yPx: 100, heightPx: 10 },
  { id: "base", xPx: 10, widthPx: 80, yPx: 100, heightPx: 10 },
  { id: "bear", xPx: 20, widthPx: 80, yPx: 100, heightPx: 10 },
]);
{
  const far = [
    { id: "bull", xPx: 0, widthPx: 40, yPx: 0, heightPx: 10 },
    { id: "base", xPx: 0, widthPx: 40, yPx: 40, heightPx: 10 },
  ];
  const placed = separateLabelYs(far);
  assert.equal(placed.find(p => p.id === "bull")!.yPx, 0);
  assert.equal(placed.find(p => p.id === "base")!.yPx, 40);
}
{
  const sideBySide = [
    { id: "bull", xPx: 0, widthPx: 10, yPx: 50, heightPx: 10 },
    { id: "div-attractive", xPx: 100, widthPx: 10, yPx: 50, heightPx: 8, fixed: true },
  ];
  assert.equal(separateLabelYs(sideBySide).find(p => p.id === "bull")!.yPx, 50);
}
assertSeparated([
  { id: "div-attractive", xPx: 700, widthPx: 90, yPx: 120, heightPx: 8, fixed: true },
  { id: "bull", xPx: 640, widthPx: 110, yPx: 118, heightPx: 9 },
  { id: "base", xPx: 640, widthPx: 110, yPx: 120, heightPx: 9 },
  { id: "bear", xPx: 640, widthPx: 110, yPx: 122, heightPx: 9 },
]);

// Score-Baseline. Der Kegel importiert keine Score-Pipeline; die Zahlen sind der alte Head.
{
  const fix = json("script/fixtures/prod-analyze-dcf-2026-10-25.json");
  assert.equal(Number(fix.expectOldHead.VWAGY.overallScore).toFixed(6), "4.735718");
  assert.equal(Number(fix.expectOldHead.SAP.overallScore).toFixed(6), "5.174758");
  assert.equal(Number(fix.expectOldHead.MSFT.overallScore).toFixed(6), "4.058138");
  const lib = read("client/src/lib/scenarioCone.ts");
  assert.doesNotMatch(lib, /from ["'][^"']*(bias-fixes|scoring)|overallScore|applyBiasFix|finalScore/);
  assert.doesNotMatch(lib, /probabilityBull:\s*0\.\d|probabilityBase:\s*0\.\d|probabilityBear:\s*0\.\d/);
  const ui = read("client/src/components/sections/TechnicalChart.tsx");
  assert.match(ui, /const \[showCone, setShowCone\] = useState\(false\)/);
  assert.match(ui, /const \[showDividend, setShowDividend\] = useState\(false\)/);
  assert.match(ui, /setShowCone\(false\); \}, \[data\.ticker\]\)/);
  assert.match(ui, /if \(!showCone\) return null/);
  assert.match(ui, /data-testid="button-scenario-cone"/);
  assert.match(ui, /data-testid="button-dividend"/);
  assert.match(ui, /widthScale=\{CONE_VIEWPORT_SCALE\}/);
  assert.match(ui, /const CONE_VIEWPORT_SCALE = 1/);
  assert.match(ui, /\{CONE_PROBABILITY_HINT\}/);
  assert.match(lib, /Einzelwahrscheinlichkeiten, Summe ≠ 100 %/);
  assert.match(ui, /m\.caption/);
  assert.match(lib, /P\(≥ Bull-Ziel\)/);
  assert.match(lib, /P\(Base ± Intervall\)/);
  assert.match(lib, /P\(≤ Bear-Ziel\)/);
  assert.match(ui, /data-testid="cone-probability-hint"/);
  assert.match(ui, /TA_PRICE_AXIS_LEFT_PX, TA_PRICE_AXIS_RIGHT_PX, TA_PRICE_MARGIN_RIGHT_PX/);
  assert.doesNotMatch(ui, /taChartMinWidth\(52, 0, 10\)/);
  assert.doesNotMatch(ui, /widthScale=\{coneScale\}/);
  assert.match(ui, /data-testid="cone-tooltip-formula"/);
  assert.match(ui, /data-testid=\{`cone-label-\$\{b\.id\}`\}/);
  assert.match(ui, /scrollToEnd=\{showCone\}/);
  assert.match(lib, /regressionWindowDays: 252/);
  assert.match(lib, /inner: \{ level: 0\.5, z: 0\.6744897501960817 \}/);
  assert.match(ui, /\{cone && \(/);
  assert.match(ui, /separateLabelYs/);
  assert.match(ui, /data-testid=\{`cone-label-\$\{m\.id\}`\}/);
  assert.match(ui, /return cone \? attachConeSeries\(base, cone\) : base/);
  assert.match(ui, /const divBand = dividend \? attractiveYieldBand\(divAxisMax\) : null/);
  assert.match(ui, /\{dividend && divBand && \(/);
  assert.match(ui, /yAxisId="div" y1=\{divBand\.y1\} y2=\{divBand\.y2\}/);
  assert.doesNotMatch(ui, /overallScore|applyBiasFix/);
  const frame = read("client/src/components/sections/TaPlotFrame.tsx");
  assert.match(frame, /widthScale > 1 \? `calc\(\$\{base\} \* \$\{widthScale\}\)` : base/);
  // #341-Dividenden-Import bleibt, der Kegel hängt nicht an dieser Zeile.
  assert.match(ui, /attractiveYieldBand, isAttractiveDividendYield, DIV_ATTRACTIVE_YIELD_PCT/);
  assert.match(lib, /volWindowDays: 63/);
  assert.match(lib, /P10: \{ percentile: 10, z: -1\.2815515655446004 \}/);
  assert.match(lib, /P90: \{ percentile: 90, z: 1\.2815515655446004 \}/);
  assert.doesNotMatch(lib, /inverseNorm|INV_NORM|CONE_BAND_PERCENT/);
}

console.log("test-scenario-cone: OK");
