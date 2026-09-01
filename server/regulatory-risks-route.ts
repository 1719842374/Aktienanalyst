/**
 * Additive TEIL-8-Hooks: PESTEL-Risks an POST /api/regulatory anhängen + Disk-Cache.
 * Kein zweiter LLM-Call. researcher.ts / regulatory.ts unberührt.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { enrichAssessment, persistAssessment, readPersistedAssessment } from "./regulatory-risks";

function isRegulatoryPost(req: Request): boolean {
  const p = (req.path || "").replace(/\/+$/, "");
  return req.method === "POST" && (p === "/api/regulatory" || p.endsWith("/api/regulatory"));
}

export function registerRegulatoryRisksHooks(app: Express): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isRegulatoryPost(req)) return next();
    const orig = res.json.bind(res);
    (res as Response).json = ((body: unknown) => {
      if (body && typeof body === "object" && Array.isArray((body as { exposures?: unknown }).exposures)) {
        const enriched = enrichAssessment(body as { ticker?: string; exposures: [] });
        persistAssessment(enriched);
        return orig(enriched);
      }
      return orig(body as never);
    }) as typeof res.json;
    next();
  });
}

export function registerRegulatoryRisksRoute(app: Express): void {
  app.get("/api/regulatory/cached/:ticker", (req: Request, res: Response) => {
    const ticker = String(req.params.ticker || "");
    const data = readPersistedAssessment(ticker);
    if (!data) {
      res.status(404).json({ error: "no cached regulatory assessment", ticker: ticker.toUpperCase() });
      return;
    }
    res.json(data);
  });
}
