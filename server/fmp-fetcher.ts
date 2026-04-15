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

    // EPS growth 5Y CAGR
    let epsGrowth5Y = 0;
    if (income.length >= 3) {
      const latestEps = income[0]?.epsDiluted || 0;
      const oldIdx = Math.min(5, income.length - 1);
      const oldEps = income[oldIdx]?.epsDiluted || 0;
      if (oldEps > 0 && latestEps > 0) epsGrowth5Y = ((latestEps / oldEps) ** (1 / Math.min(5, oldIdx)) - 1) * 100;
    }

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

    // Ratios
    const parsedRatios = (ratios || []).map((r: any) => ({
      pe: r.priceEarningsRatio, ps: r.priceToSalesRatio, pb: r.priceToBookRatio,
      date: r.date, eps: r.netIncomePerShare,
    }));

    // Estimates
    const parsedEstimates = (estimates || []).map((e: any) => ({
      date: e.date || "", estimatedEps: e.estimatedEpsDiluted || e.estimatedEpsAvg,
      estimatedRevenue: e.estimatedRevenueAvg,
    }));

    const pe = profile.price && li.epsDiluted ? profile.price / li.epsDiluted : 0;

    const result: FmpAnalysisData = {
      price: profile.price, marketCap: profile.marketCap || 0,
      pe, eps: li.epsDiluted || 0, beta: profile.beta || 1,
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
      epsTTM: li.epsDiluted || 0, epsAdjFY: li.epsDiluted || 0,
      epsConsensusNextFY: parsedEstimates[0]?.estimatedEps || 0, epsGrowth5Y,
      analystBuy, analystHold, analystSell,
      ptMedian: pt?.targetConsensus || 0, ptHigh: pt?.targetHigh || 0, ptLow: pt?.targetLow || 0,
      numAnalysts: analystBuy + analystHold + analystSell,
      ohlcv: ohlcvData, segments: parsedSegments, peerTickers, ratios: parsedRatios, estimates: parsedEstimates,
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
