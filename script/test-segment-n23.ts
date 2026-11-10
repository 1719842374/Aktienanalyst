/**
 * #465 N23: Ein KI-Unterposten, dessen Name eine andere Firma oder Marke nennt,
 * wird im Server-Validator verworfen und als „Fremdmarke verworfen“ markiert.
 * Fall: HPE → Networking → „Arista Networking“ (Tester-FAIL Punkt 4, 4307333d).
 * Kein Live-FMP und kein Live-LLM.
 *
 * Aufruf: npx tsx --tsconfig script/tsconfig.jsx.json script/test-segment-n23.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import express from "express";
import { reviewKiChildren } from "../shared/segment-children";
import { SegmentChildrenList } from "../client/src/components/sections/SegmentChildren";
import {
  loadOutlineIdentity,
  registerSegmentGrowthRoute,
  resetSegmentChildrenGuardsForTests,
  segmentChildrenKiMessages,
} from "../server/segment-growth-route";
(globalThis as any).React = React; // Komponenten nutzen das automatische JSX-Runtime im Vite-Build

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

const fixture = JSON.parse(readFileSync("script/fixtures/hpe-networking-children-n23.json", "utf8")) as {
  profile: { companyName: string; exchange: string; country: string; sector: string; industry: string; description: string };
  tester: { parent: string; children: { name: string }[]; reason: string | null };
  ki: { companyEcho: string; industryEcho: string; children: Record<string, unknown>[] };
  peers: { symbol: string; companyName: string }[];
};
const company = fixture.profile.companyName;
const names = (rows: { name: string }[]) => rows.map((row) => row.name).join(" | ");
const scope = (extra: Record<string, unknown> = {}) => ({
  kind: "product" as const,
  companyName: company,
  ticker: "HPE",
  description: fixture.profile.description,
  peerCompanies: fixture.peers,
  ...extra,
});

gap(
  "fixture-is-tester-fail",
  fixture.tester.children.some((row) => row.name === "Arista Networking") && fixture.tester.reason == null,
  `tester=${names(fixture.tester.children)} reason=${String(fixture.tester.reason)}`,
);

// 1) Peer-Regel: Name enthält den Firmennamen eines FMP-Peers.
const peerCase = reviewKiChildren("Networking", fixture.ki, null, scope());
gap(
  "arista-peer-rejected",
  !peerCase.children.some((row) => row.name === "Arista Networking")
    && /n\/a — Fremdmarke verworfen: Arista Networking/.test(peerCase.reason ?? ""),
  `kept=${names(peerCase.children)} reason=${peerCase.reason ?? "null"}`,
);
gap(
  "hpe-children-kept",
  peerCase.children.some((row) => row.name === "Networking Switches and Routers")
    && peerCase.children.some((row) => row.name === "Networking Security Solutions"),
  `kept=${names(peerCase.children)}`,
);

// 2) Marken-Regel ohne Peer-Treffer: die KI nennt die Marke, sie gehört nicht zur Firma.
const brandKi = {
  ...fixture.ki,
  children: fixture.ki.children.map((row) => (row.name === "Arista Networking" ? { ...row, brand: "Arista" } : { ...row, brand: "" })),
};
const brandCase = reviewKiChildren("Networking", brandKi, null, scope({ peerCompanies: [] }));
gap(
  "arista-brand-rejected",
  !brandCase.children.some((row) => row.name === "Arista Networking")
    && /Fremdmarke verworfen: Arista Networking/.test(brandCase.reason ?? ""),
  `kept=${names(brandCase.children)} reason=${brandCase.reason ?? "null"}`,
);

// 3) Gegenproben: Eigenmarke und echte HPE-Kinder bleiben.
const ownKi = {
  companyEcho: company,
  industryEcho: fixture.profile.industry,
  children: [
    { name: "HPE Aruba Networking", owner: company, brand: "HPE Aruba Networking", basis: "KI-Schätzung", source: null },
    { name: "Aruba Networking", owner: company, brand: "Aruba", basis: "KI-Schätzung", source: null },
    { name: "Switches", owner: company, brand: "", basis: "KI-Schätzung", source: null },
    { name: "Routers", owner: company, basis: "KI-Schätzung", source: null },
  ],
};
const ownCase = reviewKiChildren("Networking", ownKi, null, scope());
gap(
  "own-brand-kept",
  ["HPE Aruba Networking", "Aruba Networking", "Switches", "Routers"].every((name) => ownCase.children.some((row) => row.name === name))
    && !/Fremdmarke/.test(ownCase.reason ?? ""),
  `kept=${names(ownCase.children)} reason=${ownCase.reason ?? "null"}`,
);
const ownNoDescription = reviewKiChildren("Networking", ownKi, null, scope({ description: "" }));
gap(
  "own-ticker-kept-without-description",
  ownNoDescription.children.some((row) => row.name === "HPE Aruba Networking")
    && ["Switches", "Routers"].every((name) => ownNoDescription.children.some((row) => row.name === name)),
  `kept=${names(ownNoDescription.children)} reason=${ownNoDescription.reason ?? "null"}`,
);

// 4) Peer-Ticker als Wort, aber im eigenen Vokabular: kein Treffer.
const itCase = reviewKiChildren("Services", {
  children: [{ name: "IT Services", owner: company, basis: "KI-Schätzung", source: null }],
}, null, scope({ peerCompanies: [{ symbol: "IT", companyName: "Gartner, Inc." }] }));
gap("own-word-peer-ticker-kept", itCase.children.length === 1, `kept=${names(itCase.children)} reason=${itCase.reason ?? "null"}`);
const dellCase = reviewKiChildren("Compute", {
  children: [{ name: "Dell PowerEdge", owner: company, basis: "KI-Schätzung", source: null }],
}, null, scope({ peerCompanies: [{ symbol: "DELL", companyName: "Dell Technologies Inc." }] }));
gap(
  "peer-ticker-word-rejected",
  dellCase.children.length === 0 && /Fremdmarke verworfen: Dell PowerEdge/.test(dellCase.reason ?? ""),
  `kept=${names(dellCase.children)} reason=${dellCase.reason ?? "null"}`,
);

// 5) Ohne companyName bleibt das Verhalten wie bisher (kein Firmenbezug prüfbar).
const noCompany = reviewKiChildren("Networking", fixture.ki, null, { kind: "product", peerCompanies: fixture.peers });
gap("no-company-unchanged", noCompany.children.length === 3, `kept=${names(noCompany.children)}`);

// 6) Prompt verbietet fremde Marken und fragt brand ab (zusätzlich, nicht allein).
const prompt = segmentChildrenKiMessages("HPE", "Networking", "product", [], undefined, { ...fixture.profile, fiscalYear: "2025", currency: "USD" });
gap(
  "prompt-brand-rule",
  /"brand":""/.test(prompt.prompt) && /Keine Produkte oder Marken einer anderen Firma/.test(prompt.prompt),
  "prompt",
);

// 7) Identität trägt die FMP-Beschreibung als eigenes Vokabular.
resetSegmentChildrenGuardsForTests();
const identity = await loadOutlineIdentity("HPE", {
  profile: async () => ({ ...fixture.profile }),
  income: async () => [{ fiscalYear: 2025, reportedCurrency: "USD" }],
});
gap("identity-description", (identity as { description?: string } | null)?.description === fixture.profile.description, String((identity as { description?: string } | null)?.description?.slice(0, 40)));

// 8) Datenfluss: Route → Validator → JSON → Section-3-Liste.
resetSegmentChildrenGuardsForTests();
let peerCalls = 0;
const app = express();
registerSegmentGrowthRoute(app, {
  fmpAvailable: () => true,
  raw: async () => [],
  names: async () => ["Networking", "Server", "Hybrid Cloud"],
  identity: async () => ({ ...fixture.profile, fiscalYear: "2025", currency: "USD" }),
  ki: async () => fixture.ki,
  peers: async () => {
    peerCalls += 1;
    return fixture.peers;
  },
} as Parameters<typeof registerSegmentGrowthRoute>[1]);
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/segment-children/HPE?parent=Networking&kind=product`);
  const body = await response.json() as { parent: string; children: { name: string; parent: string; source: "KI"; revenue: null; shareOfParentPct: null }[]; reason: string | null };
  gap(
    "route-rejects-arista",
    response.status === 200
      && peerCalls === 1
      && !body.children.some((row) => row.name === "Arista Networking")
      && body.children.some((row) => row.name === "Networking Switches and Routers")
      && /Fremdmarke verworfen: Arista Networking/.test(body.reason ?? ""),
    `status=${response.status} peers=${peerCalls} kept=${names(body.children)} reason=${body.reason ?? "null"}`,
  );
  const markup = renderToStaticMarkup(React.createElement(SegmentChildrenList, { data: body as never }));
  gap(
    "ui-shows-note",
    /data-testid="segment-children-note"[^>]*>n\/a — Fremdmarke verworfen: Arista Networking/.test(markup)
      && !/>Arista Networking</.test(markup)
      && />Networking Switches and Routers</.test(markup),
    markup.slice(0, 240),
  );
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n23: OK");
