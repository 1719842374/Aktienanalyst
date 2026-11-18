/**
 * #465 N24 (DC 1a2ff1e3, P2-1/P2-2/P3):
 * a) Kurze Peer-Ticker (AI, ON, IT) verwerfen nie allein; Ticker zählt nur ab 3 Zeichen
 *    exakt in Großschreibung oder wenn er zugleich das erste Wort des Peer-Namens ist.
 * b) Outline/Asien-Fallback (reviewSegmentOutline, POST /api/segment-outline) hat dieselbe
 *    Namensprüfung; der Elternname zählt nicht als eigenes Vokabular seiner Kinder.
 * c) Der Vorrang der eigenen Firma ist durch einen Test gebunden.
 * Kein Live-FMP und kein Live-LLM.
 *
 * Aufruf: npx tsx script/test-segment-n24.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import express from "express";
import { reviewKiChildren, reviewSegmentOutline } from "../shared/segment-children";
import * as Section2Module from "../client/src/components/sections/Section2";
import { registerSegmentGrowthRoute, resetSegmentChildrenGuardsForTests } from "../server/segment-growth-route";
(globalThis as any).React = React; // Komponenten nutzen das automatische JSX-Runtime im Vite-Build

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

const fixture = JSON.parse(readFileSync("script/fixtures/hpe-networking-children-n23.json", "utf8")) as {
  profile: { companyName: string; exchange: string; country: string; sector: string; industry: string; description: string };
  peers: { symbol: string; companyName: string }[];
};
const company = fixture.profile.companyName;
const names = (rows: { name: string }[]) => rows.map((row) => row.name).join(" | ");
const kept = (rows: { name: string }[], name: string) => rows.some((row) => row.name === name);
const child = (name: string, extra: Record<string, unknown> = {}) => ({ name, owner: company, basis: "KI-Schätzung", source: null, ...extra });
const scope = (extra: Record<string, unknown> = {}) => ({
  kind: "product" as const,
  companyName: company,
  ticker: "HPE",
  description: fixture.profile.description,
  peerCompanies: fixture.peers,
  ...extra,
});

// ── a) P2-1 kurze Ticker ─────────────────────────────────────────────────────
const shortPeers = [
  { symbol: "HP", companyName: "" },
  { symbol: "IT", companyName: "Gartner, Inc." },
  { symbol: "AI", companyName: "C3.ai, Inc." },
  { symbol: "ON", companyName: "ON Semiconductor Corporation" },
  { symbol: "A", companyName: "Agilent Technologies, Inc." },
];
const shortNames = ["AI Infrastructure", "On-Premise Storage", "Turn ON Support", "IT Services", "Tier A Storage", "HP Servers"];
for (const description of [fixture.profile.description, ""]) {
  const label = description ? "mit Beschreibung" : "ohne Beschreibung";
  const reviewed = reviewKiChildren("Services", { children: shortNames.map((name) => child(name)) }, null, scope({ peerCompanies: shortPeers, description }));
  gap(
    `a-short-tickers-kept (${label})`,
    shortNames.every((name) => kept(reviewed.children, name)) && !/Fremdmarke/.test(reviewed.reason ?? ""),
    `kept=${names(reviewed.children)} reason=${reviewed.reason ?? "null"}`,
  );
}
const strongPeers = [
  { symbol: "ANET", companyName: "" },
  { symbol: "DELL", companyName: "Dell Technologies Inc." },
  { symbol: "HPQ", companyName: "HP Inc." },
  { symbol: "AI", companyName: "C3.ai, Inc." },
];
const strong = reviewKiChildren("Networking", {
  children: [child("ANET Switches"), child("Dell PowerEdge"), child("HP Servers"), child("C3.ai Suite"), child("Anet Router"), child("Switches"), child("Routers")],
}, null, scope({ peerCompanies: strongPeers, description: "" }));
gap(
  "a-strong-matches-rejected",
  ["ANET Switches", "Dell PowerEdge", "HP Servers", "C3.ai Suite"].every((name) => !kept(strong.children, name))
    && /Fremdmarke verworfen: ANET Switches, Dell PowerEdge, HP Servers, C3\.ai Suite/.test(strong.reason ?? ""),
  `kept=${names(strong.children)} reason=${strong.reason ?? "null"}`,
);
gap(
  "a-ticker-not-uppercase-kept",
  kept(strong.children, "Anet Router") && kept(strong.children, "Switches") && kept(strong.children, "Routers"),
  `kept=${names(strong.children)}`,
);

// ── b) P2-2 Outline-Pfad und Elternname ─────────────────────────────────────
const outlinePeers = [...fixture.peers, { symbol: "DELL", companyName: "Dell Technologies Inc." }];
const outlinePayload = {
  companyEcho: company,
  industryEcho: fixture.profile.industry,
  children: [
    { name: "Arista Networking", owner: "Arista Networks", brand: "Arista", basis: "KI-Schätzung", source: null },
    { name: "Dell PowerEdge Servers", basis: "KI-Schätzung", source: null },
    { name: "Compute", basis: "KI-Schätzung", source: null },
    { name: "HPE Aruba Networking", brand: "Aruba", basis: "KI-Schätzung", source: null },
  ],
};
const outline = (reviewSegmentOutline as (...args: unknown[]) => { items: { name: string }[]; reason: string | null })(
  outlinePayload,
  company,
  { ticker: "HPE", description: fixture.profile.description, peerCompanies: outlinePeers },
);
gap(
  "b-outline-unit-rejects",
  !kept(outline.items, "Arista Networking") && !kept(outline.items, "Dell PowerEdge Servers")
    && kept(outline.items, "Compute") && kept(outline.items, "HPE Aruba Networking")
    && /n\/a — Fremdmarke verworfen: Arista Networking, Dell PowerEdge Servers/.test(outline.reason ?? ""),
  `items=${names(outline.items)} reason=${outline.reason ?? "null"}`,
);
const brandOnlyOutline = (reviewSegmentOutline as (...args: unknown[]) => { items: { name: string }[]; reason: string | null })(
  { companyEcho: company, children: [{ name: "Arista Networking", brand: "Arista", basis: "KI-Schätzung" }, { name: "Compute", basis: "KI-Schätzung" }] },
  company,
  { ticker: "HPE", description: fixture.profile.description, peerCompanies: [] },
);
gap(
  "b-outline-brand-without-peers",
  !kept(brandOnlyOutline.items, "Arista Networking") && kept(brandOnlyOutline.items, "Compute"),
  `items=${names(brandOnlyOutline.items)} reason=${brandOnlyOutline.reason ?? "null"}`,
);
const foreignParent = reviewKiChildren("Arista Networking", {
  children: [child("Arista 7050X Switches", { brand: "Arista" }), child("Arista Networking Gear", { brand: "Arista" })],
}, null, scope());
gap(
  "b-parent-not-own-vocabulary",
  foreignParent.children.length === 0 && /Fremdmarke verworfen: Arista 7050X Switches, Arista Networking Gear/.test(foreignParent.reason ?? ""),
  `kept=${names(foreignParent.children)} reason=${foreignParent.reason ?? "null"}`,
);
const ownParent = reviewKiChildren("Networking", { children: [child("Switches"), child("Routers"), child("HPE Aruba Networking", { brand: "HPE Aruba Networking" })] }, null, scope());
gap("b-own-parent-children-kept", ownParent.children.length === 3, `kept=${names(ownParent.children)} reason=${ownParent.reason ?? "null"}`);

resetSegmentChildrenGuardsForTests();
let peerCalls = 0;
const app = express();
app.use(express.json());
registerSegmentGrowthRoute(app, {
  fmpAvailable: () => true,
  raw: async () => [],
  names: async () => [],
  identity: async () => ({ ...fixture.profile, fiscalYear: "2025", currency: "USD" }),
  outline: async () => outlinePayload,
  ki: async () => ({ companyEcho: company, industryEcho: fixture.profile.industry, children: [child("Arista 7050X Switches", { brand: "Arista" })] }),
  peers: async () => {
    peerCalls += 1;
    return outlinePeers;
  },
} as Parameters<typeof registerSegmentGrowthRoute>[1]);
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ticker: "HPE", kind: "product" }),
  });
  const body = await response.json() as { items: { name: string; shareOfParentPct: number | null; growthPct: number | null; basis: string; origin: "KI" }[]; reason: string | null };
  gap(
    "b-outline-route-rejects",
    response.status === 200 && peerCalls === 1
      && !kept(body.items, "Arista Networking") && !kept(body.items, "Dell PowerEdge Servers") && kept(body.items, "Compute")
      && /Fremdmarke verworfen: Arista Networking, Dell PowerEdge Servers/.test(body.reason ?? ""),
    `status=${response.status} peers=${peerCalls} items=${names(body.items ?? [])} reason=${body.reason ?? "null"}`,
  );
  const foreignChildren = await fetch(`http://127.0.0.1:${port}/api/segment-children/HPE?parent=${encodeURIComponent("Arista Networking")}&kind=product`);
  gap("b-rejected-outline-not-remembered", foreignChildren.status === 400, `status=${foreignChildren.status}`);
  const OutlineRows = (Section2Module as Record<string, unknown>).OutlineRows as ((props: Record<string, unknown>) => React.ReactElement) | undefined;
  let markup = "";
  if (typeof OutlineRows === "function") {
    markup = renderToStaticMarkup(React.createElement(OutlineRows, { ticker: "HPE", kind: "product", items: body.items, note: body.reason, open: {}, setOpen: () => undefined }));
  }
  gap(
    "b-outline-ui-note",
    /data-testid="segment-outline-note-product"[^>]*>n\/a — Fremdmarke verworfen: Arista Networking, Dell PowerEdge Servers/.test(markup)
      && />Compute</.test(markup) && !/>Arista Networking</.test(markup),
    markup ? markup.slice(0, 200) : "OutlineRows nicht exportiert",
  );
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}
const sectionSource = readFileSync("client/src/components/sections/Section2.tsx", "utf8");
gap(
  "b-section2-passes-reason",
  /setBusinessOutlineNote\(json\.reason \?\? null\)/.test(sectionSource) && /setGeoOutlineNote\(json\.reason \?\? null\)/.test(sectionSource)
    && /note=\{businessOutlineNote\}/.test(sectionSource) && /note=\{geoOutlineNote\}/.test(sectionSource),
  "Section2.tsx",
);

// ── c) Vorrang der eigenen Firma (P3-Testlücke) ──────────────────────────────
const ownFirst = reviewKiChildren("Networking", {
  children: [
    child("HPE Aruba Networking", { brand: "Aruba" }),
    child("Hewlett Packard Enterprise Pointnext", { brand: "Pointnext" }),
  ],
}, null, scope({ description: "", peerCompanies: [] }));
gap(
  "c-own-company-precedence",
  ownFirst.children.length === 2 && !/Fremdmarke/.test(ownFirst.reason ?? ""),
  `kept=${names(ownFirst.children)} reason=${ownFirst.reason ?? "null"}`,
);
const ownFirstOutline = (reviewSegmentOutline as (...args: unknown[]) => { items: { name: string }[]; reason: string | null })(
  { children: [{ name: "HPE Aruba Networking", brand: "Aruba", basis: "KI-Schätzung" }] },
  company,
  { ticker: "HPE", description: "", peerCompanies: [] },
);
gap("c-own-company-precedence-outline", ownFirstOutline.items.length === 1, `items=${names(ownFirstOutline.items)} reason=${ownFirstOutline.reason ?? "null"}`);

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n24: OK");
