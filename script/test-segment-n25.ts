/**
 * #465 N25 (Tester 5320f3ab, MSFT → Dynamics):
 * a/b) Eigene Produkte (Dynamics AX, NAV, CRM, „Dynamics 365 CRM“) werden nicht als Fremdmarke verworfen.
 *      Ein-Wort-Belege (Ticker, Kürzel, Erstwort) zählen nur am Namensanfang und weichen dem Elternnamen.
 *      Voller Peer-Name und fremdes brand bleiben starke Belege: HPE „Arista Networking“ und „Dell PowerEdge“
 *      werden weiter verworfen, auch im Outline-Pfad.
 * d)   Fällt der FMP-Abruf der Segmentliste aus (429), antwortet die Route 503 mit Retry-After statt
 *      400 „nicht in der Liste“, und der Ausfall wird nicht gecacht.
 * Kein Live-FMP und kein Live-LLM: fetch ist für financialmodelingprep.com gestubbt.
 *
 * Aufruf: npx tsx script/test-segment-n25.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import express from "express";
(globalThis as any).React = React;

process.env.FMP_API_KEY = "n25-test-dummy";
process.env.FMP_MAX_RETRIES = "0";
process.env.FMP_MIN_INTERVAL_MS = "0";
delete process.env.OPENROUTER_API_KEY;

const shared = await import("../shared/segment-children");
const { reviewKiChildren, reviewSegmentOutline } = shared;
const route = await import("../server/segment-growth-route");
const childrenUi = await import("../client/src/components/sections/SegmentChildren");

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}
const names = (rows: { name: string }[]) => rows.map((row) => row.name).join(" | ");
const kept = (rows: { name: string }[], name: string) => rows.some((row) => row.name === name);

type Peer = { symbol: string; companyName: string };
const msft = JSON.parse(readFileSync("script/fixtures/msft-dynamics-children-n25.json", "utf8")) as {
  profile: { companyName: string; industry: string; description: string };
  segments: string[];
  parent: string;
  tester: { children: { name: string }[]; reason: string | null };
  peersObserved: Peer[];
  peersCandidate: Peer[];
  peersCollision: Peer[];
};
const hpe = JSON.parse(readFileSync("script/fixtures/hpe-networking-children-n23.json", "utf8")) as {
  profile: { companyName: string; industry: string; description: string };
  peers: Peer[];
};
const ms = msft.profile.companyName;
const msSiblings = msft.segments.filter((name) => name !== "Dynamics");
const msChild = (name: string, extra: Record<string, unknown> = {}) => ({ name, owner: ms, basis: "Bekannte Produktlinie", source: null, ...extra });
const msScope = (peerCompanies: readonly Peer[], extra: Record<string, unknown> = {}) => ({
  kind: "product" as const,
  siblings: msSiblings,
  companyName: ms,
  ticker: "MSFT",
  description: msft.profile.description,
  peerCompanies,
  ...extra,
});
const allMsPeers = [...msft.peersObserved, ...msft.peersCandidate];

// ── Ausgangslage: Tester-Antwort ────────────────────────────────────────────
gap(
  "tester-baseline",
  /Fremdmarke verworfen: Dynamics AX, Dynamics NAV, Dynamics CRM/.test(msft.tester.reason ?? "") && kept(msft.tester.children, "Dynamics 365"),
  `reason=${msft.tester.reason}`,
);

// ── b/c) MSFT Dynamics: eigene Produktfamilie bleibt ────────────────────────
const dynamicsNames = ["Dynamics AX", "Dynamics NAV", "Dynamics CRM", "Dynamics 365 CRM", "Dynamics 365"];
const brandVariants: Array<[string, (name: string) => string]> = [
  ["brand=Name", (name) => name],
  ["brand=Kürzel", (name) => name.split(" ").slice(1).join(" ")],
  ["brand=leer", () => ""],
];
for (const [label, brandOf] of brandVariants) {
  for (const [peerLabel, peers] of [["beobachtet", msft.peersObserved], ["mit CRM/NOW", allMsPeers]] as const) {
    const reviewed = reviewKiChildren(msft.parent, { children: dynamicsNames.map((name) => msChild(name, { brand: brandOf(name) })) }, null, msScope(peers));
    gap(
      `msft-dynamics-kept (${label}, Peers ${peerLabel})`,
      dynamicsNames.every((name) => kept(reviewed.children, name)) && !/Fremdmarke/.test(reviewed.reason ?? ""),
      `kept=${names(reviewed.children)} reason=${reviewed.reason ?? "null"}`,
    );
  }
}

// ── c) Proben, die nicht fremd belegt sind, bleiben ─────────────────────────
const probes = ["NOW Platform", "Connected Cars", "Gap Analysis", "Meta Data Services", "Set-Top Box"];
const probeRun = reviewKiChildren("Server", { children: probes.map((name) => msChild(name)) }, null, msScope(msft.peersObserved));
gap(
  "probes-kept (MSFT, beobachtete Peers)",
  probes.every((name) => kept(probeRun.children, name)) && !/Fremdmarke/.test(probeRun.reason ?? ""),
  `kept=${names(probeRun.children)} reason=${probeRun.reason ?? "null"}`,
);
const tailProbes = ["Connected Cars", "Set-Top Box"];
const tailRun = reviewKiChildren("Server", { children: tailProbes.map((name) => msChild(name)) }, null, msScope([...allMsPeers, ...msft.peersCollision]));
gap(
  "probes-tail-word-kept (CARS/BOX als Peer)",
  tailProbes.every((name) => kept(tailRun.children, name)),
  `kept=${names(tailRun.children)} reason=${tailRun.reason ?? "null"}`,
);
const parentRun = reviewKiChildren("Platform Services", { children: [msChild("NOW Platform"), msChild("Meta Data Platform")] }, null, msScope([...allMsPeers, ...msft.peersCollision]));
gap(
  "probes-parent-name-beats-ticker (NOW/META als Peer, Elter „Platform Services“)",
  kept(parentRun.children, "NOW Platform") && kept(parentRun.children, "Meta Data Platform"),
  `kept=${names(parentRun.children)} reason=${parentRun.reason ?? "null"}`,
);

// ── b) HPE: Arista und Dell bleiben verworfen ───────────────────────────────
const hc = hpe.profile.companyName;
const hpeChild = (name: string, extra: Record<string, unknown> = {}) => ({ name, owner: hc, basis: "KI-Schätzung", source: null, ...extra });
const hpeScope = (extra: Record<string, unknown> = {}) => ({ kind: "product" as const, companyName: hc, ticker: "HPE", description: hpe.profile.description, peerCompanies: hpe.peers, ...extra });
const dellPeer = { symbol: "DELL", companyName: "Dell Technologies Inc." };
const arista = reviewKiChildren("Networking", { children: [hpeChild("Arista Networking"), hpeChild("Switches"), hpeChild("HPE Aruba Networking")] }, null, hpeScope());
gap(
  "hpe-arista-full-name-beats-parent",
  !kept(arista.children, "Arista Networking") && kept(arista.children, "Switches") && kept(arista.children, "HPE Aruba Networking")
    && /Fremdmarke verworfen: Arista Networking/.test(arista.reason ?? ""),
  `kept=${names(arista.children)} reason=${arista.reason ?? "null"}`,
);
const aristaBrand = reviewKiChildren("Networking", { children: [hpeChild("Arista Networking", { brand: "Arista" })] }, null, hpeScope({ peerCompanies: [] }));
gap("hpe-arista-brand-beats-parent", aristaBrand.children.length === 0 && /Fremdmarke verworfen: Arista Networking/.test(aristaBrand.reason ?? ""), `reason=${aristaBrand.reason ?? "null"}`);
const dell = reviewKiChildren("Compute", { children: [hpeChild("Dell PowerEdge"), hpeChild("HPE ProLiant")] }, null, hpeScope({ peerCompanies: [...hpe.peers, dellPeer] }));
gap(
  "hpe-dell-poweredge-rejected",
  !kept(dell.children, "Dell PowerEdge") && kept(dell.children, "HPE ProLiant") && /Fremdmarke verworfen: Dell PowerEdge/.test(dell.reason ?? ""),
  `kept=${names(dell.children)} reason=${dell.reason ?? "null"}`,
);
const outline = reviewSegmentOutline(
  {
    companyEcho: hc,
    children: [
      { name: "Arista Networking", basis: "KI-Schätzung" },
      { name: "Dell PowerEdge", basis: "KI-Schätzung" },
      { name: "Compute", basis: "KI-Schätzung" },
    ],
  },
  hc,
  { ticker: "HPE", description: hpe.profile.description, peerCompanies: [...hpe.peers, dellPeer] },
);
gap(
  "hpe-outline-arista-dell-rejected",
  !kept(outline.items, "Arista Networking") && !kept(outline.items, "Dell PowerEdge") && kept(outline.items, "Compute")
    && /Fremdmarke verworfen: Arista Networking, Dell PowerEdge/.test(outline.reason ?? ""),
  `items=${names(outline.items)} reason=${outline.reason ?? "null"}`,
);
const msOutline = reviewSegmentOutline(
  { companyEcho: ms, children: dynamicsNames.map((name) => ({ name, brand: name, basis: "Bekannte Produktlinie" })) },
  ms,
  { ticker: "MSFT", description: msft.profile.description, peerCompanies: allMsPeers },
);
gap("msft-outline-dynamics-kept", dynamicsNames.every((name) => kept(msOutline.items, name)), `items=${names(msOutline.items)} reason=${msOutline.reason ?? "null"}`);

// ── d) FMP-Ausfall der Segmentliste: 503 statt 400, nicht gecacht ───────────
const realFetch = globalThis.fetch;
let fmpMode: "429" | "ok" | "404" = "429";
let fmpCalls = 0;
const segmentRows = [{ symbol: "ZZN25", fiscalYear: 2025, period: "FY", date: "2025-06-30", data: { "Dynamics products and cloud services": 7000, Server: 9000 } }];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.includes("financialmodelingprep.com")) return realFetch(input, init);
  fmpCalls += 1;
  if (fmpMode === "429") return new Response("Limit Reach", { status: 429 });
  if (fmpMode === "404") return new Response("[]", { status: 404 });
  if (url.includes("revenue-product-segmentation")) return new Response(JSON.stringify(segmentRows), { status: 200 });
  if (url.includes("/profile")) return new Response(JSON.stringify([{ companyName: "ZZ N25 Corp", exchange: "NASDAQ", country: "US", sector: "Technology", industry: "Software", description: "" }]), { status: 200 });
  return new Response("[]", { status: 200 });
}) as typeof fetch;

route.resetSegmentChildrenGuardsForTests();
const app = express();
route.registerSegmentGrowthRoute(app);
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
const url = `http://127.0.0.1:${port}/api/segment-children/ZZN25?parent=${encodeURIComponent("Dynamics")}&kind=product`;
const unavailable = (shared as Record<string, unknown>).SEGMENT_LIST_UNAVAILABLE;
try {
  const first = await realFetch(url);
  const firstBody = await first.json() as { error?: string };
  gap(
    "d-fmp-429-is-503",
    first.status === 503 && first.headers.get("retry-after") === "60" && typeof unavailable === "string" && firstBody.error === unavailable,
    `status=${first.status} retry-after=${first.headers.get("retry-after")} error=${firstBody.error} fmpCalls=${fmpCalls}`,
  );
  fmpMode = "ok";
  const second = await realFetch(url);
  const secondBody = await second.json() as { parent?: string; reason?: string | null; error?: string };
  gap(
    "d-failure-not-cached",
    second.status === 200 && secondBody.parent === "Dynamics products and cloud services",
    `status=${second.status} parent=${secondBody.parent} reason=${secondBody.reason ?? secondBody.error}`,
  );
  route.resetSegmentChildrenGuardsForTests();
  fmpMode = "404";
  const missing = await realFetch(`http://127.0.0.1:${port}/api/segment-children/ZZN25?parent=${encodeURIComponent("Nope")}&kind=product`);
  const missingBody = await missing.json() as { error?: string };
  gap("d-no-data-stays-400", missing.status === 400 && missingBody.error === shared.SEGMENT_UNKNOWN, `status=${missing.status} error=${missingBody.error}`);
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  globalThis.fetch = realFetch;
}

// UI-Kette: fetchSegmentChildren zeigt den ehrlichen Text, ohne „Schätzung erneut auslösen“.
let uiMessage = "";
try {
  await childrenUi.fetchSegmentChildren(
    { ticker: "MSFT", parent: "Dynamics", kind: "product" },
    async () => new Response(JSON.stringify({ error: typeof unavailable === "string" ? unavailable : shared.SEGMENT_UNKNOWN }), { status: 503 }),
  );
} catch (err) {
  uiMessage = err instanceof Error ? err.message : "";
}
const panelMarkup = renderToStaticMarkup(React.createElement("p", null, uiMessage));
gap(
  "d-ui-shows-honest-text",
  typeof unavailable === "string" && uiMessage === unavailable && !/serverseitigen Liste/.test(panelMarkup),
  `message=${uiMessage}`,
);

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n25: OK");
