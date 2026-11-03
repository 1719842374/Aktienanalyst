/**
 * Symmetrische Ampel (kompakte Spec).
 *
 * Signalstärke ist der Abstand zum Median der eigenen Historie.
 * Die Richtung ist das Vorzeichen der Steigung über die letzten 5 Werte.
 * Extrem hoch + fallend wird negativ, extrem niedrig + steigend positiv,
 * und zwar mit demselben Betrag. Die Formel (Perzentil − 0,5) × Steigung
 * dreht „niedrig + steigend“ ins Negative und wird deshalb nicht verwendet.
 *
 * Nicht verwendet: RSI 30/70, RSL 110, feste Signalgewichte, absolute MACD-Level.
 * Thesis, Bilanz, Volumen und Beta sind Faktoren. Fehlt die Historie eines
 * Faktors, bleibt er 1 und wird als n/a genannt, statt einen Pegel zu erfinden.
 *
 * GRÜN, wenn adjusted über dem p70 der letzten adjusted Werte liegt.
 * ROT, wenn er unter dem p30 liegt. Sonst GELB.
 * Das Fenster ist 20–60 Handelstage, länger bei hoher eigener Schwankung.
 */
import type { TaPhase } from "./ta-phase";
import type { StockAnalysis } from "./schema";

export const SYMMETRIC = {
  slopeDays: 5,
  /** 52 Wochen in Handelstagen. Nicht der Levy-RSL über 130 Tage. */
  ma52Days: 252,
  ma50Days: 50,
  ma200Days: 200,
  volumeDays: 20,
  volHighRatio: 1.5,
  volLowRatio: 0.8,
  volHighFactor: 1.15,
  volLowFactor: 0.85,
  neutralFactor: 1,
  /** Fast Grower +0.15, Oberkante der Spanne 0.85–1.15. */
  thesisFastGrowerAdd: 0.15,
  /** Cyclical −0.10. */
  thesisCyclicalAdd: -0.10,
  thesisFloor: 0.85,
  thesisCeil: 1.15,
  bsFloor: 0.8,
  bsCeil: 1.1,
  /** Nur zusammen mit schwachem RSL. Ohne Beta-Historie bleibt der Faktor 1. */
  betaDamp: 0.85,
  baseWindow: 20,
  maxWindow: 60,
  volLookback: 20,
  lowQuantile: 0.3,
  highQuantile: 0.7,
  /** MA200-Steigung über 20 Handelstage. */
  ma200SlopeDays: 20,
  /** MA50-Steigung über dieselbe Spanne. Death Cross braucht eine fallende MA50. */
  ma50SlopeDays: 20,
  /** Moat unter 3 ist nicht Wide. Wide ist 4. */
  moatNotWideBelow: 3,
  /** Quantil der eigenen RSL-Reihe, nicht ein fester Rang 0.40. */
  rslLowQuantile: 0.4,
  /** Quantil der eigenen RSL-Reihe, nicht ein fester Rang 0.60. */
  rslHighQuantile: 0.6,
  /** Median der eigenen Volumen-Ratio, nicht ein festes 1.2×. */
  volMedianQuantile: 0.5,
  /** Maximale Dämpfung 25 %. Faktor = 1 − Stärke × Spanne, also 0.75–1. */
  falseBreakoutDampSpan: 0.25,
  /** Moat-Skala der Dämpfung. Wide 4, Narrow 2, kein Moat 0. */
  moatScoreMax: 5,
  moatWideScore: 4,
  moatNarrowScore: 2,
  moatNoneScore: 0,
  /** 0.9 + (Score / 5) × 0.2, also 0.9–1.1. */
  moatFactorFloor: 0.9,
  moatFactorSpan: 0.2,
} as const;

export type SymmetricColor = "GRÜN" | "GELB" | "ROT";

export const COLOR_MEANING: Record<SymmetricColor, string> = {
  "GRÜN": "Attraktiv",
  "GELB": "Neutral",
  "ROT": "Unattraktiv",
};

export function symmetricColorPhase(color: SymmetricColor | null): TaPhase | null {
  if (color === "GRÜN") return "ATTRAKTIV";
  if (color === "GELB") return "NEUTRAL";
  if (color === "ROT") return "VORSICHTIG";
  return null;
}

