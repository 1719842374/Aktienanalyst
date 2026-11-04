/**
 * Kauf- und Verkaufsmarken der BTC-Tagesreihe.
 * Die Erkennung läuft über die ganze übergebene Reihe. Ein Zuschnitt auf die
 * letzten 100 Marken lässt auf einem 10-Jahres-Chart nur die Zeit ab etwa
 * 2021 übrig, obwohl MA und MACD schon ab 2011 kreuzt.
 */

export interface BtcChartSignalBar {
  date: string;
  price: number;
  ma50: number | null;
  ma200: number | null;
  macd: number | null;
  signal: number | null;
  ma111: number | null;
  ma350x2: number | null;
  ma730: number | null;
}

export interface BtcChartSignal {
  date: string;
  type: "BUY" | "SELL";
  reason: string;
  price: number;
}

export function detectBtcChartSignals(series: readonly BtcChartSignalBar[]): BtcChartSignal[] {
  const signals: BtcChartSignal[] = [];

  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const curr = series[i];

    if (prev.ma50 !== null && prev.ma200 !== null && curr.ma50 !== null && curr.ma200 !== null) {
      if (prev.ma50 <= prev.ma200 && curr.ma50 > curr.ma200) {
        signals.push({ date: curr.date, type: "BUY", reason: "Golden Cross (MA50 > MA200)", price: curr.price });
      }
      if (prev.ma50 >= prev.ma200 && curr.ma50 < curr.ma200) {
        signals.push({ date: curr.date, type: "SELL", reason: "Death Cross (MA50 < MA200)", price: curr.price });
      }
    }

    if (prev.macd !== null && prev.signal !== null && curr.macd !== null && curr.signal !== null) {
      if (prev.macd <= prev.signal && curr.macd > curr.signal) {
        signals.push({ date: curr.date, type: "BUY", reason: "MACD Bullish Crossover", price: curr.price });
      }
      if (prev.macd >= prev.signal && curr.macd < curr.signal) {
        signals.push({ date: curr.date, type: "SELL", reason: "MACD Bearish Crossover", price: curr.price });
      }
    }

    if (prev.macd !== null && curr.macd !== null) {
      if (prev.macd <= 0 && curr.macd > 0) {
        signals.push({ date: curr.date, type: "BUY", reason: "MACD über Nulllinie", price: curr.price });
      }
      if (prev.macd >= 0 && curr.macd < 0) {
        signals.push({ date: curr.date, type: "SELL", reason: "MACD unter Nulllinie", price: curr.price });
      }
    }

    if (prev.ma111 !== null && prev.ma350x2 !== null && curr.ma111 !== null && curr.ma350x2 !== null) {
      if (prev.ma111 <= prev.ma350x2 && curr.ma111 > curr.ma350x2) {
        signals.push({ date: curr.date, type: "SELL", reason: "Pi Cycle Top", price: curr.price });
      }
    }

    if (prev.ma730 !== null && curr.ma730 !== null) {
      if (prev.price >= prev.ma730 && curr.price < curr.ma730) {
        signals.push({ date: curr.date, type: "SELL", reason: "Unter 2-Year MA", price: curr.price });
      }
      if (prev.price <= prev.ma730 && curr.price > curr.ma730) {
        signals.push({ date: curr.date, type: "BUY", reason: "Über 2-Year MA", price: curr.price });
      }
    }
  }

  return signals;
}

function utcDayMs(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Die Zeichenreihe ist auf etwa 500 Tage verdichtet. Eine ReferenceLine mit
 * dem echten Signaltag zeichnet nicht, wenn dieser Tag fehlt. Jede Marke
 * rückt auf den nächsten gezeichneten Tag, eine Linie pro Tag.
 */
export function snapBtcSignalsToChart<T extends { date: string }>(
  signals: readonly T[],
  chartDates: readonly string[],
): T[] {
  if (chartDates.length === 0 || signals.length === 0) return [];
  const grid = [...chartDates].sort();
  const gridMs = grid.map(utcDayMs);
  const seen = new Set<string>();
  const snapped: T[] = [];
  for (const signal of signals) {
    const target = utcDayMs(signal.date);
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < gridMs.length; i++) {
      const diff = Math.abs(gridMs[i] - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    const date = grid[best];
    if (seen.has(date)) continue;
    seen.add(date);
    snapped.push({ ...signal, date });
  }
  return snapped;
}
