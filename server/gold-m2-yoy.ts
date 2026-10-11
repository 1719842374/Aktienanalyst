/**
 * JOB 19: M2-YoY aus FRED M2SL. FRED ignoriert `limit`/`sort_order` bei fredgraph.csv und liefert
 * die ganze Reihe aufsteigend mit Kopf `observation_date` – die alte Auswertung (Zeile 0 vs. 12,
 * Filter auf "DATE") griff deshalb nie und lieferte immer den Ersatzwert 4.88.
 * Hier: letzte Beobachtung vs. Beobachtung genau 12 Monate früher (nach Datum, nicht nach Zeilenindex).
 */
export interface M2Yoy {
  yoy: number;
  date: string;
  yearAgoDate: string;
  latest: number;
  yearAgo: number;
}

export function computeM2YoyFromCsv(csv: string): M2Yoy | null {
  const rows = new Map<string, number>();
  for (const line of (csv || "").trim().split(/\r?\n/)) {
    const [d, v] = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) continue; // Kopfzeile (DATE/observation_date) u. a.
    const n = parseFloat(v);
    if (Number.isFinite(n) && n > 0) rows.set(d, n);
  }
  if (rows.size === 0) return null;
  const date = Array.from(rows.keys()).sort().pop()!;
  const yearAgoDate = `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
  const latest = rows.get(date)!;
  const yearAgo = rows.get(yearAgoDate);
  if (yearAgo == null) return null;
  return { yoy: (latest / yearAgo - 1) * 100, date, yearAgoDate, latest, yearAgo };
}
