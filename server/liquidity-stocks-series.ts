/**
 * Reads the series named in WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY §5 and
 * maps them onto StockInputs. T½, the velocity clip, and π stay in
 * liquidity-stocks-velocity.ts. Unnamed EZ/JP series are not invented.
 */
import type { Region } from "./liquidity-index-catalog";
import { H_MIN, sOfZ, type Obs } from "./liquidity-index-math";
import type { StockInputs } from "./liquidity-stocks-velocity";

const STALE_DAYS = 450;
const STOCK_TTL_H = 6;
const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv";

export const MSPD_MARKETABLE_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/debt/mspd/mspd_table_1" +
  "?filter=security_type_desc:eq:Marketable" +
  "&sort=-record_date&page[size]=100&fields=record_date,security_class_desc,total_mil_amt";

const US_IDS = ["GFDEGDQ188S", "DFII10", "DGS10", "CPIAUCSL", "M2V", "M2SL", "GDP"] as const;
const EU_IDS = ["GGGDTPEZA188N"] as const;
const DEBT_ID: Record<Region, string | null> = {
  US: "GFDEGDQ188S",
  EU: "GGGDTPEZA188N",
  ASIA: null,
};

export interface StockFetchCache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export function spelledFredIds(region: Region): string[] {
  if (region === "US") return [...US_IDS];
  if (region === "EU") return [...EU_IDS];
  return [];
}

