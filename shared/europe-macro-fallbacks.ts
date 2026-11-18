/**
 * F9-14 — Europa-Ersatzdaten für die drei Reihen, die Future_9 Z.122 als schwächer nennt:
 * Surprise-Rate, Equal-Weight, CAPEX.
 * Ersatz bleibt als Ersatz beschriftet. Fehlende oder kostenpflichtige Reihen: n/a mit Grund.
 * Kein Score.
 */
import { distributionOverWindow, type DistributionReading } from "./adaptive-window";

export const EUROPE_MACRO_PARAMS = {
  windowYears: 15,
  /** 10 Jahre Handelstage, darunter bleibt die Verteilung n/a. */
  minSpreadSessions: 252 * 10,
  /** 10 Jahre Quartale, darunter bleibt die GFCF-Verteilung n/a. */
  minGfcfQuarters: 40,
  /**
   * Prior. Future_9 nennt die Differenz der RSL, aber keine Fensterlänge.
   * Ein Handelsjahr. Keine Schätzung aus einer Trefferquote.
   */
  rslLookbackSessions: 252,
  percentScale: 100,
} as const;

export const EUROPE_RSL_PRIOR =
  "Prior, nicht aus einer Trefferquote: RSL = Schlusskurs / Median der letzten 252 Handelstage. Future_9 nennt Cap-Weight-RSL minus Equal-Weight-RSL, aber keine Fensterlänge.";

/** Cap-Weight, dieselbe Linie wie das STOXX-600-KGV (iShares EXSA). */
export const EUROPE_CAP_WEIGHT = { symbol: "EXSA.DE", label: "iShares STOXX Europe 600" } as const;

/**
 * Equal-Weight an der Xetra. Seit dem Indexwechsel ESG-gefiltert.
 * Dieselbe ISIN wie der Vorgänger ohne ESG-Filter. Kein anderer ETF als stiller Ersatz.
 */
export const EUROPE_EQUAL_WEIGHT = { symbol: "OSX6.DE", label: "Ossiam STOXX Europe 600 ESG Equal Weight" } as const;

export const EUROSTAT_GFCF = {
  dataset: "namq_10_gdp",
  freq: "Q",
  unit: "CLV_I10",
  sAdj: "SCA",
  item: "P51G",
  geo: "EA20",
} as const;

export const EUROPE_SURPRISE_REASON =
  "n/a — Euro-Surprise-Rate: Citi Economic Surprise und ein FactSet-Aggregat sind kostenpflichtig und nicht angebunden. braucht Philip";

export const EUROPE_CAPEX_NOTE =
  "Bruttoanlageinvestitionen der Eurozone (P51G, Index 2010=100). Das ist nicht die CAPEX der US-Hyperscaler.";

export interface PricePoint {
  date: string;
  value: number;
}

export interface EuropeSurpriseSlot {
  id: "surprise";
  usSignal: "Überraschungsquote";
  substitute: null;
  needsPhilip: true;
  reason: string;
}

export type LevelReading =
  | { available: true; date: string; capRsl: number; equalRsl: number; spread: number }
  | { available: false; reason: string };

export interface EuropeEqualWeightSlot {
  id: "equalWeight";
  usSignal: "Cap-Weight-RSL minus Equal-Weight-RSL";
  substitute: string;
  needsPhilip: false;
  capSymbol: typeof EUROPE_CAP_WEIGHT.symbol;
  equalSymbol: typeof EUROPE_EQUAL_WEIGHT.symbol;
  prior: string;
  spread: LevelReading;
  distribution: DistributionReading;
}

export type GfcfYoy =
  | { available: true; quarter: string; yoyPct: number; level: number; yearAgo: number }
  | { available: false; reason: string };

export interface EuropeCapexSlot {
  id: "capex";
  usSignal: "CAPEX der Hyperscaler, YoY";
  substitute: string;
  needsPhilip: false;
  source: string;
  note: string;
  yoy: GfcfYoy;
  distribution: DistributionReading;
}

export type EuropeFallbackSlot = EuropeSurpriseSlot | EuropeEqualWeightSlot | EuropeCapexSlot;

export interface EuropeMacroFallbacks {
  slots: [EuropeSurpriseSlot, EuropeEqualWeightSlot, EuropeCapexSlot];
}

export interface GfcfLevel {
  quarter: string;
  value: number;
}

