/**
 * Ein Lauf: Quellen → Ranking → Prompt → bestehendes callLLMJson → Audio-Adapter.
 */
import type { PodcastAudioAdapter, PodcastAudioResult } from "./podcast-audio";
import { rankPodcastDrivers, type PodcastGap, type RankedDriver } from "./podcast-drivers";
import { podcastScriptFromLlm, type PodcastNote, type PodcastScript } from "./podcast-prompt";
import { buildPodcastPrompt } from "./podcast-prompt";
import type { PodcastCollected } from "./podcast-sources";

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

export async function runPodcastProbe(deps: {
  collect: () => Promise<PodcastCollected>;
  llm: (prompt: string) => Promise<{ data: unknown; modelUsed?: string } | null>;
  audio: PodcastAudioAdapter;
  today: string;
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
  const timeoutReason = typeof llm?.modelUsed === "string" && llm.modelUsed.startsWith("n/a —")
    ? llm.modelUsed
    : null;
  const llmDetail = parsed.status === "ok" ? (llm?.modelUsed ?? "ok") : (timeoutReason ?? parsed.reason);
  progress.push({
    step: "llm",
    status: parsed.status === "ok" ? "ok" : "n/a",
    detail: llmDetail,
  });

  const audio = await deps.audio.synthesize(parsed.script?.spokenScript ?? "");
  progress.push({
    step: "audio",
    status: audio.status,
    detail: audio.status === "ok" ? "Audio liegt vor" : "kein dokumentierter Sprach-Endpoint",
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
