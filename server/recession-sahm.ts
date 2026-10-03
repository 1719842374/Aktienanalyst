/**
 * Sahm slot score for Offen_WORK_RECESSION_FRED_SAHM.md.
 *
 * x is the published SAHMREALTIME level. The spec's minimum over k=0..11
 * includes the current 3-month unemployment average, so that S cannot be
 * negative. The October 2025 UNRATE gap also leaves no complete window for
 * the 2026-08 print of -0.07. Rebuilding S from UNRATE would miss the
 * SAHMREALTIME ±0.02 control, so the score z-scores the realtime series.
 *
 * The spec writes σ_{t,H}+ε without a numeric expansion. μ/σ here are the
 * trailing window excluding x_t, sample divisor n-1, ε=1e-9. H is 240 months.
 * Fewer than 24 months fails closed at slot score 50.
 */

export const SAHM_HISTORY_YEARS = 20;
export const SAHM_HISTORY_MONTHS = 240;
export const SAHM_MIN_MONTHS = 24;
export const SAHM_Z_EPSILON = 1e-9;
export const SAHM_TRIGGER_PP = 0.5;

export interface FredPoint {
  date: string;
  value: number;
}

export interface SahmScore {
  available: boolean;
  n: number;
  level: number | null;
  s: number;
  raw: number;
  triggered: boolean;
}

export function cleanFredMonthly(rows: Array<{ date: string; value: number | null }>): FredPoint[] {
  const finite = rows.filter((row): row is FredPoint =>
    Boolean(row.date) && row.value != null && Number.isFinite(row.value));
  const byDate = new Map<string, number>();
  const dates: string[] = [];
  const sorted = [...finite].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  for (const row of sorted) {
    if (!byDate.has(row.date)) dates.push(row.date);
    byDate.set(row.date, row.value);
  }
  dates.sort();
  const byMonth = new Map<string, FredPoint>();
  for (const date of dates) {
    byMonth.set(date.slice(0, 7), { date, value: byDate.get(date) as number });
  }
  return [...byMonth.values()];
}

function mean(xs: number[]): number {
  return xs.reduce((sum, value) => sum + value, 0) / xs.length;
}

function sampleStd(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export function scoreSahmLevels(levels: FredPoint[]): SahmScore {
  const n = levels.length;
  const level = n > 0 ? levels[n - 1].value : null;
  const triggered = level != null && level >= SAHM_TRIGGER_PP;
  if (n < SAHM_MIN_MONTHS || level == null) {
    return { available: false, n, level, s: 50, raw: 0, triggered };
  }
  const history = levels
    .slice(Math.max(0, n - 1 - SAHM_HISTORY_MONTHS), n - 1)
    .map(point => point.value);
  const mu = mean(history);
  const sigma = sampleStd(history, mu);
  const deviation = level - mu;
  // Repeated decimals are not bit-identical after the mean, so σ can be ~1e-16.
  // Treat that as a flat history: ε must not turn a mean-level print into a huge z.
  const flat = sigma <= 1e-12;
  const onMean = Math.abs(deviation) <= 1e-8 * Math.max(1, Math.abs(mu));
  const z = flat
    ? (onMean ? 0 : Math.sign(deviation) * Number.POSITIVE_INFINITY)
    : deviation / (sigma + SAHM_Z_EPSILON);
  const clipped = Math.max(-1, Math.min(1, z / 2));
  const s = 50 + 50 * clipped;
  const raw = Math.max(-4, Math.min(4, Math.round((s - 50) / 12.5)));
  return { available: true, n, level, s, raw, triggered };
}

export function sahmIndicatorFromLevels(levels: FredPoint[]): {
  value: string;
  rawScore: number;
  weightedScore: number;
  weight: number;
  maxWeighted: number;
  zone: string;
  available: boolean;
  triggered: boolean;
} {
  const scored = scoreSahmLevels(levels);
  return {
    value: scored.level == null ? "N/A" : `${scored.level.toFixed(2)} pp`,
    rawScore: scored.raw,
    weightedScore: scored.raw,
    weight: 1,
    maxWeighted: 4,
    zone: scored.level == null ? "N/A" : scored.triggered ? "Ausgelöst (≥0.5pp)" : "Normal (<0.5pp)",
    available: scored.available,
    triggered: scored.triggered,
  };
}