export function eurostatGfcfUrl(startPeriod: string): string {
  const spec = EUROSTAT_GFCF;
  return `https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/${spec.dataset}/${spec.freq}.${spec.unit}.${spec.sAdj}.${spec.item}.${spec.geo}?format=SDMX-CSV&startPeriod=${startPeriod}`;
}

export function surpriseSlot(): EuropeSurpriseSlot {
  return {
    id: "surprise",
    usSignal: "Überraschungsquote",
    substitute: null,
    needsPhilip: true,
    reason: EUROPE_SURPRISE_REASON,
  };
}

function cleanPrices(points: PricePoint[]): PricePoint[] {
  return points
    .filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.value) && point.value > 0)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** RSL nur, wenn das volle Fenster da ist. Ein kürzeres Fenster wird nicht eingesetzt. */
export function rslSeries(points: PricePoint[], lookback = EUROPE_MACRO_PARAMS.rslLookbackSessions): Map<string, number> {
  const clean = cleanPrices(points);
  const out = new Map<string, number>();
  if (clean.length < lookback) return out;
  for (let index = lookback - 1; index < clean.length; index += 1) {
    const window = clean.slice(index - lookback + 1, index + 1).map(point => point.value);
    const center = median(window);
    if (!(center > 0)) continue;
    out.set(clean[index].date, clean[index].value / center);
  }
  return out;
}

export function computeEqualWeightSpread(cap: PricePoint[], equal: PricePoint[]): EuropeEqualWeightSlot {
  const substitute = `${EUROPE_CAP_WEIGHT.symbol} minus ${EUROPE_EQUAL_WEIGHT.symbol}`;
  const base = {
    id: "equalWeight" as const,
    usSignal: "Cap-Weight-RSL minus Equal-Weight-RSL" as const,
    substitute,
    needsPhilip: false as const,
    capSymbol: EUROPE_CAP_WEIGHT.symbol,
    equalSymbol: EUROPE_EQUAL_WEIGHT.symbol,
    prior: EUROPE_RSL_PRIOR,
  };
  const capRsl = rslSeries(cap);
  const equalRsl = rslSeries(equal);
  if (capRsl.size === 0) {
    const reason = `n/a — ${EUROPE_CAP_WEIGHT.symbol}: zu wenig Handelstage für den RSL (${EUROPE_MACRO_PARAMS.rslLookbackSessions})`;
    return { ...base, spread: { available: false, reason }, distribution: { available: false, reason } };
  }
  if (equalRsl.size === 0) {
    const reason = `n/a — ${EUROPE_EQUAL_WEIGHT.symbol}: zu wenig Handelstage für den RSL (${EUROPE_MACRO_PARAMS.rslLookbackSessions})`;
    return { ...base, spread: { available: false, reason }, distribution: { available: false, reason } };
  }
  const spreads: { key: string; value: number; capRsl: number; equalRsl: number }[] = [];
  for (const [date, capValue] of Array.from(capRsl.entries())) {
    const equalValue = equalRsl.get(date);
    if (equalValue == null) continue;
    spreads.push({ key: date, value: capValue - equalValue, capRsl: capValue, equalRsl: equalValue });
  }
  if (spreads.length === 0) {
    const reason = "n/a — EXSA.DE und OSX6.DE haben keinen gemeinsamen Handelstag mit vollem RSL";
    return { ...base, spread: { available: false, reason }, distribution: { available: false, reason } };
  }
  const latest = spreads[spreads.length - 1];
  return {
    ...base,
    spread: {
      available: true,
      date: latest.key,
      capRsl: latest.capRsl,
      equalRsl: latest.equalRsl,
      spread: latest.value,
    },
    distribution: distributionOverWindow(spreads, {
      windowYears: EUROPE_MACRO_PARAMS.windowYears,
      minPoints: EUROPE_MACRO_PARAMS.minSpreadSessions,
      seriesLabel: "Europa Equal-Weight-Spanne",
    }),
  };
}

export function unavailableEqualWeight(reason: string): EuropeEqualWeightSlot {
  return {
    id: "equalWeight",
    usSignal: "Cap-Weight-RSL minus Equal-Weight-RSL",
    substitute: `${EUROPE_CAP_WEIGHT.symbol} minus ${EUROPE_EQUAL_WEIGHT.symbol}`,
    needsPhilip: false,
    capSymbol: EUROPE_CAP_WEIGHT.symbol,
    equalSymbol: EUROPE_EQUAL_WEIGHT.symbol,
    prior: EUROPE_RSL_PRIOR,
    spread: { available: false, reason },
    distribution: { available: false, reason },
  };
}

