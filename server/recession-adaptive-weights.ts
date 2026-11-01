/**
 * Future_9 §4 — calculateAdaptiveWeights für den Rezessions-Makro-Layer.
 *
 * Basisgewichte, Habitat „restrictive“ und der Stärke-Layer sind benannte
 * Parameter (dieselbe Form wie GOLD_ADAPTIVE_BASE_WEIGHTS / GOLD_HABITAT /
 * GOLD_EFFECTIVE_WEIGHT). Die Konzentrationsgrenze ist kein festes Level.
 * Sie ist das Perzentil der eigenen Konzentrationsreihe. Fehlt die Reihe
 * oder der aktuelle Druck, bleibt der Aufschlag aus und der Text sagt n/a.
 *
 * Der Stärke-Layer gilt einmal je Dimension (Mittel der Stärken), wie der
 * Gold-Layer effectiveWeight. Ein Produkt über jeden Indikator würde die
 * Gewichte mit der Indikatorzahl schrumpfen.
 *
 * Diese Gewichte ändern die Live-P nicht. Die Schatten-P rechnet dieselbe
 * Formel nur zum Vergleich.
 */
import { percentile } from "../shared/recession-rest-overlays";
import type {
  RecessionAdaptiveLayerView,
  RecessionHabitatRegime,
  RecessionMacroDimension,
} from "../shared/recession-adaptive";

export const RECESSION_MACRO_BASE_WEIGHTS = {
  bewertung: 1.8,
  kredit: 1.2,
  realwirtschaft: 1.0,
  geldpolitik: 1.0,
  sentiment: 0.8,
  managing: 1.5,
  widersprueche: 1.3,
} as const;

/** Future_9 §4, nur im Habitat „restrictive“. Andere Dimensionen bleiben ×1. */
export const RECESSION_HABITAT_RESTRICTIVE = {
  bewertung: 1.3,
  managing: 1.2,
  geldpolitik: 1.2,
} as const;

/** Aufschlag auf Bewertung, wenn die Konzentration über ihrer eigenen Grenze liegt. */
export const RECESSION_CONCENTRATION_BEWERTUNG = 1.15;

/** effective = Basis × Habitat × (FLOOR + Stärke × SPAN), Stärke in [0, 1]. */
export const RECESSION_STRENGTH_LAYER = { FLOOR: 0.7, SPAN: 0.6 } as const;

/**
 * Perzentil der eigenen Reihe (0–100, gleiche Skala wie percentile()
 * in shared/recession-rest-overlays.ts). Das ist der benannte Parameter.
 * Das Level selbst kommt aus den Daten.
 */
export const CONCENTRATION_LIMIT_PERCENTILE = 75;

/**
 * Unter dieser Länge setzt ein Perzentil keine Grenze.
 * Dieselbe Untergrenze wie der adaptive z-Score (Z_HISTORY_MIN im Gold-Layer).
 */
export const CONCENTRATION_HISTORY_MIN = 30;

export const RECESSION_MACRO_LABELS: Record<RecessionMacroDimension, string> = {
  bewertung: "Bewertung",
  kredit: "Kredit",
  realwirtschaft: "Realwirtschaft",
  geldpolitik: "Geldpolitik",
  sentiment: "Sentiment",
  managing: "Managing",
  widersprueche: "Widersprüche",
};

export const RECESSION_MACRO_DIMENSIONS = Object.keys(RECESSION_MACRO_BASE_WEIGHTS) as RecessionMacroDimension[];

/** Indikatorname aus server/recession.ts → Dimension. Unbekannte Namen bleiben bei ihrem Live-Gewicht. */
export const RECESSION_INDICATOR_DIMENSION: Record<string, RecessionMacroDimension> = {
  "Buffett Indikator (TMC/GDP)": "bewertung",
  "Shiller CAPE": "bewertung",
  "Kreditspreads (BAA-Trs)": "kredit",
  "Margin Debt": "kredit",
  "Sahm-Regel": "realwirtschaft",
  "Aktivität (IP / Auslastung)": "realwirtschaft",
  "Durable Goods (YoY)": "realwirtschaft",
  "Inv. Zinskurve (10Y-2Y)": "geldpolitik",
  "M2 Geldmenge (YoY)": "geldpolitik",
  "VIX": "sentiment",
  "VIX-Proxy": "sentiment",
  "CNN Fear & Greed": "sentiment",
  "Google Trends \"Recession\"": "sentiment",
  "Konsumklima (CSI)": "sentiment",
};

