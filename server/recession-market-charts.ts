/**
 * GET /api/analyze-recession/markets?window=  — four-market charts.
 * ?region= stays on the RSI/MACD handler in recession-markets.ts.
 * Factpack: ?etf=&date=&window=
 */
import type { Request, Response } from "express";
import { inflateRawSync } from "node:zlib";
import {
  fmpAnalystEstimates,
  fmpHistoricalPrices,
  fmpIncomeStatementQuarterly,
  fmpKeyMetrics,
  isFmpAvailable,
} from "./fmp";
import { fetchFredVolSeries, fetchVstoxxVol } from "./recession-markets";
import { macd1269, rsiWilder } from "../shared/tech-rsi";
import {
  CHART_BOOKS,
  SERIES_FLOOR,
  VOL_Y_MAX,
  chartBarSchema,
  chartBookById,
  factpackSchema,
  finraLeverage,
  leverageForMarket,
  localVolMaxima,
  marketsResponseSchema,
  ohlcvFetchFrom,
  parseFinraMarginSheetXml,
  parseMarketWindow,
  realizedVol20,
  sliceByWindow,
  ttmEpsAt,
  valuationFromParts,
  type ChartBar,
  type EpsPrint,
  type LeverageStrip,
  type MarketChart,
  type MarketFactpack,
  type MarketsResponse,
  type MarketWindow,
  type VolPoint,
} from "../shared/recession-market-charts";

const TTL_MS = 6 * 60 * 60 * 1000;
const FINRA_XLSX_URL = "https://www.finra.org/sites/default/files/2021-03/margin-statistics.xlsx";

const bundleCache = new Map<string, { ts: number; data: MarketsResponse }>();
const factpackCache = new Map<string, { ts: number; data: MarketFactpack }>();

interface RawBar {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function parseBar(row: unknown): RawBar | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const date = String(r.date ?? "").slice(0, 10);
  const close = num(r.close) ?? num(r.adjClose);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close == null) return null;
  return {
    date,
    open: num(r.open),
    high: num(r.high),
    low: num(r.low),
    close,
    volume: num(r.volume),
  };
}

function attachIndicators(rows: RawBar[]): ChartBar[] {
  const closes = rows.map((r) => r.close);
  const rsi = rsiWilder(closes, 14);
  const macd = macd1269(closes);
  return rows.map((r, i) => {
    const m = macd[i] ?? { macd: null, signal: null, hist: null };
    const bar = {
      date: r.date,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
      rsi: rsi[i] ?? null,
      macd: m.macd,
      signal: m.signal,
      hist: m.hist,
    };
    return chartBarSchema.parse(bar);
  });
}

async function loadBars(etf: string, from: string, to: string): Promise<RawBar[]> {
  const raw = await fmpHistoricalPrices(etf, from, to);
  const rows = (Array.isArray(raw) ? raw : [])
    .map(parseBar)
    .filter((x): x is RawBar => x != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

function epsFromIncomeRow(row: unknown): EpsPrint | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const date = String(r.date ?? r.fillingDate ?? r.filingDate ?? "").slice(0, 10);
  const eps = num(r.epsdiluted) ?? num(r.eps) ?? num(r.netIncomePerShare);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || eps == null) return null;
  return { date, eps };
}

async function loadQuarterlyEps(symbol: string): Promise<EpsPrint[]> {
  const raw = await fmpIncomeStatementQuarterly(symbol, 80);
  return (Array.isArray(raw) ? raw : [])
    .map(epsFromIncomeRow)
    .filter((x): x is EpsPrint => x != null);
}

async function loadEpsPrints(etf: string, indexFallback: string | null): Promise<EpsPrint[]> {
  const primary = await loadQuarterlyEps(etf);
  if (primary.length >= 8 || !indexFallback) return primary;
  try {
    const fallback = await loadQuarterlyEps(indexFallback);
    return fallback.length > primary.length ? fallback : primary;
  } catch {
    return primary;
  }
}

