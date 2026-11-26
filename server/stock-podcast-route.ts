/**
 * POST /api/podcast/script — Aktien-Podcast, neben der Markt-Route.
 * Dieser Stand erzeugt und cacht den Voll-KI-Pack. Das Transkript und das Audio
 * hängen in den folgenden Einheiten an derselben Route.
 * Kein Schreibzugriff auf Score, Rating, Entry oder den Analyze-UI-Cache.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { OPENROUTER_NO_KEY_MESSAGE } from "../shared/openrouter-no-key";
import type { StockPodcastErrorCode, StockPodcastSource } from "../shared/podcast-types";
import { isLLMAvailable } from "./llm-openrouter";
import {
  peekPodcastPack,
  resetPodcastPackCache,
  runFullAiAnalysis,
  type FullAiDeps,
  type FullAiPack,
} from "./stock-podcast-full-ai";
import {
  madridDateLabel,
  madridDayKey,
  podcastDailyRefund,
  podcastDailyTake,
  resetPodcastDailyLimit,
} from "./stock-podcast-limit";

export const stockPodcastRequestSchema = z.object({
  ticker: z.string().min(1).max(32),
  source: z.enum(["pdf", "ki"]),
  regenerate: z.boolean().optional().default(false),
  fullAi: z.boolean().optional().default(true),
  voice: z.string().max(80).optional(),
}).strict();

export interface StockPodcastPackBody {
  ok: true;
  ticker: string;
  source: StockPodcastSource;
  stage: "analyze";
  asOf: string;
  asOfLabel: string;
  cacheKey: string;
  packCached: boolean;
  sections: FullAiPack["sections"];
  timedOut: FullAiPack["timedOut"];
}

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

export function resetStockPodcastRouteState(): void {
  resetPodcastPackCache();
  resetPodcastDailyLimit();
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

export interface StockPodcastHandlerDeps {
  now?: () => Date;
  llmAvailable?: () => boolean;
  fullAi?: typeof runFullAiAnalysis;
}

export async function handleStockPodcastScript(
  raw: unknown,
  deps: StockPodcastHandlerDeps = {},
): Promise<{ http: number; body: StockPodcastPackBody | StockPodcastRouteError }> {
  const parsed = stockPodcastRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      http: 400,
      body: {
        ok: false,
        errorCode: "LLM_UNAVAILABLE",
        error: `Ungültige Anfrage: ${first?.path.join(".") || "body"} ${first?.message ?? ""}`.trim().slice(0, 200),
        stage: "analyze",
      },
    };
  }
  const ticker = parsed.data.ticker.toUpperCase();
  const source = parsed.data.source;
  const now = deps.now?.() ?? new Date();
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
      body: errorBody("NO_API_KEY", OPENROUTER_NO_KEY_MESSAGE, "analyze", ticker, source),
    };
  }

  const day = madridDayKey(now);
  const cached = !parsed.data.regenerate && peekPodcastPack(ticker, now);
  if (!cached && !podcastDailyTake(ticker, now)) {
    return {
      http: httpFor("RATE_LIMITED"),
      body: errorBody("RATE_LIMITED", "Tageslimit erreicht.", "analyze", ticker, source),
    };
  }

  const fullAi = deps.fullAi ?? runFullAiAnalysis;
  const fullDeps: Partial<FullAiDeps> = { llmAvailable, now: () => now };
  const result = await fullAi(ticker, { regenerate: parsed.data.regenerate, now, deps: fullDeps });
  if (!result.ok) {
    if (!cached) podcastDailyRefund(ticker, now);
    return { http: httpFor(result.errorCode), body: { ...result, ticker, source } };
  }
  const body: StockPodcastPackBody = {
    ok: true,
    ticker,
    source,
    stage: "analyze",
    asOf: day,
    asOfLabel: madridDateLabel(now),
    cacheKey: stockPodcastPackKey(ticker, day),
    packCached: result.packCached,
    sections: result.pack.sections,
    timedOut: result.pack.timedOut,
  };
  return { http: 200, body };
}

export function registerStockPodcastRoute(app: Express, deps?: StockPodcastHandlerDeps): void {
  app.post("/api/podcast/script", async (req: Request, res: Response) => {
    const out = await handleStockPodcastScript(req.body, deps);
    res.status(out.http).json(out.body);
  });
}
