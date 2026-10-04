/**
 * Reads the series named in WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY §5 and
 * maps them onto StockInputs. T½, the velocity clip, and π stay in
 * liquidity-stocks-velocity.ts.
 *
 * EZ debt %GDP and debt securities come from Eurostat EDP (gov_10q_ggdebt).
 * The FRED mirror GGGDTPEZA188N stops in 2016, so it is only a fallback.
 * EZ HICP is Eurostat CP00 annual rate (the spec's CP HP). EZ velocity is
 * NGDP/M3 and JP velocity is NGDP/M2, same parsers as the briefing.
 * Capex prose budgets are not parsed into F.
 */
import { diskResearcherGet } from "./disk-cache";
import type { Region } from "./liquidity-index-catalog";
import { BOJ_M2_CODE, ECB_M3_KEY, ECB_NGDP_KEY } from "./liquidity-briefing";
import {
  bojHundredMillionYenToBillion,
  parseBojMoneyStock,
  parseEcbCsv,
  quarterVelocity,
} from "./liquidity-briefing-math";
import { H_MIN, sOfZ, type Obs } from "./liquidity-index-math";
import type { StockInputs } from "./liquidity-stocks-velocity";

const STALE_DAYS = 450;
/** Annual IMF debt prints lag. Five years still shows Japan 2023 in 2026. */
const DEBT_STALE_DAYS = 365 * 5;
const STOCK_TTL_H = 6;
const FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const ECB_DATA = "https://data-api.ecb.europa.eu/service/data";

export const MSPD_MARKETABLE_URL =
  "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/debt/mspd/mspd_table_1" +
  "?filter=security_type_desc:eq:Marketable" +
  "&sort=-record_date&page[size]=100&fields=record_date,security_class_desc,total_mil_amt";

const US_IDS = ["GFDEGDQ188S", "DFII10", "DGS10", "CPIAUCSL", "M2V", "M2SL", "GDP", "GDPC1"] as const;
const EU_IDS = ["GGGDTPEZA188N", "IRLTLT01EZM156N"] as const;
const ASIA_IDS = ["GGGDTAJPA188N", "IRLTLT01JPM156N", "JPNCPIALLMINMEI", "FPCPITOTLZGJPN", "JPNNGDP"] as const;

export interface StockFetchCache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export function spelledFredIds(region: Region): string[] {
  if (region === "US") return [...US_IDS];
  if (region === "EU") return [...EU_IDS];
  return [...ASIA_IDS];
}

export function eurostatDebtGdpUrl(now: Date): string {
  return eurostatUrl("gov_10q_ggdebt", "geo=EA20&na_item=GD&sector=S13&unit=PC_GDP", `${now.getUTCFullYear() - 12}-Q1`);
}

export function eurostatDebtSecUrl(now: Date): string {
  return eurostatUrl("gov_10q_ggdebt", "geo=EA20&na_item=F3&sector=S13&unit=MIO_EUR", `${now.getUTCFullYear() - 12}-Q1`);
}

/** CP00 all-items HICP, annual rate of change. That is the spec's CP HP. */
export function eurostatHicpUrl(now: Date): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return eurostatUrl("prc_hicp_manr", "geo=EA&coicop=CP00&unit=RCH_A", `${now.getUTCFullYear() - 12}-${month}`);
}

function eurostatUrl(dataset: string, query: string, since: string): string {
  return `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${dataset}?${query}&sinceTimePeriod=${since}&format=JSON&lang=EN`;
}

export function ecbM3Url(now: Date): string {
  return `${ECB_DATA}/BSI/${ECB_M3_KEY}?startPeriod=${now.getUTCFullYear() - 12}-01&format=csvdata&detail=dataonly`;
}

export function ecbNgdpUrl(now: Date): string {
  return `${ECB_DATA}/MNA/${ECB_NGDP_KEY}?startPeriod=${now.getUTCFullYear() - 12}-Q1&format=csvdata&detail=dataonly`;
}

export function bojM2Url(now: Date): string {
  const start = new Date(now.getTime());
  start.setUTCFullYear(start.getUTCFullYear() - 12);
  const compact = start.toISOString().slice(0, 7).replace("-", "");
  return `https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD02&code=${BOJ_M2_CODE}&startDate=${compact}`;
}

