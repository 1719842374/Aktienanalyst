/**
 * news-peers.ts
 * Google News RSS fetcher, news-to-catalyst matching, peer comparison via FMP.
 * Extracted from routes.ts (commit 1b386991) — zero logic changes.
 */

import type { Catalyst } from "../shared/schema";
import { fmpBatchQuote, fmpRatios } from "./fmp";
// parseMarkdownTable is no longer used here since the Perplexity Finance parser
// was removed — FMP peers are the sole peer source now.
// callFinanceToolThrottled kept only as a re-export target for legacy imports.

// ============================================================
// Google News RSS Parser
// ============================================================
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
    const result = dedupItems.slice(0, 10);
    console.log(`[NEWS] ${ticker}: ${result.length} items (${result.filter(i => i.lang === 'en').length} EN + ${result.filter(i => i.lang === 'de').length} DE)`);
    return result;
  } catch (err: any) { console.log(`[NEWS] Google News RSS failed for ${ticker}: ${err?.message?.substring(0, 150)}`); return []; }
}

// ============================================================
// News-to-Catalyst Matching (keyword-based)
// ============================================================
export async function matchNewsToCatalysts(
  newsItems: { title: string; source: string; pubDate: string; url: string; relativeTime: string; sentiment?: string; sentimentScore?: number; matchedCatalyst?: string; matchedCatalystIdx?: number }[],
  catalysts: Catalyst[],
  _ticker?: string,
  _companyName?: string
): Promise<void> {
  if (!newsItems.length || !catalysts.length) return;
  const BULLISH_WORDS = ['beat','surpass','record','growth','surge','rally','upgrade','buy','outperform','strong','profit','win','award','launch','expand','positive','exceed'];
  const BEARISH_WORDS = ['miss','fall','drop','decline','cut','downgrade','sell','underperform','weak','loss','fine','penalty','recall','delay','concern','risk','layoff','warn'];
  const CATALYST_KEYWORDS: Record<string, string[]> = {
    revenue: ['revenue','sales','growth','demand','order','backlog','booking'],
    margin: ['margin','cost','efficiency','operating','leverage','ebitda','profit'],
    'market share': ['market share','competitor','competition','customer','win','contract','displacement'],
    acquisition: ['acqui','merger','partner','deal','joint venture','alliance','agreement'],
    ai: ['ai','artificial intelligence','machine learning','automation','cloud','azure','copilot','llm'],
    product: ['product','launch','platform','cycle','version','upgrade','release','innovation'],
    defense: ['defense','military','contract','government','pentagon','nato','army','navy'],
    regulatory: ['fda','epa','sec','regulation','approve','approval','clearance','ruling'],
    energy: ['energy','solar','wind','battery','ev','electric','renewable','grid','power'],
    dividend: ['dividend','buyback','repurchase','shareholder','return','capital'],
    'interest rate': ['rate','fed','central bank','interest','yield','monetary'],
    demographic: ['demographic','aging','population','healthcare','biotech','drug','therapy'],
  };
  const catKeywords: string[][] = catalysts.map(cat => {
    const catName = cat.name.toLowerCase();
    const kws: string[] = catName.split(/[\s/()]+/).filter(w => w.length > 3);
    for (const [key, words] of Object.entries(CATALYST_KEYWORDS)) { if (catName.includes(key)) kws.push(...words); }
    return kws;
  });
  for (let i = 0; i < newsItems.length; i++) {
    const item = newsItems[i];
    const titleLower = ((item as any).title || (item as any).headline || '').toLowerCase();
    if (!titleLower) continue;
    const bullishHits = BULLISH_WORDS.filter(w => titleLower.includes(w)).length;
    const bearishHits = BEARISH_WORDS.filter(w => titleLower.includes(w)).length;
    const total = bullishHits + bearishHits;
    const rawScore = total > 0 ? (bullishHits - bearishHits) / total : 0;
    item.sentimentScore = Math.max(-1, Math.min(1, rawScore));
    item.sentiment = rawScore > 0.1 ? 'bullish' : rawScore < -0.1 ? 'bearish' : 'neutral';
    let bestCatIdx = -1, bestScore = 0;
    for (let ci = 0; ci < catalysts.length; ci++) {
      const hits = catKeywords[ci].filter(kw => titleLower.includes(kw)).length;
      if (hits > bestScore) { bestScore = hits; bestCatIdx = ci; }
    }
    if (bestCatIdx >= 0 && bestScore >= 1) { item.matchedCatalyst = catalysts[bestCatIdx].name; item.matchedCatalystIdx = bestCatIdx; }
    else if (Math.abs(rawScore) > 0.3 && catalysts.length > 0) { item.matchedCatalyst = catalysts[0].name; item.matchedCatalystIdx = 0; }
  }
  for (let i = 0; i < catalysts.length; i++) {
    const matched = newsItems.filter(n => n.matchedCatalystIdx === i);
    if (!matched.length) continue;
    const cat = catalysts[i];
    cat.newsCount = matched.length;
    cat.posOriginal = cat.pos;
    const avgScore = matched.reduce((s, n) => s + (n.sentimentScore || 0), 0) / matched.length;
    const bullish = matched.filter(n => n.sentiment === 'bullish').length;
    const bearish = matched.filter(n => n.sentiment === 'bearish').length;
    cat.newsSentiment = (bullish > 0 && bearish > 0) ? 'mixed' : avgScore > 0.2 ? 'bullish' : avgScore < -0.2 ? 'bearish' : 'neutral';
    const adjustment = Math.round(avgScore * 5);
    cat.posAdjustment = adjustment;
    cat.pos = Math.max(10, Math.min(85, cat.pos + adjustment));
    cat.nettoUpside = +(cat.bruttoUpside * (1 - cat.einpreisungsgrad / 100)).toFixed(2);
    cat.gb = +(cat.pos / 100 * cat.nettoUpside).toFixed(2);
  }
  console.log(`[NEWS-MATCH] Keyword-matched ${newsItems.filter(n => n.matchedCatalystIdx != null).length}/${newsItems.length} news items to catalysts`);
}

