/**
 * Szenario-Kegel ab dem letzten Close (WORK_SCENARIO_CONE_STOCK.md).
 * Reine Anzeige — keine Bewertungs- oder Score-Rechnung, kein Import aus der Score-Pipeline.
 *
 * Kegelbreite: Regression von log(Kurs) auf den Handelstag über
 * CONE_PARAMS.regressionWindowDays. Der Trend ist b, die Bandbreite ist die
 * Streuung σ_η von Δlog P − b. 50-%- und 80-%-Band:
 * last · exp(b·t ± z·σ_η·√t), z aus CONE_PARAMS.confidence.
 *
 * Endpunkte Bull / Base / Bear sind Marker. Liegt keine Szenario-PoS in der
 * Response (shared/schema.ts hat kein solches Feld; Catalyst.pos und Risk.ew
 * sind je Eintrag, Monte Carlo liegt nicht in /api/analyze), kommt die
 * Wahrscheinlichkeit aus derselben Verteilung am Horizont. Geht das nicht,
 * bleibt „PoS n/a“ mit Grund. Die Platzhalter 50/30/20 werden nicht eingesetzt.
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
   * Quantile der äußeren Kegellinien. z = Φ⁻¹(Perzentil/100).
   * P10 −1.2815515655446004, P50 0, P90 +1.2815515655446004.
   * Das 80-%-Band liest |z| von P90 (Φ⁻¹(0.90)).
   */
  quantiles: {
    P10: { percentile: 10, z: -1.2815515655446004 },
    P50: { percentile: 50, z: 0 },
    P90: { percentile: 90, z: 1.2815515655446004 },
  },
  /**
   * Konfidenzbänder um den Log-Trend. z = Φ⁻¹((1 + Niveau) / 2), je Seite.
   * inner 50 % → Φ⁻¹(0.75). outer 80 % → Φ⁻¹(0.90), derselbe Betrag wie P90.
   * Der Band-Pfad liest nur diese Namen.
   */
  confidence: {
    inner: { level: 0.5, z: 0.6744897501960817 },
    outer: { level: 0.8, z: 1.2815515655446004 },
  },
  /**
   * Fenster der Regression log(Kurs) auf den Handelstag.
   * Ein Börsenjahr, dieselbe 252-Tage-Konvention wie tradingDaysPerYear.
   */
  regressionWindowDays: 252,
  /** Unter dieser Kurszahl keine Innovations-σ (mindestens ein Freiheitsgrad). */
  minRegressionPoints: 3,
  /**
   * Nenner der Innovationsstreuung: Anzahl Tages-Log-Renditen minus innovationDf.
   * b ist der eine geschätzte Drift. Die Niveaustreuung von ε wird nicht mit √t
   * multipliziert — das wäre die falsche Einheit und sprengt den Kegel.
   */
  innovationDf: 1,
  /** Relative Toleranz, wenn σ = 0 und der Pfad auf einem Ziel liegt. */
  priceMatchRel: 1e-9,
  /**
   * Unter dieser Residuen-σ gilt die Serie als ohne Streuung (Gleitkomma-Rest
   * einer flachen Log-Reihe). Kein Konfidenzniveau.
   */
  residualSigmaFloor: 1e-12,
} as const;

/** Quelle der Bänder: nur die Schlusskurse dieser Aktie bis zum Anker. */
export const CONE_SOURCE = "eigene Kurshistorie (Schlusskurse bis zum letzten Close)";

/**
 * Formel am Kegel. b aus der Regression log P = a + b·t.
 * σ_η ist die Streuung der Tages-Log-Rendite um b (Residuum der Regression,
 * nicht die Niveaustreuung von ε und nicht noch einmal mit √t als Tages-σ).
 * z aus CONE_PARAMS.confidence, t in Handelstagen ab dem Anker.
 */
