/**
 * F9-04 — Lager/Nachfrage-Lücke (Spec: Offen_FUTURE_SOLL_IST_DETAIL.md Z.258, Quelle Z.28).
 * Reine Rechenlogik, kein Netz, kein Score:
 *  1. ISRATIO (Total Business Inventories/Sales Ratio, FRED) — z-Wert des letzten Werts gegen die
 *     Historie der letzten 10 Jahre (Mittel/Std) plus Abstand zum 10J-Median.
 *  2. YoY-Lücke Aufträge vs. Auslieferungen: DGORDER-YoY minus AMDMVS-YoY (Prozentpunkte).
 *     YoY über den gleichen Monat des Vorjahres (Datum-Match, kein Index-Raten).
 * Zu wenig Historie / fehlende Werte → value null + reason (n/a), nie 0.
 */
export interface SeriesPoint { date: string; value: number }

export type NaReading = { available: false; reason: string };

export type IsratioReading =
  | { available: true; latestDate: string; latest: number; median10y: number; mean10y: number; std10y: number;
      z: number; deviationFromMedian: number; months: number; windowStart: string }
  | NaReading;

export type OrderShipmentGapReading =
  | { available: true; latestDate: string; dgorderLatest: number; dgorderYearAgo: number; amdmvsLatest: number;
      amdmvsYearAgo: number; dgorderYoyPct: number; amdmvsYoyPct: number; gapPp: number }
  | NaReading;

export interface InventoryDemandGap {
  isratio: IsratioReading;
  orderShipmentGap: OrderShipmentGapReading;
  sources: { isratio: "FRED ISRATIO"; orders: "FRED DGORDER"; shipments: "FRED AMDMVS" };
}

/** Mindestens 5 Jahre Monatswerte im 10J-Fenster, sonst n/a. */
export const ISRATIO_MIN_MONTHS = 60;
export const ISRATIO_WINDOW_YEARS = 10;

function clean(obs: SeriesPoint[]): SeriesPoint[] {
  return obs.filter(o => typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date) && Number.isFinite(o.value))
    .slice().sort((a, b) => a.date.localeCompare(b.date));
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function shiftYears(date: string, years: number): string {
  return `${String(Number(date.slice(0, 4)) + years).padStart(4, "0")}${date.slice(4)}`;
}

export function isratioReading(obs: SeriesPoint[]): IsratioReading {
  const c = clean(obs);
  if (c.length === 0) return { available: false, reason: "ISRATIO: keine gültigen Beobachtungen" };
  const last = c[c.length - 1];
  const windowStart = shiftYears(last.date, -ISRATIO_WINDOW_YEARS);
  const win = c.filter(o => o.date > windowStart);
  if (win.length < ISRATIO_MIN_MONTHS) {
    return { available: false, reason: `ISRATIO: zu wenig Historie (${win.length} Monate im 10J-Fenster, mindestens ${ISRATIO_MIN_MONTHS})` };
  }
  const vals = win.map(o => o.value);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1));
  if (!(std > 1e-12)) return { available: false, reason: "ISRATIO: Streuung im 10J-Fenster ist 0, z-Wert nicht definiert" };
  const med = median(vals);
  return { available: true, latestDate: last.date, latest: last.value, median10y: med, mean10y: mean, std10y: std,
    z: (last.value - mean) / std, deviationFromMedian: last.value - med, months: win.length, windowStart };
}

function yoy(c: SeriesPoint[], date: string): { latest: number; yearAgo: number; pct: number } | string {
  const cur = c.find(o => o.date === date);
  const prev = c.find(o => o.date === shiftYears(date, -1));
  if (!cur) return `kein Wert für ${date}`;
  if (!prev) return `kein Vorjahreswert für ${shiftYears(date, -1)}`;
  if (prev.value === 0) return `Vorjahreswert ${shiftYears(date, -1)} ist 0`;
  return { latest: cur.value, yearAgo: prev.value, pct: ((cur.value - prev.value) / prev.value) * 100 };
}

export function orderShipmentGapReading(dgorder: SeriesPoint[], amdmvs: SeriesPoint[]): OrderShipmentGapReading {
  const d = clean(dgorder), a = clean(amdmvs);
  if (d.length === 0) return { available: false, reason: "DGORDER: keine gültigen Beobachtungen" };
  if (a.length === 0) return { available: false, reason: "AMDMVS: keine gültigen Beobachtungen" };
  const aDates = new Set(a.map(o => o.date));
  const common = d.filter(o => aDates.has(o.date));
  if (common.length === 0) return { available: false, reason: "DGORDER/AMDMVS: kein gemeinsamer Monat" };
  const date = common[common.length - 1].date;
  const dy = yoy(d, date), ay = yoy(a, date);
  if (typeof dy === "string") return { available: false, reason: `DGORDER: ${dy}` };
  if (typeof ay === "string") return { available: false, reason: `AMDMVS: ${ay}` };
  return { available: true, latestDate: date, dgorderLatest: dy.latest, dgorderYearAgo: dy.yearAgo, amdmvsLatest: ay.latest,
    amdmvsYearAgo: ay.yearAgo, dgorderYoyPct: dy.pct, amdmvsYoyPct: ay.pct, gapPp: dy.pct - ay.pct };
}

export function computeInventoryDemandGap(isratio: SeriesPoint[], dgorder: SeriesPoint[], amdmvs: SeriesPoint[]): InventoryDemandGap {
  return {
    isratio: isratioReading(isratio),
    orderShipmentGap: orderShipmentGapReading(dgorder, amdmvs),
    sources: { isratio: "FRED ISRATIO", orders: "FRED DGORDER", shipments: "FRED AMDMVS" },
  };
}
