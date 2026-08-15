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

const LUXURY_INDUSTRY_BLOCKLIST = ["luxury goods", "apparel", "jewelry", "watches", "footwear", "fashion", "textile"];
const CURATED_PEER_FALLBACK: Record<string, string[]> = {
  BYDDY: ["TSLA", "NIO", "LI", "XPEV", "GELYF"],
  NIO: ["BYDDY", "LI", "XPEV", "TSLA", "GELYF"],
  LI: ["BYDDY", "NIO", "XPEV", "TSLA", "GELYF"],
  XPEV: ["BYDDY", "NIO", "LI", "TSLA", "GELYF"],
  GELYF: ["BYDDY", "TSLA", "NIO", "LI", "XPEV"],
};
function normaliseIndustry(s: string): string {
  return s.toLowerCase().replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
}
const AUTO_EV_KEYWORDS = ["auto", "vehicle", "ev ", " ev", "electric vehicle"];
function isAutoEvIndustry(industry: string): boolean {
  return AUTO_EV_KEYWORDS.some(k => normaliseIndustry(industry).includes(k.trim()));
}
function isLuxuryIndustry(industry: string): boolean {
  return LUXURY_INDUSTRY_BLOCKLIST.some(l => normaliseIndustry(industry).includes(l));
}
function isIndustryCompatible(subjectSector: string, subjectIndustry: string, candidateSector: string, candidateIndustry: string): { ok: boolean; reason: string } {
  if (isAutoEvIndustry(subjectIndustry)) {
    if (isLuxuryIndustry(candidateIndustry)) return { ok: false, reason: "Luxury vs Auto/EV" };
    if (!isAutoEvIndustry(candidateIndustry)) return { ok: false, reason: "Industry mismatch Auto/EV" };
    return { ok: true, reason: "Auto/EV" };
  }
  const nSubjInd = normaliseIndustry(subjectIndustry);
  const nCandInd = normaliseIndustry(candidateIndustry);
  const nSubjSec = normaliseIndustry(subjectSector);
  const nCandSec = normaliseIndustry(candidateSector);
  if (nSubjInd && nCandInd && nSubjInd === nCandInd) return { ok: true, reason: "Exact Industry" };
  if (nSubjSec && nCandSec && nSubjSec === nCandSec) return { ok: true, reason: "Sector" };
  return { ok: false, reason: "Industry mismatch" };
}

export async function filterAndSelectPeers(
  subjectTicker: string, subjectSector: string, subjectIndustry: string,
  rawPeerTickers: string[], maxPeers: number = 5
): Promise<string[]> {
  const upperSubject = subjectTicker.toUpperCase();
  const candidates = rawPeerTickers.slice(0, 10);
  if (candidates.length === 0) return CURATED_PEER_FALLBACK[upperSubject]?.slice(0, maxPeers) ?? [];
  let candidateProfiles: Array<{ symbol: string; sector: string; industry: string } | null>;
  try {
    candidateProfiles = await Promise.all(candidates.map(async (sym) => {
      try {
        const p = await fmpProfile(sym);
        if (!p) return null;
        return { symbol: sym, sector: String(p.sector ?? ""), industry: String(p.industry ?? "") };
      } catch { return null; }
    }));
  } catch { candidateProfiles = candidates.map(() => null); }
  const filtered: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const sym = candidates[i];
    const prof = candidateProfiles[i];
    if (!prof) continue;
    if (isIndustryCompatible(subjectSector, subjectIndustry, prof.sector, prof.industry).ok) filtered.push(sym);
  }
  const curated = CURATED_PEER_FALLBACK[upperSubject];
  if (curated) {
    const combined = [...curated];
    for (const sym of filtered) {
      if (combined.length >= maxPeers) break;
      if (!combined.includes(sym)) combined.push(sym);
    }
    return combined.slice(0, maxPeers);
  }
  return filtered.slice(0, maxPeers);
}

export interface RoicPoint {
  roicPercent: number | null;
  fiscalYear: string | null;
  periodDate: string | null;
  roic5YPercent: number | null;
  roic5YYearsUsed: number;
}
const MIN_ROIC_5Y_YEARS = 3;
const MAX_ROIC_5Y_YEARS = 5;
const ROIC_ABS_CAP = 100;

export function extractRoicPercentFromRow(row: any): number | null {
  if (!row) return null;
  const field = row.returnOnInvestedCapital;
  const raw = field == null ? NaN : Number(field);
  if (!isFinite(raw)) return null;
  const pct = +(raw * 100).toFixed(1);
  if (Math.abs(pct) > ROIC_ABS_CAP) return null;
  return pct;
}

