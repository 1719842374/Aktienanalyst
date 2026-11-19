/**
 * POST /api/segment-gaps
 *
 * Fehlende Produktlinien und Regionen, die FMP/SEC nicht führen.
 * Kein Ticker-Hardcoding. Treffer hängen an einem vorhandenen Elternsegment.
 * Top-Level-Summen und FMP-Zeilen bleiben unangetastet.
 * Treffer liegen je Elternsegment 24 h im Speicher. Fehler und nicht abgefragte Segmente nicht.
 * Leere Antworten ohne Eltern 60 s. Ein KI-Fehler in einem Segment lässt die übrigen stehen.
 */
import { createHash } from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  KI_SUM_EXCEEDS_PARENT,
  OUTLINE_MISMATCH,
  OUTLINE_NO_IDENTITY,
  concreteSource,
  outlineEchoMatches,
  reportedParentRevenue,
  reviewKiChildren,
  segmentNamesFromFmpRows,
  type SegmentChild,
} from "../shared/segment-children";
import {
  isGeographicPlace,
  regionFitsParent,
  segmentGapKey,
  type SegmentGapItem,
  type SegmentGapResult,
} from "../shared/segment-gap";
import { prettifyProductSegmentName } from "../shared/segment-growth-calc";
import { convertSegmentRowsToUsd, fmpSegmentationRows, isFmpAvailable, type FmpSegmentRow } from "./fmp";
import { callLLMJson, isLLMAvailable, openRouterHttpBudgetRemaining, withOpenRouterHttpBudget } from "./llm-openrouter";
import { fetchSecBusinessSegments } from "./sec-segments";
import {
  loadOutlineIdentity,
  SEGMENT_CHILDREN_KI_TIMEOUT_MS,
  type OutlineIdentity,
} from "./segment-growth-route";

export type { SegmentGapItem, SegmentGapResult };

const GAP_CACHE_MS = 24 * 60 * 60 * 1000;
const GAP_EMPTY_CACHE_MS = 60 * 1000;
const GAP_CACHE_MAX = 400;
const DEFAULT_RATE_MAX = 20;
const DEFAULT_RATE_WINDOW_MS = 60 * 1000;
const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,31}$/i;
/** Prompt-Version im Cache-Schlüssel, damit alte Antworten nach einer Prompt-Änderung nicht liegen bleiben. */
export const SEGMENT_GAP_PROMPT_VERSION = "n36-gap-p13";
/**
 * Obergrenze der OpenRouter-HTTP-Requests pro Anfrage.
 * Modell-Fallback und die SEC-Extraktion zählen mit. Keine Wert-Schwelle.
 * Höchstens so viele Eltern-Aufgaben, weil jeder Start mindestens einen Request kostet.
 */
export const SEGMENT_GAP_MAX_CALLS = 4;
const gapCache = new Map<string, { at: number; ttl: number; body: { items: SegmentGapItem[]; reason: string | null } }>();
const gapInflight = new Map<string, Promise<ParentAttempt>>();
const secNameCache = new Map<string, { at: number; ttl: number; names: string[] }>();
const rateBuckets = new Map<string, number[]>();

type Llm = (opts: {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}) => Promise<{ data: unknown; modelUsed?: string } | null>;

export interface SegmentGapDeps {
  available?: () => boolean;
  productRows?: (ticker: string) => Promise<unknown[]>;
  regionRows?: (ticker: string) => Promise<unknown[]>;
  identity?: (ticker: string) => Promise<OutlineIdentity | null>;
  llm?: Llm;
  now?: () => number;
  rateLimit?: { max: number; windowMs: number };
  secSegments?: (ticker: string, companyName: string) => Promise<{ segments: Array<{ name: string }> } | null>;
  /** Standard ist convertSegmentRowsToUsd aus #505. Tests setzen einen Kurs, ohne das Netz zu rufen. */
  convertSegments?: (rows: FmpSegmentRow[]) => Promise<FmpSegmentRow[]>;
}

export function resetSegmentGapCacheForTests(): void {
  gapCache.clear();
  gapInflight.clear();
  secNameCache.clear();
  rateBuckets.clear();
}

export function segmentGapCacheKey(
  ticker: string,
  products: readonly string[],
  regions: readonly string[],
  revenues: readonly (number | null)[] = [],
): string {
  const basis = revenues.slice(0, 48).map((value) => (value == null ? "" : String(value))).join("\n");
  const names = `p:${products.slice(0, 24).join("\n")}\nr:${regions.slice(0, 24).join("\n")}\nv:${basis}`;
  const hash = createHash("sha256").update(names).digest("hex");
  return `${SEGMENT_GAP_PROMPT_VERSION}|${ticker.toUpperCase()}|${hash}`;
}

function pruneGapCache(now: number): void {
  const expired: string[] = [];
  gapCache.forEach((entry, key) => {
    if (now - entry.at >= entry.ttl) expired.push(key);
  });
  for (let i = 0; i < expired.length; i++) gapCache.delete(expired[i]);
}

