/**
 * Fetch für Netto-Bills, SOMA, DFF, Buybacks und TGA.
 * Request-Cache je Serie. Kein Cron, kein QRA-LLM.
 * Spec: Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md §4–§6.
 */
import { diskResearcherGet, diskResearcherSet } from "./disk-cache";
import {
  type BuybackK30,
  type DatedLevel,
  adaptiveFiscal,
  addIsoDays,
  calendarDelta,
  daysInMonth,
  deltaOverWeeks,
  frontEndImpulse,
  isTenToThirtyYearBucket,
  locfAt,
  buybackDeskFlag,
  netBillSupplyFromFlows,
  netBillSupplyFromStock,
  policyD30Bn,
  qraBillAnchor30,
  rollingIndexDelta,
  scaleMonthlyTo30,
  zScore,
  WINDOW,
} from "./fiscal-frontend-math";
import { alignWeekly, bessentWindowHint, classifyPolicyFromOps } from "./liquidity-regime-math";
import { QRA_SNAPSHOT, qraIdentityHolds, qraSnapshotStale } from "./qra-snapshot";
import { GENIUS_LEGAL, fetchStablecoinMarketSnapshot } from "./stablecoin-liquidity";

const FISCAL_ORIGIN = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service";
const FETCH_TIMEOUT_MS = 15_000;
const HOUR = 60 * 60 * 1000;

const TTL = {
  mspd: 24 * HOUR,
  auctions: 12 * HOUR,
  dts: 12 * HOUR,
  soma: 6 * HOUR,
  dff: 12 * HOUR,
  buybacks: 12 * HOUR,
  nl: 6 * HOUR,
  stables: 5 * 60 * 1000,
} as const;

export interface FiscalSlotView {
  available: boolean;
  display: number;
}

export interface FiscalFrontendResponse {
  asOf: string;
  fetchedAt: string;
  genius: { legal: 1; rulemakingNote: string };
  d30: { bn: number | null; kennzeichnung: "Policy" };
  netBillSupply: {
    available: boolean;
    nb30Bn: number | null;
    nbMonthBn: number | null;
    source: "MSPD" | "Auctions" | "scaled-from-monthly" | null;
    kennzeichnung: "scaled-from-monthly" | null;
    monthEnding: string | null;
  };
  fedBills: {
    available: boolean;
    deltaBn: number | null;
    kennzeichnung: "~28T";
    asOf: string | null;
  };
  frontEndImpulse: { available: boolean; fe30Bn: number | null };
  qra: {
    asOf: string;
    nextRelease: string;
    quarter: string;
    kennzeichnung: string;
    impliedBillChangeBn: number;
    anchor30Bn: number;
    identityHolds: boolean;
    stale: boolean;
  };
  adaptiveScore: {
    available: boolean;
    s: number | null;
    displayS: number;
    mix: "prior" | "inverse-vol";
    macroFiscal: number | null;
    deskFlag: 0 | 1 | null;
    deskFromOps: boolean;
    sM: FiscalSlotView;
    sF: FiscalSlotView;
    sD: FiscalSlotView;
    labels: { available: boolean; qe: boolean; rmp: boolean };
  };
  dtsTga: { available: boolean; openingBn: number | null; asOf: string | null };
}

export interface FiscalRegimeFields {
  buybackDesk: { flag: 0 | 1; source: "ops" };
  bessentHint: string | null;
  adaptivePolicy: { available: boolean; qe: boolean; rmp: boolean; deskFlag: 0 | 1; label: "QE" | "RMP" | null };
}

type FiscalRow = Record<string, string>;

const memory = new Map<string, { at: number; ttl: number; data: unknown }>();

function isoToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function monthsBefore(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

function finiteNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (text === "" || text === "null" || text === ".") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json, text/csv;q=0.9, */*;q=0.8" },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function isHtml(text: string): boolean {
  return text.includes("<!DOCTYPE") || text.includes("<html");
}

async function withCache<T>(key: string, ttlMs: number, load: () => Promise<T | null>): Promise<T | null> {
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.data as T;
  const disk = diskResearcherGet(key) as { _fetchedAt?: number; payload?: T } | null;
  if (disk && typeof disk._fetchedAt === "number" && now - disk._fetchedAt < ttlMs && disk.payload != null) {
    memory.set(key, { at: disk._fetchedAt, ttl: ttlMs, data: disk.payload });
    return disk.payload;
  }
  const fresh = await load();
  if (fresh == null) return null;
  const at = Date.now();
  memory.set(key, { at, ttl: ttlMs, data: fresh });
  try { diskResearcherSet(key, { _fetchedAt: at, payload: fresh }); } catch { /* Cache ist Komfort */ }
  return fresh;
}

