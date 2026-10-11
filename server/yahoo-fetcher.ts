/**
 * Yahoo quote + daily history, only as a stand-in when FMP answers 402
 * or is clearly down (5xx / unreachable). Not a fundamentals feed.
 *
 * Mapped fields: price, market cap, trailing PE, trailing EPS, OHLCV.
 * Income, balance, cash flow, analyst, segments and ratios stay empty.
 * The listing symbol is sent through unchanged (VOW3.DE stays VOW3.DE).
 *
 * Chart: public query1 chart endpoint, same shape as history-fallback.ts.
 * Quote (market cap / PE / EPS): v7 quote, which needs the fc.yahoo.com cookie
 * plus crumb. No yahoo-finance2 dependency.
 */
import type { FmpFailure } from "./fmp";
import { indicatorWarmupFromDate } from "./history-fallback";

export const YAHOO_PLAN_LIMIT_LABEL = "Plan-Limit, Yahoo-Kurs/History";
export const YAHOO_COVERAGE_NOTE =
  "Plan-Limit, Yahoo-Kurs/History. Teilabdeckung: nur Kurs, Market Cap, PE, EPS und History. Keine Fundamentals (GuV, Bilanz, Cashflow, Analysten). Kein volles Faktenset.";
export const YAHOO_QUOTE_COVERAGE = "yahoo-quote-history" as const;

const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 2 * 60 * 1000;
const CRUMB_TTL_MS = 30 * 60 * 1000;
const MIN_GAP_MS = 500;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface YahooBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface YahooBasicData {
  symbol: string;
  shortName: string | null;
  price: number | null;
  currency: string | null;
  exchange: string | null;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  historical: YahooBar[];
}

export interface YahooFmpShape {
  quote: {
    symbol: string;
    price: number;
    pe?: number;
    eps?: number;
    marketCap?: number;
    currency: string;
  };
  profile: {
    companyName: string;
    currency: string;
    marketCap: number;
    price: number;
    exchange: string;
    country: string;
    sector: string;
    industry: string;
    description: string;
  };
  financials: { income: never[]; cashflow: never[]; balanceSheet: never[] };
  analyst: { priceTarget: null; grades: never[]; estimates: never[] };
  ohlcv: YahooBar[];
  segments: never[];
  geoSegments: never[];
  peers: never[];
  ratios: never[];
  source: "yahoo";
}

type FetchImpl = typeof fetch;

