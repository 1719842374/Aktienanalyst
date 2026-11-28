/**
 * Klickbarkeit: KI-Badge ist ein Button und schickt den Kontext an die Route.
 * Bestätigen ohne Zahl ist disabled mit Grund. Regionen-Button bleibt bei vorhandenen Regionen.
 * Aufruf: npx tsx --tsconfig script/tsconfig.jsx.json script/test-segment-n35.ts
 */
import React, { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import express from "express";
import type { AddressInfo } from "node:net";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SegmentChildrenList, SegmentChildrenPanel } from "../client/src/components/sections/SegmentChildren";
import { SegmentEstimateBlock } from "../client/src/components/sections/Section2";
import { SegmentSupplementBody } from "../client/src/components/sections/SegmentSupplementView";
import { installFakeDom, findByTestId, reactPropsOf } from "./lib/fake-dom";
import type { SegmentSupplement } from "../shared/segment-supplement";
import type { StockAnalysis } from "../shared/schema";

delete process.env.OPENROUTER_API_KEY;
(globalThis as { React?: typeof React }).React = React;

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

const kiChild = {
  parent: "Automotive",
  name: "FSD",
  revenue: null,
  shareOfParentPct: null,
  growthPct: null,
  source: "KI" as const,
  basis: "Lücke",
};

const listHtml = renderToStaticMarkup(createElement(SegmentChildrenList, {
  data: { parent: "Automotive", children: [kiChild], reason: null },
}));
gap(
  "ki-badge-is-button",
  listHtml.includes("<button") && listHtml.includes('data-testid="segment-child-source"') && listHtml.includes("KI-Schätzung"),
  listHtml.replace(/\s+/g, " ").slice(0, 400),
);

const supplement = (growth: number | null): SegmentSupplement => ({
  parents: [],
  growth: [{
    name: "Automotive",
    reportedGrowthPct: null,
    nextYearGrowthPct: growth,
    observations: growth == null ? 0 : 2,
    source: growth == null ? null : "FMP revenue-product-segmentation",
    override: false,
    label: growth == null ? "n/a — nicht schätzbar" : "Median",
  }],
  subItems: [],
  reportedSharePct: 100,
  reportedShareReason: null,
  undisclosedNote: "Hinweis",
  childShareNotes: [],
  historyNote: null,
});
const disabledHtml = renderToStaticMarkup(createElement(SegmentSupplementBody, { data: supplement(null), drafts: {} }));
gap(
  "confirm-disabled-without-number",
  disabledHtml.includes('data-testid="segment-override-confirm"')
    && disabledHtml.includes("disabled")
    && disabledHtml.includes("Keine Zahl zum Bestätigen"),
  disabledHtml.replace(/\s+/g, " ").slice(0, 500),
);
const enabledHtml = renderToStaticMarkup(createElement(SegmentSupplementBody, { data: supplement(8.2), drafts: {} }));
gap(
  "confirm-enabled-with-number",
  enabledHtml.includes('data-testid="segment-override-confirm"') && !enabledHtml.includes("disabled"),
  enabledHtml.replace(/\s+/g, " ").slice(0, 400),
);

const analysis = {
  ticker: "TSLA",
  companyName: "Tesla, Inc.",
  currency: "USD",
  description: "Tesla baut Fahrzeuge.",
  revenue: 900,
  revenueSegments: [{ name: "Automotive", revenue: 700, percentage: 80, growth: 12, fiscalYear: "2025" }],
  geoSegments: [
    { name: "United States", revenue: 400, percentage: 50, growth: undefined },
    { name: "China", revenue: 200, percentage: 25, growth: 4 },
  ],
} as unknown as StockAnalysis;
const regionHtml = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SegmentEstimateBlock, { data: analysis })));
gap(
  "region-button-when-regions-exist",
  regionHtml.includes('data-testid="button-segment-outline-geo"') && regionHtml.includes("N/A mit KI schätzen"),
  regionHtml.includes("button-segment-outline-geo") ? "Button ohne Text" : "kein Regionen-Button",
);

