/**
 * Kauf/Verkauf-Marken der BTC-Reihe bleiben über die ganze Historie erhalten.
 * Ein Zuschnitt auf die letzten 100 Marken lässt auf dem 10-Jahres-Chart nur
 * die Zeit ab etwa 2021 stehen.
 *
 * Run: npx tsx script/test-btc-chart-signals.ts
 */
import { readFileSync } from "node:fs";
import { detectBtcChartSignals, type BtcChartSignalBar } from "../shared/btc-signals";

let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

function bar(date: string, patch: Partial<BtcChartSignalBar> = {}): BtcChartSignalBar {
  return {
    date,
    price: 100,
    ma50: 90,
    ma200: 80,
    macd: 1,
    signal: 0.5,
    ma111: null,
    ma350x2: null,
    ma730: null,
    ...patch,
  };
}

const series: BtcChartSignalBar[] = [bar("2015-06-01", { ma50: 70, ma200: 80 })];
series.push(bar("2015-06-02", { ma50: 85, ma200: 80, price: 110 }));
for (let i = 0; i < 130; i++) {
  const day = String(i + 3).padStart(2, "0");
  const month = String((i % 12) + 1).padStart(2, "0");
  const year = 2016 + Math.floor(i / 12);
  const crossed = i % 2 === 0;
  series.push(bar(`${year}-${month}-${day}`, {
    macd: crossed ? 1 : -1,
    signal: 0,
  }));
}

const signals = detectBtcChartSignals(series);
const golden = signals.find((signal) => signal.reason === "Golden Cross (MA50 > MA200)");
check("Golden Cross von 2015 bleibt erhalten", golden?.date === "2015-06-02" && golden.type === "BUY");
check(
  "mehr als 100 spätere MACD-Kreuze verdrängen die frühe Marke nicht",
  signals.length > 100 && signals[0]?.date === "2015-06-02",
  { count: signals.length, first: signals[0]?.date },
);
check(
  "MACD-Kreuze vor 2021 sind dabei",
  signals.some((signal) => signal.date < "2021-01-01" && signal.reason === "MACD Bullish Crossover"),
);

const dashboard = readFileSync(new URL("../client/src/pages/BTCDashboard.tsx", import.meta.url), "utf8");
check(
  "seltene Kreuze bleiben ein Zeichenpunkt, MACD wird nicht auf 100 gekürzt",
  dashboard.includes('signal.reason.startsWith("Golden Cross")')
    && dashboard.includes('signal.reason === "Pi Cycle Top"')
    && !dashboard.includes("signals.slice(-100)"),
);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nbtc chart signals ok");
