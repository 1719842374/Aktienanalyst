/**
 * Realzins-Adjustierung: β und Median aus der Reihe, n/a statt 0.
 * Ausführen: npx tsx script/test-buffett-realzins.ts
 */
import { readFileSync } from "fs";
import { adjustBuffettForRealYield, realHoldDays } from "../shared/buffett-realzins";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n=== β ist die Steigung der Reihe ===");
const reals = [0, 1, 2, 3, 4];
const ratios = reals.map(real => 200 * (1 + (-0.1) * (real - 2)));
const dates = reals.map((_, i) => `2020-01-0${i + 1}`);
const model = adjustBuffettForRealYield(
  dates.map((date, i) => ({ date, ratio: ratios[i] })),
  dates.map((date, i) => ({ date, value: reals[i] })),
);
check("Median Realzins 2", model.realMedian.value === 2, String(model.realMedian.value));
check("β = −0,1 aus der konstruierten Reihe", model.beta.value != null && Math.abs(model.beta.value - (-0.1)) < 1e-9, String(model.beta.value));
const last = model.points[model.points.length - 1];
check("letzter Rohwert 160", last?.raw === 160, String(last?.raw));
check("Adjustierung 160 × (1 − 0,1 × 2) = 128", last?.adj != null && Math.abs(last.adj - 128) < 1e-6, String(last?.adj));
check("z und Perzentil sind Zahlen", model.z.value != null && model.percentile.value != null);

console.log("\n=== fehlende Quelle und Faktor ≤ 0 ===");
const noReal = adjustBuffettForRealYield([{ date: "2020-01-01", ratio: 200 }], []);
check("ohne DFII10 bleibt raw und adj leer", noReal.latestAdj.value === null && noReal.latestRaw.value === null && noReal.reason != null);
check("Grund nennt DFII10", (noReal.reason ?? "").includes("DFII10"));
const exploded = adjustBuffettForRealYield(
  [
    { date: "2020-01-01", ratio: 300 },
    { date: "2020-01-02", ratio: 100 },
    { date: "2020-01-03", ratio: -100 },
  ],
  [
    { date: "2020-01-01", value: -1 },
    { date: "2020-01-02", value: 0 },
    { date: "2020-01-03", value: 1 },
  ],
);
check("ein Punkt mit Faktor ≤ 0 bleibt null und nennt den Grund", exploded.points.some(p => p.adj == null && (p.reason ?? "").includes("Faktor")));

console.log("\n=== Haltedauer aus den Abständen, Quelltext ohne angenommene −0,10 / 1,5 ===");
check("tägliche Abstände von 1 halten einen Tag", realHoldDays(["2020-01-01", "2020-01-02", "2020-01-03"]) === 1);
const src = readFileSync("shared/buffett-realzins.ts", "utf8");
const body = src.split("export function adjustBuffettForRealYield")[1] ?? "";
check("Rechenfunktion ohne −0.10 und ohne 1.5", !body.includes("-0.10") && !body.includes("-0.1") && !body.includes("1.5"));
const card = readFileSync("client/src/components/recession/BuffettRealzinsCard.tsx", "utf8");
check("Karte nutzt die bestehenden Routen", card.includes("/api/analyze-recession/buffett?region=US") && card.includes("/api/analyze-btc/real10y-history"));
const panel = readFileSync("client/src/components/recession/BuffettRatioPanel.tsx", "utf8");
check("BuffettRatioPanel unverändert gegenüber diesem Test: Datei existiert weiter", panel.includes("function") || panel.includes("export"));
const dash = readFileSync("client/src/pages/RecessionDashboard.tsx", "utf8");
check("Karte sitzt im Rezessions-Dashboard, Panel bleibt", dash.includes("<BuffettRealzinsCard />") && dash.includes("<BuffettRatioPanel />"));
const stock = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
check("Aktienanalyse ohne Buffett-Karte", !stock.includes("BuffettMacroCard") && !stock.includes("BuffettRealzinsCard"));

console.log(`\n${failed === 0 ? "ALLE GRÜN" : failed + " FEHLGESCHLAGEN"}`);
process.exit(failed ? 1 : 0);
