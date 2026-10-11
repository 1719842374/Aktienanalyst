/**
 * Future_10 §2–§3, §8 und §10 — adaptive Gold-Schicht.
 *
 * Additiv zu GIS, Real-Yield-OLS, Multi-Faktor, bestehenden Gates und Monte Carlo.
 * Jedes Signal ist ein z-Score gegen die eigene Historie. Feste Markt-Schwellen
 * (RSI 70, DXY 104, …) werden hier nicht benutzt. Spec-Konstanten (Gewichte,
 * Habitat, 1,5× Volumen, MA 50/200) bleiben die definierten Parameter.
 *
 * Fehlt eine Quelle oder die Historie, ist das Signal N/A und die Dimension
 * fällt aus der Summe. Es wird keine 0 eingesetzt.
 *
 * Das News-Flag (§9) wird nur durchgereicht. Es ändert den Score nicht.
 */
import { macd1269, rsiWilder } from "../shared/tech-rsi";
import type { GoldAdaptiveLayer, GoldAdaptiveScore, GoldAdaptiveSignal, GoldModelGate } from "../shared/gold-schema";

export const GOLD_ADAPTIVE_BASE_WEIGHTS = {
  realYield: 1.8,
  policy: 1.3,
  liquidity: 1.2,
  inflation: 0.8,
  supply: 0.9,
  technical: 1.0,
  macro: 0.9,
} as const;

export type GoldAdaptiveLayerId = keyof typeof GOLD_ADAPTIVE_BASE_WEIGHTS;

/** Future_10 §3, unmittelbar vor dem Stärke-Layer. */
export const GOLD_HABITAT = {
  STRESS_REAL_YIELD: 1.25,
  REAL_RATE_TREND_PP: -0.3,
  POLICY_BOOST: 1.2,
  M2_Z: 1,
  LIQUIDITY_BOOST: 1.15,
} as const;

/** effectiveWeight = base × habitat × (0.7 + strength × 0.6) */
export const GOLD_EFFECTIVE_WEIGHT = { FLOOR: 0.7, STRENGTH_SPAN: 0.6 } as const;

export const VOLUME_SPIKE_MULTIPLE = 1.5;
export const VOLUME_AVERAGE_DAYS = 20;
/** Unter 80 % positiven Volumen-Prints ist die Serie kein echtes Volumen. */
export const VOLUME_REAL_SHARE = 0.8;
export const Z_HISTORY_MIN = 30;
export const Z_CAP = 4;
export const RSI_HISTORY_MIN = 252;
export const RSI_HISTORY_MAX = 504;
export const TREND_LAG = 60;
export const FED_FUNDS_LAG = 12;
export const M2_YOY_LAG = 12;
export const WALCL_CHANGE_LAG = 13;
export const OLS_WINDOW = 252;
export const MA_FAST = 50;
export const MA_SLOW = 200;
/** FRED RRPONTSYD ist in Mrd. USD, WALCL und WTREGEN in Mio. USD. */
export const RRP_BILLIONS_TO_WALCL_MILLIONS = 1000;

export interface DatedNumber {
  date: string;
  value: number;
}

export interface GoldAdaptiveInput {
  closes: { date: string; close: number }[];
  volumes: { date: string; volume: number }[] | null;
  volumeSource: string | null;
  real10Y: DatedNumber[];
  fedFunds: DatedNumber[];
  m2: DatedNumber[];
  walcl: DatedNumber[];
  tga: DatedNumber[] | null;
  /** RRPONTSYD in Mrd. USD. Wird intern auf Mio. USD gehoben. */
  rrpBillions: DatedNumber[] | null;
  breakeven: DatedNumber[];
  dxy: DatedNumber[];
  aisc: { date: string; aisc: number }[] | null;
  regime: "stress" | "tailwind" | "neutral" | null;
  newsFlag: number | null;
  /** Bereits gerundeter GIS. Nur für scoreDelta, nicht für die Schicht. */
  gis?: number | null;
  now?: string;
}

export function effectiveWeight(base: number, habitatMultiplier: number, strength: number): number {
  return base * habitatMultiplier * (GOLD_EFFECTIVE_WEIGHT.FLOOR + strength * GOLD_EFFECTIVE_WEIGHT.STRENGTH_SPAN);
}

