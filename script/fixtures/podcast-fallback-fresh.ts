/**
 * Kein Abnahme-Set. Die Absätze entstehen aus fallbackParagraph, nicht aus einem Modell-Lauf.
 * Die Abnahme steht in podcast-model-v18.ts, sobald echte Modell-Absätze vorliegen.
 */
export const FALLBACK_FRESH_TICKERS = [
  "ORCL",
  "IBM",
  "DIS",
  "KO",
  "NKE",
  "BA",
  "CAT",
  "JPM",
  "BAS.DE",
  "BMW.DE",
  "DTE.DE",
  "IFX.DE",
] as const;

export const FALLBACK_FRESH_COMPANIES = [
  "Oracle",
  "International Business Machines",
  "Walt Disney",
  "Coca-Cola",
  "Nike",
  "Boeing",
  "Caterpillar",
  "JPMorgan Chase",
  "BASF",
  "Bayerische Motoren Werke",
  "Deutsche Telekom",
  "Infineon",
] as const;

export const FALLBACK_FRESH_CHAPTERS = [
  "einstieg",
  "zusammenfassung",
  "these",
  "umsatz",
  "dcf",
  "s17",
  "inversion",
  "earnings",
  "news",
] as const;

export const FALLBACK_FRESH_AT = "2026-11-26T12:00:00.000Z";