export function extractRoicFromKeyMetricsRows(rows: any[]): RoicPoint {
  const arr = Array.isArray(rows) ? rows : [];
  const latest = arr[0];
  if (!latest) return { roicPercent: null, fiscalYear: null, periodDate: null, roic5YPercent: null, roic5YYearsUsed: 0 };
  const roicPercent = extractRoicPercentFromRow(latest);
  const yearValues = arr.slice(0, MAX_ROIC_5Y_YEARS).map(r => extractRoicPercentFromRow(r)).filter((v): v is number => v !== null);
  return {
    roicPercent,
    fiscalYear: latest.fiscalYear != null ? String(latest.fiscalYear) : null,
    periodDate: typeof latest.date === "string" ? latest.date : null,
    roic5YPercent: yearValues.length >= MIN_ROIC_5Y_YEARS ? +(yearValues.reduce((a, b) => a + b, 0) / yearValues.length).toFixed(1) : null,
    roic5YYearsUsed: yearValues.length,
  };
}

export async function fetchRoicForTickers(tickers: string[]): Promise<Record<string, RoicPoint>> {
  const out: Record<string, RoicPoint> = {};
  if (tickers.length === 0) return out;
  const rows = await Promise.all(tickers.map(t => fmpKeyMetrics(t, MAX_ROIC_5Y_YEARS).catch(() => [])));
  tickers.forEach((t, i) => { out[t] = extractRoicFromKeyMetricsRows(Array.isArray(rows[i]) ? rows[i] : []); });
  return out;
}

