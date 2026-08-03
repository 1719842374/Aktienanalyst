/**
 * analyze-route.ts
 * Full /api/analyze endpoint extracted as a self-contained module.
 * Pattern mirrors gold-routes.ts (gold-routes.ts: 29 KB, registerGoldRoutes()).
 *
 * Fixes the structural truncation bug: routes.ts was a monolith too large
 * for reliable tooling. By isolating /api/analyze here, routes.ts becomes
 * a clean orchestrator that can never be silently truncated again.
 *
 * FMP + LLM data sources wired correctly:
 *  - Primary:  getFmpFallbackData() → 13 parallel FMP calls
 *  - LLM:      generateCatalystsAndMatchNews() via llm-openrouter.ts
 *  - Fallback: sector-data.ts templates when LLM/FMP unavailable
 */

import type { Express, Request, Response } from "express";
import type { Server } from "http";

import {
  getFmpBudgetStatus,
  isFmpBudgetLow,
  getFmpFallbackData,
  cacheLLMModeMatches,
  parseNumber,
  detectReportedCurrency,
  fetchFXRate,
  convertFinancials,
  generatePESTELAnalysis,
} from "./analyze-helpers";

import {
  getEffectiveSector,
  getSectorDefaults,
  generateRisks,
  estimateGovExposure,
  matchSegmentTAM,
  generateTAMAnalysis,
} from "./sector-data";

import {
  calcImpliedGStar,
  calcEinpreisungsgrad,
  classifyLynch,
  calcLynchPEG,
  generateCatalystContext,
  generateCatalysts,
} from "./catalyst-engine";

import {
  fetchNewsFromGoogleRSS,
  matchNewsToCatalysts,
  fetchPeerComparisonFromTickers,
  fetchPeerComparison,
} from "./news-peers";

import {
  analyzeRequestSchema,
  type StockAnalysis,
  type Catalyst,
  type Risk,
  type OHLCVPoint,
  type TechnicalIndicators,
  type MADataPoint,
  type MACDDataPoint,
  type TradingSignal,
  type TechnicalStatus,
  type MoatAssessment,
  type PorterForce,
  type CatalystReasoning,
  type CurrencyInfo,
  type PESTELAnalysis,
  type MacroCorrelations,
  type MacroCorrelation,
  type RevenueSegment,
} from "../shared/schema";

import {
  generateCatalystsAndMatchNews,
  generateRiskExplanations,
  generateCatalystDeepDives,
  type CapexTailwindContext,
  generateGrowthThesis,
  generateCompanySpecificRisks,
  generatePolicyContext,
  generatePorterFiveForces,
  generatePESTELAnalysis as generateLLMPESTEL,
  isLLMAvailable,
} from "./llm-openrouter";

import {
  isFmpAvailable,
  fmpBatchQuote,
  fmpProfile,
  fmpIncomeStatement,
  fmpCashFlow,
  fmpBalanceSheet,
  fmpHistoricalPrices,
  fmpAnalystEstimates,
  fmpGrades,
  fmpPriceTarget,
  fmpSegments,
  fmpPeers,
  fmpRatios,
  fmpKeyMetrics,
  fmpQuote,
  convertFmpRowsToUsd,
} from "./fmp";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── In-memory analysis cache ─────────────────────────────────────────────────
interface CachedAnalysis {
  result: StockAnalysis;
  timestamp: number;
  usedLLM: boolean;
}
const analysisCache = new Map<string, CachedAnalysis>();
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

// ─── RSI + MA helpers ─────────────────────────────────────────────────────────
function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(1).map((v, i) => v - closes[i]);
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < changes.length; i++) {
    const ch = changes[i];
    if (ch > 0) { avgGain = (avgGain * (period - 1) + ch) / period; avgLoss = (avgLoss * (period - 1)) / period; }
    else { avgGain = (avgGain * (period - 1)) / period; avgLoss = (avgLoss * (period - 1) + Math.abs(ch)) / period; }
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calculateMA(closes: number[], period: number): number {
  if (closes.length === 0) return 0;
  const slice = closes.slice(-Math.min(period, closes.length));
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function calculateBeta(stockReturns: number[], marketReturns: number[]): number {
  const n = Math.min(stockReturns.length, marketReturns.length);
  if (n < 2) return 1;
  const sR = stockReturns.slice(-n), mR = marketReturns.slice(-n);
  const meanS = sR.reduce((a, b) => a + b, 0) / n;
  const meanM = mR.reduce((a, b) => a + b, 0) / n;
  let cov = 0, varM = 0;
  for (let i = 0; i < n; i++) {
    cov += (sR[i] - meanS) * (mR[i] - meanM);
    varM += (mR[i] - meanM) ** 2;
  }
  return varM === 0 ? 1 : cov / varM;
}

// ─── Full technical series (SMA / EMA / MACD / signals) ───────────────────────
function smaSeries(data: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(data.length);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) sum -= data[i - period];
    out[i] = i >= period - 1 ? sum / period : undefined;
  }
  return out;
}

