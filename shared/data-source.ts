/**
 * C1 / PR #252 (Yahoo-Fallback bei FMP 402): Kennzeichnung einer Analyse,
 * deren Daten allein aus Yahoo stammen (FMP-Plan deckt das Symbol nicht ab).
 *
 * Yahoo liefert nur Kurs, Market Cap, KGV, EPS und Historie, keine Statements.
 * Ohne FCF/Umsatz/Bilanz gibt es keine belastbare Bewertung: DCF, Inverse-DCF,
 * CRV/Upside, Score und Rating bleiben n/a (serverseitig null bzw. nicht gesetzt,
 * clientseitig n/a-Karte statt Rechnung mit 0-Werten).
 */
export type AnalysisDataSource = "fmp" | "yahoo";

export const YAHOO_NO_VALUATION_NOTICE = "Yahoo-Daten – keine Bewertung";

/** true nur für Analysen aus dem Yahoo-Fallback (dataSource === "yahoo"). FMP-Analysen und Altdaten ohne Feld: false. */
export function isYahooOnly(a: { dataSource?: unknown } | null | undefined): boolean {
  return a?.dataSource === "yahoo";
}
