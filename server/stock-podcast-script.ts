/**
 * Genau ein callLLMJson je Quelle. Kein zweiter Versuch.
 * Das Skript ist stimmunabhängig. Die Audiodatei hängt zusätzlich an der Stimme.
 */
import type { StockPodcastChapter, StockPodcastSource } from "../shared/podcast-types";
import { PODCAST_DISCLAIMER, PODCAST_PROMPT_VERSION, PODCAST_STAGE_TIMEOUT_MS, resolveStockPodcastVoice, stockPodcastAudioPath } from "../shared/podcast-types";
import { buildPodcastFacts, hashPodcastFacts, type PodcastFacts } from "../shared/podcast-facts";
import { assemblePodcastChapters, buildPodcastLlmPrompt } from "../shared/podcast-script";
import type { FullAiPack } from "./stock-podcast-full-ai";
import { withStageTimeout } from "./stock-podcast-limit";

export interface StockPodcastLlm {
  (opts: {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<{ data: any; modelUsed: string } | null>;
}

interface ScriptCacheEntry {
  day: string;
  source: StockPodcastSource;
  cacheKey: string;
  factsHash: string;
  chapters: StockPodcastChapter[];
  asOf: string;
  asOfLabel: string;
  priceLabel: string | null;
  modelUsed: string | null;
  dropped: number;
}

const scriptCache = new Map<string, ScriptCacheEntry>();

export function resetPodcastScriptCache(): void {
  scriptCache.clear();
}

export function scriptCacheId(ticker: string, day: string, source: StockPodcastSource, factsHash: string): string {
  return `sps:${ticker}:${day}:${source}:${PODCAST_PROMPT_VERSION}:${factsHash.slice(0, 16)}`;
}

export function dropPodcastScripts(ticker: string, day: string): void {
  const prefix = `sps:${ticker.toUpperCase()}:${day}:`;
  for (const key of Array.from(scriptCache.keys())) {
    if (key.startsWith(prefix)) scriptCache.delete(key);
  }
}

export function peekPodcastScript(cacheKey: string): ScriptCacheEntry | null {
  return scriptCache.get(cacheKey) ?? null;
}

function stampVoice(entry: ScriptCacheEntry, voiceId: string): StockPodcastChapter[] {
  return entry.chapters.map(chapter => ({
    ...chapter,
    audioUrl: stockPodcastAudioPath({
      chapterId: chapter.id,
      ticker: entry.cacheKey.split(":")[1] ?? "",
      source: entry.source,
      voice: voiceId,
      cacheKey: entry.cacheKey,
    }),
  }));
}

export function readCachedScript(opts: {
  ticker: string;
  day: string;
  source: StockPodcastSource;
  factsHash: string;
  voiceId: string;
}): { entry: ScriptCacheEntry; chapters: StockPodcastChapter[] } | null {
  const cacheKey = scriptCacheId(opts.ticker, opts.day, opts.source, opts.factsHash);
  const entry = peekPodcastScript(cacheKey);
  if (!entry || entry.day !== opts.day || entry.factsHash !== opts.factsHash) return null;
  return { entry, chapters: stampVoice(entry, opts.voiceId) };
}

export async function renderStockPodcastScript(opts: {
  pack: FullAiPack;
  source: StockPodcastSource;
  voiceId?: string;
  llm: StockPodcastLlm;
  now?: Date;
}): Promise<{
  ok: true;
  cacheKey: string;
  chapters: StockPodcastChapter[];
  asOf: string;
  asOfLabel: string;
  priceLabel: string | null;
  voice: string;
  voiceLabel: string;
  cached: boolean;
  modelUsed: string | null;
  dropped: number;
  facts: PodcastFacts;
} | { ok: false; reason: "timeout" | "empty" }> {
  const voice = resolveStockPodcastVoice(opts.voiceId);
  const facts = buildPodcastFacts(opts.pack, opts.now ?? new Date());
  const factsHash = hashPodcastFacts(facts.values);
  const cacheKey = scriptCacheId(opts.pack.ticker, opts.pack.day, opts.source, factsHash);
  const cached = peekPodcastScript(cacheKey);
  if (cached && cached.factsHash === factsHash) {
    return {
      ok: true,
      cacheKey,
      chapters: stampVoice(cached, voice.id),
      asOf: cached.asOf,
      asOfLabel: cached.asOfLabel,
      priceLabel: cached.priceLabel,
      voice: voice.id,
      voiceLabel: voice.label,
      cached: true,
      modelUsed: cached.modelUsed,
      dropped: cached.dropped,
      facts,
    };
  }
  const prompt = buildPodcastLlmPrompt(opts.source, facts);
  const ac = new AbortController();
  const call = opts.llm({
    prompt: prompt.prompt,
    systemPrompt: prompt.systemPrompt,
    maxTokens: 1500,
    temperature: 0.2,
    signal: ac.signal,
  });
  const raced = await withStageTimeout(call, PODCAST_STAGE_TIMEOUT_MS.script);
  if (raced === "timeout") {
    ac.abort();
    return { ok: false, reason: "timeout" };
  }
  if (raced == null) return { ok: false, reason: "empty" };
  const modelData = raced.data ?? null;
  const assembled = assemblePodcastChapters(opts.source, facts, modelData);
  const chapters = assembled.map(chapter => ({
    ...chapter,
    audioUrl: null as string | null,
  }));
  if (!chapters.length) return { ok: false, reason: "empty" };
  if (!chapters.some(c => c.id === "schluss" && c.spoken.includes(PODCAST_DISCLAIMER))) {
    return { ok: false, reason: "empty" };
  }
  const entry: ScriptCacheEntry = {
    day: opts.pack.day,
    source: opts.source,
    cacheKey,
    factsHash,
    chapters,
    asOf: facts.asOfIso,
    asOfLabel: facts.asOfLabel,
    priceLabel: facts.priceLabel,
    modelUsed: raced.modelUsed ?? null,
    dropped: assembled.dropped,
  };
  scriptCache.set(cacheKey, entry);
  return {
    ok: true,
    cacheKey,
    chapters: stampVoice(entry, voice.id),
    asOf: entry.asOf,
    asOfLabel: entry.asOfLabel,
    priceLabel: entry.priceLabel,
    voice: voice.id,
    voiceLabel: voice.label,
    cached: false,
    modelUsed: entry.modelUsed,
    dropped: assembled.dropped,
    facts,
  };
}
