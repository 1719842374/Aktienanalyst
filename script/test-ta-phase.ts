/**
 * Sektion 12: Kurslinie und Badge teilen phaseFromTechnical.
 * NVO-Muster (Death Cross) darf nicht ATTRAKTIV sein. MSFT-Fixture ist der Gegencheck.
 * Ausführen: npx tsx script/test-ta-phase.ts
 */
import { readFileSync } from "fs";
import type { StockAnalysis } from "../shared/schema";
import { ampelColorFromStatus } from "../client/src/lib/comboBands";
import { buildBiasDecision, evaluateTechMoatOverride } from "../shared/bias-fixes";
import {
  buyScoreFromFlags,
  chartAmpelFromAnalysis,
  headerContradicts,
  paintPhaseRows,
  phaseFromTechnical,
  phasesByDate,
  type TaFlags,
  type TaPhase,
} from "../shared/ta-phase";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ALL: TaFlags = { priceAboveMA200: true, ma50AboveMA200: true, macdAboveZero: true, macdRising: true };

function flagsOf(mask: number): TaFlags {
  return {
    priceAboveMA200: (mask & 8) !== 0,
    ma50AboveMA200: (mask & 4) !== 0,
    macdAboveZero: (mask & 2) !== 0,
    macdRising: (mask & 1) !== 0,
  };
}

const COLOR: Record<TaPhase, "green" | "yellow" | "red"> = {
  ATTRAKTIV: "green",
  NEUTRAL: "yellow",
  VORSICHTIG: "red",
};

console.log("\n=== Eine Ampel, keine zweite Schwelle ===");
for (let mask = 0; mask < 16; mask++) {
  const flags = flagsOf(mask);
  const phase = phaseFromTechnical(flags, false);
  const score = buyScoreFromFlags(flags);
  check(
    `Maske ${mask} (${score}/4) gleiche Farbe wie Kombinationskurs`,
    phase != null && ampelColorFromStatus(flags) === COLOR[phase],
    `${phase} vs ${ampelColorFromStatus(flags)}`,
  );
  check(`Maske ${mask} widerspricht dem Kopf nicht`, phase != null && !headerContradicts(score, phase), `${score} ${phase}`);
}
check("3/4 ist NEUTRAL, nicht ATTRAKTIV", phaseFromTechnical({ ...ALL, macdRising: false }, false) === "NEUTRAL");
check("Death Cross bei sonst drei JA ist nicht positiv", phaseFromTechnical({ ...ALL, ma50AboveMA200: false }, false) === "NEUTRAL");
check("0/4 ist VORSICHTIG", phaseFromTechnical({ priceAboveMA200: false, ma50AboveMA200: false, macdAboveZero: false, macdRising: false }, false) === "VORSICHTIG");
check("fehlende Flags bleiben ungefärbt", phaseFromTechnical(null, false) === null);
check("Override stuft nur ATTRAKTIV auf NEUTRAL ab", phaseFromTechnical(ALL, true) === "NEUTRAL");
check("Override lässt VORSICHTIG stehen", phaseFromTechnical({ ...ALL, priceAboveMA200: false, ma50AboveMA200: false, macdAboveZero: false }, true) === "VORSICHTIG");

console.log("\n=== Segmente stoßen am Farbwechsel ===");
{
  const rows = [
    { date: "d0", close: 10 },
    { date: "d1", close: 11 },
    { date: "d2", close: 12 },
    { date: "d3", close: 9 },
    { date: "d4", close: null as number | null },
  ];
  const phases = new Map<string, TaPhase | null>([
    ["d0", null],
    ["d1", "VORSICHTIG"],
    ["d2", "NEUTRAL"],
    ["d3", "ATTRAKTIV"],
  ]);
  const painted = paintPhaseRows(rows, phases);
  check("Warmup bleibt Basisfarbe", painted[0]._phBase === 10 && painted[0]._phV == null);
  check("erster gefärbter Punkt trifft die Basis", painted[1]._phBase === 11 && painted[1]._phV === 11);
  check("Wechsel VORSICHTIG → NEUTRAL trägt beide", painted[2]._phV === 12 && painted[2]._phN === 12);
  check("ATTRAKTIV nur auf dem grünen Punkt und der Naht", painted[3]._phA === 9 && painted[3]._phN === 9 && painted[2]._phA == null);
  check("ohne Close keine Farbe", painted[4]._phase == null && painted[4]._phA == null && painted[4]._phBase == null);
}

