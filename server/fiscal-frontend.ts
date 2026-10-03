/**
 * Fiskal-Frontend — Abruf und Cache.
 *
 * UI StablecoinLiquidityPanel
 *   → GET /api/analyze-btc/fiscal-frontend
 *     → assembleFiscalFrontend
 *       → MSPD, Auctions, DTS, FRED WSHOBL/WSHOTSL/DFF/WALCL/RRP/WTREGEN, Buybacks-Ops
 *       → Schema FiscalFrontendPayload
 *
 * QRA bleibt das JSON in qra-snapshot.ts. Kein Cron, kein LLM.
 */
import { diskResearcherGet, diskResearcherSet } from "./disk-cache";
import {
  assembleFiscalFrontend,
  type AuctionInputRow,
  type BuybackOp,
  type DatedMio,
  type DatedValue,
  type FiscalFrontendPayload,
  type MspdRow,
} from "./fiscal-frontend-math";
import { fetchFredSeriesSince, type FredObs } from "./liquidity-regime";
import { GENIUS_LEGAL, fetchStablecoinMarketSnapshot } from "./stablecoin-liquidity";

const FISCAL_DATA = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
const TIMEOUT_MS = 15_000;

const TTL = {
  mspd: 24 * 60 * 60 * 1000,
  auctions: 12 * 60 * 60 * 1000,
  dts: 12 * 60 * 60 * 1000,
  wshobl: 6 * 60 * 60 * 1000,
  wshotsl: 6 * 60 * 60 * 1000,
  dff: 12 * 60 * 60 * 1000,
  buybacks: 12 * 60 * 60 * 1000,
  nl: 6 * 60 * 60 * 1000,
} as const;

const KEY = {
  mspd: "fiscal__mspd_bills",
  auctions: "fiscal__auctions_bills_30d",
  dts: "fiscal__dts_tga",
  wshobl: "fiscal__wshobl",
  wshotsl: "fiscal__wshotsl",
  dff: "fiscal__dff_5y",
  buybacks: "fiscal__buybacks_ops",
  nl: "fiscal__nl_weekly",
} as const;

const LONG_END_BUCKETS = new Set(["10Y to 20Y", "20Y to 30Y", "10Y to 30Y"]);

const mem = new Map<string, { expiresAt: number; data: unknown }>();

function isoShiftDays(days: number, from = new Date()): string {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fiscalUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${FISCAL_DATA}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === ".") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return null;
  return trimmed;
}

async function readBody(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json,text/csv" } });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.includes("<!DOCTYPE") || text.includes("<html")) return null;
    return text;
  } catch {
    return null;
  }
}

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T | null>): Promise<T | null> {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit && hit.expiresAt > now) return hit.data as T;
  const fresh = await load();
  if (fresh != null) {
    mem.set(key, { data: fresh, expiresAt: now + ttlMs });
    try { diskResearcherSet(key, { fetchedAt: new Date().toISOString(), data: fresh }); } catch { /* Disk ist Backstop */ }
    return fresh;
  }
  const disk = diskResearcherGet(key) as { data?: T; _cacheAge?: number } | null;
  const ageMs = typeof disk?._cacheAge === "number" ? disk._cacheAge * 60_000 : Number.POSITIVE_INFINITY;
  if (disk?.data != null && ageMs <= ttlMs) return disk.data;
  return null;
}

async function fiscalPages(path: string, params: Record<string, string>, pageSize: number): Promise<Record<string, unknown>[] | null> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= 5; page++) {
    const text = await readBody(fiscalUrl(path, {
      ...params,
      "page[number]": String(page),
      "page[size]": String(pageSize),
    }));
    if (!text) return page === 1 ? null : rows;
    let json: { data?: unknown; links?: { next?: string | null } };
    try { json = JSON.parse(text); } catch { return page === 1 ? null : rows; }
    if (!Array.isArray(json.data)) return page === 1 ? null : rows;
    for (const row of json.data) {
      if (row && typeof row === "object") rows.push(row as Record<string, unknown>);
    }
    if (json.data.length < pageSize || !json.links?.next) break;
  }
  return rows;
}

