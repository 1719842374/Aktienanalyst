/**
 * Future_9 §4 und §8 — adaptive Makro-Gewichte neben der Live-P.
 * Die fünf Untergruppen-Wahrscheinlichkeiten bleiben die Live-P.
 * Dieses Objekt ist nur Anzeige und Schattenrechnung.
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

export interface RecessionAdaptiveLayerView {
  id: RecessionMacroDimension;
  label: string;
  baseWeight: number;
  /** Habitat inkl. Konzentrationsaufschlag. 1, wenn kein Aufschlag bestimmt ist. */
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
  concentration: number | null;
  concentrationLimit: number | null;
  concentrationDetail: string;
  formula: string;
  layers: RecessionAdaptiveLayerView[];
  shadow: RecessionAdaptiveShadow[];
  generatedAt: string;
}
