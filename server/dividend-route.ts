import type { Express, Request, Response } from "express";
import { fmpDividends, fmpProfile, getFxRateToUsd } from "./fmp";
import { currencyFromTickerSuffix, dividendsToMajor, dividendsToUsd, minorUnitInfo } from "../shared/listing-units";
import { fetchYahooFxToUsd } from "./yahoo-fetcher";
import {
  parseFmpDividends,
  parseYahooDividends,
  parseFmpDividendCurrency,
  parseYahooDividendCurrency,
  type DividendEvent,
  type DividendHistoryResponse,
} from "../shared/dividends";

/**
 * GET /api/dividends/:ticker — dividend history for the TA overlay.
 * FMP first, Yahoo v8 chart (events=div) only when FMP has nothing. Both empty → events: [].
 */

const CACHE_MS = 12 * 60 * 60 * 1000;
// v2 (#244): .L amounts are now converted pence → GBP; old v1 entries (pence) must not be served.
const CACHE_VERSION = "v3"; // v3: DCF-FX – Nicht-USD-Dividenden in USD (wie der Kurs)
const cacheKey = (t: string) => `${CACHE_VERSION}:${t}`;
const cache = new Map<string, { at: number; body: DividendHistoryResponse }>();
const TICKER_RE = /^[A-Z0-9.\-^=]{1,15}$/;

export function normalizeDividendTicker(raw: unknown): string | null {
  const t = String(raw ?? "").trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

type YahooDivs = DividendEvent[] & { currency?: string | null; rawCurrency?: string | null };

async function yahooDividends(ticker: string): Promise<YahooDivs> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=max&interval=1mo&events=div`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0" } });
    if (!resp.ok) return [];
    const json = await resp.json();
    const out: YahooDivs = parseYahooDividends(json);
    out.currency = parseYahooDividendCurrency(json);
    out.rawCurrency = (json as any)?.chart?.result?.[0]?.meta?.currency ?? null; // case-sensitive: "GBp" = pence
    return out;
  } catch {
    return [];
  }
}

async function listingCurrencyOf(ticker: string): Promise<string | null> {
  const p: any = await fmpProfile(ticker);
  return typeof p?.currency === "string" ? p.currency : null;
}

/** DCF-FX: Major → USD, FMP zuerst, Yahoo als Ersatz; null wenn keiner einen Kurs liefert (nie 1 raten). */
async function fxToUsd(major: string): Promise<number | null> {
  const r = await getFxRateToUsd(major).catch(() => 1);
  if (r > 0 && r !== 1) return r;
  return fetchYahooFxToUsd(major).catch(() => null);
}

type DividendDeps = {
  fmp: (t: string) => Promise<unknown>;
  yahoo: (t: string) => Promise<YahooDivs>;
  listingCurrency?: (t: string) => Promise<string | null>;
  /** DCF-FX: gesetzt → Nicht-USD-Beträge nach USD (Analyse-Kurs ist seit DCF-FX USD). Ohne → wie bisher. */
  fxToUsd?: (major: string) => Promise<number | null>;
};

export async function loadDividendHistory(
  ticker: string,
  deps: DividendDeps = {
    fmp: fmpDividends,
    yahoo: yahooDividends,
    listingCurrency: listingCurrencyOf,
    fxToUsd,
  },
): Promise<DividendHistoryResponse> {
  const res = await loadDividendHistoryListing(ticker, deps);
  if (!deps.fxToUsd || res.events.length === 0) return res;
  // Währung der Beträge: Quelle → Listing-Währung (FMP-Profil) → Börsen-Suffix. Minor Units sind hier schon Major.
  let cur: string | null = res.currency ?? null;
  if (!cur && ticker.includes(".")) {
    const lc = deps.listingCurrency ? await deps.listingCurrency(ticker).catch(() => null) : null;
    const raw = lc ?? currencyFromTickerSuffix(ticker);
    cur = minorUnitInfo(raw)?.major ?? raw;
  }
  if (!cur || cur.toUpperCase() === "USD") return res;
  const rate = await deps.fxToUsd(cur.toUpperCase()).catch(() => null);
  const usd = dividendsToUsd(res.events, cur, rate);
  if (!usd) return { ...res, currency: cur, note: [res.note, `FX ${cur.toUpperCase()}USD fehlt – Beträge in ${cur}`].filter(Boolean).join(", ") };
  return { ...res, events: usd.events, currency: "USD", note: [res.note, `Beträge ${cur} → USD @ ${usd.rate.toFixed(4)}`].filter(Boolean).join(", ") };
}

async function loadDividendHistoryListing(ticker: string, deps: DividendDeps): Promise<DividendHistoryResponse> {
  let fmpNote: string | null = null;
  try {
    const raw = await deps.fmp(ticker);
    const events = parseFmpDividends(raw);
    if (events.length > 0) {
      // Minor-unit listings (LSE .L): FMP amounts are in pence while the analysis price is now in pounds (#244).
      const lc = ticker.includes(".") && deps.listingCurrency ? await deps.listingCurrency(ticker).catch(() => null) : null;
      const major = dividendsToMajor(events, lc);
      if (major) return { ticker, source: "fmp", events: major.events, note: `Beträge ${lc} → ${major.currency}`, currency: major.currency };
      return { ticker, source: "fmp", events, note: null, currency: parseFmpDividendCurrency(raw) };
    }
    fmpNote = "FMP ohne Dividenden";
  } catch (err: any) {
    fmpNote = `FMP-Fehler${err?.fmpStatus ? ` HTTP ${err.fmpStatus}` : ""}`;
  }
  const y = await deps.yahoo(ticker);
  if (y.length > 0) {
    const major = dividendsToMajor([...y], y.rawCurrency);
    if (major) return { ticker, source: "yahoo", events: major.events, note: `${fmpNote}, Yahoo-Fallback, Beträge ${y.rawCurrency} → ${major.currency}`, currency: major.currency };
    return { ticker, source: "yahoo", events: [...y], note: `${fmpNote}, Yahoo-Fallback`, currency: y.currency ?? null };
  }
  return { ticker, source: "none", events: [], note: `${fmpNote}, Yahoo ohne Dividenden` };
}

export function registerDividendRoute(app: Express): void {
  app.get("/api/dividends/:ticker", async (req: Request, res: Response) => {
    const ticker = normalizeDividendTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: "Ungültiger Ticker" });
    const hit = cache.get(cacheKey(ticker));
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body);
    const body = await loadDividendHistory(ticker);
    // Empty results are not cached, so a transient upstream miss does not stick for 12 h.
    if (body.events.length > 0) cache.set(cacheKey(ticker), { at: Date.now(), body });
    res.json(body);
  });
}
