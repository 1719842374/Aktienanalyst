// === FMP Data Fetcher — Stable API (2025+) ===
import {
  fmpProfile, fmpIncomeStatement, fmpBalanceSheet, fmpCashFlow,
  fmpHistoricalPrices, fmpAnalystEstimates, fmpGrades, fmpPriceTarget,
  fmpSegments, fmpPeers, fmpRatios, fmpBatchQuote,
  isFmpAvailable,
} from "./fmp";

export interface FmpAnalysisData {
  price: number; marketCap: number; pe: number; eps: number; beta: number;
  currency: string; exchange: string; volume: number; yearHigh: number; yearLow: number;
  sharesOutstanding: number;
  companyName: string; description: string; sector: string; industry: string; country: string;
  revenue: number; revenueGrowth: number; operatingIncome: number; netIncome: number;
  ebitda: number; grossProfit: number; totalDebt: number; cashEquivalents: number;
  totalEquity: number; totalAssets: number; fcfTTM: number; capex: number; operatingCashFlow: number;
  epsTTM: number; epsAdjFY: number; epsConsensusNextFY: number; epsGrowth5Y: number;
  /** Forward EPS growth % from analyst consensus (next FY vs. TTM).
   *  This is what Yahoo Finance and most data providers use for PEG.
   *  Falls back to epsGrowth5Y when estimates are unavailable. */
  epsGrowthFwd: number;
  /** Pre-computed PEG = P/E ÷ epsGrowthFwd (forward-based, like Yahoo Finance).
   *  null when growth is zero/negative (PEG undefined). */
  pegRatio: number | null;
  analystBuy: number; analystHold: number; analystSell: number;
  ptMedian: number; ptHigh: number; ptLow: number; numAnalysts: number;
  ohlcv: { date: string; open: number; high: number; low: number; close: number; volume: number }[];
  segments: { name: string; revenue: number }[];
  peerTickers: string[];
  ratios: { pe?: number; ps?: number; pb?: number; date?: string; eps?: number }[];
  estimates: { date: string; estimatedEps?: number; estimatedRevenue?: number }[];
}

