/**
 * Fehlende Segmente/Regionen: generisch, an ein Elternsegment gehängt, Doppelungen weg.
 * Aufruf: npx tsx --tsconfig script/tsconfig.jsx.json script/test-segment-n36.ts
 */
import React, { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import express from "express";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SegmentGapList, SegmentGapPanel, SegmentGapUnderParent, type GapRequest } from "../client/src/components/sections/SegmentGapPanel";
import { SegmentEstimateBlock } from "../client/src/components/sections/Section2";
import type { SegmentGapResult } from "../shared/segment-gap";
import { installFakeDom, findByTestId, reactPropsOf } from "./lib/fake-dom";
import { outlineEchoMatches } from "../shared/segment-children";
import { SEGMENT_GAP_MAX_CALLS, registerSegmentGapRoute, resetSegmentGapCacheForTests, segmentGapInflightForTests } from "../server/segment-gap-route";
import { applySegmentFx, convertSegmentRowsToUsd } from "../server/fmp";

delete process.env.OPENROUTER_API_KEY;
(globalThis as { React?: typeof React }).React = React;

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(name);
}

const hidden = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SegmentGapPanel, { ticker: "TSLA" })));
gap("toggle-starts-hidden", hidden.includes("Fehlende Segmente/Regionen anzeigen") && !hidden.includes("segment-gap-list"), hidden.slice(0, 200));

function GapHarness({ request }: { request: GapRequest }) {
  const [data, setData] = useState<SegmentGapResult | null>(null);
  return createElement(
    "div",
    null,
    createElement(
      "div",
      { "data-testid": "segment-row-Automotive" },
      "Automotive",
      createElement(SegmentGapUnderParent, {
        parent: "Automotive",
        kind: "product",
        items: data?.items ?? [],
      }),
    ),
    createElement(SegmentGapPanel, { ticker: "TSLA", request, onResult: setData }),
  );
}

