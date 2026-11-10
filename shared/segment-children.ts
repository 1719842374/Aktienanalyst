/**
 * Untersegmente eines Hauptsegments.
 * FMP nur, wenn die Segmentzeile das Hauptsegment als verschachtelte Werte führt.
 * Eine flache Umsatzzahl ist kein Untersegment. KI-Werte bleiben KI.
 */
import { prettifyProductSegmentName } from "./segment-growth-calc";

export type SegmentChildSource = "FMP" | "KI";

export interface SegmentChild {
  parent: string;
  name: string;
  revenue: number | null;
  shareOfParentPct: number | null;
  growthPct?: number | null;
  source: SegmentChildSource;
  basis?: string | null;
}

export interface SegmentChildrenResult {
  parent: string;
  children: SegmentChild[];
  reason: string | null;
}

export const SEGMENT_CHILDREN_ROUTE = "/api/segment-children";
export const NO_SEGMENT_CHILDREN = "n/a — weder FMP noch KI liefern Untersegmente";
export const KI_WITHOUT_BASIS = "n/a — KI-Schätzung ohne Beleg";
export const KI_SUM_EXCEEDS_PARENT = "n/a — KI-Summe überschreitet das Elternsegment";
export const KI_NEGATIVE = "n/a — negativer KI-Wert verworfen";
export const KI_UNAVAILABLE = "n/a — KI nicht erreichbar";
export const KI_FILTERED = "n/a — KI-Vorschläge verworfen: Elternname, Geschwister oder Geschäftssegment";
export const KI_WITHOUT_SOURCE = "n/a — Schätzung ohne Quelle";
export const OUTLINE_NO_IDENTITY = "n/a — Identität der Firma nicht belegt";
export const OUTLINE_MISMATCH = "n/a — Antwort passt nicht zur Firma";
export const SEGMENT_UNKNOWN = "n/a — Segment ist in der serverseitigen Liste nicht enthalten";
/** N25: FMP-Segmentliste war beim Abruf nicht erreichbar (429, 5xx, Netz). Kein Urteil über das Segment. */
export const SEGMENT_LIST_UNAVAILABLE = "n/a — FMP-Segmentliste gerade nicht erreichbar, bitte gleich erneut versuchen";
export const BASIS_TEXT_MAX = 400;

const SKIP_KEYS = new Set([
  "symbol", "date", "reportedCurrency", "cik", "fillingDate",
  "acceptedDate", "calendarYear", "period", "link", "finalLink",
  "fiscalYear", "data",
]);

function norm(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function sameChildName(kind: "product" | "geographic", left: string, right: string): boolean {
  if (kind === "product") return norm(prettifyProductSegmentName(left)) === norm(prettifyProductSegmentName(right));
  return norm(left) === norm(right);
}

function boundBasis(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= BASIS_TEXT_MAX) return clean;
  const slice = clean.slice(0, BASIS_TEXT_MAX);
  const space = slice.lastIndexOf(" ");
  const end = space >= 24 ? space : BASIS_TEXT_MAX;
  return `${clean.slice(0, end).trimEnd()}…`;
}

function fiscalYear(row: Record<string, unknown>): number {
  const year = row.fiscalYear;
  if (typeof year === "number" && Number.isInteger(year)) return year;
  if (typeof year === "string" && /^\d{4}/.test(year)) return Number(year.slice(0, 4));
  return 0;
}

function isQuarter(row: Record<string, unknown>): boolean {
  return typeof row.period === "string" && /^Q[1-4]$/i.test(row.period.trim());
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function withShares(parent: string, rows: SegmentChild[]): SegmentChild[] {
  const total = rows.reduce((sum, row) => sum + (row.revenue != null && row.revenue > 0 ? row.revenue : 0), 0);
  if (!(total > 0) || rows.some((row) => row.shareOfParentPct != null)) return rows;
  return rows.map((row) => ({
    ...row,
    parent,
    shareOfParentPct: row.revenue != null && row.revenue > 0 ? (row.revenue / total) * 100 : null,
  }));
}

function readNested(parent: string, value: unknown): SegmentChild[] {
  if (Array.isArray(value)) {
    const rows: SegmentChild[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { name?: unknown; revenue?: unknown; shareOfParentPct?: unknown };
      if (typeof rec.name !== "string" || !rec.name.trim()) continue;
      rows.push({
        parent,
        name: rec.name.trim(),
        revenue: finite(rec.revenue),
        shareOfParentPct: finite(rec.shareOfParentPct),
        source: "FMP",
      });
    }
    return withShares(parent, rows);
  }
  if (!value || typeof value !== "object") return [];
  const rows: SegmentChild[] = [];
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    const revenue = finite(raw);
    if (!name.trim() || revenue == null) continue;
    rows.push({ parent, name: name.trim(), revenue, shareOfParentPct: null, source: "FMP" });
  }
  return withShares(parent, rows);
}