export function habitatMultipliers(input: {
  regime: GoldAdaptiveInput["regime"];
  realRateTrendPp: number | null;
  m2GrowthZ: number | null;
}): Record<GoldAdaptiveLayerId, number> {
  return {
    realYield: input.regime === "stress" ? GOLD_HABITAT.STRESS_REAL_YIELD : 1,
    policy: input.realRateTrendPp != null && input.realRateTrendPp < GOLD_HABITAT.REAL_RATE_TREND_PP
      ? GOLD_HABITAT.POLICY_BOOST
      : 1,
    liquidity: input.m2GrowthZ != null && input.m2GrowthZ > GOLD_HABITAT.M2_Z
      ? GOLD_HABITAT.LIQUIDITY_BOOST
      : 1,
    inflation: 1,
    supply: 1,
    technical: 1,
    macro: 1,
  };
}

export function volumeReadingsAreReal(volumes: number[]): boolean {
  if (volumes.length < VOLUME_AVERAGE_DAYS) return false;
  let positive = 0;
  for (const value of volumes) {
    if (Number.isFinite(value) && value > 0) positive += 1;
  }
  return positive / volumes.length >= VOLUME_REAL_SHARE;
}

export function adaptiveZ(current: number, history: number[]): number | null {
  const sample = history.filter(value => Number.isFinite(value));
  if (!Number.isFinite(current) || sample.length < Z_HISTORY_MIN) return null;
  const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
  const variance = sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sample.length - 1);
  const sigma = Math.sqrt(variance);
  if (!(sigma > 0)) return null;
  const z = (current - mean) / sigma;
  if (!Number.isFinite(z)) return null;
  return Math.max(-Z_CAP, Math.min(Z_CAP, z));
}

/** Adaptiver Score minus GIS. null, wenn eine Seite fehlt. */
export function goldScoreDelta(adaptive: number | null, gis: number | null): number | null {
  if (adaptive == null || gis == null || !Number.isFinite(adaptive) || !Number.isFinite(gis)) return null;
  return adaptive - gis;
}

export function aggregateAdaptiveLayers(layers: GoldAdaptiveLayer[]): number | null {
  const used = layers.filter(layer =>
    layer.available
    && layer.contribution != null
    && layer.effectiveWeight != null
    && layer.effectiveWeight > 0
  );
  if (used.length === 0) return null;
  const weight = used.reduce((sum, layer) => sum + (layer.effectiveWeight as number), 0);
  const contribution = used.reduce((sum, layer) => sum + (layer.contribution as number), 0);
  if (!(weight > 0) || !Number.isFinite(contribution)) return null;
  return contribution / weight;
}

function valuesOf(points: DatedNumber[] | null | undefined): number[] {
  if (!points || points.length === 0) return [];
  const map = new Map<string, number>();
  for (const point of points) {
    const date = String(point?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(point.value)) continue;
    map.set(date, point.value);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([, value]) => value);
}

function datedCloses(points: { date: string; close: number }[]): { date: string; close: number }[] {
  const map = new Map<string, number>();
  for (const point of points) {
    const date = String(point?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(point.close) || !(point.close > 0)) continue;
    map.set(date, point.close);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, close]) => ({ date, close }));
}

function rawLagChange(values: number[], lag: number): number | null {
  if (lag <= 0 || values.length <= lag) return null;
  const current = values[values.length - 1];
  const prior = values[values.length - 1 - lag];
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  return current - prior;
}

function levelChangeZ(values: number[], lag: number): number | null {
  if (values.length < lag + Z_HISTORY_MIN + 1) return null;
  const changes: number[] = [];
  for (let i = lag; i < values.length; i++) {
    const change = values[i] - values[i - lag];
    if (Number.isFinite(change)) changes.push(change);
  }
  if (changes.length < Z_HISTORY_MIN + 1) return null;
  return adaptiveZ(changes[changes.length - 1], changes.slice(0, -1));
}