const MISSING_STRENGTH: Record<RecessionMacroDimension, string> = {
  bewertung: "n/a — kein gewertetes Bewertungssignal",
  kredit: "n/a — kein gewertetes Kreditsignal",
  realwirtschaft: "n/a — kein gewertetes Realwirtschaftssignal",
  geldpolitik: "n/a — kein gewertetes Geldpolitiksignal",
  sentiment: "n/a — kein gewertetes Sentimentsignal",
  managing: "n/a — Managing-Score (CAPEX, EPS, Realzins, Konzentration gegen Trend) ist nicht im Rezessionspfad",
  widersprueche: "n/a — Makro-Bilanzwidersprüche sind nicht definiert",
};

export interface AdaptiveIndicator {
  name: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  maxWeighted: number;
  available?: boolean;
}

export interface StrengthSignal {
  indicator: string;
  strength: number | null;
}

export interface RecessionHabitatInput {
  regime: RecessionHabitatRegime | null;
  regimeDetail?: string;
  concentration: number | null;
  concentrationHistory: number[] | null;
  concentrationMissing?: string;
}

export interface AdaptiveWeightResult {
  layers: RecessionAdaptiveLayerView[];
  regime: RecessionHabitatRegime | null;
  regimeDetail: string;
  concentration: number | null;
  concentrationLimit: number | null;
  concentrationDetail: string;
}

export function strengthFromIndicator(indicator: AdaptiveIndicator): number | null {
  if (indicator.available === false) return null;
  if (!(indicator.weight > 0) || !(indicator.maxWeighted > 0) || !Number.isFinite(indicator.rawScore)) return null;
  const maxRaw = indicator.maxWeighted / indicator.weight;
  if (!(maxRaw > 0)) return null;
  const strength = Math.abs(indicator.rawScore) / maxRaw;
  if (!Number.isFinite(strength)) return null;
  return Math.min(1, strength);
}

export function regimeFromRealYield(zReal: number | null, rateTight: boolean): { regime: RecessionHabitatRegime | null; detail: string } {
  if (zReal == null || !Number.isFinite(zReal)) {
    return { regime: null, detail: "n/a — Realzins-z (DFII10, 13 Wochen) fehlt, restriktiver Aufschlag nicht angewendet" };
  }
  if (rateTight) {
    return { regime: "restrictive", detail: `Habitat restriktiv: Realzins-z ${zReal.toFixed(2)} (Brücke rateTight)` };
  }
  return { regime: "neutral", detail: `Habitat nicht restriktiv: Realzins-z ${zReal.toFixed(2)}` };
}

/** Perzentil der Reihe. null, wenn die Reihe die Mindestlänge nicht erreicht. Kein Ersatzlevel. */
export function concentrationLimitFromHistory(history: number[] | null | undefined): number | null {
  if (!history) return null;
  const sample = history.filter(value => Number.isFinite(value));
  if (sample.length < CONCENTRATION_HISTORY_MIN) return null;
  const sorted = [...sample].sort((a, b) => a - b);
  const limit = percentile(sorted, CONCENTRATION_LIMIT_PERCENTILE);
  return Number.isFinite(limit) ? limit : null;
}

export function dimensionOf(indicator: string): RecessionMacroDimension | null {
  return RECESSION_INDICATOR_DIMENSION[indicator] ?? null;
}

