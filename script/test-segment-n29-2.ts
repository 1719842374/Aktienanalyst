/**
 * P2-N29-2 (WORK_DASHBOARD_FEATURES_2026-10.md:189, WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md:146,
 * script/test-segment-n30.ts:11):
 * KI-Lüge ohne geladenen Peer. „Arista Networking“ mit brandOwner HPE, Peers nur WDC/NTAP.
 * Eine FMP-Namenssuche pro brand erkennt die Falschantwort, wenn der Treffer eine andere Firma ist.
 * Kein neuer Schwellenwert: Teiltreffer und die eigene Firma sind kein Beleg und bleiben n/a im Sinne
 * der bestehenden N29-Entscheidung. Fällt die Suche aus, ist das Kind n/a mit Grund und wird nicht
 * als „keine Fremdfirma“ gecacht. Die 503/Retry-After-Antwort der Segmentliste bleibt unverändert.
 * Kein Live-FMP und kein Live-LLM.
 *
 * Aufruf: npx tsx script/test-segment-n29-2.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import express from "express";
(globalThis as any).React = React;

delete process.env.OPENROUTER_API_KEY;
delete process.env.FMP_API_KEY;
delete process.env.FMP_API_key;

const { reviewKiChildren } = await import("../shared/segment-children");
const route = await import("../server/segment-growth-route");
const childrenUi = await import("../client/src/components/sections/SegmentChildren");

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

type Peer = { symbol: string; companyName: string };
type SearchRow = { brand: string; ok: boolean; companies: Peer[] };
const hpe = JSON.parse(readFileSync("script/fixtures/hpe-networking-children-n23.json", "utf8")) as {
  profile: { companyName: string; description: string; industry: string };
  peers: Peer[];
};
const msft = JSON.parse(readFileSync("script/fixtures/msft-dynamics-children-n25.json", "utf8")) as {
  profile: { companyName: string; description: string; industry: string };
  segments: string[];
  parent: string;
  peersObserved: Peer[];
};
const hpeProd = hpe.peers.filter((peer) => peer.symbol === "WDC" || peer.symbol === "NTAP");
const hpeWdc = hpe.peers.filter((peer) => peer.symbol === "WDC");

function review(
  profile: { companyName: string; description: string },
  ticker: string,
  parent: string,
  child: Record<string, unknown>,
  peers: readonly Peer[],
  brandNameSearch?: readonly SearchRow[],
) {
  return reviewKiChildren(parent, { children: [{ owner: profile.companyName, basis: "Bekannte Produktlinie", source: null, ...child }] }, null, {
    kind: "product",
    companyName: profile.companyName,
    ticker,
    description: profile.description,
    peerCompanies: peers,
    brandNameSearch,
  });
}

const aristaHits: SearchRow[] = [{ brand: "Arista", ok: true, companies: [{ symbol: "ANET", companyName: "Arista Networks, Inc." }] }];
const lie = review(hpe.profile, "HPE", "Networking", {
  name: "Arista Networking",
  brand: "Arista",
  brandOwner: "Hewlett Packard Enterprise",
}, hpeProd, aristaHits);
gap(
  "lie-without-peer-rejected (Arista, brandOwner HPE, Suche ANET)",
  lie.children.length === 0 && /Fremdmarke verworfen: Arista Networking/.test(lie.reason ?? ""),
  `kept=${lie.children.map((row) => row.name).join(" | ") || "keine"} reason=${lie.reason ?? "null"}`,
);

const networking = review(hpe.profile, "HPE", "Networking", {
  name: "Arista Networking",
  brand: "Arista Networking",
  brandOwner: "Hewlett Packard Enterprise",
}, hpeProd, [{ brand: "Arista Networking", ok: true, companies: [{ symbol: "ANET", companyName: "Arista Networks, Inc." }] }]);
gap(
  "stem-networking-matches-networks (Arista Networking gegen Arista Networks, Inc.)",
  networking.children.length === 0 && /Fremdmarke verworfen: Arista Networking/.test(networking.reason ?? ""),
  `kept=${networking.children.map((row) => row.name).join(" | ") || "keine"} reason=${networking.reason ?? "null"}`,
);

const dynamics = review(msft.profile, "MSFT", "Dynamics", {
  name: "Dynamics 365",
  brand: "Dynamics",
  brandOwner: "Microsoft",
}, msft.peersObserved, [{ brand: "Dynamics", ok: true, companies: [{ symbol: "BOOM", companyName: "Dynamic Materials Inc." }] }]);
gap(
  "own-product-similar-stem-kept (MSFT Dynamics bleibt)",
  dynamics.children.some((row) => row.name === "Dynamics 365"),
  `reason=${dynamics.reason ?? "null"}`,
);

const netapp = review(hpe.profile, "HPE", "Storage", {
  name: "NetApp Storage",
  brand: "NetApp",
  brandOwner: "HPE",
}, hpeWdc, [{ brand: "NetApp", ok: true, companies: [{ symbol: "NTAP", companyName: "NetApp, Inc." }] }]);
gap(
  "lie-without-peer-rejected (NetApp, brandOwner HPE, NTAP nicht geladen)",
  netapp.children.length === 0 && /Fremdmarke verworfen: NetApp Storage/.test(netapp.reason ?? ""),
  `reason=${netapp.reason ?? "null"}`,
);

const power = review(msft.profile, "MSFT", msft.parent, {
  name: "Power Platform",
  brand: "Power Platform",
  brandOwner: "Microsoft",
}, msft.peersObserved, [{ brand: "Power Platform", ok: true, companies: [{ symbol: "POWI", companyName: "Power Integrations, Inc." }] }]);
gap(
  "partial-hit-not-proof (Power Platform bleibt, keine neue Schwelle)",
  power.children.some((row) => row.name === "Power Platform"),
  `reason=${power.reason ?? "null"}`,
);

const alletra = review(hpe.profile, "HPE", "Storage", {
  name: "Alletra MP",
  brand: "Alletra",
  brandOwner: "Hewlett Packard Enterprise",
}, hpeProd, [{ brand: "Alletra", ok: true, companies: [] }]);
gap(
  "empty-search-keeps-own-claim (Alletra)",
  alletra.children.some((row) => row.name === "Alletra MP"),
  `reason=${alletra.reason ?? "null"}`,
);

const subjectHit = review(hpe.profile, "HPE", "Networking", {
  name: "Arista Networking",
  brand: "Arista",
  brandOwner: "Hewlett Packard Enterprise",
}, hpeProd, [{ brand: "Arista", ok: true, companies: [{ symbol: "HPE", companyName: "Hewlett Packard Enterprise Company" }] }]);
gap(
  "subject-hit-is-not-foreign (Treffer ist die eigene Firma)",
  subjectHit.children.some((row) => row.name === "Arista Networking"),
  `reason=${subjectHit.reason ?? "null"}`,
);

const unproven = review(hpe.profile, "HPE", "Networking", {
  name: "Arista Networking",
  brand: "Arista",
  brandOwner: "Hewlett Packard Enterprise",
}, hpeProd, [{ brand: "Arista", ok: false, companies: [] }]);
gap(
  "search-failed-is-na (429/Ausfall, kein erfundener Beleg)",
  unproven.children.length === 0 && /FMP-Namenssuche nicht belegbar: Arista Networking/.test(unproven.reason ?? ""),
  `reason=${unproven.reason ?? "null"}`,
);

const rows = [{ fiscalYear: "2024", data: { Networking: 100, Storage: 80 } }];
const kiChild = {
  companyEcho: "Hewlett Packard Enterprise",
  industryEcho: "Computer Hardware",
  children: [{
    name: "Arista Networking",
    brand: "Arista",
    brandOwner: "Hewlett Packard Enterprise",
    owner: hpe.profile.companyName,
    basis: "Bekannte Produktlinie",
    source: null,
  }],
};

function mount(brandSearch: (query: string) => Promise<{ status: number; companies: Peer[] }>, now?: () => number) {
  const app = express();
  app.use(express.json());
  route.registerSegmentGrowthRoute(app, {
    fmpAvailable: () => true,
    raw: async () => rows,
    identity: async () => ({
      companyName: hpe.profile.companyName,
      exchange: "NYSE",
      country: "US",
      sector: "Technology",
      industry: "Computer Hardware",
      description: hpe.profile.description,
    }),
    peers: async () => hpeProd,
    ki: async () => kiChild,
    outline: async () => kiChild,
    brandSearch,
    now,
  });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  return { server, port };
}

async function close(server: ReturnType<typeof express> extends never ? never : import("node:http").Server) {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

route.resetSegmentChildrenGuardsForTests();
const searched: string[] = [];
const proven = mount(async (query) => {
  searched.push(query);
  return { status: 200, companies: [{ symbol: "ANET", companyName: "Arista Networks, Inc." }] };
});
try {
  const first = await fetch(`http://127.0.0.1:${proven.port}/api/segment-children/HPE?parent=Networking&kind=product`);
  const firstBody = await first.json() as { children?: { name: string }[]; reason?: string | null; promptVersion?: string };
  const viaClient = await childrenUi.fetchSegmentChildren(
    { ticker: "HPE", parent: "Networking", kind: "product" },
    async () => new Response(JSON.stringify(firstBody), { status: first.status }),
  );
  const markup = renderToStaticMarkup(React.createElement(childrenUi.SegmentChildrenList, { data: viaClient }));
  gap(
    "route-search-rejects-lie",
    first.status === 200
      && (firstBody.children?.length ?? 1) === 0
      && /Fremdmarke verworfen: Arista Networking/.test(firstBody.reason ?? "")
      && searched.join(",") === "Arista"
      && markup.includes("Fremdmarke verworfen: Arista Networking")
      && firstBody.promptVersion === route.SEGMENT_CHILDREN_PROMPT_VERSION,
    `status=${first.status} calls=${searched.join(",") || "keine"} reason=${firstBody.reason ?? "null"} markup=${markup.includes("Fremdmarke")}`,
  );
  const storage = await fetch(`http://127.0.0.1:${proven.port}/api/segment-children/HPE?parent=Storage&kind=product`);
  const storageBody = await storage.json() as { children?: { name: string }[]; reason?: string | null };
  gap(
    "brand-search-cached (zweites Segment, kein zweiter Abruf)",
    storage.status === 200
      && (storageBody.children?.length ?? 1) === 0
      && searched.join(",") === "Arista"
      && /Fremdmarke verworfen: Arista Networking/.test(storageBody.reason ?? ""),
    `status=${storage.status} calls=${searched.join(",") || "keine"} reason=${storageBody.reason ?? "null"}`,
  );
  const outline = await fetch(`http://127.0.0.1:${proven.port}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker: "HPE", kind: "product" }),
  });
  const outlineBody = await outline.json() as { items?: { name: string }[]; reason?: string | null };
  gap(
    "outline-search-rejects-lie",
    outline.status === 200
      && (outlineBody.items?.length ?? 1) === 0
      && /Fremdmarke verworfen: Arista Networking/.test(outlineBody.reason ?? "")
      && searched.join(",") === "Arista",
    `status=${outline.status} calls=${searched.join(",")} reason=${outlineBody.reason ?? "null"}`,
  );
} finally {
  await close(proven.server);
}

route.resetSegmentChildrenGuardsForTests();
let clock = 1_700_000_000_000;
const failedSearches: string[] = [];
const degraded = mount(async (query) => {
  failedSearches.push(query);
  return { status: 429, companies: [] };
}, () => clock);
try {
  const first = await fetch(`http://127.0.0.1:${degraded.port}/api/segment-children/HPE?parent=Networking&kind=product`);
  const firstBody = await first.json() as { children?: { name: string }[]; reason?: string | null };
  gap(
    "search-429-stays-200 (nicht der Listen-503)",
    first.status === 200
      && first.headers.get("retry-after") == null
      && (firstBody.children?.length ?? 1) === 0
      && /FMP-Namenssuche nicht belegbar: Arista Networking/.test(firstBody.reason ?? "")
      && failedSearches.length === 1,
    `status=${first.status} retry-after=${first.headers.get("retry-after")} calls=${failedSearches.length} reason=${firstBody.reason ?? "null"}`,
  );
  const cached = await fetch(`http://127.0.0.1:${degraded.port}/api/segment-children/HPE?parent=Networking&kind=product`);
  gap(
    "search-429-not-cached-as-clean",
    cached.status === 200 && failedSearches.length === 1,
    `status=${cached.status} calls=${failedSearches.length}`,
  );
  clock += 61_000;
  const again = await fetch(`http://127.0.0.1:${degraded.port}/api/segment-children/HPE?parent=Networking&kind=product`);
  const againBody = await again.json() as { reason?: string | null };
  gap(
    "search-429-retried-after-short-cache",
    again.status === 200 && failedSearches.length === 2 && /FMP-Namenssuche nicht belegbar/.test(againBody.reason ?? ""),
    `status=${again.status} calls=${failedSearches.length} reason=${againBody.reason ?? "null"}`,
  );
} finally {
  await close(degraded.server);
}

route.resetSegmentChildrenGuardsForTests();
let listSearches = 0;
const listApp = express();
route.registerSegmentGrowthRoute(listApp, {
  fmpAvailable: () => true,
  raw: async () => rows,
  namesStatus: async () => ({ names: [], failed: true }),
  ki: async () => kiChild,
  brandSearch: async () => {
    listSearches += 1;
    return { status: 429, companies: [] };
  },
});
const listServer = listApp.listen(0);
const listPort = (listServer.address() as { port: number }).port;
try {
  const blocked = await fetch(`http://127.0.0.1:${listPort}/api/segment-children/HPE?parent=Networking&kind=product`);
  const blockedBody = await blocked.json() as { error?: string };
  gap(
    "list-429-still-503-retry-after",
    blocked.status === 503
      && blocked.headers.get("retry-after") === "60"
      && blockedBody.error === "n/a — FMP-Segmentliste gerade nicht erreichbar, bitte gleich erneut versuchen"
      && listSearches === 0,
    `status=${blocked.status} retry-after=${blocked.headers.get("retry-after")} searches=${listSearches} error=${blockedBody.error ?? ""}`,
  );
} finally {
  await close(listServer);
}

const fmp = await import("../server/fmp");
process.env.FMP_API_KEY = "p2-2-dummy";
const realFetch = globalThis.fetch;
let searchMode: "object" | "bad-json" | "empty-array" = "object";
let nameSearchCalls = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.includes("/search-name")) return new Response("[]", { status: 200 });
  nameSearchCalls += 1;
  if (searchMode === "bad-json") return new Response("not-json", { status: 200 });
  if (searchMode === "empty-array") return new Response("[]", { status: 200 });
  return new Response(JSON.stringify({ error: "nope" }), { status: 200 });
}) as typeof fetch;

try {
  const objectBody = await fmp.fmpSearchCompanyName("Arista Networking");
  gap(
    "non-array-200-is-not-ok",
    objectBody.ok === false && objectBody.companies.length === 0,
    `ok=${String(objectBody.ok)} status=${objectBody.status} n=${objectBody.companies.length}`,
  );
  searchMode = "bad-json";
  const badJson = await fmp.fmpSearchCompanyName("Arista Networking");
  gap(
    "unreadable-json-200-is-not-ok",
    badJson.ok === false && badJson.companies.length === 0,
    `ok=${String(badJson.ok)} status=${badJson.status} n=${badJson.companies.length}`,
  );
  searchMode = "empty-array";
  const emptyArray = await fmp.fmpSearchCompanyName("Alletra");
  gap(
    "empty-array-stays-ok",
    emptyArray.ok === true && emptyArray.status === 200 && emptyArray.companies.length === 0,
    `ok=${String(emptyArray.ok)} status=${emptyArray.status} n=${emptyArray.companies.length}`,
  );
} finally {
  globalThis.fetch = realFetch;
}

route.resetSegmentChildrenGuardsForTests();
let badClock = 1_700_000_000_000;
let badMode: "object" | "bad-json" = "object";
let badCalls = 0;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.includes("/search-name")) return new Response("[]", { status: 200 });
  badCalls += 1;
  if (badMode === "bad-json") return new Response("{", { status: 200 });
  return new Response(JSON.stringify({ companies: [] }), { status: 200 });
}) as typeof fetch;
const badRoute = mount((query) => fmp.fmpSearchCompanyName(query), () => badClock);
try {
  const first = await realFetch(`http://127.0.0.1:${badRoute.port}/api/segment-children/HPE?parent=Networking&kind=product`);
  const firstBody = await first.json() as { children?: { name: string }[]; reason?: string | null };
  gap(
    "non-array-200-is-na-and-not-cached",
    first.status === 200
      && (firstBody.children?.length ?? 1) === 0
      && /FMP-Namenssuche nicht belegbar: Arista Networking/.test(firstBody.reason ?? "")
      && badCalls === 1,
    `status=${first.status} calls=${badCalls} reason=${firstBody.reason ?? "null"}`,
  );
  const cached = await realFetch(`http://127.0.0.1:${badRoute.port}/api/segment-children/HPE?parent=Networking&kind=product`);
  gap(
    "non-array-200-not-served-as-clean-cache",
    cached.status === 200 && badCalls === 1,
    `status=${cached.status} calls=${badCalls}`,
  );
  badClock += 61_000;
  const again = await realFetch(`http://127.0.0.1:${badRoute.port}/api/segment-children/HPE?parent=Networking&kind=product`);
  const againBody = await again.json() as { reason?: string | null };
  gap(
    "non-array-200-retried",
    again.status === 200 && badCalls === 2 && /FMP-Namenssuche nicht belegbar/.test(againBody.reason ?? ""),
    `status=${again.status} calls=${badCalls} reason=${againBody.reason ?? "null"}`,
  );
  route.resetSegmentChildrenGuardsForTests();
  badMode = "bad-json";
  badCalls = 0;
  badClock += 61_000;
  const unreadable = await realFetch(`http://127.0.0.1:${badRoute.port}/api/segment-children/HPE?parent=Storage&kind=product`);
  const unreadableBody = await unreadable.json() as { children?: { name: string }[]; reason?: string | null };
  gap(
    "unreadable-json-200-is-na",
    unreadable.status === 200
      && (unreadableBody.children?.length ?? 1) === 0
      && /FMP-Namenssuche nicht belegbar: Arista Networking/.test(unreadableBody.reason ?? "")
      && badCalls === 1,
    `status=${unreadable.status} calls=${badCalls} reason=${unreadableBody.reason ?? "null"}`,
  );
} finally {
  await close(badRoute.server);
  globalThis.fetch = realFetch;
  delete process.env.FMP_API_KEY;
}

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n29-2: OK");
