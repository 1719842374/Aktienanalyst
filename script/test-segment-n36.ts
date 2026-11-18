/**
 * Fehlende Segmente/Regionen: generisch, an ein Elternsegment gehängt, Doppelungen weg.
 * Aufruf: npx tsx --tsconfig script/tsconfig.jsx.json script/test-segment-n36.ts
 */
import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import express from "express";
import { readFileSync } from "node:fs";
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

const fixtureIdentity = {
  companyName: "Tesla, Inc.",
  exchange: "NASDAQ",
  country: "US",
  sector: "Consumer Cyclical",
  industry: "Auto Manufacturers",
  description: "Tesla baut Fahrzeuge und Speicher.",
  fiscalYear: "2025",
  currency: "USD",
};

function keptChild(parent: string, name: string) {
  return {
    parent,
    name,
    owner: "Tesla, Inc.",
    brand: "",
    basis: "Software im Fahrzeug",
    source: "Tesla Annual Report 2025",
    shareOfParentPct: 8,
    growthPct: null,
  };
}

async function postGap(port: number, ticker: string) {
  const response = await fetch(`http://127.0.0.1:${port}/api/segment-gaps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  const json = await response.json() as {
    items?: { parent: string; name: string; shareOfParentPct: number | null; growthPct: number | null }[];
    reason?: string | null;
    error?: string;
  };
  return { status: response.status, json };
}

resetSegmentGapCacheForTests();
let emptyClock = 1_700_000_000_000;
let emptyCalls = 0;
let emptySec = 0;
const emptyApp = express();
emptyApp.use(express.json());
registerSegmentGapRoute(emptyApp, {
  now: () => emptyClock,
  available: () => true,
  productRows: async () => [],
  regionRows: async () => [],
  identity: async () => fixtureIdentity,
  secSegments: async () => {
    emptySec += 1;
    return null;
  },
  llm: async () => {
    emptyCalls += 1;
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "Tesla, Inc.",
        industryEcho: "Auto Manufacturers",
        children: [keptChild("Automotive", "FSD")],
      },
    };
  },
});
const emptyServer = emptyApp.listen(0);
const emptyPort = (emptyServer.address() as AddressInfo).port;
try {
  const first = await postGap(emptyPort, "EXA");
  const afterFirst = emptyCalls;
  const afterFirstSec = emptySec;
  const second = await postGap(emptyPort, "EXA");
  const afterSecond = emptyCalls;
  const afterSecondSec = emptySec;
  emptyClock += 61_000;
  const third = await postGap(emptyPort, "EXA");
  gap(
    "empty-200-fmp-error-shape-cached-60s",
    first.status === 200
      && (first.json.items?.length ?? -1) === 0
      && afterFirst === 1
      && afterFirstSec === 1
      && second.status === 200
      && afterSecond === 1
      && afterSecondSec === 1
      && third.status === 200
      && emptyCalls === 2
      && emptySec === 2,
    `status=${first.status}/${second.status}/${third.status} calls=${afterFirst},${afterSecond},${emptyCalls} sec=${afterFirstSec},${afterSecondSec},${emptySec} items=${first.json.items?.length ?? "fehl"}`,
  );
} finally {
  emptyServer.close();
}

resetSegmentGapCacheForTests();
let fullClock = 1_700_000_000_000;
let fullCalls = 0;
const fullApp = express();
fullApp.use(express.json());
registerSegmentGapRoute(fullApp, {
  now: () => fullClock,
  available: () => true,
  productRows: async () => [{ fiscalYear: "2025", data: { Automotive: 700 } }],
  regionRows: async () => [{ fiscalYear: "2025", data: { "United States": 400 } }],
  identity: async () => fixtureIdentity,
  llm: async () => {
    fullCalls += 1;
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "Tesla, Inc.",
        industryEcho: "Auto Manufacturers",
        children: [keptChild("Automotive", "FSD")],
      },
    };
  },
});
const fullServer = fullApp.listen(0);
const fullPort = (fullServer.address() as AddressInfo).port;
try {
  const first = await postGap(fullPort, "EXB");
  fullClock += 61_000;
  const withinDay = await postGap(fullPort, "EXB");
  const afterHour = fullCalls;
  fullClock += 24 * 60 * 60 * 1000;
  const nextDay = await postGap(fullPort, "EXB");
  gap(
    "nonempty-cached-24h",
    first.status === 200
      && (first.json.items?.length ?? 0) === 1
      && withinDay.status === 200
      && afterHour === 1
      && nextDay.status === 200
      && fullCalls === 2,
    `status=${first.status}/${withinDay.status}/${nextDay.status} calls=${afterHour},${fullCalls} items=${first.json.items?.length ?? "fehl"}`,
  );
} finally {
  fullServer.close();
}

resetSegmentGapCacheForTests();
let limitCalls = 0;
const limitApp = express();
limitApp.use(express.json());
registerSegmentGapRoute(limitApp, {
  available: () => true,
  productRows: async () => [],
  regionRows: async () => [],
  identity: async () => fixtureIdentity,
  secSegments: async () => null,
  llm: async () => {
    limitCalls += 1;
    return null;
  },
});
const limitServer = limitApp.listen(0);
const limitPort = (limitServer.address() as AddressInfo).port;
try {
  const statuses: number[] = [];
  for (let i = 0; i < 21; i++) statuses.push((await postGap(limitPort, "EXC")).status);
  gap(
    "rate-limit-429",
    statuses.slice(0, 20).every((status) => status === 503) && statuses[20] === 429 && limitCalls === 20,
    `statuses=${statuses.join(",")} calls=${limitCalls}`,
  );
} finally {
  limitServer.close();
}

resetSegmentGapCacheForTests();
let nameCursor = "Alpha";
let nameCalls = 0;
const namePrompts: string[] = [];
const nameApp = express();
nameApp.use(express.json());
registerSegmentGapRoute(nameApp, {
  available: () => true,
  productRows: async () => [{ fiscalYear: "2025", data: { [nameCursor]: 10 } }],
  regionRows: async () => [],
  identity: async () => fixtureIdentity,
  llm: async (opts) => {
    nameCalls += 1;
    namePrompts.push(opts.prompt);
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "Tesla, Inc.",
        industryEcho: "Auto Manufacturers",
        children: [keptChild(nameCursor, "FSD")],
      },
    };
  },
});
const nameServer = nameApp.listen(0);
const namePort = (nameServer.address() as AddressInfo).port;
try {
  const first = await postGap(namePort, "EXD");
  nameCursor = "Beta";
  const second = await postGap(namePort, "EXD");
  gap(
    "cache-key-follows-names-sent",
    first.status === 200 && second.status === 200 && nameCalls === 2 && (namePrompts[1] ?? "").includes("Beta"),
    `status=${first.status}/${second.status} calls=${nameCalls} second=${(namePrompts[1] ?? "").slice(0, 180)}`,
  );
} finally {
  nameServer.close();
}

const loadedGapRoute = await import("../server/segment-gap-route");
const segmentGapCacheKey = (loadedGapRoute as {
  segmentGapCacheKey?: (ticker: string, products: readonly string[], regions: readonly string[]) => string;
}).segmentGapCacheKey;
const keyA = segmentGapCacheKey ? segmentGapCacheKey("exa", ["Alpha"], ["North"]) : "";
const keyB = segmentGapCacheKey ? segmentGapCacheKey("exa", ["Beta"], ["North"]) : "";
const keyAgain = segmentGapCacheKey ? segmentGapCacheKey("exa", ["Alpha"], ["North"]) : "";
const keyRegion = segmentGapCacheKey ? segmentGapCacheKey("exa", [], ["Alpha"]) : "";
gap(
  "cache-key-version-and-name-hash",
  typeof segmentGapCacheKey === "function"
    && keyA.includes("n36-gap-p2")
    && keyA.includes("EXA")
    && keyA === keyAgain
    && keyA !== keyB
    && keyA !== keyRegion
    && !keyA.includes("Alpha"),
  `a=${keyA} b=${keyB} region=${keyRegion}`,
);

resetSegmentGapCacheForTests();
let secCalls = 0;
let secLlm = 0;
const secPrompts: string[] = [];
let secProducts: unknown[] = [];
const secApp = express();
secApp.use(express.json());
registerSegmentGapRoute(secApp, {
  available: () => true,
  productRows: async () => secProducts,
  regionRows: async () => [{ fiscalYear: "2025", data: { "United States": 400 } }],
  identity: async () => fixtureIdentity,
  secSegments: async () => {
    secCalls += 1;
    return { segments: [{ name: "Cloud", revenue: 10, percentage: 100 }] };
  },
  llm: async (opts) => {
    secLlm += 1;
    secPrompts.push(opts.prompt);
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "Tesla, Inc.",
        industryEcho: "Auto Manufacturers",
        children: [
          keptChild("Cloud", "Cloud"),
          keptChild("Cloud", "FSD"),
          keptChild("Cloud", "United States"),
          keptChild("Software", "FSD"),
        ],
      },
    };
  },
});
const secServer = secApp.listen(0);
const secPort = (secServer.address() as AddressInfo).port;
try {
  const first = await postGap(secPort, "EXE");
  const names = (first.json.items ?? []).map((item) => `${item.parent}/${item.name}`);
  const prompt = secPrompts[0] ?? "";
  gap(
    "sec-names-when-fmp-empty",
    secCalls === 1
      && prompt.includes("Cloud")
      && prompt.includes("United States")
      && names.includes("Cloud/FSD")
      && !names.includes("Cloud/Cloud")
      && !names.includes("Cloud/United States")
      && !names.some((name) => name.startsWith("Software/")),
    `sec=${secCalls} names=${names.join(",") || first.json.reason || ""} prompt=${prompt.slice(0, 240)}`,
  );
  secProducts = [{ fiscalYear: "2025", data: { Automotive: 700 } }];
  const second = await postGap(secPort, "EXF");
  gap(
    "sec-skipped-when-fmp-has-names",
    secCalls === 1 && second.status === 200 && secLlm === 2,
    `sec=${secCalls} status=${second.status} llm=${secLlm}`,
  );
} finally {
  secServer.close();
}

const routeSource = readFileSync(new URL("../server/segment-gap-route.ts", import.meta.url), "utf8");
gap("sec-reuses-fetchSecBusinessSegments", routeSource.includes("fetchSecBusinessSegments"), routeSource.includes("fetchSecBusinessSegments") ? "referenziert" : "Funktion nicht referenziert");

resetSegmentGapCacheForTests();
const leakApp = express();
leakApp.use(express.json());
registerSegmentGapRoute(leakApp, {
  available: () => true,
  identity: async () => {
    throw new Error("secret-upstream-detail");
  },
});
const leakServer = leakApp.listen(0);
const leakPort = (leakServer.address() as AddressInfo).port;
try {
  const leaked = await postGap(leakPort, "EXG");
  const raw = JSON.stringify(leaked.json);
  gap(
    "502-generic-na",
    leaked.status === 502 && !raw.includes("secret-upstream-detail") && (leaked.json.error ?? "").includes("n/a"),
    `status=${leaked.status} body=${raw}`,
  );
} finally {
  leakServer.close();
}

resetSegmentGapCacheForTests();
let capCursor = "Seg0";
let capCalls = 0;
const capApp = express();
capApp.use(express.json());
registerSegmentGapRoute(capApp, {
  available: () => true,
  productRows: async () => [{ fiscalYear: "2025", data: { [capCursor]: 10 } }],
  regionRows: async () => [],
  identity: async () => fixtureIdentity,
  rateLimit: { max: 500, windowMs: 60_000 },
  llm: async () => {
    capCalls += 1;
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "Tesla, Inc.",
        industryEcho: "Auto Manufacturers",
        children: [keptChild(capCursor, "FSD")],
      },
    };
  },
});
const capServer = capApp.listen(0);
const capPort = (capServer.address() as AddressInfo).port;
try {
  for (let i = 0; i < 401; i++) {
    capCursor = `Seg${i}`;
    await postGap(capPort, "EXH");
  }
  const afterFill = capCalls;
  capCursor = "Seg0";
  await postGap(capPort, "EXH");
  gap(
    "cache-capped-400",
    afterFill === 401 && capCalls === 402,
    `afterFill=${afterFill} calls=${capCalls}`,
  );
} finally {
  capServer.close();
}

if (gaps.length > 0) {
  console.error(`n36 FAIL ${gaps.length}`);
  process.exit(1);
}
console.log("n36 PASS");
