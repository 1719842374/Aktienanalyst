/**
 * Future_9 §4 und §8 — Ansicht der adaptiven Makro-Gewichte.
 *
 * Eigene Datei, nicht shared/recession-adaptive.ts. Die gehört zu den
 * z-Score-/Perzentil-Schwellen (Draft #375) und wird davor gemergt.
 * Die fünf Untergruppen-Wahrscheinlichkeiten bleiben die Live-P.
 */

export type RecessionMacroDimension =
  | "bewertung"
  | "kredit"
  | "realwirtschaft"
  | "geldpolitik"
  | "sentiment"
  | "managing"
  | "widersprueche";

export type RecessionAdaptiveSource = "ki" | "quantitativ";

export type RecessionHabitatRegime = "restrictive" | "neutral";

/** Fester Spec-Wert, der nicht aus einer Reihe geschätzt ist. */
export interface WeightPrior {
  id: string;
  label: string;
  value: string;
  kind: "prior";
  reason: string;
}

export const PRIOR_KIND_LABEL = "aktuell noch nicht datengetrieben" as const;

export interface RecessionAdaptiveLayerView {
  id: RecessionMacroDimension;
  label: string;
  baseWeight: number;
  /** Habitat-Faktor. 1, wenn kein Aufschlag bestimmt ist. */
  habitatMultiplier: number;
  /** Mittel der Signale dieser Dimension. null, wenn keines eine Stärke hat. */
  strength: number | null;
  quantitativeWeight: number;
  adjustedWeight: number;
  detail: string;
}

export interface RecessionAdaptiveShadow {
  name: string;
  label: string;
  /** Live-P der Untergruppe. Wird kopiert, nicht neu gerechnet. */
  pAlt: number;
  /** Dieselbe Formel mit den angepassten Gewichten. null, wenn die Gruppe nichts Wertbares hat. */
  pNeu: number | null;
  detail: string;
}

export interface RecessionAdaptiveView {
  liveUnchanged: true;
  source: RecessionAdaptiveSource;
  reason: string;
  riskFlag: number | null;
  cached: boolean;
  regime: RecessionHabitatRegime | null;
  regimeDetail: string;
  /** Immer null. Die Reihe liegt nicht im Rezessionspfad. */
  concentration: null;
  /** Immer null. Der Perzentil-Pfad ist entfernt. */
  concentrationLimit: null;
  concentrationDetail: string;
  formula: string;
  priors: WeightPrior[];
  layers: RecessionAdaptiveLayerView[];
  shadow: RecessionAdaptiveShadow[];
  generatedAt: string;
}
