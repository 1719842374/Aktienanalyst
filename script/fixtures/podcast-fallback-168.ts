/**
 * Fallback-Nenner: 168 Absätze PRO SPRACHE, nicht insgesamt.
 *
 * Bau, vor der Messung festgehalten: zwölf Ticker, die Kapitel, für die
 * fallbackParagraph einen Text liefert, und zwei Fassungen je Text
 * (der Absatz selbst und derselbe Absatz plus ein Satz).
 * earnings und news liefern bei diesem Pack oft keinen Text und zählen nicht.
 * Zwölf Ticker mal sieben Kapitel mit Text mal zwei Fassungen = 168 je Sprache.
 *
 * Die Messung trennt ambiguous und Rest.
 * Bestanden bei 168 je Sprache: höchstens 9 Fallbacks, Wilson-95-Obergrenze ≤ 9,9 %.
 * Bestanden bei 100 je Sprache: höchstens 4 Fallbacks, Wilson-95-Obergrenze ≤ 9,8 %.
 * Die Regel wird nie gelockert. Ein Lexikon-Nachtrag macht die alte Messung zum Tuning.
 * Die Abnahme läuft dann auf einem vorher committeten, ungesehenen Satz mit demselben Nenner
 * und genau dem Lexikon-Hash, der gemergt wird.
 */
export const FALLBACK_168_PER_LANGUAGE = 168;

export const FALLBACK_168_TICKERS = [
  "NVDA",
  "7203.T",
  "NVO",
  "SIE.DE",
  "ALV.DE",
  "BAYN.DE",
  "VOW3.DE",
  "HEN3.DE",
  "LHA.DE",
  "PFE",
  "MSFT",
  "SAP.DE",
] as const;

export const FALLBACK_168_COMPANIES = [
  "NVIDIA",
  "Toyota Motor Corporation",
  "Novo Nordisk",
  "Siemens",
  "Allianz",
  "Bayer",
  "Volkswagen",
  "Henkel",
  "Lufthansa",
  "Pfizer",
  "Microsoft",
  "SAP",
] as const;

export const FALLBACK_168_CHAPTERS = [
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

/** Fester Zeitpunkt, damit as-of und Cache-Tag nicht vom Lauf abhängen. */
export const FALLBACK_168_AT = "2026-11-26T12:00:00.000Z";
