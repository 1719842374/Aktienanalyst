/**
 * Future_7 §6 und Future_8 §2, §3, §5 — adaptive Schwellen für das Rezessions-Dashboard.
 * Nur Zusatzobjekt. Netto, Max und die Live-P bleiben auf den festen Zonen.
 * Fehlende Historie ist n/a mit Grund, nie 0 und nie ein erfundener Wert.
 *
 * Die Bänder (90/75/25/10, z-Kappe, Skala) sind die benannten Parameter aus Future_8,
 * keine Markt-Schwellen. Ob ein Wert hoch oder tief liegt, kommt aus Mittel, Median,
 * Standardabweichung und Perzentil der eigenen Reihe.
 */

export interface AdaptivePoint {
  date: string;
  value: number;
}

/**
 * Fenster, Mindestlänge und die Abbildung aus Future_8.
 * buffettWindowYears liegt in 20–25 (Z.121), capeWindowYears in 20–30 (Z.122).
 * zCap und zScale: Z.38–45. defaultMaxScore und minObservations: Z.97–115.
 * Perzentil-Bänder: Z.63–72, Vergleich mit > bzw. < wie in der Skizze.
 * varianceDivisor: die Skizze teilt durch n (Grundgesamtheit), nicht durch n−1.
 * millionsPerBillion: Umrechnung der Financial-Accounts-Reihen (Mio. $ → Mrd. $),
 * dieselbe Stelle wie server/buffett-route.ts, keine Bewertungsschwelle.
 * cacheTtlMs: 6 h, wie die monatliche Makro-Route server/recession-ta-route.ts.
 * twoColumnMinPx: Tailwind-Breakpoint `sm`. Darunter eine Spalte (375 px), darüber zwei (1440 px).
 */
export const RECESSION_ADAPTIVE_PARAMS = {
  minObservations: 60,
  zCap: 4,
  zScale: 1.5,
  defaultMaxScore: 4,
  percentileHigh: 90,
  percentileElevated: 75,
  percentileLow: 25,
  percentileVeryLow: 10,
  pointsHigh: 4,
  pointsElevated: 2,
  pointsLow: -2,
  pointsVeryLow: -4,
  middlePoints: 0,
  buffettWindowYears: 20,
  capeWindowYears: 25,
  varianceDivisor: "n" as const,
  millionsPerBillion: 1000,
  cacheTtlMs: 6 * 60 * 60 * 1000,
  twoColumnMinPx: 640,
} as const;

/** 375 px → 1 Spalte, 1440 px → 2 Spalten. */
export function adaptiveColumnCount(widthPx: number): 1 | 2 {
  return widthPx >= RECESSION_ADAPTIVE_PARAMS.twoColumnMinPx ? 2 : 1;
}

export type AdaptiveReading =
  | {
      available: true;
      asOf: string;
      value: number;
      observations: number;
      windowStart: string;
      windowYears: number;
      mean: number;
      median: number;
      std: number;
      z: number;
      /** Future_8 zScoreToScore: begrenztes z mal zScale. */
      zScoreScaled: number;
      /** Future_8 calculateAdaptiveScore: (begrenztes z / zCap) mal maxScore. */
      normalizedScore: number;
      percentile: number;
      percentileScore: number;
      deviationFromMedian: number;
    }
  | { available: false; reason: string };

export interface AdaptiveIndicator {
  id: "buffett" | "cape" | "vix" | "sahm";
  name: string;
  /** adaptiv = aus der Reihe. fest = die Score-Zonen bleiben, hier steht keine Zahl. */
  role: "adaptiv" | "fest";
  windowYears: number | null;
  source: string;
  reading: AdaptiveReading | null;
  fixedNote: string | null;
  /** Dieses Objekt ändert den Live-Score nicht. */
  inLiveScore: false;
}

export interface RecessionAdaptiveReport {
  affectsScore: false;
  asOf: string | null;
  indicators: AdaptiveIndicator[];
  note: string;
  /** Makroreihen haben keine Peer-Gruppe. Die Lage ist das Perzentil der eigenen Historie. */
  peerNote: string;
}

export interface RecessionAdaptiveResponse {
  adaptiv: RecessionAdaptiveReport;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function shiftIsoYears(iso: string, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y + years, m - 1, d)).toISOString().slice(0, 10);
}

