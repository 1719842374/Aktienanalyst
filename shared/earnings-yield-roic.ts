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

/** Quartale, die ein TTM-EPS bilden. Warmup wie bei einer MA: vorher kein Wert. */
export const TTM_QUARTER_COUNT = 4;
/**
 * Abstand zweier Periodenenden in Tagen, bis zu dem sie als aufeinanderfolgende
 * Quartale gelten. Darüber ist eine Lücke: kein TTM, nichts wird aufgefüllt.
 */
export const QUARTER_MAX_GAP_DAYS = 140;
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
}

/** Bereits summiertes TTM-EPS (z. B. Yahoo trailingDilutedEPS). Kein Quartal, wird nicht noch einmal addiert. */
export interface TtmPrint {
  asOf: string;
  eps: number;
  currency: string | null;
}

export interface EarningsYieldResponse {
  symbol: string;
  /** date = asOf, value = Quartals-EPS. Der Yield wird je Kerze daraus gerechnet. */
  points: FundamentalPoint[];
  quarters: EpsQuarter[];
  /** Fertiges TTM, nur solange vier Quartale noch nicht bekannt sind. */
  ttmPrints: TtmPrint[];
  formula: string;
  source: string;
  note: string | null;
}

export interface RoicSeriesResponse {
  symbol: string;
  /** date = Filing-Datum, value = ROIC in %. */
  points: FundamentalPoint[];
  formula: string;
  source: string;
  note: string | null;
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
 * TTM-EPS aus den letzten Quartalen, deren Filing-Datum am Stichtag schon bekannt ist.
 * Weniger als TTM_QUARTER_COUNT ist Warmup. Eine Lücke zwischen den Periodenenden
 * lässt den Wert leer, ohne ein Quartal zu schätzen.
 */
export function ttmEpsAt(quarters: EpsQuarter[], asOf: string): { eps: number | null; currency: string | null; note: string | null } {
  const known = new Map<string, EpsQuarter>();
  for (const quarter of quarters) {
    if (!quarter || quarter.asOf > asOf || !Number.isFinite(quarter.eps)) continue;
    const prev = known.get(quarter.periodEnd);
    if (!prev || quarter.asOf >= prev.asOf) known.set(quarter.periodEnd, quarter);
  }
  const ordered = Array.from(known.values()).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  if (ordered.length < TTM_QUARTER_COUNT) {
    return { eps: null, currency: null, note: `n/a — Warmup, weniger als ${TTM_QUARTER_COUNT} Quartale` };
  }
  const last = ordered.slice(-TTM_QUARTER_COUNT);
  for (let i = 1; i < last.length; i++) {
    const gap = isoDayNumber(last[i].periodEnd) - isoDayNumber(last[i - 1].periodEnd);
    if (!(gap > 0 && gap <= QUARTER_MAX_GAP_DAYS)) {
      return { eps: null, currency: null, note: "n/a — Lücke in der Quartalshistorie, TTM nicht gebildet" };
    }
  }
  const currencies = new Set(last.map(q => q.currency?.trim().toUpperCase()).filter((c): c is string => !!c));
  if (currencies.size > 1) return { eps: null, currency: null, note: "n/a — Währung der Quartals-EPS weicht ab" };
  const eps = last.reduce((sum, quarter) => sum + quarter.eps, 0);
  if (!Number.isFinite(eps)) return { eps: null, currency: null, note: "n/a — TTM-EPS nicht berechenbar" };
  return { eps, currency: last.find(q => q.currency)?.currency ?? null, note: null };
}

/** Letzter berichteter TTM-Druck mit asOf <= Stichtag. Kein Auffüllen zwischen den Drucken über eine Schätzung. */
export function ttmPrintAt(prints: TtmPrint[], asOf: string): { eps: number | null; currency: string | null } {
  let hit: TtmPrint | null = null;
  for (const print of prints) {
    if (!print || print.asOf > asOf || !Number.isFinite(print.eps)) continue;
    if (!hit || print.asOf >= hit.asOf) hit = print;
  }
  return hit ? { eps: hit.eps, currency: hit.currency } : { eps: null, currency: null };
}

export function earningsYieldFromTtm(
  ttmEps: number,
  close: number,
  epsCurrency: string | null,
  priceCurrency: string | null,
): { value: number | null; note: string | null } {
  if (!Number.isFinite(ttmEps)) return { value: null, note: "n/a — TTM-EPS fehlt" };
  if (!Number.isFinite(close) || close <= 0) return { value: null, note: "n/a — Kurs fehlt oder nicht positiv" };
  const epsCode = epsCurrency?.trim().toUpperCase() ?? "";
  const priceCode = priceCurrency?.trim().toUpperCase() ?? "";
  if (epsCode && priceCode && epsCode !== priceCode) {
    return { value: null, note: `n/a — EPS in ${epsCurrency}, Kurs in ${priceCurrency}` };
  }
  return { value: (ttmEps / close) * 100, note: null };
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
    priceCurrency?: string | null;
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
        const ttm = ttmEpsAt(args.epsQuarters ?? [], row.date);
        const warmup = ttm.eps == null && ttm.note?.includes("Warmup") === true;
        const printed = warmup ? ttmPrintAt(args.ttmPrints ?? [], row.date) : { eps: null, currency: null };
        const yieldHit = ttm.eps != null
          ? earningsYieldFromTtm(ttm.eps, row.close, ttm.currency, args.priceCurrency ?? null)
          : printed.eps != null
            ? earningsYieldFromTtm(printed.eps, row.close, printed.currency, args.priceCurrency ?? null)
            : { value: null, note: ttm.note };
        earningsYieldPct = yieldHit.value;
        earningsYieldNote = yieldHit.note;
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
