/**
 * BTC-Zeitfenster der Technischen Analyse.
 * Dieselbe Handelstage-Zählung wie TechnicalChart TIME_RANGE_CUTOFF (#428):
 * letzte N Bars, nicht Kalendertage ab heute. Max ist die ganze Reihe.
 * 2Y = 504, wie TechnicalChart TIME_RANGE_CUTOFF.
 *
 * Die SMA liegt schon auf der vollen Reihe (btcAnalysis calcSMA, Vorlauf
 * vor dem Schnitt). Angezeigt wird nur das Fenster. Fehlen vor dem ersten
 * sichtbaren Bar die Punkte, bleibt MA50/MA200 null — keine Ersatzlinie.
 */
export const BTC_TA_CUTOFF = {
  "3M": 63,
  "6M": 126,
  "1Y": 252,
  "2Y": 504,
  "3Y": 756,
  "5Y": 1260,
  "10Y": 2520,
  Max: Number.MAX_SAFE_INTEGER,
} as const;

export type BtcTaRange = keyof typeof BTC_TA_CUTOFF;

export const BTC_TA_RANGES = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y", "Max"] as const satisfies readonly BtcTaRange[];

/** Wie TechnicalChart isHistoryTruncated: 95 %, weil die Barzahl je Jahr schwankt. */
export const BTC_TA_COVERAGE = 0.95;

export const BTC_PRICE_SOURCE = "blockchain.info market-price (timespan=all)";

export interface BtcTaPoint {
  date: string;
  ma50?: number | null;
  ma200?: number | null;
}

export interface BtcTaSlice<T extends BtcTaPoint> {
  visible: T[];
  /** Bars vor dem ersten sichtbaren Punkt. Die SMA hat sie schon verrechnet. */
  warmupBars: number;
  /** Preset verlangt mehr Bars, als die Reihe hat. Max ist nie „kurz“. */
  short: boolean;
  since: string | null;
  historyNote: string | null;
  ma50FromFirst: boolean;
  ma200FromFirst: boolean;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
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

export function sliceBtcTaWindow<T extends BtcTaPoint>(points: readonly T[], range: BtcTaRange): BtcTaSlice<T> {
  const cutoff = BTC_TA_CUTOFF[range];
  const take = Math.min(cutoff, points.length);
  const start = points.length - take;
  const visible = points.slice(start);
  const since = visible[0]?.date ?? null;
  const short = range !== "Max" && points.length < cutoff * BTC_TA_COVERAGE;
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
