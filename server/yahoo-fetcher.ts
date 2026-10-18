/**
 * yahoo-fetcher.ts — Ticket C1 (Future_2_NA_Fixes_Research.md §6/§7/§10,
 * Inventur Future_SOLL_IST_17c488e0.md „PR 4 Yahoo nur bei FMP 402“).
 *
 * Ersatzquelle NUR für den Fall, dass FMP für ein Symbol HTTP 402 liefert
 * (Plan deckt das Listing nicht ab, z. B. VOW3.DE, BMW.DE, SAP.DE).
 * Liefert Kurs, Market Cap, KGV (PE), EPS und Tageshistorie. Keine
 * Statements, keine Analystendaten. Das Symbol wird unverändert abgefragt
 * (`.DE` wird nicht auf ein anderes Listing umgelöst).
 *
 * - Cache: pro Symbol 15 min (YAHOO_CACHE_TTL_MS), auch Fehlschläge 2 min.
 * - Rate-Limit: mindestens YAHOO_MIN_INTERVAL_MS (Default 500 ms) zwischen
 *   ausgehenden Yahoo-Calls dieses Moduls.
 * - Quelle wird als `_dataSource: "yahoo"` an quote/profile markiert.
 *
 * Läuft nur serverseitig. Kein API-Key; Yahoo verlangt für quoteSummary
 * Cookie + Crumb, die hier einmalig geholt und wiederverwendet werden.
 */
import { yahooFetch, indicatorWarmupFromDate, type DailyBar } from "./history-fallback";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export const YAHOO_CACHE_TTL_MS = Number(process.env.YAHOO_CACHE_TTL_MS ?? 15 * 60 * 1000);
const YAHOO_FAIL_TTL_MS = 2 * 60 * 1000;
const YAHOO_MIN_INTERVAL_MS = Number(process.env.YAHOO_MIN_INTERVAL_MS ?? 500);

export interface YahooSnapshot {
  symbol: string;
  price: number;
  currency: string | null;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  name: string | null;
  exchange: string | null;
  bars: DailyBar[];
  fundamentalsAvailable: boolean;
}

let _lastYahooCallAt = 0;
let _spacing: Promise<void> = Promise.resolve();
/** Serialisiert Yahoo-Calls mit festem Mindestabstand (Rate-Limit). */
export function spaceYahooCall(): Promise<void> {
  const next = _spacing.then(async () => {
    const wait = _lastYahooCallAt + YAHOO_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    _lastYahooCallAt = Date.now();
  });
  _spacing = next.catch(() => undefined);
  return next;
}

let _crumb: { cookie: string; crumb: string; at: number } | null = null;
async function getCrumb(): Promise<{ cookie: string; crumb: string } | null> {
  if (_crumb && Date.now() - _crumb.at < 60 * 60 * 1000) return _crumb;
  try {
    await spaceYahooCall();
    const r1 = await fetch("https://fc.yahoo.com", { signal: AbortSignal.timeout(10000), headers: { "User-Agent": UA }, redirect: "manual" });
    const setCookie = (r1.headers as any).getSetCookie?.() ?? [r1.headers.get("set-cookie") ?? ""];
    const cookie = (setCookie as string[]).map((c) => c.split(";")[0]).filter(Boolean).join("; ");
    if (!cookie) return null;
    await spaceYahooCall();
    const r2 = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", { signal: AbortSignal.timeout(10000), headers: { "User-Agent": UA, Cookie: cookie } });
    const crumb = (await r2.text()).trim();
    if (!r2.ok || !crumb || crumb.length > 40 || /[<{ ]/.test(crumb)) return null;
    _crumb = { cookie, crumb, at: Date.now() };
    return _crumb;
  } catch {
    return null;
  }
}

const num = (v: any): number | null => {
  const n = typeof v === "object" && v !== null ? v.raw : v;
  return typeof n === "number" && isFinite(n) ? n : null;
};

/** Kurs/Market Cap/PE/EPS aus quoteSummary. null, wenn Yahoo nichts liefert. */
async function fetchQuoteSummary(symbol: string): Promise<Partial<YahooSnapshot> | null> {
  const auth = await getCrumb();
  if (!auth) return null;
  await spaceYahooCall();
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,summaryDetail,defaultKeyStatistics&crumb=${encodeURIComponent(auth.crumb)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": UA, Cookie: auth.cookie, Accept: "application/json" } });
  if (resp.status === 401) _crumb = null;
  if (!resp.ok) return null;
  const json: any = await resp.json();
  const r = json?.quoteSummary?.result?.[0];
  if (!r) return null;
  const price = num(r.price?.regularMarketPrice);
  const eps = num(r.defaultKeyStatistics?.trailingEps);
  let pe = num(r.summaryDetail?.trailingPE);
  if (pe == null && eps != null && eps > 0 && price != null) pe = price / eps;
  return {
    price: price ?? undefined,
    currency: r.price?.currency ?? null,
    marketCap: num(r.price?.marketCap) ?? num(r.summaryDetail?.marketCap),
    pe,
    eps,
    name: r.price?.longName ?? r.price?.shortName ?? null,
    exchange: r.price?.exchangeName ?? null,
  };
}

const cache = new Map<string, { value: YahooSnapshot | null; at: number }>();
const inflight = new Map<string, Promise<YahooSnapshot | null>>();

export function clearYahooCache(): void { cache.clear(); inflight.clear(); _crumb = null; }

/**
 * Yahoo-Snapshot für ein Symbol (gecacht). Braucht mindestens einen Kurs
 * (quoteSummary oder letzter Schlusskurs der Historie), sonst null.
 */
export async function getYahooSnapshot(symbol: string): Promise<YahooSnapshot | null> {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? YAHOO_CACHE_TTL_MS : YAHOO_FAIL_TTL_MS)) return hit.value;
  const running = inflight.get(key);
  if (running) return running;
  const p = (async (): Promise<YahooSnapshot | null> => {
    const to = new Date().toISOString().slice(0, 10);
    const [qsRes, barsRes] = await Promise.allSettled([
      fetchQuoteSummary(key),
      spaceYahooCall().then(() => yahooFetch(key, indicatorWarmupFromDate(), to)),
    ]);
    const qs = qsRes.status === "fulfilled" ? qsRes.value : null;
    const bars = barsRes.status === "fulfilled" ? barsRes.value : [];
    const lastClose = bars.length ? bars[bars.length - 1].close : null;
    const price = qs?.price ?? lastClose;
    if (!(typeof price === "number" && price > 0)) return null;
    return {
      symbol: key,
      price,
      currency: qs?.currency ?? null,
      marketCap: qs?.marketCap ?? null,
      pe: qs?.pe ?? null,
      eps: qs?.eps ?? null,
      name: qs?.name ?? null,
      exchange: qs?.exchange ?? null,
      bars,
      fundamentalsAvailable: !!qs,
    };
  })().catch((err) => {
    console.warn(`[YAHOO-402] ${key}: ${String(err?.message ?? err).slice(0, 120)}`);
    return null;
  });
  inflight.set(key, p);
  try {
    const value = await p;
    cache.set(key, { value, at: Date.now() });
    return value;
  } finally {
    inflight.delete(key);
  }
}

/** Klarer Hinweistext (Spec §7), wenn FMP 402 liefert und Yahoo übernimmt. */
export const YAHOO_402_NOTICE = "Plan deckt dieses Symbol nicht ab – Yahoo-Kurs/History aktiv";
