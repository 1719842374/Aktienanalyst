/**
 * GET /api/analyze-btc/liquidity — Liquiditätsblock für den BTC-Score + WALCL-Overlay.
 * FRED-Abruf über den gemeinsamen Kern server/fred-csv.ts (fetchFredCsv: Node-fetch,
 * 1 Wiederholung, 20-s-Gesamtbudget je Reihe) — kein eigener FRED-Weg.
 * DGS10 kommt aus dem bestehenden 10Y-Loader (server/treasury10y-route.ts, #263, 12h-Cache),
 * damit DGS10 nicht doppelt geladen wird.
 * Fehler/Throw/Timeout → Block n/a (GIS dann exakt wie ohne Block), kein Cache.
 * Regeln und Gewichte: shared/btc-liquidity.ts.
 */
import type { BtcLiquidityResponse } from "../shared/schema";
import {
  BTC_LIQUIDITY_SERIES,
  computeBtcLiquidityBlock,
  walclOverlayPoints,
  type LiquidityObs,
} from "../shared/btc-liquidity";
import { fetchFredCsv, fredCsvObservations, fredCsvUrl } from "./fred-csv";
import { getMarketTreasury10Y } from "./treasury10y-route";

const CACHE_MS = 6 * 60 * 60 * 1000;
/** Obergrenze je Anfrage: FRED-Budget (20 s) + Puffer. Danach n/a, nie hängend. */
export const BTC_LIQUIDITY_DEADLINE_MS = 25_000;
/** WALCL ab Beginn der Reihe (Overlay über die ganze BTC-Historie), DGS10 2 Jahre (nur bei injiziertem fetchCsv), Z.1 ab 1990 (20J-Perzentil + Puffer). */
const COSD = { walcl: "2002-12-01", dgs10Years: 2, z1: "1990-01-01" } as const;

type FetchCsv = (id: string, cosd?: string) => Promise<string | null>;

let cache: { at: number; body: BtcLiquidityResponse } | null = null;

function isoToday(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function yearsBefore(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

const SOURCES: BtcLiquidityResponse["sources"] = {
  walcl: fredCsvUrl(BTC_LIQUIDITY_SERIES.walcl),
  bills: fredCsvUrl(BTC_LIQUIDITY_SERIES.bills),
  otherMarketable: fredCsvUrl(BTC_LIQUIDITY_SERIES.otherMarketable),
  dgs10: fredCsvUrl(BTC_LIQUIDITY_SERIES.dgs10),
};

/** Block aus bereits geladenen Reihen (auch vom Historien-Skript genutzt). */
export function buildBtcLiquidityResponse(
  series: { walcl: LiquidityObs[]; bills: LiquidityObs[]; otherMarketable: LiquidityObs[]; dgs10: LiquidityObs[] },
  asOf: string,
  fetchedAt = new Date().toISOString(),
): BtcLiquidityResponse {
  return {
    block: computeBtcLiquidityBlock(series, asOf),
    walcl: walclOverlayPoints(series.walcl),
    fetchedAt,
    sources: SOURCES,
  };
}

export function emptyBtcLiquidity(note: string, asOf = isoToday()): BtcLiquidityResponse {
  const body = buildBtcLiquidityResponse({ walcl: [], bills: [], otherMarketable: [], dgs10: [] }, asOf);
  body.block.note = note;
  return body;
}

async function safeObs(fetchCsv: FetchCsv, id: string, cosd: string): Promise<LiquidityObs[]> {
  try {
    return fredCsvObservations(await fetchCsv(id, cosd));
  } catch {
    return [];
  }
}

async function dgs10FromTreasuryLoader(): Promise<LiquidityObs[]> {
  try {
    const r = await getMarketTreasury10Y();
    return Array.isArray(r?.points) ? r.points.map(p => ({ date: p.date, value: p.value })) : [];
  } catch {
    return [];
  }
}

/**
 * Lädt WALCL und Z.1 über fetchFredCsv, DGS10 über getMarketTreasury10Y.
 * Wird fetchCsv injiziert (Tests), laufen alle vier Reihen darüber.
 */
export async function loadBtcLiquidity(
  deps: { fetchCsv?: FetchCsv; now?: Date } = {},
): Promise<BtcLiquidityResponse> {
  const fetchCsv = deps.fetchCsv ?? ((id, cosd) => fetchFredCsv(id, cosd));
  const now = deps.now ?? new Date();
  const asOf = isoToday(now);
  const dgs10Load = deps.fetchCsv
    ? safeObs(fetchCsv, BTC_LIQUIDITY_SERIES.dgs10, yearsBefore(asOf, COSD.dgs10Years))
    : dgs10FromTreasuryLoader();
  const [walcl, bills, otherMarketable, dgs10] = await Promise.all([
    safeObs(fetchCsv, BTC_LIQUIDITY_SERIES.walcl, COSD.walcl),
    safeObs(fetchCsv, BTC_LIQUIDITY_SERIES.bills, COSD.z1),
    safeObs(fetchCsv, BTC_LIQUIDITY_SERIES.otherMarketable, COSD.z1),
    dgs10Load,
  ]);
  return buildBtcLiquidityResponse({ walcl, bills, otherMarketable, dgs10 }, asOf, now.toISOString());
}

function withDeadline<T>(p: Promise<T>, ms: number, onTimeout: () => T, onError: (err: unknown) => T): Promise<T> {
  return new Promise<T>(resolve => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(onTimeout()); } }, ms);
    p.then(
      v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      err => { if (!done) { done = true; clearTimeout(timer); resolve(onError(err)); } },
    );
  });
}

/** Cache + Deadline. Wirft nie. Gecacht wird nur ein verfügbarer Block. */
export async function getBtcLiquidity(
  opts: { now?: number; load?: () => Promise<BtcLiquidityResponse>; deadlineMs?: number } = {},
): Promise<BtcLiquidityResponse> {
  const now = opts.now ?? Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.body;
  const ms = opts.deadlineMs ?? BTC_LIQUIDITY_DEADLINE_MS;
  const errText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 160);
  const body = await withDeadline(
    Promise.resolve().then(() => (opts.load ?? loadBtcLiquidity)()),
    ms,
    () => emptyBtcLiquidity(`FRED-Abruf Timeout (${Math.round(ms / 1000)} s) – Liquiditätsblock n/a`),
    err => emptyBtcLiquidity(`FRED-Abruf fehlgeschlagen: ${errText(err)} – Liquiditätsblock n/a`),
  );
  if (body.block.available) cache = { at: now, body };
  return body;
}

/** Nur für Tests. */
export function resetBtcLiquidityCache(): void {
  cache = null;
}
