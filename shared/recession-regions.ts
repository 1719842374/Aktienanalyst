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

export type RegionSubgroupKey = "rez3m" | "rez6m" | "rez12m" | "korr3_6m" | "korr12m";

export interface RegionSubgroup {
  key: RegionSubgroupKey;
  label: string;
  horizon: string;
  /** null = n/a. Never filled from another region or a default. */
  probability: number | null;
  net: number;
  max: number;
  scoredNames: string[];
  /** Why the gauge is n/a, or what differs from the US subgroup. */
  note: string | null;
}

/**
 * F1-52: the five US subgroup cuts applied to a region catalog's slots.
 * Display only. Same 50 + net/max × 50 rule as catalogProbability. N/A slots add neither net nor max.
 * Rez 12M and Korr 12M equal the catalog P the server already computes; the aggregate is untouched.
 */
const SUBGROUP_SPEC: Array<{ key: RegionSubgroupKey; label: string; horizon: string; ids: RegionSlotId[]; book: RegionBook; diff: string | null }> = [
  { key: "rez3m", label: "Rezession Coincident", horizon: "3M", ids: ["labor", "curve", "activity"], book: "recession", diff: null },
  { key: "rez6m", label: "Rezession Leading", horizon: "6M", ids: ["labor", "curve", "activity", "money", "spreads"], book: "recession", diff: null },
  { key: "rez12m", label: "Rezession Vollständig", horizon: "12M", ids: ["labor", "curve", "activity", "money", "spreads"], book: "recession", diff: "ohne Konsumklima und NY-Fed-Anker (kein Regional-Slot) = Katalog-P" },
  { key: "korr3_6m", label: "Korrektur Sentiment", horizon: "3-6M", ids: ["vol"], book: "correction", diff: null },
  { key: "korr12m", label: "Korrektur Vollständig", horizon: "12M", ids: ["vol", "valuation"], book: "correction", diff: "= Katalog-P" },
];

export function regionSubgroups(slots: RegionSlot[]): RegionSubgroup[] {
  return SUBGROUP_SPEC.map(spec => {
    const members = slots.filter(slot => slot.book === spec.book && spec.ids.includes(slot.id));
    const scored = members.filter(slot => slot.available);
    const net = scored.reduce((sum, slot) => sum + slot.weightedScore, 0);
    const max = scored.reduce((sum, slot) => sum + slot.maxWeighted, 0);
    const probability = scored.length === 0 ? null : bookProbability(net, max);
    let note = spec.diff;
    if (probability == null) {
      const missing = members.map(slot => slot.source.startsWith(slot.name) ? slot.source : `${slot.name} (${slot.source})`);
      note = missing.length
        ? `n/a: keine Daten für ${missing.join(", ")}`
        : "n/a: kein Slot dieser Gruppe im Regional-Katalog";
    }
    return { key: spec.key, label: spec.label, horizon: spec.horizon, probability, net, max, scoredNames: scored.map(slot => slot.name), note };
  });
}

export interface RegionGaugeView {
  id: RegionId;
  label: string;
  recessionProbability: number | null;
  correctionProbability: number | null;
  scoredSlots: number;
  totalSlots: number;
  sparse: boolean;
  topDrivers: RegionSlot[];
  subgroups: RegionSubgroup[];
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
    subgroups: regionSubgroups(region.slots),
  };
}
