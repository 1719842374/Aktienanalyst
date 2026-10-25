/**
 * Future_10 §9 — Gold-News als leichter Hinweis.
 *
 * RSS: World Gold Council, Fed-Presse, Google News für Kitco und Reuters.
 * Das Flag kommt nur von OpenRouter und liegt in [−1, +1]. Ohne
 * OPENROUTER_API_KEY bleibt das Flag null. Es wird kein neutrales 0 erfunden.
 * Cache 12 h (oberes Ende der Spec-Spanne 6–12 h).
 *
 * Das Flag ist kein Summand der adaptiven Schicht.
 */
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { diskResearcherGetWithTtl, diskResearcherSet } from "./disk-cache";
import type { GoldNewsImpact, GoldNewsItem, GoldCentralBankBuying, GoldCentralBankPurchase } from "../shared/gold-schema";
import { scoreHeadlineSentiment } from "./news-sentiment";

export const GOLD_NEWS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const GOLD_NEWS_CACHE_HOURS = 12;
const CACHE_KEY = "gold_news_impact_v1";
// JOB 16b: letzter guter Wert (Flag aus OpenRouter + Meldungen), überlebt Neustarts über die Disk.
const LAST_GOOD_KEY = "gold_news_last_good_v1";
export const GOLD_NEWS_LAST_GOOD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Alle vier Feeds sind englische Ausgaben (gold.org, federalreserve.gov, Google News hl=en-US).
const FEEDS: { id: string; url: string; source: string; goldOnly: boolean; lang: "en" }[] = [
  { id: "wgc", url: "https://www.gold.org/rss.xml", source: "World Gold Council", goldOnly: false, lang: "en" },
  { id: "fed", url: "https://www.federalreserve.gov/feeds/press_all.xml", source: "Federal Reserve", goldOnly: true, lang: "en" },
  {
    id: "kitco",
    url: "https://news.google.com/rss/search?q=gold+site:kitco.com&hl=en-US&gl=US&ceid=US:en",
    source: "Kitco",
    goldOnly: false,
    lang: "en",
  },
  {
    id: "reuters",
    url: "https://news.google.com/rss/search?q=gold+site:reuters.com&hl=en-US&gl=US&ceid=US:en",
    source: "Reuters",
    goldOnly: false,
    lang: "en",
  },
];

export const FED_GOLD_PATTERN = /gold|inflation|fomc|interest rate|monetary|treasury|dollar/i;

export interface GoldNewsCacheEntry {
  storedAt: number;
  items: GoldNewsItem[];
  attempted: boolean;
  flag: number | null;
  summary: string | null;
  updatedAt: string | null;
}

export interface GoldNewsDeps {
  now: number;
  llmAvailable: boolean;
  fetchItems: () => Promise<GoldNewsItem[]>;
  complete: (headlines: string[]) => Promise<unknown>;
  cacheGet: () => GoldNewsCacheEntry | null;
  cacheSet: (entry: GoldNewsCacheEntry) => void;
  /** JOB 16b: letzter guter Wert (nur Läufe mit Meldungen und belastbarem Flag). */
  lastGoodGet?: () => GoldNewsCacheEntry | null;
  lastGoodSet?: (entry: GoldNewsCacheEntry) => void;
}