export interface AmpelFactors {
  thesisFactor: number;
  thesisNote: string;
  bsFactor: number;
  bsNote: string;
  betaFactor: number;
  betaNote: string;
  /** null: Moat unbekannt, die Dämpfung bleibt technisch. */
  moatScore: number | null;
  moatNote: string;
}

export interface SymmetricBar {
  date: string;
  close: number;
  volume?: number;
  rsi?: number;
  histogram?: number;
  ma50?: number;
  ma200?: number;
}

export interface SignalFact {
  name: string;
  value: number | null;
  percentile: number | null;
  slopeSign: number | null;
  signal: number | null;
}

export interface SymmetricSnapshot {
  color: SymmetricColor | null;
  meaning: string | null;
  paint: TaPhase | null;
  adjusted: number | null;
  tech: number | null;
  p30: number | null;
  p70: number | null;
  window: number | null;
  historyDays: number;
  factors: AmpelFactors;
  volumeRatio: number | null;
  volumeFactor: number;
  volumeNote: string;
  /** 0.75–1 auf den ganzen Score, wenn alle vier Bedingungen gelten, sonst 1. */
  falseBreakoutFactor: number;
  falseBreakout: boolean;
  /** Derselbe Faktor, wenn der Bulle falsch bricht, sonst 1. */
  falseBreakdownFactor: number;
  falseBreakdown: boolean;
  falseBreakoutNote: string;
  /** Verkauf nach Death Cross ohne Golden Cross, solange der Abstand wächst. */
  falseBreakoutSell: boolean;
  /** Golden oder Death Cross, dessen absoluter MA-Abstand nicht größer wird. */
  weakCross: boolean;
  /** Death Cross, Kurs über der MA50, Abstand nicht geschrumpft. */
  reclaimedMa50: boolean;
  crossType: "golden" | "death" | "none";
  facts: SignalFact[];
  summary: string;
}

export interface SymmetricSeries {
  phases: Map<string, TaPhase | null>;
  colors: Map<string, SymmetricColor | null>;
  last: SymmetricSnapshot | null;
}

/** Rang 0…1: Anteil der Historie ≤ value. Spec-Definition, keine RSI-Schwelle. */
export function historyPercentile(history: readonly number[], value: number): number | null {
  if (!Number.isFinite(value)) return null;
  let n = 0;
  let le = 0;
  for (const x of history) {
    if (!Number.isFinite(x)) continue;
    n += 1;
    if (x <= value) le += 1;
  }
  if (n === 0) return null;
  return le / n;
}

/** Steigung der letzten `days` Punkte. 0 = flach. Zu kurz → null. */
export function slopeSignOf(series: readonly (number | null | undefined)[], index: number, days: number = SYMMETRIC.slopeDays): number | null {
  if (index < days - 1) return null;
  const start = series[index - (days - 1)];
  const end = series[index];
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.sign(end - start);
}

/**
 * Betrag = 2 × |Perzentil − 0,5|, Vorzeichen = Steigung.
 * Hoch + fallend und niedrig + steigend haben denselben Betrag.
 */
/** Betrag aus dem Perzentil, Vorzeichen aus der Steigung. Steigung 0 → 0. */
export function signalFromPercentile(percentile: number, slopeSign: number): number {
  if (slopeSign === 0) return 0;
  return Math.sign(slopeSign) * Math.abs(percentile - 0.5) * 2;
}

export function symmetricSignal(value: number, history: readonly number[], slopeSign: number): number | null {
  const pct = historyPercentile(history, value);
  if (pct == null || !Number.isFinite(slopeSign)) return null;
  return signalFromPercentile(pct, slopeSign);
}

export interface FalseBreakoutInput {
  price: number | null;
  ma200: number | null;
  ma200Slope: number | null;
  rslValue: number | null;
  rslPercentile: number | null;
  rslHistory: readonly number[];
  volRatio: number | null;
  volHistory: readonly number[];
  /** 0–5. null lässt die technische Dämpfung unverändert. */
  moatScore?: number | null;
}

function regimeThresholds(rslHistory: readonly number[], volHistory: readonly number[]) {
  return {
    rslLow: quantile(rslHistory, SYMMETRIC.rslLowQuantile),
    rslHigh: quantile(rslHistory, SYMMETRIC.rslHighQuantile),
    volMed: quantile(volHistory, SYMMETRIC.volMedianQuantile),
  };
}

