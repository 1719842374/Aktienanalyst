/**
 * Buffett-Indikator für das Rezessions-Dashboard.
 * USA: Wilshire 5000 zum nominalen BIP, davor die Financial-Accounts-Quote
 * auf den ersten Indexwert skaliert. Trend und Standardabweichungsbänder
 * werden einmal über die gesamte Reihe geschätzt.
 * Europa und China: die Weltbank-Quote, solange sie reicht, mit demselben Trend.
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

export function registerBuffettRatioRoute(app: Express): void {
  app.get("/api/analyze-recession/buffett", async (req: Request, res: Response) => {
    const region = String(req.query.region || "US").toUpperCase();
    if (!isRegion(region)) {
      return res.status(400).json({ error: "Region muss US, EU oder CN sein" });
    }
    const hit = cache.get(region);
    if (hit && Date.now() - hit.at < hit.ttl) return res.json(hit.body);
    try {
      const annual = region === "US" ? null : ANNUAL_REGIONS[region];
      const built: {
        points: TrendPoint[];
        note: string;
        sources: { id: string; role: string }[];
        fallback?: BuffettFallbackInfo | null;
      } = region === "US"
        ? await buildUnitedStates()
        : {
            points: await buildAnnualRatio(annual!.id),
            note: annual!.note,
            sources: [{ id: annual!.id, role: "Börsenkapitalisierung in Prozent des BIP" }],
          };
      const latest = built.points.length > 0 ? built.points[built.points.length - 1] : null;
      const body = {
        region,
        asOf: latest?.date ?? null,
        latest,
        note: built.note,
        sources: built.sources,
        fallback: built.fallback ?? null,
        points: built.points,
      };
      if (built.points.length > 0) {
        cache.set(region, { at: Date.now(), ttl: built.fallback ? FALLBACK_CACHE_MS : CACHE_MS, body });
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
