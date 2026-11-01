/**
 * F10-33 — Backtest der MA-Cross-Signale auf Gold.
 *
 * Soll: Future_10 Z.274, Definition Z.84–85, Code-Schema Z.120–123.
 * Golden: die schnelle MA kreuzt die langsame von unten (vorher ≤, danach >).
 * Death: von oben (vorher ≥, danach <).
 *
 * Horizonte, Fenster und die Perzentil-Skala sind benannte Parameter.
 * Die Signifikanz eines Kreuzes ist der z-Score und das empirische Perzentil
 * seines mittleren Forward-Returns gegen alle gleich langen Forward-Returns
 * der Reihe. Es gibt keinen Cutoff, der „signifikant“ von „nicht“ trennt.
 * Die Karte ist nur Anzeige: inScore bleibt false, der GIS bleibt unberührt.
 */
import type { Express } from "express";
import { yahooFetch } from "./history-fallback";

export interface CloseBar {
  date: string;
  close: number;
}

export interface GoldCrossBacktestParams {
  symbol: string;
  fastWindow: number;
  slowWindow: number;
  horizons: Readonly<Record<string, number>>;
  historyFrom: string;
  cacheTtlMs: number;
  percentScale: number;
}

/**
 * 50/200 aus Future_10 Z.84–85. Die Horizonte sind Handelstage
 * (etwa ein Monat, ein Quartal, ein Jahr), keine Signifikanz-Schwellen.
 * percentScale legt nur die Einheit des Perzentils fest. cacheTtlMs ist
 * die Haltedauer einer vollständigen Antwort, analog zur Chart-Historie.
 */
export const GOLD_CROSS_BACKTEST_PARAMS: GoldCrossBacktestParams = {
  symbol: "GC=F",
  fastWindow: 50,
  slowWindow: 200,
  horizons: {
    oneMonth: 21,
    oneQuarter: 63,
    oneYear: 252,
  },
  historyFrom: "1970-01-01",
  cacheTtlMs: 6 * 60 * 60 * 1000,
  percentScale: 100,
};

export interface ForwardReturnSummary {
  observations: number;
  hitRate: number | null;
  meanForwardReturn: number | null;
  medianForwardReturn: number | null;
  unconditionalMean: number | null;
  unconditionalObservations: number;
  zScore: number | null;
  percentile: number | null;
}

export interface GoldCrossHorizonResult extends ForwardReturnSummary {
  name: string;
  sessions: number;
}

export interface GoldCrossSideResult {
  events: number;
  lastDate: string | null;
  dates: string[];
  horizons: GoldCrossHorizonResult[];
}

export interface GoldCrossBacktest {
  available: boolean;
  symbol: string;
  source: string;
  from: string | null;
  to: string | null;
  bars: number;
  fastWindow: number;
  slowWindow: number;
  inScore: false;
  unavailableReason: string | null;
  golden: GoldCrossSideResult;
  death: GoldCrossSideResult;
}

