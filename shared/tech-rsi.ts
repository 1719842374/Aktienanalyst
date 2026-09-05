/** Wilder RSI + MACD(12,26,9) + Swing-Divergenz. Labels, kein 17er-Score. */

export function rsiWilder(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);

  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function rsiZone(rsi: number | null): "overbought" | "oversold" | "neutral" | "n/a" {
  if (rsi == null || !Number.isFinite(rsi)) return "n/a";
  if (rsi >= 70) return "overbought";
  if (rsi <= 30) return "oversold";
  return "neutral";
}

function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let acc = 0;
  for (let i = 0; i < period; i++) acc += values[i];
  out[period - 1] = acc / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + (out[i - 1] as number) * (1 - k);
  }
  return out;
}

export interface MacdPoint {
  macd: number | null;
  signal: number | null;
  hist: number | null;
}

export function macd1269(closes: number[]): MacdPoint[] {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine: Array<number | null> = closes.map((_, i) => {
    if (ema12[i] == null || ema26[i] == null) return null;
    return (ema12[i] as number) - (ema26[i] as number);
  });
  const firstMacd = macdLine.findIndex(v => v != null);
  const signalFull: Array<number | null> = Array(closes.length).fill(null);
  if (firstMacd >= 0) {
    const dense = macdLine.slice(firstMacd).map(v => v ?? 0);
    const sig = ema(dense, 9);
    for (let i = 0; i < sig.length; i++) signalFull[firstMacd + i] = sig[i];
  }
  return closes.map((_, i) => {
    const macd = macdLine[i];
    const signal = signalFull[i];
    const hist = macd != null && signal != null ? macd - signal : null;
    return { macd, signal, hist };
  });
}

export type ComboSignal =
  | "oversold_turn" | "overbought_fade" | "aligned_up" | "aligned_down" | "mixed" | "n/a";

export function combineRsiMacd(
  rsi: number | null,
  macd: number | null,
  signal: number | null,
  hist: number | null,
  prevHist: number | null,
): ComboSignal {
  if (rsi == null || macd == null || signal == null || hist == null) return "n/a";
  const histUp = prevHist != null && prevHist <= 0 && hist > 0;
  const histDn = prevHist != null && prevHist >= 0 && hist < 0;
  if (rsi <= 35 && (hist > 0 || histUp) && macd > signal) return "oversold_turn";
  if (rsi >= 65 && (hist < 0 || histDn) && macd < signal) return "overbought_fade";
  if (rsi > 50 && macd > signal && hist > 0) return "aligned_up";
  if (rsi < 50 && macd < signal && hist < 0) return "aligned_down";
  return "mixed";
}

export type DivergenceKind =
  | "regular_bull"
  | "regular_bear"
  | "hidden_bull"
  | "hidden_bear"
  | "none";

export interface DivergenceHit {
  kind: DivergenceKind;
  lookback: number;
  i1: number;
  i2: number;
  price1: number;
  price2: number;
  rsi1: number;
  rsi2: number;
}

function localExtrema(values: number[], order: number, mode: "low" | "high"): number[] {
  const idx: number[] = [];
  for (let i = order; i < values.length - order; i++) {
    const v = values[i];
    let ok = true;
    for (let j = 1; j <= order; j++) {
      if (mode === "low" && (values[i - j] < v || values[i + j] < v)) { ok = false; break; }
      if (mode === "high" && (values[i - j] > v || values[i + j] > v)) { ok = false; break; }
    }
    if (ok) idx.push(i);
  }
  return idx;
}

/** Letzte zwei Swings im Fenster. Kein Kalender-Hardcode. */
export function detectRsiDivergence(
  closes: number[],
  rsi: Array<number | null>,
  opts?: { lookback?: number; order?: number; minGap?: number },
): DivergenceHit {
  const lookback = opts?.lookback ?? 90;
  const order = opts?.order ?? 5;
  const minGap = opts?.minGap ?? 8;
  const empty: DivergenceHit = { kind: "none", lookback, i1: -1, i2: -1, price1: 0, price2: 0, rsi1: 0, rsi2: 0 };
  const n = Math.min(closes.length, rsi.length);
  if (n < lookback / 2) return empty;
  const start = Math.max(0, n - lookback);
  const px: number[] = [];
  const rs: number[] = [];
  const map: number[] = [];
  for (let i = start; i < n; i++) {
    if (rsi[i] == null || !Number.isFinite(closes[i])) continue;
    map.push(i);
    px.push(closes[i]);
    rs.push(rsi[i] as number);
  }
  if (px.length < order * 4) return empty;

  const lows = localExtrema(px, order, "low");
  const highs = localExtrema(px, order, "high");

  const pair = (swings: number[]) => {
    if (swings.length < 2) return null;
    const b = swings[swings.length - 1];
    let a = -1;
    for (let k = swings.length - 2; k >= 0; k--) {
      if (b - swings[k] >= minGap) { a = swings[k]; break; }
    }
    if (a < 0) return null;
    return { a, b };
  };

  const lowP = pair(lows);
  const highP = pair(highs);
  const priceEps = 0.003;
  const rsiEps = 2;

  if (lowP) {
    const p1 = px[lowP.a], p2 = px[lowP.b], r1 = rs[lowP.a], r2 = rs[lowP.b];
    const hit = (kind: DivergenceKind): DivergenceHit => ({
      kind, lookback, i1: map[lowP.a], i2: map[lowP.b], price1: p1, price2: p2, rsi1: r1, rsi2: r2,
    });
    if (p2 < p1 * (1 - priceEps) && r2 > r1 + rsiEps) return hit("regular_bull");
    if (p2 > p1 * (1 + priceEps) && r2 < r1 - rsiEps) return hit("hidden_bull");
  }
  if (highP) {
    const p1 = px[highP.a], p2 = px[highP.b], r1 = rs[highP.a], r2 = rs[highP.b];
    const hit = (kind: DivergenceKind): DivergenceHit => ({
      kind, lookback, i1: map[highP.a], i2: map[highP.b], price1: p1, price2: p2, rsi1: r1, rsi2: r2,
    });
    if (p2 > p1 * (1 + priceEps) && r2 < r1 - rsiEps) return hit("regular_bear");
    if (p2 < p1 * (1 - priceEps) && r2 > r1 + rsiEps) return hit("hidden_bear");
  }
  return empty;
}
