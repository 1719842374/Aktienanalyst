/**
 * Fetch layer for CATALOG[region]. Disk hit on the spec cache key, otherwise
 * fetch that series and diskResearcherSet. The catalog fetch does not call
 * the US C2 M2V path. Spelled stock series are read separately.
 */
import { gunzipSync } from "node:zlib";
import { diskResearcherGet, diskResearcherSet } from "./disk-cache";
import { EU_BONDS_SNAPSHOT } from "./eu-bonds-snapshot";
import { BOJ_M2_CODE, BOJ_M2_YOY_CODE } from "./liquidity-briefing";
import {
  WORLD_BANK_CN_M2_URL,
  bojHundredMillionYenToBillion,
  parseAppBreakdown,
  parseBojMoneyStock,
  parseBojSeries,
  parsePeppPurchases,
  parseWorldBankLevels,
} from "./liquidity-briefing-math";
import { CATALOG, type Region, type SeriesSpec } from "./liquidity-index-catalog";
import {
  jpnAssetsToTn,
  scoreCatalog,
  type LiquidityBooksPayload,
  type Obs,
  type SeriesBundle,
} from "./liquidity-index-math";
import { BOJ_JGB_CODE, parseEurostatJson } from "./liquidity-stocks-series";
import { fetchRegionalStockInputs } from "./liquidity-stocks-series";
import type { StockInputs } from "./liquidity-stocks-velocity";
import { QRA_SNAPSHOT } from "./qra-snapshot";

export interface SeriesCache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface BuildIndexOptions {
  force?: boolean;
  now?: Date;
  cache?: SeriesCache;
  fetchBundle?: (spec: SeriesSpec) => Promise<SeriesBundle>;
  /** Spelled §5 inputs. Defaults to the stock reader, not the C2 path. */
  fetchStocks?: (region: Region, now: Date) => Promise<StockInputs>;
}

const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const ECB_DATA = "https://data-api.ecb.europa.eu/service/data";
const MSPD_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/debt/mspd/mspd_table_1" +
  "?filter=security_class_desc:eq:Bills,security_type_desc:eq:Marketable" +
  "&sort=-record_date&page[size]=40&fields=record_date,total_mil_amt";
const BUYBACK_URLS = [
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/treasury_buyback_operations?page[size]=40&sort=-record_date",
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/buybacks?page[size]=40&sort=-record_date",
];
const APP_CSV_URL = "https://www.ecb.europa.eu/mopo/pdf/APP_breakdown_history.csv";
const PEPP_CSV_URL = "https://www.ecb.europa.eu/mopo/pdf/PEPP_purchase_history.csv";
const ECB_WFS_ASSETS = "ILM/W.U2.C.A070000.U2.EUR";
const STALE_DAYS = 450;

export function parseLiquidityRegion(value: unknown): Region | "invalid" | null {
  if (value == null || value === "") return null;
  if (Array.isArray(value)) return parseLiquidityRegion(value[0]);
  const s = String(value).trim().toUpperCase();
  if (s === "US" || s === "EU" || s === "ASIA") return s;
  return "invalid";
}

