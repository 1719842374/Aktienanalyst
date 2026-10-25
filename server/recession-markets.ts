import type { Express, Request, Response } from "express";
import { fmpHistoricalPrices, isFmpAvailable } from "./fmp";
import { rsiWilder, rsiZone, macd1269, combineRsiMacd, detectRsiDivergence } from "../shared/tech-rsi";

export const MARKET_BOOKS = {
  US: { etf: "SPY", volId: "VIXCLS", volKind: "implied" as const, label: "S&P 500 (SPY)" },
  EU: { etf: "VGK", volId: "V2TX", volKind: "implied" as const, label: "Europa STOXX (VGK)" },
  AS: { etf: "ASHR", volId: "realized20", volKind: "realized" as const, label: "China A (ASHR)" },
} as const;

export type RegionId = keyof typeof MARKET_BOOKS;

const WINDOW_DAYS: Record<string, number> = {
  "1Y": 252,
  "3Y": 756,
  "5Y": 1260,
  "10Y": 2520,
  MAX: 7000,
};

const RSI_PERIOD = 14;
const WARMUP = 80;
const VOL_Y_MAX = 90;

type VolPoint = { date: string; value: number };

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function yearsAgoISO(n: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

function parseClose(row: any): { date: string; close: number; volume?: number } | null {
  const date = String(row?.date || row?.Date || "").slice(0, 10);
  const close = Number(row?.close ?? row?.adjClose ?? row?.price);
  const volume = Number(row?.volume);
  if (!date || !Number.isFinite(close)) return null;
  return { date, close, volume: Number.isFinite(volume) ? volume : undefined };
}

/** FRED CSV — same public fredgraph path as recession.ts (no API key). */
export async function fetchFredVolSeries(seriesId: string, cosd: string): Promise<VolPoint[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${cosd}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) return [];
    const csv = await resp.text();
    if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
    const out: VolPoint[] = [];
    for (const line of csv.trim().split("\n").slice(1)) {
      const [date, valStr] = line.split(",");
      const value = parseFloat(valStr?.trim());
      if (date && Number.isFinite(value)) out.push({ date: date.trim(), value });
    }
    return out;
  } catch {
    return [];
  }
}

/** Yahoo chart symbol per FRED vol series. Only VIX has a Yahoo fallback (Future_1 F1-66 / Future_2 §2). */
export const YAHOO_VOL_FALLBACK: Record<string, string> = { VIXCLS: "^VIX" };

/** Daily closes from a Yahoo v8 chart payload. Null bars (session still printing) are skipped. */
export function parseYahooChartSeries(payload: unknown): VolPoint[] {
  if (!payload || typeof payload !== "object") return [];
  const result = (payload as { chart?: { result?: Array<{ timestamp?: unknown; indicators?: { quote?: Array<{ close?: unknown }> } }> } }).chart?.result?.[0];
  const stamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
  const byDate = new Map<string, number>();
  const n = Math.min(stamps.length, closes.length);
  for (let i = 0; i < n; i++) {
    const raw = closes[i];
    if (raw == null || raw === "") continue;
    const value = typeof raw === "number" ? raw : Number(raw);
    const stamp = typeof stamps[i] === "number" ? stamps[i] : Number(stamps[i]);
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(stamp)) continue;
    byDate.set(new Date(stamp * 1000).toISOString().slice(0, 10), value);
  }
  return Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));
}

/** Yahoo v8 chart (no key, no crumb), daily, from cosd to now + 1 day. */
export async function fetchYahooDailySeries(symbol: string, cosd: string): Promise<VolPoint[]> {
  const p1 = Math.floor(Date.parse(cosd + "T00:00:00Z") / 1000);
  const p2 = Math.floor(Date.now() / 1000) + 86400;
  if (!Number.isFinite(p1)) return [];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Mozilla/5.0" } });
    if (!resp.ok) return [];
    return parseYahooChartSeries(await resp.json());
  } catch {
    return [];
  }
}

