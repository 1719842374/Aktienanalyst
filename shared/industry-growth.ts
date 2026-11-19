/**
 * Anzeige „Branchen-Wachstum“ in Sektion 9.
 * Das Qualitätstor in generateTAMAnalysis bleibt der Schutz gegen den
 * Cloud-Fallback: bei quality 'unreliable' ist tamCAGR serverseitig null.
 * Diese Kette ersetzt nur die Anzeige und geht nicht in den Score.
 * deriveGateInputs liest die Peer-Raten weiter mit der bestehenden Schwelle.
 */

export const INDUSTRY_GROWTH_AI_LABEL = "KI-Schätzung" as const;

export const GLOBAL_MARKET_TAM_LABEL = "Global Market";
export const GLOBAL_MARKET_TAM_SOURCE = "IMF / World Bank GDP Growth Estimate";

export type IndustryGrowthQuality = "ok" | "weak" | "unreliable";

export interface IndustryGrowthAiEstimate {
  value: number;
  source: string;
  rationale: string;
}

export type IndustryGrowthResolved =
  | { kind: "tam"; value: number; source: string }
  | { kind: "peer-median"; value: number; source: string; n: number }
  | { kind: "peer-span"; min: number; max: number; source: string; n: number }
  | { kind: "ai"; value: number; source: string; rationale: string; label: typeof INDUSTRY_GROWTH_AI_LABEL }
  | { kind: "na"; reason: string };

export interface IndustryGrowthInput {
  quality?: IndustryGrowthQuality | null;
  tamCAGR?: number | null;
  tamSource?: string | null;
  tamLabel?: string | null;
  peerRevenueGrowths?: readonly (number | null | undefined)[] | null;
  aiEstimate?: IndustryGrowthAiEstimate | null;
}

