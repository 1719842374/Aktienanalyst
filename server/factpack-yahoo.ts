/**
 * F2-09: SPY factpack PE and EPS when FMP left both empty.
 * quoteSummary first (needs a crumb). fundamentals-timeseries second (no crumb).
 * A single trailing EPS does not invent an EPS YoY. No call when FMP already has a PE.
 */
import { fetchYahooQuoteSummaryResult, fetchYahooTimeseriesFundamentals } from "./yahoo-fetcher";

export const FACTPACK_YAHOO_QS_SOURCE = "Yahoo quoteSummary summaryDetail.trailingPE";
export const FACTPACK_YAHOO_EPS_SOURCE = "Yahoo quoteSummary defaultKeyStatistics.trailingEps, PE = Kurs/EPS";
export const FACTPACK_YAHOO_TS_SOURCE = "Yahoo timeseries";
export const FACTPACK_YAHOO_NA = "n/a — FMP ohne PE/EPS, Yahoo quoteSummary leer, Yahoo timeseries ohne EPS";

export interface YahooFactpackNumbers {
  pe: number | null;
  eps: number | null;
  source: string | null;
  status: string;
}

export interface YahooFactpackDeps {
  quoteSummary: (symbol: string) => Promise<unknown | null>;
  timeseries: (symbol: string, price: number) => Promise<YahooFactpackNumbers>;
}

export interface YahooFactpackFill {
  pe: number | null;
  eps: number | null;
  source: string | null;
  naReason: string | null;
}

function finiteRaw(raw: unknown): number | null {
  const value = raw && typeof raw === "object" && "raw" in raw ? (raw as { raw?: unknown }).raw : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Price and EPS are the same symbol. No cross-listing mix. */
export function peFromPriceAndEps(price: number, eps: number | null): number | null {
  if (!(price > 0) || eps == null || !(eps > 0)) return null;
  return Math.round((price / eps) * 100) / 100;
}

export function trailingFromQuoteSummary(result: unknown): { pe: number | null; eps: number | null } {
  if (!result || typeof result !== "object") return { pe: null, eps: null };
  const row = result as {
    summaryDetail?: { trailingPE?: unknown };
    defaultKeyStatistics?: { trailingEps?: unknown };
  };
  return {
    pe: finiteRaw(row.summaryDetail?.trailingPE),
    eps: finiteRaw(row.defaultKeyStatistics?.trailingEps),
  };
}

export async function yahooFundamentalsWhenFmpEmpty(
  symbol: string,
  price: number,
  deps: YahooFactpackDeps,
): Promise<YahooFactpackFill> {
  const summary = trailingFromQuoteSummary(await deps.quoteSummary(symbol));
  if (summary.pe != null) {
    return { pe: summary.pe, eps: summary.eps, source: FACTPACK_YAHOO_QS_SOURCE, naReason: null };
  }
  const fromEps = peFromPriceAndEps(price, summary.eps);
  if (fromEps != null) {
    return { pe: fromEps, eps: summary.eps, source: FACTPACK_YAHOO_EPS_SOURCE, naReason: null };
  }
  const series = await deps.timeseries(symbol, price);
  if (series.pe != null && Number.isFinite(series.pe)) {
    return {
      pe: series.pe,
      eps: series.eps,
      source: series.source ?? FACTPACK_YAHOO_TS_SOURCE,
      naReason: null,
    };
  }
  return { pe: null, eps: null, source: null, naReason: FACTPACK_YAHOO_NA };
}

/** Live Yahoo for SPY. Currency is USD because the bar close is the SPY print. */
export function defaultSpyYahooDeps(): YahooFactpackDeps {
  return {
    quoteSummary: symbol => fetchYahooQuoteSummaryResult(symbol, ["summaryDetail", "defaultKeyStatistics", "financialData"]),
    timeseries: async (symbol, price) => {
      const row = await fetchYahooTimeseriesFundamentals(symbol, { price, currency: "USD" });
      return {
        pe: row.pe,
        eps: row.epsDiluted,
        source: row.pe != null ? FACTPACK_YAHOO_TS_SOURCE : null,
        status: row.status,
      };
    },
  };
}
