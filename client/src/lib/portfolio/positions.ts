/**
 * Portfolio-Positionen — Datenmodell + reine Berechnungs-Helfer.
 *
 * Auftrag 10.08.2026 ("Portfolio UX (CAPM/Kelly) + Peer-Add/Remove Fix",
 * Teil A). Ergaenzt die bestehende Kandidaten-/Kelly-/CAPM-Logik
 * (client/src/lib/portfolio/{kelly,pipeline,sharpe,weighting}.ts, UNVERAENDERT)
 * um einen echten Positions-Tracker: Stueckzahl, Einstiegspreis, Long/Short,
 * offen/geschlossen -- fuer KPI-Zeile, Pie-Chart, Performance-Chart und die
 * Investments-Tabelle mit Analyse-Deep-Link.
 *
 * PRINZIP (verbindlich laut Ticket): Zahlen nur aus FMP/Analyse-Cache/User-
 * Eingaben -- KEIN LLM fuer Kurse, Performance oder Gewichte. Alle Funktionen
 * hier sind pure Functions ohne Netzwerkzugriff, damit sie unit-testbar sind.
 */

export type PositionSide = "long" | "short";
export type PositionStatus = "open" | "closed";

export interface PortfolioPosition {
  id: string;
  ticker: string;
  name?: string;
  side: PositionSide;
  qty: number;
  entryPrice: number;
  stopPrice?: number | null;
  openedAt: string;
  status: PositionStatus;
  closedAt?: string | null;
  exitPrice?: number | null;
  scoreOverride?: number | null;
  muOverride?: number | null;
  sigmaOverride?: number | null;
  convictionOverride?: "high" | "medium" | "low" | null;
  notes?: string;
}

export interface PortfolioPolicy {
  capital: number;
  benchmark: string;
  rfPct: number;
  maxWeightPct: number;
  kellyFraction: number;
  kellyMaxFPct: number;
  mode: "auto" | "manual";
}

export const DEFAULT_POLICY: PortfolioPolicy = {
  capital: 100000,
  benchmark: "SPY",
  rfPct: 3.0,
  maxWeightPct: 30,
  kellyFraction: 0.5,
  kellyMaxFPct: 25,
  mode: "auto",
};

export function makePosition(over: Partial<PortfolioPosition> = {}): PortfolioPosition {
  return {
    id: Math.random().toString(36).slice(2),
    ticker: "",
    side: "long",
    qty: 1,
    entryPrice: 0,
    stopPrice: null,
    openedAt: new Date().toISOString(),
    status: "open",
    closedAt: null,
    exitPrice: null,
    scoreOverride: null,
    muOverride: null,
    sigmaOverride: null,
    convictionOverride: null,
    ...over,
  };
}

export function computePositionPerformance(entryPrice: number, lastPrice: number | null | undefined, side: PositionSide): number | null {
  if (lastPrice == null || !isFinite(lastPrice) || lastPrice <= 0) return null;
  if (!isFinite(entryPrice) || entryPrice <= 0) return null;
  return side === "long" ? (lastPrice / entryPrice - 1) : (entryPrice / lastPrice - 1);
}

export function computeClosedPositionPerformance(pos: PortfolioPosition): number | null {
  if (pos.exitPrice == null) return null;
  return computePositionPerformance(pos.entryPrice, pos.exitPrice, pos.side);
}

export function computeMarketValue(qty: number, lastPrice: number | null | undefined): number | null {
  if (lastPrice == null || !isFinite(lastPrice) || lastPrice <= 0) return null;
  if (!isFinite(qty) || qty <= 0) return null;
  return qty * lastPrice;
}

export interface WeightedPosition {
  position: PortfolioPosition;
  marketValue: number | null;
  weight: number | null;
  performance: number | null;
}

export function computePortfolioWeights(positions: PortfolioPosition[], lastPriceByTicker: Record<string, number | null | undefined>): WeightedPosition[] {
  const openPositions = positions.filter(p => p.status === "open");
  const withValues = openPositions.map(p => {
    const lastPrice = lastPriceByTicker[p.ticker.toUpperCase()];
    const marketValue = computeMarketValue(p.qty, lastPrice);
    const performance = computePositionPerformance(p.entryPrice, lastPrice, p.side);
    return { position: p, marketValue, performance };
  });
  const totalValue = withValues.reduce((sum, w) => sum + (w.marketValue ?? 0), 0);
  return withValues.map(w => ({
    ...w,
    weight: (w.marketValue != null && totalValue > 0) ? w.marketValue / totalValue : null,
  }));
}

export interface PortfolioKPIs {
  avgActivePerformance: number | null;
  bestPerformer: { position: PortfolioPosition; performance: number } | null;
  avgRealizedPerformance: number | null;
}

