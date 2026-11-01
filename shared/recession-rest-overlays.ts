/**
 * F1-45 Rest-Overlays in „Vier Märkte“. Nur Anzeige, kein Score.
 * Philip 01.11.2026 12:36: Schwellen aus der Reihe (Median, Perzentil, z-Score, Peer-Position).
 * Die Achse ist der Stichproben-z über die Drucke, die im sichtbaren Chart-Fenster liegen.
 * Default aus, wie #330 (470c28c5).
 */
import { asOfJoin, maxAgeFor, type MacroPoint } from "./recession-ta";

/**
 * Fenster-z. Herkunft: Varianz wie scoreSeriesStress (server/recession.ts),
 * Teiler (n−1). n < 2 lässt s nicht zu — dieselbe Untergrenze wie dort
 * (`history.length < 2` → kein z). Keine feste Zone.
 */
export const REST_OVERLAY_PARAMS = {
  minPoints: 2,
  /**
   * Perzentil-Bänder der Fenster-z-Werte.
   * Herkunft: Philip 01.11.2026 „Perzentil“, nicht die festen Zonen aus capeReading/buffettReading.
   */
  bandLowPercentile: 10,
  bandHighPercentile: 90,
  /** Median der Fenster-z-Werte. Herkunft: Philip 01.11.2026 „Median“. */
  medianPercentile: 50,
  /**
   * Achsenrand als Anteil der z-Spanne.
   * Herkunft: die bestehende Real-10J-Achse polstert absolut (real10yDomain); hier relativ,
   * damit keine feste z-Schwelle im Pfad steht.
   */
  axisPadFraction: 0.05,
  /**
   * Breite einer rechten z-Achse in px.
   * Herkunft: gleiche Breite wie die Baa-/Real-10J-Achse in RecessionMarketChartsSection (470c28c5, width 36).
   */
  axisWidth: 36,
  /**
   * Strichstärke der Overlay-Linie.
   * Herkunft: Baa-Spread und Real 10J in derselben Datei (strokeWidth 1.3, 470c28c5).
   */
  strokeWidth: 1.3,
} as const;

export interface DatedValue {
  date: string;
  value: number;
}

export interface WindowZPoint extends DatedValue {
  z: number;
}

export interface WindowZScore {
  mean: number;
  sd: number;
  points: WindowZPoint[];
  medianZ: number;
  lowZ: number;
  highZ: number;
  latest: WindowZPoint & { peerPercentile: number };
}

/** Lineare Perzentil-Interpolation. Dieselbe Form wie percentileOf in shared/credit.ts. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Stichproben-z der Drucke mit start ≤ Datum ≤ end.
 * Peer-Position des letzten Drucks = Anteil der Fensterwerte ≤ diesem Wert (0–100).
 * Konstante Reihe oder zu wenig Punkte → null, kein Ersatzwert.
 */
export function windowZScore(points: readonly DatedValue[], start: string, end: string): WindowZScore | null {
  const inWindow = points
    .filter(p => p.date >= start && p.date <= end && Number.isFinite(p.value))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (inWindow.length < REST_OVERLAY_PARAMS.minPoints) return null;
  const values = inWindow.map(p => p.value);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  const sd = Math.sqrt(variance);
  if (!(sd > 0)) return null;
  const zipped: WindowZPoint[] = inWindow.map(p => ({ date: p.date, value: p.value, z: (p.value - mean) / sd }));
  const zs = zipped.map(p => p.z).slice().sort((a, b) => a - b);
  const latest = zipped[zipped.length - 1];
  const sortedRaw = values.slice().sort((a, b) => a - b);
  const peerPercentile = (sortedRaw.filter(v => v <= latest.value).length / sortedRaw.length) * 100;
  return {
    mean,
    sd,
    points: zipped,
    medianZ: percentile(zs, REST_OVERLAY_PARAMS.medianPercentile),
    lowZ: percentile(zs, REST_OVERLAY_PARAMS.bandLowPercentile),
    highZ: percentile(zs, REST_OVERLAY_PARAMS.bandHighPercentile),
    latest: { ...latest, peerPercentile },
  };
}

export function zAxisDomain(window: WindowZScore): [number, number] {
  let lo = window.points[0].z;
  let hi = lo;
  for (const p of window.points) {
    if (p.z < lo) lo = p.z;
    if (p.z > hi) hi = p.z;
  }
  const pad = (hi - lo) * REST_OVERLAY_PARAMS.axisPadFraction;
  return [lo - pad, hi + pad];
}

export interface OverlayPlacement {
  window: WindowZScore | null;
  /** z je Kurstag, as-of wie shared/recession-ta (täglich 7 Tage, monatlich 62). */
  zByIndex: (number | null)[];
}

export function overlayZOnBars<T extends { date: string }>(
  bars: readonly T[],
  raw: readonly DatedValue[] | null | undefined,
  frequency: "daily" | "monthly",
): OverlayPlacement {
  const empty = { window: null, zByIndex: bars.map(() => null) };
  if (!bars.length || !raw?.length) return empty;
  const window = windowZScore(raw, bars[0].date, bars[bars.length - 1].date);
  if (!window) return empty;
  const prints: MacroPoint[] = window.points.map(p => ({ date: p.date, value: p.z }));
  return { window, zByIndex: asOfJoin(bars.map(b => b.date), prints, maxAgeFor(frequency)) };
}

