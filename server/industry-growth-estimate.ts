/**
 * Knopf-Schätzung für das Branchen-Wachstum in Sektion 9.
 * Gleicher OpenRouter-Pfad wie die Segment-Schätzung in Sektion 3:
 * callLLMJson, kein :online, dasselbe Rate-Limit. Kein Aufruf aus /api/analyze.
 */
import type { Express, Request, Response } from "express";
import {
  INDUSTRY_GROWTH_AI_LABEL,
  industryGrowthEstimateBody,
  industryGrowthEstimatePrompt,
} from "../shared/industry-growth";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { takeSegmentChildrenSlot } from "./segment-growth-route";

const RATE_MAX = 20;
const RATE_WINDOW_MS = 60 * 1000;

type Llm = typeof callLLMJson;

export function registerIndustryGrowthEstimateRoute(app: Express, deps?: {
  llm?: Llm;
  now?: () => number;
  available?: () => boolean;
  rateLimit?: { max: number; windowMs: number };
}): void {
  app.post("/api/industry-growth-estimate", async (req: Request, res: Response) => {
    const now = deps?.now?.() ?? Date.now();
    const limit = deps?.rateLimit ?? { max: RATE_MAX, windowMs: RATE_WINDOW_MS };
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (!takeSegmentChildrenSlot(ip, now, limit.max, limit.windowMs)) {
      return res.status(429).json({ error: "Zu viele Abfragen", label: INDUSTRY_GROWTH_AI_LABEL });
    }
    const sector = typeof req.body?.sector === "string" ? req.body.sector : "";
    const industry = typeof req.body?.industry === "string" ? req.body.industry : "";
    const description = typeof req.body?.description === "string" ? req.body.description : "";
    if (!sector.trim() && !industry.trim()) {
      return res.status(400).json({ error: "Sektor oder Branche fehlt", label: INDUSTRY_GROWTH_AI_LABEL });
    }
    const available = deps?.available ?? isLLMAvailable;
    if (!deps?.llm && !available()) {
      return res.json(industryGrowthEstimateBody(null, null, "OpenRouter nicht konfiguriert"));
    }
    const prompts = industryGrowthEstimatePrompt({ sector, industry, description });
    const llm = deps?.llm ?? callLLMJson;
    const result = await llm({
      systemPrompt: prompts.systemPrompt,
      prompt: prompts.prompt,
      maxTokens: 400,
      temperature: 0.2,
    }).catch(() => null);
    if (!result?.data) {
      return res.json(industryGrowthEstimateBody(null, result?.modelUsed ?? null, "KI-Schätzung fehlgeschlagen"));
    }
    return res.json(industryGrowthEstimateBody(result.data, result.modelUsed));
  });
}
