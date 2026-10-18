/**
 * FRED fredgraph.csv — gemeinsamer Abruf-/Parse-Kern (JOB A1).
 *
 * Herausgelöst aus server/recession.ts (getLatestFredValue), damit der Rezessions-Slot
 * „Kreditspreads (BAA-Trs)“ und das Credit-Overlay in der Technischen Analyse dieselbe
 * BAA10Y-Lesart verwenden, statt sie zu duplizieren. Das Verhalten ist 1:1 das bisherige
 * aus recession.ts (Test: script/test-fred-csv-recession.ts):
 *  - HTML-Antwort (Fehlerseite) oder leerer Body → keine Beobachtungen,
 *  - Kopfzeile wird übersprungen, Zeilen mit leerem Wert, "." oder nicht-numerischem Wert fallen weg,
 *  - Reihenfolge der Datei bleibt erhalten (FRED liefert aufsteigend), Wert = parseFloat.
 */

/** Moody's Seasoned Baa Corporate Bond Yield minus 10Y Treasury — bereits ein Spread (Prozentpunkte). */
export const BAA10Y_SERIES_ID = "BAA10Y";

export interface FredObservation { date: string; value: number }

/** URL wie bisher in recession.ts gebaut (Serien-ID unverändert eingesetzt, cosd optional). */
export function fredCsvUrl(seriesId: string, cosd?: string): string {
  const base = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
  return cosd ? `${base}&cosd=${cosd}` : base;
}

/** Gültige Beobachtungen einer fredgraph.csv, in Datei-Reihenfolge. */
export function fredCsvObservations(csv: string | null | undefined): FredObservation[] {
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
  const lines = csv.trim().split("\n").slice(1);
  const out: FredObservation[] = [];
  for (const l of lines) {
    const cells = l.split(",");
    const val = cells[1]?.trim();
    if (!(val && val !== "." && !isNaN(parseFloat(val)))) continue;
    out.push({ date: (cells[0] ?? "").trim(), value: parseFloat(val) });
  }
  return out;
}

/** Letzter gültiger Wert oder NaN — exakt die Rückgabe des bisherigen getLatestFredValue. */
export function latestFredCsvValue(csv: string | null | undefined): number {
  const obs = fredCsvObservations(csv);
  if (obs.length === 0) return NaN;
  return obs[obs.length - 1].value;
}

/** Asynchroner Abruf (für Express-Routen; blockiert den Event-Loop nicht). null = nicht erreichbar. */
export async function fetchFredCsv(seriesId: string, cosd?: string, timeoutMs = 20000): Promise<string | null> {
  try {
    const resp = await fetch(fredCsvUrl(seriesId, cosd), { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}
