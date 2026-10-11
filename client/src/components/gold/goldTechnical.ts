/**
 * Gold-TA-Reihen im BTC-Schema (Future_10 §4). Rechnet aus den vorhandenen
 * Closes dieselben Linien wie client/src/lib/btcAnalysis.ts (SMA/EMA/MACD/
 * RSI, Signal-Erkennung, Bull-Bedingungen). Rein fuer den Chart: kein Input
 * fuer getTechnicalScore oder den GIS. ma200 bleibt das Server-Feld, ma50
 * kommt aus goldChartMa.ts (#201), damit Linie und Cross-Marker identisch
 * bleiben.
 */
import type { GoldPricePoint } from "../../../../shared/gold-schema";
import { detectMaCrosses, trailingSma, withClientMa50 } from "./goldChartMa";

export interface GoldTechPoint {
  date: string;
  price: number;
  volume?: number;
  ma20: number | null; ma50: number | null; ma100: number | null; ma200: number | null;
  ema9: number | null; ema12: number | null; ema26: number | null;
  macd: number | null; signal: number | null; histogram: number | null;
  rsi14: number | null;
  real10y: number | null; m2Yoy: number | null; dxy: number | null; t10yie: number | null; walcl: number | null;
  cross?: "golden" | "death";
  /** Future_10 §4: Volumen > 1,5× Ø der 20 Vortage (nur echte Prints, sonst undefined). */
  volSpike?: boolean;
  /** Future_10 §4: Beginn einer Divergenz — Preis 20T hoeher, Ø-Volumen 20T unter den 20T davor. */
  volDivergence?: boolean;
}

export interface GoldTechSignal { date: string; type: "BUY" | "SELL"; reason: string; price: number }

export interface GoldTechnical {
  points: GoldTechPoint[];
  signals: GoldTechSignal[];
  bullConditions: { priceAboveMA200: boolean; ma50AboveMA200: boolean; macdAboveZero: boolean; macdAboveSignal: boolean; macdRising: boolean };
  currentMA50: number | null;
  currentMA200: number | null;
  currentMACD: number | null;
  currentSignal: number | null;
  /** RSI-Perzentil (0–100) gegen die eigene RSI-Historie (252–504 Tage). null bei < 252 Werten. */
  rsiPercentile: number | null;
  rsiHistoryDays: number;
}

export const VOLUME_SPIKE_MULTIPLE = 1.5; // wie server/gold-adaptive-score.ts
const VOLUME_AVERAGE_DAYS = 20;
const RSI_HISTORY_MIN = 252;
const RSI_HISTORY_MAX = 504;

/** Mittel der `n` Volumina vor bzw. bis Index `end` — nur wenn alle n echte positive Prints sind. */
function realMean(vols: (number | undefined)[], end: number, n: number): number | null {
  if (end - n + 1 < 0) return null;
  let sum = 0;
  for (let j = end - n + 1; j <= end; j++) {
    const v = vols[j];
    if (v == null || !(v > 0)) return null;
    sum += v;
  }
  return sum / n;
}

/** EMA mit SMA-Seed — identisch zu calcEMA in btcAnalysis.ts. */
function calcEMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let ema: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (ema === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      ema = sum / period;
    } else {
      ema = data[i] * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

/** RSI(14) Wilder — identisch zu calcRSI in BTCDashboard.tsx. */
export function calcRSI(prices: number[], period = 14): (number | null)[] {
  const rsi: (number | null)[] = [];
  if (prices.length < period + 1) return prices.map(() => null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    diff > 0 ? (avgGain += diff / period) : (avgLoss += Math.abs(diff) / period);
  }
  for (let i = 0; i < period; i++) rsi.push(null);
  const rs0 = avgGain / (avgLoss || 1e-10);
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0));
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    const rs = avgGain / (avgLoss || 1e-10);
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
  }
  return rsi;
}