function pickNtmEps(raw: unknown, asOf: string): number | null {
  if (!Array.isArray(raw)) return null;
  const rows: { date: string; eps: number }[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? "").slice(0, 10);
    const eps = num(r.estimatedEpsAvg) ?? num(r.epsAvg) ?? num(r.estimatedEps);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || eps == null || eps <= 0) continue;
    rows.push({ date, eps });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = rows.find((r) => r.date >= asOf);
  return (upcoming ?? rows[rows.length - 1])?.eps ?? null;
}

async function loadKeyMetricsPe(symbol: string): Promise<number | null> {
  const raw = await fmpKeyMetrics(symbol, 1);
  const row = Array.isArray(raw) ? raw[0] : null;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const pe = num(r.peRatio) ?? num(r.pe);
  return pe != null && pe > 0 ? pe : null;
}

async function loadVol(
  book: (typeof CHART_BOOKS)[number],
  bars: RawBar[],
  from: string,
  to: string,
): Promise<{ vol: VolPoint[]; volNote: string | null }> {
  if (book.volKind === "realized") {
    return {
      vol: realizedVol20(bars),
      volNote: "20T-realisierte Vol (annualisiert, %). Kein Live-VIX — VXFXICLS eingestellt 2022.",
    };
  }
  if (book.fredStart) {
    const vol = await fetchFredVolSeries(book.volId, book.fredStart);
    return { vol, volNote: vol.length ? null : `FRED ${book.volId} leer` };
  }
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

function emptySnapshot(rsi: number | null, macdHist: number | null): MarketChart["snapshot"] {
  return { pe: null, peFwd: null, peg: null, pegFwd: null, epsYoy: null, rsi, macdHist };
}

function sliceVol(vol: VolPoint[], ohlcv: ChartBar[], window: MarketWindow): VolPoint[] {
  const sorted = [...vol].sort((a, b) => a.date.localeCompare(b.date));
  if (ohlcv.length) {
    const a = ohlcv[0].date;
    const b = ohlcv[ohlcv.length - 1].date;
    return sorted.filter((v) => v.date >= a && v.date <= b && v.date >= SERIES_FLOOR);
  }
  return sliceByWindow(sorted, window);
}

export function unzipEntry(buf: Buffer, name: string): Buffer | null {
  let offset = 0;
  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const fileName = buf.slice(offset + 30, offset + 30 + nameLen).toString("utf8");
    const dataStart = offset + 30 + nameLen + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buf.length) return null;
    const data = buf.slice(dataStart, dataEnd);
    if (fileName === name) {
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      return null;
    }
    offset = dataEnd;
  }
  return null;
}

export async function fetchFinraMarginDebit(): Promise<{ date: string; debitMillions: number }[]> {
  const resp = await fetch(FINRA_XLSX_URL, {
    signal: AbortSignal.timeout(20000),
    headers: { "User-Agent": "Aktienanalyst/1.0" },
  });
  if (!resp.ok) return [];
  const buf = Buffer.from(await resp.arrayBuffer());
  const xml = unzipEntry(buf, "xl/worksheets/sheet1.xml");
  if (!xml) return [];
  return parseFinraMarginSheetXml(xml.toString("utf8"));
}

async function loadLeverage(): Promise<{ strip: LeverageStrip | null; note: string | null }> {
  try {
    const points = await fetchFinraMarginDebit();
    const strip = finraLeverage(points);
    if (!strip) return { strip: null, note: "FINRA Margin Debit nicht lieferbar" };
    return { strip, note: null };
  } catch {
    return { strip: null, note: "FINRA Margin Debit nicht lieferbar" };
  }
}

async function valuationForBar(
  book: (typeof CHART_BOOKS)[number],
  bar: ChartBar,
  allowForward: boolean,
  prints: EpsPrint[] | null,
  ntm: number | null,
  keyPe: number | null,
): Promise<ReturnType<typeof valuationFromParts>> {
  const { ttm, prevTtm } = ttmEpsAt(prints ?? [], bar.date);
  return valuationFromParts({
    price: bar.close,
    ttmEps: ttm,
    prevTtmEps: prevTtm,
    epsNtm: ntm,
    allowForward,
    keyMetricsPe: allowForward ? keyPe : null,
  });
}