function finitePoints(series: AdaptivePoint[]): AdaptivePoint[] {
  const byDate = new Map<string, number>();
  for (const point of series) {
    if (!ISO_DATE.test(point.date) || !Number.isFinite(point.value)) continue;
    byDate.set(point.date, point.value);
  }
  const out: AdaptivePoint[] = [];
  byDate.forEach((value, date) => out.push({ date, value }));
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function meanOf(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function medianOf(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Future_8 Z.38–45. Nicht endliches z bleibt null, nicht 0. */
export function zScoreToScore(z: number): number | null {
  if (!Number.isFinite(z)) return null;
  const capped = Math.max(-RECESSION_ADAPTIVE_PARAMS.zCap, Math.min(RECESSION_ADAPTIVE_PARAMS.zCap, z));
  return capped * RECESSION_ADAPTIVE_PARAMS.zScale;
}

/**
 * Future_8 Z.63–72. 0 ist das mittlere Band (weder >75 noch <25), keine fehlende Zahl.
 * Die Grenzen sind strikt (> bzw. <), wie in der Skizze.
 */
export function percentileScore(percentile: number): number | null {
  if (!Number.isFinite(percentile)) return null;
  const p = RECESSION_ADAPTIVE_PARAMS;
  if (percentile > p.percentileHigh) return p.pointsHigh;
  if (percentile > p.percentileElevated) return p.pointsElevated;
  if (percentile < p.percentileVeryLow) return p.pointsVeryLow;
  if (percentile < p.percentileLow) return p.pointsLow;
  return p.middlePoints;
}

/** Anteil der Historie ≤ value, in Prozent. Future_8 percentileScore, vor der Band-Abbildung. */
export function empiricalPercentile(value: number, history: number[]): number | null {
  if (!Number.isFinite(value) || history.length === 0) return null;
  const finite = history.filter(item => Number.isFinite(item));
  if (finite.length === 0) return null;
  const rank = finite.filter(item => item <= value).length / finite.length;
  return rank * 100;
}

/**
 * Future_8 Z.97–115. Unter 60 Beobachtungen oder ohne Streuung: null.
 * Die Skizze gab dort 0 zurück; fehlende Daten bleiben hier n/a, nie 0.
 */
export function calculateAdaptiveScore(
  current: number,
  history: number[],
  maxScore: number = RECESSION_ADAPTIVE_PARAMS.defaultMaxScore,
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(maxScore)) return null;
  if (history.length < RECESSION_ADAPTIVE_PARAMS.minObservations) return null;
  if (history.some(value => !Number.isFinite(value))) return null;
  const mean = meanOf(history);
  const variance = history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length;
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  const z = (current - mean) / std;
  const capped = Math.max(-RECESSION_ADAPTIVE_PARAMS.zCap, Math.min(RECESSION_ADAPTIVE_PARAMS.zCap, z));
  return (capped / RECESSION_ADAPTIVE_PARAMS.zCap) * maxScore;
}

/** Letzter Wert am oder vor asOf, bewertet gegen das Fenster davor (inklusive dieses Werts). */
export function adaptiveReadingAt(series: AdaptivePoint[], asOf: string, windowYears: number): AdaptiveReading {
  if (!ISO_DATE.test(asOf) || !Number.isFinite(windowYears) || windowYears <= 0) {
    return { available: false, reason: "Fenster oder Stichtag ungültig" };
  }
  const points = finitePoints(series).filter(point => point.date <= asOf);
  if (points.length === 0) return { available: false, reason: `keine Beobachtung bis ${asOf}` };
  const windowStart = shiftIsoYears(asOf, -windowYears);
  const window = points.filter(point => point.date >= windowStart);
  const current = window[window.length - 1];
  if (!current || window.length < RECESSION_ADAPTIVE_PARAMS.minObservations) {
    const count = window.length;
    return {
      available: false,
      reason: `zu wenig Historie (${count} Beobachtungen, mindestens ${RECESSION_ADAPTIVE_PARAMS.minObservations})`,
    };
  }
  const values = window.map(point => point.value);
  const mean = meanOf(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  if (std === 0) return { available: false, reason: "keine Streuung im Fenster" };
  const z = (current.value - mean) / std;
  const zScoreScaled = zScoreToScore(z);
  const normalizedScore = calculateAdaptiveScore(current.value, values);
  const percentile = empiricalPercentile(current.value, values);
  const band = percentile == null ? null : percentileScore(percentile);
  if (zScoreScaled == null || normalizedScore == null || percentile == null || band == null) {
    return { available: false, reason: "z-Score oder Perzentil nicht rechenbar" };
  }
  const median = medianOf(values);
  return {
    available: true,
    asOf: current.date,
    value: current.value,
    observations: values.length,
    windowStart,
    windowYears,
    mean,
    median,
    std,
    z,
    zScoreScaled,
    normalizedScore,
    percentile,
    percentileScore: band,
    deviationFromMedian: current.value - median,
  };
}

/**
 * Financial-Accounts-Quote in Prozent: (NCBEILQ027S + FBCELLQ027S) / 1000 / GDP.
 * Nur Quartale, die in allen drei Reihen stehen. Keine Fortschreibung, kein Wilshire.
 */
export function financialAccountsBuffettRatio(
  gdpBn: AdaptivePoint[],
  nonfinancialMn: AdaptivePoint[],
  financialMn: AdaptivePoint[],
): AdaptivePoint[] {
  const gdp = new Map(finitePoints(gdpBn).map(point => [point.date, point.value]));
  const nonfinancial = new Map(finitePoints(nonfinancialMn).map(point => [point.date, point.value]));
  const financial = new Map(finitePoints(financialMn).map(point => [point.date, point.value]));
  const dates: string[] = [];
  gdp.forEach((_value, date) => {
    if (nonfinancial.has(date) && financial.has(date)) dates.push(date);
  });
  dates.sort();
  const out: AdaptivePoint[] = [];
  for (const date of dates) {
    const gdpValue = gdp.get(date)!;
    const marketMn = nonfinancial.get(date)! + financial.get(date)!;
    if (gdpValue <= 0 || !Number.isFinite(marketMn)) continue;
    out.push({
      date,
      value: (marketMn / RECESSION_ADAPTIVE_PARAMS.millionsPerBillion / gdpValue) * 100,
    });
  }
  return out;
}

export interface AdaptiveSeriesLoad {
  points: AdaptivePoint[];
  reason: string | null;
}

const FIXED_VIX = "Zonen bleiben (>30 / 20–30 / 15–20 / <15). Future_7 Z.60–66, Future_8 Z.123.";
const FIXED_SAHM = "Die Sahm-Regel bleibt. Sie ist bereits adaptiv. Future_7 Z.70–72, Future_8 Z.124.";

function latestAsOf(readings: AdaptiveReading[]): string | null {
  const dates = readings.flatMap(reading => (reading.available ? [reading.asOf] : []));
  if (dates.length === 0) return null;
  return dates.sort()[dates.length - 1];
}

export function buildRecessionAdaptiveReport(input: {
  cape: AdaptiveSeriesLoad;
  buffett: AdaptiveSeriesLoad;
}): RecessionAdaptiveReport {
  const buffettReading = input.buffett.points.length === 0
    ? { available: false as const, reason: input.buffett.reason ?? "keine Buffett-Reihe" }
    : adaptiveReadingAt(
        input.buffett.points,
        finitePoints(input.buffett.points).at(-1)?.date ?? "",
        RECESSION_ADAPTIVE_PARAMS.buffettWindowYears,
      );
  const capeReading = input.cape.points.length === 0
    ? { available: false as const, reason: input.cape.reason ?? "keine CAPE-Reihe" }
    : adaptiveReadingAt(
        input.cape.points,
        finitePoints(input.cape.points).at(-1)?.date ?? "",
        RECESSION_ADAPTIVE_PARAMS.capeWindowYears,
      );
  const indicators: AdaptiveIndicator[] = [
    {
      id: "buffett",
      name: "Buffett (Financial Accounts / BIP)",
      role: "adaptiv",
      windowYears: RECESSION_ADAPTIVE_PARAMS.buffettWindowYears,
      source: "FRED NCBEILQ027S + FBCELLQ027S / GDP, Quartal. Nicht der Wilshire-Wert des Score-Slots.",
      reading: buffettReading,
      fixedNote: null,
      inLiveScore: false,
    },
    {
      id: "cape",
      name: "Shiller CAPE",
      role: "adaptiv",
      windowYears: RECESSION_ADAPTIVE_PARAMS.capeWindowYears,
      source: "Multpl Shiller PE, Monat. Dieselbe Tabelle wie der Score-Slot, andere Schwellen.",
      reading: capeReading,
      fixedNote: null,
      inLiveScore: false,
    },
    {
      id: "vix",
      name: "VIX",
      role: "fest",
      windowYears: null,
      source: "FRED VIXCLS, Score-Zonen unverändert",
      reading: null,
      fixedNote: FIXED_VIX,
      inLiveScore: false,
    },
    {
      id: "sahm",
      name: "Sahm-Regel",
      role: "fest",
      windowYears: null,
      source: "Sahm-Regel, unverändert",
      reading: null,
      fixedNote: FIXED_SAHM,
      inLiveScore: false,
    },
  ];
  return {
    affectsScore: false,
    asOf: latestAsOf([buffettReading, capeReading]),
    indicators,
    note: "Zusatzobjekt. Netto, Max und die fünf Wahrscheinlichkeiten bleiben auf den festen Zonen. Ein Perzentil-Score von 0 ist das mittlere Band, keine fehlende Zahl.",
    peerNote: "Keine Peer-Gruppe. Die Lage ist das Perzentil der eigenen Historie.",
  };
}

/** Anzeigetext. Fehlend wird zu „n/a — Grund“, nie zu 0. */
export function adaptiveNaText(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.startsWith("n/a")) return trimmed;
  return `n/a — ${trimmed}`;
}
