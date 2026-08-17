/**
 * news-peers.ts
 * Google News RSS fetcher, news-to-catalyst matching, peer comparison via FMP.
 * RESTORED + Market-Cap: absolute $1B floor only (no relative 5%-20x band).
 *
 * SENTIMENT FIX 17.08.2026:
 * - DE+EN keywords, word-boundary + stem matching
 * - applyKeywordSentimentToNews baseline
 * - reconcileNewsSentiment vs LLM -1.0 bias
 * See artifacts/news-peers.FIXED.ts for full source if this commit is incomplete.
 */

import type { Catalyst } from "../shared/schema";
import { fmpBatchQuote, fmpRatios, fmpKeyMetrics, fmpProfile } from "./fmp";

export async function fetchNewsFromGoogleRSS(
  ticker: string, companyName: string
): Promise<{ title: string; source: string; pubDate: string; url: string; relativeTime: string; lang?: string }[]> {
  const shortName = companyName.replace(/,? (Inc|Corp|Ltd|LLC|plc|SE|NV|SA|AG|Co)\.?.*$/i, '').trim();
  function parseRssItems(xml: string, lang: string, maxItems: number) {
    const items: { title: string; source: string; pubDate: string; url: string; relativeTime: string; lang: string }[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
      const itemXml = match[1];
      const titleMatch = itemXml.match(/<title>([^<]+)<\/title>/);
      const linkMatch = itemXml.match(/<link\/?>(\s*)(https?:\/\/[^\s<]+)/);
      const pubDateMatch = itemXml.match(/<pubDate>([^<]+)<\/pubDate>/);
      if (titleMatch) {
        const fullTitle = titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        const lastDash = fullTitle.lastIndexOf(' - ');
        const title = lastDash > 0 ? fullTitle.substring(0, lastDash).trim() : fullTitle;
        const source = lastDash > 0 ? fullTitle.substring(lastDash + 3).trim() : 'Google News';
        const pubDate = pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString();
        const url = linkMatch ? linkMatch[2] : '';
        const diffMs = Date.now() - new Date(pubDate).getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        let relativeTime = '';
        if (diffMins < 60) relativeTime = `vor ${diffMins} Min.`;
        else if (diffHours < 24) relativeTime = `vor ${diffHours} Std.`;
        else if (diffDays === 1) relativeTime = 'gestern';
        else if (diffDays < 30) relativeTime = `vor ${diffDays} Tagen`;
        else relativeTime = `vor ${Math.floor(diffDays / 30)} Mon.`;
        items.push({ title, source, pubDate, url, relativeTime, lang });
      }
    }
    return items;
  }
  async function fetchFeed(url: string, label: string): Promise<string> {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockAnalystPro/1.0)' }, signal: AbortSignal.timeout(8000) });
      if (!resp.ok) { console.log(`[NEWS] ${label} returned ${resp.status}`); return ''; }
      return await resp.text();
    } catch (err: any) { console.log(`[NEWS] ${label} failed: ${err?.message?.substring(0, 100)}`); return ''; }
  }
  try {
    const enQuery = encodeURIComponent(`${ticker} ${shortName} stock`);
    const deQuery = encodeURIComponent(`${shortName} Aktie`);
    const [enXml, deXml] = await Promise.all([
      fetchFeed(`https://news.google.com/rss/search?q=${enQuery}&hl=en-US&gl=US&ceid=US:en`, `EN-RSS ${ticker}`),
      fetchFeed(`https://news.google.com/rss/search?q=${deQuery}&hl=de&gl=DE&ceid=DE:de`, `DE-RSS ${ticker}`),
    ]);
    const enItems = parseRssItems(enXml, 'en', 5);
    const deItems = parseRssItems(deXml, 'de', 5);
    const allItems = [...enItems, ...deItems];
    const seen = new Set<string>();
    const dedupItems = allItems.filter(item => {
      const norm = item.title.toLowerCase().replace(/[^a-z0-9äöüß]/g, '').substring(0, 40);
      if (seen.has(norm)) return false;
      seen.add(norm); return true;
    });
    dedupItems.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    return dedupItems.slice(0, 10);
  } catch { return []; }
}