function monthsAgo(n: number, now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoWeekToDate(token: string): string | null {
  const week = /^(\d{4})-W(\d{2})$/.exec(token);
  if (week) {
    const year = Number(week[1]);
    const w = Number(week[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (w - 1) * 7);
    return monday.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}$/.test(token)) return `${token}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  return null;
}

function decodeFetched(buf: ArrayBuffer, url: string): string {
  const bytes = new Uint8Array(buf);
  const unzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
    ? gunzipSync(Buffer.from(bytes))
    : Buffer.from(bytes);
  if (url.includes("jgbcm") || url.includes("boj.or.jp")) {
    try {
      const sjis = new TextDecoder("shift_jis").decode(unzipped);
      if (sjis.includes("10年") || /SERIES|MAM1|SMBIT|MABS/i.test(sjis)) return sjis;
    } catch {
      /* utf-8 below */
    }
  }
  return new TextDecoder("utf-8").decode(unzipped);
}

async function fetchText(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: "text/csv,application/json,text/plain;q=0.9,*/*;q=0.8" },
    });
    if (!resp.ok) return null;
    const text = decodeFetched(await resp.arrayBuffer(), url);
    if (!text || text.includes("<!DOCTYPE") || text.includes("<html")) return null;
    return text;
  } catch {
    return null;
  }
}

function parseFredCsv(csv: string, scale: (raw: number) => number): Obs[] {
  const out: Obs[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    if (!date || raw == null || raw.trim() === ".") continue;
    const value = Number(raw.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || !Number.isFinite(value)) continue;
    out.push({ date: date.trim(), value: scale(value) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchFred(id: string, now: Date, scale: (raw: number) => number): Promise<Obs[]> {
  const csv = await fetchText(`${FRED_CSV}?id=${encodeURIComponent(id)}&cosd=${monthsAgo(72, now)}`);
  if (!csv) return [];
  return parseFredCsv(csv, scale);
}

function parseEcbCsv(csv: string, scale = 1): Obs[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const periodIdx = header.indexOf("TIME_PERIOD");
  const valueIdx = header.indexOf("OBS_VALUE");
  if (periodIdx < 0 || valueIdx < 0) return [];
  const out: Obs[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const date = isoWeekToDate(cols[periodIdx]?.trim() ?? "");
    const value = Number(cols[valueIdx]);
    if (!date || !Number.isFinite(value)) continue;
    out.push({ date, value: value * scale });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchEcb(flowKey: string, scale = 1): Promise<Obs[]> {
  const csv = await fetchText(`${ECB_DATA}/${flowKey}?format=csvdata&startPeriod=2019-01`, 20000);
  if (!csv) return [];
  return parseEcbCsv(csv, scale);
}

function dropStale(points: Obs[], now: Date): Obs[] {
  if (!points.length) return [];
  const last = points[points.length - 1].date;
  const cutoff = addDays(now.toISOString().slice(0, 10), -STALE_DAYS);
  if (last < cutoff) return [];
  return points;
}

function alignNotes(total: Obs[], bills: Obs[]): Obs[] {
  const notes: Obs[] = [];
  for (const t of total) {
    let bill: number | null = null;
    for (const b of bills) {
      if (b.date <= t.date) bill = b.value;
      else break;
    }
    if (bill == null) continue;
    notes.push({ date: t.date, value: Math.round((t.value - bill) * 1000) / 1000 });
  }
  return notes;
}

async function fetchMspd(): Promise<Obs[]> {
  const text = await fetchText(MSPD_URL);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { data?: { record_date?: string; total_mil_amt?: string }[] };
    const out: Obs[] = [];
    for (const row of parsed.data ?? []) {
      const date = row.record_date ?? "";
      const mil = Number(row.total_mil_amt);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(mil)) continue;
      out.push({ date, value: mil / 1000 });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

async function fetchBuybacks(): Promise<Obs[]> {
  for (const url of BUYBACK_URLS) {
    const text = await fetchText(url);
    if (!text) continue;
    try {
      const parsed = JSON.parse(text) as { data?: Record<string, string>[] };
      const rows = parsed.data ?? [];
      const out: Obs[] = [];
      for (const row of rows) {
        const date = row.record_date || row.operation_date || row.auction_date || "";
        const raw = row.accepted_amt || row.total_accepted_amt || row.par_amt || row.offer_amt;
        const mil = Number(raw);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(mil)) continue;
        out.push({ date, value: mil > 10_000 ? mil / 1000 : mil });
      }
      if (out.length) return out.sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      continue;
    }
  }
  return [];
}

function dated(period: string, value: number): Obs | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return { date: period, value };
  if (/^\d{4}-\d{2}$/.test(period)) return { date: `${period}-01`, value };
  if (/^\d{4}$/.test(period)) return { date: `${period}-01-01`, value };
  return null;
}

async function fetchAppPeppHoldings(): Promise<Obs[]> {
  const [appCsv, peppCsv] = await Promise.all([fetchText(APP_CSV_URL, 20000), fetchText(PEPP_CSV_URL, 20000)]);
  const app = parseAppBreakdown(appCsv || "");
  const pepp = parsePeppPurchases(peppCsv || "");
  const peppBy = new Map(pepp.map(row => [row.period, row.cumulativeNetPurchasesBn]));
  const out: Obs[] = [];
  for (const row of app) {
    const peppHold = peppBy.get(row.period);
    const point = dated(row.period, row.holdingsBn + (peppHold ?? 0));
    if (point) out.push(point);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchBundOutstanding(now: Date): Promise<Obs[]> {
  const start = `${now.getUTCFullYear() - 12}-Q1`;
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/gov_10q_ggdebt?geo=DE&na_item=F3&sector=S13&unit=MIO_EUR&sinceTimePeriod=${start}&format=JSON&lang=EN`;
  const text = await fetchText(url, 20000);
  if (!text) return [];
  return parseEurostatJson(text, 1 / 1000);
}

async function fetchBojCsv(url: string): Promise<string> {
  return (await fetchText(url, 20000)) || "";
}

function bojStart(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - 12);
  return d.toISOString().slice(0, 7).replace("-", "");
}

