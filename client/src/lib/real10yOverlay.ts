/**
 * Real10Y-Overlay (FRED DFII10, 10J-Realzins), gemeinsam für den BTC-Chart (BTC-Dashboard, dort Sektion 11
 * „Technische Analyse“, BTCDashboard.tsx:142) und die Technische Analyse der Aktie (Aktien-Dashboard Sektion 12,
 * TechnicalChart). Aus BTCDashboard.tsx herausgezogen, ohne Verhaltensänderung: gleiche Farbe, Linie, Achse,
 * Domain-Formel, Chip-Text, FRED-Reihe.
 *
 * Datenquelle BTC: GET /api/analyze-btc/macro-history?startDate=… (server/btc-routes.ts → server/btc-macro.ts
 * fetchBTCMacroHistory → FRED DFII10 + M2SL), Feld `real10yByDate`.
 * Datenquelle Aktien-TA: GET /api/analyze-btc/real10y-history?startDate=… (fetchReal10YHistory, nur DFII10,
 * derselbe Fetcher), damit ein M2SL-Ausfall Real10Y nicht n/a macht.
 * Reine Anzeige: kein Score, kein Fazit. Fehlt die Reihe → n/a, kein Ersatzwert.
 */

/** Anzeige-Konstanten 1:1 wie bisher im BTC-Chart (BTCDashboard.tsx). */
export const REAL10Y_OVERLAY = {
  /** Chip-Text. */
  label: "Real10Y",
  /** Name der Linie (Tooltip/Legende). */
  lineName: "Real10Y (DFII10)",
  color: "#38bdf8",
  strokeWidth: 1.25,
  /** Breite der rechten Achse in px. */
  axisWidth: 44,
  chipTitle: "Realzins (DFII10) als rechte Achse ein-/ausblenden",
  /** Tailwind-Klassen des aktiven Chips. */
  chipOnClass: "border-sky-400 text-sky-400",
  seriesId: "DFII10",
  sourceLabel: "FRED DFII10",
  sourceUrl: "https://fred.stlouisfed.org/series/DFII10",
} as const;

/** Achsen-Ticks: eine Nachkommastelle + %. */
export const formatReal10yTick = (v: number): string => `${v.toFixed(1)}%`;
/** Tooltip-Wert: zwei Nachkommastellen + %. */
export const formatReal10yValue = (v: number): string => `${Number(v).toFixed(2)}%`;

/**
 * Eigene Skala für die Prozentreihe (unverändert aus BTCDashboard real10yDomain): min/max der vorhandenen Werte
 * ± max(15 % der Spanne, 0,2), auf eine Nachkommastelle. Keine Werte → [0, 5].
 */
export function real10yDomain(values: ReadonlyArray<number | null | undefined>): [number, number] {
  const vals = values.filter((v): v is number => v != null);
  if (vals.length === 0) return [0, 5] as [number, number];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const padding = Math.max((max - min) * 0.15, 0.2);
  return [+(min - padding).toFixed(1), +(max + padding).toFixed(1)] as [number, number];
}

/** Pfad der bestehenden BTC-Makro-Route (Query-Key der Aktien-TA). */
export function macroHistoryPath(startDate: string): string {
  return `/api/analyze-btc/macro-history?startDate=${encodeURIComponent(startDate)}`;
}

/** Pfad der DFII10-Route für die Aktien-TA (nur Real10Y, ohne M2SL). */
export function real10yHistoryPath(startDate: string): string {
  return `/api/analyze-btc/real10y-history?startDate=${encodeURIComponent(startDate)}`;
}

/** Teil der Antwort von /api/analyze-btc/macro-history bzw. /real10y-history, den das Overlay liest (server/btc-macro.ts BTCMacroHistory). */
export interface Real10YMacroHistory {
  real10yByDate?: Record<string, number>;
  latestReal10y?: { date: string; value: number } | null;
}
