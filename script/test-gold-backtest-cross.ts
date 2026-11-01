/**
 * F10-33 — Backtest der MA-Cross-Signale auf Gold.
 * Ausführen: npx tsx script/test-gold-backtest-cross.ts
 *
 * Soll: Future_10_Gold_Adaptive_Scoring_Framework.md Z.274, Definition Z.84–85
 * und Code-Schema Z.120–123. Trefferquote und Forward-Returns. Horizonte und
 * Fenster sind Parameter. Signifikanz ist z-Score und empirisches Perzentil
 * gegen alle Forward-Returns desselben Horizonts, ohne Schwellen-Cutoff.
 */
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  GOLD_CROSS_BACKTEST_PARAMS,
  backtestGoldMaCross,
  registerGoldBacktestCrossRoute,
  summarizeForwardReturns,
  type CloseBar,
  type GoldCrossBacktestParams,
} from "../server/gold-backtest-cross";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const near = (value: number, expected: number, eps = 1e-9) => Math.abs(value - expected) < eps;

function meanOf(xs: number[]): number {
  return xs.reduce((sum, value) => sum + value, 0) / xs.length;
}

function populationStd(xs: number[], mu: number): number {
  return Math.sqrt(xs.reduce((sum, value) => sum + (value - mu) ** 2, 0) / xs.length);
}

function percentileOf(baseline: number[], value: number, scale: number): number {
  const le = baseline.filter((entry) => entry <= value).length;
  return (le / baseline.length) * scale;
}

const FIXTURE: CloseBar[] = [
  { date: "2020-01-01", close: 10 },
  { date: "2020-01-02", close: 10 },
  { date: "2020-01-03", close: 10 },
  { date: "2020-01-06", close: 10 },
  { date: "2020-01-07", close: 10 },
  { date: "2020-01-08", close: 14 },
  { date: "2020-01-09", close: 18 },
  { date: "2020-01-10", close: 18 },
  { date: "2020-01-13", close: 10 },
  { date: "2020-01-14", close: 6 },
  { date: "2020-01-15", close: 6 },
];

const PARAMS: GoldCrossBacktestParams = {
  symbol: "GC=F",
  fastWindow: 2,
  slowWindow: 4,
  horizons: { near: 1, far: 2 },
  historyFrom: "1970-01-01",
  cacheTtlMs: 60_000,
  percentScale: 100,
};

console.log("\nSignifikanz ohne Cutoff");
{
  const flat = summarizeForwardReturns([0], [0, 0, 0], () => true, 100);
  check("z bei Streuung 0 ist null", flat.zScore === null);
  check("Perzentil bleibt bei Streuung 0 definiert", flat.percentile === 100);
  check("leere Ereignisse lassen Mittel und z leer", summarizeForwardReturns([], [0.1, -0.2], () => true, 100).meanForwardReturn === null
    && summarizeForwardReturns([], [0.1, -0.2], () => true, 100).zScore === null);
  const baseline = [0, 0, 0, 0, 0.4, 18 / 14 - 1, 0, 10 / 18 - 1, -0.4, 0];
  const golden = summarizeForwardReturns([18 / 14 - 1], baseline, (value) => value > 0, 100);
  check("Golden-Perzentil der Handrechnung ist 90", golden.percentile === 90);
  check("Golden-z aus der Handrechnung", golden.zScore != null && near(golden.zScore, (18 / 14 - 1 - meanOf(baseline)) / populationStd(baseline, meanOf(baseline))));
  const death = summarizeForwardReturns([-0.4], baseline, (value) => value < 0, 100);
  check("Death-Perzentil der Handrechnung ist 20", death.percentile === 20);
  check("Death-Treffer bei negativem Return", death.hitRate === 1);
  check("Null-Return ist kein Treffer", summarizeForwardReturns([0], baseline, (value) => value > 0, 100).hitRate === 0);
}

