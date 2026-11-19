/**
 * Earnings-Klassifikation für Punkte und Text.
 * Modus und Schwellen stehen in EARNINGS_LAMP_CONFIG. Philip wählt den Standard vor dem Merge.
 * Vorzeichen immer Ist − Konsens. Unter 4 verwertbaren Quartalen gilt die feste Totzone.
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

/** Eine Stelle. colorConsensus ist der Schalter; Standard ungefärbt, bis Philip ihn setzt. */
export const EARNINGS_LAMP_CONFIG = {
  mode: "sue" as EarningsLampMode,
  colorConsensus: false,
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
  symbols: { beat: "▲", inline: "●", miss: "▼", na: "" },
  naText: "kein Konsens",
  cellWashAlpha: 0.12,
  minContrast: 4.5,
  surfaceLight: "#f9fafb",
  surfaceDark: "#1d283a",
};

export function earningsLampPaint(lamp: Exclude<EarningsLamp, "na">): {
  color: string;
  symbol: string;
  lightInk: string;
  darkInk: string;
  lightWash: string;
  darkWash: string;
} {
  const color = EARNINGS_LAMP_CONFIG.colors[lamp];
  const symbol = EARNINGS_LAMP_CONFIG.symbols[lamp];
  const lightWash = mixHex(EARNINGS_LAMP_CONFIG.surfaceLight, color, EARNINGS_LAMP_CONFIG.cellWashAlpha);
  const darkWash = mixHex(EARNINGS_LAMP_CONFIG.surfaceDark, color, EARNINGS_LAMP_CONFIG.cellWashAlpha);
  return {
    color,
    symbol,
    lightInk: readableInk(color, lightWash),
    darkInk: readableInk(color, darkWash),
    lightWash,
    darkWash,
  };
}

function mixHex(surface: string, color: string, alpha: number): string {
  const bg = hexRgb(surface);
  const fg = hexRgb(color);
  return rgbHex(bg.map((channel, i) => Math.round(channel * (1 - alpha) + fg[i] * alpha)) as [number, number, number]);
}

function hexRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function rgbHex(rgb: [number, number, number]): string {
  return `#${rgb.map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function contrast(a: string, b: string): number {
  const lin = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const L = (hex: string) => { const [r, g, b] = hexRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const hi = Math.max(L(a), L(b));
  const lo = Math.min(L(a), L(b));
  return (hi + 0.05) / (lo + 0.05);
}

function readableInk(color: string, wash: string): string {
  if (contrast(color, wash) >= EARNINGS_LAMP_CONFIG.minContrast) return color;
  const [h, s, canonicalL] = rgbToHsl(hexRgb(color));
  let best: { dist: number; hex: string } | null = null;
  for (let step = 0; step <= 100; step++) {
    const l = step / 100;
    const candidate = rgbHex(hslToRgb(h, s, l));
    if (contrast(candidate, wash) < EARNINGS_LAMP_CONFIG.minContrast) continue;
    const dist = Math.abs(l - canonicalL);
    if (!best || dist < best.dist) best = { dist, hex: candidate };
  }
  return best?.hex ?? color;
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = (max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4) * 60;
  return [(h + 360) % 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

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
  if (!pair || pair.estimate === 0) return EARNINGS_LAMP_CONFIG.naText;
  const delta = pair.actual - pair.estimate;
  if (Math.abs(pair.estimate) < EARNINGS_LAMP_CONFIG.consensusAbsMin) return signedText(delta, "$");
  const pct = surprisePct(pair.actual, pair.estimate);
  return pct == null ? EARNINGS_LAMP_CONFIG.naText : signedText(pct, "%");
}

function fixedLamp(actual: number, estimate: number, deadZonePct: number): EarningsLamp {
  if (estimate === 0) return "na";
  const delta = actual - estimate;
  const pct = (delta / Math.abs(estimate)) * 100;
  if (delta > 0 && pct > deadZonePct) return "beat";
  if (delta < 0 && pct < -deadZonePct) return "miss";
  return "inline";
}

function sueValue(delta: number, scale: number): number {
  return delta / scale;
}

function sueLamp(delta: number, scale: number): EarningsLamp {
  const sue = sueValue(delta, scale);
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
): Map<string, { lamp: EarningsLamp; sue: number | null; shown: string }> {
  const usable = rows.flatMap(row => {
    const pair = finitePair(row.actual, row.estimate);
    if (!pair || pair.estimate === 0) return [];
    return [{ date: row.date, delta: pair.actual - pair.estimate }];
  }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latest = usable.slice(-EARNINGS_LAMP_CONFIG.sueWindow);
  const scale = EARNINGS_LAMP_CONFIG.mode === "sue" ? madScale(latest.map(row => row.delta)) : null;
  const sueDates = new Set(scale == null ? [] : latest.map(row => row.date));
  const out = new Map<string, { lamp: EarningsLamp; sue: number | null; shown: string }>();
  for (const row of rows) {
    const pair = finitePair(row.actual, row.estimate);
    if (!pair || pair.estimate === 0) {
      out.set(row.date, { lamp: "na", sue: null, shown: EARNINGS_LAMP_CONFIG.naText });
      continue;
    }
    const delta = pair.actual - pair.estimate;
    const useSue = scale != null && sueDates.has(row.date);
    out.set(row.date, {
      lamp: useSue && scale != null ? sueLamp(delta, scale) : fixedLamp(pair.actual, pair.estimate, deadZonePct),
      sue: useSue && scale != null ? sueValue(delta, scale) : null,
      shown: shownText(pair.actual, pair.estimate),
    });
  }
  return out;
}

export function buildEarningsMarkers(rows: readonly EarningsRaw[]): EarningsMarkerSet {
  const revenue = classifyMetric(rows.map(row => ({ date: row.date, actual: row.revenueActual, estimate: row.revenueEstimate })), EARNINGS_LAMP_CONFIG.revenueDeadZonePct);
  const eps = classifyMetric(rows.map(row => ({ date: row.date, actual: row.epsActual, estimate: row.epsEstimate })), EARNINGS_LAMP_CONFIG.epsDeadZonePct);
  const markers: EarningsMarker[] = rows.map(row => {
    const rev = revenue.get(row.date)!;
    const ep = eps.get(row.date)!;
    const basis = rev.lamp !== "na" ? "revenue" : ep.lamp !== "na" ? "eps" : null;
    const lamp = basis === "revenue" ? rev.lamp : basis === "eps" ? ep.lamp : "na";
    const kind: EarningsKind | null = lamp === "na" ? null : lamp;
    return {
      date: row.date,
      kind,
      reason: kind == null ? EARNINGS_LAMP_CONFIG.naText : null,
      basis,
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
    };
  });
  const sample = markers.map(marker => marker.basis === "eps" ? marker.epsSurprisePct : marker.revenueSurprisePct).filter((value): value is number => value != null);
  return { markers, inlineBandPct: sample.length >= 2 ? median(sample.map(value => Math.abs(value))) : null, beatRateLabel: beatRateLabelFor(markers) };
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
      _earnRevLamp: event.revenueLamp,
      _earnEpsLamp: event.epsLamp,
      _earnRevSue: event.revenueSue,
      _earnEpsSue: event.epsSue,
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