function emaSeries(data: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(data.length);
  const k = 2 / (period + 1);
  let ema: number | undefined;
  for (let i = 0; i < data.length; i++) {
    if (!isFinite(data[i])) { out[i] = undefined; continue; }
    if (ema === undefined) {
      if (i >= period - 1) {
        let s = 0;
        for (let j = i - period + 1; j <= i; j++) s += data[j];
        ema = s / period;
        out[i] = ema;
      } else {
        out[i] = undefined;
      }
    } else {
      ema = data[i] * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

function buildTechnicalIndicators(
  ohlcvPoints: OHLCVPoint[],
  currentPrice: number
): TechnicalIndicators {
  const n = ohlcvPoints.length;
  const closes = ohlcvPoints.map(p => p.close);
  const dates = ohlcvPoints.map(p => p.date);

  const ma200 = smaSeries(closes, 200);
  const ma100 = smaSeries(closes, 100);
  const ma50  = smaSeries(closes, 50);
  const ma20  = smaSeries(closes, 20);
  const ema26 = emaSeries(closes, 26);
  const ema12 = emaSeries(closes, 12);
  const ema9  = emaSeries(closes, 9);

  // MACD = EMA12 − EMA26; Signal = EMA9(MACD); Histogram = MACD − Signal
  const macdRaw: number[] = closes.map((_, i) => {
    const e12 = ema12[i], e26 = ema26[i];
    return (e12 != null && e26 != null) ? e12 - e26 : NaN;
  });
  // Build clean series for EMA of MACD (skip leading NaNs)
  const firstValid = macdRaw.findIndex(v => isFinite(v));
  const macdForEma = macdRaw.map(v => isFinite(v) ? v : 0);
  const signalSeries = emaSeries(macdForEma, 9);
  // Re-null the signal before first valid MACD
  for (let i = 0; i < firstValid + 8; i++) if (i < n) signalSeries[i] = undefined;

  const maData: MADataPoint[] = dates.map((date, i) => ({
    date,
    close: closes[i],
    ma200: ma200[i],
    ma100: ma100[i],
    ma50:  ma50[i],
    ma20:  ma20[i],
    ema26: ema26[i],
    ema12: ema12[i],
    ema9:  ema9[i],
  }));

  const macdData: MACDDataPoint[] = dates.map((date, i) => {
    const m = isFinite(macdRaw[i]) ? macdRaw[i] : undefined;
    const s = signalSeries[i];
    return {
      date,
      macd: m,
      signal: s,
      histogram: (m != null && s != null) ? m - s : undefined,
    };
  });

  // Signals: Golden/Death Cross + MACD zero-cross / signal-cross
  const signals: TradingSignal[] = [];
  for (let i = 1; i < n; i++) {
    const cur50 = ma50[i], prev50 = ma50[i - 1];
    const cur200 = ma200[i], prev200 = ma200[i - 1];
    if (cur50 != null && cur200 != null && prev50 != null && prev200 != null) {
      if (prev50 <= prev200 && cur50 > cur200) {
        signals.push({ date: dates[i], type: "buy", reason: "Golden Cross (MA50 > MA200)", price: closes[i] });
      } else if (prev50 >= prev200 && cur50 < cur200) {
        signals.push({ date: dates[i], type: "sell", reason: "Death Cross (MA50 < MA200)", price: closes[i] });
      }
    }
    const curM = macdData[i].macd, prevM = macdData[i - 1].macd;
    const curS = macdData[i].signal, prevS = macdData[i - 1].signal;
    if (curM != null && prevM != null && curS != null && prevS != null) {
      if (prevM <= prevS && curM > curS) {
        signals.push({ date: dates[i], type: "buy", reason: "Bullish MACD Cross", price: closes[i] });
      } else if (prevM >= prevS && curM < curS) {
        signals.push({ date: dates[i], type: "sell", reason: "Bearish MACD Cross", price: closes[i] });
      }
    }
  }

  // Current status (last valid values)
  const last = n - 1;
  const lastMA50 = ma50[last];
  const lastMA200 = ma200[last];
  const lastMACD = macdData[last]?.macd;
  const lastSignal = macdData[last]?.signal;
  const prevMACD = last > 0 ? macdData[last - 1]?.macd : undefined;

  const priceAboveMA200 = lastMA200 != null ? currentPrice > lastMA200 : false;
  const ma50AboveMA200 = (lastMA50 != null && lastMA200 != null) ? lastMA50 > lastMA200 : false;
  const macdAboveZero = lastMACD != null ? lastMACD > 0 : false;
  const macdRising = (lastMACD != null && prevMACD != null) ? lastMACD > prevMACD : false;

  const currentStatus: TechnicalStatus = {
    priceAboveMA200,
    ma50AboveMA200,
    macdAboveZero,
    macdRising,
    buySignal: priceAboveMA200 && ma50AboveMA200 && macdAboveZero && macdRising,
    ma200Value: lastMA200,
    ma50Value: lastMA50,
    macdValue: lastMACD,
    signalValue: lastSignal,
  };

  return { maData, macdData, signals, currentStatus };
}

// ─── Moat scoring ─────────────────────────────────────────────────────────────
function scoreMoat(
  grossMargin: number,
  fcfMargin: number,
  returnOnEquity: number,
  revenueGrowth: number,
  description: string
): MoatAssessment {
  const desc = description.toLowerCase();
  const hasBrandMoat = desc.includes("brand") || desc.includes("premium") || desc.includes("luxury");
  const hasNetworkMoat = desc.includes("network effect") || desc.includes("platform") || desc.includes("marketplace");
  const hasSwitchingMoat = desc.includes("switching cost") || desc.includes("sticky") || desc.includes("saas") || desc.includes("subscription");
  const hasCostMoat = desc.includes("low-cost") || desc.includes("cost advantage") || desc.includes("economies of scale");
  const hasPatentMoat = desc.includes("patent") || desc.includes("proprietary") || desc.includes("intellectual property");

  let score = 0;
  const sources: string[] = [];
  const porterForces: PorterForce[] = [];

  if (grossMargin > 60) { score += 2; sources.push("Hohe Bruttomarge (>60%)"); }
  else if (grossMargin > 40) { score += 1; sources.push("Solide Bruttomarge (>40%)"); }

  if (fcfMargin > 20) { score += 2; sources.push("Starke FCF-Marge (>20%)"); }
  else if (fcfMargin > 10) { score += 1; sources.push("Positive FCF-Marge (>10%)"); }

  if (returnOnEquity > 20) { score += 2; sources.push("Hoher ROE (>20%)"); }
  else if (returnOnEquity > 12) { score += 1; sources.push("Solider ROE (>12%)"); }

  if (hasBrandMoat) { score += 1; sources.push("Markenstärke / Pricing Power"); }
  if (hasNetworkMoat) { score += 2; sources.push("Netzwerkeffekte"); }
  if (hasSwitchingMoat) { score += 1; sources.push("Wechselkosten (Switching Costs)"); }
  if (hasCostMoat) { score += 1; sources.push("Kostenvorteile"); }
  if (hasPatentMoat) { score += 1; sources.push("Patente / IP"); }

  const moatStrength: "Wide" | "Narrow" | "None" =
    score >= 6 ? "Wide" : score >= 3 ? "Narrow" : "None";

  porterForces.push(
    { force: "Rivalität unter Wettbewerbern", rating: hasBrandMoat || hasNetworkMoat ? "Niedrig" : "Hoch", score: hasBrandMoat || hasNetworkMoat ? 3 : 7 },
    { force: "Bedrohung durch Neueinsteiger", rating: hasSwitchingMoat || hasPatentMoat ? "Niedrig" : "Mittel", score: hasSwitchingMoat || hasPatentMoat ? 2 : 5 },
    { force: "Verhandlungsmacht Lieferanten", rating: hasCostMoat ? "Niedrig" : "Mittel", score: hasCostMoat ? 3 : 5 },
    { force: "Verhandlungsmacht Kunden", rating: hasSwitchingMoat ? "Niedrig" : "Mittel", score: hasSwitchingMoat ? 2 : 5 },
    { force: "Bedrohung durch Substitute", rating: hasNetworkMoat ? "Niedrig" : "Mittel", score: hasNetworkMoat ? 2 : 5 }
  );

  return { moatStrength, moatScore: Math.min(score, 10), sources, porterForces } as any;
}

// ─── Main registration ────────────────────────────────────────────────────────
export function registerAnalyzeRoute(server: Server, app: Express): void {
  // ── /api/fmp-budget ─────────────────────────────────────────────────────────
  // Exposes the FMP daily budget (calls consumed, remaining, warn threshold
  // and callsPerAnalysis). The legacy `quota` field mirrors the FMP budget for
  // backward compatibility — the old Perplexity 18/day counter is gone.
  app.get("/api/fmp-budget", (_req: Request, res: Response) => {
    const fmp = getFmpBudgetStatus();
    res.json({
      fmp,
      quota: { today: fmp.today, limit: fmp.limit, remaining: fmp.remaining, quotaExceededAt: null, resetsAt: null },
      fmpAvailable: isFmpAvailable(),
    });
  });

  // ── /api/analyze ────────────────────────────────────────────────────────────
  app.post("/api/analyze", async (req: Request, res: Response) => {
    try {
      const parsed = analyzeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const { ticker, useLLM = false, forceRefresh = false } = parsed.data;
      const upperTicker = ticker.toUpperCase();

      // ── Cache check ──
      const cacheKey = `${upperTicker}:${useLLM}`;
      if (!forceRefresh) {
        const cached = analysisCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS && cacheLLMModeMatches(cached.usedLLM, useLLM)) {
          console.log(`[ANALYZE] Cache hit for ${upperTicker}`);
          return res.json(cached.result);
        }
      }

      // ── FMP budget guard ──
      // Return HTTP 429 upfront when the remaining daily budget can no longer
      // cover a full analysis. This is cheaper than starting 13 parallel FMP
      // calls and having the last few fail with an obscure error mid-run.
      if (isFmpBudgetLow()) {
        const budget = getFmpBudgetStatus();
        console.warn(`[ANALYZE] FMP budget low: ${budget.today}/${budget.limit} — refusing ${upperTicker}`);
        return res.status(429).json({
          error: `FMP-Tagesbudget aufgebraucht (${budget.today}/${budget.limit} Calls, noch ${budget.remaining}). Neue Analysen morgen wieder möglich.`,
          errorCode: "RATE_LIMITED",
          fmpBudget: budget,
        });
      }

      console.log(`[ANALYZE] Starting analysis for ${upperTicker} (useLLM=${useLLM})`);

      // ── 1. Fetch FMP data ──
      // trackFmpCall runs inside fmp.ts on every outbound call — no manual
      // increment here or we'd double-count.
      const fmpData = await getFmpFallbackData(upperTicker);
      if (!fmpData) {
        return res.status(503).json({
          error: `Keine Daten für ${upperTicker} verfügbar. FMP API nicht erreichbar oder Ticker ungültig.`,
        });
      }

      // geoSegments was added in commit cd79678 (fmp.ts:fmpGeoSegments +
      // analyze-helpers.ts wiring). fmpData carries it through to us.
      const { quote, profile, financials, analyst, ohlcv, segments, geoSegments, peers, ratios } = fmpData as any;

      // ── 2. Parse core financials ──
      const price = parseNumber(String(quote?.price ?? 0));
      const companyName = String(profile?.companyName ?? profile?.name ?? upperTicker);
      const description = String(profile?.description ?? "");
      const sector = String(profile?.sector ?? "");
      const industry = String(profile?.industry ?? "");
      const country = String(profile?.country ?? "US");
      const exchange = String(profile?.exchange ?? "");
      const website = String(profile?.website ?? "");
      const image = String(profile?.image ?? "");
      const reportedCurrency = String(profile?.currency ?? "USD");

      // Income statement (most recent year)
      const incomeLatest = financials.income[0] ?? {};
      const incomeY1 = financials.income[1] ?? {};
      const revenue = parseNumber(String(incomeLatest.revenue ?? incomeLatest.totalRevenue ?? 0));
      const revenueY1 = parseNumber(String(incomeY1.revenue ?? incomeY1.totalRevenue ?? 0));
      const revenueGrowth = revenueY1 > 0 ? ((revenue - revenueY1) / revenueY1) * 100 : 0;
      const netIncome = parseNumber(String(incomeLatest.netIncome ?? 0));
      const ebitda = parseNumber(String(incomeLatest.ebitda ?? 0));
      const grossProfit = parseNumber(String(incomeLatest.grossProfit ?? 0));
      const operatingIncome = parseNumber(String(incomeLatest.operatingIncome ?? 0));

      // Cash flow
      const cfLatest = financials.cashflow[0] ?? {};
      const operatingCF = parseNumber(String(cfLatest.operatingCashFlow ?? cfLatest.netCashProvidedByOperatingActivities ?? 0));
      const capex = Math.abs(parseNumber(String(cfLatest.capitalExpenditure ?? cfLatest.capitalExpenditures ?? 0)));
      const fcfTTM = operatingCF - capex;

      // Balance sheet
      const bsLatest = financials.balanceSheet[0] ?? {};
      const totalDebt = parseNumber(String(bsLatest.totalDebt ?? 0));
      const cashEquivalents = parseNumber(String(bsLatest.cashAndCashEquivalents ?? bsLatest.cashAndShortTermInvestments ?? 0));
      const totalEquity = parseNumber(String(bsLatest.totalStockholdersEquity ?? bsLatest.totalEquity ?? 0));
      const totalAssets = parseNumber(String(bsLatest.totalAssets ?? 0));
      const netDebt = totalDebt - cashEquivalents;

      // Ratios
      const ratioLatest = ratios[0] ?? {};

      // eps from quote/profile is TTM; income[0].epsDiluted is last FY. Prefer TTM.
      const _epsForPE = parseNumber(String(quote?.eps ?? profile?.eps ?? incomeLatest.epsDiluted ?? 0));

      // P/E: try quote first, then ratios, then derive from price / TTM EPS.
      // FMP's /stable/ratios uses `priceToEarningsRatio` (not `priceEarningsRatio`).
      let pe = parseNumber(String(quote?.pe ?? ratioLatest.priceToEarningsRatio ?? ratioLatest.priceEarningsRatio ?? 0));
      if (!(pe > 0) && _epsForPE > 0 && price > 0) pe = price / _epsForPE;

      // Forward P/E: try ratios first, then derive from the next-FY EPS estimate.
      // We compute the estimate value (`nextFyEpsAbs`) later in the flow, but the
      // ratios-first branch usually satisfies forwardPE for large caps; the derived
      // fallback runs below after `nextFyEpsAbs` is known.
      let forwardPE = parseNumber(String(ratioLatest.forwardPE ?? ratioLatest.priceToEarningsRatioTTM ?? 0));

      const pbRatio = parseNumber(String(ratioLatest.priceToBookRatio ?? 0));
      const evEbitda = parseNumber(String(ratioLatest.enterpriseValueMultiple ?? ratioLatest.evToEbitda ?? 0));
      // dividendYield: FMP inconsistently returns either a decimal (0.036 = 3.6%)
      // or an already-percent value (3.6 = 3.6%). Detect by magnitude: any value
      // < 1 must be decimal form, so multiply by 100. This replaces the older
      // check `> 1 ? 0.01 : 1` which mis-scaled 0.036 to 0.036% instead of 3.6%.
      const _divRaw = parseNumber(String(quote?.dividendYield ?? ratioLatest.dividendYield ?? profile?.lastAnnualDividend ?? 0));
      const _divYield = (() => {
        if (_divRaw <= 0) return 0;
        // Value < 1 is definitely a decimal (0.036 → 3.6%). Value ≥ 1 is already
        // in percent (3.6 stays 3.6). Yields > 25% are implausible for equities
        // so treat those as raw dividend-per-share divided by price.
        if (_divRaw < 1) return _divRaw * 100;
        if (_divRaw > 25 && price > 0) return (_divRaw / price) * 100;
        return _divRaw;
      })();
      const dividendYield = _divYield;
      const returnOnEquity = parseNumber(String(ratioLatest.returnOnEquity ?? 0));
      const beta = parseNumber(String(profile?.beta ?? quote?.beta ?? 1));

      // sharesOutstanding: FMP /stable/profile field is `sharesOutstanding` in the
      // legacy API but `mktCap / price` in newer responses. Fall back to derived.
      let sharesOutstanding = parseNumber(String(profile?.sharesOutstanding ?? quote?.sharesOutstanding ?? 0));
      const profileMktCap = parseNumber(String(profile?.mktCap ?? profile?.marketCap ?? quote?.marketCap ?? 0));
      if (!(sharesOutstanding > 0) && profileMktCap > 0 && price > 0) {
        sharesOutstanding = Math.round(profileMktCap / price);
      }
      const marketCap = price > 0 && sharesOutstanding > 0 ? price * sharesOutstanding : profileMktCap;
      const yearHigh = parseNumber(String(quote?.yearHigh ?? 0));
      const yearLow = parseNumber(String(quote?.yearLow ?? 0));

      // Derived margins
      const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      const operatingMargin = revenue > 0 ? (operatingIncome / revenue) * 100 : 0;
      const netMargin = revenue > 0 ? (netIncome / revenue) * 100 : 0;
      const fcfMargin = revenue > 0 ? (fcfTTM / revenue) * 100 : 0;

      // FX (non-USD stocks)
      let fxRate = 1;
      if (reportedCurrency !== "USD" && reportedCurrency !== "") {
        fxRate = fetchFXRate(reportedCurrency) ?? 1;
        console.log(`[ANALYZE] FX: ${reportedCurrency} → USD = ${fxRate}`);
      }

      // ── 3. OHLCV → full technical indicators (10Y) ──
      let ohlcvRows: any[] = Array.isArray(ohlcv) ? ohlcv : (ohlcv as any)?.historical ?? [];
      ohlcvRows = [...ohlcvRows].sort((a, b) => String(a.date).localeCompare(String(b.date)));

      // Keep up to ~10Y of trading days (252*10 ≈ 2520 + buffer).
      // FMP Pro delivers the full range; previous hard-cap of 504 (~2Y) blocked the client 10Y view.
      const OHLCV_MAX_POINTS = 2600;
      const ohlcvPoints: OHLCVPoint[] = ohlcvRows.slice(-OHLCV_MAX_POINTS).map((r: any) => ({
        date: String(r.date ?? "").slice(0, 10),
        open: parseFloat(String(r.open)) || 0,
        high: parseFloat(String(r.high)) || 0,
        low: parseFloat(String(r.low)) || 0,
        close: parseFloat(String(r.close)) || 0,
        volume: parseFloat(String(r.volume ?? 0)) || 0,
      })).filter(p => p.close > 0 && p.date.length === 10);

      const technicalIndicators: TechnicalIndicators = buildTechnicalIndicators(ohlcvPoints, price);

      console.log(`[ANALYZE] Technical: ${ohlcvPoints.length} OHLCV pts, ${technicalIndicators.signals.length} signals, buySignal=${technicalIndicators.currentStatus.buySignal}`);

      // ── 4. Analyst targets ──
      const analystPTMedian = parseNumber(String(analyst.priceTarget?.targetMedian ?? analyst.priceTarget?.priceTarget ?? 0));
      const analystPTHigh = parseNumber(String(analyst.priceTarget?.targetHigh ?? 0));
      const analystPTLow = parseNumber(String(analyst.priceTarget?.targetLow ?? 0));
      const analystCount = Number(analyst.priceTarget?.numberOfAnalysts ?? analyst.grades?.length ?? 0);

      const latestGrade = analyst.grades?.[0];
      const analystConsensus = String(latestGrade?.recommendationMean ?? latestGrade?.action ?? "Hold");

      // EPS estimates — FMP /stable/analyst-estimates returns rows sorted
      // DESCENDING by date and covers multiple future FYs (e.g. NVO returns
      // 2030, 2029, 2028, … — the [0] entry is 5 years out, not "next FY"!).
      // We must pick the earliest fiscal-year end that is still in the future
      // (or the most-recent past FY if none are ahead — e.g. late-year filings).
      //
      // Fields: /stable/analyst-estimates uses `epsAvg` today; older variants
      // used `estimatedEpsAvg` / `estimatedEps`. FX conversion is applied
      // upstream in getFmpFallbackData (see FX_CONVERTIBLE_FIELDS).
      const _todayIso = new Date().toISOString().slice(0, 10);
      const _estRows: any[] = Array.isArray(analyst.estimates) ? analyst.estimates : [];
      const _epsField = (r: any): number => parseNumber(String(
        r?.epsAvg ?? r?.estimatedEpsAvg ?? r?.estimatedEpsDiluted ?? r?.estimatedEps ?? r?.eps ?? 0
      ));
      // Prefer future FYs; among futures, take the CLOSEST one to today. If no
      // future FY has a positive EPS estimate, fall back to the latest past FY
      // with a positive estimate.
      const _futureRows = _estRows.filter((r) => (r?.date ?? "") > _todayIso && _epsField(r) > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const _pastRows = _estRows.filter((r) => (r?.date ?? "") <= _todayIso && _epsField(r) > 0).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const estCurrent: any = _futureRows[0] ?? _pastRows[0] ?? analyst.estimates?.[0] ?? {};
      const nextFyEpsAbs = _epsField(estCurrent);
      // epsGrowthFwd is a PERCENTAGE (used by classifyLynch and calcLynchPEG),
      // derived from the absolute next-FY estimate vs current TTM EPS.
      const epsGrowthFwd = _epsForPE > 0 && nextFyEpsAbs > 0
        ? ((nextFyEpsAbs / _epsForPE) - 1) * 100
        : 0;

      // Backfill forwardPE if the ratios endpoint didn't supply it.
      if (!(forwardPE > 0) && nextFyEpsAbs > 0 && price > 0) {
        forwardPE = price / nextFyEpsAbs;
      }

      // ── 5. Sector + defaults ──
      // getEffectiveSector returns { sector, industry, isHybrid, hybridNote } —
      // downstream code expects the plain sector/industry strings so we destructure.
      const eff = getEffectiveSector(sector, industry, description);
      const effectiveSector = eff.sector;
      const effectiveIndustry = eff.industry;
      const sectorDefaults = getSectorDefaults(effectiveSector, effectiveIndustry);
      // WACC — mid scenario is our default (kons/opt available for scenarios in DCF).
      const wacc = sectorDefaults.waccScenarios.avg;
      const govExposureRaw = estimateGovExposure(sector, industry, description);
      const govExposure = govExposureRaw.exposure;

      // ── 6. Lynch classification ──
      // Compute epsGrowth5Y FIRST from the income-statement history so
      // classifyLynch sees the real 5Y CAGR, not the revenueGrowth proxy.
      // Getting this wrong caused NVO (Healthcare Pharma) to be classified as
      // slow_grower because Wegovy-year revenueGrowth turned negative even
      // though EPS CAGR is still ~11%.
      const _rawEpsFY = parseNumber(String(incomeLatest.epsDiluted ?? incomeLatest.eps ?? 0));
      let epsGrowth5Y = revenueGrowth;
      if (financials.income.length >= 3) {
        const oldest = financials.income[financials.income.length - 1] ?? {};
        const oldEps = parseNumber(String((oldest as any).epsDiluted ?? (oldest as any).eps ?? 0));
        if (oldEps > 0 && _rawEpsFY > 0) {
          const n = financials.income.length - 1;
          epsGrowth5Y = ((Math.pow(_rawEpsFY / oldEps, 1 / n) - 1) * 100);
        }
      }
      const lynchClass = classifyLynch({ epsGrowth5Y, revenueGrowth, sector: effectiveSector, industry, dividendYield, fcfMargin, pe, forwardPE, pbRatio });
      const { peg, pegBasis } = calcLynchPEG({ lynchClass, pe, forwardPE, epsGrowth5Y, epsGrowthFwd, revenueGrowth, dividendYield });
      const impliedGStar = calcImpliedGStar({ price, sharesOutstanding, netDebt, fcf: fcfTTM, wacc });

      // ── 7. Revenue segments ──
      // fmpSegments() (called upstream in getFmpFallbackData) already returns a
      // clean [{name, revenue, percentage, date}] array — it unwraps FMP's new
      // /stable/revenue-product-segmentation shape ({symbol, fiscalYear, period,
      // data: {"XBOX": 21B, "Windows": 17B, ...}}) into flat rows.
      //
      // The previous code here iterated Object.keys(segments[0]) which read the
      // per-row fields (name/revenue/percentage) as segment names, producing
      // garbage like [{name:'revenue', revenue:129B, percentage:100},
      // {name:'percentage', revenue:39, percentage:0}]. That's what the UI
      // showed as 'UMSATZANTEIL NACH SEGMENTEN: revenue 100% / percentage 0%'.
      //
      // Just pass through the pre-parsed rows, cap at 8 largest, and rename
      // FMP's over-verbose canonical labels to something human-readable.
      const _prettifyProduct = (raw: string): string => {
        // FMP normalises product names to Title Case; some come out awkwardly
        // long. Trim common prefixes/suffixes so the bar-chart labels fit.
        return raw
          .replace(/^Microsoft Three Six Five/, "Microsoft 365")
          .replace(/\s+And\s+/g, " & ")
          .replace(/\s+Products?\s+&\s+Cloud\s+Services$/i, "")
          .replace(/\s+Products?\s+And\s+Cloud\s+Services$/i, "")
          .replace(/\s+Products?\s+&\s+Services$/i, "")
          .replace(/\s+Products?\s+And\s+Services$/i, "")
          .replace(/\s+Corporation$/, "")
          .replace(/\s+Inc\.?$/, "")
          .trim();
      };
      let revenueSegments: RevenueSegment[] = Array.isArray(segments)
        ? segments
            .filter((s: any) => s && typeof s === "object" && typeof s.name === "string" && Number(s.revenue) > 0)
            .map((s: any) => ({
              name: _prettifyProduct(String(s.name)),
              revenue: Number(s.revenue),
              percentage: typeof s.percentage === "number" ? s.percentage : 0,
            }))
            .slice(0, 8)
        : [];

      // FMP has NO product-segmentation data for many ADRs (NVO, ASML, TSM,
      // NESN, etc.) — the endpoint returns []. For a curated set of the most
      // frequently-analysed foreign filers, derive segments proportionally from
      // their reported total revenue using the split from each company's
      // latest annual report. Percentages match published FY figures; revenue
      // is scaled to the current-year total so it stays consistent.
      //
      // ONLY used as a fallback when FMP returns 0 rows. NEVER overrides live
      // FMP data. Extend cautiously — numbers here must be sourced from an
      // official filing and dated in the comment.
      if (revenueSegments.length === 0 && revenue > 0) {
        const productFallback: Record<string, Array<{ name: string; pct: number }>> = {
          // Novo Nordisk FY2024 (annual report): Diabetes & obesity care 91.7%
          // (GLP-1 Diabetes 43.6%, Obesity care 22.4%, Insulin 8.6%, Other D&O 17.1%),
          // Rare disease 5.4%, Other 2.9%. Simplified into the 4 major buckets.
          NVO: [
            { name: "GLP-1 Diabetes (Ozempic/Rybelsus)", pct: 43.6 },
            { name: "Obesity Care (Wegovy/Saxenda)", pct: 22.4 },
            { name: "Insulin & Other Diabetes", pct: 25.7 },
            { name: "Rare Disease", pct: 5.4 },
            { name: "Other", pct: 2.9 },
          ],
          // ASML FY2024: EUV 40%, ArFi 26%, ArF Dry 4%, KrF 8%, Metrology & Inspection 3%,
          // Installed Base Mgmt (Service) 19%.
          ASML: [
            { name: "EUV Lithography", pct: 40 },
            { name: "ArFi Immersion", pct: 26 },
            { name: "Installed Base Mgmt (Service)", pct: 19 },
            { name: "KrF Lithography", pct: 8 },
            { name: "ArF Dry", pct: 4 },
            { name: "Metrology & Inspection", pct: 3 },
          ],
          // TSMC FY2024: HPC 51%, Smartphone 35%, IoT 6%, Automotive 5%, DCE 1%, Other 2%.
          TSM: [
            { name: "HPC (AI & Data Center)", pct: 51 },
            { name: "Smartphone", pct: 35 },
            { name: "IoT", pct: 6 },
            { name: "Automotive", pct: 5 },
            { name: "Digital Consumer Electronics", pct: 1 },
            { name: "Other", pct: 2 },
          ],
          // Nestle FY2024: Powdered & Liquid Beverages 26%, PetCare 21%, Nutrition & Health Science 17%,
          // Prepared Dishes & Cooking 12%, Milk & Ice cream 10%, Confectionery 8%, Water 4%, Other 2%.
          NSRGY: [
            { name: "Powdered & Liquid Beverages", pct: 26 },
            { name: "PetCare", pct: 21 },
            { name: "Nutrition & Health Science", pct: 17 },
            { name: "Prepared Dishes & Cooking", pct: 12 },
            { name: "Milk Products & Ice Cream", pct: 10 },
            { name: "Confectionery", pct: 8 },
            { name: "Water", pct: 4 },
            { name: "Other", pct: 2 },
          ],
          // SAP FY2024: Cloud 45%, Software licenses & support 40%, Services 15%.
          SAP: [
            { name: "Cloud", pct: 45 },
            { name: "Software Licenses & Support", pct: 40 },
            { name: "Services", pct: 15 },
          ],
          // LVMH FY2024: Fashion & Leather Goods 48%, Wines & Spirits 8%, Perfumes & Cosmetics 10%,
          // Watches & Jewelry 13%, Selective Retailing 21%.
          LVMUY: [
            { name: "Fashion & Leather Goods", pct: 48 },
            { name: "Selective Retailing", pct: 21 },
            { name: "Watches & Jewelry", pct: 13 },
            { name: "Perfumes & Cosmetics", pct: 10 },
            { name: "Wines & Spirits", pct: 8 },
          ],
          // Toyota FY2024 (Mar 2025 fiscal): Automotive 90%, Financial Services 7%, Other 3%.
          TM: [
            { name: "Automotive", pct: 90 },
            { name: "Financial Services", pct: 7 },
            { name: "Other", pct: 3 },
          ],
        };
        const fb = productFallback[upperTicker];
        if (fb) {
          revenueSegments = fb.map(row => ({
            name: row.name,
            revenue: Math.round(revenue * row.pct / 100),
            percentage: row.pct,
          }));
          console.log(`[SEGMENTS] Using curated fallback for ${upperTicker} (FMP had no product data)`);
        }
      }

      // ── 8. TAM analysis ──
      const tamAnalysis = generateTAMAnalysis(effectiveSector, industry, description, revenue, revenueGrowth, revenueSegments);

      // ── 9. Peers ──
      const peerTickers: string[] = Array.isArray(peers) ? peers.slice(0, 5).map((p: any) => String(p.symbol ?? p ?? "")).filter(Boolean) : [];

      // ── 10. News ──
      let newsItems: any[] = [];
      try {
        newsItems = await fetchNewsFromGoogleRSS(upperTicker, companyName);
      } catch (newsErr: any) {
        console.warn(`[ANALYZE] News fetch failed for ${upperTicker}: ${newsErr?.message?.substring(0, 80)}`);
      }
      const newsHeadlines = newsItems.map((n: any) => String(n.title ?? "")).filter(Boolean);

      // ── 11. Catalysts (LLM or template) ──
      let catalysts: Catalyst[] = [];
      let llmModelUsed = "";
      let capexContext: CapexTailwindContext | null = null;

      if (useLLM) {
        try {
          const llmResult = await generateCatalystsAndMatchNews({
            ticker: upperTicker,
            companyName,
            sector: effectiveSector,
            industry,
            description,
            revenue,
            revenueGrowth,
            fcfMargin,
            price,
            pe,
            marketCap,
            analystPTMedian,
            governmentExposure: govExposure,
            impliedGStar,
            capexContext,
            keyProjects: [],
            secFilingExcerpts: [],
            newsItems,
          });
          if (llmResult) {
            catalysts = llmResult.catalysts;
            llmModelUsed = llmResult.modelUsed;
          }
        } catch (llmErr: any) {
          console.warn(`[ANALYZE] LLM catalyst call failed: ${llmErr?.message?.substring(0, 100)}`);
        }
      }

      // Fallback: template catalysts
      if (catalysts.length < 3) {
        catalysts = generateCatalysts(
          effectiveSector, industry, revenueGrowth, fcfMargin, description,
          revenue, price, sharesOutstanding, netDebt, fcfTTM, wacc, revenueGrowth
        );
        for (const c of catalysts) {
          if (!c.context) {
            c.context = generateCatalystContext(c.name, effectiveSector, industry, description, revenueGrowth, fcfMargin, revenue);
          }
          const epr = calcEinpreisungsgrad({ bruttoUpside: c.bruttoUpside, price, sharesOutstanding, netDebt, fcf: fcfTTM, wacc, revenueGrowth, catalystType: "growth" });
          c.einpreisungsgrad = epr;
          c.nettoUpside = +(c.bruttoUpside * (1 - epr / 100)).toFixed(2);
          c.gb = +(c.pos / 100 * c.nettoUpside).toFixed(2);
        }
        if (newsItems.length > 0) {
          try { matchNewsToCatalysts(newsItems, catalysts); } catch {}
        }
      }

      // ── 12. Risks ──
      let risks: Risk[] = [];

      if (useLLM) {
        try {
          const llmRisks = await generateCompanySpecificRisks({
            ticker: upperTicker, companyName, description, sector: effectiveSector, industry,
            revenue, revenueGrowth, fcfMargin, grossMargin, forwardPE, beta,
            governmentExposure: govExposure,
            topCatalysts: catalysts.slice(0, 3).map((c) => ({ name: c.name, context: c.context ?? "" })),
            capexContext: capexContext ? { sector: capexContext.sector, programmes: capexContext.programmes, rationale: capexContext.beneficiaryEntry?.rationale ?? "" } : null,
            recentNewsHeadlines: newsHeadlines.slice(0, 5),
          });
          if (llmRisks && llmRisks.length >= 3) {
            risks = llmRisks.map((r) => ({
              ...r,
              expectedDamage: +(r.ew / 100 * r.impact).toFixed(2),
            }));
          }
        } catch (riskErr: any) {
          console.warn(`[ANALYZE] LLM risks failed: ${riskErr?.message?.substring(0, 80)}`);
        }
      }

      if (risks.length < 3) {
        risks = generateRisks(effectiveSector, beta, govExposure);
      }

      if (useLLM && risks.length > 0) {
        try {
          const enriched = await generateRiskExplanations({
            ticker: upperTicker, companyName, sector: effectiveSector, industry, description,
            revenue, revenueGrowth, fcfMargin, price, pe, marketCap,
            governmentExposure: govExposure, risks,
            keyProjects: [],
            recentNewsHeadlines: newsHeadlines.slice(0, 5),
            capexContext,
          });
          if (enriched) risks = enriched;
        } catch {}
      }

      // ── 13. Catalyst deep dives ──
      let catalystDeepDives: any[] | null = null;
      if (useLLM && catalysts.length > 0) {
        try {
          catalystDeepDives = await generateCatalystDeepDives({
            ticker: upperTicker, companyName, sector: effectiveSector, description,
            revenue, revenueGrowth, fcfMargin, price, analystPT: analystPTMedian,
            catalysts: catalysts.slice(0, 5),
            newsHeadlines: newsHeadlines.slice(0, 4),
          });
        } catch {}
      }

      // ── 14. Growth thesis ──
      let growthThesis: string | null = null;
      if (useLLM) {
        try {
          growthThesis = await generateGrowthThesis({
            ticker: upperTicker, companyName, description, sector: effectiveSector, industry,
            revenueGrowth, fcfMargin, grossMargin, operatingMargin, forwardPE, evEbitda,
            analystPTMedian, currentPrice: price, returnOnEquity,
            topCatalysts: catalysts.slice(0, 2).map((c) => ({ name: c.name, context: c.context ?? "" })),
            capexContext: capexContext ? { sector: capexContext.sector, programmes: capexContext.programmes, rationale: capexContext.beneficiaryEntry?.rationale ?? "" } : null,
          });
        } catch {}
      }

      // ── 15. Porter + PESTEL ──
      const moatAssessment = scoreMoat(grossMargin, fcfMargin, returnOnEquity, revenueGrowth, description);

      let pestelAnalysis: PESTELAnalysis = generatePESTELAnalysis(
        effectiveSector, industry, description, beta, govExposure, reportedCurrency
      );

      let porterForces: any[] | null = null;
      if (useLLM) {
        const [llmPorter] = await Promise.allSettled([
          generatePorterFiveForces({
            ticker: upperTicker, companyName, sector: effectiveSector, industry, description,
            revenue, revenueGrowth, fcfMargin, grossMargin, marketCap,
            topCatalysts: catalysts.slice(0, 3).map((c) => ({ name: c.name, context: c.context ?? "" })),
            recentNewsHeadlines: newsHeadlines.slice(0, 5),
            keyProjects: [],
          }),
        ]);
        if (llmPorter.status === "fulfilled" && llmPorter.value) porterForces = llmPorter.value;
      }

      if (porterForces && porterForces.length >= 4) {
        moatAssessment.porterForces = porterForces.map((f: any) => ({
          force: String(f.force),
          rating: f.rating as "Hoch" | "Mittel" | "Niedrig",
          score: Number(f.score),
        }));
      }

      // ── 16. Policy context ──
      let policyContext: any = null;
      if (useLLM) {
        try {
          policyContext = await generatePolicyContext({
            ticker: upperTicker, companyName, sector: effectiveSector, industry,
            description, governmentExposure: govExposure,
          });
        } catch {}
      }

      // ── 17. Peer comparison ──
      // Fills every column of the Rel. Bewertung section: pe, peg, ps, pb,
      // epsGrowth1Y, epsGrowth5Y for BOTH subject and each peer, plus a peer
      // average and a sector median. Values missing from FMP's /ratios /quote
      // endpoints are computed on the fly (5Y EPS CAGR, revenue YoY per share).
      //
      // Subject-side pb + epsGrowth1Y are computed here because
      // fetchPeerComparisonFromTickers only has the peers' /ratios rows in
      // scope; the subject's TTM figures live on the /api/analyze call chain.
      const subjectPB = pbRatio > 0 ? pbRatio : null;
      // 1Y EPS YoY: rawEpsFY vs the prior-FY EPS from the income-statement
      // history (income is sorted newest-first). Fallback null if no prior FY.
      // NOTE: use _rawEpsFY (declared in step 6) — the alias `rawEpsFY` is
      // defined later in the flow, referencing it here would trip the TDZ.
      const _priorFyEps = parseNumber(String((financials.income[1] as any)?.epsDiluted ?? (financials.income[1] as any)?.eps ?? 0));
      const subjectEpsGrowth1Y = _priorFyEps > 0 && _rawEpsFY > 0
        ? +(((_rawEpsFY / _priorFyEps) - 1) * 100).toFixed(1)
        : null;

      let peerComparison: any = null;
      if (peerTickers.length > 0) {
        try {
          peerComparison = await fetchPeerComparisonFromTickers(
            upperTicker, peerTickers, pe, peg ?? 0, revenue, marketCap, revenueGrowth, epsGrowth5Y,
            { pb: subjectPB, epsGrowth1Y: subjectEpsGrowth1Y }
          );
        } catch (peerErr: any) {
          console.warn(`[ANALYZE] Peer comparison failed: ${peerErr?.message?.substring(0, 80)}`);
        }
      }
      if (!peerComparison) {
        try {
          peerComparison = await fetchPeerComparison(
            upperTicker, companyName, pe, peg ?? 0, revenue, marketCap, revenueGrowth, epsGrowth5Y, peerTickers
          );
        } catch {}
      }

      // ── 18. DCF / fair value ──
      const dcfWacc = wacc / 100;
      const dcfGrowthRate = Math.min(Math.max(revenueGrowth / 100, -0.05), 0.25);
      const dcfTerminalGrowth = 0.025;
      const dcfYears = 5;
      let dcfFairValue = 0;
      if (fcfTTM > 0 && sharesOutstanding > 0 && dcfWacc > dcfTerminalGrowth) {
        let pvFCF = 0;
        for (let y = 1; y <= dcfYears; y++) {
          pvFCF += fcfTTM * Math.pow(1 + dcfGrowthRate, y) / Math.pow(1 + dcfWacc, y);
        }
        const terminalValue = fcfTTM * Math.pow(1 + dcfGrowthRate, dcfYears) * (1 + dcfTerminalGrowth) / (dcfWacc - dcfTerminalGrowth) / Math.pow(1 + dcfWacc, dcfYears);
        dcfFairValue = Math.round((pvFCF + terminalValue - netDebt) / sharesOutstanding * 100) / 100;
      }

      const upsidePotential = dcfFairValue > 0 && price > 0
        ? Math.round((dcfFairValue / price - 1) * 1000) / 10
        : analystPTMedian > 0 && price > 0
          ? Math.round((analystPTMedian / price - 1) * 1000) / 10
          : 0;

      // ── 19. Macro correlations ──
      const isBank =
        effectiveSector.toLowerCase().includes("financ") ||
        industry.toLowerCase().includes("bank") ||
        industry.toLowerCase().includes("financ") ||
        industry.toLowerCase().includes("insurance");

      const macroCorrelations: MacroCorrelation[] = [
        { factor: "Fed Funds Rate", correlation: isBank ? 0.6 : beta > 1.2 ? -0.4 : -0.2, description: isBank ? "Steigende Zinsen erhöhen NIM" : "Steigende Zinsen komprimieren Multiples" },
        { factor: "USD Stärke", correlation: country !== "US" ? -0.3 : 0.1, description: country !== "US" ? "USD-Stärke belastet Auslands-Earnings" : "Geringer USD-Einfluss (US-fokussiert)" },
        { factor: "Ölpreis (WTI)", correlation: effectiveSector.toLowerCase().includes("energ") ? 0.7 : -0.1, description: effectiveSector.toLowerCase().includes("energ") ? "Ölpreis direkt mit Revenue korreliert" : "Indirekter Kostenfaktor" },
        { factor: "VIX (Volatilität)", correlation: -0.5, description: "Hohe Marktvolatilität belastet Growth-Aktien" },
      ];

      // ── 20. Assemble final result ──
      // IMPORTANT — the response shape here must match shared/schema.ts:StockAnalysis
      // so the 17 frontend sections (Dashboard.tsx SECTIONS) don't crash on missing
      // fields. Field names are prescriptive: currentPrice not price, analystPT.median
      // not analystPTMedian, historicalPrices not ohlcvPoints, peRatio not pe, etc.

      // historicalPrices[] — Section10 (TechnicalChart) and MonteCarlo both read this.
      const historicalPrices = ohlcvPoints.map((p) => ({ date: p.date, close: p.close }));

      // EPS chain — rawEpsFY was already parsed in step 6 for the CAGR; alias
      // it for clarity here.
      const rawEpsFY = _rawEpsFY;
      const epsTTM = parseNumber(String(quote?.eps ?? profile?.eps ?? rawEpsFY));
      const epsAdjFY = rawEpsFY;
      // Absolute next-FY consensus EPS (in $) — used by Section 4 for forwardPE
      // display. Distinct from epsGrowthFwd which is a percentage.
      const epsConsensusNextFY = nextFyEpsAbs || parseNumber(String(
        (analyst.estimates?.[0] as any)?.estimatedEpsAvg ??
        (analyst.estimates?.[0] as any)?.estimatedEps ?? 0
      ));
      // epsGrowth5Y was computed earlier from the income-statement history
      // (see step 6 — needed for classifyLynch). No refinement needed here.

      // Ratings — map buy/hold/sell distribution from analyst.grades.
      const ratingsBuy = analyst.grades.filter((g: any) => /buy|outperform|overweight/i.test(String(g.newGrade ?? g.gradeCompany ?? ""))).length;
      const ratingsSell = analyst.grades.filter((g: any) => /sell|underperform|underweight/i.test(String(g.newGrade ?? g.gradeCompany ?? ""))).length;
      const ratingsHold = Math.max(0, analyst.grades.length - ratingsBuy - ratingsSell);

      // Sector profile — the shape Section5/Section6 depend on.
      const sectorProfile = {
        sector: effectiveSector,
        cycleClass: sectorDefaults.cycleClass,
        politicalCycle: sectorDefaults.politicalCycle,
        waccScenarios: sectorDefaults.waccScenarios,
        growthAssumptions: sectorDefaults.growthAssumptions,
        macroSensitivity: {
          interestUp: { wacc: "+50–100bps", dcf: "-5–-12%" },
          interestDown: { wacc: "-50–100bps", dcf: "+5–+12%" },
          fiscalUp: "Positiv — höhere öff. Aufwendungen bei govExposure > 20%",
          fiscalDown: "Neutral bis leicht negativ",
          geoUp: "Negativ für grenzüberschreitende Umsatz-Exposition",
          geoDown: "Neutral",
        },
        regulatoryNotes: sectorDefaults.politicalCycle,
      };

      // financialStatements — aggregated view for the FinancialStatements section.
      const debtToEquity = totalEquity > 0 ? totalDebt / totalEquity : 0;
      const currentAssets = parseNumber(String(bsLatest.totalCurrentAssets ?? 0));
      const currentLiab = parseNumber(String(bsLatest.totalCurrentLiabilities ?? 0));
      const currentRatio = currentLiab > 0 ? currentAssets / currentLiab : 0;
      const totalLiab = parseNumber(String(bsLatest.totalLiabilities ?? Math.max(0, totalAssets - totalEquity)));
      const ebitdaMargin = revenue > 0 ? (ebitda / revenue) * 100 : 0;
      const fcfPerShare = sharesOutstanding > 0 ? fcfTTM / sharesOutstanding : 0;
      const rawEpsGrowth = (() => {
        const prevEps = parseNumber(String((incomeY1 as any).epsDiluted ?? (incomeY1 as any).eps ?? 0));
        return prevEps > 0 && rawEpsFY > 0 ? ((rawEpsFY / prevEps - 1) * 100) : 0;
      })();
      const healthReasons: string[] = [];
      if (fcfMargin > 15) healthReasons.push("Starke FCF-Marge > 15%");
      else if (fcfMargin < 5 && fcfMargin > 0) healthReasons.push("Schwache FCF-Marge < 5%");
      else if (fcfMargin <= 0) healthReasons.push("Negative FCF-Marge");
      if (debtToEquity > 2) healthReasons.push("Hohe Verschuldung (D/E > 2)");
      if (currentRatio > 1.5) healthReasons.push("Solide Liquidität (Current Ratio > 1.5)");
      else if (currentRatio < 1 && currentRatio > 0) healthReasons.push("Angespannte Liquidität (Current Ratio < 1)");
      const health: "Excellent" | "Good" | "Moderate" | "Weak" | "Critical" =
        fcfMargin > 20 && debtToEquity < 1 ? "Excellent" :
        fcfMargin > 10 && debtToEquity < 2 ? "Good" :
        fcfMargin > 0 ? "Moderate" :
        fcfMargin > -10 ? "Weak" : "Critical";

      const financialStatements = {
        incomeStatement: {
          revenue, revenueGrowth,
          grossProfit, grossMargin,
          operatingIncome, operatingMargin,
          netIncome, netMargin,
          ebitda, ebitdaMargin,
          eps: epsTTM, epsGrowth: rawEpsGrowth,
        },
        balanceSheet: {
          totalAssets, totalLiabilities: totalLiab, totalEquity,
          cashEquivalents, totalDebt, netDebt,
          debtToEquity, currentRatio,
        },
        cashFlow: {
          operatingCashFlow: operatingCF, capex, fcf: fcfTTM,
          fcfMargin, fcfPerShare,
        },
        health,
        healthReasons: healthReasons.length ? healthReasons : ["Keine kritischen Signale"],
      };

      // Moat rating — legacy string form used by Section2 / Summary.
      const moatRating = moatAssessment.moatStrength ?? "None";

      // Section 11 (MoatPorterSection) reads moatAssessment.overallRating,
      // moatSources[], porterForces[].name/.reasoning, businessModelStrength,
      // sustainabilityRating. scoreMoat() returns { moatStrength, moatScore,
      // sources, porterForces:{force,rating:Niedrig|Mittel|Hoch,score} }, so we
      // remap into the shared/schema.ts MoatAssessment shape here. If we don't,
      // moat.moatSources.slice() and moat.overallRating.includes() throw and
      // React unmounts the whole app (no error boundary above Section 11).
      const _ratingMap: Record<string, "Low" | "Medium" | "High"> = {
        Niedrig: "Low", Mittel: "Medium", Hoch: "High",
        Low: "Low", Medium: "Medium", High: "High",
      };
      const moatAssessmentOut = {
        overallRating: moatAssessment.moatStrength ?? "None",
        moatSources: Array.isArray((moatAssessment as any).sources) ? (moatAssessment as any).sources : [],
        porterForces: Array.isArray(moatAssessment.porterForces)
          ? moatAssessment.porterForces.map((f: any) => ({
              name: f.name ?? f.force ?? "",
              rating: _ratingMap[String(f.rating)] ?? "Medium",
              score: Number(f.score) || 0,
              reasoning: String(f.reasoning ?? ""),
            }))
          : [],
        businessModelStrength: moatRating === "Wide" ? "Starkes, differenziertes Geschäftsmodell"
          : moatRating === "Narrow" ? "Solides Geschäftsmodell mit begrenzten Moat-Quellen"
          : "Kompetitives Geschäftsmodell ohne strukturellen Vorteil",
        sustainabilityRating: moatRating === "Wide" ? "★★★★★"
          : moatRating === "Narrow" ? "★★★☆☆"
          : "★★☆☆☆",
      };

      // Peer comparison must have the {subject, peers, peerAvg, sectorMedian, ...}
      // shape (schema.ts:PeerComparison). Add the sectorMedian field so Section7
      // can render Damodaran-style medians alongside peer-average.
      let peerComparisonOut: any = null;
      if (peerComparison && typeof peerComparison === "object" && (peerComparison as any).subject) {
        peerComparisonOut = {
          ...peerComparison,
          // Sector median: Damodaran-style anchor row shown alongside peers.
          // schema.ts:PeerComparison expects a single `epsGrowth` field on the
          // sector median; we set both epsGrowth1Y and epsGrowth5Y to the same
          // sector-typical growth number so Section 7's 1Y/5Y columns render.
          sectorMedian: (peerComparison as any).sectorMedian ?? {
            pe: sectorDefaults.sectorAvgPE,
            peg: sectorDefaults.sectorAvgPEG,
            ps: sectorDefaults.sectorAvgPS,
            pb: sectorDefaults.sectorAvgPB,
            epsGrowth: sectorDefaults.sectorEPSGrowth,
            epsGrowth1Y: sectorDefaults.sectorEPSGrowth,
            epsGrowth5Y: sectorDefaults.sectorEPSGrowth,
            sectorName: effectiveSector,
          },
        };
      }

      // NOTE: Cast to any at the end because we intentionally include a few
      // legacy-compatible extras (analystPTMedian etc.) alongside the canonical
      // schema fields. shared/schema.ts:StockAnalysis is the source of truth
      // for what the frontend actually reads.
      const analysis = {
        // ─── Section 1: Datenaktualität (Section1.tsx) ───
        ticker: upperTicker,
        companyName,
        exchange,
        sector: effectiveSector,
        industry: effectiveIndustry,
        description,
        currentPrice: price,
        priceTimestamp: new Date().toISOString(),
        currency: reportedCurrency || "USD",
        marketCap,
        sharesOutstanding,

        // Analyst data (schema: analystPT + ratings objects, NOT flat fields)
        analystPT: {
          median: analystPTMedian,
          high: analystPTHigh,
          low: analystPTLow,
          count: analystCount,
        },
        ratings: { buy: ratingsBuy, hold: ratingsHold, sell: ratingsSell },

        // Earnings (schema: peRatio, forwardPE, pegRatio — NOT pe)
        epsTTM,
        epsAdjFY,
        epsConsensusNextFY,
        epsGrowth5Y,

        peRatio: pe,
        forwardPE,
        pegRatio: peg ?? 0,
        peg: peg ?? null,
        lynchClass,
        lynchPEGBasis: pegBasis,
        evEbitda,
        beta5Y: beta,
        beta,
        fcfTTM,
        fcfMargin,
        revenue,
        ebitda,
        operatingIncome,
        netIncome,
        totalDebt,
        cashEquivalents,
        enterpriseValue: marketCap + Math.max(0, netDebt),

        // Section 10: TechnicalChart reads historicalPrices[]
        historicalPrices,

        // Section 7: Rel. Bewertung — sector averages
        sectorAvgPE: sectorDefaults.sectorAvgPE,
        sectorAvgForwardPE: sectorDefaults.sectorAvgForwardPE,
        sectorAvgEVEBITDA: sectorDefaults.sectorAvgEVEBITDA,
        sectorAvgPEG: sectorDefaults.sectorAvgPEG,

        financialStatements,
        tamAnalysis,

        // Investment thesis (Section 2)
        moatRating,
        governmentExposure: govExposure,
        growthThesis: growthThesis ?? "",
        structuralTrends: [],

        // Section 3: Zyklusanalyse
        cycleClassification: sectorDefaults.cycleClass,
        politicalCycle: sectorDefaults.politicalCycle,
        sectorMaxDrawdown: sectorDefaults.sectorMaxDrawdown,
        sectorProfile,

        // Sections 8+15
        catalysts,
        risks,

        // Section 8 helpers
        govExposureDetail: govExposureRaw.detail,
        fcfHaircut: 0,

        // Section 9: RSL-Momentum (uses historical drawdown data)
        maxDrawdownHistory: "—",
        maxDrawdownYear: "—",

        // Section 10
        ohlcvData: ohlcvPoints,
        technicalIndicators,

        // Section 11 — use schema-conformed moatAssessment (see build above).
        moatAssessment: moatAssessmentOut,

        // Section 12 — shared/schema.ts:PESTELAnalysis expects a very different
        // shape than generatePESTELAnalysis produces. Remap here so PestelSection
        // doesn't crash on .icon / .factors[].name / .severity being undefined.
        pestelAnalysis: {
          factors: Array.isArray(pestelAnalysis?.factors)
            ? pestelAnalysis.factors.map((f: any) => {
                const categoryDEMap: Record<string, string> = {
                  Political: "Politisch", Economic: "Ökonomisch", Social: "Sozial",
                  Technological: "Technologisch", Environmental: "Ökologisch", Legal: "Rechtlich",
                };
                const items = Array.isArray(f.items) ? f.items : (Array.isArray(f.factors) ? f.factors : []);
                return {
                  category: f.category,
                  categoryDE: categoryDEMap[f.category] ?? f.category,
                  icon: f.icon ?? f.emoji ?? "📊",
                  factors: items.map((it: any) => ({
                    name: String(it.name ?? it.item ?? ""),
                    impact: it.impact ?? "Neutral",
                    stockCorrelation: it.stockCorrelation ?? "Neutral",
                    stockCorrelationNote: String(it.stockCorrelationNote ?? ""),
                    severity: it.severity ?? (it.impact === "Negativ" ? "Hoch" : it.impact === "Positiv" ? "Niedrig" : "Mittel"),
                    description: String(it.description ?? it.stockCorrelationNote ?? ""),
                  })),
                  regionalOutlook: String(f.regionalOutlook ?? `${f.category}-Faktoren für ${pestelAnalysis?.region ?? "Global"}`),
                  exposureRating: (f.exposureRating ?? (f.overallImpact === "Negativ" ? "Hoch" : f.overallImpact === "Positiv" ? "Niedrig" : "Mittel")) as "Hoch" | "Mittel" | "Niedrig",
                };
              })
            : [],
          overallExposure: (pestelAnalysis?.overallSentiment === "Negativ" ? "Hoch"
            : pestelAnalysis?.overallSentiment === "Positiv" ? "Niedrig" : "Mittel") as "Hoch" | "Mittel" | "Niedrig",
          macroSummary: `PESTEL-Gesamtbild für ${pestelAnalysis?.region ?? "Global"}: ${pestelAnalysis?.overallSentiment ?? "Neutral"}. ${(pestelAnalysis?.factors ?? []).length} Kategorien analysiert.`,
          geopoliticalScore: pestelAnalysis?.overallSentiment === "Negativ" ? 7 : pestelAnalysis?.overallSentiment === "Positiv" ? 3 : 5,
          interestRateOutlook: `WACC-Umgebung: ${sectorDefaults.waccScenarios.avg}% (Sektor-typisch).`,
          capitalCostImpact: `Ein Zinsanstieg von 100bps hebt die Kapitalkosten um ~${(sectorDefaults.waccScenarios.avg - sectorDefaults.waccScenarios.opt).toFixed(1)}pp; Bewertungs-Effekt sektorabhängig.`,
        },

        // Section 13 — shared/schema.ts:MacroCorrelation expects {name, category,
        // correlation:"Positiv|Neutral|Negativ|Invers", strength:"Stark|Moderat|Schwach",
        // mechanism, currentLevel?}. Our upstream list uses {factor, correlation:number,
        // description}. Remap so the section renders instead of crashing on .name.
        macroCorrelations: {
          correlations: macroCorrelations.map((c: any) => {
            const absCorr = Math.abs(Number(c.correlation) || 0);
            const catMap: Record<string, "Index" | "Commodity" | "Macro-Indikator" | "Währung" | "Edelmetall" | "Industriemetall" | "Crypto"> = {
              "Fed Funds Rate": "Macro-Indikator",
              "USD Stärke": "Währung",
              "Ölpreis (WTI)": "Commodity",
              "VIX (Volatilität)": "Macro-Indikator",
            };
            return {
              name: String(c.factor ?? c.name ?? ""),
              category: catMap[c.factor] ?? "Macro-Indikator",
              correlation: (Number(c.correlation) > 0.2 ? "Positiv"
                : Number(c.correlation) < -0.2 ? "Negativ"
                : Number(c.correlation) < -0.5 ? "Invers"
                : "Neutral") as "Positiv" | "Neutral" | "Negativ" | "Invers",
              strength: (absCorr > 0.5 ? "Stark" : absCorr > 0.25 ? "Moderat" : "Schwach") as "Stark" | "Moderat" | "Schwach",
              mechanism: String(c.description ?? c.mechanism ?? ""),
              currentLevel: c.currentLevel,
            };
          }),
          overallMacroSensitivity: (beta > 1.3 ? "Hoch" : beta < 0.7 ? "Niedrig" : "Mittel") as "Hoch" | "Mittel" | "Niedrig",
          keyInsight: `Beta ${beta.toFixed(2)} — ${beta > 1.3 ? "höhere als der Markt" : beta < 0.7 ? "geringere als der Markt" : "marktnahe"} Konjunktursensitivität.`,
        },

        // Section 15
        newsItems,
        newsHeadlines,

        // Section 17 / Peer view
        revenueSegments,
        geoSegments: Array.isArray(geoSegments) ? geoSegments : [],
        peerComparison: peerComparisonOut,
        catalystDeepDives: catalystDeepDives ?? [],

        // KI mode signalling for Dashboard state
        llmMode: useLLM,
        llmModelUsed,
        dataSource: "fmp" as const,
        dataTimestamp: new Date().toISOString(),
        _useLLM: useLLM,

        // Legacy-compatible extras kept so any older consumer doesn't break
        analystPTMedian,
        analystPTHigh,
        analystPTLow,
        analystCount,
        analystConsensus,
        policyContext: policyContext ?? null,
        dividendYield,
        returnOnEquity,
        wacc,
        dcfFairValue,
        upsidePotential,
        impliedGStar: impliedGStar ?? 0,
        pbRatio,
        yearHigh,
        yearLow,
        totalEquity,
        totalAssets,
        netDebt,
        grossMargin,
        operatingMargin,
        netMargin,
        grossProfit,
        website,
        image,
        country,
        reportedCurrency,
      } as unknown as StockAnalysis;

      analysisCache.set(cacheKey, { result: analysis, timestamp: Date.now(), usedLLM: useLLM });

      console.log(`[ANALYZE] Done for ${upperTicker} (LLM=${useLLM}, cats=${catalysts.length}, risks=${risks.length}, ohlcv=${ohlcvPoints.length})`);
      return res.json(analysis);
    } catch (err: any) {
      console.error(`[/api/analyze] Unhandled error: ${err?.message?.substring(0, 300)}`);
      return res.status(500).json({ error: err?.message ?? "Internal server error" });
    }
  });

  // ── /api/catalyst-enrich ──────────────────────────────────────────────
  // Frontend (CatalystsSection.tsx) sends only { ticker, useLLM, force } and
  // expects the server to pull the already-computed analysis context from
  // its own cache — this route, generateRiskExplanations, and
  // generatePolicyContext below were called by the frontend but never
  // registered anywhere after the routes.ts split, so every "KI Analyse"
  // button returned the Express 404 HTML fallback page ("Unexpected token
  // '<' ... is not valid JSON"). Restored using the already-cached
  // StockAnalysis (analysisCache, populated by /api/analyze above) as the
  // context source — no second FMP round-trip needed.
  app.post("/api/catalyst-enrich", async (req: Request, res: Response) => {
    try {
      const ticker = String(req.body?.ticker ?? "").toUpperCase().trim();
      if (!ticker) return res.status(400).json({ error: "ticker fehlt" });

      // /api/analyze keys its cache as `${ticker}:${useLLM}` (see cacheKey above),
      // not the bare ticker. Try both variants since we don't know which mode
      // the initial analyze call used.
      const cached = analysisCache.get(`${ticker}:true`) ?? analysisCache.get(`${ticker}:false`);
      if (!cached) {
        return res.status(404).json({ error: "Keine Analyse im Cache — zuerst /api/analyze aufrufen" });
      }
      const a = cached.result;
      const cacheKeyUsed = analysisCache.has(`${ticker}:true`) ? `${ticker}:true` : `${ticker}:false`;

      if (!isLLMAvailable()) {
        return res.json({ _llmSkipped: true, catalysts: a.catalysts, modelUsed: null });
      }

      const llmResult = await generateCatalystsAndMatchNews({
        ticker: a.ticker,
        companyName: a.companyName,
        sector: a.sector,
        industry: a.industry,
        description: a.description,
        revenue: a.revenue,
        revenueGrowth: a.financialStatements?.incomeStatement?.revenueGrowth ?? 0,
        fcfMargin: a.fcfMargin,
        price: a.currentPrice,
        pe: a.peRatio,
        marketCap: a.marketCap,
        analystPTMedian: a.analystPT?.median ?? 0,
        governmentExposure: (a.governmentExposure ?? 0) / 100,
        impliedGStar: (a as any).impliedGStar ?? null,
        keyProjects: [],
        secFilingExcerpts: [],
        newsItems: (a.newsItems ?? []).map((n: any) => ({
          title: n.title, source: n.source, relativeTime: n.relativeTime,
          pubDate: n.pubDate, url: n.url, sentiment: n.sentiment,
          sentimentScore: n.sentimentScore, matchedCatalyst: n.matchedCatalyst,
          matchedCatalystIdx: n.matchedCatalystIdx,
        })),
      });

      if (!llmResult) {
        return res.json({ _llmSkipped: true, catalysts: a.catalysts, modelUsed: null });
      }

      // Compute netto/gb for each LLM catalyst (same formula as generateCatalysts in catalyst-engine.ts)
      const enrichedCatalysts: Catalyst[] = llmResult.catalysts.map((c: any) => {
        const pos = Math.max(0, Math.min(100, Number(c.pos) || 0));
        const bruttoUpside = Number(c.bruttoUpside) || 0;
        const einpreisungsgrad = Math.max(0, Math.min(100, Number(c.einpreisungsgrad) || 0));
        const nettoUpside = bruttoUpside * (1 - einpreisungsgrad / 100);
        const gb = nettoUpside * (pos / 100);
        return {
          name: String(c.name ?? ""), timeline: String(c.timeline ?? ""),
          pos, bruttoUpside, einpreisungsgrad, nettoUpside, gb,
          context: c.context ? String(c.context) : undefined,
          tags: Array.isArray(c.tags) ? c.tags : undefined,
        };
      });

      // Deep-dives (parallel, best-effort — timeout already bounded by generateCatalystDeepDives internals)
      let withDeepDives = enrichedCatalysts;
      try {
        const deepDives = await generateCatalystDeepDives({
          ticker: a.ticker, companyName: a.companyName, sector: a.sector,
          description: a.description, revenue: a.revenue,
          revenueGrowth: a.financialStatements?.incomeStatement?.revenueGrowth ?? 0,
          fcfMargin: a.fcfMargin, price: a.currentPrice,
          analystPT: a.analystPT?.median ?? 0,
          catalysts: enrichedCatalysts.map(c => ({
            name: c.name, pos: c.pos, bruttoUpside: c.bruttoUpside,
            einpreisungsgrad: c.einpreisungsgrad, context: c.context,
          })),
        });
        if (Array.isArray(deepDives)) {
          withDeepDives = enrichedCatalysts.map((c, i) => ({
            ...c, deepDive: deepDives[i]?.deepDive,
          }));
        }
      } catch { /* deep-dives are a nice-to-have; keep base catalysts on failure */ }

      // Persist enriched catalysts back into the cache so subsequent requests
      // (e.g. PDF export, page reload within TTL) see the enriched version.
      const updated: StockAnalysis = { ...a, catalysts: withDeepDives };
      analysisCache.set(cacheKeyUsed, { ...cached, result: updated });

      return res.json({ catalysts: withDeepDives, modelUsed: llmResult.modelUsed });
    } catch (err: any) {
      console.error(`[/api/catalyst-enrich] ${err?.message?.substring(0, 300)}`);
      return res.status(500).json({ error: err?.message ?? "Internal server error" });
    }
  });

  // ── /api/risk-explanations ────────────────────────────────────
  // Section8.tsx sends the full context directly — no cache lookup needed.
  app.post("/api/risk-explanations", async (req: Request, res: Response) => {
    try {
      const b = req.body ?? {};
      if (!b.ticker || !Array.isArray(b.risks)) {
        return res.status(400).json({ error: "ticker/risks fehlen" });
      }
      if (!isLLMAvailable()) {
        return res.json({ _llmSkipped: true, risks: b.risks });
      }
      const explained = await generateRiskExplanations({
        ticker: b.ticker, companyName: b.companyName ?? b.ticker,
        sector: b.sector ?? "", industry: b.industry ?? "",
        description: b.description ?? "", revenue: b.revenue ?? 0,
        revenueGrowth: b.revenueGrowth ?? 0, fcfMargin: b.fcfMargin ?? 0,
        price: b.price ?? 0, pe: b.pe ?? 0, marketCap: b.marketCap ?? 0,
        governmentExposure: b.governmentExposure ?? 0, risks: b.risks,
      });
      if (!explained) {
        return res.json({ _llmSkipped: true, risks: b.risks });
      }
      return res.json({ risks: explained });
    } catch (err: any) {
      console.error(`[/api/risk-explanations] ${err?.message?.substring(0, 300)}`);
      return res.status(500).json({ error: err?.message ?? "Internal server error" });
    }
  });

  // ── /api/policy-context ──────────────────────────────────────
  // Used by both MoatPorterSection (Section 11) and PestelSection (Section 12)
  // via the shared PolicyContextPanel component.
  app.post("/api/policy-context", async (req: Request, res: Response) => {
    try {
      const b = req.body ?? {};
      if (!b.ticker) return res.status(400).json({ error: "ticker fehlt" });
      if (!isLLMAvailable()) {
        return res.json({ _llmSkipped: true, policyContext: null });
      }
      const policyContext = await generatePolicyContext({
        ticker: b.ticker, companyName: b.companyName ?? b.ticker,
        sector: b.sector ?? "", industry: b.industry ?? "",
        description: b.description ?? "", governmentExposure: b.governmentExposure ?? 0,
      });
      if (!policyContext) {
        return res.json({ _llmSkipped: true, policyContext: null });
      }
      return res.json({ policyContext });
    } catch (err: any) {
      console.error(`[/api/policy-context] ${err?.message?.substring(0, 300)}`);
      return res.status(500).json({ error: err?.message ?? "Internal server error" });
    }
  });
}