export function parseMarketableTotal(text: string): { date: string; bn: number } | null {
  try {
    const parsed = JSON.parse(text) as { data?: { record_date?: string; total_mil_amt?: string }[] };
    let latest = "";
    let mil = 0;
    let count = 0;
    for (const row of parsed.data ?? []) {
      const date = row.record_date ?? "";
      const amt = Number(row.total_mil_amt);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amt)) continue;
      if (date > latest) {
        latest = date;
        mil = amt;
        count = 1;
      } else if (date === latest) {
        mil += amt;
        count += 1;
      }
    }
    if (!count) return null;
    return { date: latest, bn: mil / 1000 };
  } catch {
    return null;
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthsAgo(n: number, now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

function sorted(points: Obs[] | undefined): Obs[] {
  return (points ?? [])
    .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function fresh(points: Obs[] | undefined, now: Date): Obs[] {
  const pts = sorted(points);
  if (!pts.length) return [];
  const cutoff = addDays(now.toISOString().slice(0, 10), -STALE_DAYS);
  if (pts[pts.length - 1].date < cutoff) return [];
  return pts;
}

function latest(points: Obs[] | undefined, now: Date): number | null {
  const pts = fresh(points, now);
  return pts.length ? pts[pts.length - 1].value : null;
}

function atOrBefore(pts: Obs[], iso: string): Obs | null {
  let hit: Obs | null = null;
  for (const p of pts) {
    if (p.date <= iso) hit = p;
    else break;
  }
  return hit;
}

function yoyPercent(points: Obs[] | undefined, now: Date): number | null {
  const pts = fresh(points, now);
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const prev = atOrBefore(pts, addDays(last.date, -365));
  if (!prev || prev.date === last.date || prev.value === 0) return null;
  return ((last.value - prev.value) / Math.abs(prev.value)) * 100;
}

function last10y(points: Obs[]): Obs[] {
  const start = addDays(points[points.length - 1].date, -365 * 10);
  const window = points.filter(p => p.date >= start);
  return window.length ? window : [points[points.length - 1]];
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleStdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

function fiscalTrendOf(points: Obs[] | undefined, now: Date): number | null {
  const pts = fresh(points, now);
  const deltas: number[] = [];
  for (const p of pts) {
    const prev = atOrBefore(pts, addDays(p.date, -365));
    if (!prev || prev.date === p.date) continue;
    deltas.push(p.value - prev.value);
  }
  if (deltas.length < H_MIN) return null;
  const x = deltas[deltas.length - 1];
  const mu = mean(deltas);
  const sigma = sampleStdev(deltas);
  return sOfZ((x - mu) / (sigma + 1e-9));
}

function velocityFrom(series: Record<string, Obs[] | undefined>, now: Date): { velocity: number | null; history: number[] | null } {
  const official = fresh(series.M2V, now);
  const source = official.length
    ? last10y(official)
    : ratioPoints(fresh(series.GDP, now), fresh(series.M2SL, now));
  if (!source.length) return { velocity: null, history: null };
  return { velocity: source[source.length - 1].value, history: source.map(p => p.value) };
}

function ratioPoints(gdp: Obs[], money: Obs[]): Obs[] {
  if (!gdp.length || !money.length) return [];
  const out: Obs[] = [];
  for (const g of gdp) {
    const level = atOrBefore(money, g.date);
    if (!level || level.value === 0) continue;
    out.push({ date: g.date, value: g.value / level.value });
  }
  return out;
}

export function stocksFromSeries(
  region: Region,
  series: Record<string, Obs[] | undefined>,
  now: Date,
): StockInputs {
  const debtId = DEBT_ID[region];
  const debtPts = debtId ? series[debtId] : undefined;
  const input: StockInputs = {
    debtGdpPct: latest(debtPts, now),
    fiscalTrend: debtId ? fiscalTrendOf(debtPts, now) : null,
  };
  if (region !== "US") return input;

  const dfii = latest(series.DFII10, now);
  const dgs = latest(series.DGS10, now);
  const cpi = yoyPercent(series.CPIAUCSL, now);
  if (dfii != null) input.realRate = dfii / 100;
  else if (dgs != null && cpi != null) input.realRate = (dgs - cpi) / 100;

  const vel = velocityFrom(series, now);
  input.velocity = vel.velocity;
  input.velocityHistory = vel.history;

  const bond = latest(series.MSPD_MARKETABLE, now);
  const gdp = latest(series.GDP, now);
  if (bond != null) {
    input.bondMarketBn = bond;
    if (gdp != null && gdp !== 0) input.bondMarketGdpPct = (bond / gdp) * 100;
  }
  return input;
}

export function parseFredLevels(csv: string): Obs[] {
  const out: Obs[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    if (!date || raw == null || raw.trim() === ".") continue;
    const value = Number(raw.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || !Number.isFinite(value)) continue;
    out.push({ date: date.trim(), value });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function pointsFromCache(raw: unknown, now: Date): Obs[] | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { fetchedAt?: string; points?: Obs[] };
  if (!row.fetchedAt || !Array.isArray(row.points)) return null;
  const ageH = (now.getTime() - Date.parse(row.fetchedAt)) / 3_600_000;
  if (!Number.isFinite(ageH) || ageH > STOCK_TTL_H) return null;
  return row.points;
}

async function defaultFetchText(url: string, timeoutMs = 12000): Promise<string | null> {
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

export async function fetchRegionalStockInputs(
  region: Region,
  opts: {
    now?: Date;
    cache?: StockFetchCache;
    force?: boolean;
    fetchText?: (url: string) => Promise<string | null>;
  } = {},
): Promise<StockInputs> {
  const now = opts.now ?? new Date();
  const fetchText = opts.fetchText ?? defaultFetchText;
  const series: Record<string, Obs[]> = {};
  await Promise.all(spelledFredIds(region).map(async id => {
    const key = `liqidx_stocks_${region}__${id}`;
    if (!opts.force && opts.cache) {
      const hit = pointsFromCache(opts.cache.get(key), now);
      if (hit) {
        series[id] = hit;
        return;
      }
    }
    const csv = await fetchText(`${FRED_CSV}?id=${encodeURIComponent(id)}&cosd=${monthsAgo(12 * 12, now)}`);
    const points = csv ? parseFredLevels(csv) : [];
    series[id] = points;
    opts.cache?.set(key, { fetchedAt: now.toISOString(), points });
  }));
  if (region === "US") {
    const key = "liqidx_stocks_US__MSPD_MARKETABLE";
    const hit = !opts.force && opts.cache ? pointsFromCache(opts.cache.get(key), now) : null;
    if (hit) {
      series.MSPD_MARKETABLE = hit;
    } else {
      const text = await fetchText(MSPD_MARKETABLE_URL);
      const total = text ? parseMarketableTotal(text) : null;
      const points = total ? [{ date: total.date, value: total.bn }] : [];
      series.MSPD_MARKETABLE = points;
      opts.cache?.set(key, { fetchedAt: now.toISOString(), points });
    }
  }
  return stocksFromSeries(region, series, now);
}
