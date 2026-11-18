/**
 * BTC-Zeitfenster der Technischen Analyse.
 * Der Schnitt ist das Kalenderdatum: heute minus den Zeitraum des Presets.
 * Max ist die ganze Reihe. 3M, 6M, 1Y, 2Y, 3Y, 5Y und 10Y nutzen dieselbe Regel.
 * Krypto handelt täglich, deshalb ist 10Y ein Kalenderfenster und kein
 * 2520-Börsentage-Schnitt. Lücken in der Reihe bleiben Lücken.
 *
 * Die SMA liegt schon auf der vollen Reihe (btcAnalysis calcSMA, Vorlauf
 * vor dem Schnitt). Angezeigt wird nur das Fenster. Fehlen vor dem ersten
 * sichtbaren Bar die Punkte, bleibt MA50/MA200 null — keine Ersatzlinie.
 * `points` ist aufsteigend nach Datum, wie die Chart-Reihe.
 */
import { BTC_SPOT_SOURCE_LABEL } from "@shared/btc-spot";

export const BTC_TA_RANGES = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y", "Max"] as const;

export type BtcTaRange = (typeof BTC_TA_RANGES)[number];

export const BTC_PRICE_SOURCE = BTC_SPOT_SOURCE_LABEL;

export interface BtcTaPoint {
  date: string;
  ma50?: number | null;
  ma200?: number | null;
}

export interface BtcTaSlice<T extends BtcTaPoint> {
  visible: T[];
  /** Bars vor dem ersten sichtbaren Punkt. Die SMA hat sie schon verrechnet. */
  warmupBars: number;
  /** Die Reihe beginnt nach dem angeforderten Stichtag. Max ist nie „kurz“. */
  short: boolean;
  since: string | null;
  historyNote: string | null;
  ma50FromFirst: boolean;
  ma200FromFirst: boolean;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** UTC-heute, im selben YYYY-MM-DD wie die Kurspunkte. */
export function btcTaToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function periodOf(range: Exclude<BtcTaRange, "Max">): { years: number; months: number } {
  switch (range) {
    case "3M":
      return { years: 0, months: 3 };
    case "6M":
      return { years: 0, months: 6 };
    case "1Y":
      return { years: 1, months: 0 };
    case "2Y":
      return { years: 2, months: 0 };
    case "3Y":
      return { years: 3, months: 0 };
    case "5Y":
      return { years: 5, months: 0 };
    case "10Y":
      return { years: 10, months: 0 };
    default: {
      const unexpected: never = range;
      return unexpected;
    }
  }
}

/** Kalenderverschiebung. Der Tag wird auf den letzten Tag des Zielmonats geklemmt. */
export function shiftUtcCalendar(iso: string, years: number, months: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthIndex = month - 1 + months + years * 12;
  const targetYear = year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

/** Stichtag des Fensters. Max hat keinen. */
export function btcTaCutoffDate(range: BtcTaRange, asOf: string): string | null {
  if (range === "Max") return null;
  const { years, months } = periodOf(range);
  return shiftUtcCalendar(asOf, -years, -months);
}

/**
 * SMA an Index i aus den `period` Schlüssen davor, inklusive i.
 * null, wenn der Vorlauf nicht reicht — kein Teilfenster-Mittel.
 */
export function smaAt(closes: readonly number[], index: number, period: number): number | null {
  if (period < 1 || index < period - 1 || index >= closes.length) return null;
  let sum = 0;
  for (let j = index - period + 1; j <= index; j++) {
    const v = closes[j];
    if (!finite(v)) return null;
    sum += v;
  }
  return sum / period;
}

export function sliceBtcTaWindow<T extends BtcTaPoint>(
  points: readonly T[],
  range: BtcTaRange,
  asOf: string = btcTaToday(),
): BtcTaSlice<T> {
  const cutoff = btcTaCutoffDate(range, asOf);
  let start = 0;
  if (cutoff != null) {
    const idx = points.findIndex(p => p.date >= cutoff);
    start = idx < 0 ? points.length : idx;
  }
  const visible = points.slice(start);
  const since = visible[0]?.date ?? null;
  const short = cutoff != null && (points.length === 0 || points[0].date > cutoff);
  const ma50FromFirst = visible.length > 0 && finite(visible[0].ma50);
  const ma200FromFirst = visible.length > 0 && finite(visible[0].ma200);
  // Max nennt immer den ersten Bar. Sonst nur, wenn der Schnitt nicht gefüllt ist
  // oder MA50/MA200 am ersten sichtbaren Tag noch keinen Vorlauf haben.
  const showNote = since != null && (range === "Max" || short || !ma50FromFirst || !ma200FromFirst);
  let historyNote: string | null = null;
  if (showNote && since) {
    const parts = [`Historie seit ${since}`];
    if (!ma200FromFirst) {
      const i = visible.findIndex(p => finite(p.ma200));
      parts.push(i >= 0 ? `MA200 ab ${visible[i].date}` : "MA200 n/a — weniger als 200 Bars vor dem Fenster");
    } else if (!ma50FromFirst) {
      const i = visible.findIndex(p => finite(p.ma50));
      parts.push(i >= 0 ? `MA50 ab ${visible[i].date}` : "MA50 n/a — weniger als 50 Bars vor dem Fenster");
    }
    parts.push(`Quelle ${BTC_PRICE_SOURCE}`);
    historyNote = parts.join(" · ");
  }
  return { visible, warmupBars: start, short, since, historyNote, ma50FromFirst, ma200FromFirst };
}
