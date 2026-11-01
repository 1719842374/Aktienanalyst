/**
 * Baut das Zusatzobjekt für das Rezessionsdashboard.
 * Die Live-P der Untergruppen wird nur kopiert. Die Schatten-P nutzt
 * dieselben Formeln mit den angepassten Gewichten und ersetzt nichts.
 */
import type { RecessionAdaptiveLayerView, RecessionAdaptiveShadow, RecessionAdaptiveView } from "../shared/recession-adaptive";
import { getAIWeightSuggestion, type AiSignal, type AiWeightSuggestion } from "./recession-adaptive-ai";
import {
  ADAPTIVE_WEIGHT_FORMULA,
  bookTotals,
  calculateAdaptiveWeights,
  dimensionMultiplier,
  regimeFromRealYield,
  strengthFromIndicator,
  type AdaptiveIndicator,
} from "./recession-adaptive-weights";

export interface AdaptiveGroupInput {
  name: string;
  label: string;
  indicators: AdaptiveIndicator[];
  nyFed: number | null;
  liveProbability: number;
}

export async function loadRecessionAdaptiveView(input: {
  indicators: AdaptiveIndicator[];
  groups: AdaptiveGroupInput[];
  zReal: number | null;
  rateTight: boolean;
  concentration: number | null;
  concentrationHistory: number[] | null;
  concentrationMissing?: string;
  now?: string;
  suggest?: typeof getAIWeightSuggestion;
  probability: (groupName: string, net: number, max: number, nyFed: number | null) => number | null;
}): Promise<RecessionAdaptiveView> {
  const regime = regimeFromRealYield(input.zReal, input.rateTight);
  const signals = input.indicators.map(indicator => ({
    indicator: indicator.name,
    strength: strengthFromIndicator(indicator),
  }));
  const quantitative = calculateAdaptiveWeights({
    regime: regime.regime,
    regimeDetail: regime.detail,
    concentration: input.concentration,
    concentrationHistory: input.concentrationHistory,
    concentrationMissing: input.concentrationMissing,
  }, signals);

  const currentWeights = Object.fromEntries(quantitative.layers.map(layer => [layer.id, layer.quantitativeWeight]));
  const aiSignals: AiSignal[] = input.indicators.map(indicator => ({
    indicator: indicator.name,
    zScore: null,
    strength: strengthFromIndicator(indicator),
    direction: directionOf(indicator),
  }));
  const suggestion = await suggestWeights(input.suggest, {
    habitat: {
      regime: regime.regime,
      concentration: quantitative.concentration,
      concentrationLimit: quantitative.concentrationLimit,
      growthMomentum: null,
    },
    signals: aiSignals,
    currentWeights,
  });

  const layers = quantitative.layers.map(layer => applySuggestion(layer, suggestion));
  const shadow = input.groups.map(group => shadowOf(group, layers, input.probability));

  return {
    liveUnchanged: true,
    source: suggestion.source,
    reason: suggestion.reason,
    riskFlag: suggestion.riskFlag,
    cached: suggestion.cached,
    regime: quantitative.regime,
    regimeDetail: quantitative.regimeDetail,
    concentration: quantitative.concentration,
    concentrationLimit: quantitative.concentrationLimit,
    concentrationDetail: quantitative.concentrationDetail,
    formula: ADAPTIVE_WEIGHT_FORMULA,
    layers,
    shadow,
    generatedAt: input.now ?? new Date().toISOString(),
  };
}

function directionOf(indicator: AdaptiveIndicator): string | null {
  if (indicator.available === false || !Number.isFinite(indicator.rawScore)) return null;
  if (indicator.rawScore > 0) return "stress";
  if (indicator.rawScore < 0) return "entlastung";
  return "neutral";
}

async function suggestWeights(
  suggest: typeof getAIWeightSuggestion | undefined,
  args: Parameters<typeof getAIWeightSuggestion>[0],
): Promise<AiWeightSuggestion> {
  const run = suggest ?? getAIWeightSuggestion;
  try {
    return await run(args);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[RECESSION] KI-Gewichte nicht geladen: ${message.slice(0, 200)}`);
    return {
      source: "quantitativ",
      weights: { ...args.currentWeights },
      reason: "n/a — KI-Vorschlag fehlgeschlagen, quantitative Gewichte",
      riskFlag: null,
      cached: false,
    };
  }
}

function applySuggestion(layer: RecessionAdaptiveLayerView, suggestion: AiWeightSuggestion): RecessionAdaptiveLayerView {
  const adjusted = suggestion.weights[layer.id];
  const adjustedWeight = adjusted != null && Number.isFinite(adjusted) && adjusted > 0
    ? adjusted
    : layer.quantitativeWeight;
  let detail = layer.detail;
  if (suggestion.source === "ki" && Math.abs(adjustedWeight - layer.quantitativeWeight) > 1e-6 && layer.quantitativeWeight > 0) {
    const pct = ((adjustedWeight / layer.quantitativeWeight) - 1) * 100;
    detail = `${detail} · KI ${pct >= 0 ? "+" : ""}${pct.toFixed(1)} %`;
  }
  return { ...layer, adjustedWeight, detail };
}

function shadowOf(
  group: AdaptiveGroupInput,
  layers: RecessionAdaptiveLayerView[],
  probability: (groupName: string, net: number, max: number, nyFed: number | null) => number | null,
): RecessionAdaptiveShadow {
  const scaled = bookTotals(group.indicators, name => dimensionMultiplier(name, layers));
  if (!(scaled.max > 0)) {
    return {
      name: group.name,
      label: group.label,
      pAlt: group.liveProbability,
      pNeu: null,
      detail: "n/a — keine gewerteten Indikatoren",
    };
  }
  const pNeu = probability(group.name, scaled.net, scaled.max, group.nyFed);
  return {
    name: group.name,
    label: group.label,
    pAlt: group.liveProbability,
    pNeu,
    detail: pNeu == null ? "n/a — Schatten-P nicht bestimmbar" : "Schatten, Live-P unverändert",
  };
}
