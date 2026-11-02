/**
 * Earnings Yield und ROIC als Anzeige-Serien.
 * Earnings Yield = TTM-EPS / Kurs, je Kerze. ROIC = letzter berichteter Wert zum Filing-Datum.
 * Kein Score, kein Rating. Fehlende Werte bleiben null mit Grund, nie 0.
 * Schwellen der Achse kommen aus der Serie (Quartile), Gewichte sind benannt.
 */

export const EARNINGS_YIELD_SOURCE = "FMP income-statement period=quarter epsDiluted";
export const ROIC_SOURCE = "FMP key-metrics returnOnInvestedCapital";
export const EARNINGS_YIELD_FORMULA = "TTM-EPS / Kurs";
export const ROIC_FORMULA = "letzter berichteter ROIC zum Filing-Datum";
export const ROIC_TTM_FORMULA = "Summe der Quartals-ROIC über das aus den Abständen abgeleitete Jahresfenster";
export const ROIC_5Y_FORMULA = "Mittelwert der Quartals-ROIC-TTM über die letzten 5 Jahre";
export const ROIC_ANNUAL_FORMULA = "Jahres-ROIC zum Filing-Datum";
export const ROIC_TTM_LABEL = "ROIC TTM";
export const ROIC_5Y_LABEL = "ROIC 5Y";
export const ROIC_ANNUAL_LABEL = "ROIC Jahr";

/** Nur die Abruf-Tiefe (Jahre × dieses Fenster). Die Mindestzahl der Quartale einer Serie kommt aus den Abständen. */
export const TTM_QUARTER_COUNT = 4;
/** Kalendertage, aus denen die Quartalszahl eines Jahresfensters abgeleitet wird. */
export const FISCAL_YEAR_DAYS = 365;
/** Ein Folgeschritt gilt als dasselbe Raster, solange er höchstens das Vielfache des Median-Abstands ist. */
export const PERIOD_GAP_FACTOR = 1.6;
/** Sichtbare Chart-Spanne, die die Fundamentalhistorie abdecken können muss. */
export const OVERLAY_HISTORY_YEARS = 10;
/** Rollierender ROIC-Mittelwert. Dieselben Jahre liegen vor dem Chart-Rand als Vorlauf. */
export const ROIC_LOOKBACK_YEARS = 5;
/** Vorlauf vor dem 10Y-Rand, damit der 5J-ROIC am linken Rand schon steht. */
export const OVERLAY_WARMUP_YEARS = ROIC_LOOKBACK_YEARS;
export const FUNDAMENTAL_ANNUAL_LIMIT = OVERLAY_HISTORY_YEARS + OVERLAY_WARMUP_YEARS;
export const FUNDAMENTAL_QUARTER_LIMIT = FUNDAMENTAL_ANNUAL_LIMIT * TTM_QUARTER_COUNT;

/** Polster, wenn eine Serie keinen Streu (IQR und Spanne 0) hat. Benannter Anzeige-Parameter. */
export const FLAT_SERIES_PAD_SHARE = 0.05;

export interface FundamentalPoint {
  date: string;
  value: number | null;
  note: string | null;
}

/** Ein berichtetes Quartals-EPS. asOf ist das Filing-Datum, nicht das Periodenende. */
export interface EpsQuarter {
  periodEnd: string;
  asOf: string;
  eps: number;
  currency: string | null;
  /** Sichtbare Herkunft dieses Quartals, z. B. Yahoo oder FMP-Symbol. */
  source?: string | null;
}

/** Bereits summiertes TTM-EPS (z. B. Yahoo trailingDilutedEPS). Kein Quartal, wird nicht noch einmal addiert. */
export interface TtmPrint {
  asOf: string;
  eps: number;
  currency: string | null;
  source?: string | null;
}

export interface EarningsYieldResponse {
  symbol: string;
  /** date = asOf, value = Quartals-EPS. Der Yield wird je Kerze daraus gerechnet. */
  points: FundamentalPoint[];
  quarters: EpsQuarter[];
  /** Fertiges TTM. Ersatz, wenn das Quartalsfenster nicht steht. */
  ttmPrints: TtmPrint[];
  /** Jahres-EPS. Ersatz nach dem trailing EPS. */
  annualEps: TtmPrint[];
  /** Tageskurse der EPS-Währung gegen USD, damit die Kerze nicht einen Spotkurs für die ganze Historie benutzt. */
  fxHistory?: FxObservation[];
  formula: string;
  source: string;
  note: string | null;
}

export interface RoicSeriesResponse {
  symbol: string;
  /** date = Filing-Datum, value = ROIC in % (TTM-Summe oder Jahreswert). */
  points: FundamentalPoint[];
  formula: string;
  label: string;
  source: string;
  note: string | null;
}

/** Ein Tageskurs der Wechselkursreihe. */
export interface FxObservation {
  date: string;
  rate: number;
  source: string;
}

/**
 * Listing-FX. `rate` ist der Kurs, der schon in der Chart-Historie steckt.
 * `history` ersetzt ihn je Kerze. Ohne Tageskurs kein fester Ersatzkurs.
 */
export interface PriceFx {
  from: string;
  to: string;
  rate: number;
  history?: FxObservation[] | null;
  /** Kerzentag, zu dem `history` gelesen wird. */
  asOf?: string;
}

export interface RoicPeriod {
  asOf: string;
  periodEnd: string;
  value: number;
}

