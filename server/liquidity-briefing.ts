/**
 * Live-Fetch für EZ-Velocity (NGDP/M3), JP-Velocity (NGDP/M2) und APP/PEPP.
 * Spec: Offen_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md
 *
 * US-M2V wird hier nicht geholt. Ein vorhandener C2-Wert darf nur durchgereicht
 * werden. Tote FRED-Spiegel aus §0 werden nicht angefragt.
 */
import type { LiquidityBriefing } from "@shared/schema";
import { catalogSourceUrls, loadBriefingCatalog } from "./liquidity-briefing-catalog";
import {
  CACHE_KEYS,
  EXISTING_US_LIQUIDITY_CACHE_KEY,
  LIVE_FRED_SERIES,
  TTL_MS,
  type AppMonth,
  type DatedValue,
  type PeppMonth,
  type QuarterVelocity,
  isForbiddenFredSeries,
  median,
  parseAppBreakdown,
  parseBojMoneyStock,
  parseBojSeries,
  parseEcbCsv,
  parseFredCsv,
  parsePeppPurchases,
  quarterVelocity,
  roundTo,
  xBotInvalidationKeys,
  yoyPercent,
  bojHundredMillionYenToBillion,
  bojHundredMillionYenToTrillion,
} from "./liquidity-briefing-math";

export const ECB_M3_KEY = "M.U2.Y.V.M30.X.1.U2.2300.Z01.E";
export const ECB_M3_YOY_KEY = "M.U2.Y.V.M30.X.I.U2.2300.Z01.A";
export const ECB_M2_KEY = "M.U2.Y.V.M20.X.1.U2.2300.Z01.E";
export const ECB_M2_YOY_KEY = "M.U2.Y.V.M20.X.I.U2.2300.Z01.A";
export const ECB_M1_KEY = "M.U2.Y.V.M10.X.1.U2.2300.Z01.E";
export const ECB_M1_YOY_KEY = "M.U2.Y.V.M10.X.I.U2.2300.Z01.A";
export const ECB_NGDP_KEY = "Q.Y.I10.W2.S1.S1.B.B1GQ._Z._Z._Z.EUR.V.N";
export const BOJ_M2_CODE = "MAM1NAM2M2MO";
export const BOJ_M2_YOY_CODE = "MAM1YAM2M2MO";
export const BOJ_MB_CODE = "MABS1AN11";
export const BOJ_MB_YOY_CODE = "MABS1AN11@";

const APP_CSV_URL = "https://www.ecb.europa.eu/mopo/pdf/APP_breakdown_history.csv";
const PEPP_CSV_URL = "https://www.ecb.europa.eu/mopo/pdf/PEPP_purchase_history.csv";

export interface BriefingCache {
  get(key: string): { value: unknown; storedAt: number } | null;
  set(key: string, value: unknown, storedAt: number): void;
  delete(key: string): void;
}

export interface RegionVelocity {
  stockBn: number | null;
  yoy: number | null;
  stockAsOf: string | null;
  ngdpAnnualizedBn: number | null;
  ngdpQuarter: string | null;
  velocity: number | null;
  velocityMedian10y: number | null;
}

export interface ProgramLatest {
  period: string | null;
  netBn: number | null;
  holdingsBn: number | null;
  psppNetBn: number | null;
  psppHoldingsBn: number | null;
  cumulativeNetPurchasesBn: number | null;
}

export type { LiquidityBriefing };

interface EuBundle {
  m3: DatedValue[];
  m3Yoy: DatedValue[];
  m2: DatedValue[];
  m2Yoy: DatedValue[];
  m1: DatedValue[];
  m1Yoy: DatedValue[];
  ngdp: DatedValue[];
  app: AppMonth[];
  pepp: PeppMonth[];
}

interface AsiaBundle {
  m2Raw: DatedValue[];
  m2Yoy: DatedValue[];
  ngdp: DatedValue[];
  monetaryBase: DatedValue[];
  monetaryBaseYoy: DatedValue[];
}

export function berlinDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function briefingCacheKey(now = new Date()): string {
  return `briefing_v2__${berlinDate(now)}`;
}

export function berlinHour(now = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now);
  return Number(hour);
}

