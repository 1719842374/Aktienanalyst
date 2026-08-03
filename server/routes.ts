/**
 * routes.ts — Clean orchestrator (Step 4 of modular refactor).
 *
 * History:
 *  - Before: monolith with /api/analyze inline (~2000+ lines) → GitHub API
 *    silently truncated the file → truncation bug caused missing route body.
 *  - Now: each route is its own module. routes.ts is only a barrel + orchestrator.
 *    Structural truncation can never re-occur because no single file is large enough.
 *
 * Module map:
 *  /api/analyze, /api/fmp-budget   → server/analyze-route.ts
 *  /api/btc-miner                  → server/btc-miner.ts (GET + POST)
 *  /api/analyze-gold               → server/gold-routes.ts
 *
 * Additional routes (/api/analyze-recession, /api/researcher/*, /api/catalyst-enrich,
 * /api/export-pdf) can be extracted the same way as analyze-route.ts when needed.
 */

import type { Express } from "express";
import { type Server } from "http";

// ─── Re-exports ───────────────────────────────────────────────────────────────
// New FMP budget API + legacy quota shims (all no-ops now, kept so crons/scripts
// that still import isQuotaExceeded / incrementQuota don't break at load time).
export {
  trackFmpCall,
  getFmpBudgetStatus,
  isFmpBudgetLow,
  resetFmpBudget,
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

// ─── Route modules ────────────────────────────────────────────────────────────
import { registerAnalyzeRoute } from "./analyze-route";
import { registerGoldRoutes } from "./gold-routes";
import { fetchMinerData } from "./btc-miner";
import { assessRegulatoryExposure } from "./regulatory";

// ─── registerRoutes ───────────────────────────────────────────────────────────
export async function registerRoutes(httpServer: Server, app: Express): Promise<void> {
  // 1. /api/analyze + /api/fmp-budget
  registerAnalyzeRoute(httpServer, app);

  // 2. /api/analyze-gold
  registerGoldRoutes(httpServer, app);

  // 3a. GET /api/btc-miner — no price context, returns miner metrics only
  app.get("/api/btc-miner", async (_req, res) => {
    try {
      const minerData = await fetchMinerData();
      if (!minerData) {
        return res.status(503).json({ error: "Miner data unavailable — mempool.space unreachable" });
      }
      res.json(minerData);
    } catch (err: any) {
      console.error("[GET /api/btc-miner]", err?.message?.substring(0, 200));
      res.status(500).json({ error: err?.message || "Internal error" });
    }
  });

  // 3b. POST /api/btc-miner — accepts btcPriceHistory + btcPrice for Puell & minerScore
  //     Body: { btcPriceHistory: [{date, price}][], btcPrice: number }
  app.post("/api/btc-miner", async (req, res) => {
    try {
      const { btcPriceHistory, btcPrice } = req.body ?? {};
      const minerData = await fetchMinerData(
        Array.isArray(btcPriceHistory) ? btcPriceHistory : undefined,
        typeof btcPrice === 'number' ? btcPrice : undefined
      );
      if (!minerData) {
        return res.status(503).json({ error: "Miner data unavailable — mempool.space unreachable" });
      }
      res.json(minerData);
    } catch (err: any) {
      console.error("[POST /api/btc-miner]", err?.message?.substring(0, 200));
      res.status(500).json({ error: err?.message || "Internal error" });
    }
  });

  // 4. POST /api/regulatory — WORK2.md §8 Regulatory-Exposure-Analyse (LLM,
  //    generische Achsen ohne Fixnamen). Frontend liefert den Kontext aus der
  //    bereits geladenen StockAnalysis (geoSegments, revenue, margin, shares) —
  //    kein zweiter FMP-Roundtrip. 24h-Cache pro Ticker in regulatory.ts.
  //    Body: { ticker, companyName, sector, industry, description?,
  //            topCountries: [{countryOrRegion, percentage}], totalRevenue,
  //            operatingMargin, sharesOutstanding, taxRate?, force? }
  app.post("/api/regulatory", async (req, res) => {
    try {
      const b = req.body ?? {};
      if (!b.ticker || typeof b.ticker !== "string") {
        return res.status(400).json({ error: "ticker fehlt" });
      }
      if (!Array.isArray(b.topCountries) || typeof b.totalRevenue !== "number" ||
          typeof b.operatingMargin !== "number" || typeof b.sharesOutstanding !== "number") {
        return res.status(400).json({ error: "Kontext unvollständig (topCountries/totalRevenue/operatingMargin/sharesOutstanding)" });
      }
      const assessment = await assessRegulatoryExposure({
        ticker: b.ticker,
        companyName: String(b.companyName ?? b.ticker),
        sector: String(b.sector ?? ""),
        industry: String(b.industry ?? ""),
        description: typeof b.description === "string" ? b.description : undefined,
        topCountries: b.topCountries,
        totalRevenue: b.totalRevenue,
        operatingMargin: b.operatingMargin,
        sharesOutstanding: b.sharesOutstanding,
        taxRate: typeof b.taxRate === "number" ? b.taxRate : undefined,
        force: b.force === true,
      });
      if (!assessment) {
        return res.status(503).json({ error: "Regulatory-Analyse nicht verfügbar — LLM (OpenRouter) nicht erreichbar" });
      }
      res.json(assessment);
    } catch (err: any) {
      console.error("[POST /api/regulatory]", err?.message?.substring(0, 200));
      res.status(500).json({ error: err?.message || "Internal error" });
    }
  });

  // httpServer available for future WebSocket upgrades
}
