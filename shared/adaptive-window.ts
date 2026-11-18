/**
 * z-Score, Median und empirisches Perzentil über ein benanntes Fenster.
 * Keine Schwellen und kein Score. Zu wenig Punkte oder Streuung 0 → available false.
 * Fehlende Punkte werden nicht aufgefüllt.
 */

export const ADAPTIVE_DIST_PARAMS = {
  sampleDof: 1,
  minStd: 1e-12,
  percentScale: 100,
} as const;

export interface DistPoint {
  key: string;
  value: number;
}

export type DistributionReading =
  | {
      available: true;
      z: number;
      percentile: number;
      median: number;
      mean: number;
      points: number;
      windowStart: string;
    }
  | { available: false; reason: string };

export function quarterOrdinal(key: string): number | null {
  const match = /^(\d{4})Q([1-4])$/.exec(key);
  if (!match) return null;
  return Number(match[1]) * 4 + Number(match[2]);
}

function shiftYears(date: string, years: number): string {
  return `${String(Number(date.slice(0, 4)) + years).padStart(4, "0")}${date.slice(4)}`;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function empiricalPercentile(values: number[], latest: number): number {
  let atOrBelow = 0;
  for (const value of values) if (value <= latest) atOrBelow += 1;
  return (atOrBelow / values.length) * ADAPTIVE_DIST_PARAMS.percentScale;
}

function sampleStd(values: number[], mean: number): number {
  const dof = values.length - ADAPTIVE_DIST_PARAMS.sampleDof;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / dof);
}

function inWindow(key: string, latestKey: string, windowYears: number): boolean {
  const latestQuarter = quarterOrdinal(latestKey);
  const keyQuarter = quarterOrdinal(key);
  if (latestQuarter != null && keyQuarter != null) {
    return keyQuarter > latestQuarter - windowYears * 4;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(latestKey) && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return key > shiftYears(latestKey, -windowYears);
  }
  return false;
}

/** Letzter Punkt ist die Gegenwart. Das Fenster ist offen an der unteren Kante. */
export function distributionOverWindow(
  series: DistPoint[],
  opts: { windowYears: number; minPoints: number; seriesLabel: string },
): DistributionReading {
  const clean = series.filter(point => Number.isFinite(point.value) && point.key.length > 0);
  if (clean.length === 0) {
    return { available: false, reason: `n/a — ${opts.seriesLabel}: keine gültigen Punkte` };
  }
  const latest = clean[clean.length - 1];
  const window = clean.filter(point => inWindow(point.key, latest.key, opts.windowYears));
  if (window.length < opts.minPoints) {
    return {
      available: false,
      reason: `n/a — ${opts.seriesLabel}: zu wenig Historie (${window.length} Punkte im ${opts.windowYears}-Jahres-Fenster, mindestens ${opts.minPoints})`,
    };
  }
  const values = window.map(point => point.value);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const std = sampleStd(values, mean);
  if (!(std > ADAPTIVE_DIST_PARAMS.minStd)) {
    return { available: false, reason: `n/a — ${opts.seriesLabel}: Streuung im Fenster ist 0, z-Wert nicht definiert` };
  }
  return {
    available: true,
    z: (latest.value - mean) / std,
    percentile: empiricalPercentile(values, latest.value),
    median: median(values),
    mean,
    points: window.length,
    windowStart: window[0].key,
  };
}
