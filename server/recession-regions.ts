/**
 * Eurozone and Japan prints for the recession catalogs.
 * Fetch failures become empty series. The scorer does not invent a number.
 */
import { fmpHistoricalPrices, fmpRatiosTtm } from "./fmp";
import { parseBojSeries, parseEcbCsv } from "./liquidity-briefing-math";
import { fetchVstoxxVol, fetchYahooDailySeries } from "./recession-markets";
import { fetchYahooTimeseriesFundamentals } from "./yahoo-fetcher";
import { realizedVol20 } from "../shared/recession-market-charts";
import {
  ASIA_GDP_USD,
  REGION_WEIGHT,
  alignSpread,
  asiaGdpWeights,
  catalogProbability,
  blendWeighted,
  closedSlot,
  isStale,
  laborSlot,
  levelAndDelta,
  parseEurostatSeries,
  sahmGapPp,
  yoyByMonth,
  type AsiaGdpWeights,
  type DatedPoint,
  type RegionCatalog,
  type RegionalCatalogs,
  type RegionSlot,
  type ScoredReading,
} from "../shared/recession-regions";

const EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const ECB_M3_YOY = "https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M30.X.I.U2.2300.Z01.A";
const BOJ_M2_YOY = "MAM1YAM2M2MO";
const FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv";

export interface RegionalPrints {
  ezUnemployment: { geo: string; points: DatedPoint[] };
  ezLong: DatedPoint[];
  ezShort: DatedPoint[];
  ezIp: { geo: string; points: DatedPoint[] };
  ezM3Yoy: number | null;
  ezHy: number | null;
  ezPe: number | null;
  ezPeSource: string;
  ezVol: number | null;
  jpUnemployment: DatedPoint[];
  jpLong: DatedPoint[];
  jpIp: DatedPoint[];
  jpIpSource: string;
  jpM2Yoy: number | null;
  jpPe: number | null;
  jpPeSource: string;
  jpVol: number | null;
  /** Month-end 20-session realized vol of ASHR. Empty when Yahoo has no closes. */
  cnVolPoints: DatedPoint[];
  cnVolSource: string;
  cnPe: number | null;
  cnPeSource: string;
  /** Latest World Bank GDP, current US$. null when the FRED print is missing. */
  jpGdpUsd: number | null;
  cnGdpUsd: number | null;
  jpGdpSource: string;
  cnGdpSource: string;
}

export interface RegionScorers {
  money: (yoy: number) => ScoredReading;
  credit: (spread: number) => ScoredReading;
  vol: (level: number) => ScoredReading;
  valuation: (ratio: number) => ScoredReading;
  activity: (yoy: number) => { rawScore: number; zone: string };
  curve: (levels: number[], stressWhenLow: boolean) => { available: boolean; raw: number };
}

export interface ScoreInput {
  prints: RegionalPrints;
  usSlots: RegionSlot[];
  usRecession12m: number;
  usCorrection12m: number;
  today: string;
  scorers: RegionScorers;
}

async function getText(url: string, timeoutMs = 20000, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<string> {
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const resp = await fetch(url, {
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      headers: { "User-Agent": "Aktienanalyst/1.0", Accept: "application/json,text/csv,*/*", ...headers },
    });
    if (!resp.ok) return "";
    return await resp.text();
  } catch {
    return "";
  }
}

function parseFred(csv: string): DatedPoint[] {
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
  const points: DatedPoint[] = [];
  for (const line of csv.trim().split("\n").slice(1)) {
    const [date, raw] = line.split(",");
    const value = Number(raw?.trim());
    if (date && /^\d{4}-\d{2}-\d{2}/.test(date) && Number.isFinite(value)) points.push({ date: date.trim(), value });
  }
  return points;
}

async function fred(id: string, cosd: string, signal?: AbortSignal): Promise<DatedPoint[]> {
  const csv = await getText(`${FRED}?id=${encodeURIComponent(id)}&cosd=${cosd}`, 20000, {}, signal);
  return parseFred(csv);
}

async function getTextResult(
  url: string,
  timeoutMs = 20000,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<{ text: string; status: number | null; error: string | null }> {
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    const resp = await fetch(url, {
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      headers: { "User-Agent": "Aktienanalyst/1.0", Accept: "application/json,text/csv,*/*", ...headers },
    });
    if (!resp.ok) return { text: "", status: resp.status, error: `HTTP ${resp.status}` };
    return { text: await resp.text(), status: resp.status, error: null };
  } catch (err) {
    const name = (err as Error)?.name;
    const error = name === "TimeoutError" || name === "AbortError" ? "Timeout" : String((err as Error)?.message || err).slice(0, 120);
    return { text: "", status: null, error };
  }
}

function eurostatWhy(result: { text: string; error: string | null }): string | null {
  if (result.error) return result.error;
  if (!result.text) return "leer";
  if (result.text.includes("<html")) return "HTML";
  return null;
}

/** EA20 is tried, retried once when empty, and only then EA21. */
export function eurostatStep(pointCount: number, alreadyRetried: boolean): "use" | "retry" | "next" {
  if (pointCount > 0) return "use";
  if (!alreadyRetried) return "retry";
  return "next";
}

/** Second Eurostat try. A 20s hang is not repeated. une_rt_m with a finished empty body goes straight to the next geo. */
export const EUROSTAT_RETRY_MS = 8000;

export function eurostatAttemptPlan(input: {
  pointCount: number;
  alreadyRetried: boolean;
  why: string | null;
  dataset: string;
  httpStatus: number | null;
  hasNext: boolean;
}): "use" | "retry" | "next" {
  const step = eurostatStep(input.pointCount, input.alreadyRetried);
  if (step === "use") return "use";
  if (!input.hasNext || step === "next") return "next";
  if (input.why === "Timeout") return "next";
  if (input.dataset === "une_rt_m" && input.httpStatus === 200 && input.pointCount === 0 && input.why == null) return "next";
  return "retry";
}

