/**
 * Ampel-Segmente und Median/Perzentil-Band auf dem Kombinationskurs.
 *
 * Die Fazit-Ampel (buildFazitSignal) und das Spec-Skript getAmpelStatus gibt es
 * auf der Kursreihe nicht: DCF-Upside und RSL liegen nur als aktueller
 * Analyse-Snapshot vor, /api/ohlcv liefert Schlusskurse. Deshalb färbt die
 * bestehende TA-Ampel — dieselben vier Bedingungen wie technicalSignal
 * (shared/conflict-matrix.ts: „Same four conditions as the TA Ampel“) und
 * buySignal aus buildTechnicalIndicators (server/analyze-route.ts).
 * Keine neuen Schwellen. Fenster stehen in AMPEL_TA_PARAMS und BAND_PARAMS.
 */
import { technicalSignal } from "../../../shared/conflict-matrix";
import { phaseFromTechnical } from "../../../shared/ta-phase";
import { macd1269 } from "../../../shared/tech-rsi";
import { quantileR7 } from "./robustStats";
import { smaSeries } from "./taWindowSeries";

/**
 * Fenster der TA-Ampel.
 * maFast/maSlow: SMA 50/200 aus buildTechnicalIndicators (server/analyze-route.ts).
 * MACD bleibt macd1269 (12, 26, 9) in shared/tech-rsi.ts — hier nicht noch einmal beziffert.
 * warmupCalendarDays: ein Kalenderjahr Vorlauf, damit das MA200-Fenster am ersten
 * sichtbaren Portfolio-Punkt definiert sein kann.
 */
export const AMPEL_TA_PARAMS = {
  maFast: 50,
  maSlow: 200,
  warmupCalendarDays: 365,
} as const;

/**
 * Band um den Kombinationskurs: rollierender Median und P(lo)/P(hi).
 * window: 63 Beobachtungen ≈ 3 Monate, gleiche Länge wie
 * BTC_LIQUIDITY_CONFIG.dgs10.lookbackObs (shared/btc-liquidity.ts).
 * lo/hi: 20./80. Perzentil wie das Peer-Band in server/thesis-strength.ts (p20/p80)
 * und BTC_LIQUIDITY_CONFIG.bills.p.lo/hi.
 * median: quantileR7 bei 0,5 (R-7-Median, client/src/lib/robustStats.ts).
 */
export const BAND_PARAMS = {
  window: 63,
  lo: 0.2,
  hi: 0.8,
  median: 0.5,
} as const;

/** Grün/Gelb/Rot wie die TA-Ampel im Chart; basis = bisheriger Kombinationskurs. */
export const AMPEL_COLORS = {
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
  base: "#38bdf8",
} as const;

export type AmpelColor = "green" | "yellow" | "red";

export type TechnicalFlags = {
  priceAboveMA200: boolean;
  ma50AboveMA200: boolean;
  macdAboveZero: boolean;
  macdRising: boolean;
};

export type AmpelPoint = {
  index: number;
  color: AmpelColor | null;
  priceAboveMA200: boolean | null;
  ma50AboveMA200: boolean | null;
  macdAboveZero: boolean | null;
  macdRising: boolean | null;
  score: number | null;
};

export type AmpelSegment = {
  color: AmpelColor | "base";
  fromIndex: number;
  toIndex: number;
};

export type ComboBandPoint = { median: number | null; lo: number | null; hi: number | null };

export type ComboPoint = { date: string; value: number };

export type AmpelSegmentMeta = {
  key: string;
  color: AmpelColor | "base";
  fromIndex: number;
  toIndex: number;
  legend: boolean;
};

export type AmpelChartRow = ComboPoint & {
  ampelColor: AmpelColor | null;
  ampelLabel: string | null;
  bandLo: number | null;
  bandHi: number | null;
  bandMedian: number | null;
  segments: Record<string, number | null>;
};

