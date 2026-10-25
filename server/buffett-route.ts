/**
 * Buffett-Indikator für das Rezessions-Dashboard.
 * USA: Wilshire 5000 zum nominalen BIP, davor die Financial-Accounts-Quote
 * auf den ersten Indexwert skaliert. Trend und Standardabweichungsbänder
 * werden einmal über die gesamte Reihe geschätzt.
 * Europa und China: die Weltbank-Quote, solange sie reicht, mit demselben Trend.
 * F1-71/F1-74: danach eine Schätzung, geeicht auf die letzte Weltbank-Quote und mit
 * Benchmark-Kurs und BIP fortgeschrieben (EU ^STOXX, ersatzweise VGK; CN ASHR).
 */
import type { Express, Request, Response } from "express";
import {
  applyTrend,
  fitLogTrend,
  quarterlyFitSample,
  rollClosesForward,
  spliceAtListedStart,
  type RatioObs,
  type TrendPoint,
} from "./buffett-ratio";

const REGIONS = ["US", "EU", "CN"] as const;
type RegionId = (typeof REGIONS)[number];

/**
 * Wilshire-Konvention: ein Indexpunkt entsprach 1 Mrd. $ Kapitalisierung
 * und ist bis etwa 1,05 Mrd. $ je Punkt gedriftet. Das ist die Umrechnung
 * des Index in Dollar, keine Bewertungsschwelle.
 */
export const WILSHIRE_DOLLARS_PER_POINT_BN = 1.05;

const CACHE_MS = 15 * 60 * 1000;
/** F1-31: Ersatz-Antworten (FRED statt Wilshire) nur kurz halten, damit Wilshire bald neu versucht wird. */
const FALLBACK_CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; ttl: number; body: unknown }>();

/** F1-30: zwei Versuche mit Pause; Yahoo mit längerem Timeout als FRED. */
export const BUFFETT_FETCH_ATTEMPTS = 2;
let retryPauseMs = 1500;
const YAHOO_TIMEOUT_MS = 35000;
const FRED_TIMEOUT_MS = 25000;
const PROXY_TIMEOUT_MS = 25000;

/** Nur für Tests: Pause zwischen den Versuchen und Cache. */
export function setBuffettRetryPauseForTests(ms: number): void {
  retryPauseMs = ms;
}
export function resetBuffettCache(): void {
  cache.clear();
}

/** Fehler mit einem Grund, der so im 502-Body steht (F1-34). */
export class BuffettSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuffettSourceError";
  }
}

function fetchFailure(err: unknown, timeoutMs: number): string {
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `Timeout nach ${Math.round(timeoutMs / 1000)} s`;
  return String(e?.message ?? err ?? "unbekannter Fehler").substring(0, 160);
}

/** Holt Text mit Wiederholung. Wirft mit „<Quelle>: <Grund> (n Versuche)“. */
async function fetchTextWithRetry(
  label: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  attempts: number,
  accept: (text: string) => boolean = () => true,
): Promise<string> {
  let reason = "keine Antwort";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) {
        const text = await response.text();
        if (accept(text)) return text;
        reason = "leere oder ungültige Antwort";
      } else {
        reason = `HTTP ${response.status}`;
      }
    } catch (err) {
      reason = fetchFailure(err, timeoutMs);
    }
    if (attempt < attempts && retryPauseMs > 0) await new Promise(resolve => setTimeout(resolve, retryPauseMs));
  }
  throw new BuffettSourceError(`${label}: ${reason} (${attempts} ${attempts === 1 ? "Versuch" : "Versuche"})`);
}

const US_SOURCES = [
  { id: "^W5000", role: "Wilshire 5000, täglicher Schlusskurs" },
  { id: "GDP", role: "nominales BIP, Mrd. $, Jahresrate" },
  { id: "NCBEILQ027S", role: "Marktwert nichtfinanzieller Firmen bis zum Indexstart, Mio. $" },
  { id: "FBCELLQ027S", role: "Marktwert finanzieller Firmen bis zum Indexstart, Mio. $" },
];

interface FredPoint {
  date: string;
  value: number;
}

function isRegion(value: string): value is RegionId {
  return (REGIONS as readonly string[]).includes(value);
}

