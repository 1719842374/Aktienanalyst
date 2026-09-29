/**
 * thesis-lab-routes.ts
 * Separate API für das Thesis-Lab. Ruft /api/analyze NICHT auf.
 */

import type { Express, Request, Response } from "express";
import {
  evaluateFreeText,
  getById,
  listFixtures,
  lookupByTicker,
  type Ampel,
} from "./thesisLab";
import { INDUSTRY_META, STAGE_TO_INDUSTRIES } from "./thesis-lab-valuechain-map";

export function registerThesisLabRoutes(app: Express): void {
  app.get("/api/lab/theses", (req: Request, res: Response) => {
    const ampel = typeof req.query.ampel === "string" ? (req.query.ampel as Ampel) : undefined;
    const stage = typeof req.query.stage === "string" ? req.query.stage : undefined;
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const items = listFixtures({ ampel, stage, q });
    res.json({ asOf: "2026-09-16", count: items.length, items });
  });

  app.get("/api/lab/thesis/:id", (req: Request, res: Response) => {
    const item = getById(String(req.params.id));
    if (!item) return res.status(404).json({ error: "thesis not found" });
    res.json(item);
  });

  app.get("/api/lab/lookup", (req: Request, res: Response) => {
    const ticker = typeof req.query.ticker === "string" ? req.query.ticker : "";
    if (!ticker) return res.status(400).json({ error: "ticker required" });
    res.json({ ticker, items: lookupByTicker(ticker) });
  });

  app.get("/api/lab/valuechain-map", (_req: Request, res: Response) => {
    res.json({ stageToIndustries: STAGE_TO_INDUSTRIES, industryMeta: INDUSTRY_META });
  });

  app.post("/api/lab/thesis", (req: Request, res: Response) => {
    const thesis = String(req.body?.thesis || "").trim();
    if (thesis.length < 8) return res.status(400).json({ error: "thesis too short" });
    const result = evaluateFreeText(thesis, req.body?.overrides);
    res.json(result);
  });
}
