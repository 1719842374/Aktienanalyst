import type { Express } from "express";
import { execSync } from "child_process";
import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { fetchMacroSnapshot } from "./fmp-macro";
import { riskLevelPhrase } from "../shared/risk-level-label";
import { marginYoYAndZ } from "../shared/recession-market-charts";
import {
  euroAreaUnemploymentFromEurostat,
  sahmIndicatorFromScore,
  scoreSahmFromUnemployment,
  SAHM_HISTORY_YEARS,
  type EurostatDataset,
  type SahmUnemploymentScore,
} from "./recession-sahm";
import { fetchBridge, shockGeopoliticsSection, type RecessionBridge } from "./recession-bridge";
import { driverFazitSections, loadDriverAssessment, type DriverView } from "./recession-drivers";
import { diskBriefingUpdatedAt } from "./disk-cache";
import { sOfZ } from "./fiscal-frontend-math";
import { emptyRegionalPrints, fetchRegionalPrints, scoreRegionalCatalogs, usSlotsFromIndicators } from "./recession-regions";
import { isStale, type RegionalCatalogs } from "../shared/recession-regions";
import { WILSHIRE_DOLLARS_PER_POINT_BN } from "./buffett-route";

// ============================================================
// Generic Data Helpers
// ============================================================

function fetchUrl(url: string, timeoutMs = 20000, headers: Record<string, string> = {}): string {
  try {
    // No default headers — some servers (FRED) HTTP/2-fail when extra headers
    // are sent. Callers that need a UA pass it explicitly via the headers arg.
    const headerArgs = Object.entries(headers)
      .map(([k, v]) => `-H "${k}: ${v.replace(/"/g, "\\\"")}"`)
      .join(" ");
    return execSync(`curl -sL --max-time ${Math.floor(timeoutMs / 1000)} ${headerArgs} "${url}"`, {
      encoding: "utf-8",
      timeout: timeoutMs + 5000,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

/** Generic FRED CSV fetcher — returns latest value or NaN */
function getLatestFredValue(seriesId: string): number {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${getDateNMonthsAgo(24)}`;
  const csv = fetchUrl(url);
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return NaN;
  const lines = csv.trim().split("\n").slice(1);
  const validLines = lines.filter(l => {
    const val = l.split(",")[1]?.trim();
    return val && val !== "." && !isNaN(parseFloat(val));
  });
  if (validLines.length === 0) return NaN;
  return parseFloat(validLines[validLines.length - 1].split(",")[1].trim());
}

/** Generic FRED CSV fetcher — returns all observations */
function fetchFredSeries(seriesId: string): { date: string; value: number }[] {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${getDateNMonthsAgo(36)}`;
  const csv = fetchUrl(url);
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
  const lines = csv.trim().split("\n").slice(1);
  return lines
    .map(line => {
      const [date, valStr] = line.split(",");
      const value = parseFloat(valStr?.trim());
      return { date: date?.trim(), value };
    })
    .filter(o => !isNaN(o.value));
}

function getDateNMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().split("T")[0];
}

function getDateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().split("T")[0];
}

function readJson(text: string): unknown {
  if (!text || text.includes("<html") || text.includes("<!DOCTYPE")) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const MONTH_ABBR: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** "Oct 2, 2026" → 2026-10-02. Anything else is not a date. */
export function englishLongDate(text: string): string | null {
  const match = text.trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!match) return null;
  const month = MONTH_ABBR[match[1]];
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) return null;
  return `${match[3]}-${month}-${String(day).padStart(2, "0")}`;
}

function htmlCell(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** FRED CSV rows for one series, keeping gaps as null so the cleaner can drop them. */
function fetchFredRows(seriesId: string, cosd: string): Array<{ date: string; value: number | null }> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${cosd}`;
  const csv = fetchUrl(url);
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
  return csv.trim().split("\n").slice(1).flatMap(line => {
    const [date, valStr] = line.split(",");
    const trimmedDate = date?.trim() ?? "";
    if (!trimmedDate) return [];
    const raw = valStr?.trim() ?? "";
    const parsed = raw === "" || raw === "." ? null : Number(raw);
    const value = parsed != null && Number.isFinite(parsed) ? parsed : null;
    return [{ date: trimmedDate, value }];
  });
}

/** Generic macro data fetcher via FRED (see server/fmp-macro.ts) */
async function getMacroValue(keywords: string[], country = "United States"): Promise<{ value: number; date: string; category: string } | null> {
  try {
    const result = await fetchMacroSnapshot({ countries: [country], keywords });
    if (!result?.content) return null;
    // Parse the markdown table to extract latest_value
    const lines = result.content.split("\n");
    for (const line of lines) {
      if (line.startsWith("|") && !line.includes("country") && !line.includes("---")) {
        const cells = line.split("|").map((c: string) => c.trim()).filter(Boolean);
        if (cells.length >= 4) {
          const category = cells[1];
          const value = parseFloat(cells[2]);
          const date = cells[3];
          if (!isNaN(value)) return { value, date, category };
        }
      }
    }
  } catch {}
  return null;
}

/** Extract first number matching a pattern from HTML */
function extractNumberFromHtml(html: string, pattern: RegExp): number {
  const match = html.match(pattern);
  if (match) return parseFloat(match[1].replace(/,/g, ""));
  return NaN;
}

// ============================================================
// Indicator types
// ============================================================

export interface IndicatorResult {
  name: string;
  group: "recession" | "correction";
  subgroup: string;
  value: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  maxWeighted: number;
  zone: string;
  source: string;
  description: string;
  /**
   * False: the slot is not in the net or the max.
   * Sahm sets this when fewer than 24 months are available.
   * The unemployment backup is scored with s(z) once that history exists.
   * A missing print on any other slot does the same. Absent means the slot is scored.
   */
  available?: boolean;
  /** Crypto Fear & Greed and the single VIX substitute are a flag, not a second CNN score. */
  proxy?: boolean;
}

// ============================================================
// RECESSION INDICATORS (7)
// ============================================================

export interface SahmRegionBoard {
  region: "US" | "EZ" | "JP";
  label: string;
  source: string;
  value: string;
  zone: string;
  level: number | null;
  s: number;
  raw: number;
  available: boolean;
  triggered: boolean;
  n: number;
  /** US realtime control. Absent for regions that have no realtime series. */
  controlOk?: boolean;
  control?: Array<{ date: string; computed: number | null; fred: number; absDiff: number | null }>;
  computedLevel: number | null;
  computedS: number;
  computedRaw: number;
  computedAvailable: boolean;
  computedValue: string;
}

// 1. Sahm Rule. The card shows the realtime print and s(z) of that series.
// A blank unemployment month is not filled. The self-computed S is scored
// with the same s(z), and it is the card only when the realtime series is
// absent. The 0.50pp mark is the trigger on the displayed level.
function scoreSahm(): { indicator: IndicatorResult; evaluated: SahmUnemploymentScore } {
  const cosd = getDateYearsAgo(SAHM_HISTORY_YEARS);
  const evaluated = scoreSahmFromUnemployment(
    fetchFredRows("UNRATE", cosd),
    fetchFredRows("SAHMREALTIME", cosd),
  );
  const scored = sahmIndicatorFromScore(evaluated.score);
  const base = "3-Monats-Durchschnitt der Arbeitslosenquote vs. 12-Monats-Tief";
  return {
    evaluated,
    indicator: {
      name: "Sahm-Regel",
      group: "recession", subgroup: "coincident",
      value: scored.value,
      rawScore: scored.rawScore,
      weight: scored.weight,
      weightedScore: scored.weightedScore,
      maxWeighted: scored.maxWeighted,
      zone: scored.zone,
      source: evaluated.score.backup ? "FRED UNRATE" : "FRED SAHMREALTIME",
      description: scored.reason ? `${base}. ${scored.reason}` : base,
      available: scored.available,
    },
  };
}

/** ALQ dataflow. The euro-area geo is resolved from the dataset, not a ticker. */
const EURO_AREA_UNEMPLOYMENT_DATAFLOW = "une_rt_m";

function fetchEuroAreaUnemployment(cosd: string): { geo: string | null; rows: Array<{ date: string; value: number | null }> } {
  const start = cosd.slice(0, 7);
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${EURO_AREA_UNEMPLOYMENT_DATAFLOW}?lang=en&s_adj=SA&age=TOTAL&unit=PC_ACT&sex=T&sinceTimePeriod=${start}`;
  const raw = fetchUrl(url, 30000);
  if (!raw || raw.includes("<html") || raw.includes("<!DOCTYPE")) return { geo: null, rows: [] };
  try {
    return euroAreaUnemploymentFromEurostat(JSON.parse(raw) as EurostatDataset);
  } catch {
    return { geo: null, rows: [] };
  }
}

function sahmRegionBoard(
  region: SahmRegionBoard["region"],
  label: string,
  source: string,
  evaluated: SahmUnemploymentScore,
  withControl: boolean,
): SahmRegionBoard {
  const card = sahmIndicatorFromScore(evaluated.score);
  const computed = sahmIndicatorFromScore(evaluated.computedScore);
  return {
    region,
    label,
    source,
    value: card.value,
    zone: card.zone,
    level: evaluated.score.level,
    s: evaluated.score.s,
    raw: evaluated.score.raw,
    available: evaluated.score.available,
    triggered: evaluated.score.triggered,
    n: evaluated.score.n,
    controlOk: withControl ? evaluated.controlOk : undefined,
    control: withControl ? evaluated.control : undefined,
    computedLevel: evaluated.computedScore.level,
    computedS: evaluated.computedScore.s,
    computedRaw: evaluated.computedScore.raw,
    computedAvailable: evaluated.computedScore.available,
    computedValue: computed.value,
  };
}

function scoreEuroAreaSahm(cosd: string): SahmRegionBoard {
  const loaded = fetchEuroAreaUnemployment(cosd);
  const source = loaded.geo ? `Eurostat une_rt_m ${loaded.geo}` : "Eurostat une_rt_m";
  return sahmRegionBoard("EZ", "Eurozone", source, scoreSahmFromUnemployment(loaded.rows, []), false);
}

function scoreJapanSahm(cosd: string): SahmRegionBoard {
  return sahmRegionBoard(
    "JP",
    "Japan",
    "FRED LRUNTTTTJPM156S",
    scoreSahmFromUnemployment(fetchFredRows("LRUNTTTTJPM156S", cosd), []),
    false,
  );
}

// 2. Yield curve. s(z) over 20 years of T10Y2Y. The zero line is only the label.
// T10Y3M is the extra tenor. The 12-month change is shown beside the level.
function scoreYieldCurve(): IndicatorResult {
  const rows = fetchFredRows("T10Y2Y", getDateYearsAgo(20));
  const points = rows.flatMap(row => row.value == null ? [] : [{ date: row.date, value: row.value }]);
  const t10y3m = getLatestFredValue("T10Y3M");
  return yieldCurveReading(points, Number.isFinite(t10y3m) ? t10y3m : null);
}

// 3. Aktivität — FRED INDPRO YoY + TCU. The spec names the series and forbids
// an ISM label without an ISM print. The YoY score is the durable-goods branch
// already on this page. TCU stays on the value. A missing YoY stays unscored.
function scoreActivity(): IndicatorResult {
  const indpro = fetchFredSeries("INDPRO");
  const tcu = getLatestFredValue("TCU");
  return activityIndicator(indpro, Number.isFinite(tcu) ? tcu : null);
}

// 4. Durable Goods Orders (YoY)
function scoreDurableGoods(): IndicatorResult {
  return durableReading(yoyPercent(fetchFredSeries("DGORDER")));
}

// 5. M2 Money Supply Growth (YoY). A missing print is not a neutral regime.
function scoreM2(): IndicatorResult {
  return m2Reading(yoyPercent(fetchFredSeries("M2SL")));
}

// 6. Credit Spreads (BAA - 10Y Treasury)
function scoreCreditSpreads(): IndicatorResult {
  let val = getLatestFredValue("BAA10Y");
  // Fallback
  if (isNaN(val)) {
    const baa = getLatestFredValue("BAA");
    const gs10 = getLatestFredValue("GS10");
    if (!isNaN(baa) && !isNaN(gs10)) val = baa - gs10;
  }

  return creditReading(val);
}

// 7. Consumer Confidence (Michigan CSI)
async function scoreConsumerConfidence(): Promise<IndicatorResult> {
  // FRED is the series. The macro snapshot is only the fallback.
  let csi = getLatestFredValue("UMCSENT");
  let source = "FRED UMCSENT";
  if (isNaN(csi)) {
    const macro = await getMacroValue(["Consumer Confidence"]);
    if (macro) {
      csi = macro.value;
      source = "U of Michigan";
    }
  }
  return csiReading(csi, source);
}

// ============================================================
// CORRECTION INDICATORS
// ============================================================

// 8. Buffett Indicator. The live leg is the Wilshire 5000 chart over FRED GDP.
// The discontinued FRED full-cap series is not requested. The World Bank annual
// ratio is only the fallback, and a print outside the Japan window is shown and not scored.
const WILSHIRE_CHART = "https://query1.finance.yahoo.com/v8/finance/chart/%5EW5000?range=10d&interval=1d";

function scoreBuffett(): IndicatorResult {
  const today = recessionAsOf();
  const close = latestYahooChartClose(readJson(fetchUrl(WILSHIRE_CHART, 20000, { "User-Agent": "Mozilla/5.0" })));
  const market = close
    ? { date: close.date, value: close.value * WILSHIRE_DOLLARS_PER_POINT_BN }
    : null;
  const gdp = latestFredPoint("GDP", 5);
  const computed = buffettFromMarketCapGdp(market, gdp, today, {
    source: "Yahoo ^W5000 / FRED GDP",
    description: market && gdp
      ? `Wilshire 5000 Total Market Index ${market.date} × ${WILSHIRE_DOLLARS_PER_POINT_BN} Mrd. $ je Punkt / FRED GDP ${gdp.date}. asOf ist das ältere Bein.`
      : "Wilshire 5000 Total Market Index / FRED GDP.",
  });
  if (computed) return computed;
  return buffettFromObservation(latestFredPoint("DDDM01USA156NWDB", 40), today);
}

// 9. Shiller CAPE. ie_data.xls is not parsed. The public monthly table is the series.
const MULTPL_CAPE = "https://www.multpl.com/shiller-pe/table/by-month";

function scoreCAPE(): IndicatorResult {
  const html = fetchUrl(MULTPL_CAPE, 20000, { "User-Agent": "Mozilla/5.0" });
  return capeFromPoint(latestMultplCape(html), recessionAsOf());
}

// 10. Margin debt. FINRA Rule 4521 publishes the monthly debit series as xlsx.
// The score is the year-over-year change against the 5-year z of that series.
// A single CMV sentence is only the fallback and stays unscored.
const CMV_MARGIN = "https://www.currentmarketvaluation.com/models/margin-debt.php";
const FINRA_MARGIN_XLSX = "https://www.finra.org/sites/default/files/2021-03/margin-statistics.xlsx";

function scoreMarginDebt(): IndicatorResult {
  try {
    const points = finraMarginPoints(fetchBinary(FINRA_MARGIN_XLSX));
    const today = recessionAsOf();
    const last = points[points.length - 1];
    if (points.length >= 13 && last && !isStale(last.date, today)) {
      const scored = marginDebtReading(points);
      if (scored.available !== false) {
        return {
          ...scored,
          source: "FINRA margin-statistics",
          description: "Debit Balances in Customers' Securities Margin Accounts, Mio. $. Der Score ist das Jahreswachstum gegen den 5-Jahres-z derselben Reihe.",
        };
      }
    }
  } catch {
    // A broken workbook falls through to the unscored spot reading.
  }
  const html = fetchUrl(CMV_MARGIN, 20000, { "User-Agent": "Mozilla/5.0" });
  return marginSpotReading(marginDebitFromCmv(html));
}

function fetchBinary(url: string, timeoutMs = 20000): Buffer {
  try {
    return execSync(`curl -sL --max-time ${Math.floor(timeoutMs / 1000)} "${url}"`, {
      timeout: timeoutMs + 5000,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    return Buffer.alloc(0);
  }
}

/** One ZIP local-file entry. A data descriptor (flag bit 3) is refused. */
export function zipEntry(buf: Buffer, entryName: string): Buffer | null {
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) return null;
    const flags = buf.readUInt16LE(offset + 6);
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    if (nameStart + nameLen > buf.length || dataStart > buf.length) return null;
    const name = buf.toString("utf8", nameStart, nameStart + nameLen);
    if (flags & 0x08) return null;
    if (dataStart + compSize > buf.length) return null;
    if (name === entryName) {
      const payload = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(payload);
      if (method === 8) {
        try {
          return inflateRawSync(payload);
        } catch {
          return null;
        }
      }
      return null;
    }
    offset = dataStart + compSize;
  }
  return null;
}

/** Column A is YYYY-MM, column B is debit balances in millions of dollars. */
export function finraMarginFromSheetXml(xml: string): { date: string; debitMillions: number }[] {
  const points: { date: string; debitMillions: number }[] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml))) {
    const row = rowMatch[1];
    const month = row.match(/<c\b[^>]*\br="A\d+"[^>]*>[\s\S]*?<t>(\d{4}-\d{2})<\/t>/);
    const debit = row.match(/<c\b[^>]*\br="B\d+"[^>]*>\s*<v>(\d+(?:\.\d+)?)<\/v>/);
    if (!month || !debit) continue;
    const debitMillions = Number(debit[1]);
    if (!Number.isFinite(debitMillions) || debitMillions <= 0) continue;
    points.push({ date: `${month[1]}-01`, debitMillions });
  }
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return points;
}