async function loadMspd(): Promise<MspdRow[] | null> {
  const rows = await fiscalPages("v1/debt/mspd/mspd_table_1", {
    filter: "security_class_desc:eq:Bills,security_type_desc:eq:Marketable",
    sort: "-record_date",
    fields: "record_date,total_mil_amt,security_class_desc,security_type_desc",
  }, 36);
  if (!rows) return null;
  const parsed: MspdRow[] = [];
  for (const row of rows) {
    const date = asText(row.record_date);
    const total = asNumber(row.total_mil_amt);
    if (!date || total == null) continue;
    if (row.security_class_desc !== "Bills" || row.security_type_desc !== "Marketable") continue;
    parsed.push({ date, totalMilAmt: total });
  }
  return parsed.length ? parsed : null;
}

function auctionRow(row: Record<string, unknown>): AuctionInputRow | null {
  const auctionDate = asText(row.auction_date);
  if (!auctionDate) return null;
  return {
    auctionDate,
    maturityDate: asText(row.maturity_date),
    offeringUsd: asNumber(row.offering_amt),
    acceptedUsd: asNumber(row.total_accepted),
    securityType: asText(row.security_type),
    cashManagementBill: asText(row.cash_management_bill_cmb),
  };
}

async function loadAuctions(asOf: string): Promise<AuctionInputRow[] | null> {
  const start = isoShiftDays(-30, new Date(`${asOf}T00:00:00.000Z`));
  const fields = "auction_date,maturity_date,security_type,cash_management_bill_cmb,offering_amt,total_accepted";
  const [issued, maturing] = await Promise.all([
    fiscalPages("v1/accounting/od/auctions_query", {
      filter: `security_type:eq:Bill,auction_date:gte:${start},auction_date:lte:${asOf}`,
      sort: "-auction_date",
      fields,
    }, 300),
    fiscalPages("v1/accounting/od/auctions_query", {
      filter: `security_type:eq:Bill,maturity_date:gte:${start},maturity_date:lte:${asOf}`,
      sort: "-maturity_date",
      fields,
    }, 300),
  ]);
  if (!issued || !maturing) return null;
  const parsed: AuctionInputRow[] = [];
  const seen = new Set<string>();
  for (const row of [...issued, ...maturing]) {
    const next = auctionRow(row);
    if (!next) continue;
    const key = `${next.auctionDate}|${next.maturityDate}|${next.offeringUsd}|${next.acceptedUsd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push(next);
  }
  return parsed.length ? parsed : null;
}

async function loadTgaOpeningMil(): Promise<number | null> {
  const rows = await fiscalPages("v1/accounting/dts/operating_cash_balance", {
    filter: "account_type:eq:Treasury General Account (TGA) Opening Balance",
    sort: "-record_date",
    fields: "record_date,account_type,open_today_bal",
  }, 1);
  if (!rows?.length) return null;
  return asNumber(rows[0].open_today_bal);
}

async function loadBuybacks(asOf: string): Promise<BuybackOp[] | null> {
  const rows = await fiscalPages("v1/accounting/od/buybacks_operations", {
    filter: `operation_date:gte:${isoShiftDays(-800, new Date(`${asOf}T00:00:00.000Z`))}`,
    sort: "-operation_date",
    fields: "operation_date,maturity_bucket,total_par_amt_accepted",
  }, 1000);
  if (!rows) return null;
  const parsed: BuybackOp[] = [];
  for (const row of rows) {
    const date = asText(row.operation_date);
    const accepted = asNumber(row.total_par_amt_accepted);
    const bucket = asText(row.maturity_bucket);
    if (!date || accepted == null) continue;
    parsed.push({ date, acceptedUsd: accepted, longEnd: bucket != null && LONG_END_BUCKETS.has(bucket) });
  }
  return parsed;
}

async function loadFredMio(series: string, cosd: string): Promise<DatedMio[] | null> {
  const points = await fetchFredSeriesSince(series, cosd);
  if (!points.length) return null;
  return points.map(point => ({ date: point.date, valueMio: point.value }));
}

async function loadFred(series: string, cosd: string): Promise<DatedValue[] | null> {
  const points = await fetchFredSeriesSince(series, cosd);
  if (!points.length) return null;
  return points.map(point => ({ date: point.date, value: point.value }));
}

async function loadNl(cosd: string): Promise<{ walcl: FredObs[]; rrp: FredObs[]; tga: FredObs[] } | null> {
  const [walcl, rrp, tga] = await Promise.all([
    fetchFredSeriesSince("WALCL", cosd),
    fetchFredSeriesSince("RRPONTSYD", cosd),
    fetchFredSeriesSince("WTREGEN", cosd),
  ]);
  if (!walcl.length || !rrp.length || !tga.length) return null;
  return { walcl, rrp, tga };
}

export async function getFiscalFrontend(now = new Date()): Promise<FiscalFrontendPayload> {
  const asOf = now.toISOString().slice(0, 10);
  const somaStart = isoShiftDays(-(2 * 365 + 13 * 7 + 21), now);
  const dffStart = isoShiftDays(-(5 * 365 + 120), now);
  const nlStart = isoShiftDays(-(3 * 365), now);

  const [mspd, auctions, tgaOpeningMil, wshobl, wshotsl, dff, nl, buybacks, stables] = await Promise.all([
    cached(KEY.mspd, TTL.mspd, loadMspd),
    cached(KEY.auctions, TTL.auctions, () => loadAuctions(asOf)),
    cached(KEY.dts, TTL.dts, loadTgaOpeningMil),
    cached(KEY.wshobl, TTL.wshobl, () => loadFredMio("WSHOBL", somaStart)),
    cached(KEY.wshotsl, TTL.wshotsl, () => loadFredMio("WSHOTSL", somaStart)),
    cached(KEY.dff, TTL.dff, () => loadFred("DFF", dffStart)),
    cached(KEY.nl, TTL.nl, () => loadNl(nlStart)),
    cached(KEY.buybacks, TTL.buybacks, () => loadBuybacks(asOf)),
    fetchStablecoinMarketSnapshot(),
  ]);

  const deltaMcapUsd = stables.available
    && stables.totalMarketCapUsd != null
    && stables.totalMarketCapPrevMonthUsd != null
    ? stables.totalMarketCapUsd - stables.totalMarketCapPrevMonthUsd
    : null;

  return assembleFiscalFrontend({
    asOf,
    fetchedAt: new Date().toISOString(),
    deltaMcapUsd,
    mspd: mspd ?? [],
    auctions: auctions ?? [],
    wshobl: wshobl ?? [],
    wshotsl: wshotsl ?? [],
    dff: dff ?? [],
    walcl: nl?.walcl ?? [],
    rrp: nl?.rrp ?? [],
    tga: nl?.tga ?? [],
    buybacks: buybacks ?? [],
    tgaOpeningMil: tgaOpeningMil ?? null,
    liveVarianceMonths: 0,
    genius: GENIUS_LEGAL,
  });
}

export async function fetchBuybackDesk(asOf = todayIso()): Promise<{ flag: 0 | 1; source: "ops"; calendarHint: string | null } | null> {
  const buybacks = await cached(KEY.buybacks, TTL.buybacks, () => loadBuybacks(asOf));
  if (!buybacks) return null;
  const payload = assembleFiscalFrontend({
    asOf,
    fetchedAt: new Date().toISOString(),
    deltaMcapUsd: null,
    mspd: [],
    auctions: [],
    wshobl: [],
    wshotsl: [],
    dff: [],
    walcl: [],
    rrp: [],
    tga: [],
    buybacks,
    tgaOpeningMil: null,
    liveVarianceMonths: 0,
    genius: GENIUS_LEGAL,
  });
  return payload.desk;
}
