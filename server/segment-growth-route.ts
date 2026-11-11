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
  roundGrowthPct,
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
/** N29: Prompt-Version im Schlüssel der KI-Kinder; alte 24-h-Antworten ohne brandOwner werden nicht mehr gezeigt. */
export const SEGMENT_CHILDREN_PROMPT_VERSION = "n31-facts";

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

export interface SegmentFactRow {
  name: string;
  revenue: number;
  revenueOrigin: "FMP" | "SEC" | "Yahoo";
  yoy: number | null;
  yoyOrigin: "FMP" | "BERECHNET" | "Yahoo" | "n/a";
}

export interface SegmentEstimateFacts {
  profile: string;
  fiscalYear: string;
  currency: string;
  totalRevenue: number | null;
  business: SegmentFactRow[];
  regions: SegmentFactRow[];
}

export type SegmentLlm = (opts: {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}) => Promise<{ data: unknown; modelUsed: string } | null>;

export interface SegmentChildrenDeps {
  fmpAvailable: () => boolean;
  raw: (kind: "product" | "geographic", ticker: string) => Promise<unknown[]>;
  ki: (
    ticker: string,
    parent: string,
    kind: "product" | "geographic",
    siblings: readonly string[],
    identity?: OutlineIdentity,
    facts?: SegmentEstimateFacts,
    llm?: SegmentLlm,
  ) => Promise<unknown>;
  names?: (ticker: string, kind: "product" | "geographic") => Promise<string[]>;
  /** N25: wie names, meldet zusätzlich, ob der FMP-Abruf der Liste fehlgeschlagen ist (429, 5xx, Netz). */
  namesStatus?: (ticker: string, kind: "product" | "geographic") => Promise<{ names: string[]; failed: boolean }>;
  outline?: (
    ticker: string,
    kind: "product" | "geographic",
    identity: OutlineIdentity,
    facts?: SegmentEstimateFacts,
    llm?: SegmentLlm,
  ) => Promise<unknown>;
  identity?: (ticker: string) => Promise<OutlineIdentity | null>;
  /** N23: FMP-Peers mit Firmennamen für die Fremdmarken-Prüfung der KI-Kinder. */
  peers?: (ticker: string) => Promise<readonly PeerCompany[]>;
  /** Abschluss für Gesamtumsatz, Geschäftsjahr und Währung. Ohne Funktion bleibt der FMP-Abschluss. */
  income?: (ticker: string) => Promise<unknown>;
  /** SEC-Segmente, wenn FMP keine Geschäftssegmente hat. */
  secSegments?: (ticker: string) => Promise<readonly { name?: string; revenue?: number; prevRevenue?: number | null }[] | null>;
  /** OpenRouter. Ohne Funktion bleibt callLLMJson. */
  llm?: SegmentLlm;
  now?: () => number;
  rateLimit?: { max: number; windowMs: number };
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

function factNameKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function finiteRevenue(value: unknown): number | null {
  const revenue = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(revenue) && revenue > 0 ? revenue : null;
}

function factRowsFromSnapshots(rows: unknown[] | undefined): SegmentFactRow[] {
  const snapshots = snapshotsFromFmpRows(rows ?? []);
  const current = snapshots[0];
  if (!current) return [];
  const prior = new Map<string, number>();
  for (const row of snapshots[1]?.rows ?? []) prior.set(factNameKey(row.name), row.revenue);
  const notes = new Map<string, SegmentGrowthAnnotation>();
  for (const note of annotateMissingSegmentGrowth({ annual: snapshots })) {
    notes.set(factNameKey(note.name), note);
  }
  return current.rows.map((row) => {
    const previous = prior.get(factNameKey(row.name));
    const direct = previous == null ? null : roundGrowthPct(row.revenue, previous);
    if (direct != null) {
      return { name: row.name, revenue: row.revenue, revenueOrigin: "FMP" as const, yoy: direct, yoyOrigin: "FMP" as const };
    }
    const note = notes.get(factNameKey(row.name));
    const calculated = note?.basis === "berechnet" && typeof note.growth === "number" ? note.growth : null;
    return {
      name: row.name,
      revenue: row.revenue,
      revenueOrigin: "FMP" as const,
      yoy: calculated,
      yoyOrigin: calculated == null ? "n/a" as const : "BERECHNET" as const,
    };
  });
}

function secFactRows(segments: readonly { name?: string; revenue?: number; prevRevenue?: number | null }[] | undefined): SegmentFactRow[] {
  const out: SegmentFactRow[] = [];
  for (const segment of segments ?? []) {
    const name = typeof segment?.name === "string" ? segment.name.trim() : "";
    const revenue = finiteRevenue(segment?.revenue);
    if (!name || revenue == null) continue;
    const previous = finiteRevenue(segment.prevRevenue);
    const yoy = previous == null ? null : roundGrowthPct(revenue, previous);
    out.push({
      name,
      revenue,
      revenueOrigin: "SEC",
      yoy,
      yoyOrigin: yoy == null ? "n/a" : "BERECHNET",
    });
  }
  return out;
}

function incomeFact(income: unknown): { fiscalYear: string; currency: string; totalRevenue: number | null } {
  const row = Array.isArray(income) ? income[0] : null;
  if (!row || typeof row !== "object") return { fiscalYear: "", currency: "", totalRevenue: null };
  const record = row as Record<string, unknown>;
  const year = String(record.fiscalYear ?? record.calendarYear ?? (typeof record.date === "string" ? record.date.slice(0, 4) : ""));
  const currency = typeof record.reportedCurrency === "string" ? record.reportedCurrency.trim().toUpperCase() : "";
  return {
    fiscalYear: /^(19|20)\d{2}$/.test(year) ? year : "",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "",
    totalRevenue: finiteRevenue(record.revenue),
  };
}

export function factsFromSegmentation(input: {
  profile?: string;
  fiscalYear?: string;
  currency?: string;
  income?: unknown;
  productRows?: unknown[];
  geoRows?: unknown[];
  secSegments?: readonly { name?: string; revenue?: number; prevRevenue?: number | null }[];
}): SegmentEstimateFacts {
  const fromIncome = incomeFact(input.income);
  const business = factRowsFromSnapshots(input.productRows);
  return {
    profile: (input.profile ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
    fiscalYear: input.fiscalYear || fromIncome.fiscalYear,
    currency: input.currency || fromIncome.currency,
    totalRevenue: fromIncome.totalRevenue,
    business: business.length > 0 ? business : secFactRows(input.secSegments),
    regions: factRowsFromSnapshots(input.geoRows),
  };
}

function yahooFactRows(rows: unknown): SegmentFactRow[] {
  if (!Array.isArray(rows)) return [];
  const out: SegmentFactRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { name?: unknown; revenue?: unknown; growth?: unknown };
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const revenue = typeof rec.revenue === "number" && Number.isFinite(rec.revenue) && rec.revenue > 0 ? rec.revenue : null;
    if (!name || revenue == null) continue;
    const growth = typeof rec.growth === "number" && Number.isFinite(rec.growth) ? rec.growth : null;
    out.push({
      name,
      revenue,
      revenueOrigin: "Yahoo",
      yoy: growth,
      yoyOrigin: growth == null ? "n/a" : "Yahoo",
    });
  }
  return out;
}

function textField(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Yahoo-Zahlen füllen nur, was FMP und SEC nicht geliefert haben. */
export function mergeYahooFacts(facts: SegmentEstimateFacts, yahoo: unknown): SegmentEstimateFacts {
  if (!yahoo || typeof yahoo !== "object") return facts;
  const rec = yahoo as {
    description?: unknown;
    currency?: unknown;
    fiscalYear?: unknown;
    totalRevenue?: unknown;
    segments?: unknown;
    regions?: unknown;
  };
  const total = typeof rec.totalRevenue === "number" && Number.isFinite(rec.totalRevenue) ? rec.totalRevenue : null;
  return {
    profile: facts.profile || textField(rec.description, 600),
    fiscalYear: facts.fiscalYear || textField(rec.fiscalYear, 12),
    currency: facts.currency || textField(rec.currency, 8),
    totalRevenue: facts.totalRevenue ?? total,
    business: facts.business.length > 0 ? facts.business : yahooFactRows(rec.segments),
    regions: facts.regions.length > 0 ? facts.regions : yahooFactRows(rec.regions),
  };
}

interface KnownRegionRow {
  name: string;
  revenue: number | null;
  share: number | null;
  growth: number | null;
}

function knownRegionRows(value: unknown): KnownRegionRow[] {
  if (!Array.isArray(value)) return [];
  const out: KnownRegionRow[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { name?: unknown; revenue?: unknown; share?: unknown; growth?: unknown };
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    out.push({ name, revenue: num(rec.revenue), share: num(rec.share), growth: num(rec.growth) });
  }
  return out;
}

function regionFillPrompt(facts: SegmentEstimateFacts, rows: KnownRegionRow[], identity: OutlineIdentity, ticker: string): string {
  const lines = rows.map((row) => `${row.name}: Umsatz ${row.revenue ?? "n/a"}, Anteil ${row.share ?? "n/a"}, YoY ${row.growth ?? "n/a"}`).join("; ");
  return `${segmentFactBlock(facts)}
Bekannte Regionen: ${lines}.
Firma: ${identity.companyName}. Ticker ${ticker}. Branche: ${identity.industry || identity.sector || "n/a"}.
Schätze nur Zeilen mit YoY n/a. Eine Zeile mit einer YoY-Zahl bleibt unverändert und kommt nicht in children.
Antwortform: {"companyEcho":"${identity.companyName}","industryEcho":"${identity.industry || identity.sector || ""}","children":[{"name":"","owner":"${identity.companyName}","shareOfParentPct":null,"growthPct":null,"basis":"Begründung der Lücke","source":null}]}.
basis nennt die Lücke und darf nicht leer sein. Eine Zahl nur mit Quelle, sonst null.`;
}

export function segmentFactBlock(facts: SegmentEstimateFacts): string {
  const line = (row: SegmentFactRow) => {
    const yoy = row.yoy == null ? "n/a" : `${row.yoy} (${row.yoyOrigin})`;
    return `${row.name}: Umsatz ${row.revenue} (${row.revenueOrigin}), YoY ${yoy}`;
  };
  const list = (rows: SegmentFactRow[]) => (rows.length > 0 ? rows.map(line).join("; ") : "n/a");
  return [
    "BEKANNTE FAKTEN. Diese Zahlen nicht ersetzen. Nur Lücken füllen.",
    `Firmenprofil: ${facts.profile || "n/a"}`,
    `Geschäftsjahr: ${facts.fiscalYear || "n/a"}. Währung: ${facts.currency || "n/a"}. Gesamtumsatz: ${facts.totalRevenue ?? "n/a"}.`,
    `Geschäftssegmente: ${list(facts.business)}.`,
    `Regionen: ${list(facts.regions)}.`,
  ].join("\n");
}

async function resolveSegmentFacts(
  ticker: string,
  identity: OutlineIdentity | null,
  deps: SegmentChildrenDeps,
): Promise<SegmentEstimateFacts> {
  let productRows: unknown[] = [];
  let geoRows: unknown[] = [];
  if (deps.fmpAvailable()) {
    try {
      const [product, geo] = await Promise.all([
        deps.raw("product", ticker),
        deps.raw("geographic", ticker),
      ]);
      productRows = Array.isArray(product) ? product : [];
      geoRows = Array.isArray(geo) ? geo : [];
    } catch {
      productRows = [];
      geoRows = [];
    }
  }
  let income: unknown = [];
  if (deps.income) {
    try {
      income = await deps.income(ticker);
    } catch {
      income = [];
    }
  } else if (isFmpAvailable()) {
    try {
      income = await fmpIncomeStatement(ticker, 2);
    } catch {
      income = [];
    }
  }
  let secSegments: { name?: string; revenue?: number; prevRevenue?: number | null }[] = [];
  if (deps.secSegments) {
    try {
      const rows = await deps.secSegments(ticker);
      secSegments = Array.isArray(rows) ? [...rows] : [];
    } catch {
      secSegments = [];
    }
  } else {
    const hit = diskResearcherGetWithTtl(`segments__${ticker.toUpperCase()}`, 7 * 24 * 60 * 60 * 1000);
    const data = hit?.data as { segments?: typeof secSegments } | undefined;
    secSegments = Array.isArray(data?.segments) ? data.segments : [];
  }
  return factsFromSegmentation({
    profile: identity?.description ?? "",
    fiscalYear: identity?.fiscalYear ?? "",
    currency: identity?.currency ?? "",
    income,
    productRows,
    geoRows,
    secSegments,
  });
}

export function segmentChildrenKiMessages(
  ticker: string,
  parent: string,
  kind: "product" | "geographic",
  siblings: readonly string[],
  peerLine = "PEER-ANKER: n/a — Peer-Umsatz-YoY nicht geladen. Eine Zahl ohne eigene Quelle weglassen.",
  identity?: OutlineIdentity,
  facts?: SegmentEstimateFacts,
): { systemPrompt: string; prompt: string } {
  const blocked = siblings.map((name) => name.trim()).filter((name) => name.length > 0).slice(0, 24).join(", ");
  const siblingLine = blocked ? ` Diese Namen sind Geschwister und keine Kinder: ${blocked}.` : "";
  const identityLine = identity
    ? `Firma: ${identity.companyName}. Börse: ${identity.exchange || "n/a"}. Land: ${identity.country || "n/a"}. Sektor: ${identity.sector || "n/a"}. Branche: ${identity.industry || "n/a"}. Geschäftsjahr: ${identity.fiscalYear || "n/a"}. Währung: ${identity.currency || "n/a"}.`
    : "Geschäftsjahr: n/a. Währung: n/a.";
  const factLine = facts ? `${segmentFactBlock(facts)}\n` : "";
  const form = `{"companyEcho":"","industryEcho":"","children":[{"name":"","brand":"","brandOwner":null,"owner":"","ownerParent":"","revenue":null,"shareOfParentPct":null,"growthPct":null,"basis":"Begründung der Lücke","source":null}]}`;
  const sourceRule = "owner oder ownerParent nennt die Firma. brand nennt die Firma oder Marke, die im Namen steht, sonst leer. brandOwner nennt die Firma, der diese Marke gehört (bei Tochterfirmen die Muttergesellschaft), sonst null, wenn unklar. Keine Produkte oder Marken einer anderen Firma, auch keine Wettbewerber. Eine Zahl nur, wenn source Firma, Dokumenttyp und Jahr nennt, sonst source null und die Zahl null. Kein Platzhalter als Quelle. basis nennt die Lücke in eigenen Worten und darf nicht leer sein. Eine leere basis wird verworfen. Echte 0 bleibt 0. Ein unbekannter Wert ist null, nie 0.";
  if (kind === "geographic") {
    return {
      systemPrompt: "Antworte nur mit JSON. Schätze nur die genannte Firma. Schätze Anteil und Wachstum nur mit Basis und Quelle. Ein unbekannter Anteil ist null, nie 0. Unbekanntes Wachstum ist null, nie 0. Das Label ist KI-Schätzung, nicht Override.",
      prompt: `${factLine}${peerLine}\n${identityLine}\nTicker ${ticker}. Geografisches Segment "${parent}". Nenne die bekannten Regionen, Länder oder Bundesstaaten innerhalb dieses Gebiets. Keine Geschäftssegmente. Nicht den Namen "${parent}" wiederholen.${siblingLine} Form: ${form}. ${sourceRule} Jedes Kind braucht name, basis und owner. Leeres children nur, wenn keine Unterregion bekannt ist.`,
    };
  }
  return {
    systemPrompt: "Antworte nur mit JSON. Schätze nur die genannte Firma. Schätze Anteil und Wachstum nur mit Basis und Quelle. Bekannte Produktlinien sind erlaubt. Ein unbekannter Anteil ist null, nie 0. Unbekanntes Wachstum ist null, nie 0. Das Label ist KI-Schätzung, nicht Override.",
      prompt: `${factLine}${peerLine}\n${identityLine}\nTicker ${ticker}. Geschäftssegment "${parent}". Nenne die bekannten Produktlinien nur dieses Segments dieser Firma, nicht die Geschwister und nicht noch einmal "${parent}".${siblingLine} Form: ${form}. Beispiel: {"companyEcho":"${identity?.companyName ?? ""}","industryEcho":"${identity?.industry || identity?.sector || ""}","children":[{"name":"","brand":"","brandOwner":null,"owner":"${identity?.companyName ?? ""}","ownerParent":"","shareOfParentPct":null,"growthPct":null,"basis":"Begründung der Lücke","source":null}]}. ${sourceRule} Jedes Kind braucht name, basis und owner. Leeres children nur, wenn keine Produktlinie bekannt ist.`,
  };
}

async function defaultKiChildren(
  ticker: string,
  parent: string,
  kind: "product" | "geographic" = "product",
  siblings: readonly string[] = [],
  identity?: OutlineIdentity,
  facts?: SegmentEstimateFacts,
  llm?: SegmentLlm,
): Promise<unknown> {
  if (!llm && !isLLMAvailable()) return null;
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
    const messages = segmentChildrenKiMessages(ticker, parent, kind, siblings, peerLine, identity, facts);
    const run = llm ?? callLLMJson;
    const result = await run({
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

async function defaultOutline(
  ticker: string,
  kind: "product" | "geographic",
  identity: OutlineIdentity,
  facts?: SegmentEstimateFacts,
  llm?: SegmentLlm,
): Promise<unknown> {
  if (!llm && !isLLMAvailable()) return null;
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
  const known = segmentFactBlock(facts ?? factsFromSegmentation({
    profile: identity.description ?? "",
    fiscalYear: identity.fiscalYear ?? "",
    currency: identity.currency ?? "",
  }));
  try {
    const run = llm ?? callLLMJson;
    const result = await run({
      systemPrompt: "Antworte nur mit JSON. Schätze nur die genannte Firma. companyEcho muss den Firmennamen enthalten, industryEcho die Branche. Zahlen nur mit Dokumenttyp und Periode, sonst null. Echte 0 bleibt 0. Das Label ist KI-Schätzung, nicht FMP und nicht Override.",
      prompt: `${known}\n${peerLine}\nFirma: ${identity.companyName}. Börse: ${identity.exchange || "n/a"}. Land: ${identity.country || "n/a"}. Sektor: ${identity.sector || "n/a"}. Branche: ${identity.industry || "n/a"}. Geschäftsjahr: ${identity.fiscalYear || "n/a"}. Währung: ${identity.currency || "n/a"}. Ticker ${ticker}. ${subject} Nenne nur fehlende Namen dieser Firma, nicht einer anderen, und ersetze keine bekannte Zahl. brand nennt die Firma oder Marke, die im Namen steht, sonst leer. brandOwner nennt die Firma, der diese Marke gehört (bei Tochterfirmen die Muttergesellschaft), sonst null, wenn unklar. Keine Produkte oder Marken einer anderen Firma, auch keine Wettbewerber. Eine Zahl nur, wenn source Firma, Dokumenttyp und Jahr nennt, sonst source null und die Zahl null. Kein Platzhalter als Quelle. basis nennt die Lücke in eigenen Worten und darf nicht leer sein. Eine leere basis wird verworfen. Die Summe der Anteile darf 100 nicht übersteigen. Beispiel: {"companyEcho":"${identity.companyName}","industryEcho":"${identity.industry || identity.sector || ""}","children":[{"name":"","brand":"","brandOwner":null,"owner":"${identity.companyName}","ownerParent":"","shareOfParentPct":null,"growthPct":null,"basis":"Begründung der Lücke","source":null}]}. Echte 0 bleibt 0.`,
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
  };
}

export async function loadSegmentChildren(
  ticker: string,
  parent: string,
  kind: "product" | "geographic",
  deps: SegmentChildrenDeps = defaultSegmentChildrenDeps(),
  scope: SegmentChildrenScope = {},
): Promise<SegmentChildrenResult> {
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
    const facts = await resolveSegmentFacts(ticker, identity, deps);
    const runKi = deps.ki ?? defaultKiChildren;
    kiPayload = await runKi(ticker, label, kind, scope.siblings ?? [], identity ?? undefined, facts, deps.llm);
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
  return reviewKiChildren(label, kiPayload, reportedParentRevenue(raw, label), {
    kind,
    siblings: scope.siblings,
    businessNames: scope.businessNames,
    companyName: identity?.companyName,
    ticker,
    description: identity?.description,
    peerCompanies,
  });
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
      const body = await loadSegmentChildren(ticker, canonical, kind, deps, { siblings, businessNames });
      const shortCache = body.children.length === 0;
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
      const facts = mergeYahooFacts(await resolveSegmentFacts(ticker, identity, deps), req.body?.yahoo);
      const known = kind === "geographic" ? knownRegionRows(req.body?.rows) : [];
      const gaps = known.filter((row) => row.growth == null);
      if (known.length > 0 && gaps.length === 0) {
        return res.json({ items: [], reason: "Keine N/A-Zellen" });
      }
      const payload = known.length > 0
        ? await (deps.llm ?? callLLMJson)({
          systemPrompt: "Antworte nur mit JSON. Schätze nur fehlendes Regionenwachstum der genannten Firma. Eine bekannte YoY-Zahl bleibt. Das Label ist KI-Schätzung.",
          prompt: regionFillPrompt(facts, known, identity, ticker),
          maxTokens: 800,
          temperature: 0.2,
          signal: AbortSignal.timeout(SEGMENT_CHILDREN_KI_TIMEOUT_MS),
        }).then((result) => result?.data ?? null).catch(() => null)
        : await (deps.outline ?? defaultOutline)(ticker, kind, identity, facts, deps.llm);
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
      const reviewed = reviewSegmentOutline(payload, identity.companyName, {
        ticker,
        description: identity.description || facts.profile,
        peerCompanies,
      });
      const items = known.length > 0
        ? reviewed.items.filter((item) => gaps.some((row) => row.name.toLowerCase() === item.name.toLowerCase()))
        : reviewed.items;
      if (items.length > 0) rememberOutlineNames(ticker, kind, items.map((item) => item.name), now);
      return res.json({ items, reason: reviewed.reason });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Segment-Schätzung fehlgeschlagen";
      return res.status(502).json({ error: message.slice(0, 200) });
    }
  });
}
