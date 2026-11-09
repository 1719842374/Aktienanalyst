/**
 * F9-18 — die Schicht läuft erst, wenn der Analyse-Knopf den POST auslöst.
 * F9-08 und F9-14 bleiben Anzeige. scoreSwitch ist "aus".
 */
import { fetchEuropeMacroFallbacks } from "./europe-macro-fallbacks";
import { fetchHyperscalerCapex } from "./hyperscaler-capex";
import {
  assembleMacroAdaptiveLayer,
  type MacroAdaptiveLayer,
} from "../shared/macro-adaptive-layer";

export async function loadMacroAdaptiveLayer(opts: {
  now?: Date;
  hyperscaler?: () => Promise<MacroAdaptiveLayer["hyperscalerCapex"]>;
  europe?: () => Promise<MacroAdaptiveLayer["europe"]>;
} = {}): Promise<MacroAdaptiveLayer> {
  const now = opts.now ?? new Date();
  const [hyperscalerCapex, europe] = await Promise.all([
    (opts.hyperscaler ?? (() => fetchHyperscalerCapex()))(),
    (opts.europe ?? (() => fetchEuropeMacroFallbacks({ now })))(),
  ]);
  return assembleMacroAdaptiveLayer(hyperscalerCapex, europe, now.toISOString());
}
