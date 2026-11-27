/**
 * Regel-Fixture für die vier Spalten, kein Modell-Absatz und kein Fallback-Text.
 * Die Liste nennt nur einen fremden Namen. Im Text stehen zusätzlich ein Produkt und ein Kompositum.
 * Abnahme nach dem Code: list, none, null und [] lehnen den Absatz ab.
 */
export interface PodcastNameColumnCase {
  id: string;
  language: "de" | "en";
  chapterId: string;
  text: string;
  listed: string[];
}

export const PODCAST_NAME_COLUMNS: PodcastNameColumnCase[] = [
  {
    id: "COL-DE",
    language: "de",
    chapterId: "einstieg",
    text: "Der Kurs bleibt der Maßstab für die Firma und Toyota steht neben Zepbound und Pfizerwerk. Die Aktie stützt die Bewertung im neuen Jahr.",
    listed: ["Toyota"],
  },
  {
    id: "COL-EN",
    language: "en",
    chapterId: "einstieg",
    text: "The price stays the verified view and Toyota stands next to Zepbound and Pfizerwerk. Demand remains the verified view this year.",
    listed: ["Toyota"],
  },
];