export interface FundJoinPoint {
  date: string;
  earningsYieldPct: number | null;
  earningsYieldNote: string | null;
  roicPct: number | null;
  roicNote: string | null;
  /** Gezeichnet, wenn der Peer-ROIC-Modus an ist. */
  peerRoicPct: number | null;
  /** Wert unabhängig vom Modus, für den Tooltip. */
  peerRoicKnown: number | null;
  peerRoicNote: string | null;
  /** Peer-Kurs auf den Median des Basiskurses gezogen. null = nicht gezeichnet. */
  peerPriceIndexed: number | null;
  peerPriceRaw: number | null;
  peerPriceNote: string | null;
  /** Zähler des Earnings Yield an dieser Kerze. */
  earningsYieldEps: number | null;
  earningsYieldEpsDate: string | null;
  earningsYieldSource: string | null;
  /** Gesetzt, wenn das TTM unvollständig oder geschätzt ist. */
  earningsYieldBadge: string | null;
}

export function finiteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function earningsYieldPct(ebit: number | null, enterpriseValue: number | null): { value: number | null; note: string | null } {
  if (ebit == null || !Number.isFinite(ebit)) return { value: null, note: "n/a — EBIT fehlt" };
  if (enterpriseValue == null || !Number.isFinite(enterpriseValue) || enterpriseValue <= 0) {
    return { value: null, note: "n/a — Enterprise Value fehlt oder nicht positiv" };
  }
  return { value: (ebit / enterpriseValue) * 100, note: null };
}