async function eurostat(dataset: string, query: string, geos: string[]): Promise<{ geo: string; points: DatedPoint[] }> {
  let uneEa20Empty = false;
  for (let index = 0; index < geos.length; index++) {
    const geo = geos[index];
    const url = `${EUROSTAT}/${dataset}?format=JSON&lang=en&geo=${geo}&${query}`;
    const result = await getTextResult(url);
    const why = eurostatWhy(result);
    const points = why ? [] : parseEurostatPoints(result.text);
    const next = geos[index + 1];
    const plan = eurostatAttemptPlan({
      pointCount: points.length,
      alreadyRetried: false,
      why,
      dataset,
      httpStatus: result.status,
      hasNext: Boolean(next),
    });
    if (plan === "use") {
      return { geo: labeledGeo(dataset, geo, uneEa20Empty), points };
    }
    if (plan === "next") {
      if (dataset === "une_rt_m" && geo === "EA20" && result.status === 200 && points.length === 0 && why == null) {
        uneEa20Empty = true;
        console.warn(`[RECESSION] Eurostat une_rt_m EA20 ohne Werte, keine Wiederholung${next ? `; Fallback ${next}` : ""}`);
      } else {
        console.warn(`[RECESSION] Eurostat ${dataset} ${geo} ${why ?? "ohne Punkte"}${why === "Timeout" ? ", keine zweite 20s-Frist" : ""}${next ? `; Fallback ${next}` : ""}`);
      }
      continue;
    }
    const again = await getTextResult(url, EUROSTAT_RETRY_MS);
    const againWhy = eurostatWhy(again);
    const againPoints = againWhy ? [] : parseEurostatPoints(again.text);
    if (eurostatAttemptPlan({
      pointCount: againPoints.length,
      alreadyRetried: true,
      why: againWhy,
      dataset,
      httpStatus: again.status,
      hasNext: Boolean(next),
    }) === "use") {
      console.warn(`[RECESSION] Eurostat ${dataset} ${geo} erste Antwort ${why ?? "ohne Punkte"}, Wiederholung ok`);
      return { geo: labeledGeo(dataset, geo, uneEa20Empty), points: againPoints };
    }
    console.warn(`[RECESSION] Eurostat ${dataset} ${geo} nach Wiederholung ${againWhy ?? why ?? "ohne Punkte"}; Fallback ${next}`);
  }
  return { geo: geos[0] ?? "", points: [] };
}

function labeledGeo(dataset: string, geo: string, uneEa20Empty: boolean): string {
  if (dataset === "une_rt_m" && geo === "EA21" && uneEa20Empty) return "EA21 (EA20 ohne Werte)";
  return geo;
}

function parseEurostatPoints(text: string): DatedPoint[] {
  try {
    return parseEurostatSeries(JSON.parse(text));
  } catch {
    return [];
  }
}

function latestFinite(points: DatedPoint[]): number | null {
  for (let i = points.length - 1; i >= 0; i--) {
    if (Number.isFinite(points[i].value)) return points[i].value;
  }
  return null;
}

async function indexPe(symbols: string[], signal?: AbortSignal): Promise<{ value: number; source: string } | null> {
  if (!process.env.FMP_API_KEY) return null;
  for (const symbol of symbols) {
    if (signal?.aborted) return null;
    try {
      const payload = await fmpRatiosTtm(symbol, signal);
      const row = Array.isArray(payload) ? payload[0] : payload;
      const pe = Number(row?.priceToEarningsRatioTTM ?? row?.peRatioTTM);
      if (Number.isFinite(pe) && pe > 0) return { value: pe, source: `FMP ${symbol} PE TTM` };
    } catch {
      continue;
    }
  }
  return null;
}

const EXSA_DATA_QUERY = "portfolioId=251931&component=fundamentalsAndRisk&targetSite=de-ishares-v2&locale=de_DE&userType=individual&appType=PRODUCT_PAGE&appSubType=ISHARES";
/** Same KGV block the product page embeds, without the 2.7MB document. */
const ISHARES_EXSA_DATA = [
  `https://www.blackrock.com/varnish-api/uk-retail01-product-data/product-data/api/v2/get-product-data?${EXSA_DATA_QUERY}`,
  `https://www.ishares.com/varnish-api/uk-retail01-product-data/product-data/api/v2/get-product-data?${EXSA_DATA_QUERY}`,
];
const ISHARES_EXSA = "https://www.ishares.com/de/privatanleger/de/produkte/251931/ishares-stoxx-europe-600-ucits-etf-de-fund";
const STOXX_PE_URLS = [...ISHARES_EXSA_DATA, ISHARES_EXSA];
const OECD_JP_IP = "https://api.db.nomics.world/v22/series/OECD/DSD_STES@DF_INDSERV/JPN.M.PRVM.IX.BTE.Y._Z._Z.N?observations=1";

const GERMAN_MONTH: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", mrz: "03", mär: "03", apr: "04",
  mai: "05", jun: "06", jul: "07", aug: "08", sep: "09", okt: "10",
  nov: "11", dez: "12",
};

function peInRange(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 80;
}

function compactDate(raw: string): string | null {
  if (!/^\d{8}$/.test(raw)) return null;
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return date;
}

/** Brace slice that stays inside strings, so a `}` in the KGV hint does not end the object. */
function objectSlice(text: string, open: number): string | null {
  let depth = 0;
  let quoted = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\\") { i += 1; continue; }
      if (ch === "\"") quoted = false;
      continue;
    }
    if (ch === "\"") { quoted = true; continue; }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return null;
}

function ratioFromBlock(block: string): { date: string; value: number } | null {
  const dateMatch = block.match(/"asOfDate"\s*:\s*"?(\d{8})"?/);
  if (!dateMatch) return null;
  const date = compactDate(dateMatch[1]);
  if (!date) return null;
  const formatted = block.match(/"formattedValue"\s*:\s*"([0-9]+(?:[.,][0-9]+)?)"/);
  const numeric = block.match(/"value"\s*:\s*(-?[0-9]+(?:\.[0-9]+)?)/);
  const formattedValue = formatted ? Number(formatted[1].replace(",", ".")) : NaN;
  const numericValue = numeric ? Number(numeric[1]) : NaN;
  const value = peInRange(formattedValue) ? formattedValue : numericValue;
  if (!peInRange(value)) return null;
  return { date, value };
}

/**
 * iShares EXSA KGV. The product-data JSON and the product page use the same
 * priceEarnings object. German pages print a decimal comma. Field order varies.
 * A page that only rendered the table still has the cell and „Per TT.Mon.JJJJ“.
 */
