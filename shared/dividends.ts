/**
 * Dividend history for the Section-10 TA overlay (Future_1 §11.1, Mini-PR 7 overlay part).
 * Real cash dividends only. No source → empty list → no overlay. Nothing is substituted.
 */

export type DividendSource = "fmp" | "yahoo" | "none";

export interface DividendEvent {
  /** Ex-dividend date, ISO yyyy-mm-dd. */
  date: string;
  /** Cash amount per share in the listing currency (split-adjusted when the source provides it). */
  amount: number;
}

export interface DividendHistoryResponse {
  ticker: string;
  source: DividendSource;
  events: DividendEvent[];
  note: string | null;
  /** ISO currency the source states for the amounts (FMP row `currency`/`reportedCurrency`, Yahoo meta.currency). null = source states none. */
  currency?: string | null;
}

const CCY = /^[A-Z]{3}$/;
function ccy(v: unknown): string | null {
  const c = typeof v === "string" ? v.trim().toUpperCase() : "";
  return CCY.test(c) ? c : null;
}

/** Currency stated in FMP dividend rows, if any (first non-empty `currency` / `reportedCurrency`). */
export function parseFmpDividendCurrency(payload: unknown): string | null {
  const rows = Array.isArray(payload) ? payload : Array.isArray((payload as any)?.historical) ? (payload as any).historical : [];
  for (const r of rows) { const c = ccy(r?.currency) ?? ccy(r?.reportedCurrency); if (c) return c; }
  return null;
}

/** Yahoo v8 chart meta.currency (currency of price and dividend amounts of that listing). */
export function parseYahooDividendCurrency(payload: unknown): string | null {
  return ccy((payload as any)?.chart?.result?.[0]?.meta?.currency);
}

/**
 * Guard for the yield line: dividend and price must be in the same currency. Known and different → mismatch
 * (no FX conversion, nothing guessed). Unknown on either side → "unknown" (line shown, note says so).
 */
export function dividendCurrencyCheck(dividendCcy: string | null | undefined, priceCcy: string | null | undefined): "ok" | "mismatch" | "unknown" {
  const d = ccy(dividendCcy), p = ccy(priceCcy);
  if (!d || !p) return "unknown";
  return d === p ? "ok" : "mismatch";
}

export interface DividendYieldPoint {
  date: string;
  /** Trailing-12-month dividends / close, in %. null before a full 12M of history or without a close. */
  yieldPct: number | null;
  /** Σ dividends with ex-date in the trailing 12 months, per share in the source's currency. null like yieldPct. */
  ttmDividend?: number | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Sorted ascending, de-duplicated by date, only finite positive amounts on valid ISO dates. */
export function cleanDividendEvents(raw: Array<{ date?: unknown; amount?: unknown }>): DividendEvent[] {
  const byDate = new Map<string, number>();
  for (const r of raw) {
    const date = typeof r?.date === "string" ? r.date.slice(0, 10) : "";
    const amount = typeof r?.amount === "number" ? r.amount : Number(r?.amount);
    if (!ISO.test(date) || !Number.isFinite(amount) || amount <= 0) continue;
    if (!byDate.has(date)) byDate.set(date, amount);
  }
  return Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, amount]) => ({ date, amount }));
}

/** FMP /stable/dividends rows: { date, adjDividend, dividend, ... }. adjDividend first. */
export function parseFmpDividends(payload: unknown): DividendEvent[] {
  const rows = Array.isArray(payload) ? payload : Array.isArray((payload as any)?.historical) ? (payload as any).historical : [];
  return cleanDividendEvents(rows.map((r: any) => ({
    date: r?.date,
    amount: r?.adjDividend != null && Number(r.adjDividend) > 0 ? r.adjDividend : r?.dividend,
  })));
}

/** Yahoo v8 chart with events=div: chart.result[0].events.dividends { [ts]: { amount, date } }. */
export function parseYahooDividends(payload: unknown): DividendEvent[] {
  const divs = (payload as any)?.chart?.result?.[0]?.events?.dividends;
  if (!divs || typeof divs !== "object") return [];
  return cleanDividendEvents(Object.values(divs).map((d: any) => {
    const ts = Number(d?.date);
    return {
      date: Number.isFinite(ts) ? new Date(ts * 1000).toISOString().slice(0, 10) : "",
      amount: d?.amount,
    };
  }));
}

function minusOneYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Historical yield per bar = sum of dividends with ex-date in (date − 1y, date] / close.
 * A bar gets null until the dividend record covers a full year before it, so the line does not start with a fake dip.
 */