export function buildGoldTechnical(history: GoldPricePoint[]): GoldTechnical {
  const series = withClientMa50(history);
  const closes = series.map(p => p.close);
  const ma20 = trailingSma(closes, 20);
  const ma100 = trailingSma(closes, 100);
  const ema9 = calcEMA(closes, 9);
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((e12, i) => (e12 === null || ema26[i] === null ? null : e12 - (ema26[i] as number)));
  const signalRaw = calcEMA(macdLine.filter((v): v is number => v !== null), 9);
  let sIdx = 0;
  const signalLine = macdLine.map(v => (v === null ? null : signalRaw[sIdx++]));
  const rsi = calcRSI(closes);
  const crossByDate = new Map(detectMaCrosses(series).map(c => [c.date, c.type] as const));

  const points: GoldTechPoint[] = series.map((p, i) => {
    const m = macdLine[i];
    const s = signalLine[i];
    return {
      date: p.date,
      price: p.close,
      volume: p.volume,
      ma20: ma20[i], ma50: p.ma50, ma100: ma100[i], ma200: p.ma200 ?? null,
      ema9: ema9[i], ema12: ema12[i], ema26: ema26[i],
      macd: m, signal: s, histogram: m !== null && s !== null ? m - s : null,
      rsi14: rsi[i] ?? null,
      real10y: p.real10y ?? null, m2Yoy: p.m2Yoy ?? null, dxy: p.dxy ?? null,
      t10yie: p.t10yie ?? null, walcl: p.walcl ?? null,
      cross: crossByDate.get(p.date),
    };
  });

  // Signal-Erkennung wie btcAnalysis.ts §12 (ohne BTC-spezifische Pi-Cycle/2Y-MA).
  const signals: GoldTechSignal[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.ma50 !== null && prev.ma200 !== null && curr.ma50 !== null && curr.ma200 !== null) {
      if (prev.ma50 <= prev.ma200 && curr.ma50 > curr.ma200) signals.push({ date: curr.date, type: "BUY", reason: "Golden Cross (MA50 > MA200)", price: curr.price });
      if (prev.ma50 >= prev.ma200 && curr.ma50 < curr.ma200) signals.push({ date: curr.date, type: "SELL", reason: "Death Cross (MA50 < MA200)", price: curr.price });
    }
    if (prev.macd !== null && prev.signal !== null && curr.macd !== null && curr.signal !== null) {
      if (prev.macd <= prev.signal && curr.macd > curr.signal) signals.push({ date: curr.date, type: "BUY", reason: "MACD Bullish Crossover", price: curr.price });
      if (prev.macd >= prev.signal && curr.macd < curr.signal) signals.push({ date: curr.date, type: "SELL", reason: "MACD Bearish Crossover", price: curr.price });
    }
    if (prev.macd !== null && curr.macd !== null) {
      if (prev.macd <= 0 && curr.macd > 0) signals.push({ date: curr.date, type: "BUY", reason: "MACD über Nulllinie", price: curr.price });
      if (prev.macd >= 0 && curr.macd < 0) signals.push({ date: curr.date, type: "SELL", reason: "MACD unter Nulllinie", price: curr.price });
    }
  }

  // Volumen-Marker (nur echte Volumina; fehlt ein Print im Fenster, kein Marker).
  const vols = points.map(p => p.volume);
  let prevDiv = false;
  for (let i = 0; i < points.length; i++) {
    const v = vols[i];
    const avg = realMean(vols, i - 1, VOLUME_AVERAGE_DAYS);
    if (v != null && v > 0 && avg != null && v > VOLUME_SPIKE_MULTIPLE * avg) points[i].volSpike = true;
    const recent = realMean(vols, i, VOLUME_AVERAGE_DAYS);
    const prior = realMean(vols, i - VOLUME_AVERAGE_DAYS, VOLUME_AVERAGE_DAYS);
    const priorClose = i >= VOLUME_AVERAGE_DAYS ? points[i - VOLUME_AVERAGE_DAYS].price : null;
    const div = recent != null && prior != null && priorClose != null && points[i].price > priorClose && recent < prior;
    if (div && !prevDiv) points[i].volDivergence = true;
    prevDiv = div;
  }

  // RSI relativ zur eigenen Historie: Perzentil des letzten RSI in den letzten 252–504 Werten.
  const rsiHist = rsi.filter((v): v is number => v != null && Number.isFinite(v)).slice(-RSI_HISTORY_MAX);
  let rsiPercentile: number | null = null;
  if (rsiHist.length >= RSI_HISTORY_MIN) {
    const cur = rsiHist[rsiHist.length - 1];
    rsiPercentile = Math.round((rsiHist.filter(v => v <= cur).length / rsiHist.length) * 100);
  }

  const last = points.length > 0 ? points[points.length - 1] : null;
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const bullConditions = {
    priceAboveMA200: !!last && last.ma200 !== null && last.price > last.ma200,
    ma50AboveMA200: !!last && last.ma50 !== null && last.ma200 !== null && last.ma50 > last.ma200,
    macdAboveZero: !!last && last.macd !== null && last.macd > 0,
    macdAboveSignal: !!last && last.macd !== null && last.signal !== null && last.macd > last.signal,
    macdRising: !!last && !!prev && last.macd !== null && prev.macd !== null && last.macd > prev.macd,
  };

  return {
    points,
    signals: signals.slice(-100),
    bullConditions,
    currentMA50: last?.ma50 ?? null,
    currentMA200: last?.ma200 ?? null,
    currentMACD: last?.macd ?? null,
    currentSignal: last?.signal ?? null,
    rsiPercentile,
    rsiHistoryDays: rsiHist.length,
  };
}

/**
 * #214-Fix: Relativer RSI. Das Server-Signal `technical.rsi` traegt die
 * Richtung (positiv = bullisch) und speichert deshalb z = −(RSI-z). Der alte
 * Titel zeigte diese Richtungs-z neben dem festen Satz „hoch gegen die eigene
 * Historie = bärisch“ — bei niedrigem RSI (P15) stand dort „z=0,98 … hoch“.
 * Hier werden Perzentil, RSI-z (Vorzeichen zurueckgedreht) und Text aus
 * denselben Zahlen gebaut.
 */
