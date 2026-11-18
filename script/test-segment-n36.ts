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
import type { SegmentGapResult } from "../shared/segment-gap";
import { installFakeDom, findByTestId, reactPropsOf } from "./lib/fake-dom";
import { outlineEchoMatches } from "../shared/segment-children";
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
    items?: { parent: string; name: string; kind?: string; shareOfParentPct: number | null; growthPct: number | null; shareOrigin?: string | null; basis?: string }[];
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
    && keyA.includes("n36-gap-p4")
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
            citedChild("Energy Generation and Storage", "Megapack", "Tesla, Inc.", { source: "Tesla Annual Report 2025", revenue: 25 }),
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
      && fsd?.shareOfParentPct === 8
      && fsd.shareOrigin === "estimate"
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
      && germany.shareOfParentPct === 12
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
      && platform.shareOfParentPct === 12
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

const gapModule = readFileSync(new URL("../shared/segment-gap.ts", import.meta.url), "utf8");
gap(
  "no-ticker-parent-map",
  !/\bTSLA\b|\bMSFT\b|SAP\.DE|S\/4HANA|SuccessFactors/.test(`${routeSource}\n${gapModule}`),
  "Route und Geografie ohne Ticker-Mapping",
);

if (gaps.length > 0) {
  console.error(`n36 FAIL ${gaps.length}`);
  process.exit(1);
}
console.log("n36 PASS");
