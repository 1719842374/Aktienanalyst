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
}

export interface DividendYieldPoint {
  date: string;
  /** Trailing-12-month dividends / close, in %. null before a full 12M of history or without a close. */
  yieldPct: number | null;
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
  if (events.length === 0) return bars.map(b => ({ date: b.date, yieldPct: null }));
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
    out.push({ date: bar.date, yieldPct: ok ? Math.round((Math.max(sum, 0) / bar.close) * 10000) / 100 : null });
  }
  return out;
}