function segmentMap(row: Record<string, unknown>): Record<string, unknown> {
  return row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : row;
}

export function segmentNamesFromFmpRows(raw: unknown[]): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || isQuarter(item as Record<string, unknown>)) continue;
    for (const [key, value] of Object.entries(segmentMap(item as Record<string, unknown>))) {
      if (SKIP_KEYS.has(key) || !key.trim()) continue;
      const numeric = finite(value);
      const nested = !!value && typeof value === "object";
      if (numeric == null && !nested) continue;
      if (!names.some((name) => norm(name) === norm(key))) names.push(key.trim());
    }
  }
  return names;
}

export function canonicalSegmentName(raw: unknown[], parent: string): string | null {
  const wanted = norm(parent);
  if (!wanted) return null;
  return segmentNamesFromFmpRows(raw).find((name) => norm(name) === wanted) ?? null;
}

export function reportedParentRevenue(raw: unknown[], parent: string): number | null {
  if (!Array.isArray(raw)) return null;
  const wanted = norm(parent);
  const rows = raw.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !isQuarter(item as Record<string, unknown>));
  for (const row of [...rows].sort((a, b) => fiscalYear(b) - fiscalYear(a))) {
    for (const [key, value] of Object.entries(segmentMap(row))) {
      if (norm(key) !== wanted) continue;
      const revenue = finite(value);
      if (revenue != null && revenue > 0) return revenue;
    }
  }
  return null;
}

export function childrenFromFmpRows(raw: unknown[], parent: string): SegmentChild[] {
  if (!Array.isArray(raw) || !parent.trim()) return [];
  const rows = raw.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !isQuarter(item as Record<string, unknown>));
  const wanted = norm(parent);
  for (const row of [...rows].sort((a, b) => fiscalYear(b) - fiscalYear(a))) {
    const source = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : row;
    for (const [key, value] of Object.entries(source)) {
      if (norm(key) !== wanted) continue;
      const children = readNested(parent, value);
      if (children.length > 0) return children;
    }
  }
  return [];
}

export function childrenFromKiPayload(parent: string, payload: unknown): SegmentChild[] {
  if (!payload || typeof payload !== "object" || !parent.trim()) return [];
  const list = (payload as { children?: unknown }).children;
  if (!Array.isArray(list)) return [];
  const rows: SegmentChild[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { name?: unknown; revenue?: unknown; shareOfParentPct?: unknown };
    if (typeof rec.name !== "string" || !rec.name.trim()) continue;
    rows.push({
      parent,
      name: rec.name.trim(),
      revenue: finite(rec.revenue),
      shareOfParentPct: finite(rec.shareOfParentPct),
      source: "KI",
    });
  }
  return rows;
}

