/**
 * Pro-Request-Memo fuer FRED-Historien in /api/analyze-gold.
 * Chart-Overlays (#209), Multi-Faktor-Modell und adaptive Schicht (#208) fragen
 * DTWEXBGS, WALCL, T10YIE und M2SL jeweils selbst ab. Das Memo holt jede Serie
 * einmal je Request. Fragt ein spaeterer Aufrufer ein spaeteres Startdatum an,
 * wird die bereits geladene laengere Reihe so geschnitten, wie FREDs `cosd`
 * schneidet (siehe sliceLikeCosd).
 * Ein frueheres Startdatum loest einen neuen Abruf aus, damit nie Daten fehlen.
 *
 * Kein globaler Cache: jeder Request bekommt ein neues Memo, die Daten sind so
 * frisch wie vorher.
 */
export type FredHistoryPoint = { date: string; value: number };
export type FredHistoryFetcher = (seriesId: string, startDate: string) => FredHistoryPoint[];

export interface FredHistoryMemo {
  get(seriesId: string, startDate: string): FredHistoryPoint[];
  /** Tatsaechliche FRED-Abrufe ueber dieses Memo. */
  readonly fetches: number;
  /** Aufrufe insgesamt (Abruf oder aus dem Memo). */
  readonly requests: number;
}

export function createFredHistoryMemo(fetcher: FredHistoryFetcher): FredHistoryMemo {
  const cache = new Map<string, { start: string; points: FredHistoryPoint[] }>();
  let fetches = 0;
  let requests = 0;
  return {
    get(seriesId: string, startDate: string): FredHistoryPoint[] {
      requests++;
      const hit = cache.get(seriesId);
      if (hit && hit.start <= startDate) {
        // Kopie, damit kein Aufrufer die Reihe eines anderen veraendern kann.
        return hit.start === startDate
          ? hit.points.map(point => ({ ...point }))
          : sliceLikeCosd(hit.points, startDate).map(point => ({ ...point }));
      }
      fetches++;
      const points = fetcher(seriesId, startDate);
      // Ein leerer Abruf (FRED-Fehler) wird nicht gemerkt: der naechste Aufrufer versucht es wie bisher erneut.
      if (points.length > 0) cache.set(seriesId, { start: startDate, points });
      return points.map(point => ({ ...point }));
    },
    get fetches() { return fetches; },
    get requests() { return requests; },
  };
}

/**
 * Nachbau von FREDs `cosd`: ab cosd, bei Monatsreihen (alle Daten am 1.) inklusive
 * der Beobachtung des Monats, in dem cosd liegt. Live geprueft am 11.10.2026:
 * M2SL mit cosd=2016-10-11 beginnt bei 2016-10-01.
 */
export function sliceLikeCosd(points: FredHistoryPoint[], startDate: string): FredHistoryPoint[] {
  const monthly = points.length > 0 && points.every(point => point.date.slice(8, 10) === "01");
  const month = startDate.slice(0, 7);
  return points.filter(point => point.date >= startDate || (monthly && point.date.slice(0, 7) === month));
}
