/**
 * Gewinnwachstum und Growth Gap auf Index-Ebene (WORK_RECESSION_EARNINGS_GROWTH_PLOT,
 * WORK_RECESSION_GROWTH_GAP). Nur Anzeige, kein Score.
 *
 * Schwellen kommen aus der Reihe (Median, Perzentil, z-Score) oder aus schon
 * benannten Parametern. Fehlende Werte bleiben null mit Grund, nie 0.
 */
import { INVENTORY_DEMAND_GAP_PARAMS } from "./inventory-demand-gap";
import { WINDOW_MONTHS, chartBookById } from "./recession-market-charts";
import { percentile, REST_OVERLAY_PARAMS, windowZScore, type DatedValue } from "./recession-rest-overlays";
import { RECESSION_TA_BOOKS, type RecessionTaRegion } from "./recession-ta";

/** Verhältnis → Prozent. Dieselbe Skala wie INVENTORY_DEMAND_GAP_PARAMS.percentScale. */
const PERCENT = INVENTORY_DEMAND_GAP_PARAMS.percentScale;

/**
 * Fenster der Anzeige.
 * medianWindowYears: Spec „Median der letzten 10 Jahre“, gleiche Länge wie das ISRATIO-Fenster.
 * trendYears: Spec „5Y-Trend“, gleiche Jahreszahl wie das Marktchart-Fenster 5Y (WINDOW_MONTHS["5Y"] / 12).
 * minTrendPoints: OLS mit Achsenabschnitt ist erst ab 3 Beobachtungen bestimmt.
 * annualStatementLimit: 10J-Fenster plus das Vorjahr der ersten YoY-Rate plus der FRED-Puffer.
 */
export const EARNINGS_GROWTH_PARAMS = {
  medianWindowYears: INVENTORY_DEMAND_GAP_PARAMS.windowYears,
  trendYears: WINDOW_MONTHS["5Y"] / 12,
  minTrendPoints: 3,
  annualStatementLimit: INVENTORY_DEMAND_GAP_PARAMS.windowYears + INVENTORY_DEMAND_GAP_PARAMS.fetchBufferYears + 1,
  /** Zwei Jahresdrucke, sonst gibt es keine YoY-Rate. Gleich REST_OVERLAY_PARAMS.minPoints. */
  minAnnualPrints: REST_OVERLAY_PARAMS.minPoints,
  /** TTM = vier Quartale. Abruf: TTM plus ein weiteres Jahr Puffer. */
  quartersPerYear: 4,
  minStd: INVENTORY_DEMAND_GAP_PARAMS.minStd,
  cacheTtlMs: INVENTORY_DEMAND_GAP_PARAMS.cacheTtlMs,
} as const;

export type GrowthReading = { value: number; reason: null } | { value: null; reason: string };

export interface YoyPoint {
  date: string;
  yoyPct: number;
}

export interface SkippedYear {
  date: string;
  reason: string;
}

export interface YearPrice {
  date: string;
  close: number;
}

export interface EarningsGrowthPayload {
  region: RecessionTaRegion;
  etf: string;
  earningsSymbol: string | null;
  prices: YearPrice[];
  historical: YoyPoint[];
  skipped: SkippedYear[];
  latestRealized: GrowthReading;
  forward: GrowthReading;
  gStar: GrowthReading;
  fcfToEvPct: GrowthReading;
  realisticMedian: GrowthReading;
  trend5y: GrowthReading;
  growthGap: GrowthReading;
  impliedGap: GrowthReading;
  bandLow: GrowthReading;
  bandHigh: GrowthReading;
  warning: { active: boolean; reason: string };
  notes: string[];
}

export function na(reason: string): GrowthReading {
  return { value: null, reason };
}

export function ok(value: number): GrowthReading {
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

function shiftYears(date: string, years: number): string {
  return `${String(Number(date.slice(0, 4)) + years).padStart(4, "0")}${date.slice(4)}`;
}

/** g_t = EPS_t / EPS_{t-1} − 1, in Prozent. Vorjahr 0 → ausgelassen, nicht 0. */
export function yoyFromAnnualEps(rows: { date: string; eps: number }[]): { points: YoyPoint[]; skipped: SkippedYear[] } {
  const sorted = rows
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && finite(r.eps))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const points: YoyPoint[] = [];
  const skipped: SkippedYear[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.eps === 0) {
      skipped.push({ date: cur.date, reason: `Vorjahres-EPS am ${prev.date} ist 0` });
      continue;
    }
    points.push({ date: cur.date, yoyPct: (cur.eps / prev.eps - 1) * PERCENT });
  }
  return { points, skipped };
}

/** g_fwd = EPS_Konsens / EPS_TTM − 1, in Prozent. */
export function forwardGrowthPct(consensusEps: number | null, ttmEps: number | null): GrowthReading {
  if (!finite(consensusEps)) return na("Forward-Konsens: kein EPS der Schätzungen");
  if (!finite(ttmEps)) return na("Forward-Konsens: kein TTM-EPS");
  if (ttmEps === 0) return na("Forward-Konsens: TTM-EPS ist 0");
  if (ttmEps < 0) return na("Forward-Konsens: TTM-EPS ist negativ, die Rate ist nicht als Verhältnis definiert");
  return ok((consensusEps / ttmEps - 1) * PERCENT);
}

