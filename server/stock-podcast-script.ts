/**
 * Ein callLLMJson je Quelle für das Faktenblatt-Skript.
 * Ein kaputtes Kapitel wird höchstens zweimal neu geschrieben, im selben Zeitbudget.
 * Ein kurzer Fehlversuch des ersten Calls wird einmal wiederholt, ohne das Tageslimit ein zweites Mal zu zählen.
 * Das Skript ist stimmunabhängig. Die Audiodatei hängt zusätzlich an der Stimme und der Sprache.
 */
import type { PodcastChapterReport, PodcastDropCounts, PodcastLanguage, StockPodcastChapter, StockPodcastSource } from "../shared/podcast-types";
import { PODCAST_DISCLAIMER, PODCAST_DISCLAIMER_EN, PODCAST_PROMPT_VERSION, PODCAST_STAGE_TIMEOUT_MS, resolveStockPodcastVoice, stockPodcastAudioPath } from "../shared/podcast-types";
import { buildPodcastFacts, hashPodcastFacts, type PodcastFacts } from "../shared/podcast-facts";
import { applyRedo, applyTitleMap, brokenDrafts, buildSpeechSheet, chaptersFromDrafts, fluentPrompt, readTitleMap, seedDrafts, titlePrompt } from "../shared/podcast-fluent";
import type { LlmFailureReason } from "./llm-openrouter";
import type { FullAiPack } from "./stock-podcast-full-ai";
import { withStageTimeout } from "./stock-podcast-limit";

export interface StockPodcastLlm {
  (opts: {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<{ data: any; modelUsed: string | null; reason?: LlmFailureReason } | null>;
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
  dropped: PodcastDropCounts;
  language: PodcastLanguage;
  reports: PodcastChapterReport[];
}

const scriptCache = new Map<string, ScriptCacheEntry>();

export function resetPodcastScriptCache(): void {
  scriptCache.clear();
}

export function scriptCacheId(ticker: string, day: string, source: StockPodcastSource, factsHash: string, language: PodcastLanguage = "de"): string {
  return `sps:${ticker}:${day}:${source}:${language}:${PODCAST_PROMPT_VERSION}:${factsHash.slice(0, 16)}`;
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
      language: entry.language,
    }),
  }));
}

export function readCachedScript(opts: {
  ticker: string;
  day: string;
  source: StockPodcastSource;
  factsHash: string;
  voiceId: string;
  language?: PodcastLanguage;
}): { entry: ScriptCacheEntry; chapters: StockPodcastChapter[] } | null {
  const cacheKey = scriptCacheId(opts.ticker, opts.day, opts.source, opts.factsHash, opts.language ?? "de");
  const entry = peekPodcastScript(cacheKey);
  if (!entry || entry.day !== opts.day || entry.factsHash !== opts.factsHash) return null;
  return { entry, chapters: stampVoice(entry, opts.voiceId) };
}

export async function renderStockPodcastScript(opts: {
  pack: FullAiPack;
  source: StockPodcastSource;
  voiceId?: string;
  language?: PodcastLanguage;
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
  dropped: PodcastDropCounts;
  facts: PodcastFacts;
  language: PodcastLanguage;
  reports: PodcastChapterReport[];
} | { ok: false; reason: "timeout" | "empty" }> {
  const language = opts.language ?? "de";
  const voice = resolveStockPodcastVoice(opts.voiceId, language);
  const facts = buildPodcastFacts(opts.pack, opts.now ?? new Date());
  const factsHash = hashPodcastFacts(facts.values);
  const cacheKey = scriptCacheId(opts.pack.ticker, opts.pack.day, opts.source, factsHash, language);
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
      language: cached.language,
      reports: cached.reports,
    };
  }
  const sheet = buildSpeechSheet(facts, language);
  const started = Date.now();
  const budget = PODCAST_STAGE_TIMEOUT_MS.script;
  if (sheet.pendingTitles.length) {
    const titleLeft = budget - (Date.now() - started);
    if (titleLeft > 1500) {
      const titles = titlePrompt(sheet);
      const titleAc = new AbortController();
      const translated = await withStageTimeout(opts.llm({
        prompt: titles.prompt,
        systemPrompt: titles.systemPrompt,
        maxTokens: 400,
        temperature: 0,
        signal: titleAc.signal,
      }), Math.min(8000, titleLeft - 1000));
      if (translated === "timeout") titleAc.abort();
      else if (translated && translated.data) applyTitleMap(sheet, readTitleMap(translated.data));
    }
  }
  const prompt = fluentPrompt(sheet, opts.source);
  const ac = new AbortController();
  const ask = () => opts.llm({
    prompt: prompt.prompt,
    systemPrompt: prompt.systemPrompt,
    maxTokens: 1500,
    temperature: 0.2,
    signal: ac.signal,
  });
  let raced = await withStageTimeout(ask(), budget);
  const retryable = raced != null && raced !== "timeout" && raced.data == null
    && (raced.reason === "http" || raced.reason === "network");
  if (retryable) raced = await withStageTimeout(ask(), budget - (Date.now() - started));
  if (raced === "timeout") {
    ac.abort();
    return { ok: false, reason: "timeout" };
  }
  if (raced == null || raced.data == null) return { ok: false, reason: "empty" };
  let drafts = seedDrafts(sheet, opts.source, raced.data);
  let regens = 0;
  while (regens < 2 && brokenDrafts(drafts).length) {
    const left = budget - (Date.now() - started);
    const brokenIds = new Set(brokenDrafts(drafts).map(draft => draft.id));
    if (left < 500) {
      drafts = drafts.map(draft => brokenIds.has(draft.id) ? { ...draft, reasons: ["timeout"] } : draft);
      break;
    }
    regens += 1;
    const redo = fluentPrompt(sheet, opts.source, brokenDrafts(drafts).map(draft => ({ id: draft.id, reasons: draft.reasons })));
    const redoAc = new AbortController();
    const edited = await withStageTimeout(opts.llm({
      prompt: redo.prompt,
      systemPrompt: redo.systemPrompt,
      maxTokens: 1500,
      temperature: 0.2,
      signal: redoAc.signal,
    }), left);
    if (edited === "timeout" || edited == null || edited.data == null) {
      if (edited === "timeout") redoAc.abort();
      drafts = drafts.map(draft => brokenIds.has(draft.id) ? { ...draft, reasons: ["timeout"] } : draft);
      break;
    }
    drafts = applyRedo(sheet, drafts, edited.data);
  }
  const assembled = chaptersFromDrafts(sheet, opts.source, drafts);
  const chapters = assembled.chapters;
  const disclaimer = language === "en" ? PODCAST_DISCLAIMER_EN : PODCAST_DISCLAIMER;
  if (!chapters.length) return { ok: false, reason: "empty" };
  if (!chapters.some(c => c.id === "schluss" && c.spoken.includes(disclaimer))) {
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
    language,
    reports: assembled.reports,
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
    language,
    reports: assembled.reports,
  };
}