function rememberGap(key: string, entry: { at: number; ttl: number; body: { items: SegmentGapItem[]; reason: string | null } }): void {
  if (!gapCache.has(key) && gapCache.size >= GAP_CACHE_MAX) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    gapCache.forEach((cached, cachedKey) => {
      if (cached.at < oldestAt) {
        oldestAt = cached.at;
        oldestKey = cachedKey;
      }
    });
    if (oldestKey) gapCache.delete(oldestKey);
  }
  gapCache.set(key, entry);
}

function cachedSecNames(ticker: string, now: number): string[] | null {
  const entry = secNameCache.get(ticker.toUpperCase());
  if (!entry) return null;
  if (now - entry.at >= entry.ttl) {
    secNameCache.delete(ticker.toUpperCase());
    return null;
  }
  return entry.names;
}

function rememberSecNames(ticker: string, now: number, names: string[]): void {
  const key = ticker.toUpperCase();
  if (!secNameCache.has(key) && secNameCache.size >= GAP_CACHE_MAX) {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    secNameCache.forEach((entry, entryKey) => {
      if (entry.at < oldestAt) {
        oldestAt = entry.at;
        oldestKey = entryKey;
      }
    });
    if (oldestKey) secNameCache.delete(oldestKey);
  }
  secNameCache.set(key, { at: now, ttl: names.length === 0 ? GAP_EMPTY_CACHE_MS : GAP_CACHE_MS, names });
}

function namesFromSecSegments(sec: { segments?: ReadonlyArray<{ name?: unknown }> } | null): string[] {
  const names: string[] = [];
  for (const segment of sec?.segments ?? []) {
    const name = typeof segment.name === "string" ? segment.name.trim() : "";
    if (!name || names.some((current) => current.toLowerCase() === name.toLowerCase())) continue;
    names.push(name);
  }
  return names;
}

