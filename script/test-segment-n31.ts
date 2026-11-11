/**
 * Abschnitt 3, KI-Schätzen für Segmente und Regionen.
 * Der OpenRouter-Aufruf muss die schon bekannten Fakten enthalten.
 * Die KI füllt nur Lücken. Fehler und Timeouts bleiben nicht 24 h im Cache.
 * Ohne Quelle zeigt die Zeile n/a, mit Quelle das Label KI-Schätzung in Violett.
 *
 * Aufruf: npx tsx script/test-segment-n31.ts
 */
import React from "react";
import express from "express";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { roundGrowthPct } from "../shared/segment-growth-calc";
import { KI_UNAVAILABLE } from "../shared/segment-children";

(globalThis as { React?: typeof React }).React = React;
delete process.env.OPENROUTER_API_KEY;

const route = await import("../server/segment-growth-route");
const section = await import("../client/src/components/sections/Section2");
const childrenUi = await import("../client/src/components/sections/SegmentChildren");

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

const profile = "BYD baut Fahrzeuge und Batterien.";
const totalRevenue = 777000000123;
const productRows = [
  { date: "2025-12-31", data: { Automobiles: 500, Batteries: 100 } },
  { date: "2024-12-31", data: { Automobiles: 550, Batteries: 80 } },
];
const geoRows = [
  { date: "2025-06-30", data: { China: 400, "Asia Pacific": 1077 } },
  { date: "2024-06-30", data: { China: 360, "Asia-Pacific": 1000 } },
];
const autoYoy = roundGrowthPct(500, 550);
const batteryYoy = roundGrowthPct(100, 80);
const chinaYoy = roundGrowthPct(400, 360);
const asiaYoy = roundGrowthPct(1077, 1000);
const factLines = [
  "BEKANNTE FAKTEN. Diese Zahlen nicht ersetzen. Nur Lücken füllen.",
  `Firmenprofil: ${profile}`,
  `Geschäftsjahr: 2025. Währung: HKD. Gesamtumsatz: ${totalRevenue}.`,
  `Automobiles: Umsatz 500 (FMP), YoY ${autoYoy} (FMP)`,
  `Batteries: Umsatz 100 (FMP), YoY ${batteryYoy} (FMP)`,
  `China: Umsatz 400 (FMP), YoY ${chinaYoy} (FMP)`,
  `Asia Pacific: Umsatz 1077 (FMP), YoY ${asiaYoy} (BERECHNET)`,
];

type FactInput = {
  profile?: string;
  fiscalYear?: string;
  currency?: string;
  income?: unknown;
  productRows?: unknown[];
  geoRows?: unknown[];
  secSegments?: readonly { name?: string; revenue?: number; prevRevenue?: number | null }[];
};
const factsFrom = (route as { factsFromSegmentation?: (input: FactInput) => { business: { name: string; revenueOrigin: string; yoyOrigin: string }[]; regions: { name: string; yoyOrigin: string }[] } }).factsFromSegmentation;
const secYoy = roundGrowthPct(200, 180);
if (typeof factsFrom !== "function") {
  gap("facts-builder", false, "factsFromSegmentation fehlt");
} else {
  const secOnly = factsFrom({
    profile: "Xiaomi macht Telefone.",
    fiscalYear: "2025",
    currency: "CNY",
    income: [{ revenue: 42, fiscalYear: "2025", reportedCurrency: "CNY" }],
    productRows: [],
    geoRows: [],
    secSegments: [{ name: "Smartphones", revenue: 200, prevRevenue: 180 }],
  });
  const secBlock = (route as { segmentFactBlock?: (facts: unknown) => string }).segmentFactBlock?.(secOnly) ?? "";
  gap(
    "sec-revenue-and-calculated-yoy",
    secBlock.includes("Smartphones: Umsatz 200 (SEC), YoY " + String(secYoy) + " (BERECHNET)")
      && secBlock.includes("Gesamtumsatz: 42")
      && secBlock.includes("Firmenprofil: Xiaomi macht Telefone."),
    secBlock,
  );
  const mixed = factsFrom({
    profile,
    fiscalYear: "2025",
    currency: "HKD",
    income: [{ revenue: totalRevenue, fiscalYear: "2025", reportedCurrency: "HKD" }],
    productRows,
    geoRows,
    secSegments: [{ name: "Smartphones", revenue: 200, prevRevenue: 180 }],
  });
  const mixedBlock = (route as { segmentFactBlock?: (facts: unknown) => string }).segmentFactBlock?.(mixed) ?? "";
  gap(
    "fmp-wins-over-sec",
    factLines.every((line) => mixedBlock.includes(line)) && !mixedBlock.includes("Smartphones"),
    mixedBlock,
  );
}

