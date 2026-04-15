// === FMP Data Fetcher — replaces all callFinanceTool calls in the analyze endpoint ===
import {
  fmpQuote, fmpProfile, fmpIncomeStatement, fmpBalanceSheet, fmpCashFlow,
  fmpHistoricalPrices, fmpAnalystEstimates, fmpGrades, fmpPriceTarget,
  fmpSegments, fmpPeers, fmpRatios, fmpBatchQuote, fmpKeyMetrics,
  isFmpAvailable,
} from "./fmp";

export interface FmpAnalysisData {
  // Quote
  price: number;
  marketCap: number;
  pe: number;
  eps: number;
  beta: number;
  currency: string;
  exchange: string;
  volume: number;
  yearHigh: number;
  yearLow: number;
  sharesOutstanding: number;

  // Profile
  companyName: string;
  description: string;
  sector: string;
  industry: string;
  country: string;

  // Financials
  revenue: number;
  revenueGrowth: number;
  operatingIncome: number;
  netIncome: number;
  ebitda: number;
  grossProfit: number;
  totalDebt: number;
  cashEquivalents: number;
  totalEquity: number;
  totalAssets: number;
  fcfTTM: number;
  capex: number;
  operatingCashFlow: number;

  // EPS
  epsTTM: number;
  epsAdjFY: number;
  epsConsensusNextFY: number;
  epsGrowth5Y: number;

  // Analyst
  analystBuy: number;
  analystHold: number;
  analystSell: number;
  ptMedian: number;
  ptHigh: number;
  ptLow: number;
  numAnalysts: number;

  // OHLCV
  ohlcv: { date: string; open: number; high: number; low: number; close: number; volume: number }[];

  // Segments
  segments: { name: string; revenue: number; growth?: number }[];

  // Peers
  peerTickers: string[];

  // Ratios (for peer comparison)
  ratios: { pe?: number; ps?: number; pb?: number; roe?: number; date?: string; eps?: number }[];

  // Estimates (forward)
  estimates: { date: string; estimatedEps?: number; estimatedRevenue?: number }[];
}