export async function fetchPeerComparisonFromTickers(
  ticker: string, peerTickers: string[], pe: number, peg: number, revenue: number,
  marketCap: number, revenueGrowth: number, epsGrowth5Y: number,
  subjectExtras?: { pb?: number | null; epsGrowth1Y?: number | null }
): Promise<{ subject: any; peers: any[]; peerAvg: any } | null> {
  try {
    const [quotes, ratiosPerPeer, roicByTicker, subjectRoic] = await Promise.all([
      fmpBatchQuote(peerTickers),
      Promise.all(peerTickers.map(t => fmpRatios(t, 6).catch(() => []))),
      fetchRoicForTickers(peerTickers),
      fetchRoicForTickers([ticker]).then(r => r[ticker]),
    ]);
    const quoteByTicker = new Map<string, any>((quotes || []).map((q: any) => [q.symbol, q]));
    const cagr = (endValue: number | undefined, startValue: number | undefined, years: number): number | null => {
      if (!endValue || !startValue || years <= 0) return null;
      if (endValue <= 0 || startValue <= 0) return null;
      return +((Math.pow(endValue / startValue, 1 / years) - 1) * 100).toFixed(1);
    };

    // Absoluter Floor $1B — kein relatives 5%-20x-Band mehr.
    // CPNG (~$40-50B), SHOP, etc. bleiben; LITB/Micro-Caps (<$1B) raus.
    const PEER_CAP_ABS_FLOOR = 1_000_000_000;

    const peers: any[] = [];
    peerTickers.forEach((t, idx) => {
      const q = quoteByTicker.get(t);
      const peerCap = q?.marketCap != null ? Number(q.marketCap) : null;
      if (peerCap != null && peerCap > 0 && peerCap < PEER_CAP_ABS_FLOOR) {
        console.log(`[PEERS-FMP] ${t} verworfen — Market-Cap < $1B (peer=${peerCap})`);
        return;
      }
      const ratios: any[] = Array.isArray(ratiosPerPeer[idx]) ? ratiosPerPeer[idx] : [];
      const r0 = ratios[0]; const r1 = ratios[1];
      const peerPE = Number(r0?.priceToEarningsRatio ?? r0?.priceEarningsRatio ?? 0)
        || (q?.price && q?.eps > 0 ? q.price / q.eps : null);
      const peerPS = Number(r0?.priceToSalesRatio ?? 0) || null;
      const peerPB = Number(r0?.priceToBookRatio ?? 0) || null;
      let epsGrowth1Y: number | null = null;
      if (r0?.netIncomePerShare != null && r1?.netIncomePerShare != null && r1.netIncomePerShare > 0) {
        epsGrowth1Y = +(((r0.netIncomePerShare / r1.netIncomePerShare) - 1) * 100).toFixed(1);
      }
      let epsGrowth5Y_peer: number | null = null;
      if (ratios.length >= 3) {
        const lookback = Math.min(5, ratios.length - 1);
        epsGrowth5Y_peer = cagr(r0?.netIncomePerShare, ratios[lookback]?.netIncomePerShare, lookback);
      }
      let revenueGrowthPeer: number | null = null;
      if (r0?.revenuePerShare != null && r1?.revenuePerShare != null && r1.revenuePerShare > 0) {
        revenueGrowthPeer = +(((r0.revenuePerShare / r1.revenuePerShare) - 1) * 100).toFixed(1);
      }
      const growthForPEG = epsGrowth1Y && epsGrowth1Y > 0 ? epsGrowth1Y
        : (epsGrowth5Y_peer && epsGrowth5Y_peer > 0 ? epsGrowth5Y_peer : (epsGrowth5Y > 0 ? epsGrowth5Y : null));
      const peerPEG = peerPE && growthForPEG && growthForPEG > 0 ? +(peerPE / growthForPEG).toFixed(2) : null;
      if (!q && !r0) return;
      const peerRoic = roicByTicker[t];
      peers.push({
        ticker: t, name: q?.name || t,
        pe: peerPE ? +Number(peerPE).toFixed(1) : null,
        peg: peerPEG,
        ps: peerPS ? +Number(peerPS).toFixed(1) : null,
        pb: peerPB ? +Number(peerPB).toFixed(1) : null,
        epsGrowth1Y, epsGrowth5Y: epsGrowth5Y_peer,
        marketCap: q?.marketCap || null,
        revenueGrowth: revenueGrowthPeer,
        roic: peerRoic?.roicPercent ?? null,
        roicFiscalYear: peerRoic?.fiscalYear ?? null,
        roic5Y: peerRoic?.roic5YPercent ?? null,
        roic5YYearsUsed: peerRoic?.roic5YYearsUsed ?? 0,
      });
    });
    const validPeers = peers.filter(p => p.pe !== null || p.ps !== null || p.pb !== null).slice(0, 6);
    if (validPeers.length === 0) return null;
    const avg = (arr: (number | null)[], lo = -1000, hi = 1000): number | null => {
      const valid = arr.filter((v): v is number => v !== null && !isNaN(v) && isFinite(v) && v > lo && v < hi);
      return valid.length > 0 ? +(valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(2) : null;
    };
    const ps = revenue > 0 && marketCap > 0 ? +(marketCap / revenue).toFixed(1) : null;
    const subject = {
      ticker, name: ticker,
      pe: pe > 0 ? +pe.toFixed(1) : null,
      peg: peg > 0 ? +peg.toFixed(2) : null,
      ps,
      pb: subjectExtras?.pb != null && subjectExtras.pb > 0 ? +Number(subjectExtras.pb).toFixed(1) : null,
      epsGrowth1Y: subjectExtras?.epsGrowth1Y != null && isFinite(subjectExtras.epsGrowth1Y) ? +Number(subjectExtras.epsGrowth1Y).toFixed(1) : null,
      epsGrowth5Y: epsGrowth5Y > 0 ? +epsGrowth5Y.toFixed(1) : null,
      marketCap,
      revenueGrowth: revenueGrowth ? +revenueGrowth.toFixed(1) : null,
      roic: subjectRoic?.roicPercent ?? null,
      roicFiscalYear: subjectRoic?.fiscalYear ?? null,
      roic5Y: subjectRoic?.roic5YPercent ?? null,
      roic5YYearsUsed: subjectRoic?.roic5YYearsUsed ?? 0,
    };
    const peerAvg = {
      pe: avg(validPeers.map(p => p.pe), 0, 500),
      peg: avg(validPeers.map(p => p.peg), 0, 20),
      ps: avg(validPeers.map(p => p.ps), 0, 100),
      pb: avg(validPeers.map(p => p.pb).map(v => v && v > 0 ? v : null), 0, 200),
      epsGrowth1Y: avg(validPeers.map(p => p.epsGrowth1Y), -100, 300),
      epsGrowth5Y: avg(validPeers.map(p => p.epsGrowth5Y), -100, 300),
      roic: avg(validPeers.map(p => p.roic), -100, 100),
      roic5Y: avg(validPeers.map(p => p.roic5Y), -100, 100),
    };
    return { subject, peers: validPeers, peerAvg };
  } catch (err: any) {
    console.error(`[PEERS-FMP] Failed for ${ticker}: ${err?.message?.substring(0, 150)}`);
    return null;
  }
}

export async function fetchPeerComparison(
  ticker: string, companyName: string, pe: number, peg: number, revenue: number,
  marketCap: number, revenueGrowth: number, epsGrowth5Y: number,
  fmpPeerTickers: string[] = []
): Promise<{ subject: any; peers: any[]; peerAvg: any } | null> {
  try {
    if (fmpPeerTickers.length > 0) {
      return fetchPeerComparisonFromTickers(ticker, fmpPeerTickers, pe, peg, revenue, marketCap, revenueGrowth, epsGrowth5Y);
    }
    return null;
  } catch {
    return null;
  }
}
