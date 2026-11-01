/**
 * Kostenlose Ersatzquelle, wenn FMP 402 liefert oder die Antwort leer ist.
 * quoteSummary zuerst (incomeStatementHistory, balanceSheetHistory, defaultKeyStatistics,
 * summaryDetail.trailingPE). Sind die Abschlusszeilen nur Platzhalter, übernimmt die
 * fundamentals-timeseries ohne Crumb. ETF-KGV ohne Crumb aus der Quote-Seite.
 * Wirft nie. Fehlende Werte bleiben n/a.
 */
import type { FundamentalPoint } from "../shared/earnings-yield-roic";
import { sanitizeRoic } from "./news-peers";
import { fetchYahooQuoteSummaryResult, fetchYahooTimeseriesDocument, spaceYahooCall, YAHOO_BROWSER_UA, YAHOO_CACHE_TTL_MS } from "./yahoo-fetcher";
import {
  annualsFromQuoteSummary,
  annualsFromTimeseries,
  DAYS_PER_FISCAL_YEAR,
  earningsYieldPointsFromAnnuals,
  preferReportedSeries,
  roicPointsFromAnnuals,
  trailingPeFromQuoteSummary,
  trailingPeFromYahooHtml,
  YAHOO_ANNUAL_TYPES,
  YAHOO_HTML_TRAILING_PE_SOURCE,
  YAHOO_QS_EY_SOURCE,
  YAHOO_QS_ROIC_SOURCE,
  YAHOO_QS_TRAILING_PE_SOURCE,
  YAHOO_TS_EY_SOURCE,
  YAHOO_TS_ROIC_SOURCE,
  type ReportedSeries,
} from "../shared/yahoo-fundamental-series";

const FAIL_TTL_MS = 2 * 60 * 1000;
const QS_STATEMENT_MODULES = ["incomeStatementHistory", "balanceSheetHistory", "defaultKeyStatistics"] as const;
const QS_PE_MODULES = ["summaryDetail", "defaultKeyStatistics"] as const;

export interface YahooSeriesBundle {
  earningsYield: ReportedSeries;
  roic: ReportedSeries;
}

export interface YahooTrailingPe {
  pe: number | null;
  source: string;
  note: string | null;
}

let bundleCache = new Map<string, { at: number; body: YahooSeriesBundle }>();
const bundleInflight = new Map<string, Promise<YahooSeriesBundle>>();

export function resetYahooFundamentalCacheForTests(): void {
  bundleCache = new Map();
  bundleInflight.clear();
}

function hasValue(points: FundamentalPoint[]): boolean {
  return points.some(p => p.value != null && Number.isFinite(p.value));
}

function finalizeRoic(built: { points: FundamentalPoint[]; note: string | null }): { points: FundamentalPoint[]; note: string | null } {
  const points = built.points.map(p => {
    if (p.value == null) return p;
    const sane = sanitizeRoic(p.value);
    if (sane == null) return { ...p, value: null, note: "n/a — ROIC fehlt oder unplausibel" };
    return { ...p, value: +sane.toFixed(1) };
  });
  const any = hasValue(points);
  return { points, note: any ? null : (points.find(p => p.note)?.note ?? built.note ?? "n/a — ROIC nicht berechenbar") };
}

