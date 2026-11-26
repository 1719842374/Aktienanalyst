/**
 * POST /api/podcast/script — Aktien-Podcast, neben der Markt-Route.
 * Klick erzeugt den Voll-KI-Pack und genau ein OpenRouter-Transkript.
 * Kein Schreibzugriff auf Score, Rating, Entry oder den Analyze-UI-Cache.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { OPENROUTER_NO_KEY_MESSAGE } from "../shared/openrouter-no-key";
import {
  PODCAST_DISCLAIMER,
  PODCAST_PROMPT_VERSION,
  type StockPodcastErrorCode,
  type StockPodcastScriptResponse,
  type StockPodcastSource,
  resolveStockPodcastVoice,
} from "../shared/podcast-types";
import { buildPodcastFacts, hashPodcastFacts } from "../shared/podcast-facts";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import {
  peekPodcastPack,
  resetPodcastPackCache,
  runFullAiAnalysis,
  type FullAiDeps,
  type FullAiPack,
} from "./stock-podcast-full-ai";
import {
  madridDayKey,
  podcastDailyRefund,
  podcastDailyTake,
  resetPodcastDailyLimit,
} from "./stock-podcast-limit";
import {
  dropPodcastScripts,
  readCachedScript,
  renderStockPodcastScript,
  resetPodcastScriptCache,
  type StockPodcastLlm,
} from "./stock-podcast-script";

export const stockPodcastRequestSchema = z.object({
  ticker: z.string().min(1).max(32),
  source: z.enum(["pdf", "ki"]),
  regenerate: z.boolean().optional().default(false),
  fullAi: z.boolean().optional().default(true),
  voice: z.string().max(80).optional(),
}).strict();

export interface StockPodcastRouteError {
  ok: false;
  errorCode: StockPodcastErrorCode;
  error: string;
  stage: "analyze" | "script" | "audio";
  ticker?: string;
  source?: StockPodcastSource;
}

export function stockPodcastPackKey(ticker: string, day: string): string {
  return `spack:${ticker}:${day}`;
}

export interface StockPodcastHandlerDeps {
  now?: () => Date;
  llmAvailable?: () => boolean;
  fullAi?: typeof runFullAiAnalysis;
  llm?: StockPodcastLlm;
}

export function resetStockPodcastRouteState(): void {
  resetPodcastPackCache();
  resetPodcastDailyLimit();
  resetPodcastScriptCache();
}

function errorBody(
  errorCode: StockPodcastErrorCode,
  error: string,
  stage: StockPodcastRouteError["stage"],
  ticker?: string,
  source?: StockPodcastSource,
): StockPodcastRouteError {
  return { ok: false, errorCode, error, stage, ...(ticker ? { ticker } : {}), ...(source ? { source } : {}) };
}

function httpFor(code: StockPodcastErrorCode): number {
  switch (code) {
    case "RATE_LIMITED": return 429;
    case "KI_MODE_OFF": return 409;
    case "NO_API_KEY":
    case "LLM_UNAVAILABLE":
      return 503;
    default: {
      const _never: never = code;
      return _never;
    }
  }
}

function successBody(opts: {
  ticker: string;
  source: StockPodcastSource;
  pack: FullAiPack;
  packCached: boolean;
  script: Awaited<ReturnType<typeof renderStockPodcastScript>> & { ok: true };
}): StockPodcastScriptResponse {
  const voice = resolveStockPodcastVoice(opts.script.voice);
  return {
    ok: true,
    ticker: opts.ticker,
    source: opts.source,
    asOf: opts.script.asOf,
    asOfLabel: opts.script.asOfLabel,
    priceLabel: opts.script.priceLabel,
    cacheKey: opts.script.cacheKey,
    voice: voice.id,
    voiceLabel: voice.label,
    chapters: opts.script.chapters,
    cached: opts.script.cached,
    packCached: opts.packCached,
    promptVersion: PODCAST_PROMPT_VERSION,
    disclaimer: PODCAST_DISCLAIMER,
  };
}

export async function handleStockPodcastScript(
  raw: unknown,
  deps: StockPodcastHandlerDeps = {},
): Promise<{ http: number; body: StockPodcastScriptResponse | StockPodcastRouteError }> {
  const parsed = stockPodcastRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      http: 400,
      body: errorBody("LLM_UNAVAILABLE", `Ungültige Anfrage: ${first?.path.join(".") || "body"} ${first?.message ?? ""}`.trim().slice(0, 200), "script"),
    };
  }
  const ticker = parsed.data.ticker.toUpperCase();
  const source = parsed.data.source;
  const now = deps.now?.() ?? new Date();
  const day = madridDayKey(now);
  if (parsed.data.fullAi === false) {
    return {
      http: httpFor("KI_MODE_OFF"),
      body: errorBody("KI_MODE_OFF", "Die Voll-KI-Analyse ist für diesen Abruf aus. Sie startet nur auf Klick.", "analyze", ticker, source),
    };
  }
  const llmAvailable = deps.llmAvailable ?? isLLMAvailable;
  if (!llmAvailable()) {
    return {
      http: httpFor("NO_API_KEY"),
      body: errorBody("NO_API_KEY", OPENROUTER_NO_KEY_MESSAGE, "script", ticker, source),
    };
  }

  const regenerate = parsed.data.regenerate === true;
  const peeked = !regenerate ? peekPodcastPack(ticker, now) : null;
  let counted = false;
  let pack = peeked;
  let packCached = !!peeked;
  if (!pack) {
    if (!podcastDailyTake(ticker, now)) {
      return { http: httpFor("RATE_LIMITED"), body: errorBody("RATE_LIMITED", "Tageslimit erreicht.", "analyze", ticker, source) };
    }
    counted = true;
    const fullAi = deps.fullAi ?? runFullAiAnalysis;
    const fullDeps: Partial<FullAiDeps> = { llmAvailable, now: () => now };
    const result = await fullAi(ticker, { regenerate, now, deps: fullDeps });
    if (!result.ok) {
      podcastDailyRefund(ticker, now);
      return { http: httpFor(result.errorCode), body: { ...result, ticker, source } };
    }
    pack = result.pack;
    packCached = result.packCached;
  }
  if (regenerate) dropPodcastScripts(ticker, day);

  const facts = buildPodcastFacts(pack, now);
  const factsHash = hashPodcastFacts(facts.values);
  const voice = resolveStockPodcastVoice(parsed.data.voice);
  const scriptHit = !regenerate ? readCachedScript({ ticker, day: pack.day, source, factsHash, voiceId: voice.id }) : null;
  if (scriptHit) {
    return {
      http: 200,
      body: successBody({
        ticker,
        source,
        pack,
        packCached,
        script: {
          ok: true,
          cacheKey: scriptHit.entry.cacheKey,
          chapters: scriptHit.chapters,
          asOf: scriptHit.entry.asOf,
          asOfLabel: scriptHit.entry.asOfLabel,
          priceLabel: scriptHit.entry.priceLabel,
          voice: voice.id,
          voiceLabel: voice.label,
          cached: true,
          modelUsed: scriptHit.entry.modelUsed,
          facts,
        },
      }),
    };
  }
  if (!counted && !podcastDailyTake(ticker, now)) {
    return { http: httpFor("RATE_LIMITED"), body: errorBody("RATE_LIMITED", "Tageslimit erreicht.", "script", ticker, source) };
  }
  counted = true;
  const llm = deps.llm ?? callLLMJson;
  const rendered = await renderStockPodcastScript({ pack, source, voiceId: voice.id, llm, now });
  if (!rendered.ok) {
    podcastDailyRefund(ticker, now);
    return {
      http: httpFor("LLM_UNAVAILABLE"),
      body: errorBody("LLM_UNAVAILABLE", "KI-Podcast n/a — LLM nicht erreichbar.", "script", ticker, source),
    };
  }
  return { http: 200, body: successBody({ ticker, source, pack, packCached, script: rendered }) };
}

export function registerStockPodcastRoute(app: Express, deps?: StockPodcastHandlerDeps): void {
  app.post("/api/podcast/script", async (req: Request, res: Response) => {
    const out = await handleStockPodcastScript(req.body, deps);
    res.status(out.http).json(out.body);
  });
}
