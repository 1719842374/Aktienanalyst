/**
 * Anzeige-Cross mit Hysterese. Score, Fazit und die 4/4-Ampel bleiben am rohen
 * Vergleich MA50 > MA200. Live ist die Vola-Schwelle aus (k = 0), bis Philip
 * eine Zahl nennt.
 */

export const HYSTERESIS_BARS = 3;
export const VOL_THRESHOLD_K = 0;
export const SIGMA_WINDOW = 250;
export const SIGMA_LAG = 20;
export const MAD_SCALE = 1.4826;
export const MIN_EVENT_INDEX = 199;
export const CONFIRM_WINDOW_BARS = 10;
/** Bestätigt zum Freeze, wenn mindestens so viele der 4 Kriterien treffen. n/a zählt nicht. */
export const CONFIRM_MIN_HITS = 3;
export const CRITERION_COUNT = 4;
export const PRICE_SIDE_LOOKBACK = 5;
export const PRICE_SIDE_MIN = 3;
export const MACD_HIST_BARS = 3;
export const RS_LOOKBACK = 20;
export const VOLUME_SHORT = 5;
export const VOLUME_LONG = 20;
export const WHIPSAW_BARS = 60;
export const WHIPSAW_LOOKBACK_YEARS = 5;
/** Obergrenze: m Tage Hysterese plus das Bestätigungsfenster. */
export const CROSS_POSITIVE_LAG_BARS = HYSTERESIS_BARS + CONFIRM_WINDOW_BARS;

export const BENCHMARK_UNAVAILABLE_REASON =
  "n/a — keine Sektor-/Benchmark-ETF-Reihe in der Chart-Datenkette (SPY nur serverseitig für liveBeta, nicht am Analyse-Payload)";

export type CrossKind = "golden" | "death";
export type CrossState = "pending" | "confirmed" | "false_signal" | "expired";
export type CrossTone = "neutral" | "positive" | "negative";

export interface CrossBar {
  date: string;
  close: number;
  ma50?: number | null;
  ma200?: number | null;
  histogram?: number | null;
  volume?: number | null;
}

export interface CrossCriterion {
  id: "price" | "macd" | "relative_strength" | "volume";
  label: string;
  preisbasiert: boolean;
  /** true = getroffen, false = nicht getroffen, null = n/a. */
  met: boolean | null;
  detail: string;
}

export interface CrossEvent {
  date: string;
  index: number;
  type: CrossKind;
  detectedIndex: number;
  state: CrossState;
  hits: number;
  criteria: CrossCriterion[];
  frozen: boolean;
  asOfIndex: number;
  ageBars: number;
  counterDate: string | null;
}

export interface CrossView {
  events: CrossEvent[];
  latest: CrossEvent | null;
  whipsaw: { w: number; n: number };
}

export interface CrossOptions {
  k?: number;
  asOfIndex?: number;
  /** Schlusskurse des Benchmarks, Index = Kerze der Aktie. Fehlt die Reihe, ist Kriterium 3 n/a. */
  benchmarkCloses?: readonly (number | null | undefined)[] | null;
}

export function crossDelayTooltip(): string {
  return `Ein echter Cross wird erst bis zu ca. ${CROSS_POSITIVE_LAG_BARS} Handelstage nach dem rohen Kreuzpunkt positiv (Hysterese ${HYSTERESIS_BARS} HT, Bestätigung ${CONFIRM_WINDOW_BARS} HT).`;
}

export function crossTone(event: CrossEvent): CrossTone {
  if (event.state !== "confirmed") return "neutral";
  return event.type === "golden" ? "positive" : "negative";
}

export function hitsLabel(hits: number): string {
  return `${hits} von ${CRITERION_COUNT}`;
}

