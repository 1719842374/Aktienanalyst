/**
 * WORK_RECESSION_EARNINGS_GROWTH_PLOT und WORK_RECESSION_GROWTH_GAP.
 * Reine Rechnung für #/recession. Kein Netz, kein Score.
 *
 * Growth Gap = g_fwd − g_realized. Implied Gap = g* − g_realized.
 * Realistisches Wachstum = Median der YoY-Drucke im 10-Jahres-Fenster.
 * Kegel = dieser Median ± coneSigma · Stichproben-Streuung.
 * Fehlende Größen bleiben available:false mit Grund, nie 0 und nie interpoliert.
 */
import { asOfJoin } from "./recession-ta";

export const GROWTH_INDEXES = ["SPY", "VGK", "ASHR"] as const;
export type GrowthIndex = (typeof GROWTH_INDEXES)[number];

export const GROWTH_RANGES = ["5Y", "10Y", "Max"] as const;
export type GrowthRange = (typeof GROWTH_RANGES)[number];

export type GrowthFrequency = "quarterly" | "annual";

/**
 * Benannte Parameter. Herkunft: die beiden WORK-Specs (26.10.2026) und dieselbe
 * Stichproben-Std wie die Lager/Nachfrage-Lücke. Keine Bewertungsschwelle in Prozentpunkten.
 */
export const GROWTH_GAP_PARAMS = {
  /** Spec Growth Gap §4: Trendszenario = Median der letzten 10 Jahre. */
  medianWindowYears: 10,
  /** Spec §4: Extremszenarien ±2σ. Dieselbe Spanne ist die Warnschwelle für |Gap| / σ. */
  coneSigma: 2,
  /** |z| darunter: Spec „Nahe 0“ (Erwartung und Realität im Takt). Eine σ, nicht ein fester Pp-Wert. */
  nearZeroSigma: 1,
  /** Stichproben-Std (n−1). */
  sampleDof: 1,
  minStd: 1e-12,
  /** Mindestzahl Drucke im 10J-Fenster, sonst Median, σ und Gap-z n/a. */
  minPrints: 8,
  /** Quartalsdruck nur so lange halten, danach Lücke. Liegt unter zwei Quartalen, damit ein fehlendes Quartal nicht fortgeschrieben wird. */
  quarterMaxAgeDays: 120,
  /** Jahresdruck nur so lange halten. Liegt unter zwei Jahren, damit ein fehlendes Jahr nicht als YoY gestreckt wird. */
  annualMaxAgeDays: 400,
  /** Zwei Jahresabschlüsse sind nur dann ein YoY-Paar, wenn der Abstand in diesem Band liegt. */
  annualStepMinDays: 300,
  annualStepMaxDays: 450,
  /** VIX-z braucht mindestens ein Handelsjahr im Fenster. */
  minVixPrints: 252,
  /** Spec Earnings-Plot: Cache 6 h. */
  cacheTtlMs: 6 * 60 * 60 * 1000,
  percentScale: 100,
  /** Chartfenster der Earnings-Spec: 5Y / 10Y / Max. */
  ranges: GROWTH_RANGES,
} as const;

export const GSTAR_NA_REASON =
  "n/a — g* = WACC − FCF/EV braucht Index-FCF, EV und eine datengetriebene WACC. Keine gesetzte WACC. Top-Holdings-Aggregation ist eine kostenpflichtige Mehrfachabfrage (braucht Philip)";

export const LLM_NA_REASON =
  "n/a — LLM-Flag braucht OpenRouter (kostenpflichtig, braucht Philip)";

export const GROWTH_BOOKS: Record<GrowthIndex, { index: GrowthIndex; label: string; etf: string; fmpSymbols: readonly string[] }> = {
  SPY: { index: "SPY", label: "USA", etf: "SPY", fmpSymbols: ["SPY", "^GSPC"] },
  VGK: { index: "VGK", label: "Europa", etf: "VGK", fmpSymbols: ["VGK", "FEZ"] },
  ASHR: { index: "ASHR", label: "Asien", etf: "ASHR", fmpSymbols: ["ASHR"] },
};

export function parseGrowthIndex(raw: unknown): GrowthIndex | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "SPY" || s === "VGK" || s === "ASHR") return s;
  return null;
}

export function maxAgeForFrequency(frequency: GrowthFrequency): number {
  switch (frequency) {
    case "quarterly":
      return GROWTH_GAP_PARAMS.quarterMaxAgeDays;
    case "annual":
      return GROWTH_GAP_PARAMS.annualMaxAgeDays;
    default: {
      const neverFreq: never = frequency;
      return neverFreq;
    }
  }
}

export interface GrowthPrint {
  date: string;
  /** YoY in Prozent, nicht als Dezimalbruch. */
  yoyPct: number;
}

