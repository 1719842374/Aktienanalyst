/**
 * F1-39 — Dollar-Anteil an den Weltreserven (Spec: Offen_FUTURE_SOLL_IST_DETAIL.md Z.104, Quelle Future_1 Z.461).
 * Einzige Quelle: IMF COFER (SDMX 2.1, Reihe G001.AFXRA.CI_USD.SHRO_PT.Q = USD-Anteil an den
 * zugeordneten Devisenreserven, Prozent, quartalsweise). Reine Parse-/Rechenlogik, kein Netz, kein Score.
 * Leer / fehlende Reihe / zu kurze Historie → { available: false, reason } (n/a), nie 0.
 */
export interface QuarterPoint { period: string; value: number }

export type DollarReserveShareReading =
  | { available: true; latestPeriod: string; latestPct: number; yoyPp: number | null; yoyReason?: string;
      change5yPp: number | null; change5yReason?: string; quarters: number; series: QuarterPoint[];
      source: "IMF COFER" }
  | { available: false; reason: string; source: "IMF COFER" };

export const COFER_SERIES_KEY = "G001.AFXRA.CI_USD.SHRO_PT.Q";
/** Mindestens 5 Quartale (aktuell + Vorjahresquartal), sonst n/a. */
export const COFER_MIN_QUARTERS = 5;

/**
 * Anzeige- und Cache-Parameter für F1-39.
 * Herkunft: Philip 01.11.2026 12:36 — Schwellen nur aus der Verteilung der
 * Quartalsänderungen (Median, Perzentil, z-Score), kein fester Alarmwert.
 * Peer-Position: COFER_SERIES_KEY ist eine einzelne USD-Reihe; die Position ist
 * das Perzentil dieser Änderung in der eigenen Historie, nicht eine zweite Währung.
 * Cache: Future_1_Work.md Z.461 „Quartalsweise“. Die TTL liegt unter einem Quartal,
 * damit ein neues IMF-Quartal spätestens am nächsten Tag sichtbar ist. Fehler
 * cacht die Route nicht.
 */
export const DOLLAR_RESERVE_SHARE_PARAMS = {
  cacheTtlMs: 24 * 60 * 60 * 1000,
  /** Nachkommastellen der Anzeige (Prozent und Perzentil). */
  displayDecimals: 2,
  /** Kürzung von Fehlertexten in der API-Antwort. */
  maxReasonChars: 160,
} as const;

export const DOLLAR_RESERVE_TREND_ARROW = { up: "↑", down: "↓", flat: "→" } as const;
export const DOLLAR_RESERVE_TREND_LABEL = {
  up: "über dem Median der Quartalsänderungen",
  down: "unter dem Median der Quartalsänderungen",
  flat: "auf dem Median der Quartalsänderungen",
} as const;

export interface DollarReserveShareTrend {
  /** Letzte Änderung in Prozentpunkten, nur bei direkt folgendem Quartal. */
  latestChangePp: number;
  previousPeriod: string;
  /** Midrank-Perzentil der letzten Änderung in der Historie, 0–100. */
  percentile: number;
  /** Median der Quartalsänderungen — die einzige Richtungsschwelle, aus den Daten. */
  medianChangePp: number;
  /** z-Score gegen die volle Historie (Population). null, wenn alle Änderungen gleich sind. */
  zScore: number | null;
  /** latest > Median → up, < → down, gleich → flat. */
  direction: "up" | "down" | "flat";
  changes: number;
}

/** Antwort von GET /api/macro/dollar-reserve-share. available false → reason, nie ein Ersatz-0. */
export interface DollarReserveShareResponse {
  source: "IMF COFER";
  available: boolean;
  latestPeriod?: string;
  latestPct?: number;
  quarters?: number;
  reason?: string;
  trend: DollarReserveShareTrend | null;
  trendReason: string | null;
}

const PERIOD_RE = /^\d{4}-Q[1-4]$/;

/** Alle Beobachtungen der USD-Anteil-Reihe (Quartal) aus einer SDMX-StructureSpecificData-Antwort. */
export function parseCoferUsdShare(xml: string | null | undefined): QuarterPoint[] {
  if (!xml || !xml.includes("<message:StructureSpecificData")) return [];
  const out: QuarterPoint[] = [];
  const seriesRe = /<Series\s([^>]*)>([\s\S]*?)<\/Series>/g;
  for (const m of Array.from(xml.matchAll(seriesRe))) {
    const attrs = m[1];
    const want = ['COUNTRY="G001"', 'INDICATOR="AFXRA"', 'FXR_CURRENCY="CI_USD"', 'TYPE_OF_TRANSFORMATION="SHRO_PT"', 'FREQUENCY="Q"'];
    if (!want.every(w => attrs.includes(w))) continue;
    for (const o of Array.from(m[2].matchAll(/<Obs\s([^>]*)\/?>/g))) {
      const period = /TIME_PERIOD="([^"]+)"/.exec(o[1])?.[1];
      const raw = /OBS_VALUE="([^"]+)"/.exec(o[1])?.[1];
      const value = raw == null ? NaN : Number(raw);
      if (period && PERIOD_RE.test(period) && Number.isFinite(value)) out.push({ period, value });
    }
  }
  const byPeriod = new Map(out.map(p => [p.period, p]));
  return Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
}

