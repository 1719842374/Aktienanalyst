/**
 * F10-33 — Backtest der MA-Kreuz-Signale auf Gold (Future_10 §11, Z.274).
 *
 * Pure module. Not mounted in any page and not an input to getTechnicalScore,
 * the gold adaptive layer, the GIS or any route. Crosses come from the same
 * `trailingSma` / `detectMaCrosses` as the chart markers in goldChartMa.ts, so
 * the backtest tests exactly the signals the chart draws.
 *
 * Bias controls:
 * - Look-ahead: a cross is known only at the close of bar t (MAs use closes
 *   up to and including t). Entry/exit happen at the close of bar t+1. A cross
 *   on the last bar has no fill and is reported as pending, not traded.
 * - Forward returns are measured from the fill close. A horizon that runs past
 *   the last bar is null (n/a) and is left out of averages and hit rates.
 * - Survivorship: one instrument chosen by the spec (gold), not picked from a
 *   universe after the fact. The series is the input as given; gaps are not
 *   filled. Price-only (no roll yield, no collateral interest), gross of costs
 *   unless `costBps` is set.
 */
import { detectMaCrosses, trailingSma, type MaCrossType } from "./goldChartMa";

export type BacktestBar = { date: string; close: number };

export const BACKTEST_HORIZONS = [20, 60, 120, 250] as const;

export type CrossEvent = {
  type: MaCrossType;
  signalDate: string;
  /** Close of the bar after the signal; null when the signal is on the last bar. */
  fillDate: string | null;
  fillClose: number | null;
  /** Forward return in % from the fill close per horizon (trading bars); null = n/a. */
  forward: Record<number, number | null>;
};

export type CrossStats = {
  type: MaCrossType;
  count: number;
  /** Per horizon: number of events with data, mean %, median %, share in the signal's direction. */
  byHorizon: Record<number, { n: number; meanPct: number | null; medianPct: number | null; hitRate: number | null }>;
};

export type LongFlatTrade = {
  entryDate: string;
  entryClose: number;
  exitDate: string | null;
  exitClose: number;
  returnPct: number;
  open: boolean;
};

export type GoldMaBacktest = {
  firstDate: string | null;
  lastDate: string | null;
  bars: number;
  /** First bar where MA50 and MA200 both exist (evaluation start). */
  evalStart: string | null;
  events: CrossEvent[];
  pending: CrossEvent[];
  stats: CrossStats[];
  trades: LongFlatTrade[];
  strategy: {
    totalReturnPct: number | null;
    buyHoldReturnPct: number | null;
    timeInMarketPct: number | null;
    costBps: number;
  };
  reason: string | null;
};

function pct(from: number, to: number): number {
  return (to / from - 1) * 100;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function runGoldMaBacktest(
  input: BacktestBar[],
  opts: { costBps?: number; horizons?: readonly number[] } = {},
): GoldMaBacktest {
  const costBps = opts.costBps ?? 0;
  const horizons = opts.horizons ?? BACKTEST_HORIZONS;
  const bars = input.filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && Number.isFinite(b.close) && b.close > 0);
  const empty: GoldMaBacktest = {
    firstDate: bars[0]?.date ?? null,
    lastDate: bars[bars.length - 1]?.date ?? null,
    bars: bars.length,
    evalStart: null,
    events: [],
    pending: [],
    stats: [],
    trades: [],
    strategy: { totalReturnPct: null, buyHoldReturnPct: null, timeInMarketPct: null, costBps },
    reason: null,
  };
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].date <= bars[i - 1].date) return { ...empty, reason: "Serie nicht streng aufsteigend sortiert" };
  }
  if (bars.length < 201) return { ...empty, reason: `zu wenig Kurse (${bars.length} < 201) für MA200 plus ein Folgetag` };

  const closes = bars.map((b) => b.close);
  const ma50 = trailingSma(closes, 50);
  const ma200 = trailingSma(closes, 200);
  const points = bars.map((b, i) => ({ date: b.date, ma50: ma50[i], ma200: ma200[i] }));
  const evalIdx = points.findIndex((p) => p.ma50 != null && p.ma200 != null);
  const indexOf = new Map(bars.map((b, i) => [b.date, i]));

  const events: CrossEvent[] = [];
  const pending: CrossEvent[] = [];
  for (const cross of detectMaCrosses(points)) {
    const i = indexOf.get(cross.date)!;
    const fill = i + 1 < bars.length ? i + 1 : null;
    const forward: Record<number, number | null> = {};
    for (const h of horizons) {
      forward[h] = fill != null && fill + h < bars.length ? pct(closes[fill], closes[fill + h]) : null;
    }
    const ev: CrossEvent = {
      type: cross.type,
      signalDate: cross.date,
      fillDate: fill != null ? bars[fill].date : null,
      fillClose: fill != null ? closes[fill] : null,
      forward,
    };
    (fill == null ? pending : events).push(ev);
  }

  const stats: CrossStats[] = (["golden", "death"] as const).map((type) => {
    const list = events.filter((e) => e.type === type);
    const byHorizon: CrossStats["byHorizon"] = {};
    for (const h of horizons) {
      const vals = list.map((e) => e.forward[h]).filter((v): v is number => v != null);
      const hits = vals.filter((v) => (type === "golden" ? v > 0 : v < 0)).length;
      byHorizon[h] = {
        n: vals.length,
        meanPct: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
        medianPct: median(vals),
        hitRate: vals.length ? hits / vals.length : null,
      };
    }
    return { type, count: list.length, byHorizon };
  });

  // Long/flat: in the market from a golden fill to the next death fill.
  // Starting state is flat; a position is only opened by an observed golden cross.
  const trades: LongFlatTrade[] = [];
  const cost = costBps / 10000;
  let entry: CrossEvent | null = null;
  for (const ev of events) {
    if (ev.type === "golden" && !entry) entry = ev;
    else if (ev.type === "death" && entry) {
      const gross = ev.fillClose! / entry.fillClose!;
      trades.push({
        entryDate: entry.fillDate!,
        entryClose: entry.fillClose!,
        exitDate: ev.fillDate,
        exitClose: ev.fillClose!,
        returnPct: (gross * (1 - cost) * (1 - cost) - 1) * 100,
        open: false,
      });
      entry = null;
    }
  }
  const last = bars.length - 1;
  if (entry) {
    const gross = closes[last] / entry.fillClose!;
    trades.push({
      entryDate: entry.fillDate!,
      entryClose: entry.fillClose!,
      exitDate: null,
      exitClose: closes[last],
      returnPct: (gross * (1 - cost) - 1) * 100,
      open: true,
    });
  }
  const growth = trades.reduce((g, t) => g * (1 + t.returnPct / 100), 1);
  let barsIn = 0;
  for (const t of trades) {
    const a = indexOf.get(t.entryDate)!;
    const b = t.exitDate ? indexOf.get(t.exitDate)! : last;
    barsIn += b - a;
  }
  const evalBars = last - evalIdx;

  return {
    ...empty,
    evalStart: evalIdx >= 0 ? bars[evalIdx].date : null,
    events,
    pending,
    stats,
    trades,
    strategy: {
      totalReturnPct: (growth - 1) * 100,
      buyHoldReturnPct: evalIdx >= 0 ? pct(closes[evalIdx], closes[last]) : null,
      timeInMarketPct: evalBars > 0 ? (barsIn / evalBars) * 100 : null,
      costBps,
    },
  };
}

/** Format for display/reports: null → "n/a". */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  return v == null || !Number.isFinite(v) ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}