const identity = {
  companyName: "BYD Company Limited",
  exchange: "HKSE",
  country: "CN",
  sector: "Consumer Cyclical",
  industry: "Auto Manufacturers",
  fiscalYear: "2025",
  currency: "HKD",
  description: profile,
};
type LlmCall = { prompt: string; systemPrompt?: string };
const calls: LlmCall[] = [];
let mode: "ok" | "null" | "throw" = "ok";
const answer = {
  companyEcho: "BYD Company Limited",
  industryEcho: "Auto Manufacturers",
  children: [
    {
      name: "Passenger Vehicles",
      brand: "",
      brandOwner: null,
      owner: "BYD Company Limited",
      shareOfParentPct: 64,
      growthPct: 5,
      basis: "Lücke beim Anteil",
      source: "BYD Company Annual Report 2025",
    },
    {
      name: "Handset",
      owner: "BYD Company Limited",
      shareOfParentPct: 10,
      growthPct: 3,
      basis: "Produktlinie",
      source: null,
    },
  ],
};

route.resetSegmentChildrenGuardsForTests();
let clock = 0;
const app = express();
app.use(express.json());
route.registerSegmentGrowthRoute(app, {
  fmpAvailable: () => true,
  raw: async (_kind) => (_kind === "geographic" ? geoRows : productRows),
  income: async () => [{ revenue: totalRevenue, fiscalYear: "2025", reportedCurrency: "HKD" }],
  secSegments: async () => [],
  names: async (_ticker, kind) => (kind === "geographic" ? ["China", "Asia Pacific"] : ["Automobiles", "Batteries"]),
  identity: async () => identity,
  peers: async () => [],
  now: () => clock,
  rateLimit: { max: 50, windowMs: 60_000 },
  llm: async (opts) => {
    calls.push({ prompt: opts.prompt, systemPrompt: opts.systemPrompt });
    if (mode === "throw") throw new Error("timeout");
    if (mode === "null") return null;
    return { data: answer, modelUsed: "mock-model" };
  },
});
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

function promptsSince(start: number): string {
  return calls.slice(start).map((call) => call.prompt).join("\n");
}

