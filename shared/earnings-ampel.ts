/**
 * Lampen-Schwellen der Earnings-Ampel. Eine Stelle, Philip prüft sie.
 * Beat ab beatPct einschließlich, Miss ab missPct einschließlich, dazwischen in-line.
 * Die Chart-Klassifikation in buildEarningsMarkers bleibt das Median-Band
 * (eine Basis, Umsatz vor EPS) und liest diese Konstanten nicht.
 */
export const EARNINGS_AMPEL_THRESHOLDS = {
  epsBeatPct: 5,
  epsMissPct: -5,
  revenueBeatPct: 2,
  revenueMissPct: -2,
  beat: { color: "#22c55e", symbol: "▲" },
  inline: { color: "#eab308", symbol: "●" },
  miss: { color: "#ef4444", symbol: "▼" },
  /** Anteil der Lampenfarbe auf der Kartenfläche. Eine Quelle, kein zweites Farbset. */
  cellWashAlpha: 0.12,
  minContrast: 4.5,
  /** Kartengrund aus index.css: Light hsl(220 13% 98%), Dark hsl(217 33% 17%). */
  surfaceLight: "#f9fafb",
  surfaceDark: "#1d283a",
} as const;

export type EarningsAmpelLamp = "beat" | "miss" | "inline" | "na";

export interface EarningsAmpelMetric {
  lamp: EarningsAmpelLamp;
  surprisePct: number | null;
  actual: number | null;
  estimate: number | null;
  reason: string | null;
  shown: string | null;
  sue: number | null;
}

export interface EarningsAmpelQuarter {
  date: string;
  eps: EarningsAmpelMetric;
  revenue: EarningsAmpelMetric;
}

export interface EarningsAmpelModel {
  latest: EarningsAmpelQuarter | null;
  quarters: EarningsAmpelQuarter[];
}

type MarkerFields = {
  date: string;
  revenueActual: number | null;
  revenueEstimate: number | null;
  revenueSurprisePct: number | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprisePct: number | null;
  revenueLamp?: EarningsAmpelLamp;
  epsLamp?: EarningsAmpelLamp;
  revenueShown?: string;
  epsShown?: string;
  revenueSue?: number | null;
  epsSue?: number | null;
  revenueReason?: string | null;
  epsReason?: string | null;
};

export function classifyEarningsSurprise(
  surprisePct: number | null,
  beatPct: number,
  missPct: number,
): EarningsAmpelLamp {
  if (surprisePct == null || !Number.isFinite(surprisePct)) return "na";
  if (surprisePct >= beatPct) return "beat";
  if (surprisePct <= missPct) return "miss";
  return "inline";
}

export function earningsAmpelColor(lamp: EarningsAmpelLamp): string | null {
  switch (lamp) {
    case "beat":
      return EARNINGS_AMPEL_THRESHOLDS.beat.color;
    case "miss":
      return EARNINGS_AMPEL_THRESHOLDS.miss.color;
    case "inline":
      return EARNINGS_AMPEL_THRESHOLDS.inline.color;
    case "na":
      return null;
    default: {
      const exhaustive: never = lamp;
      return exhaustive;
    }
  }
}

export function earningsAmpelSymbol(lamp: EarningsAmpelLamp): string {
  switch (lamp) {
    case "beat":
      return EARNINGS_AMPEL_THRESHOLDS.beat.symbol;
    case "miss":
      return EARNINGS_AMPEL_THRESHOLDS.miss.symbol;
    case "inline":
      return EARNINGS_AMPEL_THRESHOLDS.inline.symbol;
    case "na":
      return "";
    default: {
      const exhaustive: never = lamp;
      return exhaustive;
    }
  }
}

export function earningsAmpelLabel(lamp: EarningsAmpelLamp): string {
  switch (lamp) {
    case "beat":
      return "Beat";
    case "miss":
      return "Miss";
    case "inline":
      return "in-line";
    case "na":
      return "n/a";
    default: {
      const exhaustive: never = lamp;
      return exhaustive;
    }
  }
}

function finiteOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function metricNaReason(label: "EPS" | "Umsatz", actual: number | null, estimate: number | null): string {
  if (finiteOrNull(actual) == null) return `n/a — ${label}-Ist fehlt`;
  if (finiteOrNull(estimate) == null || estimate === 0) return `n/a — ${label}-Schätzung fehlt oder ist 0`;
  return `n/a — ${label}-Surprise nicht berechenbar`;
}

function metricOf(
  label: "EPS" | "Umsatz",
  actual: number | null,
  estimate: number | null,
  surprisePct: number | null,
  beatPct: number,
  missPct: number,
): EarningsAmpelMetric {
  const surprise = finiteOrNull(surprisePct);
  const lamp = classifyEarningsSurprise(surprise, beatPct, missPct);
  return {
    lamp,
    surprisePct: surprise,
    actual: finiteOrNull(actual),
    estimate: finiteOrNull(estimate),
    reason: lamp === "na" ? metricNaReason(label, actual, estimate) : null,
    shown: null,
    sue: null,
  };
}