function meanStrength(signals: StrengthSignal[], dimension: RecessionMacroDimension): number | null {
  const values: number[] = [];
  for (const signal of signals) {
    if (dimensionOf(signal.indicator) !== dimension) continue;
    if (signal.strength == null || !Number.isFinite(signal.strength)) continue;
    values.push(Math.min(1, Math.max(0, signal.strength)));
  }
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function strengthFactor(strength: number): number {
  return RECESSION_STRENGTH_LAYER.FLOOR + strength * RECESSION_STRENGTH_LAYER.SPAN;
}

function concentrationReading(input: RecessionHabitatInput): { limit: number | null; detail: string; boost: boolean } {
  const history = input.concentrationHistory;
  const sample = (history ?? []).filter(value => Number.isFinite(value));
  if (!history || sample.length === 0) {
    return {
      limit: null,
      boost: false,
      detail: input.concentrationMissing ?? "n/a — Konzentrationsreihe fehlt",
    };
  }
  if (sample.length < CONCENTRATION_HISTORY_MIN) {
    return {
      limit: null,
      boost: false,
      detail: `n/a — Konzentrationsreihe hat ${sample.length} Punkte, Perzentil braucht mindestens ${CONCENTRATION_HISTORY_MIN}`,
    };
  }
  const limit = concentrationLimitFromHistory(sample);
  if (limit == null) {
    return { limit: null, boost: false, detail: "n/a — Perzentil der Konzentrationsreihe nicht bestimmbar" };
  }
  if (input.concentration == null || !Number.isFinite(input.concentration)) {
    return {
      limit,
      boost: false,
      detail: `n/a — aktueller Konzentrationsdruck fehlt, P${CONCENTRATION_LIMIT_PERCENTILE} der Reihe liegt bei ${limit.toFixed(2)}`,
    };
  }
  const above = input.concentration > limit;
  return {
    limit,
    boost: above,
    detail: above
      ? `Konzentration ${input.concentration.toFixed(2)} über P${CONCENTRATION_LIMIT_PERCENTILE} der Reihe (${limit.toFixed(2)}): Bewertung ×${RECESSION_CONCENTRATION_BEWERTUNG}`
      : `Konzentration ${input.concentration.toFixed(2)} nicht über P${CONCENTRATION_LIMIT_PERCENTILE} der Reihe (${limit.toFixed(2)})`,
  };
}

export function calculateAdaptiveWeights(habitat: RecessionHabitatInput, signals: StrengthSignal[]): AdaptiveWeightResult {
  const concentration = concentrationReading(habitat);
  const regimeDetail = habitat.regimeDetail
    ?? (habitat.regime === "restrictive"
      ? "Habitat restriktiv"
      : habitat.regime === "neutral"
        ? "Habitat nicht restriktiv"
        : "n/a — Habitat nicht bestimmt, restriktiver Aufschlag nicht angewendet");

  const layers = RECESSION_MACRO_DIMENSIONS.map((id): RecessionAdaptiveLayerView => {
    const baseWeight = RECESSION_MACRO_BASE_WEIGHTS[id];
    const restrictive = habitat.regime === "restrictive"
      ? (RECESSION_HABITAT_RESTRICTIVE[id as keyof typeof RECESSION_HABITAT_RESTRICTIVE] ?? 1)
      : 1;
    const concentrationBoost = id === "bewertung" && concentration.boost ? RECESSION_CONCENTRATION_BEWERTUNG : 1;
    const habitatMultiplier = restrictive * concentrationBoost;
    const strength = meanStrength(signals, id);
    const quantitativeWeight = strength == null
      ? baseWeight * habitatMultiplier
      : baseWeight * habitatMultiplier * strengthFactor(strength);
    const notes: string[] = [];
    if (habitat.regime == null) notes.push("Habitat n/a, Aufschlag nicht angewendet");
    else if (restrictive !== 1) notes.push(`Habitat restriktiv ×${restrictive}`);
    else notes.push("Habitat ohne Aufschlag");
    if (id === "bewertung") notes.push(concentration.detail);
    if (strength == null) notes.push(MISSING_STRENGTH[id]);
    else notes.push(`Stärke ${strength.toFixed(2)} → ×${strengthFactor(strength).toFixed(2)}`);
    return {
      id,
      label: RECESSION_MACRO_LABELS[id],
      baseWeight,
      habitatMultiplier,
      strength,
      quantitativeWeight,
      adjustedWeight: quantitativeWeight,
      detail: notes.join(" · "),
    };
  });

  return {
    layers,
    regime: habitat.regime,
    regimeDetail,
    concentration: inputConcentration(habitat),
    concentrationLimit: concentration.limit,
    concentrationDetail: concentration.detail,
  };
}

function inputConcentration(habitat: RecessionHabitatInput): number | null {
  if (habitat.concentration == null || !Number.isFinite(habitat.concentration)) return null;
  return habitat.concentration;
}

export function dimensionMultiplier(indicator: string, layers: RecessionAdaptiveLayerView[]): number {
  const dimension = dimensionOf(indicator);
  if (!dimension) return 1;
  const layer = layers.find(item => item.id === dimension);
  if (!layer || !(layer.baseWeight > 0) || !Number.isFinite(layer.adjustedWeight) || !(layer.adjustedWeight > 0)) return 1;
  return layer.adjustedWeight / layer.baseWeight;
}

export function bookTotals(
  indicators: AdaptiveIndicator[],
  multiplierFor: (name: string) => number,
): { net: number; max: number; used: string[] } {
  let net = 0;
  let max = 0;
  const used: string[] = [];
  for (const indicator of indicators) {
    if (indicator.available === false) continue;
    if (!(indicator.maxWeighted > 0) || !Number.isFinite(indicator.weightedScore) || !Number.isFinite(indicator.maxWeighted)) continue;
    const multiplier = multiplierFor(indicator.name);
    if (!Number.isFinite(multiplier) || !(multiplier > 0)) continue;
    net += indicator.weightedScore * multiplier;
    max += indicator.maxWeighted * multiplier;
    used.push(indicator.name);
  }
  return { net, max, used };
}

export const ADAPTIVE_WEIGHT_FORMULA =
  "Basis × Habitat × (0,7 + Stärke × 0,6). Konzentrationsgrenze = Perzentil der eigenen Reihe. Live-P unverändert.";