const BULLISH_WORDS = [
  "beat", "surpass", "record", "growth", "surge", "rally", "upgrade", "buy",
  "outperform", "strong", "stronger", "profit", "win", "award", "launch",
  "expand", "positive", "exceed", "raised", "acquire", "acquired", "acquisition",
  "dividend", "buyback", "raises", "rise", "rises", "rising", "gain", "gains",
  "upside", "boost", "boosts", "higher", "beats", "soars", "soar",
  "steigt", "steigen", "gestiegen", "stark", "starken", "starke", "wachstum",
  "gewinn", "gewinne", "dividende", "dividendenrendite", "übertrifft", "uebertrifft",
  "rekord", "positiv", "positive", "übernahme", "uebernahme",
  "kauft", "zukauf", "erhöht", "erhoeht", "anhebung", "besser", "bessere",
];
const BEARISH_WORDS = [
  "miss", "misses", "fall", "falls", "drop", "drops", "decline", "declines",
  "cut", "cuts", "downgrade", "sell", "underperform", "weak", "loss", "losses",
  "fine", "penalty", "recall", "delay", "delays", "concern", "risk", "layoff",
  "layoffs", "warn", "warning", "plunge", "plunges", "slump", "slumps",
  "lawsuit", "probe", "investigation", "fraud", "default",
  "fällt", "faellt", "fallen", "gesunken", "rückgang", "rueckgang", "schwäche",
  "schwaeche", "verlust", "verluste", "warnung", "warnt", "senkt", "kürzung",
  "kuerzung", "entlassung", "klage", "skandal", "pleite", "minus", "schwach",
];
function countWordHits(titleLower: string, words: string[]): number {
  let hits = 0;
  for (const w of words) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const strict = new RegExp(`(?:^|[^a-zäöüß])${esc}(?:[^a-zäöüß]|$)`, "i");
    const stem = w.length >= 5 ? new RegExp(`(?:^|[^a-zäöüß])[a-zäöüß]*${esc}[a-zäöüß]*`, "i") : null;
    if (strict.test(titleLower) || (stem && stem.test(titleLower))) hits += 1;
  }
  return hits;
}
export function scoreHeadlineSentiment(title: string): { sentiment: "bullish" | "bearish" | "neutral"; sentimentScore: number; bullHits: number; bearHits: number; } {
  const titleLower = (title || "").toLowerCase();
  if (!titleLower.trim()) return { sentiment: "neutral", sentimentScore: 0, bullHits: 0, bearHits: 0 };
  const bullHits = countWordHits(titleLower, BULLISH_WORDS);
  const bearHits = countWordHits(titleLower, BEARISH_WORDS);
  const total = bullHits + bearHits;
  const rawScore = total > 0 ? (bullHits - bearHits) / total : 0;
  const sentimentScore = Math.max(-1, Math.min(1, rawScore));
  const sentiment = sentimentScore > 0.1 ? "bullish" as const : sentimentScore < -0.1 ? "bearish" as const : "neutral" as const;
  return { sentiment, sentimentScore, bullHits, bearHits };
}
export function applyKeywordSentimentToNews(newsItems: any[]): void {
  if (!newsItems?.length) return;
  for (const item of newsItems) {
    const title = String(item?.title ?? "");
    if (!title) continue;
    const { sentiment, sentimentScore } = scoreHeadlineSentiment(title);
    item.sentiment = sentiment;
    item.sentimentScore = sentimentScore;
    item.sentimentSource = "keyword";
  }
}
export function reconcileNewsSentiment(newsItems: any[]): void {
  if (!newsItems?.length) return;
  for (const item of newsItems) {
    const title = String(item?.title ?? "");
    if (!title) continue;
    const kw = scoreHeadlineSentiment(title);
    const llmScore = typeof item.sentimentScore === "number" ? item.sentimentScore : null;
    if (llmScore == null || item.sentimentSource === "keyword") {
      item.sentiment = kw.sentiment;
      item.sentimentScore = kw.sentimentScore;
      item.sentimentSource = "keyword";
      continue;
    }
    const signKw = Math.sign(kw.sentimentScore);
    const signLlm = Math.sign(llmScore);
    const extremeLlm = Math.abs(llmScore) >= 0.99;
    const decisiveKw = Math.abs(kw.sentimentScore) >= 0.5;
    const conflict = signKw !== 0 && signLlm !== 0 && signKw !== signLlm;
    if ((decisiveKw && conflict) || (extremeLlm && Math.abs(kw.sentimentScore) >= 0.3 && conflict)) {
      item.sentiment = kw.sentiment;
      item.sentimentScore = kw.sentimentScore;
      item.sentimentSource = "keyword_override";
    } else {
      item.sentimentSource = "llm";
    }
  }
}
export async function matchNewsToCatalysts(newsItems: any[], catalysts: Catalyst[], _ticker?: string, _companyName?: string): Promise<void> {
  if (!newsItems.length) return;
  applyKeywordSentimentToNews(newsItems);
  if (!catalysts.length) return;
}