export function finraMarginPoints(buf: Buffer): { date: string; debitMillions: number }[] {
  if (!buf || buf.length < 30) return [];
  const xml = zipEntry(buf, "xl/worksheets/sheet1.xml");
  if (!xml) return [];
  return finraMarginFromSheetXml(xml.toString("utf8"));
}

// 11. Google Trends "Recession"
function scoreGoogleTrends(): IndicatorResult {
  let trendValue = NaN;
  let source = "Google Trends";

  // Primary: SerpApi Google Trends (requires SERPAPI_KEY). Without a key we
  // leave trendValue as NaN → indicator reports N/A (never a faked default).
  const serpKey = process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY || "";
  if (serpKey) {
    try {
      const url = `https://serpapi.com/search.json?engine=google_trends&q=Recession&geo=US&date=now%207-d&data_type=TIMESERIES&api_key=${encodeURIComponent(serpKey)}`;
      const raw = fetchUrl(url, 12000);
      if (raw && !raw.includes("<html")) {
        const parsed = JSON.parse(raw);
        const timeline = parsed?.interest_over_time?.timeline_data;
        if (Array.isArray(timeline) && timeline.length > 0) {
          const values: number[] = [];
          for (const point of timeline) {
            const v = point?.values?.[0]?.extracted_value ?? point?.values?.[0]?.value;
            const num = typeof v === "number" ? v : parseFloat(v);
            if (!isNaN(num)) values.push(num);
          }
          if (values.length > 0) {
            const avg = Math.round((values.reduce((s, n) => s + n, 0) / values.length) * 10) / 10;
            const latest = values[values.length - 1];
            const peak = Math.max(...values);
            trendValue = avg;
            source = `Google Trends via SerpApi (7d Ø=${avg}, Latest=${latest}, Peak=${peak})`;
            console.log(`  Google Trends (SerpApi): avg=${avg}, latest=${latest}, peak=${peak}`);
          }
        }
      }
    } catch (err: any) {
      console.log(`  Google Trends SerpApi failed: ${err?.message?.substring(0, 200)}`);
    }
  } else {
    console.log("  Google Trends: SERPAPI_KEY not set — reporting N/A");
  }

  return googleReading(Number.isFinite(trendValue) ? trendValue : null, source);
}

