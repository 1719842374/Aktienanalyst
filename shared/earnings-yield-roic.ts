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
export const ROIC_ANNUAL_FORMULA = "Jahres-ROIC zum Filing-Datum";
export const ROIC_TTM_LABEL = "ROIC TTM";
export const ROIC_ANNUAL_LABEL = "ROIC Jahr";

/** Nur die Abruf-Tiefe (Jahre × dieses Fenster). Die Mindestzahl der Quartale einer Serie kommt aus den Abständen. */
export const TTM_QUARTER_COUNT = 4;
/** Kalendertage, aus denen die Quartalszahl eines Jahresfensters abgeleitet wird. */
export const FISCAL_YEAR_DAYS = 365;
/** Ein Folgeschritt gilt als dasselbe Raster, solange er höchstens das Vielfache des Median-Abstands ist. */
export const PERIOD_GAP_FACTOR = 1.6;
/** Sichtbare Chart-Spanne, die die Fundamentalhistorie abdecken können muss. */
export const OVERLAY_HISTORY_YEARS = 10;
/** Zusätzliche Jahre, damit das TTM am linken Rand des 10Y-Fensters schon steht. */
export const OVERLAY_WARMUP_YEARS = 2;
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

/** Listing-FX der Kursserie: EPS in `from` × rate = EPS in `to` (Kurswährung). */
export interface PriceFx {
  from: string;
  to: string;
  rate: number;
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
export function ttmEpsAt(quarters: EpsQuarter[], asOf: string): { eps: number | null; currency: string | null; note: string | null } {
  const known = new Map<string, EpsQuarter>();
  for (const quarter of quarters) {
    if (!quarter || quarter.asOf > asOf || !Number.isFinite(quarter.eps)) continue;
    const prev = known.get(quarter.periodEnd);
    if (!prev || quarter.asOf >= prev.asOf) known.set(quarter.periodEnd, quarter);
  }
  const ordered = Array.from(known.values()).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const window = derivedQuarterWindow(ordered.map(q => q.periodEnd));
  if (!window) {
    return { eps: null, currency: null, note: "n/a — Warmup, Abstand der Quartale nicht ableitbar" };
  }
  if (ordered.length < window.count) {
    return { eps: null, currency: null, note: `n/a — Warmup, weniger als ${window.count} Quartale` };
  }
  const last = ordered.slice(-window.count);
  for (let i = 1; i < last.length; i++) {
    const gap = isoDayNumber(last[i].periodEnd) - isoDayNumber(last[i - 1].periodEnd);
    if (!(gap > 0 && gap <= window.maxGapDays)) {
      return { eps: null, currency: null, note: "n/a — Lücke in der Quartalshistorie, TTM nicht gebildet" };
    }
  }
  const currencies = new Set(last.map(q => q.currency?.trim().toUpperCase()).filter((c): c is string => !!c));
  if (currencies.size > 1) return { eps: null, currency: null, note: "n/a — Währung der Quartals-EPS weicht ab" };
  const eps = last.reduce((sum, quarter) => sum + quarter.eps, 0);
  if (!Number.isFinite(eps)) return { eps: null, currency: null, note: "n/a — TTM-EPS nicht berechenbar" };
  const sources = Array.from(new Set(last.map(q => q.source).filter((s): s is string => !!s && s.trim() !== "")));
  return { eps, currency: last.find(q => q.currency)?.currency ?? null, note: sources.length ? `Quelle: ${sources.join(" + ")}` : null };
}

/** Quartals-TTM, sonst trailing EPS, sonst Jahres-EPS. Der Ersatz steht im note. */
export function epsNumeratorAt(
  quarters: EpsQuarter[],
  trailing: TtmPrint[],
  annual: TtmPrint[],
  asOf: string,
): { eps: number | null; currency: string | null; note: string | null } {
  const ttm = ttmEpsAt(quarters, asOf);
  if (ttm.eps != null) return { eps: ttm.eps, currency: ttm.currency, note: ttm.note };
  const trail = ttmPrintAt(trailing, asOf);
  if (trail.eps != null) {
    const base = `Fallback: trailing EPS (${ttm.note ?? "Quartalsfenster nicht gebildet"})`;
    return { eps: trail.eps, currency: trail.currency, note: trail.source ? `${base} · Quelle: ${trail.source}` : base };
  }
  const year = ttmPrintAt(annual, asOf);
  if (year.eps != null) {
    const base = `Fallback: Jahres-EPS (${ttm.note ?? "Quartalsfenster nicht gebildet"})`;
    return { eps: year.eps, currency: year.currency, note: year.source ? `${base} · Quelle: ${year.source}` : base };
  }
  return { eps: null, currency: null, note: ttm.note };
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
export function ttmPrintAt(prints: TtmPrint[], asOf: string): { eps: number | null; currency: string | null; source: string | null } {
  let hit: TtmPrint | null = null;
  for (const print of prints) {
    if (!print || print.asOf > asOf || !Number.isFinite(print.eps)) continue;
    if (!hit || print.asOf >= hit.asOf) hit = print;
  }
  return hit ? { eps: hit.eps, currency: hit.currency, source: hit.source ?? null } : { eps: null, currency: null, source: null };
}

function ccyCode(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
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
  let fxNote: string | null = null;
  if (epsCode && priceCode && epsCode !== priceCode) {
    const from = ccyCode(fx?.from);
    const to = ccyCode(fx?.to);
    if (fx && from === epsCode && to === priceCode && fx.rate > 0) {
      eps = ttmEps * fx.rate;
      fxNote = `Fallback: EPS ${epsCurrency} × ${fx.from}${fx.to} ${fx.rate} auf Kurswährung ${priceCurrency}`;
    } else {
      return { value: null, note: `n/a — EPS in ${epsCurrency}, Kurs in ${priceCurrency}` };
    }
  }
  const value = (eps / close) * 100;
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

function asofLatest<T extends { date: string }>(sorted: T[], date: string, cursor: { i: number; last: T | null }): T | null {
  while (cursor.i < sorted.length && sorted[cursor.i].date <= date) {
    cursor.last = sorted[cursor.i];
    cursor.i += 1;
  }
  return cursor.last;
}

function finitePointNote(hit: FundamentalPoint | null, hasSeries: boolean, emptyNote: string, beforeNote: string): { value: number | null; note: string | null } {
  if (hit?.value != null && Number.isFinite(hit.value)) return { value: hit.value, note: null };
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
    if (args.showEarningsYield) {
      if (useQuarters) {
        const numerator = epsNumeratorAt(args.epsQuarters ?? [], args.ttmPrints ?? [], args.annualEps ?? [], row.date);
        const yieldHit = numerator.eps == null
          ? { value: null, note: numerator.note }
          : earningsYieldFromTtm(numerator.eps, row.close, numerator.currency, args.priceCurrency ?? null, args.priceFx ?? null);
        earningsYieldPct = yieldHit.value;
        earningsYieldNote = [numerator.note, yieldHit.note].filter((part): part is string => !!part).join(" · ") || null;
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
