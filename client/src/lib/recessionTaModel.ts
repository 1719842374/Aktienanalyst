/**
 * WORK_RECESSION_TA_CHART — turns /api/analyze-recession/ta into the props the
 * stock Section 12 (TechnicalChart) already understands. Pure, no score.
 */
import type { StockAnalysis, TechnicalIndicators, TechnicalStatus } from "../../../shared/schema";
import type { RecessionTaResponse } from "../../../shared/recession-ta";
import { buildFullSeries } from "./taWindowSeries";

export function technicalIndicatorsFromBars(bars: RecessionTaResponse["ohlcv"]): TechnicalIndicators | null {
  if (!bars.length) return null;
  const full = buildFullSeries(bars);
  const pts = full.points;
  const maData = pts.map(p => ({
    date: p.date, close: p.close, ma200: p.ma200, ma100: p.ma100, ma50: p.ma50, ma20: p.ma20,
    ema26: p.ema26, ema12: p.ema12, ema9: p.ema9,
  }));
  const macdData = pts.map(p => ({ date: p.date, macd: p.macd, signal: p.signal, histogram: p.histogram }));
  const last = pts[pts.length - 1];
  const prev = pts.length > 1 ? pts[pts.length - 2] : undefined;
  // Same four conditions as server buildTechnicalIndicators (analyze-route, untouched).
  const priceAboveMA200 = last.ma200 != null ? last.close > last.ma200 : false;
  const ma50AboveMA200 = last.ma50 != null && last.ma200 != null ? last.ma50 > last.ma200 : false;
  const macdAboveZero = last.macd != null ? last.macd > 0 : false;
  const macdRising = last.macd != null && prev?.macd != null ? last.macd > prev.macd : false;
  const currentStatus: TechnicalStatus = {
    priceAboveMA200, ma50AboveMA200, macdAboveZero, macdRising,
    buySignal: priceAboveMA200 && ma50AboveMA200 && macdAboveZero && macdRising,
    ma200Value: last.ma200, ma50Value: last.ma50, macdValue: last.macd, signalValue: last.signal,
  };
  return { maData, macdData, signals: full.signals, currentStatus };
}

/** Minimal StockAnalysis view for TechnicalChart (only the fields it reads). */
export function recessionTaAsStock(ta: RecessionTaResponse): StockAnalysis {
  return {
    ticker: ta.etf,
    currency: "USD",
    ohlcvData: ta.ohlcv,
    technicalIndicators: technicalIndicatorsFromBars(ta.ohlcv) ?? undefined,
    historyDataSource: ta.ohlcvSource === "yahoo" ? "yahoo" : "fmp",
  } as unknown as StockAnalysis;
}

export interface TaStatusInput {
  subgroups?: { name: string; probability: number; finalProbability?: number }[];
  topDrivers?: string[];
}

export function bannerProbabilities(input: TaStatusInput | null | undefined): {
  recession12m: number | null;
  correction12m: number | null;
  drivers: string[];
} {
  const pick = (name: string) => {
    const s = input?.subgroups?.find(g => g.name === name);
    if (!s) return null;
    const v = s.finalProbability ?? s.probability;
    return Number.isFinite(v) ? v : null;
  };
  return {
    recession12m: pick("recession_full"),
    correction12m: pick("correction_full"),
    drivers: (input?.topDrivers ?? []).slice(0, 3),
  };
}
