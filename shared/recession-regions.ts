/**
 * Eurozone and Japan catalogs from Offen_WORK_RECESSION_SOURCES.md.
 * Same two books. A missing print stays out of the net and the max.
 * The 0.70 / 0.20 / 0.10 blend is not the US action input.
 */

export const REGION_WEIGHT = { US: 0.7, EZ: 0.2, JP: 0.1 } as const;
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
  /** Five horizons. The US entry is the live books, copied, not recomputed. */
  subgroups?: RegionSubgroup[];
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

/** Center, span, clamp and step of the existing book formula. Named so the regional horizons do not grow a second copy of the numbers. */
export const BOOK_CENTER_PCT = 50;
export const BOOK_SPAN_PCT = 50;
export const BOOK_FLOOR_PCT = 5;
export const BOOK_CAP_PCT = 95;
export const BOOK_STEP_PCT = 5;
/** Same one-decimal net the US subgroup books already print. */
export const REGION_NET_DECIMALS = 1;

export function bookProbability(net: number, max: number): number | null {
  if (!(max > 0) || !Number.isFinite(net)) return null;
  const raw = BOOK_CENTER_PCT + (net / max) * BOOK_SPAN_PCT;
  const clamped = Math.max(BOOK_FLOOR_PCT, Math.min(BOOK_CAP_PCT, raw));
  return Math.round(clamped / BOOK_STEP_PCT) * BOOK_STEP_PCT;
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
  };
}

/** Coincident book: labor, curve, activity. Same three roles as the US 3M book. */
export const REGION_COINCIDENT_IDS: readonly RegionSlotId[] = ["labor", "curve", "activity"];
/** Added at 6M. Durable goods has no regional series and stays a named gap. */
export const REGION_LEADING_IDS: readonly RegionSlotId[] = ["money", "spreads"];
/** Correction 3–6M. One volatility slot; the US crowd leg is a named gap. */
export const REGION_SENTIMENT_IDS: readonly RegionSlotId[] = ["vol"];
/** Added at correction 12M. */
export const REGION_VALUATION_IDS: readonly RegionSlotId[] = ["valuation"];

/** Series the US books use and a region catalog does not carry. Shown as n/a, never scored. */
export const REGION_SERIES_GAPS = {
  durable: { name: "Durable Goods", reason: "keine regionale Serie; US-Serie DGORDER wird nicht kopiert" },
  confidence: { name: "Konsumklima", reason: "keine regionale Konsumklima-Serie" },
  crowd: { name: "Crowd (CNN / Krypto)", reason: "keine regionale Crowd-Serie" },
  trends: { name: "Google Trends", reason: "keine regionale Trends-Serie; der US-Cache wird nicht übernommen" },
} as const;

export interface RegionMissing {
  name: string;
  reason: string;
}

export interface RegionSubgroup {
  name: "recession_coincident" | "recession_leading" | "recession_full" | "correction_sentiment" | "correction_full";
  label: string;
  horizon: string;
  indicators: string[];
  netScore: number;
  maxScore: number;
  /** Null when nothing was scored. Not 0 and not the neutral 50. */
  probability: number | null;
  formula: string;
  missing: RegionMissing[];
  nyFedAnchor?: number;
  finalProbability?: number;
}

/** The five US books already computed in server/recession.ts. Copied onto the US catalog. */
export interface LiveRegionSubgroup {
  name: string;
  label: string;
  horizon: string;
  indicators: string[];
  netScore: number;
  maxScore: number;
  probability: number;
  formula: string;
  nyFedAnchor?: number;
  finalProbability?: number;
}

export interface RegionScoreRow {
  key: string;
  name: string;
  detail: string;
  valueText: string;
  zone: string;
  rawText: string;
  weightText: string;
  weightedText: string;
  maxText: string;
  /** Null when the row is not scored. The heatmap must not paint that as 0. */
  heatScore: number | null;
  book: RegionBook;
}

function roundNet(value: number): number {
  const factor = 10 ** REGION_NET_DECIMALS;
  return Math.round(value * factor) / factor;
}

export function subgroupFormula(net: number, max: number, rounded: number): string {
  const raw = BOOK_CENTER_PCT + (net / max) * BOOK_SPAN_PCT;
  return `${BOOK_CENTER_PCT}% + (${net.toFixed(REGION_NET_DECIMALS)}/${max.toFixed(REGION_NET_DECIMALS)}) × ${BOOK_SPAN_PCT}% = ${raw.toFixed(REGION_NET_DECIMALS)}% → ${rounded}%`;
}

/** Why a closed slot is out of the net. A real print stays in the reason; it is not turned into a score. */
export function slotNaReason(slot: RegionSlot): string {
  const source = slot.source?.trim() || "Quelle lieferte keinen Druck";
  const zone = slot.zone && slot.zone !== "N/A" && slot.zone !== "n/a" ? slot.zone : "";
  const base = zone && !source.includes(zone) ? `${source} (${zone})` : source;
  const raw = slot.value?.trim() ?? "";
  const hasPrint = raw.length > 0 && !/^n\/a$/i.test(raw);
  return hasPrint ? `${base} (Ablesung ${raw})` : base;
}

function pickSlots(slots: RegionSlot[], ids: readonly RegionSlotId[]): RegionSlot[] {
  return slots.filter(slot => ids.includes(slot.id));
}

