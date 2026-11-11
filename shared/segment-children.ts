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
    /** P2-N29-2: FMP-Namenssuche pro brand. Fehlt der Eintrag, bleibt die N29-Entscheidung. */
    brandNameSearch?: readonly BrandNameSearch[];
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
  const brandIndex = brandSearchIndex(scope.brandNameSearch);
  const unproven: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { name?: unknown; revenue?: unknown; shareOfParentPct?: unknown; growthPct?: unknown; basis?: unknown; source?: unknown; owner?: unknown; ownerParent?: unknown; brand?: unknown; brandOwner?: unknown };
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
    if (brandScope) {
      const searched = ownClaimSearchVerdict(name, rec.brand, rec.brandOwner, brandScope, brandIndex);
      if (searched === "foreign") {
        foreign.push(name);
        continue;
      }
      if (searched === "unproven") {
        unproven.push(name);
        continue;
      }
    }
    if (brandScope && namesForeignBrand(name, rec.brand, brandScope, rec.brandOwner)) {
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
  const unprovenNote = unproven.length > 0 ? `n/a — FMP-Namenssuche nicht belegbar: ${unproven.join(", ")}` : "";
  const parts = [foreignNote, unprovenNote, filtered > 0 && kept.length === 0 ? KI_FILTERED : "", ...notes].filter((part) => part.length > 0);
  if (kept.length === 0) {
    return { parent, children: [], reason: parts.join(" ") || NO_SEGMENT_CHILDREN };
  }
  return { parent, children: kept, reason: parts.length > 0 ? parts.join(" ") : null };
}

export interface PeerCompany {
  symbol: string;
  companyName: string;
}

/** P2-N29-2: eine Namenssuche für ein brand. ok=false heißt, der Abruf lieferte keinen Beleg (429, 5xx, Netz). */
export interface BrandNameSearch {
  brand: string;
  ok: boolean;
  companies: readonly PeerCompany[];
}

interface OwnBrandScope {
  companyName: string;
  tickerToken: string;
  /** Belegtes eigenes Vokabular: Firma, Ticker, Profilbeschreibung, Geschwister. Nicht der Elternname. */
  own: Set<string>;
  /** N25: erstes Wort des Elternsegments. Schützt nur gegen Ein-Wort-Treffer (Ticker, Kürzel, Erstwort). */
  parentHead: string;
  /** N28: distinct = unterscheidender Teil des Peer-Namens (ohne GENERIC_COMPANY_WORDS), raw = Wort vor dem Stamm. */
  peers: { name: string; symbolToken: string; symbolUpper: string; tokens: string[]; distinct: BrandTokenPair[] }[];
}

interface BrandTokenPair {
  stem: string;
  raw: string;
}

/** N24: Ein Peer-Ticker zählt allein erst ab dieser Länge; kürzere (AI, ON, IT) sind normale Wörter oder Kürzel. */
const PEER_TICKER_MIN_LENGTH = 3;
/**
 * N27 (DC-Vorschlag F3), Abgleich-Heuristiken, keine Wert-Caps:
 * Ein einwortiger Peer-Name zählt an jeder Stelle des Namens erst ab dieser Länge („Oracle“, „NetApp“, „Salesforce“).
 * Kürzere sind oft Alltagswörter („Box“ in „Set-Top Box“). Profil und eigenes Vokabular belegen das nicht, deshalb die Länge.
 */
const PEER_NAME_ANYWHERE_MIN_LENGTH = 5;
/** N27: Ticker = erstes Wort des Peer-Namens zählt an jeder Stelle ab dieser Länge („Alletra Dell Migration“). */
const PEER_TICKER_ANYWHERE_MIN_LENGTH = 4;
/** N27: Eine eigene Produktfamilie rettet fremde brand-Wörter nur bis zu dieser Länge (AX, NAV, CRM, 365), nicht „Cisco“ oder „Arista“. */
const OWN_SUBBRAND_MAX_LENGTH = 4;
/**
 * N28: Generische Firmenwörter. Gegen Peer-Namen zählt nur der unterscheidende Teil des Firmennamens
 * („Meta Platforms“ → meta, „Arista Networks“ → arista, „NetApp“ bleibt netapp), für den einwortigen Peer-Namen (N27)
 * und für das brand-Wort im Peer-Namen (N26). Rechtsformen (Inc, Corp, SE fehlt) entfernt schon foldCompany.
 * Die Wortfolge-Regel (mehrwortiger Peer-Name) bleibt beim vollen Namen.
 */