export function reviewKiChildren(
  parent: string,
  payload: unknown,
  parentRevenue: number | null,
  scope: {
    kind?: "product" | "geographic";
    siblings?: readonly string[];
    businessNames?: readonly string[];
    companyName?: string;
    /** N23: Ticker und FMP-Profilbeschreibung = eigenes Vokabular der Firma. */
    ticker?: string;
    description?: string;
    /** N23: dieselbe FMP-Peer-Liste wie der Peer-Anker (/stable/stock-peers), mit Firmennamen. */
    peerCompanies?: readonly PeerCompany[];
  } = {},
): SegmentChildrenResult {
  if (!payload || typeof payload !== "object") return { parent, children: [], reason: NO_SEGMENT_CHILDREN };
  const record = payload as { children?: unknown; fills?: unknown };
  const rawList = Array.isArray(record.children) ? record.children : Array.isArray(record.fills) ? record.fills : null;
  if (!Array.isArray(rawList) || rawList.length === 0) return { parent, children: [], reason: NO_SEGMENT_CHILDREN };
  const list = rawList.map((item) => {
    if (!item || typeof item !== "object") return item;
    const row = item as { name?: unknown; segmentName?: unknown; basis?: unknown; rationale?: unknown; formula?: unknown; source?: unknown; tamSource?: unknown; growthPct?: unknown; segmentGrowth?: unknown };
    const basis = [row.basis, row.rationale, row.formula].filter((part) => typeof part === "string" && part.trim()).join(" · ");
    return {
      ...row,
      name: typeof row.name === "string" && row.name.trim() ? row.name : row.segmentName,
      basis,
      source: typeof row.source === "string" && row.source.trim() ? row.source : row.tamSource,
      growthPct: row.growthPct ?? row.segmentGrowth,
    };
  });
  const kind = scope.kind ?? "product";
  const kept: SegmentChild[] = [];
  const notes: string[] = [];
  const foreign: string[] = [];
  let filtered = 0;
  const brandScope = scope.companyName
    ? ownBrandScope(scope.companyName, scope.ticker ?? "", [scope.description ?? "", ...(scope.siblings ?? [])], scope.peerCompanies ?? [], parent)
    : null;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { name?: unknown; revenue?: unknown; shareOfParentPct?: unknown; growthPct?: unknown; basis?: unknown; source?: unknown; owner?: unknown; ownerParent?: unknown; brand?: unknown };
    const name = typeof rec.name === "string" ? rec.name.trim().slice(0, 80) : "";
    if (!name) continue;
    const basis = typeof rec.basis === "string" ? boundBasis(rec.basis) : "";
    if (!basis) {
      notes.push(`${KI_WITHOUT_BASIS}: ${name}`);
      continue;
    }
    const companyName = scope.companyName ?? "";
    const owner = typeof rec.owner === "string" ? rec.owner.trim() : "";
    const ownerParent = typeof rec.ownerParent === "string" ? rec.ownerParent.trim() : "";
    const ownerOk = companyReferenced(owner, companyName) || companyReferenced(ownerParent, companyName);
    const citationText = [rec.source, rec.basis].filter((part) => typeof part === "string").join(" ");
    const hostVerdict = citedHostVerdict(citationText, companyName);
    if (companyName && !ownerOk) {
      foreign.push(name);
      continue;
    }
    if (brandScope && namesForeignBrand(name, rec.brand, brandScope)) {
      foreign.push(name);
      continue;
    }
    if (hostVerdict === "foreign") {
      foreign.push(name);
      continue;
    }
    if (hostVerdict === "invalid") {
      notes.push(`n/a — ungültige URL: ${name}`);
    }
    if (sameChildName(kind, parent, name)) {
      filtered += 1;
      continue;
    }
    if ((scope.siblings ?? []).some((sibling) => sameChildName(kind, sibling, name))) {
      filtered += 1;
      continue;
    }
    if (kind === "geographic" && (scope.businessNames ?? []).some((business) => sameChildName("product", business, name))) {
      filtered += 1;
      continue;
    }
    const share = outlineNumber(rec.shareOfParentPct);
    const revenue = finite(rec.revenue);
    const growth = outlineNumber(rec.growthPct);
    if ((share != null && share < 0) || (revenue != null && revenue < 0)) {
      notes.push(`${KI_NEGATIVE}: ${name}`);
      continue;
    }
    const citation = typeof rec.source === "string" ? rec.source.trim() : "";
    const sourced = hostVerdict !== "invalid" && concreteSource(citation, companyName);
    let shareKept = share != null && share > 0 ? share : null;
    let growthKept = growth;
    if ((share != null || growth != null) && !sourced) {
      notes.push(`${KI_WITHOUT_SOURCE}: ${name}`);
      shareKept = null;
      growthKept = null;
    }
    const shownBasis = citation && !basis.includes(citation) ? boundBasis(`${basis} · ${citation}`) : basis;
    kept.push({
      parent,
      name,
      revenue: revenue != null && revenue > 0 ? revenue : null,
      shareOfParentPct: shareKept,
      growthPct: growthKept,
      source: "KI",
      basis: shownBasis,
    });
  }
  const shareSum = kept.reduce((sum, row) => sum + (row.shareOfParentPct ?? 0), 0);
  const revenueSum = kept.reduce((sum, row) => sum + (row.revenue ?? 0), 0);
  if (kept.some((row) => row.shareOfParentPct != null) && shareSum > 100) {
    return { parent, children: [], reason: KI_SUM_EXCEEDS_PARENT };
  }
  if (parentRevenue != null && parentRevenue > 0 && kept.some((row) => row.revenue != null) && revenueSum > parentRevenue) {
    return { parent, children: [], reason: KI_SUM_EXCEEDS_PARENT };
  }
  const foreignNote = foreign.length > 0 ? `n/a — Fremdmarke verworfen: ${foreign.join(", ")}` : "";
  const parts = [foreignNote, filtered > 0 && kept.length === 0 ? KI_FILTERED : "", ...notes].filter((part) => part.length > 0);
  if (kept.length === 0) {
    return { parent, children: [], reason: parts.join(" ") || NO_SEGMENT_CHILDREN };
  }
  return { parent, children: kept, reason: parts.length > 0 ? parts.join(" ") : null };
}