/** Grün = ATTRAKTIV, Gelb = NEUTRAL, Rot = VORSICHTIG. Dieselbe Funktion wie die Kurslinie (shared/ta-phase.ts). */
export function ampelColorFromStatus(status: TechnicalFlags | null): AmpelColor | null {
  const phase = phaseFromTechnical(status, false);
  switch (phase) {
    case "ATTRAKTIV": return "green";
    case "NEUTRAL": return "yellow";
    case "VORSICHTIG": return "red";
    case null: return null;
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
}

export function evaluateAmpelOnCloses(closes: number[]): AmpelPoint[] {
  const maFast = smaSeries(closes, AMPEL_TA_PARAMS.maFast);
  const maSlow = smaSeries(closes, AMPEL_TA_PARAMS.maSlow);
  const macd = macd1269(closes);
  return closes.map((close, i) => {
    const slow = maSlow[i];
    const fast = maFast[i];
    const current = macd[i]?.macd ?? null;
    const previous = i > 0 ? (macd[i - 1]?.macd ?? null) : null;
    const empty: AmpelPoint = {
      index: i,
      color: null,
      priceAboveMA200: null,
      ma50AboveMA200: null,
      macdAboveZero: null,
      macdRising: null,
      score: null,
    };
    if (slow == null || fast == null || current == null || previous == null || !Number.isFinite(close)) return empty;
    const flags: TechnicalFlags = {
      priceAboveMA200: close > slow,
      ma50AboveMA200: fast > slow,
      macdAboveZero: current > 0,
      macdRising: current > previous,
    };
    const judged = technicalSignal(flags);
    return { index: i, color: ampelColorFromStatus(flags), ...flags, score: judged.score };
  });
}

export function segmentAmpelColors(colors: Array<AmpelColor | null>): AmpelSegment[] {
  const segments: AmpelSegment[] = [];
  for (let i = 0; i < colors.length; i++) {
    const color: AmpelColor | "base" = colors[i] ?? "base";
    const prev = segments[segments.length - 1];
    if (!prev || prev.color !== color) segments.push({ color, fromIndex: i, toIndex: i });
    else prev.toIndex = i;
  }
  return segments;
}

export function ampelChangeIndices(segments: AmpelSegment[]): number[] {
  return segments.slice(1).map(segment => segment.fromIndex);
}

export function rollingComboBands(values: number[], params: typeof BAND_PARAMS = BAND_PARAMS): ComboBandPoint[] {
  return values.map((_, i) => {
    if (i + 1 < params.window) return { median: null, lo: null, hi: null };
    const slice = values.slice(i + 1 - params.window, i + 1);
    if (slice.length < params.window || slice.some(value => !Number.isFinite(value))) {
      return { median: null, lo: null, hi: null };
    }
    return {
      median: quantileR7(slice, params.median),
      lo: quantileR7(slice, params.lo),
      hi: quantileR7(slice, params.hi),
    };
  });
}

export function ampelTooltipLabel(point: AmpelPoint): string | null {
  if (!point.color) return null;
  const name = point.color === "green" ? "Grün" : point.color === "yellow" ? "Gelb" : "Rot";
  const bits = [
    point.priceAboveMA200 ? "Kurs>MA200" : null,
    point.ma50AboveMA200 ? "MA50>MA200" : null,
    point.macdAboveZero ? "MACD>0" : null,
    point.macdRising ? "MACD↑" : null,
  ].filter((bit): bit is string => bit != null);
  const score = point.score == null ? "" : ` ${point.score}/4`;
  return `${name}:${score}${bits.length ? ` · ${bits.join(", ")}` : ""}`;
}

export function ampelWarmupFromIso(visibleFromIso: string): string {
  const date = new Date(`${visibleFromIso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - AMPEL_TA_PARAMS.warmupCalendarDays);
  return date.toISOString().slice(0, 10);
}

const noBand: ComboBandPoint = { median: null, lo: null, hi: null };

/** Sichtbare Punkte behalten Kurs und Datum. Segmente überlappen am Farbwechsel um einen Punkt. */
export function attachAmpel(visible: ComboPoint[], source: ComboPoint[], enabled: boolean): {
  badge: boolean;
  rows: AmpelChartRow[];
  segmentMeta: AmpelSegmentMeta[];
} {
  if (!enabled) {
    return {
      badge: false,
      segmentMeta: [],
      rows: visible.map(point => ({
        ...point,
        ampelColor: null,
        ampelLabel: null,
        bandLo: null,
        bandHi: null,
        bandMedian: null,
        segments: {},
      })),
    };
  }

  const ordered = [...source].sort((a, b) => a.date.localeCompare(b.date));
  const evaluated = evaluateAmpelOnCloses(ordered.map(point => point.value));
  const bands = rollingComboBands(ordered.map(point => point.value));
  const byDate = new Map<string, { point: AmpelPoint; band: ComboBandPoint }>();
  ordered.forEach((point, index) => {
    byDate.set(point.date, { point: evaluated[index], band: bands[index] });
  });

  const colors = visible.map(point => byDate.get(point.date)?.point.color ?? null);
  const segmentMeta: AmpelSegmentMeta[] = segmentAmpelColors(colors).map((segment, index, all) => ({
    key: `ampelSeg${index}`,
    color: segment.color,
    fromIndex: segment.fromIndex,
    toIndex: segment.toIndex,
    legend: index === 0 && all.length > 0,
  }));

  const rows: AmpelChartRow[] = visible.map((point, index) => {
    const hit = byDate.get(point.date);
    const segments: Record<string, number | null> = {};
    for (let s = 0; s < segmentMeta.length; s++) {
      const segment = segmentMeta[s];
      const end = s < segmentMeta.length - 1 ? segment.toIndex + 1 : segment.toIndex;
      segments[segment.key] = index >= segment.fromIndex && index <= end ? point.value : null;
    }
    const band = hit?.band ?? noBand;
    return {
      ...point,
      ampelColor: colors[index],
      ampelLabel: hit ? ampelTooltipLabel(hit.point) : null,
      bandLo: band.lo,
      bandHi: band.hi,
      bandMedian: band.median,
      segments,
    };
  });

  const last = rows.length ? rows[rows.length - 1].ampelColor : null;
  return { badge: last === "green", rows, segmentMeta };
}
