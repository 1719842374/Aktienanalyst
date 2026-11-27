/**
 * Abnahme-Korpus für Prompt stock-podcast-v18.
 * Stand 2026-11-26: im Repo liegt kein Modell-Lauf, und in dieser Umgebung ist kein API-Key gesetzt.
 * Es werden keine Sätze von Hand ergänzt und kein fallbackParagraph-Text verwendet.
 * paragraphs bleibt leer, bis ein echter Lauf mit Quelle und Erzeugungsdatum hier abgelegt wird.
 */
export interface PodcastModelParagraph {
  id: string;
  language: "de" | "en";
  chapterId: string;
  text: string;
  source: string;
  generatedAt: string;
  promptVersion: "stock-podcast-v18";
  model: string;
}

export const PODCAST_MODEL_V18: PodcastModelParagraph[] = [];

export const PODCAST_MODEL_V18_STATUS = {
  promptVersion: "stock-podcast-v18",
  generatedAt: null,
  source: null,
  reason: "Kein gespeicherter Modell-Lauf und kein API-Key. Keine erfundenen Absätze.",
} as const;
