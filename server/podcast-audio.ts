/**
 * Austauschbare Sprachausgabe.
 * Cursor Voice ist geprüft (Docs Stand 01.11.2026) und nicht angebunden:
 * es gibt keinen dokumentierten Aufruf, der Skripttext als Audio zurückgibt.
 * Kein neuer Anbieter, kein neues Env.
 */

export interface PodcastAudioResult {
  status: "ok" | "n/a";
  reason: string;
  audioUrl: string | null;
}

export interface PodcastAudioAdapter {
  readonly id: string;
  synthesize(script: string): Promise<PodcastAudioResult>;
}

export const CURSOR_VOICE_AUDIO_REASON =
  "n/a — Cursor Voice hat keine dokumentierte Sprachausgabe, die diese App aufrufen kann. Die Cursor-Docs beschreiben Spracheingabe im Chat (Mikrofon, Toggle Voice Mode) und Voice-Calls in der Cursor-App. Die öffentlichen APIs (Admin, Analytics, AI Code Tracking, Bugbot, Cloud Agents, Origin, TypeScript- und Python-SDK, HTTP /v1/session) synthetisieren keine Sprache. Es fehlt ein dokumentierter Endpoint, der Skripttext als Audio zurückgibt.";

export class CursorVoiceAudioAdapter implements PodcastAudioAdapter {
  readonly id = "cursor-voice";

  async synthesize(_script: string): Promise<PodcastAudioResult> {
    return { status: "n/a", reason: CURSOR_VOICE_AUDIO_REASON, audioUrl: null };
  }
}

export type TtsProviderStatus = { provider: string; providerLabel: string; server: boolean; reason: string | null };

/**
 * Meldet, wer das Skript spricht: die Server-Stimme (/api/tts, Default Piper) oder,
 * wenn sie fehlt, die Browser-Stimme. Das Audio entsteht erst beim Abspielen im Player,
 * je Kapitel und gecacht; deshalb bleibt audioUrl hier null.
 */
export class TtsPlayerAudioAdapter implements PodcastAudioAdapter {
  readonly id = "tts-player";

  constructor(private readonly status: () => Promise<TtsProviderStatus>, private readonly browserLabel: string) {}

  async synthesize(script: string): Promise<PodcastAudioResult> {
    if (!script.trim()) return { status: "n/a", reason: "n/a — kein Skript zum Vorlesen", audioUrl: null };
    const s = await this.status();
    if (s.server) return { status: "ok", reason: `ok — ${s.providerLabel}`, audioUrl: null };
    return { status: "ok", reason: `ok — ${this.browserLabel}${s.reason ? ` · Server-Stimme: ${s.reason}` : ""}`, audioUrl: null };
  }
}