function metricFromMarker(marker: MarkerFields, side: "eps" | "revenue"): EarningsAmpelMetric | null {
  const lamp = side === "eps" ? marker.epsLamp : marker.revenueLamp;
  if (!lamp) return null;
  return {
    lamp,
    surprisePct: finiteOrNull(side === "eps" ? marker.epsSurprisePct : marker.revenueSurprisePct),
    actual: finiteOrNull(side === "eps" ? marker.epsActual : marker.revenueActual),
    estimate: finiteOrNull(side === "eps" ? marker.epsEstimate : marker.revenueEstimate),
    reason: lamp === "na" ? (side === "eps" ? marker.epsReason : marker.revenueReason) ?? "kein Konsens" : null,
    shown: (side === "eps" ? marker.epsShown : marker.revenueShown) ?? null,
    sue: (side === "eps" ? marker.epsSue : marker.revenueSue) ?? null,
  };
}

export function buildEarningsAmpel(markers: readonly MarkerFields[]): EarningsAmpelModel {
  const { epsBeatPct, epsMissPct, revenueBeatPct, revenueMissPct } = EARNINGS_AMPEL_THRESHOLDS;
  const quarters = markers.map((marker, index) => ({
    index,
    quarter: {
      date: marker.date,
      eps: metricFromMarker(marker, "eps") ?? metricOf("EPS", marker.epsActual, marker.epsEstimate, marker.epsSurprisePct, epsBeatPct, epsMissPct),
      revenue: metricFromMarker(marker, "revenue") ?? metricOf("Umsatz", marker.revenueActual, marker.revenueEstimate, marker.revenueSurprisePct, revenueBeatPct, revenueMissPct),
    } satisfies EarningsAmpelQuarter,
  }));
  quarters.sort((a, b) => (a.quarter.date < b.quarter.date ? 1 : a.quarter.date > b.quarter.date ? -1 : a.index - b.index));
  const rows = quarters.map(entry => entry.quarter);
  return { latest: rows[0] ?? null, quarters: rows };
}

export function formatAmpelNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return String(value).replace(".", ",");
}

export function formatAmpelPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const body = Math.abs(value).toFixed(2).replace(".", ",");
  if (value > 0) return `+${body} %`;
  if (value < 0) return `−${body} %`;
  return `${body} %`;
}

export function earningsAmpelThresholdLine(): string {
  const t = EARNINGS_AMPEL_THRESHOLDS;
  return `EPS Beat ab +${t.epsBeatPct} %, Miss ab −${Math.abs(t.epsMissPct)} %. Umsatz Beat ab +${t.revenueBeatPct} %, Miss ab −${Math.abs(t.revenueMissPct)} %. Inline ${t.inline.color}.`;
}

type Rgb = [number, number, number];

function hexRgb(hex: string): Rgb {
  const n = hex.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function rgbHex(rgb: Rgb): string {
  return `#${rgb.map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

function rgbHsl(rgb: Rgb): [number, number, number] {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, s, l];
}

function hslRgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function channel(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** Kontrast zweier Hex-Farben. Die Zellfarbe bleibt die Lampenfarbe, der Text weicht nur ab, wenn diese Quote fehlt. */
export function earningsAmpelContrast(ink: string, wash: string): number {
  const a = luminance(hexRgb(ink));
  const b = luminance(hexRgb(wash));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function composite(surface: string, color: string, alpha: number): string {
  const bg = hexRgb(surface);
  const fg = hexRgb(color);
  const mixed = bg.map((c, i) => Math.round(c * (1 - alpha) + fg[i] * alpha)) as Rgb;
  return rgbHex(mixed);
}

function readableInk(color: string, wash: string): string {
  if (earningsAmpelContrast(color, wash) >= EARNINGS_AMPEL_THRESHOLDS.minContrast) return color;
  const [h, s, canonicalL] = rgbHsl(hexRgb(color));
  let best: { dist: number; hex: string } | null = null;
  for (let step = 0; step <= 100; step++) {
    const l = step / 100;
    const candidate = rgbHex(hslRgb(h, s, l));
    if (earningsAmpelContrast(candidate, wash) < EARNINGS_AMPEL_THRESHOLDS.minContrast) continue;
    const dist = Math.abs(l - canonicalL);
    if (!best || dist < best.dist) best = { dist, hex: candidate };
  }
  return best?.hex ?? color;
}

export interface EarningsAmpelCellPaint {
  color: string;
  symbol: string;
  lightInk: string;
  darkInk: string;
  lightWash: string;
  darkWash: string;
}

export function earningsAmpelCellPaint(lamp: Exclude<EarningsAmpelLamp, "na">): EarningsAmpelCellPaint {
  const spec = EARNINGS_AMPEL_THRESHOLDS[lamp];
  const lightWash = composite(EARNINGS_AMPEL_THRESHOLDS.surfaceLight, spec.color, EARNINGS_AMPEL_THRESHOLDS.cellWashAlpha);
  const darkWash = composite(EARNINGS_AMPEL_THRESHOLDS.surfaceDark, spec.color, EARNINGS_AMPEL_THRESHOLDS.cellWashAlpha);
  return {
    color: spec.color,
    symbol: spec.symbol,
    lightInk: readableInk(spec.color, lightWash),
    darkInk: readableInk(spec.color, darkWash),
    lightWash,
    darkWash,
  };
}
