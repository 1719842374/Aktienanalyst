/**
 * Regional stocks-velocity on top of books M and F.
 * Spec: WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.
 *
 * T½^rate = ln(2) / ln(1 + max(r, 0.001)), r as a decimal (0.08 = 8 %).
 * T½ = T½^rate · clip(V̄ / V, 0.5, 2). V̄ is the median of the region's own series.
 * π does not wait on a dollar fiscal rest and does not read a price or a PE.
 * A program is priced in after at most 2 years. Velocity only says whether
 * that impulse is already circulating in NGDP/M versus its own median.
 * EMG is the same function as liquidity-regime-math.excessMoneyGrowth.
 */
import { excessMoneyGrowth } from "./liquidity-regime-math";

export const PHI = 0.3;
export const PI_CAP_YEARS = 2;
export const PROGRAM_START_UNKNOWN = "program start unknown";
const VELOCITY_FLOOR = 0.5;
const VELOCITY_CAP = 2;

export interface RegionalStocks {
  debtGdpPct: number | null;
  bondMarketBn: number | null;
  bondMarketGdpPct: number | null;
  realRatePct: number | null;
  tHalfYears: number | null;
  velocity: number | null;
  velocityZ: number | null;
  excessMoneyGrowth: number | null;
  fiscalTrend: number | null;
  moneyTrend: number | null;
  pricedIn: number | null;
  unpricedPvBn: number | null;
  /** V / V̄. Above 1 means velocity is above its own median. */
  velocityOverMedian: number | null;
  programAgeYears: number | null;
  piNote: string | null;
  available: { debt: boolean; bonds: boolean; real: boolean; vel: boolean; pi: boolean };
}

export interface StockInputs {
  debtGdpPct?: number | null;
  bondMarketBn?: number | null;
  bondMarketGdpPct?: number | null;
  /** Decimal real rate. 0.08 is 8 %. */
  realRate?: number | null;
  velocity?: number | null;
  /** Own velocity history. Median is V̄. Levels are not mixed into LI. */
  velocityHistory?: number[] | null;
  fiscalRestBn?: number | null;
  tMidYears?: number | null;
  deltaR?: number | null;
  sigmaDeltaR?: number | null;
  deltaMObs?: number | null;
  /** F / M, same units as deltaMObs. */
  fiscalOverMoney?: number | null;
  /** Money stock in bn of home currency. Used only to form F/M. Not part of the payload. */
  moneyStockBn?: number | null;
  /** Years since the newest program timeline on the capex cache. Null when that date is absent. */
  programAgeYears?: number | null;
  m2YoY?: number | null;
  realGdpYoY?: number | null;
  cpiYoY?: number | null;
  fiscalTrend?: number | null;
  moneyTrend?: number | null;
}

export function rateHalfLifeYears(r: number): number | null {
  if (!Number.isFinite(r)) return null;
  const base = Math.log(1 + Math.max(r, 0.001));
  if (!(base > 0)) return null;
  return Math.log(2) / base;
}

/** clip(V̄ / V, 0.5, 2). V = 0.5 V̄ sits on the cap and returns 2. */
export function velocityFactor(v: number, vBar: number): number | null {
  if (!Number.isFinite(v) || !Number.isFinite(vBar) || v === 0) return null;
  return Math.min(VELOCITY_CAP, Math.max(VELOCITY_FLOOR, vBar / v));
}

export function tHalfYears(r: number, v?: number | null, vBar?: number | null): number | null {
  const rate = rateHalfLifeYears(r);
  if (rate == null) return null;
  if (v == null || vBar == null) return rate;
  const factor = velocityFactor(v, vBar);
  if (factor == null) return rate;
  return rate * factor;
}

/** s(z) = 50 + 50·clip(z/2, −1, 1). Unit form keeps only the side where price moved. */
export function sToUnit(z: number): number {
  if (!Number.isFinite(z)) return 0;
  const s = 50 + 50 * Math.max(-1, Math.min(1, z / 2));
  return Math.max(0, Math.min(1, (s - 50) / 50));
}

/** A = clip(ΔM_obs / max(φ F/M, ε), 0, 1). */
export function absorptionShare(deltaMObs: number, fiscalOverMoney: number, phi = PHI): number | null {
  if (!Number.isFinite(deltaMObs) || !Number.isFinite(fiscalOverMoney) || !Number.isFinite(phi)) return null;
  const denom = Math.max(phi * fiscalOverMoney, 1e-12);
  return Math.min(1, Math.max(0, deltaMObs / denom));
}

/** min(age / 2, 1). Age of 2 years is fully priced in. A future start is 0. */
export function timePricedShare(ageYears: number): number | null {
  if (!Number.isFinite(ageYears)) return null;
  return Math.min(1, Math.max(0, ageYears) / PI_CAP_YEARS);
}