function takeGapSlot(ip: string, now: number, max: number, windowMs: number): boolean {
  const recent = (rateBuckets.get(ip) ?? []).filter((at) => now - at < windowMs);
  if (recent.length >= max) {
    rateBuckets.set(ip, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  return true;
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function segmentGapPrompt(input: {
  ticker: string;
  companyName: string;
  description: string;
  products: string[];
  regions: string[];
  industry?: string;
  sector?: string;
  parentsUsd?: ReadonlyArray<{ name: string; revenueUsd: number | null }>;
  fxNote?: string | null;
  /** Dieser Aufruf füllt nur dieses Elternsegment. Leer = alle Produkt-Eltern. */
  only?: string;
}): string {
  const closed = (rows: string[]) => (rows.length > 0 ? rows.slice(0, 24).join(" | ") : "keine");
  const industryEcho = input.industry || input.sector || "";
  const parentLine = (input.parentsUsd ?? []).length > 0
    ? (input.parentsUsd ?? []).map((row) => (
      row.revenueUsd != null && row.revenueUsd > 0 ? `${row.name} ${row.revenueUsd} USD` : `${row.name} n/a`
    )).join(" | ")
    : "n/a";
  const focusNames = input.only ? [input.only] : input.products;
  const hardwareNames = input.products.filter((name) => !serviceParentName(name));
  const eachParent = focusNames.map((name) => {
    if (serviceParentName(name)) {
      const booked = hardwareNames.length > 0 ? hardwareNames.join(", ") : "keinem anderen Produkt-Eltern";
      return `- ${name}: fehlende Produktlinien nur dieses Elterns, die hier berichtet werden. Software-, Abo- oder Freischalt-Umsatz, der mit einem Gerät verkauft und in einem anderen Produkt-Eltern verbucht wird, gehört nicht hierher. Diese Produkt-Eltern sind: ${booked}.`;
    }
    return `- ${name}: Pflichtprüfung. Fehlende Produktlinien nur dieses Elterns. Software-, Abo- oder Freischalt-Umsatz, der für ein Gerät dieses Segments verkauft wird und den die Firma in diesem Segment verbucht, muss unter genau dieser Zeichenfolge stehen.`;
  }).join("\n");
  const focusLine = input.only
    ? `Dieser Aufruf füllt nur das Elternsegment "${input.only}". Kinder eines anderen Elterns gehören nicht in diese Antwort.`
    : "";
  return [
    "Bekannte Fakten. Diese Namen und Zahlen nicht ersetzen und nicht als neues Top-Level-Segment anlegen.",
    `Ticker ${input.ticker}. Firma: ${input.companyName}.`,
    `Branche: ${industryEcho || "n/a"}.`,
    `Profil: ${clip(input.description, 600) || "n/a"}.`,
    `Erlaubte Produkt-Eltern, nur diese Zeichenfolgen: ${closed(input.products)}.`,
    `Erlaubte Regionen-Eltern, nur diese Zeichenfolgen: ${closed(input.regions)}.`,
    "parent ist genau eine dieser Zeichenfolgen. Jeder andere Elternname ist ungültig und wird verworfen.",
    "Nenne Produktlinien und Regionen, die diese Firma führt und die in den beiden Listen fehlen.",
    "Nenne auch Geschäftsbereiche, die diese Firma real führt und die in den Listen nicht stehen, etwa Software, Services oder Abos.",
    "Jedes Produkt-Eltern bekommt einen eigenen Aufruf. Nicht alle Zeilen unter das erste oder das größte Segment legen.",
    focusLine,
    eachParent,
    "Ein bekannter Name kommt nicht noch einmal als Treffer.",
    "Ein Land oder eine Region ist kein Produkt-Unterposten. Eine Region nur unter dem Regionen-Eltern, das sie geografisch enthält, nicht unter einem anderen Land.",
    "Währung der Elternumsätze: USD.",
    `Elternumsätze in USD: ${parentLine}.`,
    input.fxNote ? input.fxNote : "",
    "shareOfParentPct ist eine Zahl nur zusammen mit source. source nennt die Firma, den Dokumenttyp und das Jahr. Fehlt eines davon, sind shareOfParentPct und revenue null.",
    "revenue ist der Umsatz des Unterpostens in USD und nur, wenn dieselbe source die Zahl nennt, sonst null. currency ist USD. Nie 0.",
    "basis nennt die Lücke und darf nicht leer sein. Die Quellenangabe steht in source, nicht als Ersatz für basis.",
    "naReason ist genau einer dieser Codes, sonst leer: not_disclosed_separately, bundled_in_parent, only_qualitative_mention, no_revenue_figure. Kein Freitext.",
    `Antwortform: {"companyEcho":"${input.companyName}","industryEcho":"${industryEcho}","children":[{"parent":"","name":"","owner":"${input.companyName}","currency":"USD","revenue":null,"shareOfParentPct":null,"growthPct":null,"basis":"Begründung","source":"Firma, Dokumenttyp, Jahr","naReason":"not_disclosed_separately"}]}.`,
  ].filter((line) => line.length > 0).join("\n");
}

function fold(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function serviceParentName(name: string): boolean {
  return /service|abo|subscription|software|support/i.test(name);
}

function absorbGapItem(merged: SegmentGapItem[], item: SegmentGapItem): void {
  const slot = `${item.kind}:${segmentGapKey(item.parent)}:${segmentGapKey(item.name)}`;
  if (merged.some((row) => `${row.kind}:${segmentGapKey(row.parent)}:${segmentGapKey(row.name)}` === slot)) return;
  if (item.kind === "product") {
    const cross = merged.findIndex((row) => (
      row.kind === "product"
      && segmentGapKey(row.name) === segmentGapKey(item.name)
      && serviceParentName(row.parent) !== serviceParentName(item.parent)
    ));
    if (cross >= 0) {
      const current = merged[cross];
      if (current && serviceParentName(current.parent) && !serviceParentName(item.parent)) merged[cross] = item;
      return;
    }
  }
  merged.push(item);
}

const GAP_REASON_CODE = {
  not_disclosed_separately: (name: string, _parent: string) => `n/a — Firma weist ${name} nicht separat aus`,
  bundled_in_parent: (name: string, parent: string) => `n/a — ${name} ist in ${parent} gebündelt; Firma weist es nicht separat aus`,
  only_qualitative_mention: (name: string, parent: string) => `n/a — ${name} wird bei ${parent} nur qualitativ genannt; Firma weist es nicht separat aus`,
  no_revenue_figure: (name: string, parent: string) => `n/a — für ${name} unter ${parent} fehlt eine Umsatzzahl`,
} as const;

function specificGapNote(reason: string, name: string, parent: string, companyName: string): string {
  const text = reason.replace(/\s+/g, " ").trim();
  if (text in GAP_REASON_CODE) return GAP_REASON_CODE[text as keyof typeof GAP_REASON_CODE](name, parent);
  if (text && concreteSource(text, companyName)) return `n/a — ${text}`;
  return `n/a — Firma weist ${name} nicht separat aus`;
}

function visibleBasis(basis: string, companyName: string): string {
  const text = basis.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.split(" · ").map((part) => part.trim()).filter((part) => {
    if (!part) return false;
    if (part.startsWith("Formel:")) return true;
    return concreteSource(part, companyName);
  }).join(" · ");
}

function sameShownParent(left: string, right: string): boolean {
  const shown = segmentGapKey(right);
  return segmentGapKey(left) === shown || segmentGapKey(prettifyProductSegmentName(left)) === shown;
}

function canonicalParent(parent: string, allowed: readonly string[]): string | null {
  for (let i = 0; i < allowed.length; i++) {
    const name = allowed[i] ?? "";
    if (name && sameShownParent(parent, name)) return name;
  }
  return null;
}

function citeConcreteSource(item: unknown, companyName: string): unknown {
  if (!item || typeof item !== "object") return item;
  const row = item as { source?: unknown; basis?: unknown };
  const source = typeof row.source === "string" ? row.source.trim() : "";
  const basis = typeof row.basis === "string" ? row.basis.trim() : "";
  if (concreteSource(source, companyName)) return item;
  const combined = [basis, source].filter((part) => part.length > 0).join(" · ");
  if (!basis || !concreteSource(combined, companyName)) return item;
  return { ...row, source: combined };
}

interface ShownParent {
  name: string;
  revenue: number | null;
}

function shownParents(value: unknown): ShownParent[] {
  if (!Array.isArray(value)) return [];
  const out: ShownParent[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const name = clip((item as { name?: unknown }).name, 120);
    if (!name || out.some((row) => segmentGapKey(row.name) === segmentGapKey(name))) continue;
    const revenueRaw = (item as { revenue?: unknown }).revenue;
    const revenue = typeof revenueRaw === "number" && Number.isFinite(revenueRaw) && revenueRaw > 0 ? revenueRaw : null;
    out.push({ name, revenue });
    if (out.length >= 24) break;
  }
  return out;
}

function overlayShownRevenue(shown: readonly ShownParent[], revenues: Map<string, number>, fmpNames: readonly string[]): void {
  for (const row of shown) {
    const hit = fmpNames.find((name) => sameShownParent(name, row.name));
    if (!hit) continue;
    const value = revenues.get(fold(hit));
    if (value != null) revenues.set(fold(row.name), value);
  }
}

export function reviewSegmentGaps(
  payload: unknown,
  products: readonly string[],
  regions: readonly string[],
  companyName: string,
  ticker: string,
  description: string,
  parentRevenue: ReadonlyMap<string, number> = new Map(),
): SegmentGapResult {
  const record = payload && typeof payload === "object" ? payload as { children?: unknown } : {};
  const raw = Array.isArray(record.children) ? record.children : [];
  const allowed = [...products, ...regions];
  const known = new Set(allowed.map(segmentGapKey));
  const grouped = new Map<string, { kind: "product" | "geographic"; rows: unknown[] }>();
  const notes: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { parent?: unknown; name?: unknown; shareOfParentPct?: unknown };
    const parent = clip(row.parent, 120);
    const name = clip(row.name, 80);
    const canonical = parent ? canonicalParent(parent, allowed) : null;
    if (!canonical) {
      if (name) notes.push(`n/a — Elternsegment nicht in der Liste: ${name}`);
      continue;
    }
    if (row.shareOfParentPct === 0 && name) notes.push(`n/a — Anteil 0 verworfen: ${name}`);
    const parentIsRegion = regions.some((region) => segmentGapKey(region) === segmentGapKey(canonical));
    const parentIsProduct = products.some((product) => segmentGapKey(product) === segmentGapKey(canonical));
    if (name && isGeographicPlace(name) && !parentIsRegion) {
      notes.push(`n/a — Region nicht als Produkt-Unterposten: ${name}`);
      continue;
    }
    if (name && isGeographicPlace(name) && parentIsRegion && !regionFitsParent(parent, name)) {
      notes.push(`n/a — Region passt nicht unter ${parent}: ${name}`);
      continue;
    }
    const kind: "product" | "geographic" = name && isGeographicPlace(name) && parentIsRegion
      ? "geographic"
      : parentIsRegion && !parentIsProduct
        ? "geographic"
        : "product";
    const bucket = grouped.get(`${kind}:${segmentGapKey(canonical)}`) ?? { kind, rows: [] };
    bucket.rows.push(citeConcreteSource({ ...row, parent: canonical }, companyName));
    grouped.set(`${kind}:${segmentGapKey(canonical)}`, bucket);
  }
  const items: SegmentGapItem[] = [];
  for (const bucket of Array.from(grouped.values())) {
    const parent = clip((bucket.rows[0] as { parent?: unknown }).parent, 120);
    const siblings = [...products, ...regions].filter((name) => fold(name) !== fold(parent));
    const reviewed = reviewKiChildren(parent, { children: bucket.rows }, null, {
      kind: bucket.kind,
      siblings,
      businessNames: products,
      companyName,
      ticker,
      description,
    });
    if (reviewed.reason) notes.push(reviewed.reason);
    const enriched: SegmentGapItem[] = [];
    for (const child of reviewed.children) {
      if (known.has(segmentGapKey(child.name))) continue;
      const childCurrency = currencyOnRows(bucket.rows, child.name);
      const parentUsd = parentRevenue.get(fold(parent)) ?? null;
      const item = toGapItem(parent, bucket.kind, child, parentUsd, companyName, childCurrency, naReasonOnRows(bucket.rows, child.name));
      if (
        child.revenue != null && child.revenue > 0
        && parentUsd != null
        && childCurrency !== "USD"
        && item.shareOrigin !== "fact"
        && concreteSource(item.basis, companyName)
      ) {
        notes.push(`n/a — Währung passt nicht zur Elternzeile: ${child.name}`);
      }
      enriched.push(item);
      if (item.shareOfParentPct == null && item.shareNote && !notes.some((note) => note.includes(item.shareNote ?? "") && note.includes(child.name))) {
        notes.push(`${item.shareNote}: ${child.name}`);
      }
    }
    const shareSum = enriched.reduce((sum, row) => sum + (row.shareOfParentPct ?? 0), 0);
    if (enriched.some((row) => row.shareOfParentPct != null) && shareSum > 100) {
      notes.push(KI_SUM_EXCEEDS_PARENT);
      continue;
    }
    for (const row of enriched) items.push(row);
  }
  return { items, reason: notes.filter((note) => note.trim()).join(" ") || null };
}

function rowYear(row: Record<string, unknown>): number {
  const year = row.fiscalYear;
  if (typeof year === "number" && Number.isInteger(year)) return year;
  if (typeof year === "string" && /^\d{4}/.test(year)) return Number(year.slice(0, 4));
  const date = typeof row.date === "string" ? row.date : "";
  if (/^\d{4}/.test(date)) return Number(date.slice(0, 4));
  return 0;
}

function reportedCurrencyOf(raw: unknown[]): string {
  if (!Array.isArray(raw)) return "";
  let bestYear = -1;
  let code = "";
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    if (typeof rec.period === "string" && /^Q[1-4]$/i.test(rec.period.trim())) continue;
    const reported = typeof rec.reportedCurrency === "string" ? rec.reportedCurrency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(reported)) continue;
    const year = rowYear(rec);
    if (year >= bestYear) {
      bestYear = year;
      code = reported;
    }
  }
  return code;
}

function currencyCode(value: string | undefined): string {
  const code = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}

/** Rohe Segmentzahlen in die Form, die convertSegmentRowsToUsd aus #505 erwartet. */
function segmentRowsForUsd(raw: unknown[], fallbackCurrency: string): { rows: FmpSegmentRow[]; missingCurrency: boolean } {
  const currency = reportedCurrencyOf(raw) || currencyCode(fallbackCurrency);
  const rows: FmpSegmentRow[] = [];
  let hasRevenue = false;
  for (const name of segmentNamesFromFmpRows(raw)) {
    const revenue = reportedParentRevenue(raw, name);
    if (revenue == null || !(revenue > 0)) continue;
    hasRevenue = true;
    if (!currency) continue;
    rows.push({
      name,
      revenue,
      percentage: 0,
      growth: null,
      reportedCurrency: currency,
    });
  }
  return { rows, missingCurrency: hasRevenue && !currency };
}

function revenuesFromConverted(rows: readonly FmpSegmentRow[]): { revenues: Map<string, number>; fxNote: string | null } {
  const revenues = new Map<string, number>();
  let fxNote: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.fxNaReason) {
      fxNote = row.fxNaReason;
      continue;
    }
    if (row.revenue > 0) revenues.set(fold(row.name), row.revenue);
  }
  return { revenues, fxNote };
}