function shiftYears(period: string, years: number): string {
  return `${Number(period.slice(0, 4)) + years}${period.slice(4)}`;
}

function changePp(series: QuarterPoint[], latest: QuarterPoint, years: number): number | string {
  const target = shiftYears(latest.period, -years);
  const prev = series.find(p => p.period === target);
  return prev ? latest.value - prev.value : `kein Wert für ${target}`;
}

export function dollarReserveShareReading(series: QuarterPoint[]): DollarReserveShareReading {
  const s = series.filter(p => PERIOD_RE.test(p.period) && Number.isFinite(p.value))
    .slice().sort((a, b) => a.period.localeCompare(b.period));
  if (s.length === 0) return { available: false, reason: "IMF COFER: keine gültigen USD-Beobachtungen", source: "IMF COFER" };
  if (s.length < COFER_MIN_QUARTERS) {
    return { available: false, reason: `IMF COFER: zu wenig Historie (${s.length} Quartale, mindestens ${COFER_MIN_QUARTERS})`, source: "IMF COFER" };
  }
  const latest = s[s.length - 1];
  const y1 = changePp(s, latest, 1), y5 = changePp(s, latest, 5);
  if (typeof y1 === "string") return { available: false, reason: `IMF COFER: Vorjahresquartal fehlt (${y1})`, source: "IMF COFER" };
  return {
    available: true, latestPeriod: latest.period, latestPct: latest.value, yoyPp: y1,
    change5yPp: typeof y5 === "string" ? null : y5, ...(typeof y5 === "string" ? { change5yReason: y5 } : {}),
    quarters: s.length, series: s, source: "IMF COFER",
  };
}

function nextQuarter(period: string): string | null {
  const year = Number(period.slice(0, 4));
  const quarter = Number(period.slice(6));
  if (!Number.isInteger(year) || quarter < 1 || quarter > 4) return null;
  return quarter === 4 ? `${year + 1}-Q1` : `${year}-Q${quarter + 1}`;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Trend = Perzentil der letzten Quartalsänderung in der verfügbaren Historie.
 * Richtung nur relativ zum Median dieser Änderungen. Lücken zwischen Quartalen
 * zählen nicht als Änderung. Zu wenig Folgequartale → null mit Grund, nie 0.
 */
export function dollarReserveShareTrend(series: QuarterPoint[]): { trend: DollarReserveShareTrend | null; reason: string | null } {
  const byPeriod = new Map<string, QuarterPoint>();
  for (const point of series) {
    if (point && PERIOD_RE.test(point.period) && Number.isFinite(point.value)) byPeriod.set(point.period, { period: point.period, value: point.value });
  }
  const ordered = Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
  const changes: { pp: number; previousPeriod: string }[] = [];
  for (let i = 1; i < ordered.length; i++) {
    if (nextQuarter(ordered[i - 1].period) === ordered[i].period) {
      changes.push({ pp: ordered[i].value - ordered[i - 1].value, previousPeriod: ordered[i - 1].period });
    }
  }
  if (changes.length === 0) {
    return { trend: null, reason: "IMF COFER: keine aufeinanderfolgenden Quartale für den Trend" };
  }
  const steps = changes.map(change => change.pp);
  const latest = changes[changes.length - 1];
  const medianChangePp = medianOf(steps);
  let below = 0;
  let equal = 0;
  for (const step of steps) {
    if (step < latest.pp) below += 1;
    else if (step === latest.pp) equal += 1;
  }
  const mean = steps.reduce((sum, step) => sum + step, 0) / steps.length;
  const variance = steps.reduce((sum, step) => sum + (step - mean) ** 2, 0) / steps.length;
  const sd = Math.sqrt(variance);
  return {
    trend: {
      latestChangePp: latest.pp,
      previousPeriod: latest.previousPeriod,
      percentile: ((below + 0.5 * equal) / steps.length) * 100,
      medianChangePp,
      zScore: sd === 0 ? null : (latest.pp - mean) / sd,
      direction: latest.pp > medianChangePp ? "up" : latest.pp < medianChangePp ? "down" : "flat",
      changes: steps.length,
    },
    reason: null,
  };
}