export interface PeerCompany {
  symbol: string;
  companyName: string;
}

interface OwnBrandScope {
  companyName: string;
  tickerToken: string;
  /** Belegtes eigenes Vokabular: Firma, Ticker, Profilbeschreibung, Geschwister. Nicht der Elternname. */
  own: Set<string>;
  /** N25: erstes Wort des Elternsegments. Schützt nur gegen Ein-Wort-Treffer (Ticker, Kürzel, Erstwort). */
  parentHead: string;
  peers: { symbolToken: string; symbolUpper: string; tokens: string[] }[];
}

/** N24: Ein Peer-Ticker zählt allein erst ab dieser Länge; kürzere (AI, ON, IT) sind normale Wörter oder Kürzel. */
const PEER_TICKER_MIN_LENGTH = 3;

/** Plural und -ing gleich behandeln: „Networks“ und „Networking“ ergeben „network“. */
function stemBrandToken(token: string): string {
  const base = token.endsWith("ing") ? token.slice(0, -3) : token;
  return base.endsWith("s") ? base.slice(0, -1) : base;
}

function brandTokens(value: string): string[] {
  return companyMatchTokens(value)
    .filter((token) => !COMPANY_FILLER.has(token))
    .map(stemBrandToken)
    .filter((token) => token.length > 0);
}

function tickerBase(ticker: string): string {
  const base = ticker.trim().split(/[.:\-]/)[0]?.toLowerCase() ?? "";
  return base.length >= 2 ? stemBrandToken(base) : "";
}

function tickerUpper(ticker: string): string {
  return ticker.trim().split(/[.:\-]/)[0]?.toUpperCase() ?? "";
}

function rawNameTokens(value: string): string[] {
  return value.split(/[^A-Za-z0-9]+/).filter((token) => token.length > 0);
}

function containsTokenRun(have: readonly string[], wanted: readonly string[]): boolean {
  if (wanted.length === 0) return false;
  for (let start = 0; start <= have.length - wanted.length; start++) {
    if (wanted.every((token, offset) => have[start + offset] === token)) return true;
  }
  return false;
}

function ownBrandScope(companyName: string, ticker: string, ownTexts: readonly string[], peers: readonly PeerCompany[], parent = ""): OwnBrandScope {
  const tickerToken = tickerBase(ticker);
  const own = new Set<string>(brandTokens(companyName));
  if (tickerToken) own.add(tickerToken);
  for (const text of ownTexts) {
    for (const token of brandTokens(text)) own.add(token);
  }
  const foreignPeers: OwnBrandScope["peers"] = [];
  for (const peer of peers) {
    const peerName = typeof peer?.companyName === "string" ? peer.companyName.trim() : "";
    const symbolToken = typeof peer?.symbol === "string" ? tickerBase(peer.symbol) : "";
    if (!peerName && !symbolToken) continue;
    if (symbolToken && symbolToken === tickerToken) continue;
    if (peerName && (companyReferenced(peerName, companyName) || companyReferenced(companyName, peerName))) continue;
    const symbolUpper = typeof peer?.symbol === "string" ? tickerUpper(peer.symbol) : "";
    foreignPeers.push({ symbolToken, symbolUpper, tokens: peerName ? brandTokens(peerName) : [] });
  }
  return { companyName, tickerToken, own, parentHead: brandTokens(parent)[0] ?? "", peers: foreignPeers };
}

