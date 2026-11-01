/**
 * JOB 11: /api/analyze-gold laedt FRED nicht mehr mit execSync nacheinander (blockiert den
 * Event-Loop fuer die Summe aller Abrufe), sondern startet alle bekannten Abrufe zu Beginn
 * parallel und nicht blockierend. Die #223-Memo-Semantik bleibt: das Memo bekommt einen
 * Fetcher, der fuer (Serie, Start) das vorab geladene Ergebnis genau EINMAL liefert. Jeder
 * weitere Abruf derselben Kombination (das Memo ruft nur nach, wenn der erste Abruf leer war,
 * oder fuer ein frueheres Start-Datum) laeuft wie bisher synchron ueber `fallback`.
 */
import type { FredHistoryFetcher, FredHistoryPoint } from "./gold-fred-memo";

export type FredPrefetchKey = `${string}@${string}`;
export const prefetchKey = (seriesId: string, startDate: string): FredPrefetchKey => `${seriesId}@${startDate}`;

/**
 * Reihenfolge der Memo-Aufrufe in /api/analyze-gold (siehe test-gold-fred-memo.ts ROUTE_CALLS):
 * Jede Serie wird beim ERSTEN Aufruf mit diesem Start geladen; spaetere Aufrufe schneiden im Memo.
 */
export function analyzeGoldHistoryPlan(startDate: string, m2Start: string): Array<[string, string]> {
  return [
    ["DFII10", startDate], ["DTWEXBGS", startDate], ["T10YIE", startDate], ["WALCL", startDate],
    ["M2SL", m2Start], ["FEDFUNDS", startDate], ["WTREGEN", startDate], ["RRPONTSYD", startDate],
  ];
}

export async function prefetchHistories(
  plan: Array<[string, string]>,
  fetchAsync: (seriesId: string, startDate: string) => Promise<FredHistoryPoint[]>,
): Promise<Map<FredPrefetchKey, FredHistoryPoint[]>> {
  const results = await Promise.all(plan.map(([id, start]) => fetchAsync(id, start).catch(() => [] as FredHistoryPoint[])));
  return new Map(plan.map(([id, start], i) => [prefetchKey(id, start), results[i]]));
}

/** Fetcher fuers Memo: vorab geladenes Ergebnis einmal, danach (Wiederholung / unbekannte Kombination) synchron wie bisher. */
export function prefetchedFetcher(prefetched: Map<FredPrefetchKey, FredHistoryPoint[]>, fallback: FredHistoryFetcher): FredHistoryFetcher & { served: () => number; fallbacks: () => number } {
  let served = 0, fallbacks = 0;
  const fn = ((seriesId: string, startDate: string) => {
    const key = prefetchKey(seriesId, startDate);
    if (prefetched.has(key)) {
      const points = prefetched.get(key)!;
      prefetched.delete(key);
      served++;
      return points;
    }
    fallbacks++;
    return fallback(seriesId, startDate);
  }) as FredHistoryFetcher & { served: () => number; fallbacks: () => number };
  fn.served = () => served;
  fn.fallbacks = () => fallbacks;
  return fn;
}

/** `tail -5` einer Ausgabe nachbauen (letzte 5 Zeilen, abschliessender Zeilenumbruch zaehlt nicht als Zeile). */
export function tail5(out: string): string {
  const lines = out.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-5).join("\n") + (lines.length ? "\n" : "");
}

/** Parser von fetchFREDSeries (letzter gueltiger Wert), unveraenderte Logik. */
export function parseFredLatest(csv: string): { value: number; date: string } | null {
  const lines = csv.trim().split("\n").filter(l => l && !l.startsWith("DATE") && !l.includes("DATE"));
  for (let i = lines.length - 1; i >= 0; i--) {
    const parts = lines[i].split(",");
    if (parts.length >= 2 && parts[1] !== "." && parts[1] !== "") {
      return { date: parts[0], value: parseFloat(parts[1]) };
    }
  }
  return null;
}
