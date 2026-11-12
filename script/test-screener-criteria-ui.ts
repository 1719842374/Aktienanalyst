/**
 * Render- und Eingabepfade der beiden Screener-Ansichten.
 * Transport ist ein fetch-Stub. Die Filterfunktion bleibt die produktive.
 *
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-screener-criteria-ui.ts
 */
import assert from "node:assert/strict";
import { createElement, type ReactElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { createServer, type ViteDevServer } from "vite";
import { ScreenerPanel } from "../client/src/components/researcher/ScreenerPanel";
import ScreenerDashboard from "../client/src/pages/ScreenerDashboard";
import { CAP_NEGATIVE_NOTE, CAP_RANGE_NOTE, CAP_SCALE_NOTE, MISSING_COUNTRY, MISSING_FORWARD_PE, MISSING_ROIC } from "../shared/custom-screen";

function markup(tree: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

function setInput(tree: TestRenderer.ReactTestRenderer, testId: string, value: string): void {
  act(() => {
    tree.root.findByProps({ "data-testid": testId }).props.onChange({ target: { value } });
  });
}

function tickers(tree: TestRenderer.ReactTestRenderer): string[] {
  return tree.root
    .findAllByProps({ className: "text-base font-bold font-mono text-foreground/95" })
    .map((node) => node.children.join(""));
}

const panelRows = [
  {
    ticker: "LOSS", companyName: "Loss Co", sector: "Technology", industry: "Software",
    marketCap: 2e9, pe: 10, revenueGrowth: 4, forwardPE: -5, roic: 0, country: "DE",
    actionRecommendation: "Watch", moatScore: 4, marginRiskScore: 3, rationale: "negatives Forward P/E",
    growthDrivers: [], risks: [],
  },
  {
    ticker: "NONE", companyName: "None Co", sector: "Banks", industry: "",
    marketCap: 0, pe: 8, revenueGrowth: 1, forwardPE: 0,
    actionRecommendation: "Watch", moatScore: 3, marginRiskScore: 5, rationale: "ohne Felder",
    growthDrivers: [], risks: [],
  },
];

let panel: TestRenderer.ReactTestRenderer;
act(() => {
  panel = TestRenderer.create(createElement(ScreenerPanel, { data: { candidates: panelRows }, region: "EU" }));
});
assert.equal(panel!.root.findByProps({ "data-testid": "screen-mcap-min" }).props.value, "");
assert.deepEqual(tickers(panel!), ["LOSS", "NONE"]);
assert.equal(markup(panel!).includes("Keine geladenen Kandidaten erfüllen die Kriterien."), false);

setInput(panel!, "screen-fwd-pe", "20");
assert.deepEqual(tickers(panel!), ["LOSS"]);
assert.match(panel!.root.findByProps({ "data-testid": "screen-na-notes" }).children.join(""), new RegExp(MISSING_FORWARD_PE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
setInput(panel!, "screen-fwd-pe", "");
setInput(panel!, "screen-roic", "0");
assert.deepEqual(tickers(panel!), ["LOSS"]);
assert.match(panel!.root.findByProps({ "data-testid": "screen-na-notes" }).children.join(""), new RegExp(MISSING_ROIC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
setInput(panel!, "screen-roic", "10");
assert.deepEqual(tickers(panel!), []);
setInput(panel!, "screen-roic", "");
setInput(panel!, "screen-country", "de");
assert.deepEqual(tickers(panel!), ["LOSS"]);
assert.match(panel!.root.findByProps({ "data-testid": "screen-na-notes" }).children.join(""), new RegExp(MISSING_COUNTRY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
for (const id of ["screen-mcap-min", "screen-mcap-max", "screen-industry", "screen-country", "screen-roic", "screen-fwd-pe"]) {
  setInput(panel!, id, "");
}
assert.deepEqual(tickers(panel!), ["LOSS", "NONE"]);

setInput(panel!, "screen-mcap-min", "2000");
setInput(panel!, "screen-mcap-max", "1000");
assert.deepEqual(tickers(panel!), ["LOSS", "NONE"]);
assert.match(panel!.root.findByProps({ "data-testid": "screen-na-notes" }).children.join(""), new RegExp(CAP_RANGE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.equal(markup(panel!).includes("Keine geladenen Kandidaten erfüllen die Kriterien."), false);
setInput(panel!, "screen-mcap-min", "");
setInput(panel!, "screen-mcap-max", "");
setInput(panel!, "screen-mcap-min", "1e308");
assert.deepEqual(tickers(panel!), ["LOSS", "NONE"]);
assert.match(panel!.root.findByProps({ "data-testid": "screen-na-notes" }).children.join(""), new RegExp(CAP_SCALE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
setInput(panel!, "screen-mcap-min", "-5");
assert.deepEqual(tickers(panel!), ["LOSS", "NONE"]);
assert.match(panel!.root.findByProps({ "data-testid": "screen-na-notes" }).children.join(""), new RegExp(CAP_NEGATIVE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

let emptyPanel: TestRenderer.ReactTestRenderer;
act(() => {
  emptyPanel = TestRenderer.create(createElement(ScreenerPanel, { data: { candidates: [] }, region: "US" }));
});
const emptyMarkup = markup(emptyPanel!);
assert.match(emptyMarkup, /Keine Kandidaten gefunden/);
assert.equal(emptyMarkup.includes("custom-screen-form"), false);
console.log("boundary: ScreenerPanel mit candidates=[] rendert den bestehenden Early-Return und kein Kriterienformular");

function dashboardStock() {
  return {
    ticker: "AAPL", name: "Apple", price: 100, marketCap: 3e12, pe: 28, forwardPE: -5,
    sector: "Technology", beta: 1, investorCount: 2, investors: ["Fund"], totalValue: 10,
    targetPrice: 110, upside: 10, downside: 5, crv: 2, crvPass: false, yearHigh: 120, yearLow: 80, fcfMargin: 20,
  };
}

function dashboardElement(): ReactElement {
  const { hook } = memoryLocation({ path: "/screener" });
  return createElement(Router, { hook }, createElement(ScreenerDashboard));
}

const calls: string[] = [];
let releaseLoad: (response: Response) => void = () => {};
const pendingLoad = new Promise<Response>((resolve) => { releaseLoad = resolve; });
global.fetch = (() => {
  calls.push("/api/screener");
  return pendingLoad;
}) as typeof fetch;
let dashboard: TestRenderer.ReactTestRenderer;
act(() => {
  dashboard = TestRenderer.create(dashboardElement());
});
assert.match(markup(dashboard!), /13F-Holdings werden geladen/);
await act(async () => {
  releaseLoad(new Response(JSON.stringify({
    lastUpdated: "2026-11-08T00:00:00.000Z",
    totalInvestors: 1,
    totalHoldings: 1,
    screenedStocks: [dashboardStock()],
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  await pendingLoad;
});
assert.match(markup(dashboard!), /AAPL/);
assert.equal(dashboard!.root.findByProps({ "data-testid": "screener-fwd-pe" }).props.value, "");
const callsAfterLoad = calls.length;
setInput(dashboard!, "screener-fwd-pe", "20");
assert.equal(calls.length, callsAfterLoad);
assert.match(markup(dashboard!), /AAPL/);
assert.equal(markup(dashboard!).includes(MISSING_FORWARD_PE), false);
setInput(dashboard!, "screener-mcap-min", "2000");
setInput(dashboard!, "screener-mcap-max", "1000");
assert.match(dashboard!.root.findByProps({ "data-testid": "screener-na-notes" }).children.join(""), new RegExp(CAP_RANGE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(markup(dashboard!), /AAPL/);
assert.equal(calls.length, callsAfterLoad);
for (const id of ["screener-mcap-min", "screener-mcap-max", "screener-industry", "screener-country", "screener-roic", "screener-fwd-pe"]) {
  setInput(dashboard!, id, "");
}
assert.match(markup(dashboard!), /AAPL/);
assert.equal(calls.length, callsAfterLoad);

global.fetch = (async () => {
  throw new Error("netz-stub");
}) as typeof fetch;
let failed: TestRenderer.ReactTestRenderer;
await act(async () => {
  failed = TestRenderer.create(dashboardElement());
});
assert.equal(markup(failed!).includes("Fehler beim Laden:"), true);
assert.equal(markup(failed!).includes("netz-stub"), true);

global.fetch = (async () => new Response(JSON.stringify({
  lastUpdated: "2026-11-08T00:00:00.000Z",
  totalInvestors: 0,
  totalHoldings: 0,
  screenedStocks: [],
}), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
let blankDashboard: TestRenderer.ReactTestRenderer;
await act(async () => {
  blankDashboard = TestRenderer.create(dashboardElement());
});
assert.match(markup(blankDashboard!), /screener-custom-criteria/);
assert.match(markup(blankDashboard!), /Keine Ergebnisse/);

const store = new Map<string, string>();
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  },
});
const researcherCalls: { url: string; body?: string }[] = [];
global.fetch = (async (url: string, init?: RequestInit) => {
  researcherCalls.push({ url: String(url), body: typeof init?.body === "string" ? init.body : undefined });
  if (String(url).includes("/api/researcher/screener")) {
    return new Response(JSON.stringify({
      candidates: [{
        ticker: "SAP", companyName: "SAP", sector: "Technology", industry: "Software",
        marketCap: 2e11, pe: 30, revenueGrowth: 5, actionRecommendation: "Watch",
        moatScore: 6, marginRiskScore: 4, rationale: "geladen", growthDrivers: [], risks: [],
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: "transport-stub" }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const vite: ViteDevServer = await createServer({
  configFile: "/agent/repos/Aktienanalyst/vite.config.ts",
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const researcherMod = await vite.ssrLoadModule("/src/pages/Researcher.tsx");
const Researcher = researcherMod.default as () => ReactElement;
const { hook } = memoryLocation({ path: "/researcher" });
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
let researcher: TestRenderer.ReactTestRenderer;
await act(async () => {
  researcher = TestRenderer.create(createElement(QueryClientProvider, { client }, createElement(Router, { hook }, createElement(Researcher))));
});
await act(async () => {
  researcher!.root.findByProps({ "data-testid": "button-tab-screener" }).props.onClick();
});
assert.equal(researcher!.root.findAllByProps({ "data-testid": "custom-screen-form" }).length, 0);
assert.equal(researcherCalls.filter((call) => call.url.includes("/api/researcher/screener")).length, 0);
await act(async () => {
  researcher!.root.findByProps({ "data-testid": "button-run-analysis" }).props.onClick();
});
const screenerPosts = researcherCalls.filter((call) => call.url.includes("/api/researcher/screener"));
assert.equal(screenerPosts.length, 1);
assert.deepEqual(JSON.parse(screenerPosts[0].body || "{}"), {
  region: "US", force: false, marketCapMin: 1000, marketCapMax: 500000, peMax: 30, revenueGrowthMin: 5,
});
assert.equal(researcher!.root.findAllByProps({ "data-testid": "custom-screen-form" }).length, 1);
const postsBeforeType = screenerPosts.length;
setInput(researcher!, "screen-industry", "soft");
assert.equal(researcherCalls.filter((call) => call.url.includes("/api/researcher/screener")).length, postsBeforeType);
assert.match(markup(researcher!), /SAP/);
await act(async () => {
  researcher!.root.findAllByProps({ "data-testid": "button-region-EU" })[0].props.onClick();
});
assert.equal(researcher!.root.findAllByProps({ "data-testid": "custom-screen-form" }).length, 0);
assert.equal(researcherCalls.filter((call) => call.url.includes("/api/researcher/screener")).length, 1);
await act(async () => {
  researcher!.root.findAllByProps({ "data-testid": "button-region-US" })[0].props.onClick();
});
assert.equal(researcher!.root.findAllByProps({ "data-testid": "custom-screen-form" }).length, 1);
assert.match(markup(researcher!), /SAP/);
assert.equal(researcherCalls.filter((call) => call.url.includes("/api/researcher/screener")).length, 1);
await vite.close();

console.log("screener criteria ui: OK");