export interface PricePoint {
  date: string;
  close: number;
}

export type NaReading = { available: false; reason: string };

export type ForwardReading =
  | { available: true; gFwdPct: number; epsConsensus: number; epsTtm: number; asOf: string; source: string }
  | NaReading;

export type GStarReading =
  | { available: true; gStarPct: number; asOf: string; source: string }
  | NaReading;

export type GapDirection = "positiv" | "negativ" | "nahe_null";

export type GapReading =
  | { available: true; gapPp: number; z: number; warn: boolean; direction: GapDirection }
  | NaReading;

export type RealizedStats =
  | {
      available: true;
      asOf: string;
      realizedPct: number;
      median10y: number;
      mean10y: number;
      std10y: number;
      z: number;
      percentile: number;
      prints: number;
      windowStart: string;
      coneLow: number;
      coneHigh: number;
      distanceToMedianPp: number;
    }
  | NaReading;

export type VixShockReading =
  | { available: true; asOf: string; latest: number; z: number; percentile: number; shock: boolean; prints: number; source: string }
  | NaReading;

export interface GrowthChartPoint {
  date: string;
  close: number;
  /** null = Lücke, letzter Druck ist älter als die Haltefrist. Kein Zwischenwert. */
  yoyPct: number | null;
}

export interface RecessionGrowthBody {
  index: GrowthIndex | null;
  label: string;
  etf: string | null;
  priceSource: string | null;
  priceError: string | null;
  realizedSource: string;
  realizedError: string | null;
  realizedFrequency: GrowthFrequency | null;
  realized: GrowthPrint[];
  chart: GrowthChartPoint[];
  stats: RealizedStats;
  forward: ForwardReading;
  gStar: GStarReading;
  growthGap: GapReading;
  impliedGap: GapReading;
  vix: VixShockReading;
  llm: NaReading;
  sources: string[];
}

const MONTH_ABBR: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** Gleiche Datumslesart wie englishLongDate in server/recession.ts. Die Score-Datei bleibt unangetastet. */
function englishLongDate(text: string): string | null {
  const match = text.trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!match) return null;
  const month = MONTH_ABBR[match[1]];
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) return null;
  return `${match[3]}-${month}-${String(day).padStart(2, "0")}`;
}

function htmlCell(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Multpl-Tabelle „S&P 500 Earnings Growth Rate“ (current dollars, schon in Prozent). */
export function multplGrowthPrints(html: string): GrowthPrint[] {
  if (!html) return [];
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const byDate = new Map<string, GrowthPrint>();
  for (const row of rows) {
    const cells: string[] = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(row))) cells.push(htmlCell(cellMatch[1]));
    if (cells.length < 2) continue;
    const date = englishLongDate(cells[0]);
    const num = Number(cells[1].replace(/%/g, "").replace(/,/g, "").trim());
    if (!date || !Number.isFinite(num)) continue;
    byDate.set(date, { date, yoyPct: num });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function shiftYears(date: string, years: number): string {
  return `${String(Number(date.slice(0, 4)) + years).padStart(4, "0")}${date.slice(4)}`;
}

function daysBetween(later: string, earlier: string): number {
  return (Date.parse(later + "T00:00:00Z") - Date.parse(earlier + "T00:00:00Z")) / 86400000;
}

/**
 * Spec: g = EPS_t / EPS_{t-1} − 1.
 * Paare außerhalb des Jahresabstands entfallen. Negative oder Null-Basis entfällt.
 * Kein Strecken über ein fehlendes Jahr, kein Auffüllen mit 0.
 */
export function yoyFromAnnualEps(levels: { date: string; eps: number }[]): GrowthPrint[] {
  const rows = levels
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.eps))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: GrowthPrint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const days = daysBetween(cur.date, prev.date);
    if (days < GROWTH_GAP_PARAMS.annualStepMinDays || days > GROWTH_GAP_PARAMS.annualStepMaxDays) continue;
    if (!(prev.eps > 0) || !(cur.eps > 0)) continue;
    out.push({ date: cur.date, yoyPct: (cur.eps / prev.eps - 1) * GROWTH_GAP_PARAMS.percentScale });
  }
  return out;
}

export function forwardFromEps(
  consensus: number | null,
  ttm: number | null,
  asOf: string,
  source: string,
): ForwardReading {
  if (consensus == null || !Number.isFinite(consensus)) {
    return { available: false, reason: "n/a — Forward-Konsens: epsAvg fehlt" };
  }
  if (!(consensus > 0)) return { available: false, reason: "n/a — Forward-Konsens: epsAvg ist nicht positiv" };
  if (ttm == null || !Number.isFinite(ttm)) return { available: false, reason: "n/a — TTM-EPS fehlt (ratios-ttm)" };
  if (!(ttm > 0)) return { available: false, reason: "n/a — TTM-EPS ist nicht positiv (keine Division durch 0)" };
  return {
    available: true,
    gFwdPct: (consensus / ttm - 1) * GROWTH_GAP_PARAMS.percentScale,
    epsConsensus: consensus,
    epsTtm: ttm,
    asOf,
    source,
  };
}

