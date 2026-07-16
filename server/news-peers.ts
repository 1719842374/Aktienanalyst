/**
 * news-peers.ts
 * Google News RSS fetcher, news-to-catalyst matching, peer comparison via FMP.
 * Extracted from routes.ts (commit 1b386991) — zero logic changes.
 */

import type { Catalyst } from "../shared/schema";
import { fmpBatchQuote, fmpRatios } from "./fmp";
import { parseMarkdownTable, callFinanceToolThrottled } from "./analyze-helpers";

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
export async function fetchPeerComparisonFromTickers(
  ticker: string, peerTickers: string[], pe: number, peg: number, revenue: number,
  marketCap: number, revenueGrowth: number, epsGrowth5Y: number
): Promise<{ subject: any; peers: any[]; peerAvg: any } | null> {
  try {
    const [quotes, ratiosPerPeer] = await Promise.all([
      fmpBatchQuote(peerTickers),
      Promise.all(peerTickers.map(t => fmpRatios(t, 2).catch(() => []))),
    ]);
    const quoteByTicker = new Map<string, any>((quotes || []).map((q: any) => [q.symbol, q]));
    const peers: any[] = [];
    peerTickers.forEach((t, idx) => {
      const q = quoteByTicker.get(t);
      const ratios: any[] = ratiosPerPeer[idx] || [];
      const r0 = ratios[0]; const r1 = ratios[1];
      const peerPE = Number(r0?.priceToEarningsRatio ?? r0?.priceEarningsRatio ?? 0) || (q?.price && q?.eps > 0 ? q.price / q.eps : null);
      const peerPS = Number(r0?.priceToSalesRatio ?? 0) || null;
      const peerPB = Number(r0?.priceToBookRatio ?? 0) || null;
      let epsGrowth1Y: number | null = null;
      if (r0?.netIncomePerShare && r1?.netIncomePerShare && r1.netIncomePerShare > 0) epsGrowth1Y = +(((r0.netIncomePerShare / r1.netIncomePerShare) - 1) * 100).toFixed(1);
      const growthForPEG = epsGrowth1Y && epsGrowth1Y > 0 ? epsGrowth1Y : (epsGrowth5Y > 0 ? epsGrowth5Y : null);
      const peerPEG = peerPE && growthForPEG && growthForPEG > 0 ? +(peerPE / growthForPEG).toFixed(2) : null;
      if (!q && !r0) return;
      peers.push({ ticker: t, name: q?.name || t, pe: peerPE ? +Number(peerPE).toFixed(1) : null, peg: peerPEG, ps: peerPS ? +Number(peerPS).toFixed(1) : null, pb: peerPB ? +Number(peerPB).toFixed(1) : null, epsGrowth1Y, epsGrowth5Y: null, marketCap: q?.marketCap || null, revenueGrowth: null });
    });
    const validPeers = peers.filter(p => p.pe !== null || p.ps !== null || p.pb !== null).slice(0, 6);
    console.log(`[PEERS-FMP] Valid peers: ${validPeers.length}/${peers.length}`);
    if (validPeers.length === 0) return null;
    const avg = (arr: (number | null)[]): number | null => { const valid = arr.filter((v): v is number => v !== null && !isNaN(v) && isFinite(v) && v > 0 && v < 1000); return valid.length > 0 ? +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2) : null; };
    const ps = revenue > 0 && marketCap > 0 ? +(marketCap / revenue).toFixed(1) : null;
    const subject = { ticker, name: ticker, pe: pe > 0 ? +pe.toFixed(1) : null, peg: peg > 0 ? +peg.toFixed(2) : null, ps, pb: null as number | null, epsGrowth1Y: null as number | null, epsGrowth5Y: epsGrowth5Y > 0 ? +epsGrowth5Y.toFixed(1) : null, marketCap, revenueGrowth: +revenueGrowth.toFixed(1) };
    const peerAvg = { pe: avg(validPeers.map(p => p.pe)), peg: avg(validPeers.map(p => p.peg)), ps: avg(validPeers.map(p => p.ps)), pb: avg(validPeers.map(p => p.pb)), epsGrowth1Y: avg(validPeers.map(p => p.epsGrowth1Y)), epsGrowth5Y: avg(validPeers.map(p => p.epsGrowth5Y)) };
    return { subject, peers: validPeers, peerAvg };
  } catch (err: any) { console.error(`[PEERS-FMP] Failed for ${ticker}: ${err?.message?.substring(0, 150)}`); return null; }
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
    console.log(`[PEERS] Fetching peers for ${ticker}`);
    const peersResult = await callFinanceToolThrottled('finance_company_peers', { ticker_symbol: ticker, query: `Competitors of ${companyName}`, action: `Finding peer companies for ${ticker}` }, { maxRetries: 1 });
    let peerTickers: string[] = [];
    if (peersResult?.content) {
      const content = typeof peersResult.content === 'string' ? peersResult.content : JSON.stringify(peersResult.content);
      const tickerMatches = content.match(/\b[A-Z]{1,5}(?:\.[A-Z]{1,2})?\b/g) || [];
      const skipWords = new Set(['THE','AND','FOR','USD','ETF','CEO','CFO','IPO','NYSE','NASDAQ','SEC','INC','LTD','LLC','NV','SA','AG','PLC','SE','CO','PEER','VS','EPS','PE','PEG','CTO','COO','CMO','CIO','CPO','EVP','SVP','NIM','ROE','ROA','ROI','ROIC','FCF','TTM','LTM','YTD','EBITDA','DCF','IRR','NPV','WACC','EUR','GBP','JPY','CHF','CAD','AUD','HKD','CNY','KRW','AI','ML','API','B2B','B2C','FTC','DOJ','GAAP','IFRS','Q1','Q2','Q3','Q4','H1','H2','FY','PT','TP','BUY','SELL','HOLD','OW','UW','EW','OP','LOW','HIGH','MAX','MIN', ticker]);
      peerTickers = [...new Set(tickerMatches.filter(t => t.length >= 2 && !skipWords.has(t)))].slice(0, 8);
    }
    if (peerTickers.length === 0) { console.log(`[PEERS] No peers found for ${ticker}`); return null; }
    console.log(`[PEERS] Found peers for ${ticker}: ${peerTickers.join(', ')}`);

    const ratioIds = ['ratio_price_to_earnings', 'ratio_price_to_sales', 'ratio_price_to_book', 'ratio_diluted_eps', 'calculated_market_cap'];
    const [ratiosResult, quotesResult] = await Promise.all([
      callFinanceToolThrottled('finance_company_ratios', { ticker_symbols: peerTickers, ratio_ids: ratioIds }, { maxRetries: 1 }),
      callFinanceToolThrottled('finance_quotes', { ticker_symbols: peerTickers, fields: ['pe', 'marketCap', 'eps', 'price'] }, { maxRetries: 1 }),
    ]);

    const peerData: Map<string, any> = new Map();
    if (ratiosResult?.content) {
      const content = typeof ratiosResult.content === 'string' ? ratiosResult.content : JSON.stringify(ratiosResult.content);
      const sections = content.split(/##\s+/);
      for (const section of sections) {
        if (!section.trim()) continue;
        const headerMatch = section.match(/^([A-Z]{1,6})(?:\.[A-Z]{1,2})?\s/);
        if (!headerMatch) continue;
        const t = headerMatch[1];
        if (!peerData.has(t)) peerData.set(t, { epsHistory: [] as { date: string; eps: number }[] });
        const d = peerData.get(t)!;
        const rows = parseMarkdownTable(section);
        const metricBuckets: Record<string, { date: string; value: number }[]> = { pe: [], ps: [], pb: [], marketCap: [], eps: [] };
        for (const row of rows) {
          const date = row['date'] || '';
          for (const [key, val] of Object.entries(row)) {
            const kl = key.toLowerCase();
            const num = parseFloat(String(val).replace(/[,$%]/g, ''));
            if (isNaN(num)) continue;
            if (kl.includes('price_to_earnings') || kl.includes('p/e')) metricBuckets.pe.push({ date, value: num });
            else if (kl.includes('price_to_sales') || kl.includes('p/s')) metricBuckets.ps.push({ date, value: num });
            else if (kl.includes('price_to_book') || kl.includes('p/b')) metricBuckets.pb.push({ date, value: num });
            else if (kl.includes('market_cap') || kl.includes('marketcap')) metricBuckets.marketCap.push({ date, value: num });
            else if (kl.includes('diluted_eps') || kl.includes('eps')) { metricBuckets.eps.push({ date, value: num }); if (date && num !== 0) d.epsHistory.push({ date, eps: num }); }
          }
        }
        const pickLatest = (bucket: { date: string; value: number }[]): number | undefined => {
          const valid = bucket.filter(x => x.value !== 0 && x.date);
          if (!valid.length) { const anyVal = bucket.find(x => x.value !== 0); return anyVal?.value; }
          valid.sort((a, b) => b.date.localeCompare(a.date)); return valid[0].value;
        };
        const lPE = pickLatest(metricBuckets.pe); const lPS = pickLatest(metricBuckets.ps);
        const lPB = pickLatest(metricBuckets.pb); const lMcap = pickLatest(metricBuckets.marketCap);
        const lEPS = pickLatest(metricBuckets.eps);
        if (lPE !== undefined) d.pe = lPE; if (lPS !== undefined) d.ps = lPS;
        if (lPB !== undefined) d.pb = lPB; if (lMcap !== undefined) d.marketCap = lMcap;
        if (lEPS !== undefined) d.eps = lEPS;
      }
    }
    if (quotesResult?.content) {
      const qContent = typeof quotesResult.content === 'string' ? quotesResult.content : JSON.stringify(quotesResult.content);
      for (const section of qContent.split(/##\s+/)) {
        if (!section.trim()) continue;
        const qHeader = section.match(/^([A-Z]{1,6})(?:\.[A-Z]{1,2})?\s+Quote/);
        if (!qHeader) continue;
        const t = qHeader[1];
        if (!peerData.has(t)) peerData.set(t, { epsHistory: [] as any[] });
        const d = peerData.get(t)!;
        for (const row of parseMarkdownTable(section)) {
          for (const [key, val] of Object.entries(row)) {
            const kl = key.toLowerCase(); const rawStr = String(val).trim();
            const num = parseFloat(rawStr.replace(/[,$%]/g, ''));
            if (kl === 'pe' || kl === 'p/e') { if (!isNaN(num) && num > 0) d.pe = num; }
            else if (kl.includes('marketcap') || kl.includes('market_cap') || kl === 'mktcap') {
              if (rawStr.endsWith('T')) d.marketCap = parseFloat(rawStr) * 1e12;
              else if (rawStr.endsWith('B')) d.marketCap = parseFloat(rawStr) * 1e9;
              else if (!isNaN(num) && num > 0) d.marketCap = num;
            } else if (kl === 'eps') { if (!isNaN(num) && num !== 0) d.eps = num; }
            else if (kl === 'price') { if (!isNaN(num) && num > 0) d.price = num; }
          }
        }
      }
    }

    const peers: any[] = [];
    for (const t of peerTickers) {
      const d = peerData.get(t); if (!d) continue;
      let epsGrowth1Y: number | null = null, epsGrowth5Y_peer: number | null = null;
      const history: { date: string; eps: number }[] = (d.epsHistory || []).filter((h: any) => h.eps > 0);
      if (history.length >= 2) {
        history.sort((a: any, b: any) => a.date.localeCompare(b.date));
        const latest = history[history.length - 1]; const prev = history[history.length - 2];
        if (prev.eps > 0 && latest.eps > 0) epsGrowth1Y = +(((latest.eps / prev.eps) - 1) * 100).toFixed(1);
        if (history.length >= 3) {
          const targetIdx = Math.max(0, history.length - 6); const old = history[targetIdx];
          const years = Math.max(1, history.length - 1 - targetIdx);
          if (old.eps > 0 && latest.eps > 0) epsGrowth5Y_peer = +(((latest.eps / old.eps) ** (1 / years) - 1) * 100).toFixed(1);
        }
      }
      const growthForPEG = epsGrowth5Y_peer && epsGrowth5Y_peer > 0 ? epsGrowth5Y_peer : (epsGrowth5Y > 0 ? epsGrowth5Y : null);
      const peerPEG = d.pe && growthForPEG && growthForPEG > 0 ? +(d.pe / growthForPEG).toFixed(2) : null;
      peers.push({ ticker: t, name: t, pe: d.pe ? +d.pe.toFixed(1) : null, peg: peerPEG, ps: d.ps ? +d.ps.toFixed(1) : null, pb: d.pb ? +d.pb.toFixed(1) : null, epsGrowth1Y, epsGrowth5Y: epsGrowth5Y_peer, marketCap: d.marketCap || null, revenueGrowth: null });
    }
    const validPeers = peers.filter(p => p.pe !== null || p.ps !== null || p.pb !== null).slice(0, 6);
    console.log(`[PEERS] Valid peers: ${validPeers.length}/${peers.length}`);
    if (validPeers.length === 0) { console.log(`[PEERS] All peers had null data`); return null; }

    const avg = (arr: (number | null)[]): number | null => { const valid = arr.filter((v): v is number => v !== null && !isNaN(v) && isFinite(v) && v > 0 && v < 1000); return valid.length > 0 ? +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2) : null; };
    const cleanEps1Y = (v: number | null) => v != null && v > -60 && v < 80;
    const cleanEps5Y = (v: number | null) => v != null && v > -30 && v < 60;
    const ps = revenue > 0 && marketCap > 0 ? +(marketCap / revenue).toFixed(1) : null;
    const subject = { ticker, name: companyName, pe: pe > 0 ? +pe.toFixed(1) : null, peg: peg > 0 ? +peg.toFixed(2) : null, ps, pb: null as number | null, epsGrowth1Y: null as number | null, epsGrowth5Y: epsGrowth5Y > 0 ? +epsGrowth5Y.toFixed(1) : null, marketCap, revenueGrowth: +revenueGrowth.toFixed(1) };
    console.log(`[PEERS] Built ${validPeers.length} peer comparisons for ${ticker}`);
    return {
      subject, peers: validPeers,
      peerAvg: { pe: avg(validPeers.map(p => p.pe)), peg: avg(validPeers.map(p => p.peg)), ps: avg(validPeers.map(p => p.ps)), pb: avg(validPeers.map(p => p.pb)), epsGrowth1Y: avg(validPeers.filter(p => cleanEps1Y(p.epsGrowth1Y)).map(p => p.epsGrowth1Y)), epsGrowth5Y: avg(validPeers.filter(p => cleanEps5Y(p.epsGrowth5Y)).map(p => p.epsGrowth5Y)) },
    };
  } catch (err: any) { console.log(`[PEERS] Failed for ${ticker}: ${err?.message?.substring(0, 200)}`); return null; }
}