export function trailingDividendYield(
  bars: Array<{ date: string; close: number }>,
  events: DividendEvent[],
): DividendYieldPoint[] {
  if (events.length === 0) return bars.map(b => ({ date: b.date, yieldPct: null, ttmDividend: null }));
  const firstEx = events[0].date;
  let lo = 0;
  let hi = 0;
  let sum = 0;
  const out: DividendYieldPoint[] = [];
  for (const bar of bars) {
    const from = minusOneYear(bar.date);
    while (hi < events.length && events[hi].date <= bar.date) { sum += events[hi].amount; hi++; }
    while (lo < hi && events[lo].date <= from) { sum -= events[lo].amount; lo++; }
    const covered = from >= firstEx;
    const ok = covered && Number.isFinite(bar.close) && bar.close > 0;
    const ttm = Math.max(sum, 0);
    out.push({
      date: bar.date,
      yieldPct: ok ? Math.round((ttm / bar.close) * 10000) / 100 : null,
      ttmDividend: ok ? Math.round(ttm * 10000) / 10000 : null,
    });
  }
  return out;
}

// ─── Price-chart overlay (TA section): TTM yield with honest handling of window artefacts ───

export interface DividendOverlayPoint {
  date: string;
  /** TTM yield in % after the ex-date-drift correction. null = no full 12M history or no close. */
  yieldPct: number | null;
  /** TTM dividends per share used for yieldPct (source currency). */
  ttmDividend: number | null;
  /** Raw (date − 1y, date] value when it differs from yieldPct (window held one payment too many). */
  rawYieldPct: number | null;
  /** Ex-dates excluded from this point because a newer payment of the same slot is already in the window. */
  droppedExDates: string[];
  /** Special dividends inside this window (counted in full, labelled). */
  specialExDates: string[];
  /** Ex-dates added from just before the window because this year's payment of the same slot is not yet ex (later drift). */
  addedExDates?: string[];
}

export interface DividendOverlaySeries {
  points: DividendOverlayPoint[];
  /** Regular payments per year, from the median gap between ex-dates. */
  paymentsPerYear: number;
  specialExDates: string[];
  /** Number of bars whose raw window value was corrected. */
  correctedBars: number;
}

const DAY_MS = 86400000;
const isoMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Regular payments per year from the median gap of the last (up to) 12 ex-dates; 1..12. */
export function paymentsPerYear(events: DividendEvent[]): number {
  const recent = events.slice(-13);
  if (recent.length < 2) return 1;
  const gaps = recent.slice(1).map((e, i) => (isoMs(e.date) - isoMs(recent[i].date)) / DAY_MS).sort((a, b) => a - b);
  const mid = gaps[Math.floor(gaps.length / 2)];
  return Math.min(12, Math.max(1, Math.round(365 / Math.max(mid, 1))));
}

/**
 * Special dividend = amount more than 2× the median of the SAME payment slot in neighbouring years
 * (events i ± f, i ± 2f with f = payments per year). Same-slot, because semi-annual payers (NVO) pay a final
 * that is ~2× the interim — that is regular. Only flags; amounts are never changed.
 */
export function specialDividendDates(events: DividendEvent[], f = paymentsPerYear(events)): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < events.length; i++) {
    const nb = [i - 2 * f, i - f, i + f, i + 2 * f].filter(j => j >= 0 && j < events.length).map(j => events[j].amount).sort((a, b) => a - b);
    if (nb.length < 2) continue;
    const med = (nb[Math.floor((nb.length - 1) / 2)] + nb[Math.ceil((nb.length - 1) / 2)]) / 2;
    if (med > 0 && events[i].amount > 2 * med) out.add(events[i].date);
  }
  return out;
}

/**
 * Per bar: payments with ex-date in (date − 1y, date]. When an ex-date drifts a few days earlier than a year
 * before (NVO 30.03.2026 vs 31.03.2025), the plain window holds one regular payment too many for a few days and
 * the line spikes (NVO ≈ 8.3 %). Then the oldest surplus regular payment is excluded and the point is marked
 * (rawYieldPct + droppedExDates), so the correction is visible. Special dividends are always counted and labelled.
 */
