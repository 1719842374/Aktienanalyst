/**
 * Abnahme-Nenner, anderer Ticker-Satz als die 168er-Vorregistrierung.
 * Mindestens 100 Absätze pro Sprache. Dieselbe Bauart: zwölf Ticker,
 * Kapitel mit Fallback-Text, zwei Fassungen. Gemessen erst nach dem Commit,
 * auf dem Lexikon-Hash, der gemergt wird.
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