const { doc } = installFakeDom();
const container = doc.createElement("div");
doc.body.appendChild(container);
const root = createRoot(container);
let posts = 0;
await act(async () => {
  root.render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(GapHarness, {
    request: async () => {
      posts += 1;
      return new Response(JSON.stringify({
        items: [{ parent: "Automotive", kind: "product", name: "FSD", shareOfParentPct: 8, growthPct: null, basis: "Tesla Annual Report 2025", shareOrigin: "estimate" }],
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
const rowText = findByTestId(container, "segment-row-Automotive")?.textContent ?? "";
const panelText = findByTestId(container, "segment-gaps")?.textContent ?? "";
const under = findByTestId(container, "segment-gap-under-Automotive");
const underClass = String((under ? reactPropsOf(under) : null)?.className ?? "");
gap(
  "toggle-shows-fsd",
  rowText.includes("FSD") && rowText.includes("8.0") && rowText.includes("n/a") && rowText.includes("KI-Schätzung") && !panelText.includes("FSD"),
  `row=${rowText.slice(0, 180)} panel=${panelText.slice(0, 120)}`,
);
gap(
  "rows-indented-under-parent",
  (under?.textContent ?? "").includes("FSD") && underClass.includes("pl-4") && !panelText.includes("segment-gap-list"),
  `class=${underClass || "fehlt"}`,
);
if (toggleProps?.onClick) {
  await act(async () => { toggleProps.onClick(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
gap("toggle-hides", !(findByTestId(container, "segment-row-Automotive")?.textContent ?? "").includes("FSD") && posts === 1, findByTestId(container, "segment-row-Automotive")?.textContent ?? "");
if (toggleProps?.onClick) {
  await act(async () => { toggleProps.onClick(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
gap(
  "second-open-no-request",
  posts === 1 && (findByTestId(container, "segment-row-Automotive")?.textContent ?? "").includes("FSD"),
  `posts=${posts} row=${findByTestId(container, "segment-row-Automotive")?.textContent ?? ""}`,
);
await act(async () => { root.unmount(); });

function switchData(ticker: string) {
  if (ticker === "MSFT") {
    return {
      ticker: "MSFT",
      revenueSegments: [{ name: "Intelligent Cloud", percentage: 50, revenue: 50 }],
      geoSegments: [{ name: "UNITED STATES", percentage: 60, revenue: 40 }],
    };
  }
  return {
    ticker: "TSLA",
    revenueSegments: [{ name: "Automotive", percentage: 73, revenue: 70 }],
    geoSegments: [{ name: "United States", percentage: 40, revenue: 40 }],
  };
}

function TickerSwitch({ ticker }: { ticker: string }) {
  return createElement(SegmentEstimateBlock, { data: switchData(ticker) as never });
}

const switchClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
switchClient.setQueryData(["/api/segment-growth", "TSLA"], { ticker: "TSLA", business: [], geographic: [], source: "fixture", currency: "USD" });
switchClient.setQueryData(["/api/segment-growth", "MSFT"], { ticker: "MSFT", business: [], geographic: [], source: "fixture", currency: "USD" });
let releaseMsft: () => void = () => {};
const msftGate = new Promise<void>((resolve) => { releaseMsft = resolve; });
const switchPosts: string[] = [];
const previousFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.includes("/api/segment-gaps")) return previousFetch(input, init);
  const payload = JSON.parse(String(init?.body ?? "{}")) as { ticker?: string; products?: { name?: string }[]; regions?: { name?: string }[] };
  const asked = payload.ticker ?? "";
  switchPosts.push(asked);
  const sentNames = [...(payload.products ?? []), ...(payload.regions ?? [])].map((row) => row.name ?? "");
  if (asked === "TSLA" && !sentNames.includes("Automotive")) {
    return new Response(JSON.stringify({ items: [], reason: "UI-Eltern fehlen" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (asked === "MSFT" && !sentNames.includes("UNITED STATES")) {
    return new Response(JSON.stringify({ items: [], reason: "UI-Eltern fehlen" }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (asked === "MSFT") {
    await msftGate;
    return new Response(JSON.stringify({
      items: [{ parent: "UNITED STATES", kind: "geographic", name: "US Operations", shareOfParentPct: 12, growthPct: null, basis: "Microsoft Annual Report 2025", shareOrigin: "estimate" }],
      reason: null,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({
    items: [{ parent: "Automotive", kind: "product", name: "FSD", shareOfParentPct: 8, growthPct: null, basis: "Tesla Annual Report 2025", shareOrigin: "estimate" }],
    reason: null,
  }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;
const switchContainer = doc.createElement("div");
doc.body.appendChild(switchContainer);
const switchRoot = createRoot(switchContainer);
let switchTicker = "TSLA";
const renderSwitch = () => {
  switchRoot.render(createElement(QueryClientProvider, { client: switchClient }, createElement(TickerSwitch, { ticker: switchTicker })));
};
try {
  await act(async () => { renderSwitch(); });
  const switchToggle = findByTestId(switchContainer, "segment-gap-toggle");
  const switchToggleProps = switchToggle ? reactPropsOf(switchToggle) : null;
  if (switchToggleProps?.onClick) {
    await act(async () => { switchToggleProps.onClick(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
  switchTicker = "MSFT";
  await act(async () => { renderSwitch(); });
  switchTicker = "TSLA";
  await act(async () => { renderSwitch(); });
  releaseMsft();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  const backAuto = findByTestId(switchContainer, "segment-gap-under-Automotive")?.textContent ?? "";
  const backUs = findByTestId(switchContainer, "segment-gap-under-United States")?.textContent ?? "";
  const backToggle = findByTestId(switchContainer, "segment-gap-toggle")?.textContent ?? "";
  gap(
    "ticker-switch-keeps-own-rows",
    backAuto.includes("FSD")
      && !backUs.includes("US Operations")
      && !backAuto.includes("US Operations")
      && backToggle.includes("ausblenden")
      && switchPosts.filter((ticker) => ticker === "TSLA").length === 1,
    `auto=${backAuto.slice(0, 160)} us=${backUs.slice(0, 160)} toggle=${backToggle} posts=${switchPosts.join(",")}`,
  );
} finally {
  await act(async () => { switchRoot.unmount(); });
  globalThis.fetch = previousFetch;
}

resetSegmentGapCacheForTests();
const prompts: string[] = [];
let llmCalls = 0;
let failAutomotive = true;
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
    const focus = /nur das Elternsegment "([^"]+)"/.exec(opts.prompt)?.[1] ?? "";
    if (failAutomotive && focus === "Automotive") {
      failAutomotive = false;
      const error = new Error("openrouter") as Error & { status?: number };
      error.status = 429;
      throw error;
    }
    if (focus === "Energy generation and storage") {
      return {
        modelUsed: "mock-model",
        data: {
          companyEcho: "Tesla, Inc.",
          industryEcho: "Auto Manufacturers",
          children: [{
            parent: focus,
            name: "Megapack",
            owner: "Tesla, Inc.",
            basis: "Speicher",
            source: "Tesla Annual Report 2025",
            shareOfParentPct: null,
            growthPct: null,
          }],
        },
      };
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
  const firstJson = await first.json() as { items?: { parent: string; name: string }[]; reason?: string };
  const firstNames = (firstJson.items ?? []).map((item) => `${item.parent}/${item.name}`);
  gap(
    "error-isolated-siblings-kept",
    first.status === 200
      && llmCalls === 3
      && /KI nicht erreichbar \(429\): Automotive/.test(firstJson.reason ?? "")
      && firstNames.includes("Energy generation and storage/Megapack"),
    `status=${first.status} calls=${llmCalls} names=${firstNames.join(",")} reason=${firstJson.reason ?? ""}`,
  );
  const second = await fetch(`http://127.0.0.1:${port}/api/segment-gaps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker: "TSLA" }),
  });
  const json = await second.json() as { items?: { parent: string; name: string; shareOfParentPct: number | null; growthPct: number | null }[]; reason?: string; error?: string };
  const prompt = prompts[1] ?? prompts[0] ?? "";
  gap("prompt-has-known-facts", prompt.includes("Automotive") && prompt.includes("United States") && prompt.includes("Tesla baut Fahrzeuge") && !prompt.includes("FSD"), prompt.slice(0, 360));
gap(
  "prompt-asks-unreported-lines",
  prompt.includes("Software") && prompt.includes("Services") && prompt.includes("Abos") && !prompt.includes("FSD") && !/\bTSLA\b/.test(prompt.split("Ticker")[0] ?? prompt),
  prompt.slice(0, 420),
);
  const names = (json.items ?? []).map((item) => `${item.parent}/${item.name}`);
  gap("keeps-fsd-under-automotive", names.includes("Automotive/FSD") && json.items?.find((item) => item.name === "FSD")?.shareOfParentPct == null && /Schätzung ohne Quelle: FSD/.test(json.reason ?? "") && json.items?.find((item) => item.name === "FSD")?.growthPct == null, JSON.stringify(json));
  gap("drops-echo-and-unknown-parent", !names.includes("Automotive/Automotive") && !names.includes("Automotive/United States") && !names.some((name) => name.startsWith("Software/")), names.join(",") || json.reason || "");
  gap(
    "partial-cache-retries-only-failed-parent",
    llmCalls === 4
      && prompts.slice(3).every((prompt) => prompt.includes('nur das Elternsegment "Automotive"'))
      && names.includes("Energy generation and storage/Megapack"),
    `calls=${llmCalls} prompts=${prompts.length} names=${names.join(",")}`,
  );
  const third = await fetch(`http://127.0.0.1:${port}/api/segment-gaps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker: "TSLA" }),
  });
  gap("success-cached", third.status === 200 && llmCalls === 4, `status=${third.status} calls=${llmCalls}`);
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

async function postGap(port: number, ticker: string, extra?: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${port}/api/segment-gaps`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker, ...(extra ?? {}) }),
  });
  const json = await response.json() as {
    items?: { parent: string; name: string; kind?: string; shareOfParentPct: number | null; growthPct: number | null; shareOrigin?: string | null; basis?: string; shareNote?: string | null }[];
    reason?: string | null;
    error?: string;
    promptVersion?: string | null;
    cached?: boolean;
    queried?: number | null;
    total?: number | null;
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
      && afterHour === 2
      && nextDay.status === 200
      && fullCalls === 4,
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
  segmentGapCacheKey?: (ticker: string, products: readonly string[], regions: readonly string[], revenues?: readonly (number | null)[]) => string;
}).segmentGapCacheKey;
const keyA = segmentGapCacheKey ? segmentGapCacheKey("exa", ["Alpha"], ["North"]) : "";
const keyB = segmentGapCacheKey ? segmentGapCacheKey("exa", ["Beta"], ["North"]) : "";
const keyAgain = segmentGapCacheKey ? segmentGapCacheKey("exa", ["Alpha"], ["North"]) : "";
const keyRegion = segmentGapCacheKey ? segmentGapCacheKey("exa", [], ["Alpha"]) : "";
const keyRevenue = segmentGapCacheKey ? segmentGapCacheKey("exa", ["Alpha"], ["North"], [100]) : "";
const keyRevenueNext = segmentGapCacheKey ? segmentGapCacheKey("exa", ["Alpha"], ["North"], [125]) : "";
gap(
  "cache-key-version-and-name-hash",
  typeof segmentGapCacheKey === "function"
    && keyA.includes("n36-gap-p10")
    && keyA.includes("EXA")
    && keyA === keyAgain
    && keyA !== keyB
    && keyA !== keyRegion
    && keyA !== keyRevenue
    && keyRevenue !== keyRevenueNext
    && !keyA.includes("Alpha"),
  `a=${keyA} b=${keyB} region=${keyRegion} rev=${keyRevenue}`,
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
    secCalls === 1 && second.status === 200 && secLlm === 4,
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

const realisticTsla = {
  companyEcho: "Tesla, Inc.",
  industryEcho: "Auto Manufacturers",
  children: [{
    parent: "Automotive",
    name: "FSD",
    owner: "Tesla, Inc.",
    shareOfParentPct: null,
    growthPct: null,
    basis: "FSD steckt in Automotive und ist im 10-K nicht separat ausgewiesen.",
    source: null,
  }],
};
gap(
  "filter-accepts-realistic-tsla",
  outlineEchoMatches(realisticTsla, "Tesla, Inc.", "Auto Manufacturers", "Consumer Cyclical") === true,
  "realistischer TSLA-Echo",
);
gap(
  "filter-rejects-foreign-company",
  outlineEchoMatches(
    { ...realisticTsla, companyEcho: "Ford Motor Company" },
    "Tesla, Inc.",
    "Auto Manufacturers",
    "Consumer Cyclical",
  ) === false,
  "Ford-Echo",
);

const unsourcedRow = renderToStaticMarkup(createElement(SegmentGapList, {
  data: {
    items: [{
      parent: "Automotive",
      kind: "product",
      name: "FSD",
      shareOfParentPct: null,
      growthPct: null,
      basis: "nicht separat ausgewiesen",
    }],
    reason: null,
  },
}));
gap(
  "unsourced-fsd-shows-phrase",
  unsourcedRow.includes("FSD")
    && unsourcedRow.includes("n/a — ohne Quelle")
    && unsourcedRow.includes("KI-Schätzung")
    && unsourcedRow.includes("pl-4")
    && !unsourcedRow.includes("0.0 %")
    && !unsourcedRow.includes("Automotive / FSD"),
  unsourcedRow,
);

const estimateMarkup = renderToStaticMarkup(createElement(SegmentGapUnderParent, {
  parent: "Automotive",
  kind: "product",
  items: [{
    parent: "Automotive",
    kind: "product",
    name: "FSD",
    shareOfParentPct: 8,
    growthPct: null,
    basis: "Tesla Annual Report 2025",
    shareOrigin: "estimate",
  }],
}));
const factMarkup = renderToStaticMarkup(createElement(SegmentGapUnderParent, {
  parent: "Energy Generation and Storage",
  kind: "product",
  items: [{
    parent: "Energy Generation and Storage",
    kind: "product",
    name: "Megapack",
    shareOfParentPct: 25,
    growthPct: null,
    basis: "Tesla Annual Report 2025 · Formel: 25 / 100",
    shareOrigin: "fact",
  }],
}));
gap(
  "estimate-share-is-violet",
  estimateMarkup.includes("text-violet-700")
    && estimateMarkup.includes("data-testid=\"segment-gap-share\"")
    && estimateMarkup.includes("8.0 %")
    && estimateMarkup.includes("overflow-x-hidden")
    && estimateMarkup.includes("flex-wrap")
    && estimateMarkup.includes("break-words"),
  estimateMarkup,
);
gap(
  "fact-share-shows-formula",
  factMarkup.includes("25.0 %")
    && factMarkup.includes("Formel: 25 / 100")
    && factMarkup.includes("KI-Schätzung")
    && !factMarkup.includes("font-mono text-violet-700"),
  factMarkup,
);

const sectionSource = readFileSync(new URL("../client/src/components/sections/Section2.tsx", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../client/src/components/sections/SegmentGapPanel.tsx", import.meta.url), "utf8");
gap(
  "section-indents-under-parent",
  sectionSource.includes("<SegmentGapUnderParent parent={seg.name} kind=\"product\"")
    && sectionSource.includes("<SegmentGapUnderParent parent={seg.name} kind=\"geographic\"")
    && !panelSource.includes("<SegmentGapList"),
  "Section2 hängt die Zeile an die Elternzeile",
);

const echoFirms = [
  { ticker: "TSLA", companyName: "Tesla, Inc.", sector: "Consumer Cyclical", industry: "Auto Manufacturers", parent: "Automotive" },
  { ticker: "SAP.DE", companyName: "SAP SE", sector: "Technology", industry: "Software - Application", parent: "Applications" },
  { ticker: "MSFT", companyName: "Microsoft Corporation", sector: "Technology", industry: "Software - Infrastructure", parent: "Intelligent Cloud" },
];

resetSegmentGapCacheForTests();
const echoApp = express();
echoApp.use(express.json());
registerSegmentGapRoute(echoApp, {
  available: () => true,
  productRows: async (ticker) => {
    const firm = echoFirms.find((row) => row.ticker.toUpperCase() === ticker.toUpperCase());
    return [{ fiscalYear: "2025", data: { [firm?.parent ?? "Seg"]: 100 } }];
  },
  regionRows: async () => [{ fiscalYear: "2025", data: { "United States": 40 } }],
  identity: async (ticker) => {
    const firm = echoFirms.find((row) => row.ticker.toUpperCase() === ticker.toUpperCase());
    if (!firm) return null;
    return {
      companyName: firm.companyName,
      exchange: "X",
      country: "US",
      sector: firm.sector,
      industry: firm.industry,
      description: "Profil",
      fiscalYear: "2025",
      currency: "USD",
    };
  },
  llm: async (opts) => {
    const match = opts.prompt.match(/"companyEcho":"([^"]*)","industryEcho":"([^"]*)"/);
    const firm = echoFirms.find((row) => opts.prompt.includes(`Ticker ${row.ticker}.`));
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: match?.[1] ?? "",
        industryEcho: match?.[2] ?? "",
        children: [{
          parent: firm?.parent ?? "Automotive",
          name: "FSD",
          owner: match?.[1] ?? "",
          shareOfParentPct: null,
          growthPct: null,
          basis: "nicht separat ausgewiesen",
          source: null,
        }],
      },
    };
  },
});
const echoServer = echoApp.listen(0);
const echoPort = (echoServer.address() as AddressInfo).port;
try {
  const missed: string[] = [];
  for (const firm of echoFirms) {
    const response = await postGap(echoPort, firm.ticker);
    const item = response.json.items?.find((row) => row.name === "FSD");
    const kept = response.status === 200
      && item?.parent === firm.parent
      && item.shareOfParentPct == null
      && item.growthPct == null
      && !/passt nicht/.test(response.json.reason ?? "");
    if (!kept) missed.push(`${firm.ticker}:${response.json.reason ?? JSON.stringify(response.json.items ?? [])}`);
  }
  gap("accepts-template-echo-for-tsla-sap-msft", missed.length === 0, missed.join(" | ") || "ok");
} finally {
  echoServer.close();
}

resetSegmentGapCacheForTests();
const foreignApp = express();
foreignApp.use(express.json());
registerSegmentGapRoute(foreignApp, {
  available: () => true,
  productRows: async () => [{ fiscalYear: "2025", data: { Automotive: 700 } }],
  regionRows: async () => [],
  identity: async () => fixtureIdentity,
  llm: async () => ({
    modelUsed: "mock-model",
    data: {
      companyEcho: "Ford Motor Company",
      industryEcho: "Auto Manufacturers",
      children: [{
        parent: "Automotive",
        name: "FSD",
        owner: "Ford Motor Company",
        shareOfParentPct: 8,
        growthPct: null,
        basis: "fremde Firma",
        source: "Ford Annual Report 2025",
      }],
    },
  }),
});
const foreignServer = foreignApp.listen(0);
const foreignPort = (foreignServer.address() as AddressInfo).port;
try {
  const foreign = await postGap(foreignPort, "EXI");
  gap(
    "route-rejects-foreign-company-echo",
    foreign.status === 200
      && (foreign.json.items?.length ?? 1) === 0
      && /passt nicht zur Firma/.test(foreign.json.reason ?? ""),
    foreign.json.reason ?? JSON.stringify(foreign.json.items ?? []),
  );
} finally {
  foreignServer.close();
}

function citedChild(
  parent: string,
  name: string,
  owner: string,
  extra: Record<string, unknown> = {},
) {
  return {
    parent,
    name,
    owner,
    brand: "",
    basis: "im Elternsegment, nicht separat ausgewiesen",
    source: `${owner} Annual Report 2025`,
    shareOfParentPct: null,
    growthPct: null,
    ...extra,
  };
}

resetSegmentGapCacheForTests();
const bindPrompts: string[] = [];
const bindApp = express();
bindApp.use(express.json());
registerSegmentGapRoute(bindApp, {
  available: () => true,
  productRows: async (ticker) => {
    if (ticker.toUpperCase() === "TSLA") {
      return [{ fiscalYear: "2025", data: { Automotive: 400, "Energy Generation and Storage": 100 } }];
    }
    if (ticker.toUpperCase() === "MSFT") {
      return [{ fiscalYear: "2025", data: { "Intelligent Cloud": 80 } }];
    }
    return [{ fiscalYear: "2025", data: { Cloud: 50, "Software support": 30, Services: 20 } }];
  },
  regionRows: async (ticker) => {
    if (ticker.toUpperCase() === "TSLA") return [{ fiscalYear: "2025", data: { "United States": 250, China: 80 } }];
    if (ticker.toUpperCase() === "MSFT") return [{ fiscalYear: "2025", data: { "UNITED STATES": 40, EMEA: 30 } }];
    return [{ fiscalYear: "2025", data: { EMEA: 40 } }];
  },
  identity: async (ticker) => {
    const upper = ticker.toUpperCase();
    if (upper === "MSFT") {
      return {
        companyName: "Microsoft Corporation",
        exchange: "NASDAQ",
        country: "US",
        sector: "Technology",
        industry: "Software - Infrastructure",
        description: "Microsoft verkauft Software und Cloud.",
        fiscalYear: "2025",
        currency: "USD",
      };
    }
    if (upper === "SAP.DE") {
      return {
        companyName: "SAP SE",
        exchange: "XETRA",
        country: "DE",
        sector: "Technology",
        industry: "Software - Application",
        description: "SAP verkauft Unternehmenssoftware.",
        fiscalYear: "2025",
        currency: "EUR",
      };
    }
    return fixtureIdentity;
  },
  llm: async (opts) => {
    bindPrompts.push(opts.prompt);
    if (opts.prompt.includes("Ticker TSLA.")) {
      return {
        modelUsed: "mock-model",
        data: {
          companyEcho: "Tesla, Inc.",
          industryEcho: "Auto Manufacturers",
          children: [
            citedChild("Automotive", "FSD", "Tesla, Inc.", { source: "Tesla Annual Report 2025", shareOfParentPct: 8 }),
            citedChild("Automotive", "Mexico", "Tesla, Inc.", { source: "Tesla Annual Report 2025" }),
            citedChild("Automotive", "Germany", "Tesla, Inc.", { source: "Tesla Annual Report 2025" }),
            citedChild("Automotive", "India", "Tesla, Inc.", { source: "Tesla Annual Report 2025" }),
            citedChild("Energy Generation and Storage", "Megapack", "Tesla, Inc.", { source: "Tesla Annual Report 2025", revenue: 25, currency: "USD" }),
            citedChild("Automotive", "Robotaxi", "Tesla, Inc.", { source: null, revenue: 40, basis: "Pilot ohne Beleg" }),
            citedChild("Automotive", "Optimus", "Tesla, Inc.", { source: "Tesla Annual Report 2025", shareOfParentPct: 0 }),
          ],
        },
      };
    }
    if (opts.prompt.includes("Ticker MSFT.")) {
      return {
        modelUsed: "mock-model",
        data: {
          companyEcho: "Microsoft Corporation",
          industryEcho: "Software - Infrastructure",
          children: [
            citedChild("UNITED STATES", "EMEA", "Microsoft Corporation"),
            citedChild("UNITED STATES", "Asia Pacific", "Microsoft Corporation"),
            citedChild("EMEA", "Germany", "Microsoft Corporation", { shareOfParentPct: 12 }),
            citedChild("Intelligent Cloud", "Azure", "Microsoft Corporation", { shareOfParentPct: 11 }),
          ],
        },
      };
    }
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "SAP SE",
        industryEcho: "Software - Application",
        children: [
          citedChild("S/4HANA", "RISE", "SAP SE"),
          citedChild("SuccessFactors", "Employee Central", "SAP SE"),
          citedChild("Cloud", "Business Technology Platform", "SAP SE", { shareOfParentPct: 12 }),
        ],
      },
    };
  },
});
const bindServer = bindApp.listen(0);
const bindPort = (bindServer.address() as AddressInfo).port;
try {
  const tsla = await postGap(bindPort, "TSLA");
  const tslaNames = (tsla.json.items ?? []).map((item) => `${item.kind ?? "?"}:${item.parent}/${item.name}`);
  const fsd = tsla.json.items?.find((item) => item.name === "FSD");
  const megapack = tsla.json.items?.find((item) => item.name === "Megapack");
  const robotaxi = tsla.json.items?.find((item) => item.name === "Robotaxi");
  const optimus = tsla.json.items?.find((item) => item.name === "Optimus");
  const tslaPrompt = bindPrompts.find((prompt) => prompt.includes("Ticker TSLA.")) ?? "";
  gap(
    "tsla-product-child-not-country",
    tsla.status === 200
      && tslaNames.includes("product:Automotive/FSD")
      && fsd?.shareOfParentPct == null
      && /Schätzung ohne Quelle: FSD/.test(tsla.json.reason ?? "")
      && !tslaNames.some((name) => name.endsWith("/Mexico") || name.endsWith("/Germany") || name.endsWith("/India"))
      && /nicht als Produkt-Unterposten: Mexico/.test(tsla.json.reason ?? "")
      && /nicht als Produkt-Unterposten: Germany/.test(tsla.json.reason ?? "")
      && /nicht als Produkt-Unterposten: India/.test(tsla.json.reason ?? "")
      && tslaPrompt.includes("Automotive")
      && tslaPrompt.includes("United States")
      && !tslaPrompt.includes("FSD"),
    `names=${tslaNames.join(",")} reason=${tsla.json.reason ?? ""}`,
  );
  gap(
    "tsla-share-from-facts-or-na",
    megapack?.shareOfParentPct === 25
      && megapack.shareOrigin === "fact"
      && (megapack.basis ?? "").includes("Formel: 25 / 100")
      && tslaPrompt.includes("Energy Generation and Storage 100 USD")
      && tslaPrompt.includes("Währung der Elternumsätze: USD.")
      && robotaxi?.shareOfParentPct == null
      && !(robotaxi?.basis ?? "").includes("Formel")
      && optimus?.shareOfParentPct == null
      && /Anteil 0 verworfen: Optimus/.test(tsla.json.reason ?? ""),
    `megapack=${JSON.stringify(megapack)} robotaxi=${JSON.stringify(robotaxi)} optimus=${JSON.stringify(optimus)} reason=${tsla.json.reason ?? ""}`,
  );
  const msft = await postGap(bindPort, "MSFT");
  const msftNames = (msft.json.items ?? []).map((item) => `${item.kind ?? "?"}:${item.parent}/${item.name}`);
  const germany = msft.json.items?.find((item) => item.name === "Germany");
  const azure = msft.json.items?.find((item) => item.name === "Azure");
  gap(
    "msft-region-not-under-united-states",
    msft.status === 200
      && !msftNames.some((name) => name.includes("UNITED STATES/EMEA") || name.includes("UNITED STATES/Asia Pacific"))
      && /passt nicht unter UNITED STATES: EMEA/.test(msft.json.reason ?? "")
      && /passt nicht unter UNITED STATES: Asia Pacific/.test(msft.json.reason ?? "")
      && germany?.parent === "EMEA"
      && germany.kind === "geographic"
      && germany.shareOfParentPct == null
      && /Schätzung ohne Quelle: Germany/.test(msft.json.reason ?? "")
      && azure?.parent === "Intelligent Cloud"
      && azure.kind === "product",
    `names=${msftNames.join(",")} reason=${msft.json.reason ?? ""}`,
  );
  const sap = await postGap(bindPort, "SAP.DE");
  const sapNames = (sap.json.items ?? []).map((item) => `${item.parent}/${item.name}`);
  const sapPrompt = bindPrompts.find((prompt) => prompt.includes("Ticker SAP.DE.")) ?? "";
  const platform = sap.json.items?.find((item) => item.name === "Business Technology Platform");
  gap(
    "sap-parent-binds-to-fmp-names",
    sap.status === 200
      && sapNames.length === 1
      && platform?.parent === "Cloud"
      && platform.shareOfParentPct == null
      && /Schätzung ohne Quelle: Business Technology Platform/.test(sap.json.reason ?? "")
      && /Elternsegment nicht in der Liste: RISE/.test(sap.json.reason ?? "")
      && /Elternsegment nicht in der Liste: Employee Central/.test(sap.json.reason ?? "")
      && sapPrompt.includes("Cloud")
      && sapPrompt.includes("Software support")
      && !sapPrompt.includes("S/4HANA")
      && !sapPrompt.includes("SuccessFactors"),
    `names=${sapNames.join(",")} reason=${sap.json.reason ?? ""} prompt=${sapPrompt.slice(0, 280)}`,
  );
} finally {
  bindServer.close();
}

resetSegmentGapCacheForTests();
const fxPrompts: string[] = [];
const fxApp = express();
fxApp.use(express.json());
registerSegmentGapRoute(fxApp, {
  available: () => true,
  productRows: async (ticker) => {
    if (ticker.toUpperCase() === "NVO") {
      return [{ fiscalYear: "2025", reportedCurrency: "DKK", data: { "Diabetes and Obesity care": 500 } }];
    }
    return [{ fiscalYear: "2025", reportedCurrency: "SEK", data: { Networks: 200 } }];
  },
  regionRows: async () => [],
  convertSegments: async (rows) => {
    const currency = (rows.find((row) => row.reportedCurrency)?.reportedCurrency ?? "").toUpperCase();
    if (currency === "DKK") return applySegmentFx(rows, 0.2, currency);
    if (currency === "SEK") return applySegmentFx(rows, 1, currency);
    return convertSegmentRowsToUsd(rows);
  },
  identity: async (ticker) => {
    if (ticker.toUpperCase() === "NVO") {
      return {
        companyName: "Novo Nordisk",
        exchange: "NYSE",
        country: "DK",
        sector: "Healthcare",
        industry: "Biotechnology",
        description: "Novo Nordisk verkauft Medikamente.",
        fiscalYear: "2025",
        currency: "DKK",
      };
    }
    return {
      companyName: "Ericsson",
      exchange: "NASDAQ",
      country: "SE",
      sector: "Technology",
      industry: "Communication Equipment",
      description: "Ericsson baut Netze.",
      fiscalYear: "2025",
      currency: "SEK",
    };
  },
  llm: async (opts) => {
    fxPrompts.push(opts.prompt);
    if (opts.prompt.includes("Ticker NVO.")) {
      return {
        modelUsed: "mock-model",
        data: {
          companyEcho: "Novo Nordisk",
          industryEcho: "Biotechnology",
          children: [
            citedChild("Diabetes and Obesity care", "Wegovy", "Novo Nordisk", {
              source: "Novo Nordisk Annual Report 2025",
              revenue: 25,
              currency: "USD",
            }),
            citedChild("Diabetes and Obesity care", "Rybelsus", "Novo Nordisk", {
              source: "Novo Nordisk Annual Report 2025",
              revenue: 25,
              currency: "DKK",
            }),
          ],
        },
      };
    }
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "Ericsson",
        industryEcho: "Communication Equipment",
        children: [
          citedChild("Networks", "Radio", "Ericsson", {
            source: "Ericsson Annual Report 2025",
            revenue: 40,
            currency: "USD",
          }),
        ],
      },
    };
  },
});
const fxServer = fxApp.listen(0);
const fxPort = (fxServer.address() as AddressInfo).port;
try {
  const nvo = await postGap(fxPort, "NVO", { products: [{ name: "Diabetes and Obesity care", revenue: 500 }] });
  const wegovy = nvo.json.items?.find((item) => item.name === "Wegovy");
  const rybelsus = nvo.json.items?.find((item) => item.name === "Rybelsus");
  const nvoPrompt = fxPrompts.find((prompt) => prompt.includes("Ticker NVO.")) ?? "";
  gap(
    "nvo-dkk-fact-share-in-usd",
    nvo.status === 200
      && wegovy?.shareOfParentPct === 25
      && wegovy.shareOrigin === "fact"
      && (wegovy.basis ?? "").includes("Formel: 25 / 100")
      && rybelsus?.shareOfParentPct == null
      && /Währung passt nicht zur Elternzeile: Rybelsus/.test(nvo.json.reason ?? "")
      && nvoPrompt.includes("Diabetes and Obesity care 100 USD")
      && nvoPrompt.includes("Währung der Elternumsätze: USD.")
      && !nvoPrompt.includes("500"),
    `wegovy=${JSON.stringify(wegovy)} rybelsus=${JSON.stringify(rybelsus)} reason=${nvo.json.reason ?? ""} prompt=${nvoPrompt}`,
  );
  const missing = await postGap(fxPort, "ERIC");
  const radio = missing.json.items?.find((item) => item.name === "Radio");
  const ericPrompt = fxPrompts.find((prompt) => prompt.includes("Ticker ERIC.")) ?? "";
  gap(
    "missing-fx-share-is-na",
    missing.status === 200
      && radio?.shareOfParentPct == null
      && radio?.shareOrigin !== "fact"
      && /n\/a — FX SEKUSD fehlt, kein Faktor 1/.test(missing.json.reason ?? "")
      && /n\/a — FX SEKUSD fehlt, kein Faktor 1/.test(ericPrompt)
      && !ericPrompt.includes("200 USD"),
    `radio=${JSON.stringify(radio)} reason=${missing.json.reason ?? ""} prompt=${ericPrompt}`,
  );
} finally {
  fxServer.close();
}

resetSegmentGapCacheForTests();
const identityFxPrompts: string[] = [];
const identityFxApp = express();
identityFxApp.use(express.json());
registerSegmentGapRoute(identityFxApp, {
  available: () => true,
  productRows: async (ticker) => {
    if (ticker.toUpperCase() === "NVO") {
      return [{ fiscalYear: "2025", data: { "Diabetes and Obesity care": 500 } }];
    }
    return [{ fiscalYear: "2025", data: { Networks: 200 } }];
  },
  regionRows: async () => [],
  convertSegments: async (rows) => {
    const currency = (rows.find((row) => row.reportedCurrency)?.reportedCurrency ?? "").toUpperCase();
    if (currency === "DKK") return applySegmentFx(rows, 0.2, currency);
    if (!currency) return rows.map((row) => ({ ...row, fxNaReason: "n/a — Währung fehlt" }));
    return convertSegmentRowsToUsd(rows);
  },
  identity: async (ticker) => {
    if (ticker.toUpperCase() === "NVO") {
      return {
        companyName: "Novo Nordisk",
        exchange: "NYSE",
        country: "DK",
        sector: "Healthcare",
        industry: "Biotechnology",
        description: "Novo Nordisk verkauft Medikamente.",
        fiscalYear: "2025",
        currency: "DKK",
      };
    }
    return {
      companyName: "Acme Networks",
      exchange: "NASDAQ",
      country: "US",
      sector: "Technology",
      industry: "Communication Equipment",
      description: "Acme baut Netze.",
      fiscalYear: "2025",
      currency: "",
    };
  },
  llm: async (opts) => {
    identityFxPrompts.push(opts.prompt);
    if (opts.prompt.includes("Ticker NVO.")) {
      return {
        modelUsed: "mock-model",
        data: {
          companyEcho: "Novo Nordisk",
          industryEcho: "Biotechnology",
          children: [
            citedChild("Diabetes and Obesity care", "Wegovy", "Novo Nordisk", {
              source: "Novo Nordisk Annual Report 2025",
              revenue: 25,
              currency: "USD",
            }),
          ],
        },
      };
    }
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "Acme Networks",
        industryEcho: "Communication Equipment",
        children: [
          citedChild("Networks", "Radio", "Acme Networks", {
            source: "Acme Networks Annual Report 2025",
            revenue: 40,
            currency: "USD",
          }),
        ],
      },
    };
  },
});
const identityFxServer = identityFxApp.listen(0);
const identityFxPort = (identityFxServer.address() as AddressInfo).port;
try {
  const nvo = await postGap(identityFxPort, "NVO");
  const wegovy = nvo.json.items?.find((item) => item.name === "Wegovy");
  const nvoPrompt = identityFxPrompts.find((prompt) => prompt.includes("Ticker NVO.")) ?? "";
  gap(
    "nvo-identity-currency-without-reported",
    nvo.status === 200
      && wegovy?.shareOfParentPct === 25
      && wegovy.shareOrigin === "fact"
      && nvoPrompt.includes("Diabetes and Obesity care 100 USD")
      && !nvoPrompt.includes("500"),
    `wegovy=${JSON.stringify(wegovy)} prompt=${nvoPrompt}`,
  );
  const bare = await postGap(identityFxPort, "ACME");
  const radio = bare.json.items?.find((item) => item.name === "Radio");
  const barePrompt = identityFxPrompts.find((prompt) => prompt.includes("Ticker ACME.")) ?? "";
  gap(
    "missing-currency-is-na",
    bare.status === 200
      && radio?.shareOfParentPct == null
      && radio?.shareOrigin !== "fact"
      && /Währung fehlt/.test(bare.json.reason ?? "")
      && /Währung fehlt/.test(barePrompt)
      && !barePrompt.includes("200 USD"),
    `radio=${JSON.stringify(radio)} reason=${bare.json.reason ?? ""} prompt=${barePrompt}`,
  );
} finally {
  identityFxServer.close();
}

resetSegmentGapCacheForTests();
const shownPrompts: string[] = [];
const shownApp = express();
shownApp.use(express.json());
const uiProducts = {
  TSLA: [
    { name: "Automotive", revenue: 69_530_000_000 },
    { name: "Energy Generation & Storage", revenue: 12_770_000_000 },
    { name: "Services & Other", revenue: 12_538_000_000 },
  ],
  MSFT: [
    { name: "Server", revenue: 97_000_000_000 },
    { name: "Microsoft 365 Commercial", revenue: 80_000_000_000 },
    { name: "XBOX", revenue: 21_000_000_000 },
    { name: "LinkedIn", revenue: 16_000_000_000 },
    { name: "Windows and Devices", revenue: 17_000_000_000 },
    { name: "Search advertising", revenue: 13_000_000_000 },
    { name: "Microsoft 365 Consumer", revenue: 7_000_000_000 },
    { name: "Dynamics", revenue: 7_000_000_000 },
  ],
};
registerSegmentGapRoute(shownApp, {
  available: () => true,
  productRows: async (ticker) => {
    if (ticker.toUpperCase() === "TSLA") {
      return [{
        fiscalYear: "2025",
        reportedCurrency: "USD",
        data: { Automotive: 100, "Energy Generation and Storage": 80, "Services and Other": 100, "Model 3": 10 },
      }];
    }
    return [{
      fiscalYear: "2025",
      reportedCurrency: "USD",
      data: {
        "Intelligent Cloud": 100,
        "Productivity And Business Processes": 80,
        "More Personal Computing": 50,
        "Server products and cloud services": 90,
        Gaming: 20,
      },
    }];
  },
  regionRows: async () => [],
  identity: async (ticker) => {
    if (ticker.toUpperCase() === "MSFT") {
      return {
        companyName: "Microsoft Corporation",
        exchange: "NASDAQ",
        country: "US",
        sector: "Technology",
        industry: "Software - Infrastructure",
        description: "Microsoft verkauft Software.",
        fiscalYear: "2025",
        currency: "USD",
      };
    }
    return fixtureIdentity;
  },
  llm: async (opts) => {
    shownPrompts.push(opts.prompt);
    if (opts.prompt.includes("Ticker MSFT.")) {
      return {
        modelUsed: "mock-model",
        data: {
          companyEcho: "Microsoft Corporation",
          industryEcho: "Software - Infrastructure",
          children: [
            citedChild("Server", "Azure", "Microsoft Corporation", {
              source: "Microsoft Annual Report 2025",
              shareOfParentPct: 99,
              revenue: 27,
              currency: "USD",
            }),
            citedChild("Intelligent Cloud", "Azure Legacy", "Microsoft Corporation", {
              source: "Microsoft Annual Report 2025",
              shareOfParentPct: 10,
            }),
          ],
        },
      };
    }
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "Tesla, Inc.",
        industryEcho: "Auto Manufacturers",
        children: [
          {
            parent: "Services & Other",
            name: "Software-Abo",
            owner: "Tesla, Inc.",
            shareOfParentPct: null,
            revenue: null,
            currency: "USD",
            basis: "Software-Abo ist nicht separat ausgewiesen",
            source: null,
          },
          citedChild("Automotive", "Robotaxi", "Tesla, Inc.", { shareOfParentPct: 4, source: null, basis: "Pilot ohne Beleg" }),
        ],
      },
    };
  },
});
const shownServer = shownApp.listen(0);
const shownPort = (shownServer.address() as AddressInfo).port;
try {
  const tsla = await postGap(shownPort, "TSLA", { products: uiProducts.TSLA, regions: [] });
  const fsd = tsla.json.items?.find((item) => item.name === "Software-Abo");
  const robotaxi = tsla.json.items?.find((item) => item.name === "Robotaxi");
  const servicePrompt = shownPrompts.find((prompt) => prompt.includes('nur das Elternsegment "Services & Other"')) ?? "";
  const parentCalls = uiProducts.TSLA.every((row) => shownPrompts.some((prompt) => prompt.includes(`nur das Elternsegment "${row.name}"`)));
  gap(
    "tsla-fsd-under-shown-services",
    tsla.status === 200
      && parentCalls
      && servicePrompt.includes("Software, Services und Abos")
      && fsd?.parent === "Services & Other"
      && fsd.shareOfParentPct == null
      && fsd.shareNote === "n/a — Schätzung ohne Quelle"
      && /Schätzung ohne Quelle: Software-Abo/.test(tsla.json.reason ?? "")
      && robotaxi?.shareOfParentPct == null
      && /ohne Quelle: Robotaxi/.test(tsla.json.reason ?? "")
      && !servicePrompt.includes("FSD")
      && tsla.json.promptVersion === "n36-gap-p10"
      && tsla.json.cached === false,
    `fsd=${JSON.stringify(fsd)} robotaxi=${JSON.stringify(robotaxi)} reason=${tsla.json.reason ?? ""} prompt=${servicePrompt.slice(0, 500)}`,
  );
  const again = await postGap(shownPort, "TSLA", { products: uiProducts.TSLA, regions: [] });
  gap(
    "gap-response-marks-cache",
    again.status === 200 && again.json.cached === true && again.json.promptVersion === "n36-gap-p10",
    `cached=${String(again.json.cached)} version=${String(again.json.promptVersion)}`,
  );
  const msft = await postGap(shownPort, "MSFT", { products: uiProducts.MSFT, regions: [] });
  const azure = msft.json.items?.find((item) => item.name === "Azure");
  const legacy = msft.json.items?.find((item) => item.name === "Azure Legacy");
  const msftPrompt = shownPrompts.find((prompt) => prompt.includes("Ticker MSFT.")) ?? "";
  gap(
    "msft-items-use-shown-parents",
    msft.status === 200
      && azure?.parent === "Server"
      && azure.shareOfParentPct === 30
      && azure.shareOrigin === "fact"
      && (azure.basis ?? "").includes("Formel: 27 / 90")
      && legacy == null
      && /Elternsegment nicht in der Liste: Azure Legacy/.test(msft.json.reason ?? "")
      && msftPrompt.includes("Server")
      && msftPrompt.includes("Microsoft 365 Commercial")
      && msftPrompt.includes("XBOX")
      && !msftPrompt.includes("Intelligent Cloud"),
    `azure=${JSON.stringify(azure)} legacy=${JSON.stringify(legacy)} reason=${msft.json.reason ?? ""} prompt=${msftPrompt.slice(0, 400)}`,
  );
} finally {
  shownServer.close();
}

resetSegmentGapCacheForTests();
let fitCalls = 0;
const fitParents = [
  { name: "Automotive", revenue: 69_530_000_000 },
  { name: "Energy Generation & Storage", revenue: 12_770_000_000 },
  { name: "Services & Other", revenue: 12_538_000_000 },
];
const fitRegions = [
  { name: "United States", revenue: 41_200_000_000 },
  { name: "China", revenue: 20_900_000_000 },
];
const fitApp = express();
fitApp.use(express.json());
registerSegmentGapRoute(fitApp, {
  available: () => true,
  productRows: async () => [{ fiscalYear: "2025", reportedCurrency: "USD", data: { Automotive: 100, "Energy Generation and Storage": 80, "Services and Other": 70 } }],
  regionRows: async () => [{ fiscalYear: "2025", reportedCurrency: "USD", data: { "United States": 60, China: 40 } }],
  identity: async () => fixtureIdentity,
  llm: async () => {
    fitCalls += 1;
    return { modelUsed: "mock-model", data: { companyEcho: "Tesla, Inc.", industryEcho: "Auto Manufacturers", children: [] } };
  },
});
const fitServer = fitApp.listen(0);
const fitPort = (fitServer.address() as AddressInfo).port;
try {
  const fit = await postGap(fitPort, "TSLA", { products: fitParents, regions: fitRegions });
  gap(
    "tsla-fits-call-limit",
    fitParents.length + 1 <= SEGMENT_GAP_MAX_CALLS
      && fit.status === 200
      && fitCalls === fitParents.length + 1
      && fit.json.queried === fitParents.length + 1
      && fit.json.total === fitParents.length + 1
      && !/nicht abgefragt \(Call-Limit\)/.test(fit.json.reason ?? ""),
    `limit=${SEGMENT_GAP_MAX_CALLS} parents=${fitParents.length} calls=${fitCalls} queried=${fit.json.queried} total=${fit.json.total} reason=${fit.json.reason ?? ""}`,
  );
} finally {
  fitServer.close();
}

resetSegmentGapCacheForTests();
let overCalls = 0;
const overPrompts: string[] = [];
const overApp = express();
overApp.use(express.json());
registerSegmentGapRoute(overApp, {
  now: () => 1_700_000_000_000,
  available: () => true,
  productRows: async () => [],
  regionRows: async () => [],
  identity: async () => fixtureIdentity,
  secSegments: async () => null,
  llm: async (opts) => {
    overCalls += 1;
    overPrompts.push(opts.prompt);
    const focus = /nur das Elternsegment "([^"]+)"/.exec(opts.prompt)?.[1] ?? "keine";
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "Tesla, Inc.",
        industryEcho: "Auto Manufacturers",
        children: [keptChild(focus, "Zeile")],
      },
    };
  },
});
const overServer = overApp.listen(0);
const overPort = (overServer.address() as AddressInfo).port;
try {
  const overParents = [
    { name: "Huge", revenue: 50 },
    { name: "Large", revenue: 40 },
    { name: "Mid", revenue: 30 },
    { name: "Small", revenue: 20 },
    { name: "Tiny", revenue: 10 },
  ];
  const first = await postGap(overPort, "EXL", { products: overParents, regions: [] });
  const afterFirst = overCalls;
  const second = await postGap(overPort, "EXL", { products: overParents, regions: [] });
  const huge = second.json.items?.find((item) => item.parent === "Huge");
  gap(
    "call-limit-na-not-full-cache",
    first.status === 200
      && first.json.queried === SEGMENT_GAP_MAX_CALLS
      && first.json.total === overParents.length
      && /nicht abgefragt \(Call-Limit\): Tiny/.test(first.json.reason ?? "")
      && first.json.cached === false
      && afterFirst === SEGMENT_GAP_MAX_CALLS
      && second.status === 200
      && overCalls === afterFirst
      && second.json.cached === false
      && /nicht abgefragt \(Call-Limit\): Tiny/.test(second.json.reason ?? "")
      && huge?.name === "Zeile"
      && overPrompts.filter((prompt) => prompt.includes('nur das Elternsegment "Huge"')).length === 1,
    `first=${first.json.queried}/${first.json.total} calls=${afterFirst},${overCalls} cached=${String(first.json.cached)}/${String(second.json.cached)} reason=${second.json.reason ?? ""}`,
  );
} finally {
  overServer.close();
}

resetSegmentGapCacheForTests();
let pairedCalls = 0;
let releasePair: () => void = () => {};
const pairGate = new Promise<void>((resolve) => { releasePair = resolve; });
const pairApp = express();
pairApp.use(express.json());
registerSegmentGapRoute(pairApp, {
  available: () => true,
  productRows: async () => [{ fiscalYear: "2025", reportedCurrency: "USD", data: { Only: 10 } }],
  regionRows: async () => [],
  identity: async () => fixtureIdentity,
  llm: async () => {
    pairedCalls += 1;
    await pairGate;
    return {
      modelUsed: "mock-model",
      data: { companyEcho: "Tesla, Inc.", industryEcho: "Auto Manufacturers", children: [keptChild("Only", "Zeile")] },
    };
  },
});
const pairServer = pairApp.listen(0);
const pairPort = (pairServer.address() as AddressInfo).port;
try {
  const left = postGap(pairPort, "EXP");
  const right = postGap(pairPort, "EXP");
  await new Promise((resolve) => setTimeout(resolve, 40));
  const during = pairedCalls;
  releasePair();
  const both = await Promise.all([left, right]);
  gap(
    "inflight-dedupes-same-parent",
    during === 1 && pairedCalls === 1 && both.every((row) => row.status === 200 && (row.json.items?.length ?? 0) === 1),
    `during=${during} calls=${pairedCalls} status=${both.map((row) => row.status).join(",")}`,
  );
} finally {
  pairServer.close();
}

resetSegmentGapCacheForTests();
let inflightRuns = 0;
await segmentGapInflightForTests("reject-probe", async () => {
  inflightRuns += 1;
  throw new Error("erster Fehlschlag");
}).catch(() => undefined);
await segmentGapInflightForTests("reject-probe", async () => {
  inflightRuns += 1;
  throw new Error("zweiter Start");
}).catch(() => undefined);
gap(
  "inflight-reject-starts-fresh",
  inflightRuns === 2,
  `runs=${inflightRuns}`,
);

resetSegmentGapCacheForTests();
const budgetFetch = globalThis.fetch;
const previousKey = process.env.OPENROUTER_API_KEY;
const previousModel = process.env.OPENROUTER_MODEL;
delete process.env.OPENROUTER_MODEL;
process.env.OPENROUTER_API_KEY = "budget-test-not-a-real-key";
const savedWindow = (globalThis as { window?: unknown }).window;
delete (globalThis as { window?: unknown }).window;
let openRouterHttp = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.includes("openrouter.ai")) {
    openRouterHttp += 1;
    return new Response(JSON.stringify({ error: { message: "rate" } }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.includes("company_tickers.json")) {
    return Response.json({ "0": { cik_str: 1, ticker: "EXS", title: "Example AG" } });
  }
  if (url.includes("/submissions/")) {
    return Response.json({
      filings: {
        recent: {
          form: ["10-K"],
          filingDate: ["2025-02-01"],
          accessionNumber: ["0000000001-25-000001"],
          primaryDocument: ["example.htm"],
        },
      },
    });
  }
  if (url.includes("sec.gov")) {
    const text = `${"reportable segment revenue by segment. ".repeat(80)}Total revenue 100`;
    return new Response(`<html><body>${text}</body></html>`, { status: 200 });
  }
  return budgetFetch(input, init);
}) as typeof fetch;
const budgetApp = express();
budgetApp.use(express.json());
registerSegmentGapRoute(budgetApp, {
  available: () => true,
  productRows: async () => [],
  regionRows: async () => [],
  identity: async () => fixtureIdentity,
});
const budgetServer = budgetApp.listen(0);
const budgetPort = (budgetServer.address() as AddressInfo).port;
try {
  const worst = await postGap(budgetPort, "EXS");
  gap(
    "http-budget-counts-fallback-and-sec",
    worst.status === 200
      && openRouterHttp === SEGMENT_GAP_MAX_CALLS
      && openRouterHttp <= 4
      && worst.json.cached === false
      && /nicht abgefragt \(Call-Limit\)/.test(worst.json.reason ?? "")
      && (worst.json.queried ?? 0) < (worst.json.total ?? 0),
    `status=${worst.status} http=${openRouterHttp} error=${worst.json.error ?? ""} queried=${worst.json.queried} total=${worst.json.total} reason=${worst.json.reason ?? ""}`,
  );
} finally {
  budgetServer.close();
  globalThis.fetch = budgetFetch;
  (globalThis as { window?: unknown }).window = savedWindow;
  if (previousKey == null) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = previousKey;
  if (previousModel == null) delete process.env.OPENROUTER_MODEL;
  else process.env.OPENROUTER_MODEL = previousModel;
}

const gapModule = readFileSync(new URL("../shared/segment-gap.ts", import.meta.url), "utf8");
gap(
  "no-ticker-parent-map",
  !/\bTSLA\b|\bMSFT\b|\bNVO\b|SAP\.DE|S\/4HANA|SuccessFactors/.test(`${routeSource}\n${gapModule}`),
  "Route und Geografie ohne Ticker-Mapping",
);
gap(
  "uses-convert-segment-rows-to-usd",
  routeSource.includes("convertSegmentRowsToUsd"),
  "Elternumsatz läuft über die #505-Umrechnung",
);

if (gaps.length > 0) {
  console.error(`n36 FAIL ${gaps.length}`);
  process.exit(1);
}
console.log("n36 PASS");
