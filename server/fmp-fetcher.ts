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
  epsTTM: number;
  /** Last completed fiscal year EPS (diluted). Distinct from epsTTM which is
   *  trailing 12 months. For Q2-reporting companies these can differ by >10%. */
  epsAdjFY: number;
  epsConsensusNextFY: number; epsGrowth5Y: number;
  /** Forward EPS growth % from analyst consensus (next FY vs. TTM).
   *  This is what Yahoo Finance and most data providers use for PEG.
   *  Falls back to epsGrowth5Y when estimates are unavailable. */
  epsGrowthFwd: number;
  /** Pre-computed PEG = P/E ÷ epsGrowthFwd (forward-based, like Yahoo Finance).
   *  null when growth is zero/negative (PEG undefined). */
  pegRatio: number | null;
  /** Forward P/E = price / fwdEpsConsensus. Used for Lynch PEG classification. */
  forwardPE: number;
  /** Trailing dividend yield % from profile or ratios. Used for Lynch PEGY (slow_grower). */
  dividendYield: number;
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
      fmpIncomeStatement(ticker, 6).catch(e => { console.log(`[FMP] Income error: ${e.message}`); return []; }),
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
    // income fetched with limit=6 → indices [0]..[5] = 5 full years of lookback
    let epsGrowth5Y = 0;
    if (income.length >= 3) {
      const latestEps = income[0]?.epsDiluted || 0;
      const oldIdx = Math.min(5, income.length - 1);
      const oldEps = income[oldIdx]?.epsDiluted || 0;
      const years = oldIdx; // actual number of years between [0] and [oldIdx]
      if (oldEps > 0 && latestEps > 0 && years > 0) {
        epsGrowth5Y = ((latestEps / oldEps) ** (1 / years) - 1) * 100;
      }
    }

    // Forward EPS growth — used for PEG (matches Yahoo Finance methodology).
    // Estimates array is sorted newest-first; [0] = next upcoming FY.
    const parsedEstimatesRaw = (estimates || []).map((e: any) => ({
      date: e.date || "", estimatedEps: e.estimatedEpsDiluted || e.estimatedEpsAvg,
      estimatedRevenue: e.estimatedRevenueAvg,
    }));

    // TTM EPS: prefer profile.eps (trailing 12M, GAAP) over income[0].epsDiluted (last FY)
    const ttmEps = profile.eps || li.epsDiluted || 0;

    // FY EPS: last completed fiscal year (income[0] = most recent annual statement)
    // DISTINCT from TTM: mid-year reporters (Q2/Q3 FY-end) can differ >10%.
    const fyEps = li.epsDiluted || li.eps || ttmEps;

    const fwdEpsConsensus = parsedEstimatesRaw[0]?.estimatedEps || 0;

    let epsGrowthFwd = 0;
    if (ttmEps > 0 && fwdEpsConsensus > 0) {
      epsGrowthFwd = ((fwdEpsConsensus / ttmEps) - 1) * 100;
    } else if (ttmEps < 0 && fwdEpsConsensus > 0) {
      // Recovering from loss — use revenue growth as proxy
      epsGrowthFwd = revenueGrowth > 0 ? revenueGrowth : 15;
    } else {
      epsGrowthFwd = epsGrowth5Y;
    }

    // Trailing P/E = price / TTM EPS
    const pe = profile.price && ttmEps > 0 ? profile.price / ttmEps : (profile.pe || 0);

    // Forward P/E = price / next-FY consensus EPS
    const forwardPE = profile.price && fwdEpsConsensus > 0 ? profile.price / fwdEpsConsensus : 0;

    // PEG = P/E ÷ forward EPS growth (%). null when growth ≤ 0.
    const pegRatio: number | null = (pe > 0 && epsGrowthFwd > 0) ? pe / epsGrowthFwd : null;

    // Dividend yield %: FMP ratios return decimal (e.g. 0.0044 = 0.44%) → ×100
    const ratiosLatest = (ratios || [])[0] || {} as any;
    const dividendYield =
      (ratiosLatest.dividendYield != null && ratiosLatest.dividendYield > 0)
        ? ratiosLatest.dividendYield * 100
        : (profile.lastAnnualDividend && profile.price > 0)
          ? (profile.lastAnnualDividend / profile.price) * 100
          : 0;

    console.log(`[FMP] ${ticker} EPS — TTM: ${ttmEps.toFixed(2)}, FY: ${fyEps.toFixed(2)}, Fwd: ${fwdEpsConsensus.toFixed(2)} | hist5Y: ${epsGrowth5Y.toFixed(1)}%, fwd: ${epsGrowthFwd.toFixed(1)}% | P/E: ${pe.toFixed(1)}, FwdPE: ${forwardPE.toFixed(1)} | PEG: ${pegRatio?.toFixed(2) ?? 'n/a'} | DivYld: ${dividendYield.toFixed(2)}%`);

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

    // Peers
    const peerTickers = (peers || []).map((p: any) => p.symbol || p).filter((s: any) => typeof s === 'string' && s !== ticker).slice(0, 8);

    // Historical prices
    const ohlcvData = (Array.isArray(ohlcv) ? ohlcv : []).map((d: any) => ({
      date: d.date, open: d.open, high: d.high, low: d.low, close: d.close || d.adjClose, volume: d.volume,
    }));

    // 52-week high/low from OHLCV (last 252 trading days ≈ 1 year)
    const recentOhlcv = ohlcvData.slice(-252);
    const yearHigh = recentOhlcv.length > 0 ? Math.max(...recentOhlcv.map(d => d.high || 0)) : 0;
    // Guard: filter(low>0) before Math.min — empty spread Math.min(...[]) = Infinity
    const validLows = recentOhlcv.filter(d => d.low > 0).map(d => d.low);
    const yearLow = validLows.length > 0 ? Math.min(...validLows) : 0;

    // Ratios
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
      volume: profile.volume || 0, yearHigh, yearLow,
      sharesOutstanding: profile.marketCap && profile.price ? Math.round(profile.marketCap / profile.price) : 0,
      companyName: profile.companyName || ticker, description: profile.description || "",
      sector: profile.sector || "", industry: profile.industry || "", country: profile.country || "",
      revenue, revenueGrowth, operatingIncome: li.operatingIncome || 0,
      netIncome: li.netIncome || 0, ebitda: li.ebitda || 0, grossProfit: li.grossProfit || 0,
      totalDebt: lb.totalDebt || 0, cashEquivalents: lb.cashAndCashEquivalents || lb.cashAndShortTermInvestments || 0,
      totalEquity: lb.totalStockholdersEquity || 0, totalAssets: lb.totalAssets || 0,
      fcfTTM: lc.freeCashFlow || (lc.operatingCashFlow || 0) - Math.abs(lc.capitalExpenditure || 0),
      capex: Math.abs(lc.capitalExpenditure || 0), operatingCashFlow: lc.operatingCashFlow || 0,
      epsTTM: ttmEps,
      epsAdjFY: fyEps,
      epsConsensusNextFY: parsedEstimatesRaw[0]?.estimatedEps || 0, epsGrowth5Y,
      epsGrowthFwd, pegRatio, forwardPE, dividendYield,
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