/** Perzentil einer aufsteigend sortierten Stichprobe. p = 0 … 1. */
export function quantileSorted(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = Math.min(sorted.length - 1, Math.max(0, p * (sorted.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function medianOf(values: number[]): number | null {
  const xs = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  return quantileSorted(xs, 0.5);
}

/**
 * Rechte %-Achse. Spanne aus der Serie, Polster = halber Interquartilsabstand.
 * Keine feste Untergrenze und kein Ersatz durch 0.
 */
export function percentAxisDomain(values: Array<number | null | undefined>): [number, number] {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return [0, 1];
  const lo = xs[0];
  const hi = xs[xs.length - 1];
  const q1 = quantileSorted(xs, 0.25) ?? lo;
  const q3 = quantileSorted(xs, 0.75) ?? hi;
  const iqr = q3 - q1;
  const span = hi - lo;
  const med = quantileSorted(xs, 0.5) ?? lo;
  const pad = iqr > 0 ? iqr / 2 : span > 0 ? span / 2 : (Math.abs(med) * FLAT_SERIES_PAD_SHARE || 1);
  return [lo - pad, hi + pad];
}

export function medianIndexScale(subjectCloses: number[], peerCloses: number[]): { scale: number | null; note: string | null } {
  const subject = medianOf(subjectCloses.filter(v => v > 0));
  const peer = medianOf(peerCloses.filter(v => v > 0));
  if (subject == null || peer == null || peer === 0) {
    return { scale: null, note: "n/a — Median von Kurs oder Peer-Kurs fehlt" };
  }
  return { scale: subject / peer, note: null };
}

function isoDayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

/** Ältestes Periodenende, das der Abruf noch enthalten muss (Chart-Spanne plus ROIC-Vorlauf). */
export function overlayHistoryStart(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCFullYear(d.getUTCFullYear() - FUNDAMENTAL_ANNUAL_LIMIT);
  return d.toISOString().slice(0, 10);
}

function lookbackStart(asOf: string, years: number): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return asOf;
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/**
 * Jahresfenster aus dem Median der Periodenabstände. Zwei Punkte reichen zum Ableiten.
 * Kein fester Quartalszähler: ein Jahresraster ergibt 1, ein Quartalsraster etwa 4.
 */
export function derivedQuarterWindow(periodEnds: string[]): { count: number; maxGapDays: number } | null {
  const ends = Array.from(new Set(periodEnds.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)))).sort((a, b) => a.localeCompare(b));
  const gaps: number[] = [];
  for (let i = 1; i < ends.length; i++) {
    const gap = isoDayNumber(ends[i]) - isoDayNumber(ends[i - 1]);
    if (gap > 0) gaps.push(gap);
  }
  const med = medianOf(gaps);
  if (med == null || !(med > 0)) return null;
  const count = Math.max(1, Math.round(FISCAL_YEAR_DAYS / med));
  return { count, maxGapDays: med * PERIOD_GAP_FACTOR };
}

/**
 * TTM-EPS aus den letzten Perioden, deren Filing am Stichtag bekannt ist.
 * Die Fensterlänge kommt aus den Abständen. Eine Lücke lässt die Summe leer.
 */
export function ttmEpsAt(quarters: EpsQuarter[], asOf: string): { eps: number | null; currency: string | null; note: string | null; maxAbs: number | null } {
  const known = new Map<string, EpsQuarter>();
  for (const quarter of quarters) {
    if (!quarter || quarter.asOf > asOf || !Number.isFinite(quarter.eps)) continue;
    const prev = known.get(quarter.periodEnd);
    if (!prev || quarter.asOf >= prev.asOf) known.set(quarter.periodEnd, quarter);
  }
  const ordered = Array.from(known.values()).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const window = derivedQuarterWindow(ordered.map(q => q.periodEnd));
  if (!window) {
    return { eps: null, currency: null, note: "n/a — Warmup, Abstand der Quartale nicht ableitbar", maxAbs: null };
  }
  if (ordered.length < window.count) {
    return { eps: null, currency: null, note: `n/a — Warmup, weniger als ${window.count} Quartale`, maxAbs: null };
  }
  const last = ordered.slice(-window.count);
  for (let i = 1; i < last.length; i++) {
    const gap = isoDayNumber(last[i].periodEnd) - isoDayNumber(last[i - 1].periodEnd);
    if (!(gap > 0 && gap <= window.maxGapDays)) {
      return { eps: null, currency: null, note: "n/a — Lücke in der Quartalshistorie, TTM nicht gebildet", maxAbs: null };
    }
  }
  const currencies = new Set(last.map(q => q.currency?.trim().toUpperCase()).filter((c): c is string => !!c));
  if (currencies.size > 1) return { eps: null, currency: null, note: "n/a — Währung der Quartals-EPS weicht ab", maxAbs: null };
  const eps = last.reduce((sum, quarter) => sum + quarter.eps, 0);
  if (!Number.isFinite(eps)) return { eps: null, currency: null, note: "n/a — TTM-EPS nicht berechenbar", maxAbs: null };
  const sources = Array.from(new Set(last.map(q => q.source).filter((s): s is string => !!s && s.trim() !== "")));
  const maxAbs = last.reduce((max, quarter) => Math.max(max, Math.abs(quarter.eps)), 0);
  return { eps, currency: last.find(q => q.currency)?.currency ?? null, note: sources.length ? `Quelle: ${sources.join(" + ")}` : null, maxAbs };
}

/** Sichtbarer Kurztext, wenn das trailing EPS die Stelle füllt. */
export function trailingEpsLabel(source: string | null | undefined): string {
  const src = source?.trim();
  return src ? `trailing EPS · Quelle: ${src}` : "trailing EPS";
}

/** Badge, wenn das Fenster nicht vollständig ist oder ein Quartal aus dem Jahres-EPS geschätzt wird. */
export const TTM_INCOMPLETE_BADGE = "Schätzung / TTM unvollständig";
/**
 * Ein einzelnes Quartal auf die TTM-Skala heben. Vier Quartale sind das Jahresfenster,
 * derselbe Zähler wie eine Quartalssumme. Kein stiller Faktor.
 */
export const QUARTER_ANNUALIZATION_FACTOR = 4;
/** Badge, wenn der Yield aus einem annualisierten Einzelquartal kommt. */
export const QUARTER_ANNUALIZED_BADGE = "Schätzung: Quartal annualisiert";

export function quarterAnnualizedFormula(factor: number = QUARTER_ANNUALIZATION_FACTOR): string {
  return `jüngstes Quartals-EPS × ${factor} / Kurs`;
}
/** Herkunft eines Quartals, das als Rest aus Jahres-EPS und den bekannten Quartalen steht. */
export const ANNUAL_RESIDUAL_SOURCE = "Schätzung: Jahres-EPS minus bekannte Quartale";

export interface EpsNumerator {
  eps: number | null;
  currency: string | null;
  note: string | null;
  /** Stichtag des Zählers. */
  asOf: string | null;
  source: string | null;
  formula: string;
  /** true, wenn das Fenster nicht voll ist oder ein Quartal geschätzt wurde. */
  incomplete: boolean;
  badge: string | null;
  /** Roh-EPS für den Tooltip, wenn der Zähler annualisiert ist. */
  displayEps: number | null;
}

function latestQuarterAt(quarters: EpsQuarter[], asOf: string): EpsQuarter | null {
  let hit: EpsQuarter | null = null;
  for (const quarter of quarters) {
    if (!quarter || quarter.asOf > asOf || !Number.isFinite(quarter.eps)) continue;
    if (!hit || quarter.periodEnd > hit.periodEnd || (quarter.periodEnd === hit.periodEnd && quarter.asOf >= hit.asOf)) hit = quarter;
  }
  return hit;
}

function addIsoDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

function knownQuarters(quarters: EpsQuarter[], asOf: string): EpsQuarter[] {
  const known = new Map<string, EpsQuarter>();
  for (const quarter of quarters) {
    if (!quarter || quarter.asOf > asOf || !Number.isFinite(quarter.eps)) continue;
    const prev = known.get(quarter.periodEnd);
    if (!prev || quarter.asOf >= prev.asOf) known.set(quarter.periodEnd, quarter);
  }
  return Array.from(known.values()).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

/** Ein erwartetes Quartalsende gilt als getroffen, solange es höchstens einen halben Schritt daneben liegt. */
function quarterEndMatches(periodEnd: string, expected: string, stepDays: number): boolean {
  return Math.abs(isoDayNumber(periodEnd) - isoDayNumber(expected)) <= stepDays / 2;
}

function singleMissingPeriodEnd(ordered: EpsQuarter[], yearEnd: string, count: number, stepDays: number): string | null {
  const expected: string[] = [];
  for (let i = count - 1; i >= 0; i--) expected.push(addIsoDays(yearEnd, -Math.round(stepDays * i)));
  const used = new Set<string>();
  const missing: string[] = [];
  for (const stamp of expected) {
    const hit = ordered.find(q => !used.has(q.periodEnd) && quarterEndMatches(q.periodEnd, stamp, stepDays));
    if (hit) used.add(hit.periodEnd);
    else missing.push(stamp);
  }
  if (missing.length !== 1) return null;
  if (ordered.some(q => q.periodEnd === missing[0])) return null;
  return missing[0];
}

/**
 * Fehlt in einem Geschäftsjahr genau ein Quartal, ist der Rest Jahres-EPS minus die bekannten Quartale.
 * Zwei fehlende Quartale werden nicht aufgeteilt. Der Rest gilt erst ab dem Jahres-Stichtag.
 */
export function fillSingleGapFromAnnual(quarters: EpsQuarter[], annual: TtmPrint[], asOf: string): EpsQuarter[] {
  const known = knownQuarters(quarters, asOf);
  const years = annual
    .filter(row => row && row.asOf <= asOf && Number.isFinite(row.eps))
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
  const spacing = derivedQuarterWindow(known.map(q => q.periodEnd));
  const count = spacing?.count ?? TTM_QUARTER_COUNT;
  const stepDays = spacing && spacing.count > 0 ? FISCAL_YEAR_DAYS / spacing.count : FISCAL_YEAR_DAYS / TTM_QUARTER_COUNT;
  const added: EpsQuarter[] = [];
  for (let i = 0; i < years.length; i++) {
    const year = years[i];
    const start = i > 0 ? years[i - 1].asOf : addIsoDays(year.asOf, -Math.round(FISCAL_YEAR_DAYS));
    const inYear = known.filter(q => q.periodEnd > start && q.periodEnd <= year.asOf);
    if (inYear.length !== count - 1) continue;
    const ordered = [...inYear].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    const missing = singleMissingPeriodEnd(ordered, year.asOf, count, stepDays);
    if (!missing || known.some(q => q.periodEnd === missing) || added.some(q => q.periodEnd === missing)) continue;
    const yearCode = year.currency?.trim().toUpperCase() ?? "";
    const quarterCodes = new Set(ordered.map(q => q.currency?.trim().toUpperCase()).filter((c): c is string => !!c));
    if (yearCode && quarterCodes.size > 0 && !quarterCodes.has(yearCode)) continue;
    const residual = year.eps - ordered.reduce((sum, q) => sum + q.eps, 0);
    if (!Number.isFinite(residual)) continue;
    added.push({
      periodEnd: missing,
      asOf: year.asOf,
      eps: residual,
      currency: year.currency ?? ordered.find(q => q.currency)?.currency ?? null,
      source: year.source ? `${ANNUAL_RESIDUAL_SOURCE} · ${year.source}` : ANNUAL_RESIDUAL_SOURCE,
    });
  }
  return [...known, ...added].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd) || a.asOf.localeCompare(b.asOf));
}

/** Jüngstes lückenloses Fenster. Eine Lücke am rechten Rand lässt ein älteres vollständiges Fenster stehen. */
export function latestCompleteQuarterSum(quarters: EpsQuarter[], asOf: string): {
  eps: number;
  currency: string | null;
  note: string | null;
  periodEnd: string;
  asOf: string;
  source: string | null;
  incomplete: boolean;
  maxAbs: number;
} | null {
  const ordered = knownQuarters(quarters, asOf);
  const window = derivedQuarterWindow(ordered.map(q => q.periodEnd));
  if (!window || ordered.length < window.count) return null;
  for (let end = ordered.length - 1; end >= window.count - 1; end--) {
    const slice = ordered.slice(end - window.count + 1, end + 1);
    let open = false;
    for (let i = 1; i < slice.length; i++) {
      const gap = isoDayNumber(slice[i].periodEnd) - isoDayNumber(slice[i - 1].periodEnd);
      if (!(gap > 0 && gap <= window.maxGapDays)) open = true;
    }
    if (open) continue;
    const currencies = new Set(slice.map(q => q.currency?.trim().toUpperCase()).filter((c): c is string => !!c));
    if (currencies.size > 1) continue;
    const eps = slice.reduce((sum, quarter) => sum + quarter.eps, 0);
    if (!Number.isFinite(eps)) continue;
    const sources = Array.from(new Set(slice.map(q => q.source).filter((s): s is string => !!s && s.trim() !== "")));
    const maxAbs = slice.reduce((max, quarter) => Math.max(max, Math.abs(quarter.eps)), 0);
    return {
      eps,
      currency: slice.find(q => q.currency)?.currency ?? null,
      note: sources.length ? `Quelle: ${sources.join(" + ")}` : null,
      periodEnd: slice[slice.length - 1].periodEnd,
      asOf: slice[slice.length - 1].asOf,
      source: sources.join(" + ") || null,
      incomplete: slice.some(q => (q.source ?? "").includes("Schätzung")),
      maxAbs,
    };
  }
  return null;
}

function numeratorFrom(eps: number | null, currency: string | null, asOf: string | null, source: string | null, formula: string, incomplete: boolean, note: string | null, badge: string | null = null, displayEps: number | null = null): EpsNumerator {
  return { eps, currency, asOf, source, formula, incomplete, note, badge, displayEps };
}

/**
 * Zähler je Kerze. Zuerst ein aufgefülltes Quartalsfenster, sonst das jüngste vollständige Fenster.
 * Ein positives trailing EPS verdeckt kein jüngeres negatives Quartal: das jüngere Datum hat Vorrang.
 */
export function epsNumeratorAt(
  quarters: EpsQuarter[],
  trailing: TtmPrint[],
  annual: TtmPrint[],
  asOf: string,
): EpsNumerator {
  const filled = fillSingleGapFromAnnual(quarters, annual, asOf);
  const complete = latestCompleteQuarterSum(filled, asOf);
  const trail = ttmPrintAt(trailing, asOf);
  const trailPrint = trailing.filter(row => row && row.asOf <= asOf && Number.isFinite(row.eps)).sort((a, b) => a.asOf.localeCompare(b.asOf)).pop() ?? null;
  const latest = latestQuarterAt(quarters, asOf);
  const reported = ttmEpsAt(quarters, asOf);
  const agrees = complete == null || trail.eps == null || Math.abs(complete.eps - trail.eps) <= complete.maxAbs;
  const endsAtLatest = complete != null && latest != null && complete.periodEnd === latest.periodEnd;
  if (complete && endsAtLatest && (agrees || complete.eps < 0 || complete.incomplete)) {
    const badge = complete.incomplete ? TTM_INCOMPLETE_BADGE : null;
    return numeratorFrom(complete.eps, complete.currency, complete.asOf, complete.source, EARNINGS_YIELD_FORMULA, complete.incomplete, [complete.note, badge].filter((part): part is string => !!part).join(" · ") || null, badge);
  }
  const positiveTrailWouldCover = latest != null && latest.eps < 0 && trail.eps != null && trail.eps > 0 && trail.asOf != null && latest.asOf >= trail.asOf;
  const olderWindow = complete != null && latest != null && latest.eps < 0 && complete.periodEnd < latest.periodEnd;
  if (latest && latest.eps < 0 && (positiveTrailWouldCover || olderWindow || (complete == null && (trail.eps == null || trail.eps > 0)))) {
    const src = latest.source ?? null;
    const annualized = latest.eps * QUARTER_ANNUALIZATION_FACTOR;
    return numeratorFrom(
      annualized,
      latest.currency,
      latest.asOf,
      src,
      quarterAnnualizedFormula(),
      true,
      [`EPS ${latest.eps} am ${latest.asOf}`, src ? `Quelle: ${src}` : null, QUARTER_ANNUALIZED_BADGE].filter((part): part is string => !!part).join(" · "),
      QUARTER_ANNUALIZED_BADGE,
      latest.eps,
    );
  }
  if (complete && agrees) {
    const badge = complete.incomplete ? TTM_INCOMPLETE_BADGE : null;
    return numeratorFrom(complete.eps, complete.currency, complete.asOf, complete.source, EARNINGS_YIELD_FORMULA, complete.incomplete, [complete.note, badge].filter((part): part is string => !!part).join(" · ") || null, badge);
  }
  if (trail.eps != null) {
    const why = reported.eps != null
      ? `Quartalssumme ${reported.eps} weicht vom berichteten TTM ab`
      : (reported.note ?? "Quartalsfenster nicht gebildet");
    return numeratorFrom(trail.eps, trail.currency, trailPrint?.asOf ?? null, trail.source, EARNINGS_YIELD_FORMULA, false, `Fallback: ${trailingEpsLabel(trail.source)} (${why})`);
  }
  const year = ttmPrintAt(annual, asOf);
  const yearPrint = annual.filter(row => row && row.asOf <= asOf && Number.isFinite(row.eps)).sort((a, b) => a.asOf.localeCompare(b.asOf)).pop() ?? null;
  if (year.eps != null) {
    const base = `Fallback: Jahres-EPS (${reported.note ?? "Quartalsfenster nicht gebildet"})`;
    return numeratorFrom(year.eps, year.currency, yearPrint?.asOf ?? null, year.source, EARNINGS_YIELD_FORMULA, false, year.source ? `${base} · Quelle: ${year.source}` : base);
  }
  return numeratorFrom(null, null, null, null, EARNINGS_YIELD_FORMULA, false, reported.note);
}

function sameCurrency(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim().toUpperCase();
  const right = (b ?? "").trim().toUpperCase();
  if (!left || !right) return true;
  return left === right;
}

/** Ergänzt fehlende Perioden. Eine andere Währung wird nicht in die Reihe gemischt. */
export function supplementQuarters(primary: EpsQuarter[], extra: EpsQuarter[]): { quarters: EpsQuarter[]; added: number; heldBack: string | null } {
  const have = new Set(primary.map(q => q.periodEnd));
  const primaryCcy = primary.find(q => q.currency)?.currency ?? null;
  const added: EpsQuarter[] = [];
  let foreign: string | null = null;
  for (const row of extra) {
    if (!row.periodEnd || have.has(row.periodEnd)) continue;
    if (!sameCurrency(primaryCcy, row.currency)) {
      foreign = `FMP-Währung ${row.currency} nicht mit ${primaryCcy} gemischt`;
      continue;
    }
    added.push(row);
    have.add(row.periodEnd);
  }
  const quarters = [...primary, ...added].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd) || a.asOf.localeCompare(b.asOf));
  return { quarters, added: added.length, heldBack: added.length > 0 ? null : foreign };
}

