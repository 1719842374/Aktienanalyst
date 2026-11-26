/**
 * TTS für den Aktien-Podcast.
 * Primär OpenRouter POST /api/v1/audio/speech mit dem bestehenden OPENROUTER_API_KEY.
 * Belegt: https://openrouter.ai/docs/guides/overview/multimodal/tts
 *         https://openrouter.ai/docs/api/api-reference/tts/create-speech
 *         https://openrouter.ai/microsoft/mai-voice-2.1
 * xAI nur, wenn XAI_API_KEY gesetzt ist. Ohne diesen Key kein xAI-Call.
 */
import { createHash } from "node:crypto";
import {
  OPENROUTER_TTS_MODEL,
  OPENROUTER_TTS_URL,
  XAI_TTS_URL,
  type StockPodcastErrorCode,
  resolveStockPodcastVoice,
} from "../shared/podcast-types";

export interface PodcastAudioEnv {
  openrouterKey?: string;
  xaiKey?: string;
}

export type PodcastAudioFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  bytes: () => Promise<Uint8Array>;
}>;

const audioCache = new Map<string, { audio: Buffer; provider: "openrouter" | "xai" }>();

export function resetPodcastAudioCache(): void {
  audioCache.clear();
}

export function podcastAudioCacheId(parts: {
  ticker: string;
  day: string;
  source: string;
  voice: string;
  chapterId: string;
  spoken: string;
}): string {
  const textHash = createHash("sha256").update(parts.spoken).digest("hex").slice(0, 16);
  return ["spa", parts.ticker, parts.day, parts.source, parts.voice, parts.chapterId, textHash].join("|");
}

function defaultEnv(): PodcastAudioEnv {
  return {
    openrouterKey: process.env.OPENROUTER_API_KEY || "",
    xaiKey: process.env.XAI_API_KEY || "",
  };
}

async function readBytes(res: { ok: boolean; status: number; bytes: () => Promise<Uint8Array> }): Promise<Buffer | null> {
  if (!res.ok) return null;
  const raw = await res.bytes();
  if (!raw || raw.byteLength < 8) return null;
  return Buffer.from(raw);
}

async function openRouterSpeech(text: string, voice: string, key: string, fetchImpl: PodcastAudioFetch, signal?: AbortSignal): Promise<Buffer | null> {
  const res = await fetchImpl(OPENROUTER_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_TTS_MODEL,
      input: text,
      voice,
      response_format: "mp3",
    }),
    signal,
  });
  return readBytes(res);
}

async function xaiSpeech(text: string, voiceId: string, key: string, fetchImpl: PodcastAudioFetch, signal?: AbortSignal, language: "de" | "en" = "de"): Promise<Buffer | null> {
  const res = await fetchImpl(XAI_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      language,
    }),
    signal,
  });
  return readBytes(res);
}

export async function synthesizePodcastAudio(opts: {
  text: string;
  voiceId?: string;
  language?: "de" | "en";
  cacheId: string;
  env?: PodcastAudioEnv;
  fetchImpl?: PodcastAudioFetch;
  timeoutMs?: number;
}): Promise<
  | { ok: true; audio: Buffer; provider: "openrouter" | "xai"; cached: boolean }
  | { ok: false; errorCode: StockPodcastErrorCode; error: string }
> {
  const cached = audioCache.get(opts.cacheId);
  if (cached) return { ok: true, audio: cached.audio, provider: cached.provider, cached: true };
  const text = opts.text.trim();
  if (!text) return { ok: false, errorCode: "LLM_UNAVAILABLE", error: "KI-Podcast n/a — LLM nicht erreichbar." };
  if (text.length > 8000) return { ok: false, errorCode: "LLM_UNAVAILABLE", error: "KI-Podcast n/a — LLM nicht erreichbar." };
  const env = opts.env ?? defaultEnv();
  const voice = resolveStockPodcastVoice(opts.voiceId);
  const openrouterKey = env.openrouterKey?.trim() ?? "";
  const xaiKey = env.xaiKey?.trim() ?? "";
  if (!openrouterKey && !xaiKey) {
    return {
      ok: false,
      errorCode: "NO_API_KEY",
      error: "KI nicht verfügbar: Auf diesem Server ist kein OpenRouter-Key konfiguriert. Es wird keine Antwort erzeugt.",
    };
  }
  const fetchImpl = opts.fetchImpl ?? (async (url, init) => {
    const res = await fetch(url, init);
    return { ok: res.ok, status: res.status, bytes: async () => new Uint8Array(await res.arrayBuffer()) };
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 45_000);
  try {
    let audio: Buffer | null = null;
    let provider: "openrouter" | "xai" = "openrouter";
    const speechLanguage = opts.language ?? "de";
    if (voice.provider === "openrouter" && openrouterKey) {
      audio = await openRouterSpeech(text, voice.id, openrouterKey, fetchImpl, ac.signal);
      if (!audio && xaiKey) {
        audio = await xaiSpeech(text, "eve", xaiKey, fetchImpl, ac.signal, speechLanguage);
        provider = "xai";
      }
    } else if (xaiKey) {
      const xaiVoice = voice.provider === "xai" ? voice.id : "eve";
      audio = await xaiSpeech(text, xaiVoice, xaiKey, fetchImpl, ac.signal, speechLanguage);
      provider = "xai";
    }
    if (!audio) {
      return { ok: false, errorCode: "LLM_UNAVAILABLE", error: "KI-Podcast n/a — LLM nicht erreichbar." };
    }
    audioCache.set(opts.cacheId, { audio, provider });
    console.log(`[PODCAST-TTS] ${provider} ${audio.length} bytes`);
    return { ok: true, audio, provider, cached: false };
  } catch {
    return { ok: false, errorCode: "LLM_UNAVAILABLE", error: "KI-Podcast n/a — LLM nicht erreichbar." };
  } finally {
    clearTimeout(timer);
  }
}
