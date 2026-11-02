/**
 * Kursachse des Charts.
 * Nach der USD-Bewertung (currencyInfo.converted) liegen die Kerzen in USD,
 * das Listing SAP.DE / VOW3.DE bleibt Euro. factor rechnet die Anzeige zurück:
 * Anzeige = Datenwert × factor. Die Kerzen selbst und der Score bleiben USD.
 * Ohne Umrechnung ist factor die Identität und das Symbol kommt aus data.currency.
 */
import type { CurrencyInfo } from "@shared/schema";
import { currencyFromTickerSuffix } from "@shared/listing-units";
import { currencySymbol } from "@shared/currency-format";

export const CHART_PRICE_SCALE_IDENTITY = 1;

const LISTING_EURO = "EUR";
const TRADING_USD = "USD";

export interface ChartListingPrice {
  /** Code für currencySymbol. */
  code: string;
  /** Datenwert × factor = Beschriftung. */
  factor: number;
  symbol: string;
}

export function chartListingPrice(data: {
  ticker?: string | null;
  currency?: string | null;
  currencyInfo?: CurrencyInfo | null;
}): ChartListingPrice {
  const info = data.currencyInfo ?? null;
  const fromSuffix = currencyFromTickerSuffix(data.ticker);
  const listing = (info?.reportedCurrency || fromSuffix || "").trim().toUpperCase();
  const fx = info?.fxRate;
  const trading = (info?.tradingCurrency || TRADING_USD).trim().toUpperCase();
  const convertedEuroToUsd = info?.converted === true
    && listing === LISTING_EURO
    && trading === TRADING_USD
    && typeof fx === "number"
    && Number.isFinite(fx)
    && fx > 0
    && fx !== CHART_PRICE_SCALE_IDENTITY;
  if (convertedEuroToUsd && typeof fx === "number") {
    return { code: LISTING_EURO, factor: CHART_PRICE_SCALE_IDENTITY / fx, symbol: currencySymbol(LISTING_EURO) };
  }
  const code = (data.currency && data.currency.trim()) || (listing === LISTING_EURO ? LISTING_EURO : TRADING_USD);
  return { code, factor: CHART_PRICE_SCALE_IDENTITY, symbol: currencySymbol(code) };
}

export function formatChartPrice(symbol: string, value: number, factor: number, digits: number): string {
  return `${symbol}${(value * factor).toFixed(digits)}`;
}
