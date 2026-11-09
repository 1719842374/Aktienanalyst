/**
 * history-fallback.ts
 *
 * Sprint B1 (SPRINT_B1_OHLCV_FALLBACK.md / WORK_DATA_PROVIDERS.md §5):
 * FMP Free/Starter liefert nur ~5 Jahre taegliche Kurshistorie. Bei UI-
 * Timeframes > 5Y (v.a. 10Y) fehlen dadurch Kerzen und die MA200/Death-Cross-
 * Logik hat nicht genug Bars. Dieses Modul implementiert die in
 * WORK_DATA_PROVIDERS.md Abschnitt 5 vorgeschlagene Fallback-Skizze 1:1:
 *
 *   1) fromDateForTimeframe(): Wunsch-Startdatum je UI-Timeframe.
 *   2) fetchDailyHistory(): FMP zuerst, dann bei Luecke einen Alt-Provider
 *      (Yahoo Finance Chart-API, mit Stooq als Reserve) nachladen und mergen.
 *      FMP-Daten haben IMMER Vorrang; der Alt-Provider fuellt nur Luecken
 *      bzw. verlaengert die Serie nach links (aeltere Daten).
 *
 * WICHTIG (Regel aus dem Ticket): Kein Secret verlaesst den Server. Diese
 * Datei laeuft ausschliesslich server-seitig (kein "use client", kein Export
 * Richtung client/). Yahoo/Stooq sind oeffentliche, unauthentifizierte Free-
 * Endpunkte -- es gibt hier keinen API-Key zu schuetzen, aber auch kein Grund,
 * das jemals aus dem Browser aufzurufen.
 *
 * Additiv: Diese Datei ist komplett neu und aendert keine bestehende Datei.
 * Der einzige Call-Site-Eingriff erfolgt minimal-invasiv in analyze-route.ts.
 */
import { minorUnitInfo, stooqListing, yahooBarsToMajor } from "../shared/listing-units";

export type HistoryProvider = "fmp" | "yahoo" | "stooq" | "nasdaq" | "onvista";

export interface DailyBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: HistoryProvider;
}

export type Timeframe = "3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "10Y";

/**
 * Visible 10Y chart is the last 2520 trading days (client TIME_RANGE_CUTOFF).
 * MA200 needs 199 prior closes. One shared lookback — 200 sessions plus a
 * small buffer — is enough for MA200/100/50/20, EMA26/12/9, RSI14, BB(20,2)
 * and MACD(12,26,9). It is not a second full history.
 */
export const TA_VISIBLE_10Y_BARS = 2520;
export const TA_INDICATOR_WARMUP_BARS = 220;
/** ~1 calendar year before the visible 10Y start (>=200 trading days, holiday slack). */
export const TA_WARMUP_CALENDAR_DAYS = 365;
/**
 * Hard cap: visible 10Y + warmup + slack. slice(-cap) keeps the newest bars,
 * so the warmup prefix is not cut off the front. Still bounded if a provider
 * returns an unbounded history.
 */
export const TA_OHLCV_MAX_POINTS = TA_VISIBLE_10Y_BARS + TA_INDICATOR_WARMUP_BARS + 60;

/** Wunsch-Spanne aus UI (1:1 aus WORK_DATA_PROVIDERS.md §5 uebernommen). */
export function fromDateForTimeframe(tf: Timeframe, now: Date = new Date()): string {
  const days: Record<Timeframe, number> = {
    "3M": 95, "6M": 185, "1Y": 370, "2Y": 740, "3Y": 1100, "5Y": 1825, "10Y": 3650,
  };
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - (days[tf] ?? 370));
  return d.toISOString().slice(0, 10);
}