export function describeRelativeRsi(
  percentile: number | null,
  historyDays: number,
  serverDirectionZ: number | null | undefined,
): { label: string; title: string; rsiZ: number | null; consistent: boolean } {
  if (percentile == null) {
    return { label: "Rel. RSI: N/A (< 1 Jahr Historie)", title: "Weniger als 1 Jahr RSI-Historie — kein relativer RSI.", rsiZ: null, consistent: true };
  }
  const years = (historyDays / 252).toFixed(1);
  const rsiZ = serverDirectionZ == null || !Number.isFinite(serverDirectionZ) ? null : -serverDirectionZ;
  const level = percentile >= 50 ? "hoch" : "niedrig";
  const reading = percentile >= 50 ? "hoch gegen die eigene Historie = bärisch" : "niedrig gegen die eigene Historie = bullisch";
  const zPart = rsiZ == null ? "RSI-z: N/A" : `RSI-z=${rsiZ.toFixed(2)}`;
  // Perzentil (Client, 252–504 Werte inkl. heute) und z (Server, Historie ohne heute) duerfen
  // nur in der Mitte auseinanderlaufen; an den Raendern muessen sie dieselbe Seite zeigen.
  const consistent = rsiZ == null || Math.abs(percentile - 50) < 15 || (percentile >= 50) === (rsiZ >= 0);
  return {
    label: `Rel. ${years}J: P${percentile} (${level})`,
    title: `RSI liegt im ${percentile}. Perzentil der letzten ${years} Jahre, ${zPart}: ${reading}.`,
    rsiZ,
    consistent,
  };
}

/** #214-Fix: Server-Detail beginnt schon mit „Volumen-Spike:“ — Praefix nur einmal zeigen. */
export function volumeLegendText(label: string, serverDetail: string | null | undefined): string {
  if (!serverDetail) return label;
  const stripped = serverDetail.replace(/^Volumen-(Spike|Divergenz)\s*:\s*/, "");
  return `${label}: ${stripped}`;
}

/* ---------- 10Y / Max (lange Chart-Historie, /api/gold-chart-history) ---------- */

export type GoldTimeRange = "3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "10Y" | "Max";
export const GOLD_RANGE_DAYS: Record<GoldTimeRange, number | null> = {
  "3M": 90, "6M": 180, "1Y": 365, "2Y": 730, "3Y": 1095, "5Y": 1825, "10Y": 3653, Max: null,
};
/** Diese Fenster brauchen mehr als die 10 Jahre aus /api/analyze-gold (MA200-Vorlauf bzw. volle Historie). */
export const needsLongHistory = (r: GoldTimeRange) => r === "10Y" || r === "Max";

/** Fenster auf die (bereits voll berechneten) Punkte anwenden. Max = alles. */
export function filterGoldRange<T extends { date: string }>(points: T[], range: GoldTimeRange, today: Date = new Date()): T[] {
  const days = GOLD_RANGE_DAYS[range];
  if (days == null) return points;
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  return points.filter(d => d.date >= cutoffStr);
}

export type GoldMacroKey = "real10y" | "m2Yoy" | "dxy" | "t10yie" | "walcl";
/** "on" = Werte im Fenster, "na" = Reihe existiert, aber nicht im Fenster (Chip n/a, keine Linie), "absent" = Quelle fehlt ganz. */
export function macroRangeState(all: Array<Partial<Record<GoldMacroKey, number | null>>>, inRange: Array<Partial<Record<GoldMacroKey, number | null>>>, key: GoldMacroKey): "on" | "na" | "absent" {
  if (inRange.some(d => d[key] != null)) return "on";
  return all.some(d => d[key] != null) ? "na" : "absent";
}

/** Ehrlicher Hinweis, wenn eine Reihe spaeter beginnt als das Fenster oder die Historie kuerzer ist als 10Y. */
export function goldRangeNote(
  range: GoldTimeRange,
  inRange: Array<{ date: string } & Partial<Record<GoldMacroKey, number | null>>>,
  source: string | null,
  labels: Record<GoldMacroKey, string>,
): string | null {
  if (!needsLongHistory(range) || inRange.length === 0) return null;
  const first = inRange[0].date;
  const last = inRange[inRange.length - 1].date;
  const years = (Date.parse(last) - Date.parse(first)) / (365.25 * 864e5);
  const yr = years.toFixed(1).replace(".", ",");
  const head = range === "Max"
    ? `Max = ab ${first} (${yr} J${source ? `, ${source}` : ""})`
    : years < 9.9 ? `10Y: nur ${yr} J verfügbar (ab ${first})` : `10Y ab ${first}${source ? ` (${source})` : ""}`;
  const late: string[] = [];
  for (const key of Object.keys(labels) as GoldMacroKey[]) {
    const hit = inRange.find(d => d[key] != null);
    if (!hit) late.push(`${labels[key]} n/a`);
    else if (Date.parse(hit.date) - Date.parse(first) > 60 * 864e5) late.push(`${labels[key]} ab ${hit.date.slice(0, 4)}`);
  }
  return late.length ? `${head} · ${late.join(" · ")}` : head;
}