/**
 * g* = WACC − FCF/EV, in Prozent.
 * WACC fehlt in den angebundenen Index-Quellen → n/a, nie ein angenommener Satz.
 */
export function impliedGStarPct(waccPct: number | null, fcf: number | null, ev: number | null): GrowthReading {
  if (!finite(waccPct)) return na("g*: Index-WACC liegt in keiner angebundenen Quelle (kein angenommener Satz)");
  if (!finite(fcf)) return na("g*: Free Cash Flow des Index fehlt");
  if (!finite(ev)) return na("g*: Enterprise Value des Index fehlt");
  if (ev === 0) return na("g*: Enterprise Value ist 0");
  const g = waccPct - (fcf / ev) * PERCENT;
  if (!finite(g)) return na("g*: nicht endlich");
  return ok(g);
}

export function fcfToEvPct(fcf: number | null, ev: number | null): GrowthReading {
  if (!finite(fcf)) return na("FCF/EV: Free Cash Flow fehlt");
  if (!finite(ev)) return na("FCF/EV: Enterprise Value fehlt");
  if (ev === 0) return na("FCF/EV: Enterprise Value ist 0");
  return ok((fcf / ev) * PERCENT);
}

function windowPoints(points: YoyPoint[], asOf: string): YoyPoint[] {
  if (!points.length) return [];
  const end = asOf >= points[points.length - 1].date ? asOf : points[points.length - 1].date;
  const start = shiftYears(end, -EARNINGS_GROWTH_PARAMS.medianWindowYears);
  return points.filter(p => p.date > start && p.date <= end);
}

function tooFew(label: string, n: number, need: number): GrowthReading {
  return na(`${label}: zu wenig Jahresraten (${n}, mindestens ${need})`);
}

export function realisticMedianPct(points: YoyPoint[], asOf: string): GrowthReading {
  const win = windowPoints(points, asOf);
  const need = EARNINGS_GROWTH_PARAMS.trendYears;
  if (win.length < need) return tooFew(`Median ${EARNINGS_GROWTH_PARAMS.medianWindowYears}J`, win.length, need);
  return ok(median(win.map(p => p.yoyPct)));
}

/** 5Y-Trend: angepasste Rate am letzten Punkt, OLS auf den Jahresraten im 5J-Fenster. */
export function trend5yPct(points: YoyPoint[], asOf: string): GrowthReading {
  const end = points.length ? (asOf >= points[points.length - 1].date ? asOf : points[points.length - 1].date) : asOf;
  const start = shiftYears(end, -EARNINGS_GROWTH_PARAMS.trendYears);
  const win = points.filter(p => p.date > start && p.date <= end);
  if (win.length < EARNINGS_GROWTH_PARAMS.minTrendPoints) {
    return tooFew("5Y-Trend", win.length, EARNINGS_GROWTH_PARAMS.minTrendPoints);
  }
  const n = win.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += win[i].yoyPct;
    sxx += i * i;
    sxy += i * win[i].yoyPct;
  }
  const den = n * sxx - sx * sx;
  if (!(Math.abs(den) > EARNINGS_GROWTH_PARAMS.minStd)) return na("5Y-Trend: Zeitachse ohne Streuung");
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  const fitted = a + b * (n - 1);
  if (!finite(fitted)) return na("5Y-Trend: nicht endlich");
  return ok(fitted);
}

export function subtractReadings(name: string, left: GrowthReading, right: GrowthReading): GrowthReading {
  if (left.value == null) return na(`${name}: ${left.reason}`);
  if (right.value == null) return na(`${name}: ${right.reason}`);
  return ok(left.value - right.value);
}

/**
 * Warnung, wenn der Growth Gap über dem hohen Perzentil der historischen
 * Abweichungen vom Median liegt. Die Schwelle ist dieses Perzentil, kein fester Satz.
 */
export function gapWarning(gap: GrowthReading, points: YoyPoint[], asOf: string): { active: boolean; reason: string } {
  if (gap.value == null) return { active: false, reason: gap.reason ?? "Growth Gap n/a" };
  const med = realisticMedianPct(points, asOf);
  if (med.value == null) return { active: false, reason: med.reason ?? "Median n/a" };
  const win = windowPoints(points, asOf);
  const dev = win.map(p => p.yoyPct - med.value!);
  if (dev.length < EARNINGS_GROWTH_PARAMS.trendYears) {
    return { active: false, reason: `Warnschwelle: zu wenig Abweichungen (${dev.length})` };
  }
  const sorted = dev.slice().sort((a, b) => a - b);
  const threshold = percentile(sorted, REST_OVERLAY_PARAMS.bandHighPercentile);
  const mean = dev.reduce((s, v) => s + v, 0) / dev.length;
  const variance = dev.reduce((s, v) => s + (v - mean) ** 2, 0) / (dev.length - INVENTORY_DEMAND_GAP_PARAMS.sampleDof);
  const sd = Math.sqrt(variance);
  const z = sd > EARNINGS_GROWTH_PARAMS.minStd ? (gap.value - mean) / sd : null;
  const active = gap.value > threshold;
  const zText = z == null ? "z n/a" : `z ${z.toFixed(2)}`;
  return {
    active,
    reason: active
      ? `Growth Gap ${gap.value.toFixed(1)} Pp liegt über P${REST_OVERLAY_PARAMS.bandHighPercentile} der Abweichungen vom Median (${threshold.toFixed(1)} Pp, ${zText})`
      : `Growth Gap ${gap.value.toFixed(1)} Pp liegt nicht über P${REST_OVERLAY_PARAMS.bandHighPercentile} (${threshold.toFixed(1)} Pp, ${zText})`,
  };
}

