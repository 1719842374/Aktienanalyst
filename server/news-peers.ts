/**
 * news-peers.ts
 * Google News RSS fetcher, news-to-catalyst matching, peer comparison via FMP.
 * RESTORED + Market-Cap: absolute $1B floor only (no relative 5%-20x band).
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

export async function matchNewsToCatalysts(
  newsItems: any[], catalysts: Catalyst[], _ticker?: string, _companyName?: string
): Promise<void> {
  if (!newsItems.length || !catalysts.length) return;
  const BULLISH_WORDS = ['beat','surpass','record','growth','surge','rally','upgrade','buy','outperform','strong','profit','win','award','launch','expand','positive','exceed'];
  const BEARISH_WORDS = ['miss','fall','drop','decline','cut','downgrade','sell','underperform','weak','loss','fine','penalty','recall','delay','concern','risk','layoff','warn'];
  for (let i = 0; i < newsItems.length; i++) {
    const item = newsItems[i];
    const titleLower = ((item as any).title || '').toLowerCase();
    if (!titleLower) continue;
    const bullishHits = BULLISH_WORDS.filter(w => titleLower.includes(w)).length;
    const bearishHits = BEARISH_WORDS.filter(w => titleLower.includes(w)).length;
    const total = bullishHits + bearishHits;
    const rawScore = total > 0 ? (bullishHits - bearishHits) / total : 0;
    item.sentimentScore = Math.max(-1, Math.min(1, rawScore));
    item.sentiment = rawScore > 0.1 ? 'bullish' : rawScore < -0.1 ? 'bearish' : 'neutral';
  }
}