export function interpretGoldNewsLlm(
  data: unknown,
  llmAvailable: boolean,
): { flag: number | null; summary: string | null; reason: string | null } {
  if (!llmAvailable) return { flag: null, summary: null, reason: "OPENROUTER_API_KEY fehlt" };
  const record = data && typeof data === "object" ? data as { flag?: unknown; summary?: unknown } : {};
  const numeric = typeof record.flag === "number" ? record.flag : Number(record.flag);
  if (!Number.isFinite(numeric)) {
    return { flag: null, summary: null, reason: "OpenRouter ohne belastbares Flag" };
  }
  const summary = typeof record.summary === "string" && record.summary.trim() ? record.summary.trim() : null;
  return {
    flag: Math.max(-1, Math.min(1, numeric)),
    summary,
    reason: summary ? null : "OpenRouter ohne Zusammenfassung",
  };
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

export function parseGoldRssItems(xml: string, sourceFallback: string, maxItems: number): GoldNewsItem[] {
  const items: GoldNewsItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
    const itemXml = match[1];
    const titleRaw = itemXml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const title = decodeXml(titleRaw);
    if (!title) continue;
    const link = itemXml.match(/<link[^>]*>(\s*)(https?:\/\/[^\s<]+)/i)?.[2]
      ?? itemXml.match(/<link[^>]*href="(https?:\/\/[^"]+)"/i)?.[1]
      ?? "";
    const pubRaw = itemXml.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1]
      ?? itemXml.match(/<dc:date>([^<]+)<\/dc:date>/i)?.[1]
      ?? "";
    const parsedDate = pubRaw ? new Date(pubRaw) : null;
    const pubDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : "";
    const lastDash = title.lastIndexOf(" - ");
    const headline = lastDash > 0 ? title.slice(0, lastDash).trim() : title;
    const source = lastDash > 0 ? title.slice(lastDash + 3).trim() : sourceFallback;
    items.push({ title: headline, source, url: link, pubDate });
  }
  return items;
}

async function fetchFeed(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; StockAnalystPro/1.0)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return "";
  return response.text();
}

export async function fetchGoldNewsItems(): Promise<GoldNewsItem[]> {
  const batches = await Promise.all(FEEDS.map(async feed => {
    try {
      const xml = await fetchFeed(feed.url);
      let items = parseGoldRssItems(xml, feed.source, 5).map(item => ({ ...item, lang: feed.lang }));
      if (feed.goldOnly) items = items.filter(item => FED_GOLD_PATTERN.test(`${item.title} ${item.source}`));
      return items;
    } catch (err: any) {
      console.warn(`[GOLD-NEWS] ${feed.id} fehlgeschlagen: ${err?.message?.substring(0, 120)}`);
      return [];
    }
  }));
  const seen = new Set<string>();
  const merged: GoldNewsItem[] = [];
  for (const item of batches.flat()) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 48);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  merged.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
  return merged.slice(0, 8);
}

function newsPrompt(headlines: string[]): string {
  return `Aktuelle Gold-relevante News:
${headlines.slice(0, 8).map((headline, index) => `${index + 1}. ${headline}`).join("\n")}

Bewerte den Gesamteinfluss auf Gold:
- flag: -1 (bearish) bis +1 (bullish), 0 = neutral
- summary: 1-2 Sätze Begründung

Antworte nur als JSON:
{ "flag": 0.0, "summary": "..." }`;
}

async function completeGoldNewsFlag(headlines: string[]): Promise<unknown> {
  const result = await callLLMJson({
    prompt: newsPrompt(headlines),
    temperature: 0.2,
    maxTokens: 400,
    systemPrompt: "Du bewertest nur den Einfluss der gelieferten Meldungen auf Gold. Antworte als JSON mit flag und summary.",
  });
  return result?.data ?? null;
}

function emptyImpact(reason: string, llmAvailable: boolean, items: GoldNewsItem[]): GoldNewsImpact {
  return {
    flag: null,
    summary: null,
    updatedAt: null,
    llmAvailable,
    unavailableReason: reason,
    items,
    cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
  };
}