const GENERIC_COMPANY_WORDS = ["Platforms", "Networks", "Systems", "Technologies", "Technology", "Holdings", "Group", "Corporation", "Solutions"];
const GENERIC_COMPANY_STEMS = new Set(GENERIC_COMPANY_WORDS.map((word) => stemBrandToken(word.toLowerCase())));

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

/** N28 (P3-S): wie brandTokens, aber mit dem Wort vor dem Stamm; Längen werden am Rohwort gemessen („Boeing“ = 6, nicht „boe“). */
function brandTokenPairs(value: string): BrandTokenPair[] {
  return companyMatchTokens(value)
    .filter((token) => !COMPANY_FILLER.has(token))
    .map((raw) => ({ stem: stemBrandToken(raw), raw }))
    .filter((pair) => pair.stem.length > 0);
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
    const pairs = peerName ? brandTokenPairs(peerName) : [];
    const distinct = pairs.filter((pair) => !GENERIC_COMPANY_STEMS.has(pair.stem));
    foreignPeers.push({ name: peerName, symbolToken, symbolUpper, tokens: pairs.map((pair) => pair.stem), distinct: distinct.length > 0 ? distinct : pairs });
  }
  return { companyName, tickerToken, own, parentHead: brandTokens(parent)[0] ?? "", peers: foreignPeers };
}

function namesOwnCompany(text: string, scope: OwnBrandScope): boolean {
  if (companyReferenced(text, scope.companyName)) return true;
  return scope.tickerToken.length > 0 && brandTokens(text).includes(scope.tickerToken);
}

/** N29: Platzhalter, die die KI statt null schreibt; gelten als „brandOwner fehlt“. */
const BRAND_OWNER_UNKNOWN = new Set(["null", "none", "n/a", "na", "unklar", "unbekannt", "unknown", "-"]);

/**
 * N29: brandOwner = Firma, der die Marke im Namen gehört (KI-Feld, optional).
 * "peer": nennt einen geladenen Peer (Name oder Ticker). "own": eigene Firma (Name ohne Rechtsform oder Ticker),
 * N30: nur wenn alle Wörter zur eigenen Firma oder zum Ticker gehören. "foreign": eine andere Firma.
 * "none": null, leer, Platzhalter oder kein Text; N30 auch Tochter/Teilnennung, deren erstes unterscheidendes Wort eigen ist.
 */
