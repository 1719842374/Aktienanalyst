/**
 * Gemeinsames Modell des Podcast-Players (Section 2 und Researcher).
 * Eine Episode besteht aus Kapiteln, ein Kapitel aus Sätzen. Die Sätze sind
 * die Einheit für Sync-Highlight, Sprung und TTS. Kein Score, kein Schema.
 */

export const PLAYER_PARAMS = {
  /** Sprungweite der ±-Knöpfe. */
  skipSeconds: 15,
  /** Wählbare Geschwindigkeiten, erste ist Default. */
  speeds: [1, 1.5, 2] as const,
  /** Sleep-Timer in Minuten. "chapter" = Ende des laufenden Kapitels. */
  sleepMinutes: [15, 30, 45, 60] as const,
  /**
   * Sprechtempo für die Zeitschätzung, solange keine Audiodatei mit echter
   * Dauer vorliegt (Browser-Stimme). Deutsche Nachrichtensprecher liegen bei
   * etwa 130–160 Wörtern pro Minute; die Mitte ist der Schätzwert.
   */
  estimateWordsPerMinute: 145,
  /** Pause zwischen zwei Sätzen in der Schätzung, in Sekunden. */
  estimateSentencePauseSeconds: 0.35,
  /** Intervall, in dem der Client den TTS-Auftrag erneut abfragt. */
  ttsPollMs: 4000,
  /** Client-Timeout je TTS-Statusabfrage (die Synthese selbst läuft im Hintergrund). */
  ttsRequestTimeoutMs: 30_000,
  /** Aktualisierung von Fortschrittsbalken und Highlight während der Wiedergabe. */
  tickMs: 250,
  /** Namensteile, die bei Browser-Stimmen auf eine natürlichere (neuronale) Stimme hindeuten. */
  preferredVoiceHints: ["natural", "neural", "online", "google"] as const,
  /** Sprache der Browser-Stimme, wenn keine Server-Stimme bereitsteht. */
  speechLang: "de-DE",
  /** localStorage-Schlüssel der gewählten Browser-Stimme. */
  voiceStorageKey: "podcast-player-voice",
} as const;

export type PlayerSpeed = (typeof PLAYER_PARAMS.speeds)[number];
export type SleepChoice = "off" | "chapter" | (typeof PLAYER_PARAMS.sleepMinutes)[number];

export interface PlayerChapter {
  id: string;
  title: string;
  status: "ok" | "n/a";
  /** Grund bei n/a, sonst null. */
  reason: string | null;
  /** Gesprochene Sätze in Reihenfolge. Leer bei n/a. */
  sentences: string[];
  sourceLabel: string | null;
  sourceUrl: string | null;
}

export interface PlayerEpisode {
  /** Ticker oder Researcher-Kennung. Teil des TTS-Cache-Schlüssels. */
  id: string;
  title: string;
  subtitle: string;
  /** Kurzlabel auf dem generierten Cover (Ticker oder „MARKT“). */
  coverLabel: string;
  chapters: PlayerChapter[];
}

