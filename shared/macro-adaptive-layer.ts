/**
 * F9-08, F9-14 und F9-18 — Zusatzobjekt der Makro-Schicht.
 * scoreSwitch bleibt "aus". Die Live-P und die Aktien-Ratings werden hier nicht gerechnet.
 */
import type { EuropeMacroFallbacks } from "./europe-macro-fallbacks";
import { unavailableEqualWeight, unavailableEuroCapex, assembleEuropeFallbacks, EUROPE_SURPRISE_REASON } from "./europe-macro-fallbacks";
import type { HyperscalerCapexView } from "./hyperscaler-capex";
import { unavailableHyperscalerCapex } from "./hyperscaler-capex";

export const MACRO_LAYER_SCORE_SWITCH = "aus" as const;

export interface MacroAdaptiveLayer {
  liveScoreUnchanged: true;
  scoreSwitch: typeof MACRO_LAYER_SCORE_SWITCH;
  hyperscalerCapex: HyperscalerCapexView;
  europe: EuropeMacroFallbacks;
  generatedAt: string;
}

export function assembleMacroAdaptiveLayer(
  hyperscalerCapex: HyperscalerCapexView,
  europe: EuropeMacroFallbacks,
  generatedAt: string,
): MacroAdaptiveLayer {
  return {
    liveScoreUnchanged: true,
    scoreSwitch: MACRO_LAYER_SCORE_SWITCH,
    hyperscalerCapex,
    europe,
    generatedAt,
  };
}

export function unavailableMacroAdaptiveLayer(reason: string, generatedAt: string): MacroAdaptiveLayer {
  return assembleMacroAdaptiveLayer(
    unavailableHyperscalerCapex(reason),
    assembleEuropeFallbacks(
      unavailableEqualWeight(reason),
      unavailableEuroCapex(reason.startsWith("n/a —") ? reason : `n/a — ${reason}`),
    ),
    generatedAt,
  );
}

export { EUROPE_SURPRISE_REASON };