function brandOwnerVerdict(value: unknown, scope: OwnBrandScope): "peer" | "own" | "foreign" | "none" {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || BRAND_OWNER_UNKNOWN.has(text.toLowerCase()) || companyMatchTokens(text).length === 0) return "none";
  const upper = text.toUpperCase();
  if (scope.peers.some((peer) => (peer.name && (companyReferenced(text, peer.name) || companyReferenced(peer.name, text))) || (peer.symbolUpper.length > 0 && upper === peer.symbolUpper))) return "peer";
  // N30 (DC-Vorschlag G2): eigen nur, wenn alle Wörter von brandOwner zur eigenen Firma bzw. zum eigenen Ticker gehören
  // und die Firma ganz oder der Ticker genannt ist (keine Teilnennung wie „GE HealthCare“, „Intel, not AMD“).
  // Beginnt brandOwner mit eigenem Vokabular (Tochter: „LinkedIn Corporation“, „Aruba Networks“, „Xbox Game Studios“),
  // gilt er als fehlend und N28 entscheidet.
  const core = brandTokens(text);
  const ownCore = brandTokens(scope.companyName);
  const ownSet = new Set([...ownCore, ...(scope.tickerToken ? [scope.tickerToken] : [])]);
  if (core.length > 0 && core.every((token) => ownSet.has(token)) && (ownCore.every((token) => core.includes(token)) || core.includes(scope.tickerToken))) return "own";
  const firstDistinct = core.find((token) => !GENERIC_COMPANY_STEMS.has(token));
  if (firstDistinct && scope.own.has(firstDistinct)) return "none";
  return "foreign";
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
 *    N27: ab PEER_NAME_ANYWHERE_MIN_LENGTH Zeichen auch an jeder anderen Stelle; ein Ticker, der zugleich erstes
 *    Peer-Wort ist, ab PEER_TICKER_ANYWHERE_MIN_LENGTH Zeichen an jeder Stelle (nur bei fremdem Kopf, ohne Elternbezug),
 *    jeweils nicht im eigenen Vokabular. N28: Für 5) und das brand-Wort im Peer-Namen zählt nur der unterscheidende Teil
 *    des Peer-Namens ohne GENERIC_COMPANY_WORDS; Längen von Peer-Namen und brand-Wörtern am Rohwort. Steht das erste Wort des Elternsegments im Namen, gelten 3) und 4) nicht
 *    („Dynamics CRM“ unter „Dynamics …“); 5) gilt weiter (N26: „NetApp Storage“ unter „Storage“). Wörter hinten im Namen („Connected Cars“, „Set-Top Box“) sind kein Beleg.
 * N29 brandOwner, nach allen Peer-Belegen aus dem Namen (die verwerfen weiter immer):
 * a) brandOwner nennt einen geladenen Peer: verworfen. b) brandOwner ist die eigene Firma: bleibt, sticht die
 *    brand-Regeln (Unterbrands außerhalb des Profils, „Power Platform“). c) brandOwner ist eine andere Firma: verworfen,
 *    auch ohne geladenen Peer. d) brandOwner fehlt oder null: wie N28.
 * N30: b) nur, wenn alle brandOwner-Wörter zur eigenen Firma oder zum Ticker gehören. Tochter mit eigenem Erstwort
 *    („LinkedIn Corporation“, „Aruba Networks“) gilt als d); andere Teilnennung („GE HealthCare“ bei GE) ebenso.
 */
