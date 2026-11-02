/**
 * Buffett-Regression für das Rezessions-Dashboard.
 *
 * Soll: WORK_BUFFETT_ADAPTIVE_SOLUTION.md (auf main fc933a5e ohne wörtliche BA-IDs).
 * BA-01 ΔSektor, BA-02 Gewinn-CAGR, BA-03 Gewinnmarge, BA-04 Realzins,
 * BA-05 β aus der Historie, BA-06 Perzentil der Residuen,
 * BA-08 angepasste Quote. BA-07 (Konzentration als eigener Term) ist in der Spec
 * ausdrücklich nicht vorgesehen und fehlt hier.
 *
 * Schwellen kommen aus dem z der Residuen (s(z), Z_CLIP) und dem Perzentil
 * derselben Reihe. Die Slot-Decke ist ein benannter Parameter, keine 200-%-Zone.
 */
import { SMOOTH_QUARTERS } from "./buffett-ratio";
import { sOfZ, Z_CLIP } from "./fiscal-frontend-math";

export const BUFFETT_REGRESSION_PARAMS = {
  /** Vorherige Extrem-Rohnote der Zonentabelle. Hält die Slot-Decke bei Gewicht × Rohnote. */
  rawCap: 8,
  /** Gewicht des Korrektur-Slots, wie bisher, als benannter Parameter. */
  weight: 2,
  /** Länge des Gewinn-CAGR. Dieselbe Quartalszahl wie der Zehnjahresgewinn. */
  cagrLagQuarters: SMOOTH_QUARTERS,
  /** Clip von s(z). Dieselbe Konstante wie die Fiskal-Schicht. */
  zClip: Z_CLIP,
} as const;

export const BUFFETT_SECTOR_UNAVAILABLE =
  "n/a — keine historische Sektorreihe. FMP-ETF-Holdings sind ein Bestand, keine Zeitreihe; eine freie Quartalsreihe der Indexgewichte liegt nicht vor";

export interface DatedValue {
  date: string;
  value: number;
}

export interface RatioPoint {
  date: string;
  ratio: number;
}

export interface RegressionCoefficient {
  name: string;
  beta: number;
}

export interface RegressionCurvePoint {
  date: string;
  fitted: number;
}

export interface BuffettRegressionFit {
  available: boolean;
  reason: string | null;
  sectorNote: string;
  coefficients: RegressionCoefficient[];
  intercept: number | null;
  n: number;
  residual: number | null;
  residualZ: number | null;
  /** Anteil der Historien-Residuen, die nicht über dem aktuellen Residuum liegen. 0…1. */
  residualPercentile: number | null;
  fitted: number | null;
  rawScore: number | null;
  weight: number;
  weightedScore: number | null;
  maxWeighted: number;
  zone: string;
  /** Ein Satz für die Indikator-Beschreibung. */
  detail: string;
  source: string;
  curve: RegressionCurvePoint[];
  /** Regressoren des letzten Punkts stammen aus dem letzten vollständigen Quartal. */
  carriedRegressors: boolean;
}

export interface ScoredSlot {
  name: string;
  value: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  maxWeighted: number;
  zone: string;
  source: string;
  description: string;
  available?: boolean;
}

interface RegressionRow {
  date: string;
  ratio: number;
  profitCagr: number;
  profitMargin: number;
  realRate: number;
  sectorDelta: number | null;
}

const REGRESSOR_NAMES = {
  profitCagr: "Gewinn-CAGR",
  profitMargin: "Gewinnmarge",
  realRate: "Realzins",
  sectorDelta: "ΔSektor",
} as const;

type RegressorKey = keyof typeof REGRESSOR_NAMES;

export function unavailableRegression(reason: string, sectorNote = BUFFETT_SECTOR_UNAVAILABLE): BuffettRegressionFit {
  return {
    available: false,
    reason,
    sectorNote,
    coefficients: [],
    intercept: null,
    n: 0,
    residual: null,
    residualZ: null,
    residualPercentile: null,
    fitted: null,
    rawScore: null,
    weight: BUFFETT_REGRESSION_PARAMS.weight,
    weightedScore: null,
    maxWeighted: BUFFETT_REGRESSION_PARAMS.rawCap * BUFFETT_REGRESSION_PARAMS.weight,
    zone: `Regression n/a — ${reason}`,
    detail: `Regression n/a — ${reason}`,
    source: "Regression nicht geschätzt",
    curve: [],
    carriedRegressors: false,
  };
}

