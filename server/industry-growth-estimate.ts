/**
 * Knopf-Schätzung für das Branchen-Wachstum in Sektion 9.
 * Dasselbe Muster wie /api/segment-outline (#465): nur auf Anfrage,
 * callLLMJson ohne Websuche, dasselbe Rate-Limit. Kein Aufruf aus /api/analyze.
 */
import type { Express, Request, Response } from "express";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { SEGMENT_CHILDREN_KI_TIMEOUT_MS, takeSegmentChildrenSlot } from "./segment-growth-route";

const IMF_FIVE_SOURCE = "IMF / World Bank GDP Growth Estimate";

/** Dieselben Ablehnungen wie in Section7. Kein Ersatz durch eine Default-Zahl. */
export function industryGrowthRejection(input: {
  quality?: string | null;
  label?: string | null;
  source?: string | null;
  value?: number | null;
}): string | null {
  const quality = (input.quality ?? "").trim().toLowerCase();
  const label = (input.label ?? "").trim().toLowerCase();
  const source = (input.source ?? "").trim().toLowerCase();
  if (quality === "unreliable") return "tamCAGR verworfen: Segment-TAM unzuverlässig";
  if (label === "global market" || source === "global market") return "Global Market ist keine Branchenquelle";
  if (source === IMF_FIVE_SOURCE.toLowerCase() && input.value === 5) return "IMF-Pauschale 5 % ist keine Branchenquelle";
  return null;
}

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
      return res.status(429).json({ error: "Zu viele Abfragen" });
    }
    const sector = typeof req.body?.sector === "string" ? req.body.sector.trim() : "";
    const industry = typeof req.body?.industry === "string" ? req.body.industry.trim() : "";
    const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 400) : "";
    if (!sector && !industry) {
      return res.status(400).json({ error: "Sektor oder Branche fehlt" });
    }
    const available = deps?.available ?? isLLMAvailable;
    if (!deps?.llm && !available()) {
      return res.json({ reason: "OpenRouter nicht konfiguriert" });
    }
    const llm = deps?.llm ?? callLLMJson;
    const result = await llm({
      systemPrompt: "Antworte nur mit JSON. Schätze das Branchenwachstum in Prozent. Eine fehlende Zahl bleibt null. Ohne Quelle und Begründung keine Zahl. Global Market und die IMF-Pauschale sind keine zulässige Quelle.",
      prompt: `Sektor: ${sector || "n/a"}. Branche: ${industry || "n/a"}. Beschreibung: ${description || "n/a"}. JSON: {"growthPct": number|null, "source": string, "rationale": string}`,
      maxTokens: 400,
      temperature: 0.2,
      signal: AbortSignal.timeout(SEGMENT_CHILDREN_KI_TIMEOUT_MS),
    }).catch(() => null);
    const data = result?.data as { growthPct?: unknown; source?: unknown; rationale?: unknown } | undefined;
    const value = typeof data?.growthPct === "number" && Number.isFinite(data.growthPct) ? data.growthPct : null;
    const source = typeof data?.source === "string" ? data.source.trim() : "";
    const rationale = typeof data?.rationale === "string" ? data.rationale.trim() : "";
    const modelBlocked = industryGrowthRejection({ label: source, source, value });
    if (modelBlocked) return res.json({ reason: modelBlocked, modelUsed: result?.modelUsed ?? null });
    if (value == null || !source || !rationale) {
      return res.json({ reason: "KI-Schätzung ohne Quelle oder Begründung", modelUsed: result?.modelUsed ?? null });
    }
    return res.json({ value, source, rationale, label: "KI-Schätzung", modelUsed: result?.modelUsed ?? null });
  });
}