function namesForeignBrand(name: string, brand: unknown, scope: OwnBrandScope, brandOwner: unknown = null): boolean {
  if (namesOwnCompany(name, scope)) return false;
  const tokens = brandTokens(name);
  const raw = rawNameTokens(name);
  const head = tokens[0] ?? "";
  const rawHead = raw[0] ?? "";
  const parentAnchored = scope.parentHead.length > 0 && tokens.includes(scope.parentHead);
  for (const peer of scope.peers) {
    if (peer.tokens.length > 1 && !peer.tokens.every((token) => scope.own.has(token)) && containsTokenRun(tokens, peer.tokens)) return true;
    // N27: einwortiger Peer-Name an jeder Stelle („Windows Oracle Database“, „ProLiant NetApp Bundle“).
    // N28: einwortig nach Abzug generischer Firmenwörter („Surface Arista“ bei „Arista Networks“), Länge am Rohwort.
    const single = peer.distinct.length === 1 ? peer.distinct[0] : null;
    if (single && single.raw.length >= PEER_NAME_ANYWHERE_MIN_LENGTH && !scope.own.has(single.stem) && tokens.includes(single.stem)) return true;
    if (!head || scope.own.has(head)) continue;
    if (peer.tokens.length === 1 && peer.tokens[0] === head) return true;
    // N26: Der Elternbezug schützt nur gegen Ticker und Kürzel, nicht gegen einen einwortigen Peer-Namen („NetApp Storage“).
    if (parentAnchored) continue;
    if (peer.symbolUpper.length < PEER_TICKER_MIN_LENGTH || !peer.symbolToken || scope.own.has(peer.symbolToken)) continue;
    // N27: Ticker = erstes Peer-Wort an jeder Stelle, nur bei fremdem Namensanfang und ohne Elternbezug.
    // N28: Länge bleibt am Ticker-Stamm („CARS“ → car), sonst fiele „Connected Cars“.
    if (peer.tokens[0] === peer.symbolToken && peer.symbolToken.length >= PEER_TICKER_ANYWHERE_MIN_LENGTH && tokens.includes(peer.symbolToken)) return true;
    if (rawHead === peer.symbolUpper) return true;
    if (peer.tokens[0] === peer.symbolToken && head === peer.symbolToken) return true;
  }
  // N29: brandOwner nach den Peer-Belegen aus dem Namen, vor den brand-Regeln.
  const ownerVerdict = brandOwnerVerdict(brandOwner, scope);
  if (ownerVerdict === "peer") return true;
  if (ownerVerdict === "own") return false;
  if (ownerVerdict === "foreign") return true;
  if (typeof brand !== "string" || !brand.trim()) return false;
  if (namesOwnCompany(brand, scope)) return false;
  const brandPairs = brandTokenPairs(brand);
  const brandParts = brandPairs.map((pair) => pair.stem);
  if (brandParts.every((token) => scope.own.has(token))) return false;
  // N26: Ein fremdes brand-Wort aus einem geladenen Peer-Namen ist immer fremd, auch hinter einem eigenen Erstwort
  // („Surface Arista“, brand „Azure Arista“). Nur Peer-Namen, keine Ticker: „Dynamics CRM“ bleibt bei CRM-Peer.
  // N28: nur der unterscheidende Teil des Peer-Namens („Platform“ aus „Meta Platforms“ zählt nicht).
  if (brandParts.some((token) => !scope.own.has(token) && scope.peers.some((peer) => peer.distinct.some((pair) => pair.stem === token)))) return true;
  // N27: Die eigene Familie rettet nur kurze fremde Untermarken-Wörter; „Surface Cisco“ (brand Cisco) bleibt fremd,
  // auch wenn Cisco nicht als Peer geladen ist (N23 brand-only-Abwehr).
  // N28 (P3-S): Länge am Rohwort („Corning“ = 7, nicht „corn“).
  const ownOrShort = (pair: BrandTokenPair) => scope.own.has(pair.stem) || pair.raw.length <= OWN_SUBBRAND_MAX_LENGTH;
  if (scope.own.has(brandParts[0] ?? "") && brandPairs.every(ownOrShort)) return false;
  if (head && scope.own.has(head) && brandPairs.every((pair) => tokens.includes(pair.stem) && ownOrShort(pair))) return false;
  return true;
}

export function brandSearchKey(brand: string): string {
  return brand.trim().toLowerCase().replace(/\s+/g, " ");
}

function brandSearchIndex(rows: readonly BrandNameSearch[] | undefined): Map<string, BrandNameSearch> | null {
  if (!rows) return null;
  const index = new Map<string, BrandNameSearch>();
  for (const row of rows) {
    if (typeof row?.brand !== "string" || !row.brand.trim()) continue;
    index.set(brandSearchKey(row.brand), row);
  }
  return index;
}

/** Die eigene brandOwner-Angabe ist der einzige Grund, das Kind zu behalten. Genau diese Lücke sucht P2-N29-2. */
function ownClaimNeedsSearch(name: string, brand: unknown, brandOwner: unknown, scope: OwnBrandScope): boolean {
  if (typeof brand !== "string" || !brand.trim()) return false;
  if (brandOwnerVerdict(brandOwner, scope) !== "own") return false;
  if (namesForeignBrand(name, brand, scope, brandOwner)) return false;
  return namesForeignBrand(name, brand, scope, null);
}

/**
 * P2-N29-2: der Markenname steht als Firma in der Namenssuche, und es ist nicht die eigene Firma.
 * Dieselben Belege wie bei einem geladenen Peer: Wortfolge und die bestehende
 * Mindestlänge einwortiger Peer-Namen. Der Vergleich nutzt stemBrandToken, damit
 * „Networking“ und „Networks“ dieselbe Folge sind. Generische Firmenwörter allein sind kein Beleg.
 * Kein neuer Schwellenwert. Teilüberlappung ist kein Beleg.
 */