export function quarterKey(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const month = Number(date.slice(5, 7));
  if (month < 1 || month > 12) return null;
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${date.slice(0, 4)}Q${quarter}`;
}

function lastByQuarter(points: DatedValue[]): Map<string, DatedValue> {
  const out = new Map<string, DatedValue>();
  const ordered = [...points]
    .filter(point => Number.isFinite(point.value) && quarterKey(point.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const point of ordered) {
    const key = quarterKey(point.date);
    if (key) out.set(key, point);
  }
  return out;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values: number[]): number {
  const center = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Geschichte braucht Intercept + Regressoren und einen Freiheitsgrad für das Residuum. */
export function historyMinimum(regressorCount: number): number {
  return regressorCount + 2;
}

function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const rows = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let row = col + 1; row < size; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    if (Math.abs(rows[pivot][col]) < 1e-10) return null;
    const hold = rows[col];
    rows[col] = rows[pivot];
    rows[pivot] = hold;
    const scale = rows[col][col];
    for (let colIndex = col; colIndex <= size; colIndex++) rows[col][colIndex] /= scale;
    for (let row = 0; row < size; row++) {
      if (row === col) continue;
      const factor = rows[row][col];
      for (let colIndex = col; colIndex <= size; colIndex++) rows[row][colIndex] -= factor * rows[col][colIndex];
    }
  }
  return rows.map(row => row[size]);
}

function ols(y: number[], columns: number[][]): { intercept: number; beta: number[] } | null {
  const width = columns[0]?.length ?? 0;
  const height = y.length;
  const xtx: number[][] = Array.from({ length: width + 1 }, () => Array(width + 1).fill(0));
  const xty: number[] = Array(width + 1).fill(0);
  for (let row = 0; row < height; row++) {
    const design = [1, ...columns[row]];
    for (let left = 0; left <= width; left++) {
      xty[left] += design[left] * y[row];
      for (let right = 0; right <= width; right++) xtx[left][right] += design[left] * design[right];
    }
  }
  const coefficients = solveLinear(xtx, xty);
  if (!coefficients) return null;
  return { intercept: coefficients[0], beta: coefficients.slice(1) };
}

function signed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

function profitCagrByQuarter(profits: Map<string, number>, keys: string[], lag: number): Map<string, number> {
  const out = new Map<string, number>();
  const years = lag / 4;
  if (!(years > 0)) return out;
  for (let index = lag; index < keys.length; index++) {
    const now = profits.get(keys[index]);
    const prior = profits.get(keys[index - lag]);
    if (now == null || prior == null || !(now > 0) || !(prior > 0)) continue;
    out.set(keys[index], (Math.pow(now / prior, 1 / years) - 1) * 100);
  }
  return out;
}

function sectorDeltaByQuarter(shares: Map<string, DatedValue>, keys: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (let index = 1; index < keys.length; index++) {
    const now = shares.get(keys[index])?.value;
    const prior = shares.get(keys[index - 1])?.value;
    if (now == null || prior == null || !Number.isFinite(now) || !Number.isFinite(prior)) continue;
    out.set(keys[index], (now - prior) * 100);
  }
  return out;
}

export function assembleBuffettRegression(input: {
  ratios: RatioPoint[];
  profits: DatedValue[];
  gdp: DatedValue[];
  realRates: DatedValue[];
  sectorShares?: DatedValue[] | null;
  cagrLagQuarters?: number;
}): BuffettRegressionFit {
  const lag = input.cagrLagQuarters ?? BUFFETT_REGRESSION_PARAMS.cagrLagQuarters;
  const sectorGiven = input.sectorShares != null;
  const sectorNote = sectorGiven ? "Sektoranteil aus der übergebenen Reihe, Veränderung zum Vorquartal in Prozentpunkten" : BUFFETT_SECTOR_UNAVAILABLE;
  if (input.ratios.length === 0) return { ...unavailableRegression("n/a — Buffett-Reihe leer", sectorNote) };
  if (input.profits.length === 0) return { ...unavailableRegression("n/a — FRED CP leer", sectorNote) };
  if (input.gdp.length === 0) return { ...unavailableRegression("n/a — FRED GDP leer", sectorNote) };
  if (input.realRates.length === 0) return { ...unavailableRegression("n/a — FRED DFII10 leer", sectorNote) };

  const profitPoints = lastByQuarter(input.profits);
  const gdpPoints = lastByQuarter(input.gdp);
  const realPoints = lastByQuarter(input.realRates);
  const ratioPoints = lastByQuarter(input.ratios.map(point => ({ date: point.date, value: point.ratio })));
  const profitKeys = Array.from(profitPoints.keys()).sort();
  const profitLevels = new Map<string, number>();
  for (const key of profitKeys) {
    const level = profitPoints.get(key)?.value;
    if (level != null) profitLevels.set(key, level);
  }
  const cagr = profitCagrByQuarter(profitLevels, profitKeys, lag);
  const sectorPoints = sectorGiven ? lastByQuarter(input.sectorShares ?? []) : new Map<string, DatedValue>();
  const sectorKeys = Array.from(sectorPoints.keys()).sort();
  const sectorDelta = sectorGiven ? sectorDeltaByQuarter(sectorPoints, sectorKeys) : new Map<string, number>();

  const rows: RegressionRow[] = [];
  for (const key of Array.from(ratioPoints.keys()).sort()) {
    const ratio = ratioPoints.get(key);
    const profit = profitPoints.get(key)?.value;
    const gdp = gdpPoints.get(key)?.value;
    const realRate = realPoints.get(key)?.value;
    const profitCagr = cagr.get(key);
    if (!ratio || profit == null || gdp == null || !(gdp > 0) || realRate == null || profitCagr == null) continue;
    const delta = sectorDelta.get(key);
    rows.push({
      date: ratio.date,
      ratio: ratio.value,
      profitCagr,
      profitMargin: (profit / gdp) * 100,
      realRate,
      sectorDelta: delta == null ? null : delta,
    });
  }

  const lastRatio = [...input.ratios]
    .filter(point => Number.isFinite(point.ratio))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .at(-1);
  let carriedRegressors = false;
  if (lastRatio && rows.length > 0 && lastRatio.date > rows[rows.length - 1].date) {
    const prior = rows[rows.length - 1];
    rows.push({ ...prior, date: lastRatio.date, ratio: lastRatio.ratio });
    carriedRegressors = true;
  }

  const useSector = sectorGiven && rows.length > 0 && rows.every(row => row.sectorDelta != null && Number.isFinite(row.sectorDelta));
  const sectorStatus = useSector
    ? sectorNote
    : sectorGiven
      ? "n/a — Sektorreihe deckt nicht jedes Regressionsquartal, Spalte entfällt"
      : sectorNote;

  const keys: RegressorKey[] = useSector
    ? ["profitCagr", "profitMargin", "realRate", "sectorDelta"]
    : ["profitCagr", "profitMargin", "realRate"];
  if (rows.length < 2) {
    return { ...unavailableRegression(`n/a — zu wenige gemeinsame Quartale (${rows.length})`, sectorStatus), n: rows.length };
  }
  const current = rows[rows.length - 1];
  const history = rows.slice(0, -1);
  const active: RegressorKey[] = [];
  for (const key of keys) {
    const values = history.map(row => row[key] as number);
    if (values.length >= 2 && sampleStd(values) > 1e-8) active.push(key);
  }
  if (active.length === 0) {
    return { ...unavailableRegression("n/a — Regressoren ohne Streuung in der Historie", sectorStatus), n: history.length };
  }
  if (history.length < historyMinimum(active.length)) {
    return {
      ...unavailableRegression(
        `n/a — Historie kürzer als Intercept + Regressoren + ein Freiheitsgrad (${history.length} < ${historyMinimum(active.length)})`,
        sectorStatus,
      ),
      n: history.length,
    };
  }

  const y = history.map(row => row.ratio);
  const columns = history.map(row => active.map(key => row[key] as number));
  const fittedModel = ols(y, columns);
  if (!fittedModel) {
    return { ...unavailableRegression("n/a — Regression nicht identifiziert (singuläre Regressoren)", sectorStatus), n: history.length };
  }

  const predict = (row: RegressionRow): number => {
    let value = fittedModel.intercept;
    active.forEach((key, index) => {
      value += fittedModel.beta[index] * (row[key] as number);
    });
    return value;
  };
  const historyResiduals = history.map(row => row.ratio - predict(row));
  const currentFitted = predict(current);
  const residual = current.ratio - currentFitted;
  const sigma = sampleStd(historyResiduals);
  const center = mean(historyResiduals);
  const z = sigma <= 1e-12
    ? (Math.abs(residual - center) <= 1e-8 ? 0 : Math.sign(residual - center) * Number.POSITIVE_INFINITY)
    : (residual - center) / sigma;
  const percentile = historyResiduals.filter(value => value <= residual).length / historyResiduals.length;
  const s = sOfZ(z);
  const rawScore = Math.round(((s - 50) / 50) * BUFFETT_REGRESSION_PARAMS.rawCap);
  const weight = BUFFETT_REGRESSION_PARAMS.weight;
  const weightedScore = rawScore * weight;
  const maxWeighted = BUFFETT_REGRESSION_PARAMS.rawCap * weight;
  const coefficients = active.map((key, index) => ({ name: REGRESSOR_NAMES[key], beta: fittedModel.beta[index] }));
  const betaText = coefficients.map(item => `${item.name} ${signed(item.beta, 2)}`).join(", ");
  const carryText = carriedRegressors ? " Regressoren vom letzten vollständigen Quartal." : "";
  const zone = `Residual z ${signed(Number.isFinite(z) ? z : Math.sign(z) * BUFFETT_REGRESSION_PARAMS.zClip, 2)}, Perzentil ${Math.round(percentile * 100)}, n=${history.length}`;
  const detail = `Regression auf der eigenen Historie (β ${betaText}; Intercept ${signed(fittedModel.intercept, 1)}). `
    + `Aktuelle Quote ${current.ratio.toFixed(1)} %, angepasst ${currentFitted.toFixed(1)} %, Residuum ${signed(residual, 1)} Pp. `
    + `Score aus s(z) mit Z_CLIP=${BUFFETT_REGRESSION_PARAMS.zClip}, Rohnote-Decke ${BUFFETT_REGRESSION_PARAMS.rawCap}, Gewicht ${weight}. `
    + `${sectorStatus}.${carryText}`;
  const curve = [...history, current].map(row => ({ date: row.date, fitted: predict(row) }));
  return {
    available: true,
    reason: null,
    sectorNote: sectorStatus,
    coefficients,
    intercept: fittedModel.intercept,
    n: history.length,
    residual,
    residualZ: Number.isFinite(z) ? z : null,
    residualPercentile: percentile,
    fitted: currentFitted,
    rawScore,
    weight,
    weightedScore,
    maxWeighted,
    zone,
    detail,
    source: "Regression FRED CP / GDP / DFII10",
    curve,
    carriedRegressors,
  };
}

export function applyRegressionToSlot<T extends ScoredSlot>(slot: T, fit: BuffettRegressionFit): T {
  if (slot.available === false) return slot;
  if (!fit.available || fit.rawScore == null || fit.weightedScore == null) {
    const note = fit.detail.startsWith("Regression n/a") ? fit.detail : `Regression n/a — ${fit.reason ?? "unbekannt"}`;
    if (slot.description.includes("Regression n/a")) return slot;
    return { ...slot, description: `${slot.description} ${note}` };
  }
  const source = slot.source.includes("Regression FRED") ? slot.source : `${slot.source}; ${fit.source}`;
  return {
    ...slot,
    rawScore: fit.rawScore,
    weight: fit.weight,
    weightedScore: fit.weightedScore,
    maxWeighted: fit.maxWeighted,
    zone: fit.zone,
    source,
    description: `${slot.description} ${fit.detail}`,
  };
}
