/**
 * #465 N26 (DC d55d9a75, P2-N25-1 und P2-N25-2):
 * 1) brand-Hintertür über das eigene Erstwort: Ein nicht eigenes brand-Wort aus einem geladenen Peer-Namen
 *    ist fremd („Surface Arista“, „Azure Salesforce Connector“, „Windows Oracle Database“, brand „Azure Arista“).
 *    Nur Peer-Namen, keine Ticker: „Dynamics CRM“ bleibt bei CRM-Peer.
 * 2) Der Elternbezug schaltet einwortige Peer-Namen nicht mehr ab („NetApp Storage“, „NetApp Server“, „Oracle Server“).
 * Eigene Produkte (Dynamics 365, AX, NAV, CRM, „Dynamics 365 CRM“, Power Platform) bleiben;
 * Arista und Dell werden weiter verworfen, im Kinder- und im Outline-Pfad.
 * Kein Live-FMP und kein Live-LLM.
 *
 * Aufruf: npx tsx script/test-segment-n26.ts
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
const anet = hpe.peers.find((peer) => peer.symbol === "ANET")!;
const msPeers = [...msft.peersObserved, ...msft.peersCandidate, anet];
const msChild = (name: string, extra: Record<string, unknown> = {}) => ({ name, owner: ms, basis: "Bekannte Produktlinie", source: null, ...extra });
const msScope = (peerCompanies: readonly Peer[] = msPeers) => ({
  kind: "product" as const,
  siblings: msft.segments.filter((name) => name !== "Dynamics"),
  companyName: ms,
  ticker: "MSFT",
  description: msft.profile.description,
  peerCompanies,
});

// ── 1) P2-N25-1: brand-Spoof hinter eigenem Erstwort ────────────────────────
const spoof = reviewKiChildren("Windows and Devices", {
  children: [
    msChild("Surface Arista", { brand: "Arista" }),
    msChild("Azure Salesforce Connector", { brand: "Salesforce" }),
    msChild("Windows Oracle Database", { brand: "Oracle" }),
    msChild("Surface Pro", { brand: "Surface" }),
  ],
}, null, msScope());
gap(
  "spoof-own-head-foreign-brand-rejected",
  ["Surface Arista", "Azure Salesforce Connector", "Windows Oracle Database"].every((name) => !kept(spoof.children, name))
    && kept(spoof.children, "Surface Pro")
    && /Fremdmarke verworfen: Surface Arista, Azure Salesforce Connector, Windows Oracle Database/.test(spoof.reason ?? ""),
  `kept=${names(spoof.children)} reason=${spoof.reason ?? "null"}`,
);
const spoofFirst = reviewKiChildren("Server", { children: [msChild("Arista Switches", { brand: "Azure Arista" })] }, null, msScope());
gap("spoof-brand-own-first-word-rejected", spoofFirst.children.length === 0 && /Fremdmarke verworfen: Arista Switches/.test(spoofFirst.reason ?? ""), `reason=${spoofFirst.reason ?? "null"}`);
const spoofOutline = reviewSegmentOutline(
  { companyEcho: ms, children: [{ name: "Surface Arista", brand: "Arista", basis: "b" }, { name: "Windows Oracle Database", brand: "Oracle", basis: "b" }, { name: "Azure", brand: "Azure", basis: "b" }] },
  ms,
  { ticker: "MSFT", description: msft.profile.description, peerCompanies: msPeers },
);
gap(
  "spoof-outline-rejected",
  !kept(spoofOutline.items, "Surface Arista") && !kept(spoofOutline.items, "Windows Oracle Database") && kept(spoofOutline.items, "Azure"),
  `items=${names(spoofOutline.items)} reason=${spoofOutline.reason ?? "null"}`,
);

// Bindung der Zeile „erstes brand-Wort eigen“: eigene Untermarke außerhalb des Namens bleibt.
const subBrand = reviewKiChildren(msft.parent, { children: [msChild("Navision", { brand: "Dynamics NAV" })] }, null, msScope());
gap("own-first-brand-word-kept (Navision, brand Dynamics NAV)", kept(subBrand.children, "Navision"), `kept=${names(subBrand.children)} reason=${subBrand.reason ?? "null"}`);
// Nur nicht eigene brand-Wörter zählen gegen Peer-Namen: „Platform“ (MSFT-Profil) in „Meta Platforms“ macht nichts fremd.
const ownWordInPeer = reviewKiChildren(msft.parent, { children: [msChild("Dynamics NAV Platform", { brand: "Dynamics NAV Platform" })] }, null, msScope([...msPeers, ...msft.peersCollision]));
gap("own-brand-word-in-peer-name-kept", kept(ownWordInPeer.children, "Dynamics NAV Platform"), `kept=${names(ownWordInPeer.children)} reason=${ownWordInPeer.reason ?? "null"}`);

// ── 2) P2-N25-2: einwortiger Peer-Name trotz Elternbezug ────────────────────
const hc = hpe.profile.companyName;
const hpeChild = (name: string, extra: Record<string, unknown> = {}) => ({ name, owner: hc, basis: "KI-Schätzung", source: null, ...extra });
const hpeScope = (extra: Record<string, unknown> = {}) => ({ kind: "product" as const, companyName: hc, ticker: "HPE", description: hpe.profile.description, peerCompanies: hpe.peers, ...extra });
const storage = reviewKiChildren("Storage", { children: [hpeChild("NetApp Storage"), hpeChild("Alletra Storage")] }, null, hpeScope());
gap(
  "netapp-storage-rejected",
  !kept(storage.children, "NetApp Storage") && kept(storage.children, "Alletra Storage") && /Fremdmarke verworfen: NetApp Storage/.test(storage.reason ?? ""),
  `kept=${names(storage.children)} reason=${storage.reason ?? "null"}`,
);
const server = reviewKiChildren("Server", { children: [hpeChild("NetApp Server"), hpeChild("ProLiant Server")] }, null, hpeScope());
gap("netapp-server-rejected", !kept(server.children, "NetApp Server") && kept(server.children, "ProLiant Server"), `kept=${names(server.children)} reason=${server.reason ?? "null"}`);
const oracle = reviewKiChildren("Server", { children: [msChild("Oracle Server"), msChild("SQL Server")] }, null, msScope());
gap("oracle-server-rejected", !kept(oracle.children, "Oracle Server") && kept(oracle.children, "SQL Server"), `kept=${names(oracle.children)} reason=${oracle.reason ?? "null"}`);

// ── Eigene Produkte bleiben ─────────────────────────────────────────────────
const own = ["Dynamics 365", "Dynamics AX", "Dynamics NAV", "Dynamics CRM", "Dynamics 365 CRM", "Microsoft Power Platform"];
for (const [label, brandOf] of [["brand=Name", (n: string) => n], ["brand=Kürzel", (n: string) => n.split(" ").slice(1).join(" ")], ["brand=leer", () => ""]] as const) {
  const reviewed = reviewKiChildren(msft.parent, { children: own.map((name) => msChild(name, { brand: brandOf(name) })) }, null, msScope());
  gap(`msft-own-kept (${label})`, own.every((name) => kept(reviewed.children, name)) && !/Fremdmarke/.test(reviewed.reason ?? ""), `kept=${names(reviewed.children)} reason=${reviewed.reason ?? "null"}`);
}
const ownOutline = reviewSegmentOutline(
  { companyEcho: ms, children: own.map((name) => ({ name, brand: name, basis: "b" })) },
  ms,
  { ticker: "MSFT", description: msft.profile.description, peerCompanies: msPeers },
);
gap("msft-own-kept-outline", own.every((name) => kept(ownOutline.items, name)), `items=${names(ownOutline.items)} reason=${ownOutline.reason ?? "null"}`);

// ── Arista und Dell bleiben verworfen ───────────────────────────────────────
const dell = { symbol: "DELL", companyName: "Dell Technologies Inc." };
const hpeKids = reviewKiChildren("Networking", { children: [hpeChild("Arista Networking"), hpeChild("Switches"), hpeChild("HPE Aruba Networking", { brand: "Aruba" })] }, null, hpeScope());
gap("arista-children-rejected", !kept(hpeKids.children, "Arista Networking") && kept(hpeKids.children, "Switches") && kept(hpeKids.children, "HPE Aruba Networking"), `kept=${names(hpeKids.children)} reason=${hpeKids.reason ?? "null"}`);
const dellKids = reviewKiChildren("Compute", { children: [hpeChild("Dell PowerEdge"), hpeChild("HPE ProLiant")] }, null, hpeScope({ peerCompanies: [...hpe.peers, dell] }));
gap("dell-children-rejected", !kept(dellKids.children, "Dell PowerEdge") && kept(dellKids.children, "HPE ProLiant"), `kept=${names(dellKids.children)} reason=${dellKids.reason ?? "null"}`);
const hpeOutline = reviewSegmentOutline(
  { companyEcho: hc, children: [{ name: "Arista Networking", basis: "b" }, { name: "Dell PowerEdge", basis: "b" }, { name: "NetApp Storage", basis: "b" }, { name: "Compute", basis: "b" }] },
  hc,
  { ticker: "HPE", description: hpe.profile.description, peerCompanies: [...hpe.peers, dell] },
);
gap(
  "arista-dell-netapp-outline-rejected",
  ["Arista Networking", "Dell PowerEdge", "NetApp Storage"].every((name) => !kept(hpeOutline.items, name)) && kept(hpeOutline.items, "Compute"),
  `items=${names(hpeOutline.items)} reason=${hpeOutline.reason ?? "null"}`,
);

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n26: OK");
