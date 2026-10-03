/**
 * Soll vs. Ist — reine Vergleichsfunktion (Offen_WORK_PORTFOLIO_SOLL_IST.md §3).
 *
 * Kein Netzwerk, kein localStorage, kein LLM. Gewichte kommen fertig herein
 * (Soll aus allocate/capmWeights, Ist aus computeMarketWeights). Diese Datei
 * renormiert nicht: Summe Soll ≠ 1 bleibt sichtbar, Trade nutzt die Rohgewichte.
 *
 * Gleicher Nenner: eine CASH-Quote darf nur vorkommen, wenn beide Vektoren sie
 * haben. Sonst ist der Vergleich Typ A gegen Typ B und wird nicht gerechnet.
 */

export const CASH_TICKER = "CASH";

export const COMPARE_POLICY = {
  onTargetBp: 25,
  slightBp: 100,
  displayFloor: 0.0025,
  renormalizeDisplay: false,
} as const;

/** Banner, wenn |Σ Soll − 1| diese Schwelle überschreitet (2 Prozentpunkte). */
export const TARGET_SUM_BANNER_ABS = 0.02;

const ON_TARGET_ABS = COMPARE_POLICY.onTargetBp / 10_000;
const SLIGHT_ABS = COMPARE_POLICY.slightBp / 10_000;

/** Dezimalgrenzen (25 bp, 100 bp, 2 pp) liegen nicht exakt in IEEE-754. */
function decimal(x: number): number {
  return Math.round(x * 1e10) / 1e10;
}

export type ActiveStatus = "on_target" | "slight" | "off";
export type TradeSide = "buy" | "sell" | "flat";

export interface CompareTargetActualRow {
  ticker: string;
  /** w* Soll */
  target: number;
  /** w Ist */
  actual: number;
  /** a = w − w* */
  active: number;
  /** (w* − w) × NAV */
  trade: number;
  side: TradeSide;
  status: ActiveStatus;
  /** Chart-Zeile. Unter displayFloor bleibt der Name in `rows`. */
  display: boolean;
}

export interface CompareTargetActualResult {
  hasTarget: boolean;
  denominatorMismatch: boolean;
  rows: CompareTargetActualRow[];
  chartRows: CompareTargetActualRow[];
  nav: number;
  n: number;
  l1: number | null;
  turnover: number | null;
  mae: number | null;
  maxAbsActive: number | null;
  offCount: number;
  targetSum: number | null;
  actualSum: number | null;
  targetSumOff: boolean;
}

function normalizeWeights(weights: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!weights) return out;
  for (const [raw, value] of Object.entries(weights)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const ticker = raw.trim().toUpperCase();
    if (!ticker) continue;
    out[ticker] = (out[ticker] ?? 0) + value;
  }
  return out;
}

function sumValues(weights: Record<string, number>): number {
  let sum = 0;
  for (const value of Object.values(weights)) sum += value;
  return sum;
}

function hasCashQuote(weights: Record<string, number>): boolean {
  return Object.prototype.hasOwnProperty.call(weights, CASH_TICKER);
}

function emptyResult(nav: number, patch: Partial<CompareTargetActualResult> = {}): CompareTargetActualResult {
  return {
    hasTarget: false,
    denominatorMismatch: false,
    rows: [],
    chartRows: [],
    nav,
    n: 0,
    l1: null,
    turnover: null,
    mae: null,
    maxAbsActive: null,
    offCount: 0,
    targetSum: null,
    actualSum: null,
    targetSumOff: false,
    ...patch,
  };
}

function statusFor(absActive: number): ActiveStatus {
  const abs = decimal(absActive);
  if (abs < ON_TARGET_ABS) return "on_target";
  if (abs < SLIGHT_ABS) return "slight";
  return "off";
}

/**
 * Vergleicht Soll- und Ist-Gewichte auf der Union der Ticker.
 * Fehlendes Soll oder fehlendes Ist auf einer Seite ist 0, nicht ein Join.
 * `renormalizeDisplay` bleibt false: weder Chart noch Trade wird skaliert.
 */
export function compareTargetActual(
  target: Record<string, number> | null | undefined,
  actual: Record<string, number> | null | undefined,
  nav: number,
): CompareTargetActualResult {
  const safeNav = Number.isFinite(nav) ? nav : 0;
  const targetMap = normalizeWeights(target);
  const actualMap = normalizeWeights(actual);
  if (Object.keys(targetMap).length === 0) return emptyResult(safeNav);

  const targetSum = sumValues(targetMap);
  const actualSum = sumValues(actualMap);
  const targetSumOff = decimal(Math.abs(targetSum - 1)) > TARGET_SUM_BANNER_ABS;
  const targetHasCash = hasCashQuote(targetMap);
  const actualHasCash = hasCashQuote(actualMap);
  if (targetHasCash !== actualHasCash) {
    return emptyResult(safeNav, {
      hasTarget: true,
      denominatorMismatch: true,
      targetSum,
      actualSum,
      targetSumOff,
    });
  }

  const tickers = Array.from(new Set([...Object.keys(targetMap), ...Object.keys(actualMap)]));
  const rows: CompareTargetActualRow[] = tickers.map(ticker => {
    const targetWeight = targetMap[ticker] ?? 0;
    const actualWeight = actualMap[ticker] ?? 0;
    const active = actualWeight - targetWeight;
    const trade = (targetWeight - actualWeight) * safeNav;
    const side: TradeSide = trade > 0 ? "buy" : trade < 0 ? "sell" : "flat";
    return {
      ticker,
      target: targetWeight,
      actual: actualWeight,
      active,
      trade,
      side,
      status: statusFor(Math.abs(active)),
      display: Math.max(Math.abs(targetWeight), Math.abs(actualWeight)) >= COMPARE_POLICY.displayFloor,
    };
  });
  rows.sort((a, b) => {
    const byActive = Math.abs(b.active) - Math.abs(a.active);
    if (byActive !== 0) return byActive;
    return a.ticker.localeCompare(b.ticker);
  });

  let l1 = 0;
  let maxAbsActive = 0;
  let offCount = 0;
  for (const row of rows) {
    const absActive = Math.abs(row.active);
    l1 += absActive;
    if (absActive > maxAbsActive) maxAbsActive = absActive;
    if (row.status === "off") offCount += 1;
  }
  const n = rows.length;

  return {
    hasTarget: true,
    denominatorMismatch: false,
    rows,
    chartRows: rows.filter(row => row.display),
    nav: safeNav,
    n,
    l1,
    turnover: l1 / 2,
    mae: n > 0 ? l1 / n : null,
    maxAbsActive,
    offCount,
    targetSum,
    actualSum,
    targetSumOff,
  };
}