export const CONE_FORMULA = "log P = a + b·t + ε; σ_η = Streuung(Δlog P − b); Band(t) = P₀·exp(b·t ± z·σ_η·√t); z = Φ⁻¹((1+Niveau)/2); PoS = Φ derselben Verteilung am Horizont";

/** Die drei Ereignisse sind keine Zerlegung. Die Summe muss nicht 100 % sein. */
export const CONE_PROBABILITY_HINT = "Einzelwahrscheinlichkeiten, Summe ≠ 100 %";

export const CONE_EVENT_LABEL = {
  bull: "P(≥ Bull-Ziel)",
  base: "P(Base ± Intervall)",
  bear: "P(≤ Bear-Ziel)",
} as const;

export const CONE_POS_SOURCE = {
  monteCarlo: "Monte Carlo S18",
  regression: "Fallback Log-Regression",
} as const;

export const CONE_POS_FORMULA = {
  monteCarloBull: "Anteil der S18-Endkurse ≥ Bull-Ziel",
  monteCarloBase: "Anteil der S18-Endkurse im Intervall Base ± 50-%-Halbband (z_inner·σ_η·√H)",
  monteCarloBear: "Anteil der S18-Endkurse ≤ Bear-Ziel",
  regression: CONE_FORMULA,
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

/**
 * last · exp(drift·t + z · σ · √t). t in Handelstagen.
 * drift = 0 ist der alte Null-Drift. σ ist die Residuenstreuung der Log-Regression
 * (oder, im Test der Hilfsfunktion, eine übergebene Tages-σ).
 */
export function coneBandPrice(last: number, sigmaDaily: number, z: number, tDays: number, driftPerDay = 0): number {
  return last * Math.exp(driftPerDay * tDays + z * sigmaDaily * Math.sqrt(tDays));
}

/** Abramowitz & Stegun 7.1.26. Maximale Abweichung etwa 1.5e-7. Kein Konfidenzniveau. */
const ERF_AS726 = {
  p: 0.3275911,
  a1: 0.254829592,
  a2: -0.284496736,
  a3: 1.421413741,
  a4: -1.453152027,
  a5: 1.061405429,
} as const;

function erfAs726(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + ERF_AS726.p * a);
  const y = 1 - (((((ERF_AS726.a5 * t + ERF_AS726.a4) * t) + ERF_AS726.a3) * t + ERF_AS726.a2) * t + ERF_AS726.a1) * t * Math.exp(-a * a);
  return sign * y;
}

/** Φ(z), Standardnormalverteilung. Für die Szenario-PoS am Horizont. */
export function standardNormalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  return 0.5 * (1 + erfAs726(z / Math.SQRT2));
}

export interface LogTrendFit {
  /** Steigung von log(Kurs) je Handelstag. null = Regression steht nicht. */
  slope: number | null;
  /**
   * Streuung von Δlog P − b. Das ist die Bandbreite je √Handelstag.
   * null = nicht berechenbar.
   */
  residualSigma: number | null;
  sample: number;
  shortHistory: boolean;
  /** null, wenn die Regression steht. Sonst der n/a-Grund. */
  reason: string | null;
}

/**
 * OLS von log(Kurs) auf den Handelstagsindex, letzte `window` positive Kurse.
 * Bandbreite = Streuung der Tages-Log-Rendite um die Steigung b.
 * Historie kürzer als das Fenster → Rechnung mit den vorhandenen Kursen, kein Auffüllen.
 */
