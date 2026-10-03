/**
 * Soll vs. Ist — pure Funktion, kein Netz, kein LLM.
 *
 * Spec: Offen_WORK_PORTFOLIO_SOLL_IST.md §3 und §5.
 *
 *   a_i      = w_i − w_i*
 *   L1       = Σ |a_i|
 *   Turnover = L1 / 2
 *   MAE      = L1 / n
 *   Trade_i  = (w_i* − w_i) · NAV     > 0 Buy, < 0 Sell
 *
 * Gleicher Nenner: eine CASH-Quote nur, wenn beide Vektoren sie haben.
 * Union der Ticker, kein Inner-Join. Keine Renormierung (Summe≠1 bleibt Banner).
 */

export const onTargetBp = 25;
export const slightBp = 100;
export const displayFloor = 0.0025;
export const renormalizeDisplay = false;

const ON_TARGET = onTargetBp / 10_000;
const SLIGHT = slightBp / 10_000;
/** Banner, wenn |Σ Soll − 1| diese Schwelle überschreitet (2 Prozentpunkte). */
const SUM_TARGET_BAND = 0.02;

export type ActiveStatus = "on-target" | "slight" | "off";
export type TradeSide = "buy" | "sell" | "flat";

export interface TargetActualRow {
  ticker: string;
  /** w* Soll, unrenormiert */
  target: number;
  /** w Ist, unrenormiert */
  actual: number;
  /** a = w − w* */
  active: number;
  /** (w* − w) · NAV */
  trade: number;
  side: TradeSide;
  status: ActiveStatus;
}

export interface CompareTargetActualResult {
  /** true nur wenn kein Soll-Vektor übergeben wurde — dann keine Zeilen aus dem Ist ableiten. */
  empty: boolean;
  rows: TargetActualRow[];
  /** Gruppierte Balken: Namen mit Soll oder Ist unter displayFloor bleiben in `rows`. */
  chartRows: TargetActualRow[];
  /** Active-Weight-Balken: |a| unter displayFloor bleibt in `rows`. */
  activeChartRows: TargetActualRow[];
  nav: number;
  n: number;
  l1: number;
  turnover: number;
  mae: number | null;
  maxAbsActive: number | null;
  offCount: number;
  targetSum: number;
  actualSum: number;
  sumTargetOff: boolean;
  /** Genau eine Seite hat CASH — Quote wurde aus beiden Vektoren genommen. */
  cashMixed: boolean;
  renormalized: false;
}

function normalizeWeights(input: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input) return out;
  for (const [raw, value] of Object.entries(input)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const ticker = raw.trim().toUpperCase();
    if (!ticker) continue;
    out[ticker] = (out[ticker] ?? 0) + value;
  }
  return out;
}

export function activeStatus(absActive: number): ActiveStatus {
  if (absActive < ON_TARGET) return "on-target";
  if (absActive < SLIGHT) return "slight";
  return "off";
}

function emptyResult(nav: number): CompareTargetActualResult {
  return {
    empty: true,
    rows: [],
    chartRows: [],
    activeChartRows: [],
    nav,
    n: 0,
    l1: 0,
    turnover: 0,
    mae: null,
    maxAbsActive: null,
    offCount: 0,
    targetSum: 0,
    actualSum: 0,
    sumTargetOff: false,
    cashMixed: false,
    renormalized: false,
  };
}

export function compareTargetActual(input: {
  target: Record<string, number> | null | undefined;
  actual: Record<string, number> | null | undefined;
  nav: number;
}): CompareTargetActualResult {
  const nav = Number.isFinite(input.nav) ? input.nav : 0;
  const target = normalizeWeights(input.target);
  const actual = normalizeWeights(input.actual);
  if (Object.keys(target).length === 0) return emptyResult(nav);

  const targetHasCash = Object.prototype.hasOwnProperty.call(target, "CASH");
  const actualHasCash = Object.prototype.hasOwnProperty.call(actual, "CASH");
  const cashMixed = targetHasCash !== actualHasCash;
  if (cashMixed) {
    delete target.CASH;
    delete actual.CASH;
  }

  const seen: Record<string, true> = {};
  const tickers: string[] = [];
  for (const key of Object.keys(target).concat(Object.keys(actual))) {
    if (seen[key]) continue;
    seen[key] = true;
    tickers.push(key);
  }
  const rows: TargetActualRow[] = [];
  for (const ticker of tickers) {
    const wStar = target[ticker] ?? 0;
    const w = actual[ticker] ?? 0;
    const active = w - wStar;
    const trade = (wStar - w) * nav;
    const side: TradeSide = trade > 0 ? "buy" : trade < 0 ? "sell" : "flat";
    rows.push({
      ticker,
      target: wStar,
      actual: w,
      active,
      trade,
      side,
      status: activeStatus(Math.abs(active)),
    });
  }
  rows.sort((a, b) => {
    const byAbs = Math.abs(b.active) - Math.abs(a.active);
    if (byAbs !== 0) return byAbs;
    return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
  });

  let l1 = 0;
  let maxAbsActive: number | null = null;
  let offCount = 0;
  for (const row of rows) {
    const abs = Math.abs(row.active);
    l1 += abs;
    if (maxAbsActive == null || abs > maxAbsActive) maxAbsActive = abs;
    if (row.status === "off") offCount += 1;
  }
  const n = rows.length;
  const targetSum = Object.values(target).reduce((s, v) => s + v, 0);
  const actualSum = Object.values(actual).reduce((s, v) => s + v, 0);

  return {
    empty: false,
    rows,
    chartRows: rows.filter(r => r.target >= displayFloor || r.actual >= displayFloor),
    activeChartRows: rows.filter(r => Math.abs(r.active) >= displayFloor),
    nav,
    n,
    l1,
    turnover: l1 / 2,
    mae: n > 0 ? l1 / n : null,
    maxAbsActive,
    offCount,
    targetSum,
    actualSum,
    sumTargetOff: Math.abs(targetSum - 1) > SUM_TARGET_BAND,
    cashMixed,
    renormalized: false,
  };
}
