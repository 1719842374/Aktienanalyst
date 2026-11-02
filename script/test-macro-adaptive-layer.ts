/**
 * F9-08 Hyperscaler-CAPEX, F9-14 Europa-Ersatz, F9-18 Analyse-Knopf.
 * Ohne Score. Live-Netz nur wenn OFFLINE nicht gesetzt ist.
 *
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-macro-adaptive-layer.ts
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  computeHyperscalerCapex,
  printsFromFmpPayload,
  priorQuarterKey,
  unavailableHyperscalerCapex,
  type CapexPrint,
} from "../shared/hyperscaler-capex";
import {
  computeEqualWeightSpread,
  computeEuroAreaCapex,
  EUROPE_SURPRISE_REASON,
  parseEurostatGfcfCsv,
  surpriseSlot,
  type PricePoint,
} from "../shared/europe-macro-fallbacks";
import { assembleMacroAdaptiveLayer, MACRO_LAYER_SCORE_SWITCH } from "../shared/macro-adaptive-layer";
import { fetchHyperscalerCapex } from "../server/hyperscaler-capex";
import { fetchEuropeMacroFallbacks } from "../server/europe-macro-fallbacks";
import { getMacroAdaptiveLayer, resetMacroAdaptiveLayerCache } from "../server/macro-adaptive-layer-route";
import { MacroAdaptiveLayerBody, MacroAdaptiveLayerCard } from "../client/src/components/recession/MacroAdaptiveLayerCard";

(globalThis as { React?: typeof React }).React = React;

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const SYMBOLS = ["AMZN", "MSFT", "GOOGL", "META", "ORCL"] as const;

function quarterOf(index: number, startYear = 2010): string {
  const year = startYear + Math.floor(index / 4);
  return `${year}Q${(index % 4) + 1}`;
}

function quarterDate(quarter: string): string {
  const year = quarter.slice(0, 4);
  const q = Number(quarter.slice(5));
  const month = String(q * 3).padStart(2, "0");
  const day = q === 1 || q === 4 ? "31" : "30";
  return `${year}-${month}-${day}`;
}

function prints(untilIndex: number, valueAt: (symbol: string, index: number) => number | null, startYear = 2010): CapexPrint[] {
  const out: CapexPrint[] = [];
  for (let index = 0; index <= untilIndex; index += 1) {
    const quarter = quarterOf(index, startYear);
    for (const symbol of SYMBOLS) {
      const value = valueAt(symbol, index);
      if (value == null) continue;
      out.push({ symbol, date: quarterDate(quarter), capexUsd: value });
    }
  }
  return out;
}

function days(count: number, valueAt: (index: number) => number): PricePoint[] {
  const start = Date.parse("2010-01-01T00:00:00Z");
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(start + index * 86400000).toISOString().slice(0, 10),
    value: valueAt(index),
  }));
}

console.log("\nF9-08 Hyperscaler-CAPEX");
{
  check("Vorquartal 2026Q1 ist 2025Q1", priorQuarterKey("2026Q1") === "2025Q1");
  const last = 66;
  const flat = computeHyperscalerCapex(prints(last, () => 100));
  check("vollständige Menge, YoY 0", flat.aggregate.available && flat.aggregate.yoyPct === 0, JSON.stringify(flat.aggregate));
  check("Streuung 0 ist n/a, nicht z=0", !flat.distribution.available && flat.distribution.reason.includes("Streuung"));

  const bumped = computeHyperscalerCapex(prints(last, (_symbol, index) => (index === last ? 150 : 100)));
  check("letzter Stoß hebt die Summe", bumped.aggregate.available && Math.abs(bumped.aggregate.yoyPct - 50) < 1e-9, String(bumped.aggregate.available && bumped.aggregate.yoyPct));
  check("Verteilung über 15 Jahre", bumped.distribution.available && bumped.distribution.z > 0 && bumped.distribution.percentile === 100);

  const hole = computeHyperscalerCapex(prints(last, (symbol, index) => (symbol === "ORCL" && index === last ? null : 100)));
  check("unvollständiges Schlussquartal wird nicht die Summe", hole.aggregate.available && hole.aggregate.quarter !== quarterOf(last));
  check("Lücke nennt ORCL und füllt nicht auf", hole.aggregate.available && (hole.aggregate.incompleteReason ?? "").includes("ORCL") && (hole.aggregate.incompleteReason ?? "").includes("nicht aufgefüllt"));
  const orcl = hole.names.find(name => name.symbol === "ORCL");
  check("ORCL zeigt das eigene letzte Quartal", orcl?.quarter === quarterOf(last - 1) && orcl.yoyPct === 0);

  const parsed = printsFromFmpPayload("MSFT", [
    { date: "2025-06-30", capitalExpenditure: -80, reportedCurrency: "USD" },
    { date: "2025-09-30", capitalExpenditure: -40, reportedCurrency: "EUR" },
    { date: "2024-06-30", capitalExpenditure: -50, reportedCurrency: "USD" },
  ]);
  check("negative USD-CAPEX wird Ausgabe", parsed.prints.length === 2 && parsed.prints.every(print => print.capexUsd > 0));
  check("EUR wird nicht umgerechnet", !parsed.prints.some(print => print.date === "2025-09-30"));
  const foreign = printsFromFmpPayload("SAP", [{ date: "2025-12-31", capitalExpenditure: -10, reportedCurrency: "EUR" }]);
  check("nur Fremdwährung ist n/a", foreign.prints.length === 0 && (foreign.problem ?? "").includes("nicht in USD"));

  let calls = 0;
  const missingKey = await fetchHyperscalerCapex({
    hasKey: () => false,
    load: async () => {
      calls += 1;
      return [];
    },
  });
  check("ohne Schlüssel kein FMP-Aufruf", calls === 0 && !missingKey.aggregate.available && missingKey.aggregate.reason.includes("FMP_API_KEY"));
}

console.log("\nF9-14 Europa-Ersatz");
{
  const surprise = surpriseSlot();
  check("Surprise braucht Philip", surprise.needsPhilip && surprise.reason === EUROPE_SURPRISE_REASON && surprise.substitute === null);

  const count = 252 + 2520;
  const cap = days(count, index => (index === count - 1 ? 150 : 100));
  const equal = days(count, () => 100);
  const spread = computeEqualWeightSpread(cap, equal);
  check("Spanne ist Cap-RSL minus Equal-RSL", spread.spread.available && Math.abs(spread.spread.spread - 0.5) < 1e-9, String(spread.spread.available && spread.spread.spread));
  check("Spanne hat z und Perzentil", spread.distribution.available && spread.distribution.z > 0 && spread.distribution.percentile === 100);
  const short = computeEqualWeightSpread(days(10, () => 100), days(10, () => 100));
  check("zu kurzer RSL ist n/a", !short.spread.available && short.spread.reason.startsWith("n/a —"));

  const levels = Array.from({ length: 80 }, (_, index) => {
    const year = 2006 + Math.floor(index / 4);
    const quarter = `${year}Q${(index % 4) + 1}`;
    const value = index === 79 ? 180 : 100 * Math.pow(1.005, index);
    return { quarter, value };
  });
  const gfcf = computeEuroAreaCapex(levels);
  check("GFCF-YoY aus dem Index, nicht aus einer Wachstumszeile", gfcf.yoy.available && gfcf.yoy.quarter === "2025Q4" && gfcf.yoy.yoyPct > 0);
  check("GFCF-Verteilung", gfcf.distribution.available && gfcf.distribution.z > 0);
  check("Hinweis, dass es nicht Hyperscaler-CAPEX ist", gfcf.note.includes("nicht die CAPEX"));

  const csv = [
    "DATAFLOW,LAST UPDATE,freq,unit,s_adj,na_item,geo,TIME_PERIOD,OBS_VALUE,OBS_FLAG,CONF_STATUS",
    "ESTAT,30/10/26,Q,CLV_I10,SCA,P51G,EA20,2024-Q1,100,,",
    "ESTAT,30/10/26,Q,CLV_I10,SCA,P51G,EA20,2024-Q2,,",
    "ESTAT,30/10/26,Q,CLV_I10,SCA,P51G,EA20,2025-Q1,110,,",
  ].join("\n");
  const parsed = parseEurostatGfcfCsv(csv);
  check("leere Eurostat-Zelle fällt weg", parsed.levels.length === 2 && !parsed.levels.some(level => level.quarter === "2024Q2"));
  const gap = computeEuroAreaCapex(parsed.levels);
  check("2025Q1 gegen 2024Q1, die Lücke bleibt eine Lücke", gap.yoy.available && gap.yoy.quarter === "2025Q1" && Math.abs(gap.yoy.yoyPct - 10) < 1e-9);

  const offline = await fetchEuropeMacroFallbacks({
    now: new Date("2026-11-02T00:00:00Z"),
    yahoo: async symbol => (symbol === "EXSA.DE" ? [] : days(3, () => 1)),
    eurostat: async () => null,
  });
  check("leeres Yahoo ist n/a mit Grund", !offline.slots[1].spread.available && offline.slots[1].spread.reason.includes("EXSA.DE"));
  check("Eurostat nicht erreichbar ist n/a", !offline.slots[2].yoy.available && offline.slots[2].yoy.reason.includes("nicht erreichbar"));
  check("Surprise bleibt Philip, auch wenn der Rest fehlt", offline.slots[0].reason === EUROPE_SURPRISE_REASON);
}

console.log("\nF9-18 Knopf, Cache, Karte, Pins");
{
  check("Schalter ist aus", MACRO_LAYER_SCORE_SWITCH === "aus");
  const layer = assembleMacroAdaptiveLayer(
    unavailableHyperscalerCapex("n/a — Test"),
    { slots: [surpriseSlot(), computeEqualWeightSpread(days(3000, () => 100), days(3000, index => 100 + index)), computeEuroAreaCapex([{ quarter: "2024Q1", value: 100 }, { quarter: "2025Q1", value: 110 }])] },
    "2026-11-02T00:00:00.000Z",
  );
  check("Zusatzobjekt lässt die Live-P stehen", layer.liveScoreUnchanged === true && layer.scoreSwitch === "aus");

  resetMacroAdaptiveLayerCache();
  let loads = 0;
  const load = async () => {
    loads += 1;
    return layer;
  };
  const first = await getMacroAdaptiveLayer({ now: 1_000, ttlMs: 1_000, load });
  const second = await getMacroAdaptiveLayer({ now: 1_500, ttlMs: 1_000, load });
  check("Cache hält die Schicht", first === second && loads === 1, `loads=${loads}`);
  resetMacroAdaptiveLayerCache();

  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(MacroAdaptiveLayerCard, { number: 17 })));
  check("Knopf ist im Leerlauf da", html.includes("macro-layer-analyze") && html.includes("Schicht analysieren") && html.includes("n/a — noch nicht analysiert"));
  const body = renderToStaticMarkup(React.createElement(MacroAdaptiveLayerBody, { view: layer }));
  check("Karte nennt den ausgeschalteten Schalter", body.includes("Score-Schalter aus") && body.includes("macro-layer-surprise") && body.includes("braucht Philip"));

  const pin = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
  const rows: Array<[string, string, string]> = [
    ["VOW3 (VWAGY)", "4.735718", pin.VWAGY.overallScore],
    ["SAP", "5.174758", pin.SAP.overallScore],
    ["MSFT", "4.058138", pin.MSFT.overallScore],
  ];
  for (const [label, expect, actual] of rows) {
    const shown = Number(actual).toFixed(6);
    console.log(`  ${label} vorher ${expect} nachher ${shown}`);
    check(`${label} bleibt ${expect}`, shown === expect, shown);
  }
  const names = execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" }).split("\n");
  check("analyze-route.ts nicht im Diff", !names.includes("server/analyze-route.ts"));
  check("Gold und geo-map nicht im Diff", !names.some(name => name.includes("geo-map") || name.includes("gold-adaptive") || name.startsWith("client/src/components/gold/")));
}

if (process.env.OFFLINE === "1") {
  console.log("\nLive übersprungen (OFFLINE=1)");
} else {
  console.log("\nLive Yahoo und Eurostat, FMP nur wenn der Schlüssel da ist");
  const live = await fetchEuropeMacroFallbacks({ now: new Date("2026-11-02T00:00:00.000Z") });
  const equal = live.slots[1];
  const gfcf = live.slots[2];
  console.log(`  Equal-Weight: ${equal.spread.available ? `${equal.spread.date} Spanne ${equal.spread.spread.toFixed(4)}` : equal.spread.reason}`);
  console.log(`  GFCF: ${gfcf.yoy.available ? `${gfcf.yoy.quarter} YoY ${gfcf.yoy.yoyPct.toFixed(2)} %` : gfcf.yoy.reason}`);
  check("Equal-Weight ist Zahl oder n/a mit Grund", equal.spread.available ? Number.isFinite(equal.spread.spread) : equal.spread.reason.startsWith("n/a —"));
  check("GFCF ist Zahl oder n/a mit Grund", gfcf.yoy.available ? Number.isFinite(gfcf.yoy.yoyPct) : gfcf.yoy.reason.startsWith("n/a —"));
  check("Surprise bleibt n/a", live.slots[0].reason.startsWith("n/a —") && live.slots[0].needsPhilip);
  const capex = await fetchHyperscalerCapex();
  console.log(`  Hyperscaler: ${capex.aggregate.available ? `${capex.aggregate.quarter} YoY ${capex.aggregate.yoyPct.toFixed(2)} %` : capex.aggregate.reason}`);
  check("Hyperscaler ist Zahl oder n/a mit Grund", capex.aggregate.available ? Number.isFinite(capex.aggregate.yoyPct) : capex.aggregate.reason.startsWith("n/a —"));
}

console.log(`\n${failed === 0 ? "alle Checks grün" : `${failed} Checks rot`}`);
process.exit(failed ? 1 : 0);
