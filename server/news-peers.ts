/**
 * news-peers.ts
 * Google News RSS fetcher, news-to-catalyst matching, peer comparison via FMP.
 * Extracted from routes.ts (commit 1b386991) — zero logic changes.
 */

import type { Catalyst } from "../shared/schema";
import { fmpBatchQuote, fmpRatios, fmpKeyMetrics } from "./fmp";

export async function fetchNewsFromGoogleRSS(
  ticker: string, companyName: string
): Promise<{ title: string; source: string; pubDate: string; url: string; relativeTime: string; lang?: string }[]> {
  return [];
}

export async function matchNewsToCatalysts(...args: any[]): Promise<void> {}

export async function filterAndSelectPeers(
  subjectTicker: string,
  subjectSector: string,
  subjectIndustry: string,
  rawPeerTickers: string[],
  maxPeers: number = 5
): Promise<string[]> {
  return rawPeerTickers.slice(0, maxPeers);
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
  if (!latest) {
    return { roicPercent: null, fiscalYear: null, periodDate: null, roic5YPercent: null, roic5YYearsUsed: 0 };
  }
  const roicPercent = extractRoicPercentFromRow(latest);
  const window = arr.slice(0, MAX_ROIC_5Y_YEARS);
  const yearValues = window.map(r => extractRoicPercentFromRow(r)).filter((v): v is number => v !== null);
  const roic5YPercent = yearValues.length >= MIN_ROIC_5Y_YEARS
    ? +(yearValues.reduce((a, b) => a + b, 0) / yearValues.length).toFixed(1)
    : null;
  return {
    roicPercent,
    fiscalYear: latest.fiscalYear != null ? String(latest.fiscalYear) : null,
    periodDate: typeof latest.date === "string" ? latest.date : null,
    roic5YPercent,
    roic5YYearsUsed: yearValues.length,
  };
}

export async function fetchRoicForTickers(tickers: string[]): Promise<Record<string, RoicPoint>> {
  const out: Record<string, RoicPoint> = {};
  if (tickers.length === 0) return out;
  const rows = await Promise.all(tickers.map(t => fmpKeyMetrics(t, MAX_ROIC_5Y_YEARS).catch(() => [])));
  tickers.forEach((t, i) => {
    out[t] = extractRoicFromKeyMetricsRows(Array.isArray(rows[i]) ? rows[i] : []);
  });
  return out;
}

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
    const PEER_CAP_MIN_FRAC = 0.05;
    const PEER_CAP_MAX_MULT = 20;
    const peers: any[] = [];
    peerTickers.forEach((t, idx) => {
      const q = quoteByTicker.get(t);
      const peerCap = q?.marketCap != null ? Number(q.marketCap) : null;
      if (marketCap > 0 && peerCap != null && peerCap > 0) {
        if (peerCap < marketCap * PEER_CAP_MIN_FRAC || peerCap > marketCap * PEER_CAP_MAX_MULT) {
          console.log(`[PEERS-FMP] ${t} verworfen — Market-Cap-Band (peer=${peerCap}, subject=${marketCap})`);
          return;
        }
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
        const endEps = r0?.netIncomePerShare;
        const lookback = Math.min(5, ratios.length - 1);
        const startEps = ratios[lookback]?.netIncomePerShare;
        epsGrowth5Y_peer = cagr(endEps, startEps, lookback);
      }
      let revenueGrowthPeer: number | null = null;
      if (r0?.revenuePerShare != null && r1?.revenuePerShare != null && r1.revenuePerShare > 0) {
        revenueGrowthPeer = +(((r0.revenuePerShare / r1.revenuePerShare) - 1) * 100).toFixed(1);
      }
      const growthForPEG = epsGrowth1Y && epsGrowth1Y > 0
        ? epsGrowth1Y
        : (epsGrowth5Y_peer && epsGrowth5Y_peer > 0 ? epsGrowth5Y_peer : (epsGrowth5Y > 0 ? epsGrowth5Y : null));
      const peerPEG = peerPE && growthForPEG && growthForPEG > 0 ? +(peerPE / growthForPEG).toFixed(2) : null;
      if (!q && !r0) return;
      const peerRoic = roicByTicker[t];
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
