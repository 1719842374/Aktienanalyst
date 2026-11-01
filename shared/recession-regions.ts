/**
 * Eurozone and Japan catalogs from Offen_WORK_RECESSION_SOURCES.md.
 * Same two books. A missing print stays out of the net and the max.
 * The 0.70 / 0.20 / 0.10 blend is not the US action input.
 */

export const REGION_WEIGHT = { US: 0.7, EZ: 0.2, JP: 0.1 } as const;
/**
 * Nominal GDP, current US$, World Bank via FRED.
 * CN is the series the Buffett anchor already uses. JP is the same series for Japan.
 * The peer weight is the latest print's share. A missing print is n/a, not a stand-in number.
 */
export const ASIA_GDP_USD = {
  JP: "MKTGDPJPA646NWDB",
  CN: "MKTGDPCNA646NWDB",
} as const;
/** s(z) raw is already on the −4…+4 scale. Same max the curve slot uses. */
export const SERIES_STRESS_MAX = 4;
/** 20-session realized vol, same window as the ASHR market chart. */
export const ASHR_REALIZED_SESSIONS = 20;
export const ASHR_REALIZED_MIN_RETURNS = 15;
export const ASHR_ANN_SESSIONS = 252;
/** A monthly print older than this is shown and not scored. */
export const STALE_MONTHS = 18;
export const SAHM_ANALOG_THRESHOLD_PP = 0.5;

export type RegionId = "US" | "EZ" | "JP";
export type RegionBook = "recession" | "correction";
export type RegionSlotId = "labor" | "curve" | "activity" | "money" | "spreads" | "valuation" | "vol";

export interface RegionSlot {
  id: RegionSlotId;
  name: string;
  book: RegionBook;
  value: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  maxWeighted: number;
  zone: string;
  source: string;
  available: boolean;
}

export interface RegionCatalog {
  id: RegionId;
  label: string;
  weight: number;
  slots: RegionSlot[];
  recessionProbability: number | null;
  correctionProbability: number | null;
  /** How this region's headline P was built. Absent on US and Europa. */
  note?: string;
}

export interface RegionalCatalogs {
  weights: { US: number; EZ: number; JP: number };
  regions: RegionCatalog[];
  blendedRecession12m: number | null;
  blendedCorrection12m: number | null;
  actionUsesUsBooks: true;
}

export interface DatedPoint {
  date: string;
  value: number;
}

export interface ScoredReading {
  value: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  maxWeighted: number;
  zone: string;
  available?: boolean;
}

export function bookProbability(net: number, max: number): number | null {
  if (!(max > 0) || !Number.isFinite(net)) return null;
  const raw = 50 + (net / max) * 50;
  const clamped = Math.max(5, Math.min(95, raw));
  return Math.round(clamped / 5) * 5;
}

export interface AsiaSideWeight {
  series: string;
  gdpUsd: number | null;
  /** null = n/a. A lone survivor is 1 after the missing side is dropped. */
  weight: number | null;
  reason: string;
}

export interface AsiaGdpWeights {
  jp: AsiaSideWeight;
  cn: AsiaSideWeight;
  text: string;
}