export function bandReading(points: YoyPoint[], asOf: string, p: number): GrowthReading {
  const win = windowPoints(points, asOf);
  if (win.length < EARNINGS_GROWTH_PARAMS.trendYears) return tooFew(`P${p}`, win.length, EARNINGS_GROWTH_PARAMS.trendYears);
  const sorted = win.map(x => x.yoyPct).sort((a, b) => a - b);
  return ok(percentile(sorted, p));
}

/** Letzter Schlusskurs je Kalenderjahr. */
export function yearEndCloses(bars: { date: string; close: number }[]): YearPrice[] {
  const byYear = new Map<string, YearPrice>();
  for (const b of bars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !finite(b.close) || b.close <= 0) continue;
    const prev = byYear.get(b.date.slice(0, 4));
    if (!prev || b.date > prev.date) byYear.set(b.date.slice(0, 4), { date: b.date, close: b.close });
  }
  return Array.from(byYear.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Störereignis: letzter Vol-Druck liegt am oder über dem hohen Perzentil seiner eigenen Reihe.
 * Kein fester VIX-Punktwert.
 */
export function volShock(points: DatedValue[]): { active: boolean; reason: string } {
  if (points.length < REST_OVERLAY_PARAMS.minPoints) {
    return { active: false, reason: "Störereignis n/a — Vol-Reihe zu kurz" };
  }
  const start = points[0].date;
  const end = points[points.length - 1].date;
  const z = windowZScore(points, start, end);
  if (!z) return { active: false, reason: "Störereignis n/a — Vol ohne Streuung" };
  const active = z.latest.peerPercentile >= REST_OVERLAY_PARAMS.bandHighPercentile;
  return {
    active,
    reason: active
      ? `Vol per ${z.latest.date} auf Perzentil ${z.latest.peerPercentile.toFixed(0)} (ab P${REST_OVERLAY_PARAMS.bandHighPercentile})`
      : `Vol per ${z.latest.date} auf Perzentil ${z.latest.peerPercentile.toFixed(0)}, unter P${REST_OVERLAY_PARAMS.bandHighPercentile}`,
  };
}

export function earningsBook(region: RecessionTaRegion): { etf: string; indexFallback: string | null; label: string } {
  const etf = RECESSION_TA_BOOKS[region].etf;
  const book = chartBookById(etf);
  return { etf, indexFallback: book?.indexFallback ?? null, label: RECESSION_TA_BOOKS[region].label };
}

export function assembleEarningsGrowth(input: {
  region: RecessionTaRegion;
  earningsSymbol: string | null;
  bars: { date: string; close: number }[];
  annualEps: { date: string; eps: number }[];
  forward: GrowthReading;
  gStar: GrowthReading;
  fcfToEvPct: GrowthReading;
  notes: string[];
}): EarningsGrowthPayload {
  const book = earningsBook(input.region);
  const { points, skipped } = yoyFromAnnualEps(input.annualEps);
  const asOf = input.bars.length ? input.bars[input.bars.length - 1].date : (points[points.length - 1]?.date ?? "");
  const latest = points.length ? ok(points[points.length - 1].yoyPct) : na(input.notes.find(n => n.includes("EPS")) ?? "historisches EPS YoY: keine Jahresraten");
  const realisticMedian = realisticMedianPct(points, asOf);
  const trend5y = trend5yPct(points, asOf);
  const growthGap = subtractReadings("Growth Gap", input.forward, latest);
  const impliedGap = subtractReadings("Implied Gap", input.gStar, latest);
  return {
    region: input.region,
    etf: book.etf,
    earningsSymbol: input.earningsSymbol,
    prices: yearEndCloses(input.bars),
    historical: points,
    skipped,
    latestRealized: latest,
    forward: input.forward,
    gStar: input.gStar,
    fcfToEvPct: input.fcfToEvPct,
    realisticMedian,
    trend5y,
    growthGap,
    impliedGap,
    bandLow: bandReading(points, asOf, REST_OVERLAY_PARAMS.bandLowPercentile),
    bandHigh: bandReading(points, asOf, REST_OVERLAY_PARAMS.bandHighPercentile),
    warning: gapWarning(growthGap, points, asOf),
    notes: input.notes,
  };
}