/** F1-66: pause between the two FRED attempts (like #274 buffett-route). Tests set 0. */
let fredVolRetryPauseMs = 1500;
export function setFredVolRetryPauseForTests(ms: number): void {
  fredVolRetryPauseMs = ms;
}

/**
 * Chart vol series: FRED first. Only when FRED is empty and the series has a Yahoo twin
 * (VIXCLS → ^VIX) the Yahoo closes fill the chart, with a note. Chart path only; the
 * VIX score keeps its own resolver in recession.ts.
 * F1-66: for a series with a Yahoo twin, FRED gets a second attempt (pause 1.5 s) before Yahoo.
 * Bound: 2 × 20 s FRED + 1.5 s + 20 s Yahoo. volSource names the source that really
 * delivered ("FRED VIXCLS" / "Yahoo ^VIX"), null when both are empty; series without a
 * Yahoo twin carry no volSource (unchanged).
 */
export async function fetchFredVolWithYahooFallback(
  seriesId: string,
  cosd: string,
  deps: {
    fred?: (id: string, cosd: string) => Promise<VolPoint[]>;
    yahoo?: (symbol: string, cosd: string) => Promise<VolPoint[]>;
  } = {},
): Promise<{ vol: VolPoint[]; volNote: string | null; volSource?: string | null }> {
  const fred = deps.fred ?? fetchFredVolSeries;
  const yahoo = deps.yahoo ?? fetchYahooDailySeries;
  const symbol = YAHOO_VOL_FALLBACK[seriesId];
  let vol = await fred(seriesId, cosd);
  if (!vol.length && symbol) {
    if (fredVolRetryPauseMs > 0) await new Promise(resolve => setTimeout(resolve, fredVolRetryPauseMs));
    vol = await fred(seriesId, cosd);
  }
  if (vol.length) return symbol ? { vol, volNote: null, volSource: `FRED ${seriesId}` } : { vol, volNote: null };
  if (!symbol) return { vol, volNote: `FRED ${seriesId} leer` };
  const yv = (await yahoo(symbol, cosd)).filter(p => p.date >= cosd);
  if (!yv.length) return { vol: [], volNote: `FRED ${seriesId} leer, Yahoo ${symbol} leer`, volSource: null };
  return { vol: yv, volNote: `${seriesId === "VIXCLS" ? "VIX" : seriesId} via Yahoo ${symbol} (FRED ${seriesId} leer)`, volSource: `Yahoo ${symbol}` };
}

/** Official STOXX V2TX daily file (DD.MM.YYYY;V2TX;value). Spec: Yahoo/Stoox path. */
const STOXX_V2TX_URL =
  "https://www.stoxx.com/document/Indices/Current/HistoricalData/h_v2tx.txt";

const STOXX_UA =
  "Aktienanalyst/1.0 (+https://github.com/1719842374/Aktienanalyst)";

function stoxxErrMsg(e: any): string {
  // Prefer message/cause — Error.name alone is useless ("TypeError")
  const parts = [e?.message, e?.cause?.code, e?.cause?.message, e?.name]
    .filter(Boolean)
    .map((x: any) => String(x));
  const seen = new Set<string>();
  const uniq = parts.filter(p => (seen.has(p) ? false : (seen.add(p), true)));
  return (uniq.join(" | ") || "network").slice(0, 120);
}

/** Prefer AbortController — timeout() helper is flaky under some undici builds. */
function abortAfter(ms: number): { signal: AbortSignal; clear: () => void } {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, clear: () => clearTimeout(t) };
}

