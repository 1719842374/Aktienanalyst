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
  trackFmpCall,
  getFmpBudgetStatus,
  isQuotaExceeded,
  incrementQuota,
  getQuotaStatus,
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
  growthThesisFingerprint,
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

  return { moatStrength, moatScore: Math.min(score, 10), sources, porterForces };
}

// ─── Main registration ────────────────────────────────────────────────────────
export function registerAnalyzeRoute(server: Server, app: Express): void {
  // ── /api/fmp-budget ─────────────────────────────────────────────────────────
  app.get("/api/fmp-budget", (_req: Request, res: Response) => {
    const fmp = getFmpBudgetStatus();
    const quota = getQuotaStatus();
    res.json({ fmp, quota, fmpAvailable: isFmpAvailable() });
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

      // ── Quota guard ──
      if (isQuotaExceeded()) {
        const status = getQuotaStatus();
        return res.status(429).json({
          error: `Tageslimit erreicht (${status.today}/${status.limit} Analysen)`,
          quotaStatus: status,
        });
      }

      incrementQuota();
      console.log(`[ANALYZE] Starting analysis for ${upperTicker} (useLLM=${useLLM})`);

      // ── 1. Fetch FMP data ──
      const fmpData = await getFmpFallbackData(upperTicker);
      if (!fmpData) {
        return res.status(503).json({
          error: `Keine Daten für ${upperTicker} verfügbar. FMP API nicht erreichbar oder Ticker ungültig.`,
        });
      }

      trackFmpCall(13); // getFmpFallbackData uses 13 parallel calls

      const { quote, profile, financials, analyst, ohlcv, segments, peers, ratios } = fmpData;

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
      const pe = parseNumber(String(quote?.pe ?? ratioLatest.priceEarningsRatio ?? 0));
      const forwardPE = parseNumber(String(ratioLatest.priceEarningsRatioTTM ?? ratioLatest.forwardPE ?? 0));
      const pbRatio = parseNumber(String(ratioLatest.priceToBookRatio ?? 0));
      const evEbitda = parseNumber(String(ratioLatest.enterpriseValueMultiple ?? ratioLatest.evToEbitda ?? 0));
      const dividendYield = parseNumber(String(quote?.dividendYield ?? ratioLatest.dividendYield ?? 0)) * (quote?.dividendYield > 1 ? 0.01 : 1); // normalize if pct
      const returnOnEquity = parseNumber(String(ratioLatest.returnOnEquity ?? 0));
      const beta = parseNumber(String(profile?.beta ?? quote?.beta ?? 1));
      const sharesOutstanding = parseNumber(String(profile?.sharesOutstanding ?? quote?.sharesOutstanding ?? 0));
      const marketCap = price > 0 && sharesOutstanding > 0 ? price * sharesOutstanding : parseNumber(String(profile?.mktCap ?? quote?.marketCap ?? 0));
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

      // ── 3. OHLCV → technical indicators ──
      let ohlcvRows: any[] = Array.isArray(ohlcv) ? ohlcv : (ohlcv as any)?.historical ?? [];
      ohlcvRows = [...ohlcvRows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const closes = ohlcvRows.map((r: any) => parseFloat(String(r.close))).filter((v) => isFinite(v) && v > 0);
      const volumes = ohlcvRows.map((r: any) => parseFloat(String(r.volume ?? 0)));

      const rsi14 = calculateRSI(closes, 14);
      const ma50 = calculateMA(closes, 50);
      const ma200 = calculateMA(closes, 200);
      const deviationMA200 = ma200 > 0 ? ((price - ma200) / ma200) * 100 : 0;
      const avgVolume30d = volumes.length > 30 ? volumes.slice(-30).reduce((a, b) => a + b, 0) / 30 : 0;

      // Approximate annual returns for beta
      const annualReturns = closes.length > 252
        ? closes.slice(-252).map((c, i, arr) => i === 0 ? 0 : (c - arr[i - 1]) / arr[i - 1]).slice(1)
        : [];

      const ohlcvPoints: OHLCVPoint[] = ohlcvRows.slice(-504).map((r: any) => ({
        date: String(r.date ?? "").slice(0, 10),
        open: parseFloat(String(r.open)) || 0,
        high: parseFloat(String(r.high)) || 0,
        low: parseFloat(String(r.low)) || 0,
        close: parseFloat(String(r.close)) || 0,
        volume: parseFloat(String(r.volume ?? 0)) || 0,
      }));

      const technicalIndicators: TechnicalIndicators = {
        rsi14: Math.round(rsi14 * 10) / 10,
        ma50: Math.round(ma50 * 100) / 100,
        ma200: Math.round(ma200 * 100) / 100,
        deviationFromMA200: Math.round(deviationMA200 * 10) / 10,
        avgVolume30d: Math.round(avgVolume30d),
        yearHigh,
        yearLow,
        priceVsYearHigh: yearHigh > 0 ? Math.round(((price - yearHigh) / yearHigh) * 1000) / 10 : 0,
        priceVsYearLow: yearLow > 0 ? Math.round(((price - yearLow) / yearLow) * 1000) / 10 : 0,
      };

      // ── 4. Analyst targets ──
      const analystPTMedian = parseNumber(String(analyst.priceTarget?.targetMedian ?? analyst.priceTarget?.priceTarget ?? 0));
      const analystPTHigh = parseNumber(String(analyst.priceTarget?.targetHigh ?? 0));
      const analystPTLow = parseNumber(String(analyst.priceTarget?.targetLow ?? 0));
      const analystCount = Number(analyst.priceTarget?.numberOfAnalysts ?? analyst.grades?.length ?? 0);

      const latestGrade = analyst.grades?.[0];
      const analystConsensus = String(latestGrade?.recommendationMean ?? latestGrade?.action ?? "Hold");

      // EPS estimates
      const estCurrent = analyst.estimates?.[0] ?? {};
      const epsGrowthFwd = parseNumber(String(estCurrent.epsAvg ?? estCurrent.eps ?? 0));
      const revenueEstimateNext = parseNumber(String(estCurrent.revenueAvg ?? 0));

      // ── 5. Sector + defaults ──
      const effectiveSector = getEffectiveSector(sector, industry, description);
      const sectorDefaults = getSectorDefaults(effectiveSector);
      const wacc = sectorDefaults.wacc;
      const govExposure = estimateGovExposure(sector, industry, description, country);

      // ── 6. Lynch classification ──
      const epsGrowth5Y = revenueGrowth; // proxy
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
        // Attach context strings if missing
        for (const c of catalysts) {
          if (!c.context) {
            c.context = generateCatalystContext(c.name, effectiveSector, industry, description, revenueGrowth, fcfMargin, revenue);
          }
          const epr = calcEinpreisungsgrad({ bruttoUpside: c.bruttoUpside, price, sharesOutstanding, netDebt, fcf: fcfTTM, wacc, revenueGrowth, catalystType: "growth" });
          c.einpreisungsgrad = epr;
          c.nettoUpside = +(c.bruttoUpside * (1 - epr / 100)).toFixed(2);
          c.gb = +(c.pos / 100 * c.nettoUpside).toFixed(2);
        }
        // Match news to template catalysts
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

      // Fallback: sector template risks
      if (risks.length < 3) {
        risks = generateRisks(effectiveSector, industry, beta, govExposure, description);
      }

      // Enrich risks with LLM explanations
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
        const [llmPorter, llmPestel] = await Promise.allSettled([
          generatePorterFiveForces({
            ticker: upperTicker, companyName, sector: effectiveSector, industry, description,
            revenue, revenueGrowth, fcfMargin, grossMargin, marketCap,
            topCatalysts: catalysts.slice(0, 3).map((c) => ({ name: c.name, context: c.context ?? "" })),
            recentNewsHeadlines: newsHeadlines.slice(0, 5),
            keyProjects: [],
          }),
          generateLLMPESTEL({
            ticker: upperTicker, companyName, sector: effectiveSector, industry, description,
            revenue, revenueGrowth, fcfMargin, governmentExposure: govExposure, beta,
            topCatalysts: catalysts.slice(0, 3).map((c) => ({ name: c.name, context: c.context ?? "" })),
            capexContext: capexContext ? { sector: capexContext.sector, programmes: capexContext.programmes, rationale: capexContext.beneficiaryEntry?.rationale ?? "" } : null,
            recentNewsHeadlines: newsHeadlines.slice(0, 5),
            keyProjects: [],
          }),
        ]);
        if (llmPorter.status === "fulfilled" && llmPorter.value) porterForces = llmPorter.value;
        // LLM PESTEL has different shape — map to PESTELAnalysis if needed
      }

      // Update moat porterForces from LLM if available
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
      let peerComparison: any[] = [];
      if (peerTickers.length > 0) {
        try {
          peerComparison = await fetchPeerComparisonFromTickers(peerTickers);
        } catch {}
      }
      if (peerComparison.length === 0) {
        try {
          peerComparison = await fetchPeerComparison(upperTicker, effectiveSector);
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
      const macroCorrelations: MacroCorrelation[] = [
        { factor: "Fed Funds Rate", correlation: isBank ? 0.6 : beta > 1.2 ? -0.4 : -0.2, description: isBank ? "Steigende Zinsen erhöhen NIM" : "Steigende Zinsen komprimieren Multiples" },
        { factor: "USD Stärke", correlation: country !== "US" ? -0.3 : 0.1, description: country !== "US" ? "USD-Stärke belastet Auslands-Earnings" : "Geringer USD-Einfluss (US-fokussiert)" },
        { factor: "Ölpreis (WTI)", correlation: effectiveSector.toLowerCase().includes("energ") ? 0.7 : -0.1, description: effectiveSector.toLowerCase().includes("energ") ? "Ölpreis direkt mit Revenue korreliert" : "Indirekter Kostenfaktor" },
        { factor: "VIX (Volatilität)", correlation: -0.5, description: "Hohe Marktvolatilität belastet Growth-Aktien" },
      ];

      // ── 20. Assemble final result ──
      const analysis: StockAnalysis = {
        ticker: upperTicker,
        companyName,
        description,
        sector: effectiveSector,
        industry,
        country,
        exchange,
        website,
        image,
        reportedCurrency,
        price,
        marketCap,
        sharesOutstanding,
        beta,
        yearHigh,
        yearLow,
        // Financials
        revenue,
        revenueGrowth,
        netIncome,
        ebitda,
        grossProfit,
        operatingIncome,
        fcfTTM,
        totalDebt,
        cashEquivalents,
        netDebt,
        totalEquity,
        totalAssets,
        // Margins
        grossMargin,
        operatingMargin,
        netMargin,
        fcfMargin,
        // Valuation
        pe,
        forwardPE,
        pbRatio,
        evEbitda,
        peg: peg ?? 0,
        pegBasis,
        dividendYield,
        returnOnEquity,
        wacc,
        dcfFairValue,
        upsidePotential,
        impliedGStar: impliedGStar ?? 0,
        lynchClass,
        // Analyst
        analystPTMedian,
        analystPTHigh,
        analystPTLow,
        analystCount,
        analystConsensus,
        governmentExposure: govExposure,
        // Analysis
        catalysts,
        risks,
        tamAnalysis,
        revenueSegments,
        peerComparison,
        moatAssessment,
        pestelAnalysis,
        technicalIndicators,
        ohlcvData: ohlcvPoints,
        macroCorrelations: { correlations: macroCorrelations },
        newsItems,
        growthThesis: growthThesis ?? "",
        policyContext: policyContext ?? null,
        catalystDeepDives: catalystDeepDives ?? [],
        llmModelUsed,
        dataSource: "fmp" as const,
        analysisTimestamp: new Date().toISOString(),
      };

      // ── Cache result ──
      analysisCache.set(cacheKey, { result: analysis, timestamp: Date.now(), usedLLM: useLLM });

      console.log(`[ANALYZE] Done for ${upperTicker} in ${ ((Date.now() - 0) / 1000).toFixed(1) }s (LLM=${useLLM}, cats=${catalysts.length}, risks=${risks.length})`);
      return res.json(analysis);
    } catch (err: any) {
      console.error(`[/api/analyze] Unhandled error: ${err?.message?.substring(0, 300)}`);
      return res.status(500).json({ error: err?.message ?? "Internal server error" });
    }
  });
}