export function fiscalRestFromCache(raw: unknown): { fiscalRestBn: number | null; tMidYears: number | null } {
  if (!raw || typeof raw !== "object") return { fiscalRestBn: null, tMidYears: null };
  const row = raw as Record<string, unknown>;
  return {
    fiscalRestBn: finiteNonNegative(row.fiscalRestBn),
    tMidYears: finiteNonNegative(row.tMidYears),
  };
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function applyCapexRest(
  input: StockInputs,
  rest: { fiscalRestBn: number | null; tMidYears: number | null },
): StockInputs {
  if (rest.fiscalRestBn == null) return input;
  const next: StockInputs = { ...input, fiscalRestBn: rest.fiscalRestBn };
  if (rest.tMidYears != null) next.tMidYears = rest.tMidYears;
  const money = input.moneyStockBn;
  if (money != null && Number.isFinite(money) && money > 0) next.fiscalOverMoney = rest.fiscalRestBn / money;
  return next;
}

export function parseEurostatJson(text: string, scale = 1): Obs[] {
  try {
    const parsed = JSON.parse(text) as {
      value?: Record<string, number>;
      dimension?: { time?: { category?: { index?: Record<string, number> } } };
    };
    const index = parsed.dimension?.time?.category?.index;
    if (!index || !parsed.value) return [];
    const out: Obs[] = [];
    for (const [label, idx] of Object.entries(index)) {
      const date = periodToIso(label);
      const value = Number(parsed.value[String(idx)]);
      if (!date || !Number.isFinite(value)) continue;
      out.push({ date, value: value * scale });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function periodToIso(token: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const quarter = /^(\d{4})-Q([1-4])$/i.exec(token.trim());
  if (quarter) {
    const month = (Number(quarter[2]) - 1) * 3 + 1;
    return `${quarter[1]}-${String(month).padStart(2, "0")}-01`;
  }
  if (/^\d{4}-\d{2}$/.test(token)) return `${token}-01`;
  if (/^\d{4}$/.test(token)) return `${token}-01-01`;
  return null;
}

function datedFromEcb(csv: string, scale: number): Obs[] {
  return parseEcbCsv(csv).flatMap(row => {
    const date = periodToIso(row.period);
    return date ? [{ date, value: row.value * scale }] : [];
  });
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

function fresh(points: Obs[] | undefined, now: Date, staleDays = STALE_DAYS): Obs[] {
  const pts = sorted(points);
  if (!pts.length) return [];
  const cutoff = addDays(now.toISOString().slice(0, 10), -staleDays);
  if (pts[pts.length - 1].date < cutoff) return [];
  return pts;
}

function latest(points: Obs[] | undefined, now: Date, staleDays = STALE_DAYS): number | null {
  const pts = fresh(points, now, staleDays);
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

function fiscalTrendOf(points: Obs[] | undefined, now: Date, staleDays = STALE_DAYS): number | null {
  const pts = fresh(points, now, staleDays);
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

function yoySeries(points: Obs[] | undefined, now: Date): Obs[] {
  const pts = fresh(points, now);
  const out: Obs[] = [];
  for (const p of pts) {
    const prev = atOrBefore(pts, addDays(p.date, -365));
    if (!prev || prev.date === p.date || prev.value === 0) continue;
    out.push({ date: p.date, value: ((p.value - prev.value) / Math.abs(prev.value)) * 100 });
  }
  return out;
}

function realFromNominal(nominalPct: Obs[], inflationPct: Obs[]): Obs[] {
  const out: Obs[] = [];
  for (const y of nominalPct) {
    const infl = atOrBefore(inflationPct, y.date);
    if (!infl) continue;
    out.push({ date: y.date, value: y.value - infl.value });
  }
  return out;
}

function annualChangeStats(levelsPct: Obs[]): { delta: number; sigma: number } | null {
  const deltas: number[] = [];
  for (const p of levelsPct) {
    const prev = atOrBefore(levelsPct, addDays(p.date, -365));
    if (!prev || prev.date === p.date) continue;
    deltas.push((p.value - prev.value) / 100);
  }
  if (deltas.length < 2) return null;
  const sigma = sampleStdev(deltas);
  if (!(sigma > 0)) return null;
  return { delta: deltas[deltas.length - 1], sigma };
}

function quarterStart(token: string): string | null {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(token);
  if (!quarter) return null;
  const month = (Number(quarter[2]) - 1) * 3 + 1;
  return `${quarter[1]}-${String(month).padStart(2, "0")}-01`;
}

function velocityNgdpOverM(ngdp: Obs[], money: Obs[], annualizeNgdp: boolean): { velocity: number | null; history: number[] | null } {
  const series = quarterVelocity({
    ngdp: ngdp.map(p => ({ period: p.date, value: p.value })),
    moneyMonthly: money.map(p => ({ period: p.date, value: p.value })),
    annualizeNgdp,
  });
  if (!series.length) return { velocity: null, history: null };
  const dated = series.flatMap(row => {
    const date = quarterStart(row.quarter);
    return date ? [{ date, value: row.velocity }] : [];
  });
  const window = last10y(dated);
  if (!window.length) return { velocity: null, history: null };
  return { velocity: window[window.length - 1].value, history: window.map(p => p.value) };
}

function attachRealRate(input: StockInputs, realPct: Obs[]): void {
  if (!realPct.length) return;
  input.realRate = realPct[realPct.length - 1].value / 100;
  const stats = annualChangeStats(realPct);
  if (!stats) return;
  input.deltaR = stats.delta;
  input.sigmaDeltaR = stats.sigma;
}

function debtObs(region: Region, series: Record<string, Obs[] | undefined>, now: Date): Obs[] {
  if (region === "EU") {
    const live = fresh(series.EZ_DEBT_GDP, now, STALE_DAYS);
    if (live.length) return live;
    return fresh(series.GGGDTPEZA188N, now, DEBT_STALE_DAYS);
  }
  if (region === "ASIA") return fresh(series.GGGDTAJPA188N, now, DEBT_STALE_DAYS);
  return fresh(series.GFDEGDQ188S, now, STALE_DAYS);
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
  const debtPts = debtObs(region, series, now);
  const debtWindow = region === "US" ? STALE_DAYS : region === "EU" && fresh(series.EZ_DEBT_GDP, now).length ? STALE_DAYS : DEBT_STALE_DAYS;
  const input: StockInputs = {
    debtGdpPct: debtPts.length ? debtPts[debtPts.length - 1].value : null,
    fiscalTrend: debtPts.length ? fiscalTrendOf(debtPts, now, debtWindow) : null,
  };
  if (region === "US") fillUs(input, series, now);
  else if (region === "EU") fillEu(input, series, now);
  else fillAsia(input, series, now);
  return input;
}

function fillUs(input: StockInputs, series: Record<string, Obs[] | undefined>, now: Date): void {
  const dfii = fresh(series.DFII10, now);
  const dgs = latest(series.DGS10, now);
  const cpi = yoyPercent(series.CPIAUCSL, now);
  if (dfii.length) attachRealRate(input, dfii);
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

  const m2 = yoyPercent(series.M2SL, now);
  const realGdp = yoyPercent(series.GDPC1, now);
  if (m2 != null) {
    input.m2YoY = m2;
    input.deltaMObs = m2 / 100;
  }
  if (realGdp != null) input.realGdpYoY = realGdp;
  if (cpi != null) input.cpiYoY = cpi;
  const money = latest(series.M2SL, now);
  if (money != null) input.moneyStockBn = money;
}

function fillEu(input: StockInputs, series: Record<string, Obs[] | undefined>, now: Date): void {
  const realPct = realFromNominal(fresh(series.IRLTLT01EZM156N, now), fresh(series.EZ_HICP_YOY, now));
  attachRealRate(input, realPct);

  const m3 = fresh(series.ECB_M3, now);
  const ngdp = fresh(series.ECB_NGDP, now);
  const vel = velocityNgdpOverM(ngdp, m3, true);
  input.velocity = vel.velocity;
  input.velocityHistory = vel.history;

  const bond = latest(series.EZ_DEBT_SEC, now);
  const ngdpLevel = ngdp.length ? ngdp[ngdp.length - 1].value : null;
  if (bond != null) {
    input.bondMarketBn = bond;
    if (ngdpLevel != null && ngdpLevel !== 0) input.bondMarketGdpPct = (bond / (ngdpLevel * 4)) * 100;
  }
  const m3Yoy = yoyPercent(series.ECB_M3, now);
  if (m3Yoy != null) {
    input.m2YoY = m3Yoy;
    input.deltaMObs = m3Yoy / 100;
  }
  if (m3.length) input.moneyStockBn = m3[m3.length - 1].value;
}

function japanInflationPct(series: Record<string, Obs[] | undefined>, now: Date): Obs[] {
  const monthly = yoySeries(series.JPNCPIALLMINMEI, now);
  if (monthly.length) return monthly;
  // JPNCPIALLMINMEI stops in 2021. FPCPITOTLZGJPN is the annual percent fallback.
  return fresh(series.FPCPITOTLZGJPN, now, DEBT_STALE_DAYS);
}

function fillAsia(input: StockInputs, series: Record<string, Obs[] | undefined>, now: Date): void {
  const cpiYoy = japanInflationPct(series, now);
  const realPct = realFromNominal(fresh(series.IRLTLT01JPM156N, now), cpiYoy);
  attachRealRate(input, realPct);

  const m2 = fresh(series.BOJ_M2, now);
  const ngdp = fresh(series.JPNNGDP, now);
  const vel = velocityNgdpOverM(ngdp, m2, false);
  input.velocity = vel.velocity;
  input.velocityHistory = vel.history;

  const m2Yoy = yoyPercent(series.BOJ_M2, now);
  if (m2Yoy != null) {
    input.m2YoY = m2Yoy;
    input.deltaMObs = m2Yoy / 100;
  }
  if (cpiYoy.length) input.cpiYoY = cpiYoy[cpiYoy.length - 1].value;
  if (m2.length) input.moneyStockBn = m2[m2.length - 1].value;
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

async function defaultFetchText(url: string, timeoutMs = 20000): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!resp.ok) return null;
      const text = await resp.text();
      if (!text || text.includes("<!DOCTYPE") || text.includes("<html")) return null;
      return text;
    } catch {
      if (attempt === 1) return null;
    }
  }
  return null;
}

async function loadPoints(
  region: Region,
  id: string,
  now: Date,
  opts: { cache?: StockFetchCache; force?: boolean },
  load: () => Promise<Obs[]>,
): Promise<Obs[]> {
  const key = `liqidx_stocks_${region}__${id}`;
  if (!opts.force && opts.cache) {
    const hit = pointsFromCache(opts.cache.get(key), now);
    if (hit) return hit;
  }
  const points = await load();
  opts.cache?.set(key, { fetchedAt: now.toISOString(), points });
  return points;
}

function defaultFiscalRest(region: Region): { fiscalRestBn: number | null; tMidYears: number | null } {
  try {
    return fiscalRestFromCache(diskResearcherGet(`capex__${region}`));
  } catch {
    return { fiscalRestBn: null, tMidYears: null };
  }
}

export async function fetchRegionalStockInputs(
  region: Region,
  opts: {
    now?: Date;
    cache?: StockFetchCache;
    force?: boolean;
    fetchText?: (url: string) => Promise<string | null>;
    readFiscalRest?: (region: Region) => { fiscalRestBn: number | null; tMidYears: number | null };
  } = {},
): Promise<StockInputs> {
  const now = opts.now ?? new Date();
  const fetchText = opts.fetchText ?? defaultFetchText;
  const series: Record<string, Obs[]> = {};
  const fredStart = monthsAgo(30 * 12, now);
  await Promise.all(spelledFredIds(region).map(async id => {
    series[id] = await loadPoints(region, id, now, opts, async () => {
      const csv = await fetchText(`${FRED_CSV}?id=${encodeURIComponent(id)}&cosd=${fredStart}`);
      return csv ? parseFredLevels(csv) : [];
    });
  }));
  if (region === "US") {
    series.MSPD_MARKETABLE = await loadPoints(region, "MSPD_MARKETABLE", now, opts, async () => {
      const text = await fetchText(MSPD_MARKETABLE_URL);
      const total = text ? parseMarketableTotal(text) : null;
      return total ? [{ date: total.date, value: total.bn }] : [];
    });
  }
  if (region === "EU") {
    const [debt, bonds, hicp, m3, ngdp] = await Promise.all([
      loadPoints(region, "EZ_DEBT_GDP", now, opts, async () => {
        const text = await fetchText(eurostatDebtGdpUrl(now));
        return text ? parseEurostatJson(text) : [];
      }),
      loadPoints(region, "EZ_DEBT_SEC", now, opts, async () => {
        const text = await fetchText(eurostatDebtSecUrl(now));
        return text ? parseEurostatJson(text, 1 / 1000) : [];
      }),
      loadPoints(region, "EZ_HICP_YOY", now, opts, async () => {
        const text = await fetchText(eurostatHicpUrl(now));
        return text ? parseEurostatJson(text) : [];
      }),
      loadPoints(region, "ECB_M3", now, opts, async () => {
        const text = await fetchText(ecbM3Url(now));
        return text ? datedFromEcb(text, 1 / 1000) : [];
      }),
      loadPoints(region, "ECB_NGDP", now, opts, async () => {
        const text = await fetchText(ecbNgdpUrl(now));
        return text ? datedFromEcb(text, 1 / 1000) : [];
      }),
    ]);
    series.EZ_DEBT_GDP = debt;
    series.EZ_DEBT_SEC = bonds;
    series.EZ_HICP_YOY = hicp;
    series.ECB_M3 = m3;
    series.ECB_NGDP = ngdp;
  }
  if (region === "ASIA") {
    series.BOJ_M2 = await loadPoints(region, "BOJ_M2", now, opts, async () => {
      const text = await fetchText(bojM2Url(now));
      if (!text) return [];
      return parseBojMoneyStock(text).flatMap(row => {
        const date = periodToIso(row.period);
        return date ? [{ date, value: bojHundredMillionYenToBillion(row.value) }] : [];
      });
    });
  }
  const rest = (opts.readFiscalRest ?? defaultFiscalRest)(region);
  return applyCapexRest(stocksFromSeries(region, series, now), rest);
}