function finiteRates(values: readonly (number | null | undefined)[] | null | undefined): number[] {
  if (!values) return [];
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function isGlobalMarketConstant(input: IndustryGrowthInput): boolean {
  return (input.tamLabel ?? "").trim() === GLOBAL_MARKET_TAM_LABEL
    && (input.tamSource ?? "").trim() === GLOBAL_MARKET_TAM_SOURCE;
}

function usableTam(input: IndustryGrowthInput): { value: number; source: string } | null {
  if (input.quality === "unreliable") return null;
  if (isGlobalMarketConstant(input)) return null;
  if (typeof input.tamCAGR !== "number" || !Number.isFinite(input.tamCAGR)) return null;
  const source = (input.tamSource ?? "").trim() || (input.tamLabel ?? "").trim() || "tamCAGR";
  return { value: input.tamCAGR, source };
}

function usableAi(estimate: IndustryGrowthAiEstimate | null | undefined): IndustryGrowthAiEstimate | null {
  if (!estimate) return null;
  if (typeof estimate.value !== "number" || !Number.isFinite(estimate.value)) return null;
  const source = estimate.source.trim();
  const rationale = estimate.rationale.trim();
  if (!source || !rationale) return null;
  return { value: estimate.value, source, rationale };
}

function peerStage(rates: readonly number[]): IndustryGrowthResolved | null {
  const n = rates.length;
  if (n >= 5) {
    const sorted = [...rates].sort((a, b) => a - b);
    const mid = Math.floor(n / 2);
    const value = n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    return { kind: "peer-median", value, source: `Peer-Median (n=${n})`, n };
  }
  if (n >= 3) {
    return {
      kind: "peer-span",
      min: Math.min(...rates),
      max: Math.max(...rates),
      source: `Peer-Spanne (n=${n})`,
      n,
    };
  }
  return null;
}

function naReason(input: IndustryGrowthInput, n: number, aiRejected: boolean): string {
  const parts: string[] = [];
  if (input.quality === "unreliable") {
    parts.push("tamCAGR verworfen: Segment-TAM unzuverlässig (Coverage unter 70 % oder weniger als 2 Labels)");
  } else if (isGlobalMarketConstant(input)) {
    parts.push("Global Market 5 % (IMF / World Bank) ist keine Branchenquelle");
  } else if (typeof input.tamCAGR !== "number" || !Number.isFinite(input.tamCAGR)) {
    parts.push(input.quality ? `tamCAGR fehlt (quality ${input.quality})` : "tamCAGR fehlt");
  }
  if (n === 0) parts.push("keine Peer-Umsatzwachstumsraten");
  else if (n <= 2) parts.push(`Peer-Umsatzwachstum n=${n} (unter 3)`);
  parts.push(aiRejected ? "KI-Schätzung ohne Quelle oder Begründung verworfen" : "keine KI-Schätzung");
  return parts.join("; ");
}

export function resolveIndustryGrowth(input: IndustryGrowthInput): IndustryGrowthResolved {
  const tam = usableTam(input);
  if (tam) return { kind: "tam", value: tam.value, source: tam.source };
  const rates = finiteRates(input.peerRevenueGrowths);
  const peers = peerStage(rates);
  if (peers) return peers;
  const ai = usableAi(input.aiEstimate);
  if (ai) {
    return {
      kind: "ai",
      value: ai.value,
      source: ai.source,
      rationale: ai.rationale,
      label: INDUSTRY_GROWTH_AI_LABEL,
    };
  }
  const rejected = input.aiEstimate != null && ai == null;
  return { kind: "na", reason: naReason(input, rates.length, rejected) };
}

export function industryGrowthSourceText(resolved: IndustryGrowthResolved): string {
  switch (resolved.kind) {
    case "tam":
      return resolved.source;
    case "peer-median":
      return resolved.source;
    case "peer-span":
      return resolved.source;
    case "ai":
      return `${resolved.label}: ${resolved.source}. ${resolved.rationale}`;
    case "na":
      return resolved.reason;
    default: {
      const unreachable: never = resolved;
      return unreachable;
    }
  }
}

export type ParsedIndustryGrowthEstimate =
  | { ok: true; value: number; source: string; rationale: string }
  | { ok: false; reason: string };

export function parseIndustryGrowthEstimate(data: unknown): ParsedIndustryGrowthEstimate {
  if (!data || typeof data !== "object") return { ok: false, reason: "KI-Antwort ohne Objekt" };
  const rec = data as { growthPct?: unknown; value?: unknown; source?: unknown; rationale?: unknown };
  const raw = typeof rec.growthPct === "number" ? rec.growthPct : rec.value;
  const source = typeof rec.source === "string" ? rec.source.trim() : "";
  const rationale = typeof rec.rationale === "string" ? rec.rationale.trim() : "";
  if (typeof raw !== "number" || !Number.isFinite(raw)) return { ok: false, reason: "KI-Antwort ohne Wachstumszahl" };
  if (!source || !rationale) return { ok: false, reason: "KI-Schätzung ohne Quelle oder Begründung verworfen" };
  return { ok: true, value: raw, source, rationale };
}

export function industryGrowthEstimatePrompt(input: { sector: string; industry: string; description: string }): { systemPrompt: string; prompt: string } {
  const sector = input.sector.trim() || "n/a";
  const industry = input.industry.trim() || "n/a";
  const description = input.description.trim().slice(0, 400);
  return {
    systemPrompt: "Antworte nur mit JSON. Schätze das Branchenwachstum in Prozent. Eine fehlende Zahl bleibt null. Ohne Quelle und Begründung keine Zahl.",
    prompt: `Sektor: ${sector}. Branche: ${industry}. Beschreibung: ${description || "n/a"}. JSON: {"growthPct": number|null, "source": string, "rationale": string}`,
  };
}

export function industryGrowthEstimateBody(data: unknown, modelUsed: string | null, failureReason?: string): {
  label: typeof INDUSTRY_GROWTH_AI_LABEL;
  value?: number;
  source?: string;
  rationale?: string;
  reason?: string;
  modelUsed: string | null;
} {
  if (failureReason) return { label: INDUSTRY_GROWTH_AI_LABEL, reason: failureReason, modelUsed };
  const parsed = parseIndustryGrowthEstimate(data);
  if (!parsed.ok) return { label: INDUSTRY_GROWTH_AI_LABEL, reason: parsed.reason, modelUsed };
  return {
    label: INDUSTRY_GROWTH_AI_LABEL,
    value: parsed.value,
    source: parsed.source,
    rationale: parsed.rationale,
    modelUsed,
  };
}