async function usdParentRevenues(
  productRaw: unknown[],
  regionRaw: unknown[],
  convert: (rows: FmpSegmentRow[]) => Promise<FmpSegmentRow[]>,
  fallbackCurrency: string,
): Promise<{ revenues: Map<string, number>; fxNote: string | null }> {
  const productBuilt = segmentRowsForUsd(productRaw, fallbackCurrency);
  const regionBuilt = segmentRowsForUsd(regionRaw, fallbackCurrency);
  const product = revenuesFromConverted(await convert(productBuilt.rows));
  const region = revenuesFromConverted(await convert(regionBuilt.rows));
  region.revenues.forEach((value, key) => {
    if (!product.revenues.has(key)) product.revenues.set(key, value);
  });
  const missingNote = productBuilt.missingCurrency || regionBuilt.missingCurrency ? "n/a — Währung fehlt" : null;
  const fxNote = [product.fxNote, region.fxNote, missingNote].filter((note) => note && note.trim()).join(" ") || null;
  return { revenues: product.revenues, fxNote };
}

function currencyOnRows(rows: readonly unknown[], name: string): string {
  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; currency?: unknown };
    if (clip(row.name, 80) !== name) continue;
    const code = clip(row.currency, 12).toUpperCase();
    return /^[A-Z]{3}$/.test(code) ? code : "";
  }
  return "";
}

