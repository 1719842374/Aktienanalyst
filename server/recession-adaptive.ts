/**
 * Baut das Zusatzobjekt für das Rezessionsdashboard.
 * Die Live-P der Untergruppen wird nur kopiert. Die Schatten-P nutzt
 * dieselben Formeln mit den angepassten Gewichten und ersetzt nichts.
 * Der KI-Abruf hat eine Zeitgrenze. Danach stehen die quantitativen Gewichte
 * und n/a mit Grund. Die Live-P ist zu diesem Zeitpunkt schon gesetzt.
 */
import type { RecessionAdaptiveLayerView, RecessionAdaptiveShadow, RecessionAdaptiveView, WeightPrior } from "../shared/recession-adaptive-weights-view";
import {
  aiWeightPriors,
  getAIWeightSuggestion,
  RECESSION_AI_WEIGHT_TIMEOUT_MS,
  type AiSignal,
  type AiWeightSuggestion,
} from "./recession-adaptive-ai";
import {
  ADAPTIVE_WEIGHT_FORMULA,
  bookTotals,
  calculateAdaptiveWeights,
  CONCENTRATION_ABSENT,
  dimensionMultiplier,
  macroWeightPriors,
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

export function weightPriors(): WeightPrior[] {
  return [...macroWeightPriors(), ...aiWeightPriors()];
}

export function unavailableAdaptiveView(reason: string, now = new Date().toISOString()): RecessionAdaptiveView {
  return {
    liveUnchanged: true,
    source: "quantitativ",
    reason,
    riskFlag: null,
    cached: false,
    regime: null,
    regimeDetail: "n/a — Schicht nicht gebaut",
    concentration: null,
    concentrationLimit: null,
    concentrationDetail: CONCENTRATION_ABSENT,
    formula: ADAPTIVE_WEIGHT_FORMULA,
    priors: weightPriors(),
    layers: [],
    shadow: [],
    generatedAt: now,
  };
}

export async function loadRecessionAdaptiveView(input: {
  indicators: AdaptiveIndicator[];
  groups: AdaptiveGroupInput[];
  zReal: number | null;
  rateTight: boolean;
  now?: string;
  timeoutMs?: number;
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
  }, signals);

  const currentWeights = Object.fromEntries(quantitative.layers.map(layer => [layer.id, layer.quantitativeWeight]));
  const aiSignals: AiSignal[] = input.indicators.map(indicator => ({
    indicator: indicator.name,
    zScore: null,
    strength: strengthFromIndicator(indicator),
    direction: directionOf(indicator),
  }));
  const suggestion = await suggestionWithin(
    suggestWeights(input.suggest, {
      habitat: {
        regime: regime.regime,
        concentration: null,
        concentrationLimit: null,
        growthMomentum: null,
      },
      signals: aiSignals,
      currentWeights,
    }),
    input.timeoutMs ?? RECESSION_AI_WEIGHT_TIMEOUT_MS,
    currentWeights,
  );

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
    concentration: null,
    concentrationLimit: null,
    concentrationDetail: quantitative.concentrationDetail,
    formula: ADAPTIVE_WEIGHT_FORMULA,
    priors: weightPriors(),
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

function quantitativeSuggestion(weights: Record<string, number>, reason: string): AiWeightSuggestion {
  return { source: "quantitativ", weights: { ...weights }, reason, riskFlag: null, cached: false };
}

/** Löst spätestens nach ms auf. Ein hängender KI-Abruf wird nicht weiter awaited. */
export function suggestionWithin(
  work: Promise<AiWeightSuggestion>,
  ms: number,
  weights: Record<string, number>,
): Promise<AiWeightSuggestion> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: AiWeightSuggestion) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      finish(quantitativeSuggestion(weights, "n/a — KI-Abruf über der Zeitgrenze, quantitative Gewichte"));
    }, ms);
    work.then(
      value => finish(value),
      () => finish(quantitativeSuggestion(weights, "n/a — KI-Vorschlag fehlgeschlagen, quantitative Gewichte")),
    );
  });
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
    return quantitativeSuggestion(args.currentWeights, "n/a — KI-Vorschlag fehlgeschlagen, quantitative Gewichte");
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