async function fetchBojJgbTn(now: Date): Promise<Obs[]> {
  const url = `https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=FM05&code=${BOJ_JGB_CODE}&startDate=${bojStart(now)}`;
  const rows = parseBojSeries(await fetchBojCsv(url), BOJ_JGB_CODE);
  return rows.flatMap(row => {
    const point = dated(row.period, jpnAssetsToTn(row.value));
    return point ? [point] : [];
  });
}

async function fetchBojM2Yoy(now: Date): Promise<Obs[]> {
  const url = `https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD02&code=${BOJ_M2_CODE},${BOJ_M2_YOY_CODE}&startDate=${bojStart(now)}`;
  const csv = await fetchBojCsv(url);
  const official = parseBojSeries(csv, BOJ_M2_YOY_CODE);
  if (official.length) {
    return official.flatMap(row => {
      const point = dated(row.period, row.value);
      return point ? [point] : [];
    });
  }
  const levels = parseBojMoneyStock(csv).map(row => {
    const point = dated(row.period, bojHundredMillionYenToBillion(row.value));
    return point;
  }).filter((p): p is Obs => !!p);
  return yoyPercent(levels);
}

async function fetchBojGovDepTn(now: Date): Promise<Obs[]> {
  const codes = ["BSLGV", "BSLGV1", "MAABGDEPT"];
  for (const code of codes) {
    const url = `https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD01&code=${code}&startDate=${bojStart(now)}`;
    const rows = parseBojSeries(await fetchBojCsv(url), code);
    if (rows.length) {
      return rows.flatMap(row => {
        const point = dated(row.period, jpnAssetsToTn(row.value));
        return point ? [point] : [];
      });
    }
  }
  return [];
}

async function fetchCnM2Yoy(): Promise<Obs[]> {
  const text = await fetchText(`${WORLD_BANK_CN_M2_URL.replace("mrnev=8", "mrnev=20")}`, 20000);
  const levels = parseWorldBankLevels(text || "");
  const out: Obs[] = [];
  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1];
    const last = levels[i];
    if (!(prev.value > 0)) continue;
    const point = dated(last.period, ((last.value - prev.value) / prev.value) * 100);
    if (point) out.push(point);
  }
  return out;
}

async function fetchDefaultBundle(spec: SeriesSpec, now: Date): Promise<SeriesBundle> {
  if (spec.validUntil && now.toISOString().slice(0, 10) > spec.validUntil) return { points: [] };
  switch (spec.cacheKey) {
    case "liqidx_US__WALCL":
      return { points: dropStale(await fetchFred("WALCL", now, v => v / 1000), now) };
    case "liqidx_US__soma": {
      const [bills, total] = await Promise.all([
        fetchFred("WSHOBL", now, v => v / 1000),
        fetchFred("WSHOTSL", now, v => v / 1000),
      ]);
      return {
        points: dropStale(alignNotes(total, bills), now),
        parts: { bills: dropStale(bills, now) },
      };
    }
    case "liqidx_US__rrp":
      return { points: dropStale(await fetchFred("RRPONTSYD", now, v => v), now) };
    case "liqidx_US__tga":
      return { points: dropStale(await fetchFred("WTREGEN", now, v => v / 1000), now) };
    case "liqidx_US__mspd":
      return { points: dropStale(await fetchMspd(), now) };
    case "liqidx_US__buybacks": {
      const live = dropStale(await fetchBuybacks(), now);
      if (live.length) return { points: live };
      return {
        points: [{ date: QRA_SNAPSHOT.asOf, value: QRA_SNAPSHOT.assumedBuybacksBn }],
        impulse: "level",
      };
    }
    case "fiscal__qra_2026Q3":
      return { points: [{ date: QRA_SNAPSHOT.asOf, value: QRA_SNAPSHOT.impliedBillChangeBn }] };
    case "liqidx_EU__assets":
      return { points: dropStale(await fetchEcb(ECB_WFS_ASSETS, 1 / 1000), now) };
    case "liqidx_EU__app_pepp":
      return { points: dropStale(await fetchAppPeppHoldings(), now) };
    case "liqidx_EU__df":
      return { points: dropStale(await fetchEcb("ILM/W.U2.C.L020200.U2.EUR", 1 / 1000), now) };
    case "liqidx_EU__ecbdfr":
      return { points: dropStale(await fetchFred("ECBDFR", now, v => v), now) };
    case "liqidx_EU__m3":
      return { points: dropStale(await fetchEcb("BSI/M.U2.Y.V.M30.X.I.U2.2300.Z01.A", 1), now) };
    case "liqidx_EU__govdep":
      // ILM WFS 5.1 — general government liabilities at the Eurosystem, EUR millions.
      return { points: dropStale(await fetchEcb("ILM/W.U2.C.L050100.U2.EUR", 1 / 1000), now) };
    case "liqidx_EU__eubonds":
      return { points: [{ date: EU_BONDS_SNAPSHOT.asOf, value: EU_BONDS_SNAPSHOT.netBondBn }] };
    case "liqidx_EU__bund":
      return { points: dropStale(await fetchBundOutstanding(now), now) };
    case "liqidx_ASIA__jpnassets":
      return { points: dropStale(await fetchFred("JPNASSETS", now, jpnAssetsToTn), now) };
    case "liqidx_ASIA__jgb_px":
      return { points: dropStale(await fetchBojJgbTn(now), now) };
    case "liqidx_ASIA__rate":
      return { points: dropStale(await fetchFred("IRSTCI01JPM156N", now, v => v), now) };
    case "liqidx_ASIA__m2":
      return { points: dropStale(await fetchBojM2Yoy(now), now) };
    case "liqidx_ASIA__jgb_iss":
      return { points: dropStale(await fetchBojJgbTn(now), now) };
    case "liqidx_ASIA__govdep":
      return { points: dropStale(await fetchBojGovDepTn(now), now) };
    case "liqidx_ASIA__cn_m2":
      return { points: await fetchCnM2Yoy() };
    default:
      return { points: [] };
  }
}