function naReasonOnRows(rows: readonly unknown[], name: string): string {
  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    if (!item || typeof item !== "object") continue;
    const row = item as { name?: unknown; naReason?: unknown };
    if (clip(row.name, 80) !== name) continue;
    return clip(typeof row.naReason === "string" ? row.naReason : "", 180);
  }
  return "";
}

function toGapItem(
  parent: string,
  kind: "product" | "geographic",
  child: SegmentChild,
  parentRevenue: number | null,
  companyName: string,
  childCurrency: string,
  naReason: string,
): SegmentGapItem {
  const basis = child.basis ?? "";
  const sourced = concreteSource(basis, companyName);
  const revenue = child.revenue != null && child.revenue > 0 ? child.revenue : null;
  const parentUsd = parentRevenue != null && parentRevenue > 0 ? parentRevenue : null;
  let share: number | null = null;
  let shareOrigin: SegmentGapItem["shareOrigin"] = null;
  let shareNote: string | null = null;
  let shownBasis = basis;
  if (revenue != null && parentUsd != null && childCurrency === "USD" && sourced) {
    const rounded = Math.round((revenue / parentUsd) * 1000) / 10;
    if (rounded > 0 && rounded <= 100) {
      share = rounded;
      shareOrigin = "fact";
      const formula = `Formel: ${revenue} / ${parentUsd}`;
      if (!shownBasis.includes(formula)) shownBasis = `${shownBasis} · ${formula}`;
    } else if (child.shareOfParentPct != null && child.shareOfParentPct > 0 && child.shareOfParentPct <= 100) {
      share = child.shareOfParentPct;
      shareOrigin = "estimate";
    } else {
      shareNote = "n/a — Anteil nicht belegbar";
    }
  } else if (revenue != null && parentUsd != null && childCurrency !== "" && childCurrency !== "USD") {
    shareNote = "n/a — Währung passt nicht zur Elternzeile";
  } else if (sourced && child.shareOfParentPct != null && child.shareOfParentPct > 0 && child.shareOfParentPct <= 100) {
    share = child.shareOfParentPct;
    shareOrigin = "estimate";
  } else if (!sourced) {
    shareNote = specificGapNote(naReason, child.name, parent, companyName);
  } else {
    shareNote = specificGapNote(naReason, child.name, parent, companyName);
  }
  return {
    parent,
    kind,
    name: child.name,
    shareOfParentPct: share,
    growthPct: child.growthPct ?? null,
    basis: visibleBasis(shownBasis, companyName),
    shareOrigin,
    shareNote,
  };
}

