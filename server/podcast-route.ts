/**
 * POST /api/podcast/brief — ein Klick, Key Driver und Skript.
 * Audio nur über den Adapter. Die Bewertungsroute wird nicht gelesen.
 */
import type { Express, Request, Response } from "express";
import { CURSOR_VOICE_AUDIO_REASON, CursorVoiceAudioAdapter } from "./podcast-audio";
import { callLLMJson } from "./llm-openrouter";
import { runPodcastProbe } from "./podcast-pipeline";
import { collectPodcastInputs, defaultPodcastDeps } from "./podcast-sources";

export const PODCAST_LLM_MAX_TOKENS = 2800;
export const PODCAST_LLM_TEMPERATURE = 0.3;

export function registerPodcastRoute(app: Express): void {
  app.post("/api/podcast/brief", async (_req: Request, res: Response) => {
    try {
      const deps = await defaultPodcastDeps();
      const result = await runPodcastProbe({
        collect: () => collectPodcastInputs(deps),
        llm: (prompt) => callLLMJson({
          prompt,
          maxTokens: PODCAST_LLM_MAX_TOKENS,
          temperature: PODCAST_LLM_TEMPERATURE,
        }),
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
