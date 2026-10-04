/**
 * Fetch layer for CATALOG[region]. Disk hit on the spec cache key, otherwise
 * fetch that series and diskResearcherSet. Does not call the US M2V path.
 */
import { diskResearcherGet, diskResearcherSet } from "./disk-cache";
import { CATALOG, type Region, type SeriesSpec } from "./liquidity-index-catalog";
import {
  jpnAssetsToTn,
  scoreCatalog,
  type LiquidityBooksPayload,
  type Obs,
  type SeriesBundle,
} from "./liquidity-index-math";

export interface SeriesCache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface BuildIndexOptions {
  force?: boolean;
  now?: Date;
  cache?: SeriesCache;
  fetchBundle?: (spec: SeriesSpec) => Promise<SeriesBundle>;
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

async function fetchText(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    const text = await resp.text();
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
    case "liqidx_US__buybacks":
      return { points: dropStale(await fetchBuybacks(), now) };
    case "fiscal__qra_2026Q3":
      return { points: [{ date: "2026-08-05", value: 409 }] };
    case "liqidx_EU__assets":
      // WFS total-assets has no stable fast EDP key here. An empty slot stays
      // unavailable instead of scoring a different balance-sheet line.
      return { points: [] };
    case "liqidx_EU__app_pepp":
      return { points: [] };
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
      return { points: [{ date: "2026-07-01", value: 80 }] };
    case "liqidx_EU__bund":
      return { points: [] };
    case "liqidx_ASIA__jpnassets":
      return { points: dropStale(await fetchFred("JPNASSETS", now, jpnAssetsToTn), now) };
    case "liqidx_ASIA__jgb_px":
      return { points: [] };
    case "liqidx_ASIA__rate":
      return { points: dropStale(await fetchFred("IRSTCI01JPM156N", now, v => v), now) };
    case "liqidx_ASIA__m2":
      return { points: [] };
    case "liqidx_ASIA__jgb_iss":
      return { points: [] };
    case "liqidx_ASIA__govdep":
      return { points: [] };
    case "liqidx_ASIA__cn_m2": {
      const raw = await fetchFred("MYAGM2CNM189N", now, v => v);
      const yoy = yoyPercent(raw);
      return { points: dropStale(yoy, now) };
    }
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
  return scoreCatalog(region, bundles);
}