type ParentAttempt = {
  ok: boolean;
  status: number | null;
  items: SegmentGapItem[];
  reason: string | null;
  fromCache: boolean;
};

type GapTask = {
  label: string;
  only: string;
  taskProducts: string[];
  taskRegions: string[];
  /** Server-USD für den Cache-Schlüssel. Nicht die Client-Zahl. */
  revenue: number | null;
  /** Reihenfolge der Abfrage. Angezeigter Umsatz, sonst Server-USD. */
  sortRevenue: number | null;
  placeholder: boolean;
};

function gapTasks(
  products: readonly string[],
  regions: readonly string[],
  revenues: ReadonlyMap<string, number>,
  order: ReadonlyMap<string, number>,
): GapTask[] {
  const ranked = (name: string) => order.get(fold(name)) ?? revenues.get(fold(name)) ?? null;
  const tasks: GapTask[] = products.map((name) => ({
    label: name,
    only: name,
    taskProducts: [name],
    taskRegions: [],
    revenue: revenues.get(fold(name)) ?? null,
    sortRevenue: ranked(name),
    placeholder: false,
  }));
  if (regions.length > 0) {
    let bestUsd: number | null = null;
    let bestSort: number | null = null;
    for (const name of regions) {
      const usdValue = revenues.get(fold(name)) ?? null;
      const sortValue = ranked(name);
      if (usdValue != null && (bestUsd == null || usdValue > bestUsd)) bestUsd = usdValue;
      if (sortValue != null && (bestSort == null || sortValue > bestSort)) bestSort = sortValue;
    }
    tasks.push({
      label: regions.join(", "),
      only: "",
      taskProducts: [],
      taskRegions: regions.slice(),
      revenue: bestUsd,
      sortRevenue: bestSort,
      placeholder: false,
    });
  }
  if (tasks.length === 0) {
    tasks.push({
      label: "keine",
      only: "",
      taskProducts: [],
      taskRegions: [],
      revenue: null,
      sortRevenue: null,
      placeholder: true,
    });
  }
  tasks.sort((a, b) => (b.sortRevenue ?? -1) - (a.sortRevenue ?? -1) || a.label.localeCompare(b.label));
  return tasks;
}

function parentCacheKey(ticker: string, task: GapTask): string {
  const basis = task.revenue != null && task.revenue > 0 ? String(task.revenue) : "";
  return `${SEGMENT_GAP_PROMPT_VERSION}|${ticker.toUpperCase()}|${task.label}|v:${basis}`;
}

function freshParent(key: string, now: number): { items: SegmentGapItem[]; reason: string | null } | null {
  const hit = gapCache.get(key);
  if (!hit || now - hit.at >= hit.ttl) {
    if (hit) gapCache.delete(key);
    return null;
  }
  return hit.body;
}

function failureStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const record = err as { status?: unknown; response?: { status?: unknown } };
  const raw = record.status ?? record.response?.status;
  const code = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return code === 429 || code === 402 ? code : null;
}

function unreachableNote(label: string, status: number | null): string {
  const code = status === 429 || status === 402 ? ` (${status})` : "";
  return `n/a — KI nicht erreichbar${code}: ${label}`;
}

export function segmentGapInflightForTests(key: string, run: () => Promise<ParentAttempt>): Promise<ParentAttempt> {
  return shareParentAttempt(key, run);
}

function shareParentAttempt(key: string, run: () => Promise<ParentAttempt>): Promise<ParentAttempt> {
  const pending = gapInflight.get(key);
  if (pending) return pending;
  const promise = run().finally(() => {
    gapInflight.delete(key);
  });
  gapInflight.set(key, promise);
  return promise;
}