/** Frisch bis 18:00 Berlin am selben Tag, sonst 6 Stunden. */
export function briefingCacheFresh(storedAt: number, now: Date, value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as { rates?: unknown; spillover?: unknown };
  if (!row.rates || !row.spillover) return false;
  if (now.getTime() < storedAt) return false;
  const saved = new Date(storedAt);
  if (berlinDate(saved) === berlinDate(now) && berlinHour(now) < 18) return true;
  return now.getTime() - storedAt < TTL_MS.briefing;
}

function yearsAgoIso(now: Date, years: number): string {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export function briefingSourceUrls(now = new Date()): { id: string; url: string }[] {
  const start = yearsAgoIso(now, 12);
  const startPeriod = start.slice(0, 7);
  const startCompact = start.slice(0, 4) + start.slice(5, 7);
  const ngdpStart = `${start.slice(0, 4)}-Q1`;
  for (const id of LIVE_FRED_SERIES) {
    if (isForbiddenFredSeries(id)) {
      throw new Error(`Verbotene FRED-Serie im Briefing-Fetch: ${id}`);
    }
  }
  return [
    {
      id: "ECB_M3",
      url: `https://data-api.ecb.europa.eu/service/data/BSI/${ECB_M3_KEY}?startPeriod=${startPeriod}&format=csvdata&detail=dataonly`,
    },
    {
      id: "ECB_M3_YOY",
      url: `https://data-api.ecb.europa.eu/service/data/BSI/${ECB_M3_YOY_KEY}?startPeriod=${startPeriod}&format=csvdata&detail=dataonly`,
    },
    {
      id: "ECB_M2",
      url: `https://data-api.ecb.europa.eu/service/data/BSI/${ECB_M2_KEY}?startPeriod=${startPeriod}&format=csvdata&detail=dataonly`,
    },
    {
      id: "ECB_M2_YOY",
      url: `https://data-api.ecb.europa.eu/service/data/BSI/${ECB_M2_YOY_KEY}?startPeriod=${startPeriod}&format=csvdata&detail=dataonly`,
    },
    {
      id: "ECB_M1",
      url: `https://data-api.ecb.europa.eu/service/data/BSI/${ECB_M1_KEY}?startPeriod=${startPeriod}&format=csvdata&detail=dataonly`,
    },
    {
      id: "ECB_M1_YOY",
      url: `https://data-api.ecb.europa.eu/service/data/BSI/${ECB_M1_YOY_KEY}?startPeriod=${startPeriod}&format=csvdata&detail=dataonly`,
    },
    {
      id: "ECB_NGDP",
      url: `https://data-api.ecb.europa.eu/service/data/MNA/${ECB_NGDP_KEY}?startPeriod=${ngdpStart}&format=csvdata&detail=dataonly`,
    },
    { id: "APP", url: APP_CSV_URL },
    { id: "PEPP", url: PEPP_CSV_URL },
    {
      id: "BOJ_M2",
      url: `https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD02&code=${BOJ_M2_CODE},${BOJ_M2_YOY_CODE}&startDate=${startCompact}`,
    },
    {
      id: "BOJ_MB",
      url: `https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=csv&lang=en&db=MD01&code=${BOJ_MB_CODE},${encodeURIComponent(BOJ_MB_YOY_CODE)}&startDate=${startCompact}`,
    },
    {
      id: "JPNNGDP",
      url: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=JPNNGDP&cosd=${start}`,
    },
    ...catalogSourceUrls(now),
  ];
}

async function diskCache(): Promise<BriefingCache> {
  const { diskResearcherDelete, diskResearcherGet, diskResearcherSet } = await import("./disk-cache");
  return {
    get(key) {
      const row = diskResearcherGet(key);
      if (!row || typeof row.storedAt !== "number") return null;
      return { value: row.value, storedAt: row.storedAt };
    },
    set(key, value, storedAt) {
      diskResearcherSet(key, { value, storedAt });
    },
    delete(key) {
      diskResearcherDelete(key);
    },
  };
}

export function memoryBriefingCache(): BriefingCache {
  const map = new Map<string, { value: unknown; storedAt: number }>();
  return {
    get(key) {
      return map.get(key) ?? null;
    },
    set(key, value, storedAt) {
      map.set(key, { value, storedAt });
    },
    delete(key) {
      map.delete(key);
    },
  };
}

function fresh(entry: { storedAt: number } | null, ttl: number, nowMs: number): boolean {
  return !!entry && nowMs - entry.storedAt < ttl;
}

function cachedHasList(value: unknown, key: string): boolean {
  return !!value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key]);
}

function lastPoint(points: DatedValue[] | undefined): DatedValue | null {
  const sorted = [...(points ?? [])].filter(p => Number.isFinite(p.value)).sort((a, b) => a.period.localeCompare(b.period));
  return sorted.length ? sorted[sorted.length - 1] : null;
}

async function fetchText(url: string, fetchImpl: typeof fetch): Promise<string> {
  if (/[?&]id=([^&]+)/.test(url)) {
    const id = decodeURIComponent(url.match(/[?&]id=([^&]+)/)![1]);
    if (isForbiddenFredSeries(id)) throw new Error(`Fetch blockiert: ${id}`);
  }
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetchImpl(url, {
        signal: AbortSignal.timeout(20000),
        headers: { Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8" },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      let text = new TextDecoder("utf-8").decode(buf);
      if (url.includes("jgbcm")) {
        const sjis = new TextDecoder("shift_jis").decode(buf);
        if (sjis.includes("10年")) text = sjis;
      }
      if (!text || text.includes("<html") || text.includes("<!DOCTYPE")) {
        throw new Error("HTML statt CSV");
      }
      return text;
    } catch (err: any) {
      lastError = err?.message || "fetch failed";
    }
  }
  console.warn(`[liquidity-briefing] ${lastError} ${url}`);
  return "";
}

function emptyRegion(): RegionVelocity {
  return {
    stockBn: null, yoy: null, stockAsOf: null,
    ngdpAnnualizedBn: null, ngdpQuarter: null,
    velocity: null, velocityMedian10y: null,
  };
}

function velocityBlock(
  series: QuarterVelocity[],
  stockBn: number | null,
  yoy: number | null,
  stockAsOf: string | null,
): RegionVelocity {
  const latest = series.length ? series[series.length - 1] : null;
  const tail = series.slice(-40).map(p => p.velocity);
  const med = median(tail);
  return {
    stockBn,
    yoy,
    stockAsOf,
    ngdpAnnualizedBn: latest ? roundTo(latest.ngdpAnnualized, 1) : null,
    ngdpQuarter: latest?.quarter ?? null,
    velocity: latest ? roundTo(latest.velocity, 3) : null,
    velocityMedian10y: med == null ? null : roundTo(med, 3),
  };
}

function latestApp(rows: AppMonth[]): ProgramLatest {
  const last = rows.length ? rows[rows.length - 1] : null;
  if (!last) {
    return { period: null, netBn: null, holdingsBn: null, psppNetBn: null, psppHoldingsBn: null, cumulativeNetPurchasesBn: null };
  }
  return {
    period: last.period,
    netBn: roundTo(last.netBn, 3),
    holdingsBn: roundTo(last.holdingsBn, 3),
    psppNetBn: roundTo(last.psppNetBn, 3),
    psppHoldingsBn: roundTo(last.psppHoldingsBn, 3),
    cumulativeNetPurchasesBn: null,
  };
}

function latestPepp(rows: PeppMonth[]): ProgramLatest {
  const last = rows.length ? rows[rows.length - 1] : null;
  if (!last) {
    return { period: null, netBn: null, holdingsBn: null, psppNetBn: null, psppHoldingsBn: null, cumulativeNetPurchasesBn: null };
  }
  return {
    period: last.period,
    netBn: roundTo(last.netBn, 3),
    holdingsBn: null,
    psppNetBn: null,
    psppHoldingsBn: null,
    cumulativeNetPurchasesBn: roundTo(last.cumulativeNetPurchasesBn, 3),
  };
}

function m3ToBn(points: DatedValue[]): DatedValue[] {
  return points.map(p => ({ period: p.period, value: p.value / 1000 }));
}

function ngdpMillionsToBn(points: DatedValue[]): DatedValue[] {
  return points.map(p => ({ period: p.period, value: p.value / 1000 }));
}

async function readExistingUsLiquidity(): Promise<{ velocity: number | null; emg: number | null; velocityMedian10y: number | null }> {
  const { diskResearcherGet } = await import("./disk-cache");
  const row = diskResearcherGet(EXISTING_US_LIQUIDITY_CACHE_KEY);
  const velocity = typeof row?.velocity === "number" && Number.isFinite(row.velocity) ? row.velocity : null;
  const emg = typeof row?.excessMoneyGrowth === "number" && Number.isFinite(row.excessMoneyGrowth) ? row.excessMoneyGrowth : null;
  const velocityMedian10y = typeof row?.velocityMedian10y === "number" && Number.isFinite(row.velocityMedian10y) ? row.velocityMedian10y : null;
  return { velocity, emg, velocityMedian10y };
}

export async function applyXBotPing(
  account: string,
  text: string,
  cache?: BriefingCache,
  now = new Date(),
): Promise<string[]> {
  const store = cache ?? await diskCache();
  const keys = xBotInvalidationKeys(account, text);
  if (keys.length === 0) return [];
  const briefingKey = briefingCacheKey(now);
  for (const key of keys) store.delete(key);
  store.delete(briefingKey);
  return [...keys, briefingKey];
}

export async function fetchLiquidityBriefing(opts: {
  fetchImpl?: typeof fetch;
  now?: Date;
  cache?: BriefingCache;
  refresh?: boolean;
  readUsLiquidity?: () => { velocity: number | null; emg: number | null; velocityMedian10y?: number | null } | Promise<{ velocity: number | null; emg: number | null; velocityMedian10y?: number | null }>;
} = {}): Promise<LiquidityBriefing> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const cache = opts.cache ?? await diskCache();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const readUs = opts.readUsLiquidity ?? readExistingUsLiquidity;
  const briefingKey = briefingCacheKey(now);

  if (opts.refresh) {
    cache.delete(briefingKey);
    cache.delete(CACHE_KEYS.us);
    cache.delete(CACHE_KEYS.eu);
    cache.delete(CACHE_KEYS.euM3);
    cache.delete(CACHE_KEYS.asia);
  }

  const cachedBriefing = cache.get(briefingKey);
  if (!opts.refresh && cachedBriefing && briefingCacheFresh(cachedBriefing.storedAt, now, cachedBriefing.value)) {
    return cachedBriefing.value as LiquidityBriefing;
  }

  const urls = briefingSourceUrls(now);
  const byId = Object.fromEntries(urls.map(u => [u.id, u.url]));

  let eu = cache.get(CACHE_KEYS.eu);
  if (!fresh(eu, TTL_MS.euAppPep, nowMs) || !cachedHasList(eu?.value, "m1")) eu = null;
  let m3Entry = cache.get(CACHE_KEYS.euM3);
  if (!fresh(m3Entry, TTL_MS.euM3, nowMs)) m3Entry = null;
  let asia = cache.get(CACHE_KEYS.asia);
  if (!fresh(asia, TTL_MS.asia, nowMs) || !cachedHasList(asia?.value, "monetaryBase")) asia = null;

  if (!eu || !m3Entry) {
    const [m3Csv, m3YoyCsv, m2Csv, m2YoyCsv, m1Csv, m1YoyCsv, ngdpCsv, appCsv, peppCsv] = await Promise.all([
      fetchText(byId.ECB_M3, fetchImpl).catch(() => ""),
      fetchText(byId.ECB_M3_YOY, fetchImpl).catch(() => ""),
      fetchText(byId.ECB_M2, fetchImpl).catch(() => ""),
      fetchText(byId.ECB_M2_YOY, fetchImpl).catch(() => ""),
      fetchText(byId.ECB_M1, fetchImpl).catch(() => ""),
      fetchText(byId.ECB_M1_YOY, fetchImpl).catch(() => ""),
      fetchText(byId.ECB_NGDP, fetchImpl).catch(() => ""),
      fetchText(byId.APP, fetchImpl).catch(() => ""),
      fetchText(byId.PEPP, fetchImpl).catch(() => ""),
    ]);
    const bundle: EuBundle = {
      m3: parseEcbCsv(m3Csv).sort((a, b) => a.period.localeCompare(b.period)),
      m3Yoy: parseEcbCsv(m3YoyCsv).sort((a, b) => a.period.localeCompare(b.period)),
      m2: parseEcbCsv(m2Csv).sort((a, b) => a.period.localeCompare(b.period)),
      m2Yoy: parseEcbCsv(m2YoyCsv).sort((a, b) => a.period.localeCompare(b.period)),
      m1: parseEcbCsv(m1Csv).sort((a, b) => a.period.localeCompare(b.period)),
      m1Yoy: parseEcbCsv(m1YoyCsv).sort((a, b) => a.period.localeCompare(b.period)),
      ngdp: parseEcbCsv(ngdpCsv).sort((a, b) => a.period.localeCompare(b.period)),
      app: parseAppBreakdown(appCsv).sort((a, b) => a.period.localeCompare(b.period)),
      pepp: parsePeppPurchases(peppCsv).sort((a, b) => a.period.localeCompare(b.period)),
    };
    eu = { value: bundle, storedAt: nowMs };
    if (bundle.m3.length) {
      cache.set(CACHE_KEYS.eu, bundle, nowMs);
      cache.set(CACHE_KEYS.euM3, { m3: bundle.m3, ngdp: bundle.ngdp, m3Yoy: bundle.m3Yoy }, nowMs);
    }
  }

  if (!asia) {
    const [m2Csv, ngdpCsv, mbCsv] = await Promise.all([
      fetchText(byId.BOJ_M2, fetchImpl).catch(() => ""),
      fetchText(byId.JPNNGDP, fetchImpl).catch(() => ""),
      fetchText(byId.BOJ_MB, fetchImpl).catch(() => ""),
    ]);
    const bundle: AsiaBundle = {
      m2Raw: parseBojMoneyStock(m2Csv),
      m2Yoy: parseBojSeries(m2Csv, BOJ_M2_YOY_CODE),
      ngdp: parseFredCsv(ngdpCsv).sort((a, b) => a.period.localeCompare(b.period)),
      monetaryBase: parseBojSeries(mbCsv, BOJ_MB_CODE),
      monetaryBaseYoy: parseBojSeries(mbCsv, BOJ_MB_YOY_CODE),
    };
    asia = { value: bundle, storedAt: nowMs };
    if (bundle.m2Raw.length) cache.set(CACHE_KEYS.asia, bundle, nowMs);
  }

  const euBundle: EuBundle = (eu?.value as EuBundle) || {
    m3: [], m3Yoy: [], m2: [], m2Yoy: [], m1: [], m1Yoy: [], ngdp: [], app: [], pepp: [],
  };
  const asiaBundle: AsiaBundle = (asia?.value as AsiaBundle) || {
    m2Raw: [], m2Yoy: [], ngdp: [], monetaryBase: [], monetaryBaseYoy: [],
  };

  const m3Bn = m3ToBn(euBundle.m3 || []);
  const ezNgdpBn = ngdpMillionsToBn(euBundle.ngdp || []);
  const ezSeries = quarterVelocity({ ngdp: ezNgdpBn, moneyMonthly: m3Bn, annualizeNgdp: true });
  const m3Last = m3Bn.length ? m3Bn[m3Bn.length - 1] : null;
  const m3Official = euBundle.m3Yoy?.length ? euBundle.m3Yoy[euBundle.m3Yoy.length - 1].value : null;
  const m3Yoy = m3Official ?? yoyPercent(m3Bn)?.latest ?? null;
  const m1Last = lastPoint(m3ToBn(euBundle.m1 || []));
  const m2EzLast = lastPoint(m3ToBn(euBundle.m2 || []));
  const m1YoyLast = lastPoint(euBundle.m1Yoy || []);
  const m2YoyLast = lastPoint(euBundle.m2Yoy || []);
  const eurozone = {
    ...velocityBlock(
      ezSeries,
      m3Last ? roundTo(m3Last.value, 1) : null,
      m3Yoy == null ? null : roundTo(m3Yoy, 2),
      m3Last?.period ?? null,
    ),
    m1StockBn: m1Last ? roundTo(m1Last.value, 1) : null,
    m1Yoy: m1YoyLast ? roundTo(m1YoyLast.value, 2) : null,
    m1AsOf: m1Last?.period ?? null,
    m2StockBn: m2EzLast ? roundTo(m2EzLast.value, 1) : null,
    m2Yoy: m2YoyLast ? roundTo(m2YoyLast.value, 2) : null,
    m2AsOf: m2EzLast?.period ?? null,
  };

  const m2Bn = (asiaBundle.m2Raw || []).map(p => ({
    period: p.period,
    value: bojHundredMillionYenToBillion(p.value),
  }));
  const jpSeries = quarterVelocity({
    ngdp: asiaBundle.ngdp || [],
    moneyMonthly: m2Bn,
    annualizeNgdp: false,
  });
  const m2Last = m2Bn.length ? m2Bn[m2Bn.length - 1] : null;
  const m2Official = asiaBundle.m2Yoy?.length ? asiaBundle.m2Yoy[asiaBundle.m2Yoy.length - 1].value : null;
  const m2Yoy = m2Official ?? yoyPercent(m2Bn)?.latest ?? null;
  const mbLast = lastPoint(asiaBundle.monetaryBase || []);
  const mbYoyLast = lastPoint(asiaBundle.monetaryBaseYoy || []);
  const japan = {
    ...velocityBlock(
      jpSeries,
      m2Last ? roundTo(m2Last.value, 1) : null,
      m2Yoy == null ? null : roundTo(m2Yoy, 2),
      m2Last?.period ?? null,
    ),
    monetaryBaseTn: mbLast ? roundTo(bojHundredMillionYenToTrillion(mbLast.value), 3) : null,
    monetaryBaseYoy: mbYoyLast ? roundTo(mbYoyLast.value, 1) : null,
    monetaryBaseAsOf: mbLast?.period ?? null,
  };

  const app = latestApp(euBundle.app || []);
  const pepp = latestPepp(euBundle.pepp || []);
  const usLiquidity = await readUs();
  const catalog = await loadBriefingCatalog(now, {
    usVelocity: usLiquidity.velocity,
    usVelocityMedian: usLiquidity.velocityMedian10y ?? null,
    jpVelocity: japan.velocity,
    jpVelocityMedian: japan.velocityMedian10y,
    ezVelocity: eurozone.velocity,
    ezVelocityMedian: eurozone.velocityMedian10y,
    jpMoneyBn: japan.stockBn,
    fRestBn: null,
    deltaMBn: null,
    app: euBundle.app || [],
    pepp: euBundle.pepp || [],
  }, url => fetchText(url, fetchImpl));

  cache.set(CACHE_KEYS.us, {
    rates: catalog.rates,
    books: catalog.books.us,
    qra: catalog.qra,
  }, nowMs);
  const euRow = cache.get(CACHE_KEYS.eu);
  if (euRow && euRow.value && typeof euRow.value === "object") {
    cache.set(CACHE_KEYS.eu, { ...(euRow.value as object), wfsDepositsBn: catalog.books.eu.wfsDepositsBn }, euRow.storedAt);
  }
  const asiaRow = cache.get(CACHE_KEYS.asia);
  if (asiaRow && asiaRow.value && typeof asiaRow.value === "object") {
    cache.set(CACHE_KEYS.asia, { ...(asiaRow.value as object), assetsTn: catalog.books.jp.assetsTn }, asiaRow.storedAt);
  }

  const payload: LiquidityBriefing = {
    asOf: berlinDate(now),
    eurozone,
    japan,
    app,
    pepp,
    us: {
      velocity: usLiquidity.velocity,
      emg: usLiquidity.emg,
      velocityMedian10y: usLiquidity.velocityMedian10y ?? null,
      source: usLiquidity.velocity == null ? null : "liquidity-regime",
    },
    sources: {
      m3: "ECB BSI M1/M2/M3 outstanding",
      ngdpEa: "ECB MNA nominal GDP EA21",
      m2: "BoJ MD02 MAM1NAM2M2MO",
      ngdpJp: "FRED JPNNGDP",
      app: APP_CSV_URL,
      pepp: PEPP_CSV_URL,
      rates: "FRED DFII10 DGS10 T10YIE IRLTLT01JPM156N JPNCPIALLMINMEI",
      mof: "MoF jgbcm.csv",
      mspd: "FiscalData MSPD marketable bills",
      wfs: "ECB ILM government deposits",
    },
    cache: {
      us: CACHE_KEYS.us,
      eu: CACHE_KEYS.eu,
      m3: CACHE_KEYS.euM3,
      asia: CACHE_KEYS.asia,
      briefing: briefingKey,
    },
    available: {
      ez: eurozone.velocity != null,
      jp: japan.velocity != null,
      app: app.netBn != null,
      pepp: pepp.netBn != null,
    },
    ...catalog,
  };

  if (payload.available.ez && payload.available.jp && payload.available.app && payload.available.pepp) {
    cache.set(briefingKey, payload, nowMs);
  }
  return payload;
}