console.log("\nGolden und Death auf der Fixture");
{
  const result = backtestGoldMaCross(FIXTURE, PARAMS);
  check("auswertbar, kein Score", result.available && result.inScore === false && !("score" in result));
  check("ein Golden Cross am 2020-01-08", result.golden.events === 1 && result.golden.dates[0] === "2020-01-08" && result.golden.lastDate === "2020-01-08");
  check("ein Death Cross am 2020-01-13", result.death.events === 1 && result.death.dates[0] === "2020-01-13");
  const goldenNear = result.golden.horizons.find((row) => row.name === "near");
  const deathNear = result.death.horizons.find((row) => row.name === "near");
  const goldenFar = result.golden.horizons.find((row) => row.name === "far");
  const deathFar = result.death.horizons.find((row) => row.name === "far");
  check("Horizonte in Parameter-Reihenfolge", result.golden.horizons.map((row) => row.name).join(",") === "near,far");
  check("near ist 1 Handelstag", goldenNear?.sessions === 1 && deathNear?.sessions === 1);
  check("Golden near = 18/14 − 1, Treffer 100 %", goldenNear != null && goldenNear.observations === 1 && goldenNear.hitRate === 1
    && goldenNear.meanForwardReturn != null && near(goldenNear.meanForwardReturn, 18 / 14 - 1)
    && goldenNear.medianForwardReturn === goldenNear.meanForwardReturn);
  check("Death near = −0,4, Treffer 100 %", deathNear != null && deathNear.hitRate === 1 && deathNear.meanForwardReturn === -0.4);
  check("Golden near Perzentil 90", goldenNear?.percentile === 90);
  check("Death near Perzentil 20", deathNear?.percentile === 20);
  const farBaseline = [0, 0, 0, 0.4, 0.8, 18 / 14 - 1, 10 / 18 - 1, 6 / 18 - 1, -0.4];
  check("Golden far Perzentil 700/9", goldenFar?.percentile != null && near(goldenFar.percentile, percentileOf(farBaseline, 18 / 14 - 1, 100)));
  check("Death far Perzentil 100/3", deathFar?.percentile != null && near(deathFar.percentile, percentileOf(farBaseline, -0.4, 100)));
  check("Golden-z positiv, Death-z negativ", (goldenNear?.zScore ?? 0) > 0 && (deathNear?.zScore ?? 0) < 0);
  check("unbedingtes Mittel liegt bei", goldenNear?.unconditionalMean != null && deathNear?.unconditionalObservations === 10
    && near(goldenNear.unconditionalMean, meanOf([0, 0, 0, 0, 0.4, 18 / 14 - 1, 0, 10 / 18 - 1, -0.4, 0])));
}

console.log("\nFenster, Sortierung, Lücken");
{
  const reversed = backtestGoldMaCross([...FIXTURE].reverse(), PARAMS);
  check("unsortierte Bars liefern dieselben Kreuze", reversed.golden.dates[0] === "2020-01-08" && reversed.death.dates[0] === "2020-01-13");
  const withHole = backtestGoldMaCross([
    FIXTURE[0],
    { date: "2020-01-02", close: 0 },
    ...FIXTURE.slice(1),
  ], PARAMS);
  check("Close ≤ 0 fällt heraus und ändert die Kreuze nicht", withHole.golden.dates.join() === "2020-01-08" && withHole.bars === FIXTURE.length);
  const tail = backtestGoldMaCross([
    { date: "2020-02-03", close: 10 },
    { date: "2020-02-04", close: 10 },
    { date: "2020-02-05", close: 10 },
    { date: "2020-02-06", close: 10 },
    { date: "2020-02-07", close: 14 },
  ], PARAMS);
  const tailNear = tail.golden.horizons.find((row) => row.name === "near");
  check("Kreuz ohne Folge-Bar bleibt Ereignis, Forward-Return n/a", tail.golden.events === 1 && tail.golden.lastDate === "2020-02-07"
    && tailNear?.observations === 0 && tailNear.hitRate === null && tailNear.meanForwardReturn === null && tailNear.zScore === null);
  check("flache Reihe ohne Kreuz", backtestGoldMaCross(FIXTURE.slice(0, 6).map((bar) => ({ ...bar, close: 10 })), PARAMS).golden.events === 0
    && backtestGoldMaCross(FIXTURE.slice(0, 6).map((bar) => ({ ...bar, close: 10 })), PARAMS).death.events === 0);
  const bad = backtestGoldMaCross(FIXTURE, { ...PARAMS, fastWindow: 4, slowWindow: 4 });
  check("fast ≥ slow ist nicht auswertbar", bad.available === false && bad.golden.events === 0 && bad.unavailableReason != null);
  const empty = backtestGoldMaCross([], PARAMS);
  check("keine Bars sind nicht auswertbar", empty.available === false && empty.bars === 0 && empty.from === null);
}

console.log("\nBenannte Standard-Horizonte");
{
  check("Standardfenster 50/200 aus der Spec", GOLD_CROSS_BACKTEST_PARAMS.fastWindow === 50 && GOLD_CROSS_BACKTEST_PARAMS.slowWindow === 200);
  check("Horizonte heißen oneMonth, oneQuarter, oneYear", Object.keys(GOLD_CROSS_BACKTEST_PARAMS.horizons).join(",") === "oneMonth,oneQuarter,oneYear");
  const short = Array.from({ length: 5 }, (_, index) => ({ date: `2021-01-0${index + 1}`, close: 100 + index }));
  const named = backtestGoldMaCross(short, GOLD_CROSS_BACKTEST_PARAMS);
  check("kurze Reihe nennt die drei Horizonte mit ihren Sessions", named.available
    && named.golden.horizons.map((row) => `${row.name}:${row.sessions}`).join(",") === "oneMonth:21,oneQuarter:63,oneYear:252"
    && named.golden.events === 0);
  check("Symbol GC=F und inScore false", named.symbol === "GC=F" && named.inScore === false);
}