// One crowd leg: live CNN, otherwise a single VIX proxy. Crypto is only the proxy flag.
function scoreCrowdLeg(vix: number): IndicatorResult {
  let cnn: number | null = null;
  try {
    const json = fetchUrl(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      20000,
      {
        "Origin": "https://www.cnn.com",
        "Referer": "https://www.cnn.com/markets/fear-and-greed",
      },
    );
    if (json && !json.includes("<html") && !json.includes("teapot")) {
      const parsed = JSON.parse(json);
      const score = parseFloat(parsed?.fear_and_greed?.score);
      if (Number.isFinite(score)) cnn = score;
    }
  } catch (err: any) {
    console.log(`  CNN F&G primary failed: ${err?.message?.substring(0, 100)}`);
  }
  return crowdReading(cnn, Number.isFinite(vix) ? vix : null, false);
}

function scoreWei(): IndicatorResult {
  const wei = getLatestFredValue("WEI");
  return weiReading(Number.isFinite(wei) ? wei : null);
}

// ============================================================
// NY Fed Recession Probability Anchor
// ============================================================
function getNYFedRecessionProb(): number {
  return getLatestFredValue("RECPROUSM156N");
}

// ============================================================
// Analysis Engine
// ============================================================

export interface SubgroupResult {
  name: string;
  label: string;
  horizon: string;
  indicators: string[];
  netScore: number;
  maxScore: number;
  probability: number;
  formula: string;
  nyFedAnchor?: number;
  finalProbability?: number;
}

export interface RecessionAnalysis {
  date: string;
  /** UTC day the response was built. UI shows „Stand“ only when this is today. */
  asOf: string;
  schemaVersion: number;
  indicators: IndicatorResult[];
  subgroups: SubgroupResult[];
  nyFedValue: number | null;
  googleTrendsAvailable: boolean;
  topDrivers: string[];
  interpretation: string;
  drivers: DriverView;
  fazit: { summary: string; riskLevel: string; sections: FazitSection[] };
  sources: { name: string; url: string }[];
  bridge: RecessionBridge;
  /** US card plus scored Eurozone and Japan unemployment S. Not in the 17-indicator net. */
  sahmRegions: SahmRegionBoard[];
  regions: RegionalCatalogs;
}

function clampAndRound(p: number): number {
  const clamped = Math.max(5, Math.min(95, p));
  return Math.round(clamped / 5) * 5;
}

export const RECESSION_SCHEMA_VERSION = 1;
/** Model weight on the NY Fed series. The other 0.70 stays on the indicator formula. */
export const NY_FED_ANCHOR_WEIGHT = 0.3;
export const ACTIVITY_SLOT_NAME = "Aktivität (IP / Auslastung)";

export function recessionAsOf(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** FRED RECPROUSM156N is already a percent. 0.76 stays 0.76. */
export function nyFedAnchorPct(seriesPercent: number): number {
  return seriesPercent;
}

export function blendWithNyFedAnchor(formulaPct: number, anchorPct: number): number {
  return formulaPct * (1 - NY_FED_ANCHOR_WEIGHT) + anchorPct * NY_FED_ANCHOR_WEIGHT;
}

function rawGroupProbability(net: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(net)) return 50;
  return 50 + (net / max) * 50;
}

export function probabilityFromNet(net: number, max: number): number {
  return clampAndRound(rawGroupProbability(net, max));
}

export function anchoredRecessionProbability(net: number, max: number, nyFedSeries: number | null): {
  formulaPct: number;
  anchorPct: number | null;
  probability: number;
} {
  const formulaPct = rawGroupProbability(net, max);
  if (nyFedSeries == null || !Number.isFinite(nyFedSeries)) {
    return { formulaPct, anchorPct: null, probability: clampAndRound(formulaPct) };
  }
  const anchorPct = nyFedAnchorPct(nyFedSeries);
  return {
    formulaPct,
    anchorPct,
    probability: clampAndRound(blendWithNyFedAnchor(formulaPct, anchorPct)),
  };
}

/** Same 13-observation lag the other monthly FRED slots already use. */
export function yoyPercent(obs: { date: string; value: number }[]): number {
  if (obs.length < 13) return NaN;
  const latest = obs[obs.length - 1].value;
  const yearAgo = obs[obs.length - 13].value;
  if (yearAgo === 0 || !Number.isFinite(latest) || !Number.isFinite(yearAgo)) return NaN;
  return ((latest - yearAgo) / yearAgo) * 100;
}

export function scoredTotals(indicators: Array<Pick<IndicatorResult, "weightedScore" | "maxWeighted" | "available">>): { net: number; max: number } {
  const scored = indicators.filter(i => i.available !== false);
  return {
    net: scored.reduce((s, i) => s + i.weightedScore, 0),
    max: scored.reduce((s, i) => s + i.maxWeighted, 0),
  };
}

export function activityIndicator(
  indpro: { date: string; value: number }[],
  tcu: number | null,
): IndicatorResult {
  const yoy = yoyPercent(indpro);
  const yoyOk = Number.isFinite(yoy);
  const tcuOk = tcu != null && Number.isFinite(tcu);
  const parts: string[] = [];
  if (yoyOk) parts.push(`INDPRO YoY ${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%`);
  if (tcuOk) parts.push(`TCU ${tcu!.toFixed(1)}%`);
  const sources: string[] = [];
  if (yoyOk) sources.push("FRED INDPRO");
  if (tcuOk) sources.push("FRED TCU");
  const base = {
    name: ACTIVITY_SLOT_NAME,
    group: "recession" as const,
    subgroup: "coincident",
    value: parts.length > 0 ? parts.join(", ") : "N/A",
    source: sources.length > 0 ? sources.join(", ") : "FRED INDPRO / TCU",
    description: "Industrieproduktion Jahr-über-Jahr (INDPRO) und Kapazitätsauslastung (TCU).",
  };
  if (!yoyOk) {
    return {
      ...base,
      rawScore: 0,
      weight: 0,
      weightedScore: 0,
      maxWeighted: 0,
      zone: parts.length > 0 ? "Ablesung, kein Score" : "N/A",
      available: false,
    };
  }
  const scored = realActivityYoyScore(yoy);
  return {
    ...base,
    rawScore: scored.rawScore,
    weight: 1,
    weightedScore: scored.rawScore,
    maxWeighted: 3,
    zone: scored.zone,
  };
}

/** z(Δ WTI 4w) > 1.5. A missing z stays unknown — it is not a shock and not a calm print. */
export function oilShockFromZ(zWti4w: number | null): boolean | null {
  if (zWti4w == null || !Number.isFinite(zWti4w)) return null;
  return zWti4w > 1.5;
}

export function correctionAction(pKorr12: number, pRez12: number, oilShock: boolean | null): string {
  const head = `P_korr12 ${pKorr12}%, P_rez12 ${pRez12}%: `;
  if (pKorr12 >= 65 && pRez12 < 40) {
    return `${head}Beta/Duration runter; kein volles Rezessions-Portfolio`;
  }
  if (pKorr12 >= 65 && pRez12 >= 40) {
    if (oilShock === true) return `${head}defensiv + Cash/Bills + Gold-Kanal`;
    if (oilShock === false) return `${head}defensiv + Cash/Bills`;
    return `${head}defensiv + Cash/Bills. Öl-Schock-Flag nicht verfügbar`;
  }
  if (pKorr12 < 50 && pRez12 >= 40) {
    return `${head}Konjunktur weich, Multiples nicht das Problem → Quality/Value`;
  }
  return `${head}Standard-Risiko`;
}

