/**
 * Realzins-Adjustierung des Buffett-Indikators (WORK_REALZINS_ADJUST). Nur Anzeige.
 *
 * Buffett_adj = Buffett_raw × (1 + β × (Realzins − Median)).
 * β ist die OLS-Steigung von (Quote/Median − 1) auf (Realzins − Median),
 * nicht die angenommene −0,10. Der Median ersetzt den angenommenen Langfristsatz.
 * Fehlende Punkte bleiben aus, nie 0.
 */
import { INVENTORY_DEMAND_GAP_PARAMS } from "./inventory-demand-gap";
import { buffettZone } from "./buffett-zone";
import { percentile, REST_OVERLAY_PARAMS } from "./recession-rest-overlays";

const PERCENT = INVENTORY_DEMAND_GAP_PARAMS.percentScale;

/**
 * olsMinObservations: Steigung mit Achsenabschnitt braucht 3 Punkte.
 * Die Haltedauer eines Realzins-Drucks ist das hohe Perzentil der Abstände
 * in der DFII10-Reihe selbst (REST_OVERLAY_PARAMS.bandHighPercentile).
 */
export const REALZINS_PARAMS = {
  olsMinObservations: 3,
  minStd: INVENTORY_DEMAND_GAP_PARAMS.minStd,
  sampleDof: INVENTORY_DEMAND_GAP_PARAMS.sampleDof,
  gapPercentile: REST_OVERLAY_PARAMS.bandHighPercentile,
} as const;

export type RealzinsReading = { value: number; reason: null } | { value: null; reason: string };

export interface RealzinsPoint {
  date: string;
  raw: number;
  real: number;
  adj: number | null;
  reason: string | null;
}

export interface RealzinsAdjustment {
  beta: RealzinsReading;
  realMedian: RealzinsReading;
  buffettMedian: RealzinsReading;
  latestRaw: RealzinsReading;
  latestReal: RealzinsReading;
  latestAdj: RealzinsReading;
  z: RealzinsReading;
  percentile: RealzinsReading;
  zoneLabel: string | null;
  points: RealzinsPoint[];
  reason: string | null;
}

function na(reason: string): RealzinsReading {
  return { value: null, reason };
}

function ok(value: number): RealzinsReading {
  return { value, reason: null };
}

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function daySpan(a: string, b: string): number {
  return (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000;
}

/** Oberes Perzentil der Abstände in der Realzins-Reihe, in Tagen. */
export function realHoldDays(datesAsc: string[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < datesAsc.length; i++) {
    const g = daySpan(datesAsc[i - 1], datesAsc[i]);
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return null;
  return percentile(gaps.slice().sort((a, b) => a - b), REALZINS_PARAMS.gapPercentile);
}

function empty(reason: string): RealzinsAdjustment {
  const reading = na(reason);
  return {
    beta: reading,
    realMedian: reading,
    buffettMedian: reading,
    latestRaw: reading,
    latestReal: reading,
    latestAdj: reading,
    z: reading,
    percentile: reading,
    zoneLabel: null,
    points: [],
    reason,
  };
}

/**
 * Gemeinsame Punkte: letzter DFII10-Druck am oder vor dem Buffett-Datum,
 * nicht älter als die dateneigene Haltedauer.
 */
export function adjustBuffettForRealYield(
  buffett: { date: string; ratio: number }[],
  real: { date: string; value: number }[],
): RealzinsAdjustment {
  const ratios = buffett
    .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && finite(p.ratio))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const reals = real
    .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && finite(p.value))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!ratios.length) return empty("n/a — Buffett-Reihe ohne gültige Quote");
  if (!reals.length) return empty("n/a — DFII10 ohne gültige Realzinsen");
  const hold = realHoldDays(reals.map(p => p.date));
  if (hold == null) return empty("n/a — DFII10-Abstände nicht bestimmt");

  const joined: { date: string; raw: number; real: number }[] = [];
  let j = -1;
  for (const b of ratios) {
    while (j + 1 < reals.length && reals[j + 1].date <= b.date) j++;
    if (j < 0) continue;
    const age = daySpan(reals[j].date, b.date);
    if (age <= hold) joined.push({ date: b.date, raw: b.ratio, real: reals[j].value });
  }
  if (joined.length < REALZINS_PARAMS.olsMinObservations) {
    return empty(`n/a — zu wenig gemeinsame Buffett/DFII10-Punkte (${joined.length}, mindestens ${REALZINS_PARAMS.olsMinObservations})`);
  }

  const realMedian = median(joined.map(p => p.real));
  const buffettMedian = median(joined.map(p => p.raw));
  if (buffettMedian === 0) return empty("n/a — Median der Buffett-Quote ist 0, die relative Rate ist nicht definiert");

  const xs = joined.map(p => p.real - realMedian);
  const ys = joined.map(p => p.raw / buffettMedian - 1);
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let varX = 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    varX += (xs[i] - mx) ** 2;
    cov += (xs[i] - mx) * (ys[i] - my);
  }
  if (!(varX > REALZINS_PARAMS.minStd)) return empty("n/a — Realzins im Überlapp ohne Streuung, β nicht bestimmt");
  const beta = cov / varX;

  const points: RealzinsPoint[] = joined.map(p => {
    const factor = 1 + beta * (p.real - realMedian);
    if (!(factor > 0)) {
      return { date: p.date, raw: p.raw, real: p.real, adj: null, reason: "Adjustierung nicht definiert (Faktor ≤ 0)" };
    }
    return { date: p.date, raw: p.raw, real: p.real, adj: p.raw * factor, reason: null };
  });
  const adjVals = points.map(p => p.adj).filter((v): v is number => v != null);
  const last = points[points.length - 1];
  const latestAdj = last.adj == null ? na(last.reason ?? "letzter Punkt ohne Adjustierung") : ok(last.adj);

  let z: RealzinsReading = na("z-Score: zu wenig adjustierte Punkte");
  let pct: RealzinsReading = na("Perzentil: zu wenig adjustierte Punkte");
  let zoneLabel: string | null = null;
  if (latestAdj.value != null && adjVals.length >= REALZINS_PARAMS.olsMinObservations) {
    const mean = adjVals.reduce((s, v) => s + v, 0) / adjVals.length;
    const dof = adjVals.length - REALZINS_PARAMS.sampleDof;
    const sd = dof > 0 ? Math.sqrt(adjVals.reduce((s, v) => s + (v - mean) ** 2, 0) / dof) : 0;
    if (sd > REALZINS_PARAMS.minStd) {
      const zValue = (latestAdj.value - mean) / sd;
      z = ok(zValue);
      const le = adjVals.filter(v => v <= latestAdj.value!).length;
      pct = ok((le / adjVals.length) * PERCENT);
      zoneLabel = buffettZone(zValue)?.label ?? null;
    } else {
      z = na("z-Score: Streuung der adjustierten Reihe ist 0");
      pct = na("Perzentil: Streuung der adjustierten Reihe ist 0");
    }
  }

  return {
    beta: ok(beta),
    realMedian: ok(realMedian),
    buffettMedian: ok(buffettMedian),
    latestRaw: ok(last.raw),
    latestReal: ok(last.real),
    latestAdj,
    z,
    percentile: pct,
    zoneLabel,
    points,
    reason: null,
  };
}