export function supplementPrints(primary: TtmPrint[], extra: TtmPrint[]): { prints: TtmPrint[]; added: number; heldBack: string | null } {
  const have = new Set(primary.map(p => p.asOf));
  const primaryCcy = primary.find(p => p.currency)?.currency ?? null;
  const added: TtmPrint[] = [];
  let foreign: string | null = null;
  for (const row of extra) {
    if (!row.asOf || have.has(row.asOf)) continue;
    if (!sameCurrency(primaryCcy, row.currency)) {
      foreign = `FMP-Währung ${row.currency} nicht mit ${primaryCcy} gemischt`;
      continue;
    }
    added.push(row);
    have.add(row.asOf);
  }
  return { prints: [...primary, ...added].sort((a, b) => a.asOf.localeCompare(b.asOf)), added: added.length, heldBack: added.length > 0 ? null : foreign };
}

/** Letzter berichteter TTM-Druck mit asOf <= Stichtag. Kein Auffüllen zwischen den Drucken über eine Schätzung. */
export function ttmPrintAt(prints: TtmPrint[], asOf: string): { eps: number | null; currency: string | null; source: string | null; asOf: string | null } {
  let hit: TtmPrint | null = null;
  for (const print of prints) {
    if (!print || print.asOf > asOf || !Number.isFinite(print.eps)) continue;
    if (!hit || print.asOf >= hit.asOf) hit = print;
  }
  return hit ? { eps: hit.eps, currency: hit.currency, source: hit.source ?? null, asOf: hit.asOf } : { eps: null, currency: null, source: null, asOf: null };
}

