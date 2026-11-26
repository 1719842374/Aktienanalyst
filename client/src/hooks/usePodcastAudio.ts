/**
 * Server-Stimme für eine Player-Episode.
 * Kette: PodcastPlayer → dieses Hook → apiRequest POST /api/tts/episode → server/tts-route → Piper → .cache/tts.
 * Solange der Auftrag läuft ("pending"), fragt das Hook im festen Takt nach. Bei "n/a" oder Fehler
 * bleibt der Grund sichtbar und der Player spricht mit der Browser-Stimme.
 */
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  BROWSER_PROVIDER_ID, BROWSER_PROVIDER_LABEL, PLAYER_PARAMS, playableChapters,
  type PlayerEpisode, type TtsEpisodeRequest, type TtsEpisodeStatus,
} from "@shared/podcast-player";

function browserNa(reason: string, total: number): TtsEpisodeStatus {
  return { status: "n/a", provider: BROWSER_PROVIDER_ID, providerLabel: BROWSER_PROVIDER_LABEL, reason, doneChapters: 0, totalChapters: total, chapters: [] };
}

export function usePodcastAudio(scope: TtsEpisodeRequest["scope"], episode: PlayerEpisode | null): TtsEpisodeStatus | null {
  const [status, setStatus] = useState<TtsEpisodeStatus | null>(null);
  const body = useMemo<TtsEpisodeRequest | null>(() => {
    if (!episode) return null;
    const chapters = playableChapters(episode).map(c => ({ id: c.id, sentences: c.sentences }));
    return chapters.length ? { scope, id: episode.id, chapters } : null;
  }, [scope, episode]);
  const key = body ? JSON.stringify(body) : "";

  useEffect(() => {
    if (!body) {
      setStatus(null);
      return;
    }
    let cancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const total = body.chapters.length;
    const poll = async () => {
      try {
        const res = await apiRequest("POST", "/api/tts/episode", body, PLAYER_PARAMS.ttsRequestTimeoutMs);
        const json = await res.json().catch(() => null) as TtsEpisodeStatus | { error?: string } | null;
        if (cancel) return;
        if (!res.ok || !json || typeof (json as TtsEpisodeStatus).status !== "string") {
          const err = json && "error" in json && json.error ? json.error : `HTTP ${res.status}`;
          setStatus(browserNa(`Server-Stimme nicht erreichbar (${err})`, total));
          return;
        }
        const next = json as TtsEpisodeStatus;
        setStatus(next);
        if (next.status === "pending") timer = setTimeout(() => { void poll(); }, PLAYER_PARAMS.ttsPollMs);
      } catch (err: unknown) {
        if (cancel) return;
        setStatus(browserNa(`Server-Stimme nicht erreichbar (${err instanceof Error ? err.message : "Abruf fehlgeschlagen"})`, total));
      }
    };
    setStatus(null);
    void poll();
    return () => {
      cancel = true;
      if (timer) clearTimeout(timer);
    };
  // body ist über key abgedeckt; ein neues Objekt mit gleichem Inhalt startet keinen neuen Auftrag.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return status;
}
