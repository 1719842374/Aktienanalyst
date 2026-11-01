/**
 * POST /api/podcast/brief — ein Klick, Key Driver und Skript.
 * Audio nur über den Adapter. Die Bewertungsroute wird nicht gelesen.
 */
import type { Express, Request, Response } from "express";
import { CHAT_LLM_TIMEOUT_MS } from "./chat-route";
import { CURSOR_VOICE_AUDIO_REASON, CursorVoiceAudioAdapter } from "./podcast-audio";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { PODCAST_NO_KEY_MESSAGE, runPodcastProbe } from "./podcast-pipeline";
import { collectPodcastInputs, collectPodcastSymbols, defaultPodcastDeps } from "./podcast-sources";
import { writePodcastTranscript } from "./podcast-transcript-route";
import { PODCAST_MARKET_SYMBOL } from "../shared/podcast-transcript";

export const PODCAST_LLM_MAX_TOKENS = 2800;
export const PODCAST_LLM_TEMPERATURE = 0.3;
/**
 * Dieselbe Decke wie der KI-Chat (CHAT_LLM_TIMEOUT_MS). Eine Antwort, danach
 * n/a. Liegt unter dem Client-Timeout des Podcast-Buttons.
 */
export const PODCAST_LLM_TIMEOUT_MS = CHAT_LLM_TIMEOUT_MS;

export async function callPodcastLlm(
  prompt: string,
  deps: {
    invoke: (opts: {
      prompt: string;
      maxTokens: number;
      temperature: number;
      signal: AbortSignal;
    }) => Promise<{ data: unknown; modelUsed: string } | null>;
    timeoutMs?: number;
  },
): Promise<{ data: unknown; modelUsed?: string } | null> {
  const timeoutMs = deps.timeoutMs ?? PODCAST_LLM_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const reason = `n/a — OpenRouter-Timeout nach ${timeoutMs} ms`;
  try {
    const result = await new Promise<{ data: unknown; modelUsed: string } | null>((resolve, reject) => {
      const onAbort = () => reject(Object.assign(new Error(reason), { name: "AbortError" }));
      if (controller.signal.aborted) {
        onAbort();
        return;
      }
      controller.signal.addEventListener("abort", onAbort, { once: true });
      deps.invoke({
        prompt,
        maxTokens: PODCAST_LLM_MAX_TOKENS,
        temperature: PODCAST_LLM_TEMPERATURE,
        signal: controller.signal,
      }).then(resolve, reject);
    });
    if (controller.signal.aborted) return { data: null, modelUsed: reason };
    return result;
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
    if (aborted) return { data: null, modelUsed: reason };
    const message = err instanceof Error ? err.message : "Aufruf fehlgeschlagen";
    return { data: null, modelUsed: `n/a — ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ohne Key kein OpenRouter-Call. Die Meldung ist die des Chats, nicht
 * „OpenRouter lieferte kein JSON“ — das gilt nur, wenn ein Key da ist und
 * trotzdem kein JSON zurückkommt.
 */
export async function podcastLlmCall(
  prompt: string,
  deps: {
    available: () => boolean;
    invoke: (opts: {
      prompt: string;
      maxTokens: number;
      temperature: number;
      signal: AbortSignal;
    }) => Promise<{ data: unknown; modelUsed: string } | null>;
    timeoutMs?: number;
  },
): Promise<{ data: unknown; modelUsed?: string } | null> {
  if (!deps.available()) return { data: null, modelUsed: PODCAST_NO_KEY_MESSAGE };
  return callPodcastLlm(prompt, deps);
}

export function registerPodcastRoute(app: Express): void {
  app.post("/api/podcast/brief", async (req: Request, res: Response) => {
    try {
      const symbols = collectPodcastSymbols(req.body);
      const deps = await defaultPodcastDeps(symbols);
      const result = await runPodcastProbe({
        collect: () => collectPodcastInputs(deps),
        llm: (prompt) => podcastLlmCall(prompt, {
          available: isLLMAvailable,
          invoke: (opts) => callLLMJson(opts),
        }),
        audio: new CursorVoiceAudioAdapter(),
        today: new Date().toISOString().slice(0, 10),
        remember: (text) => {
          const saved = writePodcastTranscript(PODCAST_MARKET_SYMBOL, text);
          return { stored: saved.text != null, reason: saved.reason };
        },
      });
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unbekannt";
      console.warn(`[PODCAST] ${message.slice(0, 200)}`);
      res.status(200).json({
        drivers: [],
        gaps: [{ channel: "pipeline", label: "Podcast", status: `n/a — ${message}` }],
        notes: [],
        script: null,
        scriptStatus: `n/a — ${message}`,
        audio: { status: "n/a", reason: CURSOR_VOICE_AUDIO_REASON, audioUrl: null },
        progress: [{ step: "pipeline", status: "n/a", detail: message }],
        modelUsed: null,
      });
    }
  });
}
