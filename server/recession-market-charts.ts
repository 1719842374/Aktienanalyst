/**
 * Four-market vol/price grid for GET /api/analyze-recession/markets (no region)
 * and the lazy click factpack (?date=). Does not import the 17-indicator scorer.
 */
import type { Response } from "express";
import { inflateRawSync } from "node:zlib";
import {
  fmpAnalystEstimates,
  fmpHistoricalPrices,
  fmpIncomeStatementQuarterly,
  fmpKeyMetrics,
  convertFmpRowsToUsd,
  isFmpAvailable,
} from "./fmp";
import { rsiWilder, macd1269 } from "../shared/tech-rsi";
import {
  RECESSION_CHART_MARKETS,
  VOL_Y_MAX,
  buildEtfFactpack,
  chartMarketById,
  leverageStats,
  localVolMaxima,
  normalizeMarketWindow,
  parseFinraMarginSheetXml,
  realizedVol20,
  sliceLeverageSeries,
  sliceTradingWindow,
  snapshotFromFactpack,
  type EpsPrint,
  type FactpackMathInput,
  type MarginDebitPoint,
  type MarketWindow,
  type RecessionChartMarket,
  type RecessionChartMarketId,
  type RecessionFactpackResponse,
  type RecessionLeverage,
  type RecessionMarketsResponse,
  type RecessionOhlcvBar,
  type RecessionVolPoint,
} from "../shared/recession-market-charts";

const TTL_MS = 6 * 60 * 60 * 1000;
const OHLCV_FROM = "1998-06-01";
const FINRA_XLSX = "https://www.finra.org/sites/default/files/2021-03/margin-statistics.xlsx";

function volBandLabel(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  if (v > 40) return "Extreme Fear";
  if (v >= 30) return "Fear";
  if (v >= 20) return "Normal";
  return "Complacency";
}

async function fetchFredVolSeries(seriesId: string, cosd: string): Promise<RecessionVolPoint[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${cosd}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) return [];
    const csv = await resp.text();
    if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
    const out: RecessionVolPoint[] = [];
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

interface StoredFundamentals {
  quarters: EpsPrint[];
  annual: EpsPrint[];
  estimates: EpsPrint[];
}

interface ChartBundle {
  bars: Record<RecessionChartMarketId, RecessionOhlcvBar[]>;
  vol: Record<RecessionChartMarketId, RecessionVolPoint[]>;
  volNote: Record<RecessionChartMarketId, string | null>;
  fundamentals: Record<RecessionChartMarketId, StoredFundamentals>;
  leverage: MarginDebitPoint[] | null;
  leverageError: string | null;
}

let bundleCache: { ts: number; data: ChartBundle } | null = null;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v as Record<string, unknown>[] : [];
}

function knownDate(row: Record<string, unknown>): string {
  return String(row?.filingDate || row?.acceptedDate || row?.date || "").slice(0, 10);
}

function emptyFundamentals(): StoredFundamentals {
  return { quarters: [], annual: [], estimates: [] };
}

async function loadFundamentals(symbol: string): Promise<StoredFundamentals> {
  const [incomeRaw, estimatesRaw, metricsRaw] = await Promise.all([
    fmpIncomeStatementQuarterly(symbol, 80).catch(() => []),
    fmpAnalystEstimates(symbol, 8).catch(() => []),
    fmpKeyMetrics(symbol, 20).catch(() => []),
  ]);
  const income = await convertFmpRowsToUsd(asArray(incomeRaw));
  const estimates = await convertFmpRowsToUsd(asArray(estimatesRaw));
  const quarters: EpsPrint[] = [];
  for (const row of income) {
    const date = knownDate(row);
    const eps = num(row?.epsDiluted ?? row?.eps ?? row?.epsdiluted);
    if (date && eps != null) quarters.push({ date, eps });
  }
  const annual: EpsPrint[] = [];
  for (const row of asArray(metricsRaw)) {
    const date = String(row?.date || "").slice(0, 10);
    const eps = num(row?.netIncomePerShare ?? row?.earningsPerShare ?? row?.eps);
    if (date && eps != null) annual.push({ date, eps });
  }
  const estimateRows: EpsPrint[] = [];
  for (const row of estimates) {
    const date = String(row?.date || "").slice(0, 10);
    const eps = num(row?.epsAvg ?? row?.estimatedEpsAvg ?? row?.estimatedEpsDiluted);
    if (date && eps != null && eps > 0) estimateRows.push({ date, eps });
  }
  return { quarters, annual, estimates: estimateRows };
}

function withIndicators(rows: Array<{
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}>): RecessionOhlcvBar[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted.map(r => r.close);
  const rsi = rsiWilder(closes, 14);
  const macd = macd1269(closes);
  return sorted.map((r, i) => ({
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    rsi: rsi[i],
    macd: macd[i]?.macd ?? null,
    signal: macd[i]?.signal ?? null,
    hist: macd[i]?.hist ?? null,
  }));
}

