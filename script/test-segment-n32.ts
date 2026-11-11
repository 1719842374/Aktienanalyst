/**
 * Tester 11.11. 17:25: SAP.DE 422, 1211.HK ohne FMP, Regionen ohne Button.
 * Aufruf: npx tsx script/test-segment-n32.ts
 */
import React from "react";
import express from "express";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { reviewSegmentOutline } from "../shared/segment-children";
import { estimateSegmentTam } from "../server/segment-tam-estimate-route";

(globalThis as { React?: typeof React }).React = React;
delete process.env.OPENROUTER_API_KEY;

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

const sapPrompts: string[] = [];
const sap = await estimateSegmentTam({
  ticker: "SAP.DE",
  companyName: "SAP SE",
  sector: "Technology",
  industry: "Software - Application",
  description: "SAP macht Unternehmenssoftware.",
  currency: "EUR",
  fiscalYear: "2024",
  totalRevenue: 34.1,
  peerAnchor: null,
  segments: [
    { segmentName: "Software support", segmentRevenue: 12.4, segmentShare: 40, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
    { segmentName: "Services", segmentRevenue: 4.8, segmentShare: 15, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
    { segmentName: "licenses", segmentRevenue: 8.1, segmentShare: 26, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
  ],
} as never, {
  isLLMAvailable: () => true,
  callLLMJson: async (opts) => {
    sapPrompts.push(opts.prompt);
    return {
      modelUsed: "mock-model",
      data: {
        fills: [{
          segmentName: "Software support",
          tamSize: 40,
          tamSource: "SAP Annual Report 2024",
          formula: "Markt für Support",
          rationale: "Belegt aus dem Bericht",
          confidence: "med",
        }],
      },
    };
  },
});
const sapPrompt = sapPrompts.join("\n");
gap(
  "sap-prompt-has-eur-year-revenue-profile",
  sapPrompt.includes("EUR")
    && sapPrompt.includes("2024")
    && sapPrompt.includes("Software support")
    && sapPrompt.includes("SAP macht Unternehmenssoftware")
    && sapPrompt.includes("34.1"),
  sapPrompt.slice(0, 400),
);
gap(
  "sap-422-tam-without-cagr-still-fills-sourced-cell",
  sap.ok === true
    && sap.ok
    && sap.fills.some((row) => row.segmentName === "Software support" && row.tamSize === 40 && row.tamSource === "SAP Annual Report 2024")
    && !sap.fills.some((row) => row.segmentName === "Services" || row.segmentName === "licenses"),
  sap.ok ? `fills=${sap.fills.map((row) => row.segmentName).join(",")}` : `${sap.status} ${sap.error}`,
);

const own = reviewSegmentOutline(
  {
    companyEcho: "BYD Company Limited",
    industryEcho: "Auto Manufacturers",
    children: [{
      name: "BYD Automobiles",
      owner: "BYD Company Limited",
      brand: "BYD",
      brandOwner: "BYD Company Limited",
      basis: "Fahrzeugumsatz",
      source: "BYD Company Annual Report 2024",
      shareOfParentPct: 70,
      growthPct: -9.1,
    }],
  },
  "BYD Company Limited",
  { ticker: "1211.HK", description: "BYD baut Fahrzeuge und Batterien." },
);
gap(
  "hk-own-segment-not-foreign-brand",
  own.items.some((row) => row.name === "BYD Automobiles" && row.shareOfParentPct === 70),
  `items=${own.items.map((row) => row.name).join(",") || "leer"} reason=${own.reason ?? "null"}`,
);

const route = await import("../server/segment-growth-route");
const calls: { prompt: string }[] = [];
route.resetSegmentChildrenGuardsForTests();
const app = express();
app.use(express.json());
route.registerSegmentGrowthRoute(app, {
  fmpAvailable: () => false,
  raw: async () => [],
  income: async () => [],
  secSegments: async () => [],
  identity: async () => ({
    companyName: "BYD Company Limited",
    exchange: "HKSE",
    country: "HK",
    sector: "Consumer Cyclical",
    industry: "Auto Manufacturers",
    description: "",
    fiscalYear: "",
    currency: "",
  }),
  peers: async () => [],
  rateLimit: { max: 20, windowMs: 60_000 },
  llm: async (opts) => {
    calls.push({ prompt: opts.prompt });
    const region = opts.prompt.includes("United States");
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "BYD Company Limited",
        industryEcho: "Auto Manufacturers",
        children: [region ? {
          name: "United States",
          owner: "BYD Company Limited",
          basis: "Fehlendes Regionenwachstum",
          source: "Microsoft Annual Report 2025",
          shareOfParentPct: null,
          growthPct: 6,
        } : {
          name: "BYD Automobiles",
          owner: "BYD Company Limited",
          brand: "BYD",
          brandOwner: "BYD Company Limited",
          basis: "Fahrzeugumsatz aus dem vorliegenden Abschluss",
          source: "BYD Company Annual Report 2024",
          shareOfParentPct: 70,
          growthPct: -9.1,
        }],
      },
    };
  },
});
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: "1211.HK",
      kind: "product",
      yahoo: {
        description: "BYD baut Fahrzeuge und Batterien.",
        currency: "HKD",
        fiscalYear: "2024",
        totalRevenue: 777000000123,
        segments: [{ name: "Automobiles", revenue: 500, growth: -9.1 }],
        regions: [{ name: "China", revenue: 400, growth: 11.1 }],
      },
    }),
  });
  const json = await res.json() as { items?: { name: string }[]; reason?: string; error?: string };
  const prompt = calls.map((call) => call.prompt).join("\n");
  gap(
    "hk-without-fmp-prompt-has-yahoo-facts",
    res.status === 200
      && prompt.includes("Yahoo")
      && prompt.includes("HKD")
      && prompt.includes("2024")
      && prompt.includes("777000000123")
      && prompt.includes("BYD baut Fahrzeuge und Batterien")
      && prompt.includes("Automobiles")
      && prompt.includes("China")
      && prompt.includes("-9.1")
      && (json.items ?? []).some((row) => row.name === "BYD Automobiles"),
    `status=${res.status} items=${(json.items ?? []).map((row) => row.name).join(",") || json.reason || json.error || "leer"} prompt=${prompt.slice(0, 400)}`,
  );

  calls.length = 0;
  const regionRes = await fetch(`http://127.0.0.1:${port}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: "MSFT",
      kind: "geographic",
      rows: [
        { name: "United States", revenue: 140, share: 51, growth: null },
        { name: "Other Countries", revenue: 136, share: 49, growth: 8.2 },
      ],
      yahoo: { currency: "USD", fiscalYear: "2025", totalRevenue: 281, description: "Microsoft macht Software." },
    }),
  });
  const regionJson = await regionRes.json() as { items?: { name: string; growthPct: number | null }[] };
  const regionPrompt = calls.map((call) => call.prompt).join("\n");
  gap(
    "region-button-payload-fills-only-na-growth",
    regionRes.status === 200
      && regionPrompt.includes("United States")
      && regionPrompt.includes("Other Countries")
      && regionPrompt.includes("8.2")
      && regionPrompt.includes("USD")
      && regionPrompt.includes("Microsoft macht Software")
      && (regionJson.items ?? []).some((row) => row.name === "United States")
      && !(regionJson.items ?? []).some((row) => row.name === "Other Countries"),
    `status=${regionRes.status} items=${(regionJson.items ?? []).map((row) => row.name).join(",") || "leer"} prompt=${regionPrompt.slice(0, 350)}`,
  );
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

const section = await import("../client/src/components/sections/Section2");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
client.setQueryData(["/api/segment-growth", "MSFT"], { ticker: "MSFT", business: [], geographic: [], source: "fixture", currency: "USD" });
const html = renderToStaticMarkup(React.createElement(
  QueryClientProvider,
  { client },
  React.createElement(section.SegmentEstimateBlock, {
    data: {
      ticker: "MSFT",
      companyName: "Microsoft Corporation",
      description: "Microsoft macht Software.",
      currency: "USD",
      revenue: 281,
      revenueSegments: [{ name: "Server", percentage: 40, revenue: 100, growth: 10 }],
      geoSegments: [
        { name: "United States", percentage: 51, revenue: 140, growth: null },
        { name: "Other Countries", percentage: 49, revenue: 136, growth: 8.2 },
      ],
    } as never,
  }),
));
gap(
  "region-button-visible-when-regions-exist",
  html.includes("button-segment-outline-geo") && html.includes("N/A mit KI schätzen") && html.includes("United States"),
  `button=${html.includes("button-segment-outline-geo")} text=${html.includes("N/A mit KI schätzen")} us=${html.includes("United States")}`,
);

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n32: OK");