function searchProvesForeign(brand: string, companies: readonly PeerCompany[], scope: OwnBrandScope): boolean {
  const pairs = brandTokenPairs(brand);
  const distinct = pairs.filter((pair) => !GENERIC_COMPANY_STEMS.has(pair.stem));
  if (distinct.length === 0) return false;
  if (pairs.length === 1 && pairs[0].raw.length < PEER_NAME_ANYWHERE_MIN_LENGTH) return false;
  const wanted = pairs.map((pair) => pair.stem);
  for (const company of companies) {
    const name = typeof company?.companyName === "string" ? company.companyName.trim() : "";
    if (!name) continue;
    const symbolToken = typeof company.symbol === "string" ? tickerBase(company.symbol) : "";
    if (symbolToken && symbolToken === scope.tickerToken) continue;
    if (namesOwnCompany(name, scope)) continue;
    if (companyReferenced(name, scope.companyName) || companyReferenced(scope.companyName, name)) continue;
    if (containsTokenRun(brandTokenPairs(name).map((pair) => pair.stem), wanted)) return true;
  }
  return false;
}

function ownClaimSearchVerdict(
  name: string,
  brand: unknown,
  brandOwner: unknown,
  scope: OwnBrandScope,
  index: Map<string, BrandNameSearch> | null,
): "foreign" | "unproven" | "skip" {
  if (!index || !ownClaimNeedsSearch(name, brand, brandOwner, scope) || typeof brand !== "string") return "skip";
  const row = index.get(brandSearchKey(brand));
  if (!row) return "skip";
  if (!row.ok) return "unproven";
  return searchProvesForeign(brand, row.companies, scope) ? "foreign" : "skip";
}

export function ownClaimBrandQueries(
  payload: unknown,
  parent: string,
  input: {
    companyName: string;
    ticker?: string;
    description?: string;
    siblings?: readonly string[];
    peerCompanies?: readonly PeerCompany[];
  },
): string[] {
  if (!payload || typeof payload !== "object" || !input.companyName.trim()) return [];
  const record = payload as { children?: unknown; fills?: unknown };
  const rawList = Array.isArray(record.children) ? record.children : Array.isArray(record.fills) ? record.fills : null;
  if (!rawList) return [];
  const scope = ownBrandScope(input.companyName, input.ticker ?? "", [input.description ?? "", ...(input.siblings ?? [])], input.peerCompanies ?? [], parent);
  const queries: string[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { name?: unknown; segmentName?: unknown; brand?: unknown; brandOwner?: unknown };
    const name = (typeof rec.name === "string" && rec.name.trim() ? rec.name : typeof rec.segmentName === "string" ? rec.segmentName : "").trim();
    if (!name || !ownClaimNeedsSearch(name, rec.brand, rec.brandOwner, scope)) continue;
    const brand = typeof rec.brand === "string" ? rec.brand.trim() : "";
    const key = brandSearchKey(brand);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    queries.push(brand);
  }
  return queries;
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
  brand: { ticker?: string; description?: string; peerCompanies?: readonly PeerCompany[]; brandNameSearch?: readonly BrandNameSearch[] } = {},
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
  const brandIndex = brandSearchIndex(brand.brandNameSearch);
  const unproven: string[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { name?: unknown; segmentName?: unknown; shareOfParentPct?: unknown; growthPct?: unknown; segmentGrowth?: unknown; basis?: unknown; rationale?: unknown; formula?: unknown; source?: unknown; tamSource?: unknown; owner?: unknown; ownerParent?: unknown; brand?: unknown; brandOwner?: unknown };
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
      const searched = ownClaimSearchVerdict(name, rec.brand, rec.brandOwner, brandScope, brandIndex);
      if (ownerForeign || searched === "foreign" || namesForeignBrand(name, rec.brand, brandScope, rec.brandOwner)) {
        seen.add(norm(name));
        foreign.push(name);
        continue;
      }
      if (searched === "unproven") {
        seen.add(norm(name));
        unproven.push(name);
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
  const parts = [
    foreign.length > 0 ? `n/a — Fremdmarke verworfen: ${foreign.join(", ")}` : "",
    unproven.length > 0 ? `n/a — FMP-Namenssuche nicht belegbar: ${unproven.join(", ")}` : "",
    ...notes,
  ].filter((part) => part.length > 0);
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