export async function loadGoldNewsImpact(deps: GoldNewsDeps): Promise<GoldNewsImpact> {
  const cached = deps.cacheGet();
  const fresh = cached && deps.now - cached.storedAt < GOLD_NEWS_CACHE_TTL_MS ? cached : null;
  let items = fresh?.items ?? [];
  if (!fresh) {
    try {
      items = await deps.fetchItems();
    } catch (err: any) {
      console.warn(`[GOLD-NEWS] Abruf fehlgeschlagen: ${err?.message?.substring(0, 160)}`);
      items = [];
    }
  }

  if (fresh?.attempted) {
    return {
      flag: fresh.flag,
      summary: fresh.summary,
      updatedAt: fresh.updatedAt,
      llmAvailable: deps.llmAvailable,
      unavailableReason: fresh.flag == null ? (fresh.summary ? null : "OpenRouter ohne belastbares Flag") : null,
      items,
      cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
    };
  }

  if (!deps.llmAvailable) {
    if (items.length > 0) {
      deps.cacheSet({
        storedAt: fresh?.storedAt ?? deps.now,
        items,
        attempted: false,
        flag: null,
        summary: null,
        updatedAt: null,
      });
    }
    return emptyImpact("OPENROUTER_API_KEY fehlt", false, items);
  }

  // JOB 16b: leere oder gescheiterte Läufe werden nie gecacht; stattdessen letzter guter Wert.
  const lastGoodOr = (reason: string, fallback: GoldNewsImpact): GoldNewsImpact => {
    const good = deps.lastGoodGet?.() ?? null;
    if (!good || good.flag == null) return fallback;
    return {
      flag: good.flag,
      summary: good.summary,
      updatedAt: good.updatedAt,
      llmAvailable: true,
      unavailableReason: null,
      items: good.items,
      cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
      lastGood: true,
      lastGoodReason: reason,
    };
  };

  if (items.length === 0) return lastGoodOr("keine Gold-Meldungen", emptyImpact("keine Gold-Meldungen", true, items));

  let flag: number | null = null;
  let summary: string | null = null;
  let reason: string | null = null;
  try {
    const raw = await deps.complete(items.slice(0, 8).map(item => item.title));
    const parsed = interpretGoldNewsLlm(raw, true);
    flag = parsed.flag;
    summary = parsed.summary;
    reason = parsed.reason;
  } catch (err: any) {
    reason = `OpenRouter fehlgeschlagen: ${err?.message?.substring(0, 120) ?? "unbekannt"}`;
  }

  const updatedAt = flag != null ? new Date(deps.now).toISOString() : null;
  if (flag == null) {
    return lastGoodOr(reason ?? "OpenRouter ohne belastbares Flag", {
      flag, summary, updatedAt, llmAvailable: true, unavailableReason: reason, items, cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
    });
  }
  const entry: GoldNewsCacheEntry = {
    storedAt: fresh?.storedAt ?? deps.now,
    items,
    attempted: true,
    flag,
    summary,
    updatedAt,
  };
  deps.cacheSet(entry);
  deps.lastGoodSet?.({ ...entry, storedAt: deps.now });
  return {
    flag,
    summary,
    updatedAt,
    llmAvailable: true,
    unavailableReason: reason,
    items,
    cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
  };
}

/**
 * Anzeige-Felder je Meldung: Keyword-Sentiment (gleiche Logik wie Aktien-News) und Sprache.
 * Ändert weder das LLM-Flag noch die Schlagzeilen für den Prompt; das Flag bleibt der einzige
 * News-Wert, der in die adaptive Schicht geht. Fehlende Sprache bleibt null (n/a), nicht geraten.
 */
export function enrichGoldNewsItems(items: GoldNewsItem[]): GoldNewsItem[] {
  return items.map(item => {
    const { sentiment, sentimentScore } = scoreHeadlineSentiment(item.title);
    return { ...item, lang: item.lang ?? null, sentiment, sentimentScore, sentimentSource: "keyword" as const };
  });
}

/** Stabschef 11.10.: ein letzter guter Wert älter als 24 h zählt nicht mehr für den Score. */
export const GOLD_NEWS_LAST_GOOD_SCORE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Flag für die Score-Berechnung. Aktuelle Werte unverändert; ein letzter guter Wert nur bis
 * einschließlich 24 h nach updatedAt, danach null (Anzeige bleibt „Letzter guter Stand vom …“).
 */
