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
  applyKeywordSentimentToNews,
  reconcileNewsSentiment,
  fetchPeerComparisonFromTickers,
  fetchPeerComparison,
  filterAndSelectPeers,
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
  growthThesisFingerprint,
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
  fmpIncomeStatementQuarterly,
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
  fmpEarningsCalendar,
  convertFmpRowsToUsd,
} from "./fmp";
import { buildScoringForAnalysis } from "./scoring-integration";
import { getCachedRegulatoryAssessment } from "./regulatory";

// Segment-Fallback-Pipeline (2026-08): SEC EDGAR fallback for when FMP's
// /revenue-product-segmentation returns [] (verified for IREN). Additive-only
// module, see server/sec-segments.ts for the full fallback-chain rationale.
import { fetchSecBusinessSegments } from "./sec-segments";
import { diskResearcherGet, diskResearcherSet } from "./disk-cache";
import { normalizePeerOverrides, buildAnalyzeCacheKey, applyPeerOverrides } from "./peer-cache-key";
import { invalidateThesisStrengthCache } from "./thesis-strength-cache";

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

// Auftrag 08.08.2026 ("These direkt nach KI-Enrich aktualisieren + Peer-Gap"):
// gemeinsame Helper-Funktion fuer die These-Generierung, wiederverwendet von
// Schritt 14 (/api/analyze) UND von /api/catalyst-enrich (These-Refresh nach
// KI-Katalysator-Update). Kapselt Segment-Ableitung, GB-Summe, Peer-Gap
// (optional -- null wenn zum Aufrufzeitpunkt nicht verfuegbar), Fingerprint-
// Berechnung und den Cache-Vergleich (kein neuer LLM-Call bei identischem
// Fingerprint). Reine Extraktion des bereits in Schritt 14 verwendeten
// Musters -- keine Verhaltensaenderung fuer den bestehenden Aufrufer.
async function generateThesisWithFingerprintCache(params: {
  ticker: string; companyName: string; description: string; sector: string; industry: string;
  revenueGrowth: number; fcfMargin: number; grossMargin?: number; operatingMargin?: number;
  forwardPE?: number; evEbitda?: number; analystPTMedian?: number; currentPrice?: number; returnOnEquity?: number;
  catalysts: Array<{ name: string; context?: string; pos?: number; nettoUpside?: number; gb?: number; generic?: boolean }>;
  capexContext?: { sector: string; programmes: string[]; rationale: string } | null;
  revenueSegments: RevenueSegment[];
  gStar: number | null;
  moat: string | null;
  lynchClass: string | null;
  nextEarningsDate: string | null;
  peerGapPct?: number | null;
  sectorMedianRevenueYoyPct?: number | null;
  prevGrowthThesis?: string | null;
  prevGrowthThesisFingerprint?: string | null;
  prevGrowthThesisGeneratedAt?: string | null;
}): Promise<{ growthThesis: string | null; growthThesisFingerprintValue: string | null; growthThesisGeneratedAt: string | null }> {
  const sortedSegs = [...params.revenueSegments]
    .filter(s => typeof s.growth === "number" && isFinite(s.growth as number))
    .sort((a, b) => (b.growth as number) - (a.growth as number));
  const topSegmentForThesis = sortedSegs[0]
    ? { name: sortedSegs[0].name, growthPct: sortedSegs[0].growth as number, sharePct: sortedSegs[0].percentage }
    : null;
  const otherSegmentsForThesis = sortedSegs.slice(1, 3).map(s => ({ name: s.name, growthPct: s.growth as number }));
  const gbSumForThesis = params.catalysts.length > 0
    ? params.catalysts.reduce((sum, c) => sum + (typeof c.gb === "number" && isFinite(c.gb) ? c.gb : 0), 0)
    : null;

  const thesisInput = {
    ticker: params.ticker, companyName: params.companyName, description: params.description,
    sector: params.sector, industry: params.industry,
    revenueGrowth: params.revenueGrowth, fcfMargin: params.fcfMargin, grossMargin: params.grossMargin,
    operatingMargin: params.operatingMargin, forwardPE: params.forwardPE, evEbitda: params.evEbitda,
    analystPTMedian: params.analystPTMedian, currentPrice: params.currentPrice, returnOnEquity: params.returnOnEquity,
    topCatalysts: params.catalysts.slice(0, 4).map((c) => ({ name: c.name, context: c.context ?? "", pos: c.pos, nettoUpside: c.nettoUpside, gb: c.gb, generic: c.generic })),
    capexContext: params.capexContext ?? null,
    topSegment: topSegmentForThesis,
    otherSegments: otherSegmentsForThesis,
    gStar: params.gStar,
    gbSum: gbSumForThesis,
    moat: params.moat,
    lynchClass: params.lynchClass,
    nextEarningsDate: params.nextEarningsDate,
    peerGapPct: params.peerGapPct ?? null,
    sectorMedianRevenueYoyPct: params.sectorMedianRevenueYoyPct ?? null,
  };

  const fp = growthThesisFingerprint(thesisInput);
  if (params.prevGrowthThesis && params.prevGrowthThesisFingerprint === fp) {
    console.log(`[GROWTH-THESIS][${params.ticker}] Fingerprint unveraendert — gecachte These wiederverwendet`);
    return { growthThesis: params.prevGrowthThesis, growthThesisFingerprintValue: fp, growthThesisGeneratedAt: params.prevGrowthThesisGeneratedAt ?? new Date().toISOString() };
  }
  const growthThesis = await generateGrowthThesis(thesisInput);
  console.log(`[GROWTH-THESIS][${params.ticker}] Neu generiert (Fingerprint: ${fp})`);
  return { growthThesis, growthThesisFingerprintValue: fp, growthThesisGeneratedAt: new Date().toISOString() };
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

      // BUGFIX (05.08.2026, gefunden waehrend Live-Verifikation des
      // REGULATORY-Gate-Fixes): analyzeRequestSchema definiert das Feld als
      // `force` (shared/schema.ts), diese Zeile destrukturierte aber
      // `forceRefresh` — ein Feld, das im Schema gar nicht existiert. Jeder
      // Request mit `{"force": true}` wurde dadurch STILL ignoriert: `force`
      // landete nie in `parsed.data.forceRefresh` (welches folglich immer
      // beim Default `false` blieb), der Analyze-Cache griff also IMMER,
      // selbst wenn der Aufrufer explizit einen frischen Re-Fetch verlangte.
      // Betraf jeden Client-Request und jeden Cron-Precache-Call mit
      // force=true, nicht nur diese Verifikation.
      const { ticker, useLLM = false, force: forceRefresh = false, peerOverrides } = parsed.data;
      const upperTicker = ticker.toUpperCase();

      // Auftrag 09.08.2026 / gehaertet 10.08.2026 ("Peer-Add/Remove zuverlaessig"):
      // Normalisierung (trim, uppercase, dedupliziert, SORTIERT) lebt in
      // server/peer-cache-key.ts -- pure, unit-getestet (script/test-peer-
      // cache-key.ts). Root-Cause des urspruenglichen Bugs: die Listen wurden
      // zwar uppercased, aber NICHT sortiert vor dem Cache-Key-Join -- zwei
      // Requests mit semantisch identischem Override-Set aber unterschied-
      // licher Array-Reihenfolge erzeugten unterschiedliche Cache-Keys und
      // damit potenziell "Geister-Peers" aus einem alten Cache-Eintrag.
      const { add: peerAddList, remove: peerRemoveList, hasOverrides: hasPeerOverrides } = normalizePeerOverrides(peerOverrides);

      // ── Cache check ──
      // Cache-Key MUSS die Peer-Overrides enthalten -- sonst wuerde ein User,
      // der LLY zu NVO hinzufuegt, den gecachten Response OHNE LLY zurueckbekommen
      // (oder umgekehrt: der naechste User ohne Override erhaelt versehentlich
      // die mit LLY angereicherte Version).
      const cacheKey = buildAnalyzeCacheKey(upperTicker, useLLM, peerAddList, peerRemoveList);
      if (!forceRefresh) {
        const cached = analysisCache.get(cacheKey);
        const cacheHit = !!(cached && Date.now() - cached.timestamp < CACHE_TTL_MS && cacheLLMModeMatches(cached.usedLLM, useLLM));
        if (hasPeerOverrides || cached) {
          console.log(`[PEERS] ticker=${upperTicker} incoming overrides=[${[...peerAddList.map(t => `+${t}`), ...peerRemoveList.map(t => `-${t}`)].join(",")}] cacheKey=${cacheKey} cacheHit=${cacheHit}`);
        }
        if (cacheHit) {
          console.log(`[ANALYZE] Cache hit for ${upperTicker}`);
          return res.json(cached!.result);
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

      // ── 3a. Datenaktualität Section 1: Earnings + FCF-Yield ──
      // Nur echte zukünftige Kalendertermine werden gezeigt. Fehlt FMPs Termin,
      // bleibt das Feld null; die UI zeigt transparent "n/a" statt einer Schätzung.
      const todayIso = new Date().toISOString().slice(0, 10);
      const earningsRows = await fmpEarningsCalendar(upperTicker).catch(() => []);
      const nextEarnings = earningsRows
        .filter((r: any) => (!r?.symbol || String(r.symbol).toUpperCase() === upperTicker) && typeof r?.date === "string" && r.date.slice(0, 10) > todayIso)
        .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)))[0] ?? null;
      const nextEarningsDate = nextEarnings?.date ? String(nextEarnings.date).slice(0, 10) : null;
      const nextEarningsTimeRaw = String(nextEarnings?.time ?? "").toLowerCase();
      const nextEarningsTime = /amc|after/.test(nextEarningsTimeRaw) ? "amc"
        : /bmo|before/.test(nextEarningsTimeRaw) ? "bmo" : undefined;
      const nextEarningsIsEstimate = nextEarnings
        ? Boolean(nextEarnings?.isEstimate ?? nextEarnings?.estimated ?? nextEarnings?.estimate)
        : undefined;
      const latestFiscalYear = String(incomeLatest?.fiscalYear ?? incomeLatest?.calendarYear ?? "").trim();
      const latestPeriodRaw = String(incomeLatest?.period ?? "FY").trim();
      const latestPeriod = /^fy$/i.test(latestPeriodRaw) ? "Q4" : latestPeriodRaw;
      const lastReportedQuarter = latestFiscalYear ? `${latestPeriod} FY${latestFiscalYear}` : null;

      // Definition: FCF-Yield = FCF / Market Cap. Für die Vorjahresbasis wird
      // der historische Kurs am/kurz vor FY-Ende mit den damals gemeldeten
      // weightedAverageShsOutDil multipliziert. Fehlt eine Komponente: n/a.
      const fcfYield = fcfTTM > 0 && marketCap > 0 ? (fcfTTM / marketCap) * 100 : null;
      const cfPrev = financials.cashflow[1] ?? {};
      const incomePrev = financials.income[1] ?? {};
      const fcfPrevOcf = parseNumber(String(cfPrev?.operatingCashFlow ?? cfPrev?.netCashProvidedByOperatingActivities ?? 0));
      const fcfPrevCapex = Math.abs(parseNumber(String(cfPrev?.capitalExpenditure ?? cfPrev?.capitalExpenditures ?? 0)));
      const fcfPrev = fcfPrevOcf - fcfPrevCapex;
      const priorDate = String(incomePrev?.date ?? cfPrev?.date ?? "");
      const priorPrice = priorDate
        ? [...ohlcvRows].filter((r: any) => String(r?.date ?? "") <= priorDate).sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))[0]
        : null;
      const priorClose = parseNumber(String(priorPrice?.close ?? priorPrice?.adjClose ?? 0));
      const priorShares = parseNumber(String(incomePrev?.weightedAverageShsOutDil ?? incomePrev?.weightedAverageShsOut ?? 0));
      const priorMarketCap = priorClose > 0 && priorShares > 0 ? priorClose * priorShares : 0;
      const fcfYieldPrev = fcfPrev > 0 && priorMarketCap > 0 ? (fcfPrev / priorMarketCap) * 100 : null;
      const fcfYieldYoyPp = fcfYield != null && fcfYieldPrev != null ? +(fcfYield - fcfYieldPrev).toFixed(2) : null;
      const fcfYieldYoyAvailable = fcfYieldYoyPp != null;

      // Auftrag 07.08.2026 ("FCF Margin YoY"): analog zur bereits vorhandenen
      // FCF-Yield-YoY-Berechnung, aber einfacher -- keine Marktkapitalisierungs-
      // Historie noetig, nur FCF und Revenue der Vorperiode (beide bereits
      // oben fuer fcfYieldPrev berechnet bzw. verfuegbar: fcfPrev, incomePrev).
      // Fehlt eine Komponente: n/a, kein Fake-Wert.
      const revenuePrev = parseNumber(String(incomePrev?.revenue ?? 0));
      const fcfMarginPrevYearPct = fcfPrev > 0 && revenuePrev > 0 ? (fcfPrev / revenuePrev) * 100 : null;
      const fcfMarginYoyPp = fcfMargin != null && fcfMarginPrevYearPct != null ? +(fcfMargin - fcfMarginPrevYearPct).toFixed(2) : null;
      const fcfMarginYoyAvailable = fcfMarginYoyPp != null;

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
              // Echte YoY-Segment-Wachstumsrate aus fmpSegments() durchreichen.
              // Ohne dieses Feld sah generateTAMAnalysis() nur `undefined` und
              // die Spalte "Wachstum" der Segment-TAM-Analyse zeigte 0.0 %.
              // null bleibt null (keine Vorjahreszahl) — kein 0-Default.
              growth: typeof s.growth === "number" && isFinite(s.growth) ? s.growth : null,
              ...(typeof s.prevRevenue === "number" ? { prevRevenue: s.prevRevenue } : {}),
              // Management-Score-Fix (05.08.2026): prevPercentage aus
              // fmpSegments()/normaliseSegmentRows() durchreichen — vorher
              // wurde dieses Feld an dieser Stelle verworfen, obwohl es
              // bereits berechnet wurde. Noetig fuer ΔSegment-Anteil.
              ...(typeof s.prevPercentage === "number" ? { prevPercentage: s.prevPercentage } : {}),
              // Auftrag 06.08.2026 ("Segment-FY durchreichen"): derselbe
              // Fehlertyp wie beim prevPercentage-Bug — normaliseSegmentRows()
              // in fmp.ts setzt bereits s.date (das reale Berichtsdatum der
              // Segmentzeile, z.B. "2025-06-30"), aber dieses Mapping hat es
              // nie nach RevenueSegment.fiscalYear uebernommen. Jahr wird
              // NUR aus einem echten Datum extrahiert -- nie erfunden.
              ...(typeof s.date === "string" && /^\d{4}/.test(s.date)
                ? { fiscalYear: s.date.slice(0, 4) }
                : {}),
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

      // ── 7b. SEC EDGAR fallback for business segments (Segment-Fallback-Pipeline, 2026-08) ──
      // ROOT CAUSE this fixes: FMP's /revenue-product-segmentation returns []
      // for a meaningful number of tickers (verified live for IREN: FMP HAS
      // geographic data — Australia/Canada — but NO business-segment split).
      // Until now the ONLY fallback was the curated hardcoded map above, which
      // only covers a handful of well-known ADRs (NVO, ASML, TSM, ...) — every
      // other ticker with empty FMP segments (e.g. IREN) silently showed only
      // the geographic block, which looked like "the feature is broken" rather
      // than "this data source doesn't have it".
      //
      // Fallback order (ticker-agnostic, no IREN special-case):
      //   (a) FMP fmpSegments() — already tried above, fastest & free
      //   (b) curated static map — already tried above, covers foreign ADRs
      //       FMP structurally never reports on
      //   (c) THIS BLOCK: SEC EDGAR full-text 10-K/20-F extraction via LLM —
      //       ticker-agnostic, works for any SEC-registered filer (US listing
      //       OR foreign private issuer filing 20-F)
      //   (d) if all three fail: revenueSegmentsSource = "none" +
      //       revenueSegmentsMessage set below — NEVER a generic/fake fallback.
      //
      // Cached per ticker (disk-cache.ts researcher_cache table, 24h TTL) since
      // SEC filings only change ~once per quarter — avoids re-fetching/re-LLM'ing
      // a multi-MB filing on every analysis request for the same ticker.
      let revenueSegmentsSource: "fmp" | "sec" | "curated" | "none" = "none";
      let revenueSegmentsMessage: string | undefined;
      let secFiscalYearLabel: string | undefined;

      if (revenueSegments.length > 0) {
        // Rows already came from fmpSegments() (step 7 above) or the curated
        // map. Distinguish which one so the UI can show the right "Quelle:".
        revenueSegmentsSource = Array.isArray(segments) && segments.length > 0 ? "fmp" : "curated";

        // Auftrag 09.08.2026 ("Segment-Wachstum aus SEC-/Geschäftsberichten
        // extrahieren"): der curated Fallback (NVO, ASML, TSM, ...) liefert nur
        // { name, revenue, percentage } -- KEIN growth/prevRevenue, weil er aus
        // einer statischen Prozent-Aufteilung ohne Vorjahresbezug abgeleitet
        // wird. Ohne diese Anreicherung zeigt die UI dauerhaft "n/a" und der
        // Thesis-Score-Segment-Score bleibt bei 0, obwohl echte YoY-Zahlen im
        // 10-K/20-F stehen. Additiv, ticker-agnostisch: ruft die bestehende
        // SEC-EDGAR-Pipeline zusaetzlich auf, WENN der curated Fallback aktiv
        // ist UND kein Segment bereits ein growth-Feld hat -- matched per
        // normalisiertem Namens-Substring, ueberschreibt NIE die curated
        // Prozente/Revenue-Werte, ergaenzt nur growth/prevRevenue additiv.
        const needsGrowthEnrichment = revenueSegmentsSource === "curated" && revenueSegments.every(s => s.growth == null);
        if (needsGrowthEnrichment) {
          try {
            const enrichCacheKey = `segments_growth__${upperTicker}`;
            let enrichResult = diskResearcherGet(enrichCacheKey) as { segments: RevenueSegment[]; _empty?: boolean } | null;
            if (!enrichResult) {
              const fetched = await fetchSecBusinessSegments(upperTicker, companyName);
              enrichResult = fetched && fetched.segments.length > 0
                ? { segments: fetched.segments.map(s => ({ name: s.name, revenue: s.revenue, percentage: s.percentage, ...(typeof s.prevRevenue === "number" && s.prevRevenue > 0 && !s.noPriorYearMatch ? { prevRevenue: s.prevRevenue } : {}) })) }
                : { segments: [], _empty: true };
              diskResearcherSet(enrichCacheKey, enrichResult);
            }
            if (enrichResult.segments.length > 0) {
              const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
              let matchedCount = 0;
              revenueSegments = revenueSegments.map(curatedSeg => {
                const curatedNorm = norm(curatedSeg.name);
                const secMatch = enrichResult!.segments.find(secSeg => {
                  const secNorm = norm(secSeg.name);
                  return curatedNorm.includes(secNorm) || secNorm.includes(curatedNorm) || curatedNorm.slice(0, 6) === secNorm.slice(0, 6);
                });
                if (secMatch && typeof secMatch.prevRevenue === "number" && secMatch.prevRevenue > 0) {
                  matchedCount++;
                  // WICHTIG: growth wird auf Basis des CURATED revenue (nicht des
                  // SEC-revenue, das evtl. anders skaliert ist) mit dem SEC-
                  // prevRevenue berechnet -- vermeidet Skalen-Inkonsistenzen
                  // zwischen der prozentual abgeleiteten curated Revenue und der
                  // absoluten SEC-Revenue.
                  const impliedPrevRevenue = curatedSeg.revenue / (secMatch.revenue / secMatch.prevRevenue);
                  const growth = ((curatedSeg.revenue / impliedPrevRevenue) - 1) * 100;
                  return { ...curatedSeg, growth, prevRevenue: Math.round(impliedPrevRevenue) };
                }
                return curatedSeg;
              });
              if (matchedCount > 0) {
                console.log(`[SEGMENTS] Growth-Anreicherung fuer ${upperTicker}: ${matchedCount}/${revenueSegments.length} curated Segmente mit SEC-YoY angereichert`);
              }
            }
          } catch (enrichErr) {
            console.warn(`[SEGMENTS] Growth-Anreicherung fehlgeschlagen fuer ${upperTicker}:`, enrichErr);
            // Fehler hier ist NIE fatal -- curated Segmente ohne growth sind
            // weiterhin besser als kein Ergebnis; die UI zeigt dann weiterhin n/a.
          }
        }
      } else {
        const secCacheKey = `segments__${upperTicker}`;
        let secResult = diskResearcherGet(secCacheKey) as
          | { segments: RevenueSegment[]; fiscalYear?: string; formType?: string; filingUrl?: string; _empty?: boolean }
          | null;

        if (!secResult) {
          const fetched = await fetchSecBusinessSegments(upperTicker, companyName);
          if (fetched && fetched.segments.length > 0) {
            const total = fetched.segments.reduce((sum, s) => sum + s.revenue, 0);
            secResult = {
              segments: fetched.segments.map(s => {
                // Auftrag 09.08.2026 ("Segment-Wachstum aus SEC-Berichten"):
                // growth wird HIER aus prevRevenue berechnet -- niemals vom LLM
                // selbst geschaetzt. Nur wenn eine plausible Vorjahreszahl
                // vorliegt (prevRevenue > 0, kein noPriorYearMatch); sonst
                // bleibt growth null (NIEMALS 0 als Platzhalter, analog zur
                // bestehenden FMP-Pipeline weiter oben in dieser Datei).
                const priorYearRevenue: number | undefined = (typeof s.prevRevenue === "number" && isFinite(s.prevRevenue) && s.prevRevenue > 0 && !s.noPriorYearMatch) ? s.prevRevenue : undefined;
                const growth = priorYearRevenue != null ? ((s.revenue / priorYearRevenue) - 1) * 100 : null;
                return {
                  name: s.name,
                  revenue: s.revenue,
                  percentage: total > 0 ? Math.round((s.revenue / total) * 1000) / 10 : s.percentage,
                  source: "sec" as const,
                  fiscalYear: fetched.fiscalYear,
                  growth,
                  ...(priorYearRevenue != null ? { prevRevenue: priorYearRevenue } : {}),
                };
              }),
              fiscalYear: fetched.fiscalYear,
              formType: fetched.formType,
              filingUrl: fetched.filingUrl,
            };
          } else {
            // Cache the "nothing found" result too — otherwise every request
            // for a ticker with no segment reporting re-triggers a full SEC
            // filing fetch + LLM call for nothing.
            secResult = { segments: [], _empty: true };
          }
          diskResearcherSet(secCacheKey, secResult);
        }
        // secResult ist nach dem obigen Block garantiert gesetzt (entweder aus
        // dem Disk-Cache oder frisch befuellt) -- non-null Assertion statt einer
        // strukturellen Aenderung an der bestehenden if(!secResult)-Neubefuellung.
        const secResultFinal = secResult!;

        if (secResultFinal.segments.length > 0) {
          revenueSegments = secResultFinal.segments;
          revenueSegmentsSource = "sec";
          secFiscalYearLabel = secResultFinal.fiscalYear;
          console.log(`[SEGMENTS] SEC EDGAR fallback succeeded for ${upperTicker}: ${secResultFinal.formType ?? "10-K/20-F"} (${secResultFinal.fiscalYear ?? "unknown FY"}), ${secResultFinal.segments.length} segments`);
        } else {
          // (d) Nothing found anywhere — clear message, NEVER a fake/generic fallback.
          // Distinguish "company only reports geographically" (geoSegments present)
          // from "no segment data at all" (neither present) per hard requirement #1.
          revenueSegmentsSource = "none";
          revenueSegmentsMessage = (Array.isArray(geoSegments) && geoSegments.length > 0)
            ? "Unternehmen berichtet nur geografisch — kein separates Geschäftssegment-Reporting im letzten 10-K/20-F gefunden."
            : "Segmentreporting nicht in den letzten 10-K/20-F enthalten.";
          console.log(`[SEGMENTS] No business-segment data found for ${upperTicker} via FMP, curated map, or SEC EDGAR`);
        }
      }

      // ── 8. TAM analysis ──
      const tamAnalysis = generateTAMAnalysis(effectiveSector, industry, description, revenue, revenueGrowth, revenueSegments);

      // ── 9. Peers ──
      // Auftrag 05.08.2026: FMP /stock-peers liefert Kandidaten rein aus
      // Kursbewegungs-/Marktkap-Aehnlichkeit, NICHT aus Sector/Industry. Live-
      // Beispiel BYDDY: FMP mischt Richemont/Dior (Luxury Goods) unter die
      // "Peers" eines Auto-Herstellers. filterAndSelectPeers() prueft jeden
      // Kandidaten gegen die Subjekt-Industry (sector/industry aus Schritt 2
      // oben bereits verfuegbar) und greift bei Bedarf auf eine kuratierte
      // Fallback-Liste zurueck (nur fuer bekannte Problemfaelle, nur wenn die
      // FMP-Peers den Filter nicht bestehen). ROIC-Berechnung, Scoring-Gate-
      // Logik und alle anderen Peer-Spalten bleiben unveraendert.
      const rawPeerTickers: string[] = Array.isArray(peers) ? peers.map((p: any) => String(p.symbol ?? p ?? "")).filter(Boolean) : [];
      let peerTickers: string[] = rawPeerTickers.slice(0, 5);
      try {
        peerTickers = await filterAndSelectPeers(upperTicker, sector, industry, rawPeerTickers, 5);
      } catch (peerFilterErr: any) {
        console.warn(`[ANALYZE] Peer-Filter fehlgeschlagen fuer ${upperTicker}, verwende ungefilterte FMP-Peers: ${peerFilterErr?.message?.substring(0, 100)}`);
      }

      // Auftrag 09.08.2026 ("Peer-Liste nachziehbar"): User-Override NACH der
      // Auto-Auswahl/Filterung anwenden -- remove zuerst (falls ein User einen
      // Auto-Peer aktiv ausschliessen will), dann add (z.B. LLY bei NVO, das
      // FMPs Kursbewegungs-Aehnlichkeits-Heuristik nicht automatisch findet).
      // Max. 8 Peers gesamt, damit Sektor-Median/Peer-Tabelle stabil bleiben
      // (Ticket-Vorgabe "Max. Anzahl Peers begrenzen").
      if (hasPeerOverrides) {
        peerTickers = applyPeerOverrides(peerTickers, upperTicker, peerAddList, peerRemoveList, 8);
        // Ticket-Pflichtformat (10.08.2026, "Peer-Add/Remove zuverlaessig"):
        // [PEERS] ticker=... incoming overrides=[...] effective=[...] cacheKey=... cacheHit=...
        console.log(`[PEERS] ticker=${upperTicker} incoming overrides=[${[...peerAddList.map(t => `+${t}`), ...peerRemoveList.map(t => `-${t}`)].join(",")}] effective=[${peerTickers.join(",")}] cacheKey=${cacheKey}`);
      }

      // ── 10. News ──
      let newsItems: any[] = [];
      try {
        newsItems = await fetchNewsFromGoogleRSS(upperTicker, companyName);
      } catch (newsErr: any) {
        console.warn(`[ANALYZE] News fetch failed for ${upperTicker}: ${newsErr?.message?.substring(0, 80)}`);
      }      if (newsItems.length > 0) {
        try { applyKeywordSentimentToNews(newsItems); } catch {}
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
            // Auftrag 08.08.2026 ("Live-These + Thesis-Score + Katalysatoren"):
            // explizites generic=false fuer firmenspezifische LLM-Katalysatoren --
            // Grundlage fuer die Investment-These (Schritt 14) und Baustein E.
            for (const c of catalysts) c.generic = false;
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
          // Auftrag 08.08.2026: Template-/Fallback-Katalysatoren sind per
          // Definition generisch (keine firmenspezifische LLM-Ableitung).
          c.generic = true;
        }
        if (newsItems.length > 0) {
          try { matchNewsToCatalysts(newsItems, catalysts); } catch {}
        }
      }
            if (newsItems.length > 0) {
        try { reconcileNewsSentiment(newsItems); } catch {}
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
      // Auftrag 08.08.2026 ("Live-These + Thesis-Score + Katalysatoren"):
      // moatAssessment wird additiv vorgezogen (reine Funktion, keine LLM-
      // Abhaengigkeit) -- vorher lief scoreMoat() erst in Schritt 15, NACH
      // der These. Die urspruengliche Zeile in Schritt 15 referenziert jetzt
      // dieselbe Variable statt sie neu zu berechnen (kein doppelter Call).
      const moatAssessment = scoreMoat(grossMargin, fcfMargin, returnOnEquity, revenueGrowth, description);

      let growthThesis: string | null = null;
      let growthThesisFingerprintValue: string | null = null;
      let growthThesisGeneratedAt: string | null = null;
      if (useLLM) {
        try {
          // Auftrag 08.08.2026 ("These-Refresh + Peer-Gap"): Peer-Gap/Sektor-
          // Median sind an dieser Stelle (Schritt 14) noch NICHT verfuegbar --
          // peerComparison wird erst in Schritt 9b (weiter unten) berechnet.
          // Bewusste Entscheidung (Ticket-Empfehlung Option B): nicht den
          // gesamten Analyze-Flow umbauen, um sie vorzuverlegen. Die erste
          // These bleibt ohne Peer-Gap-Satz; der Enrich-Refresh (siehe
          // /api/catalyst-enrich) hat peerComparison bereits im Cache und
          // gibt Peer-Gap dann mit. Beide Aufrufer teilen sich jetzt dieselbe
          // Helper-Funktion (generateThesisWithFingerprintCache) fuer
          // Segment-Ableitung, GB-Summe, Fingerprint-Vergleich und Cache-Hit.
          const prevCached = analysisCache.get(cacheKey)?.result;
          const thesisResult = await generateThesisWithFingerprintCache({
            ticker: upperTicker, companyName, description, sector: effectiveSector, industry,
            revenueGrowth, fcfMargin, grossMargin, operatingMargin, forwardPE, evEbitda,
            analystPTMedian, currentPrice: price, returnOnEquity,
            catalysts,
            capexContext: capexContext ? { sector: capexContext.sector, programmes: capexContext.programmes, rationale: capexContext.beneficiaryEntry?.rationale ?? "" } : null,
            revenueSegments,
            gStar: impliedGStar,
            moat: (moatAssessment as any).moatStrength ?? null,
            lynchClass,
            nextEarningsDate,
            peerGapPct: null,
            sectorMedianRevenueYoyPct: null,
            prevGrowthThesis: prevCached?.growthThesis ?? null,
            prevGrowthThesisFingerprint: prevCached?.growthThesisFingerprint ?? null,
            prevGrowthThesisGeneratedAt: (prevCached as any)?.growthThesisGeneratedAt ?? null,
          });
          growthThesis = thesisResult.growthThesis;
          growthThesisFingerprintValue = thesisResult.growthThesisFingerprintValue;
          growthThesisGeneratedAt = thesisResult.growthThesisGeneratedAt;
        } catch {}
      }

      // ── 15. Porter + PESTEL ──

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

      // Quartalsumsaetze fuer Realized-8Q (Scoring-Pipeline, §17.8) — 16 Quartale,
      // FMP liefert newest-first, calcRealizedGrowth8QServer erwartet chronologisch.
      let quarterlyRevenueChronological: number[] | null = null;
      try {
        const qRows: any[] = await fmpIncomeStatementQuarterly(upperTicker, 16);
        if (Array.isArray(qRows) && qRows.length > 0) {
          quarterlyRevenueChronological = qRows
            .map(r => Number(r?.revenue))
            .filter(v => isFinite(v) && v > 0)
            .reverse();
        }
      } catch (qErr: any) {
        console.warn(`[ANALYZE] Quarterly revenue fetch failed: ${qErr?.message?.substring(0, 80)}`);
      }

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

      // ── Scoring-Pipeline (WORK_SCORING_VORLAGE.md §0 + §17) ──
      // Verdrahtet mit ECHTEN Analyse-Daten: g* (calcImpliedGStar, oben),
      // FMP-Quartalsumsaetze (Realized-8Q), Jahres-Statements (Margen-Delta,
      // Inventory-Delta), Peer-Wachstum (Share-Loss-Signal), health/Moat
      // (qualityScore-Mapping), MA200-Trendlage (trendMultiplier) und die
      // Katalysatoren (Fiscal-Megatrend-Pruefung mit Lookahead-Sperre).
      // Punkt 1 (HOCH-Ticket 05.08.2026): REGULATORY_EXPOSURE-Gate an die
      // Scoring-Pipeline verdrahten. Liest NUR aus dem bestehenden In-Memory-
      // Cache von regulatory.ts (kein neuer LLM-Call — die Regulatory-Analyse
      // bleibt bewusst lazy und wird weiterhin vom PESTEL-KI-Panel im Frontend
      // ausgeloest). Wurde fuer diesen Ticker noch nie eine Regulatory-Analyse
      // gefahren, liefert dies `null` und das Gate bleibt in buildGates()
      // korrekt inaktiv (kein Fake-Default).
      const cachedRegulatory = getCachedRegulatoryAssessment(upperTicker);
      const regulatoryGate = cachedRegulatory?.gate ?? null;

      let scoring: StockAnalysis["scoring"] = undefined;
      try {
        scoring = buildScoringForAnalysis({
          ctx: {
            impliedGStar,
            quarterlyRevenueChronological,
            annualIncome: financials.income as any[],
            annualBalance: financials.balanceSheet as any[],
            subjectRevenueGrowth: isFinite(revenueGrowth) ? revenueGrowth : null,
            peerRevenueGrowths: peerComparison?.peers
              ? (peerComparison.peers as any[]).map(p => p?.revenueGrowth ?? null)
              : null,
            regulatoryGate,
          },
          health,
          moatRating,
          // Trend-Booleans liegen in currentStatus (TechnicalStatus), nicht am
          // TechnicalIndicators-Objekt selbst.
          technicalIndicators: technicalIndicators?.currentStatus ?? null,
          catalysts,
          price,
          asOfDate: new Date().toISOString().slice(0, 10),
        });
      } catch (scErr: any) {
        console.warn(`[ANALYZE] Scoring pipeline failed: ${scErr?.message?.substring(0, 120)}`);
      }

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
        nextEarningsDate,
        ...(nextEarningsTime ? { nextEarningsTime } : {}),
        ...(nextEarningsIsEstimate !== undefined ? { nextEarningsIsEstimate } : {}),
        lastReportedQuarter,
        fcfYield,
        fcfYieldYoyPp,
        fcfYieldYoyAvailable,
        fcfMarginYoyPp,
        fcfMarginYoyAvailable,
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
        scoring,

        // Investment thesis (Section 2)
        moatRating,
        governmentExposure: govExposure,
        growthThesis: growthThesis ?? "",
        growthThesisFingerprint: growthThesisFingerprintValue ?? undefined,
        growthThesisGeneratedAt: growthThesisGeneratedAt ?? undefined,
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
        // Segment-Fallback-Pipeline (2026-08): lets the UI show "Quelle: FMP"
        // vs. "Quelle: 10-K FY2025" vs. a clear "not available" message instead
        // of a silent/empty block. See step 7b above for the fallback chain.
        revenueSegmentsSource,
        revenueSegmentsMessage,
        peerComparison: peerComparisonOut,
        activePeerOverrides: hasPeerOverrides ? { add: peerAddList, remove: peerRemoveList } : { add: [], remove: [] },
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

      // /api/analyze keys its cache as `analyze:${ticker}:llm:${0|1}[:peers:+..:-..]`
      // (siehe cacheKey oben, gehaertet 10.08.2026 fuer Peer-Override-Stabilitaet).
      // Da hier zum Zeitpunkt des KI-Enrich-Klicks nicht bekannt ist, ob/welche
      // Peer-Overrides beim urspruenglichen /api/analyze-Call aktiv waren, wird
      // die Cache-Map nach dem neuesten passenden Eintrag fuer diesen Ticker
      // durchsucht (mit oder ohne Peer-Overrides, LLM an/aus) -- robuster als
      // eine feste Zwei-Varianten-Rateliste, die bei aktiven Overrides ins
      // Leere liefe. Faellt zusaetzlich auf die alte Key-Form zurueck (Legacy-
      // Cache-Eintraege aus einem laufenden Prozess vor diesem Deploy).
      let cached = analysisCache.get(`analyze:${ticker}:llm:1`) ?? analysisCache.get(`analyze:${ticker}:llm:0`);
      let cacheKeyUsed: string | null = cached ? (analysisCache.get(`analyze:${ticker}:llm:1`) === cached ? `analyze:${ticker}:llm:1` : `analyze:${ticker}:llm:0`) : null;
      if (!cached) {
        for (const [key, entry] of Array.from(analysisCache.entries())) {
          if (key.startsWith(`analyze:${ticker}:llm:`)) { cached = entry; cacheKeyUsed = key; break; }
        }
      }
      if (!cached) {
        // Legacy-Fallback: alte Key-Form von vor der Peer-Override-Haertung.
        cached = analysisCache.get(`${ticker}:true`) ?? analysisCache.get(`${ticker}:false`);
        cacheKeyUsed = cached ? (analysisCache.get(`${ticker}:true`) === cached ? `${ticker}:true` : `${ticker}:false`) : null;
      }
      if (!cached || !cacheKeyUsed) {
        return res.status(404).json({ error: "Keine Analyse im Cache — zuerst /api/analyze aufrufen" });
      }
      const a = cached.result;

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
          // Auftrag 08.08.2026: KI-Enrich-Button liefert ausschliesslich
          // firmenspezifische LLM-Katalysatoren -- generic=false.
          generic: false,
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

      // Auftrag 08.08.2026 ("These direkt nach KI-Enrich aktualisieren"):
      // sobald firmenspezifische Katalysatoren vorliegen, wird die
      // Investment-These (Section 2) SOFORT mit denselben neuen
      // Katalysatoren neu generiert -- vorher stand in S15 "firmenspezifisch"
      // aber S2 zeigte weiterhin die alte These auf den vorherigen
      // (moeglicherweise generischen) Katalysatoren bis zum naechsten
      // vollen /api/analyze-Lauf. peerComparison liegt an dieser Stelle
      // bereits im gecachten `a` vor (die volle Analyse ist schon
      // durchgelaufen) -- Peer-Gap/Sektor-Median werden daher hier zum
      // ersten Mal in die These aufgenommen (in Schritt 14 selbst noch
      // nicht verfuegbar, siehe Kommentar dort).
      let refreshedGrowthThesis = a.growthThesis ?? null;
      let refreshedFingerprint = a.growthThesisFingerprint ?? null;
      let refreshedGeneratedAt = (a as any).growthThesisGeneratedAt ?? null;
      try {
        const peers = (a as any).peerComparison?.peers as Array<{ revenueGrowth?: number | null }> | undefined;
        const peerRevGrowths = Array.isArray(peers)
          ? peers.map(p => p?.revenueGrowth).filter((x): x is number => typeof x === "number" && isFinite(x))
          : [];
        const sortedPeerGrowths = [...peerRevGrowths].sort((x, y) => x - y);
        const sectorMedianRevenueYoyPct = sortedPeerGrowths.length > 0
          ? sortedPeerGrowths[Math.floor(sortedPeerGrowths.length / 2)]
          : null;
        const subjectRevenueGrowth = a.financialStatements?.incomeStatement?.revenueGrowth ?? null;
        const peerGapPct = subjectRevenueGrowth != null && sectorMedianRevenueYoyPct != null
          ? subjectRevenueGrowth - sectorMedianRevenueYoyPct
          : null;

        const moatForThesis = (a as any).moatAssessment?.overallRating ?? null;
        console.log(`[GROWTH-THESIS][${a.ticker}] Enrich-Refresh Peer-Gap-Inputs: subjectRevenueGrowth=${subjectRevenueGrowth}, sectorMedianRevenueYoyPct=${sectorMedianRevenueYoyPct}, peerGapPct=${peerGapPct}, peerRevGrowths=${JSON.stringify(peerRevGrowths)}`);
        const thesisResult = await generateThesisWithFingerprintCache({
          ticker: a.ticker, companyName: a.companyName, description: a.description,
          sector: a.sector, industry: a.industry,
          revenueGrowth: subjectRevenueGrowth ?? 0, fcfMargin: a.fcfMargin,
          analystPTMedian: a.analystPT?.median ?? undefined, currentPrice: a.currentPrice,
          catalysts: withDeepDives,
          capexContext: null,
          revenueSegments: a.revenueSegments ?? [],
          gStar: (a as any).impliedGStar ?? null,
          moat: moatForThesis,
          lynchClass: (a as any).lynchClass ?? null,
          nextEarningsDate: (a as any).nextEarningsDate ?? null,
          peerGapPct,
          sectorMedianRevenueYoyPct,
          prevGrowthThesis: a.growthThesis ?? null,
          prevGrowthThesisFingerprint: a.growthThesisFingerprint ?? null,
          prevGrowthThesisGeneratedAt: (a as any).growthThesisGeneratedAt ?? null,
        });
        if (thesisResult.growthThesis) {
          refreshedGrowthThesis = thesisResult.growthThesis;
          refreshedFingerprint = thesisResult.growthThesisFingerprintValue;
          refreshedGeneratedAt = thesisResult.growthThesisGeneratedAt;
        }
      } catch (thesisErr: any) {
        console.warn(`[/api/catalyst-enrich] These-Refresh fehlgeschlagen fuer ${ticker}: ${thesisErr?.message?.substring(0, 100)}`);
      }

      // Persist enriched catalysts (und ggf. aktualisierte These) back into
      // the cache so subsequent requests (e.g. PDF export, page reload
      // within TTL) see the enriched version.
      const updated: StockAnalysis = {
        ...a, catalysts: withDeepDives,
        growthThesis: refreshedGrowthThesis ?? a.growthThesis,
        growthThesisFingerprint: refreshedFingerprint ?? a.growthThesisFingerprint,
        growthThesisGeneratedAt: refreshedGeneratedAt ?? (a as any).growthThesisGeneratedAt,
      } as StockAnalysis;
      analysisCache.set(cacheKeyUsed, { ...cached, result: updated });
      invalidateThesisStrengthCache(ticker);

      return res.json({
        catalysts: withDeepDives, modelUsed: llmResult.modelUsed,
        growthThesis: updated.growthThesis, growthThesisGeneratedAt: (updated as any).growthThesisGeneratedAt,
      });
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
