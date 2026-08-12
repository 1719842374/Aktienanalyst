import type { Express } from "express";
import { fetchBTCMacroHistory } from "./btc-macro";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const cache = new Map<string, { expiresAt: number; data: Awaited<ReturnType<typeof fetchBTCMacroHistory>> }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Additive BTC-Route: Die bestehende Browser-Analyse bleibt unveraendert und
 * erweitert ihre technische Zeitreihe mit diesen serverseitig geladenen
 * FRED-Makro-Overlays.
 */
export function registerBTCRoutes(app: Express): void {
  app.get("/api/analyze-btc/macro-history", async (req, res) => {
    const requestedStart = typeof req.query.startDate === "string" ? req.query.startDate : "2011-01-01";
    const startDate = DATE_PATTERN.test(requestedStart) ? requestedStart : "2011-01-01";
    const cacheKey = startDate;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return res.json(cached.data);

    try {
      const data = await fetchBTCMacroHistory(startDate);
      cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      res.json(data);
    } catch (err: any) {
      console.error("[GET /api/analyze-btc/macro-history]", err?.message?.substring(0, 200));
      res.status(502).json({ error: "FRED-Makrodaten nicht verfügbar" });
    }
  });
}