/** clip(V / V̄, 0, 1). At the region's own median the impulse is circulating. */
export function circulationShare(v: number, vBar: number): number | null {
  if (!Number.isFinite(v) || !Number.isFinite(vBar) || !(vBar > 0) || v < 0) return null;
  return Math.min(1, v / vBar);
}

/** π = time share × circulation. Missing age or velocity leaves it empty. */
/** Remaining dollar impulse. No F and π known → 0 (Philip: π does not wait on F). */
export function unpricedPvBn(pi: number | null, fiscalRestBn: number | null): number | null {
  if (pi == null || !Number.isFinite(pi)) return null;
  if (fiscalRestBn == null || !Number.isFinite(fiscalRestBn)) return 0;
  return (1 - Math.max(0, Math.min(1, pi))) * fiscalRestBn;
}

export function pricedInFromAgeAndVelocity(
  ageYears: number | null,
  v: number | null,
  vBar: number | null,
): number | null {
  if (ageYears == null || v == null || vBar == null) return null;
  const time = timePricedShare(ageYears);
  const circ = circulationShare(v, vBar);
  if (time == null || circ == null) return null;
  return time * circ;
}

/**
 * Older rate-channel mix. The payload no longer uses it. F is not required.
 * π = 0.6·s_to_unit(z_r) + 0.4·A.
 */
export function pricedInPi(input: { zR: number | null; absorption: number | null }): number | null {
  const hasR = input.zR != null && Number.isFinite(input.zR);
  const hasA = input.absorption != null && Number.isFinite(input.absorption);
  if (hasR && hasA) return 0.6 * sToUnit(input.zR as number) + 0.4 * (input.absorption as number);
  if (hasR) return sToUnit(input.zR as number);
  if (hasA) return Math.max(0, Math.min(1, input.absorption as number));
  return null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function median(values: number[]): number | null {
  const xs = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  if (xs.length % 2 === 1) return xs[mid];
  return (xs[mid - 1] + xs[mid]) / 2;
}

function zScore(x: number, history: number[]): number | null {
  const xs = history.filter(n => Number.isFinite(n));
  if (!Number.isFinite(x) || xs.length < 2) return null;
  const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, v) => a + (v - mu) ** 2, 0) / (xs.length - 1);
  const sigma = Math.sqrt(variance);
  return (x - mu) / (sigma + 1e-9);
}

export function buildRegionalStocks(input: StockInputs = {}): RegionalStocks {
  const realRate = finiteOrNull(input.realRate);
  const velocity = finiteOrNull(input.velocity);
  const history = input.velocityHistory?.filter(n => Number.isFinite(n)) ?? [];
  const vBar = history.length ? median(history) : null;
  const tHalf = realRate == null ? null : tHalfYears(realRate, velocity, vBar);
  const ageRaw = finiteOrNull(input.programAgeYears);
  const age = ageRaw ?? PI_CAP_YEARS;
  const velocityOverMedian = velocity != null && vBar != null && vBar !== 0 ? velocity / vBar : null;
  const pricedIn = pricedInFromAgeAndVelocity(age, velocity, vBar);
  const piNote = ageRaw == null
    ? "π = 2y cap × V/V̄ (Philip; program start unknown)"
    : null;
  const m2 = finiteOrNull(input.m2YoY);
  const gdp = finiteOrNull(input.realGdpYoY);
  const cpi = finiteOrNull(input.cpiYoY);
  const debt = finiteOrNull(input.debtGdpPct);
  const bondsBn = finiteOrNull(input.bondMarketBn);
  const bondsGdp = finiteOrNull(input.bondMarketGdpPct);
  return {
    debtGdpPct: debt,
    bondMarketBn: bondsBn,
    bondMarketGdpPct: bondsGdp,
    realRatePct: realRate == null ? null : Math.round(realRate * 1e6) / 1e4,
    tHalfYears: tHalf,
    velocity,
    velocityZ: velocity == null ? null : zScore(velocity, history),
    excessMoneyGrowth: m2 != null && gdp != null && cpi != null ? excessMoneyGrowth(m2, gdp, cpi) : null,
    fiscalTrend: finiteOrNull(input.fiscalTrend),
    moneyTrend: finiteOrNull(input.moneyTrend),
    pricedIn,
    unpricedPvBn: unpricedPvBn(pricedIn, finiteOrNull(input.fiscalRestBn)),
    velocityOverMedian,
    programAgeYears: age,
    piNote,
    available: {
      debt: debt != null,
      bonds: bondsBn != null || bondsGdp != null,
      real: realRate != null,
      vel: velocity != null,
      pi: pricedIn != null,
    },
  };
}
