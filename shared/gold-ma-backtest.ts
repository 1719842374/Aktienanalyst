/**
 * F10-33 Backtest der Golden- und Death-Cross-Signale auf Gold.
 *
 * Dieselbe Kreuzdefinition wie die Chart-Marker (50-Tage-MA kreuzt 200-Tage-MA).
 * Ein Trade läuft bis zum gegenteiligen Kreuz. Offene Trades haben keine Rendite
 * und zählen nicht in die Trefferquote. Kein GIS.
 */
import { detectMaCrosses, trailingSma, type MaCrossType } from "../client/src/components/gold/goldChartMa";
import { median } from "./gold-mine-supply";

export const GOLD_MA_BACKTEST_PARAMS = {
  fastPeriod: 50,
  slowPeriod: 200,
} as const;

export interface GoldMaBacktestSide {
  signals: number;
  completed: number;
  open: number;
  medianReturn: number | null;
  hitShare: number | null;
  medianHoldDays: number | null;
  reason: string | null;
}

export interface GoldMaBacktestResponse {
  affectsScore: false;
  available: boolean;
  reason: string | null;
  source: string | null;
  pointCount: number | null;
  from: string | null;
  to: string | null;
  fastPeriod: number;
  slowPeriod: number;
  golden: GoldMaBacktestSide | null;
  death: GoldMaBacktestSide | null;
}

export interface GoldClosePoint {
  date: string;
  close: number;
}

function na(text: string): string {
  return text.startsWith("n/a") ? text : `n/a — ${text}`;
}

function emptySide(reason: string): GoldMaBacktestSide {
  return {
    signals: 0,
    completed: 0,
    open: 0,
    medianReturn: null,
    hitShare: null,
    medianHoldDays: null,
    reason: na(reason),
  };
}

function daysBetween(from: string, to: string): number | null {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86400000);
}

interface ClosedTrade {
  type: MaCrossType;
  returnPct: number;
  holdDays: number | null;
}

function summarize(type: MaCrossType, trades: ClosedTrade[], signals: number, open: number): GoldMaBacktestSide {
  const side = trades.filter(trade => trade.type === type);
  if (side.length === 0) {
    return {
      ...emptySide(signals === 0 ? "kein Kreuz in der Reihe" : "kein abgeschlossenes Kreuz"),
      signals,
      open,
    };
  }
  const hits = type === "golden"
    ? side.filter(trade => trade.returnPct > 0).length
    : side.filter(trade => trade.returnPct < 0).length;
  const holds = side.map(trade => trade.holdDays).filter((days): days is number => days != null);
  return {
    signals,
    completed: side.length,
    open,
    medianReturn: median(side.map(trade => trade.returnPct)),
    hitShare: hits / side.length,
    medianHoldDays: holds.length > 0 ? median(holds) : null,
    reason: null,
  };
}

export function backtestGoldMaCrosses(
  points: GoldClosePoint[],
  fastPeriod = GOLD_MA_BACKTEST_PARAMS.fastPeriod,
  slowPeriod = GOLD_MA_BACKTEST_PARAMS.slowPeriod,
): GoldMaBacktestResponse {
  const base = {
    affectsScore: false as const,
    source: null,
    fastPeriod,
    slowPeriod,
  };
  const usable = points.filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.close) && point.close > 0);
  if (usable.length < slowPeriod) {
    return {
      ...base,
      available: false,
      reason: na(`weniger als ${slowPeriod} Schlüsse für die langsame MA`),
      pointCount: usable.length,
      from: usable[0]?.date ?? null,
      to: usable[usable.length - 1]?.date ?? null,
      golden: null,
      death: null,
    };
  }
  const closes = usable.map(point => point.close);
  const maFast = trailingSma(closes, fastPeriod);
  const maSlow = trailingSma(closes, slowPeriod);
  const crosses = detectMaCrosses(usable.map((point, index) => ({
    date: point.date,
    ma50: maFast[index],
    ma200: maSlow[index],
  })));
  const closeByDate = new Map(usable.map(point => [point.date, point.close]));
  const closed: ClosedTrade[] = [];
  let goldenSignals = 0;
  let deathSignals = 0;
  let goldenOpen = 0;
  let deathOpen = 0;
  for (let i = 0; i < crosses.length; i++) {
    const entry = crosses[i];
    if (entry.type === "golden") goldenSignals += 1;
    else deathSignals += 1;
    const exit = crosses.slice(i + 1).find(cross => cross.type !== entry.type);
    const entryClose = closeByDate.get(entry.date);
    if (!exit || entryClose == null || !(entryClose > 0)) {
      if (entry.type === "golden") goldenOpen += 1;
      else deathOpen += 1;
      continue;
    }
    const exitClose = closeByDate.get(exit.date);
    if (exitClose == null || !(exitClose > 0)) {
      if (entry.type === "golden") goldenOpen += 1;
      else deathOpen += 1;
      continue;
    }
    closed.push({
      type: entry.type,
      returnPct: exitClose / entryClose - 1,
      holdDays: daysBetween(entry.date, exit.date),
    });
  }
  return {
    ...base,
    available: true,
    reason: null,
    pointCount: usable.length,
    from: usable[0].date,
    to: usable[usable.length - 1].date,
    golden: summarize("golden", closed, goldenSignals, goldenOpen),
    death: summarize("death", closed, deathSignals, deathOpen),
  };
}