function subgroupFrom(
  slots: RegionSlot[],
  extraMissing: RegionMissing[],
  meta: Pick<RegionSubgroup, "name" | "label" | "horizon">,
): RegionSubgroup {
  const scored = slots.filter(slot => slot.available);
  const net = scored.reduce((sum, slot) => sum + slot.weightedScore, 0);
  const max = scored.reduce((sum, slot) => sum + slot.maxWeighted, 0);
  const netScore = roundNet(net);
  const maxScore = roundNet(max);
  const probability = bookProbability(net, max);
  const missing = [
    ...slots.filter(slot => !slot.available).map(slot => ({ name: slot.name, reason: slotNaReason(slot) })),
    ...extraMissing,
  ];
  return {
    ...meta,
    indicators: scored.map(slot => slot.name),
    netScore,
    maxScore,
    probability,
    formula: probability == null ? "keine gewerteten Indikatoren → n/a" : subgroupFormula(net, max, probability),
    missing,
  };
}

/** Five horizons from the slots a region actually has. Closed slots add neither net nor max. */
export function buildRegionSubgroups(slots: RegionSlot[]): RegionSubgroup[] {
  const coincident = pickSlots(slots, REGION_COINCIDENT_IDS);
  const leading = [...coincident, ...pickSlots(slots, REGION_LEADING_IDS)];
  const sentiment = pickSlots(slots, REGION_SENTIMENT_IDS);
  const correction = [...sentiment, ...pickSlots(slots, REGION_VALUATION_IDS)];
  return [
    subgroupFrom(coincident, [], { name: "recession_coincident", label: "Rezession Coincident", horizon: "3M" }),
    subgroupFrom(leading, [REGION_SERIES_GAPS.durable], { name: "recession_leading", label: "Rezession Leading", horizon: "6M" }),
    subgroupFrom(leading, [REGION_SERIES_GAPS.durable, REGION_SERIES_GAPS.confidence], { name: "recession_full", label: "Rezession Vollständig", horizon: "12M" }),
    subgroupFrom(sentiment, [REGION_SERIES_GAPS.crowd], { name: "correction_sentiment", label: "Korrektur Sentiment", horizon: "3-6M" }),
    subgroupFrom(correction, [REGION_SERIES_GAPS.crowd, REGION_SERIES_GAPS.trends], { name: "correction_full", label: "Korrektur Vollständig", horizon: "12M" }),
  ];
}

/** Copy of the live US books. No second formula, so the five probabilities stay byte-identical. */
export function attachLiveSubgroups(live: LiveRegionSubgroup[]): RegionSubgroup[] {
  return live.map(item => ({
    name: item.name as RegionSubgroup["name"],
    label: item.label,
    horizon: item.horizon,
    indicators: [...item.indicators],
    netScore: item.netScore,
    maxScore: item.maxScore,
    probability: item.probability,
    formula: item.formula,
    missing: [],
    ...(item.nyFedAnchor != null ? { nyFedAnchor: item.nyFedAnchor } : {}),
    ...(item.finalProbability != null ? { finalProbability: item.finalProbability } : {}),
  }));
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`;
}

function gapRow(key: string, name: string, reason: string, book: RegionBook): RegionScoreRow {
  return {
    key,
    name,
    detail: reason,
    valueText: `n/a — ${reason}`,
    zone: "n/a",
    rawText: "n/a",
    weightText: "n/a",
    weightedText: "n/a",
    maxText: "n/a",
    heatScore: null,
    book,
  };
}

function rowFromSlot(slot: RegionSlot): RegionScoreRow {
  if (!slot.available) {
    const reason = slotNaReason(slot);
    return {
      key: `slot-${slot.id}-${slot.name}`,
      name: slot.name,
      detail: slot.source,
      valueText: `n/a — ${reason}`,
      zone: "n/a",
      rawText: "n/a",
      weightText: "n/a",
      weightedText: "n/a",
      maxText: "n/a",
      heatScore: null,
      book: slot.book,
    };
  }
  return {
    key: `slot-${slot.id}-${slot.name}`,
    name: slot.name,
    detail: slot.source,
    valueText: slot.value,
    zone: slot.zone,
    rawText: signed(slot.rawScore),
    weightText: `×${slot.weight}`,
    weightedText: signed(slot.weightedScore),
    maxText: String(slot.maxWeighted),
    heatScore: slot.weightedScore,
    book: slot.book,
  };
}

/** Scoring table and heatmap for one region. Missing rows are n/a with a reason, never a zero score. */
export function regionScoreRows(slots: RegionSlot[]): RegionScoreRow[] {
  return [
    ...pickSlots(slots, REGION_COINCIDENT_IDS).map(rowFromSlot),
    ...pickSlots(slots, REGION_LEADING_IDS).map(rowFromSlot),
    gapRow("gap-durable", REGION_SERIES_GAPS.durable.name, REGION_SERIES_GAPS.durable.reason, "recession"),
    gapRow("gap-confidence", REGION_SERIES_GAPS.confidence.name, REGION_SERIES_GAPS.confidence.reason, "recession"),
    ...pickSlots(slots, REGION_SENTIMENT_IDS).map(rowFromSlot),
    gapRow("gap-crowd", REGION_SERIES_GAPS.crowd.name, REGION_SERIES_GAPS.crowd.reason, "correction"),
    ...pickSlots(slots, REGION_VALUATION_IDS).map(rowFromSlot),
    gapRow("gap-trends", REGION_SERIES_GAPS.trends.name, REGION_SERIES_GAPS.trends.reason, "correction"),
  ];
}