export function fitLogPriceTrend(closes: readonly number[], window = CONE_PARAMS.regressionWindowDays): LogTrendFit {
  const positive: number[] = [];
  for (const c of closes) {
    if (typeof c === "number" && Number.isFinite(c) && c > 0) positive.push(c);
  }
  const slice = positive.slice(-window);
  const n = slice.length;
  const shortHistory = n < window;
  if (n < CONE_PARAMS.minRegressionPoints) {
    return {
      slope: null,
      residualSigma: null,
      sample: n,
      shortHistory: true,
      reason: `n/a — nur ${n} Kurse, Log-Regression braucht ${CONE_PARAMS.minRegressionPoints}`,
    };
  }
  const ys = slice.map(c => Math.log(c));
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += ys[i];
    sumXX += i * i;
    sumXY += i * ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const sxx = sumXX - n * meanX * meanX;
  const rawSlope = sxx > 0 ? (sumXY - n * meanX * meanY) / sxx : 0;
  const slope = Math.abs(rawSlope) <= CONE_PARAMS.residualSigmaFloor ? 0 : rawSlope;
  let sse = 0;
  let nRet = 0;
  for (let i = 1; i < n; i++) {
    const innovation = (ys[i] - ys[i - 1]) - slope;
    sse += innovation * innovation;
    nRet += 1;
  }
  const df = nRet - CONE_PARAMS.innovationDf;
  const rawSigma = df > 0 ? Math.sqrt(sse / df) : 0;
  const residualSigma = rawSigma <= CONE_PARAMS.residualSigmaFloor ? 0 : rawSigma;
  return { slope, residualSigma, sample: n, shortHistory, reason: null };
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
  /** null = weder Response noch Historie tragen eine Wahrscheinlichkeit. */
  probability: number | null;
  posText: string;
  /** Ereignis, nicht der Szenarioname. Die drei Werte sind keine Verteilung. */
  eventLabel: string;
  /** null bei n/a. */
  sourceLabel: string | null;
  /** Formel genau dieser Zahl. null bei n/a. */
  formula: string | null;
  /** true nur bei der Log-Regression, wenn keine S18-Ziehung mit Horizont vorliegt. */
  fallback: boolean;
  /** Handelstage der S18-Ziehung, nur wenn diese Quelle die Zahl liefert. */
  shownHorizon: number | null;
  /** Sichtbarer Text am Kegel, inklusive Horizont bei S18. */
  caption: string;
  /** null, wenn probability eine Zahl ist. Sonst der n/a-Grund. */
  posReason: string | null;
}

export interface ConePoint {
  t: number;
  date: string;
  /** Untere Kante des 80-%-Bands. */
  p10: number;
  /** Trend = Anker · exp(b·t). */
  p50: number;
  /** Obere Kante des 80-%-Bands. */
  p90: number;
  /** Untere / obere Kante des 50-%-Bands. */
  innerLow: number;
  innerHigh: number;
}

export interface ScenarioCone {
  anchorPrice: number;
  anchorDate: string;
  /** Residuen-σ der Log-Regression. null = Regression steht nicht. */
  sigmaDaily: number | null;
  /** Steigung b von log(Kurs) je Handelstag. null = Regression steht nicht. */
  driftPerDay: number | null;
  volSample: number;
  shortHistory: boolean;
  /** null, wenn die Bänder stehen. Sonst der n/a-Grund. */
  bandReason: string | null;
  source: string;
  formula: string;
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
  /**
   * Szenario-PoS als Anteil 0–1.
   * null = aus der Log-Regression am Horizont ableiten (kein 50/30/20-Platzhalter).
   */
  probabilityBull: number | null;
  probabilityBase: number | null;
  probabilityBear: number | null;
  /** Handelstage aus der Response. null = kein Vorlauf, nur der Anker. */
  horizonDays: number | null;
  /** S17 bleibt für den Horizont-Median der Timelines. PoS wird daraus nicht summiert. */
  catalysts?: readonly ConeCatalyst[] | null;
  /**
   * S18-Ziehung. Endkurse allein reichen nicht: ohne horizonDays aus dem
   * Ergebnis bleibt der Kegel beim Katalysator-Horizont und die PoS fällt
   * auf die Log-Regression. Kein festes 252 im Kegel.
   */
  monteCarlo?: ConeMonteCarlo | null;
}

export interface ConeMonteCarlo {
  terminalPrices?: readonly number[] | null;
  horizonDays?: number | null;
}