/** False Breakout: Kurs unter fallendem MA200, RSL unter dem eigenen p40, Volumen unter dem eigenen Median. */
export function isFalseBreakout(input: FalseBreakoutInput): boolean {
  const { rslLow, volMed } = regimeThresholds(input.rslHistory, input.volHistory);
  return input.price != null
    && input.ma200 != null
    && input.price < input.ma200
    && input.ma200Slope != null
    && input.ma200Slope < 0
    && input.rslValue != null
    && rslLow != null
    && input.rslValue < rslLow
    && input.volRatio != null
    && volMed != null
    && input.volRatio < volMed;
}

/** False Breakdown: Kurs über steigendem MA200, RSL über dem eigenen p60, Volumen unter dem eigenen Median. */
export function isFalseBreakdown(input: FalseBreakoutInput): boolean {
  const { rslHigh, volMed } = regimeThresholds(input.rslHistory, input.volHistory);
  return input.price != null
    && input.ma200 != null
    && input.price > input.ma200
    && input.ma200Slope != null
    && input.ma200Slope > 0
    && input.rslValue != null
    && rslHigh != null
    && input.rslValue > rslHigh
    && input.volRatio != null
    && volMed != null
    && input.volRatio < volMed;
}

/** Wide 4, Narrow 2, kein Moat 0. Unbekannte Ratings bleiben leer. */
export function moatScoreFromRating(rating: string | null | undefined): number | null {
  const key = String(rating ?? "").trim().toLowerCase();
  if (!key) return null;
  if (key.includes("none") || key.includes("kein") || key.includes("no moat")) return SYMMETRIC.moatNoneScore;
  if (key.includes("wide") || key.includes("strong")) return SYMMETRIC.moatWideScore;
  if (key.includes("narrow") || key.includes("limited")) return SYMMETRIC.moatNarrowScore;
  return null;
}

/** 0.9 bei Score 0, 1.1 bei Score 5. */
export function moatFalseBreakoutFactor(score: number): number {
  const clamped = Math.min(SYMMETRIC.moatScoreMax, Math.max(0, score));
  return SYMMETRIC.moatFactorFloor + (clamped / SYMMETRIC.moatScoreMax) * SYMMETRIC.moatFactorSpan;
}

/**
 * 1, wenn eine Bedingung fehlt. Dann bleibt auch ein Moat ohne Wirkung.
 * Sonst 1 − Stärke × 0.25, mal Moat 0.9–1.1, wenn ein Score vorliegt.
 * Stärke ist 2 × |RSL-Perzentil − 0.5|, höchstens 1.
 */
export function falseBreakoutFactorOf(input: FalseBreakoutInput): number {
  if (!isFalseBreakout(input) && !isFalseBreakdown(input)) return SYMMETRIC.neutralFactor;
  if (input.rslPercentile == null) return SYMMETRIC.neutralFactor;
  const strength = Math.min(Math.abs(input.rslPercentile - 0.5) * 2, 1);
  const base = 1 - strength * SYMMETRIC.falseBreakoutDampSpan;
  if (base === SYMMETRIC.neutralFactor) return SYMMETRIC.neutralFactor;
  if (input.moatScore == null || !Number.isFinite(input.moatScore)) return base;
  return base * moatFalseBreakoutFactor(input.moatScore);
}

/** Golden Cross: MA50 über MA200 und steigend. Das Gegenstück zum Death Cross. */
export function goldenCrossActive(ma50: number | null, ma200: number | null, ma50Slope: number | null): boolean {
  return ma50 != null && ma200 != null && ma50 > ma200 && ma50Slope != null && ma50Slope > 0;
}

/**
 * Verkauf nach Death Cross, solange kein Golden Cross aktiv ist.
 * Es reicht, dass der Kurs unter einer der beiden MAs liegt.
 * Wide-Moat, ein Golden Cross oder ein Kurs über beiden MAs lässt den Tag in der normalen Ampel.
 */
export function falseBreakoutSell(input: {
  price: number | null;
  ma50: number | null;
  ma200: number | null;
  ma50Slope: number | null;
  goldenCrossActive: boolean;
  rslPercentile: number | null;
  moatScore: number | null;
}): boolean {
  const deathCross = input.ma50 != null
    && input.ma200 != null
    && input.ma50 < input.ma200
    && input.ma50Slope != null
    && input.ma50Slope < 0;
  const brokeOrNear = input.price != null
    && input.ma50 != null
    && input.ma200 != null
    && (input.price < input.ma50 || input.price < input.ma200);
  const weakRsl = input.rslPercentile != null && input.rslPercentile < SYMMETRIC.rslLowQuantile;
  const notWideMoat = input.moatScore != null && input.moatScore < SYMMETRIC.moatNotWideBelow;
  return deathCross && !input.goldenCrossActive && brokeOrNear && weakRsl && notWideMoat;
}

