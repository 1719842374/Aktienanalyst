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
import type { GoldNewsImpact, GoldNewsItem } from "../shared/gold-schema";
import { scoreHeadlineSentiment } from "./news-sentiment";

export const GOLD_NEWS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const GOLD_NEWS_CACHE_HOURS = 12;
const CACHE_KEY = "gold_news_impact_v1";

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

  if (items.length === 0) return emptyImpact("keine Gold-Meldungen", true, items);

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
  deps.cacheSet({
    storedAt: fresh?.storedAt ?? deps.now,
    items,
    attempted: true,
    flag,
    summary,
    updatedAt,
  });
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

let memoryCache: GoldNewsCacheEntry | null = null;

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
  });
  return { ...impact, items: enrichGoldNewsItems(impact.items) };
}