function parseStoxxV2txText(text: string, from: string, to: string): { vol: VolPoint[]; err: string | null } {
  if (!text) return { vol: [], err: "empty body" };
  if (/<html|<!DOCTYPE/i.test(text)) return { vol: [], err: "html/bot" };
  const raw: VolPoint[] = [];
  for (const line of text.trim().split("\n").slice(1)) {
    const parts = line.split(";");
    if (parts.length < 3) continue;
    const dRaw = parts[0];
    const vRaw = parts[parts.length - 1];
    const dp = dRaw.trim().replace(/\r/g, "").split(".");
    if (dp.length !== 3) continue;
    const [dd, mm, yyyy] = dp;
    if (!yyyy || yyyy.length !== 4) continue;
    const iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    const value = parseFloat(String(vRaw).trim().replace(/\r/g, "").replace(",", "."));
    if (!Number.isFinite(value)) continue;
    raw.push({ date: iso, value });
  }
  raw.sort((x, y) => x.date.localeCompare(y.date));
  if (raw.length <= 10) return { vol: [], err: `parse ${raw.length} rows` };
  const filtered = raw.filter(p => p.date >= from && p.date <= to);
  if (filtered.length > 10) return { vol: filtered, err: null };
  return { vol: raw, err: null };
}

async function fetchStoxxViaHttps(from: string, to: string): Promise<{ vol: VolPoint[]; err: string | null }> {
  const https = await import("node:https");
  const fs = await import("node:fs");
  // Prefer system CA bundle when present (Docker ca-certificates + SSL_CERT_FILE)
  let ca: string | undefined;
  try {
    const p = process.env.SSL_CERT_FILE || "/etc/ssl/certs/ca-certificates.crt";
    if (fs.existsSync(p)) ca = fs.readFileSync(p, "utf8");
  } catch {
    /* fall back to Node defaults */
  }
  const text: string = await new Promise((resolve, reject) => {
    const req = https.get(
      STOXX_V2TX_URL,
      {
        headers: { "User-Agent": STOXX_UA, Accept: "text/plain,*/*" },
        timeout: 45000,
        ...(ca ? { ca } : {}),
      },
      res => {
        if ((res.statusCode || 0) >= 400) {
          reject(new Error(`http ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
  return parseStoxxV2txText(text, from, to);
}

async function fetchStoxxWithFetch(
  initHeaders?: Record<string, string>,
): Promise<string> {
  const { signal, clear } = abortAfter(45000);
  try {
    const resp = await fetch(STOXX_V2TX_URL, {
      signal,
      ...(initHeaders ? { headers: initHeaders } : {}),
    });
    if (!resp.ok) throw new Error(`http ${resp.status}`);
    return await resp.text();
  } finally {
    clear();
  }
}

async function fetchStoxxOfficialV2tx(
  from: string,
  to: string,
): Promise<{ vol: VolPoint[]; err: string | null }> {
  const attempts: Array<() => Promise<string>> = [
    () => fetchStoxxWithFetch(),
    () => fetchStoxxWithFetch({ "User-Agent": STOXX_UA, Accept: "text/plain,*/*" }),
  ];
  let lastErr: string | null = null;
  for (const run of attempts) {
    try {
      const parsed = parseStoxxV2txText(await run(), from, to);
      if (parsed.vol.length > 10) return parsed;
      lastErr = parsed.err;
    } catch (e: any) {
      lastErr = stoxxErrMsg(e);
    }
  }
  try {
    const viaHttps = await fetchStoxxViaHttps(from, to);
    if (viaHttps.vol.length > 10) return viaHttps;
    lastErr = viaHttps.err || lastErr;
  } catch (e: any) {
    lastErr = stoxxErrMsg(e) || lastErr;
  }
  return { vol: [], err: lastErr || "network" };
}

/** VSTOXX: FMP first, then STOXX official h_v2tx.txt (Yahoo delisted / Stooq bot-wall). */
export async function fetchVstoxxVol(
  from: string,
  to: string,
): Promise<{ vol: VolPoint[]; source: "fmp" | "stoxx" | null; stoxxErr: string | null }> {
  for (const sym of ["^V2TX", "V2TX"]) {
    try {
      const rawPrices = await fmpHistoricalPrices(sym, from, to);
      const rows = (Array.isArray(rawPrices) ? rawPrices : [])
        .map(parseClose)
        .filter((x): x is NonNullable<typeof x> => x != null)
        .sort((a2, b2) => a2.date.localeCompare(b2.date));
      if (rows.length > 10) {
        return {
          vol: rows.map(r => ({ date: r.date, value: r.close })),
          source: "fmp",
          stoxxErr: null,
        };
      }
    } catch {
      /* try next */
    }
  }
  const { vol, err } = await fetchStoxxOfficialV2tx(from, to);
  if (vol.length > 10) return { vol, source: "stoxx", stoxxErr: null };
  return { vol: [], source: null, stoxxErr: err };
}

/** 20-session realized vol (annualized %): sqrt(252) * stdev(ln returns). */
function realizedVol20(closes: { date: string; close: number }[]): VolPoint[] {
  const out: VolPoint[] = [];
  for (let i = 20; i < closes.length; i++) {
    const rets: number[] = [];
    for (let j = i - 19; j <= i; j++) {
      const a = closes[j - 1]?.close;
      const b = closes[j]?.close;
      if (!(a > 0) || !(b > 0)) continue;
      rets.push(Math.log(b / a));
    }
    if (rets.length < 15) continue;
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    const var_ = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
    const ann = Math.sqrt(Math.max(0, var_) * 252) * 100;
    if (Number.isFinite(ann)) out.push({ date: closes[i].date, value: ann });
  }
  return out;
}

function sliceVolToWindow(vol: VolPoint[], windowStart: string | null, days: number): VolPoint[] {
  if (!vol.length) return [];
  if (windowStart) {
    return vol.filter(v => v.date >= windowStart).slice(-days);
  }
  return vol.slice(-days);
}

function volBandLabel(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  if (v > 40) return "Extreme Fear";
  if (v >= 30) return "Fear";
  if (v >= 20) return "Normal";
  return "Complacency";
}

async function fetchRegionVol(
  region: RegionId,
  book: (typeof MARKET_BOOKS)[RegionId],
  etfRows: { date: string; close: number }[],
  from: string,
  to: string,
): Promise<{ vol: VolPoint[]; volNote: string | null; volSource?: string | null }> {
  if (book.volKind === "realized" || book.volId === "realized20") {
    return { vol: realizedVol20(etfRows), volNote: null };
  }
  if (region === "US") {
    // MAX ≈ series start 1990; keep headroom for window
    const cosd = yearsAgoISO(40);
    return fetchFredVolWithYahooFallback("VIXCLS", cosd);
  }
  // EU implied: VSTOXX — FMP first, STOXX official fallback
  const { vol, source, stoxxErr } = await fetchVstoxxVol(from, to);
  if (!vol.length) {
    const why = stoxxErr ? `STOXX ${stoxxErr}` : "STOXX leer";
    return { vol, volNote: `VSTOXX nicht lieferbar (FMP leer, ${why})` };
  }
  return {
    vol,
    volNote: source === "stoxx" ? "VSTOXX via STOXX h_v2tx.txt (FMP leer)" : null,
  };
}

export async function buildRegionMarket(region: RegionId, window: string) {
  const book = MARKET_BOOKS[region];
  const days = WINDOW_DAYS[window] || WINDOW_DAYS["5Y"];
  const to = new Date().toISOString().slice(0, 10);
  const from = addDays(to, -(days + WARMUP + RSI_PERIOD));

  const raw = await fmpHistoricalPrices(book.etf, from, to);
  const rows = (Array.isArray(raw) ? raw : [])
    .map(parseClose)
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const closes = rows.map(r => r.close);
  const rsi = rsiWilder(closes, RSI_PERIOD);
  const macd = macd1269(closes);
  const cut = Math.max(0, rows.length - days);
  const series = rows.slice(cut).map((r, i) => {
    const idx = i + cut;
    const m = macd[idx] || { macd: null, signal: null, hist: null };
    return {
      date: r.date,
      close: r.close,
      volume: r.volume ?? null,
      rsi: rsi[idx],
      macd: m.macd,
      signal: m.signal,
      hist: m.hist,
    };
  });

  const windowStart = series[0]?.date ?? null;
  const { vol: volFull, volNote, volSource } = await fetchRegionVol(region, book, rows, from, to);
  const vol = sliceVolToWindow(volFull, windowStart, days);
  const volLatest = vol.length ? vol[vol.length - 1].value : null;

  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const lastRsi = last?.rsi ?? null;
  const combo = combineRsiMacd(
    lastRsi,
    last?.macd ?? null,
    last?.signal ?? null,
    last?.hist ?? null,
    prev?.hist ?? null,
  );
  const winCloses = series.map(s => s.close);
  const winRsi = series.map(s => s.rsi);
  const divergence = detectRsiDivergence(winCloses, winRsi, { lookback: 90, order: 5, minGap: 8 });
  const d1 = divergence.i1 >= 0 ? series[divergence.i1]?.date ?? null : null;
  const d2 = divergence.i2 >= 0 ? series[divergence.i2]?.date ?? null : null;

  return {
    region,
    label: book.label,
    etf: book.etf,
    volId: book.volId,
    volKind: book.volKind,
    volYMax: VOL_Y_MAX,
    volLatest,
    volBand: volBandLabel(volLatest),
    volNote,
    // F1-66: real source of the VIX series (FRED VIXCLS / Yahoo ^VIX, null = both empty); absent for EU/AS.
    ...(volSource !== undefined ? { volSource } : {}),
    vol,
    window,
    asOf: last?.date ?? null,
    rsiPeriod: RSI_PERIOD,
    rsi: lastRsi,
    rsiZone: rsiZone(lastRsi),
    macd: last?.macd ?? null,
    signal: last?.signal ?? null,
    hist: last?.hist ?? null,
    combo,
    divergence: {
      kind: divergence.kind,
      lookback: divergence.lookback,
      from: d1,
      to: d2,
      price1: divergence.price1,
      price2: divergence.price2,
      rsi1: divergence.rsi1,
      rsi2: divergence.rsi2,
    },
    points: series.length,
    series,
  };
}

let marketCache: { key: string; ts: number; data: any } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000;

export function registerRecessionMarketRoutes(app: Express) {
  app.get("/api/analyze-recession/markets", async (req: Request, res: Response) => {
    // Charts contract (?window= / ?date=) lives next to this handler.
    // ?region= without date keeps the RSI/MACD payload below.
    const { tryHandleRecessionMarketCharts } = await import("./recession-market-charts");
    if (await tryHandleRecessionMarketCharts(req, res)) return;

    const regionRaw = String(req.query.region || "US").toUpperCase();
    const region = (regionRaw === "EU" || regionRaw === "AS" ? regionRaw : "US") as RegionId;
    const windowRaw = String(req.query.window || "5Y").toUpperCase();
    const window = WINDOW_DAYS[windowRaw] ? windowRaw : "5Y";
    // v10: AbortController + Docker ca-certificates / use-openssl-ca
    const key = `v10:${region}:${window}`;

    if (marketCache && marketCache.key === key && Date.now() - marketCache.ts < TTL_MS) {
      return res.json(marketCache.data);
    }
    if (!isFmpAvailable()) {
      return res.status(503).json({ error: "FMP nicht konfiguriert", region, window });
    }
    try {
      const data = await buildRegionMarket(region, window);
      // Empty EU vol often transient (STOXX egress) — do not pin for 6h
      const euEmpty =
        region === "EU" && Array.isArray(data?.vol) && data.vol.length === 0;
      if (!euEmpty) {
        marketCache = { key, ts: Date.now(), data };
      }
      res.json(data);
    } catch (err: any) {
      console.error("[RECESSION-MARKETS]", err?.message);
      res.status(500).json({ error: err?.message || "markets failed", region, window });
    }
  });
}