function ccyCode(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

/** Letzter Wechselkurs mit Datum <= Stichtag. Kein Auffüllen nach vorn. */
export function fxObservationAt(history: FxObservation[] | null | undefined, asOf: string): FxObservation | null {
  let hit: FxObservation | null = null;
  for (const row of history ?? []) {
    if (!row || row.date > asOf || !(row.rate > 0)) continue;
    if (!hit || row.date >= hit.date) hit = row;
  }
  return hit;
}

export function earningsYieldFromTtm(
  ttmEps: number,
  close: number,
  epsCurrency: string | null,
  priceCurrency: string | null,
  fx: PriceFx | null = null,
): { value: number | null; note: string | null } {
  if (!Number.isFinite(ttmEps)) return { value: null, note: "n/a — TTM-EPS fehlt" };
  if (!Number.isFinite(close) || close <= 0) return { value: null, note: "n/a — Kurs fehlt oder nicht positiv" };
  const epsCode = ccyCode(epsCurrency);
  const priceCode = ccyCode(priceCurrency);
  let eps = ttmEps;
  let price = close;
  let fxNote: string | null = null;
  if (epsCode && priceCode && epsCode !== priceCode) {
    const from = ccyCode(fx?.from);
    const to = ccyCode(fx?.to);
    const day = fx?.history ? fxObservationAt(fx.history, fx.asOf ?? "") : null;
    if (day && from === epsCode && to === priceCode) {
      const scale = fx && fx.rate > 0 ? fx.rate : day.rate;
      eps = ttmEps * day.rate;
      price = close / scale * day.rate;
      fxNote = `${fx?.from ?? ""}${fx?.to ?? ""} ${day.rate} am ${day.date}, Quelle ${day.source}`;
    } else if (!fx?.history && fx && from === epsCode && to === priceCode && fx.rate > 0) {
      eps = ttmEps * fx.rate;
      fxNote = `Fallback: EPS ${epsCurrency} × ${fx.from}${fx.to} ${fx.rate} auf Kurswährung ${priceCurrency}`;
    } else if (fx?.history) {
      return { value: null, note: `n/a — kein ${fx.from}${fx.to} bis ${fx.asOf ?? "zum Stichtag"}` };
    } else {
      return { value: null, note: `n/a — EPS in ${epsCurrency}, Kurs in ${priceCurrency}` };
    }
  }
  const value = (eps / price) * 100;
  if (!Number.isFinite(value)) return { value: null, note: "n/a — Earnings Yield nicht berechenbar" };
  return { value, note: fxNote };
}

const ROIC_ANNUAL_FALLBACK = "Fallback: Jahres-ROIC, Quartalsfenster unvollständig";

/**
 * Quartals-ROIC als TTM-Summe, sobald das abgeleitete Jahresfenster lückenlos bekannt ist.
 * Davor und bei Lücken der letzte Jahreswert. Reine Jahresreihe bleibt Jahres-ROIC.
 * Stichtag ist das Filing, nicht das Periodenende.
 */
export function annualizedRoicSeries(quarters: RoicPeriod[], annuals: RoicPeriod[]): {
  points: FundamentalPoint[];
  formula: string;
  label: string;
  note: string | null;
} {
  const q = quarters.filter(row => row.asOf && row.periodEnd && Number.isFinite(row.value))
    .sort((a, b) => a.asOf.localeCompare(b.asOf) || a.periodEnd.localeCompare(b.periodEnd));
  const a = annuals.filter(row => row.asOf && Number.isFinite(row.value))
    .sort((a1, b1) => a1.asOf.localeCompare(b1.asOf) || a1.periodEnd.localeCompare(b1.periodEnd));
  const dates = Array.from(new Set([...q.map(row => row.asOf), ...a.map(row => row.asOf)])).sort((x, y) => x.localeCompare(y));
  const points: FundamentalPoint[] = [];
  let sawTtm = false;
  let sawAnnualFallback = false;
  for (const date of dates) {
    const known = q.filter(row => row.asOf <= date).sort((x, y) => x.periodEnd.localeCompare(y.periodEnd));
    const window = derivedQuarterWindow(known.map(row => row.periodEnd));
    let value: number | null = null;
    let note: string | null = null;
    if (window && known.length >= window.count) {
      const last = known.slice(-window.count);
      let open = false;
      for (let i = 1; i < last.length; i++) {
        const gap = isoDayNumber(last[i].periodEnd) - isoDayNumber(last[i - 1].periodEnd);
        if (!(gap > 0 && gap <= window.maxGapDays)) open = true;
      }
      if (!open) {
        value = +last.reduce((sum, row) => sum + row.value, 0).toFixed(1);
        sawTtm = true;
      }
    }
    if (value == null) {
      const year = a.filter(row => row.asOf <= date).pop();
      if (year) {
        value = year.value;
        note = q.length > 0 ? ROIC_ANNUAL_FALLBACK : null;
        if (q.length > 0) sawAnnualFallback = true;
      }
    }
    if (value == null || !Number.isFinite(value)) continue;
    const prev = points[points.length - 1];
    if (prev && prev.date === date) {
      points[points.length - 1] = { date, value, note };
    } else if (!prev || prev.value !== value || prev.note !== note) {
      points.push({ date, value, note });
    }
  }
  if (points.length === 0) {
    return { points: [], formula: ROIC_ANNUAL_FORMULA, label: ROIC_ANNUAL_LABEL, note: "n/a — ROIC nicht annualisierbar" };
  }
  const note = sawTtm && sawAnnualFallback
    ? "Wo das Quartalsfenster fehlt, steht der Jahres-ROIC (Fallback)."
    : null;
  return sawTtm
    ? { points, formula: ROIC_TTM_FORMULA, label: ROIC_TTM_LABEL, note }
    : { points, formula: ROIC_ANNUAL_FORMULA, label: ROIC_ANNUAL_LABEL, note: null };
}

function quarterTtmValue(known: RoicPeriod[]): number | null {
  const window = derivedQuarterWindow(known.map(row => row.periodEnd));
  if (!window || known.length < window.count) return null;
  const last = known.slice(-window.count);
  for (let i = 1; i < last.length; i++) {
    const gap = isoDayNumber(last[i].periodEnd) - isoDayNumber(last[i - 1].periodEnd);
    if (!(gap > 0 && gap <= window.maxGapDays)) return null;
  }
  const sum = last.reduce((total, row) => total + row.value, 0);
  return Number.isFinite(sum) ? +sum.toFixed(1) : null;
}

/**
 * Je Filing: TTM aus den Quartalen, und sobald das 5J-Fenster voll ist der Mittelwert
 * dieser TTM-Werte. Keine Jahresreihe, nichts wird zwischen den Filings geschätzt.
 */
export function rollingRoicSeries(quarters: RoicPeriod[]): {
  points: FundamentalPoint[];
  formula: string;
  label: string;
  note: string | null;
} {
  const q = quarters.filter(row => row.asOf && row.periodEnd && Number.isFinite(row.value))
    .sort((a, b) => a.asOf.localeCompare(b.asOf) || a.periodEnd.localeCompare(b.periodEnd));
  const dates = Array.from(new Set(q.map(row => row.asOf))).sort((a, b) => a.localeCompare(b));
  const snapshots: Array<{ date: string; ttm: number }> = [];
  const points: FundamentalPoint[] = [];
  let sawFiveYear = false;
  for (const date of dates) {
    const known = q.filter(row => row.asOf <= date).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    const ttm = quarterTtmValue(known);
    if (ttm == null) continue;
    snapshots.push({ date, ttm });
    const start = lookbackStart(date, ROIC_LOOKBACK_YEARS);
    const oldest = known[0]?.periodEnd ?? date;
    const full = oldest <= start;
    const inWindow = snapshots.filter(row => row.date >= start && row.date <= date);
    const value = full && inWindow.length > 0
      ? +(inWindow.reduce((total, row) => total + row.ttm, 0) / inWindow.length).toFixed(1)
      : ttm;
    if (full) sawFiveYear = true;
    const formula = full ? ROIC_5Y_FORMULA : ROIC_TTM_FORMULA;
    points.push({ date, value, note: `Formel: ${formula}` });
  }
  if (points.length === 0) {
    return { points: [], formula: ROIC_TTM_FORMULA, label: ROIC_TTM_LABEL, note: "n/a — keine Quartals-ROIC für TTM oder 5J-Mittel" };
  }
  return sawFiveYear
    ? { points, formula: ROIC_5Y_FORMULA, label: ROIC_5Y_LABEL, note: "Frühe Punkte bleiben ROIC TTM, bis das 5J-Fenster voll ist." }
    : { points, formula: ROIC_TTM_FORMULA, label: ROIC_TTM_LABEL, note: "5J-Fenster noch nicht voll, gezeichnet ist die Quartals-TTM." };
}

function asofLatest<T extends { date: string }>(sorted: T[], date: string, cursor: { i: number; last: T | null }): T | null {
  while (cursor.i < sorted.length && sorted[cursor.i].date <= date) {
    cursor.last = sorted[cursor.i];
    cursor.i += 1;
  }
  return cursor.last;
}

function finitePointNote(hit: FundamentalPoint | null, hasSeries: boolean, emptyNote: string, beforeNote: string): { value: number | null; note: string | null } {
  if (hit?.value != null && Number.isFinite(hit.value)) return { value: hit.value, note: hit.note };
  if (hit?.note) return { value: null, note: hit.note };
  return { value: null, note: hasSeries ? beforeNote : emptyNote };
}

/**
 * Earnings Yield je Kerze aus TTM-EPS und dem Kurs dieses Tages.
 * Liegen keine Quartale vor, bleibt der alte As-of auf fertigen Yield-Punkten
 * (Jahresreihe). ROIC und Peer-ROIC liegen per Filing-Datum auf dem letzten
 * bekannten Wert. Peer-Kurse ebenso; die gezeichnete Höhe ist der Median-Index.
 * Vor dem ersten Punkt bleibt die Stelle leer. Nichts wird interpoliert.
 */
export function joinFundamentalsOntoPrices(
  priceDates: string[],
  args: {
    earningsYield: FundamentalPoint[] | null;
    epsQuarters?: EpsQuarter[] | null;
    ttmPrints?: TtmPrint[] | null;
    annualEps?: TtmPrint[] | null;
    priceCurrency?: string | null;
    priceFx?: PriceFx | null;
    roic: FundamentalPoint[] | null;
    roicSeriesNote?: string | null;
    peerRoic: FundamentalPoint[] | null;
    peerRoicSeriesNote?: string | null;
    peerBars: { date: string; close: number }[] | null;
    peerPriceSeriesNote?: string | null;
    subjectCloses: number[];
    showEarningsYield: boolean;
    showRoic: boolean;
    showPeerRoic: boolean;
    showPeerPrice: boolean;
  },
): FundJoinPoint[] {
  const rows = priceDates.map((date, i) => ({ date, close: args.subjectCloses[i] ?? NaN }));
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const useQuarters = args.showEarningsYield && args.epsQuarters != null;
  const ey = (!useQuarters && args.showEarningsYield ? args.earningsYield ?? [] : []).filter(p => p.date).sort((a, b) => a.date.localeCompare(b.date));
  const roic = (args.showRoic ? args.roic ?? [] : []).filter(p => p.date && p.value != null).sort((a, b) => a.date.localeCompare(b.date));
  const peerRoic = (args.showPeerRoic ? args.peerRoic ?? [] : []).filter(p => p.date && p.value != null).sort((a, b) => a.date.localeCompare(b.date));
  const bars = (args.showPeerPrice ? args.peerBars ?? [] : [])
    .filter(b => b.date && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const scale = args.showPeerPrice ? medianIndexScale(rows.map(r => r.close), bars.map(b => b.close)) : { scale: null, note: null };
  const firstPeer = bars[0]?.date ?? null;
  const cEy = { i: 0, last: null as FundamentalPoint | null };
  const cRoic = { i: 0, last: null as FundamentalPoint | null };
  const cPeerRoic = { i: 0, last: null as FundamentalPoint | null };
  const cPx = { i: 0, last: null as { date: string; close: number } | null };
  return rows.map(row => {
    let earningsYieldPct: number | null = null;
    let earningsYieldNote: string | null = null;
    let earningsYieldEps: number | null = null;
    let earningsYieldEpsDate: string | null = null;
    let earningsYieldSource: string | null = null;
    let earningsYieldBadge: string | null = null;
    if (args.showEarningsYield) {
      if (useQuarters) {
        const numerator = epsNumeratorAt(args.epsQuarters ?? [], args.ttmPrints ?? [], args.annualEps ?? [], row.date);
        const yieldHit = numerator.eps == null
          ? { value: null, note: numerator.note }
          : earningsYieldFromTtm(numerator.eps, row.close, numerator.currency, args.priceCurrency ?? null, args.priceFx ? { ...args.priceFx, asOf: row.date } : null);
        earningsYieldPct = yieldHit.value;
        const bits = [`Formel: ${numerator.formula}`, numerator.note, yieldHit.note].filter((part): part is string => !!part);
        earningsYieldNote = bits.filter((part, index) => bits.indexOf(part) === index).join(" · ") || null;
        earningsYieldEps = numerator.displayEps ?? numerator.eps;
        earningsYieldEpsDate = numerator.asOf;
        earningsYieldSource = numerator.source;
        earningsYieldBadge = numerator.badge;
      } else {
        const eyHit = asofLatest(ey, row.date, cEy);
        const yieldHit = finitePointNote(eyHit, ey.length > 0, "n/a — keine Earnings-Yield-Punkte", "n/a — noch kein Earnings-Yield-Stichtag");
        earningsYieldPct = yieldHit.value;
        earningsYieldNote = yieldHit.note;
      }
    }
    const roicHit = asofLatest(roic, row.date, cRoic);
    const roicResolved = args.showRoic
      ? finitePointNote(roicHit, roic.length > 0, args.roicSeriesNote ?? "n/a — keine ROIC-Punkte", "n/a — noch kein ROIC-Filing bis zu diesem Tag")
      : { value: null, note: null };
    const peerKnown = args.showPeerRoic
      ? finitePointNote(asofLatest(peerRoic, row.date, cPeerRoic), peerRoic.length > 0, args.peerRoicSeriesNote ?? "n/a — kein ROIC für den Peer", "n/a — noch kein Peer-ROIC-Filing bis zu diesem Tag")
      : { value: null, note: "n/a — Peer nicht gewählt" };
    const pxHit = asofLatest(bars, row.date, cPx);
    let peerPriceNote: string | null = null;
    if (args.showPeerPrice) {
      if (bars.length === 0) peerPriceNote = args.peerPriceSeriesNote ?? "n/a — Peer-Kurs ohne gültige Schlüsse";
      else if (!pxHit) peerPriceNote = firstPeer ? `n/a — Peer-Kurs beginnt am ${firstPeer}` : (args.peerPriceSeriesNote ?? "n/a — Peer-Kurs fehlt");
      else if (scale.scale == null) peerPriceNote = scale.note;
    } else {
      peerPriceNote = "n/a — Peer nicht gewählt";
    }
    const indexed = pxHit && scale.scale != null ? pxHit.close * scale.scale : null;
    return {
      date: row.date,
      earningsYieldPct,
      earningsYieldNote,
      earningsYieldEps,
      earningsYieldEpsDate,
      earningsYieldSource,
      earningsYieldBadge,
      roicPct: roicResolved.value,
      roicNote: roicResolved.note,
      peerRoicPct: peerKnown.value,
      peerRoicKnown: peerKnown.value,
      peerRoicNote: peerKnown.note,
      peerPriceIndexed: indexed,
      peerPriceRaw: pxHit?.close ?? null,
      peerPriceNote,
    };
  });
}

export function latestFinite(points: FundamentalPoint[] | null | undefined): { value: number | null; note: string | null } {
  if (!points || points.length === 0) return { value: null, note: null };
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.value != null && Number.isFinite(p.value)) return { value: p.value, note: null };
  }
  const noted = [...points].reverse().find(p => p.note);
  return { value: null, note: noted?.note ?? "n/a — keine belastbare Beobachtung" };
}