export function goldNewsScoreFlag(impact: GoldNewsImpact | null | undefined, now: number): number | null {
  if (!impact || impact.flag == null) return null;
  if (!impact.lastGood) return impact.flag;
  const t = impact.updatedAt ? Date.parse(impact.updatedAt) : NaN;
  if (!Number.isFinite(t)) return null;
  return now - t <= GOLD_NEWS_LAST_GOOD_SCORE_MAX_AGE_MS ? impact.flag : null;
}

let memoryCache: GoldNewsCacheEntry | null = null;
let memoryLastGood: GoldNewsCacheEntry | null = null;

export async function getGoldNewsImpact(): Promise<GoldNewsImpact> {
  const impact = await loadGoldNewsImpact({
    now: Date.now(),
    llmAvailable: isLLMAvailable(),
    fetchItems: fetchGoldNewsItems,
    complete: completeGoldNewsFlag,
    cacheGet: () => {
      if (memoryCache && Date.now() - memoryCache.storedAt < GOLD_NEWS_CACHE_TTL_MS) return memoryCache;
      const disk = diskResearcherGetWithTtl(CACHE_KEY, GOLD_NEWS_CACHE_TTL_MS);
      if (!disk || !disk.data || !Array.isArray(disk.data.items)) return null;
      memoryCache = { ...(disk.data as GoldNewsCacheEntry), storedAt: disk.storedAt };
      return memoryCache;
    },
    cacheSet: entry => {
      memoryCache = entry;
      try { diskResearcherSet(CACHE_KEY, entry); } catch { /* Disk ist der Backstop */ }
    },
    lastGoodGet: () => {
      if (memoryLastGood) return memoryLastGood;
      const disk = diskResearcherGetWithTtl(LAST_GOOD_KEY, GOLD_NEWS_LAST_GOOD_TTL_MS);
      if (!disk || !disk.data || !Array.isArray(disk.data.items)) return null;
      memoryLastGood = { ...(disk.data as GoldNewsCacheEntry), storedAt: disk.storedAt };
      return memoryLastGood;
    },
    lastGoodSet: entry => {
      memoryLastGood = entry;
      try { diskResearcherSet(LAST_GOOD_KEY, entry); } catch { /* Disk ist der Backstop */ }
    },
  });
  let centralBankBuying: GoldCentralBankBuying | null;
  try {
    centralBankBuying = await getCentralBankGoldBuying();
  } catch (err: any) {
    centralBankBuying = emptyCb(`Abruf fehlgeschlagen: ${err?.message?.substring(0, 120) ?? "unbekannt"}`);
  }
  // F10-34: nur Anzeige. flag/summary/items oben bleiben unverändert, goldNewsScoreFlag liest nur flag.
  return { ...impact, items: enrichGoldNewsItems(impact.items), centralBankBuying };
}

// ─── F10-34 (Future_10 §11): Zentralbank-Goldkäufe Europa/global per LLM ───────────────────────
// Nur Anzeige in der Gold-News-Sektion. Kein News-Flag, kein GIS, kein Score.
// Das LLM darf nur aus den gelieferten Meldungen zitieren. Quelle, URL und Datum kommen aus dem Feed,
// nicht vom LLM. Tonnen gelten nur, wenn die Zahl wörtlich in der zitierten Schlagzeile steht.

export const GOLD_CB_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CB_CACHE_KEY = "gold_cb_buying_v1";
const CB_FEEDS: { id: string; url: string; source: string }[] = [
  {
    id: "cb-global",
    url: "https://news.google.com/rss/search?q=%22central+bank%22+gold+purchases+OR+buying+OR+reserves+tonnes&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
  },
  {
    id: "cb-europe",
    url: "https://news.google.com/rss/search?q=gold+reserves+(ECB+OR+Bundesbank+OR+%22National+Bank+of+Poland%22+OR+%22Czech+National+Bank%22+OR+%22Banca+d%27Italia%22)&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
  },
];

