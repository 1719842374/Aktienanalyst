/**
 * Szenario-Kegel ab dem letzten Close (WORK_SCENARIO_CONE_STOCK.md).
 * Reine Anzeige — keine Bewertungs- oder Score-Rechnung, kein Import aus der Score-Pipeline.
 *
 * Kegelbreite: σ_daily aus den letzten CONE_PARAMS.volWindowDays Schlusskursen,
 * Band = last · exp(z · σ_daily · √t). z steht in CONE_PARAMS.quantiles (P10/P50/P90).
 *
 * Endpunkte Bull / Base / Bear sind Marker. Wahrscheinlichkeiten nur, wenn die
 * Response sie als Szenario-PoS trägt. shared/schema.ts hat kein solches Feld
 * (Catalyst.pos und Risk.ew sind je Eintrag, Monte Carlo liegt nicht in
 * /api/analyze). Fehlt die Wahrscheinlichkeit → „PoS n/a“, ohne Prozentzeichen.
 * Die Platzhalter 50/30/20 werden nicht eingesetzt.
 *
 * Herkunft der Fenster: Philip 01.11.2026 12:36 — Schwellen aus den Daten
 * (Median der Katalysator-Horizonte), Gewichte/Fenster nur als benannte
 * Konstanten. volWindowDays = 63 = ein Quartal des Börsenjahrs.
 * tradingDaysPerYear = dieselbe 252-Tage-Konvention wie die GBM in calculations.ts.
 */

export const CONE_PARAMS = {
  /** Börsenjahr, identisch zu Δt = 1/252 in client/src/lib/calculations.ts. */
  tradingDaysPerYear: 252,
  monthsPerYear: 12,
  /** Nenner für das Quartalsfenster: volWindowDays = tradingDaysPerYear / quartersPerYear. */
  quartersPerYear: 4,
  /**
   * σ-Fenster in Handelstagen. 63 = ein Quartal (tradingDaysPerYear / quartersPerYear).
   * Der Band-Pfad liest nur diesen Namen.
   */
  volWindowDays: 63,
  /**
   * g* und Expected Damage stehen in der Analyse-Response in Prozent
   * (impliedGStar, risks[].expectedDamage), nicht als Dezimal.
   */
  percent: 100,
  /**
   * Quantile der Kegelbänder. z = Φ⁻¹(Perzentil/100), Standardnormalverteilung.
   * P10 −1.2815515655446004, P50 0, P90 +1.2815515655446004.
   * Der Band-Pfad liest nur diese z-Parameter.
   */
  quantiles: {
    P10: { percentile: 10, z: -1.2815515655446004 },
    P50: { percentile: 50, z: 0 },
    P90: { percentile: 90, z: 1.2815515655446004 },
  },
} as const;

export type ConeBand = keyof typeof CONE_PARAMS.quantiles;

export const CONE_STYLE = {
  band: "#64748b",
  bull: "#22c55e",
  base: "#38bdf8",
  bear: "#ef4444",
} as const;

export const POS_NA = "PoS n/a";

const MARKER_ORDER = ["bull", "base", "bear"] as const;
export type ScenarioMarkerId = (typeof MARKER_ORDER)[number];

const MARKER_NAME: Record<ScenarioMarkerId, string> = {
  bull: "Bull",
  base: "Base",
  bear: "Bear",
};

/** z des Quantils aus CONE_PARAMS. Kein zweiter Rechenweg. */
export function bandZ(band: ConeBand): number {
  return CONE_PARAMS.quantiles[band].z;
}

/** last · exp(z · σ_daily · √t). t in Handelstagen, σ daily (nicht annualisiert). */
export function coneBandPrice(last: number, sigmaDaily: number, z: number, tDays: number): number {
  return last * Math.exp(z * sigmaDaily * Math.sqrt(tDays));
}

export interface SigmaEstimate {
  /** null, wenn weniger als zwei positive Schlusskurse vorliegen. */
  sigma: number | null;
  /** Anzahl Kurse im Fenster (gekürzt, wenn die Historie kürzer als volWindowDays ist). */
  sample: number;
  shortHistory: boolean;
}

/**
 * σ_daily = Populations-Standardabweichung der Log-Returns
 * (dieselbe /n-Konvention wie calculateGBMParams), letzte `window` positive Kurse.
 * Historie kürzer als das Fenster → σ aus den vorhandenen Kursen, kein Auffüllen.
 */
