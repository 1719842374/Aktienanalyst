/**
 * #258 Stabschef-Follow-up: Hook-Reihenfolge in PeerComparison.
 *
 * Rendert PeerComparison mit dem echten react-dom-Client-Reconciler (createRoot + act)
 * und wechselt per Rerender zwischen 0 Peers, peerComparison null und vollen Peers.
 * Vorher stand useMemo (sortedPeers) hinter dem Early-Return der leeren Liste, und
 * React warf "Rendered more hooks than during the previous render".
 *
 * Im Repo gibt es weder jsdom noch react-test-renderer. Deshalb steckt hier ein minimales
 * Fake-DOM, das nur abdeckt, was react-dom 18 zum Mounten, Aktualisieren und Entfernen braucht.
 *
 * Ausfuehren: npx tsx --tsconfig script/tsconfig.jsx.json script/test-peer-hooks-rerender.ts
 */
import { readFileSync } from "node:fs";
import React from "react";

(globalThis as any).React = React;

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── Minimal-DOM ────────────────────────────────────────────────────────────
const HTML_NS = "http://www.w3.org/1999/xhtml";
class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  ownerDocument: any;
  listeners: Record<string, Function[]> = {};
  constructor(public nodeType: number, public nodeName: string) {}
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return p.childNodes[i + 1] ?? null; }
  appendChild(c: FakeNode) { c.parentNode?.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c; }
  insertBefore(c: FakeNode, ref: FakeNode | null) {
    if (!ref) return this.appendChild(c);
    c.parentNode?.removeChild(c);
    const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c); c.parentNode = this; return c;
  }
  removeChild(c: FakeNode) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  addEventListener(t: string, f: Function) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t: string, f: Function) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
  get textContent(): string { return this.childNodes.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.childNodes.forEach(c => (c.parentNode = null)); this.childNodes = []; if (v) this.appendChild(this.ownerDocument.createTextNode(String(v))); }
}
class FakeText extends FakeNode {
  constructor(public nodeValue: string) { super(3, "#text"); }
  get textContent() { return this.nodeValue; }
  set textContent(v: string) { this.nodeValue = v; }
  get data() { return this.nodeValue; }
}
class FakeElement extends FakeNode {
  attributes: Record<string, string> = {};
  style: any = { setProperty(k: string, v: string) { (this as any)[k] = v; }, removeProperty(k: string) { delete (this as any)[k]; } };
  value = ""; defaultValue = ""; checked = false; type = "";
  constructor(public tagName: string, public namespaceURI: string) { super(1, tagName.toUpperCase()); }
  setAttribute(k: string, v: any) { this.attributes[k] = String(v); }
  setAttributeNS(_ns: string, k: string, v: any) { this.attributes[k] = String(v); }
  getAttribute(k: string) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k: string) { delete this.attributes[k]; }
  removeAttributeNS(_ns: string, k: string) { delete this.attributes[k]; }
  hasAttribute(k: string) { return k in this.attributes; }
  focus() {} blur() {}
  set innerHTML(v: string) { this.textContent = v; }
}
class FakeDocument extends FakeNode {
  body: FakeElement; documentElement: FakeElement; activeElement: any = null; defaultView: any;
  constructor() {
    super(9, "#document");
    this.ownerDocument = this;
    this.documentElement = this.createElement("html");
    this.body = this.createElement("body");
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string) { const e = new FakeElement(tag, HTML_NS); e.ownerDocument = this; return e; }
  createElementNS(ns: string, tag: string) { const e = new FakeElement(tag, ns); e.ownerDocument = this; return e; }
  createTextNode(t: string) { const n = new FakeText(t); n.ownerDocument = this; return n; }
  createComment(t: string) { const n = new FakeText(t); n.nodeType = 8; n.ownerDocument = this; return n; }
}
const doc = new FakeDocument();
class HTMLIFrameElement {}
const win: any = { document: doc, HTMLIFrameElement, addEventListener() {}, removeEventListener() {}, navigator: { userAgent: "node" }, location: { protocol: "http:" }, getSelection: () => null };
win.window = win; doc.defaultView = win;
Object.assign(globalThis as any, { window: win, document: doc, HTMLIFrameElement, IS_REACT_ACT_ENVIRONMENT: true });
if (!(globalThis as any).navigator) (globalThis as any).navigator = win.navigator;

function findByTestId(n: FakeNode, id: string): FakeElement | null {
  if (n instanceof FakeElement && n.attributes["data-testid"] === id) return n;
  for (const c of n.childNodes) { const r = findByTestId(c, id); if (r) return r; }
  return null;
}