async function fetchQuoteHtml(symbol: string): Promise<string | null> {
  try {
    await spaceYahooCall();
    const resp = await fetch(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": YAHOO_BROWSER_UA, Accept: "text/html" },
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

async function buildBundle(symbol: string, years: number): Promise<YahooSeriesBundle> {
  const sym = symbol.trim().toUpperCase();
  const qs = await fetchYahooQuoteSummaryResult(sym, QS_STATEMENT_MODULES);
  const qsAnnuals = qs ? annualsFromQuoteSummary(qs) : [];
  const qsEy = earningsYieldPointsFromAnnuals(qsAnnuals);
  const qsRoic = finalizeRoic(roicPointsFromAnnuals(qsAnnuals));
  const primaryEy: ReportedSeries = {
    points: qsEy.points,
    source: YAHOO_QS_EY_SOURCE,
    note: qs ? qsEy.note : "n/a — Yahoo quoteSummary nicht verfügbar",
  };
  const primaryRoic: ReportedSeries = {
    points: qsRoic.points,
    source: YAHOO_QS_ROIC_SOURCE,
    note: qs ? qsRoic.note : "n/a — Yahoo quoteSummary nicht verfügbar",
  };
  if (hasValue(primaryEy.points) && hasValue(primaryRoic.points)) {
    return { earningsYield: { ...primaryEy, note: null }, roic: { ...primaryRoic, note: null } };
  }
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - years * DAYS_PER_FISCAL_YEAR * 24 * 60 * 60;
  const doc = await fetchYahooTimeseriesDocument(sym, YAHOO_ANNUAL_TYPES, period1, period2);
  const tsAnnuals = doc ? annualsFromTimeseries(doc) : [];
  const tsEy = earningsYieldPointsFromAnnuals(tsAnnuals);
  const tsRoic = finalizeRoic(roicPointsFromAnnuals(tsAnnuals));
  const fallbackEy: ReportedSeries = {
    points: tsEy.points,
    source: YAHOO_TS_EY_SOURCE,
    note: doc ? tsEy.note : "n/a — Yahoo fundamentals-timeseries nicht verfügbar",
  };
  const fallbackRoic: ReportedSeries = {
    points: tsRoic.points,
    source: YAHOO_TS_ROIC_SOURCE,
    note: doc ? tsRoic.note : "n/a — Yahoo fundamentals-timeseries nicht verfügbar",
  };
  const earningsYield = preferReportedSeries(primaryEy, fallbackEy);
  const roic = preferReportedSeries(primaryRoic, fallbackRoic);
  return {
    earningsYield: hasValue(earningsYield.points) ? { ...earningsYield, note: null } : earningsYield,
    roic: hasValue(roic.points) ? { ...roic, note: null } : roic,
  };
}

export async function loadYahooFundamentalBundle(symbol: string, years: number): Promise<YahooSeriesBundle> {
  const key = `${symbol.trim().toUpperCase()}|${years}`;
  const hit = bundleCache.get(key);
  const fresh = hit && Date.now() - hit.at < (hasValue(hit.body.earningsYield.points) || hasValue(hit.body.roic.points) ? YAHOO_CACHE_TTL_MS : FAIL_TTL_MS);
  if (hit && fresh) return hit.body;
  const running = bundleInflight.get(key);
  if (running) return running;
  const pending = buildBundle(symbol, years).finally(() => { bundleInflight.delete(key); });
  bundleInflight.set(key, pending);
  const body = await pending;
  bundleCache.set(key, { at: Date.now(), body });
  return body;
}

export async function loadYahooEtfTrailingPe(symbol: string): Promise<YahooTrailingPe> {
  const sym = symbol.trim().toUpperCase();
  const qs = await fetchYahooQuoteSummaryResult(sym, QS_PE_MODULES);
  const fromSummary = qs ? trailingPeFromQuoteSummary(qs) : null;
  if (fromSummary != null) return { pe: fromSummary, source: YAHOO_QS_TRAILING_PE_SOURCE, note: null };
  const html = await fetchQuoteHtml(sym);
  const fromPage = html ? trailingPeFromYahooHtml(html) : null;
  if (fromPage != null) return { pe: fromPage, source: YAHOO_HTML_TRAILING_PE_SOURCE, note: null };
  const note = !qs && !html
    ? "n/a — Yahoo quoteSummary summaryDetail.trailingPE nicht verfügbar"
    : "n/a — Yahoo trailingPE fehlt";
  return { pe: null, source: YAHOO_QS_TRAILING_PE_SOURCE, note };
}