export function dividendOverlaySeries(
  bars: Array<{ date: string; close: number }>,
  events: DividendEvent[],
): DividendOverlaySeries {
  const empty = (b: { date: string }): DividendOverlayPoint => ({ date: b.date, yieldPct: null, ttmDividend: null, rawYieldPct: null, droppedExDates: [], specialExDates: [] });
  if (events.length === 0) return { points: bars.map(empty), paymentsPerYear: 0, specialExDates: [], correctedBars: 0 };
  const f = paymentsPerYear(events);
  const specials = specialDividendDates(events, f);
  const firstEx = events[0].date;
  let corrected = 0;
  const points = bars.map(bar => {
    const from = minusOneYear(bar.date);
    if (!(from >= firstEx) || !Number.isFinite(bar.close) || bar.close <= 0) return empty(bar);
    const win = events.filter(e => e.date > from && e.date <= bar.date);
    const regular = win.filter(e => !specials.has(e.date));
    const special = win.filter(e => specials.has(e.date));
    const surplus = Math.max(0, regular.length - f);
    const dropped = regular.slice(0, surplus);
    // Opposite drift (KO 15.09.2025 vs 13.09.2024): the window misses one regular payment for a few days and the
    // line dips. Re-add the newest regular payment(s) that left the window less than half a payment period ago.
    const deficit = Math.max(0, f - regular.length);
    const graceFrom = new Date(isoMs(from) - (365 / f / 2) * DAY_MS).toISOString().slice(0, 10);
    const added = deficit > 0 && regular.length > 0
      ? events.filter(e => !specials.has(e.date) && e.date <= from && e.date > graceFrom).slice(-deficit)
      : [];
    const kept = added.concat(regular.slice(surplus), special);
    const rawSum = win.reduce((s, e) => s + e.amount, 0);
    const sum = kept.reduce((s, e) => s + e.amount, 0);
    const pct = (v: number) => Math.round((v / bar.close) * 10000) / 100;
    const changed = dropped.length > 0 || added.length > 0;
    if (changed) corrected++;
    return {
      date: bar.date,
      yieldPct: pct(sum),
      ttmDividend: Math.round(sum * 10000) / 10000,
      rawYieldPct: changed ? pct(rawSum) : null,
      droppedExDates: dropped.map(e => e.date),
      specialExDates: special.map(e => e.date),
      addedExDates: added.map(e => e.date),
    };
  });
  return { points, paymentsPerYear: f, specialExDates: Array.from(specials), correctedBars: corrected };
}

// ─── Section-1 KPI tile: same value as the last point of the price-chart overlay ───

export type DividendKpi =
  | { kind: "ttm"; yieldPct: number; ttmDividend: number; date: string; smoothed: boolean }
  | { kind: "mismatch"; dividendCurrency: string; priceCurrency: string }
  | { kind: "none" };

/**
 * TTM yield for the KPI tile. Uses dividendOverlaySeries (incl. ex-date smoothing) on the SAME last bar the chart
 * ends on, so tile == last overlay point. Same currency guard as the overlay. No history / no 12M → "none".
 */
export function dividendKpiFromHistory(
  history: DividendHistoryResponse | null | undefined,
  lastBar: { date: string; close: number } | null | undefined,
  priceCurrency: string | null | undefined,
): DividendKpi {
  if (!history || history.events.length === 0 || !lastBar) return { kind: "none" };
  if (dividendCurrencyCheck(history.currency, priceCurrency) === "mismatch") {
    return { kind: "mismatch", dividendCurrency: String(history.currency), priceCurrency: String(priceCurrency) };
  }
  const p = dividendOverlaySeries([lastBar], history.events).points[0];
  if (!p || p.yieldPct == null || p.ttmDividend == null) return { kind: "none" };
  return { kind: "ttm", yieldPct: p.yieldPct, ttmDividend: p.ttmDividend, date: p.date, smoothed: p.rawYieldPct != null };
}

/** Tooltip marker lines for one overlay point: corrected and raw value side by side, plus the ex-date(s). */
export function dividendMarkerLines(
  p: { yieldPct?: number | null; rawYieldPct?: number | null; droppedExDates?: string[]; addedExDates?: string[]; specialExDates?: string[] },
  fmtDate: (iso: string) => string = d => d,
): Array<{ text: string; cls: string }> {
  const out: Array<{ text: string; cls: string }> = [];
  const pct = (v: number) => `${v.toFixed(2)} %`;
  if (p.yieldPct != null && p.rawYieldPct != null && p.droppedExDates?.length) {
    out.push({ cls: "text-amber-500", text: `geglättet ${pct(p.yieldPct)} · roh ${pct(p.rawYieldPct)} (Ex-Tag ${p.droppedExDates.map(fmtDate).join(", ")} doppelt im 12M-Fenster)` });
  }
  if (p.yieldPct != null && p.rawYieldPct != null && p.addedExDates?.length) {
    out.push({ cls: "text-amber-500", text: `aufgefüllt ${pct(p.yieldPct)} · roh ${pct(p.rawYieldPct)} (Ex-Tag ${p.addedExDates.map(fmtDate).join(", ")} mitgezählt, Folgezahlung noch nicht ex)` });
  }
  if (p.specialExDates?.length) {
    out.push({ cls: "text-violet-400", text: `inkl. Sonderdividende (Ex-Tag ${p.specialExDates.map(fmtDate).join(", ")})` });
  }
  return out;
}