export function isharesPriceEarnings(html: string): { date: string; value: number } | null {
  if (!html) return null;
  const text = html.replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
  const marker = /"priceEarnings"\s*:\s*\{/g;
  let found: RegExpExecArray | null;
  while ((found = marker.exec(text))) {
    const block = objectSlice(text, found.index + found[0].length - 1);
    if (!block) continue;
    const ratio = ratioFromBlock(block);
    if (ratio) return ratio;
  }
  const valueMatch = text.match(/data-id="fundamentalsAndRisk-priceEarnings-data"[^>]*>\s*([0-9]+(?:[.,][0-9]+)?)\s*</);
  const dateMatch = text.match(/data-id="fundamentalsAndRisk-priceEarnings-asOf"[^>]*>\s*(?:Per\s+)?(\d{1,2})\.([A-Za-zÄÖÜäöü]{3})\.(\d{4})/);
  if (!valueMatch || !dateMatch) return null;
  const value = Number(valueMatch[1].replace(",", "."));
  const month = GERMAN_MONTH[dateMatch[2].toLowerCase()];
  const day = Number(dateMatch[1]);
  if (!month || day < 1 || day > 31 || !peInRange(value)) return null;
  return { date: `${dateMatch[3]}-${month}-${String(day).padStart(2, "0")}`, value };
}

/** DBnomics series.docs[0] period/value pairs. YYYY-MM becomes the month start. */
export function parseDbNomicsSeries(payload: unknown): DatedPoint[] {
  if (!payload || typeof payload !== "object") return [];
  const docs = (payload as { series?: { docs?: unknown[] } }).series?.docs;
  const doc = Array.isArray(docs) ? docs[0] : null;
  if (!doc || typeof doc !== "object") return [];
  const periods = (doc as { period?: unknown }).period;
  const values = (doc as { value?: unknown }).value;
  if (!Array.isArray(periods) || !Array.isArray(values)) return [];
  const points: DatedPoint[] = [];
  const n = Math.min(periods.length, values.length);
  for (let i = 0; i < n; i++) {
    const period = String(periods[i] ?? "");
    const value = typeof values[i] === "number" ? values[i] : Number(values[i]);
    if (!Number.isFinite(value)) continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(period)
      ? period
      : /^\d{4}-\d{2}$/.test(period)
        ? `${period}-01`
        : "";
    if (!date) continue;
    points.push({ date, value });
  }
  return points;
}

/** FRED label when OECD is not the newer series. A timeout is not described as an empty body. */
export function jpActivitySource(usedPrimary: boolean, oecdPointCount: number, failure?: "timeout" | "empty" | null): string {
  if (usedPrimary) return "OECD STES JPN.M.PRVM.IX.BTE.Y (DBnomics)";
  if (oecdPointCount > 0) return "FRED JPNPROINDMISMEI; OECD älter als FRED";
  if (failure === "timeout") return "FRED JPNPROINDMISMEI; OECD Zeitüberschreitung";
  return "FRED JPNPROINDMISMEI; OECD nach Wiederholung leer oder HTML";
}

/** Same rule as EA20: a 25s hang is not fetched again. Empty, HTTP and HTML get one 8s retry. */
export const OECD_RETRY_MS = 8000;

export function oecdAttemptPlan(why: string | null): "use" | "retry" | "stop" {
  if (why == null) return "use";
  if (why === "Timeout") return "stop";
  return "retry";
}

async function readOecdJpIp(url = OECD_JP_IP): Promise<{ text: string; failure: "timeout" | "empty" | null }> {
  const first = await getTextResult(url, 25000);
  const why = eurostatWhy(first);
  if (oecdAttemptPlan(why) === "use") return { text: first.text, failure: null };
  if (oecdAttemptPlan(why) === "stop") return { text: "", failure: "timeout" };
  const again = await getTextResult(url, OECD_RETRY_MS);
  const againWhy = eurostatWhy(again);
  if (oecdAttemptPlan(againWhy) === "use") return { text: again.text, failure: null };
  if (againWhy === "Timeout") return { text: "", failure: "timeout" };
  return { text: "", failure: "empty" };
}

/** The series whose last print is newer. An empty side loses. A tie keeps the primary. */
export function newerSeries(primary: DatedPoint[], fallback: DatedPoint[]): { points: DatedPoint[]; usedPrimary: boolean } {
  const last = (points: DatedPoint[]) => points.reduce((max, point) => point.date > max ? point.date : max, "");
  if (primary.length === 0) return { points: fallback, usedPrimary: false };
  if (fallback.length === 0) return { points: primary, usedPrimary: true };
  if (last(primary) >= last(fallback)) return { points: primary, usedPrimary: true };
  return { points: fallback, usedPrimary: false };
}

async function stoxxPe(today: string): Promise<{ value: number | null; source: string }> {
  const fmp = await indexPe(["^STOXX", "^SXXP", "EXSA.DE"]);
  if (fmp) return { value: fmp.value, source: fmp.source };
  for (const url of STOXX_PE_URLS) {
    const pe = isharesPriceEarnings(await getText(url, 25000, { "User-Agent": "Mozilla/5.0" }));
    if (!pe) continue;
    if (isStale(pe.date, today)) {
      return { value: null, source: `iShares EXSA KGV ${pe.date.slice(0, 7)} außerhalb des 18-Monats-Fensters` };
    }
    return { value: pe.value, source: `iShares EXSA KGV ${pe.date}` };
  }
  return { value: null, source: "STOXX 600 PE (FMP leer, iShares ohne KGV)" };
}

async function topixPe(): Promise<{ value: number | null; source: string }> {
  const fmp = await indexPe(["^TPX", "1306.T"]);
  if (fmp) return { value: fmp.value, source: fmp.source };
  return { value: null, source: "TOPIX/CAPE JP (FMP leer; JPX-PER nur xlsx)" };
}

export interface AshrPeProbe {
  pe: number | null;
  status: string;
  httpStatus: number | null;
  epsAsOf: string | null;
}

/**
 * ASHR KGV only. TOPIX stays on indexPe.
 * A positive FMP print wins. Yahoo is used only when FMP has none.
 * A dated Yahoo print older than the existing 18-month PE window (isStale, same rule as iShares EXSA) stays null.
 */
export function ashrPeFromProbes(input: {
  fmp: { value: number; source: string } | null;
  yahoo: AshrPeProbe | null;
  today: string;
  /** Set when the price handed to Yahoo came from an FMP close, not from Yahoo's chart. */
  priceSource?: "fmp";
}): { value: number | null; source: string } {
  if (input.fmp && Number.isFinite(input.fmp.value) && input.fmp.value > 0) {
    return { value: input.fmp.value, source: input.fmp.source };
  }
  const yahoo = input.yahoo;
  if (yahoo && yahoo.pe != null && Number.isFinite(yahoo.pe) && yahoo.pe > 0) {
    if (yahoo.epsAsOf && isStale(yahoo.epsAsOf, input.today)) {
      return { value: null, source: `n/a — Yahoo ASHR KGV ${yahoo.epsAsOf.slice(0, 7)} außerhalb des 18-Monats-Fensters` };
    }
    const asOf = yahoo.epsAsOf ?? "ohne Stichtag";
    const source = input.priceSource === "fmp"
      ? `Yahoo ASHR KGV (Kurs FMP, trailingDilutedEPS Yahoo, Stand ${asOf})`
      : `Yahoo ASHR KGV (Kurs/trailingDilutedEPS, Stand ${asOf})`;
    return { value: yahoo.pe, source };
  }
  const fmpWhy = input.fmp ? `FMP ${input.fmp.value} kein KGV` : "FMP leer";
  const yahooWhy = !yahoo
    ? "Yahoo nicht abgefragt"
    : yahoo.status === "http_error" && yahoo.httpStatus != null
      ? `Yahoo ASHR HTTP ${yahoo.httpStatus}`
      : `Yahoo ASHR ${yahoo.status}`;
  return { value: null, source: `n/a — ASHR KGV (${fmpWhy}; ${yahooWhy})` };
}

/** ASHR lists in US-$, same currency as BENCHMARK_REGIONS.CN in server/buffett-route.ts. */
const ASHR_LISTING_CURRENCY = "USD";
const ASIA_SUPPLEMENT_TIMEOUT_MS = 12000;
/** Inside the 12s block, so a hung FMP history still leaves time for the Yahoo closes. */
export const ASIA_FMP_TIMEOUT_MS = 5000;

export async function bounded<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, fallback: T): Promise<{ value: T; timedOut: boolean }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal).then(value => ({ value, timedOut: false })).catch(() => ({ value: fallback, timedOut: false })),
      new Promise<{ value: T; timedOut: boolean }>(resolve => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ value: fallback, timedOut: true });
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Same close fields as parseClose in server/recession-markets.ts. */
function closesFromPriceRows(raw: unknown): { date: string; close: number }[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: { date: string; close: number }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { date?: unknown; Date?: unknown; close?: unknown; adjClose?: unknown; price?: unknown };
    const date = String(rec.date || rec.Date || "").slice(0, 10);
    const close = Number(rec.close ?? rec.adjClose ?? rec.price);
    if (!date || !Number.isFinite(close) || !(close > 0)) continue;
    out.push({ date, close });
  }
  return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