export type FetchCloseBars = (symbol: string, from: string, to: string) => Promise<readonly CloseBar[]>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function finite(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Populationsstreuung. null, wenn weniger als zwei Werte vorliegen oder die Streuung 0 ist. */
function populationStd(values: readonly number[], mu: number): number | null {
  if (values.length < 2) return null;
  const variance = values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / values.length;
  const sigma = Math.sqrt(variance);
  return sigma > 0 ? sigma : null;
}

/** Anteil der Baseline-Werte, die nicht über `value` liegen, in der Einheit percentScale. */
function empiricalPercentile(baseline: readonly number[], value: number, scale: number): number | null {
  if (baseline.length === 0 || !Number.isFinite(value) || !Number.isFinite(scale)) return null;
  let notAbove = 0;
  for (const entry of baseline) if (entry <= value) notAbove += 1;
  return (notAbove / baseline.length) * scale;
}

/**
 * Trefferquote und Forward-Return-Signifikanz.
 * `isHit` definiert die Richtung (Golden: Return > 0, Death: Return < 0).
 * Ein Return von 0 ist kein Treffer. z und Perzentil vergleichen das Mittel
 * der Ereignis-Returns mit allen Baseline-Returns desselben Horizonts.
 */
export function summarizeForwardReturns(
  eventReturns: readonly number[],
  baselineReturns: readonly number[],
  isHit: (forwardReturn: number) => boolean,
  percentScale: number,
): ForwardReturnSummary {
  const events = finite(eventReturns);
  const baseline = finite(baselineReturns);
  const eventMean = mean(events);
  const baselineMean = mean(baseline);
  const sigma = baselineMean == null ? null : populationStd(baseline, baselineMean);
  const zScore = eventMean == null || baselineMean == null || sigma == null
    ? null
    : (eventMean - baselineMean) / sigma;
  return {
    observations: events.length,
    hitRate: events.length === 0 ? null : events.filter(isHit).length / events.length,
    meanForwardReturn: eventMean,
    medianForwardReturn: median(events),
    unconditionalMean: baselineMean,
    unconditionalObservations: baseline.length,
    zScore: zScore != null && Number.isFinite(zScore) ? zScore : null,
    percentile: eventMean == null ? null : empiricalPercentile(baseline, eventMean, percentScale),
  };
}

function windowsValid(params: GoldCrossBacktestParams): boolean {
  return Number.isInteger(params.fastWindow)
    && Number.isInteger(params.slowWindow)
    && params.fastWindow >= 1
    && params.slowWindow > params.fastWindow;
}

function cleanBars(bars: readonly CloseBar[]): CloseBar[] {
  const byDate = new Map<string, CloseBar>();
  for (const bar of bars) {
    const date = String(bar?.date ?? "").slice(0, 10);
    const close = Number(bar?.close);
    if (!DATE_RE.test(date) || !Number.isFinite(close) || close <= 0) continue;
    byDate.set(date, { date, close });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function rollingSma(closes: readonly number[], window: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (!Number.isInteger(window) || window < 1) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= window) sum -= closes[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

function forwardReturn(closes: readonly number[], index: number, sessions: number): number | null {
  const future = index + sessions;
  if (future >= closes.length) return null;
  const base = closes[index];
  const next = closes[future];
  if (!(base > 0) || !Number.isFinite(next)) return null;
  return next / base - 1;
}

type CrossSide = "golden" | "death";

function isHitFor(side: CrossSide): (forwardReturn: number) => boolean {
  switch (side) {
    case "golden":
      return (forwardReturn) => forwardReturn > 0;
    case "death":
      return (forwardReturn) => forwardReturn < 0;
    default: {
      const exhaustive: never = side;
      throw new Error(`unbekannte Kreuz-Seite ${String(exhaustive)}`);
    }
  }
}

function emptySide(params: GoldCrossBacktestParams): GoldCrossSideResult {
  return {
    events: 0,
    lastDate: null,
    dates: [],
    horizons: Object.entries(params.horizons).map(([name, sessions]) => ({
      name,
      sessions,
      observations: 0,
      hitRate: null,
      meanForwardReturn: null,
      medianForwardReturn: null,
      unconditionalMean: null,
      unconditionalObservations: 0,
      zScore: null,
      percentile: null,
    })),
  };
}

function unavailable(params: GoldCrossBacktestParams, reason: string): GoldCrossBacktest {
  return {
    available: false,
    symbol: params.symbol,
    source: `Yahoo ${params.symbol}`,
    from: null,
    to: null,
    bars: 0,
    fastWindow: params.fastWindow,
    slowWindow: params.slowWindow,
    inScore: false,
    unavailableReason: reason,
    golden: emptySide(params),
    death: emptySide(params),
  };
}

function sideResult(
  closes: readonly number[],
  dates: readonly string[],
  indices: readonly number[],
  side: CrossSide,
  params: GoldCrossBacktestParams,
): GoldCrossSideResult {
  const eventDates = indices.map((index) => dates[index]);
  const horizons = Object.entries(params.horizons).map(([name, sessions]) => {
    const usable = Number.isInteger(sessions) && sessions >= 1;
    const baseline: number[] = [];
    const eventReturns: number[] = [];
    if (usable) {
      for (let i = 0; i + sessions < closes.length; i++) {
        const value = forwardReturn(closes, i, sessions);
        if (value != null) baseline.push(value);
      }
      for (const index of indices) {
        const value = forwardReturn(closes, index, sessions);
        if (value != null) eventReturns.push(value);
      }
    }
    return {
      name,
      sessions,
      ...summarizeForwardReturns(eventReturns, baseline, isHitFor(side), params.percentScale),
    };
  });
  return {
    events: indices.length,
    lastDate: eventDates.length > 0 ? eventDates[eventDates.length - 1] : null,
    dates: eventDates,
    horizons,
  };
}

export function backtestGoldMaCross(
  bars: readonly CloseBar[],
  params: GoldCrossBacktestParams = GOLD_CROSS_BACKTEST_PARAMS,
): GoldCrossBacktest {
  if (!windowsValid(params)) {
    return unavailable(params, `MA-Fenster ungültig: schnell ${params.fastWindow}, langsam ${params.slowWindow}`);
  }
  const cleaned = cleanBars(bars);
  if (cleaned.length === 0) {
    return unavailable(params, `Yahoo ${params.symbol} ohne gültige Schlüsse`);
  }
  const closes = cleaned.map((bar) => bar.close);
  const dates = cleaned.map((bar) => bar.date);
  const fast = rollingSma(closes, params.fastWindow);
  const slow = rollingSma(closes, params.slowWindow);
  const golden: number[] = [];
  const death: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prevFast = fast[i - 1];
    const prevSlow = slow[i - 1];
    const currFast = fast[i];
    const currSlow = slow[i];
    if (prevFast == null || prevSlow == null || currFast == null || currSlow == null) continue;
    if (prevFast <= prevSlow && currFast > currSlow) golden.push(i);
    else if (prevFast >= prevSlow && currFast < currSlow) death.push(i);
  }
  return {
    available: true,
    symbol: params.symbol,
    source: `Yahoo ${params.symbol}`,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    bars: cleaned.length,
    fastWindow: params.fastWindow,
    slowWindow: params.slowWindow,
    inScore: false,
    unavailableReason: null,
    golden: sideResult(closes, dates, golden, "golden", params),
    death: sideResult(closes, dates, death, "death", params),
  };
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function fetchYahooCloses(symbol: string, from: string, to: string): Promise<CloseBar[]> {
  const bars = await yahooFetch(symbol, from, to);
  return bars.map((bar) => ({ date: bar.date, close: bar.close }));
}

export function registerGoldBacktestCrossRoute(
  app: Express,
  deps: { fetchBars?: FetchCloseBars; now?: () => number; params?: GoldCrossBacktestParams } = {},
): void {
  const params = deps.params ?? GOLD_CROSS_BACKTEST_PARAMS;
  const fetchBars = deps.fetchBars ?? fetchYahooCloses;
  const now = deps.now ?? Date.now;
  let cache: { at: number; body: GoldCrossBacktest } | null = null;
  let inFlight: Promise<GoldCrossBacktest> | null = null;

  app.get("/api/gold/backtest-cross", async (_req, res) => {
    if (cache && now() - cache.at < params.cacheTtlMs) {
      res.json(cache.body);
      return;
    }
    try {
      inFlight ??= (async () => {
        const bars = await fetchBars(params.symbol, params.historyFrom, isoDay(now()));
        const body = backtestGoldMaCross(bars, params);
        if (body.available) cache = { at: now(), body };
        return body;
      })().finally(() => {
        inFlight = null;
      });
      res.json(await inFlight);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.json(unavailable(params, message));
    }
  });
}
