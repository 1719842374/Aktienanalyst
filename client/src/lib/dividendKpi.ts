/**
 * Future_1 §11.1 / Offen_FUTURE_SOLL_IST PR 7 (KPI-Teil): Dividendenrendite nur zeigen, wenn > 0.
 * Input ist bereits Prozent (analyze-route normiert FMP-Dezimal/Prozent). Kein Wert erfunden.
 */
export function dividendYieldKpi(value: number | null | undefined): string | null {
  if (value == null || typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return `${value.toFixed(2)}%`;
}

import { dividendKpiFromHistory, type DividendHistoryResponse } from "@shared/dividends";

export interface DividendKpiDisplay { value: string; sub: string }

/**
 * JOB 20: eine Quelle für die Dividendenrendite (Section 1 Kachel und Section 4 Financial Statements).
 * TTM aus /api/dividends am letzten Chart-Bar (dividendKpiFromHistory, gleiche Glättung wie das Overlay),
 * sonst GJ-Wert von FMP. Kein dritter Wert.
 */
export function dividendKpiDisplay(
  data: { dividendYield?: number | null; currency?: string | null; ohlcvData?: { date: string; close: number }[] | null; historicalPrices?: { date: string; close: number }[] | null },
  history: DividendHistoryResponse | null | undefined,
): DividendKpiDisplay | null {
  const divFy = dividendYieldKpi(data.dividendYield);
  const bars = data.ohlcvData?.length ? data.ohlcvData : data.historicalPrices; // TechnicalChart plots ohlcvData
  const lastBar = bars?.length ? bars[bars.length - 1] : null;
  const divTtm = dividendKpiFromHistory(history, lastBar ? { date: lastBar.date, close: lastBar.close } : null, data.currency);
  return divTtm.kind === "ttm" ? { value: `${divTtm.yieldPct.toFixed(2)}%`, sub: `TTM${divFy ? ` · GJ (FMP) ${divFy}` : ""}` }
    : divTtm.kind === "mismatch" ? { value: "n/a", sub: `TTM: Dividende ${divTtm.dividendCurrency} ≠ Kurs ${divTtm.priceCurrency}` }
    : divFy ? { value: divFy, sub: "GJ (FMP)" }
    : null;
}
