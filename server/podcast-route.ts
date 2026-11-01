/**
 * POST /api/podcast/brief — ein Klick, Key Driver und Skript.
 * Audio nur über den Adapter. Die Bewertungsroute wird nicht gelesen.
 */
import type { Express, Request, Response } from "express";
import { CHAT_LLM_TIMEOUT_MS } from "./chat-route";
import { CURSOR_VOICE_AUDIO_REASON, CursorVoiceAudioAdapter } from "./podcast-audio";
import { callLLMJson } from "./llm-openrouter";
import { runPodcastProbe } from "./podcast-pipeline";
import { collectPodcastInputs, defaultPodcastDeps } from "./podcast-sources";

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

export function registerPodcastRoute(app: Express): void {
  app.post("/api/podcast/brief", async (_req: Request, res: Response) => {
    try {
      const deps = await defaultPodcastDeps();
      const result = await runPodcastProbe({
        collect: () => collectPodcastInputs(deps),
        llm: (prompt) => callPodcastLlm(prompt, { invoke: (opts) => callLLMJson(opts) }),
        audio: new CursorVoiceAudioAdapter(),
        today: new Date().toISOString().slice(0, 10),
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
