/**
 * #465 N27 (DC a7424572, P2-N26-1 und P2-N26-2, Regressionen seit N25 gegenüber 5320f3ab):
 * 1) ohne brand: Ein einwortiger Peer-Name zählt wieder an jeder Stelle (ab PEER_NAME_ANYWHERE_MIN_LENGTH),
 *    ein Ticker = erstes Peer-Wort an jeder Stelle (ab PEER_TICKER_ANYWHERE_MIN_LENGTH, nur fremder Kopf, ohne Elternbezug).
 * 2) mit brand ohne geladenen Peer: Die eigene Familie rettet nur kurze fremde brand-Wörter (AX, NAV, CRM, 365).
 * Eigene Produkte, „Set-Top Box“, „Connected Cars“ und Alletra bleiben. Kein Live-FMP und kein Live-LLM.
 *
 * Aufruf: npx tsx script/test-segment-n27.ts
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
const msPeers = [...msft.peersObserved, ...msft.peersCandidate];
const msChild = (name: string, extra: Record<string, unknown> = {}) => ({ name, owner: ms, basis: "Bekannte Produktlinie", source: null, ...extra });
const hpeChild = (name: string, extra: Record<string, unknown> = {}) => ({ name, owner: hc, basis: "KI-Schätzung", source: null, ...extra });
const msScope = (peerCompanies: readonly Peer[] = msPeers) => ({
  kind: "product" as const,
  siblings: msft.segments.filter((name) => name !== "Dynamics"),
  companyName: ms,
  ticker: "MSFT",
  description: msft.profile.description,
  peerCompanies,
});
// Prod-Lage HPE laut DC: Peers nur WDC und NTAP, Arista nicht geladen.
const hpeProdPeers = hpe.peers.filter((peer) => peer.symbol === "WDC" || peer.symbol === "NTAP");
const dell = { symbol: "DELL", companyName: "Dell Technologies Inc." };
const hpeScope = (peerCompanies: readonly Peer[] = hpeProdPeers) => ({ kind: "product" as const, companyName: hc, ticker: "HPE", description: hpe.profile.description, peerCompanies });

// ── 1) P2-N26-1: ohne brand, Peer-Wort nicht am Anfang ─────────────────────
const msNoBrand = reviewKiChildren("Windows and Devices", { children: [msChild("Windows Oracle Database"), msChild("Azure Salesforce Connector"), msChild("Surface Pro")] }, null, msScope());
gap(
  "nobrand-msft-peer-name-anywhere-rejected",
  !kept(msNoBrand.children, "Windows Oracle Database") && !kept(msNoBrand.children, "Azure Salesforce Connector") && kept(msNoBrand.children, "Surface Pro"),
  `kept=${names(msNoBrand.children)} reason=${msNoBrand.reason ?? "null"}`,
);
const msOutline = reviewSegmentOutline(
  { companyEcho: ms, children: [{ name: "Windows Oracle Database", basis: "b" }, { name: "Azure", basis: "b" }] },
  ms,
  { ticker: "MSFT", description: msft.profile.description, peerCompanies: msPeers },
);
gap("nobrand-outline-oracle-rejected", !kept(msOutline.items, "Windows Oracle Database") && kept(msOutline.items, "Azure"), `items=${names(msOutline.items)} reason=${msOutline.reason ?? "null"}`);
const hpeNoBrand = reviewKiChildren("Storage", { children: [hpeChild("ProLiant NetApp Bundle"), hpeChild("Alletra Storage")] }, null, hpeScope());
gap(
  "nobrand-hpe-netapp-anywhere-rejected",
  !kept(hpeNoBrand.children, "ProLiant NetApp Bundle") && kept(hpeNoBrand.children, "Alletra Storage"),
  `kept=${names(hpeNoBrand.children)} reason=${hpeNoBrand.reason ?? "null"}`,
);
const hpeDell = reviewKiChildren("Compute", { children: [hpeChild("Alletra Dell Migration"), hpeChild("HPE ProLiant")] }, null, hpeScope([...hpeProdPeers, dell]));
gap(
  "nobrand-hpe-dell-ticker-anywhere-rejected",
  !kept(hpeDell.children, "Alletra Dell Migration") && kept(hpeDell.children, "HPE ProLiant"),
  `kept=${names(hpeDell.children)} reason=${hpeDell.reason ?? "null"}`,
);

// ── 2) P2-N26-2: brand fremd, Peer nicht geladen ────────────────────────────
const msBrand = reviewKiChildren("Windows and Devices", {
  children: [msChild("Surface Cisco", { brand: "Cisco" }), msChild("Azure Webex", { brand: "Azure Cisco" }), msChild("Surface Pro", { brand: "Surface" })],
}, null, msScope());
gap(
  "brand-unloaded-peer-rejected (Cisco)",
  !kept(msBrand.children, "Surface Cisco") && !kept(msBrand.children, "Azure Webex") && kept(msBrand.children, "Surface Pro"),
  `kept=${names(msBrand.children)} reason=${msBrand.reason ?? "null"}`,
);
const noPeers = reviewKiChildren("Windows and Devices", { children: [msChild("Surface Arista", { brand: "Arista" })] }, null, msScope([]));
gap("brand-no-peers-rejected (Surface Arista)", noPeers.children.length === 0 && /Fremdmarke verworfen: Surface Arista/.test(noPeers.reason ?? ""), `reason=${noPeers.reason ?? "null"}`);
const aristaProd = reviewKiChildren("Networking", {
  children: [hpeChild("Arista Networking", { brand: "Arista" }), hpeChild("ProLiant Arista Switches", { brand: "Arista" }), hpeChild("Switches"), hpeChild("HPE Aruba Networking", { brand: "Aruba" })],
}, null, hpeScope());
gap(
  "hpe-arista-brand-prod-peers-rejected (WDC/NTAP)",
  !kept(aristaProd.children, "Arista Networking") && !kept(aristaProd.children, "ProLiant Arista Switches")
    && kept(aristaProd.children, "Switches") && kept(aristaProd.children, "HPE Aruba Networking"),
  `kept=${names(aristaProd.children)} reason=${aristaProd.reason ?? "null"}`,
);
const aristaOutline = reviewSegmentOutline(
  { companyEcho: hc, children: [{ name: "Arista Networking", brand: "Arista", basis: "b" }, { name: "ProLiant Arista Switches", brand: "Arista", basis: "b" }, { name: "Compute", basis: "b" }] },
  hc,
  { ticker: "HPE", description: hpe.profile.description, peerCompanies: hpeProdPeers },
);
gap(
  "hpe-arista-brand-prod-peers-outline-rejected",
  !kept(aristaOutline.items, "Arista Networking") && !kept(aristaOutline.items, "ProLiant Arista Switches") && kept(aristaOutline.items, "Compute"),
  `items=${names(aristaOutline.items)} reason=${aristaOutline.reason ?? "null"}`,
);

// ── Bleibt ──────────────────────────────────────────────────────────────────
const own = ["Dynamics 365", "Dynamics AX", "Dynamics NAV", "Dynamics CRM", "Dynamics 365 CRM", "Dynamics NAV Platform", "Microsoft Power Platform"];
const allPeers = [...msPeers, ...msft.peersCollision];
for (const [label, brandOf] of [["brand=Name", (n: string) => n], ["brand=Kürzel", (n: string) => n.split(" ").slice(1).join(" ")], ["brand=leer", () => ""]] as const) {
  for (const [peerLabel, peers] of [["geladen", allPeers], ["keine", []]] as const) {
    const reviewed = reviewKiChildren(msft.parent, { children: own.map((name) => msChild(name, { brand: brandOf(name) })) }, null, msScope(peers));
    gap(`msft-own-kept (${label}, Peers ${peerLabel})`, own.every((name) => kept(reviewed.children, name)) && !/Fremdmarke/.test(reviewed.reason ?? ""), `kept=${names(reviewed.children)} reason=${reviewed.reason ?? "null"}`);
  }
}
const tail = reviewKiChildren("Server", { children: [msChild("Set-Top Box"), msChild("Connected Cars")] }, null, msScope(allPeers));
gap("tail-words-kept (BOX/CARS geladen)", kept(tail.children, "Set-Top Box") && kept(tail.children, "Connected Cars"), `kept=${names(tail.children)} reason=${tail.reason ?? "null"}`);
const alletra = reviewKiChildren("Storage", { children: [hpeChild("Alletra Storage"), hpeChild("HPE Alletra MP", { brand: "Alletra" })] }, null, hpeScope([...hpe.peers, dell]));
gap("alletra-kept", kept(alletra.children, "Alletra Storage") && kept(alletra.children, "HPE Alletra MP"), `kept=${names(alletra.children)} reason=${alletra.reason ?? "null"}`);

// ── Nur Doku (P3, kein gap) ─────────────────────────────────────────────────
const doc = reviewKiChildren("Windows and Devices", { children: [msChild("Windows Meta Quest"), msChild("Azure SAP Solutions"), msChild("Microsoft Oracle Database", { brand: "Oracle" })] }, null, msScope(allPeers));
// P3 vorbestehend seit N23: eigenes Produkt, dessen brand nicht im Profil steht („Alletra MP“, brand Alletra), gilt als fremd.
const docAlletra = reviewKiChildren("Storage", { children: [hpeChild("Alletra MP", { brand: "Alletra" })] }, null, hpeScope());
console.log(`DOC P3 alletra-brand kept=${names(docAlletra.children)} reason=${docAlletra.reason ?? "null"}`);
console.log(`DOC P3 kept=${names(doc.children)} reason=${doc.reason ?? "null"}`);

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n27: OK");
