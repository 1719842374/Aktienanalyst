/**
 * Minimal-DOM für Tests mit dem echten react-dom-Client-Reconciler (createRoot + React.act).
 * Im Repo gibt es weder jsdom noch react-test-renderer; das hier deckt nur ab, was react-dom 18
 * und die getesteten Komponenten zum Mounten/Aktualisieren brauchen. Vor dem ersten Import von
 * react-dom/client `installFakeDom()` aufrufen.
 */
export const HTML_NS = "http://www.w3.org/1999/xhtml";

export class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  ownerDocument: any;
  listeners: Record<string, Function[]> = {};
  constructor(public nodeType: number, public nodeName: string) {}
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get parentElement() { return this.parentNode instanceof FakeElement ? this.parentNode : null; }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return p.childNodes[i + 1] ?? null; }
  get previousSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return i > 0 ? p.childNodes[i - 1] : null; }
  appendChild(c: FakeNode) { c.parentNode?.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c; }
  insertBefore(c: FakeNode, ref: FakeNode | null) {
    if (!ref) return this.appendChild(c);
    c.parentNode?.removeChild(c);
    const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, c); c.parentNode = this; return c;
  }
  removeChild(c: FakeNode) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  contains(n: FakeNode | null): boolean { for (let x: FakeNode | null = n; x; x = x.parentNode) if (x === this) return true; return false; }
  addEventListener(t: string, f: Function) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t: string, f: Function) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
  dispatchEvent() { return true; }
  getRootNode() { let x: FakeNode = this; while (x.parentNode) x = x.parentNode; return x; }
  get isConnected() { return this.getRootNode() === this.ownerDocument; }
  get textContent(): string { return this.childNodes.map(c => c.textContent).join(""); }
  set textContent(v: string) { this.childNodes.forEach(c => (c.parentNode = null)); this.childNodes = []; if (v) this.appendChild(this.ownerDocument.createTextNode(String(v))); }
}
export class FakeText extends FakeNode {
  constructor(public nodeValue: string) { super(3, "#text"); }
  get textContent() { return this.nodeValue; }
  set textContent(v: string) { this.nodeValue = v; }
  get data() { return this.nodeValue; }
}
export class FakeElement extends FakeNode {
  attributes: Record<string, string> = {};
  style: any = { setProperty(k: string, v: string) { (this as any)[k] = v; }, removeProperty(k: string) { delete (this as any)[k]; }, getPropertyValue(k: string) { return (this as any)[k] ?? ""; } };
  value = ""; defaultValue = ""; checked = false; type = ""; scrollTop = 0; scrollLeft = 0;
  clientWidth = 1024; clientHeight = 768; offsetWidth = 1024; offsetHeight = 768;
  dataset: Record<string, string> = {};
  classList = { add() {}, remove() {}, contains() { return false; }, toggle() { return false; } };
  constructor(public tagName: string, public namespaceURI: string) { super(1, tagName.toUpperCase()); }
  get localName() { return this.tagName; }
  get children() { return this.childNodes.filter(c => c instanceof FakeElement); }
  setAttribute(k: string, v: any) { this.attributes[k] = String(v); }
  setAttributeNS(_ns: string, k: string, v: any) { this.attributes[k] = String(v); }
  getAttribute(k: string) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k: string) { delete this.attributes[k]; }
  removeAttributeNS(_ns: string, k: string) { delete this.attributes[k]; }
  hasAttribute(k: string) { return k in this.attributes; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 1024, bottom: 768, width: 1024, height: 768, toJSON() {} }; }
  getClientRects() { return []; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getElementsByTagName() { return []; }
  closest() { return null; }
  matches() { return false; }
  focus() {} blur() {} click() {} scrollIntoView() {} scrollTo() {}
  getContext() { return null; }
  set innerHTML(v: string) { this.textContent = v; }
  get innerHTML() { return this.textContent; }
}
export class FakeDocument extends FakeNode {
  body: FakeElement; head: FakeElement; documentElement: FakeElement; activeElement: any = null; defaultView: any;
  cookie = ""; readyState = "complete"; visibilityState = "visible"; hidden = false;
  constructor() {
    super(9, "#document");
    this.ownerDocument = this;
    this.documentElement = this.createElement("html");
    this.head = this.createElement("head");
    this.body = this.createElement("body");
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }
  createElement(tag: string) { const e = new FakeElement(tag, HTML_NS); e.ownerDocument = this; return e; }
  createElementNS(ns: string, tag: string) { const e = new FakeElement(tag, ns); e.ownerDocument = this; return e; }
  createTextNode(t: string) { const n = new FakeText(t); n.ownerDocument = this; return n; }
  createComment(t: string) { const n = new FakeText(t); n.nodeType = 8; n.ownerDocument = this; return n; }
  getElementById() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getElementsByTagName() { return []; }
  hasFocus() { return true; }
}
export class MemoryStorage {
  map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

export function installFakeDom(opts: { hash?: string; search?: string } = {}) {
  const doc = new FakeDocument();
  class HTMLIFrameElement {}
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const location: any = { protocol: "http:", host: "localhost", hostname: "localhost", origin: "http://localhost", pathname: "/", hash: opts.hash ?? "", search: opts.search ?? "" };
  Object.defineProperty(location, "href", { get: () => `http://localhost/${location.search}${location.hash}` });
  const win: any = {
    document: doc, HTMLIFrameElement, location, localStorage, sessionStorage,
    navigator: { userAgent: "node", language: "de-DE", languages: ["de-DE"] },
    history: { pushState() {}, replaceState() {}, back() {}, state: null },
    innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, scrollX: 0, scrollY: 0,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    matchMedia: (q: string) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent() { return false; } }),
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    scrollTo() {}, getSelection: () => null,
    requestAnimationFrame: (cb: Function) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id: any) => clearTimeout(id),
    ResizeObserver: Observer, IntersectionObserver: Observer, MutationObserver: Observer,
  };
  win.window = win; win.self = win; win.top = win; doc.defaultView = win;
  const g = globalThis as any;
  for (const k of ["document", "location", "localStorage", "sessionStorage", "history", "innerWidth", "innerHeight", "matchMedia", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver", "IntersectionObserver", "MutationObserver", "HTMLIFrameElement", "addEventListener", "removeEventListener", "scrollTo", "getSelection"]) {
    try { Object.defineProperty(g, k, { value: win[k], configurable: true, writable: true }); } catch { /* ignore */ }
  }
  g.window = win;
  try { Object.defineProperty(g, "navigator", { value: win.navigator, configurable: true, writable: true }); } catch { /* node >=21 navigator */ }
  g.HTMLElement = FakeElement; g.Element = FakeElement; g.Node = FakeNode; g.Text = FakeText;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return { doc, win, localStorage };
}

export function findByTestId(n: FakeNode, id: string): FakeElement | null {
  if (n instanceof FakeElement && n.attributes["data-testid"] === id) return n;
  for (const c of n.childNodes) { const r = findByTestId(c, id); if (r) return r; }
  return null;
}

/** React-Fiber eines DOM-Knotens (react-dom hängt ihn als __reactFiber$… an). */
export function fiberOf(node: any): any {
  const key = Object.keys(node).find(k => k.startsWith("__reactFiber$"));
  return key ? node[key] : null;
}

/** Aktuelle React-Props eines DOM-Knotens (__reactProps$…, wie sie das React-Event-System nutzt). */
export function reactPropsOf(node: any): any {
  const key = Object.keys(node).find(k => k.startsWith("__reactProps$"));
  return key ? node[key] : null;
}

/** Vom DOM-Knoten aus die nächste Eltern-Komponente vom Typ `type` finden und ihre Props liefern. */
export function propsOfAncestor(node: any, type: any): any {
  for (let f = fiberOf(node); f; f = f.return) if (f.type === type) return f.memoizedProps;
  return null;
}