function parseOhlcv(row: Record<string, unknown>): {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
} | null {
  const date = String(row?.date || row?.Date || "").slice(0, 10);
  const close = num(row?.close ?? row?.adjClose ?? row?.price);
  if (!date || close == null) return null;
  return {
    date,
    open: num(row?.open),
    high: num(row?.high),
    low: num(row?.low),
    close,
    volume: num(row?.volume),
  };
}

function unzipEntry(buf: Buffer, want: string): string | null {
  let i = 0;
  while (i + 30 <= buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) {
      i += 1;
      continue;
    }
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8");
    const start = i + 30 + nameLen + extraLen;
    if (compSize <= 0 || start + compSize > buf.length) {
      i = Math.max(start, i + 1);
      continue;
    }
    const comp = buf.subarray(start, start + compSize);
    if (name === want) {
      if (method === 0) return comp.toString("utf8");
      if (method === 8) return inflateRawSync(comp).toString("utf8");
      return null;
    }
    i = start + compSize;
  }
  return null;
}

export function finraMarginFromXlsxBuffer(buf: Buffer): MarginDebitPoint[] {
  const xml = unzipEntry(buf, "xl/worksheets/sheet1.xml");
  if (!xml) return [];
  return parseFinraMarginSheetXml(xml);
}

