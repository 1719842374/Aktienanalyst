/**
 * GET /api/analyze-recession/markets?window=  — four-market charts.
 * ?region= stays on the RSI/MACD handler in recession-markets.ts.
 * Factpack: ?etf=&date=&window=
 */
import type { Request, Response } from "express";
import { inflateRawSync } from "node:zlib";
import {
  fmpAnalystEstimates,
  fmpEarningsCalendar,
  fmpHistoricalPrices,
  fmpIncomeStatementQuarterly,
  fmpKeyMetrics,
  fmpRatiosQuarterly,
  fmpRatiosTtm,
  isFmpAvailable,
} from "./fmp";
import { fetchFredVolSeries, fetchVstoxxVol } from "./recession-markets";
import { macd1269, rsiWilder } from "../shared/tech-rsi";
import {
  CHART_BOOKS,
  SERIES_FLOOR,
  VOL_Y_MAX,
  addDaysIso,
  chartBarSchema,
  chartBookById,
  factpackSchema,
  epsPrintFromEarningsRow,
  epsPrintFromRatioQuarter,
  epsPrintFromRow,
  finraLeverage,
  instrumentCanPriceEps,
  leverageForMarket,
  localVolMaxima,
  marketsResponseSchema,
  ntmEpsFromEstimateRows,
  ohlcvFetchFrom,
  parseFinraMarginSheetXml,
  parseMarketWindow,
  pegFieldsFromMetricsRow,
  pickValuationInstrument,
  realizedVol20,
  sliceByWindow,
  ttmEpsFromRatiosTtmRow,
  valuationFromFmpRows,
  valuationLabelFor,
  type ChartBar,
  type LeverageStrip,
  type MarketChart,
  type MarketFactpack,
  type MarketsResponse,
  type MarketWindow,
  type ValuationInstrument,
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

function asRows(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function firstRow(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw[0] ?? null;
  if (raw && typeof raw === "object") return raw;
  return null;
}

function rowHasVendorPeg(row: unknown): boolean {
  const extra = pegFieldsFromMetricsRow(row);
  return extra.peg != null || extra.pegFwd != null;
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
  return {
    pe: null,
    peFwd: null,
    peg: null,
    pegFwd: null,
    pegKind: null,
    pegFwdKind: null,
    epsYoy: null,
    rsi,
    macdHist,
    missing: null,
  };
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

async function loadLeverage(window: MarketWindow): Promise<{ strip: LeverageStrip | null; note: string | null }> {
  try {
    const points = await fetchFinraMarginDebit();
    const strip = finraLeverage(points, window);
    if (!strip) return { strip: null, note: "FINRA Margin Debit nicht lieferbar" };
    return { strip, note: null };
  } catch {
    return { strip: null, note: "FINRA Margin Debit nicht lieferbar" };
  }
}

interface PrintSources {
  incomeRows: unknown[];
  earningsRows: unknown[];
  ratioQuarterRows: unknown[];
  ratiosTtmRow: unknown;
  notes: string[];
}

function noteShortPrints(notes: string[], call: string, rows: unknown[], parsed: number, emptyField: string) {
  if (parsed >= 4) return;
  if (rows.length === 0) notes.push(`${call} leer`);
  else if (parsed === 0) notes.push(`${call} ohne ${emptyField}`);
  else notes.push(`${call} hat ${parsed} EPS-Drucke, TTM braucht 4`);
}

async function loadPrintSources(symbol: string): Promise<PrintSources> {
  const notes: string[] = [];
  let incomeRows: unknown[] = [];
  let earningsRows: unknown[] = [];
  let ratioQuarterRows: unknown[] = [];
  let ratiosTtmRow: unknown = null;

  const incomeCall = `GET /stable/income-statement?symbol=${symbol}&period=quarter`;
  try {
    const rows = asRows(await fmpIncomeStatementQuarterly(symbol, 80));
    const parsed = rows.map(epsPrintFromRow).filter((x) => x != null).length;
    if (parsed > 0) incomeRows = rows;
    noteShortPrints(notes, incomeCall, rows, parsed, "epsDiluted/eps");
  } catch {
    notes.push(`${incomeCall} fehlgeschlagen`);
  }

  const incomeN = incomeRows.map(epsPrintFromRow).filter((x) => x != null).length;
  if (incomeN < 8) {
    const call = `GET /stable/earnings?symbol=${symbol}`;
    try {
      const rows = asRows(await fmpEarningsCalendar(symbol));
      const parsed = rows.map(epsPrintFromEarningsRow).filter((x) => x != null).length;
      if (parsed > 0) earningsRows = rows;
      noteShortPrints(notes, call, rows, parsed, "epsActual");
    } catch {
      notes.push(`${call} fehlgeschlagen`);
    }
  }

  const earningsN = earningsRows.map(epsPrintFromEarningsRow).filter((x) => x != null).length;
  if (Math.max(incomeN, earningsN) < 8) {
    const call = `GET /stable/ratios?symbol=${symbol}&period=quarter`;
    try {
      const rows = asRows(await fmpRatiosQuarterly(symbol, 40));
      const parsed = rows.map(epsPrintFromRatioQuarter).filter((x) => x != null).length;
      if (parsed > 0) ratioQuarterRows = rows;
      noteShortPrints(notes, call, rows, parsed, "netIncomePerShare");
    } catch {
      notes.push(`${call} fehlgeschlagen`);
    }
  }

  const ratioN = ratioQuarterRows.map(epsPrintFromRatioQuarter).filter((x) => x != null).length;
  if (Math.max(incomeN, earningsN, ratioN) < 8) {
    const call = `GET /stable/ratios-ttm?symbol=${symbol}`;
    try {
      const row = firstRow(await fmpRatiosTtm(symbol));
      ratiosTtmRow = row;
      if (ttmEpsFromRatiosTtmRow(row) == null && Math.max(incomeN, earningsN, ratioN) < 4) {
        notes.push(row ? `${call} ohne netIncomePerShareTTM` : `${call} leer`);
      }
    } catch {
      notes.push(`${call} fehlgeschlagen`);
    }
  }

  return { incomeRows, earningsRows, ratioQuarterRows, ratiosTtmRow, notes };
}

function instrumentFrom(
  symbol: string,
  role: ValuationInstrument["role"],
  price: number | null,
  sources: PrintSources,
  allowForward: boolean,
): ValuationInstrument {
  const vendor = rowHasVendorPeg(sources.ratiosTtmRow)
    ? sources.ratiosTtmRow
    : sources.ratioQuarterRows.find((row) => rowHasVendorPeg(row)) ?? sources.ratiosTtmRow;
  return {
    symbol,
    role,
    price,
    incomeRows: sources.incomeRows,
    earningsRows: sources.earningsRows,
    ratioQuarterRows: sources.ratioQuarterRows,
    ratiosTtmRow: allowForward ? sources.ratiosTtmRow : null,
    vendorRatiosRow: allowForward ? vendor : null,
    keyMetricsRow: null,
    estimateRows: [],
  };
}

async function closeOnOrBefore(symbol: string, asOf: string): Promise<number | null> {
  const from = addDaysIso(asOf, -21);
  try {
    const raw = await fmpHistoricalPrices(symbol, from, asOf);
    const bars = (Array.isArray(raw) ? raw : [])
      .map(parseBar)
      .filter((x): x is RawBar => x != null && x.date <= asOf)
      .sort((a, b) => a.date.localeCompare(b.date));
    return bars.length ? bars[bars.length - 1].close : null;
  } catch {
    return null;
  }
}

function rowsFor(inst: ValuationInstrument, allowForward: boolean) {
  return {
    price: inst.price,
    asOf: "",
    allowForward,
    incomeRows: inst.incomeRows,
    earningsRows: inst.earningsRows,
    ratioQuarterRows: inst.ratioQuarterRows,
    ratiosTtmRow: inst.ratiosTtmRow,
    ratiosRow: inst.vendorRatiosRow,
    keyMetricsRow: inst.keyMetricsRow,
    estimateRows: inst.estimateRows,
  };
}

async function loadValuation(
  book: (typeof CHART_BOOKS)[number],
  bar: ChartBar,
  allowForward: boolean,
): Promise<{ core: ReturnType<typeof valuationFromFmpRows>; missing: string | null; valuationLabel: string }> {
  const etfSources = await loadPrintSources(book.etf);
  const etfInst = instrumentFrom(book.etf, "etf", bar.close, etfSources, allowForward);
  let fallback: ValuationInstrument | null = null;
  let fallbackSources: PrintSources | null = null;
  const priceNotes: string[] = [];
  if (!instrumentCanPriceEps(etfInst) && book.indexFallback) {
    fallbackSources = await loadPrintSources(book.indexFallback);
    const price = await closeOnOrBefore(book.indexFallback, bar.date);
    if (price == null) {
      priceNotes.push(`GET /stable/historical-price-eod/full?symbol=${book.indexFallback} ohne Kurs am ${bar.date}`);
    }
    fallback = instrumentFrom(book.indexFallback, "fallback", price, fallbackSources, allowForward);
  }

  const chosen = pickValuationInstrument(etfInst, fallback);
  let fwdNote: string | null = null;
  if (allowForward) {
    const estimateCall = `GET /stable/analyst-estimates?symbol=${chosen.symbol}&period=annual`;
    try {
      const rows = asRows(await fmpAnalystEstimates(chosen.symbol, 8));
      if (ntmEpsFromEstimateRows(rows, bar.date) != null) chosen.estimateRows = rows;
      else fwdNote = rows.length ? `${estimateCall} ohne epsAvg` : `${estimateCall} leer`;
    } catch {
      fwdNote = `${estimateCall} fehlgeschlagen`;
    }
    const preview = valuationFromFmpRows({ ...rowsFor(chosen, true), asOf: bar.date });
    if (preview.pegKind == null || preview.pegFwdKind == null) {
      const call = `GET /stable/key-metrics?symbol=${chosen.symbol}`;
      try {
        const row = firstRow(await fmpKeyMetrics(chosen.symbol, 1));
        if (rowHasVendorPeg(row)) chosen.keyMetricsRow = row;
        else if (preview.pegKind == null && preview.epsYoy == null) {
          priceNotes.push(row ? `${call} ohne priceToEarningsGrowthRatio` : `${call} leer`);
        }
      } catch {
        priceNotes.push(`${call} fehlgeschlagen`);
      }
    }
  }

  const core = valuationFromFmpRows({ ...rowsFor(chosen, allowForward), asOf: bar.date });
  const valuationLabel = valuationLabelFor(chosen, book.etf);
  const sourceNotes = (chosen.symbol === book.etf ? etfSources.notes : fallbackSources?.notes ?? etfSources.notes);
  const gaps: string[] = [];
  if (valuationLabel !== "ETF-Proxy") {
    gaps.push(`Formel auf ${chosen.symbol} (Kurs und EPS), nicht auf ${book.etf}`);
  }
  if (core.pe == null) {
    const why = [...sourceNotes, ...priceNotes].filter(Boolean);
    gaps.push(why.length ? `PE n/a: ${why.join("; ")}` : "PE n/a: kein Kurs und EPS derselben Einheit");
  }
  if (core.epsYoy == null && core.pe != null) {
    gaps.push("EPS YoY n/a: weniger als 8 Quartalsdrucke derselben Einheit");
  } else if (core.epsYoy == null && sourceNotes.length) {
    gaps.push(`EPS YoY n/a: ${sourceNotes.join("; ")}`);
  }
  if (allowForward && core.peFwd == null && fwdNote) gaps.push(`fwd n/a: ${fwdNote}`);
  if (allowForward && core.peg == null && core.epsYoy != null && core.epsYoy <= 0) {
    gaps.push("PEG n/a: g<=0");
  }
  if (allowForward && core.pegFwd == null && core.gCons != null && core.gCons <= 0) {
    gaps.push("PEG fwd n/a: g<=0");
  }
  return { core, missing: gaps.length ? gaps.join(" · ") : null, valuationLabel };
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
  let valuationLabel = "ETF-Proxy";
  if (withValuation && last) {
    try {
      const loaded = await loadValuation(book, last, true);
      const v = loaded.core;
      valuationLabel = loaded.valuationLabel;
      snapshot = {
        pe: v.pe,
        peFwd: v.peFwd,
        peg: v.peg,
        pegFwd: v.pegFwd,
        pegKind: v.pegKind,
        pegFwdKind: v.pegFwdKind,
        epsYoy: v.epsYoy,
        rsi: last.rsi,
        macdHist: last.hist,
        missing: loaded.missing,
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
    valuationLabel,
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
  const leverage = await loadLeverage(window);
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
  let cacheable = true;
  let loaded: Awaited<ReturnType<typeof loadValuation>> | null = null;
  try {
    loaded = await loadValuation(book, bar, allowForward);
  } catch (err) {
    cacheable = false;
    console.error(`[RECESSION-CHARTS] factpack ${book.etf}`, err instanceof Error ? err.message : err);
  }
  const v = loaded?.core ?? valuationFromFmpRows({
    price: bar.close,
    asOf: bar.date,
    allowForward: false,
    incomeRows: [],
    earningsRows: [],
    ratiosRow: null,
    keyMetricsRow: null,
    estimateRows: [],
  });
  const note = [v.note, loaded?.missing].filter(Boolean).join(" ") || null;
  const pack = factpackSchema.parse({
    id: book.id,
    etf: book.etf,
    date: bar.date,
    close: bar.close,
    valuationLabel: loaded?.valuationLabel ?? "ETF-Proxy",
    pe: v.pe,
    peFwd: v.peFwd,
    peg: v.peg,
    pegFwd: v.pegFwd,
    pegKind: v.pegKind,
    pegFwdKind: v.pegFwdKind,
    epsYoy: v.epsYoy,
    gCons: v.gCons,
    rsi: bar.rsi,
    macd: bar.macd,
    macdSignal: bar.signal,
    macdHist: bar.hist,
    volume: bar.volume,
    pegExpensive: v.pegExpensive,
    pegFwdExpensive: v.pegFwdExpensive,
    note,
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
    const key = `v3:${window}:${etf}:${date}`;
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

  const key = `v3:${window}`;
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