export async function fetchFmpAnalysisData(ticker: string): Promise<FmpAnalysisData | null> {
  if (!isFmpAvailable()) return null;

  try {
    console.log(`[FMP] Fetching data for ${ticker}...`);

    // Parallel fetch all data
    const [quote, profile, income, balance, cashflow, ohlcv, estimates, grades, pt, segments, ratios, keyMetrics] = await Promise.all([
      fmpQuote(ticker).catch(() => null),
      fmpProfile(ticker).catch(() => null),
      fmpIncomeStatement(ticker, 6).catch(() => []),
      fmpBalanceSheet(ticker, 2).catch(() => []),
      fmpCashFlow(ticker, 2).catch(() => []),
      fmpHistoricalPrices(ticker, yearAgo(10), today()).catch(() => []),
      fmpAnalystEstimates(ticker, 4).catch(() => []),
      fmpGrades(ticker, 30).catch(() => []),
      fmpPriceTarget(ticker).catch(() => null),
      fmpSegments(ticker).catch(() => []),
      fmpRatios(ticker, 10).catch(() => []),
      fmpKeyMetrics(ticker, 2).catch(() => []),
    ]);

    if (!quote || !quote.price) {
      console.log(`[FMP] No quote data for ${ticker}`);
      return null;
    }

    // Parse income statement
    const latestIncome = income?.[0] || {};
    const prevIncome = income?.[1] || {};
    const revenue = latestIncome.revenue || 0;
    const prevRevenue = prevIncome.revenue || 0;
    const revenueGrowth = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : 0;

    // EPS growth 5Y CAGR
    let epsGrowth5Y = 0;
    if (income.length >= 3) {
      const latestEps = income[0]?.epsdiluted || 0;
      const oldIdx = Math.min(5, income.length - 1);
      const oldEps = income[oldIdx]?.epsdiluted || 0;
      if (oldEps > 0 && latestEps > 0) {
        epsGrowth5Y = ((latestEps / oldEps) ** (1 / Math.min(5, oldIdx)) - 1) * 100;
      }
    }

    // Balance sheet
    const latestBalance = balance?.[0] || {};
    
    // Cash flow
    const latestCF = cashflow?.[0] || {};

    // Analyst ratings from grades
    let analystBuy = 0, analystHold = 0, analystSell = 0;
    const recentGrades = (grades || []).filter((g: any) => {
      const d = new Date(g.date);
      return d > new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    });
    for (const g of recentGrades) {
      const grade = (g.newGrade || "").toLowerCase();
      if (grade.includes("buy") || grade.includes("outperform") || grade.includes("overweight")) analystBuy++;
      else if (grade.includes("sell") || grade.includes("underperform") || grade.includes("underweight")) analystSell++;
      else analystHold++;
    }

    // Forward EPS from estimates
    const fwdEstimate = estimates?.[0];
    const epsConsensusNextFY = fwdEstimate?.estimatedEpsDiluted || fwdEstimate?.estimatedEpsAvg || 0;

    // Segments parsing
    const parsedSegments: { name: string; revenue: number; growth?: number }[] = [];
    if (Array.isArray(segments) && segments.length > 0) {
      // FMP returns [{date: "2024-...", ...segmentData}]
      const latest = segments[0] || {};
      for (const [key, val] of Object.entries(latest)) {
        if (key === "date" || key === "symbol") continue;
        if (typeof val === "number" && val > 0) {
          parsedSegments.push({ name: key, revenue: val });
        }
      }
    }

    // Peer tickers
    let peerTickers: string[] = [];
    try {
      peerTickers = await fmpPeers(ticker);
    } catch {}

    // Parse ratios for EPS history
    const parsedRatios = (ratios || []).map((r: any) => ({
      pe: r.priceEarningsRatio || null,
      ps: r.priceToSalesRatio || null,
      pb: r.priceToBookRatio || null,
      roe: r.returnOnEquity || null,
      date: r.date || null,
      eps: r.netIncomePerShare || null,
    }));

    // Parse estimates
    const parsedEstimates = (estimates || []).map((e: any) => ({
      date: e.date || "",
      estimatedEps: e.estimatedEpsDiluted || e.estimatedEpsAvg || null,
      estimatedRevenue: e.estimatedRevenueAvg || null,
    }));

    const result: FmpAnalysisData = {
      price: quote.price || 0,
      marketCap: quote.marketCap || profile?.mktCap || 0,
      pe: quote.pe || 0,
      eps: quote.eps || latestIncome.epsdiluted || 0,
      beta: profile?.beta || 1.0,
      currency: profile?.currency || "USD",
      exchange: quote.exchange || profile?.exchangeShortName || "",
      volume: quote.volume || 0,
      yearHigh: quote.yearHigh || 0,
      yearLow: quote.yearLow || 0,
      sharesOutstanding: quote.sharesOutstanding || profile?.sharesOutstanding || 0,

      companyName: profile?.companyName || quote.name || ticker,
      description: profile?.description || "",
      sector: profile?.sector || "",
      industry: profile?.industry || "",
      country: profile?.country || "",

      revenue,
      revenueGrowth,
      operatingIncome: latestIncome.operatingIncome || 0,
      netIncome: latestIncome.netIncome || 0,
      ebitda: latestIncome.ebitda || latestIncome.ebitdaRatio ? revenue * (latestIncome.ebitdaRatio || 0) : 0,
      grossProfit: latestIncome.grossProfit || 0,
      totalDebt: latestBalance.totalDebt || 0,
      cashEquivalents: latestBalance.cashAndCashEquivalents || latestBalance.cashAndShortTermInvestments || 0,
      totalEquity: latestBalance.totalStockholdersEquity || 0,
      totalAssets: latestBalance.totalAssets || 0,
      fcfTTM: latestCF.freeCashFlow || (latestCF.operatingCashFlow || 0) - Math.abs(latestCF.capitalExpenditure || 0),
      capex: Math.abs(latestCF.capitalExpenditure || 0),
      operatingCashFlow: latestCF.operatingCashFlow || 0,

      epsTTM: quote.eps || latestIncome.epsdiluted || 0,
      epsAdjFY: latestIncome.epsdiluted || 0,
      epsConsensusNextFY,
      epsGrowth5Y,

      analystBuy,
      analystHold,
      analystSell,
      ptMedian: pt?.targetMedian || pt?.targetConsensus || 0,
      ptHigh: pt?.targetHigh || 0,
      ptLow: pt?.targetLow || 0,
      numAnalysts: analystBuy + analystHold + analystSell,

      ohlcv: (ohlcv || []).map((d: any) => ({
        date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
      })),

      segments: parsedSegments,
      peerTickers,
      ratios: parsedRatios,
      estimates: parsedEstimates,
    };

    console.log(`[FMP] Got data for ${ticker}: $${result.price} ${result.companyName} (${result.sector})`);
    return result;
  } catch (err: any) {
    console.error(`[FMP] Failed for ${ticker}: ${err?.message?.substring(0, 200)}`);
    return null;
  }
}

function today(): string { return new Date().toISOString().slice(0, 10); }
function yearAgo(n: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}
