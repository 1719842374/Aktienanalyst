import type { OHLCVPoint, TradingSignal } from "../../../shared/schema";

export type WindowPoint = {
  date: string;
  close: number;
  ma200?: number;
  ma100?: number;
  ma50?: number;
  ma20?: number;
  ema26?: number;
  ema12?: number;
  ema9?: number;
  macd?: number;
  signal?: number;
  histogram?: number;
  bbUpper?: number;
  bbMid?: number;
  bbLower?: number;
  rsi?: number;
  volume: number;
  _volNorm: number;
  _volUp: boolean;
  _signals: TradingSignal[] | null;
};

export type WindowSeries = { points: WindowPoint[]; signals: TradingSignal[] };

type FullPoint = Omit<WindowPoint, "_volNorm">;

export type FullSeries = {
  points: FullPoint[];
  signals: TradingSignal[];
  indexOf: Map<OHLCVPoint, number>;
  indexByDate: Map<string, number>;
};

function calcRSI(closes: number[], period = 14): (number | undefined)[] {
  const rsi: (number | undefined)[] = [];
  if (closes.length < period + 1) return closes.map(() => undefined);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = 0; i < period; i++) rsi.push(undefined);
  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
  }
  return rsi;
}

function calcBollinger(closes: number[], period = 20, k = 2) {
  return closes.map((_, i) => {
    if (i < period - 1) return { bbMid: undefined, bbUpper: undefined, bbLower: undefined };
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return { bbMid: mean, bbUpper: mean + k * std, bbLower: mean - k * std };
  });
}

export function smaSeries(data: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(data.length);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) sum -= data[i - period];
    out[i] = i >= period - 1 ? sum / period : undefined;
  }
  return out;
}

