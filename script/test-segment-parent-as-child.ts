/**
 * P3 aus #465 (WORK_DASHBOARD_FEATURES_2026-10.md:189, WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md:146,
 * WORK_IMPLEMENTIERUNG_OFFEN.md:9, Merge-Kommentar 6760620940):
 * „Die KI liefert das Elternsegment selbst als Kind (NVDA „Data Center Segment“, HPE „Hybrid Cloud Segment“).“
 * Der bestehende Abgleich verwirft nur den gleichen Namen. „Data Center Segment“ unter „Data Center“
 * und „Hybrid Cloud Segment“ unter „Hybrid Cloud“ bleiben heute stehen.
 * Kein neuer Zahlenwert. Prompt und Schema bleiben, promptVersion bleibt n29-brandOwner.
 * Geografische Namen bleiben beim exakten Vergleich; die beiden Belege sind Produktsegmente.
 * Kein Live-FMP und kein Live-LLM.
 *
 * Aufruf: npx tsx script/test-segment-parent-as-child.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import express from "express";
(globalThis as any).React = React;

delete process.env.OPENROUTER_API_KEY;
delete process.env.FMP_API_KEY;
delete process.env.FMP_API_key;

const { reviewKiChildren, KI_FILTERED } = await import("../shared/segment-children");
const route = await import("../server/segment-growth-route");
const childrenUi = await import("../client/src/components/sections/SegmentChildren");

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

type Profile = { companyName: string; description: string; exchange?: string; country?: string; sector?: string; industry?: string };
type Peer = { symbol: string; companyName: string };
const hpe = JSON.parse(readFileSync("script/fixtures/hpe-networking-children-n23.json", "utf8")) as { profile: Profile };
const proxy = JSON.parse(readFileSync("script/fixtures/nvda-aapl-profile-proxy-n29.json", "utf8")) as { NVDA: Profile };

function review(
  profile: Profile,
  ticker: string,
  parent: string,
  children: Record<string, unknown>[],
  kind: "product" | "geographic" = "product",
) {
  return reviewKiChildren(parent, {
    children: children.map((child) => ({ owner: profile.companyName, basis: "Bekannte Produktlinie", source: null, ...child })),
  }, null, {
    kind,
    companyName: profile.companyName,
    ticker,
    description: profile.description,
    peerCompanies: [] as Peer[],
  });
}

const names = (rows: { name: string }[]) => rows.map((row) => row.name).join(" | ") || "keine";
const kept = (rows: { name: string }[], name: string) => rows.some((row) => row.name === name);

const nvda = review(proxy.NVDA, "NVDA", "Data Center", [
  { name: "Data Center Segment", brand: "Data Center", brandOwner: "NVIDIA" },
  { name: "DATA CENTER  SEGMENT", brand: "Data Center", brandOwner: "NVIDIA" },
  { name: "DGX Systems", brand: "DGX", brandOwner: "NVIDIA" },
  { name: "Data Center Networking", brand: "NVIDIA", brandOwner: "NVIDIA" },
]);
gap(
  "nvda-parent-segment-dropped",
  !kept(nvda.children, "Data Center Segment") && !kept(nvda.children, "DATA CENTER  SEGMENT"),
  `kept=${names(nvda.children)} reason=${nvda.reason ?? "null"}`,
);
gap(
  "nvda-real-child-kept",
  kept(nvda.children, "DGX Systems") && kept(nvda.children, "Data Center Networking") && nvda.reason == null,
  `kept=${names(nvda.children)} reason=${nvda.reason ?? "null"}`,
);

const hpeMixed = review(hpe.profile, "HPE", "Hybrid Cloud", [
  { name: "Hybrid Cloud Segment", brand: "Hybrid Cloud", brandOwner: "HPE" },
  { name: "GreenLake Cloud", brand: "GreenLake", brandOwner: "HPE" },
]);
gap(
  "hpe-parent-segment-dropped",
  !kept(hpeMixed.children, "Hybrid Cloud Segment") && kept(hpeMixed.children, "GreenLake Cloud") && hpeMixed.reason == null,
  `kept=${names(hpeMixed.children)} reason=${hpeMixed.reason ?? "null"}`,
);

const onlyEcho = review(proxy.NVDA, "NVDA", "Data Center", [
  { name: "Data Center Segment", brand: "Data Center", brandOwner: "NVIDIA" },
]);
gap(
  "only-echo-uses-existing-filter-reason",
  onlyEcho.children.length === 0 && onlyEcho.reason === KI_FILTERED,
  `kept=${names(onlyEcho.children)} reason=${onlyEcho.reason ?? "null"}`,
);

const symmetric = review(proxy.NVDA, "NVDA", "Data Center Segment", [
  { name: "Data Center", brand: "Data Center", brandOwner: "NVIDIA" },
  { name: "DGX Systems", brand: "DGX", brandOwner: "NVIDIA" },
]);
gap(
  "symmetric-parent-with-segment-suffix",
  !kept(symmetric.children, "Data Center") && kept(symmetric.children, "DGX Systems"),
  `kept=${names(symmetric.children)} reason=${symmetric.reason ?? "null"}`,
);

const geo = review(proxy.NVDA, "NVDA", "United States", [
  { name: "United States Segment", brand: "United States", brandOwner: "NVIDIA" },
  { name: "Texas", brand: "Texas", brandOwner: "NVIDIA" },
], "geographic");
gap(
  "geographic-keeps-exact-compare",
  kept(geo.children, "United States Segment") && kept(geo.children, "Texas"),
  `kept=${names(geo.children)} reason=${geo.reason ?? "null"}`,
);
const geoExact = review(proxy.NVDA, "NVDA", "United States", [
  { name: "United States", brand: "United States", brandOwner: "NVIDIA" },
], "geographic");
gap(
  "geographic-exact-parent-still-dropped",
  geoExact.children.length === 0 && geoExact.reason === KI_FILTERED,
  `kept=${names(geoExact.children)} reason=${geoExact.reason ?? "null"}`,
);

gap(
  "prompt-version-unchanged",
  route.SEGMENT_CHILDREN_PROMPT_VERSION === "n29-brandOwner",
  `version=${route.SEGMENT_CHILDREN_PROMPT_VERSION}`,
);

route.resetSegmentChildrenGuardsForTests();
const app = express();
route.registerSegmentGrowthRoute(app, {
  fmpAvailable: () => true,
  raw: async () => [{ fiscalYear: "2025", data: { "Data Center": 80, Gaming: 20 } }],
  identity: async () => ({
    companyName: proxy.NVDA.companyName,
    exchange: "NASDAQ",
    country: "US",
    sector: "Technology",
    industry: "Semiconductors",
    description: proxy.NVDA.description,
  }),
  peers: async () => [],
  ki: async () => ({
    companyEcho: "NVIDIA Corporation",
    industryEcho: "Semiconductors",
    children: [
      { name: "Data Center Segment", brand: "Data Center", brandOwner: "NVIDIA", owner: proxy.NVDA.companyName, basis: "Bekannte Produktlinie", source: null },
      { name: "DGX Systems", brand: "DGX", brandOwner: "NVIDIA", owner: proxy.NVDA.companyName, basis: "Bekannte Produktlinie", source: null },
    ],
  }),
});
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
const url = childrenUi.segmentChildrenUrl("NVDA", "Data Center", "product");
try {
  const response = await fetch(`http://127.0.0.1:${port}${url}`);
  const body = await response.json() as { children?: { name: string }[]; reason?: string | null; promptVersion?: string; parent?: string };
  const viaClient = await childrenUi.fetchSegmentChildren(
    { ticker: "NVDA", parent: "Data Center", kind: "product" },
    async () => new Response(JSON.stringify(body), { status: response.status, headers: { "content-type": "application/json" } }),
  );
  const markup = renderToStaticMarkup(React.createElement(childrenUi.SegmentChildrenList, { data: viaClient }));
  gap(
    "route-ui-drops-parent-echo",
    response.status === 200
      && body.parent === "Data Center"
      && body.promptVersion === "n29-brandOwner"
      && !kept(body.children ?? [], "Data Center Segment")
      && kept(body.children ?? [], "DGX Systems")
      && viaClient.children.some((row) => row.name === "DGX Systems")
      && !viaClient.children.some((row) => row.name === "Data Center Segment")
      && markup.includes("DGX Systems")
      && markup.includes("KI-Schätzung")
      && !markup.includes("Data Center Segment"),
    `status=${response.status} parent=${body.parent ?? ""} version=${body.promptVersion ?? ""} kept=${names(body.children ?? [])} reason=${body.reason ?? "null"}`,
  );
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment parent-as-child: OK");