function parseFredCsv(csv: string): DatedLevel[] {
  if (!csv || isHtml(csv)) return [];
  const out: DatedLevel[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    if (!date || raw == null) continue;
    const value = finiteNumber(raw);
    if (value == null) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) out.push({ date: date.trim(), value });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchFred(id: string, cosd: string): Promise<DatedLevel[] | null> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${cosd}`;
  const text = await fetchText(url);
  if (text == null) return null;
  if (isHtml(text)) return [];
  return parseFredCsv(text);
}

/** Fiscal Data liefert `links.next` als Query-Suffix (`&page[number]=2`), nicht als absolute URL. */
function fiscalNextUrl(current: string, link: string): string | null {
  if (link.startsWith("http://") || link.startsWith("https://")) return link;
  if (link.startsWith("&") || link.startsWith("?")) {
    const url = new URL(current);
    const extra = new URLSearchParams(link.replace(/^[?&]/, ""));
    for (const [key, value] of extra) url.searchParams.set(key, value);
    return url.toString();
  }
  try {
    return new URL(link, current).toString();
  } catch {
    return null;
  }
}

async function fetchFiscalRows(path: string, params: Record<string, string>): Promise<FiscalRow[] | null> {
  const url = new URL(FISCAL_ORIGIN + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const rows: FiscalRow[] = [];
  let next: string | null = url.toString();
  for (let page = 0; next && page < 20; page++) {
    const text = await fetchText(next);
    if (text == null || isHtml(text)) {
      if (page === 0) return text != null && isHtml(text) ? [] : null;
      break;
    }
    let json: { data?: FiscalRow[]; links?: { next?: string | null } };
    try { json = JSON.parse(text); } catch {
      if (page === 0) return null;
      break;
    }
    if (!Array.isArray(json.data)) {
      if (page === 0) return null;
      break;
    }
    rows.push(...json.data);
    const link = json.links?.next;
    if (typeof link !== "string" || link.length === 0) break;
    next = fiscalNextUrl(next, link);
  }
  return rows;
}

async function cachedFred(key: string, ttl: number, id: string, cosd: string): Promise<DatedLevel[] | null> {
  return withCache(key, ttl, () => fetchFred(id, cosd));
}

function fetchBuybackRows(asOf: string): Promise<FiscalRow[] | null> {
  const buybackFrom = addIsoDays(monthsBefore(asOf, 24), -31);
  return withCache("fiscal__buybacks_ops", TTL.buybacks, () => fetchFiscalRows("/v1/accounting/od/buybacks_operations", {
    filter: `operation_date:gte:${buybackFrom}`,
    fields: "operation_date,maturity_bucket,total_par_amt_accepted",
    sort: "-operation_date",
    "page[size]": "500",
  }));
}

function mspdStocks(rows: FiscalRow[]): DatedLevel[] {
  const out: DatedLevel[] = [];
  for (const row of rows) {
    const date = row.record_date;
    const mil = finiteNumber(row.total_mil_amt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || mil == null) continue;
    out.push({ date, value: mil / 1000 });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function sumOfferings(rows: FiscalRow[] | null): number | null {
  if (rows == null) return null;
  let sum = 0;
  for (const row of rows) {
    const dollars = finiteNumber(row.offering_amt);
    if (dollars == null) continue;
    sum += dollars / 1e9;
  }
  return sum;
}

function buybackOps(rows: FiscalRow[]): { date: string; acceptedBn: number }[] {
  const out: { date: string; acceptedBn: number }[] = [];
  for (const row of rows) {
    if (!isTenToThirtyYearBucket(row.maturity_bucket || "")) continue;
    const accepted = finiteNumber(row.total_par_amt_accepted);
    const date = row.operation_date;
    if (accepted == null || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) continue;
    out.push({ date, acceptedBn: accepted / 1e9 });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function trailingK30(ops: { date: string; acceptedBn: number }[], asOf: string): BuybackK30[] {
  const start = monthsBefore(asOf, 24);
  const points: BuybackK30[] = [];
  for (const op of ops) {
    if (op.date < start || op.date > asOf) continue;
    const windowStart = addIsoDays(op.date, -30);
    let sum = 0;
    for (const other of ops) {
      if (other.date > windowStart && other.date <= op.date) sum += other.acceptedBn;
    }
    points.push({ date: op.date, k30Bn: sum });
  }
  return points;
}

interface LoadedSeries {
  asOf: string;
  mspd: DatedLevel[] | null;
  grossBn: number | null;
  maturingBn: number | null;
  wshobl: DatedLevel[] | null;
  wshotsl: DatedLevel[] | null;
  dff: DatedLevel[] | null;
  walcl: DatedLevel[] | null;
  rrp: DatedLevel[] | null;
  wtregen: DatedLevel[] | null;
  buybackK30: BuybackK30[] | null;
  dts: { date: string; openingBn: number } | null;
  d30Bn: number | null;
}

async function loadSeries(asOf: string): Promise<LoadedSeries> {
  const cosd30m = monthsBefore(asOf, 30);
  const cosd2y = monthsBefore(asOf, 24);
  const cosd5y = monthsBefore(asOf, 60);
  const auctionFrom = addIsoDays(asOf, -30);

  const [mspdRows, grossRows, maturingRows, wshobl, wshotsl, dff, walcl, rrp, wtregen, buybackRows, dtsRows, stables] = await Promise.all([
    withCache("fiscal__mspd_bills", TTL.mspd, () => fetchFiscalRows("/v1/debt/mspd/mspd_table_1", {
      filter: "security_class_desc:eq:Bills,security_type_desc:eq:Marketable",
      fields: "record_date,security_class_desc,security_type_desc,total_mil_amt",
      sort: "-record_date",
      "page[size]": "40",
    })),
    withCache(`fiscal__auctions_bills_30d__gross__${auctionFrom}`, TTL.auctions, () => fetchFiscalRows("/v1/accounting/od/auctions_query", {
      filter: `security_type:eq:Bill,auction_date:gte:${auctionFrom},auction_date:lte:${asOf}`,
      fields: "auction_date,security_type,cash_management_bill_cmb,offering_amt",
      "page[size]": "500",
    })),
    withCache(`fiscal__auctions_bills_30d__maturing__${auctionFrom}`, TTL.auctions, () => fetchFiscalRows("/v1/accounting/od/auctions_query", {
      // M = fällige Bills im Fenster über maturity_date. est_pub_held_mat_by_type_amt ist ein Typ-Salat, kein 30-Tage-Betrag, und wird nicht summiert.
      filter: `security_type:eq:Bill,maturity_date:gte:${auctionFrom},maturity_date:lte:${asOf}`,
      fields: "maturity_date,security_type,cash_management_bill_cmb,offering_amt",
      "page[size]": "500",
    })),
    cachedFred("fiscal__wshobl", TTL.soma, "WSHOBL", cosd2y),
    cachedFred("fiscal__wshotsl", TTL.soma, "WSHOTSL", cosd2y),
    cachedFred("fiscal__dff_5y", TTL.dff, "DFF", cosd5y),
    cachedFred("fiscal__walcl", TTL.nl, "WALCL", cosd30m),
    cachedFred("fiscal__rrpontsyd", TTL.nl, "RRPONTSYD", cosd30m),
    cachedFred("fiscal__wtregen", TTL.nl, "WTREGEN", cosd30m),
    fetchBuybackRows(asOf),
    withCache("fiscal__dts_tga", TTL.dts, () => fetchFiscalRows("/v1/accounting/dts/operating_cash_balance", {
      filter: "account_type:eq:Treasury General Account (TGA) Opening Balance",
      fields: "record_date,account_type,open_today_bal",
      sort: "-record_date",
      "page[size]": "5",
    })),
    withCache("fiscal__stable_mcap_5m", TTL.stables, async () => {
      const snap = await fetchStablecoinMarketSnapshot();
      return snap.available ? snap : null;
    }),
  ]);

  let dts: LoadedSeries["dts"] = null;
  if (dtsRows) {
    for (const row of dtsRows) {
      const opening = finiteNumber(row.open_today_bal);
      if (opening == null || !/^\d{4}-\d{2}-\d{2}$/.test(row.record_date || "")) continue;
      dts = { date: row.record_date, openingBn: opening / 1000 };
      break;
    }
  }

  const deltaM = stables && stables.totalMarketCapUsd != null && stables.totalMarketCapPrevMonthUsd != null
    ? stables.totalMarketCapUsd - stables.totalMarketCapPrevMonthUsd
    : null;

  const ops = buybackRows ? buybackOps(buybackRows) : null;
  return {
    asOf,
    mspd: mspdRows ? mspdStocks(mspdRows) : null,
    grossBn: sumOfferings(grossRows),
    maturingBn: sumOfferings(maturingRows),
    wshobl,
    wshotsl,
    dff,
    walcl,
    rrp,
    wtregen,
    buybackK30: ops ? trailingK30(ops, asOf) : null,
    dts,
    d30Bn: policyD30Bn(deltaM),
  };
}

function somaLevels(total: DatedLevel[], bills: DatedLevel[]): { notesBn: number[]; billsBn: number[] } {
  const notesBn: number[] = [];
  const billsBn: number[] = [];
  for (const point of total) {
    const billMio = locfAt(bills, point.date);
    if (billMio == null) continue;
    notesBn.push((point.value - billMio) / 1000);
    billsBn.push(billMio / 1000);
  }
  return { notesBn, billsBn };
}

function scoreFrom(series: LoadedSeries) {
  const aligned = series.walcl && series.rrp && series.wtregen
    ? alignWeekly(series.walcl, series.rrp, series.wtregen)
    : [];
  const nl13w = rollingIndexDelta(aligned.map(point => point.netBn), 13);
  const tga4w = rollingIndexDelta(aligned.map(point => point.tgaBn), 4);
  const soma = series.wshotsl && series.wshobl ? somaLevels(series.wshotsl, series.wshobl) : { notesBn: [], billsBn: [] };
  const notes13w = rollingIndexDelta(soma.notesBn, 13);
  const bills13w = rollingIndexDelta(soma.billsBn, 13);
  const di90 = series.dff ? calendarDelta(series.dff, 90) : [];
  return adaptiveFiscal({
    asOf: series.asOf,
    nl13w,
    di90,
    notes13w,
    bills13w,
    feMonthly: [],
    tga4w,
    buybackK30: series.buybackK30 ?? [],
  });
}

function netBill(series: LoadedSeries): FiscalFrontendResponse["netBillSupply"] {
  const stocks = series.mspd ?? [];
  const later = stocks[stocks.length - 1];
  const earlier = stocks[stocks.length - 2];
  const nbMonthBn = later && earlier ? netBillSupplyFromStock(later.value, earlier.value) : null;
  const auctionsOk = series.grossBn != null && series.maturingBn != null;
  const auctionsHaveRows = auctionsOk && (series.grossBn !== 0 || series.maturingBn !== 0);
  if (auctionsHaveRows) {
    const nb30Bn = netBillSupplyFromFlows(series.grossBn!, series.maturingBn!);
    return {
      available: nb30Bn != null,
      nb30Bn,
      nbMonthBn,
      source: "Auctions",
      kennzeichnung: null,
      monthEnding: later?.date ?? null,
    };
  }
  if (nbMonthBn != null && later) {
    const scaled = scaleMonthlyTo30(nbMonthBn, daysInMonth(later.date));
    return {
      available: scaled != null,
      nb30Bn: scaled,
      nbMonthBn,
      source: "scaled-from-monthly",
      kennzeichnung: "scaled-from-monthly",
      monthEnding: later.date,
    };
  }
  return {
    available: false,
    nb30Bn: null,
    nbMonthBn,
    source: nbMonthBn != null ? "MSPD" : null,
    kennzeichnung: null,
    monthEnding: later?.date ?? null,
  };
}

export async function buildFiscalFrontendResponse(now = new Date()): Promise<FiscalFrontendResponse> {
  const asOf = isoToday(now);
  const series = await loadSeries(asOf);
  const bills = netBill(series);
  const fedDeltaMio = series.wshobl ? deltaOverWeeks(series.wshobl, 4) : null;
  const fedBn = fedDeltaMio ? fedDeltaMio.delta / 1000 : null;
  const impulse = frontEndImpulse({
    d30: series.d30Bn,
    fedBills: fedBn,
    netSupply: bills.nb30Bn,
  });
  const adaptive = scoreFrom(series);
  return {
    asOf,
    fetchedAt: now.toISOString(),
    genius: GENIUS_LEGAL,
    d30: { bn: series.d30Bn, kennzeichnung: "Policy" },
    netBillSupply: bills,
    fedBills: {
      available: fedBn != null,
      deltaBn: fedBn,
      kennzeichnung: "~28T",
      asOf: fedDeltaMio?.asOf ?? null,
    },
    frontEndImpulse: { available: impulse.available, fe30Bn: impulse.fe30 },
    qra: {
      asOf: QRA_SNAPSHOT.asOf,
      nextRelease: QRA_SNAPSHOT.nextRelease,
      quarter: QRA_SNAPSHOT.quarter,
      kennzeichnung: QRA_SNAPSHOT.kennzeichnung,
      impliedBillChangeBn: QRA_SNAPSHOT.impliedBillChangeBn,
      anchor30Bn: qraBillAnchor30(QRA_SNAPSHOT.impliedBillChangeBn),
      identityHolds: qraIdentityHolds(),
      stale: qraSnapshotStale(asOf),
    },
    adaptiveScore: {
      available: adaptive.available,
      s: adaptive.s,
      displayS: adaptive.displayS,
      mix: adaptive.mix,
      macroFiscal: adaptive.macroFiscal,
      deskFlag: series.buybackK30 == null ? null : adaptive.deskFlag,
      deskFromOps: series.buybackK30 != null,
      sM: { available: adaptive.sM.available, display: adaptive.sM.display },
      sF: { available: adaptive.sF.available, display: adaptive.sF.display },
      sD: { available: adaptive.sD.available, display: adaptive.sD.display },
      labels: adaptive.labels,
    },
    dtsTga: {
      available: series.dts != null,
      openingBn: series.dts?.openingBn ?? null,
      asOf: series.dts?.date ?? null,
    },
  };
}

/**
 * Researcher-Panel: DFF 5y, SOMA 2y, Ops-Flag, QE/RMP-Label.
 * Der Kalender bleibt ein Hint und geht nicht in classifyPolicy.
 */
export async function fiscalRegimeAttachment(asOf = isoToday()): Promise<Partial<FiscalRegimeFields>> {
  const [wshobl, wshotsl, buybackRows] = await Promise.all([
    cachedFred("fiscal__wshobl", TTL.soma, "WSHOBL", monthsBefore(asOf, 24)),
    cachedFred("fiscal__wshotsl", TTL.soma, "WSHOTSL", monthsBefore(asOf, 24)),
    cachedFred("fiscal__dff_5y", TTL.dff, "DFF", monthsBefore(asOf, 60)),
    fetchBuybackRows(asOf),
  ]).then(([bills, total, _dff, ops]) => [bills, total, ops] as const);

  const soma = wshobl && wshotsl ? somaLevels(wshotsl, wshobl) : { notesBn: [], billsBn: [] };
  const notes13w = rollingIndexDelta(soma.notesBn, 13);
  const bills13w = rollingIndexDelta(soma.billsBn, 13);
  const zNotes = zScore(notes13w, WINDOW.deltaNl13w.h, WINDOW.deltaNl13w.hMin);
  const zBills = zScore(bills13w, WINDOW.deltaNl13w.h, WINDOW.deltaNl13w.hMin);
  const notesDelta = notes13w.length ? notes13w[notes13w.length - 1] : null;
  const deskFlag: 0 | 1 = buybackRows == null ? 0 : buybackDeskFlag(asOf, trailingK30(buybackOps(buybackRows), asOf));
  const out: Partial<FiscalRegimeFields> = {};
  if (wshobl && wshotsl) {
    out.adaptivePolicy = classifyPolicyFromOps({
      zNotes13w: zNotes.z,
      notesDelta13wBn: notesDelta,
      zBills13w: zBills.z,
      deskFlag,
    });
  }
  if (buybackRows != null) {
    out.buybackDesk = { flag: deskFlag, source: "ops" };
    out.bessentHint = bessentWindowHint(asOf);
  }
  return out;
}
