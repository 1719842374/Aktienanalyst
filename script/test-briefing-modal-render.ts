/**
 * Renders BriefingModal: v1 when regions are missing, v2 as three columns plus cross.
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
    tacticalStance: "Neutral",
    stanceRationale: "US Neutral, EU Neutral, ASIA Neutral",
    regions: [
      { region: "US", stance: "Neutral", money: "Fed", fiscal: "QRA", trade: "USTR", li: 62, realRatePct: 1.8, velocity: 1.41, pricedIn: 0.2 },
      { region: "EU", stance: "Vorsichtig", money: "Index n/v", fiscal: "n/v", trade: "n/v", li: null, realRatePct: null, velocity: null, pricedIn: null },
      { region: "ASIA", stance: "Neutral", money: "Index n/v", fiscal: "n/v", trade: "n/v", li: null, realRatePct: null, velocity: null, pricedIn: null },
    ],
    briefing: {
      headline: "Cross US EU ASIA",
      summary: "should-not-show-as-v1-summary",
      topChanges: [{ rank: 1, title: "none", region: "ASIA", description: "none" }],
      recommendation: "v1-only",
    },
  },
}));

const checks: Record<string, boolean> = {
  v1Headline: v1.includes("Alt") && v1.includes("ein Block"),
  v1NoColumns: !v1.includes('data-testid="briefing-regions"'),
  v1Action: v1.includes("Beobachten"),
  v2Cols: ["US", "EU", "ASIA"].every((r) => v2.includes(`data-testid="briefing-region-${r}"`)),
  v2Cross: v2.includes("US→EZ") && v2.includes("US→Asia") && v2.includes("EZ→Asia"),
  v2Numbers: v2.includes("LI 62") && v2.includes("LI n/v"),
  v2NoV1Summary: !v2.includes("should-not-show-as-v1-summary") && !v2.includes("v1-only"),
  v2Stance: v2.includes("Vorsichtig"),
  v2EmptyTrade: v2.includes("n/v"),
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
