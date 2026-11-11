/**
 * Earnings-Klassifikation für Punkte und Text.
 * Standard ist SUE, Philip schaltet vor dem Merge auf fest um, wenn er das will.
 * Vorzeichen immer Ist − Konsens. Weniger als 4 verwertbare Quartale: feste Totzone.
 */

function median(values: readonly number[]): number | null {
  const xs = values.filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid];
}

export type EarningsKind = "beat" | "miss" | "inline";
export type EarningsLamp = EarningsKind | "na";
export type EarningsLampMode = "sue" | "fixed";

/** Eine Stelle für Modus, Schwellen, Farben und den Konsens-Schalter. */
export const EARNINGS_LAMP_CONFIG = {
  mode: "sue" as EarningsLampMode,
  /** Philips Ergänzung: Konsens mitfärben. Die andere Lesart lässt ihn unfarbig. */
  colorConsensus: true,
  sueWindow: 8,
  sueMinQuarters: 4,
  sueGreenAbove: 1,
  sueRedBelow: -1,
  madScale: 1.4826,
  epsDeadZonePct: 5,
  revenueDeadZonePct: 2,
  consensusAbsMin: 0.05,
  colors: {
    beat: "#22c55e",
    inline: "#eab308",
    miss: "#ef4444",
    na: "#94a3b8",
  },
  symbols: {
    beat: "▲",
    inline: "●",
    miss: "▼",
    na: "",
  },
  naText: "kein Konsens",
};

export interface EarningsRaw {
  date: string;
  revenueActual: number | null;
  revenueEstimate: number | null;
  epsActual: number | null;
  epsEstimate: number | null;
}

export interface EarningsMarker {
  date: string;
  kind: EarningsKind | null;
  reason: string | null;
  basis: "revenue" | "eps" | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  revenueSurprisePct: number | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprisePct: number | null;
  revenueLamp: EarningsLamp;
  epsLamp: EarningsLamp;
  revenueSue: number | null;
  epsSue: number | null;
  revenueShown: string;
  epsShown: string;
  revenueReason: string | null;
  epsReason: string | null;
}

export interface EarningsMarkerSet {
  markers: EarningsMarker[];
  /** Median |Surprise| der Klassifikationsbasis, in Prozentpunkten. */
  inlineBandPct: number | null;
  beatRateLabel: string;
}

function finitePair(actual: number | null, estimate: number | null): { actual: number; estimate: number } | null {
  if (actual == null || estimate == null || !Number.isFinite(actual) || !Number.isFinite(estimate)) return null;
  return { actual, estimate };
}

/** Vorzeichen aus Ist − Konsens. Der Prozentwert teilt durch den Betrag, damit das Vorzeichen nicht kippt. */
function surprisePct(actual: number | null, estimate: number | null): number | null {
  const pair = finitePair(actual, estimate);
  if (!pair || pair.estimate === 0) return null;
  return ((pair.actual - pair.estimate) / Math.abs(pair.estimate)) * 100;
}