function emaSeries(data: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(data.length);
  const k = 2 / (period + 1);
  let ema: number | undefined;
  for (let i = 0; i < data.length; i++) {
    if (!isFinite(data[i])) { out[i] = undefined; continue; }
    if (ema === undefined) {
      if (i >= period - 1) {
        let s = 0;
        for (let j = i - period + 1; j <= i; j++) s += data[j];
        ema = s / period;
        out[i] = ema;
      } else {
        out[i] = undefined;
      }
    } else {
      ema = data[i] * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}

/** MAs, BB, RSI, MACD und Signale einmal auf der vollen, chronologischen OHLCV-Historie. */
export function buildFullSeries(ohlcv: OHLCVPoint[]): FullSeries {
  let sorted = true;
  for (let i = 1; i < ohlcv.length; i++) {
    if (ohlcv[i - 1].date > ohlcv[i].date) { sorted = false; break; }
  }
  const bars = sorted ? ohlcv : [...ohlcv].sort((a, b) => a.date.localeCompare(b.date));
  const indexOf = new Map<OHLCVPoint, number>();
  const indexByDate = new Map<string, number>();
  bars.forEach((b, i) => {
    indexOf.set(b, i);
    if (!indexByDate.has(b.date)) indexByDate.set(b.date, i);
  });
  if (bars.length === 0) return { points: [], signals: [], indexOf, indexByDate };
  const closes = bars.map(b => b.close);
  const dates = bars.map(b => b.date);
  const ma200 = smaSeries(closes, 200);
  const ma100 = smaSeries(closes, 100);
  const ma50 = smaSeries(closes, 50);
  const ma20 = smaSeries(closes, 20);
  const ema26 = emaSeries(closes, 26);
  const ema12 = emaSeries(closes, 12);
  const ema9 = emaSeries(closes, 9);

  const macdRaw: number[] = closes.map((_, i) => {
    const e12 = ema12[i], e26 = ema26[i];
    return (e12 != null && e26 != null) ? e12 - e26 : NaN;
  });
  const firstValid = macdRaw.findIndex(v => isFinite(v));
  const macdForEma = macdRaw.map(v => isFinite(v) ? v : 0);
  const signalSeries = emaSeries(macdForEma, 9);
  for (let i = 0; i < firstValid + 8; i++) if (i < bars.length) signalSeries[i] = undefined;

  const bb = calcBollinger(closes);
  const rsi = calcRSI(closes);

  const macdAt = (i: number) => (isFinite(macdRaw[i]) ? macdRaw[i] : undefined);
  const signals: TradingSignal[] = [];
  for (let i = 1; i < bars.length; i++) {
    const cur50 = ma50[i], prev50 = ma50[i - 1];
    const cur200 = ma200[i], prev200 = ma200[i - 1];
    if (cur50 != null && cur200 != null && prev50 != null && prev200 != null) {
      if (prev50 <= prev200 && cur50 > cur200) {
        signals.push({ date: dates[i], type: "buy", reason: "Golden Cross (MA50 > MA200)", price: closes[i] });
      } else if (prev50 >= prev200 && cur50 < cur200) {
        signals.push({ date: dates[i], type: "sell", reason: "Death Cross (MA50 < MA200)", price: closes[i] });
      }
    }
    const curM = macdAt(i), prevM = macdAt(i - 1);
    const curS = signalSeries[i], prevS = signalSeries[i - 1];
    if (curM != null && prevM != null && curS != null && prevS != null) {
      if (prevM <= prevS && curM > curS) {
        signals.push({ date: dates[i], type: "buy", reason: "Bullish MACD Cross", price: closes[i] });
      } else if (prevM >= prevS && curM < curS) {
        signals.push({ date: dates[i], type: "sell", reason: "Bearish MACD Cross", price: closes[i] });
      }
    }
  }

  const signalsByDate = new Map<string, TradingSignal[]>();
  for (const s of signals) {
    const arr = signalsByDate.get(s.date) || [];
    arr.push(s);
    signalsByDate.set(s.date, arr);
  }

  const points: FullPoint[] = bars.map((b, i) => {
    const m = macdAt(i);
    const sig = signalSeries[i];
    const prevClose = i > 0 ? closes[i - 1] : closes[i];
    return {
      date: b.date,
      close: b.close,
      ma200: ma200[i], ma100: ma100[i], ma50: ma50[i],
      ma20: ma20[i], ema26: ema26[i], ema12: ema12[i], ema9: ema9[i],
      macd: m,
      signal: sig,
      histogram: (m != null && sig != null) ? m - sig : undefined,
      bbUpper: bb[i]?.bbUpper,
      bbMid: bb[i]?.bbMid,
      bbLower: bb[i]?.bbLower,
      rsi: rsi[i],
      volume: b.volume ?? 0,
      _volUp: b.close >= prevClose,
      _signals: signalsByDate.get(b.date) || null,
    };
  });
  return { points, signals, indexOf, indexByDate };
}

/**
 * Fenster = Ausschnitt der vollen Serie. Wert am Datum D = Wert der Gesamt-Historie an D.
 * Kopien der Bars (anderes Objekt, gleiches Datum) treffen denselben Index.
 * Fehlt Historie vor Fensterbeginn, bleiben lange Perioden am Anfang leer.
 */
export function buildWindowSeries(full: FullSeries, bars: OHLCVPoint[]): WindowSeries {
  if (bars.length === 0) return { points: [], signals: [] };
  const allVols = bars.map(b => b.volume).filter(v => v > 0);
  const maxVol = allVols.length ? Math.max(...allVols) : 1;
  const dates = new Set<string>();
  const points: WindowPoint[] = [];
  for (const b of bars) {
    const i = full.indexOf.get(b) ?? full.indexByDate.get(b.date);
    if (i === undefined) continue;
    dates.add(full.points[i].date);
    points.push({ ...full.points[i], _volNorm: b.volume > 0 ? b.volume / maxVol : 0 });
  }
  const signals = full.signals.filter(s => dates.has(s.date));
  return { points, signals };
}

export function sliceBars(bars: OHLCVPoint[], from: string, to: string): OHLCVPoint[] {
  if (!from || !to || from > to) return [];
  const out: OHLCVPoint[] = [];
  for (const p of bars) {
    if (p.date >= from && p.date <= to) out.push(p);
  }
  return out;
}

/** Index des ersten endlichen Indikatorwerts, oder -1. */
export function firstFiniteIndex(points: WindowPoint[], key: keyof WindowPoint): number {
  return points.findIndex(p => {
    const v = p[key];
    return typeof v === "number" && isFinite(v);
  });
}
