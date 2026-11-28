/**
 * GET /api/segment-growth/:ticker
 *
 * Lücken-Wachstum für Geschäfts- und Regionensegmente.
 * Schreibt nicht in den Analyze-Cache und nicht in den Score.
 * Fakt-YoY aus dem gleichen Jahresnamen bleibt in /api/analyze; hier nur
 * „berechnet“ und begründetes n/a.
 */
import type { Express, Request, Response } from "express";
import {
  annotateMissingSegmentGrowth,
  snapshotsFromFmpRows,
  type SegmentGrowthAnnotation,
  type StatementYear,
} from "../shared/segment-growth-calc";
import {
  fmpBalanceSheet,
  fmpCashFlow,
  fmpIncomeStatement,
  fmpObserved,
  fmpPeerCompanies,
  fmpProfile,
  fmpSearchCompanyName,
  fmpSegmentationRows,
  isFmpAvailable,
  promoteNonGeoRowsToBusiness,
} from "./fmp";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { loadPeerGrowthAnchor } from "./peer-growth-anchor";
import { curatedSegmentNames } from "./curated-product-segments";
import { diskResearcherGetWithTtl } from "./disk-cache";
import { prettifyProductSegmentName } from "../shared/segment-growth-calc";
import {
  KI_FILTERED,
  KI_UNAVAILABLE,
  OUTLINE_MISMATCH,
  OUTLINE_NO_IDENTITY,
  SEGMENT_CHILDREN_ROUTE,
  SEGMENT_LIST_UNAVAILABLE,
  SEGMENT_UNKNOWN,
  childrenFromFmpRows,
  reportedParentRevenue,
  resolveSegmentChildren,
  reviewKiChildren,
  outlineEchoMatches,
  brandSearchKey,
  ownClaimBrandQueries,
  reviewSegmentOutline,
  segmentNamesFromFmpRows,
  type PeerCompany,
  type SegmentChildrenResult,
} from "../shared/segment-children";

const CACHE_MS = 15 * 60 * 1000;
const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,31}$/i;

interface CacheBody {
  ticker: string;
  business: SegmentGrowthAnnotation[];
  geographic: SegmentGrowthAnnotation[];
  source: string;
  currency: string | null;
}

function incomeReportedCurrency(income: unknown): string | null {
  const row = Array.isArray(income) ? income[0] : null;
  if (!row || typeof row !== "object") return null;
  const reported = profileText(row as Record<string, unknown>, "reportedCurrency").toUpperCase();
  return /^[A-Z]{3}$/.test(reported) ? reported : null;
}

const cache = new Map<string, { at: number; body: CacheBody }>();

export function resetSegmentGrowthCacheForTests(): void {
  cache.clear();
}

const CHILDREN_CACHE_MS = 24 * 60 * 60 * 1000;
const CHILDREN_ERROR_CACHE_MS = 60 * 1000;
const CHILDREN_CACHE_MAX = 400;
export const SEGMENT_CHILDREN_KI_TIMEOUT_MS = 15_000;
const DEFAULT_RATE_MAX = 20;
const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const childCache = new Map<string, { at: number; ttl: number; body: SegmentChildrenResult }>();
/** P2-N29-2: erfolgreiche Namenssuche. 429 und Netzfehler werden nicht als „keine Firma“ abgelegt. */
const brandSearchCache = new Map<string, { at: number; companies: readonly PeerCompany[] }>();
/** N29: Prompt-Version im Schlüssel der KI-Kinder; alte 24-h-Antworten ohne brandOwner werden nicht mehr gezeigt. */
export const SEGMENT_CHILDREN_PROMPT_VERSION = "n29-brandOwner";