/** „Kurs FMP“ only when the closes that produced lastClose came from FMP, not from the Yahoo chart. */
export function ashrPriceSource(via: "fmp" | "yahoo" | "none", lastClose: number | null): "fmp" | undefined {
  return via === "fmp" && lastClose != null && lastClose > 0 ? "fmp" : undefined;
}

async function ashrPe(
  today: string,
  lastClose: number | null,
  signal?: AbortSignal,
  inputPriceSource?: "fmp",
): Promise<{ value: number | null; source: string }> {
  const fmp = await indexPe(["ASHR"], signal);
  if (fmp) return ashrPeFromProbes({ fmp, yahoo: null, today });
  const priceSource = inputPriceSource;
  try {
    const yahoo = priceSource
      ? await fetchYahooTimeseriesFundamentals("ASHR", { price: lastClose, currency: ASHR_LISTING_CURRENCY, signal })
      : await fetchYahooTimeseriesFundamentals("ASHR", { signal });
    return ashrPeFromProbes({
      fmp: null,
      yahoo: { pe: yahoo.pe, status: yahoo.status, httpStatus: yahoo.httpStatus, epsAsOf: yahoo.asOf.eps },
      today,
      priceSource,
    });
  } catch (err) {
    return ashrPeFromProbes({
      fmp: null,
      yahoo: { pe: null, status: String((err as Error)?.message ?? err).slice(0, 160), httpStatus: null, epsAsOf: null },
      today,
      priceSource,
    });
  }
}

/** Last print of each calendar month, same rule as monthEndPoints in server/recession.ts. */
function monthEndPoints(points: DatedPoint[]): DatedPoint[] {
  const sorted = points
    .filter(point => point.date.length >= 7 && Number.isFinite(point.value))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const byMonth = new Map<string, DatedPoint>();
  for (const point of sorted) byMonth.set(point.date.slice(0, 7), point);
  return Array.from(byMonth.values());
}