export function registerSegmentGapRoute(app: Express, deps: SegmentGapDeps = {}): void {
  app.post("/api/segment-gaps", async (req: Request, res: Response) => {
    const ticker = typeof req.body?.ticker === "string" ? req.body.ticker.trim() : "";
    if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: "ticker fehlt oder ist ungültig" });
    const now = deps.now?.() ?? Date.now();
    const limit = deps.rateLimit ?? { max: DEFAULT_RATE_MAX, windowMs: DEFAULT_RATE_WINDOW_MS };
    try {
      await withOpenRouterHttpBudget(SEGMENT_GAP_MAX_CALLS, async () => {
      const identity = deps.identity ? await deps.identity(ticker) : await loadOutlineIdentity(ticker);
      if (!identity?.companyName) return res.json({ items: [], reason: OUTLINE_NO_IDENTITY });
      const available = deps.available ?? isFmpAvailable;
      let products: string[] = [];
      let regions: string[] = [];
      let productRaw: unknown[] = [];
      let regionRaw: unknown[] = [];
      if (available()) {
        const productRows = deps.productRows ? await deps.productRows(ticker) : await fmpSegmentationRows("product", ticker, "annual");
        const regionRows = deps.regionRows ? await deps.regionRows(ticker) : await fmpSegmentationRows("geographic", ticker, "annual");
        productRaw = Array.isArray(productRows) ? productRows : [];
        regionRaw = Array.isArray(regionRows) ? regionRows : [];
        products = segmentNamesFromFmpRows(productRaw);
        regions = segmentNamesFromFmpRows(regionRaw);
      }
      const fmpProducts = products.slice();
      const fmpRegions = regions.slice();
      const shownProducts = shownParents(req.body?.products);
      const shownRegions = shownParents(req.body?.regions);
      if (shownProducts.length > 0) products = shownProducts.map((row) => row.name);
      if (shownRegions.length > 0) regions = shownRegions.map((row) => row.name);
      if (products.length === 0 && shownProducts.length === 0) {
        const cachedNames = cachedSecNames(ticker, now);
        if (cachedNames) products = cachedNames;
      }
      const convert = deps.convertSegments ?? convertSegmentRowsToUsd;
      const usd = await usdParentRevenues(productRaw, regionRaw, convert, identity.currency ?? "");
      overlayShownRevenue(shownProducts, usd.revenues, fmpProducts);
      overlayShownRevenue(shownRegions, usd.revenues, fmpRegions);
      pruneGapCache(now);
      const parentsKnown = products.length > 0 || regions.length > 0 || cachedSecNames(ticker, now) !== null;
      const order = new Map<string, number>();
      for (const row of [...shownProducts, ...shownRegions]) {
        if (row.revenue != null) order.set(fold(row.name), row.revenue);
      }
      let tasks = gapTasks(products, regions, usd.revenues, order);
      const systemPrompt = "Antworte nur mit JSON. Schätze nur fehlende Produktlinien und Regionen der genannten Firma. companyEcho muss den Firmennamen enthalten, industryEcho die genannte Branche. parent ist genau die Zeichenfolge dieses Aufrufs. Ein Land ist kein Produkt-Unterposten. Eine Region nur unter dem passenden Regionen-Eltern. Pflicht je Hardware-Eltern: Software-, Abo- oder Freischalt-Umsatz für ein Gerät dieses Segments, den die Firma dort verbucht, steht unter diesem Eltern. Ein Service-Eltern zieht diesen Umsatz nicht an sich. Bekannte Namen nicht wiederholen. revenue nur in USD und nur mit source, sonst null. shareOfParentPct nur mit source, die Firma, Dokumenttyp und Jahr nennt, sonst null. naReason ist genau einer der Codes not_disclosed_separately, bundled_in_parent, only_qualitative_mention, no_revenue_figure, sonst leer. Nie 0. Das Label ist KI-Schätzung, kein Override.";
      const run = deps.llm ?? callLLMJson;
      const reply = (
        merged: SegmentGapItem[],
        notes: string[],
        queried: number,
        total: number,
        cached: boolean,
      ) => {
        const coverage = `abgefragt ${queried} von ${total}`;
        const reason = [...notes, usd.fxNote && !notes.some((note) => note.includes(usd.fxNote ?? "")) ? usd.fxNote : "", coverage]
          .filter((note) => note && note.trim())
          .join(" ") || null;
        const body: SegmentGapResult = {
          items: merged,
          reason,
          promptVersion: SEGMENT_GAP_PROMPT_VERSION,
          cached,
          queried,
          total,
        };
        return body;
      };
      const fromCache = (list: GapTask[]) => {
        const queriedTasks = list.slice(0, SEGMENT_GAP_MAX_CALLS);
        const skipped = list.slice(SEGMENT_GAP_MAX_CALLS);
        const hits = queriedTasks.map((task) => freshParent(parentCacheKey(ticker, task), now));
        if (hits.some((hit) => hit == null)) return null;
        const merged: SegmentGapItem[] = [];
        const notes: string[] = [];
        for (const hit of hits) {
          if (hit?.reason) notes.push(hit.reason);
          for (const item of hit?.items ?? []) absorbGapItem(merged, item);
        }
        for (const task of skipped) notes.push(`n/a — nicht abgefragt (Call-Limit): ${task.label}`);
        return reply(merged, notes, queriedTasks.length, list.length, skipped.length === 0);
      };
      if (parentsKnown) {
        const early = fromCache(tasks);
        if (early) return res.json(early);
      }
      if (products.length === 0 && shownProducts.length === 0 && cachedSecNames(ticker, now) === null) {
        const secNames = namesFromSecSegments(
          deps.secSegments
            ? await deps.secSegments(ticker, identity.companyName)
            : await fetchSecBusinessSegments(ticker, identity.companyName),
        );
        rememberSecNames(ticker, now, secNames);
        if (secNames.length > 0) products = secNames;
        tasks = gapTasks(products, regions, usd.revenues, order);
        const early = fromCache(tasks);
        if (early) return res.json(early);
      }
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (!takeGapSlot(ip, now, limit.max, limit.windowMs)) {
        return res.status(429).json({ error: "Zu viele Abfragen" });
      }
      if (rateBuckets.size > 2000) {
        const stale: string[] = [];
        rateBuckets.forEach((stamps, stampKey) => {
          const fresh = stamps.filter((at) => now - at < limit.windowMs);
          if (fresh.length === 0) stale.push(stampKey);
          else rateBuckets.set(stampKey, fresh);
        });
        for (let i = 0; i < stale.length; i++) rateBuckets.delete(stale[i]);
      }
      if (!deps.llm && !isLLMAvailable()) return res.status(503).json({ error: "n/a — KI nicht erreichbar" });
      const parentsUsd = [...products, ...regions].map((name) => ({
        name,
        revenueUsd: usd.revenues.get(fold(name)) ?? null,
      }));
      const queriedTasks = tasks.slice(0, SEGMENT_GAP_MAX_CALLS);
      const skipped = tasks.slice(SEGMENT_GAP_MAX_CALLS);
      const merged: SegmentGapItem[] = [];
      const notes: string[] = [];
      let transportFails = 0;
      let successes = 0;
      let fromCacheCount = 0;
      let budgetSkips = 0;
      for (const task of queriedTasks) {
        const key = parentCacheKey(ticker, task);
        const stored = freshParent(key, now);
        if (stored) {
          successes += 1;
          fromCacheCount += 1;
          if (stored.reason) notes.push(stored.reason);
          for (const item of stored.items) absorbGapItem(merged, item);
          continue;
        }
        if (openRouterHttpBudgetRemaining() === 0) {
          notes.push(`n/a — nicht abgefragt (Call-Limit): ${task.label}`);
          budgetSkips += 1;
          continue;
        }
        const attempt = await shareParentAttempt(key, async () => {
          const again = freshParent(key, now);
          if (again) return { ok: true, status: null, items: again.items, reason: again.reason, fromCache: true };
          let payload: unknown = null;
          let status: number | null = null;
          try {
            const result = await run({
              systemPrompt,
              prompt: segmentGapPrompt({
                ticker,
                companyName: identity.companyName,
                description: identity.description ?? "",
                products,
                regions,
                industry: identity.industry,
                sector: identity.sector,
                parentsUsd,
                fxNote: usd.fxNote,
                only: task.only,
              }),
              maxTokens: 800,
              temperature: 0.2,
              signal: AbortSignal.timeout(SEGMENT_CHILDREN_KI_TIMEOUT_MS),
            }) as { data?: unknown; status?: unknown } | null;
            payload = result?.data ?? null;
            if (payload == null) status = failureStatus({ status: result?.status });
          } catch (err) {
            payload = null;
            status = failureStatus(err);
          }
          if (payload == null) return { ok: false, status, items: [], reason: unreachableNote(task.label, status), fromCache: false };
          if (!outlineEchoMatches(payload, identity.companyName, identity.industry, identity.sector)) {
            return { ok: false, status: null, items: [], reason: OUTLINE_MISMATCH, fromCache: false };
          }
          const reviewed = reviewSegmentGaps(
            payload,
            task.only ? task.taskProducts : [],
            task.taskRegions,
            identity.companyName,
            ticker,
            identity.description ?? "",
            usd.revenues,
          );
          const ttl = task.placeholder && reviewed.items.length === 0 ? GAP_EMPTY_CACHE_MS : GAP_CACHE_MS;
          rememberGap(key, { at: now, ttl, body: { items: reviewed.items, reason: reviewed.reason } });
          return { ok: true, status: null, items: reviewed.items, reason: reviewed.reason, fromCache: false };
        });
        if (!attempt.ok) {
          if (attempt.reason === OUTLINE_MISMATCH) notes.push(OUTLINE_MISMATCH);
          else {
            transportFails += 1;
            notes.push(attempt.reason ?? unreachableNote(task.label, attempt.status));
          }
          continue;
        }
        successes += 1;
        if (attempt.fromCache) fromCacheCount += 1;
        if (attempt.reason) notes.push(attempt.reason);
        for (const item of attempt.items) absorbGapItem(merged, item);
      }
      for (const task of skipped) notes.push(`n/a — nicht abgefragt (Call-Limit): ${task.label}`);
      if (successes === 0 && transportFails === queriedTasks.length) {
        return res.status(503).json({ error: "n/a — KI nicht erreichbar" });
      }
      if (merged.length === 0 && notes.some((note) => note === OUTLINE_MISMATCH) && successes === 0) {
        return res.json({
          items: [],
          reason: OUTLINE_MISMATCH,
          promptVersion: SEGMENT_GAP_PROMPT_VERSION,
          cached: false,
          queried: queriedTasks.length,
          total: tasks.length,
        });
      }
      const cached = budgetSkips === 0 && fromCacheCount === queriedTasks.length && skipped.length === 0 && transportFails === 0;
      return res.json(reply(merged, notes, queriedTasks.length - budgetSkips, tasks.length, cached));
      });
    } catch {
      return res.status(502).json({ error: "n/a — fehlende Segmente nicht erreichbar" });
    }
  });
}