function namesOwnCompany(text: string, scope: OwnBrandScope): boolean {
  if (companyReferenced(text, scope.companyName)) return true;
  return scope.tickerToken.length > 0 && brandTokens(text).includes(scope.tickerToken);
}

/**
 * N23/N24/N25: Name eines KI-Kinds nennt eine andere Firma oder Marke.
 * Eigene Firma oder eigener Ticker im Namen gehen vor.
 * Starker Beleg (wirkt immer):
 * 1) Der Firmenname eines FMP-Peers mit mindestens zwei Wörtern (ohne Rechtsform wie Inc, Corp, Holdings)
 *    steht als Wortfolge im Namen, außer alle seine Wörter gehören zum eigenen Vokabular.
 * 2) brand nennt eine Marke außerhalb des belegten eigenen Vokabulars (Firma, Ticker, Profilbeschreibung,
 *    Geschwister). Der Elternname zählt dafür nicht. N26: Steht ein nicht eigenes brand-Wort in einem geladenen
 *    Peer-Namen, ist die Marke fremd (nur Namen, keine Ticker). Sonst ist eine Marke eigen, wenn ihr erstes Wort belegt eigen
 *    ist, oder wenn sie im Namen steht und das erste Wort des Namens eine belegte eigene Produktfamilie ist
 *    („AX“ in „Dynamics AX“, wenn „Dynamics“ im Profil steht).
 * Ein-Wort-Beleg (Ticker, Kürzel, Erstwort, einwortiger Peer-Name) wirkt nur am Namensanfang:
 * 3) Peer-Ticker ab PEER_TICKER_MIN_LENGTH Zeichen exakt in Großschreibung als erstes Wort („ANET Switches“),
 * 4) das erste Wort des Namens ist zugleich Ticker und erstes Wort des Peer-Namens („Dell PowerEdge“), oder
 * 5) es ist der ganze, einwortige Peer-Name („HP Servers“ bei „HP Inc.“),
 *    jeweils nicht im eigenen Vokabular. Steht das erste Wort des Elternsegments im Namen, gelten 3) und 4) nicht
 *    („Dynamics CRM“ unter „Dynamics …“); 5) gilt weiter (N26: „NetApp Storage“ unter „Storage“). Wörter hinten im Namen („Connected Cars“, „Set-Top Box“) sind kein Beleg.
 */
function namesForeignBrand(name: string, brand: unknown, scope: OwnBrandScope): boolean {
  if (namesOwnCompany(name, scope)) return false;
  const tokens = brandTokens(name);
  const raw = rawNameTokens(name);
  const head = tokens[0] ?? "";
  const rawHead = raw[0] ?? "";
  const parentAnchored = scope.parentHead.length > 0 && tokens.includes(scope.parentHead);
  for (const peer of scope.peers) {
    if (peer.tokens.length > 1 && !peer.tokens.every((token) => scope.own.has(token)) && containsTokenRun(tokens, peer.tokens)) return true;
    if (!head || scope.own.has(head)) continue;
    if (peer.tokens.length === 1 && peer.tokens[0] === head) return true;
    // N26: Der Elternbezug schützt nur gegen Ticker und Kürzel, nicht gegen einen einwortigen Peer-Namen („NetApp Storage“).
    if (parentAnchored) continue;
    if (peer.symbolUpper.length < PEER_TICKER_MIN_LENGTH || !peer.symbolToken || scope.own.has(peer.symbolToken)) continue;
    if (rawHead === peer.symbolUpper) return true;
    if (peer.tokens[0] === peer.symbolToken && head === peer.symbolToken) return true;
  }
  if (typeof brand !== "string" || !brand.trim()) return false;
  if (namesOwnCompany(brand, scope)) return false;
  const brandParts = brandTokens(brand);
  if (brandParts.every((token) => scope.own.has(token))) return false;
  // N26: Ein fremdes brand-Wort aus einem geladenen Peer-Namen ist immer fremd, auch hinter einem eigenen Erstwort
  // („Surface Arista“, brand „Azure Arista“). Nur Peer-Namen, keine Ticker: „Dynamics CRM“ bleibt bei CRM-Peer.
  if (brandParts.some((token) => !scope.own.has(token) && scope.peers.some((peer) => peer.tokens.includes(token)))) return true;
  if (scope.own.has(brandParts[0] ?? "")) return false;
  if (head && scope.own.has(head) && brandParts.every((token) => tokens.includes(token))) return false;
  return true;
}

