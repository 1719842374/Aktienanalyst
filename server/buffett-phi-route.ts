/**
 * GET /api/analyze-recession/buffett-phi — F1-36/F1-37/F1-40.
 * φ über callLLMJson (server/llm-openrouter.ts), Cache PHI_CACHE_MS.
 * Fällt der LLM aus: letzter gültiger Cache-Wert, sonst Median der Historie.
 * Ohne Historie phi null und „kein φ verfügbar“, nie eine feste Zahl.
 * Jeder gesetzte Fallback trägt im reason das Wort „Fallback“.
 * Die Buffett-Quote (/api/analyze-recession/buffett) bleibt unverändert.
 * Kein Score, analyze-route unberührt. EU/CN: phi null + Grund, nie 0.
 */
import type { Express, Request, Response } from "express";
import {
  PHI_CACHE_MS,
  PHI_LLM_PROMPT,
  PHI_UNAVAILABLE_REASON,
  PHI_US_ONLY_REASON,
  derivePhiFallback,
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
/** Jede erfolgreiche LLM-Schätzung. Der Median wird daraus gerechnet, nicht aus einer festen Zahl. */
let history: PhiCache[] = [];
let testLlm: { available: boolean; call: PhiLlm } | null = null;

export function resetBuffettPhiCache(): void {
  cache = null;
  history = [];
}

/** Nur für Tests: der letzte Cache-Slot fehlt, die Historie bleibt. */
export function dropBuffettPhiLastCacheForTests(): void {
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
    fallbackPhi: input.fallback ? input.phi : null,
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
    fallbackPhi: null,
    model: null,
    reason: PHI_US_ONLY_REASON,
    asOf: null,
    fromCache: false,
  };
}

function fromCache(hit: PhiCache, reason: string | null, fallback: boolean): BuffettPhiBody {
  return usBody({
    phi: hit.phi,
    source: fallback ? "fallback" : "cache",
    fallback,
    model: hit.model,
    reason,
    asOf: hit.asOf,
    fromCache: true,
  });
}

function unavailableBody(detail: string): BuffettPhiBody {
  return {
    region: "US",
    phi: null,
    domesticShare: null,
    source: null,
    fallback: false,
    fallbackPhi: null,
    model: null,
    reason: `${PHI_UNAVAILABLE_REASON} — ${detail}`,
    asOf: null,
    fromCache: false,
  };
}

/** LLM lieferte nichts: Cache, sonst Median, sonst n/a. */
function fallbackAfterMiss(failReason: string, now: number): BuffettPhiBody {
  const derived = derivePhiFallback(cache?.phi ?? null, history.map(item => item.phi));
  if (derived.kind === "cache" && cache) {
    return fromCache(cache, `Fallback — letzter gültiger Cache-Wert — ${failReason}`, true);
  }
  if (derived.kind === "median" && derived.phi != null) {
    return usBody({
      phi: derived.phi,
      source: "fallback",
      fallback: true,
      model: null,
      reason: `Fallback — Median aus ${history.length} gespeicherten φ-Schätzungen — ${failReason}`,
      asOf: new Date(now).toISOString(),
      fromCache: false,
    });
  }
  return unavailableBody(failReason);
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
  if (cache && now - cache.at < PHI_CACHE_MS) return fromCache(cache, null, false);
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
          const stored = { at: now, phi: parsed.phi, model: result.modelUsed, asOf };
          history = [...history, stored];
          cache = stored;
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
  return fallbackAfterMiss(failReason, now);
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
        res.json(fallbackAfterMiss(String((err as Error)?.message ?? err).slice(0, 160), Date.now()));
      }
    }
  });
}
