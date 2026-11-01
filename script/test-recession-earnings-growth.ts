/**
 * Gewinnwachstum und Growth Gap: Formeln, n/a statt 0, Schwellen aus der Reihe.
 * Ausführen: npx tsx script/test-recession-earnings-growth.ts
 */
import { readFileSync } from "fs";
import { TA_NARROW_MAX_PX } from "../client/src/lib/taChartScale";
import {
  EARNINGS_GROWTH_PARAMS,
  assembleEarningsGrowth,
  forwardGrowthPct,
  gapWarning,
  impliedGStarPct,
  volShock,
  yearEndCloses,
  yoyFromAnnualEps,
} from "../shared/recession-earnings-growth";
import { REST_OVERLAY_PARAMS } from "../shared/recession-rest-overlays";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n=== YoY, Vorjahr 0 ist kein Wachstum 0 ===");
const yoy = yoyFromAnnualEps([
  { date: "2020-12-31", eps: 0 },
  { date: "2021-12-31", eps: 10 },
  { date: "2022-12-31", eps: 11 },
]);
check("2021 ausgelassen, Grund nennt 0", yoy.skipped.some(s => s.date === "2021-12-31" && s.reason.includes("0")));
check("2022 = 10 %", yoy.points.length === 1 && Math.abs(yoy.points[0].yoyPct - 10) < 1e-9, String(yoy.points[0]?.yoyPct));
check("kein Punkt mit Wert 0", yoy.points.every(p => p.yoyPct !== 0));

console.log("\n=== Forward und g* ===");
const fwd = forwardGrowthPct(11, 10);
check("11/10 − 1 = 10 %", fwd.value != null && Math.abs(fwd.value - 10) < 1e-9, String(fwd.value));
const fwdZero = forwardGrowthPct(11, 0);
check("TTM 0 → n/a, Wert null", fwdZero.value === null && fwdZero.reason.includes("0"));
const fwdNeg = forwardGrowthPct(11, -2);
check("TTM negativ → n/a", fwdNeg.value === null);
const gMissing = impliedGStarPct(null, 30, 1000);
check("ohne WACC g* n/a, nicht 0", gMissing.value === null && gMissing.reason.includes("WACC"));
const g = impliedGStarPct(8, 30, 1000);
check("g* = 8 − 3 = 5", g.value === 5, String(g.value));

console.log("\n=== Median, Trend, Gap, Warnung aus der Reihe ===");
const annual = [100, 110, 121, 133.1, 146.41, 161.051, 177.1561].map((eps, i) => ({
  date: `${2018 + i}-12-31`,
  eps,
}));
const built = assembleEarningsGrowth({
  region: "US",
  earningsSymbol: "^GSPC",
  bars: annual.map(a => ({ date: a.date, close: 1000 + a.eps })),
  annualEps: annual,
  forward: { value: 40, reason: null },
  gStar: { value: null, reason: "g*: Index-WACC liegt in keiner angebundenen Quelle (kein angenommener Satz)" },
  fcfToEvPct: { value: null, reason: "FCF/EV: Enterprise Value fehlt" },
  notes: [],
});
check("sechs YoY-Raten", built.historical.length === 6, String(built.historical.length));
check("letzte realisierte Rate 10 %", built.latestRealized.value != null && Math.abs(built.latestRealized.value - 10) < 0.05, String(built.latestRealized.value));
check("Median liegt auf den Raten, nicht auf 0", built.realisticMedian.value != null && built.realisticMedian.value > 9, String(built.realisticMedian.value));
check("Growth Gap = 40 − realisiert", built.growthGap.value != null && built.latestRealized.value != null && Math.abs(built.growthGap.value - (40 - built.latestRealized.value)) < 1e-9);
check("Implied Gap n/a weil g* n/a", built.impliedGap.value === null && (built.impliedGap.reason ?? "").includes("WACC"));
check("Warnung aktiv, weil 30 Pp über dem Perzentil der eigenen Abweichungen liegt", built.warning.active, built.warning.reason);
const calm = gapWarning({ value: 0, reason: null }, built.historical, "2024-12-31");
check("Gap auf dem Median warnt nicht", calm.active === false, calm.reason);

console.log("\n=== Kurs je Jahr, Vol-Schock ohne festen Punktwert ===");
const closes = yearEndCloses([
  { date: "2024-01-02", close: 10 },
  { date: "2024-06-01", close: 12 },
  { date: "2025-01-03", close: 9 },
]);
check("je Kalenderjahr der letzte Kurs", closes.map(c => c.close).join(",") === "12,9");
const flat = volShock([{ date: "2024-01-01", value: 10 }, { date: "2024-01-02", value: 10 }]);
check("Vol ohne Streuung → nicht aktiv, mit Grund", flat.active === false && flat.reason.includes("n/a"));
const spike = Array.from({ length: 20 }, (_, i) => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, value: i === 19 ? 80 : 15 }));
const shock = volShock(spike);
check(`Spitze liegt auf oder über P${REST_OVERLAY_PARAMS.bandHighPercentile}`, shock.active, shock.reason);

console.log("\n=== Parameter, Route, Score-Pin, kein analyze-route ===");
check("Medianfenster ist das ISRATIO-Fenster", EARNINGS_GROWTH_PARAMS.medianWindowYears === 10);
check("5Y-Trend folgt WINDOW_MONTHS 5Y", EARNINGS_GROWTH_PARAMS.trendYears === 5);
const route = readFileSync("server/recession-earnings-growth-route.ts", "utf8");
check("Route hängt an /api/analyze-recession/earnings-growth", route.includes('"/api/analyze-recession/earnings-growth"'));
check("Route zieht die Analyse-Route nicht ein", !/from ["']\.\/analyze-route["']|from ["']\.\.\/analyze-route["']/.test(route));
const routes = readFileSync("server/routes.ts", "utf8");
check("routes.ts registriert die Route", routes.includes("registerEarningsGrowthRoute"));
const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
const round6 = (n: number) => n.toFixed(6);
check("VOW3 4.735718", round6(pin.VWAGY.overallScore) === "4.735718", String(pin.VWAGY.overallScore));
check("SAP 5.174758", round6(pin.SAP.overallScore) === "5.174758", String(pin.SAP.overallScore));
check("MSFT 4.058138", round6(pin.MSFT.overallScore) === "4.058138", String(pin.MSFT.overallScore));

console.log("\n=== Layout 375 / 1440 ===");
check("375 stapelt", 375 <= TA_NARROW_MAX_PX);
check("1440 steht in einer Zeile", 1440 > TA_NARROW_MAX_PX);
const panel = readFileSync("client/src/components/recession/RecessionGrowthPanel.tsx", "utf8");
check("Layout-Funktion nutzt denselben Breakpoint", panel.includes("viewportPx <= TA_NARROW_MAX_PX"));
check("Grid ist eine Spalte und ab sm zwei", panel.includes("grid-cols-1") && panel.includes("sm:grid-cols-2"));
check("Plot scrollt statt zu quetschen", panel.includes("TaPlotScroll") && panel.includes("TA_PLOT_MIN_PX"));
const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
check("Aktien-Dashboard mountet BuffettMacroCard nicht", !dash.includes("BuffettMacroCard"));

console.log(`\n${failed === 0 ? "ALLE GRÜN" : failed + " FEHLGESCHLAGEN"}`);
process.exit(failed ? 1 : 0);