const CURVE_MIN_MONTHS = 24;
const CURVE_HISTORY_MONTHS = 240;
const BRIEFING_ESSAY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PRIVATE_CREDIT_ESSAY =
  "Der $3-Billionen-Private-Credit-Markt steht vor seinem ersten echten Stresstest seit 2008. Morgan Stanley warnt vor Default-Raten von bis zu 8% (vs. historisch 2-2,5%). "
  + "40% der Private-Credit-Kreditnehmer haben laut IWF negativen freien Cashflow — ein Anstieg von 25% in 2021. "
  + "Mehrere Fonds (Blue Owl Capital, Cliffwater) haben bereits Rücknahmen eingeschränkt oder gestoppt. Die Parallelen zu den Vorboten der 2008-Krise (Rating-Arbitrage, Illiquidität, unrealistische Bewertungen) werden von UBS-Chairman Kelleher und der BIS explizit gezogen. "
  + "Bankkredite an Non-Bank Financial Institutions (NBFIs) sind auf $1,92 Billionen gestiegen (+66% seit Ende 2024), was eine potenzielle Ansteckungsgefahr für das regulierte Bankensystem darstellt. "
  + "Anders als 2023 bei der Silicon Valley Bank (konzentriertes VC-Exposure, Zinsrisiko bei Anleiheportfolios) ist das heutige Risiko breiter gestreut: Private Credit, Leveraged Loans, AI-Datacenter-Finanzierungen und covenant-lite Strukturen bilden ein Cluster eng korrelierter Risiken.";

function closedIndicator(
  base: Pick<IndicatorResult, "name" | "group" | "subgroup" | "source" | "description">,
  value = "N/A",
): IndicatorResult {
  return {
    ...base,
    value,
    rawScore: 0,
    weight: 0,
    weightedScore: 0,
    maxWeighted: 0,
    zone: "N/A",
    available: false,
  };
}

function latestFredPoint(seriesId: string, years: number): { date: string; value: number } | null {
  const rows = fetchFredRows(seriesId, getDateYearsAgo(years));
  for (let i = rows.length - 1; i >= 0; i--) {
    const value = rows[i].value;
    if (value != null && Number.isFinite(value) && rows[i].date) return { date: rows[i].date, value };
  }
  return null;
}

function monthEndPoints(rows: { date: string; value: number }[]): { date: string; value: number }[] {
  const sorted = rows
    .filter(row => Boolean(row.date) && Number.isFinite(row.value))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const byMonth = new Map<string, { date: string; value: number }>();
  for (const row of sorted) byMonth.set(row.date.slice(0, 7), row);
  return Array.from(byMonth.values());
}

function rawFromS(s: number): number {
  return Math.max(-4, Math.min(4, Math.round((s - 50) / 12.5)));
}

/** s(z) like the fiscal front end. History excludes the current print. n < 24 fails closed. */
export function scoreSeriesStress(levels: number[]): { available: boolean; raw: number; s: number } {
  if (levels.length < CURVE_MIN_MONTHS) return { available: false, raw: 0, s: 50 };
  const level = levels[levels.length - 1];
  const history = levels.slice(Math.max(0, levels.length - 1 - CURVE_HISTORY_MONTHS), levels.length - 1);
  if (history.length < 2) return { available: false, raw: 0, s: 50 };
  const mu = history.reduce((sum, value) => sum + value, 0) / history.length;
  const variance = history.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (history.length - 1);
  const sigma = Math.sqrt(variance);
  const deviation = level - mu;
  const flat = sigma <= 1e-12;
  const onMean = Math.abs(deviation) <= 1e-8 * Math.max(1, Math.abs(mu));
  const z = flat
    ? (onMean ? 0 : Math.sign(deviation) * Number.POSITIVE_INFINITY)
    : deviation / (sigma + 1e-9);
  const s = sOfZ(z);
  return { available: true, raw: rawFromS(s), s };
}

/**
 * Recession-book score of T10Y2Y. A low curve is the stress, so z is taken on
 * the negated spread. The sign of the spread itself stays the label only.
 */