function priorYearQuarter(quarter: string): string | null {
  const match = /^(\d{4})Q([1-4])$/.exec(quarter);
  if (!match) return null;
  return `${Number(match[1]) - 1}Q${match[2]}`;
}

export function parseEurostatGfcfCsv(csv: string): { levels: GfcfLevel[]; problem: string | null } {
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) {
    return { levels: [], problem: "n/a — Eurostat namq_10_gdp P51G EA20 nicht erreichbar" };
  }
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]?.split(",") ?? [];
  const periodIndex = header.indexOf("TIME_PERIOD");
  const valueIndex = header.indexOf("OBS_VALUE");
  if (periodIndex < 0 || valueIndex < 0) {
    return { levels: [], problem: "n/a — Eurostat-CSV ohne TIME_PERIOD oder OBS_VALUE" };
  }
  const levels: GfcfLevel[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    const period = cells[periodIndex]?.trim() ?? "";
    const match = /^(\d{4})-Q([1-4])$/.exec(period);
    const raw = cells[valueIndex]?.trim() ?? "";
    if (!raw || raw === ".") continue;
    const value = Number(raw);
    if (!match || !Number.isFinite(value)) continue;
    levels.push({ quarter: `${match[1]}Q${match[2]}`, value });
  }
  levels.sort((a, b) => a.quarter.localeCompare(b.quarter));
  if (levels.length === 0) {
    return { levels: [], problem: "n/a — Eurostat P51G EA20 ohne Beobachtungen" };
  }
  return { levels, problem: null };
}

export function computeEuroAreaCapex(levels: GfcfLevel[]): EuropeCapexSlot {
  const source = `Eurostat ${EUROSTAT_GFCF.dataset} ${EUROSTAT_GFCF.item} ${EUROSTAT_GFCF.geo} ${EUROSTAT_GFCF.unit}`;
  const base = {
    id: "capex" as const,
    usSignal: "CAPEX der Hyperscaler, YoY" as const,
    substitute: "Bruttoanlageinvestitionen Eurozone, YoY",
    needsPhilip: false as const,
    source,
    note: EUROPE_CAPEX_NOTE,
  };
  const byQuarter = new Map<string, number>();
  for (const level of levels) {
    if (!/^(\d{4})Q([1-4])$/.test(level.quarter) || !Number.isFinite(level.value)) continue;
    byQuarter.set(level.quarter, level.value);
  }
  const points: { key: string; value: number; level: number; yearAgo: number }[] = [];
  for (const [quarter, level] of Array.from(byQuarter.entries())) {
    const priorKey = priorYearQuarter(quarter);
    if (!priorKey || !byQuarter.has(priorKey)) continue;
    const yearAgo = byQuarter.get(priorKey)!;
    if (!(yearAgo > 0)) continue;
    points.push({
      key: quarter,
      value: ((level - yearAgo) / yearAgo) * EUROPE_MACRO_PARAMS.percentScale,
      level,
      yearAgo,
    });
  }
  points.sort((a, b) => a.key.localeCompare(b.key));
  if (points.length === 0) {
    const reason = "n/a — Eurostat P51G: kein Vorjahresquartal";
    return { ...base, yoy: { available: false, reason }, distribution: { available: false, reason } };
  }
  const latest = points[points.length - 1];
  return {
    ...base,
    yoy: { available: true, quarter: latest.key, yoyPct: latest.value, level: latest.level, yearAgo: latest.yearAgo },
    distribution: distributionOverWindow(points, {
      windowYears: EUROPE_MACRO_PARAMS.windowYears,
      minPoints: EUROPE_MACRO_PARAMS.minGfcfQuarters,
      seriesLabel: "Eurostat P51G",
    }),
  };
}

export function unavailableEuroCapex(reason: string): EuropeCapexSlot {
  return {
    id: "capex",
    usSignal: "CAPEX der Hyperscaler, YoY",
    substitute: "Bruttoanlageinvestitionen Eurozone, YoY",
    needsPhilip: false,
    source: `Eurostat ${EUROSTAT_GFCF.dataset} ${EUROSTAT_GFCF.item} ${EUROSTAT_GFCF.geo}`,
    note: EUROPE_CAPEX_NOTE,
    yoy: { available: false, reason },
    distribution: { available: false, reason },
  };
}

export function assembleEuropeFallbacks(equalWeight: EuropeEqualWeightSlot, capex: EuropeCapexSlot): EuropeMacroFallbacks {
  return { slots: [surpriseSlot(), equalWeight, capex] };
}