interface FredResult {
  points: FredPoint[];
  /** Grund, wenn die Reihe nicht geladen wurde; sonst null. */
  error: string | null;
}

async function fetchFred(seriesId: string, from: string): Promise<FredResult> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${from}`;
  let text: string;
  try {
    text = await fetchTextWithRetry(
      `FRED ${seriesId}`,
      url,
      {},
      FRED_TIMEOUT_MS,
      BUFFETT_FETCH_ATTEMPTS,
      body => !!body && !body.includes("<html") && !body.includes("<!DOCTYPE"),
    );
  } catch (err: any) {
    return { points: [], error: String(err?.message ?? err) };
  }
  const out: FredPoint[] = [];
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    if (!date || raw == null) continue;
    const value = Number(raw.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || !Number.isFinite(value)) continue;
    out.push({ date: date.trim(), value });
  }
  return { points: out, error: out.length === 0 ? `FRED ${seriesId}: keine Werte in der CSV` : null };
}

function asMap(points: FredPoint[]): Map<string, number> {
  return new Map(points.map(point => [point.date, point.value]));
}

function valueAt(points: FredPoint[], date: string): number | null {
  if (points.length === 0) return null;
  if (date <= points[0].date) return points[0].value;
  if (date >= points[points.length - 1].date) return points[points.length - 1].value;
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].date <= date) lo = mid;
    else hi = mid;
  }
  const left = points[lo];
  const right = points[hi];
  const span = Date.parse(`${right.date}T00:00:00Z`) - Date.parse(`${left.date}T00:00:00Z`);
  if (span <= 0) return left.value;
  const t = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${left.date}T00:00:00Z`)) / span;
  return left.value + (right.value - left.value) * t;
}

interface YahooBar {
  date: string;
  close: number;
}

async function fetchYahooDaily(
  symbol: string,
  period1: number,
  options: { attempts: number; timeoutMs: number } = { attempts: 1, timeoutMs: PROXY_TIMEOUT_MS },
): Promise<YahooBar[]> {
  const period2 = Math.floor(Date.now() / 1000) + 86_400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  const text = await fetchTextWithRetry(
    `Yahoo ${symbol}`,
    url,
    { headers: { "User-Agent": "Mozilla/5.0" } },
    options.timeoutMs,
    options.attempts,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BuffettSourceError(`Yahoo ${symbol}: Antwort ist kein JSON`);
  }
  const body = parsed as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const result = body.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const out: YahooBar[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    out.push({ date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), close });
  }
  return out;
}

async function fetchWilshire(): Promise<YahooBar[]> {
  const out = await fetchYahooDaily("^W5000", 599817600, { attempts: BUFFETT_FETCH_ATTEMPTS, timeoutMs: YAHOO_TIMEOUT_MS });
  if (out.length < 500) throw new BuffettSourceError(`Yahoo ^W5000: zu wenige Tagesschlüsse (${out.length} < 500)`);
  return out;
}

/** F1-31: Kennzeichnung, wenn der Zähler aus FRED statt aus dem Wilshire 5000 kommt. */
export interface BuffettFallbackInfo {
  source: string;
  reason: string;
  frequency: "quarterly";
  asOf: string | null;
}

export const FRED_MARKET_VALUE_FALLBACK_SOURCE = "FRED NCBEILQ027S + FBCELLQ027S (Financial Accounts, Quartalswerte)";

/**
 * Yahoo lässt den Wilshire-Tag oft leer, während der US-Gesamtmarkt schon
 * einen Schluss hat. Die fehlenden Sitzungen laufen mit dessen Rendite weiter,
 * damit der letzte Punkt der aktuelle Handelstag ist.
 */
const SESSION_PROXIES = [
  { id: "^DWCF", name: "Dow Jones U.S. Total Stock Market" },
  { id: "VTI", name: "Vanguard Total Stock Market" },
] as const;

async function fetchSessionProxy(): Promise<{ id: string; name: string; bars: YahooBar[] } | null> {
  const period1 = Math.floor(Date.now() / 1000) - 400 * 86_400;
  for (const proxy of SESSION_PROXIES) {
    try {
      const bars = await fetchYahooDaily(proxy.id, period1);
      if (bars.length >= 5) return { id: proxy.id, name: proxy.name, bars };
    } catch (err: any) {
      console.warn(`[buffett] ${proxy.id}`, err?.message?.substring(0, 120));
    }
  }
  return null;
}

