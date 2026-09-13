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
async function fetchFredVolSeries(seriesId: string, cosd: string): Promise<VolPoint[]> {
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

/** Official STOXX V2TX daily file (DD.MM.YYYY;V2TX;value). Spec: Yahoo/Stoox path. */
const STOXX_V2TX_URL =
  "https://www.stoxx.com/document/Indices/Current/HistoricalData/h_v2tx.txt";

const STOXX_UA =
  "Aktienanalyst/1.0 (+https://github.com/1719842374/Aktienanalyst)";

function stoxxErrMsg(e: any): string {
  const parts = [e?.message || e?.name || String(e), e?.cause?.code, e?.cause?.message]
    .filter(Boolean)
    .map((x: any) => String(x));
  const msg = parts.join(" | ").slice(0, 120);
  return msg || "network";
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
  // If from/to filter too thin, keep raw — sliceVolToWindow trims later
  const filtered = raw.filter(p => p.date >= from && p.date <= to);
  if (filtered.length > 10) return { vol: filtered, err: null };
  return { vol: raw, err: null };
}

async function fetchStoxxViaHttps(from: string, to: string): Promise<{ vol: VolPoint[]; err: string | null }> {
  const https = await import("node:https");
  const text: string = await new Promise((resolve, reject) => {
    const req = https.get(
      STOXX_V2TX_URL,
      {
        headers: { "User-Agent": STOXX_UA, Accept: "text/plain,*/*" },
        timeout: 45000,
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

async function fetchStoxxOfficialV2tx(
  from: string,
  to: string,
): Promise<{ vol: VolPoint[]; err: string | null }> {
  const attempts: Array<() => Promise<Response>> = [
    // Match FRED style first (known-good on Render)
    () => fetch(STOXX_V2TX_URL, { signal: AbortSignal.timeout(45000) }),
    () =>
      fetch(STOXX_V2TX_URL, {
        signal: AbortSignal.timeout(45000),
        headers: { "User-Agent": STOXX_UA, Accept: "text/plain,*/*" },
      }),
  ];
  let lastErr: string | null = null;
  for (const run of attempts) {
    try {
      const resp = await run();
      if (!resp.ok) {
        lastErr = `http ${resp.status}`;
        continue;
      }
      const parsed = parseStoxxV2txText(await resp.text(), from, to);
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
async function fetchVstoxxVol(
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
): Promise<{ vol: VolPoint[]; volNote: string | null }> {
  if (book.volKind === "realized" || book.volId === "realized20") {
    return { vol: realizedVol20(etfRows), volNote: null };
  }
  if (region === "US") {
    // MAX ≈ series start 1990; keep headroom for window
    const cosd = yearsAgoISO(40);
    const vol = await fetchFredVolSeries("VIXCLS", cosd);
    return { vol, volNote: vol.length ? null : "FRED VIXCLS leer" };
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
  const { vol: volFull, volNote } = await fetchRegionVol(region, book, rows, from, to);
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
    const regionRaw = String(req.query.region || "US").toUpperCase();
    const region = (regionRaw === "EU" || regionRaw === "AS" ? regionRaw : "US") as RegionId;
    const windowRaw = String(req.query.window || "5Y").toUpperCase();
    const window = WINDOW_DAYS[windowRaw] ? windowRaw : "5Y";
    // v8: STOXX fetch/https fallback + better TypeError msg
    const key = `v8:${region}:${window}`;

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