/** Start of the hidden warmup prefix: visible 10Y from-date minus ~1 year. */
export function indicatorWarmupFromDate(now: Date = new Date()): string {
  const d = new Date(fromDateForTimeframe("10Y", now) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - TA_WARMUP_CALENDAR_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * True when the loaded series does not cover the visible 10Y window, or when
 * fewer than TA_INDICATOR_WARMUP_BARS sit before that window. A young listing
 * stays true until older bars actually exist — callers must not invent them.
 */
export function needsIndicatorPrefix(barCount: number, earliest: string | undefined, visibleFrom: string): boolean {
  if (!earliest || earliest > visibleFrom) return true;
  return Math.max(0, barCount - TA_VISIBLE_10Y_BARS) < TA_INDICATOR_WARMUP_BARS;
}

/**
 * Yahoo Finance Chart-API als Alt-Provider (server-seitig, kein API-Key
 * noetig). WORK_DATA_PROVIDERS.md §3 empfiehlt Yahoo als einfachste Option
 * fuer lange Daily-Historie. Ein plausibler User-Agent-Header ist noetig,
 * sonst antwortet der Endpoint mit 429 (in der Sandbox verifiziert).
 *
 * period1/period2 folgt dem angeforderten [from, to] (sichtbare 10Y plus
 * Warmup, nicht range=max). Wir schneiden serverseitig noch einmal auf
 * [from, to] zu.
 */
function utcUnixDay(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
}

export async function yahooFetch(symbol: string, from: string, to: string): Promise<DailyBar[]> {
  return (await yahooChart(symbol, from, to)).bars;
}

/** Yahoo bars in the major unit plus that major currency (GBp → GBP). */
export async function yahooChart(symbol: string, from: string, to: string): Promise<{ bars: DailyBar[]; currency: string | null }> {
  const period1 = utcUnixDay(from);
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const period2 = Math.floor(end.getTime() / 1000);
  if (!isFinite(period1) || !isFinite(period2) || period1 >= period2) return { bars: [], currency: null };
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json",
    },
  });
  if (!resp.ok) throw new Error(`Yahoo chart API HTTP ${resp.status}`);
  const json: any = await resp.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("Yahoo chart API: leere Antwort");

  const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const opens: (number | null)[] = quote.open ?? [];
  const highs: (number | null)[] = quote.high ?? [];
  const lows: (number | null)[] = quote.low ?? [];
  const closes: (number | null)[] = quote.close ?? [];
  const volumes: (number | null)[] = quote.volume ?? [];

  const bars: DailyBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || !isFinite(close)) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    if (date < from || date > to) continue;
    bars.push({
      date,
      open: opens[i] ?? close,
      high: highs[i] ?? close,
      low: lows[i] ?? close,
      close,
      volume: volumes[i] ?? 0,
      source: "yahoo",
    });
  }
  // LSE etc. quote in pence (meta.currency "GBp"); FMP bars are normalised to pounds upstream.
  const metaCurrency = typeof result.meta?.currency === "string" ? result.meta.currency : null;
  return {
    bars: yahooBarsToMajor(bars, metaCurrency),
    currency: minorUnitInfo(metaCurrency)?.major ?? metaCurrency,
  };
}

/**
 * Stooq CSV-Download als zweite Alt-Provider-Option (WORK_DATA_PROVIDERS.md
 * §3: "gut fuer Backfills"). US-Ticker brauchen das ".us"-Suffix. Wird nur
 * als Reserve genutzt, falls Yahoo aus der jeweiligen Umgebung nicht
 * zuverlaessig erreichbar ist (z.B. Rate-Limit/429 ohne Retry-Erfolg).
 */
export async function stooqFetch(symbol: string, from: string, to: string): Promise<DailyBar[]> {
  // .L → "<ticker>.uk" (Stooq's LSE suffix), quoted in pence; other symbols as before.
  const { stooqSymbol, quoteCurrency } = stooqListing(symbol);
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!resp.ok) throw new Error(`Stooq HTTP ${resp.status}`);
  const csv = await resp.text();
  if (!csv || /<html/i.test(csv)) throw new Error("Stooq: keine CSV-Antwort (evtl. Bot-Schutz)");

  const lines = csv.trim().split("\n");
  const bars: DailyBar[] = [];
  // Erwartetes Header-Format: Date,Open,High,Low,Close,Volume
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 6) continue;
    const [date, open, high, low, close, volume] = cols;
    if (!date || date < from || date > to) continue;
    const closeNum = Number(close);
    if (!isFinite(closeNum) || closeNum <= 0) continue;
    bars.push({
      date,
      open: Number(open) || closeNum,
      high: Number(high) || closeNum,
      low: Number(low) || closeNum,
      close: closeNum,
      volume: Number(volume) || 0,
      source: "stooq",
    });
  }
  // LSE pence → pounds via the same path as Yahoo/FMP (#244, shared/listing-units). No-op for other symbols.
  return yahooBarsToMajor(bars, quoteCurrency);
}

