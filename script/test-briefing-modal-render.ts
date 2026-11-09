/**
 * Renders BriefingModal against the Country Macro Pulse KeyEventCard.
 * Run: npx tsx script/test-briefing-modal-render.ts
 *
 * RED on main: the modal is still the dense Cross / region / Top Changes layout
 * and does not render KeyEventCard. GREEN when the briefing reuses that card
 * and missing impacts stay n/a with a reason.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";

const root = path.resolve(".");
const outfile = path.join(os.tmpdir(), "researcher-briefing-modal.mjs");
const macroOut = path.join(os.tmpdir(), "researcher-macro-panel.mjs");
const alias = {
  "@": path.join(root, "client/src"),
  "@shared": path.join(root, "shared"),
};
await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["client/src/pages/Researcher.tsx"],
  bundle: true,
  format: "esm",
  platform: "node",
  loader: { ".css": "empty" },
  jsx: "automatic",
  outfile,
  alias,
  logLevel: "silent",
});
await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["client/src/components/researcher/MacroPanel.tsx"],
  bundle: true,
  format: "esm",
  platform: "node",
  loader: { ".css": "empty" },
  jsx: "automatic",
  outfile: macroOut,
  alias,
  logLevel: "silent",
});

const { BriefingModal } = await import(pathToFileURL(outfile).href);
const macroMod = await import(pathToFileURL(macroOut).href);
const mapperMod = await import("../shared/briefing-key-event.ts").catch(() => null);
const toBriefingKeyEvent = mapperMod?.toBriefingKeyEvent as
  | ((change: Record<string, unknown>) => Record<string, unknown>)
  | undefined;
const KeyEventCard = macroMod.KeyEventCard as ((props: { ev: Record<string, unknown> }) => unknown) | undefined;

const noop = () => {};
const v1Change = { rank: 1, title: "Fed", description: "alt", region: "US" };
const v2Change = {
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
};
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
      topChanges: [v1Change],
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
      topChanges: [v2Change],
      recommendation: "v1-only",
    },
  },
}));

const researcherSrc = readFileSync("client/src/pages/Researcher.tsx", "utf8");
const macroSrc = readFileSync("client/src/components/researcher/MacroPanel.tsx", "utf8");
const serverSrc = readFileSync("server/researcher.ts", "utf8");
const mappedV2 = typeof toBriefingKeyEvent === "function" ? toBriefingKeyEvent(v2Change) : null;
const cardHtml = mappedV2 && typeof KeyEventCard === "function"
  ? renderToStaticMarkup(createElement(KeyEventCard, { ev: mappedV2 }))
  : "";
const missing = typeof toBriefingKeyEvent === "function"
  ? toBriefingKeyEvent({ title: "Fed", description: "alt" })
  : null;
const keptNeutral = typeof toBriefingKeyEvent === "function"
  ? toBriefingKeyEvent({ title: "Fed", inflationImpact: "neutral", affectedSectors: ["Energy"] })
  : null;

const checks: Record<string, boolean> = {
  v1Headline: v1.includes("Alt") && v1.includes("ein Block"),
  v1NoColumns: !v1.includes('data-testid="briefing-regions"'),
  v1Action: v1.includes("Beobachten"),
  v1Hero: v1.includes('data-testid="briefing-hero"') && v1.includes("Macro Synthesis"),
  v1Card: v1.includes('data-testid="briefing-event-card"') && v1.includes("Fed") && v1.includes("alt"),
  v1ImpactRow: v1.includes("Inflation") && v1.includes("Zinsen") && v1.includes("Aktien"),
  v1MissingIsNa: v1.includes("n/a — Makro-Event ohne Inflationsimpuls")
    && v1.includes("n/a — Makro-Event ohne Zinsimpuls")
    && v1.includes("n/a — Makro-Event ohne Aktienimpuls")
    && v1.includes("n/a — keine Sektoren im Makro-Event")
    && !v1.includes(">neutral<"),
  v1NoBars: !v1.includes(">Headline<") && !v1.includes(">Cross<") && !v1.includes(">Top Changes<"),
  v2NoColumns: !v2.includes('data-testid="briefing-regions"') && !v2.includes('data-testid="briefing-cross"'),
  v2Hero: v2.includes('data-testid="briefing-hero"') && v2.includes('data-testid="briefing-stance-tag"'),
  v2Cards: v2.includes('data-testid="briefing-events"')
    && v2.includes("md:grid-cols-2")
    && v2.includes("OBBBA verabschiedet")
    && v2.includes("Aktuelle Key Events"),
  v2Category: v2.includes("Fiskalpolitik") && v2.includes("2025-Q3"),
  v2ImpactRow: v2.includes("Inflation") && v2.includes("steigend") && v2.includes("Zinsen") && v2.includes("Aktien") && v2.includes("positiv"),
  v2Rationale: v2.includes("Fiskale Expansion treibt Demand."),
  v2Sectors: v2.includes("Technology") && v2.includes("Defense"),
  v2NoV1Summary: !v2.includes("should-not-show-as-v1-summary") && !v2.includes("v1-only"),
  v2Stance: v2.includes("Vorsichtig"),
  v2NoBars: !v2.includes(">Headline<") && !v2.includes(">Cross<") && !v2.includes(">Top Changes<") && !v2.includes(">Tactical Stance<"),
  v2ReusesKeyEventCard: cardHtml.length > 40 && v2.includes(cardHtml),
  reusesExport: researcherSrc.includes("KeyEventCard")
    && macroSrc.includes("export function KeyEventCard")
    && !researcherSrc.includes("function ImpactBadge"),
  serverMapsCardFields: serverSrc.includes("toBriefingKeyEvent(")
    && !serverSrc.includes('inflationImpact: src?.inflationImpact || "neutral"'),
  missingStaysNa: !!missing
    && missing.inflationImpact === "n/a — Makro-Event ohne Inflationsimpuls"
    && missing.rateImpact === "n/a — Makro-Event ohne Zinsimpuls"
    && missing.equityImpact === "n/a — Makro-Event ohne Aktienimpuls"
    && missing.severity === "n/a — Makro-Event ohne Schwere"
    && Array.isArray(missing.affectedSectors)
    && missing.affectedSectors[0] === "n/a — keine Sektoren im Makro-Event",
  realNeutralIsKept: !!keptNeutral
    && keptNeutral.inflationImpact === "neutral"
    && Array.isArray(keptNeutral.affectedSectors)
    && keptNeutral.affectedSectors[0] === "Energy",
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
