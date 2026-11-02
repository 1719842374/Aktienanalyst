/**
 * Ein Lauf: Quellen → Ranking → Prompt → bestehendes callLLMJson → Audio-Adapter.
 */
import type { PodcastAudioAdapter, PodcastAudioResult } from "./podcast-audio";
import { rankPodcastDrivers, type PodcastGap, type RankedDriver } from "./podcast-drivers";
import { podcastScriptFromLlm, type PodcastNote, type PodcastScript } from "./podcast-prompt";
import { buildPodcastPrompt } from "./podcast-prompt";
import type { PodcastCollected } from "./podcast-sources";
import { OPENROUTER_NO_KEY_MESSAGE } from "../shared/openrouter-no-key";

export interface PodcastProgressStep {
  step: string;
  status: string;
  detail?: string;
}

export interface PodcastProbeResult {
  drivers: RankedDriver[];
  gaps: PodcastGap[];
  notes: PodcastNote[];
  script: PodcastScript | null;
  scriptStatus: string;
  audio: PodcastAudioResult;
  progress: PodcastProgressStep[];
  modelUsed: string | null;
}

/** Ergebnis des Transkript-Caches. stored bleibt false, wenn der Text abgelehnt wurde. */
export interface PodcastCacheWrite {
  stored: boolean;
  reason: string | null;
}

/** Derselbe Satz wie im Chat, Quelle shared/openrouter-no-key.ts. */
export const PODCAST_NO_KEY_MESSAGE = OPENROUTER_NO_KEY_MESSAGE;

function llmDetailOf(
  llm: { data: unknown; modelUsed?: string } | null,
  parsed: { status: string; reason: string },
): string {
  if (parsed.status === "ok") return llm?.modelUsed ?? "ok";
  const used = llm?.modelUsed;
  if (typeof used === "string" && (used.startsWith("n/a —") || used === PODCAST_NO_KEY_MESSAGE)) return used;
  return parsed.reason;
}

export async function runPodcastProbe(deps: {
  collect: () => Promise<PodcastCollected>;
  llm: (prompt: string) => Promise<{ data: unknown; modelUsed?: string } | null>;
  audio: PodcastAudioAdapter;
  today: string;
  /** Schreibt spokenScript in den lokalen Transkript-Cache. Ohne Schreiber bleibt der Schritt n/a. */
  remember?: (text: string) => PodcastCacheWrite;
}): Promise<PodcastProbeResult> {
  const progress: PodcastProgressStep[] = [];
  const collected = await deps.collect();
  progress.push({
    step: "sources",
    status: collected.series.length ? "ok" : "n/a",
    detail: `${collected.series.length} Reihen, ${collected.gaps.length} Lücken`,
  });

  const ranked = rankPodcastDrivers(collected.series);
  const gaps = [...collected.gaps, ...ranked.skipped];
  progress.push({
    step: "rank",
    status: ranked.drivers.length ? "ok" : "n/a",
    detail: `${ranked.drivers.length} Treiber`,
  });

  const prompt = buildPodcastPrompt({
    today: deps.today,
    drivers: ranked.drivers,
    gaps,
    notes: collected.notes,
  });
  let llm: { data: unknown; modelUsed?: string } | null = null;
  try {
    llm = await deps.llm(prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Aufruf fehlgeschlagen";
    llm = { data: null, modelUsed: `n/a — ${message}` };
  }
  const parsed = podcastScriptFromLlm(llm?.data ?? null);
  const llmDetail = llmDetailOf(llm, parsed);
  progress.push({
    step: "llm",
    status: parsed.status === "ok" ? "ok" : "n/a",
    detail: llmDetail,
  });

  const spoken = parsed.script?.spokenScript ?? "";
  const audio = await deps.audio.synthesize(spoken);
  progress.push({
    step: "audio",
    status: audio.status,
    detail: audio.reason,
  });

  const remembered = spoken.trim()
    ? (deps.remember?.(spoken) ?? { stored: false, reason: "n/a — Pipeline ohne Cache-Schreiber" })
    : { stored: false, reason: "n/a — kein Skript zum Speichern" };
  progress.push({
    step: "cache",
    status: remembered.stored ? "ok" : "n/a",
    detail: remembered.stored ? "Transkript im lokalen Cache" : (remembered.reason ?? "n/a — nicht gespeichert"),
  });

  return {
    drivers: ranked.drivers,
    gaps,
    notes: collected.notes,
    script: parsed.script,
    scriptStatus: parsed.status === "ok" ? "ok" : llmDetail,
    audio,
    progress,
    modelUsed: llm?.modelUsed ?? null,
  };
}