/**
 * Konvergenz nach einem Cross. Der Abstand ist |MA50 − MA200|.
 * Er gilt als nicht bestätigt, wenn er gegenüber vor 20 Tagen nicht größer ist.
 * Golden bleibt dann gelb, ein Death Cross auch. Wächst der Abstand und der Kurs
 * liegt noch unter der MA50, bleibt der Death Cross rot. Liegt der Kurs wieder
 * über der MA50, wird er gelb, auch wenn der Abstand nicht geschrumpft ist.
 */
export type MaCross = "golden" | "death";

export function weakCross(input: {
  ma50: number | null;
  ma200: number | null;
  previousGap: number | null;
  crossType: MaCross;
}): boolean {
  if (input.ma50 == null || input.ma200 == null || input.previousGap == null) return false;
  const currentGap = Math.abs(input.ma50 - input.ma200);
  const converging = currentGap <= input.previousGap;
  if (input.crossType === "golden") return input.ma50 > input.ma200 && converging;
  return input.ma50 < input.ma200 && converging;
}

/**
 * Death Cross, der Kurs liegt wieder über der eigenen MA50, und der Abstand
 * zur MA200 ist gegenüber vor 20 Tagen nicht kleiner. Dann bleibt der Tag nicht rot.
 */
export function reclaimedMa50DuringDeathCross(input: {
  price: number | null;
  ma50: number | null;
  ma200: number | null;
  previousGap: number | null;
}): boolean {
  if (input.price == null || input.ma50 == null || input.ma200 == null) return false;
  if (!(input.ma50 < input.ma200) || !(input.price > input.ma50)) return false;
  if (input.previousGap == null) return false;
  return Math.abs(input.ma50 - input.ma200) >= input.previousGap;
}

export function volumeFactor(ratio: number | null): { factor: number; note: string } {
  if (ratio == null || !Number.isFinite(ratio)) {
    return { factor: SYMMETRIC.neutralFactor, note: "n/a — kein Volumenverhältnis, Faktor 1" };
  }
  if (ratio > SYMMETRIC.volHighRatio) {
    return { factor: SYMMETRIC.volHighFactor, note: `Volumen ${ratio.toFixed(2)}× > ${SYMMETRIC.volHighRatio}×, verstärkt ×${SYMMETRIC.volHighFactor}` };
  }
  if (ratio < SYMMETRIC.volLowRatio) {
    return { factor: SYMMETRIC.volLowFactor, note: `Volumen ${ratio.toFixed(2)}× < ${SYMMETRIC.volLowRatio}×, dämpft ×${SYMMETRIC.volLowFactor}` };
  }
  return { factor: SYMMETRIC.neutralFactor, note: `Volumen ${ratio.toFixed(2)}×, Faktor 1` };
}

/** Anteile der Thesis-Klassen. Nur Fast Grower und Cyclical verschieben den Faktor. */
export function thesisFactorFromShares(shares: Record<string, number> | null | undefined): { factor: number; note: string } {
  if (!shares) return { factor: SYMMETRIC.neutralFactor, note: "n/a — keine Thesis-Anteile, Faktor 1" };
  let fast = 0;
  let cyclical = 0;
  let weight = 0;
  for (const [name, share] of Object.entries(shares)) {
    if (!Number.isFinite(share) || share <= 0) continue;
    weight += share;
    const key = name.toLowerCase();
    if (key.includes("fast")) fast += share;
    else if (key.includes("cycl")) cyclical += share;
  }
  if (weight <= 0) return { factor: SYMMETRIC.neutralFactor, note: "n/a — Thesis-Anteile leer, Faktor 1" };
  const add = (fast / weight) * SYMMETRIC.thesisFastGrowerAdd + (cyclical / weight) * SYMMETRIC.thesisCyclicalAdd;
  const factor = Math.min(SYMMETRIC.thesisCeil, Math.max(SYMMETRIC.thesisFloor, 1 + add));
  const note = `Fast Grower ${(fast / weight * 100).toFixed(0)} % ×${(1 + (fast / weight) * SYMMETRIC.thesisFastGrowerAdd).toFixed(2)} · Cyclical ${(cyclical / weight * 100).toFixed(0)} % ×${(1 + (cyclical / weight) * SYMMETRIC.thesisCyclicalAdd).toFixed(2)} · gesamt ×${factor.toFixed(2)}`;
  return { factor, note };
}