export function realizedSigmaDaily(closes: readonly number[], window = CONE_PARAMS.volWindowDays): SigmaEstimate {
  const positive: number[] = [];
  for (const c of closes) {
    if (typeof c === "number" && Number.isFinite(c) && c > 0) positive.push(c);
  }
  const slice = positive.slice(-window);
  const shortHistory = slice.length < window;
  if (slice.length < 2) return { sigma: null, sample: slice.length, shortHistory };
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
  let mean = 0;
  for (const r of rets) mean += r;
  mean /= rets.length;
  let variance = 0;
  for (const r of rets) variance += (r - mean) ** 2;
  variance /= rets.length;
  return { sigma: Math.sqrt(variance), sample: slice.length, shortHistory };
}

/** Median der oberen Monatsgrenze aus Katalysator-Timelines („6-12M“, „12M“). Kein Default-Horizont. */
export function horizonTradingDays(timelines: readonly (string | null | undefined)[]): number | null {
  const months: number[] = [];
  for (const raw of timelines) {
    if (!raw) continue;
    const range = raw.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*M/i);
    if (range) {
      months.push(Number(range[2]));
      continue;
    }
    const single = raw.match(/(\d+(?:\.\d+)?)\s*M/i);
    if (single) months.push(Number(single[1]));
  }
  if (months.length === 0) return null;
  const sorted = [...months].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (!Number.isFinite(median) || median <= 0) return null;
  const days = Math.round(median * CONE_PARAMS.tradingDaysPerYear / CONE_PARAMS.monthsPerYear);
  return days > 0 ? days : null;
}

