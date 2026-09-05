/** Wilder RSI + MACD(12,26,9). Kombination nur Label, kein 17er-Score. */

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
  const macdFilled = macdLine.map((v, i) => {
    if (v != null) return v;
    const prev = macdLine.slice(0, i).reverse().find(x => x != null);
    return prev ?? 0;
  });
  const firstMacd = macdLine.findIndex(v => v != null);
  const signalFull: Array<number | null> = Array(closes.length).fill(null);
  if (firstMacd >= 0) {
    const slice = macdLine.slice(firstMacd) as number[];
    const dense = slice.map(v => v ?? 0);
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
  | "oversold_turn"
  | "overbought_fade"
  | "aligned_up"
  | "aligned_down"
  | "mixed"
  | "n/a";

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