export async function buildChartMarket(
  book: (typeof CHART_BOOKS)[number],
  window: MarketWindow,
  leverage: { strip: LeverageStrip | null; note: string | null } | null,
  withValuation: boolean,
): Promise<MarketChart> {
  const to = new Date().toISOString().slice(0, 10);
  const from = ohlcvFetchFrom(window, to);
  const rawBars = await loadBars(book.etf, from, to);
  const indicated = attachIndicators(rawBars);
  const ohlcv = sliceByWindow(indicated, window);
  const { vol: volFull, volNote } = await loadVol(book, rawBars, from, to);
  const vol = sliceVol(volFull, ohlcv, window);
  const marks = localVolMaxima(vol);
  const last = ohlcv[ohlcv.length - 1] ?? null;
  let snapshot = emptySnapshot(last?.rsi ?? null, last?.hist ?? null);
  if (withValuation && last) {
    try {
      const [prints, estimates, keyPe] = await Promise.all([
        loadEpsPrints(book.etf, book.indexFallback),
        fmpAnalystEstimates(book.etf, 8).catch(() => []),
        loadKeyMetricsPe(book.etf).catch(() => null),
      ]);
      const ntm = pickNtmEps(estimates, last.date);
      const v = await valuationForBar(book, last, true, prints, ntm, keyPe);
      snapshot = {
        pe: v.pe,
        peFwd: v.peFwd,
        peg: v.peg,
        pegFwd: v.pegFwd,
        epsYoy: v.epsYoy,
        rsi: last.rsi,
        macdHist: last.hist,
      };
    } catch (err) {
      console.error(`[RECESSION-CHARTS] valuation ${book.etf}`, err instanceof Error ? err.message : err);
    }
  }
  const strip = leverage ? leverageForMarket(book.id, leverage.strip) : null;
  return {
    id: book.id,
    etf: book.etf,
    name: book.name,
    volId: book.volId,
    volKind: book.volKind,
    bandsAnalog: book.bandsAnalog,
    volYMax: VOL_Y_MAX,
    volNote,
    ohlcv,
    vol,
    marks,
    snapshot,
    leverage: strip,
    leverageNote: book.id === "SPY" ? (strip ? null : leverage?.note ?? null) : null,
    valuationLabel: "ETF-Proxy",
  };
}

function failedMarket(book: (typeof CHART_BOOKS)[number], message: string): MarketChart {
  return {
    id: book.id,
    etf: book.etf,
    name: book.name,
    volId: book.volId,
    volKind: book.volKind,
    bandsAnalog: book.bandsAnalog,
    volYMax: VOL_Y_MAX,
    volNote: message,
    ohlcv: [],
    vol: [],
    marks: [],
    snapshot: emptySnapshot(null, null),
    leverage: null,
    leverageNote: book.id === "SPY" ? "FINRA Margin Debit nicht lieferbar" : null,
    valuationLabel: "ETF-Proxy",
  };
}

function bundleCacheable(data: MarketsResponse): boolean {
  return data.markets.every((m) => {
    if (m.ohlcv.length === 0) return false;
    if (m.volKind === "implied" && m.vol.length === 0) return false;
    return true;
  });
}

export async function buildMarketsResponse(window: MarketWindow): Promise<MarketsResponse> {
  const leverage = await loadLeverage();
  const markets = await Promise.all(
    CHART_BOOKS.map(async (book) => {
      try {
        return await buildChartMarket(book, window, leverage, true);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Markt nicht lieferbar";
        console.error(`[RECESSION-CHARTS] ${book.etf}`, message);
        return failedMarket(book, message);
      }
    }),
  );
  const asOf = markets.reduce<string | null>((acc, m) => {
    const d = m.ohlcv[m.ohlcv.length - 1]?.date ?? null;
    if (!d) return acc;
    if (!acc || d > acc) return d;
    return acc;
  }, null);
  return marketsResponseSchema.parse({ asOf, window, markets });
}