/** Satzgrenzen an . ! ? … gefolgt von Leerraum und Großbuchstabe, Ziffer oder Anführung. Zahlen wie „77,7“ bleiben ganz. */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = clean.split(/(?<=[.!?…])\s+(?=["„»(A-ZÄÖÜ0-9])/).map(p => p.trim()).filter(Boolean);
  const merged: string[] = [];
  for (const p of parts) {
    const prev = merged[merged.length - 1];
    const ordinal = prev != null && (ORDINAL_ONLY.test(prev) || (ORDINAL_DAY_END.test(prev) && MONTH_START.test(p)));
    if (prev && (SENTENCE_ABBREVIATIONS.test(prev) || ordinal)) merged[merged.length - 1] = `${prev} ${p}`;
    else merged.push(p);
  }
  return merged;
}

/** „bis zum 30. September“ und „3. Platz“: Ordinalzahl mit Punkt ist kein Satzende. */
const ORDINAL_ONLY = /^\d{1,2}\.$/;
const ORDINAL_DAY_END = /(?:^|\s)\d{1,2}\.$/;
const MONTH_START = /^(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/;

/** Abkürzungen mit Punkt, nach denen kein Satz endet (Finanz- und Firmentexte). */
const SENTENCE_ABBREVIATIONS = /(?:^|\s)(?:Mrd|Mio|Tsd|Nr|Dr|Prof|ca|bzw|vgl|z\.\s?B|u\.\s?a|d\.\s?h|inkl|exkl|Inc|Corp|Co|Ltd|St|Mr|Mrs|Ms|Jan|Feb|Mär|Apr|Jun|Jul|Aug|Sep|Sept|Okt|Nov|Dez|U\.S|v\.\s?a)\.$/;

/** Absätze (Leerzeile) → Sätze, Absatzgrenzen zählen als Satzgrenze. */
export function sentencesOfParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).flatMap(p => splitSentences(p));
}

export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/** Geschätzte Sprechdauer eines Satzes bei 1x in Millisekunden. */
export function estimateSentenceMs(sentence: string): number {
  const words = wordCount(sentence);
  const speak = (words / PLAYER_PARAMS.estimateWordsPerMinute) * 60_000;
  return Math.round(speak + PLAYER_PARAMS.estimateSentencePauseSeconds * 1000);
}

export function playableChapters(episode: PlayerEpisode): PlayerChapter[] {
  return episode.chapters.filter(c => c.status === "ok" && c.sentences.length > 0);
}

/**
 * Sprechform eines Satzes für Server- und Browser-Stimme. Das Transkript zeigt weiter den Originalsatz.
 * Nur Kürzel, die Stimmen sonst buchstabieren; Zahlen liest die Stimme selbst.
 */
const MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function spokenDate(d: string, m: string, y: string): string {
  const month = MONTH_NAMES[Number(m) - 1];
  return month ? `${Number(d)}. ${month} ${y}` : `${d}.${m}.${y}`;
}

export function spokenForm(sentence: string): string {
  return sentence
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => spokenDate(d, m, y))
    .replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, (_, d, m, y) => spokenDate(d, m, y))
    .replace(/\bQ([1-4])\b/g, "Quartal $1")
    .replace(/\bFY\s?(\d{4})\b/g, "Geschäftsjahr $1")
    .replace(/\bH([12])\b/g, "Halbjahr $1")
    .replace(/(\d)\s?%/g, "$1 Prozent")
    .replace(/(\d)\s?Mrd\.?(?=\s|$)/g, "$1 Milliarden")
    .replace(/(\d)\s?Mio\.?(?=\s|$)/g, "$1 Millionen")
    .replace(/€\s?(\d[\d.,]*)/g, "$1 Euro")
    .replace(/\$\s?(\d[\d.,]*)/g, "$1 Dollar")
    .replace(/(\d[\d.,]*)\s?€/g, "$1 Euro")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lauftext eines Kapitels, wie er an die TTS geht und gehasht wird. */
export function chapterSpeechText(chapter: PlayerChapter): string {
  return chapter.sentences.join("\n");
}

// ── TTS-Vertrag zwischen Player und /api/tts ─────────────────────────────────

export type TtsJobStatus = "ready" | "pending" | "n/a";

export interface TtsChapterAudio {
  chapterId: string;
  url: string;
  mime: string;
  durationMs: number;
  /** Startzeit jedes Satzes in ms, gleiche Länge wie chapter.sentences. */
  sentenceStartsMs: number[];
}

export interface TtsEpisodeStatus {
  status: TtsJobStatus;
  /** Provider-ID, z. B. "piper". "browser" = keine Server-Stimme, Web Speech übernimmt. */
  provider: string;
  /** Lesbare Bezeichnung, z. B. "Piper · de_DE-thorsten-high". */
  providerLabel: string;
  reason: string | null;
  /** Fertige Kapitel bezogen auf alle abspielbaren Kapitel. */
  doneChapters: number;
  totalChapters: number;
  chapters: TtsChapterAudio[];
}

export interface TtsEpisodeRequest {
  scope: "stock" | "researcher";
  id: string;
  chapters: Array<{ id: string; sentences: string[] }>;
}

export const BROWSER_PROVIDER_ID = "browser";
export const BROWSER_PROVIDER_LABEL = "Browser-Stimme (Web Speech API)";

/** Kürzel für den Audio-Status-Text, z. B. „ok — Piper · de_DE-thorsten-high“. */
export function audioStatusLine(status: TtsEpisodeStatus | null): string {
  if (!status) return "n/a — Audio noch nicht angefragt";
  if (status.status === "ready") return `ok — ${status.providerLabel}`;
  if (status.status === "pending") return `läuft — ${status.providerLabel} (${status.doneChapters}/${status.totalChapters} Kapitel)`;
  return `ok — ${BROWSER_PROVIDER_LABEL}${status.reason ? ` · Server-Stimme: ${status.reason}` : ""}`;
}
