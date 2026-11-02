/**
 * Sektion 9 rendert Offline und die Karten aus aiscZone.latest.
 * Ausführen: npx tsx script/test-gold-miner-section.ts
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";
import { buildGoldAiscSeries, type GoldAiscFile } from "../shared/gold-aisc";
import { buildGoldMinerZone } from "../shared/gold-miner-zone";
import type { GoldAiscSeries } from "../shared/schema";
import { TIME_RANGE_CUTOFF, slicePresetWindow } from "../client/src/lib/taRangeCutoff";

const root = process.cwd();
const outfile = path.join(os.tmpdir(), `gold-miner-section-${process.pid}.cjs`);
await esbuild.build({
  absWorkingDir: root,
  stdin: {
    contents: `export { GoldMinerBreakevenSection } from "./client/src/components/gold/GoldMinerBreakevenSection";
export { GOLD_FALLBACK_DATA } from "./client/src/lib/goldFallbackData";
export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
export { createElement } from "react";
export { renderToStaticMarkup } from "react-dom/server";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "empty" },
  alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
  outfile,
  logLevel: "silent",
});

const mod = createRequire(import.meta.url)(outfile);
const render = (data: any) => mod.renderToStaticMarkup(
  mod.createElement(mod.QueryClientProvider, { client: new mod.QueryClient() }, mod.createElement(mod.GoldMinerBreakevenSection, { data })),
);

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const offline = render(mod.GOLD_FALLBACK_DATA);
check("Fallback ohne aiscZone", mod.GOLD_FALLBACK_DATA.aiscZone === undefined);
check("Offline-Zeile", offline.includes('data-testid="gold-miner-offline"') && offline.includes("Offline-Daten"));
check("Offline ohne Zonen-Badge", !offline.includes('data-testid="gold-miner-zone-badge"'));

function series(aisc: number): GoldAiscSeries {
  const value = (company: "NEM" | "B" | "AEM") => ({
    company, quarter: "2024-Q1", aisc, sourceUrl: "https://example.com/a", sourceTitle: "t", sourceDate: "2024-06-01",
  });
  return {
    unit: "USD/oz", basis: "by-product", method: "mean", minCompanies: 2, lagDays: 60,
    stressLow: 1.1, stressHigh: 1.15,
    companies: {
      NEM: { name: "Newmont", ticker: "NEM", metric: "AISC" },
      B: { name: "Barrick", ticker: "B", metric: "AISC" },
      AEM: { name: "Agnico Eagle", ticker: "AEM", metric: "AISC" },
    },
    quarters: [{
      quarter: "2024-Q1", periodEnd: "2024-03-31", availableFrom: "2024-01-02", aisc, count: 3,
      values: [value("NEM"), value("B"), value("AEM")],
    }],
    gaps: [], retrievedAt: "2026-10-18", source: "server/data/gold-aisc.json", inScore: false,
  };
}

const dates: string[] = [];
let t = Date.parse("2024-01-02T00:00:00Z");
while (dates.length < 180) {
  const d = new Date(t);
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(d.toISOString().slice(0, 10));
  t += 86400000;
}
const zone = buildGoldMinerZone(dates.map(date => ({ date, close: 2000 })), series(1000));
const html = render({ ...mod.GOLD_FALLBACK_DATA, aiscZone: zone, aiscZoneSpotSource: "Yahoo GC=F (Futures)" });
check("Badge Profitabel", html.includes('data-testid="gold-miner-zone-badge"') && html.includes("Profitabel"));
check("Karte Multiple 2.00×", html.includes('data-testid="gold-miner-card-multiple"') && html.includes("2.00×"));
check("Karte AISC $1,000", html.includes('data-testid="gold-miner-card-aisc"') && html.includes("$1,000"));
check("drei Charts", ["gold-miner-chart-spot", "gold-miner-chart-multiple", "gold-miner-chart-margin"].every(id => html.includes(`data-testid="${id}"`)));
check("Zeitraum-Buttons wie der Aktien-TA-Chart", ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y", "Max"].every(r => html.includes(`data-testid="button-gold-miner-range-${r}"`)));
check("Von/Bis", html.includes('data-testid="input-gold-miner-from"') && html.includes('data-testid="input-gold-miner-to"') && html.includes(">Von<") && html.includes(">Bis<"));
check("Formel am Wert", html.includes("Keine Interpolation"));
check("Historie seit kommt aus thresholds.since", !!zone?.thresholds.since && html.includes(`Historie seit ${zone.thresholds.since}`) && html.includes('data-testid="gold-miner-history-since"'));
check("Spot-Quelle an Untertitel, Multiple und Marge", (html.match(/Yahoo GC=F \(Futures\)/g) ?? []).length >= 3, String((html.match(/Yahoo GC=F \(Futures\)/g) ?? []).length));
check("kein Overlay-Faktor 1,15 in der Sektion", !html.includes("1,15") && !html.includes("×1.15"));

const bars = Array.from({ length: 400 }, (_, i) => i);
check("3M = letzte 63 Handelstage, dieselbe Zahl wie TechnicalChart", slicePresetWindow(bars, "3M").length === TIME_RANGE_CUTOFF["3M"] && slicePresetWindow(bars, "3M")[0] === 400 - 63);
check("1Y = letzte 252, 10Y = letzte 2520 wenn die Serie reicht", slicePresetWindow(bars, "1Y").length === 252 && slicePresetWindow(Array.from({ length: 3000 }, (_, i) => i), "10Y").length === 2520);
check("Max = ganze Reihe", slicePresetWindow(bars, "Max").length === bars.length);
const sectionSrc = readFileSync(path.join(root, "client/src/components/gold/GoldMinerBreakevenSection.tsx"), "utf8");
const chartSrc = readFileSync(path.join(root, "client/src/components/sections/TechnicalChart.tsx"), "utf8");
check("Sektion schneidet mit slicePresetWindow, nicht mit Kalendertagen", sectionSrc.includes("slicePresetWindow(points, range)") && !/3653|RANGE_DAYS/.test(sectionSrc));
check("TechnicalChart nutzt denselben Helper, die Zahlen stehen nur in taRangeCutoff", chartSrc.includes('from "@/lib/taRangeCutoff"') && chartSrc.includes("slicePresetWindow(ohlcv, timeRange)") && !/"3M": 63/.test(chartSrc));
check("Band-Spanne steht neben dem Chart", html.includes('data-testid="gold-miner-band-span"') && html.includes("Bänder "));
{
  const at = html.indexOf('data-testid="gold-miner-history-since"');
  const heading = html.slice(at, at + 700);
  check("Multiple-Untertitel: kurze P20/P50, ohne pLowRank in der Zeile", heading.includes("P20 ") && heading.includes("P50 ") && !heading.includes("pLowRank="));
}
check("öffnet auf Max, die volle Reihe", html.includes('data-testid="button-gold-miner-range-Max"') && sectionSrc.includes('useState<TimeRange>("Max")'));

const aiscFile = JSON.parse(readFileSync(path.join(root, "server/data/gold-aisc.json"), "utf8")) as GoldAiscFile;
const aiscSeries = buildGoldAiscSeries(aiscFile);
const spotFx = JSON.parse(readFileSync(path.join(root, "script/fixtures/gold-spot-gc-f-2016-2026.json"), "utf8")) as { points: { date: string; close: number }[] };
const realZone = buildGoldMinerZone(spotFx.points, aiscSeries);
const realHtml = render({ ...mod.GOLD_FALLBACK_DATA, aiscZone: realZone, aiscLine: aiscSeries, aiscZoneSpotSource: "Yahoo GC=F (Futures)" });
check("echte Historie: seit 2016 im Untertitel", !!realZone?.thresholds.since && realHtml.includes(`Historie seit ${realZone.thresholds.since}`) && realZone.thresholds.since < "2017-01-01", realZone?.thresholds.since ?? "");
check("echte Historie: Bänder beginnen vor 2018", realHtml.includes('data-testid="gold-miner-band-span"') && /Bänder 201[67]-/.test(realHtml));
check("Barrick-Lücken sind sichtbar und als nicht interpoliert gekennzeichnet", realHtml.includes('data-testid="gold-miner-company-gaps"') && realHtml.includes("B 2016-Q4") && realHtml.includes("nicht interpoliert"));
check("Score-Karte zeigt den vollen Rang, nicht die 667-Tage-Stichprobe", realHtml.includes('data-testid="gold-miner-card-score"') && realHtml.includes(`${Math.round(realZone!.latest!.score)}/100`) && (realZone?.thresholds.obs ?? 0) > 2000);

console.log(failed === 0 ? "\nSektion 9 grün." : `\n${failed} Test(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
