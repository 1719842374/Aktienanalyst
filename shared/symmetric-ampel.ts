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
export function slopeSignOf(series: readonly (number | null | undefined)[], index: number, days = SYMMETRIC.slopeDays): number | null {
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

export function ampelFactorsFromAnalysis(data: StockAnalysis): AmpelFactors {
  const thesis = thesisFactorFromClass(data.lynchClass);
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
  return {
    thesisFactor: thesis.factor,
    thesisNote: thesis.note,
    bsFactor: SYMMETRIC.neutralFactor,
    bsNote: `${bits.join(" · ")} — keine Bilanz-Historie, Faktor 1`,
    betaFactor: SYMMETRIC.neutralFactor,
    betaNote: finite(data.beta5Y)
      ? `Beta ${data.beta5Y.toFixed(2)} — keine Beta-Historie, kein Vergleich mit einem festen Pegel, Faktor 1`
      : "Beta n/a — Faktor 1",
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
    `Thesis ${snap.factors.thesisNote} ×${snap.factors.thesisFactor.toFixed(2)}`,
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
  const rsi: (number | null)[] = [];
  const macd: (number | null)[] = [];
  const volRatio: (number | null)[] = [];

  for (let i = 0; i < bars.length; i++) {
    const ma52 = smaAt(closes, i, SYMMETRIC.ma52Days);
    rsl.push(ma52 != null && ma52 !== 0 ? closes[i] / ma52 : null);
    const ma50 = finite(bars[i].ma50) ? bars[i].ma50 as number : smaAt(closes, i, SYMMETRIC.ma50Days);
    const ma200 = finite(bars[i].ma200) ? bars[i].ma200 as number : smaAt(closes, i, SYMMETRIC.ma200Days);
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
    const tech = signals.length ? signals.reduce((a, b) => a + b, 0) / signals.length : null;
    const vol = volumeFactor(volRatio[i]);
    const product = tech == null
      ? null
      : tech * factors.thesisFactor * factors.bsFactor * vol.factor * factors.betaFactor;
    techAt.push(tech);
    adjusted.push(product);
    factsAt.push(bucket);
    volAt.push({ ratio: volRatio[i], factor: vol.factor, note: vol.note });
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
        if (current > p70) color = "GRÜN";
        else if (current < p30) color = "ROT";
        else color = "GELB";
      }
    }
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
      facts: factsAt[i],
    };
    last = { ...base, summary: describeSnapshot(base) };
  }

  return { phases, colors, last };
}
