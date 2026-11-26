/**
 * Vertrag des Aktien-Podcasts für den UI-PR.
 * Der Markt-Podcast (shared/podcast-transcript.ts) bleibt ein anderer Cache.
 */

export const STOCK_PODCAST_ERROR_CODES = ["NO_API_KEY", "LLM_UNAVAILABLE", "RATE_LIMITED", "KI_MODE_OFF", "BAD_REQUEST"] as const;
export type StockPodcastErrorCode = (typeof STOCK_PODCAST_ERROR_CODES)[number];

export type StockPodcastSource = "pdf" | "ki";

export type StockPodcastStage = "analyze" | "script" | "audio";

/**
 * Obergrenze neuer Erzeugungen je Ticker bis Mitternacht Europe/Madrid.
 * Cache-Treffer zählen nicht. PDF und KI-Analyse teilen sich dieses Limit.
 */
export const PODCAST_DAILY_MAX = 2;

export const PODCAST_PROMPT_VERSION = "stock-podcast-v10";

export const PODCAST_DISCLAIMER = "Dies ist keine Anlageberatung.";

export const PODCAST_STAGE_TIMEOUT_MS = {
  analyze: 180_000,
  supplement: 90_000,
  script: 30_000,
  audio: 45_000,
} as const;

/** Belegt: https://openrouter.ai/docs/guides/overview/multimodal/tts und https://openrouter.ai/microsoft/mai-voice-2.1 */
export const OPENROUTER_TTS_MODEL = "microsoft/mai-voice-2.1";
export const OPENROUTER_TTS_URL = "https://openrouter.ai/api/v1/audio/speech";

export const XAI_TTS_URL = "https://api.x.ai/v1/tts";

export const OPENROUTER_PODCAST_VOICES = [
  { id: "de-DE-Mia:MAI-Voice-2.1", label: "Mia" },
  { id: "de-DE-Klaus:MAI-Voice-2.1", label: "Klaus" },
  { id: "de-DE-Harper:MAI-Voice-2.1", label: "Harper" },
  { id: "de-DE-Grant:MAI-Voice-2.1", label: "Grant" },
] as const;

export const XAI_PODCAST_VOICES = [
  { id: "eve", label: "Eve" },
  { id: "leo", label: "Leo" },
  { id: "ara", label: "Ara" },
] as const;

export const DEFAULT_PODCAST_VOICE_ID = OPENROUTER_PODCAST_VOICES[0].id;

export interface StockPodcastVoice {
  id: string;
  label: string;
  provider: "openrouter" | "xai";
}

export function listStockPodcastVoices(): StockPodcastVoice[] {
  return [
    ...OPENROUTER_PODCAST_VOICES.map(v => ({ id: v.id, label: v.label, provider: "openrouter" as const })),
    ...XAI_PODCAST_VOICES.map(v => ({ id: v.id, label: v.label, provider: "xai" as const })),
  ];
}

export function resolveStockPodcastVoice(voiceId: string | undefined): StockPodcastVoice {
  const wanted = (voiceId ?? "").trim();
  const found = listStockPodcastVoices().find(v => v.id === wanted);
  if (found) return found;
  const def = OPENROUTER_PODCAST_VOICES[0];
  return { id: def.id, label: def.label, provider: "openrouter" };
}

export interface StockPodcastChapter {
  id: string;
  title: string;
  label: string;
  template: string;
  spoken: string;
  durationSec: number;
  llmOwned: boolean;
  audioUrl: string | null;
}

export interface StockPodcastStageTiming {
  elapsedMs: number;
  timeoutMs: number;
}

/** Sichtbare Stufen-Laufzeiten. Audio-Timeout steht hier, die Messung folgt dem GET. */
export interface StockPodcastStageTimings {
  analyze: StockPodcastStageTiming;
  script: StockPodcastStageTiming;
  audio: { timeoutMs: number };
}

export interface StockPodcastScriptResponse {
  ok: true;
  ticker: string;
  source: StockPodcastSource;
  asOf: string;
  asOfLabel: string;
  priceLabel: string | null;
  cacheKey: string;
  voice: string;
  voiceLabel: string;
  chapters: StockPodcastChapter[];
  cached: boolean;
  packCached: boolean;
  promptVersion: string;
  disclaimer: string;
  stages: StockPodcastStageTimings;
}

export interface StockPodcastErrorResponse {
  ok: false;
  errorCode: StockPodcastErrorCode;
  error: string;
  stage: StockPodcastStage;
  ticker?: string;
  source?: StockPodcastSource;
}

export function stockPodcastAudioPath(opts: {
  chapterId: string;
  ticker: string;
  source: StockPodcastSource;
  voice: string;
  cacheKey: string;
}): string {
  const q = new URLSearchParams({
    ticker: opts.ticker,
    source: opts.source,
    voice: opts.voice,
    cacheKey: opts.cacheKey,
  });
  return `/api/podcast/audio/${encodeURIComponent(opts.chapterId)}?${q.toString()}`;
}