// ── Fixture ────────────────────────────────────────────────────────────────
const base = JSON.parse(readFileSync(new URL("./fixtures/analysis-MSFT.json", import.meta.url), "utf8"));
const mkPeer = (t: string, pe: number) => ({ ticker: t, name: `${t} Inc`, marketCap: 1e11, pe, peg: 1.5, ps: 5, pb: 4, epsGrowth1Y: 10, epsGrowth5Y: 8, roic: 20, roic5Y: 18 });
const fullPc = base.peerComparison && base.peerComparison.peers?.length
  ? base.peerComparison
  : { subject: mkPeer(base.ticker, 30), peers: [mkPeer("AAA", 20), mkPeer("BBB", 25), mkPeer("CCC", 18)], peerAvg: null, sectorMedian: null };
const withPeers = { ...base, peerComparison: fullPc, activePeerOverrides: { add: [], remove: [] } };
const zeroPeers = { ...base, peerComparison: { ...fullPc, peers: [] }, activePeerOverrides: { add: [], remove: ["AAA"] } };
const nullPc = { ...base, peerComparison: null, activePeerOverrides: { add: [], remove: ["AAA", "BBB", "CCC"] } };

async function main() {
  const { createRoot } = await import("react-dom/client");
  const act = (React as any).act as (cb: () => Promise<void>) => Promise<void>;
  const { default: PeerComparison } = await import("../client/src/components/sections/PeerComparison");

  const hookErrors: string[] = [];
  const origError = console.error;
  console.error = (...a: any[]) => {
    const msg = a.map(String).join(" ");
    if (/hooks|Hooks/.test(msg)) hookErrors.push(msg.split("\n")[0]);
    // Rest still prints, so other warnings stay visible.
    else origError(...a);
  };

  const container = doc.createElement("div");
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  const noop = () => {};

  async function render(label: string, data: any): Promise<string | null> {
    try {
      await act(async () => { root.render(React.createElement(PeerComparison, { data, onOverridesChange: noop })); });
      return null;
    } catch (e: any) {
      return `${label}: ${String(e?.message ?? e).split("\n")[0]}`;
    }
  }

  console.log("Hook-Reihenfolge — echter react-dom-Reconciler, Rerender-Wechsel");
  const steps: Array<[string, any]> = [
    ["0 Peers", zeroPeers], ["Peers", withPeers], ["0 Peers", zeroPeers],
    ["null", nullPc], ["Peers", withPeers], ["null", nullPc],
  ];
  const thrown: string[] = [];
  let emptySeen = 0, tableSeen = 0;
  for (const [label, data] of steps) {
    const err = await render(label, data);
    if (err) { thrown.push(err); break; }
    if (findByTestId(container, "peer-empty")) emptySeen++;
    else if (findByTestId(container, "peer-scored-table")) tableSeen++;
  }
  check("Wechsel 0 → Peers → 0 → null → Peers → null ohne Exception", thrown.length === 0, thrown.join(" | "));
  check("kein \"Rendered more/fewer hooks\" / Hook-Order-Warnung", hookErrors.length === 0, hookErrors.join(" | "));
  check("leerer Zweig gerendert (0 Peers / null)", emptySeen === 4, `emptySeen=${emptySeen}`);
  check("Tabellen-Zweig gerendert (Peers)", tableSeen === 2, `tableSeen=${tableSeen}`);
  check("nach letztem Wechsel (null): Eingabe + Reset im leeren Zweig", thrown.length === 0 && !!findByTestId(container, "input-peer-add") && !!findByTestId(container, "button-peer-reset"));

  await act(async () => { root.unmount(); });
  console.error = origError;

  // Statisch: kein Hook mehr hinter dem Early-Return
  const src = readFileSync(new URL("../client/src/components/sections/PeerComparison.tsx", import.meta.url), "utf8");
  const fnStart = src.indexOf("export default function PeerComparison");
  const early = src.indexOf("if (!pc || !pc.peers || pc.peers.length === 0)", fnStart);
  const fnEnd = src.indexOf("\nexport function PeerOverrideControls", fnStart);
  const afterEarly = src.slice(early, fnEnd);
  check("Quelltext: keine use*-Hooks nach dem Early-Return", !/\buse[A-Z]\w*\(/.test(afterEarly), (afterEarly.match(/\buse[A-Z]\w*\(/g) || []).join(","));

  console.log(failed === 0 ? "\n✅ Alle Peer-Hook-Rerender-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
