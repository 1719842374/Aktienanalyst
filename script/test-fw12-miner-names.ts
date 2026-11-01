/**
 * FW-12 — Namen von Hash-Ribbon und Miner-Zone. Formeln unangetastet.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-fw12-miner-names.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describeMinerMeasures } from "../shared/miner-measure-names";
import { classifyMinerZone } from "../server/btc-miner";
import { MinerMeasureNote } from "../client/src/components/sections/Section13Miner";

(globalThis as any).React = React;

let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  n++;
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};

const ribbonOnly = describeMinerMeasures({ inCapitulation: true, crossoverSignal: false, minerZone: "profitable" });
check("MA30 unter MA60 heißt Hash-Ribbon, nicht Miner-Zone", ribbonOnly.hashRibbonValue.includes("nur MA30 unter MA60") && ribbonOnly.minerZoneValue === "Profitabel");
check("Auseinanderfallen wird benannt", ribbonOnly.diverge && ribbonOnly.note.includes("Formeln unverändert"));

const missing = describeMinerMeasures({ inCapitulation: null, crossoverSignal: null, minerZone: null });
check("fehlende Maße sind n/a mit Grund", missing.hashRibbonValue.startsWith("n/a —") && missing.minerZoneValue.startsWith("n/a —") && !missing.diverge);

const aligned = describeMinerMeasures({ inCapitulation: true, crossoverSignal: false, minerZone: "capitulation" });
check("gleiche Richtung fällt nicht auseinander", !aligned.diverge);

const zone = classifyMinerZone({
  spotPrice: 100_000,
  breakeven: 40_000,
  puell: 1.2,
  hashRibbonSignal: "capitulation",
  difficultyCompression: "neutral",
  mpiZone: "neutral",
});
check("Formel unverändert: Ribbon-Kapitulation bei hohem Spot bleibt keine Miner-Kapitulation", zone.zone !== "capitulation", `${zone.zone} ${zone.score}`);
const html = renderToStaticMarkup(React.createElement(MinerMeasureNote, {
  inCapitulation: true,
  crossoverSignal: false,
  minerZone: zone.zone,
}));
check("Karte zeigt beide Namen und bricht um (flex-wrap)", html.includes("Hash-Ribbon (inCapitulation)") && html.includes("Miner-Zone (minerZone.zone)") && html.includes("flex-wrap") && html.includes("Formeln unverändert"));
check("Anzeige erfindet keine 0", !html.includes(">0<"));

const pin = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
check("VOW3 (VWAGY) 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718");
check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758");
check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");

console.log("\nFrage an Philip (Formel nicht geändert):");
console.log("| Lage | Hash-Ribbon inCapitulation | minerZone.zone | minerZone.score |");
console.log(`| MA30<MA60, Spot 100k, Breakeven 40k, Puell 1,2 | true | ${zone.zone} | ${zone.score} |`);
const stressed = classifyMinerZone({
  spotPrice: 30_000,
  breakeven: 50_000,
  puell: 0.4,
  hashRibbonSignal: "neutral",
  difficultyCompression: "compressed",
  mpiZone: "neutral",
});
console.log(`| MA30 nicht darunter, Spot unter Breakeven, Puell 0,4 | false | ${stressed.zone} | ${stressed.score} |`);

console.log(`\n${n - fail}/${n} Checks grün`);
process.exit(fail ? 1 : 0);