/** Nächster Konsens-EPS ab asOf. Vergangene Schätzjahre zählen nicht als Forward. */
export function nextConsensusEps(raw: unknown, asOf: string): { date: string; eps: number } | null {
  if (!Array.isArray(raw)) return null;
  const rows: { date: string; eps: number }[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? "").slice(0, 10);
    const eps = [r.epsAvg, r.estimatedEpsAvg, r.estimatedEpsDiluted, r.estimatedEps]
      .map(v => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN))
      .find(v => Number.isFinite(v) && v > 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || eps == null) continue;
    rows.push({ date, eps });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows.find(r => r.date >= asOf) ?? null;
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function empiricalPercentile(vals: number[], latest: number): number {
  let le = 0;
  for (const v of vals) if (v <= latest) le++;
  return (le / vals.length) * GROWTH_GAP_PARAMS.percentScale;
}

function sampleStd(vals: number[], mean: number): number {
  const dof = vals.length - GROWTH_GAP_PARAMS.sampleDof;
  if (!(dof > 0)) return 0;
  return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / dof);
}

export function realizedStats(prints: GrowthPrint[]): RealizedStats {
  const rows = prints
    .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.yoyPct))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return { available: false, reason: "n/a — kein Gewinnwachstums-Druck" };
  const last = rows[rows.length - 1];
  const windowStart = shiftYears(last.date, -GROWTH_GAP_PARAMS.medianWindowYears);
  const win = rows.filter(p => p.date > windowStart && p.date <= last.date);
  if (win.length < GROWTH_GAP_PARAMS.minPrints) {
    return {
      available: false,
      reason: `n/a — zu wenig Historie (${win.length} Drucke im ${GROWTH_GAP_PARAMS.medianWindowYears}J-Fenster, mindestens ${GROWTH_GAP_PARAMS.minPrints})`,
    };
  }
  const vals = win.map(p => p.yoyPct);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const std = sampleStd(vals, mean);
  if (!(std > GROWTH_GAP_PARAMS.minStd)) {
    return { available: false, reason: "n/a — Streuung im 10J-Fenster ist 0, z-Wert nicht definiert" };
  }
  const med = median(vals);
  return {
    available: true,
    asOf: last.date,
    realizedPct: last.yoyPct,
    median10y: med,
    mean10y: mean,
    std10y: std,
    z: (last.yoyPct - mean) / std,
    percentile: empiricalPercentile(vals, last.yoyPct),
    prints: win.length,
    windowStart,
    coneLow: med - GROWTH_GAP_PARAMS.coneSigma * std,
    coneHigh: med + GROWTH_GAP_PARAMS.coneSigma * std,
    distanceToMedianPp: last.yoyPct - med,
  };
}

export function gapReading(left: number | null, leftMissing: string, realized: RealizedStats): GapReading {
  if (!realized.available) return { available: false, reason: realized.reason };
  if (left == null || !Number.isFinite(left)) return { available: false, reason: leftMissing };
  const gapPp = left - realized.realizedPct;
  const z = gapPp / realized.std10y;
  const absZ = Math.abs(z);
  let direction: GapDirection;
  if (absZ < GROWTH_GAP_PARAMS.nearZeroSigma) direction = "nahe_null";
  else if (gapPp > 0) direction = "positiv";
  else direction = "negativ";
  return { available: true, gapPp, z, warn: absZ >= GROWTH_GAP_PARAMS.coneSigma, direction };
}

export function vixShock(points: { date: string; value: number }[], source: string): VixShockReading {
  const rows = points
    .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return { available: false, reason: "n/a — VIX: keine Drucke" };
  const last = rows[rows.length - 1];
  const windowStart = shiftYears(last.date, -GROWTH_GAP_PARAMS.medianWindowYears);
  const win = rows.filter(p => p.date > windowStart);
  if (win.length < GROWTH_GAP_PARAMS.minVixPrints) {
    return {
      available: false,
      reason: `n/a — VIX: zu wenig Historie (${win.length} Drucke, mindestens ${GROWTH_GAP_PARAMS.minVixPrints})`,
    };
  }
  const vals = win.map(p => p.value);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const std = sampleStd(vals, mean);
  if (!(std > GROWTH_GAP_PARAMS.minStd)) return { available: false, reason: "n/a — VIX: Streuung im Fenster ist 0" };
  const z = (last.value - mean) / std;
  return {
    available: true,
    asOf: last.date,
    latest: last.value,
    z,
    percentile: empiricalPercentile(vals, last.value),
    shock: Math.abs(z) >= GROWTH_GAP_PARAMS.coneSigma,
    prints: win.length,
    source,
  };
}