export function thesisFactorFromClass(lynchClass: string | null | undefined): { factor: number; note: string } {
  const raw = String(lynchClass ?? "").trim();
  const key = raw.toLowerCase().replace(/\s+/g, "_");
  let add = 0;
  let note = raw ? `${raw} ohne Auf- oder Abschlag` : "n/a — keine Lynch-Klasse, Faktor 1";
  if (key === "fast_grower" || key === "fastgrower") {
    add = SYMMETRIC.thesisFastGrowerAdd;
    note = `Fast Grower +${SYMMETRIC.thesisFastGrowerAdd}`;
  } else if (key === "cyclical") {
    add = SYMMETRIC.thesisCyclicalAdd;
    note = `Cyclical ${SYMMETRIC.thesisCyclicalAdd}`;
  }
  const factor = Math.min(SYMMETRIC.thesisCeil, Math.max(SYMMETRIC.thesisFloor, 1 + add));
  return { factor, note };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function ampelFactorsFromAnalysis(data: StockAnalysis & { styleConfidences?: Record<string, number> | null }): AmpelFactors {
  const shares = data.styleConfidences;
  const thesis = shares && Object.keys(shares).length > 0
    ? thesisFactorFromShares(shares)
    : thesisFactorFromClass(data.lynchClass);
  const bs = data.financialStatements?.balanceSheet;
  const ebitda = data.ebitda;
  const netDebt = bs?.netDebt;
  const de = bs?.debtToEquity;
  const current = bs?.currentRatio;
  const ndEbitda = finite(netDebt) && finite(ebitda) && ebitda !== 0 ? netDebt / ebitda : null;
  const bits = [
    finite(de) ? `D/E ${de.toFixed(2)}` : "D/E n/a",
    finite(current) ? `Current ${current.toFixed(2)}` : "Current n/a",
    ndEbitda != null ? `NetDebt/EBITDA ${ndEbitda.toFixed(2)}` : "NetDebt/EBITDA n/a",
    "Zinsdeckung n/a",
  ];
  const rating = data.moatAssessment?.overallRating ?? data.moatRating ?? null;
  const moatScore = moatScoreFromRating(rating);
  const moatNote = moatScore == null
    ? "Moat n/a — Dämpfung bleibt technisch"
    : `Moat ${rating} ${moatScore.toFixed(1)} ×${moatFalseBreakoutFactor(moatScore).toFixed(2)}`;
  return {
    thesisFactor: thesis.factor,
    thesisNote: thesis.note,
    bsFactor: SYMMETRIC.neutralFactor,
    bsNote: `${bits.join(" · ")} — keine Bilanz-Historie, Faktor 1`,
    betaFactor: SYMMETRIC.neutralFactor,
    betaNote: finite(data.beta5Y)
      ? `Beta ${data.beta5Y.toFixed(2)} — keine Beta-Historie, kein Vergleich mit einem festen Pegel, Faktor 1`
      : "Beta n/a — Faktor 1",
    moatScore,
    moatNote,
  };
}

function smaAt(values: readonly number[], index: number, period: number): number | null {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) return null;
    sum += v;
  }
  return sum / period;
}

function quantile(values: readonly number[], q: number): number | null {
  const xs = values.filter(v => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const idx = q * (xs.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}

/** Hohe eigene Schwankung verlängert das Schwellenfenster bis 60 Tage. */
export function adaptiveWindowLength(volPercentile: number | null): number {
  const p = volPercentile == null ? 0 : Math.min(1, Math.max(0, volPercentile));
  return Math.round(SYMMETRIC.baseWindow + (SYMMETRIC.maxWindow - SYMMETRIC.baseWindow) * p);
}

function returnStdev(closes: readonly number[], index: number, len: number): number | null {
  if (index < len) return null;
  const rets: number[] = [];
  for (let j = index - len + 1; j <= index; j++) {
    const prev = closes[j - 1];
    const cur = closes[j];
    if (!(prev > 0) || !(cur > 0)) return null;
    rets.push(Math.log(cur / prev));
  }
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
  const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

interface RunningRank {
  sorted: number[];
  push(value: number): number;
}

function runningRank(): RunningRank {
  const sorted: number[] = [];
  return {
    sorted,
    push(value: number): number {
      let lo = 0;
      let hi = sorted.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] <= value) lo = mid + 1;
        else hi = mid;
      }
      sorted.splice(lo, 0, value);
      return (lo + 1) / sorted.length;
    },
  };
}

