/**
 * Markt-Spread Baa (FRED BAA10Y) für das Credit-Overlay in Sektion 12 (JOB W1, Option b).
 *
 * BAA10Y = Moody's Seasoned Baa Corporate Bond Yield minus 10Y Treasury — bereits ein Spread,
 * es wird KEINE Treasury abgezogen. Aggregat über alle US-Unternehmen, keine Anleihe des
 * analysierten Titels. Geht NICHT in den Score; nur Overlay + Fazit-Hinweis.
 * Keine Werte im Code: alles kommt aus der FRED-CSV, fehlt sie → n/a.
 */

export const CREDIT_SERIES_ID = "BAA10Y";
export const CREDIT_SOURCE_LABEL = "FRED BAA10Y (Moody's Baa − 10Y Treasury)";
export const CREDIT_SOURCE_URL = "https://fred.stlouisfed.org/series/BAA10Y";
export const ISSUER_BOND_NA_NOTE = "Unternehmensspezifische Anleiherendite: n/a – keine freie Kursquelle (TRACE/Bloomberg kostenpflichtig)";

export function marketSpreadLabel(ticker: string | null | undefined): string {
  return `Markt-Spread Baa (alle US-Unternehmen) – keine Anleihe von ${ticker || "diesem Titel"}`;
}

/** Regel-Parameter des Fazit-Hinweises (Methodik, keine Datenwerte). */
export const STRESS_CHANGE_OBS = 63;       // ≈ 3 Monate Handelstage
export const STRESS_LOOKBACK_YEARS = 20;   // Referenzverteilung der 3M-Änderungen
export const STRESS_PERCENTILE = 80;       // Hinweis, wenn aktuelle 3M-Änderung > P80
/** Overlay: ein Spread-Wert gilt für einen Kurstag nur, wenn er höchstens so viele Kalendertage älter ist. */
export const OVERLAY_MAX_GAP_DAYS = 7;

export interface CreditPoint { date: string; value: number }

export interface CreditSpreadResponse {
  seriesId: string;
  source: string;
  sourceUrl: string;
  /** Prozentpunkte, aufsteigend nach Datum. Leer = n/a. */
  points: CreditPoint[];
  stress: CreditStressSignal | null;
  note: string | null;
}

export interface CreditStressSignal {
  rising: boolean;
  asOf: string;
  last: number;
  change3MPp: number;
  percentileThresholdPp: number;
  percentileRank: number;
  sampleSize: number;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** FRED fredgraph.csv → Punkte. "." (fehlender Tag) und Müll werden verworfen. */
export function parseFredCsv(csv: string | null | undefined): CreditPoint[] {
  if (!csv || /<html|<!DOCTYPE/i.test(csv)) return [];
  const out: CreditPoint[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(",");
    const date = d?.trim();
    const value = Number(v?.trim());
    if (date && ISO.test(date) && v?.trim() !== "." && Number.isFinite(value)) out.push({ date, value });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out.filter((p, i) => i === 0 || p.date !== out[i - 1].date);
}

function percentileOf(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * „Kreditmarkt-Stress steigt“: aktuelle 3M-Änderung (63 Beobachtungen) liegt über dem P80
 * aller rollierenden 3M-Änderungen der letzten 20 Jahre und ist positiv.
 * Zu wenig Historie (< 1 Jahr Referenz) → null (n/a, kein Hinweis).
 */
export function creditStressSignal(points: CreditPoint[]): CreditStressSignal | null {
  if (!Array.isArray(points) || points.length <= STRESS_CHANGE_OBS) return null;
  const last = points[points.length - 1];
  const cutoff = new Date(last.date + "T00:00:00Z");
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - STRESS_LOOKBACK_YEARS);
  const cut = cutoff.toISOString().slice(0, 10);
  const changes: number[] = [];
  for (let i = STRESS_CHANGE_OBS; i < points.length; i++) {
    if (points[i].date < cut) continue;
    changes.push(points[i].value - points[i - STRESS_CHANGE_OBS].value);
  }
  if (changes.length < 252) return null;
  const current = changes[changes.length - 1];
  const sorted = [...changes].sort((a, b) => a - b);
  const threshold = percentileOf(sorted, STRESS_PERCENTILE);
  const below = sorted.filter(c => c < current).length;
  return {
    rising: current > 0 && current > threshold,
    asOf: last.date,
    last: last.value,
    change3MPp: current,
    percentileThresholdPp: threshold,
    percentileRank: (below / sorted.length) * 100,
    sampleSize: sorted.length,
  };
}

export function creditStressHint(s: CreditStressSignal | null | undefined): string | null {
  if (!s || !s.rising) return null;
  const bp = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)} bp`;
  return `Kreditmarkt-Stress steigt: Markt-Spread Baa (BAA10Y, alle US-Unternehmen) ${bp(s.change3MPp)} in 3M `
    + `(über P${STRESS_PERCENTILE} der 3M-Änderungen seit ${STRESS_LOOKBACK_YEARS}J, Schwelle ${bp(s.percentileThresholdPp)}), `
    + `aktuell ${s.last.toFixed(2)}% (Stand ${s.asOf}). Nur Hinweis, kein Score-Einfluss.`;
}

export interface CreditOverlayPoint { date: string; spreadPct: number | null; spreadDate: string | null }

/** Ordnet jedem Kurstag den letzten FRED-Wert ≤ Datum zu (max. OVERLAY_MAX_GAP_DAYS alt), sonst null. */
export function creditOverlaySeries(bars: Array<{ date: string }>, points: CreditPoint[]): CreditOverlayPoint[] {
  const out: CreditOverlayPoint[] = [];
  let j = -1;
  for (const b of bars) {
    while (j + 1 < points.length && points[j + 1].date <= b.date) j++;
    const p = j >= 0 ? points[j] : null;
    const gap = p ? (Date.parse(b.date + "T00:00:00Z") - Date.parse(p.date + "T00:00:00Z")) / 86400000 : Infinity;
    out.push(p && gap <= OVERLAY_MAX_GAP_DAYS ? { date: b.date, spreadPct: p.value, spreadDate: p.date } : { date: b.date, spreadPct: null, spreadDate: null });
  }
  return out;
}