/** Letzter Handelstag je Monat. Ein echter Schluss, kein Monatsmittel. */
export function monthEndCloses(bars: { date: string; close: number }[]): PricePoint[] {
  const byMonth = new Map<string, PricePoint>();
  for (const bar of bars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || !Number.isFinite(bar.close) || !(bar.close > 0)) continue;
    const key = bar.date.slice(0, 7);
    const prev = byMonth.get(key);
    if (!prev || prev.date < bar.date) byMonth.set(key, { date: bar.date, close: bar.close });
  }
  return Array.from(byMonth.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * YoY auf die Kursmonate legen: letzter Druck, der nicht älter als maxAgeDays ist.
 * Älter → null. Kein Mittel zwischen zwei Drucken.
 */
export function growthChartPoints(price: PricePoint[], realized: GrowthPrint[], maxAgeDays: number): GrowthChartPoint[] {
  const months = monthEndCloses(price);
  const prints = realized
    .filter(p => Number.isFinite(p.yoyPct))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(p => ({ date: p.date, value: p.yoyPct }));
  const yoy = asOfJoin(months.map(p => p.date), prints, maxAgeDays);
  return months.map((p, i) => ({ date: p.date, close: p.close, yoyPct: yoy[i] }));
}

export function sliceGrowthChart(points: GrowthChartPoint[], range: GrowthRange, asOf: string): GrowthChartPoint[] {
  switch (range) {
    case "Max":
      return points;
    case "5Y":
      return points.filter(p => p.date >= shiftYears(asOf, -5));
    case "10Y":
      return points.filter(p => p.date >= shiftYears(asOf, -10));
    default: {
      const neverRange: never = range;
      return neverRange;
    }
  }
}

export interface GrowthBuildInput {
  index: GrowthIndex;
  price: PricePoint[];
  priceSource: string | null;
  priceError: string | null;
  realized: GrowthPrint[];
  realizedSource: string;
  realizedError: string | null;
  realizedFrequency: GrowthFrequency | null;
  forward: ForwardReading;
  vixPoints: { date: string; value: number }[];
  vixSource: string;
  vixError: string | null;
}

export function buildGrowthBody(input: GrowthBuildInput): RecessionGrowthBody {
  const book = GROWTH_BOOKS[input.index];
  const stats = realizedStats(input.realized);
  const gStar: GStarReading = { available: false, reason: GSTAR_NA_REASON };
  const growthGap = input.forward.available
    ? gapReading(input.forward.gFwdPct, "", stats)
    : gapReading(null, input.forward.reason, stats);
  const impliedGap = gapReading(null, GSTAR_NA_REASON, stats);
  const vix = input.vixPoints.length
    ? vixShock(input.vixPoints, input.vixSource)
    : { available: false as const, reason: input.vixError ?? "n/a — VIX: keine Drucke" };
  const chart = input.realizedFrequency
    ? growthChartPoints(input.price, input.realized, maxAgeForFrequency(input.realizedFrequency))
    : monthEndCloses(input.price).map(p => ({ date: p.date, close: p.close, yoyPct: null }));
  const sources = [input.priceSource, input.realizedSource, input.forward.available ? input.forward.source : null, vix.available ? vix.source : null]
    .filter((s): s is string => !!s);
  return {
    index: input.index,
    label: book.label,
    etf: book.etf,
    priceSource: input.priceSource,
    priceError: input.priceError,
    realizedSource: input.realizedSource,
    realizedError: input.realizedError,
    realizedFrequency: input.realizedFrequency,
    realized: input.realized,
    chart,
    stats,
    forward: input.forward,
    gStar,
    growthGap,
    impliedGap,
    vix,
    llm: { available: false, reason: LLM_NA_REASON },
    sources,
  };
}

export function emptyGrowthBody(reason: string): RecessionGrowthBody {
  const na = { available: false as const, reason };
  return {
    index: null,
    label: "",
    etf: null,
    priceSource: null,
    priceError: reason,
    realizedSource: "",
    realizedError: reason,
    realizedFrequency: null,
    realized: [],
    chart: [],
    stats: na,
    forward: na,
    gStar: { available: false, reason: GSTAR_NA_REASON },
    growthGap: na,
    impliedGap: { available: false, reason: GSTAR_NA_REASON },
    vix: na,
    llm: { available: false, reason: LLM_NA_REASON },
    sources: [],
  };
}
