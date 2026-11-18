/**
 * #465 N28 (Tester-FAIL A1 @1b3eeef5, DC P3-T/P3-S):
 * 1) Gegen Peer-Namen zählt nur der unterscheidende Teil des Firmennamens ohne GENERIC_COMPANY_WORDS
 *    („Arista Networks“ → arista, „Cisco Systems“ → cisco), für den einwortigen Peer-Namen und das brand-Wort im Peer-Namen.
 * 2) P3-S: Längen von Peer-Namen und brand-Wörtern am Rohwort („Boeing“ = 6, „Corning“ = 7), nicht am Stamm.
 * 3) A2/P3-T: PEER_NAME_ANYWHERE_MIN_LENGTH ist gebunden (4 Zeichen bleibt, 5 Zeichen wird verworfen).
 * 4) Power Platform bleibt bei brand leer und „Microsoft Power Platform“, auch mit Meta Platforms als Peer.
 *    brand „Power Platform“ bleibt verworfen: „Power“ steht nicht im FMP-Profil (Ursache A1, nur Doku, siehe Bericht).
 * Kein Live-FMP und kein Live-LLM.
 *
 * Aufruf: npx tsx script/test-segment-n28.ts
 */
import { readFileSync } from "node:fs";
import { reviewKiChildren, reviewSegmentOutline } from "../shared/segment-children";

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}
const names = (rows: { name: string }[]) => rows.map((row) => row.name).join(" | ");
const kept = (rows: { name: string }[], name: string) => rows.some((row) => row.name === name);

type Peer = { symbol: string; companyName: string };
const msft = JSON.parse(readFileSync("script/fixtures/msft-dynamics-children-n25.json", "utf8")) as {
  profile: { companyName: string; description: string };
  segments: string[];
  parent: string;
  peersObserved: Peer[];
  peersCandidate: Peer[];
  peersCollision: Peer[];
};
const hpe = JSON.parse(readFileSync("script/fixtures/hpe-networking-children-n23.json", "utf8")) as {
  profile: { companyName: string; description: string };
  peers: Peer[];
};
const ms = msft.profile.companyName;
const hc = hpe.profile.companyName;
const msAll = [...msft.peersObserved, ...msft.peersCandidate, ...msft.peersCollision];
const anet = hpe.peers.find((peer) => peer.symbol === "ANET") as Peer;
const csco = { symbol: "CSCO", companyName: "Cisco Systems, Inc." };
const snap = { symbol: "SNAP", companyName: "Snap Inc." };
const intc = { symbol: "INTC", companyName: "Intel Corporation" };
const boeing = { symbol: "BA", companyName: "The Boeing Company" };
const corning = { symbol: "GLW", companyName: "Corning Incorporated" };
const msChild = (name: string, extra: Record<string, unknown> = {}) => ({ name, owner: ms, basis: "Bekannte Produktlinie", source: null, ...extra });
const hpeChild = (name: string, extra: Record<string, unknown> = {}) => ({ name, owner: hc, basis: "KI-Schätzung", source: null, ...extra });
const msScope = (peerCompanies: readonly Peer[]) => ({
  kind: "product" as const,
  siblings: msft.segments.filter((name) => name !== "Dynamics"),
  companyName: ms,
  ticker: "MSFT",
  description: msft.profile.description,
  peerCompanies,
});
const hpeScope = (peerCompanies: readonly Peer[]) => ({ kind: "product" as const, companyName: hc, ticker: "HPE", description: hpe.profile.description, peerCompanies });

// ── 1) unterscheidender Teil des Peer-Namens ────────────────────────────────
const distinct = reviewKiChildren("Windows and Devices", { children: [msChild("Surface Arista"), msChild("Azure Cisco Gateway"), msChild("Surface Pro")] }, null, msScope([...msAll, anet, csco]));
gap(
  "distinct-peer-name-anywhere-rejected (Arista Networks, Cisco Systems)",
  !kept(distinct.children, "Surface Arista") && !kept(distinct.children, "Azure Cisco Gateway") && kept(distinct.children, "Surface Pro"),
  `kept=${names(distinct.children)} reason=${distinct.reason ?? "null"}`,
);
const distinctOutline = reviewSegmentOutline(
  { companyEcho: ms, children: [{ name: "Surface Arista", basis: "b" }, { name: "Azure", basis: "b" }] },
  ms,
  { ticker: "MSFT", description: msft.profile.description, peerCompanies: [...msAll, anet] },
);
gap("distinct-peer-name-outline-rejected", !kept(distinctOutline.items, "Surface Arista") && kept(distinctOutline.items, "Azure"), `items=${names(distinctOutline.items)} reason=${distinctOutline.reason ?? "null"}`);