/** Month-end realized vol. Same shared realizedVol20 the ASHR chart uses after FMP closes. */
export function ashrRealizedVolPoints(closes: { date: string; close: number }[]): DatedPoint[] {
  const sorted = closes
    .filter(bar => bar.date && Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return monthEndPoints(realizedVol20(sorted));
}

export async function loadAshrCloses(
  cosd: string,
  deps: {
    fmp: (signal: AbortSignal) => Promise<unknown>;
    yahoo: (signal: AbortSignal) => Promise<{ date: string; value: number }[]>;
    timeoutMs?: number;
    fmpTimeoutMs?: number;
    parent?: AbortSignal;
  },
): Promise<{ closes: { date: string; close: number }[]; via: "fmp" | "yahoo" | "none"; reason: "ok" | "timeout" | "empty" }> {
  const ms = deps.timeoutMs ?? ASIA_SUPPLEMENT_TIMEOUT_MS;
  const fmpMs = deps.fmpTimeoutMs ?? (deps.timeoutMs == null ? Math.min(ASIA_FMP_TIMEOUT_MS, ms) : ms);
  const link = (signal: AbortSignal) => deps.parent ? AbortSignal.any([signal, deps.parent]) : signal;
  if (deps.parent?.aborted) return { closes: [], via: "none", reason: "timeout" };
  const fmp = await bounded(async signal => closesFromPriceRows(await deps.fmp(link(signal))), fmpMs, []);
  if (!fmp.timedOut && ashrRealizedVolPoints(fmp.value).length > 0) {
    return { closes: fmp.value, via: "fmp", reason: "ok" };
  }
  if (deps.parent?.aborted) return { closes: [], via: "none", reason: "timeout" };
  const yahoo = await bounded(async signal => {
    const bars = await deps.yahoo(link(signal));
    return bars
      .filter(bar => bar.date && Number.isFinite(bar.value) && bar.value > 0)
      .map(bar => ({ date: bar.date, close: bar.value }));
  }, ms, []);
  if (!yahoo.timedOut && ashrRealizedVolPoints(yahoo.value).length > 0) {
    return { closes: yahoo.value, via: "yahoo", reason: "ok" };
  }
  if (fmp.timedOut || yahoo.timedOut) return { closes: [], via: "none", reason: "timeout" };
  return { closes: [], via: "none", reason: "empty" };
}

function chinaVolFromCloses(
  via: "fmp" | "yahoo" | "none",
  closes: { date: string; close: number }[],
  reason: "ok" | "timeout" | "empty",
): { points: DatedPoint[]; source: string } {
  const points = ashrRealizedVolPoints(closes);
  if (reason === "timeout" || points.length === 0 || via === "none") {
    const source = reason === "timeout"
      ? "n/a — ASHR-Vol Zeitüberschreitung"
      : "n/a — ASHR ohne Tagesschlüsse für realisierte Vol 20T (FMP leer; Yahoo leer)";
    return { points: [], source };
  }
  const source = via === "fmp"
    ? "FMP ASHR, realisierte Vol 20T annualisiert"
    : "Yahoo ASHR, realisierte Vol 20T annualisiert";
  return { points, source };
}

function yearsAgo(today: string, years: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

/** One retry. The CSV is real, and a burst of US fetches can drop the first response. */
async function ecbM3Yoy(): Promise<number | null> {
  const url = `${ECB_M3_YOY}?format=csvdata&startPeriod=2005-01&detail=dataonly`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await getText(url, 25000);
    const series = parseEcbCsv(text).sort((a, b) => a.period.localeCompare(b.period));
    if (series.length > 0) return series[series.length - 1].value;
  }
  return null;
}

export function emptyRegionalPrints(): RegionalPrints {
  return {
    ezUnemployment: { geo: "EA20", points: [] },
    ezLong: [],
    ezShort: [],
    ezIp: { geo: "EA20", points: [] },
    ezM3Yoy: null,
    ezHy: null,
    ezPe: null,
    ezPeSource: "STOXX 600 PE (FMP leer, iShares ohne KGV)",
    ezVol: null,
    jpUnemployment: [],
    jpLong: [],
    jpIp: [],
    jpIpSource: "FRED JPNPROINDMISMEI",
    jpM2Yoy: null,
    jpPe: null,
    jpPeSource: "TOPIX/CAPE JP (FMP leer; JPX-PER nur xlsx)",
    jpVol: null,
    cnVolPoints: [],
    cnVolSource: "n/a — ASHR ohne Tagesschlüsse für realisierte Vol 20T (FMP leer; Yahoo leer)",
    cnPe: null,
    cnPeSource: "n/a — ASHR KGV (FMP leer)",
    jpGdpUsd: null,
    cnGdpUsd: null,
    jpGdpSource: `n/a — FRED ${ASIA_GDP_USD.JP} leer`,
    cnGdpSource: `n/a — FRED ${ASIA_GDP_USD.CN} leer`,
  };
}

async function gdpUsd(id: string, signal?: AbortSignal): Promise<{ value: number | null; source: string }> {
  const points = await fred(id, "1990-01-01", signal);
  const value = latestFinite(points);
  if (value == null || !(value > 0)) return { value: null, source: `n/a — FRED ${id} leer` };
  const dated = [...points].reverse().find(point => point.value > 0);
  const year = dated?.date.slice(0, 4) ?? "";
  return { value, source: `FRED ${id} ${year}`.trim() };
}

/** Eurostat, OECD, FRED, ECB, BoJ, STOXX and TOPIX. Same calls as main, without ASHR or the GDP weights. */
async function fetchLegacyRegionalPrints(today: string): Promise<RegionalPrints> {
  const cosd = yearsAgo(today, 20);
  const bojStart = yearsAgo(today, 20).slice(0, 4) + yearsAgo(today, 20).slice(5, 7);
  const [ezUnemployment, ezIp, ezLong, ezShort, ezHyPoints, jpUnemployment, jpLong, jpIpFred, oecdIpText, ezM3Yoy, bojText, ezPe, jpPe, vstoxx] = await Promise.all([
    eurostat("une_rt_m", "s_adj=SA&age=TOTAL&unit=PC_ACT&sex=T&sinceTimePeriod=2005-01", ["EA20", "EA21"]),
    eurostat("sts_inpr_m", "s_adj=SCA&nace_r2=B-D&unit=I21&sinceTimePeriod=2005-01", ["EA20", "EA21"]),
    fred("IRLTLT01EZM156N", cosd),
    fred("IR3TIB01EZM156N", cosd),
    fred("BAMLHE00EHYIOAS", cosd),
    fred("LRUNTTTTJPM156S", cosd),
    fred("IRLTLT01JPM156N", cosd),
    fred("JPNPROINDMISMEI", cosd),
    readOecdJpIp(OECD_JP_IP),
    ecbM3Yoy(),
    getText(`https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD02&code=${BOJ_M2_YOY}&startDate=${bojStart}`),
    stoxxPe(today),
    topixPe(),
    fetchVstoxxVol(cosd, today).catch(() => ({ vol: [] as { date: string; value: number }[] })),
  ]);
  let oecdIp: DatedPoint[] = [];
  if (oecdIpText.text && !oecdIpText.text.includes("<html")) {
    try {
      oecdIp = parseDbNomicsSeries(JSON.parse(oecdIpText.text));
    } catch {
      oecdIp = [];
    }
  }
  const jpIpPick = newerSeries(oecdIp, jpIpFred);
  if (!jpIpPick.usedPrimary) {
    const why = oecdIp.length > 0
      ? "OECD älter als FRED, keine Wiederholung"
      : oecdIpText.failure === "timeout"
        ? "OECD Zeitüberschreitung, keine zweite 25s-Frist"
        : "OECD nach Wiederholung leer oder HTML";
    console.warn(`[RECESSION] ${why}; Fallback JPNPROINDMISMEI`);
  }
  const m2 = parseBojSeries(bojText, BOJ_M2_YOY);
  const vol = [...vstoxx.vol].sort((a, b) => a.date.localeCompare(b.date));
  return {
    ezUnemployment,
    ezLong,
    ezShort,
    ezIp,
    ezM3Yoy,
    ezHy: latestFinite(ezHyPoints),
    ezPe: ezPe.value,
    ezPeSource: ezPe.source,
    ezVol: vol.length ? vol[vol.length - 1].value : null,
    jpUnemployment,
    jpLong,
    jpIp: jpIpPick.points,
    jpIpSource: jpActivitySource(jpIpPick.usedPrimary, oecdIp.length, oecdIpText.failure),
    jpM2Yoy: m2.length ? m2[m2.length - 1].value : null,
    jpPe: jpPe.value,
    jpPeSource: jpPe.source,
    jpVol: null,
    cnVolPoints: [],
    cnVolSource: "n/a — ASHR ohne Tagesschlüsse für realisierte Vol 20T (FMP leer; Yahoo leer)",
    cnPe: null,
    cnPeSource: "n/a — ASHR KGV (FMP leer)",
    jpGdpUsd: null,
    cnGdpUsd: null,
    jpGdpSource: `n/a — FRED ${ASIA_GDP_USD.JP} leer`,
    cnGdpSource: `n/a — FRED ${ASIA_GDP_USD.CN} leer`,
  };
}

type AsiaSupplement = Pick<RegionalPrints, "cnVolPoints" | "cnVolSource" | "cnPe" | "cnPeSource" | "jpGdpUsd" | "cnGdpUsd" | "jpGdpSource" | "cnGdpSource">;

/** A failed ASHR/GDP load leaves the legacy EZ/JP prints untouched. */
export function applyAsiaSupplement(legacy: RegionalPrints, asia: AsiaSupplement | null): RegionalPrints {
  if (!asia) {
    return {
      ...legacy,
      cnVolPoints: [],
      cnVolSource: "n/a — ASHR-Vol nicht geladen",
      cnPe: null,
      cnPeSource: "n/a — ASHR KGV nicht geladen",
      jpGdpUsd: null,
      cnGdpUsd: null,
      jpGdpSource: `n/a — FRED ${ASIA_GDP_USD.JP} nicht geladen`,
      cnGdpSource: `n/a — FRED ${ASIA_GDP_USD.CN} nicht geladen`,
    };
  }
  return { ...legacy, ...asia };
}

const ASIA_BLOCK_MS = 12000;

function asiaTimeoutSupplement(): AsiaSupplement {
  return {
    cnVolPoints: [],
    cnVolSource: "n/a — ASHR-Vol Zeitüberschreitung",
    cnPe: null,
    cnPeSource: "n/a — ASHR KGV Zeitüberschreitung",
    jpGdpUsd: null,
    cnGdpUsd: null,
    jpGdpSource: `n/a — FRED ${ASIA_GDP_USD.JP} Zeitüberschreitung`,
    cnGdpSource: `n/a — FRED ${ASIA_GDP_USD.CN} Zeitüberschreitung`,
  };
}

function snapshotAsia(partial: AsiaSupplement): AsiaSupplement {
  return { ...partial, cnVolPoints: partial.cnVolPoints.slice() };
}

export interface AsiaRuntimeDeps {
  pe?: (today: string, lastClose: number | null, signal: AbortSignal, priceSource?: "fmp") => Promise<{ value: number | null; source: string }>;
  gdp?: (id: string, signal: AbortSignal) => Promise<{ value: number | null; source: string }>;
}

async function buildAsiaSupplement(
  today: string,
  parent: AbortSignal,
  load: typeof loadAshrCloses,
  partial: AsiaSupplement,
  fields?: AsiaRuntimeDeps,
): Promise<AsiaSupplement> {
  const cosd = yearsAgo(today, 20);
  const gdp = fields?.gdp ?? gdpUsd;
  const linked = (signal: AbortSignal) => AbortSignal.any([signal, parent]);
  const writeGdp = (id: string, assign: (value: { value: number | null; source: string }) => void) => bounded(
    signal => gdp(id, linked(signal)),
    ASIA_SUPPLEMENT_TIMEOUT_MS,
    { value: null, source: `n/a — FRED ${id} Zeitüberschreitung` },
  ).then(result => {
    if (parent.aborted) return;
    assign(result.value);
  });
  const gdpDone = Promise.all([
    writeGdp(ASIA_GDP_USD.JP, value => {
      partial.jpGdpUsd = value.value;
      partial.jpGdpSource = value.source;
    }),
    writeGdp(ASIA_GDP_USD.CN, value => {
      partial.cnGdpUsd = value.value;
      partial.cnGdpSource = value.source;
    }),
  ]);
  const loaded = await load(cosd, {
    fmp: signal => fmpHistoricalPrices("ASHR", cosd, today, signal),
    yahoo: signal => fetchYahooDailySeries("ASHR", cosd, signal),
    parent,
  });
  if (parent.aborted) return snapshotAsia(partial);
  const lastClose = loaded.closes.length ? loaded.closes[loaded.closes.length - 1].close : null;
  const vol = chinaVolFromCloses(loaded.via, loaded.closes, loaded.reason);
  partial.cnVolPoints = vol.points;
  partial.cnVolSource = vol.source;
  if (parent.aborted) return snapshotAsia(partial);
  const priceSource = ashrPriceSource(loaded.via, lastClose);
  const pe = fields?.pe ?? ashrPe;
  await Promise.all([
    bounded(signal => pe(today, lastClose, linked(signal), priceSource), ASIA_SUPPLEMENT_TIMEOUT_MS, { value: null, source: "n/a — ASHR KGV Zeitüberschreitung" }).then(result => {
      if (parent.aborted) return;
      partial.cnPe = result.value.value;
      partial.cnPeSource = result.value.source;
    }),
    gdpDone,
  ]);
  return snapshotAsia(partial);
}

/** One deadline for the whole ASHR/GDP block. Finished fields stay; only open fields keep the timeout reason. */
export async function runAsiaSupplement(
  today: string,
  timeoutMs = ASIA_BLOCK_MS,
  load: typeof loadAshrCloses = loadAshrCloses,
  fields?: AsiaRuntimeDeps,
): Promise<AsiaSupplement> {
  const partial = asiaTimeoutSupplement();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      buildAsiaSupplement(today, controller.signal, load, partial, fields),
      new Promise<AsiaSupplement>(resolve => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(snapshotAsia(partial));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fetchRegionalPrints(today = new Date().toISOString().slice(0, 10)): Promise<RegionalPrints> {
  const legacy = await fetchLegacyRegionalPrints(today);
  let asia: AsiaSupplement | null = null;
  try {
    asia = await runAsiaSupplement(today);
  } catch {
    asia = null;
  }
  return applyAsiaSupplement(legacy, asia);
}

function fromReading(id: RegionSlot["id"], name: string, book: RegionSlot["book"], source: string, reading: ScoredReading, value?: string): RegionSlot {
  if (reading.available === false || !Number.isFinite(reading.rawScore)) {
    return closedSlot(id, name, book, source, value ?? reading.value ?? "N/A");
  }
  return {
    id,
    name,
    book,
    value: value ?? reading.value,
    rawScore: reading.rawScore,
    weight: reading.weight,
    weightedScore: reading.weightedScore,
    maxWeighted: reading.maxWeighted,
    zone: reading.zone,
    source,
    available: true,
  };
}

function activitySlot(name: string, source: string, points: DatedPoint[], today: string, score: RegionScorers["activity"]): RegionSlot {
  if (points.length === 0) return closedSlot("activity", name, "recession", source);
  const last = [...points].sort((a, b) => a.date < b.date ? -1 : 1).at(-1)!;
  const yoy = yoyByMonth(points);
  if (isStale(last.date, today) || !Number.isFinite(yoy)) {
    return closedSlot("activity", name, "recession", source, `${last.value.toFixed(1)} (${last.date.slice(0, 7)})`);
  }
  const scored = score(yoy);
  return {
    id: "activity",
    name,
    book: "recession",
    value: `YoY ${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}% (${last.date.slice(0, 7)})`,
    rawScore: scored.rawScore,
    weight: 1,
    weightedScore: scored.rawScore,
    maxWeighted: 3,
    zone: scored.zone,
    source,
    available: true,
  };
}

function curveSlot(
  name: string,
  source: string,
  points: DatedPoint[],
  stressWhenLow: boolean,
  score: RegionScorers["curve"],
): RegionSlot {
  const snapshot = levelAndDelta(points);
  if (!snapshot) return closedSlot("curve", name, "recession", source);
  const delta = snapshot.delta == null ? "n/a" : `${snapshot.delta > 0 ? "+" : ""}${snapshot.delta.toFixed(2)} pp`;
  const value = `${snapshot.level.toFixed(2)}% · 12M Δ ${delta}`;
  const scored = score(points.map(point => point.value), stressWhenLow);
  if (!scored.available) return { ...closedSlot("curve", name, "recession", source, value), zone: "keine 20J-Historie" };
  return {
    id: "curve",
    name,
    book: "recession",
    value,
    rawScore: scored.raw,
    weight: 1,
    weightedScore: scored.raw,
    maxWeighted: 4,
    zone: stressWhenLow ? "Spread s(z)" : "Niveau s(z)",
    source,
    available: true,
  };
}

function naValue(source: string): string {
  return source.startsWith("n/a —") ? source : "N/A";
}

function chinaVolSlot(prints: RegionalPrints, scorers: RegionScorers): RegionSlot {
  const source = prints.cnVolSource || "n/a — Yahoo ASHR ohne Tagesschlüsse für realisierte Vol 20T";
  const points = monthEndPoints(prints.cnVolPoints);
  const latest = points.at(-1);
  if (!latest) return closedSlot("vol", "Vol China (ASHR)", "correction", source, naValue(source));
  const scored = scorers.curve(points.map(point => point.value), false);
  if (!scored.available) {
    return closedSlot(
      "vol",
      "Vol China (ASHR)",
      "correction",
      source,
      `n/a — ASHR-Vol: ${points.length} Monate, Historie für s(z) reicht nicht`,
    );
  }
  return {
    id: "vol",
    name: "Vol China (ASHR)",
    book: "correction",
    value: `${latest.value.toFixed(1)}% · 20T · ${latest.date.slice(0, 7)}`,
    rawScore: scored.raw,
    weight: 1,
    weightedScore: scored.raw,
    maxWeighted: 4,
    zone: "Niveau s(z)",
    source,
    available: true,
  };
}

function chinaPeSlot(prints: RegionalPrints, scorers: RegionScorers): RegionSlot {
  const source = prints.cnPeSource || "n/a — ASHR KGV (FMP leer)";
  if (prints.cnPe == null || !(Number.isFinite(prints.cnPe) && prints.cnPe > 0)) {
    return closedSlot("valuation", "KGV China (ASHR)", "correction", source, naValue(source));
  }
  return fromReading("valuation", "KGV China (ASHR)", "correction", source, scorers.valuation(prints.cnPe), prints.cnPe.toFixed(1));
}

function bookLive(weight: number | null, slots: RegionSlot[], book: RegionSlot["book"]): boolean {
  return weight != null && weight > 0 && catalogProbability(slots, book) != null;
}

/** A scored print whose side does not enter this book stays visible, but not as a driver of the headline P. */
function slotsInMix(slots: RegionSlot[], weight: number | null): RegionSlot[] {
  const recession = bookLive(weight, slots, "recession");
  const correction = bookLive(weight, slots, "correction");
  return slots.map(slot => {
    const live = slot.book === "recession" ? recession : correction;
    if (live || !slot.available) return slot;
    return {
      ...slot,
      available: false,
      weight: 0,
      weightedScore: 0,
      maxWeighted: 0,
      zone: "nicht in der Katalog-P",
    };
  });
}

function asiaNote(gdp: AsiaGdpWeights, jp: RegionSlot[], cn: RegionSlot[]): string {
  const parts = [
    "Japan + China (ASHR). Japan-KGV bleibt TOPIX, China-Vol und China-KGV sind ASHR.",
    gdp.text,
  ];
  const books: Array<RegionSlot["book"]> = ["recession", "correction"];
  for (const book of books) {
    const label = book === "recession" ? "Rezession" : "Korrektur";
    const jpLive = bookLive(gdp.jp.weight, jp, book);
    const cnLive = bookLive(gdp.cn.weight, cn, book);
    if (jpLive && cnLive) {
      parts.push(`${label}: Japan und China in der Katalog-P.`);
      continue;
    }
    if (!jpLive && !cnLive) {
      parts.push(`${label}: keine Seite in der Katalog-P.`);
      continue;
    }
    parts.push(`${label}: ${jpLive ? "China" : "Japan"} nicht in der Katalog-P.`);
  }
  return parts.join(" ");
}

function region(id: RegionCatalog["id"], label: string, slots: RegionSlot[]): RegionCatalog {
  return {
    id,
    label,
    weight: REGION_WEIGHT[id],
    slots,
    recessionProbability: catalogProbability(slots, "recession"),
    correctionProbability: catalogProbability(slots, "correction"),
  };
}

export function scoreRegionalCatalogs(input: ScoreInput): RegionalCatalogs {
  const { prints, scorers, today } = input;
  const ezRates = prints.ezUnemployment.points.map(point => point.value);
  const ezLaborSource = prints.ezUnemployment.points.length
    ? `Eurostat une_rt_m ${prints.ezUnemployment.geo}`
    : "Eurostat une_rt_m EA20";
  const ezSpread = alignSpread(prints.ezLong, prints.ezShort);
  const ezIpSource = prints.ezIp.points.length
    ? `Eurostat sts_inpr_m ${prints.ezIp.geo} I21`
    : "Eurostat sts_inpr_m";
  const ez: RegionSlot[] = [
    laborSlot("ALQ Eurozone", ezLaborSource, sahmGapPp(ezRates)),
    curveSlot("Kurve EZ (10J−3M)", "FRED IRLTLT01EZM156N − IR3TIB01EZM156N", ezSpread, true, scorers.curve),
    activitySlot("Aktivität EZ", ezIpSource, prints.ezIp.points, today, scorers.activity),
    prints.ezM3Yoy == null
      ? closedSlot("money", "Geld EZ M3", "recession", "ECB BSI.M.U2.Y.V.M30")
      : fromReading("money", "Geld EZ M3", "recession", "ECB BSI.M.U2.Y.V.M30", scorers.money(prints.ezM3Yoy), `${prints.ezM3Yoy.toFixed(1)}%`),
    prints.ezHy == null
      ? closedSlot("spreads", "Spreads EZ HY", "recession", "FRED BAMLHE00EHYIOAS")
      : fromReading("spreads", "Spreads EZ HY", "recession", "FRED BAMLHE00EHYIOAS", scorers.credit(prints.ezHy), `${prints.ezHy.toFixed(2)}%`),
    prints.ezPe == null
      ? closedSlot("valuation", "STOXX 600 PE", "correction", prints.ezPeSource)
      : fromReading("valuation", "STOXX 600 PE", "correction", prints.ezPeSource, scorers.valuation(prints.ezPe), prints.ezPe.toFixed(1)),
    prints.ezVol == null
      ? closedSlot("vol", "VSTOXX", "correction", "STOXX V2TX")
      : fromReading("vol", "VSTOXX", "correction", "STOXX V2TX", scorers.vol(prints.ezVol), prints.ezVol.toFixed(1)),
  ];
  const jp: RegionSlot[] = [
    laborSlot("ALQ Japan", "FRED LRUNTTTTJPM156S", sahmGapPp(prints.jpUnemployment.map(point => point.value))),
    curveSlot("Kurve JP 10J", "FRED IRLTLT01JPM156N", prints.jpLong, false, scorers.curve),
    activitySlot("Aktivität JP", prints.jpIpSource || "FRED JPNPROINDMISMEI", prints.jpIp, today, scorers.activity),
    prints.jpM2Yoy == null
      ? closedSlot("money", "Geld JP M2", "recession", "BoJ M2")
      : fromReading("money", "Geld JP M2", "recession", "BoJ M2", scorers.money(prints.jpM2Yoy), `${prints.jpM2Yoy.toFixed(1)}%`),
    closedSlot("spreads", "Spreads JP", "recession", "JGB-Corp (keine freie OAS-Serie)"),
    prints.jpPe == null
      ? closedSlot("valuation", "TOPIX/CAPE JP", "correction", prints.jpPeSource)
      : fromReading("valuation", "TOPIX/CAPE JP", "correction", prints.jpPeSource, scorers.valuation(prints.jpPe), prints.jpPe.toFixed(1)),
    prints.jpVol == null
      ? closedSlot("vol", "JNVI", "correction", "JNVI (keine freie Serie)")
      : fromReading("vol", "JNVI", "correction", "JNVI", scorers.vol(prints.jpVol), prints.jpVol.toFixed(1)),
  ];
  const cn: RegionSlot[] = [
    chinaVolSlot(prints, scorers),
    chinaPeSlot(prints, scorers),
  ];
  const gdp = asiaGdpWeights({
    jp: { gdpUsd: prints.jpGdpUsd, source: prints.jpGdpSource },
    cn: { gdpUsd: prints.cnGdpUsd, source: prints.cnGdpSource },
  });
  const peerWeight = (weight: number | null) => weight != null && weight > 0 ? weight : Number.NaN;
  const recessionProbability = blendWeighted([
    { weight: peerWeight(gdp.jp.weight), probability: catalogProbability(jp, "recession") },
    { weight: peerWeight(gdp.cn.weight), probability: catalogProbability(cn, "recession") },
  ]);
  const correctionProbability = blendWeighted([
    { weight: peerWeight(gdp.jp.weight), probability: catalogProbability(jp, "correction") },
    { weight: peerWeight(gdp.cn.weight), probability: catalogProbability(cn, "correction") },
  ]);
  const us = region("US", "USA", input.usSlots);
  const euro = region("EZ", "Eurozone", ez);
  const asia = region("JP", "Asien", [...slotsInMix(jp, gdp.jp.weight), ...slotsInMix(cn, gdp.cn.weight)]);
  asia.recessionProbability = recessionProbability;
  asia.correctionProbability = correctionProbability;
  asia.note = asiaNote(gdp, jp, cn);
  return {
    weights: { ...REGION_WEIGHT },
    regions: [us, euro, asia],
    blendedRecession12m: blendWeighted([
      { weight: REGION_WEIGHT.US, probability: input.usRecession12m },
      { weight: REGION_WEIGHT.EZ, probability: euro.recessionProbability },
      { weight: REGION_WEIGHT.JP, probability: asia.recessionProbability },
    ]),
    blendedCorrection12m: blendWeighted([
      { weight: REGION_WEIGHT.US, probability: input.usCorrection12m },
      { weight: REGION_WEIGHT.EZ, probability: euro.correctionProbability },
      { weight: REGION_WEIGHT.JP, probability: asia.correctionProbability },
    ]),
    actionUsesUsBooks: true,
  };
}

export function usSlotsFromIndicators(indicators: Array<{
  name: string;
  group: "recession" | "correction";
  value: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  maxWeighted: number;
  zone: string;
  source: string;
  available?: boolean;
}>): RegionSlot[] {
  const pick = (id: RegionSlot["id"], nameIncludes: string): RegionSlot | null => {
    const found = indicators.find(indicator => indicator.name.includes(nameIncludes));
    if (!found) return null;
    const available = found.available !== false && found.maxWeighted > 0;
    return {
      id,
      name: found.name,
      book: found.group,
      value: found.value,
      rawScore: found.rawScore,
      weight: available ? found.weight : 0,
      weightedScore: available ? found.weightedScore : 0,
      maxWeighted: available ? found.maxWeighted : 0,
      zone: found.zone,
      source: found.source,
      available,
    };
  };
  return [
    pick("labor", "Sahm"),
    pick("curve", "Zinskurve"),
    pick("activity", "Aktivität"),
    pick("money", "M2"),
    pick("spreads", "Kredit"),
    pick("valuation", "Buffett"),
    pick("valuation", "CAPE"),
    pick("vol", "VIX"),
  ].filter((slot): slot is RegionSlot => slot != null);
}