async function fetchFinraMargin(): Promise<{ points: MarginDebitPoint[] | null; error: string | null }> {
  try {
    const resp = await fetch(FINRA_XLSX, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Aktienanalyst/1.0", Accept: "*/*" },
    });
    if (!resp.ok) return { points: null, error: `FINRA HTTP ${resp.status}` };
    const points = finraMarginFromXlsxBuffer(Buffer.from(await resp.arrayBuffer()));
    if (points.length < 24) return { points: null, error: "FINRA Serie zu kurz" };
    return { points, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "FINRA nicht erreichbar";
    return { points: null, error: message.slice(0, 160) };
  }
}

async function loadVol(
  book: (typeof RECESSION_CHART_MARKETS)[number],
  bars: RecessionOhlcvBar[],
  from: string,
  to: string,
): Promise<{ vol: RecessionVolPoint[]; volNote: string | null }> {
  if (book.volKind === "realized") {
    return {
      vol: realizedVol20(bars),
      volNote: "Kein Live-VIX (VXFXICLS eingestellt 2022). 20-Tage realisierte Vol.",
    };
  }
  if (book.volId === "VIXCLS" || book.volId === "VXNCLS") {
    const vol = await fetchFredVolSeries(book.volId, `${book.volSince}-01-01`);
    return { vol, volNote: vol.length ? null : `FRED ${book.volId} leer` };
  }
  const { fetchVstoxxVol } = await import("./recession-markets");
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

async function buildBundle(): Promise<ChartBundle> {
  const to = new Date().toISOString().slice(0, 10);
  const leverageP = fetchFinraMargin();
  const built = await Promise.all(RECESSION_CHART_MARKETS.map(async book => {
    const [rawPrices, fundamentals] = await Promise.all([
      fmpHistoricalPrices(book.etf, OHLCV_FROM, to).catch(() => []),
      loadFundamentals(book.etf).catch(() => emptyFundamentals()),
    ]);
    const bars = withIndicators(
      asArray(rawPrices).map(parseOhlcv).filter((x): x is NonNullable<typeof x> => x != null),
    );
    const { vol, volNote } = await loadVol(book, bars, OHLCV_FROM, to);
    return { book, bars, fundamentals, vol, volNote };
  }));
  const leverage = await leverageP;
  const bars = {} as ChartBundle["bars"];
  const vol = {} as ChartBundle["vol"];
  const volNote = {} as ChartBundle["volNote"];
  const fundamentals = {} as ChartBundle["fundamentals"];
  for (const row of built) {
    bars[row.book.id] = row.bars;
    vol[row.book.id] = row.vol;
    volNote[row.book.id] = row.volNote;
    fundamentals[row.book.id] = row.fundamentals;
  }
  return {
    bars,
    vol,
    volNote,
    fundamentals,
    leverage: leverage.points,
    leverageError: leverage.error,
  };
}

async function getBundle(): Promise<ChartBundle> {
  if (bundleCache && Date.now() - bundleCache.ts < TTL_MS) return bundleCache.data;
  const data = await buildBundle();
  const spyOk = data.bars.spy.length > 0;
  if (spyOk) bundleCache = { ts: Date.now(), data };
  return data;
}

function factpackFor(
  bars: RecessionOhlcvBar[],
  fundamentals: StoredFundamentals,
  date: string,
): ReturnType<typeof buildEtfFactpack> {
  const eligible = bars.filter(b => b.date <= date);
  const bar = eligible.length ? eligible[eligible.length - 1] : null;
  const input: FactpackMathInput = {
    date: bar?.date ?? date,
    price: bar?.close ?? null,
    volume: bar?.volume ?? null,
    rsi: bar?.rsi ?? null,
    macd: bar?.macd ?? null,
    signal: bar?.signal ?? null,
    macdHist: bar?.hist ?? null,
    quarters: fundamentals.quarters,
    annual: fundamentals.annual,
    estimates: fundamentals.estimates,
  };
  return buildEtfFactpack(input);
}

function leverageFor(bundle: ChartBundle, windowStart: string | null): {
  leverage: RecessionLeverage | null;
  leverageNote: string | null;
} {
  if (!bundle.leverage || bundle.leverage.length === 0) {
    return { leverage: null, leverageNote: bundle.leverageError || "FINRA Margin Debit nicht lieferbar" };
  }
  const stats = leverageStats(bundle.leverage);
  return {
    leverage: {
      source: "FINRA",
      unit: "Mrd. $",
      latestBillions: stats.latestBillions,
      asOf: stats.asOf,
      yoyPercent: stats.yoyPercent == null ? null : Math.round(stats.yoyPercent * 10) / 10,
      z5y: stats.z5y == null ? null : Math.round(stats.z5y * 100) / 100,
      elevated: stats.elevated,
      series: sliceLeverageSeries(bundle.leverage, windowStart),
    },
    leverageNote: null,
  };
}

function projectMarket(bundle: ChartBundle, id: RecessionChartMarketId, window: MarketWindow): RecessionChartMarket {
  const book = RECESSION_CHART_MARKETS.find(m => m.id === id)!;
  const ohlcv = sliceTradingWindow(bundle.bars[id], window);
  const start = ohlcv[0]?.date ?? null;
  const end = ohlcv[ohlcv.length - 1]?.date ?? null;
  const vol = bundle.vol[id]
    .filter(v => (!start || v.date >= start) && (!end || v.date <= end))
    .sort((a, b) => a.date.localeCompare(b.date));
  const volLatest = vol.length ? vol[vol.length - 1].value : null;
  const last = ohlcv[ohlcv.length - 1];
  const factpack = last
    ? factpackFor(bundle.bars[id], bundle.fundamentals[id], last.date)
    : buildEtfFactpack({
      date: new Date().toISOString().slice(0, 10),
      price: null,
      volume: null,
      rsi: null,
      macd: null,
      signal: null,
      macdHist: null,
      quarters: bundle.fundamentals[id].quarters,
      annual: bundle.fundamentals[id].annual,
      estimates: bundle.fundamentals[id].estimates,
    });
  const lev = book.leverage ? leverageFor(bundle, start) : { leverage: null, leverageNote: null };
  return {
    id: book.id,
    label: book.label,
    indexName: book.indexName,
    etf: book.etf,
    volId: book.volId,
    volKind: book.volKind,
    volSince: book.volSince,
    bandScope: book.bandScope,
    ohlcv,
    vol,
    volMarks: localVolMaxima(vol),
    volYMax: VOL_Y_MAX,
    volLatest,
    volBand: volBandLabel(volLatest),
    volNote: bundle.volNote[id],
    snapshot: snapshotFromFactpack(factpack),
    leverage: lev.leverage,
    leverageNote: lev.leverageNote,
  };
}

export async function handleMarketCharts(res: Response, windowRaw: string): Promise<void> {
  const window = normalizeMarketWindow(windowRaw);
  if (!isFmpAvailable()) {
    res.status(503).json({ error: "FMP nicht konfiguriert", window });
    return;
  }
  try {
    const bundle = await getBundle();
    const markets = RECESSION_CHART_MARKETS.map(m => projectMarket(bundle, m.id, window));
    const asOf = markets.reduce<string | null>((max, m) => {
      const d = m.ohlcv[m.ohlcv.length - 1]?.date ?? null;
      if (!d) return max;
      return !max || d > max ? d : max;
    }, null);
    const body: RecessionMarketsResponse = { asOf, window, markets };
    res.json(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "markets failed";
    console.error("[RECESSION-MARKET-CHARTS]", message);
    res.status(500).json({ error: message, window });
  }
}

export async function handleMarketFactpack(
  res: Response,
  windowRaw: string,
  date: string,
  idRaw: string,
): Promise<void> {
  const window = normalizeMarketWindow(windowRaw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date muss YYYY-MM-DD sein", window });
    return;
  }
  const book = chartMarketById(idRaw);
  if (!book) {
    res.status(400).json({ error: "Unbekannter Markt", id: idRaw, window });
    return;
  }
  if (!isFmpAvailable()) {
    res.status(503).json({ error: "FMP nicht konfiguriert", window, id: book.id });
    return;
  }
  try {
    const bundle = await getBundle();
    const factpack = factpackFor(bundle.bars[book.id], bundle.fundamentals[book.id], date);
    const asOf = bundle.bars[book.id][bundle.bars[book.id].length - 1]?.date ?? null;
    const body: RecessionFactpackResponse = {
      asOf,
      window,
      id: book.id,
      etf: book.etf,
      date: factpack.date,
      factpack,
    };
    res.json(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "factpack failed";
    console.error("[RECESSION-MARKET-FACTPACK]", message);
    res.status(500).json({ error: message, window, id: book.id });
  }
}