// ============================================================
// Peer Comparison via FMP (fast path)
// ============================================================
// Peer comparison fed by FMP only. WORK_SCORING_VORLAGE / relative-valuation
// docs require every peer column to be populated when the data is available
// (per-share ratios are computed from FMP /ratios rows chronologically).
//
// Fields expected by the Rel. Bewertung section (Section 7):
//   subject: { ticker, name, pe, peg, ps, pb, epsGrowth1Y, epsGrowth5Y,
//              marketCap, revenueGrowth }
//   peers:   same shape
//   peerAvg: { pe, peg, ps, pb, epsGrowth1Y, epsGrowth5Y }
//
// The 5Y CAGR needs ≥6 annual ratio rows (start + 5 growth periods), the 1Y
// YoY needs 2 rows, so we fetch 6. FMP /stable/ratios returns rows sorted
// most-recent first.
export async function fetchPeerComparisonFromTickers(
  ticker: string,
  peerTickers: string[],
  pe: number,
  peg: number,
  revenue: number,
  marketCap: number,
  revenueGrowth: number,
  epsGrowth5Y: number,
  subjectExtras?: { pb?: number | null; epsGrowth1Y?: number | null }
): Promise<{ subject: any; peers: any[]; peerAvg: any } | null> {
  try {
    const [quotes, ratiosPerPeer] = await Promise.all([
      fmpBatchQuote(peerTickers),
      Promise.all(peerTickers.map(t => fmpRatios(t, 6).catch(() => []))),
    ]);
    const quoteByTicker = new Map<string, any>((quotes || []).map((q: any) => [q.symbol, q]));

    // Small helper to CAGR two same-unit per-share values across `years`.
    // Sign-safe: skips negatives (can't take fractional power of a negative).
    const cagr = (endValue: number | undefined, startValue: number | undefined, years: number): number | null => {
      if (!endValue || !startValue || years <= 0) return null;
      if (endValue <= 0 || startValue <= 0) return null;
      return +((Math.pow(endValue / startValue, 1 / years) - 1) * 100).toFixed(1);
    };

    const peers: any[] = [];
    peerTickers.forEach((t, idx) => {
      const q = quoteByTicker.get(t);
      const ratios: any[] = Array.isArray(ratiosPerPeer[idx]) ? ratiosPerPeer[idx] : [];
      const r0 = ratios[0]; const r1 = ratios[1];

      // Valuation multiples — prefer /ratios, fall back to quote-derived P/E.
      const peerPE = Number(r0?.priceToEarningsRatio ?? r0?.priceEarningsRatio ?? 0)
        || (q?.price && q?.eps > 0 ? q.price / q.eps : null);
      const peerPS = Number(r0?.priceToSalesRatio ?? 0) || null;
      const peerPB = Number(r0?.priceToBookRatio ?? 0) || null;

      // EPS 1Y YoY — uses netIncomePerShare (diluted EPS proxy).
      let epsGrowth1Y: number | null = null;
      if (r0?.netIncomePerShare != null && r1?.netIncomePerShare != null && r1.netIncomePerShare > 0) {
        epsGrowth1Y = +(((r0.netIncomePerShare / r1.netIncomePerShare) - 1) * 100).toFixed(1);
      }

      // EPS 5Y CAGR — needs 6 rows (start + 5 growth years). Ratios come newest
      // first, so oldest is the last element. Use up to 5-year lookback.
      let epsGrowth5Y_peer: number | null = null;
      if (ratios.length >= 3) {
        const endEps = r0?.netIncomePerShare;
        const lookback = Math.min(5, ratios.length - 1);
        const startEps = ratios[lookback]?.netIncomePerShare;
        epsGrowth5Y_peer = cagr(endEps, startEps, lookback);
      }

      // Revenue growth (YoY) — revenuePerShare is share-count-neutral.
      let revenueGrowthPeer: number | null = null;
      if (r0?.revenuePerShare != null && r1?.revenuePerShare != null && r1.revenuePerShare > 0) {
        revenueGrowthPeer = +(((r0.revenuePerShare / r1.revenuePerShare) - 1) * 100).toFixed(1);
      }

      // PEG for the peer: prefer forward-ish 1Y growth if positive, else 5Y CAGR.
      const growthForPEG = epsGrowth1Y && epsGrowth1Y > 0
        ? epsGrowth1Y
        : (epsGrowth5Y_peer && epsGrowth5Y_peer > 0 ? epsGrowth5Y_peer : (epsGrowth5Y > 0 ? epsGrowth5Y : null));
      const peerPEG = peerPE && growthForPEG && growthForPEG > 0
        ? +(peerPE / growthForPEG).toFixed(2)
        : null;

      if (!q && !r0) return;
      peers.push({
        ticker: t,
        name: q?.name || t,
        pe: peerPE ? +Number(peerPE).toFixed(1) : null,
        peg: peerPEG,
        ps: peerPS ? +Number(peerPS).toFixed(1) : null,
        pb: peerPB ? +Number(peerPB).toFixed(1) : null,
        epsGrowth1Y,
        epsGrowth5Y: epsGrowth5Y_peer,
        marketCap: q?.marketCap || null,
        revenueGrowth: revenueGrowthPeer,
      });
    });

    const validPeers = peers.filter(p => p.pe !== null || p.ps !== null || p.pb !== null).slice(0, 6);
    console.log(`[PEERS-FMP] Valid peers: ${validPeers.length}/${peers.length} (with growth series)`);
    if (validPeers.length === 0) return null;

    // Average helper: filters nulls/NaN and clamps to a sensible range so a
    // single outlier peer with pb=-153 doesn't destroy the peer-avg PB.
    const avg = (arr: (number | null)[], lo = -1000, hi = 1000): number | null => {
      const valid = arr.filter((v): v is number => v !== null && !isNaN(v) && isFinite(v) && v > lo && v < hi);
      return valid.length > 0 ? +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2) : null;
    };

    const ps = revenue > 0 && marketCap > 0 ? +(marketCap / revenue).toFixed(1) : null;
    const subject = {
      ticker,
      name: ticker,
      pe: pe > 0 ? +pe.toFixed(1) : null,
      peg: peg > 0 ? +peg.toFixed(2) : null,
      ps,
      pb: subjectExtras?.pb != null && subjectExtras.pb > 0 ? +Number(subjectExtras.pb).toFixed(1) : null,
      epsGrowth1Y: subjectExtras?.epsGrowth1Y != null && isFinite(subjectExtras.epsGrowth1Y) ? +Number(subjectExtras.epsGrowth1Y).toFixed(1) : null,
      epsGrowth5Y: epsGrowth5Y > 0 ? +epsGrowth5Y.toFixed(1) : null,
      marketCap,
      revenueGrowth: revenueGrowth ? +revenueGrowth.toFixed(1) : null,
    };
    const peerAvg = {
      pe: avg(validPeers.map(p => p.pe), 0, 500),
      peg: avg(validPeers.map(p => p.peg), 0, 20),
      ps: avg(validPeers.map(p => p.ps), 0, 100),
      // PB avg tolerates positives only — negative book value peers (DOCN) are outliers.
      pb: avg(validPeers.map(p => p.pb).map(v => v && v > 0 ? v : null), 0, 200),
      epsGrowth1Y: avg(validPeers.map(p => p.epsGrowth1Y), -100, 300),
      epsGrowth5Y: avg(validPeers.map(p => p.epsGrowth5Y), -100, 300),
    };
    return { subject, peers: validPeers, peerAvg };
  } catch (err: any) {
    console.error(`[PEERS-FMP] Failed for ${ticker}: ${err?.message?.substring(0, 150)}`);
    return null;
  }
}

// ============================================================
// Peer Comparison Fetcher (full path with EPS history)
// ============================================================
export async function fetchPeerComparison(
  ticker: string, companyName: string, pe: number, peg: number, revenue: number,
  marketCap: number, revenueGrowth: number, epsGrowth5Y: number,
  fmpPeerTickers: string[] = []
): Promise<{ subject: any; peers: any[]; peerAvg: any } | null> {
  try {
    if (fmpPeerTickers.length > 0) {
      console.log(`[PEERS] Using ${fmpPeerTickers.length} FMP peer tickers for ${ticker}`);
      return fetchPeerComparisonFromTickers(ticker, fmpPeerTickers, pe, peg, revenue, marketCap, revenueGrowth, epsGrowth5Y);
    }
    // Legacy fallback path used the Perplexity Finance external-tool to discover
    // peers when FMP peers were empty. That tool is gone — the FMP peer list
    // (fmpPeers) is the only source now. If it's empty, there's no peer view.
    console.log(`[PEERS] No FMP peer tickers for ${ticker} — skipping peer comparison`);
    return null;
  } catch (err: any) { console.log(`[PEERS] Failed for ${ticker}: ${err?.message?.substring(0, 200)}`); return null; }
}
