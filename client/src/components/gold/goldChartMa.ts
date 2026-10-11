/**
 * Visual MA50 + Golden/Death markers for the gold price chart (Future_10 §4 / §7).
 * SMA uses the close series already on each GoldPricePoint — the same trailing
 * window and cent rounding as ma200 in server/gold-routes.ts. This module is
 * not an input to getTechnicalScore. Volume is absent on the price point; it
 * is not invented here.
 */

export type MaCrossType = "golden" | "death";

export type MaCross = {
  date: string;
  type: MaCrossType;
  ma50: number;
  ma200: number;
};

/** Trailing SMA. Null until `period` closes exist. Rounded to cents. */
export function trailingSma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i + 1 - period, i + 1);
    const ma = slice.reduce((sum, value) => sum + value, 0) / period;
    out[i] = Math.round(ma * 100) / 100;
  }
  return out;
}

export function withClientMa50<T extends { close: number }>(points: T[]): (T & { ma50: number | null })[] {
  const ma50 = trailingSma(points.map((point) => point.close), 50);
  return points.map((point, index) => ({ ...point, ma50: ma50[index] }));
}

/**
 * Golden: 50-day MA crosses the 200-day MA from below.
 * Death: 50-day MA crosses the 200-day MA from above.
 * A bar needs both averages on itself and on the previous bar.
 */
export function detectMaCrosses(
  points: { date: string; ma50: number | null; ma200?: number | null }[],
): MaCross[] {
  const crosses: MaCross[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev50 = points[i - 1].ma50;
    const prev200 = points[i - 1].ma200;
    const ma50 = points[i].ma50;
    const ma200 = points[i].ma200;
    if (prev50 == null || prev200 == null || ma50 == null || ma200 == null) continue;
    if (prev50 <= prev200 && ma50 > ma200) {
      crosses.push({ date: points[i].date, type: "golden", ma50, ma200 });
    } else if (prev50 >= prev200 && ma50 < ma200) {
      crosses.push({ date: points[i].date, type: "death", ma50, ma200 });
    }
  }
  return crosses;
}
