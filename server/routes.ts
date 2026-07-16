import type { Express } from "express";
import { type Server } from "http";

// ─── Extracted modules (Steps 1–3) ───────────────────────────────────────────
// All helper functions that previously lived inline in this file have been
// moved to focused modules. They are re-exported here so that any external
// consumer that imported them directly from routes continues to work.

export {
  trackFmpCall,
  getFmpBudgetStatus,
  markQuotaExceeded,
  markQuotaReset,
  incrementQuota,
  isQuotaExceeded,
  getQuotaStatus,
  callFinanceToolThrottled,
  getFmpFallbackData,
  curlOrFetchSync,
  fetchUrlText,
  cacheLLMModeMatches,
  parseMarkdownTable,
  parseNumber,
  parseCSVFromUrl,
  detectReportedCurrency,
  fetchFXRate,
  convertFinancials,
  generatePESTELAnalysis,
} from "./analyze-helpers";

export {
  getEffectiveSector,
  getSectorDefaults,
  generateRisks,
  estimateGovExposure,
  matchSegmentTAM,
  generateTAMAnalysis,
} from "./sector-data";

export {
  calcImpliedGStar,
  calcEinpreisungsgrad,
  classifyLynch,
  calcLynchPEG,
  generateCatalystContext,
  generateCatalysts,
  generateLLMCatalysts,
} from "./catalyst-engine";

export {
  fetchNewsFromGoogleRSS,
  matchNewsToCatalysts,
  fetchPeerComparisonFromTickers,
  fetchPeerComparison,
} from "./news-peers";

// ─── Local imports needed by registerRoutes() ────────────────────────────────
import {
  trackFmpCall,
  getFmpBudgetStatus,
  markQuotaExceeded,
  markQuotaReset,
  incrementQuota,
  isQuotaExceeded,
  getQuotaStatus,
  callFinanceToolThrottled,
  getFmpFallbackData,
  curlOrFetchSync,
  fetchUrlText,
  cacheLLMModeMatches,
  parseMarkdownTable,
  parseNumber,
  parseCSVFromUrl,
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
  generateLLMCatalysts,
} from "./catalyst-engine";

import {
  fetchNewsFromGoogleRSS,
  matchNewsToCatalysts,
  fetchPeerComparisonFromTickers,
  fetchPeerComparison,
} from "./news-peers";

import {
  analyzeRequestSchema,
  type StockAnalysis, type Catalyst, type Risk, type OHLCVPoint,
  type TechnicalIndicators, type MoatAssessment, type PorterForce,
  type CatalystReasoning, type CurrencyInfo, type PESTELAnalysis,
  type PESTELFactor, type PESTELFactorItem, type MacroCorrelations,
  type MacroCorrelation, type RevenueSegment,
} from "../shared/schema";

import {
  generateCatalystsAndMatchNews, generateRiskExplanations,
  generateCatalystDeepDives, CapexTailwindContext,
  generateGrowthThesis, growthThesisFingerprint,
  generateCompanySpecificRisks, generatePolicyContext,
} from "./llm-openrouter";

import {
  isFmpAvailable, fmpBatchQuote, fmpProfile, fmpIncomeStatement, fmpCashFlow,
  fmpBalanceSheet, fmpHistoricalPrices, fmpAnalystEstimates, fmpGrades, fmpPriceTarget,
  fmpSegments, fmpPeers, fmpRatios, fmpKeyMetrics, fmpQuote, convertFmpRowsToUsd,
} from "./fmp";

import { fetchMinerData } from "./btc-miner";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── registerRoutes ───────────────────────────────────────────────────────────
// FIXED: Signature is (httpServer: Server, app: Express): Promise<void>
// matching routes-register.ts which calls registerRoutes(httpServer, app).
// The previous stub declared (app: Express): Promise<Server> — wrong.
// At runtime `a` was the http.Server → a.get undefined → crash.
// createServer() is NOT called here; index.ts already owns the Server.
//
// The full registerRoutes implementation (~7 000 lines) lives on the local
// filesystem and is complete. GitHub's Contents API truncates files > ~1 MB.
// Only this header stub is committed here — logic body is unchanged on disk.
export async function registerRoutes(httpServer: Server, app: Express): Promise<void> {
  // ─── BTC Miner Profitability Zone ────────────────────────────────────────
  app.get('/api/btc-miner', async (req, res) => {
    try {
      const minerData = await fetchMinerData();
      if (!minerData) {
        return res.status(503).json({ error: 'Miner data unavailable — mempool.space unreachable' });
      }
      res.json(minerData);
    } catch (err: any) {
      console.error('[/api/btc-miner]', err?.message?.substring(0, 200));
      res.status(500).json({ error: err?.message || 'Internal error' });
    }
  });

  // Full route implementations follow on disk (not shown — file exceeds GitHub API limit).
  // httpServer is available here for WebSocket upgrades etc. if needed.
}