console.log("\n=== MSFT-Fixture: Gegencheck, Badge = Kopf ===");
const msft = JSON.parse(readFileSync(new URL("./fixtures/analysis-MSFT.json", import.meta.url), "utf8")) as StockAnalysis;
{
  const ampel = chartAmpelFromAnalysis(msft);
  const bias = buildBiasDecision(msft);
  console.log(`  ℹ MSFT Phase ${ampel.phase} · Kopf ${ampel.buyScore}/4 · Override ${ampel.overrideActive} · RSL ${ampel.rsl} · Perzentil ${ampel.rslPercentile}`);
  console.log(`  ℹ MSFT Override-Text: ${ampel.detail}`);
  check("MSFT Badge ist ATTRAKTIV", ampel.phase === "ATTRAKTIV", String(ampel.phase));
  check("MSFT Kopf ist 4/4", ampel.buyScore === 4, String(ampel.buyScore));
  check("MSFT Badge widerspricht dem Kopf nicht", ampel.contradictsHeader === false);
  check("MSFT Override aus, identisch mit buildBiasDecision", ampel.overrideActive === false && bias.techMoatOverride.active === false, bias.techMoatOverride.detail);
  check("MSFT RSL-Perzentil kommt aus evaluateTechMoatOverride", ampel.rslPercentile === bias.techMoatOverride.rslPercentile, `${ampel.rslPercentile} vs ${bias.techMoatOverride.rslPercentile}`);
}

console.log("\n=== NVO-Muster: Death Cross, kein positives Signal ===");
{
  const cs = msft.technicalIndicators!.currentStatus;
  const sorted = [...msft.historicalPrices].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 130);
  const avg26w = sorted.reduce((s, p) => s + p.close, 0) / sorted.length;
  const nvo = {
    ...msft,
    ticker: "NVO",
    companyName: "Novo Nordisk",
    currentPrice: avg26w * 0.85,
    moatRating: "None",
    moatAssessment: { ...msft.moatAssessment!, overallRating: "None" },
    technicalIndicators: {
      ...msft.technicalIndicators!,
      currentStatus: {
        ...cs,
        priceAboveMA200: false,
        ma50AboveMA200: false,
        macdAboveZero: false,
        macdRising: false,
        buySignal: false,
      },
    },
  } as StockAnalysis;
  const ampel = chartAmpelFromAnalysis(nvo);
  const bias = buildBiasDecision(nvo);
  console.log(`  ℹ NVO-Muster Phase ${ampel.phase} · Kopf ${ampel.buyScore}/4 · Override ${ampel.overrideActive} · RSL ${ampel.rsl} · Perzentil ${ampel.rslPercentile}`);
  console.log(`  ℹ NVO-Muster Override-Text: ${ampel.detail}`);
  check("NVO-Muster ist nicht ATTRAKTIV", ampel.phase !== "ATTRAKTIV", String(ampel.phase));
  check("NVO-Muster ist VORSICHTIG", ampel.phase === "VORSICHTIG", String(ampel.phase));
  check("NVO-Muster widerspricht dem Kopf nicht", ampel.contradictsHeader === false);
  check("NVO-Muster Death-Cross-Override aktiv", ampel.overrideActive === true && bias.techMoatOverride.active === true, ampel.detail ?? "");
  check("NVO-Muster Perzentil ist das Override-Perzentil", ampel.rslPercentile === bias.techMoatOverride.rslPercentile && ampel.rslPercentile != null, String(ampel.rslPercentile));
  const direct = evaluateTechMoatOverride({
    ma50AboveMA200: false,
    rsl: ampel.rsl,
    historicalPrices: [],
    ruleMoat: { rating: bias.techMoatOverride.ruleMoatRating as "None", score: bias.techMoatOverride.ruleMoatScore },
    llmMoatRating: "None",
  });
  check("Override-Schalter hängt nicht an der Historie", direct.active === true, direct.detail);

  const series = phasesByDate([
    { date: "2024-01-02", close: 100, ma200: 90, ma50: 95, macd: 1 },
    { date: "2024-01-03", close: 80, ma200: 100, ma50: 90, macd: -0.4 },
  ], ampel.moat);
  check("historischer Death-Cross-Tag ist nicht ATTRAKTIV", series.get("2024-01-03") !== "ATTRAKTIV", String(series.get("2024-01-03")));
  check("Tag ohne Vorgänger-MACD bleibt ungefärbt", series.get("2024-01-02") === null);
}

console.log("\n=== Chart-Quelle ===");
{
  const ui = readFileSync(new URL("../client/src/components/sections/TechnicalChart.tsx", import.meta.url), "utf8");
  check("Badge-Testid", ui.includes('data-testid="chart-ampel-label"'));
  check("kein Starkes Kaufsignal", !ui.includes("Starkes Kaufsignal") && !readFileSync(new URL("../shared/ta-phase.ts", import.meta.url), "utf8").includes("Starkes Kaufsignal"));
  check("MA-Labels bleiben MA200 MA100 MA50 MA20", ["MA200 (SMA)", "MA100 (SMA)", "MA50 (SMA)", "MA20 (SMA)"].every(label => ui.includes(label)));
  check("importiert die gemeinsame Phase", ui.includes('from "@shared/ta-phase"'));
}

console.log(failed === 0 ? "\n✅ Alle Phasen-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