export interface ConeCatalyst {
  pos?: number | null;
  direction?: string | null;
  flag?: string | null;
  bruttoUpside?: number | null;
  newsSentiment?: string | null;
  tags?: readonly string[] | null;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function markerCaption(id: ScenarioMarkerId, posText: string, shownHorizon: number | null, fallback: boolean): string {
  const horizon = shownHorizon != null ? ` · ${shownHorizon} Handelstage` : "";
  const fb = fallback ? " · Fallback" : "";
  return `${CONE_EVENT_LABEL[id]} ${posText}${horizon}${fb}`;
}

function marker(
  id: ScenarioMarkerId,
  price: number | null,
  probability: number | null,
  posReason: string | null,
  sourceLabel: string | null,
  formula: string | null,
  fallback: boolean,
  shownHorizon: number | null,
): ScenarioMarker {
  const usable = price != null && Number.isFinite(price) ? price : null;
  const p = probability != null && Number.isFinite(probability) ? probability : null;
  const useFallback = p != null && fallback;
  const horizon = p != null ? shownHorizon : null;
  const posText = formatPos(p);
  return {
    id,
    name: MARKER_NAME[id],
    price: usable,
    probability: p,
    posText,
    eventLabel: CONE_EVENT_LABEL[id],
    sourceLabel: p == null ? null : sourceLabel,
    formula: p == null ? null : formula,
    fallback: useFallback,
    shownHorizon: horizon,
    caption: markerCaption(id, posText, horizon, useFallback),
    posReason: p == null ? posReason : null,
  };
}

function unitProbability(p: number | null): number | null {
  if (p == null || !Number.isFinite(p) || p < 0 || p > 1) return null;
  return p;
}

/** Preisintervall Base ± 50-%-Halbband. σ oder Horizont fehlt → null. */
export function baseIntervalPrices(base: number | null, sigma: number | null, horizon: number): { low: number | null; high: number | null } {
  if (base == null || !(base > 0) || sigma == null || !(horizon > 0)) return { low: null, high: null };
  const half = CONE_PARAMS.confidence.inner.z * sigma * Math.sqrt(horizon);
  return { low: base * Math.exp(-half), high: base * Math.exp(half) };
}

/**
 * Anteile einer S18-Ziehung. Bull, Base und Bear je für sich, keine Normierung auf 1.
 * Leere Ziehung → null.
 */
export function monteCarloScenarioShares(
  terminals: readonly number[] | null | undefined,
  targets: { bull: number | null; bear: number | null; baseLow: number | null; baseHigh: number | null },
): Record<ScenarioMarkerId, number | null> {
  const empty = { bull: null, base: null, bear: null };
  const xs = (terminals ?? []).filter(v => typeof v === "number" && Number.isFinite(v));
  if (xs.length === 0) return empty;
  const n = xs.length;
  const share = (pred: (v: number) => boolean) => xs.reduce((s, v) => s + (pred(v) ? 1 : 0), 0) / n;
  return {
    bull: targets.bull != null && targets.bull > 0 ? share(v => v >= targets.bull!) : null,
    bear: targets.bear != null && targets.bear > 0 ? share(v => v <= targets.bear!) : null,
    base: targets.baseLow != null && targets.baseHigh != null
      ? share(v => v >= targets.baseLow! && v <= targets.baseHigh!)
      : null,
  };
}

function pricesMatch(a: number, b: number): boolean {
  const tol = Math.max(CONE_PARAMS.priceMatchRel, Math.abs(b) * CONE_PARAMS.priceMatchRel);
  return Math.abs(a - b) <= tol;
}

/**
 * PoS aus der Log-Normalverteilung am Horizont.
 * Bull = P(P_H ≥ Ziel), Bear = P(P_H ≤ Ziel),
 * Base = P(P_H im 50-%-breiten Intervall um das Base-Ziel).
 * Eine übergebene Wahrscheinlichkeit bleibt stehen. Fehlt das Ziel oder die
 * Regression, bleibt null und posReason nennt den Grund.
 */
export function scenarioProbability(
  kind: ScenarioMarkerId,
  price: number | null,
  anchor: number,
  slope: number | null,
  sigma: number | null,
  horizon: number,
): { probability: number | null; reason: string | null } {
  if (price == null || !Number.isFinite(price)) {
    const why = kind === "bull" ? "kein Forward-Konsens" : kind === "base" ? "g* fehlt" : "kein Expected Damage";
    return { probability: null, reason: `n/a — ${why}` };
  }
  if (!(price > 0)) return { probability: null, reason: "n/a — Zielkurs nicht positiv" };
  if (slope == null || sigma == null) return { probability: null, reason: "n/a — Log-Regression nicht berechenbar" };
  if (!(horizon > 0)) return { probability: null, reason: "n/a — kein Horizont aus den Katalysator-Timelines" };
  const path = anchor * Math.exp(slope * horizon);
  if (sigma === 0) {
    if (kind === "bull") return { probability: path >= price || pricesMatch(path, price) ? 1 : 0, reason: null };
    if (kind === "bear") return { probability: path <= price || pricesMatch(path, price) ? 1 : 0, reason: null };
    return { probability: pricesMatch(path, price) ? 1 : 0, reason: null };
  }
  const scale = sigma * Math.sqrt(horizon);
  const z = (Math.log(price / anchor) - slope * horizon) / scale;
  if (kind === "bull") return { probability: 1 - standardNormalCdf(z), reason: null };
  if (kind === "bear") return { probability: standardNormalCdf(z), reason: null };
  const half = CONE_PARAMS.confidence.inner.z;
  return { probability: standardNormalCdf(z + half) - standardNormalCdf(z - half), reason: null };
}

export function buildScenarioCone(input: ScenarioConeInput): ScenarioCone | null {
  const last = input.anchorPrice;
  if (!Number.isFinite(last) || last <= 0 || !input.anchorDate) return null;
  const fit = fitLogPriceTrend(input.closes, CONE_PARAMS.regressionWindowDays);
  const horizon = input.horizonDays != null && input.horizonDays > 0 ? input.horizonDays : 0;
  const zOuter = CONE_PARAMS.confidence.outer.z;
  const zInner = CONE_PARAMS.confidence.inner.z;
  const canFan = fit.residualSigma != null && fit.slope != null && horizon > 0;
  const dates = canFan ? addTradingDays(input.anchorDate, horizon) : [];
  const steps = canFan ? horizon : 0;
  const slope = fit.slope ?? 0;
  const sigma = fit.residualSigma ?? 0;
  const points: ConePoint[] = [];
  for (let t = 0; t <= steps; t++) {
    const date = t === 0 ? input.anchorDate.slice(0, 10) : dates[t - 1];
    points.push({
      t,
      date,
      p10: coneBandPrice(last, sigma, -zOuter, t, slope),
      p50: coneBandPrice(last, sigma, 0, t, slope),
      p90: coneBandPrice(last, sigma, zOuter, t, slope),
      innerLow: coneBandPrice(last, sigma, -zInner, t, slope),
      innerHigh: coneBandPrice(last, sigma, zInner, t, slope),
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
  const explicit: Record<ScenarioMarkerId, number | null> = {
    bull: input.probabilityBull,
    base: input.probabilityBase,
    bear: input.probabilityBear,
  };
  const prices: Record<ScenarioMarkerId, number | null> = { bull: bullPrice, base: basePrice, bear: bearPrice };
  const band = baseIntervalPrices(basePrice, fit.residualSigma, horizon);
  const mc = monteCarloScenarioShares(input.monteCarlo?.terminalPrices, {
    bull: bullPrice,
    bear: bearPrice,
    baseLow: band.low,
    baseHigh: band.high,
  });
  const mcHorizon = input.monteCarlo?.horizonDays != null && input.monteCarlo.horizonDays > 0 ? input.monteCarlo.horizonDays : null;
  const markers = MARKER_ORDER.map(id => {
    const given = explicit[id];
    if (given != null && Number.isFinite(given)) return marker(id, prices[id], given, null, null, null, false, null);
    const mcShare = unitProbability(mc[id]);
    if (mcHorizon != null && mcShare != null) {
      const baseFormula = id === "bull" ? CONE_POS_FORMULA.monteCarloBull : id === "bear" ? CONE_POS_FORMULA.monteCarloBear : CONE_POS_FORMULA.monteCarloBase;
      return marker(id, prices[id], mcShare, null, CONE_POS_SOURCE.monteCarlo, `${baseFormula} · Horizont ${mcHorizon} Handelstage`, false, mcHorizon);
    }
    const derived = scenarioProbability(id, prices[id], last, fit.slope, fit.residualSigma, horizon);
    const reg = unitProbability(derived.probability);
    if (reg != null) {
      return marker(id, prices[id], reg, null, CONE_POS_SOURCE.regression, CONE_POS_FORMULA.regression, true, null);
    }
    return marker(id, prices[id], null, derived.reason, null, null, false, null);
  });
  return {
    anchorPrice: last,
    anchorDate: input.anchorDate.slice(0, 10),
    sigmaDaily: fit.residualSigma,
    driftPerDay: fit.slope,
    volSample: fit.sample,
    shortHistory: fit.shortHistory,
    bandReason: fit.reason,
    source: CONE_SOURCE,
    formula: CONE_FORMULA,
    horizonDays: horizon,
    points,
    markers,
  };
}

export interface ConeAnalysisInput {
  ohlcvData?: readonly { date: string; close: number }[] | null;
  historicalPrices?: readonly { date: string; close: number }[] | null;
  impliedGStar?: number | null;
  scoring?: { gateInputs?: { impliedGrowthPercent?: number | null } } | null;
  analystPT?: { median?: number | null } | null;
  risks?: readonly { expectedDamage?: number | null }[] | null;
  catalysts?: readonly (ConeCatalyst & { timeline?: string | null })[] | null;
  /** Steht nur, wenn die Response selbst Endkurse trägt. Sonst null. */
  monteCarlo?: ConeMonteCarlo | null;
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

function usableMonteCarlo(mc: ConeMonteCarlo | null | undefined): { terminalPrices: readonly number[]; horizonDays: number } | null {
  const prices = mc?.terminalPrices;
  const horizon = mc?.horizonDays;
  if (!prices || prices.length === 0) return null;
  if (horizon == null || !Number.isFinite(horizon) || horizon <= 0) return null;
  return { terminalPrices: prices, horizonDays: horizon };
}

export function scenarioConeFromAnalysis(
  data: ConeAnalysisInput,
  anchor: { date: string; close: number },
  monteCarlo?: ConeMonteCarlo | null,
): ScenarioCone | null {
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
  const fromResponse = usableMonteCarlo(data.monteCarlo);
  const fromSection = usableMonteCarlo(monteCarlo);
  const chosen = fromResponse ?? fromSection;
  return buildScenarioCone({
    closes: closes.length > 0 ? closes : [anchor.close],
    anchorPrice: anchor.close,
    anchorDate: anchor.date,
    gStarPct: gStar,
    forwardConsensusPrice: finiteOrNull(data.analystPT?.median),
    expectedDamagePct: damage,
    // Kein Bull/Base/Bear-PoS-Feld in StockAnalysis. S18 nur mit Endkursen und Horizont aus dem Ergebnis, sonst Log-Regression.
    probabilityBull: null,
    probabilityBase: null,
    probabilityBear: null,
    horizonDays: chosen ? chosen.horizonDays : horizonTradingDays(timelines),
    catalysts: data.catalysts ?? null,
    monteCarlo: chosen,
  });
}

export interface ConePlotFields {
  coneP10?: number | null;
  coneP50?: number | null;
  coneP90?: number | null;
  coneInnerLow?: number | null;
  coneInnerHigh?: number | null;
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
    const label = m.caption;
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
      coneInnerLow: anchor.innerLow,
      coneInnerHigh: anchor.innerHigh,
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
      coneInnerLow: pt.innerLow,
      coneInnerHigh: pt.innerHigh,
      ...(isEnd ? endMarkers : EMPTY_MARKERS),
    } as unknown as T & ConePlotFields);
  }
  return out;
}

/** Werte, die die Preisachse zusätzlich aufnehmen muss. 0-Ersatzziele sind nicht dabei. */
export function coneDomainValues(cone: ScenarioCone): number[] {
  const out: number[] = [];
  for (const p of cone.points) {
    for (const v of [p.p10, p.p50, p.p90, p.innerLow, p.innerHigh]) {
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
 * 1 = unverändert. >1 verlängert die Fläche.
 * TechnicalChart setzt CONE_VIEWPORT_SCALE = 1 und ruft diese Funktion nicht auf:
 * eine Skala > 1 schiebt den Kegel aus dem sichtbaren Scrollport. Die Funktion bleibt.
 */
export function conePlotScale(historyCount: number, forwardCount: number): number {
  if (!(historyCount > 0) || !(forwardCount > 0)) return 1;
  return (historyCount + forwardCount) / historyCount;
}

/** Ein Label in Pixeln. yPx ist die Mitte, x wächst nach rechts, y nach unten. */
export interface LabelBox {
  id: string;
  xPx: number;
  widthPx: number;
  yPx: number;
  /** Höhe der Schrift (em). Daraus ergibt sich der nötige Abstand, nicht aus einem festen Pixelwert. */
  heightPx: number;
  /** true = bleibt liegen (Dividenden-Label). Kegel-Labels weichen aus. */
  fixed?: boolean;
}

function boxesOverlapX(a: LabelBox, b: LabelBox): boolean {
  return a.xPx < b.xPx + b.widthPx && b.xPx < a.xPx + a.widthPx;
}

/**
 * Tester-FAIL #359: Kegel- und Dividenden-Labels überlappen bei 1440 px.
 * Liegen zwei Boxen horizontal übereinander und ist der Pixelabstand ihrer
 * Mitten kleiner als die halbe Summe ihrer Höhen, rückt das untere Label
 * um genau diesen Fehlbetrag nach unten. Ist das untere fest (Dividende),
 * rückt das obere um denselben Fehlbetrag nach oben. Kein zusätzlicher Rand.
 */
export function separateLabelYs(items: readonly LabelBox[]): { id: string; yPx: number }[] {
  const placed = items
    .filter(it => Number.isFinite(it.xPx) && Number.isFinite(it.widthPx) && it.widthPx > 0
      && Number.isFinite(it.yPx) && Number.isFinite(it.heightPx) && it.heightPx > 0)
    .map(it => ({ ...it }));
  const steps = placed.length * placed.length;
  for (let step = 0; step < steps; step++) {
    placed.sort((a, b) => a.yPx - b.yPx || a.id.localeCompare(b.id));
    let moved = false;
    for (let i = 0; i < placed.length - 1; i++) {
      const a = placed[i];
      const b = placed[i + 1];
      if (!boxesOverlapX(a, b)) continue;
      const required = (a.heightPx + b.heightPx) / 2;
      const dist = b.yPx - a.yPx;
      if (dist >= required) continue;
      const deficit = required - dist;
      if (!b.fixed) b.yPx += deficit;
      else if (!a.fixed) a.yPx -= deficit;
      else continue;
      moved = true;
      break;
    }
    if (!moved) break;
  }
  return placed.map(p => ({ id: p.id, yPx: p.yPx }));
}