function fact(
  name: string,
  value: number | null,
  percentile: number | null,
  slope: number | null,
  signal: number | null,
): SignalFact {
  return { name, value, percentile, slopeSign: slope, signal };
}

function slopeWord(sign: number | null): string {
  if (sign == null) return "n/a";
  if (sign > 0) return "steigend";
  if (sign < 0) return "fallend";
  return "flach";
}

function pctWord(p: number | null): string {
  if (p == null) return "n/a";
  return `P${Math.round(p * 100)}`;
}

function num(v: number | null, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toFixed(digits);
}

export function describeSnapshot(snap: Omit<SymmetricSnapshot, "summary">): string {
  const signals = snap.facts.map(f =>
    `${f.name} ${num(f.value)} ${pctWord(f.percentile)} ${slopeWord(f.slopeSign)} ${f.signal == null ? "n/a" : (f.signal >= 0 ? "+" : "") + f.signal.toFixed(2)}`,
  );
  const band = snap.color
    ? `${snap.color} ${snap.meaning} · adjusted ${num(snap.adjusted)} · p30 ${num(snap.p30)} · p70 ${num(snap.p70)} · Fenster ${snap.window ?? "n/a"}T`
    : "n/a — zu wenig eigene Historie für p30/p70";
  return [
    ...signals,
    snap.volumeNote,
    snap.falseBreakoutNote,
    `Thesis ${snap.factors.thesisNote} ×${snap.factors.thesisFactor.toFixed(2)}`,
    snap.factors.moatNote,
    `Bilanz ${snap.factors.bsNote}`,
    snap.factors.betaNote,
    band,
    `Historie ${snap.historyDays} Handelstage`,
  ].join(" · ");
}

const EMPTY_FACTORS: AmpelFactors = {
  thesisFactor: 1,
  thesisNote: "n/a",
  bsFactor: 1,
  bsNote: "n/a",
  betaFactor: 1,
  betaNote: "n/a",
  moatScore: null,
  moatNote: "Moat n/a",
};

/**
 * Kausale Serie: Perzentile sehen nur Werte bis zum jeweiligen Tag.
 * `bars` sollten die volle Historie sein, nicht das sichtbare Fenster.
 */