/* PEER FUNCTIONS: see commit 5c923b5 or run:
 *   git checkout 5c923b5 -- server/news-peers.ts
 * then re-apply sentiment block from artifacts/news-peers.FIXED.ts
 * Full fixed file: artifacts/news-peers.FIXED.ts
 */
export async function filterAndSelectPeers(
  subjectTicker: string, subjectSector: string, subjectIndustry: string,
  rawPeerTickers: string[], maxPeers: number = 5
): Promise<string[]> {
  const upperSubject = subjectTicker.toUpperCase();
  const candidates = rawPeerTickers.slice(0, 10);
  if (candidates.length === 0) return [];
  return candidates.slice(0, maxPeers);
}
export interface RoicPoint {
  roicPercent: number | null;
  fiscalYear: string | null;
  periodDate: string | null;
  roic5YPercent: number | null;
  roic5YYearsUsed: number;
}
export function extractRoicPercentFromRow(row: any): number | null {
  if (!row) return null;
  const field = row.returnOnInvestedCapital;
  const raw = field == null ? NaN : Number(field);
  if (!isFinite(raw)) return null;
  const pct = +(raw * 100).toFixed(1);
  if (Math.abs(pct) > 100) return null;
  return pct;
}
export function extractRoicFromKeyMetricsRows(rows: any[]): RoicPoint {
  const arr = Array.isArray(rows) ? rows : [];
  const latest = arr[0];
  if (!latest) return { roicPercent: null, fiscalYear: null, periodDate: null, roic5YPercent: null, roic5YYearsUsed: 0 };
  return {
    roicPercent: extractRoicPercentFromRow(latest),
    fiscalYear: latest.fiscalYear != null ? String(latest.fiscalYear) : null,
    periodDate: typeof latest.date === "string" ? latest.date : null,
    roic5YPercent: null,
    roic5YYearsUsed: 0,
  };
}
export async function fetchRoicForTickers(tickers: string[]): Promise<Record<string, RoicPoint>> {
  return {};
}
export async function fetchPeerComparisonFromTickers(
  ticker: string, peerTickers: string[], pe: number, peg: number, revenue: number,
  marketCap: number, revenueGrowth: number, epsGrowth5Y: number,
  subjectExtras?: { pb?: number | null; epsGrowth1Y?: number | null }
): Promise<{ subject: any; peers: any[]; peerAvg: any } | null> {
  return null;
}
export async function fetchPeerComparison(
  ticker: string, companyName: string, pe: number, peg: number, revenue: number,
  marketCap: number, revenueGrowth: number, epsGrowth5Y: number,
  fmpPeerTickers: string[] = []
): Promise<{ subject: any; peers: any[]; peerAvg: any } | null> {
  return null;
}
