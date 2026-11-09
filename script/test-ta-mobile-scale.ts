/**
 * Mobile TA Skalierung v1 — Floors und Achsenlogik (UI-only).
 * Run: npx tsx script/test-ta-mobile-scale.ts
 */
import { readFileSync } from "node:fs";
import {
  TA_AXIS_FONT_PX,
  TA_OSC_MIN_PX,
  TA_PLOT_MIN_PX,
  TA_VOLUME_BAND_PX,
  TA_X_MIN_TICK_GAP,
  axisTick,
  narrowPriceTicks,
  taChartMinWidth,
  xAxisIntervalProps,
} from "../client/src/lib/taChartScale";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

check("Plot-Floor ≥ 360", TA_PLOT_MIN_PX >= 360);
check("Achsenfont mobile ≥ 10", TA_AXIS_FONT_PX >= 10);
check("Volumenband 36–44", TA_VOLUME_BAND_PX >= 36 && TA_VOLUME_BAND_PX <= 44);
check("Oszillator-Floor ≥ 40", TA_OSC_MIN_PX >= 40);
check("X-Lücke deckt ein 10px-Label ab", TA_X_MIN_TICK_GAP >= 32);

const stockMin = taChartMinWidth(52, 0, 10);
check("Aktien-Chart min = Plot + linke Achse + Rand", stockMin === TA_PLOT_MIN_PX + 52 + 10, String(stockMin));
const btcMin = taChartMinWidth(55, 44, 8);
check("BTC mit einer %-Achse min = 360+55+44+8", btcMin === 467, String(btcMin));

const ticks = narrowPriceTicks(10, 50, 5);
check("Preis-Ticks genau 5", ticks.length === 5, ticks.join(","));
check("Preis-Ticks monoton, Endpunkte auf der Domain",
  ticks[0] === 10 && ticks[4] === 50 && ticks.every((v, i) => i === 0 || v > ticks[i - 1]));
check("zu viele Ticks werden auf 5 gekappt", narrowPriceTicks(0, 100, 9).length === 5);
check("zu wenige Ticks werden auf 4 angehoben", narrowPriceTicks(0, 100, 2).length === 4);
check("ungültige Domain fällt nicht um", narrowPriceTicks(Number.NaN, 1).length === 2);

const narrowX = xAxisIntervalProps(true, 31);
check("Mobile X dünnt mit preserveStartEnd", narrowX.interval === "preserveStartEnd");
check("Mobile X setzt die Mindestlücke", narrowX.minTickGap === TA_X_MIN_TICK_GAP);
const desktopX = xAxisIntervalProps(false, 31);
check("Desktop-X bleibt das numerische Intervall", desktopX.interval === 31 && desktopX.minTickGap == null);

check("Mobile-Tick 10px", axisTick(true, 9, "#fff").fontSize === 10);
check("Desktop-Tick unverändert", axisTick(false, 9, "#fff").fontSize === 9 && axisTick(false, 8, "#fff").fontSize === 8);

const plot = readFileSync(new URL("../client/src/components/sections/TaPlotFrame.tsx", import.meta.url), "utf8");
const stock = readFileSync(new URL("../client/src/components/sections/TechnicalChart.tsx", import.meta.url), "utf8");
const btc = readFileSync(new URL("../client/src/pages/BTCDashboard.tsx", import.meta.url), "utf8");
const dash = readFileSync(new URL("../client/src/pages/Dashboard.tsx", import.meta.url), "utf8");

check("Scrollbreite ist max(100%, min), nicht nur min-width", plot.includes("max(100%"));
check("Volumenband nutzt den Floor", plot.includes("TA_VOLUME_BAND_PX") && plot.includes("minHeight: TA_VOLUME_BAND_PX"));
check("Aktien-Chart scrollt und nutzt Preis-Ticks", stock.includes("TaPlotScroll") && stock.includes("narrowPriceTicks"));
check("Aktien-Oszillatoren haben den Höhen-Floor", stock.includes("minHeight: TA_OSC_MIN_PX"));
check("BTC-Chart scrollt, eine Preis-Tickliste, Oszillator-Floor",
  btc.includes("btc-ta-plot-scroll") && btc.includes("narrowPriceTicks") && btc.includes("minHeight: TA_OSC_MIN_PX"));
check("BTC blendet die zweite Makro-Achse aus", btc.includes("macroAxisHidden") && btc.includes('tick={macroAxisHidden("real10y") ? false'));
check("keine ReferenceDot-Kreise auf dem BTC-Kurs", !btc.includes("<ReferenceDot") && !btc.includes("TA_SIGNAL_DOT_R"));
check("Main darf unter den Inhalt schrumpfen, damit der Chart-Scroll greift",
  dash.includes('className="flex-1 min-w-0 overflow-y-auto') && btc.includes('className="flex-1 min-w-0 overflow-y-auto'));

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nta mobile scale ok");
