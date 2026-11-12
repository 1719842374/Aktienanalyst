/**
 * Researcher-Podcast (POST /api/podcast/brief) → Episode des gemeinsamen Players.
 * Kapitel: Einstieg (Hook + These), je Takeaway ein Treiber-Kapitel „Rang. Label“, Einordnung (Problem,
 * Implikation, Schluss). Fehlen die Felder, aber spokenScript ist da, wird das Skript ein Kapitel.
 */
import { PODCAST_MARKET_SYMBOL } from "./podcast-transcript";
import { sentencesOfParagraphs, type PlayerChapter, type PlayerEpisode } from "./podcast-player";

export interface ResearcherScriptLike {
  title: string;
  hook: string;
  thesis: string;
  takeaways: Array<{ driverId: string; text: string }>;
  problem: string;
  implication: string;
  close: string;
  spokenScript: string;
}

export interface ResearcherDriverLike {
  id: string;
  rank: number;
  label: string;
  source: string;
}

function chapter(id: string, title: string, parts: string[], sourceLabel: string | null): PlayerChapter {
  const sentences = parts.flatMap(p => sentencesOfParagraphs(p ?? ""));
  return {
    id, title, sourceLabel, sourceUrl: null,
    status: sentences.length ? "ok" : "n/a",
    reason: sentences.length ? null : "n/a — Abschnitt im Skript leer",
    sentences,
  };
}

export function researcherPodcastEpisode(script: ResearcherScriptLike, drivers: ResearcherDriverLike[], today: string | null): PlayerEpisode {
  const byId = new Map(drivers.map(d => [d.id, d]));
  const chapters: PlayerChapter[] = [chapter("intro", "Einstieg", [script.hook, script.thesis], null)];
  script.takeaways.forEach((t, i) => {
    const d = byId.get(t.driverId);
    const title = d ? `${d.rank}. ${d.label}` : `${i + 1}. ${t.driverId}`;
    chapters.push(chapter(`driver-${i + 1}`, title, [t.text], d?.source ?? null));
  });
  chapters.push(chapter("outro", "Einordnung & Schluss", [script.problem, script.implication, script.close], null));
  const playable = chapters.filter(c => c.status === "ok").length;
  const fallback = playable === 0 ? [chapter("script", "Skript", [script.spokenScript], null)] : chapters;
  return {
    id: PODCAST_MARKET_SYMBOL,
    title: script.title || "Key-Driver-Podcast",
    subtitle: `Researcher · Key Driver${today ? ` · ${today}` : ""} · KI-generiert im Research-Stil`,
    coverLabel: PODCAST_MARKET_SYMBOL,
    chapters: fallback,
  };
}
