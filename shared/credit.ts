/**
 * Credit-Overlay Stufe 1 (JOB A1): Markt-Spread Baa (FRED BAA10Y) in der Technischen Analyse.
 *
 * BAA10Y = Moody's Seasoned Baa Corporate Bond Yield minus 10Y Treasury — bereits ein Spread,
 * es wird KEINE Treasury abgezogen. Aggregat über alle US-Unternehmen, keine Anleihe des
 * analysierten Titels. Geht NICHT in den Score und NICHT in die Fazit-Zählung.
 * Keine Datenwerte im Code: alles kommt aus der FRED-CSV, fehlt sie → n/a.
 * Typen: shared/schema.ts.
 */
import type { CreditOverlayPoint, CreditPoint, CreditStressSignal } from "./schema";

export type { CreditOverlayPoint, CreditPoint, CreditSpreadResponse, CreditStressSignal } from "./schema";

export const CREDIT_SOURCE_LABEL = "FRED BAA10Y (Moody's Baa − 10Y Treasury)";
export const CREDIT_SOURCE_URL = "https://fred.stlouisfed.org/series/BAA10Y";
export const ISSUER_BOND_NA_NOTE = "Unternehmensspezifische Anleiherendite: n/a – keine freie Kursquelle (TRACE/Bloomberg kostenpflichtig)";
export const CREDIT_STRESS_HINT = "Kreditmarkt-Stress steigt";

/** Exaktes Label der Overlay-Linie (Bauauftrag A1). */
export function marketSpreadLabel(ticker: string | null | undefined): string {
  return `Markt-Spread Baa (alle US-Unternehmen) – keine Anleihe von ${ticker || "diesem Titel"}`;
}

/** Regel-Parameter des Hinweises (Methodik, keine Datenwerte). */
export const STRESS_CHANGE_OBS = 63;       // ≈ 3 Monate Handelstage
export const STRESS_LOOKBACK_YEARS = 20;   // Referenzverteilung der 3M-Änderungen
export const STRESS_PERCENTILE = 80;       // „steigt“, wenn aktuelle 3M-Änderung > 0 und > P80
export const STRESS_MIN_SAMPLE = 252;      // < 1 Jahr Referenz → kein Signal (n/a)
/** Overlay: ein Spread-Wert gilt für einen Kurstag nur, wenn er höchstens so viele Kalendertage älter ist. */
export const OVERLAY_MAX_GAP_DAYS = 7;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Beobachtungen (aus server/fred-csv.ts) → nach Datum sortiert, nur ISO-Daten, ohne doppelte Tage. */
export function normalizeCreditPoints(obs: ReadonlyArray<{ date: string; value: number }> | null | undefined): CreditPoint[] {
  if (!Array.isArray(obs)) return [];
  const out = obs
    .filter(o => o && ISO.test(o.date) && Number.isFinite(o.value))
    .map(o => ({ date: o.date, value: o.value }));
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out.filter((p, i) => i === 0 || p.date !== out[i - 1].date);
}

function percentileOf(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Aktuelle 3M-Änderung (63 Beobachtungen) gegen die rollierenden 3M-Änderungen der letzten 20 Jahre.
 * rising = Änderung > 0 UND > P80. Zu wenig Historie → null (n/a, kein Hinweis).
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
  if (changes.length < STRESS_MIN_SAMPLE) return null;
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

/** Hinweistext NUR bei steigendem Spread, sonst null. Reine Anzeige, kein Score-/Fazit-Faktor. */
export function creditStressHint(s: CreditStressSignal | null | undefined): string | null {
  if (!s || !s.rising) return null;
  const bp = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)} bp`;
  return `${CREDIT_STRESS_HINT}: Markt-Spread Baa ${bp(s.change3MPp)} in 3M `
    + `(über P${STRESS_PERCENTILE} der 3M-Änderungen seit ${STRESS_LOOKBACK_YEARS}J, Schwelle ${bp(s.percentileThresholdPp)}), `
    + `aktuell ${s.last.toFixed(2)}% (Stand ${s.asOf}). Nur Hinweis, kein Score-Einfluss.`;
}

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