function withTrend(points: RatioObs[]): TrendPoint[] {
  const model = fitLogTrend(quarterlyFitSample(points));
  if (!model) throw new BuffettSourceError("Trend nicht schätzbar (zu wenige Quartale)");
  return applyTrend(model, points);
}

async function buildUnitedStates(): Promise<{
  points: TrendPoint[];
  note: string;
  sources: { id: string; role: string }[];
  fallback?: BuffettFallbackInfo | null;
}> {
  const [gdpResult, nfcResult, financialResult, wilshireResult, proxy] = await Promise.all([
    fetchFred("GDP", "1947-01-01"),
    fetchFred("NCBEILQ027S", "1947-01-01"),
    fetchFred("FBCELLQ027S", "1947-01-01"),
    fetchWilshire().then(
      bars => ({ bars, error: null as string | null }),
      (err: any) => ({ bars: null as YahooBar[] | null, error: String(err?.message ?? err) }),
    ),
    fetchSessionProxy(),
  ]);
  const gdp = gdpResult.points;
  const nfc = nfcResult.points;
  const financial = financialResult.points;
  if (gdp.length < 8) throw new BuffettSourceError(`BIP-Reihe leer – ${gdpResult.error ?? `nur ${gdp.length} Werte`}`);
  const nfcMap = asMap(nfc);
  const financialMap = asMap(financial);
  const earlyDates = [...nfcMap.keys()]
    .filter(date => date >= "1950-01-01" && financialMap.has(date))
    .sort();
  const early: RatioObs[] = [];
  for (const date of earlyDates) {
    const gdpBn = valueAt(gdp, date);
    if (gdpBn == null || gdpBn <= 0) continue;
    const marketCapBn = ((nfcMap.get(date) ?? 0) + (financialMap.get(date) ?? 0)) / 1000;
    early.push({ date, ratio: (marketCapBn / gdpBn) * 100 });
  }
  if (!wilshireResult.bars) {
    // F1-31: Wilshire fehlt → FRED-Marktwert auch für aktuelle Werte, als Quartalsreihe mit eigenem Trend.
    const wilshireError = wilshireResult.error ?? "Yahoo ^W5000: keine Daten";
    if (early.length < 8) {
      const fredError = nfcResult.error ?? financialResult.error ?? `nur ${early.length} Quartale`;
      throw new BuffettSourceError(`${wilshireError}; FRED-Ersatz leer – ${fredError}`);
    }
    const points = withTrend(early);
    const asOf = points.length > 0 ? points[points.length - 1].date : null;
    return {
      points,
      fallback: { source: FRED_MARKET_VALUE_FALLBACK_SOURCE, reason: wilshireError, frequency: "quarterly", asOf },
      note: `Ersatzquelle: Der Wilshire 5000 ist nicht verfügbar (${wilshireError}). Der Zähler ist deshalb der Marktwert der Aktien nichtfinanzieller und finanzieller Firmen aus den Financial Accounts (FRED NCBEILQ027S + FBCELLQ027S), geteilt durch das nominale BIP. Das sind Quartalswerte mit Veröffentlichungsverzug; der letzte Punkt ist das letzte veröffentlichte Quartal, nicht der heutige Handelstag. Das Niveau ist nicht mit der Wilshire-Linie vergleichbar, weil die Financial Accounts auch nicht börsennotierte Firmen enthalten. Trend und Bänder werden auf dieser Reihe geschätzt.`,
      sources: US_SOURCES.filter(source => source.id !== "^W5000"),
    };
  }
  const wilshire = wilshireResult.bars;
  const bars = proxy ? rollClosesForward(wilshire, proxy.bars) : wilshire;
  const extended = bars.length > wilshire.length;
  const listed: RatioObs[] = [];
  for (const bar of bars) {
    const gdpBn = valueAt(gdp, bar.date);
    if (gdpBn == null || gdpBn <= 0) continue;
    listed.push({
      date: bar.date,
      ratio: (bar.close * WILSHIRE_DOLLARS_PER_POINT_BN / gdpBn) * 100,
    });
  }
  if (listed.length < 500) throw new BuffettSourceError(`Wilshire-Quote leer (${listed.length} Tage mit BIP-Wert)`);
  const spliced = spliceAtListedStart(early, listed);
  const carried = extended && proxy
    ? ` Fehlt der Wilshire-Schluss, läuft der Kurs mit der Tagesrendite des ${proxy.name} bis zur letzten US-Sitzung weiter (höchstens 30 Tage, Punkte als „fortgeschrieben“ markiert).`
    : "";
  // #245: fortgeschriebene Punkte tragen das Proxy-Symbol
  const proxyDates = new Set(bars.filter(bar => (bar as { proxy?: true }).proxy).map(bar => bar.date));
  const points = withTrend(spliced).map(point =>
    proxy && proxyDates.has(point.date) ? { ...point, proxy: proxy.id } : point);
  return {
    points,
    note: `Der Zähler ist der Wilshire 5000. Ein Indexpunkt wird mit 1,05 Mrd. $ Kapitalisierung angesetzt und durch das nominale BIP geteilt. Bis 1950 zurück wird die Quote der Financial Accounts auf den ersten Indexwert skaliert. Die Trendlinie und die Bänder von einer und zwei Standardabweichungen gelten für die gesamte Reihe. Die Zeitfenster zeigen davon nur einen Ausschnitt.${carried}`,
    sources: extended && proxy
      ? [...US_SOURCES, { id: proxy.id, role: `${proxy.name}, Tagesrendite nach dem letzten Wilshire-Schluss` }]
      : US_SOURCES,
  };
}

