/**
 * POST /api/podcast/script und GET /api/podcast/audio/:chapterId
 * Aktien-Podcast neben der Markt-Route. Klick erzeugt den Voll-KI-Pack,
 * genau ein OpenRouter-Transkript und auf Abruf MP3 je Kapitel.
 * Kein Schreibzugriff auf Score, Rating, Entry oder den Analyze-UI-Cache.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { OPENROUTER_NO_KEY_MESSAGE } from "../shared/openrouter-no-key";
import {
  emptyDropCounts,
  PODCAST_DISCLAIMER,
  PODCAST_PROMPT_VERSION,
  PODCAST_STAGE_TIMEOUT_MS,
  type PodcastDropCounts,
  type StockPodcastErrorCode,
  type StockPodcastScriptResponse,
  type StockPodcastSource,
  type StockPodcastStageTimings,
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
  peekPodcastScript,
  readCachedScript,
  renderStockPodcastScript,
  resetPodcastScriptCache,
  type StockPodcastLlm,
} from "./stock-podcast-script";
import { podcastAudioCacheId, resetPodcastAudioCache, synthesizePodcastAudio, type PodcastAudioEnv, type PodcastAudioFetch } from "./stock-podcast-audio";

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
  audioEnv?: PodcastAudioEnv;
  fetchAudio?: PodcastAudioFetch;
}

export function resetStockPodcastRouteState(): void {
  resetPodcastPackCache();
  resetPodcastDailyLimit();
  resetPodcastScriptCache();
  resetPodcastAudioCache();
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
    case "BAD_REQUEST":
      return 400;
    default: {
      const _never: never = code;
      return _never;
    }
  }
}

function stageTimings(analyzeMs: number, scriptMs: number, dropped: PodcastDropCounts = emptyDropCounts()): StockPodcastStageTimings {
  return {
    analyze: { elapsedMs: analyzeMs, timeoutMs: PODCAST_STAGE_TIMEOUT_MS.analyze },
    script: { elapsedMs: scriptMs, timeoutMs: PODCAST_STAGE_TIMEOUT_MS.script, dropped },
    audio: { timeoutMs: PODCAST_STAGE_TIMEOUT_MS.audio },
  };
}

function successBody(opts: {
  ticker: string;
  source: StockPodcastSource;
  pack: FullAiPack;
  packCached: boolean;
  stages: StockPodcastStageTimings;
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
    stages: opts.stages,
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
      body: errorBody("BAD_REQUEST", `Ungültige Anfrage: ${first?.path.join(".") || "body"} ${first?.message ?? ""}`.trim().slice(0, 200), "script"),
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
  const analyzeStarted = Date.now();
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
  const analyzeMs = Date.now() - analyzeStarted;
  const scriptStarted = Date.now();

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
        stages: stageTimings(analyzeMs, Date.now() - scriptStarted, scriptHit.entry.dropped),
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
          dropped: scriptHit.entry.dropped ?? emptyDropCounts(),
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
  return { http: 200, body: successBody({ ticker, source, pack, packCached, stages: stageTimings(analyzeMs, Date.now() - scriptStarted, rendered.dropped), script: rendered }) };
}

export function registerStockPodcastRoute(app: Express, deps?: StockPodcastHandlerDeps): void {
  app.post("/api/podcast/script", async (req: Request, res: Response) => {
    const out = await handleStockPodcastScript(req.body, deps);
    res.status(out.http).json(out.body);
  });
  app.get("/api/podcast/audio/:chapterId", async (req: Request, res: Response) => {
    const out = await handleStockPodcastAudio({
      chapterId: String(req.params.chapterId ?? ""),
      ticker: req.query.ticker,
      source: req.query.source,
      voice: req.query.voice,
      cacheKey: req.query.cacheKey,
    }, deps);
    if (out.ok) {
      res.status(200);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.send(out.audio);
      return;
    }
    res.status(out.http).json(out.body);
  });
}

export async function handleStockPodcastAudio(
  query: { chapterId?: unknown; ticker?: unknown; source?: unknown; voice?: unknown; cacheKey?: unknown },
  deps: StockPodcastHandlerDeps = {},
): Promise<{ ok: true; audio: Buffer } | { ok: false; http: number; body: StockPodcastRouteError }> {
  const chapterId = typeof query.chapterId === "string" ? query.chapterId : "";
  const ticker = typeof query.ticker === "string" ? query.ticker.toUpperCase() : "";
  const source = query.source === "pdf" || query.source === "ki" ? query.source : null;
  const cacheKey = typeof query.cacheKey === "string" ? query.cacheKey : "";
  const voice = resolveStockPodcastVoice(typeof query.voice === "string" ? query.voice : undefined);
  if (!chapterId || !ticker || !source || !cacheKey) {
    return { ok: false, http: 400, body: errorBody("BAD_REQUEST", "Ungültige Audio-Anfrage.", "audio", ticker || undefined, source ?? undefined) };
  }
  const script = peekPodcastScript(cacheKey);
  const chapter = script?.chapters.find(c => c.id === chapterId);
  if (!script || !chapter) {
    return {
      ok: false,
      http: 404,
      body: errorBody("LLM_UNAVAILABLE", "KI-Podcast n/a — LLM nicht erreichbar.", "audio", ticker, source),
    };
  }
  const audio = await synthesizePodcastAudio({
    text: chapter.spoken,
    voiceId: voice.id,
    cacheId: podcastAudioCacheId({
      ticker,
      day: script.day,
      source,
      voice: voice.id,
      chapterId,
      spoken: chapter.spoken,
    }),
    env: deps.audioEnv,
    fetchImpl: deps.fetchAudio,
  });
  if (!audio.ok) return { ok: false, http: httpFor(audio.errorCode), body: errorBody(audio.errorCode, audio.error, "audio", ticker, source) };
  return { ok: true, audio: audio.audio };
}