console.log("\nRoute /api/gold/backtest-cross");
{
  let calls = 0;
  const fetchBars = async (symbol: string, from: string, to: string) => {
    calls += 1;
    check("Abruf ist GC=F ab dem benannten Historiestart", symbol === "GC=F" && from === PARAMS.historyFrom && /^\d{4}-\d{2}-\d{2}$/.test(to));
    return FIXTURE;
  };
  const app = express();
  registerGoldBacktestCrossRoute(app, { fetchBars, now: () => 1_700_000_000_000, params: PARAMS });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  try {
    const port = (server.address() as AddressInfo).port;
    const first = await fetch(`http://127.0.0.1:${port}/api/gold/backtest-cross`);
    const body = await first.json() as { golden: { dates: string[] }; inScore: boolean; available: boolean };
    check("GET 200 mit dem Golden-Datum", first.status === 200 && body.available && body.inScore === false && body.golden.dates[0] === "2020-01-08");
    await fetch(`http://127.0.0.1:${port}/api/gold/backtest-cross`);
    check("zweiter Abruf nutzt den Cache", calls === 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }

  let attempts = 0;
  const flaky = express();
  registerGoldBacktestCrossRoute(flaky, {
    fetchBars: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Yahoo weg");
      return FIXTURE;
    },
    now: () => 1_700_000_000_000,
    params: PARAMS,
  });
  const flakyServer = flaky.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => flakyServer.once("listening", () => resolve()));
  try {
    const port = (flakyServer.address() as AddressInfo).port;
    const failedRes = await fetch(`http://127.0.0.1:${port}/api/gold/backtest-cross`);
    const failedBody = await failedRes.json() as { available: boolean; unavailableReason: string | null; inScore: boolean };
    check("Yahoo-Fehler bleibt 200 und auswertbar false", failedRes.status === 200 && failedBody.available === false && failedBody.inScore === false
      && (failedBody.unavailableReason ?? "").includes("Yahoo weg"));
    const recovered = await fetch(`http://127.0.0.1:${port}/api/gold/backtest-cross`);
    const recoveredBody = await recovered.json() as { available: boolean };
    check("Fehler wird nicht gecacht", attempts === 2 && recoveredBody.available === true);
  } finally {
    await new Promise<void>((resolve, reject) => flakyServer.close((err) => (err ? reject(err) : resolve())));
  }
}

console.log("\nVerdrahtung ohne Score-Dateien");
{
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const registrations = routes.match(/registerGoldBacktestCrossRoute/g) ?? [];
  check("routes.ts registriert den Handler genau einmal", registrations.length === 1);
  check(
    "die Registrierung ist eine Zeile",
    routes.includes('(await import("./gold-backtest-cross")).registerGoldBacktestCrossRoute(app);'),
  );
  const handler = readFileSync(new URL("../server/gold-backtest-cross.ts", import.meta.url), "utf8");
  check("Handler importiert den adaptiven Score nicht", !handler.includes("gold-adaptive-score"));
  check("Handler nennt die Route", handler.includes('"/api/gold/backtest-cross"'));
  check("Handler liest Yahoo über das Symbol", handler.includes("yahooFetch") && handler.includes("symbol"));
  const dashboard = readFileSync(new URL("../client/src/pages/GoldDashboard.tsx", import.meta.url), "utf8");
  check("Info-Karte hängt am Gold-Dashboard", dashboard.includes("<GoldCrossBacktestCard />"));
  const card = readFileSync(new URL("../client/src/components/gold/GoldCrossBacktestCard.tsx", import.meta.url), "utf8");
  check("Karte fragt /api/gold/backtest-cross", card.includes('"/api/gold/backtest-cross"'));
  check("Karte sagt, dass sie den Score nicht verändert", card.includes("kein Score"));
  check("Karte importiert weder Score noch TechnicalChart", !card.includes("gold-adaptive-score") && !card.includes("TechnicalChart"));
  const priceChart = readFileSync(new URL("../client/src/components/gold/GoldPriceChart.tsx", import.meta.url), "utf8");
  check("GoldPriceChart bleibt ohne den Backtest-Import", !priceChart.includes("gold-backtest-cross") && !priceChart.includes("GoldCrossBacktestCard"));
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll gold MA-cross backtest checks passed.");