try {
  const beforeProduct = calls.length;
  const productRes = await fetch(`${base}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker: "1211.HK", kind: "product" }),
  });
  const productJson = await productRes.json() as { items?: { name: string; basis: string }[]; reason?: string; error?: string };
  const productPrompt = promptsSince(beforeProduct);
  gap(
    "button-segment-calls-openrouter",
    productRes.status === 200 && calls.length === beforeProduct + 1 && factLines.every((line) => productPrompt.includes(line)),
    `status=${productRes.status} calls=${calls.length - beforeProduct} prompt=${productPrompt.slice(0, 500)}`,
  );
  const OutlineRows = section.OutlineRows;
  const productMarkup = renderToStaticMarkup(React.createElement(OutlineRows, {
    ticker: "1211.HK",
    kind: "product",
    items: productJson.items ?? [],
    note: productJson.reason ?? null,
    open: {},
    setOpen: () => undefined,
  }));
  gap(
    "button-segment-violet-with-source-and-na",
    productMarkup.includes("KI-Schätzung")
      && productMarkup.includes("text-violet-700")
      && productMarkup.includes("BYD Company Annual Report 2025")
      && productMarkup.includes("n/a — ohne Quelle")
      && productMarkup.includes("segment-outline-product"),
    productMarkup.slice(0, 500),
  );

  const beforeGeo = calls.length;
  const geoRes = await fetch(`${base}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker: "1211.HK", kind: "geographic" }),
  });
  const geoPrompt = promptsSince(beforeGeo);
  gap(
    "button-region-calls-openrouter",
    geoRes.status === 200 && calls.length === beforeGeo + 1 && factLines.every((line) => geoPrompt.includes(line)) && /geografisch/i.test(geoPrompt),
    `status=${geoRes.status} calls=${calls.length - beforeGeo} prompt=${geoPrompt.slice(0, 300)}`,
  );

  const beforeChild = calls.length;
  const childRes = await fetch(`${base}/api/segment-children/1211.HK?parent=${encodeURIComponent("China")}&kind=geographic`);
  const childPrompt = promptsSince(beforeChild);
  gap(
    "region-child-payload-has-facts",
    childRes.status === 200 && calls.length === beforeChild + 1 && factLines.every((line) => childPrompt.includes(line)) && childPrompt.includes("China"),
    `status=${childRes.status} calls=${calls.length - beforeChild} prompt=${childPrompt.slice(0, 300)}`,
  );

  mode = "null";
  const beforeErr = calls.length;
  const errRes = await fetch(`${base}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker: "1810.HK", kind: "product" }),
  });
  const errJson = await errRes.json() as { error?: string; reason?: string; items?: unknown };
  const again = await fetch(`${base}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker: "1810.HK", kind: "product" }),
  });
  const failMsg = (section as { outlineFailureMessage?: (ok: boolean, json: { items?: unknown; reason?: string; error?: string } | null) => string | null }).outlineFailureMessage;
  const visible = typeof failMsg === "function" ? failMsg(errRes.ok, errJson) : "";
  const errMarkup = renderToStaticMarkup(React.createElement("p", { "data-testid": "segment-outline-error-product" }, visible));
  gap(
    "outline-error-visible-and-not-cached-24h",
    errRes.status === 503
      && again.status === 503
      && calls.length === beforeErr + 2
      && visible === KI_UNAVAILABLE
      && errMarkup.includes(KI_UNAVAILABLE)
      && readFileSync("client/src/components/sections/Section2.tsx", "utf8").includes("outlineFailureMessage"),
    `status=${errRes.status}/${again.status} calls=${calls.length - beforeErr} visible=${visible}`,
  );

  mode = "throw";
  clock = 1_000_000;
  const beforeTimeout = calls.length;
  const timeoutRes = await fetch(`${base}/api/segment-children/1810.HK?parent=${encodeURIComponent("China")}&kind=geographic`);
  const timeoutJson = await timeoutRes.json() as { reason?: string; children?: unknown[]; error?: string };
  const callsAfterFirst = calls.length;
  clock += 30_000;
  const cachedRes = await fetch(`${base}/api/segment-children/1810.HK?parent=${encodeURIComponent("China")}&kind=geographic`);
  const callsAfterCache = calls.length;
  clock += 23 * 60 * 60 * 1000;
  const laterRes = await fetch(`${base}/api/segment-children/1810.HK?parent=${encodeURIComponent("China")}&kind=geographic`);
  const timeoutMarkup = renderToStaticMarkup(React.createElement(childrenUi.SegmentChildrenList, {
    data: { parent: "China", children: [], reason: timeoutJson.reason ?? timeoutJson.error ?? null },
  }));
  gap(
    "timeout-visible-and-not-cached-24h",
    timeoutRes.status === 200
      && timeoutJson.reason === KI_UNAVAILABLE
      && (timeoutJson.children ?? []).length === 0
      && callsAfterFirst === beforeTimeout + 1
      && callsAfterCache === beforeTimeout + 1
      && cachedRes.status === 200
      && laterRes.status === 200
      && calls.length === beforeTimeout + 2
      && timeoutMarkup.includes(KI_UNAVAILABLE),
    `status=${timeoutRes.status} reason=${timeoutJson.reason ?? timeoutJson.error ?? "null"} calls=${calls.length - beforeTimeout} after30s=${callsAfterCache - beforeTimeout}`,
  );
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n31: OK");
