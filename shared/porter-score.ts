import type { PorterForce, PorterSubScore } from "./schema";

/**
 * Porter Five Forces — Bedrohungsskala 1–5.
 * Niedriger = geringere Bedrohung. Keine Zehnerskala.
 *
 * Bänder (Rating folgt immer dem Score, nicht einem freien LLM-Label):
 *   Low / Niedrig = 1–2
 *   Medium / Mittel = 3
 *   High / Hoch = 4–5
 *
 * Liegen Unterpunkte vor, ist der Kraft-Score der gerundete Mittelwert
 * ihrer geklemmten Scores (danach erneut auf [1, 5] geklemmt). Der rohe
 * Kraft-Score wird dann ignoriert, damit ein 1–10-Rohwert den Ø nicht
 * nach Vulnerable zieht.
 */

/** Fehlende oder nicht-endliche Eingabe → 3 (Mittel). Sonst runden und auf [1, 5] klemmen. */
export function clampPorterThreat(raw: unknown): number {
  if (raw == null || raw === "") return 3;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function porterThreatRatingEn(score: number): "Low" | "Medium" | "High" {
  if (score <= 2) return "Low";
  if (score <= 3) return "Medium";
  return "High";
}

export function porterThreatRatingDe(score: number): "Niedrig" | "Mittel" | "Hoch" {
  if (score <= 2) return "Niedrig";
  if (score <= 3) return "Mittel";
  return "Hoch";
}

/** Bis zu vier Unterpunkte. Jeder Score ist Threat 1–5. Leere Labels fallen weg. */
export function parsePorterSubScores(raw: unknown): PorterSubScore[] {
  if (!Array.isArray(raw)) return [];
  const out: PorterSubScore[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { label?: unknown; score?: unknown };
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label) continue;
    out.push({ label: label.slice(0, 120), score: clampPorterThreat(row.score) });
    if (out.length >= 4) break;
  }
  return out;
}

/**
 * Schema-Form fürs Analyze-Payload.
 * reasoning: vorhandener Text, sonst summary (LLM liefert oft nur summary).
 */
export function toSchemaPorterForce(raw: unknown): PorterForce {
  const row = (raw && typeof raw === "object" ? raw : {}) as {
    name?: unknown;
    force?: unknown;
    score?: unknown;
    reasoning?: unknown;
    summary?: unknown;
    subScores?: unknown;
  };
  const subScores = parsePorterSubScores(row.subScores);
  const score = clampPorterThreat(
    subScores.length > 0
      ? subScores.reduce((sum, sub) => sum + sub.score, 0) / subScores.length
      : row.score,
  );
  const reasoningText = typeof row.reasoning === "string" ? row.reasoning.trim() : "";
  const summaryText = typeof row.summary === "string" ? row.summary.trim() : "";
  const force: PorterForce = {
    name: String(row.name ?? row.force ?? "").trim(),
    rating: porterThreatRatingEn(score),
    score,
    reasoning: reasoningText || summaryText,
  };
  if (subScores.length > 0) force.subScores = subScores;
  return force;
}