export interface SegmentOutlineItem {
  name: string;
  shareOfParentPct: number | null;
  growthPct: number | null;
  basis: string;
  origin: "KI";
}

const GENERIC_SOURCE = new Set(["ki-schätzung", "ki schätzung", "ki", "schätzung", "unbekannt", "unknown", "n/a", "na"]);

const SOURCE_DOC = /(geschäftsbericht|jahresbericht|annual report|investor-präsentation|investorenpräsentation|investor presentation|10-k|20-f|10-q|8-k|halbjahresbericht|quartalsbericht)/i;
const SOURCE_BAD = /(peer-median|peer median|kein geschäftsbericht|ki-schätzung|ki schätzung|\bschätzung\b|abgeleitet)/i;

export function concreteSource(value: string, companyName = ""): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  if (GENERIC_SOURCE.has(lower) || SOURCE_BAD.test(lower)) return false;
  const years = Array.from(text.matchAll(/(?:19|20)\d{2}/g), (match) => Number(match[0]));
  const nowYear = new Date().getFullYear();
  const yearOk = years.length > 0 && years.every((year) => year <= nowYear && year >= nowYear - 3);
  if (!yearOk) return false;
  const urlMatch = text.match(/https?:\/\/\S+/i);
  if (urlMatch) {
    if (!companyName) return false;
    let host = "";
    try {
      host = new URL(urlMatch[0]).hostname.toLowerCase();
    } catch {
      return false;
    }
    const labels = host.split(".").filter((label) => label.length >= 2);
    const ownHost = labels.some((label) => hostLabelMatches(label, companyName));
    if (!ownHost && !neutralCitationHost(host)) return false;
    return SOURCE_DOC.test(text) || SOURCE_DOC.test(decodeURIComponent(urlMatch[0]));
  }
  if (!SOURCE_DOC.test(text)) return false;
  if (!companyName) return true;
  return companyReferenced(text, companyName);
}

function outlineNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

const ECHO_STOP = new Set(["company", "corporation", "corp", "inc", "ltd", "limited", "group", "holdings", "the", "and", "plc", "ag", "co"]);

function echoTokens(value: string, min: number): string[] {
  return value.toLowerCase().split(/[^a-z0-9äöü]+/).filter((token) => token.length >= min && !ECHO_STOP.has(token));
}

function foldAmpersand(value: string): string {
  const pair = /([a-z0-9]+)\s*&\s*([a-z0-9]+)/;
  let folded = value;
  while (pair.test(folded)) {
    folded = folded.replace(pair, (_match, left: string, right: string) => (
      left.length === 1 || right.length === 1 ? `${left}${right}` : `${left} ${right}`
    ));
  }
  return folded;
}