function ratioChangeZ(values: number[], lag: number): { z: number | null; current: number | null } {
  const ratios: number[] = [];
  for (let i = lag; i < values.length; i++) {
    const prior = values[i - lag];
    if (!(prior > 0) || !Number.isFinite(values[i])) continue;
    ratios.push(values[i] / prior - 1);
  }
  if (ratios.length < Z_HISTORY_MIN + 1) return { z: null, current: ratios.length ? ratios[ratios.length - 1] : null };
  return {
    z: adaptiveZ(ratios[ratios.length - 1], ratios.slice(0, -1)),
    current: ratios[ratios.length - 1],
  };
}

function fromZ(id: string, label: string, z: number | null, missing: string, note?: string): GoldAdaptiveSignal {
  if (z == null) {
    return { id, available: false, z: null, strength: null, direction: null, detail: `${label}: ${missing}` };
  }
  const direction = Math.tanh(z);
  const strength = Math.abs(direction);
  const extra = note ? `, ${note}` : "";
  return {
    id,
    available: true,
    z,
    strength,
    direction,
    detail: `${label}: z=${z.toFixed(2)}, Stärke ${strength.toFixed(2)}${extra}`,
  };
}

function trailingMean(values: number[], end: number, period: number): number | null {
  if (period <= 0 || end - period + 1 < 0 || end >= values.length) return null;
  let sum = 0;
  for (let i = end - period + 1; i <= end; i++) {
    if (!Number.isFinite(values[i])) return null;
    sum += values[i];
  }
  return sum / period;
}

function simpleResiduals(xs: number[], ys: number[]): number[] | null {
  if (xs.length !== ys.length || xs.length < Z_HISTORY_MIN) return null;
  const n = xs.length;
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanX += xs[i];
    meanY += ys[i];
  }
  meanX /= n;
  meanY /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
  }
  if (!(sxx > 0)) return null;
  const beta = sxy / sxx;
  const alpha = meanY - beta * meanX;
  return ys.map((y, i) => y - (alpha + beta * xs[i]));
}

function locf(series: { date: string; value: number }[], date: string): number | null {
  let known: number | null = null;
  for (const point of series) {
    if (point.date <= date && Number.isFinite(point.value)) known = point.value;
    else if (point.date > date) break;
  }
  return known;
}

function sortDated(points: DatedNumber[]): { date: string; value: number }[] {
  const map = new Map<string, number>();
  for (const point of points) {
    const date = String(point?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(point.value)) continue;
    map.set(date, point.value);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));
}

function layerFrom(
  id: GoldAdaptiveLayerId,
  label: string,
  habitatMultiplier: number,
  signals: GoldAdaptiveSignal[],
): GoldAdaptiveLayer {
  const baseWeight = GOLD_ADAPTIVE_BASE_WEIGHTS[id];
  const usable = signals.filter(signal => signal.available && signal.direction != null && signal.strength != null);
  const detail = signals.map(signal => signal.detail).join(" · ") || "Quelle fehlt";
  if (usable.length === 0) {
    return {
      id,
      label,
      available: false,
      baseWeight,
      habitatMultiplier,
      strength: null,
      effectiveWeight: null,
      direction: null,
      contribution: null,
      detail,
      signals,
    };
  }
  const direction = usable.reduce((sum, signal) => sum + (signal.direction as number), 0) / usable.length;
  const strength = usable.reduce((sum, signal) => sum + (signal.strength as number), 0) / usable.length;
  const weight = effectiveWeight(baseWeight, habitatMultiplier, strength);
  return {
    id,
    label,
    available: true,
    baseWeight,
    habitatMultiplier,
    strength,
    effectiveWeight: weight,
    direction,
    contribution: direction * weight,
    detail,
    signals,
  };
}

