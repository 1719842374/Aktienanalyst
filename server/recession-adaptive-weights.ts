/**
 * Future_9 §4 — calculateAdaptiveWeights für den Rezessions-Makro-Layer.
 *
 * Basis, Habitat-Faktoren und der Stärke-Layer (Boden, Spanne) sind Priors
 * aus der Spec. Im Payload liegt keine ergebnisgelabelte Historie, aus der
 * eine Trefferquote je Dimension schätzbar wäre. Sie bleiben benannt und
 * werden als „Prior (nicht datenbasiert)“ ausgewiesen.
 *
 * Ob das Habitat restriktiv ist, kommt aus dem Realzins-z der Brücke.
 * Die Stärke ist |Rohwert| / eigener Maximalrohwert des Indikators.
 *
 * Der Perzentil-Aufschlag auf die Konzentration ist entfernt. Cap-Weight-RSL
 * minus Equal-Weight-RSL wird im Rezessionslauf nicht geladen (RSP fehlt
 * in den Chart-Büchern). Ein P75, der immer null bekommt, lief nie.
 *
 * Diese Gewichte ändern die Live-P nicht.
 */
import type {
  RecessionAdaptiveLayerView,
  RecessionHabitatRegime,
  RecessionMacroDimension,
  WeightPrior,
} from "../shared/recession-adaptive-weights-view";

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

/** effective = Basis × Habitat × (FLOOR + Stärke × SPAN), Stärke in [0, 1]. */
export const RECESSION_STRENGTH_LAYER = { FLOOR: 0.7, SPAN: 0.6 } as const;

export const CONCENTRATION_ABSENT =
  "n/a — Cap-Weight-RSL minus Equal-Weight-RSL liegt nicht im Rezessionspfad. Equal-Weight (RSP) wird dort nicht geladen. Der Perzentil-Aufschlag ist entfernt, weil er ohne Reihe nie lief.";

const PRIOR_REASON_BASE =
  "Future_9 §4 setzt diese Startwerte. Eine Trefferquote je Dimension bräuchte eine ergebnisgelabelte Historie. Die liegt im Rezessionspayload nicht. Drei Dokumentationspunkte sind keine Schätzung.";

const PRIOR_REASON_HABITAT =
  "Die Faktoren stehen in Future_9 §4. Ob das Habitat restriktiv ist, kommt aus dem Realzins-z der Brücke. Die Faktoren selbst sind nicht aus einer Elastizität geschätzt.";

const PRIOR_REASON_STRENGTH =
  "Die Abbildung steht in Future_9 §4. Die Stärke ist der Betrag des Rohwerts geteilt durch den eigenen Maximalrohwert. Boden und Spanne sind nicht aus einer Verteilung geschätzt.";

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
}

export interface AdaptiveWeightResult {
  layers: RecessionAdaptiveLayerView[];
  regime: RecessionHabitatRegime | null;
  regimeDetail: string;
  concentration: null;
  concentrationLimit: null;
  concentrationDetail: string;
}

export function macroWeightPriors(): WeightPrior[] {
  const base = RECESSION_MACRO_BASE_WEIGHTS;
  return [
    {
      id: "base",
      label: "Basisgewichte",
      value: `Bewertung ${base.bewertung} · Kredit ${base.kredit} · Realwirtschaft ${base.realwirtschaft} · Geldpolitik ${base.geldpolitik} · Sentiment ${base.sentiment} · Managing ${base.managing} · Widersprüche ${base.widersprueche}`,
      kind: "prior",
      reason: PRIOR_REASON_BASE,
    },
    {
      id: "habitat",
      label: "Habitat restriktiv",
      value: `Bewertung ×${RECESSION_HABITAT_RESTRICTIVE.bewertung} · Managing ×${RECESSION_HABITAT_RESTRICTIVE.managing} · Geldpolitik ×${RECESSION_HABITAT_RESTRICTIVE.geldpolitik}`,
      kind: "prior",
      reason: PRIOR_REASON_HABITAT,
    },
    {
      id: "strength",
      label: "Stärke-Layer",
      value: `${RECESSION_STRENGTH_LAYER.FLOOR} + Stärke × ${RECESSION_STRENGTH_LAYER.SPAN}`,
      kind: "prior",
      reason: PRIOR_REASON_STRENGTH,
    },
  ];
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

function restrictiveFactor(id: RecessionMacroDimension, regime: RecessionHabitatRegime | null): number {
  if (regime !== "restrictive") return 1;
  if (id === "bewertung") return RECESSION_HABITAT_RESTRICTIVE.bewertung;
  if (id === "managing") return RECESSION_HABITAT_RESTRICTIVE.managing;
  if (id === "geldpolitik") return RECESSION_HABITAT_RESTRICTIVE.geldpolitik;
  return 1;
}

export function calculateAdaptiveWeights(habitat: RecessionHabitatInput, signals: StrengthSignal[]): AdaptiveWeightResult {
  const regimeDetail = habitat.regimeDetail
    ?? (habitat.regime === "restrictive"
      ? "Habitat restriktiv"
      : habitat.regime === "neutral"
        ? "Habitat nicht restriktiv"
        : "n/a — Habitat nicht bestimmt, restriktiver Aufschlag nicht angewendet");

  const layers = RECESSION_MACRO_DIMENSIONS.map((id): RecessionAdaptiveLayerView => {
    const baseWeight = RECESSION_MACRO_BASE_WEIGHTS[id];
    const restrictive = restrictiveFactor(id, habitat.regime);
    const strength = meanStrength(signals, id);
    const quantitativeWeight = strength == null
      ? baseWeight * restrictive
      : baseWeight * restrictive * strengthFactor(strength);
    const notes: string[] = [];
    if (habitat.regime == null) notes.push("Habitat n/a, Aufschlag nicht angewendet");
    else if (restrictive !== 1) notes.push(`Habitat restriktiv ×${restrictive}, Prior`);
    else notes.push("Habitat ohne Aufschlag");
    if (id === "bewertung") notes.push(CONCENTRATION_ABSENT);
    if (strength == null) notes.push(MISSING_STRENGTH[id]);
    else notes.push(`Stärke ${strength.toFixed(2)} → ×${strengthFactor(strength).toFixed(2)}`);
    return {
      id,
      label: RECESSION_MACRO_LABELS[id],
      baseWeight,
      habitatMultiplier: restrictive,
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
    concentration: null,
    concentrationLimit: null,
    concentrationDetail: CONCENTRATION_ABSENT,
  };
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
  "Basis × Habitat × (0,7 + Stärke × 0,6). Die festen Faktoren sind Priors aus Future_9 §4. Live-P unverändert.";