function positiveGdp(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function shareText(percent: number): string {
  return `${(percent * 100).toFixed(1).replace(".", ",")} %`;
}

/**
 * Japan/China blend weights from the two GDP prints.
 * Both present: share of the sum. One missing: that side stays n/a and the other is 1.
 * Both missing: both weights stay n/a. Never a fixed 1/1.
 */
export function asiaGdpWeights(input: {
  jp: { gdpUsd: number | null; source: string };
  cn: { gdpUsd: number | null; source: string };
}): AsiaGdpWeights {
  const jpGdp = positiveGdp(input.jp.gdpUsd);
  const cnGdp = positiveGdp(input.cn.gdpUsd);
  const jpReason = input.jp.source;
  const cnReason = input.cn.source;
  if (jpGdp != null && cnGdp != null) {
    const sum = jpGdp + cnGdp;
    const jp = jpGdp / sum;
    const cn = cnGdp / sum;
    return {
      jp: { series: ASIA_GDP_USD.JP, gdpUsd: jpGdp, weight: jp, reason: jpReason },
      cn: { series: ASIA_GDP_USD.CN, gdpUsd: cnGdp, weight: cn, reason: cnReason },
      text: `BIP-Anteil US-$: Japan ${shareText(jp)} (${jpReason}), China ${shareText(cn)} (${cnReason}).`,
    };
  }
  if (jpGdp != null) {
    return {
      jp: { series: ASIA_GDP_USD.JP, gdpUsd: jpGdp, weight: 1, reason: jpReason },
      cn: { series: ASIA_GDP_USD.CN, gdpUsd: null, weight: null, reason: cnReason },
      text: `Gewicht China n/a — ${cnReason}. Japan neu normiert auf 100 %.`,
    };
  }
  if (cnGdp != null) {
    return {
      jp: { series: ASIA_GDP_USD.JP, gdpUsd: null, weight: null, reason: jpReason },
      cn: { series: ASIA_GDP_USD.CN, gdpUsd: cnGdp, weight: 1, reason: cnReason },
      text: `Gewicht Japan n/a — ${jpReason}. China neu normiert auf 100 %.`,
    };
  }
  return {
    jp: { series: ASIA_GDP_USD.JP, gdpUsd: null, weight: null, reason: jpReason },
    cn: { series: ASIA_GDP_USD.CN, gdpUsd: null, weight: null, reason: cnReason },
    text: `Gewicht Japan n/a — ${jpReason}. Gewicht China n/a — ${cnReason}.`,
  };
}

export function blendWeighted(parts: Array<{ weight: number; probability: number | null }>): number | null {
  const live = parts.filter(part => part.probability != null && part.weight > 0);
  const weightSum = live.reduce((sum, part) => sum + part.weight, 0);
  if (!(weightSum > 0)) return null;
  const raw = live.reduce((sum, part) => sum + (part.weight / weightSum) * (part.probability as number), 0);
  const clamped = Math.max(5, Math.min(95, raw));
  return Math.round(clamped / 5) * 5;
}

export function catalogProbability(slots: RegionSlot[], book: RegionBook): number | null {
  const scored = slots.filter(slot => slot.book === book && slot.available);
  if (scored.length === 0) return null;
  const net = scored.reduce((sum, slot) => sum + slot.weightedScore, 0);
  const max = scored.reduce((sum, slot) => sum + slot.maxWeighted, 0);
  return bookProbability(net, max);
}

/**
 * Sahm analog: 3-month average minus the lowest 3-month average in the prior 12 months.
 * The 0.5pp mark is the threshold the catalog asks us to compute. It is not the US s(z) card.
 */
export function sahmGapPp(monthlyRates: number[]): number {
  if (monthlyRates.length < 15) return NaN;
  const averages: number[] = [];
  for (let i = 2; i < monthlyRates.length; i++) {
    const window = monthlyRates.slice(i - 2, i + 1);
    if (window.some(value => !Number.isFinite(value))) return NaN;
    averages.push(window.reduce((sum, value) => sum + value, 0) / 3);
  }
  const current = averages[averages.length - 1];
  const prior = averages.slice(Math.max(0, averages.length - 1 - 12), averages.length - 1);
  if (prior.length < 12 || !Number.isFinite(current)) return NaN;
  return current - Math.min(...prior);
}

export function closedSlot(id: RegionSlotId, name: string, book: RegionBook, source: string, value = "N/A"): RegionSlot {
  return {
    id,
    name,
    book,
    value,
    rawScore: 0,
    weight: 0,
    weightedScore: 0,
    maxWeighted: 0,
    zone: "N/A",
    source,
    available: false,
  };
}

export function laborSlot(name: string, source: string, gapPp: number): RegionSlot {
  if (!Number.isFinite(gapPp)) return closedSlot("labor", name, "recession", source);
  const triggered = gapPp >= SAHM_ANALOG_THRESHOLD_PP;
  const raw = triggered ? 4 : -3;
  return {
    id: "labor",
    name,
    book: "recession",
    value: `${gapPp >= 0 ? "+" : ""}${gapPp.toFixed(2)} pp`,
    rawScore: raw,
    weight: 1,
    weightedScore: raw,
    maxWeighted: 4,
    zone: triggered ? "≥0.5pp" : "<0.5pp",
    source,
    available: true,
  };
}

export function monthsBetween(earlier: string, later: string): number {
  const start = earlier.slice(0, 7).split("-").map(Number);
  const end = later.slice(0, 7).split("-").map(Number);
  if (start.length < 2 || end.length < 2 || start.some(n => !Number.isFinite(n)) || end.some(n => !Number.isFinite(n))) return NaN;
  return (end[0] - start[0]) * 12 + (end[1] - start[1]);
}

export function isStale(lastDate: string, today: string, maxMonths = STALE_MONTHS): boolean {
  const age = monthsBetween(lastDate, today);
  return !Number.isFinite(age) || age > maxMonths;
}

export function yoyByMonth(points: DatedPoint[]): number {
  if (points.length < 2) return NaN;
  const sorted = [...points].filter(point => Number.isFinite(point.value) && point.date.length >= 7)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if (sorted.length < 2) return NaN;
  const last = sorted[sorted.length - 1];
  const [year, month] = last.date.slice(0, 7).split("-").map(Number);
  const prevKey = `${year - 1}-${String(month).padStart(2, "0")}`;
  let prev: DatedPoint | null = null;
  for (const point of sorted) {
    if (point.date.slice(0, 7) === prevKey) prev = point;
  }
  if (!prev || prev.value === 0) return NaN;
  return ((last.value - prev.value) / prev.value) * 100;
}

export function levelAndDelta(points: DatedPoint[]): { level: number; delta: number | null; asOf: string } | null {
  const sorted = [...points].filter(point => Number.isFinite(point.value) && point.date.length >= 7)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if (sorted.length === 0) return null;
  const last = sorted[sorted.length - 1];
  const [year, month] = last.date.slice(0, 7).split("-").map(Number);
  const prevKey = `${year - 1}-${String(month).padStart(2, "0")}`;
  let prev: DatedPoint | null = null;
  for (const point of sorted) {
    if (point.date.slice(0, 7) === prevKey) prev = point;
  }
  return {
    level: last.value,
    delta: prev ? last.value - prev.value : null,
    asOf: last.date.slice(0, 10),
  };
}

/** Eurostat statistics API JSON. Time is the last dimension. An empty geo returns no points. */
export function parseEurostatSeries(payload: unknown): DatedPoint[] {
  if (!payload || typeof payload !== "object") return [];
  const data = payload as {
    value?: Record<string, number>;
    dimension?: { time?: { category?: { index?: Record<string, number> } } };
  };
  const timeIndex = data.dimension?.time?.category?.index;
  const values = data.value;
  if (!timeIndex || !values) return [];
  const times = Object.entries(timeIndex).sort((a, b) => a[1] - b[1]).map(([period]) => period);
  const points: DatedPoint[] = [];
  for (const [key, value] of Object.entries(values)) {
    const index = Number(key);
    const period = times[index];
    if (!period || typeof value !== "number" || !Number.isFinite(value)) continue;
    points.push({ date: period.length === 7 ? `${period}-01` : period, value });
  }
  return points.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

export function alignSpread(longRates: DatedPoint[], shortRates: DatedPoint[]): DatedPoint[] {
  const shorts = new Map<string, number>();
  for (const point of shortRates) {
    if (Number.isFinite(point.value)) shorts.set(point.date.slice(0, 7), point.value);
  }
  return longRates
    .filter(point => Number.isFinite(point.value) && shorts.has(point.date.slice(0, 7)))
    .map(point => ({
      date: point.date,
      value: point.value - (shorts.get(point.date.slice(0, 7)) as number),
    }))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}

/** Share of unscored slots above which the region view shows a thin-data hint instead of pretending full coverage. */
export const REGION_SPARSE_SHARE = 0.5;

export interface RegionGaugeView {
  id: RegionId;
  label: string;
  recessionProbability: number | null;
  correctionProbability: number | null;
  scoredSlots: number;
  totalSlots: number;
  sparse: boolean;
  topDrivers: RegionSlot[];
  note?: string;
}

/**
 * Display view for the Section-1 region buttons (Offen_FUTURE_SOLL_IST PR 6).
 * Reads the catalog P the server already computed. No new score, no blend, no US action change.
 */
export function regionGaugeView(catalogs: RegionalCatalogs | null | undefined, id: RegionId): RegionGaugeView | null {
  const region = catalogs?.regions.find(r => r.id === id);
  if (!region) return null;
  const scored = region.slots.filter(slot => slot.available);
  const totalSlots = region.slots.length;
  const topDrivers = [...scored]
    .filter(slot => slot.weightedScore !== 0)
    .sort((a, b) => Math.abs(b.weightedScore) - Math.abs(a.weightedScore))
    .slice(0, 3);
  return {
    id: region.id,
    label: region.label,
    recessionProbability: region.recessionProbability,
    correctionProbability: region.correctionProbability,
    scoredSlots: scored.length,
    totalSlots,
    sparse: totalSlots === 0 || (totalSlots - scored.length) / totalSlots > REGION_SPARSE_SHARE,
    topDrivers,
    note: region.note,
  };
}

/** Annualized 20-session realized vol in percent. A flat price is 0, which is a print, not a missing value. */
export function realizedVol20(closes: { date: string; close: number }[]): DatedPoint[] {
  const sorted = closes
    .filter(bar => bar.date && Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const out: DatedPoint[] = [];
  for (let i = ASHR_REALIZED_SESSIONS; i < sorted.length; i++) {
    const rets: number[] = [];
    for (let j = i - (ASHR_REALIZED_SESSIONS - 1); j <= i; j++) {
      const left = sorted[j - 1]?.close;
      const right = sorted[j]?.close;
      if (!(left > 0) || !(right > 0)) continue;
      rets.push(Math.log(right / left));
    }
    if (rets.length < ASHR_REALIZED_MIN_RETURNS) continue;
    const mean = rets.reduce((sum, value) => sum + value, 0) / rets.length;
    const variance = rets.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (rets.length - 1);
    const annualized = Math.sqrt(Math.max(0, variance) * ASHR_ANN_SESSIONS) * 100;
    if (Number.isFinite(annualized)) out.push({ date: sorted[i].date, value: annualized });
  }
  return out;
}

/** Last print of each calendar month, in date order. */
export function monthEndSeries(points: DatedPoint[]): DatedPoint[] {
  const byMonth = new Map<string, DatedPoint>();
  const sorted = [...points]
    .filter(point => point.date.length >= 7 && Number.isFinite(point.value))
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  for (const point of sorted) byMonth.set(point.date.slice(0, 7), point);
  return Array.from(byMonth.values());
}