/** Nächste `count` Handelstage nach `iso` (Sa/So ausgelassen). Reine Zeitachse, keine Feiertagsquelle. */
export function addTradingDays(iso: string, count: number): string[] {
  const out: string[] = [];
  if (!iso || count <= 0) return out;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return out;
  while (out.length < count) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function formatPos(probability: number | null | undefined): string {
  if (probability == null || !Number.isFinite(probability)) return POS_NA;
  const pct = Math.round(probability * CONE_PARAMS.percent * 10) / 10;
  return Number.isInteger(pct) ? `${pct.toFixed(0)}%` : `${pct.toFixed(1)}%`;
}

export interface ScenarioMarker {
  id: ScenarioMarkerId;
  name: string;
  /** null = kein Ziel in der Response (nicht 0 als Ersatz). */
  price: number | null;
  /** null = Response trägt keine Szenario-Wahrscheinlichkeit. */
  probability: number | null;
  posText: string;
}

export interface ConePoint {
  t: number;
  date: string;
  p10: number;
  p50: number;
  p90: number;
}

export interface ScenarioCone {
  anchorPrice: number;
  anchorDate: string;
  sigmaDaily: number | null;
  volSample: number;
  shortHistory: boolean;
  horizonDays: number;
  points: ConePoint[];
  markers: ScenarioMarker[];
}

export interface ScenarioConeInput {
  /** Chronologische Schlusskurse bis einschließlich Anker, Listing-Währung. */
  closes: readonly number[];
  anchorPrice: number;
  anchorDate: string;
  /** g* in Prozent (impliedGStar). null = kein Base-Marker. */
  gStarPct: number | null;
  /**
   * Forward-Konsens als Kurs (analystPT.median), dieselbe Währung wie der Close.
   * 0 = in dieser Response „kein Ziel“ (FMP-Leerwert), nicht ein Ziel bei 0.
   */
  forwardConsensusPrice: number | null;
  /** Summe risks[].expectedDamage in Prozent. null = kein Bear-Marker. */
  expectedDamagePct: number | null;
  /** Szenario-PoS als Anteil 0–1. null = fehlt. */
  probabilityBull: number | null;
  probabilityBase: number | null;
  probabilityBear: number | null;
  /** Handelstage aus der Response. null = kein Vorlauf, nur der Anker. */
  horizonDays: number | null;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function marker(id: ScenarioMarkerId, price: number | null, probability: number | null): ScenarioMarker {
  const usable = price != null && Number.isFinite(price) ? price : null;
  return {
    id,
    name: MARKER_NAME[id],
    price: usable,
    probability: probability != null && Number.isFinite(probability) ? probability : null,
    posText: formatPos(probability),
  };
}

export function buildScenarioCone(input: ScenarioConeInput): ScenarioCone | null {
  const last = input.anchorPrice;
  if (!Number.isFinite(last) || last <= 0 || !input.anchorDate) return null;
  const est = realizedSigmaDaily(input.closes, CONE_PARAMS.volWindowDays);
  const horizon = input.horizonDays != null && input.horizonDays > 0 ? input.horizonDays : 0;
  const z10 = bandZ("P10");
  const z50 = bandZ("P50");
  const z90 = bandZ("P90");
  const dates = est.sigma != null && horizon > 0 ? addTradingDays(input.anchorDate, horizon) : [];
  const steps = est.sigma != null ? horizon : 0;
  const points: ConePoint[] = [];
  for (let t = 0; t <= steps; t++) {
    const date = t === 0 ? input.anchorDate.slice(0, 10) : dates[t - 1];
    const sigma = est.sigma ?? 0;
    points.push({
      t,
      date,
      p10: coneBandPrice(last, sigma, z10, t),
      p50: coneBandPrice(last, sigma, z50, t),
      p90: coneBandPrice(last, sigma, z90, t),
    });
  }
  const bullPrice = input.forwardConsensusPrice != null
    && Number.isFinite(input.forwardConsensusPrice)
    && input.forwardConsensusPrice !== 0
    ? input.forwardConsensusPrice
    : null;
  const basePrice = input.gStarPct != null && Number.isFinite(input.gStarPct)
    ? last * (1 + input.gStarPct / CONE_PARAMS.percent)
    : null;
  const bearPrice = input.expectedDamagePct != null && Number.isFinite(input.expectedDamagePct)
    ? last * (1 - input.expectedDamagePct / CONE_PARAMS.percent)
    : null;
  return {
    anchorPrice: last,
    anchorDate: input.anchorDate.slice(0, 10),
    sigmaDaily: est.sigma,
    volSample: est.sample,
    shortHistory: est.shortHistory,
    horizonDays: horizon,
    points,
    markers: [
      marker("bull", bullPrice, input.probabilityBull),
      marker("base", basePrice, input.probabilityBase),
      marker("bear", bearPrice, input.probabilityBear),
    ],
  };
}

export interface ConeAnalysisInput {
  ohlcvData?: readonly { date: string; close: number }[] | null;
  historicalPrices?: readonly { date: string; close: number }[] | null;
  impliedGStar?: number | null;
  scoring?: { gateInputs?: { impliedGrowthPercent?: number | null } } | null;
  analystPT?: { median?: number | null } | null;
  risks?: readonly { expectedDamage?: number | null }[] | null;
  catalysts?: readonly { timeline?: string | null }[] | null;
}

/**
 * Schlüsse bis zum Anker-Datum. Der Anker ist der letzte gezeichnete Close
 * (Listing-Währung, keine FX). σ aus diesem Verlauf, nicht aus einem anderen Maßstab.
 */
export function closesUntil(series: readonly { date: string; close: number }[], anchorDate: string): number[] {
  const day = anchorDate.slice(0, 10);
  let end = -1;
  for (let i = 0; i < series.length; i++) {
    if (series[i]?.date?.slice(0, 10) === day) end = i;
  }
  const slice = end >= 0 ? series.slice(0, end + 1) : series;
  return slice.map(p => p.close);
}

export function scenarioConeFromAnalysis(data: ConeAnalysisInput, anchor: { date: string; close: number }): ScenarioCone | null {
  const ohlcv = data.ohlcvData;
  const series = ohlcv && ohlcv.length > 0 ? ohlcv : (data.historicalPrices ?? []);
  const closes = closesUntil(series, anchor.date);
  const gFromScore = data.scoring?.gateInputs?.impliedGrowthPercent;
  const gStar = finiteOrNull(data.impliedGStar) ?? finiteOrNull(gFromScore);
  let damage: number | null = null;
  if (Array.isArray(data.risks) && data.risks.length > 0) {
    let sum = 0;
    let any = false;
    for (const r of data.risks) {
      const v = finiteOrNull(r?.expectedDamage);
      if (v != null) {
        sum += v;
        any = true;
      }
    }
    if (any) damage = sum;
  }
  const timelines = Array.isArray(data.catalysts) ? data.catalysts.map(c => c?.timeline) : [];
  return buildScenarioCone({
    closes: closes.length > 0 ? closes : [anchor.close],
    anchorPrice: anchor.close,
    anchorDate: anchor.date,
    gStarPct: gStar,
    forwardConsensusPrice: finiteOrNull(data.analystPT?.median),
    expectedDamagePct: damage,
    // Kein Bull/Base/Bear-PoS-Feld in StockAnalysis. Nicht aus 50/30/20 und nicht aus der Summe von Catalyst.pos.
    probabilityBull: null,
    probabilityBase: null,
    probabilityBear: null,
    horizonDays: horizonTradingDays(timelines),
  });
}

export interface ConePlotFields {
  coneP10?: number | null;
  coneP50?: number | null;
  coneP90?: number | null;
  coneBull?: number | null;
  coneBase?: number | null;
  coneBear?: number | null;
  coneBullLabel?: string | null;
  coneBaseLabel?: string | null;
  coneBearLabel?: string | null;
}

function markerPlot(cone: ScenarioCone): Required<Pick<ConePlotFields, "coneBull" | "coneBase" | "coneBear" | "coneBullLabel" | "coneBaseLabel" | "coneBearLabel">> {
  const blank: Required<Pick<ConePlotFields, "coneBull" | "coneBase" | "coneBear" | "coneBullLabel" | "coneBaseLabel" | "coneBearLabel">> = {
    coneBull: null, coneBase: null, coneBear: null, coneBullLabel: null, coneBaseLabel: null, coneBearLabel: null,
  };
  for (const m of cone.markers) {
    if (m.price == null || !Number.isFinite(m.price)) continue;
    const label = `${m.name} · ${m.posText}`;
    if (m.id === "bull") { blank.coneBull = m.price; blank.coneBullLabel = label; }
    else if (m.id === "base") { blank.coneBase = m.price; blank.coneBaseLabel = label; }
    else { blank.coneBear = m.price; blank.coneBearLabel = label; }
  }
  return blank;
}

const EMPTY_MARKERS: ReturnType<typeof markerPlot> = {
  coneBull: null, coneBase: null, coneBear: null,
  coneBullLabel: null, coneBaseLabel: null, coneBearLabel: null,
};

/**
 * Hängt den Kegel an den letzten Punkt. t = 0 liegt auf diesem Close
 * (P10 = P50 = P90 = Close). Zukunftspunkte haben close = null, damit die
 * Kurslinie nicht in den Kegel weiterläuft. cone = null → dasselbe Array.
 */
export function attachConeSeries<T extends { date: string; close: number }>(
  points: T[],
  cone: ScenarioCone | null,
): Array<T & ConePlotFields> {
  if (!cone || points.length === 0 || cone.points.length === 0) return points as Array<T & ConePlotFields>;
  const anchor = cone.points[0];
  const future = cone.points.slice(1);
  const endMarkers = markerPlot(cone);
  const out: Array<T & ConePlotFields> = points.map((p, i) => {
    if (i !== points.length - 1) return p as T & ConePlotFields;
    return {
      ...p,
      coneP10: anchor.p10,
      coneP50: anchor.p50,
      coneP90: anchor.p90,
      ...(future.length === 0 ? endMarkers : EMPTY_MARKERS),
    };
  });
  for (let i = 0; i < future.length; i++) {
    const pt = future[i];
    const isEnd = i === future.length - 1;
    out.push({
      date: pt.date,
      close: null as unknown as number,
      volume: 0,
      _volNorm: 0,
      _volUp: false,
      _signals: null,
      coneP10: pt.p10,
      coneP50: pt.p50,
      coneP90: pt.p90,
      ...(isEnd ? endMarkers : EMPTY_MARKERS),
    } as unknown as T & ConePlotFields);
  }
  return out;
}

/** Werte, die die Preisachse zusätzlich aufnehmen muss. 0-Ersatzziele sind nicht dabei. */
export function coneDomainValues(cone: ScenarioCone): number[] {
  const out: number[] = [];
  for (const p of cone.points) {
    for (const v of [p.p10, p.p50, p.p90]) {
      if (Number.isFinite(v)) out.push(v);
    }
  }
  for (const m of cone.markers) {
    if (m.price != null && Number.isFinite(m.price)) out.push(m.price);
  }
  return out;
}

/**
 * Plot-Breite relativ zum Chart ohne Kegel.
 * 1 = unverändert. >1 verlängert die Fläche, damit die Historie nicht gestaucht wird.
 */
export function conePlotScale(historyCount: number, forwardCount: number): number {
  if (!(historyCount > 0) || !(forwardCount > 0)) return 1;
  return (historyCount + forwardCount) / historyCount;
}
