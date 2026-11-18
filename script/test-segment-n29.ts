/**
 * #465 N29 (Stabschef: brandOwner vorziehen, Tester-FAIL A1 „Fremdmarke verworfen: Power Platform“):
 * 1) Prompt und Schema (Kinder :374, Outline :514) führen pro Kind brandOwner (Firma, der die Marke gehört, sonst null).
 * 2) Regel nach allen Peer-Belegen aus dem Namen: brandOwner = geladener Peer → verworfen; = eigene Firma (Name ohne
 *    Rechtsform oder Ticker) → bleibt, sticht brand-only; = andere Firma → verworfen, auch ohne Peer; fehlt/null → wie N28.
 * 3) Cache-Schlüssel der KI-Kinder trägt die Prompt-Version.
 * Kein Live-FMP und kein Live-LLM. NVDA/AAPL-Profile sind eine Näherung (Fixture-_source).
 *
 * Aufruf: npx tsx script/test-segment-n29.ts
 */
import { readFileSync } from "node:fs";
import { reviewKiChildren, reviewSegmentOutline } from "../shared/segment-children";
import * as route from "../server/segment-growth-route";

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}
const names = (rows: { name: string }[]) => rows.map((row) => row.name).join(" | ");
const kept = (rows: { name: string }[], name: string) => rows.some((row) => row.name === name);

type Peer = { symbol: string; companyName: string };
type Profile = { companyName: string; description: string };
const msft = JSON.parse(readFileSync("script/fixtures/msft-dynamics-children-n25.json", "utf8")) as {
  profile: Profile; segments: string[]; parent: string; peersObserved: Peer[]; peersCandidate: Peer[]; peersCollision: Peer[];
};
const hpe = JSON.parse(readFileSync("script/fixtures/hpe-networking-children-n23.json", "utf8")) as { profile: Profile; peers: Peer[] };
const proxy = JSON.parse(readFileSync("script/fixtures/nvda-aapl-profile-proxy-n29.json", "utf8")) as { NVDA: Profile; AAPL: Profile };
const msAll = [...msft.peersObserved, ...msft.peersCandidate, ...msft.peersCollision];
const hpeProd = hpe.peers.filter((peer) => peer.symbol === "WDC" || peer.symbol === "NTAP");
const hpeWdc = hpe.peers.filter((peer) => peer.symbol === "WDC");

function review(profile: Profile, ticker: string, parent: string, child: Record<string, unknown>, peers: readonly Peer[], siblings: readonly string[] = []) {
  return reviewKiChildren(parent, { children: [{ owner: profile.companyName, basis: "Bekannte Produktlinie", source: null, ...child }] }, null, {
    kind: "product", siblings, companyName: profile.companyName, ticker, description: profile.description, peerCompanies: peers,
  });
}
const ms = (child: Record<string, unknown>, peers: readonly Peer[] = msAll) => review(msft.profile, "MSFT", msft.parent, child, peers, msft.segments.filter((n) => n !== "Dynamics"));
const hp = (parent: string, child: Record<string, unknown>, peers: readonly Peer[] = hpe.peers) => review(hpe.profile, "HPE", parent, child, peers);

// ── 1) Prompt und Schema ────────────────────────────────────────────────────
const product = route.segmentChildrenKiMessages("MSFT", "Dynamics", "product", []);
const geo = route.segmentChildrenKiMessages("MSFT", "United States", "geographic", []);
const promptOk = (text: string) => text.includes('"brandOwner":null') && /brandOwner nennt die Firma, der diese Marke gehört/.test(text);
gap("prompt-children-brandOwner (product + geographic)", promptOk(product.prompt) && promptOk(geo.prompt), `product=${promptOk(product.prompt)} geographic=${promptOk(geo.prompt)}`);
const routeSource = readFileSync("server/segment-growth-route.ts", "utf8");
const outlineBody = routeSource.slice(routeSource.indexOf("async function defaultOutline"), routeSource.indexOf("export function defaultSegmentChildrenDeps"));
gap("prompt-outline-brandOwner", promptOk(outlineBody), `outline=${promptOk(outlineBody)}`);

// ── 2) Cache-Schlüssel mit Prompt-Version ───────────────────────────────────
const keyFn = (route as Record<string, unknown>).segmentChildrenCacheKey as ((t: string, k: "product" | "geographic", p: string) => string) | undefined;
const version = (route as Record<string, unknown>).SEGMENT_CHILDREN_PROMPT_VERSION as string | undefined;
const key = keyFn ? keyFn("msft", "product", "  Dynamics   Products ") : "";
gap("cache-key-has-prompt-version", !!version && key === `${version}|MSFT|product|dynamics products`, `version=${version ?? "fehlt"} key=${key || "fehlt"}`);

