/**
 * Sahm slot score for Offen_WORK_RECESSION_FRED_SAHM.md.
 *
 * S is computed from an unemployment series:
 *   U3m_t = mean of the delivered prints among U_t, U_{t-1}, U_{t-2}
 *   S_t = U3m_t - min_{k=1..12} U3m_{t-k}
 * A missing unemployment print is left missing. It is not stored as a number.
 * The 3-month mean uses the prints that exist, and only when at least two of
 * the three months were delivered. The minimum is the previous 12 months.
 * The spec text writes k=0..11, which includes the current average and cannot
 * be negative. SAHMREALTIME prints such as -0.07 are the prior-12 minimum.
 *
 * The US card shows the realtime series when any print arrived: blanks are
 * dropped, the latest delivered print is the level, and s(z) uses only those
 * prints. The self-computed S is the backup when that series was not
 * delivered, and that backup is scored with the same s(z). The 0.50pp mark
 * is the trigger on the displayed level.
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
  /** Why the slot is not the realtime print. Absent when the card shows that series. */
  reason?: string | null;
  /** True when the level is the self-computed unemployment S, not the realtime print. */
  backup?: boolean;
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
  reason: string | null;
} {
  const reason = scored.reason ?? null;
  return {
    value: scored.level == null ? "N/A" : `${scored.level.toFixed(2)} pp`,
    rawScore: scored.raw,
    weightedScore: scored.raw,
    weight: 1,
    maxWeighted: 4,
    zone: reason
      ? reason
      : scored.level == null
        ? "N/A"
        : scored.triggered ? "Ausgelöst (≥0.5pp)" : "Normal (<0.5pp)",
    available: scored.available,
    triggered: scored.triggered,
    reason,
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
  /** Card score. Realtime s(z) when that series arrived, otherwise the scored S. */
  score: SahmScore;
  /** s(z) of the self-computed S. Same object as `score` when realtime is empty. */
  computedScore: SahmScore;
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

/** Mean of the delivered prints in the trailing three months. Null below two prints. */
function threeMonthAverage(byMonth: Map<string, number | null>, month: string): number | null {
  const present = [0, -1, -2]
    .map(lag => unemploymentAt(byMonth, addMonths(month, lag)))
    .filter((value): value is number => value != null);
  if (present.length < 2) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

/**
 * S_t from unemployment. Null when the current mean or any of the previous
 * 12 means is missing. A single blank month does not erase the window.
 */
export function sahmAtMonth(byMonth: Map<string, number | null>, month: string): number | null {
  const current = threeMonthAverage(byMonth, month);
  if (current == null) return null;
  const window: number[] = [];
  for (let k = 1; k <= 12; k++) {
    const value = threeMonthAverage(byMonth, addMonths(month, -k));
    if (value == null) return null;
    window.push(value);
  }
  return current - Math.min(...window);
}

export function sahmLevelsFromUnemployment(rows: Array<{ date: string; value: number | null }>): Array<{ date: string; value: number | null }> {
  const byMonth = unemploymentByMonth(rows);
  return monthsInSpan(byMonth).map(month => ({
    date: `${month}-01`,
    value: sahmAtMonth(byMonth, month),
  }));
}

function closedScore(level: number | null, n: number, reason: string, backup = false): SahmScore {
  return {
    available: false,
    n,
    level,
    s: 50,
    raw: 0,
    triggered: level != null && level >= SAHM_TRIGGER_PP,
    reason,
    backup,
  };
}

function scoreComputedSeries(series: Array<{ date: string; value: number | null }>): SahmScore {
  const finite = series.filter((point): point is FredPoint => point.value != null);
  if (finite.length === 0) {
    return closedScore(null, 0, "Realtime-Serie nicht geliefert");
  }
  const scored = scoreSahmLevels(finite);
  const lastMonth = finite[finite.length - 1].date.slice(0, 7);
  if (!scored.available) {
    return { ...scored, backup: true, reason: `eigener Backup ${lastMonth}, nicht Claudias Serie` };
  }
  return { ...scored, backup: true };
}

/**
 * Card level is the realtime series when any print arrived (blanks dropped,
 * not filled). That series is s(z). The unemployment S is scored with the
 * same s(z), and it is the card only when the realtime series is empty.
 * `control` compares the self-computed S to the realtime prints.
 * The formula module does not name a series id; callers pass the observations.
 */
export function scoreSahmFromUnemployment(
  unemployment: Array<{ date: string; value: number | null }>,
  realtime: Array<{ date: string; value: number | null }>,
): SahmUnemploymentScore {
  const series = sahmLevelsFromUnemployment(unemployment);
  const byMonth = new Map(series.map(point => [point.date.slice(0, 7), point.value]));
  const realtimePoints = cleanFredMonthly(realtime);
  const computedScore = scoreComputedSeries(series);
  const control = realtimePoints.slice(-SAHM_CONTROL_MONTHS).map(point => {
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
  if (realtimePoints.length > 0) {
    return { controlOk, control, computedScore, score: scoreSahmLevels(realtimePoints) };
  }
  return { controlOk: false, control, computedScore, score: computedScore };
}

export interface EurostatDataset {
  id?: string[];
  size?: number[];
  value?: Record<string, number | null>;
  dimension?: Record<string, {
    category?: {
      index?: Record<string, number>;
      label?: Record<string, string>;
    };
  }>;
}

function euroAreaGeneration(code: string): number {
  const match = /^EA(\d+)$/.exec(code);
  return match ? Number(match[1]) : -1;
}

/**
 * Euro-area unemployment from a statistics dataset cube.
 * The aggregate is the geo whose label starts with "Euro area".
 * When several compositions are published, the highest EA generation is used.
 * No geo code is chosen in this module.
 */
export function euroAreaUnemploymentFromEurostat(payload: EurostatDataset): {
  geo: string | null;
  rows: Array<{ date: string; value: number | null }>;
} {
  const ids = payload.id ?? [];
  const size = payload.size ?? [];
  const geoPos = ids.indexOf("geo");
  const timePos = ids.indexOf("time");
  const geoIndex = payload.dimension?.geo?.category?.index ?? {};
  const geoLabel = payload.dimension?.geo?.category?.label ?? {};
  const timeIndex = payload.dimension?.time?.category?.index ?? {};
  if (geoPos < 0 || timePos < 0 || size.length !== ids.length) return { geo: null, rows: [] };
  if (size.some((length, index) => index !== geoPos && index !== timePos && length !== 1)) {
    return { geo: null, rows: [] };
  }
  const candidates = Object.keys(geoIndex).filter(code => /^Euro area\b/i.test(geoLabel[code] ?? ""));
  if (candidates.length === 0) return { geo: null, rows: [] };
  const geo = candidates.slice().sort((a, b) => euroAreaGeneration(b) - euroAreaGeneration(a) || a.localeCompare(b))[0];
  const stride: number[] = new Array(size.length).fill(1);
  for (let i = size.length - 2; i >= 0; i--) stride[i] = stride[i + 1] * size[i + 1];
  const geoAt = geoIndex[geo];
  const values = payload.value ?? {};
  const rows = Object.entries(timeIndex)
    .sort((a, b) => a[1] - b[1])
    .map(([period, timeAt]) => {
      const raw = values[String(geoAt * stride[geoPos] + timeAt * stride[timePos])];
      const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
      return { date: period.length === 7 ? `${period}-01` : period, value };
    });
  return { geo, rows };
}
