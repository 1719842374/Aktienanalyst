/**
 * GET /api/analyze-recession/buffett-phi — F1-36/F1-37/F1-40.
 * φ über callLLMJson (server/llm-openrouter.ts), Cache PHI_CACHE_MS.
 * Fallback PHI_FALLBACK, im Feld source und im reason als „Fallback“ markiert.
 * Die Buffett-Quote (/api/analyze-recession/buffett) bleibt unverändert.
 * Kein Score, analyze-route unberührt. EU/CN: phi null + Grund, nie 0.
 */
import type { Express, Request, Response } from "express";
import {
  PHI_CACHE_MS,
  PHI_FALLBACK,
  PHI_LLM_PROMPT,
  PHI_US_ONLY_REASON,
  parsePhiPayload,
  type BuffettPhiBody,
} from "../shared/buffett-phi";

export type { BuffettPhiBody };
type PhiRegion = BuffettPhiBody["region"];

export type PhiLlm = (opts: {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}) => Promise<{ data: unknown; modelUsed: string } | null>;

interface PhiCache {
  at: number;
  phi: number;
  model: string;
  asOf: string;
}

let cache: PhiCache | null = null;
let testLlm: { available: boolean; call: PhiLlm } | null = null;

export function resetBuffettPhiCache(): void {
  cache = null;
}

/** Nur für Tests. Ersetzt den OpenRouter-Aufruf, lässt einen vorhandenen Cache stehen. */
export function setBuffettPhiLlmForTests(llm: { available: boolean; call: PhiLlm } | null): void {
  testLlm = llm;
}

function usBody(input: {
  phi: number;
  source: "llm" | "cache" | "fallback";
  fallback: boolean;
  model: string | null;
  reason: string | null;
  asOf: string;
  fromCache: boolean;
}): BuffettPhiBody {
  const share = input.phi >= 0 && input.phi < 1 ? 1 - input.phi : null;
  return {
    region: "US",
    phi: input.phi,
    domesticShare: share,
    source: input.source,
    fallback: input.fallback,
    fallbackPhi: PHI_FALLBACK,
    model: input.model,
    reason: input.reason,
    asOf: input.asOf,
    fromCache: input.fromCache,
  };
}

export function phiBodyForRegion(region: "EU" | "CN"): BuffettPhiBody {
  return {
    region,
    phi: null,
    domesticShare: null,
    source: null,
    fallback: false,
    fallbackPhi: PHI_FALLBACK,
    model: null,
    reason: PHI_US_ONLY_REASON,
    asOf: null,
    fromCache: false,
  };
}

function fromCache(hit: PhiCache, reason: string | null): BuffettPhiBody {
  return usBody({
    phi: hit.phi,
    source: "cache",
    fallback: false,
    model: hit.model,
    reason,
    asOf: hit.asOf,
    fromCache: true,
  });
}

async function loadLlm(): Promise<{ available: boolean; call: PhiLlm }> {
  if (testLlm) return testLlm;
  const { callLLMJson, isLLMAvailable } = await import("./llm-openrouter");
  return {
    available: isLLMAvailable(),
    call: opts => callLLMJson(opts),
  };
}

export async function resolveUsForeignShare(now = Date.now()): Promise<BuffettPhiBody> {
  if (cache && now - cache.at < PHI_CACHE_MS) return fromCache(cache, null);
  const llm = await loadLlm();
  let failReason = "LLM nicht verfügbar";
  if (llm.available) {
    try {
      const result = await llm.call({ prompt: PHI_LLM_PROMPT, maxTokens: 120, temperature: 0 });
      if (!result) {
        failReason = "LLM lieferte kein JSON";
      } else {
        const parsed = parsePhiPayload(result.data);
        if (parsed.phi != null) {
          const asOf = new Date(now).toISOString();
          cache = { at: now, phi: parsed.phi, model: result.modelUsed, asOf };
          return usBody({
            phi: parsed.phi,
            source: "llm",
            fallback: false,
            model: result.modelUsed,
            reason: null,
            asOf,
            fromCache: false,
          });
        }
        failReason = parsed.reason ?? "LLM-Antwort ungültig";
      }
    } catch (err) {
      failReason = `LLM-Abruf fehlgeschlagen: ${String((err as Error)?.message ?? err).slice(0, 160)}`;
    }
  }
  if (cache) return fromCache(cache, `letzter gültiger LLM-Wert — ${failReason}`);
  return usBody({
    phi: PHI_FALLBACK,
    source: "fallback",
    fallback: true,
    model: null,
    reason: `Fallback — ${failReason}`,
    asOf: new Date(now).toISOString(),
    fromCache: false,
  });
}

function isRegion(value: string): value is PhiRegion {
  return value === "US" || value === "EU" || value === "CN";
}

export function registerBuffettPhiRoute(app: Express): void {
  app.get("/api/analyze-recession/buffett-phi", async (req: Request, res: Response) => {
    const region = String(req.query.region || "US").toUpperCase();
    if (!isRegion(region)) {
      return res.status(400).json({ error: "Region muss US, EU oder CN sein" });
    }
    try {
      if (region !== "US") return res.json(phiBodyForRegion(region));
      return res.json(await resolveUsForeignShare());
    } catch (err) {
      if (!res.headersSent) {
        res.json(usBody({
          phi: PHI_FALLBACK,
          source: "fallback",
          fallback: true,
          model: null,
          reason: `Fallback — ${String((err as Error)?.message ?? err).slice(0, 160)}`,
          asOf: new Date().toISOString(),
          fromCache: false,
        }));
      }
    }
  });
}
