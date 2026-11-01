import { useMemo } from "react";
import { dividendOverlaySeries, dividendCurrencyCheck } from "@shared/dividends";
import { dividendYieldRange, type DividendYieldRange } from "@shared/dividend-valuation";
import { useDividendHistory } from "./useDividendHistory";

/** F1-17/F1-18: historische TTM-Spanne aus derselben /api/dividends-Query wie Overlay und KPI. Nur Anzeige. */
export function useDividendRange(data: { ticker: string; currency?: string | null; ohlcvData?: { date: string; close: number }[] | null; historicalPrices?: { date: string; close: number }[] | null }): DividendYieldRange | null {
  const q = useDividendHistory(data.ticker);
  const bars = data.ohlcvData?.length ? data.ohlcvData : data.historicalPrices;
  return useMemo(() => {
    const h = q.data;
    if (!h || !h.events.length || !bars?.length) return null;
    if (dividendCurrencyCheck(h.currency, data.currency) === "mismatch") return null;
    const sorted = bars.slice().sort((a, b) => a.date.localeCompare(b.date));
    return dividendYieldRange(dividendOverlaySeries(sorted, h.events).points);
  }, [q.data, bars, data.currency]);
}