// ── 3) brandOwner = eigene Firma: bleibt (sticht brand-only) ────────────────
for (const owner of ["Microsoft", "Microsoft Corporation", "MSFT"]) {
  const r = ms({ name: "Power Platform", brand: "Power Platform", brandOwner: owner });
  gap(`own-msft-power-platform (brandOwner ${owner}, Meta Platforms geladen)`, kept(r.children, "Power Platform"), `kept=${names(r.children)} reason=${r.reason ?? "null"}`);
}
const ownCases: [string, () => ReturnType<typeof ms>, string][] = [
  ["Azure OpenAI Service", () => ms({ name: "Azure OpenAI Service", brand: "Azure OpenAI", brandOwner: "Microsoft" }), "MSFT"],
  ["GitHub Copilot", () => ms({ name: "GitHub Copilot", brand: "GitHub Copilot", brandOwner: "Microsoft" }), "MSFT"],
  ["Alletra MP", () => hp("Storage", { name: "Alletra MP", brand: "Alletra", brandOwner: "Hewlett Packard Enterprise" }), "HPE"],
  ["GreenLake Cloud", () => hp("Hybrid Cloud", { name: "GreenLake Cloud", brand: "GreenLake", brandOwner: "HPE" }), "HPE"],
  ["DGX Systems", () => review(proxy.NVDA, "NVDA", "Data Center", { name: "DGX Systems", brand: "DGX", brandOwner: "NVIDIA" }, []), "NVDA"],
  ["MacBook Air", () => review(proxy.AAPL, "AAPL", "Mac", { name: "MacBook Air", brand: "MacBook", brandOwner: "Apple" }, []), "AAPL"],
];
for (const [name, run, ticker] of ownCases) {
  const r = run();
  gap(`own-subbrand-kept ${ticker} ${name}`, kept(r.children, name), `kept=${names(r.children)} reason=${r.reason ?? "null"}`);
}
const outline = reviewSegmentOutline(
  { companyEcho: msft.profile.companyName, children: [{ name: "Power Platform", brand: "Power Platform", brandOwner: "Microsoft", basis: "b" }] },
  msft.profile.companyName,
  { ticker: "MSFT", description: msft.profile.description, peerCompanies: msAll },
);
gap("own-outline-power-platform-kept", kept(outline.items, "Power Platform"), `items=${names(outline.items)} reason=${outline.reason ?? "null"}`);

// ── 4) brandOwner = andere Firma: verworfen, auch ohne Peer ─────────────────
const foreignCases: [string, ReturnType<typeof ms>][] = [
  ["Arista Networking (brandOwner Arista Networks, brand leer, Peers WDC/NTAP)", hp("Networking", { name: "Arista Networking", brand: "", brandOwner: "Arista Networks" }, hpeProd)],
  ["Arista Networking (brandOwner Arista Networks, brand Arista, Peers WDC/NTAP)", hp("Networking", { name: "Arista Networking", brand: "Arista", brandOwner: "Arista Networks" }, hpeProd)],
  ["Surface Arista (brandOwner Arista Networks, ohne Arista-Peer)", ms({ name: "Surface Arista", brandOwner: "Arista Networks" }, msft.peersObserved)],
  ["Windows Oracle Database (brandOwner Oracle, ohne Peers)", ms({ name: "Windows Oracle Database", brandOwner: "Oracle" }, [])],
  ["NetApp Storage (brandOwner NetApp, Peers nur WDC)", hp("Storage", { name: "NetApp Storage", brandOwner: "NetApp" }, hpeWdc)],
];
// Regel 1: brandOwner nennt einen geladenen Peer (Name oder Ticker), ohne Beleg im Namen.
foreignCases.push(
  ["ProLiant Storage Bundle (brandOwner NetApp, NTAP geladen)", hp("Storage", { name: "ProLiant Storage Bundle", brandOwner: "NetApp" }, hpeProd)],
  ["ProLiant Storage Bundle (brandOwner Ticker NTAP, NTAP geladen)", hp("Storage", { name: "ProLiant Storage Bundle", brandOwner: "NTAP" }, hpeProd)],
);
for (const [label, r] of foreignCases) gap(`foreign-owner-rejected ${label}`, r.children.length === 0 && /Fremdmarke verworfen/.test(r.reason ?? ""), `reason=${r.reason ?? "null"}`);

// ── 5) Lügen-Tests: Peer-Belege aus dem Namen gehen vor brandOwner = eigene Firma ─
const lies: [string, ReturnType<typeof ms>][] = [
  ["Arista Networking (brandOwner HPE, Arista Networks geladen)", hp("Networking", { name: "Arista Networking", brand: "Arista", brandOwner: "Hewlett Packard Enterprise" }, hpe.peers)],
  ["Windows Oracle Database (brandOwner Microsoft, ORCL geladen)", ms({ name: "Windows Oracle Database", brandOwner: "Microsoft" }, msft.peersObserved)],
  ["NetApp Storage (brandOwner HPE, NTAP geladen)", hp("Storage", { name: "NetApp Storage", brandOwner: "HPE" }, hpeProd)],
];
for (const [label, r] of lies) gap(`lie-peer-evidence-wins ${label}`, r.children.length === 0, `reason=${r.reason ?? "null"}`);
const lieNoPeer = hp("Networking", { name: "Arista Networking", brand: "Arista", brandOwner: "Hewlett Packard Enterprise" }, hpeProd);
console.log(`DOC P3 Lüge ohne Arista-Peer (brand Arista, brandOwner HPE, Peers WDC/NTAP): kept=${names(lieNoPeer.children)} reason=${lieNoPeer.reason ?? "null"}`);

// ── 6) brandOwner fehlt, null oder Platzhalter: wie N28 ─────────────────────
for (const owner of [undefined, null, "", "null", "unklar"]) {
  const r = ms(owner === undefined ? { name: "Power Platform", brand: "Power Platform" } : { name: "Power Platform", brand: "Power Platform", brandOwner: owner });
  gap(`no-owner-like-n28 (brandOwner ${JSON.stringify(owner) ?? "fehlt"})`, r.children.length === 0 && /Fremdmarke verworfen: Power Platform/.test(r.reason ?? ""), `reason=${r.reason ?? "null"}`);
}
const tail = ms({ name: "Set-Top Box" });
gap("no-owner-tail-word-kept (Set-Top Box)", kept(tail.children, "Set-Top Box"), `kept=${names(tail.children)}`);

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n29: OK");
