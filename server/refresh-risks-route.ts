/**
 * POST /api/refresh-risks — Section 8 (client/src/components/sections/Section8.tsx:52) replaces the
 * generic template risks with company-specific LLM risks.
 *
 * REGRESSION-FIX (11.10.2026): the handler lived inline in routes.ts and was dropped by 57189dd
 * (16.07.2026, routes.ts 7606 → 279 lines). Since then the SPA catch-all answered with index.html,
 * Section8's r.json() threw, the .catch swallowed it and the generic risks silently stayed.
 * Restored from 57189dd^ (routes.ts ~6041–6078) as its own module, with two fixes:
 *  - expectedDamage = EW% × Impact% (same formula as analyze-route.ts step 12). The old handler set
 *    it to 0, which would have zeroed Section 8's Total Expected Damage and risk-adjusted target.
 *  - no LLM key / LLM error → 200 JSON { risks: null, reason }, never a 500. Section8 keeps its risks.
 */
import type { Express } from "express";
import { generateCompanySpecificRisks } from "./llm-openrouter";
import { diskCacheGet, diskCacheSet } from "./disk-cache";

type RiskGen = typeof generateCompanySpecificRisks;
export interface RefreshRisksDeps {
  generate?: RiskGen;
  cacheGet?: (ticker: string) => any | null;
  cacheSet?: (ticker: string, data: any) => void;
}

export function registerRefreshRisksRoute(app: Express, deps: RefreshRisksDeps = {}): void {
  const generate = deps.generate ?? generateCompanySpecificRisks;
  const cacheGet = deps.cacheGet ?? diskCacheGet;
  const cacheSet = deps.cacheSet ?? diskCacheSet;

  app.post("/api/refresh-risks", async (req, res) => {
    const { ticker, companyName, description, sector, industry, revenue,
      revenueGrowth, fcfMargin, forwardPE, beta, governmentExposure,
      catalysts, newsItems } = req.body || {};
    if (!ticker || !description || !(catalysts?.length > 0))
      return res.json({ risks: null, reason: "insufficient_data" });
    try {
      const refreshCats = (catalysts || [])
        .filter((c: any) => !c.tags?.includes("capex-tailwind")).slice(0, 2);
      const newRisks = await generate({
        ticker: String(ticker),
        companyName: String(companyName || ticker),
        description: String(description || ""),
        sector: String(sector || "Technology"),
        industry: String(industry || ""),
        revenue: Number(revenue) || 0,
        revenueGrowth: Number(revenueGrowth) || 0,
        fcfMargin: Number(fcfMargin) || 0,
        grossMargin: 0,
        forwardPE: Number(forwardPE) || 0,
        beta: Number(beta) || 1.1,
        governmentExposure: Number(governmentExposure) || 0,
        topCatalysts: refreshCats.map((c: any) => ({ name: c.name, context: c.context || "" })),
        capexContext: null,
        recentNewsHeadlines: (newsItems || []).slice(0, 4).map((n: any) => n.title || ""),
      });
      if (!newRisks || newRisks.length < 3)
        return res.json({ risks: null, reason: "llm_unavailable" });
      const freshRisks = newRisks.map(r => ({ ...r, expectedDamage: +(r.ew / 100 * r.impact).toFixed(2) }));
      // Persist to the disk cache so the next load shows the specific risks right away
      const key = String(ticker).toUpperCase();
      try {
        const existing = cacheGet(key);
        if (existing) cacheSet(key, { ...existing, risks: freshRisks });
      } catch (e: any) {
        console.warn(`[REFRESH-RISKS] cache write skipped for ${key}: ${e?.message?.substring(0, 80)}`);
      }
      console.log(`[REFRESH-RISKS] ${ticker}: ${freshRisks.map(r => r.name).join(" | ")}`);
      return res.json({ risks: freshRisks, ticker });
    } catch (err: any) {
      console.warn(`[REFRESH-RISKS] ${ticker}: ${err?.message?.substring(0, 120)}`);
      return res.json({ risks: null, reason: "llm_error" });
    }
  });
}