function yoyPercent(levels: Obs[]): Obs[] {
  const pts = [...levels].sort((a, b) => a.date.localeCompare(b.date));
  const out: Obs[] = [];
  for (const p of pts) {
    const prevDate = addDays(p.date, -365);
    let prev: Obs | null = null;
    for (const q of pts) {
      if (q.date <= prevDate) prev = q;
      else break;
    }
    if (!prev || prev.value === 0 || prev.date === p.date) continue;
    out.push({ date: p.date, value: ((p.value - prev.value) / Math.abs(prev.value)) * 100 });
  }
  return out;
}

function bundleFromCache(raw: unknown, ttlHours: number, validUntil: string | undefined, now: Date): SeriesBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { fetchedAt?: string; points?: Obs[]; parts?: Record<string, Obs[]> };
  if (!row.fetchedAt || !Array.isArray(row.points)) return null;
  if (validUntil && now.toISOString().slice(0, 10) > validUntil) return null;
  const ageH = (now.getTime() - Date.parse(row.fetchedAt)) / 3_600_000;
  if (!Number.isFinite(ageH) || ageH > ttlHours) return null;
  return { points: row.points, parts: row.parts };
}

const diskCache: SeriesCache = {
  get: key => diskResearcherGet(key),
  set: (key, value) => diskResearcherSet(key, value),
};

export async function buildLiquidityIndex(region: Region, opts: BuildIndexOptions = {}): Promise<LiquidityBooksPayload> {
  const now = opts.now ?? new Date();
  const cache = opts.cache ?? diskCache;
  const fetchBundle = opts.fetchBundle ?? ((spec: SeriesSpec) => fetchDefaultBundle(spec, now));
  const bundles: Record<string, SeriesBundle> = {};
  await Promise.all(CATALOG[region].map(async spec => {
    if (!opts.force) {
      const hit = bundleFromCache(cache.get(spec.cacheKey), spec.ttlHours, spec.validUntil, now);
      if (hit) {
        bundles[spec.cacheKey] = hit;
        return;
      }
    }
    let bundle: SeriesBundle = { points: [] };
    try {
      bundle = await fetchBundle(spec);
    } catch {
      bundle = { points: [] };
    }
    bundles[spec.cacheKey] = bundle;
    cache.set(spec.cacheKey, { fetchedAt: now.toISOString(), points: bundle.points, parts: bundle.parts });
  }));
  let stocks: StockInputs = {};
  try {
    const fetchStocks = opts.fetchStocks ?? ((r: Region, n: Date) => fetchRegionalStockInputs(r, {
      now: n,
      cache,
      force: opts.force,
    }));
    stocks = await fetchStocks(region, now) ?? {};
  } catch {
    stocks = {};
  }
  return scoreCatalog(region, bundles, stocks);
}