export function segmentChildrenCacheKey(ticker: string, kind: "product" | "geographic", parent: string): string {
  return `${SEGMENT_CHILDREN_PROMPT_VERSION}|${ticker.toUpperCase()}|${kind}|${parent.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

/** N30 (Beleg 4): Prompt-Version in der 200-Antwort von /api/segment-children, dieselbe Konstante wie im Cache-Schlüssel. Der Client liest nur parent, children und reason. */
export function withSegmentChildrenPromptVersion(body: SegmentChildrenResult): SegmentChildrenResult & { promptVersion: string } {
  return { ...body, promptVersion: SEGMENT_CHILDREN_PROMPT_VERSION };
}
const rateBuckets = new Map<string, number[]>();

const OUTLINE_NAME_TTL_MS = 24 * 60 * 60 * 1000;
const OUTLINE_NAMES_PER_TICKER = 24;
const OUTLINE_NAMES_TOTAL = 400;
const outlineNames = new Map<string, { names: string[]; at: number }>();
const IDENTITY_TTL_MS = 24 * 60 * 60 * 1000;
const identityCache = new Map<string, { at: number; identity: OutlineIdentity }>();
const statementFacts = new Map<string, { at: number; fiscalYear: string; currency: string }>();

export function resetSegmentChildrenGuardsForTests(): void {
  childCache.clear();
  brandSearchCache.clear();
  rateBuckets.clear();
  outlineNames.clear();
  identityCache.clear();
  statementFacts.clear();
}

function rememberOutlineNames(ticker: string, kind: "product" | "geographic", names: string[], now: number): void {
  const key = `${ticker.toUpperCase()}|${kind}`;
  const existing = outlineNames.get(key);
  const kept = existing && now - existing.at < OUTLINE_NAME_TTL_MS ? existing.names : [];
  const merged = [...kept];
  for (const name of names) {
    if (!merged.some((current) => sameDisplayedName(kind, current, name))) merged.push(name);
  }
  outlineNames.set(key, { names: merged.slice(-OUTLINE_NAMES_PER_TICKER), at: now });
  const expired: string[] = [];
  outlineNames.forEach((entry, entryKey) => {
    if (now - entry.at >= OUTLINE_NAME_TTL_MS) expired.push(entryKey);
  });
  for (let i = 0; i < expired.length; i++) outlineNames.delete(expired[i]);
  while (outlineNames.size > OUTLINE_NAMES_TOTAL) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    outlineNames.forEach((entry, entryKey) => {
      if (entry.at < oldestAt) {
        oldestAt = entry.at;
        oldestKey = entryKey;
      }
    });
    if (!oldestKey) break;
    outlineNames.delete(oldestKey);
  }
}

function rememberedOutlineName(ticker: string, kind: "product" | "geographic", parent: string, now: number): string | null {
  const key = `${ticker.toUpperCase()}|${kind}`;
  const entry = outlineNames.get(key);
  if (!entry || now - entry.at >= OUTLINE_NAME_TTL_MS) {
    if (entry) outlineNames.delete(key);
    return null;
  }
  return entry.names.find((name) => sameDisplayedName(kind, name, parent)) ?? null;
}

export function takeSegmentChildrenSlot(ip: string, now: number, max: number, windowMs: number): boolean {
  const recent = (rateBuckets.get(ip) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= max) {
    rateBuckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  return true;
}

function yearKey(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const rec = row as { date?: unknown; fiscalYear?: unknown; calendarYear?: unknown };
  if (typeof rec.date === "string" && rec.date.length >= 4) return rec.date.slice(0, 10);
  if (rec.fiscalYear != null) return String(rec.fiscalYear);
  if (rec.calendarYear != null) return String(rec.calendarYear);
  return "";
}

function revenueOf(row: unknown): number | null {
  if (!row || typeof row !== "object") return null;
  const n = Number((row as { revenue?: unknown }).revenue);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function statementYearsFromFmp(income: unknown, cashflow: unknown, balance: unknown): StatementYear[] {
  const map = new Map<string, StatementYear>();
  const take = (rows: unknown, field: "income" | "cashflow" | "balance") => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const key = yearKey(row);
      const revenue = revenueOf(row);
      if (!key || revenue == null) continue;
      const year = map.get(key) ?? { periodKey: key };
      year[field] = revenue;
      map.set(key, year);
    }
  };
  take(income, "income");
  take(cashflow, "cashflow");
  take(balance, "balance");
  return Array.from(map.values()).sort((a, b) => b.periodKey.localeCompare(a.periodKey)).slice(0, 2);
}

export async function loadSegmentGrowth(ticker: string): Promise<CacheBody> {
  const key = ticker.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  const [productAnnual, productQuarter, geoAnnual, geoQuarter, income, cashflow, balance] = await Promise.all([
    fmpSegmentationRows("product", key, "annual"),
    fmpSegmentationRows("product", key, "quarter"),
    fmpSegmentationRows("geographic", key, "annual"),
    fmpSegmentationRows("geographic", key, "quarter"),
    fmpIncomeStatement(key, 2).catch(() => []),
    fmpCashFlow(key, 2).catch(() => []),
    fmpBalanceSheet(key, 2).catch(() => []),
  ]);
  rememberStatementFacts(key, income);
  const statements = statementYearsFromFmp(income, cashflow, balance);
  const body: CacheBody = {
    ticker: key,
    business: annotateMissingSegmentGrowth({
      annual: snapshotsFromFmpRows(productAnnual),
      quarterly: snapshotsFromFmpRows(productQuarter),
      statements,
    }),
    geographic: annotateMissingSegmentGrowth({
      annual: snapshotsFromFmpRows(geoAnnual),
      quarterly: snapshotsFromFmpRows(geoQuarter),
      statements,
    }),
    source: "FMP revenue-product-segmentation, revenue-geographic-segmentation, income-statement, cash-flow-statement, balance-sheet-statement",
    currency: incomeReportedCurrency(income),
  };
  cache.set(key, { at: Date.now(), body });
  return body;
}

export interface SegmentChildrenDeps {
  fmpAvailable: () => boolean;
  raw: (kind: "product" | "geographic", ticker: string) => Promise<unknown[]>;
  ki: (ticker: string, parent: string, kind: "product" | "geographic", siblings: readonly string[], identity?: OutlineIdentity) => Promise<unknown>;
  names?: (ticker: string, kind: "product" | "geographic") => Promise<string[]>;
  /** N25: wie names, meldet zusätzlich, ob der FMP-Abruf der Liste fehlgeschlagen ist (429, 5xx, Netz). */
  namesStatus?: (ticker: string, kind: "product" | "geographic") => Promise<{ names: string[]; failed: boolean }>;
  outline?: (ticker: string, kind: "product" | "geographic", identity: OutlineIdentity) => Promise<unknown>;
  identity?: (ticker: string) => Promise<OutlineIdentity | null>;
  /** N23: FMP-Peers mit Firmennamen für die Fremdmarken-Prüfung der KI-Kinder. */
  peers?: (ticker: string) => Promise<readonly PeerCompany[]>;
  /** P2-N29-2: FMP /search-name pro brand. Status bleibt sichtbar, 429 ist kein leeres Ergebnis. */
  brandSearch?: (query: string) => Promise<{ status: number; ok?: boolean; companies: readonly PeerCompany[] }>;
  now?: () => number;
  rateLimit?: { max: number; windowMs: number };
  /** Optionaler LLM-Aufruf für den Klick auf ein Untersegment oder eine Region. Ohne ihn gilt callLLMJson. */
  llm?: (opts: {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }) => Promise<{ data: unknown; modelUsed?: string } | null>;
}

export interface OutlineIdentity {
  companyName: string;
  exchange: string;
  country: string;
  sector: string;
  industry: string;
  fiscalYear?: string;
  currency?: string;
  /** FMP-Profilbeschreibung. Nur eigenes Vokabular für die Fremdmarken-Prüfung, nicht im Prompt. */
  description?: string;
}

export interface SegmentChildrenScope {
  siblings?: readonly string[];
  businessNames?: readonly string[];
}

export function namesFromDisplayedSources(input: {
  kind: "product" | "geographic";
  ticker: string;
  ownRows: unknown[];
  geoRows: unknown[];
  secCache: { segments?: { name?: string }[] } | null;
}): string[] {
  const names = segmentNamesFromFmpRows(input.ownRows);
  if (input.kind === "geographic") return names;
  if (names.length === 0) {
    for (const name of curatedSegmentNames(input.ticker)) names.push(name);
  }
  if (names.length === 0) {
    for (const segment of input.secCache?.segments ?? []) {
      if (typeof segment?.name === "string" && segment.name.trim()) names.push(segment.name.trim());
    }
  }
  const geo = segmentNamesFromFmpRows(input.geoRows).map((name) => ({ name, revenue: 1 }));
  const business = names.map((name) => ({ name, revenue: 1 }));
  for (const row of promoteNonGeoRowsToBusiness(business, geo)) {
    if (!names.some((name) => name.toLowerCase() === row.name.toLowerCase())) names.push(row.name);
  }
  return names;
}

/**
 * N25: Dieselben Jahreszeilen wie fmpSegmentationRows(kind, ticker, "annual"), aber mit Status.
 * fmpSegmentationRows macht aus 429, 5xx und Netzfehlern still eine leere Liste.
 * Das hier meldet diesen Fall, damit die Route kein „nicht in der Liste“ behauptet.
 * 402/403/404 sind „keine Daten“, kein Ausfall.
 */
async function observedAnnualSegmentationRows(kind: "product" | "geographic", ticker: string): Promise<{ rows: unknown[]; failed: boolean }> {
  const path = kind === "product" ? "/revenue-product-segmentation" : "/revenue-geographic-segmentation";
  const result = await fmpObserved(path, { symbol: ticker });
  if (result.status >= 200 && result.status < 300) {
    const json = result.json as { data?: unknown } | unknown[] | null;
    const rows = Array.isArray(json) ? json : Array.isArray((json as { data?: unknown } | null)?.data) ? (json as { data: unknown[] }).data : [];
    return { rows, failed: false };
  }
  const failed = isFmpAvailable() && (result.status === 0 || result.status === 429 || result.status >= 500);
  return { rows: [], failed };
}

async function defaultDisplayedNamesWithStatus(ticker: string, kind: "product" | "geographic"): Promise<{ names: string[]; failed: boolean }> {
  const own = await observedAnnualSegmentationRows(kind, ticker);
  const geo = kind === "product" ? await observedAnnualSegmentationRows("geographic", ticker) : { rows: [], failed: false };
  // Dieselbe Frist wie der Analyse-Disk-Cache (disk-cache.ts CACHE_TTL_DAYS = 7).
  // diskResearcherGet löscht nach einem Tag und würde die Zeile vor diesem Lesen entfernen.
  const secHit = diskResearcherGetWithTtl(`segments__${ticker.toUpperCase()}`, 7 * 24 * 60 * 60 * 1000);
  const secCache = (secHit?.data ?? null) as { segments?: { name?: string }[] } | null;
  const names = namesFromDisplayedSources({ kind, ticker, ownRows: own.rows, geoRows: geo.rows, secCache });
  return { names, failed: own.failed || geo.failed };
}

async function defaultDisplayedNames(ticker: string, kind: "product" | "geographic"): Promise<string[]> {
  return (await defaultDisplayedNamesWithStatus(ticker, kind)).names;
}

const RAW_SKIP_KEYS = new Set([
  "symbol", "date", "reportedCurrency", "cik", "fillingDate",
  "acceptedDate", "calendarYear", "period", "link", "finalLink",
  "fiscalYear", "data",
]);

function yearPart(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{4}/.test(value)) return Number(value.slice(0, 4));
  return null;
}

function rowFiscalYear(row: Record<string, unknown>): number {
  return yearPart(row.fiscalYear) ?? yearPart(row.calendarYear) ?? yearPart(row.date) ?? 0;
}

function newestMatchingRawKey(
  rawRows: unknown[],
  kind: "product" | "geographic",
  requested: string,
  listed: readonly string[],
): string | null {
  const allowed = new Set(listed.map((name) => name.trim()));
  let bestName: string | null = null;
  let bestYear = -1;
  for (const item of rawRows) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.period === "string" && /^Q[1-4]$/i.test(row.period.trim())) continue;
    const year = rowFiscalYear(row);
    const source = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : row;
    for (const [key, value] of Object.entries(source)) {
      const name = key.trim();
      if (!name || RAW_SKIP_KEYS.has(key) || !allowed.has(name)) continue;
      const numeric = typeof value === "number" ? value : Number(value);
      const nested = !!value && typeof value === "object";
      if (!Number.isFinite(numeric) && !nested) continue;
      if (!sameDisplayedName(kind, name, requested)) continue;
      if (year > bestYear) {
        bestYear = year;
        bestName = name;
      }
    }
  }
  return bestName;
}

function sameDisplayedName(kind: "product" | "geographic", listed: string, requested: string): boolean {
  const fold = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  if (kind === "product") return fold(prettifyProductSegmentName(listed)) === fold(prettifyProductSegmentName(requested));
  return fold(listed) === fold(requested);
}

export function segmentChildrenKiMessages(
  ticker: string,
  parent: string,
  kind: "product" | "geographic",
  siblings: readonly string[],
  peerLine = "PEER-ANKER: n/a — Peer-Umsatz-YoY nicht geladen. Eine Zahl ohne eigene Quelle weglassen.",
  identity?: OutlineIdentity,
): { systemPrompt: string; prompt: string } {
  const blocked = siblings.map((name) => name.trim()).filter((name) => name.length > 0).slice(0, 24).join(", ");
  const siblingLine = blocked ? ` Diese Namen sind Geschwister und keine Kinder: ${blocked}.` : "";
  const identityLine = identity
    ? `Firma: ${identity.companyName}. Börse: ${identity.exchange || "n/a"}. Land: ${identity.country || "n/a"}. Sektor: ${identity.sector || "n/a"}. Branche: ${identity.industry || "n/a"}. Geschäftsjahr: ${identity.fiscalYear || "n/a"}. Währung: ${identity.currency || "n/a"}.`
    : "Geschäftsjahr: n/a. Währung: n/a.";
  const form = `{"companyEcho":"","industryEcho":"","children":[{"name":"","brand":"","brandOwner":null,"owner":"","ownerParent":"","revenue":null,"shareOfParentPct":null,"growthPct":null,"basis":"","source":null}]}`;
  const sourceRule = "owner oder ownerParent nennt die Firma. brand nennt die Firma oder Marke, die im Namen steht, sonst leer. brandOwner nennt die Firma, der diese Marke gehört (bei Tochterfirmen die Muttergesellschaft), sonst null, wenn unklar. Keine Produkte oder Marken einer anderen Firma, auch keine Wettbewerber. Eine Zahl nur, wenn source Firma, Dokumenttyp und Jahr nennt, sonst source null und die Zahl null. Kein Platzhalter als Quelle. Echte 0 bleibt 0. Ein unbekannter Wert ist null, nie 0.";
  if (kind === "geographic") {
    return {
      systemPrompt: "Antworte nur mit JSON. Schätze nur die genannte Firma. Schätze Anteil und Wachstum nur mit Basis und Quelle. Ein unbekannter Anteil ist null, nie 0. Unbekanntes Wachstum ist null, nie 0. Das Label ist KI-Schätzung, nicht Override.",
      prompt: `${peerLine}\n${identityLine}\nTicker ${ticker}. Geografisches Segment "${parent}". Nenne die bekannten Regionen, Länder oder Bundesstaaten innerhalb dieses Gebiets. Keine Geschäftssegmente. Nicht den Namen "${parent}" wiederholen.${siblingLine} Form: ${form}. ${sourceRule} Jedes Kind braucht name, basis und owner. Leeres children nur, wenn keine Unterregion bekannt ist.`,
    };
  }
  return {
    systemPrompt: "Antworte nur mit JSON. Schätze nur die genannte Firma. Schätze Anteil und Wachstum nur mit Basis und Quelle. Bekannte Produktlinien sind erlaubt. Ein unbekannter Anteil ist null, nie 0. Unbekanntes Wachstum ist null, nie 0. Das Label ist KI-Schätzung, nicht Override.",
    prompt: `${peerLine}\n${identityLine}\nTicker ${ticker}. Geschäftssegment "${parent}". Nenne die bekannten Produktlinien nur dieses Segments dieser Firma, nicht die Geschwister und nicht noch einmal "${parent}".${siblingLine} Form: ${form}. Beispiel: {"companyEcho":"${identity?.companyName ?? ""}","industryEcho":"${identity?.industry || identity?.sector || ""}","children":[{"name":"","brand":"","brandOwner":null,"owner":"${identity?.companyName ?? ""}","ownerParent":"","shareOfParentPct":null,"growthPct":null,"basis":"","source":null}]}. ${sourceRule} Jedes Kind braucht name, basis und owner. Leeres children nur, wenn keine Produktlinie bekannt ist.`,
  };
}

async function defaultKiChildren(
  ticker: string,
  parent: string,
  kind: "product" | "geographic" = "product",
  siblings: readonly string[] = [],
  identity?: OutlineIdentity,
): Promise<unknown> {
  if (!isLLMAvailable()) return null;
  try {
    let peerLine = "PEER-ANKER: n/a — Peer-Umsatz-YoY nicht geladen. Eine Zahl ohne eigene Quelle weglassen.";
    try {
      const anchor = await loadPeerGrowthAnchor(ticker);
      if (anchor?.medianRevenueYoyPct != null) {
        peerLine = `PEER-ANKER: Median Umsatz-YoY ${anchor.medianRevenueYoyPct}% (n=${anchor.peerCount}, P25=${anchor.p25RevenueYoyPct}%, P75=${anchor.p75RevenueYoyPct}%). Quelle: ${anchor.source}. Fehlendes Wachstum relativ zu diesem Median schätzen und die Quelle nennen.`;
      }
    } catch {
      // Ohne Anker bleibt die Schätzung an die eigene Quelle gebunden.
    }
    const messages = segmentChildrenKiMessages(ticker, parent, kind, siblings, peerLine, identity);
    const result = await callLLMJson({
      systemPrompt: messages.systemPrompt,
      prompt: messages.prompt,
      maxTokens: 800,
      temperature: 0.2,
      signal: AbortSignal.timeout(SEGMENT_CHILDREN_KI_TIMEOUT_MS),
    });
    return result?.data ?? null;
  } catch {
    return null;
  }
}

function profileText(profile: Record<string, unknown>, key: string): string {
  const value = profile[key];
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  return typeof value === "string" ? value.trim() : "";
}

export interface OutlineIdentityLoad {
  profile?: (ticker: string) => Promise<unknown>;
  income?: (ticker: string) => Promise<unknown>;
  now?: () => number;
}

async function ensureStatementFacts(ticker: string, now: number, load: OutlineIdentityLoad): Promise<{ fiscalYear: string; currency: string }> {
  const hit = statementFacts.get(ticker);
  if (hit && now - hit.at < IDENTITY_TTL_MS) return hit;
  let fiscalYear = "";
  let currency = "";
  try {
    const income = await (load.income ?? ((symbol: string) => fmpIncomeStatement(symbol, 1)))(ticker);
    const row = Array.isArray(income) ? income[0] : null;
    if (row && typeof row === "object") {
      const statement = row as Record<string, unknown>;
      const year = profileText(statement, "fiscalYear") || profileText(statement, "calendarYear") || profileText(statement, "date").slice(0, 4);
      const reported = profileText(statement, "reportedCurrency").toUpperCase();
      if (/^(19|20)\d{2}$/.test(year)) fiscalYear = year;
      if (/^[A-Z]{3}$/.test(reported)) currency = reported;
    }
  } catch {
    // Ohne Abschluss bleiben Jahr und Währung n/a.
  }
  const facts = { at: now, fiscalYear, currency };
  statementFacts.set(ticker, facts);
  return facts;
}

function rememberStatementFacts(ticker: string, income: unknown, now = Date.now()): void {
  const row = Array.isArray(income) ? income[0] : null;
  if (!row || typeof row !== "object") return;
  const statement = row as Record<string, unknown>;
  const year = profileText(statement, "fiscalYear") || profileText(statement, "calendarYear") || profileText(statement, "date").slice(0, 4);
  const reported = profileText(statement, "reportedCurrency").toUpperCase();
  statementFacts.set(ticker.toUpperCase(), {
    at: now,
    fiscalYear: /^(19|20)\d{2}$/.test(year) ? year : "",
    currency: /^[A-Z]{3}$/.test(reported) ? reported : "",
  });
}

export async function loadOutlineIdentity(ticker: string, load: OutlineIdentityLoad = {}): Promise<OutlineIdentity | null> {
  const key = ticker.trim().toUpperCase();
  const now = load.now?.() ?? Date.now();
  const hit = identityCache.get(key);
  if (hit && now - hit.at < IDENTITY_TTL_MS) {
    const facts = await ensureStatementFacts(key, now, load);
    return { ...hit.identity, fiscalYear: facts.fiscalYear, currency: facts.currency };
  }
  try {
    const profile = await (load.profile ?? fmpProfile)(ticker);
    if (!profile || typeof profile !== "object") return null;
    const record = profile as Record<string, unknown>;
    const companyName = profileText(record, "companyName");
    if (companyName.length < 2) return null;
    const identity: OutlineIdentity = {
      companyName,
      exchange: profileText(record, "exchange") || profileText(record, "exchangeShortName"),
      country: profileText(record, "country"),
      sector: profileText(record, "sector"),
      industry: profileText(record, "industry"),
      description: profileText(record, "description"),
    };
    identityCache.set(key, { at: now, identity });
    const facts = await ensureStatementFacts(key, now, load);
    return { ...identity, fiscalYear: facts.fiscalYear, currency: facts.currency };
  } catch {
    return null;
  }
}

async function defaultOutline(ticker: string, kind: "product" | "geographic", identity: OutlineIdentity): Promise<unknown> {
  if (!isLLMAvailable()) return null;
  let peerLine = "PEER-ANKER: n/a — Peer-Umsatz-YoY nicht geladen. Eine Zahl ohne eigene Quelle weglassen.";
  try {
    const anchor = await loadPeerGrowthAnchor(ticker);
    if (anchor?.medianRevenueYoyPct != null) {
      peerLine = `PEER-ANKER: Median Umsatz-YoY ${anchor.medianRevenueYoyPct}% (n=${anchor.peerCount}, P25=${anchor.p25RevenueYoyPct}%, P75=${anchor.p75RevenueYoyPct}%). Quelle: ${anchor.source}.`;
    }
  } catch {
    // Ohne Anker bleibt jede Zahl an die eigene Quelle gebunden.
  }
  const subject = kind === "geographic"
    ? "Schätze die geografischen Umsatzregionen."
    : "Schätze die Geschäftssegmente oder Produktgruppen.";
  try {
    const result = await callLLMJson({
      systemPrompt: "Antworte nur mit JSON. Schätze nur die genannte Firma. companyEcho muss den Firmennamen enthalten, industryEcho die Branche. Zahlen nur mit Dokumenttyp und Periode, sonst null. Echte 0 bleibt 0. Das Label ist KI-Schätzung, nicht FMP und nicht Override.",
      prompt: `${peerLine}\nFirma: ${identity.companyName}. Börse: ${identity.exchange || "n/a"}. Land: ${identity.country || "n/a"}. Sektor: ${identity.sector || "n/a"}. Branche: ${identity.industry || "n/a"}. Geschäftsjahr: ${identity.fiscalYear || "n/a"}. Währung: ${identity.currency || "n/a"}. Ticker ${ticker}. ${subject} Nenne drei bis sechs Namen dieser Firma, nicht einer anderen. brand nennt die Firma oder Marke, die im Namen steht, sonst leer. brandOwner nennt die Firma, der diese Marke gehört (bei Tochterfirmen die Muttergesellschaft), sonst null, wenn unklar. Keine Produkte oder Marken einer anderen Firma, auch keine Wettbewerber. Eine Zahl nur, wenn source Firma, Dokumenttyp und Jahr nennt, sonst source null und die Zahl null. Kein Platzhalter als Quelle. Die Summe der Anteile darf 100 nicht übersteigen. Beispiel: {"companyEcho":"${identity.companyName}","industryEcho":"${identity.industry || identity.sector || ""}","children":[{"name":"","brand":"","brandOwner":null,"owner":"${identity.companyName}","ownerParent":"","shareOfParentPct":null,"growthPct":null,"basis":"","source":null}]}. Echte 0 bleibt 0.`,
      maxTokens: 800,
      temperature: 0.2,
      signal: AbortSignal.timeout(SEGMENT_CHILDREN_KI_TIMEOUT_MS),
    });
    return result?.data ?? null;
  } catch {
    return null;
  }
}

export function defaultSegmentChildrenDeps(): SegmentChildrenDeps {
  return {
    fmpAvailable: isFmpAvailable,
    raw: (kind, ticker) => fmpSegmentationRows(kind, ticker, "annual"),
    names: defaultDisplayedNames,
    namesStatus: defaultDisplayedNamesWithStatus,
    ki: defaultKiChildren,
    outline: defaultOutline,
    identity: loadOutlineIdentity,
    peers: fmpPeerCompanies,
    brandSearch: fmpSearchCompanyName,
  };
}

async function resolveBrandNameSearch(
  queries: readonly string[],
  deps: SegmentChildrenDeps,
  now: number,
): Promise<{ rows: { brand: string; ok: boolean; companies: readonly PeerCompany[] }[]; degraded: boolean }> {
  if (!deps.brandSearch || !deps.fmpAvailable() || queries.length === 0) return { rows: [], degraded: false };
  const rows: { brand: string; ok: boolean; companies: readonly PeerCompany[] }[] = [];
  let degraded = false;
  for (const brand of queries) {
    const key = brandSearchKey(brand);
    const cached = brandSearchCache.get(key);
    if (cached && now - cached.at < CHILDREN_CACHE_MS) {
      rows.push({ brand, ok: true, companies: cached.companies });
      continue;
    }
    let outcome: { status: number; ok?: boolean; companies: readonly PeerCompany[] };
    try {
      outcome = await deps.brandSearch(brand);
    } catch {
      outcome = { status: 0, ok: false, companies: [] };
    }
    if (outcome.ok !== false && outcome.status >= 200 && outcome.status < 300) {
      const companies = Array.isArray(outcome.companies) ? outcome.companies : [];
      if (brandSearchCache.size >= CHILDREN_CACHE_MAX) {
        let oldestKey: string | null = null;
        let oldestAt = Number.POSITIVE_INFINITY;
        brandSearchCache.forEach((entry, entryKey) => {
          if (entry.at < oldestAt) {
            oldestAt = entry.at;
            oldestKey = entryKey;
          }
        });
        if (oldestKey) brandSearchCache.delete(oldestKey);
      }
      brandSearchCache.set(key, { at: now, companies });
      rows.push({ brand, ok: true, companies });
    } else {
      degraded = true;
      rows.push({ brand, ok: false, companies: [] });
    }
  }
  return { rows, degraded };
}

export async function loadSegmentChildren(
  ticker: string,
  parent: string,
  kind: "product" | "geographic",
  deps: SegmentChildrenDeps = defaultSegmentChildrenDeps(),
  scope: SegmentChildrenScope = {},
  now = Date.now(),
): Promise<SegmentChildrenResult & { brandSearchDegraded?: boolean }> {
  const label = parent.trim();
  let raw: unknown[] = [];
  if (deps.fmpAvailable()) {
    try {
      const rows = await deps.raw(kind, ticker);
      raw = Array.isArray(rows) ? rows : [];
    } catch {
      raw = [];
    }
  }
  const fmp = childrenFromFmpRows(raw, label);
  if (fmp.length > 0) return resolveSegmentChildren(label, fmp, []);
  let identity: OutlineIdentity | null = null;
  if (deps.identity) {
    try {
      identity = await deps.identity(ticker);
    } catch {
      identity = null;
    }
    if (!identity?.companyName) return { parent: label, children: [], reason: OUTLINE_NO_IDENTITY };
  }
  let kiPayload: unknown = null;
  try {
    kiPayload = await deps.ki(ticker, label, kind, scope.siblings ?? [], identity ?? undefined);
  } catch {
    kiPayload = null;
  }
  if (kiPayload == null) return { parent: label, children: [], reason: KI_UNAVAILABLE };
  if (identity && !outlineEchoMatches(kiPayload, identity.companyName, identity.industry, identity.sector)) {
    return { parent: label, children: [], reason: OUTLINE_MISMATCH };
  }
  let peerCompanies: readonly PeerCompany[] = [];
  if (identity && deps.peers && deps.fmpAvailable()) {
    try {
      const rows = await deps.peers(ticker);
      peerCompanies = Array.isArray(rows) ? rows : [];
    } catch {
      peerCompanies = [];
    }
  }
  const queries = identity?.companyName
    ? ownClaimBrandQueries(kiPayload, label, {
      companyName: identity.companyName,
      ticker,
      description: identity.description,
      siblings: scope.siblings,
      peerCompanies,
    })
    : [];
  const searched = await resolveBrandNameSearch(queries, deps, now);
  return {
    ...reviewKiChildren(label, kiPayload, reportedParentRevenue(raw, label), {
      kind,
      siblings: scope.siblings,
      businessNames: scope.businessNames,
      companyName: identity?.companyName,
      ticker,
      description: identity?.description,
      peerCompanies,
      brandNameSearch: searched.rows,
    }),
    ...(searched.degraded ? { brandSearchDegraded: true } : {}),
  };
}

function clipText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function yearOf(value: unknown): string | null {
  const raw = typeof value === "number" && Number.isInteger(value) ? String(value) : value;
  if (typeof raw !== "string") return null;
  const match = raw.match(/(?:19|20)\d{2}/);
  return match ? match[0] : null;
}

function moneyOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e15 ? value : null;
}

function currencyOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

interface NamedAmount {
  name: string;
  revenue: number | null;
  growth: number | null;
}

function namedAmounts(value: unknown, max: number): NamedAmount[] {
  if (!Array.isArray(value)) return [];
  const out: NamedAmount[] = [];
  for (const row of value) {
    if (out.length >= max) break;
    if (!row || typeof row !== "object") continue;
    const rec = row as { name?: unknown; revenue?: unknown; growth?: unknown };
    const name = clipText(rec.name, 80);
    if (!name) continue;
    const growth = typeof rec.growth === "number" && Number.isFinite(rec.growth) ? rec.growth : null;
    out.push({ name, revenue: moneyOrNull(rec.revenue), growth });
  }
  return out;
}

export interface ChildRefillInput {
  parent: string;
  kind: "product" | "geographic";
  child: string;
  knownChildren: string[];
  parentRevenue: number | null;
  parentYoy: number | null;
  fiscalYear: string | null;
  currency: string | null;
  regions: NamedAmount[];
}

export function readChildRefill(body: unknown): ChildRefillInput | null {
  const b = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const parent = clipText(b.parent, 120);
  const child = clipText(b.child, 80);
  const kind = b.kind === "geographic" ? "geographic" : b.kind === "product" ? "product" : null;
  if (!parent || !child || !kind) return null;
  const knownChildren: string[] = [];
  if (Array.isArray(b.knownChildren)) {
    for (const name of b.knownChildren) {
      if (knownChildren.length >= 24) break;
      const clean = clipText(name, 80);
      if (clean) knownChildren.push(clean);
    }
  }
  const yoy = typeof b.parentYoy === "number" && Number.isFinite(b.parentYoy) ? b.parentYoy : null;
  return {
    parent,
    kind,
    child,
    knownChildren,
    parentRevenue: moneyOrNull(b.parentRevenue),
    parentYoy: yoy,
    fiscalYear: yearOf(b.fiscalYear),
    currency: currencyOrNull(b.currency),
    regions: namedAmounts(b.regions, 24),
  };
}

export function childRefillPrompt(ticker: string, input: ChildRefillInput): string {
  const children = input.knownChildren.join(", ") || "n/a";
  const regions = input.regions.length > 0
    ? input.regions.map((row) => `${row.name}: Umsatz ${row.revenue ?? "n/a"}, YoY ${row.growth ?? "n/a"}`).join("; ")
    : "n/a";
  return [
    "BEKANNTE FAKTEN. Diese Zahlen nicht ersetzen. Nur die genannte Lücke füllen.",
    `Ticker ${ticker}. Elternsegment: ${input.parent}.`,
    `Umsatz des Elternsegments: ${input.parentRevenue ?? "n/a"}. YoY des Elternsegments: ${input.parentYoy ?? "n/a"}.`,
    `Geschäftsjahr: ${input.fiscalYear ?? "n/a"}. Währung: ${input.currency ?? "n/a"}.`,
    `Regionen: ${regions}.`,
    `Bekannte Untersegmente: ${children}.`,
    `Schätze nur "${input.child}": shareOfParentPct und growthPct. Eine Zahl nur mit Quelle, sonst null.`,
    `Antwortform: {"companyEcho":"","industryEcho":"","children":[{"name":"${input.child}","owner":"","shareOfParentPct":null,"growthPct":null,"basis":"Begründung","source":null}]}.`,
  ].join("\n");
}

interface RegionGapRow extends NamedAmount {
  share: number | null;
}

function regionRows(value: unknown): RegionGapRow[] {
  if (!Array.isArray(value)) return [];
  const out: RegionGapRow[] = [];
  for (const row of value) {
    if (out.length >= 24) break;
    if (!row || typeof row !== "object") continue;
    const rec = row as { name?: unknown; revenue?: unknown; share?: unknown; growth?: unknown };
    const name = clipText(rec.name, 80);
    if (!name) continue;
    const share = typeof rec.share === "number" && Number.isFinite(rec.share) ? rec.share : null;
    const growth = typeof rec.growth === "number" && Number.isFinite(rec.growth) ? rec.growth : null;
    out.push({ name, revenue: moneyOrNull(rec.revenue), share, growth });
  }
  return out;
}

export function regionGapPrompt(ticker: string, companyName: string, rows: RegionGapRow[], context: unknown): string {
  const b = context && typeof context === "object" ? context as Record<string, unknown> : {};
  const segments = namedAmounts(b.segments, 24);
  const segmentLine = segments.length > 0
    ? segments.map((row) => `${row.name}: Umsatz ${row.revenue ?? "n/a"}, YoY ${row.growth ?? "n/a"}`).join("; ")
    : "n/a";
  const regionLine = rows.map((row) => `${row.name}: Umsatz ${row.revenue ?? "n/a"}, Anteil ${row.share ?? "n/a"}, YoY ${row.growth ?? "n/a"}`).join("; ");
  return [
    "BEKANNTE FAKTEN. Diese Zahlen nicht ersetzen. Nur Regionen mit YoY n/a schätzen.",
    `Ticker ${ticker}. Firma: ${companyName}.`,
    `Geschäftsjahr: ${yearOf(b.fiscalYear) ?? "n/a"}. Währung: ${currencyOrNull(b.currency) ?? "n/a"}. Gesamtumsatz: ${moneyOrNull(b.totalRevenue) ?? "n/a"}.`,
    `Geschäftssegmente: ${segmentLine}.`,
    `Bekannte Regionen: ${regionLine}.`,
    `Eine Zeile mit einer YoY-Zahl bleibt unverändert und kommt nicht in children.`,
    `Antwortform: {"companyEcho":"${companyName}","industryEcho":"","children":[{"name":"","owner":"${companyName}","shareOfParentPct":null,"growthPct":null,"basis":"Begründung der Lücke","source":null}]}.`,
  ].join("\n");
}

export function registerSegmentGrowthRoute(app: Express, childrenDeps?: SegmentChildrenDeps): void {
  app.get("/api/segment-growth/:ticker", async (req: Request, res: Response) => {
    const raw = req.params.ticker;
    const ticker = (Array.isArray(raw) ? raw[0] : raw) ?? "";
    if (!TICKER_RE.test(ticker)) {
      return res.status(400).json({ error: "ticker fehlt oder ist ungültig" });
    }
    if (!isFmpAvailable()) {
      return res.status(503).json({
        error: "FMP_API_KEY fehlt",
        ticker: ticker.toUpperCase(),
        business: [],
        geographic: [],
        source: "n/a — FMP_API_KEY fehlt",
        currency: null,
      });
    }
    try {
      const body = await loadSegmentGrowth(ticker);
      return res.json(body);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Segment-Wachstum fehlgeschlagen";
      return res.status(502).json({ error: message.slice(0, 200) });
    }
  });

  app.get(`${SEGMENT_CHILDREN_ROUTE}/:ticker`, async (req: Request, res: Response) => {
    const raw = req.params.ticker;
    const ticker = (Array.isArray(raw) ? raw[0] : raw) ?? "";
    const parent = typeof req.query.parent === "string" ? req.query.parent.trim() : "";
    const kind = req.query.kind === "geographic" ? "geographic" : req.query.kind === "product" ? "product" : null;
    if (!TICKER_RE.test(ticker) || !parent || parent.length > 120 || !kind) {
      return res.status(400).json({ error: "ticker, parent oder kind fehlt" });
    }
    const deps = childrenDeps ?? defaultSegmentChildrenDeps();
    const now = deps.now?.() ?? Date.now();
    const limit = deps.rateLimit ?? { max: DEFAULT_RATE_MAX, windowMs: DEFAULT_RATE_WINDOW_MS };
    const cacheKey = segmentChildrenCacheKey(ticker, kind, parent);
    const expired: string[] = [];
    childCache.forEach((entry, key) => {
      if (now - entry.at >= entry.ttl) expired.push(key);
    });
    for (let i = 0; i < expired.length; i++) childCache.delete(expired[i]);
    const hit = childCache.get(cacheKey);
    if (hit && now - hit.at < hit.ttl) return res.json(withSegmentChildrenPromptVersion(hit.body));
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!takeSegmentChildrenSlot(ip, now, limit.max, limit.windowMs)) {
      return res.status(429).json({ error: "Zu viele Abfragen" });
    }
    if (rateBuckets.size > 2000) {
      const stale: string[] = [];
      rateBuckets.forEach((stamps, key) => {
        const fresh = stamps.filter((at) => now - at < limit.windowMs);
        if (fresh.length === 0) stale.push(key);
        else rateBuckets.set(key, fresh);
      });
      for (let i = 0; i < stale.length; i++) rateBuckets.delete(stale[i]);
    }
    try {
      const rawRows = deps.fmpAvailable() ? await deps.raw(kind, ticker) : [];
      const rows = Array.isArray(rawRows) ? rawRows : [];
      let listed: string[];
      let listFailed = false;
      if (deps.namesStatus) {
        const status = await deps.namesStatus(ticker, kind);
        listed = status.names;
        listFailed = status.failed;
      } else {
        listed = deps.names
          ? await deps.names(ticker, kind)
          : segmentNamesFromFmpRows(rows);
      }
      const hit = listed.find((name) => sameDisplayedName(kind, name, parent)) ?? null;
      const remembered = rememberedOutlineName(ticker, kind, parent, now);
      if (!hit && !remembered) {
        // N25: Ausgefallene FMP-Liste ist kein Beleg, dass das Segment fehlt. Nicht gecacht.
        if (listFailed) {
          res.set("Retry-After", String(Math.ceil(CHILDREN_ERROR_CACHE_MS / 1000)));
          return res.status(503).json({ error: SEGMENT_LIST_UNAVAILABLE });
        }
        return res.status(400).json({ error: SEGMENT_UNKNOWN });
      }
      const fromNewestYear = hit ? newestMatchingRawKey(rows, kind, parent, listed) : null;
      const canonical = fromNewestYear ?? hit ?? remembered!;
      const siblings = listed.filter((name) => !sameDisplayedName(kind, name, canonical));
      let businessNames: string[] = [];
      if (kind === "geographic" && deps.fmpAvailable()) {
        try {
          if (deps.names) {
            businessNames = await deps.names(ticker, "product");
          } else {
            const productRows = await deps.raw("product", ticker);
            businessNames = segmentNamesFromFmpRows(Array.isArray(productRows) ? productRows : []);
          }
        } catch {
          businessNames = [];
        }
      }
      const loaded = await loadSegmentChildren(ticker, canonical, kind, deps, { siblings, businessNames }, now);
      const body: SegmentChildrenResult = { parent: loaded.parent, children: loaded.children, reason: loaded.reason };
      const shortCache = body.children.length === 0 || loaded.brandSearchDegraded === true;
      const ttl = shortCache ? CHILDREN_ERROR_CACHE_MS : CHILDREN_CACHE_MS;
      if (childCache.size >= CHILDREN_CACHE_MAX) {
        let oldestKey: string | null = null;
        let oldestAt = Number.POSITIVE_INFINITY;
        childCache.forEach((entry, key) => {
          if (entry.at < oldestAt) {
            oldestAt = entry.at;
            oldestKey = key;
          }
        });
        if (oldestKey) childCache.delete(oldestKey);
      }
      childCache.set(cacheKey, { at: now, body, ttl });
      return res.json(withSegmentChildrenPromptVersion(body));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Untersegmente fehlgeschlagen";
      return res.status(502).json({ error: message.slice(0, 200) });
    }
  });

  app.post(`${SEGMENT_CHILDREN_ROUTE}/:ticker`, async (req: Request, res: Response) => {
    const raw = req.params.ticker;
    const ticker = (Array.isArray(raw) ? raw[0] : raw) ?? "";
    const input = readChildRefill(req.body);
    if (!TICKER_RE.test(ticker) || !input) {
      return res.status(400).json({ error: "ticker, parent, kind oder child fehlt" });
    }
    const deps = childrenDeps ?? defaultSegmentChildrenDeps();
    const now = deps.now?.() ?? Date.now();
    const limit = deps.rateLimit ?? { max: DEFAULT_RATE_MAX, windowMs: DEFAULT_RATE_WINDOW_MS };
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!takeSegmentChildrenSlot(ip, now, limit.max, limit.windowMs)) {
      return res.status(429).json({ error: "Zu viele Abfragen" });
    }
    try {
      let identity: OutlineIdentity | null = null;
      if (deps.identity) {
        try { identity = await deps.identity(ticker); } catch { identity = null; }
      }
      const run = deps.llm ?? callLLMJson;
      let payload: unknown = null;
      try {
        const result = await run({
          systemPrompt: "Antworte nur mit JSON. Schätze nur das genannte Untersegment dieser Firma. Eine Zahl nur mit Quelle. Das Label ist KI-Schätzung.",
          prompt: childRefillPrompt(ticker, input),
          maxTokens: 600,
          temperature: 0.2,
          signal: AbortSignal.timeout(SEGMENT_CHILDREN_KI_TIMEOUT_MS),
        });
        payload = result?.data ?? null;
      } catch {
        payload = null;
      }
      if (payload == null) return res.status(503).json({ error: KI_UNAVAILABLE });
      const reviewed = reviewKiChildren(input.parent, payload, input.parentRevenue, {
        kind: input.kind,
        siblings: input.knownChildren.filter((name) => name.toLowerCase() !== input.child.toLowerCase()),
        companyName: identity?.companyName,
        ticker,
        description: identity?.description,
      });
      const match = reviewed.children.find((row) => row.name.toLowerCase() === input.child.toLowerCase());
      if (!match || (match.shareOfParentPct == null && match.growthPct == null)) {
        return res.status(422).json({ error: reviewed.reason || "n/a — KI-Schätzung ohne Beleg" });
      }
      return res.json({ child: match, reason: reviewed.reason });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Untersegment-Schätzung fehlgeschlagen";
      return res.status(502).json({ error: message.slice(0, 200) });
    }
  });

  app.post("/api/segment-outline", async (req: Request, res: Response) => {
    const ticker = typeof req.body?.ticker === "string" ? req.body.ticker.trim() : "";
    const kind = req.body?.kind === "geographic" ? "geographic" : req.body?.kind === "product" ? "product" : null;
    if (!TICKER_RE.test(ticker) || !kind) {
      return res.status(400).json({ error: "ticker oder kind fehlt" });
    }
    const deps = childrenDeps ?? defaultSegmentChildrenDeps();
    const now = deps.now?.() ?? Date.now();
    const limit = deps.rateLimit ?? { max: DEFAULT_RATE_MAX, windowMs: DEFAULT_RATE_WINDOW_MS };
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!takeSegmentChildrenSlot(ip, now, limit.max, limit.windowMs)) {
      return res.status(429).json({ error: "Zu viele Abfragen" });
    }
    try {
      const identity = deps.identity ? await deps.identity(ticker) : await loadOutlineIdentity(ticker);
      if (!identity?.companyName) return res.json({ items: [], reason: OUTLINE_NO_IDENTITY });
      const knownRegions = kind === "geographic" ? regionRows(req.body?.rows) : [];
      if (knownRegions.length > 0) {
        const gaps = knownRegions.filter((row) => row.growth == null);
        if (gaps.length === 0) return res.json({ items: [], reason: "Keine N/A-Zellen" });
        const run = deps.llm ?? callLLMJson;
        let payload: unknown = null;
        try {
          const result = await run({
            systemPrompt: "Antworte nur mit JSON. Schätze nur fehlendes Regionenwachstum der genannten Firma. Eine bekannte YoY-Zahl bleibt. Das Label ist KI-Schätzung.",
            prompt: regionGapPrompt(ticker, identity.companyName, knownRegions, req.body?.context),
            maxTokens: 800,
            temperature: 0.2,
            signal: AbortSignal.timeout(SEGMENT_CHILDREN_KI_TIMEOUT_MS),
          });
          payload = result?.data ?? null;
        } catch {
          payload = null;
        }
        if (payload == null) return res.status(503).json({ error: KI_UNAVAILABLE });
        if (!outlineEchoMatches(payload, identity.companyName, identity.industry, identity.sector)) {
          return res.json({ items: [], reason: OUTLINE_MISMATCH });
        }
        const reviewed = reviewSegmentOutline(payload, identity.companyName, {
          ticker,
          description: identity.description,
        });
        const wanted = new Set(gaps.map((row) => row.name.toLowerCase()));
        return res.json({ ...reviewed, items: reviewed.items.filter((item) => wanted.has(item.name.toLowerCase())) });
      }
      const payload = deps.outline
        ? await deps.outline(ticker, kind, identity)
        : await defaultOutline(ticker, kind, identity);
      if (process.env.SEGMENT_OUTLINE_DEBUG === "1") {
        const rawJson = JSON.stringify(payload ?? null);
        console.log(`[OUTLINE-RAW] ${ticker} ${kind} ${rawJson.slice(0, 2000)}`);
      }
      if (payload == null) return res.status(503).json({ error: KI_UNAVAILABLE });
      if (!outlineEchoMatches(payload, identity.companyName, identity.industry, identity.sector)) {
        return res.json({ items: [], reason: OUTLINE_MISMATCH });
      }
      let peerCompanies: readonly PeerCompany[] = [];
      if (deps.peers && deps.fmpAvailable()) {
        try {
          const rows = await deps.peers(ticker);
          peerCompanies = Array.isArray(rows) ? rows : [];
        } catch {
          peerCompanies = [];
        }
      }
      const queries = ownClaimBrandQueries(payload, "", {
        companyName: identity.companyName,
        ticker,
        description: identity.description,
        peerCompanies,
      });
      const searched = await resolveBrandNameSearch(queries, deps, now);
      const reviewed = reviewSegmentOutline(payload, identity.companyName, {
        ticker,
        description: identity.description,
        peerCompanies,
        brandNameSearch: searched.rows,
      });
      if (reviewed.items.length > 0) rememberOutlineNames(ticker, kind, reviewed.items.map((item) => item.name), now);
      return res.json(reviewed);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Segment-Schätzung fehlgeschlagen";
      return res.status(502).json({ error: message.slice(0, 200) });
    }
  });
}