async function buildAnnualRatio(seriesId: string): Promise<TrendPoint[]> {
  const result = await fetchFred(seriesId, "1975-01-01");
  const ratios = result.points.map(point => ({ date: point.date, ratio: point.value }));
  // F1-34: statt einer leeren 200-Antwort den Grund melden.
  if (ratios.length < 8) throw new BuffettSourceError(result.error ?? `FRED ${seriesId}: nur ${ratios.length} Jahreswerte`);
  return withTrend(ratios);
}

const ANNUAL_REGIONS: Record<Exclude<RegionId, "US">, { id: string; note: string }> = {
  EU: {
    id: "DDDM01EZA156NWDB",
    note: "Euroraum, börsennotierte Inlandsfirmen in Prozent des BIP (Weltbank über FRED). Die Reihe endet mit dem letzten veröffentlichten Jahr. Trend und Bänder werden auf dieser Reihe geschätzt.",
  },
  CN: {
    id: "DDDM01CNA156NWDB",
    note: "China, börsennotierte Inlandsfirmen in Prozent des BIP (Weltbank über FRED). Die Reihe endet mit dem letzten veröffentlichten Jahr. Trend und Bänder werden auf dieser Reihe geschätzt.",
  },
};

// ── F1-71 / F1-74: Benchmark-Schätzung für EU und CN ──────────────────────────

export interface BenchmarkCandidate {
  symbol: string;
  name: string;
  kind: "index" | "etf";
  currency: "EUR" | "USD";
  /** Umrechnung des Kurses in die BIP-Währung: Kurs / FX (FX = Kurswährung je BIP-Währung). */
  fx?: { id: string; role: string };
}

export interface BenchmarkRegion {
  gdp: { id: string; role: string; currency: "EUR" | "USD"; periodDays: number };
  candidates: BenchmarkCandidate[];
  scopeNote: string;
}

/** Reihenfolge der Kandidaten = Fallback-Kette (Index → ETF). Danach: Weltbank-Reihe allein, dann n/a. */
export const BENCHMARK_REGIONS: Record<Exclude<RegionId, "US">, BenchmarkRegion> = {
  EU: {
    gdp: { id: "EUNNGDP", role: "BIP Euroraum, nominal, Mio. €, Quartalswert (Eurostat über FRED)", currency: "EUR", periodDays: 91 },
    candidates: [
      { symbol: "^STOXX", name: "STOXX Europe 600", kind: "index", currency: "EUR" },
      {
        symbol: "VGK",
        name: "Vanguard FTSE Europe ETF",
        kind: "etf",
        currency: "USD",
        fx: { id: "DEXUSEU", role: "US-$ je Euro, täglich (Umrechnung des VGK-Kurses in €)" },
      },
    ],
    scopeNote: " Der Kurs deckt Europa ab (auch Großbritannien und die Schweiz), Anker und BIP gelten für den Euroraum.",
  },
  CN: {
    gdp: { id: "MKTGDPCNA646NWDB", role: "BIP China, nominal, US-$, Jahreswert (Weltbank über FRED)", currency: "USD", periodDays: 365 },
    candidates: [
      { symbol: "ASHR", name: "Xtrackers Harvest CSI 300 China A-Shares ETF", kind: "etf", currency: "USD" },
    ],
    scopeNote: " Der Kurs bildet die 300 größten A-Aktien (CSI 300) in US-$ ab, Anker und BIP gelten für alle börsennotierten Inlandsfirmen Chinas.",
  },
};