export function centralBankPrompt(headlines: string[]): string {
  return `Gold-Meldungen (nummeriert, mit Datum und Quelle):
${headlines.map((headline, index) => `${index + 1}. ${headline}`).join("\n")}

Aufgabe: Liste nur Käufe oder Verkäufe von Gold durch Zentralbanken (Europa und global), die in diesen Meldungen ausdrücklich genannt werden.
Regeln:
- item: Nummer der Meldung, aus der der Eintrag stammt (Pflicht).
- institution: Zentralbank oder Land, wie in der Meldung genannt.
- direction: "buy" oder "sell".
- tonnes: nur, wenn die Tonnenzahl in der Meldung steht, sonst null. Nichts schätzen, nichts umrechnen.
- period: Zeitraum laut Meldung (z. B. "September 2026"), sonst null.
- Keine Meldung passt: leere Liste.

Antworte nur als JSON:
{ "entries": [ { "item": 1, "institution": "...", "direction": "buy", "tonnes": null, "period": null } ] }`;
}

export interface CbDeps {
  now: number;
  llmAvailable: boolean;
  fetchItems: () => Promise<GoldNewsItem[]>;
  complete: (headlines: string[]) => Promise<unknown>;
  cacheGet: () => GoldCentralBankBuying | null;
  cacheSet: (value: GoldCentralBankBuying) => void;
}

function emptyCb(reason: string): GoldCentralBankBuying {
  return { entries: [], updatedAt: null, unavailableReason: reason, discarded: 0, cacheTtlHours: GOLD_NEWS_CACHE_HOURS };
}

/** Zahl steht wörtlich in der Schlagzeile (z. B. "12", "12.5", "1,000", "1.000")? */
export function numberInText(value: number, text: string): boolean {
  const matches = text.match(/\d[\d.,]*/g) ?? [];
  return matches.some(raw => {
    const t = raw.replace(/[.,]$/, "");
    const candidates = [Number(t.replace(/,/g, "")), Number(t.replace(/\./g, "").replace(/,/g, ".")), Number(t.replace(/,/g, "."))];
    return candidates.some(c => Number.isFinite(c) && Math.abs(c - value) < 1e-9);
  });
}