export function restOverlayStatusText(input: {
  label: string;
  loading: boolean;
  failed: boolean;
  source: string;
  note: string | null;
  window: WindowZScore | null;
  rawUnit: string;
}): string {
  const { label } = input;
  if (input.loading) return `${label}: wird geladen …`;
  if (input.failed) return `${label}: n/a — ${input.note ?? "Quelle nicht erreichbar"}`;
  if (!input.window) {
    const why = input.note ?? "zu wenig Werte im Fenster für einen z-Score";
    return `${label}: n/a — ${why}${input.source ? ` · Quelle ${input.source}` : ""}`;
  }
  const last = input.window.latest;
  const p = REST_OVERLAY_PARAMS;
  return `${label} (eigene Achse, z): aktuell ${last.z.toFixed(2)} (Roh ${last.value.toFixed(2)} ${input.rawUnit}) per ${last.date} · Perzentil ${last.peerPercentile.toFixed(0)} · Median-z ${input.window.medianZ.toFixed(2)} · Bänder P${p.bandLowPercentile}/P${p.bandHighPercentile} · Quelle ${input.source} · kein Score-Einfluss`;
}

/**
 * Vorjahresabstand der M2-Rate.
 * Herkunft: server/recession.ts yoyPercent — unter 13 Beobachtungen NaN,
 * Jahr-zuvor = letzter Index minus 12. Für die Monatsreihe M2SL ist das ein Jahr.
 */
export const M2_YOY_PARAMS = {
  lagObservations: 12,
} as const;

/** YoY in Prozent je Beobachtung ab dem Lag. Letzter Punkt = yoyPercent(levels). */
export function m2YoyPoints(levels: readonly DatedValue[]): DatedValue[] {
  const lag = M2_YOY_PARAMS.lagObservations;
  const sorted = levels
    .filter(p => Number.isFinite(p.value))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: DatedValue[] = [];
  for (let i = lag; i < sorted.length; i++) {
    const prev = sorted[i - lag].value;
    const cur = sorted[i].value;
    if (prev === 0 || !Number.isFinite(prev) || !Number.isFinite(cur)) continue;
    out.push({ date: sorted[i].date, value: ((cur - prev) / prev) * 100 });
  }
  return out;
}

/** Spanne eines CAPE-Drucks. Herkunft: latestMultplCape (Wert unter 5 oder über 80 ist kein CAPE-Druck). */
export const CAPE_PARAMS = {
  minValue: 5,
  maxValue: 80,
} as const;

export type RestOverlayId = "buffett" | "cape" | "curve" | "m2" | "trends";

export interface RestOverlaySpec {
  id: RestOverlayId;
  chip: string;
  /** Name ohne Region. Die Region hängt die Sektion an, wenn die Reihe eine hat. */
  label: string;
  color: string;
  onClass: string;
  testId: string;
  statusTestId: string;
  field: string;
  axisId: string;
  frequency: "daily" | "monthly";
  rawUnit: string;
  dash: string;
}

export const REST_OVERLAYS: Record<RestOverlayId, RestOverlaySpec> = {
  buffett: {
    id: "buffett",
    chip: "Buffett",
    label: "Buffett",
    color: "#eab308",
    onClass: "border-yellow-500 text-yellow-500",
    testId: "toggle-recession-buffett",
    statusTestId: "recession-buffett-status",
    field: "_zBuffett",
    axisId: "zBuffett",
    frequency: "daily",
    rawUnit: "%",
    dash: "4 3",
  },
  cape: {
    id: "cape",
    chip: "CAPE",
    label: "CAPE",
    color: "#a78bfa",
    onClass: "border-violet-500 text-violet-500",
    testId: "toggle-recession-cape",
    statusTestId: "recession-cape-status",
    field: "_zCape",
    axisId: "zCape",
    frequency: "monthly",
    rawUnit: "PE",
    dash: "6 3",
  },
  curve: {
    id: "curve",
    chip: "Zinskurve",
    label: "Zinskurve",
    color: "#22d3ee",
    onClass: "border-cyan-500 text-cyan-500",
    testId: "toggle-recession-curve",
    statusTestId: "recession-curve-status",
    field: "_zCurve",
    axisId: "zCurve",
    frequency: "daily",
    rawUnit: "pp",
    dash: "3 2",
  },
  m2: {
    id: "m2",
    chip: "M2",
    label: "M2",
    color: "#34d399",
    onClass: "border-emerald-500 text-emerald-500",
    testId: "toggle-recession-m2",
    statusTestId: "recession-m2-status",
    field: "_zM2",
    axisId: "zM2",
    frequency: "monthly",
    rawUnit: "%",
    dash: "2 4",
  },
  trends: {
    id: "trends",
    chip: "Trends",
    label: "Trends",
    color: "#fb923c",
    onClass: "border-orange-500 text-orange-500",
    testId: "toggle-recession-trends",
    statusTestId: "recession-trends-status",
    field: "_zTrends",
    axisId: "zTrends",
    frequency: "daily",
    rawUnit: "Index",
    dash: "1 3",
  },
};

/** SPY/QQQ = US, VGK = EU, ASHR = China (Asien-Buch der bestehenden Buffett-Route). */
export function marketBuffettRegion(marketId: string): "US" | "EU" | "CN" {
  if (marketId === "VGK") return "EU";
  if (marketId === "ASHR") return "CN";
  return "US";
}

/** Anzeige-Name der Buffett-Region. CN ist im Dashboard „Asien“ (ASHR). */
export const BUFFETT_REGION_LABEL: Record<"US" | "EU" | "CN", string> = {
  US: "US",
  EU: "EU",
  CN: "Asien",
};