export function computePortfolioKPIs(positions: PortfolioPosition[], lastPriceByTicker: Record<string, number | null | undefined>): PortfolioKPIs {
  const openPositions = positions.filter(p => p.status === "open");
  const openPerfs = openPositions
    .map(p => ({ position: p, performance: computePositionPerformance(p.entryPrice, lastPriceByTicker[p.ticker.toUpperCase()], p.side) }))
    .filter((x): x is { position: PortfolioPosition; performance: number } => x.performance != null);

  const avgActivePerformance = openPerfs.length > 0
    ? openPerfs.reduce((sum, x) => sum + x.performance, 0) / openPerfs.length
    : null;

  const bestPerformer = openPerfs.length > 0
    ? openPerfs.reduce((best, x) => (x.performance > best.performance ? x : best))
    : null;

  const closedPositions = positions.filter(p => p.status === "closed");
  const closedPerfs = closedPositions
    .map(p => computeClosedPositionPerformance(p))
    .filter((x): x is number => x != null);
  const avgRealizedPerformance = closedPerfs.length > 0
    ? closedPerfs.reduce((sum, x) => sum + x, 0) / closedPerfs.length
    : null;

  return { avgActivePerformance, bestPerformer, avgRealizedPerformance };
}

export interface PortfolioPerformancePoint {
  date: string;
  performancePct: number;
  value: number;
}

export type PerformanceTimeframe = "1M" | "3M" | "6M" | "YTD" | "1Y" | "2Y";

export function timeframeCutoffIso(timeframe: PerformanceTimeframe, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  let cutoff: Date;
  switch (timeframe) {
    case "1M": cutoff = new Date(y, m - 1, d); break;
    case "3M": cutoff = new Date(y, m - 3, d); break;
    case "6M": cutoff = new Date(y, m - 6, d); break;
    case "YTD": cutoff = new Date(y, 0, 1); break;
    case "1Y": cutoff = new Date(y - 1, m, d); break;
    case "2Y": cutoff = new Date(y - 2, m, d); break;
    default: cutoff = new Date(0);
  }
  return cutoff.toISOString().slice(0, 10);
}

export function rebasePerformanceSeries(
  series: PortfolioPerformancePoint[],
  fromDate: string,
): PortfolioPerformancePoint[] {
  const sliced = series.filter(pt => pt.date >= fromDate);
  if (sliced.length === 0) return [];
  const baseLevel = 1 + sliced[0].performancePct;
  if (!Number.isFinite(baseLevel) || baseLevel === 0) return [];
  return sliced.map(pt => ({
    date: pt.date,
    value: pt.value,
    performancePct: (1 + pt.performancePct) / baseLevel - 1,
  }));
}

export function computePortfolioPerformanceSeries(
  positions: PortfolioPosition[],
  historicalPricesByTicker: Record<string, Array<{ date: string; close: number }> | undefined>,
): PortfolioPerformancePoint[] {
  const openPositions = positions.filter(p => p.status === "open" && historicalPricesByTicker[p.ticker.toUpperCase()]?.length);
  if (openPositions.length === 0) return [];

  const allDatesSet = new Set<string>();
  for (const p of openPositions) {
    for (const pt of historicalPricesByTicker[p.ticker.toUpperCase()]!) allDatesSet.add(pt.date);
  }
  const allDates = Array.from(allDatesSet).sort();
  if (allDates.length === 0) return [];

  const priceAt: Record<string, (date: string) => number | null> = {};
  for (const p of openPositions) {
    const series = historicalPricesByTicker[p.ticker.toUpperCase()]!;
    const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
    priceAt[p.ticker.toUpperCase()] = (date: string) => {
      let last: number | null = null;
      for (const pt of sorted) {
        if (pt.date > date) break;
        last = pt.close;
      }
      return last;
    };
  }

  const values: number[] = [];
  for (const date of allDates) {
    let v = 0;
    let hasAny = false;
    for (const p of openPositions) {
      const price = priceAt[p.ticker.toUpperCase()](date);
      if (price == null) continue;
      hasAny = true;
      v += p.side === "long" ? p.qty * price : -p.qty * price;
    }
    if (hasAny) values.push(v);
  }
  if (values.length === 0) return [];

  const v0 = values[0];
  const result: PortfolioPerformancePoint[] = [];
  for (const date of allDates) {
    let v = 0;
    let hasAny = false;
    for (const p of openPositions) {
      const price = priceAt[p.ticker.toUpperCase()](date);
      if (price == null) continue;
      hasAny = true;
      v += p.side === "long" ? p.qty * price : -p.qty * price;
    }
    if (!hasAny) continue;
    const perf = v0 !== 0 ? (v / v0 - 1) : 0;
    result.push({ date, performancePct: perf, value: v });
  }
  return result;
}

const STORAGE_KEY_POSITIONS = "aktienanalyst_portfolio_positions_v1";
const STORAGE_KEY_POLICY = "aktienanalyst_portfolio_policy_v1";

export function loadPositionsFromStorage(): PortfolioPosition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POSITIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePositionsToStorage(positions: PortfolioPosition[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_POSITIONS, JSON.stringify(positions));
  } catch {
  }
}

export function loadPolicyFromStorage(): PortfolioPolicy {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_POLICY);
    if (!raw) return DEFAULT_POLICY;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_POLICY, ...parsed };
  } catch {
    return DEFAULT_POLICY;
  }
}

export function savePolicyToStorage(policy: PortfolioPolicy): void {
  try {
    localStorage.setItem(STORAGE_KEY_POLICY, JSON.stringify(policy));
  } catch {
  }
}

export function suggestConvictionFromScore(score: number | null | undefined): "high" | "medium" | "low" | null {
  if (score == null || !isFinite(score)) return null;
  if (score >= 80) return "high";
  if (score >= 60) return "medium";
  return "low";
}