export async function fetchFmpAnalysisData(ticker: string): Promise<FmpAnalysisData | null> {
  if (!isFmpAvailable()) return null;
  try {
    console.log(`[FMP] Fetching data for ${ticker}...`);
    const [profile, income, balance, cashflow, ohlcv, estimates, grades, pt, segments, peers, ratios] = await Promise.all([
      fmpProfile(ticker).catch(() => null),
      fmpIncomeStatement(ticker, 5).catch(e => { console.log(`[FMP] Income error: ${e.message}`); return []; }),
      fmpBalanceSheet(ticker, 1).catch(() => []),
      fmpCashFlow(ticker, 1).catch(() => []),
      fmpHistoricalPrices(ticker, yearAgo(10), today()).catch(() => []),
      fmpAnalystEstimates(ticker, 4).catch(() => []),
      fmpGrades(ticker, 5).catch(() => []),
      fmpPriceTarget(ticker).catch(() => null),
      fmpSegments(ticker).catch(() => []),
      fmpPeers(ticker).catch(() => []),
      fmpRatios(ticker, 5).catch(() => []),
    ]);

    if (!profile || !profile.price) { console.log(`[FMP] No profile for ${ticker}`); return null; }

    const li = income?.[0] || {} as any;
    const pi = income?.[1] || {} as any;
    const revenue = li.revenue || 0;
    const prevRevenue = pi.revenue || 0;
    const revenueGrowth = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;

    // EPS growth 5Y CAGR (historical — kept for RSL/DCF growth adjustments)
    let epsGrowth5Y = 0;
    if (income.length >= 3) {
      const latestEps = income[0]?.epsDiluted || 0;
      const oldIdx = Math.min(5, income.length - 1);
      const oldEps = income[oldIdx]?.epsDiluted || 0;
      if (oldEps > 0 && latestEps > 0) epsGrowth5Y = ((latestEps / oldEps) ** (1 / Math.min(5, oldIdx)) - 1) * 100;
    }

    // Forward EPS growth — used for PEG (matches Yahoo Finance methodology).
    // Uses next-FY consensus EPS vs. TTM EPS so the ratio reflects expected
    // earnings acceleration, not backward-looking CAGR.
    // Estimates array is sorted newest-first; [0] = next upcoming FY.
    const parsedEstimatesRaw = (estimates || []).map((e: any) => ({
      date: e.date || "", estimatedEps: e.estimatedEpsDiluted || e.estimatedEpsAvg,
      estimatedRevenue: e.estimatedRevenueAvg,
    }));

    const ttmEps = li.epsDiluted || 0;
    const fwdEpsConsensus = parsedEstimatesRaw[0]?.estimatedEps || 0;

    let epsGrowthFwd = 0;
    if (ttmEps > 0 && fwdEpsConsensus > 0) {
      // Forward EPS growth % = (nextFY_EPS / TTM_EPS - 1) × 100
      epsGrowthFwd = ((fwdEpsConsensus / ttmEps) - 1) * 100;
    } else if (ttmEps < 0 && fwdEpsConsensus > 0) {
      // Recovering from loss — forward growth is meaningful but CAGR formula breaks.
      // Use revenue growth as proxy to avoid divide-by-negative artifacts.
      epsGrowthFwd = revenueGrowth > 0 ? revenueGrowth : 15; // conservative default
    } else {
      // Fallback: historical 5Y CAGR when no forward estimates available
      epsGrowthFwd = epsGrowth5Y;
    }

    // PEG = P/E ÷ forward EPS growth (%)
    // Undefined (null) when growth ≤ 0 — negative PEG is meaningless.
    const pe = profile.price && ttmEps ? profile.price / ttmEps : 0;
    const pegRatio: number | null = (pe > 0 && epsGrowthFwd > 0) ? pe / epsGrowthFwd : null;

    console.log(`[FMP] ${ticker} EPS growth — hist5Y: ${epsGrowth5Y.toFixed(1)}%, fwd: ${epsGrowthFwd.toFixed(1)}% | P/E: ${pe.toFixed(1)} | PEG(fwd): ${pegRatio?.toFixed(2) ?? 'n/a'}`);

    const lb = balance?.[0] || {} as any;
    const lc = cashflow?.[0] || {} as any;

    // Analyst grades
    let analystBuy = 0, analystHold = 0, analystSell = 0;
    for (const g of (grades || []).slice(0, 30)) {
      const gr = (g.newGrade || "").toLowerCase();
      if (gr.includes("buy") || gr.includes("outperform") || gr.includes("overweight")) analystBuy++;
      else if (gr.includes("sell") || gr.includes("underperform") || gr.includes("underweight")) analystSell++;
      else analystHold++;
    }

    // Segments
    const parsedSegments: { name: string; revenue: number }[] = [];
    if (Array.isArray(segments) && segments.length > 0) {
      const latest = segments[0];
      const segData = (latest as any)?.data || latest;
      if (typeof segData === 'object') {
        for (const [key, val] of Object.entries(segData)) {
          if (key === "date" || key === "symbol" || key === "fiscalYear" || key === "period" || key === "reportedCurrency") continue;
          if (typeof val === "number" && val > 0) parsedSegments.push({ name: key, revenue: val });
        }
      }
    }

    // Peers — new format returns array of objects with symbol
    const peerTickers = (peers || []).map((p: any) => p.symbol || p).filter((s: any) => typeof s === 'string' && s !== ticker).slice(0, 8);

    // Historical prices — new format is flat array
    const ohlcvData = (Array.isArray(ohlcv) ? ohlcv : []).map((d: any) => ({
      date: d.date, open: d.open, high: d.high, low: d.low, close: d.close || d.adjClose, volume: d.volume,
    }));

    // Ratios — FMP /stable/ratios renamed peRatio → priceToEarningsRatio
    // evToEbitda removed from /stable/ratios (moved to /stable/key-metrics as enterpriseValueOverEBITDA)
    const parsedRatios = (ratios || []).map((r: any) => ({
      pe: r.priceToEarningsRatio ?? r.priceEarningsRatio ?? r.peRatio,
      ps: r.priceToSalesRatio,
      pb: r.priceToBookRatio,
      date: r.date,
      eps: r.netIncomePerShare,
    }));

    const result: FmpAnalysisData = {
      price: profile.price, marketCap: profile.marketCap || 0,
      pe, eps: ttmEps, beta: profile.beta || 1,
      currency: profile.currency || "USD", exchange: profile.exchange || "",
      volume: profile.volume || 0, yearHigh: 0, yearLow: 0,
      sharesOutstanding: profile.marketCap && profile.price ? Math.round(profile.marketCap / profile.price) : 0,
      companyName: profile.companyName || ticker, description: profile.description || "",
      sector: profile.sector || "", industry: profile.industry || "", country: profile.country || "",
      revenue, revenueGrowth, operatingIncome: li.operatingIncome || 0,
      netIncome: li.netIncome || 0, ebitda: li.ebitda || 0, grossProfit: li.grossProfit || 0,
      totalDebt: lb.totalDebt || 0, cashEquivalents: lb.cashAndCashEquivalents || lb.cashAndShortTermInvestments || 0,
      totalEquity: lb.totalStockholdersEquity || 0, totalAssets: lb.totalAssets || 0,
      fcfTTM: lc.freeCashFlow || (lc.operatingCashFlow || 0) - Math.abs(lc.capitalExpenditure || 0),
      capex: Math.abs(lc.capitalExpenditure || 0), operatingCashFlow: lc.operatingCashFlow || 0,
      epsTTM: ttmEps, epsAdjFY: ttmEps,
      epsConsensusNextFY: parsedEstimatesRaw[0]?.estimatedEps || 0, epsGrowth5Y,
      epsGrowthFwd, pegRatio,
      analystBuy, analystHold, analystSell,
      ptMedian: pt?.targetConsensus || 0, ptHigh: pt?.targetHigh || 0, ptLow: pt?.targetLow || 0,
      numAnalysts: analystBuy + analystHold + analystSell,
      ohlcv: ohlcvData, segments: parsedSegments, peerTickers, ratios: parsedRatios, estimates: parsedEstimatesRaw,
    };
    console.log(`[FMP] ✅ ${ticker}: $${result.price} ${result.companyName} (${result.sector}) Rev=${(revenue/1e9).toFixed(1)}B`);
    return result;
  } catch (err: any) {
    console.error(`[FMP] ❌ ${ticker}: ${err?.message?.substring(0, 200)}`);
    return null;
  }
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function yearAgo(n: number): string { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10); }
