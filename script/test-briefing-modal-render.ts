/**
 * Renders BriefingModal: v1 and v2 both as Key-Event cards (Macro Impuls layout).
 * Run: npx tsx script/test-briefing-modal-render.ts
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as esbuild from "esbuild";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";

const outfile = path.join(os.tmpdir(), "researcher-briefing-modal.mjs");
await esbuild.build({
  absWorkingDir: path.resolve("."),
  entryPoints: ["client/src/pages/Researcher.tsx"],
  bundle: true,
  format: "esm",
  platform: "node",
  loader: { ".css": "empty" },
  jsx: "automatic",
  outfile,
  logLevel: "silent",
});

const { BriefingModal } = await import(pathToFileURL(outfile).href);
const noop = () => {};
const v1 = renderToStaticMarkup(createElement(BriefingModal, {
  loading: false,
  error: null,
  onClose: noop,
  onRetry: noop,
  onForceRefresh: noop,
  data: {
    briefing: {
      headline: "Alt",
      summary: "ein Block",
      topChanges: [{ rank: 1, title: "Fed", description: "alt", region: "US" }],
      keyMetricsShift: { inflationView: "stabil", rateView: "stabil", equityView: "neutral" },
      recommendation: "Beobachten",
    },
  },
}));
const v2 = renderToStaticMarkup(createElement(BriefingModal, {
  loading: false,
  error: null,
  onClose: noop,
  onRetry: noop,
  onForceRefresh: noop,
  data: {
    headline: "Cross US EU ASIA",
    cross: ["US→EZ: US USTR | EU n/v", "US→Asia: n/v", "EZ→Asia: n/v"],
    tacticalStance: "Vorsichtig",
    stanceRationale: "US Neutral, EU Vorsichtig, ASIA Neutral",
    regions: [
      { region: "US", stance: "Neutral", money: "Fed", fiscal: "QRA", trade: "USTR", li: 62, realRatePct: 1.8, velocity: 1.41, pricedIn: 0.2 },
      { region: "EU", stance: "Vorsichtig", money: "Index n/v", fiscal: "n/v", trade: "n/v", li: null, realRatePct: null, velocity: null, pricedIn: null },
      { region: "ASIA", stance: "Neutral", money: "Index n/v", fiscal: "n/v", trade: "n/v", li: null, realRatePct: null, velocity: null, pricedIn: null },
    ],
    briefing: {
      headline: "Cross US EU ASIA",
      summary: "should-not-show-as-v1-summary",
      topChanges: [{
        rank: 1,
        title: "OBBBA verabschiedet",
        region: "US",
        category: "Fiskalpolitik",
        timeframe: "2025-Q3",
        description: "Capex-Anreize für Manufacturing.",
        inflationImpact: "steigend",
        rateImpact: "steigend",
        equityImpact: "positiv",
        rationale: "Fiskale Expansion treibt Demand.",
        affectedSectors: ["Technology", "Defense"],
      }],
      recommendation: "v1-only",
    },
  },
}));

const checks: Record<string, boolean> = {
  v1Headline: v1.includes("Alt") && v1.includes("ein Block"),
  v1NoColumns: !v1.includes('data-testid="briefing-regions"'),
  v1Action: v1.includes("Beobachten"),
  v1Card: v1.includes('data-testid="briefing-event-card"') && v1.includes("Fed"),
  v1ImpactRow: v1.includes("Inflation") && v1.includes("Zinsen") && v1.includes("Aktien"),
  v1NoBars: !v1.includes(">Headline<") && !v1.includes(">Cross<") && !v1.includes(">Top Changes<"),
  v2NoColumns: !v2.includes('data-testid="briefing-regions"') && !v2.includes('data-testid="briefing-cross"'),
  v2Cards: v2.includes('data-testid="briefing-events"') && v2.includes("OBBBA verabschiedet"),
  v2Category: v2.includes("Fiskalpolitik") && v2.includes("2025-Q3"),
  v2ImpactRow: v2.includes("Inflation") && v2.includes("steigend") && v2.includes("Zinsen") && v2.includes("Aktien"),
  v2Rationale: v2.includes("Fiskale Expansion treibt Demand."),
  v2Sectors: v2.includes("Technology") && v2.includes("Defense"),
  v2NoV1Summary: !v2.includes("should-not-show-as-v1-summary") && !v2.includes("v1-only"),
  v2Stance: v2.includes("Vorsichtig"),
  v2NoBars: !v2.includes(">Headline<") && !v2.includes(">Cross<") && !v2.includes(">Top Changes<") && !v2.includes(">Tactical Stance<"),
};
let failed = 0;
for (const [name, ok] of Object.entries(checks)) {
  if (ok) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}
if (failed) {
  console.log(v2.slice(0, 1800));
  process.exit(1);
}
console.log("modal render passed");