async function buildFactpack(
  etf: string,
  date: string,
  window: MarketWindow,
): Promise<{ pack: MarketFactpack; cacheable: boolean } | null> {
  const book = chartBookById(etf);
  if (!book) return null;
  const market = await buildChartMarket(book, window, null, false);
  const bar = market.ohlcv.find((p) => p.date === date) ?? null;
  if (!bar) return null;
  const lastDate = market.ohlcv[market.ohlcv.length - 1]?.date ?? null;
  const allowForward = bar.date === lastDate;
  let prints: EpsPrint[] = [];
  let ntm: number | null = null;
  let keyPe: number | null = null;
  let cacheable = true;
  try {
    const [epsRows, estimates, pe] = await Promise.all([
      loadEpsPrints(book.etf, book.indexFallback),
      allowForward ? fmpAnalystEstimates(book.etf, 8).catch(() => []) : Promise.resolve([]),
      allowForward ? loadKeyMetricsPe(book.etf).catch(() => null) : Promise.resolve(null),
    ]);
    prints = epsRows;
    ntm = pickNtmEps(estimates, bar.date);
    keyPe = pe;
  } catch (err) {
    cacheable = false;
    console.error(`[RECESSION-CHARTS] factpack ${book.etf}`, err instanceof Error ? err.message : err);
  }
  const v = await valuationForBar(book, bar, allowForward, prints, ntm, keyPe);
  const pack = factpackSchema.parse({
    id: book.id,
    etf: book.etf,
    date: bar.date,
    close: bar.close,
    valuationLabel: "ETF-Proxy",
    pe: v.pe,
    peFwd: v.peFwd,
    peg: v.peg,
    pegFwd: v.pegFwd,
    epsYoy: v.epsYoy,
    gCons: v.gCons,
    rsi: bar.rsi,
    macd: bar.macd,
    macdSignal: bar.signal,
    macdHist: bar.hist,
    volume: bar.volume,
    pegExpensive: v.pegExpensive,
    pegFwdExpensive: v.pegFwdExpensive,
    note: v.note,
  });
  return { pack, cacheable };
}

function cacheGet<T>(map: Map<string, { ts: number; data: T }>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > TTL_MS) {
    map.delete(key);
    return null;
  }
  return hit.data;
}

/**
 * Handles the charts contract. Returns false when `region` is set and `date` is absent
 * so the existing RSI/MACD handler keeps its response shape.
 */
export async function tryHandleRecessionMarketCharts(req: Request, res: Response): Promise<boolean> {
  const date = typeof req.query.date === "string" ? req.query.date.trim() : "";
  const hasRegion = req.query.region != null && String(req.query.region).length > 0;
  if (!date && hasRegion) return false;

  if (!isFmpAvailable()) {
    res.status(503).json({ error: "FMP nicht konfiguriert" });
    return true;
  }

  const window = parseMarketWindow(req.query.window);

  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: "date erwartet YYYY-MM-DD" });
      return true;
    }
    const etf = String(req.query.etf || req.query.id || "").toUpperCase();
    if (!chartBookById(etf)) {
      res.status(400).json({ error: "etf muss SPY, QQQ, VGK oder ASHR sein" });
      return true;
    }
    const key = `v1:${window}:${etf}:${date}`;
    const cached = cacheGet(factpackCache, key);
    if (cached) {
      res.json(cached);
      return true;
    }
    try {
      const built = await buildFactpack(etf, date, window);
      if (!built) {
        res.status(404).json({ error: `Kein Handelstag ${date} im Fenster ${window}`, etf, window });
        return true;
      }
      if (built.cacheable) factpackCache.set(key, { ts: Date.now(), data: built.pack });
      res.json(built.pack);
    } catch (err) {
      const message = err instanceof Error ? err.message : "factpack failed";
      console.error("[RECESSION-CHARTS]", message);
      res.status(500).json({ error: message });
    }
    return true;
  }

  const key = `v1:${window}`;
  const cached = cacheGet(bundleCache, key);
  if (cached) {
    res.json(cached);
    return true;
  }
  try {
    const data = await buildMarketsResponse(window);
    if (bundleCacheable(data)) bundleCache.set(key, { ts: Date.now(), data });
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "markets failed";
    console.error("[RECESSION-CHARTS]", message);
    res.status(500).json({ error: message, window });
  }
  return true;
}
