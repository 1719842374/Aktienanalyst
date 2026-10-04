/**
 * Regional stocks-velocity on top of books M and F.
 * Spec: WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.
 *
 * T½^rate = ln(2) / ln(1 + max(r, 0.001)), r as a decimal (0.08 = 8 %).
 * T½ = T½^rate · clip(V̄ / V, 0.5, 2). V̄ is the median of the region's own series.
 * π is the regional Einpreisungsgrad. This file does not import equity g* or EPR.
 * EMG is the same function as liquidity-regime-math.excessMoneyGrowth.
 */
import { excessMoneyGrowth } from "./liquidity-regime-math";

export const PHI = 0.3;
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

/**
 * π = 0.6·s_to_unit(z_r) + 0.4·A.
 * A missing channel is dropped and the remaining channel is used on its own.
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
  const fiscalRest = finiteOrNull(input.fiscalRestBn);
  const deltaR = finiteOrNull(input.deltaR);
  const sigmaR = finiteOrNull(input.sigmaDeltaR);
  const zR = deltaR != null && sigmaR != null && sigmaR > 0 ? deltaR / sigmaR : null;
  const deltaM = finiteOrNull(input.deltaMObs);
  const fOverM = finiteOrNull(input.fiscalOverMoney);
  const absorption = deltaM != null && fOverM != null ? absorptionShare(deltaM, fOverM) : null;
  const piAvailable = fiscalRest != null;
  const pricedIn = piAvailable ? pricedInPi({ zR, absorption }) : null;
  const tMid = finiteOrNull(input.tMidYears);
  let unpricedPvBn: number | null = null;
  if (piAvailable && pricedIn != null && tHalf != null && tHalf !== 0 && tMid != null && fiscalRest != null) {
    const pv = fiscalRest * Math.pow(2, -tMid / tHalf);
    unpricedPvBn = pv * (1 - pricedIn);
  }
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
    unpricedPvBn,
    available: {
      debt: debt != null,
      bonds: bondsBn != null || bondsGdp != null,
      real: realRate != null,
      vel: velocity != null,
      pi: piAvailable,
    },
  };
}