/** Mindestzahl an Tageskursen nach dem Anker, sonst gilt der Kandidat als ausgefallen. */
export const BENCHMARK_MIN_BARS_AFTER_ANCHOR = 20;

/** Perioden-Werte auf die Periodenmitte legen (FRED datiert auf den Periodenanfang). */
export function atPeriodMid(points: FredPoint[], periodDays: number): FredPoint[] {
  const shift = Math.round(periodDays / 2) * 86_400_000;
  return points.map(point => ({
    date: new Date(Date.parse(`${point.date}T00:00:00Z`) + shift).toISOString().slice(0, 10),
    value: point.value,
  }));
}

export interface AnchorResult {
  anchorDate: string;
  anchorClose: number;
  anchorGdp: number;
  points: RatioObs[];
}

/**
 * Quote(t) = Quote_Anker × (Kurs(t) / Kurs_Anker) / (BIP(t) / BIP_Anker).
 * Anker = letzter Kurs an oder vor dem 31.12. des Weltbank-Jahres; BIP linear zwischen Periodenmitten,
 * nach dem letzten Wert konstant. Wirft BuffettSourceError mit Grund.
 */
export function anchorEstimate(input: {
  anchorQuote: number;
  anchorYear: number;
  bars: { date: string; close: number }[];
  gdp: FredPoint[];
  label: string;
}): AnchorResult {
  const yearEnd = `${input.anchorYear}-12-31`;
  const bars = input.bars.filter(bar => Number.isFinite(bar.close) && bar.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const before = bars.filter(bar => bar.date <= yearEnd);
  const anchor = before[before.length - 1];
  if (!anchor || anchor.date < `${input.anchorYear}-10-01`) {
    throw new BuffettSourceError(`${input.label}: kein Kurs im letzten Quartal des Ankerjahres ${input.anchorYear}`);
  }
  if (input.gdp.length === 0 || input.gdp[0].date > anchor.date) {
    throw new BuffettSourceError(`${input.label}: BIP-Reihe deckt das Ankerdatum ${anchor.date} nicht ab`);
  }
  const anchorGdp = valueAt(input.gdp, anchor.date);
  if (anchorGdp == null || anchorGdp <= 0) throw new BuffettSourceError(`${input.label}: kein BIP-Wert am Ankerdatum`);
  const after = bars.filter(bar => bar.date > anchor.date);
  if (after.length < BENCHMARK_MIN_BARS_AFTER_ANCHOR) {
    throw new BuffettSourceError(`${input.label}: zu wenige Kurse nach dem Anker (${after.length} < ${BENCHMARK_MIN_BARS_AFTER_ANCHOR})`);
  }
  const points: RatioObs[] = [{ date: anchor.date, ratio: input.anchorQuote }];
  for (const bar of after) {
    const gdpNow = valueAt(input.gdp, bar.date);
    if (gdpNow == null || gdpNow <= 0) continue;
    points.push({ date: bar.date, ratio: input.anchorQuote * (bar.close / anchor.close) / (gdpNow / anchorGdp) });
  }
  return { anchorDate: anchor.date, anchorClose: anchor.close, anchorGdp, points };
}

export interface BenchmarkInfo {
  symbol: string;
  name: string;
  kind: "index" | "etf";
  currency: "EUR" | "USD";
  estimate: true;
  anchorYear: number;
  anchorDate: string;
  anchorQuote: number;
  gdpSeries: string;
  gdpAsOf: string;
  /** Gründe der übersprungenen Kandidaten, z. B. Index ausgefallen → ETF. */
  skipped: string[];
}

type BuffettPointOut = TrendPoint & { proxyKind?: "etf" };

function germanDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

function formatPct(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

async function loadCandidateBars(candidate: BenchmarkCandidate, anchorYear: number): Promise<{ date: string; close: number }[]> {
  const period1 = Math.floor(Date.UTC(anchorYear - 1, 0, 1) / 1000);
  const bars = await fetchYahooDaily(candidate.symbol, period1, { attempts: BUFFETT_FETCH_ATTEMPTS, timeoutMs: YAHOO_TIMEOUT_MS });
  if (!candidate.fx) return bars;
  const fx = await fetchFred(candidate.fx.id, `${anchorYear - 1}-01-01`);
  if (fx.points.length === 0) throw new BuffettSourceError(fx.error ?? `FRED ${candidate.fx.id}: keine Werte`);
  const out: { date: string; close: number }[] = [];
  for (const bar of bars) {
    const rate = valueAt(fx.points, bar.date);
    if (rate != null && rate > 0) out.push({ date: bar.date, close: bar.close / rate });
  }
  return out;
}

/**
 * Weltbank-Jahresquote bis zum Anker, danach die Benchmark-Schätzung.
 * Fällt die Weltbank-Reihe aus, bleibt der Grund unverändert (n/a); fallen Kurs oder BIP aus,
 * kommt die Weltbank-Reihe allein mit Grund im Hinweis.
 */
async function buildBenchmarkRegion(region: Exclude<RegionId, "US">): Promise<{
  points: BuffettPointOut[];
  note: string;
  sources: { id: string; role: string }[];
  benchmark: BenchmarkInfo | null;
  benchmarkUnavailable: string | null;
}> {
  const annual = ANNUAL_REGIONS[region];
  const config = BENCHMARK_REGIONS[region];
  const worldBankSource = { id: annual.id, role: "Börsenkapitalisierung in Prozent des BIP" };
  const wb = await fetchFred(annual.id, "1975-01-01");
  const ratios = wb.points.map(point => ({ date: point.date, ratio: point.value }));
  if (ratios.length < 8) throw new BuffettSourceError(wb.error ?? `FRED ${annual.id}: nur ${ratios.length} Jahreswerte`);
  const last = wb.points[wb.points.length - 1];
  const anchorYear = Number(last.date.slice(0, 4));

  const reasons: string[] = [];
  const gdpResult = await fetchFred(config.gdp.id, `${anchorYear - 2}-01-01`);
  if (gdpResult.points.length > 0) {
    const gdp = atPeriodMid(gdpResult.points, config.gdp.periodDays);
    const gdpAsOf = gdpResult.points[gdpResult.points.length - 1].date;
    for (const candidate of config.candidates) {
      try {
        const bars = await loadCandidateBars(candidate, anchorYear);
        const anchored = anchorEstimate({ anchorQuote: last.value, anchorYear, bars, gdp, label: `Yahoo ${candidate.symbol}` });
        const tail = anchored.points.filter(point => point.date > last.date);
        const combined = [...ratios, ...tail];
        const anchorStamp = anchored.anchorDate;
        const points: BuffettPointOut[] = withTrend(combined).map(point =>
          candidate.kind === "etf" && point.date > anchorStamp ? { ...point, proxy: candidate.symbol, proxyKind: "etf" as const } : point);
        const viaEtf = candidate.kind === "etf"
          ? ` ETF-Proxy: Der Kurs stammt vom ${candidate.name} (${candidate.symbol}), nicht von einem Index mit gemessener Marktkapitalisierung${candidate.fx ? `; in € umgerechnet mit FRED ${candidate.fx.id}` : ""}.`
          : "";
        const skippedText = reasons.length > 0 ? ` Übersprungen: ${reasons.join("; ")}.` : "";
        const note = `Schätzung ab dem Anker: Bis ${anchorYear} ist das die Weltbank-Quote (${annual.id}). Anker-Datum ${germanDate(anchored.anchorDate)} (Weltbank-Quote ${anchorYear}: ${formatPct(last.value)} %). Danach gilt Quote(t) = Quote_Anker × Kurs(t)/Kurs_Anker ÷ BIP(t)/BIP_Anker mit dem Kurs ${candidate.symbol} (${candidate.name}, ${candidate.fx ? "in €" : candidate.currency === "EUR" ? "€" : "US-$"}) und dem BIP ${config.gdp.id} (${config.gdp.currency === "EUR" ? "€" : "US-$"}, letzter Wert für die Periode ab ${germanDate(gdpAsOf)}, danach konstant gehalten). Das ist keine gemessene Marktkapitalisierung: Börsengänge, Delistings und Änderungen der Indexzusammensetzung fehlen.${config.scopeNote}${viaEtf}${skippedText} Trend und Bänder werden auf der ganzen Reihe geschätzt.`;
        const sources = [
          worldBankSource,
          { id: candidate.symbol, role: candidate.kind === "etf" ? `ETF-Proxy: ${candidate.name}, täglicher Schlusskurs ab dem Anker` : `${candidate.name}, täglicher Schlusskurs ab dem Anker` },
          ...(candidate.fx ? [candidate.fx] : []),
          { id: config.gdp.id, role: config.gdp.role },
        ];
        return {
          points,
          note,
          sources,
          benchmark: {
            symbol: candidate.symbol,
            name: candidate.name,
            kind: candidate.kind,
            currency: candidate.fx ? config.gdp.currency : candidate.currency,
            estimate: true,
            anchorYear,
            anchorDate: anchored.anchorDate,
            anchorQuote: last.value,
            gdpSeries: config.gdp.id,
            gdpAsOf,
            skipped: [...reasons],
          },
          benchmarkUnavailable: null,
        };
      } catch (err: any) {
        reasons.push(String(err?.message ?? err).substring(0, 200));
      }
    }
  } else {
    reasons.push(gdpResult.error ?? `FRED ${config.gdp.id}: keine Werte`);
  }
  const reason = reasons.join("; ");
  return {
    points: withTrend(ratios),
    note: `${annual.note} Keine Benchmark-Schätzung nach ${anchorYear}: ${reason}.`,
    sources: [worldBankSource],
    benchmark: null,
    benchmarkUnavailable: reason,
  };
}

export function registerBuffettRatioRoute(app: Express): void {
  app.get("/api/analyze-recession/buffett", async (req: Request, res: Response) => {
    const region = String(req.query.region || "US").toUpperCase();
    if (!isRegion(region)) {
      return res.status(400).json({ error: "Region muss US, EU oder CN sein" });
    }
    const hit = cache.get(region);
    if (hit && Date.now() - hit.at < hit.ttl) return res.json(hit.body);
    try {
      const built: {
        points: TrendPoint[];
        note: string;
        sources: { id: string; role: string }[];
        fallback?: BuffettFallbackInfo | null;
        benchmark?: BenchmarkInfo | null;
        benchmarkUnavailable?: string | null;
      } = region === "US"
        ? await buildUnitedStates()
        : await buildBenchmarkRegion(region);
      const latest = built.points.length > 0 ? built.points[built.points.length - 1] : null;
      const body = {
        region,
        asOf: latest?.date ?? null,
        latest,
        note: built.note,
        sources: built.sources,
        fallback: built.fallback ?? null,
        points: built.points,
        // F1-71/F1-74: nur EU/CN; die US-Antwort bleibt unverändert.
        ...(region === "US" ? {} : { benchmark: built.benchmark ?? null, benchmarkUnavailable: built.benchmarkUnavailable ?? null }),
      };
      if (built.points.length > 0) {
        const short = !!built.fallback || !!built.benchmarkUnavailable;
        cache.set(region, { at: Date.now(), ttl: short ? FALLBACK_CACHE_MS : CACHE_MS, body });
      }
      res.json(body);
    } catch (err: any) {
      console.error("[GET /api/analyze-recession/buffett]", err?.message?.substring(0, 200));
      // F1-34: konkreter Grund (Timeout, zu wenige Bars, BIP leer …) statt generischem Text.
      const reason = String(err?.message ?? "unbekannter Fehler").substring(0, 300);
      res.status(502).json({
        error: `Buffett-Quote nicht verfügbar: ${reason}`,
        errorCode: "BUFFETT_SOURCE_UNAVAILABLE",
        reason,
      });
    }
  });
}
