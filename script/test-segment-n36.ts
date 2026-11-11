/**
 * Fehlende Segmente/Regionen: generisch, an ein Elternsegment gehängt, Doppelungen weg.
 * Aufruf: npx tsx --tsconfig script/tsconfig.jsx.json script/test-segment-n36.ts
 */
import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import express from "express";
import type { AddressInfo } from "node:net";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SegmentGapPanel } from "../client/src/components/sections/SegmentGapPanel";
import { installFakeDom, findByTestId, reactPropsOf } from "./lib/fake-dom";
import { registerSegmentGapRoute, resetSegmentGapCacheForTests } from "../server/segment-gap-route";

delete process.env.OPENROUTER_API_KEY;
(globalThis as { React?: typeof React }).React = React;

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(name);
}

const hidden = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SegmentGapPanel, { ticker: "TSLA" })));
gap("toggle-starts-hidden", hidden.includes("Fehlende Segmente/Regionen anzeigen") && !hidden.includes("segment-gap-list"), hidden.slice(0, 200));

const { doc } = installFakeDom();
const container = doc.createElement("div");
doc.body.appendChild(container);
const root = createRoot(container);
let posts = 0;
await act(async () => {
  root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SegmentGapPanel, {
    ticker: "TSLA",
    request: async () => {
      posts += 1;
      return new Response(JSON.stringify({
        items: [{ parent: "Automotive", kind: "product", name: "FSD", shareOfParentPct: 8, growthPct: null, basis: "Tesla Annual Report 2025" }],
        reason: null,
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  })));
});
const toggle = findByTestId(container, "segment-gap-toggle");
const toggleProps = toggle ? reactPropsOf(toggle) : null;
gap("toggle-is-button", toggle?.nodeName === "BUTTON" && typeof toggleProps?.onClick === "function", toggle?.nodeName ?? "fehlt");
if (toggleProps?.onClick) {
  await act(async () => { toggleProps.onClick(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
const shown = container.textContent ?? "";
gap("toggle-shows-fsd", shown.includes("Automotive / FSD") && shown.includes("8.0") && shown.includes("n/a") && shown.includes("KI-Schätzung"), shown.slice(0, 240));
if (toggleProps?.onClick) {
  await act(async () => { toggleProps.onClick(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
gap("toggle-hides", !(container.textContent ?? "").includes("Automotive / FSD") && posts === 1, container.textContent ?? "");
await act(async () => { root.unmount(); });

resetSegmentGapCacheForTests();
const prompts: string[] = [];
let llmCalls = 0;
let failOnce = true;
const app = express();
app.use(express.json());
registerSegmentGapRoute(app, {
  available: () => true,
  productRows: async () => [{ fiscalYear: "2025", data: { Automotive: 700, "Energy generation and storage": 100 } }],
  regionRows: async () => [{ fiscalYear: "2025", data: { "United States": 400, China: 200 } }],
  identity: async () => ({
    companyName: "Tesla, Inc.",
    exchange: "NASDAQ",
    country: "US",
    sector: "Consumer Cyclical",
    industry: "Auto Manufacturers",
    description: "Tesla baut Fahrzeuge und Speicher.",
    fiscalYear: "2025",
    currency: "USD",
  }),
  llm: async (opts) => {
    llmCalls += 1;
    prompts.push(opts.prompt);
    if (failOnce) {
      failOnce = false;
      return null;
    }
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "Tesla, Inc.",
        industryEcho: "Auto Manufacturers",
        children: [
          { parent: "Automotive", name: "Automotive", owner: "Tesla, Inc.", basis: "Echo", source: "Tesla Annual Report 2025", shareOfParentPct: 100, growthPct: 1 },
          { parent: "Automotive", name: "FSD", owner: "Tesla, Inc.", brand: "", basis: "Software im Fahrzeug", source: "Tesla Annual Report 2025", shareOfParentPct: 8, growthPct: null },
          { parent: "Automotive", name: "United States", owner: "Tesla, Inc.", basis: "schon eine Region", source: "Tesla Annual Report 2025", shareOfParentPct: 40, growthPct: 3 },
          { parent: "Software", name: "FSD", owner: "Tesla, Inc.", basis: "kein bekanntes Elternsegment", source: "Tesla Annual Report 2025", shareOfParentPct: 5, growthPct: 1 },
        ],
      },
    };
  },
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;
try {
  const first = await fetch(`http://127.0.0.1:${port}/api/segment-gaps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker: "TSLA" }),
  });
  gap("error-not-cached", first.status === 503 && llmCalls === 1, `status=${first.status} calls=${llmCalls}`);
  const second = await fetch(`http://127.0.0.1:${port}/api/segment-gaps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker: "TSLA" }),
  });
  const json = await second.json() as { items?: { parent: string; name: string; shareOfParentPct: number | null; growthPct: number | null }[]; reason?: string; error?: string };
  const prompt = prompts[1] ?? prompts[0] ?? "";
  gap("prompt-has-known-facts", prompt.includes("Automotive") && prompt.includes("United States") && prompt.includes("Tesla baut Fahrzeuge") && !prompt.includes("FSD"), prompt.slice(0, 360));
  const names = (json.items ?? []).map((item) => `${item.parent}/${item.name}`);
  gap("keeps-fsd-under-automotive", names.includes("Automotive/FSD") && json.items?.find((item) => item.name === "FSD")?.shareOfParentPct === 8 && json.items?.find((item) => item.name === "FSD")?.growthPct == null, JSON.stringify(json));
  gap("drops-echo-and-unknown-parent", !names.includes("Automotive/Automotive") && !names.includes("Automotive/United States") && !names.some((name) => name.startsWith("Software/")), names.join(",") || json.reason || "");
  const third = await fetch(`http://127.0.0.1:${port}/api/segment-gaps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker: "TSLA" }),
  });
  gap("success-cached", third.status === 200 && llmCalls === 2, `status=${third.status} calls=${llmCalls}`);
} finally {
  server.close();
}

if (gaps.length > 0) {
  console.error(`n36 FAIL ${gaps.length}`);
  process.exit(1);
}
console.log("n36 PASS");
