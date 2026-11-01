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
  CONE_PARAMS, POS_NA, addTradingDays, attachConeSeries, bandZ, buildScenarioCone,
  coneBandPrice, coneDomainValues, conePlotScale, horizonTradingDays,
  realizedSigmaDaily, scenarioConeFromAnalysis, type ScenarioConeInput,
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
  assert.equal(cone.shortHistory, false);
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
  assert.ok(cone.volSample < CONE_PARAMS.volWindowDays);
  assert.ok(cone.sigmaDaily != null && cone.sigmaDaily > 0);
  assert.equal(cone.points[0].p10, 10.8);
  assert.equal(cone.points[0].p50, 10.8);
  assert.equal(cone.points[0].p90, 10.8);
  assert.equal(cone.points.length, 6);
  const manual = realizedSigmaDaily(closes, closes.length);
  assert.equal(cone.sigmaDaily, manual.sigma);
  const t = 4;
  assert.ok(Math.abs(cone.points[t].p90 - coneBandPrice(10.8, cone.sigmaDaily!, bandZ("P90"), t)) < 1e-9);
  assert.ok(Math.abs(cone.points[t].p10 - coneBandPrice(10.8, cone.sigmaDaily!, bandZ("P10"), t)) < 1e-9);
  assert.equal(cone.points[t].p50, 10.8);
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
  assert.equal(attached[attached.length - 1].coneBearLabel, "Bear · PoS n/a");
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

// MSFT: letzter Close, Bull = Konsens-Kurs, Base = Close·(1+g*), Bear = Close·(1−Schaden), PoS n/a.
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
  for (const m of cone.markers) {
    assert.equal(m.probability, null);
    assert.equal(m.posText, POS_NA);
    assert.equal(m.posText, "PoS n/a");
    assert.ok(m.posText !== "50%" && m.posText !== "30%" && m.posText !== "20%");
  }
  const t = 20;
  assert.ok(Math.abs(cone.points[t].p90 - coneBandPrice(last.close, cone.sigmaDaily!, bandZ("P90"), t)) < 1e-6);
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
  assert.equal(cone.markers.find(m => m.id === "bull")!.price, null);
  const samples = coneDomainValues(cone);
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  assert.ok(lo > 1, `Achse auf 0/Pence gezogen: min ${lo}`);
  assert.equal(samples.some(v => v === 0), false);
  assert.ok(hi / 39.38 < 30 && 39.38 / lo < 30, `Spanne ${lo}…${hi} nicht mehr GBP-Kurs`);
  for (const m of cone.markers) assert.equal(m.posText, POS_NA);
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
  assert.ok(lo > 0 && lo > last * 0.05, `${ticker} Achse gestaucht: ${lo} bei Close ${last}`);
  assert.ok(hi / last < 30 && last / lo < 30, `${ticker} Spanne ${lo}…${hi}`);
  assert.ok(cone.markers.every(m => m.posText === POS_NA));
}

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
  assert.match(ui, /widthScale=\{coneScale\}/);
  assert.match(ui, /\{cone && \(/);
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
