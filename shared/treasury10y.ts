/**
 * 10Y-Treasury-Overlay (A3, Offen_WORK_BUFFETT_ASIA_10Y.md §3) in der Technischen Analyse.
 *
 * FRED DGS10 = Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity, in Prozent.
 * Marktzins, kein Bezug zum analysierten Titel. Geht NICHT in den Score und NICHT in die Fazit-Zählung.
 * Keine Datenwerte im Code: alles kommt aus der FRED-CSV, fehlt sie → n/a.
 * Muster wie das Credit-Overlay (#253, shared/credit.ts): dieselbe Normalisierung und derselbe
 * as-of-Join (max. OVERLAY_MAX_GAP_DAYS Kalendertage). Typen: shared/schema.ts.
 */
import type { Treasury10YOverlayPoint, Treasury10YPoint } from "./schema";
import { creditOverlaySeries, normalizeCreditPoints, OVERLAY_MAX_GAP_DAYS } from "./credit";

export type { Treasury10YOverlayPoint, Treasury10YPoint, Treasury10YResponse } from "./schema";
export { OVERLAY_MAX_GAP_DAYS };

export const TREASURY10Y_SERIES_ID = "DGS10";
export const TREASURY10Y_SOURCE_LABEL = "FRED DGS10 (US-Staatsanleihe 10J, Constant Maturity)";
export const TREASURY10Y_SOURCE_URL = "https://fred.stlouisfed.org/series/DGS10";
/** Exaktes Label der Overlay-Linie. */
export const TREASURY10Y_LABEL = "10J US-Treasury-Rendite (DGS10)";

/** Beobachtungen (aus server/fred-csv.ts) → nach Datum sortiert, nur ISO-Daten, ohne doppelte Tage. */
export function normalizeTreasury10YPoints(obs: ReadonlyArray<{ date: string; value: number }> | null | undefined): Treasury10YPoint[] {
  return normalizeCreditPoints(obs);
}

/** Ordnet jedem Kurstag den letzten DGS10-Wert ≤ Datum zu (max. OVERLAY_MAX_GAP_DAYS alt), sonst null. */
export function treasury10YOverlaySeries(bars: Array<{ date: string }>, points: Treasury10YPoint[]): Treasury10YOverlayPoint[] {
  return creditOverlaySeries(bars, points).map(p => ({ date: p.date, yieldPct: p.spreadPct, yieldDate: p.spreadDate }));
}

export interface Treasury10YWindowChange {
  first: number;
  firstDate: string;
  last: number;
  lastDate: string;
  /** last − first in Basispunkten (gerundet). */
  changeBp: number;
  direction: "steigend" | "fallend" | "unverändert";
}

/**
 * Zinsrichtung im sichtbaren Fenster: erster vs. letzter vorhandener Wert. Keine Schwelle, nur das Vorzeichen.
 * Weniger als zwei vorhandene Werte → null (n/a).
 */
export function treasury10YWindowChange(series: Treasury10YOverlayPoint[] | null | undefined): Treasury10YWindowChange | null {
  if (!Array.isArray(series)) return null;
  const have = series.filter(p => p.yieldPct != null && p.yieldDate != null);
  if (have.length < 2) return null;
  const a = have[0], b = have[have.length - 1];
  if (a.yieldDate === b.yieldDate) return null;
  const changeBp = Math.round((b.yieldPct! - a.yieldPct!) * 100);
  return {
    first: a.yieldPct!, firstDate: a.yieldDate!, last: b.yieldPct!, lastDate: b.yieldDate!,
    changeBp,
    direction: changeBp > 0 ? "steigend" : changeBp < 0 ? "fallend" : "unverändert",
  };
}
