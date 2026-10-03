/**
 * Sahm slot score for Offen_WORK_RECESSION_FRED_SAHM.md.
 *
 * S is computed from an unemployment series:
 *   U3m_t = (U_t + U_{t-1} + U_{t-2}) / 3
 *   S_t = U3m_t - min_{k=0..11} U3m_{t-k}
 * A missing calendar month leaves that S undefined. The slot is then scored
 * with s(z) only when the last 12 realtime prints all exist and sit within
 * ±0.02. Otherwise the slot fails closed at score 50. No other window is used.
 *
 * The spec writes σ_{t,H}+ε without a numeric expansion. μ/σ here are the
 * trailing window excluding x_t, sample divisor n-1, ε=1e-9. H is 240 months.
 * Fewer than 24 S months fails closed at slot score 50.
 */

export const SAHM_HISTORY_YEARS = 20;
export const SAHM_HISTORY_MONTHS = 240;
export const SAHM_MIN_MONTHS = 24;
export const SAHM_CONTROL_MONTHS = 12;
export const SAHM_CONTROL_TOLERANCE = 0.02;
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

export function sahmIndicatorFromScore(scored: SahmScore): {
  value: string;
  rawScore: number;
  weightedScore: number;
  weight: number;
  maxWeighted: number;
  zone: string;
  available: boolean;
  triggered: boolean;
} {
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

export function sahmIndicatorFromLevels(levels: FredPoint[]) {
  return sahmIndicatorFromScore(scoreSahmLevels(levels));
}

export interface SahmControlRow {
  date: string;
  computed: number | null;
  fred: number;
  absDiff: number | null;
}

export interface SahmUnemploymentScore {
  score: SahmScore;
  control: SahmControlRow[];
  controlOk: boolean;
}

function addMonths(month: string, k: number): string {
  let year = Number(month.slice(0, 4));
  let m = Number(month.slice(5, 7)) + k;
  while (m <= 0) {
    m += 12;
    year -= 1;
  }
  while (m > 12) {
    m -= 12;
    year += 1;
  }
  return `${year}-${String(m).padStart(2, "0")}`;
}

function unemploymentByMonth(rows: Array<{ date: string; value: number | null }>): Map<string, number | null> {
  const sorted = rows
    .filter(row => row.date.length >= 7)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const byMonth = new Map<string, number | null>();
  for (const row of sorted) {
    const value = row.value != null && Number.isFinite(row.value) ? row.value : null;
    byMonth.set(row.date.slice(0, 7), value);
  }
  return byMonth;
}

function monthsInSpan(byMonth: Map<string, number | null>): string[] {
  const keys = [...byMonth.keys()].sort();
  if (keys.length === 0) return [];
  const out: string[] = [];
  let cursor = keys[0];
  const end = keys[keys.length - 1];
  while (cursor <= end && out.length <= 2400) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
}

function unemploymentAt(byMonth: Map<string, number | null>, month: string): number | null {
  if (!byMonth.has(month)) return null;
  return byMonth.get(month) ?? null;
}

function threeMonthAverage(byMonth: Map<string, number | null>, month: string): number | null {
  const points = [0, -1, -2].map(lag => unemploymentAt(byMonth, addMonths(month, lag)));
  if (points.some(value => value == null)) return null;
  return ((points[0] as number) + (points[1] as number) + (points[2] as number)) / 3;
}

/** S_t from unemployment. Null when any required calendar month is blank. */
export function sahmAtMonth(byMonth: Map<string, number | null>, month: string): number | null {
  const window: number[] = [];
  for (let k = 0; k <= 11; k++) {
    const value = threeMonthAverage(byMonth, addMonths(month, -k));
    if (value == null) return null;
    window.push(value);
  }
  return window[0] - Math.min(...window);
}

export function sahmLevelsFromUnemployment(rows: Array<{ date: string; value: number | null }>): Array<{ date: string; value: number | null }> {
  const byMonth = unemploymentByMonth(rows);
  return monthsInSpan(byMonth).map(month => ({
    date: `${month}-01`,
    value: sahmAtMonth(byMonth, month),
  }));
}

function closedScore(level: number | null, n: number): SahmScore {
  return {
    available: false,
    n,
    level,
    s: 50,
    raw: 0,
    triggered: level != null && level >= SAHM_TRIGGER_PP,
  };
}

/**
 * Score S computed from unemployment. `realtime` is only the ±0.02 control.
 * The formula module does not name a series id; callers pass the observations.
 */
export function scoreSahmFromUnemployment(
  unemployment: Array<{ date: string; value: number | null }>,
  realtime: Array<{ date: string; value: number | null }>,
): SahmUnemploymentScore {
  const series = sahmLevelsFromUnemployment(unemployment);
  const byMonth = new Map(series.map(point => [point.date.slice(0, 7), point.value]));
  const control = cleanFredMonthly(realtime).slice(-SAHM_CONTROL_MONTHS).map(point => {
    const month = point.date.slice(0, 7);
    const computed = byMonth.has(month) ? byMonth.get(month) ?? null : null;
    return {
      date: `${month}-01`,
      computed,
      fred: point.value,
      absDiff: computed == null ? null : Math.abs(computed - point.value),
    };
  });
  const controlOk = control.length === SAHM_CONTROL_MONTHS && control.every(row =>
    row.computed != null && row.absDiff != null && row.absDiff <= SAHM_CONTROL_TOLERANCE);
  const finite = series.filter((point): point is FredPoint => point.value != null);
  const latest = series.length > 0 ? series[series.length - 1].value : null;
  if (!controlOk) {
    return { controlOk: false, control, score: closedScore(latest, finite.length) };
  }
  return { controlOk: true, control, score: scoreSahmLevels(finite) };
}