function signedText(value: number, suffix: string): string {
  const body = Math.abs(value).toFixed(2).replace(".", ",");
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${body} ${suffix}`;
}

function shownText(actual: number | null, estimate: number | null): string {
  const pair = finitePair(actual, estimate);
  if (!pair) return EARNINGS_LAMP_CONFIG.naText;
  const delta = pair.actual - pair.estimate;
  if (Math.abs(pair.estimate) < EARNINGS_LAMP_CONFIG.consensusAbsMin) return signedText(delta, "$");
  const pct = surprisePct(pair.actual, pair.estimate);
  return pct == null ? EARNINGS_LAMP_CONFIG.naText : signedText(pct, "%");
}

function fixedLamp(actual: number, estimate: number, deadZonePct: number): EarningsLamp {
  const delta = actual - estimate;
  if (estimate === 0) return "na";
  const pct = (delta / Math.abs(estimate)) * 100;
  if (delta > 0 && pct > deadZonePct) return "beat";
  if (delta < 0 && pct < -deadZonePct) return "miss";
  return "inline";
}

function sueLamp(delta: number, scale: number): EarningsLamp {
  const sue = delta / scale;
  if (sue > EARNINGS_LAMP_CONFIG.sueGreenAbove) return "beat";
  if (sue < EARNINGS_LAMP_CONFIG.sueRedBelow) return "miss";
  return "inline";
}

function madScale(deltas: readonly number[]): number | null {
  if (deltas.length < EARNINGS_LAMP_CONFIG.sueMinQuarters) return null;
  const window = deltas.slice(-EARNINGS_LAMP_CONFIG.sueWindow);
  const mid = median(window);
  if (mid == null) return null;
  const mad = median(window.map(value => Math.abs(value - mid)));
  if (mad == null || mad === 0) return null;
  return mad * EARNINGS_LAMP_CONFIG.madScale;
}

function classifyMetric(
  rows: readonly { date: string; actual: number | null; estimate: number | null }[],
  deadZonePct: number,
): Map<string, { lamp: EarningsLamp; sue: number | null; shown: string; reason: string | null }> {
  const out = new Map<string, { lamp: EarningsLamp; sue: number | null; shown: string; reason: string | null }>();
  const usable = rows
    .map(row => {
      const pair = finitePair(row.actual, row.estimate);
      return pair ? { date: row.date, delta: pair.actual - pair.estimate, actual: pair.actual, estimate: pair.estimate } : null;
    })
    .filter((row): row is { date: string; delta: number; actual: number; estimate: number } => row != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latest = usable.slice(-EARNINGS_LAMP_CONFIG.sueWindow);
  const scale = EARNINGS_LAMP_CONFIG.mode === "sue" ? madScale(latest.map(row => row.delta)) : null;
  const sueDates = new Set(scale == null ? [] : latest.map(row => row.date));
  for (const row of rows) {
    const pair = finitePair(row.actual, row.estimate);
    if (!pair || pair.estimate === 0) {
      out.set(row.date, { lamp: "na", sue: null, shown: EARNINGS_LAMP_CONFIG.naText, reason: EARNINGS_LAMP_CONFIG.naText });
      continue;
    }
    const delta = pair.actual - pair.estimate;
    const useSue = scale != null && sueDates.has(row.date);
    const sue = useSue && scale != null ? delta / scale : null;
    const lamp = useSue && scale != null ? sueLamp(delta, scale) : fixedLamp(pair.actual, pair.estimate, deadZonePct);
    out.set(row.date, { lamp, sue, shown: shownText(pair.actual, pair.estimate), reason: null });
  }
  return out;
}

function pointKind(revenue: EarningsLamp, eps: EarningsLamp): { kind: EarningsKind | null; basis: "revenue" | "eps" | null } {
  if (revenue !== "na") return { kind: revenue, basis: "revenue" };
  if (eps !== "na") return { kind: eps, basis: "eps" };
  return { kind: null, basis: null };
}

export function buildEarningsMarkers(rows: readonly EarningsRaw[]): EarningsMarkerSet {
  const revenue = classifyMetric(
    rows.map(row => ({ date: row.date, actual: row.revenueActual, estimate: row.revenueEstimate })),
    EARNINGS_LAMP_CONFIG.revenueDeadZonePct,
  );
  const eps = classifyMetric(
    rows.map(row => ({ date: row.date, actual: row.epsActual, estimate: row.epsEstimate })),
    EARNINGS_LAMP_CONFIG.epsDeadZonePct,
  );
  const markers: EarningsMarker[] = rows.map(row => {
    const rev = revenue.get(row.date)!;
    const ep = eps.get(row.date)!;
    const point = pointKind(rev.lamp, ep.lamp);
    const reason = point.kind == null ? EARNINGS_LAMP_CONFIG.naText : null;
    return {
      date: row.date,
      kind: point.kind,
      reason,
      basis: point.basis,
      revenueActual: row.revenueActual,
      revenueEstimate: row.revenueEstimate,
      revenueSurprisePct: surprisePct(row.revenueActual, row.revenueEstimate),
      epsActual: row.epsActual,
      epsEstimate: row.epsEstimate,
      epsSurprisePct: surprisePct(row.epsActual, row.epsEstimate),
      revenueLamp: rev.lamp,
      epsLamp: ep.lamp,
      revenueSue: rev.sue,
      epsSue: ep.sue,
      revenueShown: rev.shown,
      epsShown: ep.shown,
      revenueReason: rev.reason,
      epsReason: ep.reason,
    };
  });
  const sample = markers
    .map(marker => marker.basis === "eps" ? marker.epsSurprisePct : marker.revenueSurprisePct)
    .filter((value): value is number => value != null);
  const band = sample.length >= 2 ? median(sample.map(value => Math.abs(value))) : null;
  return { markers, inlineBandPct: band, beatRateLabel: beatRateLabelFor(markers) };
}

/** Dieselbe Zählung wie das API-Label, nur für die übergebenen Marker. */
export function beatRateLabelFor(markers: readonly EarningsMarker[]): string {
  const classified = markers.filter(m => m.kind != null && m.basis === "revenue");
  const pool = classified.length > 0 ? classified : markers.filter(m => m.kind != null);
  const beats = pool.filter(m => m.kind === "beat").length;
  const basisName = classified.length > 0 ? "Revenue" : pool.some(m => m.basis === "eps") ? "EPS" : "Surprise";
  if (pool.length === 0) return "n/a — keine klassifizierbare Surprise";
  return `${basisName} Beat ${beats}/${pool.length} (${Math.round((beats / pool.length) * 100)} %)`;
}

/** Badge nur für Events, die auf einen Balken dieses Fensters fallen. */
export function beatRateLabelForWindow(markers: readonly EarningsMarker[], dates: readonly string[]): string {
  const visible = markers.filter(m => m.kind != null && snapEarningsToBar(dates, m.date) != null);
  return beatRateLabelFor(visible);
}

/** Hängt klassifizierte Marker an Kurspunkte. Ohne Marker bleibt die Reihe dieselbe Referenz. */
export function attachEarningsToPoints<T extends { date: string; close: number }>(
  points: readonly T[],
  markers: readonly EarningsMarker[] | null | undefined,
): T[] {
  if (!markers?.some(m => m.kind)) return points as T[];
  const dates = points.filter(p => Number.isFinite(p.close)).map(p => p.date);
  const byDate = new Map<string, EarningsMarker>();
  for (const marker of markers) {
    if (!marker.kind) continue;
    const bar = snapEarningsToBar(dates, marker.date);
    if (bar) byDate.set(bar, marker);
  }
  return points.map(p => {
    const event = byDate.get(p.date);
    if (!event?.kind) return p;
    return {
      ...p,
      _earn: p.close,
      _earnKind: event.kind,
      _earnRevActual: event.revenueActual,
      _earnRevEst: event.revenueEstimate,
      _earnRev: event.revenueSurprisePct,
      _earnEps: event.epsSurprisePct,
      _earnReason: event.reason,
    };
  });
}

/**
 * Nächster Handelstag im Fenster. Liegt das Event vor dem ersten oder nach
 * dem letzten Balken, ist es verworfen. Ein Wochenende oder Feiertag zwischen
 * erstem und letztem Balken bleibt auf dem nächsten Handelstag.
 */
export function snapEarningsToBar(dates: readonly string[], eventDate: string): string | null {
  if (!eventDate || dates.length === 0) return null;
  let first = dates[0];
  let last = dates[0];
  for (const d of dates) {
    if (d < first) first = d;
    if (d > last) last = d;
  }
  if (eventDate < first || eventDate > last) return null;
  let best: string | null = null;
  for (const d of dates) {
    if (d >= eventDate && (best == null || d < best)) best = d;
  }
  return best;
}
