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

// ─── Route modules ────────────────────────────────────────────────────────────
import { registerAnalyzeRoute } from "./analyze-route";
import { registerGoldRoutes } from "./gold-routes";
import { fetchMinerData } from "./btc-miner";

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

  // httpServer available for future WebSocket upgrades
}