/**
 * Unit guard at the merge seam: alt bars only extend FMP to the left, so the newest alt close before FMP's
 * first bar must be on the same scale. A ×100 jump (pence vs pounds) means a unit mismatch → alt dropped,
 * series stays honest (truncated) instead of a chart/MA200 with a 100× cliff. Factor-2 band tolerates real moves.
 */
export function altSeamUnitMismatch(fmpBars: DailyBar[], alt: DailyBar[]): boolean {
  const first = fmpBars[0];
  if (!first || !(first.close > 0)) return false;
  const before = alt.filter((a) => a.date < first.date && a.close > 0);
  const seam = before.length ? before[before.length - 1] : undefined;
  if (!seam) return false;
  const r = seam.close / first.close;
  return r > 2 || r < 0.5;
}

/**
 * Keep the newest run whose day-to-day closes stay within the seam factor.
 * A jump above 2× or below 0.5× is a unit break, not a trading day, so the
 * older prefix is dropped instead of feeding the moving averages a cliff.
 */
export function contiguousSameScale(bars: DailyBar[]): DailyBar[] {
  const sorted = bars.filter((b) => b.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  let start = 0;
  for (let i = sorted.length - 1; i > 0; i--) {
    const ratio = sorted[i - 1].close / sorted[i].close;
    if (ratio > 2 || ratio < 0.5) {
      start = i;
      break;
    }
  }
  return sorted.slice(start);
}

function sameClose(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= scale * 1e-6;
}

/**
 * A vendor day with no volume and no high-low range that repeats the previous
 * close is a carried last sale, not a session. Keeping it draws a staircase
 * and lets that stale quote count as many days in the moving averages.
 * A print with volume, a range, or a new close stays. Nothing is interpolated.
 */
export function tradedSessions(bars: DailyBar[]): DailyBar[] {
  const sorted = bars.filter((b) => b.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const kept: DailyBar[] = [];
  for (const bar of sorted) {
    const prev = kept[kept.length - 1];
    const flat = sameClose(bar.open, bar.close) && sameClose(bar.high, bar.close) && sameClose(bar.low, bar.close);
    const repeat = prev != null && sameClose(bar.close, prev.close);
    if (prev && !(bar.volume > 0) && flat && repeat) continue;
    kept.push(bar);
  }
  return kept;
}

/** Nasdaq public daily history. US symbols only; dotted listings stay on Yahoo/Stooq. */
export async function nasdaqFetch(symbol: string, from: string, to: string): Promise<DailyBar[]> {
  const sym = symbol.trim().toUpperCase();
  if (sym.includes(".") || !/^[A-Z][A-Z0-9-]{0,9}$/.test(sym)) return [];
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(sym)}/historical?assetclass=stocks&fromdate=${from}&todate=${to}&limit=10000`;
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(20000),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json",
    },
  });
  if (!resp.ok) throw new Error(`Nasdaq historical HTTP ${resp.status}`);
  const json: any = await resp.json();
  const rows: any[] = json?.data?.tradesTable?.rows ?? [];
  const bars: DailyBar[] = [];
  for (const row of rows) {
    const rawDate = String(row?.date ?? "");
    const parts = rawDate.split("/");
    if (parts.length !== 3) continue;
    const [month, day, year] = parts;
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (date < from || date > to) continue;
    const close = Number(String(row?.close ?? "").replace(/[$,]/g, ""));
    if (!isFinite(close) || close <= 0) continue;
    const num = (value: unknown, fallback: number) => {
      const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
      return isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };
    const volume = Number(String(row?.volume ?? "").replace(/[,]/g, ""));
    bars.push({
      date,
      open: num(row?.open, close),
      high: num(row?.high, close),
      low: num(row?.low, close),
      close,
      volume: isFinite(volume) && volume > 0 ? volume : 0,
      source: "nasdaq",
    });
  }
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

/** OTC venues also quote on weekends; those days are not exchange sessions. */
function isWeekday(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

/** One trading venue of the same security, in that venue's currency. */
export interface VenueSeries {
  venue: string;
  currency: string | null;
  bars: DailyBar[];
}

/** Venue closes must match the primary listing on shared days before they may fill its gap. */
export const VENUE_MIN_OVERLAP_DAYS = 20;
export const VENUE_MAX_MEDIAN_DEVIATION = 0.05;

const ONVISTA_API = "https://api.onvista.de/api/v1";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function getJson(url: string, timeoutMs = 15000): Promise<any> {
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": BROWSER_UA, "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/**
 * Daily history of the same security on its other venues (onvista, keyed by
 * the instrument whose home symbol is the ticker). A depositary receipt or a
 * share that moved its primary listing keeps trading elsewhere before the
 * current listing's first day.
 */
export async function onvistaVenues(symbol: string, from: string, to: string): Promise<VenueSeries[]> {
  const home = symbol.trim().toUpperCase().split(".")[0];
  if (!home) return [];
  const search = await getJson(`${ONVISTA_API}/instruments/search?searchValue=${encodeURIComponent(home)}`);
  const hit = (search?.list ?? []).find((it: any) =>
    it?.entityType === "STOCK" && String(it?.homeSymbol ?? "").toUpperCase() === home);
  if (!hit?.entityValue) return [];
  const base = `${ONVISTA_API}/instruments/STOCK/${encodeURIComponent(hit.entityValue)}`;
  const quotes = await getJson(`${base}/quotes`);
  const markets: { id: number; name: string; currency: string | null }[] = (quotes?.list ?? [])
    .map((q: any) => ({ id: Number(q?.market?.idNotation), name: String(q?.market?.name ?? ""), currency: q?.isoCurrency ?? null }))
    .filter((m: { id: number }) => Number.isFinite(m.id));
  const series = await Promise.all(markets.map(async (m): Promise<VenueSeries | null> => {
    try {
      const eod = await getJson(`${base}/eod_history?idNotation=${m.id}&range=MAX&startDate=${from}&perPage=5000`, 20000);
      const times: number[] = eod?.datetimeLast ?? [];
      const bars: DailyBar[] = [];
      for (let i = 0; i < times.length; i++) {
        const close = Number(eod.last?.[i]);
        if (!Number.isFinite(close) || close <= 0) continue;
        const date = new Date(times[i] * 1000).toISOString().slice(0, 10);
        if (date < from || date > to) continue;
        const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : close);
        const volume = Number(eod.volume?.[i]);
        bars.push({
          date,
          open: num(eod.first?.[i]),
          high: num(eod.high?.[i]),
          low: num(eod.low?.[i]),
          close,
          volume: Number.isFinite(volume) && volume > 0 ? volume : 0,
          source: "onvista",
        });
      }
      const currency = eod?.isoCurrency ?? m.currency;
      return { venue: m.name, currency: minorUnitInfo(currency)?.major ?? currency, bars: yahooBarsToMajor(bars, currency) };
    } catch {
      return null;
    }
  }));
  return series.filter((s): s is VenueSeries => s != null && s.bars.length > 0);
}

/** Daily FX closes (quote currency per unit of base) from Yahoo, e.g. EURUSD=X. */
export async function yahooFxCloses(base: string, quote: string, from: string, to: string): Promise<Map<string, number>> {
  const { bars } = await yahooChart(`${base}${quote}=X`, from, to);
  return new Map(bars.filter((b) => b.close > 0).map((b) => [b.date, b.close]));
}

function rateOn(rates: Map<string, number>, sortedDates: string[], date: string): number | null {
  let lo = 0, hi = sortedDates.length - 1, hitIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedDates[mid] <= date) { hitIdx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const key = sortedDates[hitIdx >= 0 ? hitIdx : 0];
  return key != null ? rates.get(key) ?? null : null;
}

/** Venue bars converted to the listing currency with that day's (or the previous) FX close. */
export function convertVenueBars(series: VenueSeries, target: string, fx: Map<string, number> | null): DailyBar[] | null {
  if (!series.currency || series.currency === target) return series.bars;
  if (!fx || fx.size === 0) return null;
  const dates = Array.from(fx.keys()).sort();
  const out: DailyBar[] = [];
  for (const b of series.bars) {
    const r = rateOn(fx, dates, b.date);
    if (r == null || !(r > 0)) continue;
    out.push({ ...b, open: b.open * r, high: b.high * r, low: b.low * r, close: b.close * r });
  }
  return out;
}

/**
 * Pick the venue that fills the days before the primary listing's first bar.
 * Only venues whose closes match the primary listing on shared days qualify;
 * among those, the one with the most traded sessions in the gap wins.
 */
export function venueBackfill(
  primary: DailyBar[],
  converted: { venue: string; bars: DailyBar[] }[],
): { venue: string; bars: DailyBar[]; medianDeviation: number } | null {
  const first = primary[0]?.date;
  if (!first) return null;
  const byDate = new Map(primary.map((b) => [b.date, b.close]));
  let best: { venue: string; bars: DailyBar[]; medianDeviation: number } | null = null;
  for (const c of converted) {
    const devs: number[] = [];
    for (const b of c.bars) {
      const p = byDate.get(b.date);
      if (p != null && p > 0) devs.push(Math.abs(b.close / p - 1));
    }
    if (devs.length < VENUE_MIN_OVERLAP_DAYS) continue;
    devs.sort((a, b) => a - b);
    const medianDeviation = devs[Math.floor(devs.length / 2)];
    if (medianDeviation > VENUE_MAX_MEDIAN_DEVIATION) continue;
    const gap = tradedSessions(c.bars.filter((b) => b.date < first && isWeekday(b.date)));
    if (gap.length === 0) continue;
    if (!best || gap.length > best.bars.length) best = { venue: c.venue, bars: gap, medianDeviation };
  }
  return best;
}

async function venueGapFill(symbol: string, from: string, primary: DailyBar[], currency: string | null): Promise<DailyBar[]> {
  const to = new Date().toISOString().slice(0, 10);
  // Callers often ask only up to FMP's first bar; the overlap check needs the listing after that.
  if (primary.length < VENUE_MIN_OVERLAP_DAYS) {
    const full = await yahooChart(symbol, from, to);
    primary = full.bars;
    currency = full.currency ?? currency;
  }
  if (!primary.length || !currency) return [];
  const venues = await onvistaVenues(symbol, from, to);
  const fxCache = new Map<string, Map<string, number> | null>();
  const converted: { venue: string; bars: DailyBar[] }[] = [];
  for (const v of venues) {
    let fx: Map<string, number> | null = null;
    if (v.currency && v.currency !== currency) {
      if (!fxCache.has(v.currency)) {
        try { fxCache.set(v.currency, await yahooFxCloses(v.currency, currency, from, to)); }
        catch { fxCache.set(v.currency, null); }
      }
      fx = fxCache.get(v.currency) ?? null;
    }
    const bars = convertVenueBars(v, currency, fx);
    if (bars?.length) converted.push({ venue: v.venue, bars });
  }
  const pick = venueBackfill(primary, converted);
  if (pick) {
    console.log(`[HISTORY-FALLBACK] ${symbol}: ${pick.bars.length} Handelstage vor ${primary[0].date} von ${pick.venue} (Abweichung Median ${(pick.medianDeviation * 100).toFixed(1)} %)`);
  }
  return pick?.bars ?? [];
}

/**
 * 1) FMP full historical from..to
 * 2) Wenn rawEarliest zu jung fuer tf -> Alternative nachladen
 * 3) Merge nach date (Alternative fuellt Luecken / verlaengert links)
 *
 * 1:1 Signatur-Vorlage aus WORK_DATA_PROVIDERS.md §5, minimal erweitert um
 * ein ehrliches `truncated`-Flag falls auch der Fallback nicht ausreicht
 * (Ticket-Regel "Zahlen-Prinzip": nicht kuenstlich verlaengern/interpolieren).
 */
export async function fetchDailyHistory(opts: {
  symbol: string;
  timeframe: Timeframe;
  /**
   * Request start. Earlier than the timeframe from-date = indicator warmup.
   * `truncated` stays tied to the visible timeframe, not to this prefix.
   */
  fetchFrom?: string;
  fmpFetch: (from: string, to: string) => Promise<DailyBar[]>;
  altFetch?: (from: string, to: string) => Promise<DailyBar[]>;
}): Promise<{ bars: DailyBar[]; source: string; truncated: boolean }> {
  const to = new Date().toISOString().slice(0, 10);
  const visibleFrom = fromDateForTimeframe(opts.timeframe);
  const from = opts.fetchFrom && opts.fetchFrom < visibleFrom ? opts.fetchFrom : visibleFrom;
  let bars = await opts.fmpFetch(from, to);
  bars.sort((a, b) => a.date.localeCompare(b.date));

  const gotFrom = bars[0]?.date;
  let truncated = !gotFrom || gotFrom > visibleFrom;
  const wantsEarlier = !gotFrom || gotFrom > from;
  let source = "fmp";
  let altOldest: string | undefined;

  if ((truncated || wantsEarlier) && opts.altFetch) {
    try {
      const alt = contiguousSameScale(await opts.altFetch(from, gotFrom ?? to));
      if (alt.length > 0 && altSeamUnitMismatch(bars, alt)) {
        console.warn(`[HISTORY-FALLBACK] ${opts.symbol}: Alt-Provider-Einheit passt nicht zu FMP (Sprung an der Nahtstelle) -- verworfen`);
      } else if (alt.length > 0) {
        altOldest = alt[0].date;
        const byDate = new Map(bars.map((b) => [b.date, b]));
        for (const a of alt) if (!byDate.has(a.date)) byDate.set(a.date, a);
        bars = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
        source = alt.some((a) => a.source === "onvista")
          ? "fmp+onvista"
          : alt.some((a) => a.source === "nasdaq") ? "fmp+nasdaq" : "fmp+alt";
      }
    } catch (err) {
      // Alt-Provider fehlgeschlagen (z.B. Rate-Limit) -> ehrlich truncated
      // lassen statt stillschweigend nur FMP-Daten zu zeigen als waeren sie
      // vollstaendig. Kein Interpolieren, kein Fake-Fuellen (Ticket-Regel).
      console.warn(`[HISTORY-FALLBACK] altFetch fehlgeschlagen fuer ${opts.symbol}: ${(err as Error)?.message ?? err}`);
    }
    truncated = !bars[0] || bars[0].date > visibleFrom;
    // Older same-scale bars from the alt provider are the listing's real start.
    // That series is complete even when it begins after the 10Y window.
    const extended = Boolean(altOldest && gotFrom && bars[0] && bars[0].date < gotFrom && bars[0].date <= altOldest);
    if (truncated && extended) truncated = false;
  }

  bars = tradedSessions(bars);
  return { bars, source, truncated };
}

/**
 * Praktischer Wrapper fuer die konkrete Provider-Kombination im Projekt:
 * Yahoo primaer als Alt-Provider, Stooq als Reserve falls Yahoo wirft.
 * Wird von analyze-route.ts genutzt, um nicht die Provider-Auswahl-Logik
 * an der Call-Site duplizieren zu muessen.
 */
export async function altFetchYahooThenStooq(symbol: string, from: string, to: string): Promise<DailyBar[]> {
  let yahoo: DailyBar[] = [];
  let currency: string | null = null;
  try {
    ({ bars: yahoo, currency } = await yahooChart(symbol, from, to));
  } catch (err) {
    console.warn(`[HISTORY-FALLBACK] Yahoo fehlgeschlagen fuer ${symbol}: ${(err as Error)?.message ?? err}`);
  }
  const yahooFrom = yahoo[0]?.date;
  let older: DailyBar[] = [];
  if (!yahooFrom || yahooFrom > from) {
    try {
      older = (await venueGapFill(symbol, from, yahoo, currency)).filter((b) => b.date <= to);
    } catch (err) {
      console.warn(`[HISTORY-FALLBACK] Handelsplätze fehlgeschlagen fuer ${symbol}: ${(err as Error)?.message ?? err}`);
    }
    // Nasdaq last-sale prints only when no venue traded the security daily.
    if (older.length === 0) {
      try {
        older = await nasdaqFetch(symbol, from, to);
      } catch (err) {
        console.warn(`[HISTORY-FALLBACK] Nasdaq fehlgeschlagen fuer ${symbol}: ${(err as Error)?.message ?? err}`);
      }
    }
  }
  const merged = new Map<string, DailyBar>();
  for (const bar of older) merged.set(bar.date, bar);
  for (const bar of yahoo) merged.set(bar.date, bar);
  const combined = tradedSessions(contiguousSameScale(Array.from(merged.values())));
  if (combined.length > 0) return combined;
  try {
    return await stooqFetch(symbol, from, to);
  } catch (err) {
    console.warn(`[HISTORY-FALLBACK] Stooq fehlgeschlagen fuer ${symbol}: ${(err as Error)?.message ?? err}`);
    return [];
  }
}
