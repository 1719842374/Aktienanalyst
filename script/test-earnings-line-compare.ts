/**
 * Vorher/Nachher für Score, Rating, Ampel und Kurslinienfarbe.
 * Fixtures only. Keine Live-Keys.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-earnings-line-compare.ts
 */
import { readFileSync } from "node:fs";
import type { StockAnalysis } from "../shared/schema";

const { buildBiasDecision } = await import("../shared/bias-fixes.ts");
const { ampelFactorsFromAnalysis, symmetricAmpelSeries } = await import("../shared/symmetric-ampel.ts");
const { buildFullSeries } = await import("../client/src/lib/taWindowSeries.ts");

const ui = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
const fourWired = ui.includes("paintAmpelClose(");
const ampelToggleOff = /const \[showAmpel,\s+setShowAmpel\]\s+=\s+useState\(false\)/.test(ui);
const blueClose = ui.includes('closeStroke="hsl(var(--primary))"');

const FOUR_COLOR: Record<string, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
};

function lineColor(fourTone: string | null, phase: string | null, toggleOn: boolean): string {
  if (toggleOn && phase) return `Phasenlinie ${phase} über der Close-Linie`;
  if (fourWired && fourTone && FOUR_COLOR[fourTone]) return `Vier-Bedingungen ${fourTone} ${FOUR_COLOR[fourTone]}`;
  if (fourWired && !fourTone) return "blau hsl(var(--primary)) (Tag ohne MA/MACD)";
  if (ampelToggleOff && blueClose) return "blau hsl(var(--primary))";
  return "n/a — Chart-Default nicht erkannt";
}

async function fourToneOf(points: { close: number; ma200?: number; ma50?: number; macd?: number }[]): Promise<string | null | "missing"> {
  try {
    const { paintAmpelClose } = await import("../shared/ta-ampel.ts");
    const painted = paintAmpelClose(points);
    const last = [...painted].reverse().find(p => p._ampel != null) ?? painted[painted.length - 1];
    return last?._ampel ?? null;
  } catch {
    return "missing";
  }
}

function load(name: string): StockAnalysis | null {
  try {
    return JSON.parse(readFileSync(name, "utf8")) as StockAnalysis;
  } catch {
    return null;
  }
}

const tickers = [
  { ticker: "MSFT", file: "script/fixtures/analysis-MSFT.json" },
  { ticker: "NVDA", file: "script/fixtures/analysis-NVDA.json" },
  { ticker: "SPY", file: "script/fixtures/analysis-SPY.json" },
];

for (const item of tickers) {
  const data = load(item.file);
  if (!data) {
    console.log(`${item.ticker}\tScore\tn/a — keine Fixture ${item.file}`);
    console.log(`${item.ticker}\tRating\tn/a — keine Fixture ${item.file}`);
    console.log(`${item.ticker}\tAmpel symmetrisch\tn/a — keine Fixture ${item.file}`);
    console.log(`${item.ticker}\tVier-Bedingungen letzter Ton\tn/a — keine Fixture ${item.file}`);
    console.log(`${item.ticker}\tKurslinie Toggle aus\tn/a — keine Fixture ${item.file}`);
    console.log(`${item.ticker}\tKurslinie Toggle an\tn/a — keine Fixture ${item.file}`);
    console.log(`${item.ticker}\tscoring.finalScore\tn/a — keine Fixture ${item.file}`);
    continue;
  }
  const bias = buildBiasDecision(data);
  const bars = (data.historicalPrices ?? []).map(p => ({ date: p.date, close: p.close, volume: p.volume ?? 0, open: p.open ?? p.close, high: p.high ?? p.close, low: p.low ?? p.close }));
  const full = buildFullSeries(bars);
  const factors = ampelFactorsFromAnalysis(data);
  const symmetric = symmetricAmpelSeries(full.points.map(p => ({
    date: p.date,
    close: p.close,
    volume: p.volume,
    rsi: p.rsi,
    histogram: p.histogram,
  })), factors);
  const lastDate = full.points[full.points.length - 1]?.date ?? "";
  const phase = lastDate ? (symmetric.phases.get(lastDate) ?? null) : null;
  const tone = await fourToneOf(full.points);
  const toneText = tone === "missing" ? "nicht auf diesem Stand (kein shared/ta-ampel.ts)" : (tone ?? "n/a — kein vollständiger Tag");
  const header = data.technicalIndicators?.currentStatus;
  const buy = header
    ? [header.priceAboveMA200, header.ma50AboveMA200, header.macdAboveZero, header.macdRising].filter(Boolean).length
    : null;
  console.log(`${item.ticker}\tScore\t${bias.overallScore}`);
  console.log(`${item.ticker}\tRating\t${bias.overallRating}`);
  console.log(`${item.ticker}\tscoring.finalScore\t${data.scoring?.finalScore ?? "n/a — Feld fehlt"}`);
  console.log(`${item.ticker}\tAmpel symmetrisch\t${symmetric.last?.color ?? "n/a"} ${symmetric.last?.meaning ?? ""}`.trim());
  console.log(`${item.ticker}\tAmpel symmetrisch Phase letzter Kurs\t${phase ?? "n/a"}`);
  console.log(`${item.ticker}\tVier-Bedingungen Header\t${buy == null ? "n/a — currentStatus fehlt" : `${buy}/4`}`);
  console.log(`${item.ticker}\tVier-Bedingungen letzter Ton\t${toneText}`);
  console.log(`${item.ticker}\tKurslinie Toggle aus\t${lineColor(tone === "missing" ? null : tone, phase, false)}`);
  console.log(`${item.ticker}\tKurslinie Toggle an\t${lineColor(tone === "missing" ? null : tone, phase, true)}`);
}
console.log(`chart\tshowAmpel default aus\t${ampelToggleOff}`);
console.log(`chart\tblaue Close-Linie\t${blueClose}`);
console.log(`chart\tVier-Bedingungen verdrahtet\t${fourWired}`);
console.log("earnings line compare: OK");