function realYieldSignals(closes: { date: string; close: number }[], real10Y: DatedNumber[]): GoldAdaptiveSignal[] {
  const real = sortDated(real10Y);
  const realByDate = new Map(real.map(point => [point.date, point.value]));
  const joined = closes.filter(point => realByDate.has(point.date));
  const window = joined.slice(-OLS_WINDOW);
  let premium: GoldAdaptiveSignal;
  if (window.length < Z_HISTORY_MIN) {
    premium = fromZ("realYield.premium", "Fair-Value-Residual", null, "zu wenig gemeinsame Gold/DFII10-Punkte");
  } else {
    const residuals = simpleResiduals(
      window.map(point => realByDate.get(point.date) as number),
      window.map(point => point.close),
    );
    const z = residuals && residuals.length > Z_HISTORY_MIN
      ? adaptiveZ(residuals[residuals.length - 1], residuals.slice(0, -1))
      : null;
    premium = fromZ(
      "realYield.premium",
      "Fair-Value-Residual",
      z == null ? null : -z,
      "Residual ohne Streuung",
      "teuer = bärisch",
    );
  }
  const realValues = real.map(point => point.value);
  const trendZ = levelChangeZ(realValues, TREND_LAG);
  const trend = fromZ(
    "realYield.trend",
    "Real10Y-Trend",
    trendZ == null ? null : -trendZ,
    "DFII10-Historie fehlt",
    "fallend = bullisch",
  );
  return [premium, trend];
}

function policySignals(real10Y: DatedNumber[], fedFunds: DatedNumber[]): GoldAdaptiveSignal[] {
  const funds = valuesOf(fedFunds);
  const fundsZ = levelChangeZ(funds, FED_FUNDS_LAG);
  const fundsSignal = fromZ(
    "policy.fedFunds",
    "Fed Funds",
    fundsZ == null ? null : -fundsZ,
    "FEDFUNDS-Historie fehlt",
    "Senkung = bullisch",
  );
  const realZ = levelChangeZ(valuesOf(real10Y), TREND_LAG);
  const realSignal = fromZ(
    "policy.realRate",
    "Realzins-Rückgang",
    realZ == null ? null : -realZ,
    "DFII10-Historie fehlt",
    "fallend = bullisch",
  );
  return [fundsSignal, realSignal];
}

function liquiditySignals(
  m2: DatedNumber[],
  walcl: DatedNumber[],
  tga: DatedNumber[] | null,
  rrpBillions: DatedNumber[] | null,
): { signals: GoldAdaptiveSignal[]; m2GrowthZ: number | null } {
  const m2Levels = valuesOf(m2);
  const m2Ratio = ratioChangeZ(m2Levels, M2_YOY_LAG);
  const m2Signal = fromZ(
    "liquidity.m2",
    "M2 YoY",
    m2Ratio.z,
    "M2SL-Historie fehlt",
    m2Ratio.current == null ? undefined : `YoY ${(m2Ratio.current * 100).toFixed(2)}%`,
  );
  const walclRatio = ratioChangeZ(valuesOf(walcl), WALCL_CHANGE_LAG);
  const walclSignal = fromZ(
    "liquidity.walcl",
    "WALCL",
    walclRatio.z,
    "WALCL-Historie fehlt",
    "steigend = bullisch",
  );
  const netSignal = netLiquiditySignal(walcl, tga, rrpBillions);
  return { signals: [m2Signal, walclSignal, netSignal], m2GrowthZ: m2Ratio.z };
}

function netLiquiditySignal(
  walcl: DatedNumber[],
  tga: DatedNumber[] | null,
  rrpBillions: DatedNumber[] | null,
): GoldAdaptiveSignal {
  const walclPoints = sortDated(walcl);
  const tgaPoints = sortDated(tga ?? []);
  const rrpPoints = sortDated(rrpBillions ?? []);
  if (walclPoints.length === 0 || tgaPoints.length === 0 || rrpPoints.length === 0) {
    return fromZ("liquidity.net", "Netto-Liquidität", null, "WALCL, WTREGEN oder RRPONTSYD fehlt");
  }
  const nets: number[] = [];
  for (const point of walclPoints) {
    const tgaValue = locf(tgaPoints, point.date);
    const rrpValue = locf(rrpPoints, point.date);
    if (tgaValue == null || rrpValue == null) continue;
    nets.push(point.value - tgaValue - rrpValue * RRP_BILLIONS_TO_WALCL_MILLIONS);
  }
  const change = ratioChangeZ(nets, WALCL_CHANGE_LAG);
  return fromZ("liquidity.net", "Netto-Liquidität", change.z, "Netto-Liquidität ohne Historie", "WALCL − TGA − RRP");
}