/** Schema-Prüfung der LLM-Antwort gegen die gelieferten Meldungen. Ungültige Einträge werden verworfen. */
export function validateCentralBankLlm(
  data: unknown,
  items: GoldNewsItem[],
): { entries: GoldCentralBankPurchase[]; discarded: number; reason: string | null } {
  const record = data && typeof data === "object" ? data as { entries?: unknown } : null;
  if (!record || !Array.isArray(record.entries)) {
    return { entries: [], discarded: 0, reason: "OpenRouter ohne gültige Antwort (entries fehlt)" };
  }
  const entries: GoldCentralBankPurchase[] = [];
  let discarded = 0;
  const seen = new Set<string>();
  for (const raw of record.entries) {
    const e = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
    const idx = e && typeof e.item === "number" && Number.isInteger(e.item) ? e.item - 1 : -1;
    const item = idx >= 0 && idx < items.length ? items[idx] : null;
    const institution = typeof e?.institution === "string" ? e.institution.trim() : "";
    const direction = e?.direction === "buy" || e?.direction === "sell" ? e.direction : null;
    const tonnesRaw = e?.tonnes;
    const tonnesOk = tonnesRaw == null
      || (typeof tonnesRaw === "number" && Number.isFinite(tonnesRaw) && tonnesRaw > 0 && !!item && numberInText(tonnesRaw, item.title));
    const period = typeof e?.period === "string" && e.period.trim() ? e.period.trim().slice(0, 40) : null;
    if (!item || !item.pubDate || !item.source || !item.url || !institution || institution.length > 80 || !direction || !tonnesOk) {
      discarded++;
      continue;
    }
    const key = `${idx}|${institution.toLowerCase()}|${direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      institution,
      direction,
      tonnes: typeof tonnesRaw === "number" ? tonnesRaw : null,
      period,
      sourceTitle: item.title,
      source: item.source,
      url: item.url,
      date: item.pubDate,
    });
  }
  return { entries, discarded, reason: entries.length === 0 ? "keine belegten Zentralbank-Käufe in den Meldungen" : null };
}

export async function loadCentralBankGoldBuying(deps: CbDeps): Promise<GoldCentralBankBuying> {
  const cached = deps.cacheGet();
  if (cached && cached.updatedAt && deps.now - Date.parse(cached.updatedAt) < GOLD_CB_CACHE_TTL_MS) return cached;
  if (!deps.llmAvailable) return emptyCb("OPENROUTER_API_KEY fehlt");
  let items: GoldNewsItem[] = [];
  try { items = (await deps.fetchItems()).filter(item => item.pubDate && item.source && item.url).slice(0, 10); } catch { items = []; }
  if (items.length === 0) return emptyCb("keine Zentralbank-Meldungen abrufbar");
  let raw: unknown = null;
  try {
    raw = await deps.complete(items.map(item => `${item.pubDate.slice(0, 10)} | ${item.source} | ${item.title}`));
  } catch (err: any) {
    return emptyCb(`OpenRouter fehlgeschlagen: ${err?.message?.substring(0, 120) ?? "unbekannt"}`);
  }
  if (raw == null) return emptyCb("OpenRouter ohne Antwort");
  const v = validateCentralBankLlm(raw, items);
  const out: GoldCentralBankBuying = {
    entries: v.entries,
    updatedAt: new Date(deps.now).toISOString(),
    unavailableReason: v.reason,
    discarded: v.discarded,
    cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
  };
  // Nur gültige Antworten cachen (auch „keine belegten Käufe“ ist eine gültige Antwort).
  deps.cacheSet(out);
  return out;
}

async function fetchCentralBankItems(): Promise<GoldNewsItem[]> {
  const batches = await Promise.all(CB_FEEDS.map(async feed => {
    try {
      return parseGoldRssItems(await fetchFeed(feed.url), feed.source, 8);
    } catch (err: any) {
      console.warn(`[GOLD-CB] ${feed.id} fehlgeschlagen: ${err?.message?.substring(0, 120)}`);
      return [];
    }
  }));
  const seen = new Set<string>();
  const merged: GoldNewsItem[] = [];
  for (const item of batches.flat()) {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 48);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  merged.sort((a, b) => (b.pubDate || "").localeCompare(a.pubDate || ""));
  return merged;
}

async function completeCentralBank(headlines: string[]): Promise<unknown> {
  const result = await callLLMJson({
    prompt: centralBankPrompt(headlines),
    temperature: 0,
    maxTokens: 600,
    systemPrompt: "Du extrahierst nur ausdrücklich genannte Zentralbank-Goldkäufe aus den gelieferten Meldungen. Nichts erfinden. Antworte als JSON mit entries.",
  });
  return result?.data ?? null;
}

let memoryCb: GoldCentralBankBuying | null = null;

export async function getCentralBankGoldBuying(): Promise<GoldCentralBankBuying> {
  return loadCentralBankGoldBuying({
    now: Date.now(),
    llmAvailable: isLLMAvailable(),
    fetchItems: fetchCentralBankItems,
    complete: completeCentralBank,
    cacheGet: () => {
      if (memoryCb) return memoryCb;
      const disk = diskResearcherGetWithTtl(CB_CACHE_KEY, GOLD_CB_CACHE_TTL_MS);
      if (!disk || !disk.data || !Array.isArray(disk.data.entries)) return null;
      memoryCb = disk.data as GoldCentralBankBuying;
      return memoryCb;
    },
    cacheSet: value => {
      memoryCb = value;
      try { diskResearcherSet(CB_CACHE_KEY, value); } catch { /* Disk ist der Backstop */ }
    },
  });
}