interface CacheEntry {
  at: number;
  data: YahooBasicData | null;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<YahooBasicData | null>>();
let crumbState: { cookie: string; crumb: string; at: number } | null = null;
let paceTail: Promise<void> = Promise.resolve();
let lastPaceAt = 0;

/** Uppercase and trim only. Does not strip .DE or swap the listing. */
export function yahooListingSymbol(ticker: string): string {
  return String(ticker ?? "").trim().toUpperCase();
}

/**
 * 402 = plan does not cover the symbol.
 * Clear upstream: HTTP 5xx, or no HTTP status at all (timeout / network).
 * 429, missing key, empty quote, 401/403/404 stay on the existing FMP error.
 */
export function isYahooQuoteHistoryFallback(failure: FmpFailure): boolean {
  if (failure.fmpStatus === 402) return true;
  if (failure.errorCode === "FMP_UNREACHABLE") return true;
  if (failure.errorCode === "FMP_UPSTREAM_ERROR" && failure.fmpStatus != null && failure.fmpStatus >= 500) return true;
  return false;
}

/** fmp = quote present. yahoo = eligible failure. fmp-error = failure we do not paper over. */
export function routeQuoteSource(
  fmp: { failure: FmpFailure } | { quote?: { price?: number | null } | null },
): "fmp" | "yahoo" | "fmp-error" {
  if ("failure" in fmp && fmp.failure) {
    return isYahooQuoteHistoryFallback(fmp.failure) ? "yahoo" : "fmp-error";
  }
  return "fmp";
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function positive(value: unknown): number | null {
  const n = finite(value);
  return n != null && n > 0 ? n : null;
}

export function mapYahooToFmpFallback(data: YahooBasicData | null): YahooFmpShape | null {
  const price = data ? positive(data.price) : null;
  if (!data || price == null) return null;
  const name = (data.shortName || "").trim();
  return {
    quote: {
      symbol: data.symbol,
      price,
      ...(positive(data.pe) != null ? { pe: positive(data.pe) as number } : {}),
      ...(finite(data.eps) != null ? { eps: finite(data.eps) as number } : {}),
      ...(positive(data.marketCap) != null ? { marketCap: positive(data.marketCap) as number } : {}),
      currency: data.currency ?? "",
    },
    profile: {
      companyName: name || data.symbol,
      currency: data.currency ?? "",
      marketCap: positive(data.marketCap) ?? 0,
      price,
      exchange: data.exchange ?? "",
      country: "",
      sector: "",
      industry: "",
      description: "",
    },
    financials: { income: [], cashflow: [], balanceSheet: [] },
    analyst: { priceTarget: null, grades: [], estimates: [] },
    ohlcv: data.historical.filter((bar) => bar.close > 0 && bar.date.length === 10),
    segments: [],
    geoSegments: [],
    peers: [],
    ratios: [],
    source: "yahoo",
  };
}

export function clearYahooFetcherCacheForTests(): void {
  cache.clear();
  inflight.clear();
  crumbState = null;
}

function cookieFrom(headers: Headers): string {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const multi = typeof getSetCookie === "function" ? getSetCookie.call(headers) : [];
  if (multi.length > 0) return multi.map((row) => row.split(";")[0]?.trim()).filter(Boolean).join("; ");
  const single = headers.get("set-cookie");
  if (!single) return "";
  return single.split(/,(?=[^;]+=)/).map((row) => row.split(";")[0]?.trim()).filter((row) => row.includes("=")).join("; ");
}

async function loadCrumb(fetchImpl: FetchImpl, force: boolean): Promise<{ cookie: string; crumb: string }> {
  if (!force && crumbState && Date.now() - crumbState.at < CRUMB_TTL_MS) {
    return { cookie: crumbState.cookie, crumb: crumbState.crumb };
  }
  const fc = await fetchImpl("https://fc.yahoo.com", {
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  const cookie = cookieFrom(fc.headers);
  const crumbRes = await fetchImpl("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": UA, Accept: "text/plain", ...(cookie ? { Cookie: cookie } : {}) },
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumbRes.ok || !crumb || crumb.startsWith("{") || crumb.startsWith("<")) {
    throw new Error(`Yahoo crumb HTTP ${crumbRes.status}`);
  }
  crumbState = { cookie, crumb, at: Date.now() };
  return { cookie, crumb };
}

async function fetchQuote(symbol: string, fetchImpl: FetchImpl): Promise<Record<string, unknown> | null> {
  const attempt = async (forceCrumb: boolean): Promise<Response> => {
    const { cookie, crumb } = await loadCrumb(fetchImpl, forceCrumb);
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&crumb=${encodeURIComponent(crumb)}`;
    return fetchImpl(url, {
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": UA, Accept: "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    });
  };
  let resp = await attempt(false);
  if (resp.status === 401 || resp.status === 403) {
    crumbState = null;
    resp = await attempt(true);
  }
  if (!resp.ok) return null;
  const json = await resp.json() as { quoteResponse?: { result?: Record<string, unknown>[] } };
  const row = json?.quoteResponse?.result?.[0];
  return row && typeof row === "object" ? row : null;
}

function utcUnixDay(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
}

async function fetchChart(symbol: string, fetchImpl: FetchImpl): Promise<{ bars: YahooBar[]; meta: Record<string, unknown> | null }> {
  const from = indicatorWarmupFromDate();
  const to = new Date().toISOString().slice(0, 10);
  const period1 = utcUnixDay(from);
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const period2 = Math.floor(end.getTime() / 1000);
  if (!Number.isFinite(period1) || !Number.isFinite(period2) || period1 >= period2) return { bars: [], meta: null };
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  const resp = await fetchImpl(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!resp.ok) return { bars: [], meta: null };
  const json = await resp.json() as { chart?: { result?: Array<Record<string, unknown>> } };
  const result = json?.chart?.result?.[0];
  if (!result) return { bars: [], meta: null };
  const meta = (result.meta && typeof result.meta === "object") ? result.meta as Record<string, unknown> : null;
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp as number[] : [];
  const quote = ((result.indicators as { quote?: Array<Record<string, unknown>> } | undefined)?.quote?.[0]) ?? {};
  const opens = (quote.open as Array<number | null> | undefined) ?? [];
  const highs = (quote.high as Array<number | null> | undefined) ?? [];
  const lows = (quote.low as Array<number | null> | undefined) ?? [];
  const closes = (quote.close as Array<number | null> | undefined) ?? [];
  const volumes = (quote.volume as Array<number | null> | undefined) ?? [];
  const bars: YahooBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close)) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    if (date < from || date > to) continue;
    bars.push({
      date,
      open: opens[i] ?? close,
      high: highs[i] ?? close,
      low: lows[i] ?? close,
      close,
      volume: volumes[i] ?? 0,
    });
  }
  return { bars, meta };
}

async function loadUncached(symbol: string, fetchImpl: FetchImpl): Promise<YahooBasicData | null> {
  const [quoteSettled, chartSettled] = await Promise.allSettled([
    fetchQuote(symbol, fetchImpl),
    fetchChart(symbol, fetchImpl),
  ]);
  const quote = quoteSettled.status === "fulfilled" ? quoteSettled.value : null;
  const chart = chartSettled.status === "fulfilled" ? chartSettled.value : { bars: [], meta: null };
  const lastClose = chart.bars.length > 0 ? chart.bars[chart.bars.length - 1].close : null;
  const price = positive(quote?.regularMarketPrice) ?? positive(chart.meta?.regularMarketPrice) ?? positive(lastClose);
  if (price == null && chart.bars.length === 0) return null;
  const quoteSymbol = typeof quote?.symbol === "string" ? quote.symbol : null;
  const metaSymbol = typeof chart.meta?.symbol === "string" ? chart.meta.symbol : null;
  return {
    symbol: quoteSymbol || metaSymbol || symbol,
    shortName: (typeof quote?.shortName === "string" ? quote.shortName : null)
      ?? (typeof chart.meta?.shortName === "string" ? chart.meta.shortName : null),
    price,
    currency: (typeof quote?.currency === "string" ? quote.currency : null)
      ?? (typeof chart.meta?.currency === "string" ? chart.meta.currency : null),
    exchange: (typeof quote?.exchange === "string" ? quote.exchange : null)
      ?? (typeof chart.meta?.exchangeName === "string" ? chart.meta.exchangeName : null),
    marketCap: positive(quote?.marketCap),
    pe: positive(quote?.trailingPE),
    eps: finite(quote?.epsTrailingTwelveMonths),
    historical: chart.bars,
  };
}

function pace<T>(work: () => Promise<T>): Promise<T> {
  const run = paceTail.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastPaceAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await work();
    } finally {
      lastPaceAt = Date.now();
    }
  });
  paceTail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Quote + history for one listing. Returns null on an unknown symbol or a
 * Yahoo outage. Does not throw.
 * Pass fetchImpl to bypass cache and the rate limiter (tests).
 */
export async function fetchYahooAnalysisData(
  ticker: string,
  opts?: { fetchImpl?: FetchImpl },
): Promise<YahooBasicData | null> {
  const symbol = yahooListingSymbol(ticker);
  if (!symbol) return null;
  const fetchImpl = opts?.fetchImpl;
  if (fetchImpl) {
    try {
      return await loadUncached(symbol, fetchImpl);
    } catch (err) {
      console.error(`[Yahoo] ${symbol}: ${(err as Error)?.message ?? err}`);
      return null;
    }
  }
  const hit = cache.get(symbol);
  if (hit) {
    const ttl = hit.data ? SUCCESS_TTL_MS : MISS_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.data;
    cache.delete(symbol);
  }
  const pending = inflight.get(symbol);
  if (pending) return pending;
  const job = pace(async () => {
    try {
      const data = await loadUncached(symbol, globalThis.fetch.bind(globalThis));
      cache.set(symbol, { at: Date.now(), data });
      return data;
    } catch (err) {
      console.error(`[Yahoo] ${symbol}: ${(err as Error)?.message ?? err}`);
      cache.set(symbol, { at: Date.now(), data: null });
      return null;
    } finally {
      inflight.delete(symbol);
    }
  });
  inflight.set(symbol, job);
  return job;
}