export function stateLabel(state: CrossState): string {
  switch (state) {
    case "pending":
      return "unbestätigt/PENDING";
    case "confirmed":
      return "bestätigt";
    case "false_signal":
      return "Fehlsignal";
    case "expired":
      return "verfallen";
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/** Rohzeile Golden/Death: null = kein MA-Cross, Farbe bleibt beim MACD. */
export function maCrossReasonTone(
  reason: string,
  date: string,
  events: readonly CrossEvent[],
): CrossTone | null {
  const golden = reason.includes("Golden Cross");
  const death = reason.includes("Death Cross");
  if (!golden && !death) return null;
  const type: CrossKind = golden ? "golden" : "death";
  const event = events.find(item => item.date === date && item.type === type);
  if (!event) return "neutral";
  return crossTone(event);
}

export function spreadOfBar(bar: CrossBar): number | null {
  const ma50 = bar.ma50;
  const ma200 = bar.ma200;
  if (ma50 == null || ma200 == null) return null;
  if (!Number.isFinite(ma50) || !Number.isFinite(ma200) || ma50 <= 0 || ma200 <= 0) return null;
  const spread = Math.log(ma50 / ma200);
  return Number.isFinite(spread) ? spread : null;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** sigma_t = 1.4826 · MAD(s_u − s_{u−20}) für u = t−249..t. */
export function sigmaAt(spreads: readonly (number | null)[], t: number): number | null {
  const start = t - (SIGMA_WINDOW - 1);
  const deltas: number[] = [];
  for (let u = start; u <= t; u++) {
    const now = u >= 0 ? spreads[u] : null;
    const prev = u - SIGMA_LAG >= 0 ? spreads[u - SIGMA_LAG] : null;
    if (now == null || prev == null) continue;
    const delta = now - prev;
    if (Number.isFinite(delta)) deltas.push(delta);
  }
  if (deltas.length === 0) return null;
  const center = median(deltas);
  const mad = median(deltas.map(delta => Math.abs(delta - center)));
  if (!Number.isFinite(mad)) return null;
  return MAD_SCALE * mad;
}

function subtractYears(iso: string, years: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year - years, month - 1, day));
  return date.toISOString().slice(0, 10);
}

function priceCriterion(bars: readonly CrossBar[], index: number, type: CrossKind): CrossCriterion {
  const label = "Preis auf der Regime-Seite des MA200 (≥3 von 5 HT)";
  if (index < PRICE_SIDE_LOOKBACK - 1) {
    return { id: "price", label, preisbasiert: true, met: false, detail: "weniger als 5 Handelstage" };
  }
  let onSide = 0;
  for (let i = index - (PRICE_SIDE_LOOKBACK - 1); i <= index; i++) {
    const ma200 = bars[i]?.ma200;
    const close = bars[i]?.close;
    if (ma200 == null || close == null || !Number.isFinite(ma200) || !Number.isFinite(close)) continue;
    if (type === "golden" ? close > ma200 : close < ma200) onSide += 1;
  }
  const met = onSide >= PRICE_SIDE_MIN;
  return { id: "price", label, preisbasiert: true, met, detail: `${onSide} von ${PRICE_SIDE_LOOKBACK} HT` };
}

function macdCriterion(bars: readonly CrossBar[], index: number, type: CrossKind): CrossCriterion {
  const label = "MACD-Histogramm 3 Bars in Regime-Richtung";
  if (index < MACD_HIST_BARS - 1) {
    return { id: "macd", label, preisbasiert: true, met: false, detail: "weniger als 3 Bars" };
  }
  let aligned = 0;
  for (let i = index - (MACD_HIST_BARS - 1); i <= index; i++) {
    const histogram = bars[i]?.histogram;
    if (histogram == null || !Number.isFinite(histogram)) {
      return { id: "macd", label, preisbasiert: true, met: false, detail: "Histogramm fehlt" };
    }
    if (type === "golden" ? histogram > 0 : histogram < 0) aligned += 1;
  }
  return {
    id: "macd",
    label,
    preisbasiert: true,
    met: aligned === MACD_HIST_BARS,
    detail: `${aligned} von ${MACD_HIST_BARS} Bars`,
  };
}

function relativeStrengthCriterion(
  bars: readonly CrossBar[],
  index: number,
  benchmarkCloses: readonly (number | null | undefined)[] | null | undefined,
): CrossCriterion {
  const label = "Relative Stärke 20 HT gegen Sektor-/Benchmark-ETF > 0";
  if (!benchmarkCloses) {
    return { id: "relative_strength", label, preisbasiert: false, met: null, detail: BENCHMARK_UNAVAILABLE_REASON };
  }
  const prev = index - RS_LOOKBACK;
  const stockNow = bars[index]?.close;
  const stockPrev = prev >= 0 ? bars[prev]?.close : null;
  const benchNow = benchmarkCloses[index];
  const benchPrev = prev >= 0 ? benchmarkCloses[prev] : null;
  if (
    stockNow == null || stockPrev == null || benchNow == null || benchPrev == null
    || !(stockNow > 0) || !(stockPrev > 0) || !(benchNow > 0) || !(benchPrev > 0)
  ) {
    return {
      id: "relative_strength",
      label,
      preisbasiert: false,
      met: null,
      detail: "n/a — Benchmark-Schluss am Stichtag oder 20 HT davor fehlt",
    };
  }
  const excess = Math.log(stockNow / stockPrev) - Math.log(benchNow / benchPrev);
  return {
    id: "relative_strength",
    label,
    preisbasiert: false,
    met: excess > 0,
    detail: `Überschuss ${excess.toFixed(4)}`,
  };
}

function volumeCriterion(bars: readonly CrossBar[], index: number): CrossCriterion {
  const label = "Volumen V5/V20 > 1 an Up-Tagen";
  const volumes: number[] = [];
  for (let i = index; i >= 1 && volumes.length < VOLUME_LONG; i--) {
    const volume = bars[i]?.volume;
    const close = bars[i]?.close;
    const prev = bars[i - 1]?.close;
    if (volume == null || close == null || prev == null) continue;
    if (!Number.isFinite(volume) || !Number.isFinite(close) || !Number.isFinite(prev)) continue;
    if (close >= prev) volumes.push(volume);
  }
  if (volumes.length < VOLUME_LONG) {
    return { id: "volume", label, preisbasiert: false, met: false, detail: `${volumes.length} von ${VOLUME_LONG} Up-Tagen` };
  }
  const mean = (slice: readonly number[]) => slice.reduce((sum, value) => sum + value, 0) / slice.length;
  const v5 = mean(volumes.slice(0, VOLUME_SHORT));
  const v20 = mean(volumes);
  if (!(v20 > 0)) {
    return { id: "volume", label, preisbasiert: false, met: false, detail: "V20 ist 0" };
  }
  const ratio = v5 / v20;
  return { id: "volume", label, preisbasiert: false, met: ratio > 1, detail: `V5/V20 ${ratio.toFixed(2)}` };
}

export function evaluateCriteria(
  bars: readonly CrossBar[],
  index: number,
  type: CrossKind,
  benchmarkCloses?: readonly (number | null | undefined)[] | null,
): CrossCriterion[] {
  return [
    priceCriterion(bars, index, type),
    macdCriterion(bars, index, type),
    relativeStrengthCriterion(bars, index, benchmarkCloses),
    volumeCriterion(bars, index),
  ];
}

interface RawCross {
  type: CrossKind;
  index: number;
  detectedIndex: number;
}

function rawEvents(spreads: readonly (number | null)[], k: number): RawCross[] {
  const out: RawCross[] = [];
  let regime: CrossKind | null = null;
  for (let t = 0; t < spreads.length; t++) {
    const tau = t - (HYSTERESIS_BARS - 1);
    if (tau < MIN_EVENT_INDEX) continue;
    const sigma = k === 0 ? 0 : sigmaAt(spreads, t);
    if (k !== 0 && (sigma == null || !Number.isFinite(sigma))) continue;
    const threshold = k === 0 ? 0 : k * (sigma as number);
    let golden = true;
    let death = true;
    for (let j = 0; j < HYSTERESIS_BARS; j++) {
      const spread = spreads[t - j];
      if (spread == null || !(spread > threshold)) golden = false;
      if (spread == null || !(spread < -threshold)) death = false;
    }
    let next: CrossKind | null = regime;
    if (golden) next = "golden";
    else if (death) next = "death";
    if (next !== regime && next != null) {
      out.push({ type: next, index: tau, detectedIndex: t });
    }
    regime = next;
  }
  return out;
}

export function confirmCrossEvents(bars: readonly CrossBar[], options: CrossOptions = {}): CrossView {
  const k = options.k ?? VOL_THRESHOLD_K;
  const asOf = Math.min(bars.length - 1, options.asOfIndex ?? bars.length - 1);
  if (bars.length === 0 || asOf < 0) return { events: [], latest: null, whipsaw: { w: 0, n: 0 } };
  const spreads = bars.map(spreadOfBar);
  const raw = rawEvents(spreads, k).filter(event => event.detectedIndex <= asOf);
  const events: CrossEvent[] = raw.map((event, ordinal) => {
    const counter = raw[ordinal + 1] ?? null;
    const freeze = event.index + CONFIRM_WINDOW_BARS;
    const evalIndex = Math.min(asOf, freeze);
    const criteria = evaluateCriteria(bars, evalIndex, event.type, options.benchmarkCloses);
    const hits = criteria.filter(item => item.met === true).length;
    const frozen = asOf >= freeze;
    const flipped = counter != null && counter.index <= asOf;
    let state: CrossState;
    if (!frozen) state = flipped ? "false_signal" : "pending";
    else if (counter != null && counter.index <= freeze) state = "false_signal";
    else if (hits >= CONFIRM_MIN_HITS) state = flipped ? "false_signal" : "confirmed";
    else state = flipped ? "false_signal" : "expired";
    return {
      date: bars[event.index]?.date ?? "",
      index: event.index,
      type: event.type,
      detectedIndex: event.detectedIndex,
      state,
      hits,
      criteria,
      frozen,
      asOfIndex: asOf,
      ageBars: asOf - event.index,
      counterDate: flipped && counter ? (bars[counter.index]?.date ?? null) : null,
    };
  });
  const asOfDate = bars[asOf]?.date ?? "";
  const cutoff = asOfDate ? subtractYears(asOfDate, WHIPSAW_LOOKBACK_YEARS) : "";
  const inWindow = events.filter(event => event.date >= cutoff);
  const whipsawCount = inWindow.filter(event => {
    if (!event.counterDate) return false;
    const counter = events.find(item => item.date === event.counterDate);
    return counter != null && counter.index - event.index <= WHIPSAW_BARS;
  }).length;
  return {
    events,
    latest: events.length > 0 ? events[events.length - 1] : null,
    whipsaw: { w: whipsawCount, n: inWindow.length },
  };
}
