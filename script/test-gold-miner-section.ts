/**
 * Sektion 9 rendert Offline und die Karten aus aiscZone.latest.
 * Ausführen: npx tsx script/test-gold-miner-section.ts
 */
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";
import { buildGoldMinerZone } from "../shared/gold-miner-zone";
import type { GoldAiscSeries } from "../shared/schema";

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
const html = render({ ...mod.GOLD_FALLBACK_DATA, aiscZone: zone });
check("Badge Profitabel", html.includes('data-testid="gold-miner-zone-badge"') && html.includes("Profitabel"));
check("Karte Multiple 2.00×", html.includes('data-testid="gold-miner-card-multiple"') && html.includes("2.00×"));
check("Karte AISC $1,000", html.includes('data-testid="gold-miner-card-aisc"') && html.includes("$1,000"));
check("drei Charts", ["gold-miner-chart-spot", "gold-miner-chart-multiple", "gold-miner-chart-margin"].every(id => html.includes(`data-testid="${id}"`)));
check("Zeitraum-Buttons wie der Aktien-TA-Chart", ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y", "Max"].every(r => html.includes(`data-testid="button-gold-miner-range-${r}"`)));
check("Von/Bis", html.includes('data-testid="input-gold-miner-from"') && html.includes('data-testid="input-gold-miner-to"') && html.includes(">Von<") && html.includes(">Bis<"));
check("Formel am Wert", html.includes("Keine Interpolation"));
check("kein Overlay-Faktor 1,15 in der Sektion", !html.includes("1,15") && !html.includes("×1.15"));

console.log(failed === 0 ? "\nSektion 9 grün." : `\n${failed} Test(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
