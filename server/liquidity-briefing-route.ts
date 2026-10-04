/**
 * GET /api/researcher/liquidity-briefing
 * EZ/JP Velocity und APP/PEPP. Der US-C2-Pfad bleibt /api/researcher/liquidity.
 */
import type { Express } from "express";
import { fetchLiquidityBriefing } from "./liquidity-briefing";

export function registerLiquidityBriefingRoute(app: Express): void {
  app.get("/api/researcher/liquidity-briefing", async (req, res) => {
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    try {
      const result = await fetchLiquidityBriefing({ refresh });
      res.json(result);
    } catch (err: any) {
      const message = err?.message || "liquidity briefing failed";
      console.error("[RESEARCHER/liquidity-briefing] failed:", message);
      res.status(500).json({ error: message });
    }
  });
}