function inflationSignal(breakeven: DatedNumber[], real10Y: DatedNumber[]): GoldAdaptiveSignal {
  const breakZ = levelChangeZ(valuesOf(breakeven), TREND_LAG);
  if (breakZ == null) return fromZ("inflation.breakeven", "Breakeven", null, "T10YIE-Historie fehlt");
  const realZ = levelChangeZ(valuesOf(real10Y), TREND_LAG);
  const rawConditional = realZ == null ? breakZ : breakZ - Math.max(0, realZ);
  const conditional = Math.max(-Z_CAP, Math.min(Z_CAP, rawConditional));
  return fromZ(
    "inflation.breakeven",
    "Breakeven",
    conditional,
    "T10YIE-Historie fehlt",
    realZ == null ? "ohne Realzins-Bedingung" : "steigend nur, wenn der Realzins nicht mitzieht",
  );
}

function supplySignal(
  closes: { date: string; close: number }[],
  aisc: { date: string; aisc: number }[] | null,
): GoldAdaptiveSignal {
  if (!aisc || aisc.length === 0) return fromZ("supply.aisc", "AISC-Margin", null, "AISC-Quelle fehlt");
  const steps = [...aisc]
    .filter(step => /^\d{4}-\d{2}-\d{2}$/.test(String(step.date).slice(0, 10)) && Number.isFinite(step.aisc) && step.aisc > 0)
    .map(step => ({ date: String(step.date).slice(0, 10), aisc: step.aisc }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (steps.length === 0) return fromZ("supply.aisc", "AISC-Margin", null, "AISC-Quelle fehlt");
  const margins: number[] = [];
  let stepIndex = 0;
  let known: number | null = null;
  for (const bar of closes) {
    while (stepIndex < steps.length && steps[stepIndex].date <= bar.date) {
      known = steps[stepIndex].aisc;
      stepIndex += 1;
    }
    if (known != null && known > 0) margins.push((bar.close - known) / known);
  }
  if (margins.length < Z_HISTORY_MIN + 1) {
    return fromZ("supply.aisc", "AISC-Margin", null, "AISC-Zeitreihe zu kurz für einen z-Score");
  }
  return fromZ(
    "supply.aisc",
    "AISC-Margin",
    adaptiveZ(margins[margins.length - 1], margins.slice(0, -1)),
    "AISC-Margin ohne Streuung",
    "enge Margin = Stress",
  );
}

function technicalSignals(
  closes: { date: string; close: number }[],
  volumes: { date: string; volume: number }[] | null,
  volumeSource: string | null,
): GoldAdaptiveSignal[] {
  const closeValues = closes.map(point => point.close);
  return [
    rsiSignal(closeValues),
    ma200Signal(closeValues),
    crossSignal(closeValues),
    macdSignal(closeValues),
    ...volumeSignals(closes, volumes, volumeSource),
  ];
}

function rsiSignal(closes: number[]): GoldAdaptiveSignal {
  const rsi = rsiWilder(closes, 14).filter((value): value is number => value != null && Number.isFinite(value));
  const window = rsi.slice(-RSI_HISTORY_MAX);
  if (window.length < RSI_HISTORY_MIN + 1) {
    return fromZ("technical.rsi", "RSI", null, "weniger als 1 Jahr RSI-Historie");
  }
  const z = adaptiveZ(window[window.length - 1], window.slice(0, -1));
  return fromZ("technical.rsi", "RSI", z == null ? null : -z, "RSI ohne Streuung", "hoch gegen die eigene Historie = bärisch");
}

function ma200Signal(closes: number[]): GoldAdaptiveSignal {
  const deviations: number[] = [];
  for (let i = MA_SLOW - 1; i < closes.length; i++) {
    const ma = trailingMean(closes, i, MA_SLOW);
    if (ma != null && ma > 0) deviations.push((closes[i] - ma) / ma);
  }
  if (deviations.length < Z_HISTORY_MIN + 1) {
    return fromZ("technical.ma200", "MA200-Abweichung", null, "weniger als 200 Schlüsse plus Historie");
  }
  return fromZ(
    "technical.ma200",
    "MA200-Abweichung",
    adaptiveZ(deviations[deviations.length - 1], deviations.slice(0, -1)),
    "MA200-Abweichung ohne Streuung",
    "über der eigenen MA200-Historie = bullisch",
  );
}

function crossSignal(closes: number[]): GoldAdaptiveSignal {
  const spreads: number[] = [];
  for (let i = MA_SLOW - 1; i < closes.length; i++) {
    const ma50 = trailingMean(closes, i, MA_FAST);
    const ma200 = trailingMean(closes, i, MA_SLOW);
    if (ma50 == null || ma200 == null || !(ma200 > 0)) continue;
    spreads.push((ma50 - ma200) / ma200);
  }
  if (spreads.length < Z_HISTORY_MIN + 1) {
    return fromZ("technical.cross", "MA-Spread", null, "Golden/Death-Spread ohne Historie");
  }
  const current = spreads[spreads.length - 1];
  const state = current >= 0 ? "50-MA über 200-MA" : "50-MA unter 200-MA";
  return fromZ(
    "technical.cross",
    "MA-Spread",
    adaptiveZ(current, spreads.slice(0, -1)),
    "MA-Spread ohne Streuung",
    state,
  );
}

function macdSignal(closes: number[]): GoldAdaptiveSignal {
  const hist = macd1269(closes)
    .map(point => point.hist)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (hist.length < Z_HISTORY_MIN + 1) return fromZ("technical.macd", "MACD", null, "MACD 12/26/9 ohne Historie");
  const window = hist.slice(-RSI_HISTORY_MAX);
  return fromZ(
    "technical.macd",
    "MACD",
    adaptiveZ(window[window.length - 1], window.slice(0, -1)),
    "MACD ohne Streuung",
    "Histogramm über der eigenen Historie = bullisch",
  );
}

function volumeSignals(
  closes: { date: string; close: number }[],
  volumes: { date: string; volume: number }[] | null,
  volumeSource: string | null,
): GoldAdaptiveSignal[] {
  const raw = volumes ?? [];
  const rawReal = volumeReadingsAreReal(raw.map(point => point.volume));
  if (!rawReal) {
    const why = volumes == null
      ? "Volumenquelle fehlt"
      : "Volumenreihe ohne echte positive Prints";
    return [
      fromZ("technical.volumeSpike", "Volumen-Spike", null, why),
      fromZ("technical.volumeDivergence", "Volumen-Divergenz", null, why),
    ];
  }
  const volByDate = new Map<string, number>();
  for (const point of raw) {
    const date = String(point.date).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(point.volume)) volByDate.set(date, point.volume);
  }
  const bars = closes
    .filter(point => volByDate.has(point.date))
    .map(point => ({ close: point.close, volume: volByDate.get(point.date) as number }));
  if (!volumeReadingsAreReal(bars.map(bar => bar.volume))) {
    const why = "Volumen nicht auf die Gold-Schlüsse datierbar";
    return [
      fromZ("technical.volumeSpike", "Volumen-Spike", null, why),
      fromZ("technical.volumeDivergence", "Volumen-Divergenz", null, why),
    ];
  }
  const source = volumeSource ? `Quelle ${volumeSource}` : "Quelle ohne Namen";
  return [volumeSpikeSignal(bars, source), volumeDivergenceSignal(bars, source)];
}

function volumeSpikeSignal(bars: { close: number; volume: number }[], source: string): GoldAdaptiveSignal {
  const ratios: number[] = [];
  const signs: number[] = [];
  for (let i = VOLUME_AVERAGE_DAYS; i < bars.length; i++) {
    const avg = trailingMean(bars.map(bar => bar.volume), i - 1, VOLUME_AVERAGE_DAYS);
    const priorClose = bars[i - VOLUME_AVERAGE_DAYS].close;
    if (avg == null || !(avg > 0) || !(priorClose > 0)) continue;
    ratios.push(bars[i].volume / avg);
    const priceChange = bars[i].close / priorClose - 1;
    signs.push(priceChange === 0 ? 0 : Math.sign(priceChange));
  }
  if (ratios.length < Z_HISTORY_MIN + 1) {
    return fromZ("technical.volumeSpike", "Volumen-Spike", null, "zu wenig Volumistage");
  }
  const ratio = ratios[ratios.length - 1];
  const z = adaptiveZ(ratio, ratios.slice(0, -1));
  const sign = signs[signs.length - 1] ?? 0;
  if (z == null || sign === 0) {
    return fromZ("technical.volumeSpike", "Volumen-Spike", null, sign === 0 ? "kein 20-Tage-Preisimpuls" : "Volumen ohne Streuung");
  }
  const spike = ratio > VOLUME_SPIKE_MULTIPLE;
  return fromZ(
    "technical.volumeSpike",
    "Volumen-Spike",
    sign * z,
    "Volumen ohne Streuung",
    `${source}, letzter / 20T = ${ratio.toFixed(2)}×${spike ? `, Spike > ${VOLUME_SPIKE_MULTIPLE}×` : ""}`,
  );
}

function volumeDivergenceSignal(bars: { close: number; volume: number }[], source: string): GoldAdaptiveSignal {
  const combos: number[] = [];
  const lag = VOLUME_AVERAGE_DAYS;
  for (let i = lag * 2; i < bars.length; i++) {
    const recentVol = trailingMean(bars.map(bar => bar.volume), i, lag);
    const priorVol = trailingMean(bars.map(bar => bar.volume), i - lag, lag);
    const priorClose = bars[i - lag].close;
    if (recentVol == null || priorVol == null || !(priorVol > 0) || !(priorClose > 0)) continue;
    const priceChange = bars[i].close / priorClose - 1;
    const volumeChange = recentVol / priorVol - 1;
    combos.push(priceChange * volumeChange);
  }
  if (combos.length < Z_HISTORY_MIN + 1) {
    return fromZ("technical.volumeDivergence", "Volumen-Divergenz", null, "zu wenig Volumistage");
  }
  const current = combos[combos.length - 1];
  return fromZ(
    "technical.volumeDivergence",
    "Volumen-Divergenz",
    adaptiveZ(current, combos.slice(0, -1)),
    "Volumen-Divergenz ohne Streuung",
    `${source}, Preis steigt und Volumen fällt = negativ`,
  );
}

function macroSignal(dxy: DatedNumber[]): GoldAdaptiveSignal {
  const z = levelChangeZ(valuesOf(dxy), TREND_LAG);
  return fromZ("macro.dxy", "DXY", z == null ? null : -z, "DTWEXBGS-Historie fehlt", "fallend = bullisch");
}

function latestMas(closes: number[]): { ma50: number | null; ma200: number | null } {
  if (closes.length === 0) return { ma50: null, ma200: null };
  const end = closes.length - 1;
  return {
    ma50: trailingMean(closes, end, MA_FAST),
    ma200: trailingMean(closes, end, MA_SLOW),
  };
}

function buildGates(
  closes: number[],
  real10Y: number[],
): GoldModelGate[] {
  const priceWindow = closes.slice(-RSI_HISTORY_MAX);
  const priceZ = priceWindow.length > Z_HISTORY_MIN
    ? adaptiveZ(priceWindow[priceWindow.length - 1], priceWindow.slice(0, -1))
    : null;
  const realTrend = rawLagChange(real10Y, TREND_LAG);
  let policy: GoldModelGate;
  if (priceZ == null || realTrend == null) {
    policy = {
      id: "GOLD_POLICY_MISMATCH",
      active: false,
      cap: 100,
      severity: "warn",
      rationale: "Policy-Mismatch nicht bestimmbar — Preis-Historie oder DFII10-Trend fehlt",
    };
  } else if (priceZ > GOLD_HABITAT.M2_Z && realTrend > 0) {
    policy = {
      id: "GOLD_POLICY_MISMATCH",
      active: true,
      cap: 100,
      severity: "warn",
      rationale: `Hoher Preis (z=${priceZ.toFixed(2)}) bei steigendem Realzins (${realTrend.toFixed(2)} pp über ${TREND_LAG} Beobachtungen)`,
    };
  } else {
    policy = {
      id: "GOLD_POLICY_MISMATCH",
      active: false,
      cap: 100,
      severity: "warn",
      rationale: `Kein Policy-Mismatch (Preis-z=${priceZ.toFixed(2)}, Realzins-Trend ${realTrend.toFixed(2)} pp)`,
    };
  }

  const mas = latestMas(closes);
  let death: GoldModelGate;
  if (mas.ma50 == null || mas.ma200 == null) {
    death = {
      id: "GOLD_DEATH_CROSS_ACTIVE",
      active: false,
      cap: 100,
      severity: "warn",
      rationale: "Death Cross nicht bestimmbar — weniger als 200 Schlüsse",
    };
  } else if (mas.ma50 < mas.ma200) {
    death = {
      id: "GOLD_DEATH_CROSS_ACTIVE",
      active: true,
      cap: 100,
      severity: "warn",
      rationale: `Death Cross aktiv: 50-MA ${mas.ma50.toFixed(2)} < 200-MA ${mas.ma200.toFixed(2)}`,
    };
  } else {
    death = {
      id: "GOLD_DEATH_CROSS_ACTIVE",
      active: false,
      cap: 100,
      severity: "warn",
      rationale: `50-MA ${mas.ma50.toFixed(2)} liegt nicht unter der 200-MA ${mas.ma200.toFixed(2)}`,
    };
  }
  return [policy, death];
}

export function scoreGoldAdaptive(input: GoldAdaptiveInput): GoldAdaptiveScore {
  const closes = datedCloses(input.closes);
  const closeValues = closes.map(point => point.close);
  const realValues = valuesOf(input.real10Y);
  const realTrend = rawLagChange(realValues, TREND_LAG);
  const liquidity = liquiditySignals(input.m2, input.walcl, input.tga, input.rrpBillions);
  const habitat = habitatMultipliers({
    regime: input.regime,
    realRateTrendPp: realTrend,
    m2GrowthZ: liquidity.m2GrowthZ,
  });
  const layers: GoldAdaptiveLayer[] = [
    layerFrom("realYield", "Real Yield", habitat.realYield, realYieldSignals(closes, input.real10Y)),
    layerFrom("policy", "Policy", habitat.policy, policySignals(input.real10Y, input.fedFunds)),
    layerFrom("liquidity", "Liquidität", habitat.liquidity, liquidity.signals),
    layerFrom("inflation", "Inflation", habitat.inflation, [inflationSignal(input.breakeven, input.real10Y)]),
    layerFrom("supply", "Angebot", habitat.supply, [supplySignal(closes, input.aisc)]),
    layerFrom("technical", "Technik", habitat.technical, technicalSignals(closes, input.volumes, input.volumeSource)),
    layerFrom("macro", "Makro", habitat.macro, [macroSignal(input.dxy)]),
  ];
  const habitatNotes: string[] = [];
  if (habitat.realYield !== 1) habitatNotes.push("Regime Stress: Real Yield ×1,25");
  if (habitat.policy !== 1) {
    habitatNotes.push(`Realzins-Trend ${(realTrend ?? 0).toFixed(2)} pp < −0,30: Policy ×1,20`);
  }
  if (habitat.liquidity !== 1) {
    habitatNotes.push(`M2-YoY z=${(liquidity.m2GrowthZ ?? 0).toFixed(2)} > 1: Liquidität ×1,15`);
  }
  if (habitatNotes.length === 0) habitatNotes.push("kein Habitat-Multiplikator");

  const score = aggregateAdaptiveLayers(layers);
  const technicalLayer = layers.find(layer => layer.id === "technical");
  return {
    score,
    scoreDelta: goldScoreDelta(score, input.gis ?? null),
    formula: "Summe(Richtung × effectiveWeight) / Summe(effectiveWeight), nur Dimensionen mit Quelle",
    layers,
    technicalSignals: technicalLayer?.signals ?? [],
    gates: buildGates(closeValues, realValues),
    habitatNotes,
    newsFlag: input.newsFlag,
    newsInScore: false,
    volumeSource: input.volumeSource,
    generatedAt: input.now ?? new Date().toISOString(),
  };
}