export function symmetricAmpelSeries(
  bars: readonly SymmetricBar[],
  factors: AmpelFactors = EMPTY_FACTORS,
): SymmetricSeries {
  const closes = bars.map(b => b.close);
  const volumes = bars.map(b => (finite(b.volume) ? b.volume as number : Number.NaN));
  const rsl: (number | null)[] = [];
  const ma50Ratio: (number | null)[] = [];
  const maGap: (number | null)[] = [];
  const ma200Series: (number | null)[] = [];
  const ma50Series: (number | null)[] = [];
  const rsi: (number | null)[] = [];
  const macd: (number | null)[] = [];
  const volRatio: (number | null)[] = [];

  for (let i = 0; i < bars.length; i++) {
    const ma52 = smaAt(closes, i, SYMMETRIC.ma52Days);
    rsl.push(ma52 != null && ma52 !== 0 ? closes[i] / ma52 : null);
    const ma50 = finite(bars[i].ma50) ? bars[i].ma50 as number : smaAt(closes, i, SYMMETRIC.ma50Days);
    const ma200 = finite(bars[i].ma200) ? bars[i].ma200 as number : smaAt(closes, i, SYMMETRIC.ma200Days);
    ma200Series.push(ma200);
    ma50Series.push(ma50);
    ma50Ratio.push(ma50 != null && ma50 !== 0 ? closes[i] / ma50 : null);
    maGap.push(ma50 != null && ma200 != null && ma200 !== 0 ? ma50 / ma200 : null);
    rsi.push(finite(bars[i].rsi) ? bars[i].rsi as number : null);
    macd.push(finite(bars[i].histogram) ? bars[i].histogram as number : null);
    const volSma = smaAt(volumes, i, SYMMETRIC.volumeDays);
    const vol = bars[i].volume;
    volRatio.push(volSma != null && volSma > 0 && finite(vol) && vol > 0 ? vol / volSma : null);
  }

  const ranks = {
    rsl: runningRank(),
    rsi: runningRank(),
    macd: runningRank(),
    ma50: runningRank(),
    gap: runningRank(),
  };
  const adjusted: (number | null)[] = [];
  const techAt: (number | null)[] = [];
  const factsAt: SignalFact[][] = [];
  const volAt: { ratio: number | null; factor: number; note: string }[] = [];
  const breakoutAt: { factor: number; breakdownFactor: number; active: boolean; breakdown: boolean; sell: boolean; weakCross: boolean; reclaimedMa50: boolean; crossType: "golden" | "death" | "none"; note: string }[] = [];

  const rslHist: number[] = [];
  const volHist: number[] = [];

  const pushSignal = (
    name: string,
    series: readonly (number | null)[],
    index: number,
    rank: RunningRank,
    bucket: SignalFact[],
    signals: number[],
  ) => {
    const value = series[index];
    if (value == null) {
      bucket.push(fact(name, null, null, null, null));
      return;
    }
    const pct = rank.push(value);
    const slope = slopeSignOf(series, index);
    const resolved = slope == null ? null : signalFromPercentile(pct, slope);
    if (resolved != null) signals.push(resolved);
    bucket.push(fact(name, value, pct, slope, resolved));
  };

  for (let i = 0; i < bars.length; i++) {
    const bucket: SignalFact[] = [];
    const signals: number[] = [];
    pushSignal("Kurs/MA52", rsl, i, ranks.rsl, bucket, signals);
    pushSignal("RSI", rsi, i, ranks.rsi, bucket, signals);
    pushSignal("MACD-Hist", macd, i, ranks.macd, bucket, signals);
    pushSignal("MA50", ma50Ratio, i, ranks.ma50, bucket, signals);
    pushSignal("MA-Lage", maGap, i, ranks.gap, bucket, signals);
    const ma200Slope = slopeSignOf(ma200Series, i, SYMMETRIC.ma200SlopeDays);
    const rslFact = bucket.find(item => item.name === "Kurs/MA52");
    const rslNow = rsl[i];
    const volNow = volRatio[i];
    if (rslNow != null) rslHist.push(rslNow);
    if (volNow != null) volHist.push(volNow);
    const regime: FalseBreakoutInput = {
      price: closes[i],
      ma200: ma200Series[i],
      ma200Slope,
      rslValue: rsl[i],
      rslPercentile: rslFact?.percentile ?? null,
      rslHistory: rslHist,
      volRatio: volRatio[i],
      volHistory: volHist,
      moatScore: factors.moatScore,
    };
    const bearFlag = isFalseBreakout(regime);
    const bullFlag = isFalseBreakdown(regime);
    const damp = falseBreakoutFactorOf(regime);
    const tech = signals.length ? signals.reduce((a, b) => a + b, 0) / signals.length : null;
    const vol = volumeFactor(volRatio[i]);
    const moatBit = factors.moatScore == null
      ? ""
      : ` · Moat ${factors.moatScore.toFixed(1)} ×${moatFalseBreakoutFactor(factors.moatScore).toFixed(2)}`;
    const ma50Slope = slopeSignOf(ma50Series, i, SYMMETRIC.ma50SlopeDays);
    const ma50Now = ma50Series[i];
    const ma200Now = ma200Series[i];
    const crossType: "golden" | "death" | "none" = ma50Now == null || ma200Now == null || ma50Now === ma200Now
      ? "none"
      : ma50Now > ma200Now ? "golden" : "death";
    const lookback = i - SYMMETRIC.ma50SlopeDays;
    const prevMa50 = lookback >= 0 ? ma50Series[lookback] : null;
    const prevMa200 = lookback >= 0 ? ma200Series[lookback] : null;
    const previousGap = prevMa50 != null && prevMa200 != null ? Math.abs(prevMa50 - prevMa200) : null;
    const converging = crossType !== "none" && weakCross({ ma50: ma50Now, ma200: ma200Now, previousGap, crossType });
    const reclaimed = reclaimedMa50DuringDeathCross({
      price: closes[i],
      ma50: ma50Now,
      ma200: ma200Now,
      previousGap,
    });
    const sell = falseBreakoutSell({
      price: closes[i],
      ma50: ma50Now,
      ma200: ma200Now,
      ma50Slope,
      goldenCrossActive: goldenCrossActive(ma50Now, ma200Now, ma50Slope),
      rslPercentile: rslFact?.percentile ?? null,
      moatScore: factors.moatScore,
    });
    const crossNote = converging
      ? `${crossType === "golden" ? "Golden" : "Death"} Cross konvergiert`
      : reclaimed
        ? "Death Cross, Kurs über MA50, Abstand nicht geschrumpft"
        : crossType === "death"
          ? "Death Cross, Abstand wächst"
          : "";
    const breakoutNote = [
      sell && !converging && !reclaimed
        ? `False-Breakout-Verkauf ROT · Death Cross ohne Golden Cross · Bruch unter MA50 oder MA200${moatBit}`
        : bearFlag || bullFlag
          ? `${bearFlag ? "False Breakout" : "False Breakdown"} ×${damp.toFixed(2)}${moatBit}`
          : "False-Breakout-Faktor 1",
      crossNote,
    ].filter(part => part.length > 0).join(" · ");
    const product = tech == null
      ? null
      : tech * factors.thesisFactor * factors.bsFactor * vol.factor * factors.betaFactor * damp;
    techAt.push(tech);
    adjusted.push(product);
    factsAt.push(bucket);
    volAt.push({ ratio: volRatio[i], factor: vol.factor, note: vol.note });
    breakoutAt.push({ factor: damp, breakdownFactor: bullFlag ? damp : SYMMETRIC.neutralFactor, active: bearFlag, breakdown: bullFlag, sell, weakCross: converging, reclaimedMa50: reclaimed, crossType, note: breakoutNote });
  }

  const stdevs: number[] = [];
  const phases = new Map<string, TaPhase | null>();
  const colors = new Map<string, SymmetricColor | null>();
  let last: SymmetricSnapshot | null = null;

  for (let i = 0; i < bars.length; i++) {
    const sd = returnStdev(closes, i, SYMMETRIC.volLookback);
    let volPct: number | null = null;
    if (sd != null) {
      stdevs.push(sd);
      volPct = historyPercentile(stdevs, sd);
    }
    const window = adaptiveWindowLength(volPct);
    const from = Math.max(0, i - window + 1);
    const recent: number[] = [];
    for (let j = from; j <= i; j++) {
      const v = adjusted[j];
      if (v != null) recent.push(v);
    }
    let color: SymmetricColor | null = null;
    let p30: number | null = null;
    let p70: number | null = null;
    const current = adjusted[i];
    if (current != null && recent.length >= SYMMETRIC.baseWindow) {
      p30 = quantile(recent, SYMMETRIC.lowQuantile);
      p70 = quantile(recent, SYMMETRIC.highQuantile);
      if (p30 != null && p70 != null) {
        // Ein Tag genügt. Eine Mehrheit über mehrere Tage würde Wide und Narrow gleich halten.
        if (current > p70) color = "GRÜN";
        else if (current < p30) color = "ROT";
        else color = "GELB";
      }
    }
    if (breakoutAt[i].weakCross) color = "GELB";
    else if (breakoutAt[i].reclaimedMa50) color = "GELB";
    else if (breakoutAt[i].crossType === "death") color = "ROT";
    else if (breakoutAt[i].sell) color = "ROT";
    phases.set(bars[i].date, symmetricColorPhase(color));
    colors.set(bars[i].date, color);
    const base = {
      color,
      meaning: color ? COLOR_MEANING[color] : null,
      paint: symmetricColorPhase(color),
      adjusted: current,
      tech: techAt[i],
      p30,
      p70,
      window: current != null && recent.length >= SYMMETRIC.baseWindow ? window : null,
      historyDays: i + 1,
      factors,
      volumeRatio: volAt[i].ratio,
      volumeFactor: volAt[i].factor,
      volumeNote: volAt[i].note,
      falseBreakoutFactor: breakoutAt[i].factor,
      falseBreakout: breakoutAt[i].active,
      falseBreakdownFactor: breakoutAt[i].breakdownFactor,
      falseBreakdown: breakoutAt[i].breakdown,
      falseBreakoutNote: breakoutAt[i].note,
      falseBreakoutSell: breakoutAt[i].sell,
      weakCross: breakoutAt[i].weakCross,
      reclaimedMa50: breakoutAt[i].reclaimedMa50,
      crossType: breakoutAt[i].crossType,
      facts: factsAt[i],
    };
    last = { ...base, summary: describeSnapshot(base) };
  }

  return { phases, colors, last };
}
