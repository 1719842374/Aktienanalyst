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
 *  /api/analyze, /api/fmp-budget  → server/analyze-route.ts
 *  /api/btc-miner                 → server/btc-miner.ts (inline below, small)
 *  /api/analyze-gold              → server/gold-routes.ts
 *
 * Additional routes (/api/analyze-recession, /api/researcher/*, /api/catalyst-enrich,
 * /api/export-pdf) can be extracted the same way as analyze-route.ts when needed.
 */

import type { Express } from "express";
import { type Server } from "http";

// ─── Re-exports (consumed by other server modules) ───────────────────────────
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

// ─── registerRoutes — called by routes-register.ts ───────────────────────────
export async function registerRoutes(httpServer: Server, app: Express): Promise<void> {
  // 1. /api/analyze + /api/fmp-budget
  registerAnalyzeRoute(httpServer, app);

  // 2. /api/analyze-gold
  registerGoldRoutes(httpServer, app);

  // 3. /api/btc-miner (small, kept inline — no truncation risk)
  app.get("/api/btc-miner", async (_req, res) => {
    try {
      const minerData = await fetchMinerData();
      if (!minerData) {
        return res.status(503).json({ error: "Miner data unavailable — mempool.space unreachable" });
      }
      res.json(minerData);
    } catch (err: any) {
      console.error("[/api/btc-miner]", err?.message?.substring(0, 200));
      res.status(500).json({ error: err?.message || "Internal error" });
    }
  });

  // httpServer available for future WebSocket upgrades
}
