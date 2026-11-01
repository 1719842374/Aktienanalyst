/**
 * Future_9 §9 — getAIWeightSuggestion.
 *
 * Nutzt callLLMJson aus server/llm-openrouter.ts. Kein zweiter Client.
 * Der Key bleibt OPENROUTER_API_KEY, gelesen nur im bestehenden Client.
 * Jedes Gewicht bleibt innerhalb ±25 % der quantitativen Gewichte.
 * Bei Fehler, fehlendem Key oder unbrauchbarem JSON gelten die quantitativen
 * Gewichte. Erfolgreiche Antworten liegen 8 h im Speicher (Fenster 6–12 h).
 */
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import type { RecessionHabitatRegime, WeightPrior } from "../shared/recession-adaptive-weights-view";

/** Spec-Fenster 6–12 h. Der gespeicherte TTL-Wert liegt darin. */
export const RECESSION_AI_WEIGHT_CACHE_MIN_MS = 6 * 60 * 60 * 1000;
export const RECESSION_AI_WEIGHT_CACHE_MAX_MS = 12 * 60 * 60 * 1000;
export const RECESSION_AI_WEIGHT_CACHE_MS = 8 * 60 * 60 * 1000;

/** Maximale relative Abweichung vom quantitativen Gewicht. Prior aus Future_9 §9, keine geschätzte Schwankung. */
export const AI_WEIGHT_MAX_SHARE = 0.25;

/**
 * Unter der Proxy-Wache von 24 s in registerRecessionRoutes.
 * Kein aus Daten geschätzter Wert. Bei Überschreitung gilt n/a mit Grund.
 */
export const RECESSION_AI_WEIGHT_TIMEOUT_MS = 4_000;

const PRIOR_REASON_AI_BAND =
  "Future_9 §9 begrenzt die KI auf ±25 % der quantitativen Gewichte. Das ist eine Kappung, keine geschätzte Schwankung.";

const PRIOR_REASON_AI_TIMEOUT =
  "Liegt unter der Proxy-Wache von 24 s in registerRecessionRoutes, damit die Live-P nicht auf den KI-Abruf wartet. Kein aus Daten geschätzter Wert.";

export function aiWeightPriors(): WeightPrior[] {
  return [
    {
      id: "ai-band",
      label: "KI-Band",
      value: `±${AI_WEIGHT_MAX_SHARE * 100} %`,
      kind: "prior",
      reason: PRIOR_REASON_AI_BAND,
    },
    {
      id: "ai-timeout",
      label: "KI-Zeitgrenze",
      value: `${RECESSION_AI_WEIGHT_TIMEOUT_MS / 1000} s`,
      kind: "prior",
      reason: PRIOR_REASON_AI_TIMEOUT,
    },
  ];
}

export interface AiHabitat {
  regime: RecessionHabitatRegime | null;
  concentration: number | null;
  concentrationLimit: number | null;
  growthMomentum: number | null;
}

export interface AiSignal {
  indicator: string;
  zScore: number | null;
  strength: number | null;
  direction: string | null;
}

export interface AiWeightSuggestion {
  source: "ki" | "quantitativ";
  weights: Record<string, number>;
  reason: string;
  riskFlag: number | null;
  cached: boolean;
}

export type LlmJson = (opts: {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}) => Promise<{ data: unknown } | null>;

interface CacheSlot {
  at: number;
  fingerprint: string;
  suggestion: AiWeightSuggestion;
}

let cacheSlot: CacheSlot | null = null;

export function resetRecessionAiWeightCache(): void {
  cacheSlot = null;
}

export function clampAiWeight(current: number, suggested: number, band = AI_WEIGHT_MAX_SHARE): number | null {
  if (!Number.isFinite(current) || !(current > 0) || !Number.isFinite(suggested)) return null;
  const low = current * (1 - band);
  const high = current * (1 + band);
  return Math.min(high, Math.max(low, suggested));
}

export function applyAiWeights(
  quantitative: Record<string, number>,
  suggested: unknown,
): { weights: Record<string, number>; used: boolean } {
  const weights: Record<string, number> = { ...quantitative };
  if (!suggested || typeof suggested !== "object" || Array.isArray(suggested)) {
    return { weights, used: false };
  }
  const record = suggested as Record<string, unknown>;
  let used = false;
  for (const key of Object.keys(quantitative)) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const raw = record[key];
    const numeric = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
    const next = clampAiWeight(quantitative[key], numeric);
    if (next == null) continue;
    weights[key] = next;
    used = true;
  }
  return { weights, used };
}

