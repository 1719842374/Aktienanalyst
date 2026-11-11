/**
 * #465 N30 (DC 026bd68d, P2-N29-1 + Beleg 4):
 * 1) brandOwner zählt nur als eigen, wenn alle seine Wörter zur eigenen Firma bzw. zum eigenen Ticker gehören
 *    (DC-Vorschlag G2). Tochterfirmen als brandOwner („LinkedIn Corporation“, „Nuance Communications“,
 *    „Xbox Game Studios“, „Aruba Networks“, „Cray Inc.“, „Beats Electronics“, „Beats by Dre“) gelten als fehlend:
 *    N28 entscheidet, die eigene Tochtermarke bleibt. Teilnennungen („GE HealthCare“, „GE Vernova“ bei GE,
 *    „HP Enterprise“ bei HPQ, „Kyndryl (IBM spin-off)“, „Intel, not AMD“, „Oracle (via Microsoft partnership)“)
 *    sind nicht eigen. Die N29-Fälle mit der Mutter als brandOwner bleiben.
 * 4) /api/segment-children liefert promptVersion (gleiche Konstante wie der Cache-Schlüssel); der Client liest
 *    nur parent, children und reason, die Darstellung bleibt gleich.
 * Offen (nicht gebaut): P2-N29-2 Lüge ohne geladenen Peer („Arista Networking“ mit brandOwner HPE).
 * Kein Live-FMP und kein Live-LLM. Profile von NVDA/AAPL: DC-Proxy-Texte (script/fixtures/nvda-aapl-profile-proxy-n29.json).
 *
 * Aufruf: npx tsx script/test-segment-n30.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import express from "express";
(globalThis as any).React = React;

delete process.env.OPENROUTER_API_KEY;

const shared = await import("../shared/segment-children");
const { reviewKiChildren } = shared;
const route = await import("../server/segment-growth-route");
const childrenUi = await import("../client/src/components/sections/SegmentChildren");

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

type Peer = { symbol: string; companyName: string };
const hpe = JSON.parse(readFileSync("script/fixtures/hpe-networking-children-n23.json", "utf8")) as {
  profile: { companyName: string; description: string };
  peers: Peer[];
};
const ms = JSON.parse(readFileSync("script/fixtures/msft-dynamics-children-n25.json", "utf8")) as {
  profile: { companyName: string; description: string };
  segments: string[];
  parent: string;
  peersObserved: Peer[];
  peersCandidate: Peer[];
  peersCollision: Peer[];
};
const px = JSON.parse(readFileSync("script/fixtures/nvda-aapl-profile-proxy-n29.json", "utf8")) as Record<"NVDA" | "AAPL", { companyName: string; description: string }>;
const hpePeers = hpe.peers.filter((peer) => peer.symbol === "WDC" || peer.symbol === "NTAP");
const msAll = [...ms.peersObserved, ...ms.peersCandidate, ...ms.peersCollision];

const companies: Record<string, { co: string; d: string; sib: string[] }> = {
  MSFT: { co: ms.profile.companyName, d: ms.profile.description, sib: ms.segments },
  HPE: { co: hpe.profile.companyName, d: hpe.profile.description, sib: [] },
  NVDA: { co: px.NVDA.companyName, d: px.NVDA.description, sib: [] },
  AAPL: { co: px.AAPL.companyName, d: px.AAPL.description, sib: [] },
  GE: { co: "GE Aerospace", d: "GE Aerospace designs and produces commercial and defense aircraft engines, integrated engine components, electric power, and mechanical aircraft systems.", sib: [] },
  HPQ: { co: "HP Inc.", d: "HP Inc. provides personal computing and other access devices, imaging and printing products, and related technologies, solutions, and services.", sib: [] },
  IBM: { co: "International Business Machines Corporation", d: "IBM provides integrated solutions and services worldwide, including hybrid cloud and AI software, consulting, and infrastructure such as IBM Z mainframes.", sib: [] },
  AMD: { co: "Advanced Micro Devices, Inc.", d: "Advanced Micro Devices operates as a semiconductor company with Data Center, Client, Gaming, and Embedded segments, offering EPYC, Ryzen and Radeon products.", sib: [] },
};

function keeps(ticker: string, parent: string, child: { name: string; brand: string; brandOwner?: unknown }, peers: readonly Peer[] = []): boolean {
  const c = companies[ticker];
  const result = reviewKiChildren(parent, { children: [{ owner: c.co, basis: "Bekannte Produktlinie", source: null, ...child }] }, null, {
    kind: "product",
    companyName: c.co,
    ticker,
    description: c.d,
    siblings: c.sib.filter((name) => name !== parent),
    peerCompanies: peers,
  });
  return result.children.some((row) => row.name === child.name);
}
const bo = (value: unknown) => (value === undefined ? "fehlt" : JSON.stringify(value));

// ── 1a) Töchter als brandOwner: wie ohne brandOwner (N28), eigene Tochtermarke bleibt ──
const subsidiaries: [string, string, string, string, string, readonly Peer[]][] = [
  ["MSFT", "LinkedIn", "LinkedIn Premium", "LinkedIn", "LinkedIn Corporation", []],
  ["MSFT", "LinkedIn", "LinkedIn Talent Solutions", "LinkedIn", "LinkedIn", []],
  ["MSFT", "Intelligent Cloud", "Nuance Dragon Medical", "Nuance", "Nuance Communications", []],
  ["MSFT", "Gaming", "Xbox Game Pass", "Xbox", "Xbox Game Studios", []],
  ["HPE", "Networking", "Aruba Central", "Aruba", "Aruba Networks", hpePeers],
  ["HPE", "Compute", "Cray EX", "Cray", "Cray Inc.", hpePeers],
  ["AAPL", "Wearables", "Beats Studio", "Beats", "Beats Electronics", []],
  ["AAPL", "Wearables", "Beats Studio", "Beats", "Beats by Dre", []],
];
for (const [ticker, parent, name, brand, owner, peers] of subsidiaries) {
  const without = keeps(ticker, parent, { name, brand }, peers);
  const withOwner = keeps(ticker, parent, { name, brand, brandOwner: owner }, peers);
  gap(`subsidiary-owner-kept ${ticker} ${name} (brandOwner ${owner})`, without && withOwner, `ohne brandOwner=${without ? "bleibt" : "verworfen"} mit=${withOwner ? "bleibt" : "verworfen"}`);
}
// Töchter, die schon ohne brandOwner fremd sind (nicht im Profil), bleiben verworfen.
const foreignSubsidiaries: [string, string, string, string, string][] = [
  ["MSFT", "Gaming", "Call of Duty", "Activision", "Activision Blizzard"],
  ["MSFT", "Intelligent Cloud", "GitHub Copilot", "GitHub Copilot", "GitHub, Inc."],
  ["HPE", "Networking", "Juniper Mist AI", "Juniper", "Juniper Networks"],
  ["NVDA", "Data Center", "Mellanox InfiniBand", "Mellanox", "Mellanox Technologies"],
];
for (const [ticker, parent, name, brand, owner] of foreignSubsidiaries) {
  const peers = ticker === "HPE" ? hpePeers : [];
  gap(`subsidiary-not-in-profile-rejected ${ticker} ${name} (brandOwner ${owner})`, !keeps(ticker, parent, { name, brand, brandOwner: owner }, peers), "wie N27/N28");
}
gap("own-prefixed-owner-kept HPE Aruba Central (brandOwner HPE Aruba Networking)", keeps("HPE", "Networking", { name: "Aruba Central", brand: "Aruba", brandOwner: "HPE Aruba Networking" }, hpePeers), "erstes Wort Ticker -> wie N28");
gap("own-prefixed-owner-kept MSFT Xbox Game Pass (brandOwner Microsoft Gaming)", keeps("MSFT", "Gaming", { name: "Xbox Game Pass", brand: "Xbox", brandOwner: "Microsoft Gaming" }), "erstes Wort eigen -> wie N28");

// ── 1b) Teilnennungen und andere Firmen: nicht eigen ──
const notOwn: [string, string, string, string, string, readonly Peer[]][] = [
  ["GE", "Commercial Engines", "Vivid Ultrasound", "Vivid", "GE HealthCare", []],
  ["GE", "Commercial Engines", "Vivid Ultrasound", "Vivid", "GE HealthCare", [{ symbol: "GEHC", companyName: "GE HealthCare Technologies Inc." }]],
  ["GE", "Commercial Engines", "Haliade-X Turbine", "Haliade", "GE Vernova", []],
  ["HPQ", "Personal Systems", "ProLiant DL380", "ProLiant", "HP Enterprise", []],
  ["HPQ", "Personal Systems", "ProLiant DL380", "ProLiant", "Hewlett Packard Enterprise", []],
  ["IBM", "Infrastructure", "Kyndryl Bridge", "Kyndryl", "Kyndryl (IBM spin-off)", []],
  ["IBM", "Infrastructure", "Kyndryl Bridge", "Kyndryl", "Kyndryl Holdings", []],
  ["AMD", "Data Center", "Xeon Scalable", "Xeon", "Intel, not AMD", []],
  ["AMD", "Data Center", "Xeon Scalable", "Xeon", "Intel", []],
  ["MSFT", "Server", "OCI Database", "OCI", "Oracle (via Microsoft partnership)", []],
  ["MSFT", ms.parent, "Power Platform", "Power Platform", "Microsoft <img src=x onerror=alert(1)>", msAll],
  // Teilname der eigenen Firma ohne Ticker ist keine Eigentümer-Angabe („Hewlett Packard“ bei Hewlett Packard Enterprise).
  ["HPE", "Networking", "Arista Networking", "Arista", "Hewlett Packard", hpePeers],
];
for (const [ticker, parent, name, brand, owner, peers] of notOwn) {
  gap(`partial-or-foreign-owner-rejected ${ticker} ${name} (brandOwner ${owner}${peers.length ? `, Peers ${peers.map((p) => p.symbol).join("/")}` : ""})`, !keeps(ticker, parent, { name, brand, brandOwner: owner }, peers), "nicht eigen");
}

// ── 1c) N29-Fälle: Mutter als brandOwner bleibt ──
const parents: [string, string, string, string, string, readonly Peer[]][] = [
  ["MSFT", ms.parent, "Power Platform", "Power Platform", "Microsoft", msAll],
  ["MSFT", ms.parent, "Power Platform", "Power Platform", "Microsoft Corporation", msAll],
  ["MSFT", ms.parent, "Power Platform", "Power Platform", "MSFT", msAll],
  ["MSFT", "Intelligent Cloud", "GitHub Copilot", "GitHub Copilot", "Microsoft Corporation", ms.peersObserved],
  ["MSFT", "Intelligent Cloud", "Azure OpenAI Service", "Azure OpenAI", "Microsoft", ms.peersObserved],
  ["HPE", "Storage", "Alletra MP", "Alletra", "Hewlett Packard Enterprise", hpePeers],
  ["HPE", "Storage", "Alletra MP", "Alletra", "Hewlett-Packard Enterprise", hpePeers],
  ["HPE", "Hybrid Cloud", "GreenLake Cloud", "GreenLake", "HPE", hpePeers],
  ["NVDA", "Data Center", "DGX Systems", "DGX", "NVIDIA", []],
  ["NVDA", "Data Center", "Blackwell GPUs", "Blackwell", "NVIDIA Corporation", []],
  ["AAPL", "Mac", "MacBook Air", "MacBook", "Apple", []],
  ["AAPL", "Services", "iCloud+", "iCloud", "Apple Inc.", []],
];
for (const [ticker, parent, name, brand, owner, peers] of parents) {
  gap(`parent-owner-kept ${ticker} ${name} (brandOwner ${owner})`, keeps(ticker, parent, { name, brand, brandOwner: owner }, peers), "N29 bleibt");
}
// Peer-Belege und fremde brandOwner bleiben unverändert.
gap("peer-owner-rejected HPE Arista Networking (brandOwner Arista Networks)", !keeps("HPE", "Networking", { name: "Arista Networking", brand: "Arista", brandOwner: "Arista Networks" }, hpePeers), "N29 bleibt");
gap("peer-owner-rejected HPE NetApp Storage (brandOwner NetApp, NTAP geladen)", !keeps("HPE", "Storage", { name: "NetApp Storage", brand: "NetApp", brandOwner: "NetApp" }, hpePeers), "N29 bleibt");
gap("missing-owner-unchanged HPE Arista Networking (brandOwner null)", !keeps("HPE", "Networking", { name: "Arista Networking", brand: "Arista", brandOwner: null }, hpePeers), `brandOwner ${bo(null)}`);

// ── 4) promptVersion in der Antwort, Client ignoriert sie ──
const version = (route as Record<string, unknown>).SEGMENT_CHILDREN_PROMPT_VERSION;
route.resetSegmentChildrenGuardsForTests();
let rawCalls = 0;
const app = express();
route.registerSegmentGrowthRoute(app, {
  fmpAvailable: () => true,
  raw: async () => {
    rawCalls += 1;
    return [{ fiscalYear: "2024", data: { "United States": { Commercial: 100, Consumer: 70 } } }];
  },
  ki: async () => null,
});
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
const childUrl = `http://127.0.0.1:${port}/api/segment-children/ZZN30?parent=${encodeURIComponent("United States")}&kind=geographic`;
let fresh: Record<string, unknown> = {};
let cached: Record<string, unknown> = {};
let badBody: Record<string, unknown> = {};
try {
  const first = await fetch(childUrl);
  fresh = await first.json() as Record<string, unknown>;
  const callsAfterFirst = rawCalls;
  const second = await fetch(childUrl);
  cached = await second.json() as Record<string, unknown>;
  const bad = await fetch(`http://127.0.0.1:${port}/api/segment-children/ZZN30?kind=geographic`);
  badBody = await bad.json() as Record<string, unknown>;
  gap("response-has-prompt-version (frisch)", first.status === 200 && typeof version === "string" && fresh.promptVersion === version, `status=${first.status} promptVersion=${String(fresh.promptVersion)}`);
  gap("response-has-prompt-version (Cache-Treffer)", second.status === 200 && rawCalls === callsAfterFirst && cached.promptVersion === version, `status=${second.status} rawCalls=${rawCalls} promptVersion=${String(cached.promptVersion)}`);
  gap("response-shape-only-adds-prompt-version", JSON.stringify(Object.keys(fresh).sort()) === JSON.stringify(["children", "parent", "promptVersion", "reason"]), `keys=${Object.keys(fresh).sort().join(",")}`);
  gap("error-body-unchanged", bad.status === 400 && JSON.stringify(Object.keys(badBody)) === JSON.stringify(["error"]), `status=${bad.status} keys=${Object.keys(badBody).join(",")}`);
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}
gap(
  "prompt-version-same-source-as-cache-key",
  typeof version === "string" && route.segmentChildrenCacheKey("MSFT", "product", "Dynamics").startsWith(`${version}|`),
  `key=${route.segmentChildrenCacheKey("MSFT", "product", "Dynamics")}`,
);

// Client: gleiche Daten mit und ohne promptVersion -> gleiches Markup, Version nicht sichtbar.
const { promptVersion: _ignored, ...withoutVersion } = fresh;
const viaClient = await childrenUi.fetchSegmentChildren(
  { ticker: "ZZN30", parent: "United States", kind: "geographic" },
  async () => new Response(JSON.stringify(fresh), { status: 200 }),
);
const markupWith = renderToStaticMarkup(React.createElement(childrenUi.SegmentChildrenList, { data: viaClient }));
const markupWithout = renderToStaticMarkup(React.createElement(childrenUi.SegmentChildrenList, { data: withoutVersion as unknown as typeof viaClient }));
gap(
  "client-ignores-prompt-version",
  markupWith === markupWithout && markupWith.includes("segment-child") && typeof version === "string" && !markupWith.includes(version),
  `gleich=${markupWith === markupWithout} länge=${markupWith.length}`,
);

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n30: OK");
