/**
 * WORK_RECESSION_TA_CHART — Rezessions-TA analog Aktien-Sektion 12.
 * Pure contract + helpers shared by server route, client section and tests.
 * Display only: nothing here feeds a score.
 */

export type RecessionTaRegion = "US" | "EU" | "AS";

export type MacroSeriesId = "vol" | "curve" | "spread";

export interface MacroSeriesSpec {
  id: MacroSeriesId;
  /** FRED id(s); curve EU = long − short. */
  fred: string[];
  label: string;
  unit: string;
  /** Monthly prints are drawn as steps and joined with a longer staleness window. */
  frequency: "daily" | "monthly";
}

export interface RecessionTaBook {
  region: RecessionTaRegion;
  label: string;
  etf: string;
  buffettRegion: "US" | "EU" | "CN";
  series: Partial<Record<MacroSeriesId, MacroSeriesSpec>>;
}

export const RECESSION_TA_BOOKS: Record<RecessionTaRegion, RecessionTaBook> = {
  US: {
    region: "US",
    label: "US",
    etf: "SPY",
    buffettRegion: "US",
    series: {
      vol: { id: "vol", fred: ["VIXCLS"], label: "VIX", unit: "", frequency: "daily" },
      curve: { id: "curve", fred: ["T10Y2Y"], label: "Yield Curve T10Y2Y", unit: "%", frequency: "daily" },
      spread: { id: "spread", fred: ["BAA10Y"], label: "Credit Spread BAA10Y", unit: "%", frequency: "daily" },
    },
  },
  EU: {
    region: "EU",
    label: "Europa",
    etf: "VGK",
    buffettRegion: "EU",
    series: {
      // VSTOXX: FRED has no V2TX; fetched via STOXX/FMP like Section „Markt-RSI“.
      vol: { id: "vol", fred: ["V2TX"], label: "VSTOXX", unit: "", frequency: "daily" },
      curve: {
        id: "curve",
        fred: ["IRLTLT01EZM156N", "IR3TIB01EZM156N"],
        label: "Yield Curve EZ 10J−3M",
        unit: "%",
        frequency: "monthly",
      },
      spread: { id: "spread", fred: ["BAMLHE00EHYIOAS"], label: "Credit Spread EUR HY", unit: "%", frequency: "daily" },
    },
  },
  AS: {
    region: "AS",
    label: "Asien",
    etf: "ASHR",
    buffettRegion: "CN",
    // No public daily China curve / credit spread: n/a → overlays hidden.
    // Vol = 20-session realized vol of ASHR (same proxy as „Markt-RSI“ Asien).
    series: {
      vol: { id: "vol", fred: [], label: "Realized Vol 20T (ASHR)", unit: "", frequency: "daily" },
    },
  },
};

export function parseTaRegion(raw: unknown): RecessionTaRegion {
  const r = String(raw ?? "US").toUpperCase();
  return r === "EU" || r === "AS" ? r : "US";
}

export interface MacroPoint {
  date: string;
  value: number;
}

export interface MacroSeriesPayload {
  id: MacroSeriesId;
  label: string;
  unit: string;
  frequency: "daily" | "monthly";
  source: string;
  points: MacroPoint[];
  /** Set when the series is unavailable — the chart hides the overlay. */
  error: string | null;
}

export interface RecessionTaBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RecessionTaResponse {
  region: RecessionTaRegion;
  label: string;
  etf: string;
  ohlcv: RecessionTaBar[];
  ohlcvSource: "fmp" | "yahoo" | null;
  ohlcvError: string | null;
  series: MacroSeriesPayload[];
}

/** Difference of two dated series on common dates (EZ curve = 10J − 3M). */
export function diffSeries(a: MacroPoint[], b: MacroPoint[]): MacroPoint[] {
  const bm = new Map(b.map(p => [p.date, p.value]));
  const out: MacroPoint[] = [];
  for (const p of a) {
    const v = bm.get(p.date);
    if (v != null && Number.isFinite(v)) out.push({ date: p.date, value: +(p.value - v).toFixed(4) });
  }
  return out;
}

/**
 * As-of join: for each chart date take the last print ≤ date, but only if it
 * is not older than maxAgeDays (daily 7, monthly 62). Otherwise null → gap.
 */
export function asOfJoin(dates: string[], pointsAsc: MacroPoint[], maxAgeDays: number): (number | null)[] {
  const out: (number | null)[] = [];
  let j = -1;
  const ms = 86400000;
  for (const d of dates) {
    while (j + 1 < pointsAsc.length && pointsAsc[j + 1].date <= d) j++;
    if (j < 0) { out.push(null); continue; }
    const p = pointsAsc[j];
    const age = (Date.parse(d + "T00:00:00Z") - Date.parse(p.date + "T00:00:00Z")) / ms;
    out.push(age <= maxAgeDays ? p.value : null);
  }
  return out;
}

export function maxAgeFor(freq: "daily" | "monthly"): number {
  return freq === "monthly" ? 62 : 7;
}

/** Bars from FMP / Yahoo rows → ascending, finite, de-duplicated. */
export function normalizeBars(rows: unknown[]): RecessionTaBar[] {
  const byDate = new Map<string, RecessionTaBar>();
  for (const r of rows as any[]) {
    const date = String(r?.date ?? "").slice(0, 10);
    const close = Number(r?.close ?? r?.adjClose);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(close) || close <= 0) continue;
    const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : close);
    byDate.set(date, {
      date,
      open: num(r?.open),
      high: num(r?.high),
      low: num(r?.low),
      close,
      volume: Number.isFinite(Number(r?.volume)) ? Number(r.volume) : 0,
    });
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
}