export function yieldCurveReading(
  t10y2y: { date: string; value: number }[],
  t10y3m: number | null,
): IndicatorResult {
  const monthly = monthEndPoints(t10y2y);
  const level = monthly.length ? monthly[monthly.length - 1].value : null;
  const delta = monthly.length >= 13 && level != null ? level - monthly[monthly.length - 13].value : null;
  const base = {
    name: "Inv. Zinskurve (10Y-2Y)",
    group: "recession" as const,
    subgroup: "coincident",
    source: "FRED T10Y2Y / T10Y3M",
    description: "T10Y2Y-Niveau und 12M-Änderung, Zusatz T10Y3M. Score ist s(z) über 20 Jahre, nicht der Sprung an 0.",
  };
  if (level == null) return closedIndicator(base);
  const deltaText = delta == null ? "n/a" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)} pp`;
  const parts = [`T10Y2Y ${level.toFixed(2)}%`, `12M Δ ${deltaText}`];
  if (t10y3m != null && Number.isFinite(t10y3m)) parts.push(`T10Y3M ${t10y3m.toFixed(2)}%`);
  const value = parts.join(" · ");
  const label = level < 0 ? "Invertiert (<0)" : "Normal (≥0)";
  const scored = scoreSeriesStress(monthly.map(point => -point.value));
  if (!scored.available) {
    return { ...closedIndicator(base, value), zone: `${label}, keine 20J-Historie` };
  }
  return {
    ...base,
    value,
    rawScore: scored.raw,
    weight: 1,
    weightedScore: scored.raw,
    maxWeighted: 4,
    zone: label,
  };
}

/** YoY branch shared by durable goods and industrial production. Weight 1, max 3. */
function realActivityYoyScore(yoy: number): { rawScore: number; zone: string } {
  const decline = yoy < -5;
  return {
    rawScore: decline ? 3 : -2,
    zone: decline ? "Starker Rückgang (>-5%)" : "Stabil",
  };
}

export function durableReading(yoy: number): IndicatorResult {
  const base = {
    name: "Durable Goods (YoY)",
    group: "recession" as const,
    subgroup: "leading",
    source: "FRED DGORDER",
    description: "Auftragseingang langlebige Güter, Jahr-über-Jahr",
  };
  if (!Number.isFinite(yoy)) return closedIndicator(base);
  const scored = realActivityYoyScore(yoy);
  return {
    ...base,
    value: `${yoy.toFixed(1)}%`,
    rawScore: scored.rawScore,
    weight: 1,
    weightedScore: scored.rawScore,
    maxWeighted: 3,
    zone: scored.zone,
  };
}

export function m2Reading(yoy: number): IndicatorResult {
  const base = {
    name: "M2 Geldmenge (YoY)",
    group: "recession" as const,
    subgroup: "leading",
    source: "FRED M2SL",
    description: "US M2-Geldmengenwachstum Jahr-über-Jahr",
  };
  if (!Number.isFinite(yoy)) return closedIndicator(base);
  let rawScore = 0;
  let zone = "Normal (4-10%)";
  if (yoy < 0) { rawScore = 3; zone = "Kontraktion (<0%)"; }
  else if (yoy < 2) { rawScore = 3; zone = "Sehr niedrig (<2%)"; }
  else if (yoy < 4) { rawScore = 1; zone = "Niedrig (2-4%)"; }
  else if (yoy <= 10) { rawScore = 0; zone = "Normal (4-10%)"; }
  else { rawScore = -2; zone = "Expansiv (>10%)"; }
  return {
    ...base,
    value: `${yoy.toFixed(1)}%`,
    rawScore,
    weight: 1,
    weightedScore: rawScore,
    maxWeighted: 3,
    zone,
  };
}

export function creditReading(val: number): IndicatorResult {
  const base = {
    name: "Kreditspreads (BAA-Trs)",
    group: "recession" as const,
    subgroup: "leading",
    source: "FRED BAA10Y",
    description: "Moody's BAA Corporate Bond Spread über 10Y Treasury",
  };
  if (!Number.isFinite(val)) return closedIndicator(base);
  let rawScore = 0;
  let zone = "Normal (1.5-2.0%)";
  if (val > 2.5) { rawScore = 3; zone = "Stress (>2.5%)"; }
  else if (val >= 2.0) { rawScore = 2; zone = "Erhöht (2.0-2.5%)"; }
  else if (val >= 1.5) { rawScore = 0; zone = "Normal (1.5-2.0%)"; }
  else if (val >= 1.0) { rawScore = -1; zone = "Eng (1.0-1.5%)"; }
  else { rawScore = -2; zone = "Sehr eng (<1.0%)"; }
  return {
    ...base,
    value: `${val.toFixed(2)}%`,
    rawScore,
    weight: 1,
    weightedScore: rawScore,
    maxWeighted: 3,
    zone,
  };
}

export function csiReading(csi: number, source = "FRED UMCSENT"): IndicatorResult {
  const base = {
    name: "Konsumklima (CSI)",
    group: "recession" as const,
    subgroup: "full",
    source,
    description: "University of Michigan Consumer Sentiment Index",
  };
  if (!Number.isFinite(csi)) return closedIndicator(base);
  const triggered = csi < 60;
  const rawScore = triggered ? 3 : -2;
  return {
    ...base,
    value: `${csi.toFixed(1)}`,
    rawScore,
    weight: 1,
    weightedScore: rawScore,
    maxWeighted: 3,
    zone: triggered ? "Pessimistisch (<60)" : "Normal (≥60)",
  };
}

export function weiReading(value: number | null): IndicatorResult {
  const base = {
    name: "Weekly Nowcast (WEI)",
    group: "recession" as const,
    subgroup: "leading",
    source: "FRED WEI",
    description: "Lewis-Mertens-Stock Weekly Economic Index. Leading-Zusatz, kein Score.",
  };
  if (value == null || !Number.isFinite(value)) return closedIndicator(base);
  return { ...closedIndicator(base, value.toFixed(2)), zone: "Ablesung, kein Score" };
}

export function buffettReading(ratio: number): IndicatorResult {
  const base = {
    name: "Buffett Indikator (TMC/GDP)",
    group: "correction" as const,
    subgroup: "valuation",
    source: "FRED DDDM01USA156NWDB",
    description: "Marktkapitalisierung / BIP, FRED DDDM01USA156NWDB",
  };
  if (!Number.isFinite(ratio)) return closedIndicator(base);
  let rawScore = -4;
  let zone = `Fair/unterbewertet (${ratio.toFixed(0)}% <140%)`;
  if (ratio > 200) { rawScore = 8; zone = `Extrem überbewertet (${ratio.toFixed(0)}% >200%)`; }
  else if (ratio >= 165) { rawScore = 5; zone = "Stark überbewertet (165-200%)"; }
  else if (ratio >= 140) { rawScore = 2; zone = "Überbewertet (140-165%)"; }
  return {
    ...base,
    value: `${ratio.toFixed(0)}%`,
    rawScore,
    weight: 2,
    weightedScore: rawScore * 2,
    maxWeighted: 16,
    zone,
  };
}

/**
 * WILL5000PR points are the market-cap billions the index was built on.
 * GDP is billions. The result is the Buffett ratio in percent.
 */
export function buffettMarketCapGdpPercent(wilshire: number, gdpBillions: number): number {
  if (!Number.isFinite(wilshire) || !Number.isFinite(gdpBillions) || gdpBillions === 0) return NaN;
  return (wilshire / gdpBillions) * 100;
}

/** A dated ratio. The Japan activity window (STALE_MONTHS) keeps an old print out of net and max. */
export function buffettFromObservation(
  point: { date: string; value: number } | null,
  today: string,
  meta: { source?: string; description?: string } = {},
): IndicatorResult {
  const base = {
    name: "Buffett Indikator (TMC/GDP)",
    group: "correction" as const,
    subgroup: "valuation",
    source: meta.source ?? "FRED DDDM01USA156NWDB",
    description: meta.description ?? "Marktkapitalisierung / BIP, FRED DDDM01USA156NWDB",
  };
  if (!point || !Number.isFinite(point.value) || !point.date) return closedIndicator(base);
  if (isStale(point.date, today)) {
    return closedIndicator(base, `${point.value.toFixed(0)}% (${point.date.slice(0, 7)})`);
  }
  return {
    ...buffettReading(point.value),
    source: base.source,
    description: base.description,
  };
}

/**
 * Wilshire / GDP when both prints are inside the Japan window.
 * A missing or stale leg is not a ratio — the caller uses the World Bank series.
 */
export function buffettFromMarketCapGdp(
  market: { date: string; value: number } | null,
  gdp: { date: string; value: number } | null,
  today: string,
  meta: { source?: string; description?: string } = {},
): IndicatorResult | null {
  if (!market || !gdp) return null;
  if (isStale(market.date, today) || isStale(gdp.date, today)) return null;
  const ratio = buffettMarketCapGdpPercent(market.value, gdp.value);
  if (!Number.isFinite(ratio)) return null;
  const asOf = market.date < gdp.date ? market.date : gdp.date;
  return buffettFromObservation(
    { date: asOf, value: ratio },
    today,
    {
      source: meta.source ?? "FRED WILL5000PR / GDP",
      description: meta.description ?? "Wilshire 5000 / BIP (FRED WILL5000PR / GDP).",
    },
  );
}

/** Last finite daily close. A null bar (the session still printing) is skipped. */
export function latestYahooChartClose(payload: unknown): { date: string; value: number } | null {
  if (!payload || typeof payload !== "object") return null;
  const result = (payload as { chart?: { result?: Array<{ timestamp?: unknown; indicators?: { quote?: Array<{ close?: unknown }> } }> } }).chart?.result?.[0];
  const stamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
  let found: { date: string; value: number } | null = null;
  const n = Math.min(stamps.length, closes.length);
  for (let i = 0; i < n; i++) {
    const raw = closes[i];
    if (raw == null || raw === "") continue;
    const value = typeof raw === "number" ? raw : Number(raw);
    const stamp = typeof stamps[i] === "number" ? stamps[i] : Number(stamps[i]);
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(stamp)) continue;
    found = { date: new Date(stamp * 1000).toISOString().slice(0, 10), value };
  }
  return found;
}

/** Newest row of the public Shiller PE monthly table. The workbook is not read. */
export function latestMultplCape(html: string): { date: string; value: number } | null {
  if (!html || html.includes("Just a moment")) return null;
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match => htmlCell(match[1]));
    if (cells.length < 2) continue;
    const date = englishLongDate(cells[0]);
    const value = Number(cells[1].replace(/,/g, ""));
    if (!date || !Number.isFinite(value) || value < 5 || value > 80) continue;
    return { date, value };
  }
  return null;
}

export function capeFromPoint(point: { date: string; value: number } | null, today: string): IndicatorResult {
  const description = "Shiller CAPE (PE10) aus der öffentlichen Monatstabelle. ie_data.xls wird nicht gelesen.";
  if (!point || !Number.isFinite(point.value) || point.value < 5 || point.value > 80 || !point.date) {
    return {
      ...capeReading(Number.NaN),
      source: "Multpl Shiller-PE leer",
      description: "Kein CAPE-Druck. ie_data.xls wird nicht gelesen.",
    };
  }
  if (isStale(point.date, today)) {
    return {
      ...capeReading(Number.NaN),
      value: `${point.value.toFixed(1)} (${point.date.slice(0, 7)})`,
      source: "Multpl Shiller PE",
      description,
    };
  }
  return { ...capeReading(point.value), source: "Multpl Shiller PE", description };
}

/**
 * One public debit sentence. The broken meta line ("$1,416%") does not match,
 * because the level has to be named in billions.
 */
export function marginDebitFromCmv(html: string): { date: string; billions: number } | null {
  if (!html) return null;
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const match = text.match(/As of ([A-Z][a-z]+ \d{1,2}, \d{4}) \(the latest data available\), total US margin debt was \$([0-9][0-9,]*(?:\.\d+)?) billion/i);
  if (!match) return null;
  const date = englishLongDate(match[1]);
  const billions = Number(match[2].replace(/,/g, ""));
  if (!date || !Number.isFinite(billions) || billions < 100 || billions > 5000) return null;
  return { date, billions };
}

/** A single debit is shown. Without a monthly history there is no 5-year z and no score. */
export function marginSpotReading(spot: { date: string; billions: number } | null): IndicatorResult {
  const closed = {
    name: "Margin Debt",
    group: "correction" as const,
    subgroup: "valuation",
    source: "FINRA-Historie nur als xlsx",
    description: "Die Debit-Historie steht nur in der FINRA-xlsx. Ohne Monatsreihe bleibt der Slot zu.",
  };
  if (!spot) return closedIndicator(closed);
  return {
    ...closedIndicator(
      {
        ...closed,
        source: "Current Market Valuation (FINRA-Debit, ein Druck)",
        description: "Ein öffentlicher Debit-Druck in Mrd. $. Ohne die Monatsreihe gibt es keinen 5J-z und keinen Score.",
      },
      `${spot.billions.toFixed(1)} Mrd. $ (${spot.date.slice(0, 7)})`,
    ),
    zone: "Ablesung, kein 5J-z",
  };
}

/** Value string only when the slot is scored. A closed print is not the live level. */
export function liveBuffettValue(indicator: Pick<IndicatorResult, "value" | "available"> | undefined): string | null {
  if (!indicator || indicator.available === false) return null;
  const parsed = parseFloat(String(indicator.value).replace("%", ""));
  if (!Number.isFinite(parsed)) return null;
  return indicator.value;
}

export function buffettFazitClause(indicator: Pick<IndicatorResult, "value" | "available"> | undefined): string {
  const value = liveBuffettValue(indicator);
  if (value == null) return "";
  const buffettVal = parseFloat(String(value).replace("%", ""));
  if (!Number.isFinite(buffettVal) || buffettVal <= 180) return "";
  return `Der Buffett-Indikator steht bei ${value} — das höchste Niveau seit der Dotcom-Blase. `
    + `Historisch führten Bewertungen über 200% zu durchschnittlichen Drawdowns von 30-50% innerhalb von 18 Monaten. `;
}

/** Last P/E10 in an in-memory grid. The excess-yield column is also labeled CAPE and stays near 0. */
export function latestShillerCape(rows: unknown[][]): number {
  const candidates: number[] = [];
  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) return;
    row.forEach((cell, col) => {
      if (String(cell ?? "").trim() !== "CAPE") return;
      let latest = NaN;
      for (let i = rowIndex + 1; i < rows.length; i++) {
        const below = rows[i];
        const value = Array.isArray(below) ? below[col] : undefined;
        if (typeof value === "number" && Number.isFinite(value) && value > 0) latest = value;
      }
      if (Number.isFinite(latest)) candidates.push(latest);
    });
  });
  const ratio = candidates.find(value => value >= 5);
  return ratio ?? NaN;
}

export function capeReading(cape: number): IndicatorResult {
  const base = {
    name: "Shiller CAPE",
    group: "correction" as const,
    subgroup: "valuation",
    source: "CAPE-Ratio",
    description: "Cyclically Adjusted Price-to-Earnings Ratio (Shiller PE)",
  };
  if (!Number.isFinite(cape)) return closedIndicator(base);
  let rawScore = -5;
  let zone = `Günstig (${cape.toFixed(1)} <15)`;
  if (cape > 35) { rawScore = 7; zone = `Extrem hoch (${cape.toFixed(1)} >35)`; }
  else if (cape >= 30) { rawScore = 3; zone = "Hoch (30-35)"; }
  else if (cape >= 15) { rawScore = 0; zone = "Normal (15-30)"; }
  return {
    ...base,
    value: cape.toFixed(1),
    rawScore,
    weight: 1.8,
    weightedScore: Math.round(rawScore * 1.8 * 10) / 10,
    maxWeighted: 12.6,
    zone,
  };
}

export function marginDebtReading(points: { date: string; debitMillions: number }[]): IndicatorResult {
  const base = {
    name: "Margin Debt",
    group: "correction" as const,
    subgroup: "valuation",
    source: "FINRA",
    description: "NYSE Margin Debt aus der FINRA-Statistik, Einheit Mrd. $",
  };
  const clean = points
    .filter(point => Number.isFinite(point.debitMillions) && point.debitMillions > 0)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if (clean.length < 13) return closedIndicator(base);
  const stats = marginYoYAndZ(clean.map(point => point.debitMillions));
  const billions = clean[clean.length - 1].debitMillions / 1000;
  const yoy = stats.yoyPct;
  const z = stats.z5y;
  const yoyText = yoy == null || !Number.isFinite(yoy) ? "" : ` · YoY ${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%`;
  const zText = z == null || !Number.isFinite(z) ? "" : ` · z5y ${z >= 0 ? "+" : ""}${z.toFixed(2)}`;
  const value = `${billions.toFixed(1)} Mrd. $${yoyText}${zText}`;
  if (/\$\d{4}T/i.test(value)) return closedIndicator(base);
  if (z == null || !Number.isFinite(z)) return { ...closedIndicator(base), value };
  const raw = rawFromS(sOfZ(z));
  return {
    ...base,
    value,
    rawScore: raw,
    weight: 1,
    weightedScore: raw,
    maxWeighted: 4,
    zone: `YoY ${yoy == null ? "n/a" : `${yoy.toFixed(1)}%`}, z5y ${z.toFixed(2)}`,
  };
}

export function googleReading(trend: number | null, source = "Google Trends"): IndicatorResult {
  const base = {
    name: "Google Trends \"Recession\"",
    group: "correction" as const,
    subgroup: "sentiment_ext",
    source: trend == null ? "Google Trends (N/A)" : source,
    description: "Google-Suchinteresse für 'Recession' (0-100 Index)",
  };
  if (trend == null || !Number.isFinite(trend)) return closedIndicator(base);
  let rawScore = -4;
  let zone = `Niedrig (${trend} <30) → Sorglosigkeit`;
  if (trend > 75) { rawScore = 7; zone = `Extrem hoch (${trend} >75) → Panik-Suchen`; }
  else if (trend >= 60) { rawScore = 4; zone = `Hoch (${trend} 60-75) → Erhöhtes Interesse`; }
  else if (trend >= 30) { rawScore = 0; zone = `Normal (${trend} 30-60)`; }
  return {
    ...base,
    value: `${trend.toFixed(0)} (7d Ø)`,
    rawScore,
    weight: 1.7,
    weightedScore: Math.round(rawScore * 1.7 * 10) / 10,
    maxWeighted: 11.9,
    zone,
  };
}

export function vixReading(vix: number): IndicatorResult {
  const base = {
    name: "VIX",
    group: "correction" as const,
    subgroup: "sentiment",
    source: "FRED VIXCLS",
    description: "CBOE Volatility Index (Angstbarometer)",
  };
  if (!Number.isFinite(vix)) return closedIndicator(base);
  let rawScore = -3;
  let zone = `Sorglosigkeit (${vix.toFixed(1)} <15)`;
  if (vix > 30) { rawScore = 4; zone = `Panik (${vix.toFixed(1)} >30)`; }
  else if (vix >= 20) { rawScore = 1; zone = "Erhöht (20-30)"; }
  else if (vix >= 15) { rawScore = 0; zone = "Normal (15-20)"; }
  return {
    ...base,
    value: vix.toFixed(1),
    rawScore,
    weight: 1,
    weightedScore: rawScore,
    maxWeighted: 4,
    zone,
  };
}

export function crowdReading(cnn: number | null, vix: number | null, cnnIsProxy: boolean): IndicatorResult {
  const cnnOk = cnn != null && Number.isFinite(cnn) && !cnnIsProxy;
  if (cnnOk) {
    const fgValue = cnn as number;
    let rawScore = -5;
    let zone = `Extreme Fear (${Math.round(fgValue)} <25)`;
    if (fgValue > 75) { rawScore = 6; zone = `Extreme Greed (${Math.round(fgValue)} >75)`; }
    else if (fgValue > 55) { rawScore = 2; zone = "Greed (55-75)"; }
    else if (fgValue >= 45) { rawScore = 0; zone = "Neutral (45-55)"; }
    else if (fgValue >= 25) { rawScore = -2; zone = "Fear (25-45)"; }
    return {
      name: "CNN Fear & Greed",
      group: "correction",
      subgroup: "sentiment",
      value: `${Math.round(fgValue)}`,
      rawScore,
      weight: 1.6,
      weightedScore: Math.round(rawScore * 1.6 * 10) / 10,
      maxWeighted: 9.6,
      zone,
      source: "CNN Fear & Greed (Live)",
      description: "CNN Fear & Greed Index (0=Extreme Fear, 100=Extreme Greed)",
    };
  }
  if (vix != null && Number.isFinite(vix)) {
    let rawScore = 4;
    let zone = `Extreme Sorglosigkeit (VIX ${vix.toFixed(1)} < 12)`;
    if (vix > 30) { rawScore = -3; zone = `Extreme Angst (VIX ${vix.toFixed(1)} > 30)`; }
    else if (vix > 22) { rawScore = -1; zone = `Angst (VIX ${vix.toFixed(1)} 22-30)`; }
    else if (vix >= 15) { rawScore = 0; zone = `Neutral (VIX ${vix.toFixed(1)} 15-22)`; }
    else if (vix >= 12) { rawScore = 2; zone = `Sorglosigkeit (VIX ${vix.toFixed(1)} 12-15)`; }
    return {
      name: "VIX-Proxy",
      group: "correction",
      subgroup: "sentiment",
      value: `VIX-Proxy ${vix.toFixed(1)}`,
      rawScore,
      weight: 1,
      weightedScore: rawScore,
      maxWeighted: 4,
      zone,
      source: "FRED VIXCLS",
      description: "Ein Crowd-Bein als VIX-Proxy. Nicht AAII, Put/Call und Investors Intelligence zugleich.",
      proxy: true,
    };
  }
  return closedIndicator({
    name: "CNN Fear & Greed",
    group: "correction",
    subgroup: "sentiment",
    source: "CNN Fear & Greed",
    description: "CNN Fear & Greed Index (0=Extreme Fear, 100=Extreme Greed)",
  });
}

export function briefingEssayAllowed(updatedAtMs: number | null, now = Date.now()): boolean {
  if (updatedAtMs == null || !Number.isFinite(updatedAtMs)) return false;
  const age = now - updatedAtMs;
  return age >= 0 && age <= BRIEFING_ESSAY_MAX_AGE_MS;
}

export function briefingCacheUpdatedAt(): number | null {
  const stamps: number[] = [];
  const sql = diskBriefingUpdatedAt();
  if (sql != null) stamps.push(sql);
  const dir = path.join(process.cwd(), ".cache", "researcher");
  try {
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (name !== "briefing-result.json" && !name.startsWith("briefing_v2__")) continue;
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { savedAt?: string; updated_at?: string };
          const saved = Date.parse(raw?.savedAt ?? raw?.updated_at ?? "");
          if (Number.isFinite(saved)) stamps.push(saved);
        } catch { /* unreadable cache is not a fresh essay */ }
      }
    }
  } catch { /* no cache directory */ }
  if (!stamps.length) return null;
  return Math.max(...stamps);
}

export function privateCreditEssay(allowed: boolean): { title: string; emoji: string; text: string } | null {
  if (!allowed) return null;
  return { title: "Private Credit & Systemisches Risiko", emoji: "🏦", text: PRIVATE_CREDIT_ESSAY };
}

function groupFormula(net: number, max: number, rounded: number): string {
  if (!(max > 0)) return `keine gewerteten Indikatoren → ${rounded}%`;
  const raw = 50 + (net / max) * 50;
  return `50% + (${net.toFixed(1)}/${max.toFixed(1)}) × 50% = ${raw.toFixed(1)}% → ${rounded}%`;
}

export async function runRecessionAnalysis(): Promise<RecessionAnalysis> {
  console.log("[RECESSION] Starting recession analysis...");

  const bridgePromise = fetchBridge();
  const cosdSahm = getDateYearsAgo(SAHM_HISTORY_YEARS);
  const usSahm = scoreSahm();
  const regionalPromise = fetchRegionalPrints().catch(() => null);

  const vixValue = getLatestFredValue("VIXCLS");
  const indicators: IndicatorResult[] = await Promise.all([
    Promise.resolve(usSahm.indicator),
    scoreYieldCurve(),
    scoreActivity(),
    scoreDurableGoods(),
    scoreM2(),
    scoreCreditSpreads(),
    scoreConsumerConfidence(),
    scoreBuffett(),
    scoreCAPE(),
    scoreMarginDebt(),
    scoreGoogleTrends(),
    vixReading(vixValue),
    scoreCrowdLeg(vixValue),
    scoreWei(),
  ]);

  console.log("[RECESSION] All indicators scored:");
  indicators.forEach(ind => {
    console.log(`  ${ind.name}: ${ind.value} → Score ${ind.weightedScore} (max ${ind.maxWeighted})`);
  });

  const googleAvailable = indicators.find(i => i.name.includes("Google"))?.value !== "N/A";
  const nyFedValue = getNYFedRecessionProb();
  console.log(`[RECESSION] NY Fed recession prob: ${nyFedValue}`);

  // === Build subgroups per methodology ===

  // 1. Rezession Coincident (3M): Sahm + Zinskurve + Aktivität. Unscored slots add neither net nor max.
  const coincidentInds = indicators.filter(i => i.subgroup === "coincident");
  const coincidentTotals = scoredTotals(coincidentInds);
  const coincidentNet = coincidentTotals.net;
  const coincidentMax = coincidentTotals.max;

  // 2. Rezession Leading (6M): + Durable + M2 + Kredit
  const leadingInds = indicators.filter(i => i.subgroup === "leading");
  const rezLeadingTotals = scoredTotals([...coincidentInds, ...leadingInds]);
  const rezLeadingNet = rezLeadingTotals.net;
  const rezLeadingMax = rezLeadingTotals.max;

  // 3. Rezession Vollständig (12M): + Konsumklima
  const fullInds = indicators.filter(i => i.subgroup === "full");
  const rezFullTotals = scoredTotals([...coincidentInds, ...leadingInds, ...fullInds]);
  const rezFullNet = rezFullTotals.net;
  const rezFullMax = rezFullTotals.max;

  // 4. Korrektur Sentiment: VIX plus one crowd leg. A missing print adds neither net nor max.
  const sentimentInds = indicators.filter(i => i.subgroup === "sentiment");
  const sentimentTotals = scoredTotals(sentimentInds);
  const sentimentNet = sentimentTotals.net;
  const sentimentMax = sentimentTotals.max;

  // 5. Korrektur Vollständig (12M): valuation slots. Google N/A stays out via available:false.
  const valuationInds = indicators.filter(i => i.subgroup === "valuation" || i.subgroup === "sentiment_ext");
  const valuationTotals = scoredTotals(valuationInds);
  const corrFullNet = sentimentNet + valuationTotals.net;
  const corrFullMax = sentimentMax + valuationTotals.max;

  // Compute probabilities
  const pCoincident = probabilityFromNet(coincidentNet, coincidentMax);
  const pLeading = probabilityFromNet(rezLeadingNet, rezLeadingMax);

  // 12M Recession with NY Fed anchor. The series is already percent — no ×10.
  const anchored = anchoredRecessionProbability(
    rezFullNet,
    rezFullMax,
    Number.isFinite(nyFedValue) ? nyFedValue : null,
  );
  const pRezFormula = anchored.formulaPct;
  const pRezFull = anchored.probability;
  const anchorPct = anchored.anchorPct;

  const pSentiment = probabilityFromNet(sentimentNet, sentimentMax);
  const pCorrFull = probabilityFromNet(corrFullNet, corrFullMax);

  const subgroups: SubgroupResult[] = [
    {
      name: "recession_coincident",
      label: "Rezession Coincident",
      horizon: "3M",
      indicators: coincidentInds.map(i => i.name),
      netScore: Math.round(coincidentNet * 10) / 10,
      maxScore: Math.round(coincidentMax * 10) / 10,
      probability: pCoincident,
      formula: groupFormula(coincidentNet, coincidentMax, pCoincident),
    },
    {
      name: "recession_leading",
      label: "Rezession Leading",
      horizon: "6M",
      indicators: [...coincidentInds, ...leadingInds].map(i => i.name),
      netScore: Math.round(rezLeadingNet * 10) / 10,
      maxScore: Math.round(rezLeadingMax * 10) / 10,
      probability: pLeading,
      formula: groupFormula(rezLeadingNet, rezLeadingMax, pLeading),
    },
    {
      name: "recession_full",
      label: "Rezession Vollständig",
      horizon: "12M",
      indicators: [...coincidentInds, ...leadingInds, ...fullInds].map(i => i.name),
      netScore: Math.round(rezFullNet * 10) / 10,
      maxScore: Math.round(rezFullMax * 10) / 10,
      probability: pRezFull,
      formula: anchorPct != null
        ? `Formel: ${rezFullMax > 0 ? `50% + (${rezFullNet.toFixed(1)}/${rezFullMax.toFixed(1)}) × 50% = ${pRezFormula.toFixed(1)}%` : `keine gewerteten Indikatoren = ${pRezFormula.toFixed(1)}%`} | NY-Fed-Anker: ${anchorPct.toFixed(1)}% | Final: ${pRezFormula.toFixed(1)}%×0.7 + ${anchorPct.toFixed(1)}%×0.3 = ${pRezFull}%`
        : groupFormula(rezFullNet, rezFullMax, pRezFull),
      nyFedAnchor: anchorPct ?? undefined,
      finalProbability: pRezFull,
    },
    {
      name: "correction_sentiment",
      label: "Korrektur Sentiment",
      horizon: "3-6M",
      indicators: sentimentInds.map(i => i.name),
      netScore: Math.round(sentimentNet * 10) / 10,
      maxScore: Math.round(sentimentMax * 10) / 10,
      probability: pSentiment,
      formula: groupFormula(sentimentNet, sentimentMax, pSentiment),
    },
    {
      name: "correction_full",
      label: "Korrektur Vollständig",
      horizon: "12M",
      indicators: [...sentimentInds, ...valuationInds].map(i => i.name),
      netScore: Math.round(corrFullNet * 10) / 10,
      maxScore: Math.round(corrFullMax * 10) / 10,
      probability: pCorrFull,
      formula: groupFormula(corrFullNet, corrFullMax, pCorrFull),
    },
  ];

  // Top 3 drivers
  const sortedByImpact = indicators.filter(i => i.available !== false).sort((a, b) => Math.abs(b.weightedScore) - Math.abs(a.weightedScore));
  const topDrivers = sortedByImpact.slice(0, 3).map(i =>
    `${i.name}: ${i.weightedScore > 0 ? "+" : ""}${i.weightedScore} (${i.zone})`
  );

  // Interpretation
  const maxProb = Math.max(pRezFull, pCorrFull);
  let interpretation: string;
  if (maxProb >= 70) {
    interpretation = "Hohes Risiko: Mehrere Indikatoren signalisieren erhöhte Rezessions- oder Korrekturwahrscheinlichkeit. Defensivere Positionierung empfohlen.";
  } else if (maxProb >= 50) {
    interpretation = "Moderates Risiko: Gemischte Signale. Einzelne Indikatoren zeigen Warnsignale, aber kein breiter Konsens. Selektive Vorsicht geboten.";
  } else if (maxProb >= 30) {
    interpretation = "Niedriges Risiko: Die Mehrheit der Indikatoren signalisiert stabile wirtschaftliche Bedingungen. Standardmäßige Risikomanagement-Maßnahmen ausreichend.";
  } else {
    interpretation = "Sehr niedriges Risiko: Praktisch alle Indikatoren zeigen positive Signale. Marktumfeld begünstigt Risikobereitschaft.";
  }

  const today = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

  const sources = [
    { name: "FRED (Federal Reserve Economic Data)", url: "https://fred.stlouisfed.org" },
    { name: "FRED WILL5000PR / GDP", url: "https://fred.stlouisfed.org/series/WILL5000PR" },
    { name: "FRED DDDM01USA156NWDB", url: "https://fred.stlouisfed.org/series/DDDM01USA156NWDB" },
    { name: "CNN Fear & Greed Index", url: "https://www.cnn.com/markets/fear-and-greed" },
    { name: "University of Michigan Consumer Sentiment", url: "https://data.sca.isr.umich.edu" },
    { name: "Google Trends", url: "https://trends.google.com" },
    { name: "Eurostat une_rt_m (Eurozone ALQ)", url: "https://ec.europa.eu/eurostat/databrowser/view/une_rt_m/default/table" },
  ];

  // ====== FAZIT: Comprehensive assessment ======
  const bridge = await bridgePromise;
  const driverAssessment = await loadDriverAssessment();
  const drivers: DriverView = {
    status: driverAssessment.status,
    lines: driverAssessment.lines,
    cards: driverAssessment.cards,
  };
  const fazit = generateFazit(indicators, subgroups, pCoincident, pLeading, pRezFull, pSentiment, pCorrFull, topDrivers, bridge, drivers);

  console.log("[RECESSION] Analysis complete.");
  console.log(`[RECESSION] Probabilities: Rez-3M=${pCoincident}%, Rez-6M=${pLeading}%, Rez-12M=${pRezFull}%, Korr-3-6M=${pSentiment}%, Korr-12M=${pCorrFull}%`);

  return {
    date: today,
    asOf: recessionAsOf(),
    schemaVersion: RECESSION_SCHEMA_VERSION,
    indicators,
    subgroups,
    nyFedValue: isNaN(nyFedValue) ? null : nyFedValue,
    googleTrendsAvailable: googleAvailable,
    topDrivers,
    interpretation,
    drivers,
    fazit,
    sources,
    bridge,
    sahmRegions: [
      sahmRegionBoard("US", "Vereinigte Staaten", usSahm.indicator.source, usSahm.evaluated, true),
      scoreEuroAreaSahm(cosdSahm),
      scoreJapanSahm(cosdSahm),
    ],
    regions: scoreRegionalCatalogs({
      prints: await regionalPromise ?? emptyRegionalPrints(),
      usSlots: usSlotsFromIndicators(indicators),
      usRecession12m: pRezFull,
      usCorrection12m: pCorrFull,
      today: recessionAsOf(),
      scorers: {
        money: yoy => m2Reading(yoy),
        credit: spread => creditReading(spread),
        vol: level => vixReading(level),
        valuation: ratio => capeReading(ratio),
        activity: yoy => realActivityYoyScore(yoy),
        curve: (levels, stressWhenLow) => {
          const scored = scoreSeriesStress(stressWhenLow ? levels.map(value => -value) : levels);
          return { available: scored.available, raw: scored.raw };
        },
      },
    }),
  };
}

// ============================================================
// Fazit Generator — Comprehensive macro risk assessment
// ============================================================

interface FazitSection {
  title: string;
  emoji: string;
  text: string;
}

export function generateFazit(
  indicators: IndicatorResult[],
  subgroups: any[],
  pRez3M: number, pRez6M: number, pRez12M: number,
  pKorr3_6M: number, pKorr12M: number,
  topDrivers: string[],
  bridge: RecessionBridge,
  drivers: DriverView,
): { summary: string; riskLevel: string; sections: FazitSection[] } {
  // Extract key indicator values
  const get = (name: string) => indicators.find(i => i.name.includes(name));
  const buffett = get("Buffett");
  const cape = get("CAPE");
  const vix = get("VIX");
  const sahm = get("Sahm");
  const yield10y2y = get("Zinskurve");
  const creditSpreads = get("Kreditspreads");
  const consConf = get("Konsumklima");
  const cnnFG = get("CNN");
  const googleTrends = get("Google");
  const marginDebt = get("Margin");

  const maxProb = Math.max(pRez12M, pKorr12M);
  const riskLevel = maxProb >= 70 ? "Hoch" : maxProb >= 50 ? "Erhöht" : maxProb >= 30 ? "Moderat" : "Niedrig";

  // Section 1: Quantitative Assessment
  const bullCount = indicators.filter(i => i.weightedScore < 0).length;
  const bearCount = indicators.filter(i => i.weightedScore > 0).length;
  const neutralCount = indicators.filter(i => i.weightedScore === 0).length;

  let quantSummary = `Von ${indicators.length} Indikatoren signalisieren ${bearCount} ein erhöhtes Risiko (bearish), ${bullCount} sind positiv (bullish) und ${neutralCount} neutral. `;
  quantSummary += `Die Rezessionswahrscheinlichkeit liegt bei ${pRez3M}% (3M), ${pRez6M}% (6M) und ${pRez12M}% (12M). `;
  quantSummary += `Die Korrekturwahrscheinlichkeit beträgt ${pKorr3_6M}% (Sentiment, 3-6M) und ${pKorr12M}% (Vollständig, 12M). `;
  const driverList = topDrivers.slice(0, 3).join("; ");
  // Google Trends sits in sentiment_ext and still enters P_korr12. That is not a valuation print.
  const valuationLiftsCorrection = indicators.some(i =>
    i.available !== false && i.subgroup === "valuation" && i.weightedScore > 0,
  );
  if (pKorr12M >= 65) {
    if (valuationLiftsCorrection) {
      quantSummary += `Die hohe Korrekturwahrscheinlichkeit von ${pKorr12M}% wird maßgeblich durch extreme Bewertungsniveaus getrieben: `;
      quantSummary += driverList + ".";
    } else if (driverList) {
      quantSummary += `Die hohe Korrekturwahrscheinlichkeit von ${pKorr12M}% wird durch folgende Treiber getrieben: ${driverList}.`;
    } else {
      quantSummary += `Die hohe Korrekturwahrscheinlichkeit von ${pKorr12M}% kommt nicht aus gewerteten Bewertungs-Slots.`;
    }
  } else if (pRez12M >= 40) {
    quantSummary += `Die erhöhte Rezessionswahrscheinlichkeit reflektiert eine Kombination aus schwächelnden Konjunkturdaten und geopolitischem Stress.`;
  }

  // Section 2: Valuation Risk — never an empty heading; closed slots get an honest hint.
  let valuationText = "";
  valuationText += buffettFazitClause(buffett);
  const capeVal = cape ? parseFloat(String(cape.value)) : NaN;
  if (!isNaN(capeVal) && capeVal > 30) {
    valuationText += `Das Shiller CAPE-Ratio von ${capeVal} liegt über dem Durchschnitt der letzten 140 Jahre (ca. 17) und signalisiert, dass zukünftige Aktienrenditen (10J) mit hoher Wahrscheinlichkeit unterdurchschnittlich ausfallen. `;
  }
  if (marginDebt && marginDebt.rawScore > 0) {
    valuationText += `Die NYSE Margin Debt (${marginDebt.value}) zeigt erhöhte Hebelwirkung im Markt — ein klassischer Vorlauf-Indikator für abrupte Sell-Offs.`;
  }
  if (!valuationText.trim()) {
    valuationText = "Buffett, Shiller CAPE und Margin Debt sind nicht gewertet (N/A oder außerhalb des Fensters). Dieser Abschnitt nennt deshalb kein Bewertungsniveau; P_korr12 kommt in diesem Lauf nicht aus der Bewertungsseite.";
  }

  // Section 3: Geopolitics — only the WTI→CPI→BE→DGS10 chain, and only when shock.
  const geoSection = shockGeopoliticsSection(bridge);

  // The shock channel stays on the oil bridge. The private-credit essay needs a briefing cache ≤ 30 days.
  const essayOn = briefingEssayAllowed(briefingCacheUpdatedAt());
  const creditSection = privateCreditEssay(essayOn);

  // Section 5: Handlung aus P_korr12 und P_rez12.
  // The oil bridge already measured z(Δ WTI 4w). A missing z is not a shock.
  const actionText = correctionAction(pKorr12M, pRez12M, oilShockFromZ(bridge.oil.zOil));

  // Build summary
  let summary = `Gesamtbewertung: ${riskLevelPhrase(riskLevel)}. `;
  summary += `Rezession 12M: ${pRez12M}%, Korrektur 12M: ${pKorr12M}%. `;
  const buffettText = liveBuffettValue(buffett);
  if (pKorr12M >= 65 && essayOn && buffettText) {
    summary += `Die Kombination aus historisch extremen Bewertungen (Buffett ${buffettText}, CAPE ${cape?.value}) `;
    summary += `und systemischen Risiken im $3T-Private-Credit-Markt bildet ein Dreifach-Risiko-Cluster, `;
    summary += `das defensives Portfoliomanagement erfordert.`;
  }

  const sections: FazitSection[] = [
    { title: "Quantitative Bewertung", emoji: "📊", text: quantSummary },
    { title: "Bewertungsrisiko", emoji: "⚠️", text: valuationText },
    ...(geoSection ? [geoSection] : []),
    ...driverFazitSections(drivers),
    ...(creditSection ? [creditSection] : []),
    { title: "Handlungsempfehlung", emoji: "🎯", text: actionText },
  ];

  return { summary, riskLevel, sections };
}

// ============================================================
// Express route registration
// ============================================================
// In-memory cache for recession analysis (1h TTL)
// Recession indicators are all macro/weekly data — no need to re-fetch every click
let recessionCache: { data: RecessionAnalysis; ts: number } | null = null;
const RECESSION_CACHE_TTL = 60 * 60 * 1000; // 1 hour

export function registerRecessionRoutes(app: Express) {
  app.post("/api/analyze-recession", async (req, res) => {
    const force = req.body?.force === true;
    // Serve from cache if available and not stale
    if (!force && recessionCache && Date.now() - recessionCache.ts < RECESSION_CACHE_TTL) {
      console.log(`[RECESSION] cache HIT (age=${Math.round((Date.now() - recessionCache.ts)/60000)}min)`);
      return res.json(recessionCache.data);
    }
    // runRecessionAnalysis is async + heavy (many FRED/scrape fetches).
    // Proxy guard: if still running after 24s, return 202 and continue in background.
    let responded = false;
    const guard = setTimeout(() => {
      if (!responded) {
        responded = true;
        console.warn("[RECESSION] Proxy guard fired — returning 202");
        res.status(202).json({
          __building: true,
          message: "Rezessions-Analyse l\u00e4uft im Hintergrund (>24s). Bitte in 8\u201310 Sekunden erneut klicken.",
          retryAfterMs: 9000,
        });
      }
    }, 24000);
    guard.unref();
    try {
      const analysis = await runRecessionAnalysis();
      recessionCache = { data: analysis, ts: Date.now() };
      clearTimeout(guard);
      if (!responded) {
        responded = true;
        res.json(analysis);
      }
    } catch (error: any) {
      clearTimeout(guard);
      console.error("[RECESSION] Error:", error?.message);
      if (!responded) {
        responded = true;
        res.status(500).json({ error: error?.message || "Recession analysis failed" });
      }
    }
  });
}
