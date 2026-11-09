/**
 * Earnings Beat/Miss (WORK_DASHBOARD_FEATURES §2).
 * Inline-Band = Median der absoluten Surprise in dieser Stichprobe.
 * Weniger als zwei verwertbare Surprises → kein Band, Ereignis bleibt n/a (nie 0 als Schwelle).
 * Der Median lag in shared/distribution.ts (Commit 9e775062). Die Datei ist auf main nicht vorhanden
 * und bleibt es; die Funktion steht hier, nur für dieses Band.
 */

function median(values: readonly number[]): number | null {
  const xs = values.filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid];
}

export type EarningsKind = "beat" | "miss" | "inline";

export interface EarningsRaw {
  date: string;
  revenueActual: number | null;
  revenueEstimate: number | null;
  epsActual: number | null;
  epsEstimate: number | null;
}

export interface EarningsMarker {
  date: string;
  kind: EarningsKind | null;
  reason: string | null;
  basis: "revenue" | "eps" | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  revenueSurprisePct: number | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprisePct: number | null;
}

export interface EarningsMarkerSet {
  markers: EarningsMarker[];
  /** Median |Surprise| der Klassifikationsbasis, in Prozentpunkten. */
  inlineBandPct: number | null;
  beatRateLabel: string;
}

function surprisePct(actual: number | null, estimate: number | null): number | null {
  if (actual == null || estimate == null || !Number.isFinite(actual) || !Number.isFinite(estimate)) return null;
  if (estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

export function buildEarningsMarkers(rows: readonly EarningsRaw[]): EarningsMarkerSet {
  const prepared = rows.map(row => {
    const revenueSurprisePct = surprisePct(row.revenueActual, row.revenueEstimate);
    const epsSurprisePct = surprisePct(row.epsActual, row.epsEstimate);
    const basis: "revenue" | "eps" | null = revenueSurprisePct != null ? "revenue" : epsSurprisePct != null ? "eps" : null;
    const value = basis === "revenue" ? revenueSurprisePct : basis === "eps" ? epsSurprisePct : null;
    return {
      ...row,
      revenueSurprisePct,
      epsSurprisePct,
      basis,
      value,
    };
  });

  const sample = prepared.map(p => p.value).filter((v): v is number => v != null);
  const band = sample.length >= 2 ? median(sample.map(v => Math.abs(v))) : null;

  const markers: EarningsMarker[] = prepared.map(p => {
    if (p.value == null || p.basis == null) {
      const why = p.revenueActual == null && p.epsActual == null
        ? "n/a — weder Umsatz- noch EPS-Ist berichtet"
        : "n/a — Schätzung fehlt oder ist 0, keine Surprise";
      return {
        date: p.date, kind: null, reason: why, basis: null,
        revenueActual: p.revenueActual, revenueEstimate: p.revenueEstimate, revenueSurprisePct: p.revenueSurprisePct,
        epsActual: p.epsActual, epsEstimate: p.epsEstimate, epsSurprisePct: p.epsSurprisePct,
      };
    }
    if (band == null) {
      return {
        date: p.date, kind: null, basis: p.basis,
        reason: "n/a — weniger als zwei Surprises, kein Inline-Band (Median der Beträge)",
        revenueActual: p.revenueActual, revenueEstimate: p.revenueEstimate, revenueSurprisePct: p.revenueSurprisePct,
        epsActual: p.epsActual, epsEstimate: p.epsEstimate, epsSurprisePct: p.epsSurprisePct,
      };
    }
    let kind: EarningsKind = "inline";
    if (p.value > band) kind = "beat";
    else if (p.value < -band) kind = "miss";
    return {
      date: p.date, kind, reason: null, basis: p.basis,
      revenueActual: p.revenueActual, revenueEstimate: p.revenueEstimate, revenueSurprisePct: p.revenueSurprisePct,
      epsActual: p.epsActual, epsEstimate: p.epsEstimate, epsSurprisePct: p.epsSurprisePct,
    };
  });

  const classified = markers.filter(m => m.kind != null && m.basis === "revenue");
  const pool = classified.length > 0 ? classified : markers.filter(m => m.kind != null);
  const beats = pool.filter(m => m.kind === "beat").length;
  const basisName = classified.length > 0 ? "Revenue" : pool.some(m => m.basis === "eps") ? "EPS" : "Surprise";
  const beatRateLabel = pool.length === 0
    ? "n/a — keine klassifizierbare Surprise"
    : `${basisName} Beat ${beats}/${pool.length} (${Math.round((beats / pool.length) * 100)} %)`;

  return { markers, inlineBandPct: band, beatRateLabel };
}

/** Hängt klassifizierte Marker an Kurspunkte. Ohne Marker bleibt die Reihe dieselbe Referenz. */
export function attachEarningsToPoints<T extends { date: string; close: number }>(
  points: readonly T[],
  markers: readonly EarningsMarker[] | null | undefined,
): T[] {
  if (!markers?.some(m => m.kind)) return points as T[];
  const dates = points.map(p => p.date);
  const byDate = new Map<string, EarningsMarker>();
  for (const marker of markers) {
    if (!marker.kind) continue;
    const bar = snapEarningsToBar(dates, marker.date);
    if (bar) byDate.set(bar, marker);
  }
  return points.map(p => {
    const event = byDate.get(p.date);
    if (!event?.kind) return p;
    return {
      ...p,
      _earn: p.close,
      _earnKind: event.kind,
      _earnRevActual: event.revenueActual,
      _earnRevEst: event.revenueEstimate,
      _earnRev: event.revenueSurprisePct,
      _earnEps: event.epsSurprisePct,
      _earnReason: event.reason,
    };
  });
}

/** Nächster Handelstag ≥ Earnings-Datum, sonst null. */
export function snapEarningsToBar(dates: readonly string[], eventDate: string): string | null {
  if (!eventDate) return null;
  let best: string | null = null;
  for (const d of dates) {
    if (d >= eventDate && (best == null || d < best)) best = d;
  }
  return best;
}