const { doc } = installFakeDom();
const calls: { method: string; url: string; data?: unknown }[] = [];
const container = doc.createElement("div");
doc.body.appendChild(container);
const root = createRoot(container);
await act(async () => {
  root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SegmentChildrenPanel, {
    ticker: "TSLA",
    parent: "Automotive",
    kind: "product" as const,
    context: {
      parentRevenue: 700,
      parentYoy: 12,
      fiscalYear: "2025",
      currency: "USD",
      regions: [{ name: "United States", revenue: 400, growth: null }, { name: "China", revenue: 200, growth: 4 }],
    },
    request: async (method: string, url: string, data?: unknown) => {
      calls.push({ method, url, data });
      if (method === "GET") {
        return new Response(JSON.stringify({ parent: "Automotive", children: [kiChild], reason: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        child: { ...kiChild, shareOfParentPct: 18, growthPct: 9, basis: "Tesla Annual Report 2025" },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  })));
});
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
const button = findByTestId(container, "segment-child-source");
const props = button ? reactPropsOf(button) : null;
if (button && props && typeof props.onClick === "function") {
  await act(async () => { props.onClick({ stopPropagation() {} }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
const posted = calls.find((call) => call.method === "POST");
const body = posted?.data as { parentRevenue?: number; parentYoy?: number; fiscalYear?: string; currency?: string; knownChildren?: string[]; regions?: { name: string }[] } | undefined;
gap(
  "click-posts-context",
  !!posted
    && body?.parentRevenue === 700
    && body?.parentYoy === 12
    && body?.fiscalYear === "2025"
    && body?.currency === "USD"
    && Array.isArray(body?.knownChildren)
    && body.knownChildren.includes("FSD")
    && (body.regions ?? []).some((row) => row.name === "United States"),
  JSON.stringify(posted ?? calls),
);
const after = container.textContent ?? "";
gap("click-shows-share-and-growth", after.includes("18.0") && after.includes("9.0"), after.slice(0, 300));
await act(async () => { root.unmount(); });

const route = await import("../server/segment-growth-route");
route.resetSegmentChildrenGuardsForTests();
const prompts: string[] = [];
const app = express();
app.use(express.json());
route.registerSegmentGrowthRoute(app, {
  fmpAvailable: () => false,
  raw: async () => [],
  ki: async () => null,
  identity: async () => ({
    companyName: "Tesla, Inc.",
    exchange: "NASDAQ",
    country: "US",
    sector: "Consumer Cyclical",
    industry: "Auto Manufacturers",
    description: "Tesla baut Fahrzeuge.",
    fiscalYear: "2025",
    currency: "USD",
  }),
  peers: async () => [],
  rateLimit: { max: 20, windowMs: 60_000 },
  llm: async (opts: { prompt: string }) => {
    prompts.push(opts.prompt);
    const region = opts.prompt.includes("Nur Regionen mit YoY");
    return {
      modelUsed: "mock-model",
      data: region ? {
        companyEcho: "Tesla, Inc.",
        industryEcho: "Auto Manufacturers",
        children: [{
          name: "United States",
          owner: "Tesla, Inc.",
          basis: "Fehlendes Regionenwachstum",
          source: "Tesla Annual Report 2025",
          growthPct: 6,
          shareOfParentPct: null,
        }, {
          name: "China",
          owner: "Tesla, Inc.",
          basis: "nicht anfassen",
          source: "Tesla Annual Report 2025",
          growthPct: 99,
          shareOfParentPct: null,
        }],
      } : {
        companyEcho: "Tesla, Inc.",
        industryEcho: "Auto Manufacturers",
        children: [{
          name: "FSD",
          owner: "Tesla, Inc.",
          brand: "",
          brandOwner: null,
          basis: "Software im Fahrzeugsegment",
          source: "Tesla Annual Report 2025",
          shareOfParentPct: 18,
          growthPct: 9,
        }],
      },
    };
  },
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
try {
  const childRes = await fetch(`http://127.0.0.1:${port}/api/segment-children/TSLA`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      parent: "Automotive",
      kind: "product",
      child: "FSD",
      knownChildren: ["FSD", "Model 3"],
      parentRevenue: 700,
      parentYoy: 12,
      fiscalYear: "FY2025",
      currency: "usd",
      regions: [{ name: "United States", revenue: 400, growth: null }],
    }),
  });
  const childText = await childRes.text();
  const childJson = (() => { try { return JSON.parse(childText) as { child?: { shareOfParentPct?: number; growthPct?: number }; error?: string }; } catch { return { error: childText.slice(0, 80) }; } })();
  const childPrompt = prompts[0] ?? "";
  gap("route-child-status", childRes.status === 200, `status=${childRes.status} ${childJson.error ?? ""}`);
  gap("route-child-context", childPrompt.includes("700") && childPrompt.includes("12") && childPrompt.includes("2025") && childPrompt.includes("USD") && childPrompt.includes("United States") && childPrompt.includes("Model 3"), childPrompt.slice(0, 400) || "kein Prompt");
  gap("route-child-numbers", childJson.child?.shareOfParentPct === 18 && childJson.child?.growthPct === 9, JSON.stringify(childJson));

  prompts.length = 0;
  const bad = await fetch(`http://127.0.0.1:${port}/api/segment-children/TSLA`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      parent: "Automotive",
      kind: "product",
      child: "FSD",
      currency: "dollar",
      fiscalYear: "soon",
      parentRevenue: "viel",
      knownChildren: "nope",
    }),
  });
  const badPrompt = prompts[0] ?? "";
  gap(
    "invalid-context-stays-empty",
    bad.status === 200 && badPrompt.includes("Währung: n/a") && badPrompt.includes("Geschäftsjahr: n/a") && !badPrompt.includes("soon") && !badPrompt.includes("dollar") && !badPrompt.includes("viel"),
    badPrompt.slice(0, 300) || `status=${bad.status}`,
  );

  prompts.length = 0;
  const regionRes = await fetch(`http://127.0.0.1:${port}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: "TSLA",
      kind: "geographic",
      rows: [
        { name: "United States", revenue: 400, share: 50, growth: null },
        { name: "China", revenue: 200, share: 25, growth: 4 },
      ],
      context: {
        currency: "USD",
        fiscalYear: "2025",
        totalRevenue: 900,
        segments: [{ name: "Automotive", revenue: 700, growth: 12 }],
      },
    }),
  });
  const regionText = await regionRes.text();
  const regionJson = (() => { try { return JSON.parse(regionText) as { items?: { name: string; growthPct: number | null }[]; reason?: string; error?: string }; } catch { return { error: regionText.slice(0, 80) }; } })();
  const regionPrompt = prompts[0] ?? "";
  gap("route-region-status", regionRes.status === 200, `status=${regionRes.status} ${regionJson.error ?? ""}`);
  gap("route-region-context", regionPrompt.includes("Automotive") && regionPrompt.includes("700") && regionPrompt.includes("USD") && regionPrompt.includes("2025"), regionPrompt.slice(0, 400) || "kein Prompt");
  gap(
    "route-region-only-gap",
    regionJson.items?.length === 1 && regionJson.items[0].name === "United States" && regionJson.items[0].growthPct === 6,
    JSON.stringify(regionJson),
  );
} finally {
  server.close();
}

if (gaps.length > 0) {
  console.error(`n35 FAIL ${gaps.length}`);
  process.exit(1);
}
console.log("n35 PASS");