function textOrNa(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

function fingerprintOf(habitat: AiHabitat, signals: AiSignal[], weights: Record<string, number>): string {
  const weightKey = Object.keys(weights).sort().map(key => `${key}:${weights[key].toFixed(6)}`).join("|");
  const signalKey = signals
    .map(signal => `${signal.indicator}:${signal.strength == null ? "na" : signal.strength.toFixed(4)}:${signal.zScore == null ? "na" : signal.zScore.toFixed(4)}`)
    .join(",");
  return [
    habitat.regime ?? "na",
    textOrNa(habitat.concentration, 4),
    textOrNa(habitat.concentrationLimit, 4),
    textOrNa(habitat.growthMomentum, 4),
    weightKey,
    signalKey,
  ].join("~");
}

function buildPrompt(habitat: AiHabitat, signals: AiSignal[], currentWeights: Record<string, number>): string {
  const lines = signals.slice(0, 10).map(signal => {
    const z = signal.zScore == null ? "n/a" : signal.zScore.toFixed(2);
    const strength = signal.strength == null ? "n/a" : signal.strength.toFixed(2);
    const direction = signal.direction ?? "n/a";
    return `- ${signal.indicator}: z=${z}, strength=${strength}, direction=${direction}`;
  });
  return [
    "Du bist ein Makro-Analyst. Analysiere das aktuelle Habitat und schlage leichte Gewichtungsanpassungen vor.",
    "",
    `Habitat: ${habitat.regime ?? "n/a — Habitat nicht bestimmt"}`,
    `Konzentration (Cap-Equal RSL): ${textOrNa(habitat.concentration)}`,
    `Konzentrationsgrenze (Perzentil der Reihe): ${textOrNa(habitat.concentrationLimit)}`,
    `Gewinnmomentum (z-Score): ${habitat.growthMomentum == null ? "n/a — Gewinnmomentum nicht im Rezessionspfad" : habitat.growthMomentum.toFixed(2)}`,
    "",
    "Aktuelle Signale:",
    lines.length > 0 ? lines.join("\n") : "n/a — keine Signale mit Stärke",
    "",
    "Aktuelle Gewichte:",
    JSON.stringify(currentWeights, null, 2),
    "",
    "Aufgabe:",
    "1. Liegt ein struktureller Regime-Wechsel oder erhöhtes Risiko vor?",
    "2. Schlage angepasste Gewichte vor (max ±25% Abweichung von den aktuellen Werten).",
    "3. Gib eine kurze Begründung (1-2 Sätze).",
    "",
    "Antworte ausschließlich im folgenden JSON-Format:",
    '{ "adjustedWeights": { "bewertung": 1.9 }, "riskFlag": 0, "reason": "Kurze Begründung" }',
    "Verwende nur die Schlüssel der aktuellen Gewichte. Fehlende Reihen nicht als 0 setzen.",
  ].join("\n");
}

function readReason(data: unknown): string {
  if (!data || typeof data !== "object") return "n/a — KI ohne Begründung";
  const reason = (data as { reason?: unknown }).reason;
  if (typeof reason !== "string" || !reason.trim()) return "n/a — KI ohne Begründung";
  return reason.trim().slice(0, 400);
}

function readRiskFlag(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const flag = (data as { riskFlag?: unknown }).riskFlag;
  const numeric = typeof flag === "number" ? flag : typeof flag === "string" ? Number(flag) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function quantitativeResult(weights: Record<string, number>, reason: string): AiWeightSuggestion {
  return { source: "quantitativ", weights: { ...weights }, reason, riskFlag: null, cached: false };
}

export async function getAIWeightSuggestion(input: {
  habitat: AiHabitat;
  signals: AiSignal[];
  currentWeights: Record<string, number>;
  now?: number;
  call?: LlmJson;
  llmAvailable?: boolean;
}): Promise<AiWeightSuggestion> {
  const now = input.now ?? Date.now();
  const fingerprint = fingerprintOf(input.habitat, input.signals, input.currentWeights);
  if (cacheSlot && cacheSlot.fingerprint === fingerprint && now - cacheSlot.at < RECESSION_AI_WEIGHT_CACHE_MS && now >= cacheSlot.at) {
    return { ...cacheSlot.suggestion, weights: { ...cacheSlot.suggestion.weights }, cached: true };
  }

  const available = input.llmAvailable ?? isLLMAvailable();
  if (!available) {
    return quantitativeResult(input.currentWeights, "n/a — OPENROUTER_API_KEY fehlt, quantitative Gewichte");
  }

  const call = input.call ?? ((opts) => callLLMJson(opts));
  let data: unknown = null;
  try {
    const result = await call({
      prompt: buildPrompt(input.habitat, input.signals, input.currentWeights),
      maxTokens: 500,
      temperature: 0.3,
      systemPrompt: "Antworte ausschließlich mit einem JSON-Objekt. Keine Prosa außerhalb des JSON.",
    });
    data = result?.data ?? null;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[RECESSION-AI] Weight suggestion failed: ${message.slice(0, 200)}`);
    return quantitativeResult(input.currentWeights, "n/a — KI-Vorschlag fehlgeschlagen, quantitative Gewichte");
  }

  if (!data || typeof data !== "object") {
    return quantitativeResult(input.currentWeights, "n/a — KI-Antwort fehlt, quantitative Gewichte");
  }
  const adjusted = (data as { adjustedWeights?: unknown }).adjustedWeights;
  const applied = applyAiWeights(input.currentWeights, adjusted);
  if (!applied.used) {
    return quantitativeResult(input.currentWeights, "n/a — KI-Gewichte nicht verwertbar, quantitative Gewichte");
  }
  const suggestion: AiWeightSuggestion = {
    source: "ki",
    weights: applied.weights,
    reason: readReason(data),
    riskFlag: readRiskFlag(data),
    cached: false,
  };
  cacheSlot = { at: now, fingerprint, suggestion };
  return { ...suggestion, weights: { ...suggestion.weights } };
}