function foldCompany(value: string): string {
  const folded = value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return foldAmpersand(folded)
    .replace(/['’]/g, "")
    .replace(/\b(?:p\.?\s*l\.?\s*c\.?|s\.?\s*a\.?|n\.?\s*v\.?|l\.?\s*l\.?\s*c\.?|incorporated|corporation|company|holdings|holding|limited|group|corp|inc|ltd|llc|plc|co|ag|gmbh|oyj)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function companyMatchTokens(value: string): string[] {
  return foldCompany(value).split(/\s+/).filter((token) => token.length >= 2);
}

function expandWordAmpersand(value: string): string {
  const pair = /([a-z0-9]{2,})\s*&\s*([a-z0-9]{2,})/;
  let current = value;
  while (pair.test(current)) current = current.replace(pair, "$1 and $2");
  return current;
}

function hostNameTokens(value: string): string[] {
  const folded = value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return foldAmpersand(expandWordAmpersand(folded))
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function hostLabelMatches(label: string, companyName: string): boolean {
  const plain = label.replace(/-/g, "");
  if (plain.length < 2) return false;
  const singleCore = companyMatchTokens(companyName).filter((token) => !COMPANY_FILLER.has(token) && foldCompany(token).length > 0);
  if (singleCore.some((token) => token === plain)) return true;
  const parts = hostNameTokens(companyName);
  const kind = (token: string): "core" | "filler" | "legal" => {
    if (COMPANY_FILLER.has(token)) return "filler";
    if (foldCompany(token).length === 0) return "legal";
    return "core";
  };
  for (let start = 0; start < parts.length; start += 1) {
    if (kind(parts[start] ?? "") !== "core") continue;
    let joined = parts[start] ?? "";
    for (let end = start + 1; end < parts.length; end += 1) {
      const token = parts[end] ?? "";
      const tokenKind = kind(token);
      joined += token;
      if (tokenKind === "filler") continue;
      if (tokenKind === "legal") {
        if (kind(parts[end - 1] ?? "") === "core" && joined === plain) return true;
        break;
      }
      if (joined === plain) return true;
    }
  }
  return false;
}

const COMPANY_FILLER = new Set(["of", "the", "and"]);

const SEGMENT_FILING_HOSTS = [
  "hkexnews.hk",
  "cninfo.com.cn",
  "sse.com.cn",
  "szse.cn",
  "disclosure.edinet-fsa.go.jp",
  "sec.gov",
];

function hostUnder(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`);
}

/** Nur die explizite Host-Liste. Kein generisches *.gov, keine Medien. */
function neutralCitationHost(host: string): boolean {
  return SEGMENT_FILING_HOSTS.some((root) => hostUnder(host, root));
}

function citedHostVerdict(citation: string, companyName: string): "none" | "foreign" | "invalid" {
  const urlMatch = citation.match(/https?:\/\/\S+/i);
  if (!urlMatch || !companyName) return "none";
  let host = "";
  try {
    host = new URL(urlMatch[0]).hostname.toLowerCase();
  } catch {
    return "invalid";
  }
  if (neutralCitationHost(host)) return "none";
  const labels = host.split(".").filter((label) => label.length >= 2);
  if (labels.some((label) => hostLabelMatches(label, companyName))) return "none";
  return "foreign";
}

function companyReferenced(text: string, companyName: string): boolean {
  const core = (value: string) => companyMatchTokens(value).filter((token) => !COMPANY_FILLER.has(token));
  const wanted = core(companyName);
  if (!text.trim() || wanted.length === 0) return false;
  const have = core(text);
  for (let start = 0; start <= have.length - wanted.length; start++) {
    let same = true;
    for (let offset = 0; offset < wanted.length; offset++) {
      if (have[start + offset] !== wanted[offset]) {
        same = false;
        break;
      }
    }
    if (same) return true;
  }
  return false;
}

export function outlineEchoMatches(payload: unknown, companyName: string, industry = "", sector = ""): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as { companyEcho?: unknown; industryEcho?: unknown };
  const companyEcho = record.companyEcho;
  if (typeof companyEcho !== "string" || !companyEcho.trim()) return false;
  if (!companyReferenced(companyEcho, companyName)) return false;
  const hints = echoTokens(`${industry} ${sector}`, 4);
  if (hints.length === 0) return true;
  const industryEcho = record.industryEcho;
  if (typeof industryEcho !== "string" || !industryEcho.trim()) return false;
  const industryFold = industryEcho.toLowerCase();
  return hints.some((token) => industryFold.includes(token));
}

export function outlineStillCurrent(startedTicker: string, currentTicker: string): boolean {
  return startedTicker.trim().toUpperCase() === currentTicker.trim().toUpperCase();
}

export function reviewSegmentOutline(
  payload: unknown,
  companyName = "",
  /** N24: dieselbe Fremdmarken-Prüfung wie bei den KI-Kindern. */
  brand: { ticker?: string; description?: string; peerCompanies?: readonly PeerCompany[] } = {},
): { items: SegmentOutlineItem[]; reason: string | null } {
  if (!payload || typeof payload !== "object") return { items: [], reason: NO_SEGMENT_CHILDREN };
  const record = payload as { children?: unknown; fills?: unknown };
  const rawList = Array.isArray(record.children) ? record.children : Array.isArray(record.fills) ? record.fills : null;
  if (!rawList || rawList.length === 0) return { items: [], reason: NO_SEGMENT_CHILDREN };
  const items: SegmentOutlineItem[] = [];
  const notes: string[] = [];
  const foreign: string[] = [];
  const seen = new Set<string>();
  const brandScope = companyName
    ? ownBrandScope(companyName, brand.ticker ?? "", [brand.description ?? ""], brand.peerCompanies ?? [])
    : null;
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { name?: unknown; segmentName?: unknown; shareOfParentPct?: unknown; growthPct?: unknown; segmentGrowth?: unknown; basis?: unknown; rationale?: unknown; formula?: unknown; source?: unknown; tamSource?: unknown; owner?: unknown; ownerParent?: unknown; brand?: unknown };
    const name = (typeof rec.name === "string" && rec.name.trim() ? rec.name : typeof rec.segmentName === "string" ? rec.segmentName : "").trim().slice(0, 80);
    if (!name || seen.has(norm(name))) continue;
    const basisText = [rec.basis, rec.rationale, rec.formula].filter((part) => typeof part === "string" && part.trim()).join(" · ");
    const basis = basisText ? boundBasis(basisText) : "";
    if (!basis) {
      notes.push(`${KI_WITHOUT_BASIS}: ${name}`);
      continue;
    }
    if (brandScope) {
      const owner = typeof rec.owner === "string" ? rec.owner.trim() : "";
      const ownerParent = typeof rec.ownerParent === "string" ? rec.ownerParent.trim() : "";
      const ownerForeign = (owner || ownerParent) && !companyReferenced(owner, companyName) && !companyReferenced(ownerParent, companyName);
      if (ownerForeign || namesForeignBrand(name, rec.brand, brandScope)) {
        seen.add(norm(name));
        foreign.push(name);
        continue;
      }
    }
    const citation = (typeof rec.source === "string" && rec.source.trim() ? rec.source : typeof rec.tamSource === "string" ? rec.tamSource : "").trim();
    const share = outlineNumber(rec.shareOfParentPct);
    const growth = outlineNumber(rec.growthPct ?? rec.segmentGrowth);
    if ((share != null && share < 0) || (growth != null && growth < -100)) {
      notes.push(`${KI_NEGATIVE}: ${name}`);
      continue;
    }
    const sourced = concreteSource(citation, companyName);
    let shareKept = share != null && share > 0 ? share : null;
    let growthKept = growth;
    if ((share != null || growth != null) && !sourced) {
      notes.push(`${KI_WITHOUT_SOURCE}: ${name}`);
      shareKept = null;
      growthKept = null;
    }
    seen.add(norm(name));
    items.push({
      name,
      shareOfParentPct: shareKept,
      growthPct: growthKept,
      basis: citation && !basis.includes(citation) ? boundBasis(`${basis} · ${citation}`) : basis,
      origin: "KI",
    });
  }
  const shareSum = items.reduce((sum, row) => sum + (row.shareOfParentPct ?? 0), 0);
  if (items.some((row) => row.shareOfParentPct != null) && shareSum > 100) {
    return { items: [], reason: KI_SUM_EXCEEDS_PARENT };
  }
  const parts = [foreign.length > 0 ? `n/a — Fremdmarke verworfen: ${foreign.join(", ")}` : "", ...notes].filter((part) => part.length > 0);
  if (items.length === 0) return { items: [], reason: parts[0] ?? NO_SEGMENT_CHILDREN };
  return { items, reason: parts.length > 0 ? parts.join(" ") : null };
}

export function resolveSegmentChildren(
  parent: string,
  fmp: readonly SegmentChild[],
  ki: readonly SegmentChild[],
): SegmentChildrenResult {
  if (fmp.length > 0) return { parent, children: fmp.map((row) => ({ ...row, source: "FMP" })), reason: null };
  if (ki.length > 0) return { parent, children: ki.map((row) => ({ ...row, source: "KI" })), reason: null };
  return { parent, children: [], reason: NO_SEGMENT_CHILDREN };
}
