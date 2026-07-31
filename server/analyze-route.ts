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
      const dividendYield = parseNumber(String(quote?.dividendYield ?? ratioLatest.dividendYield ?? 0)) * (quote?.dividendYield > 1 ? 0.01 : 1);
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

      // EPS estimates — FMP /stable/analyst-estimates returns `estimatedEpsAvg`
      // (average of analyst estimates for next FY EPS). Historic field names
      // (`epsAvg`, `eps`) are kept as fallbacks so older cached rows still parse.
      const estCurrent: any = analyst.estimates?.[0] ?? {};
      const nextFyEpsAbs = parseNumber(String(
        estCurrent.estimatedEpsAvg ?? estCurrent.estimatedEpsDiluted ??
        estCurrent.estimatedEps ?? estCurrent.epsAvg ?? estCurrent.eps ?? 0
      ));
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
      // epsGrowth5Y is refined below from the income-statement history; use
      // revenueGrowth as a temporary proxy for Lynch until the CAGR is computed.
      let epsGrowth5Y = revenueGrowth;
      const lynchClass = classifyLynch({ epsGrowth5Y, revenueGrowth, sector: effectiveSector, industry, dividendYield, fcfMargin, pe, forwardPE, pbRatio });
      const { peg, pegBasis } = calcLynchPEG({ lynchClass, pe, forwardPE, epsGrowth5Y, epsGrowthFwd, revenueGrowth, dividendYield });
      const impliedGStar = calcImpliedGStar({ price, sharesOutstanding, netDebt, fcf: fcfTTM, wacc });

      // ── 7. Revenue segments ──
      const revenueSegments: RevenueSegment[] = [];
      if (Array.isArray(segments) && segments.length > 0) {
        const segLatest = segments[0];
        const segKeys = Object.keys(segLatest).filter((k) => k !== "date" && k !== "symbol" && k !== "reportedCurrency" && k !== "period");
        const segTotal = segKeys.reduce((sum, k) => sum + parseNumber(String(segLatest[k])), 0);
        for (const key of segKeys.slice(0, 8)) {
          const val = parseNumber(String(segLatest[key]));
          if (val > 0 && segTotal > 0) {
            revenueSegments.push({ name: key, revenue: val, percentage: Math.round((val / segTotal) * 1000) / 10 });
          }
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
      // fetchPeerComparisonFromTickers signature (news-peers.ts:156):
      //   (ticker, peerTickers[], pe, peg, revenue, marketCap, revenueGrowth, epsGrowth5Y)
      // returns { subject, peers, peerAvg } | null. We pass the full context so
      // the peer view can render P/E, PEG, P/S and EPS growth for each peer.
      let peerComparison: any = null;
      if (peerTickers.length > 0) {
        try {
          peerComparison = await fetchPeerComparisonFromTickers(
            upperTicker, peerTickers, pe, peg ?? 0, revenue, marketCap, revenueGrowth, epsGrowth5Y
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

      // EPS chain — keep the three flavours the frontend distinguishes.
      const rawEpsFY = parseNumber(String(incomeLatest.epsDiluted ?? incomeLatest.eps ?? 0));
      const epsTTM = parseNumber(String(quote?.eps ?? profile?.eps ?? rawEpsFY));
      const epsAdjFY = rawEpsFY;
      // Absolute next-FY consensus EPS (in $) — used by Section 4 for forwardPE
      // display. Distinct from epsGrowthFwd which is a percentage.
      const epsConsensusNextFY = nextFyEpsAbs || parseNumber(String(
        (analyst.estimates?.[0] as any)?.estimatedEpsAvg ??
        (analyst.estimates?.[0] as any)?.estimatedEps ?? 0
      ));
      // 5Y EPS CAGR — refine the proxy from the income-statement history.
      if (financials.income.length >= 3) {
        const oldest = financials.income[financials.income.length - 1] ?? {};
        const oldEps = parseNumber(String((oldest as any).epsDiluted ?? (oldest as any).eps ?? 0));
        if (oldEps > 0 && rawEpsFY > 0) {
          const n = financials.income.length - 1;
          epsGrowth5Y = ((Math.pow(rawEpsFY / oldEps, 1 / n) - 1) * 100);
        }
      }

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

      // Peer comparison must have the {subject, peers, peerAvg, sectorMedian, ...}
      // shape (schema.ts:PeerComparison). Add the sectorMedian field so Section7
      // can render Damodaran-style medians alongside peer-average.
      let peerComparisonOut: any = null;
      if (peerComparison && typeof peerComparison === "object" && (peerComparison as any).subject) {
        peerComparisonOut = {
          ...peerComparison,
          sectorMedian: (peerComparison as any).sectorMedian ?? {
            pe: sectorDefaults.sectorAvgPE, peg: sectorDefaults.sectorAvgPEG,
            ps: sectorDefaults.sectorAvgPS, pb: sectorDefaults.sectorAvgPB,
            epsGrowth: sectorDefaults.sectorEPSGrowth, sectorName: effectiveSector,
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

        // Section 11
        moatAssessment,

        // Section 12
        pestelAnalysis,

        // Section 13
        macroCorrelations: { correlations: macroCorrelations, overallMacroSensitivity: "Mittel", keyInsight: "" },

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
}