// ── 2) P3-S: Länge am Rohwort ───────────────────────────────────────────────
const rawPeer = reviewKiChildren("Compute", { children: [hpeChild("ProLiant Boeing Edition"), hpeChild("ProLiant Corning Glass"), hpeChild("HPE ProLiant")] }, null, hpeScope([...hpe.peers, boeing, corning]));
gap(
  "raw-length-peer-name-rejected (Boeing, Corning)",
  !kept(rawPeer.children, "ProLiant Boeing Edition") && !kept(rawPeer.children, "ProLiant Corning Glass") && kept(rawPeer.children, "HPE ProLiant"),
  `kept=${names(rawPeer.children)} reason=${rawPeer.reason ?? "null"}`,
);
const rawBrand = reviewKiChildren("Windows and Devices", {
  children: [msChild("Surface Corning", { brand: "Corning" }), msChild("Azure Boeing", { brand: "Azure Boeing" }), msChild("Xbox Mesh", { brand: "Xbox Mesh" })],
}, null, msScope(msft.peersObserved));
gap(
  "raw-length-brand-rejected (Corning, Boeing nicht geladen)",
  !kept(rawBrand.children, "Surface Corning") && !kept(rawBrand.children, "Azure Boeing") && kept(rawBrand.children, "Xbox Mesh"),
  `kept=${names(rawBrand.children)} reason=${rawBrand.reason ?? "null"}`,
);

// ── 3) A2: Schwelle PEER_NAME_ANYWHERE_MIN_LENGTH gebunden ──────────────────
const four = reviewKiChildren("Windows and Devices", { children: [msChild("Windows Snap Assist")] }, null, msScope([...msAll, snap]));
gap("threshold-4-char-peer-name-kept (Snap)", kept(four.children, "Windows Snap Assist"), `kept=${names(four.children)} reason=${four.reason ?? "null"}`);
const five = reviewKiChildren("Windows and Devices", { children: [msChild("Surface Intel Edition"), msChild("Surface Pro")] }, null, msScope([...msAll, intc]));
gap("threshold-5-char-peer-name-rejected (Intel)", !kept(five.children, "Surface Intel Edition") && kept(five.children, "Surface Pro"), `kept=${names(five.children)} reason=${five.reason ?? "null"}`);

// ── 4) Power Platform, Peers geladen inkl. Meta Platforms ───────────────────
const withMeta = [...msAll];
for (const brand of ["", "Microsoft Power Platform"]) {
  const reviewed = reviewKiChildren(msft.parent, { children: [msChild("Power Platform", { brand }), msChild("Dynamics 365", { brand: "Dynamics 365" })] }, null, msScope(withMeta));
  gap(`msft-power-platform-kept (brand ${JSON.stringify(brand)}, Meta Platforms geladen)`, kept(reviewed.children, "Power Platform") && !/Fremdmarke/.test(reviewed.reason ?? ""), `kept=${names(reviewed.children)} reason=${reviewed.reason ?? "null"}`);
}
const pp = reviewKiChildren(msft.parent, { children: [msChild("Power Platform", { brand: "Power Platform" })] }, null, msScope(withMeta));
const ppNoPeers = reviewKiChildren(msft.parent, { children: [msChild("Power Platform", { brand: "Power Platform" })] }, null, msScope([]));
console.log(`DOC A1 brand "Power Platform" (Peers inkl. META): kept=${names(pp.children)} reason=${pp.reason ?? "null"}; ohne Peers: reason=${ppNoPeers.reason ?? "null"}`);

// ── Bleibt weiter verworfen / bleibt (Stichprobe; vollständig in n26/n27) ──
const hpeProd = hpe.peers.filter((peer) => peer.symbol === "WDC" || peer.symbol === "NTAP");
const arista = reviewKiChildren("Networking", { children: [hpeChild("Arista Networking", { brand: "Arista" }), hpeChild("Switches")] }, null, hpeScope(hpeProd));
gap("hpe-arista-brand-prod-peers-still-rejected", !kept(arista.children, "Arista Networking") && kept(arista.children, "Switches"), `kept=${names(arista.children)} reason=${arista.reason ?? "null"}`);
const tail = reviewKiChildren("Server", { children: [msChild("Set-Top Box"), msChild("Connected Cars")] }, null, msScope(msAll));
gap("tail-words-still-kept (BOX/CARS geladen)", kept(tail.children, "Set-Top Box") && kept(tail.children, "Connected Cars"), `kept=${names(tail.children)} reason=${tail.reason ?? "null"}`);

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n28: OK");
