/**
 * F1-36 / F1-37 / F1-40 — globalisierungsbereinigte Buffett-Quote, nur Anzeige.
 *
 * Domestic Market Cap / BIP = (Marktwert / BIP) × (1 − φ).
 * φ ist der geschätzte Auslandsumsatz-Anteil, keine eingesetzte Bewertungsschwelle.
 * Gültige LLM-Spanne: Future_1_Work.md Z.470 (0,25–0,55).
 * Fallback nur, wenn kein LLM-Wert und kein letzter gültiger Cache vorliegt.
 * Handelsbilanz (α) und Reservewährungs-Prämie (β) werden hier nicht multipliziert:
 * dafür gibt es kein aus den Reihen abgeleitetes Gewicht. Sie bleiben eigene Zeilen.
 */
export const PHI_FALLBACK = 0.40;
export const PHI_RANGE_MIN = 0.25;
export const PHI_RANGE_MAX = 0.55;
/** Future_1_Work.md Z.459: Schätzung wöchentlich, nicht bei jedem Chart-Abruf. */
export const PHI_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

export const PHI_US_ONLY_REASON = "Auslandsumsatz-Anteil φ ist nur für die USA geschätzt";

export const PHI_LLM_PROMPT = [
  "Schätze für die USA den aktuellen Anteil des gesamten Aktienmarkt-Werts,",
  "der auf Umsätze außerhalb der USA entfällt (Top 10 Unternehmen gewichtet).",
  "Berücksichtige die Rolle des USD als Reservewährung.",
  `Antworte nur mit JSON {"phi": <Zahl zwischen ${PHI_RANGE_MIN} und ${PHI_RANGE_MAX}>}.`,
  "phi ist der foreign revenue share.",
].join(" ");

export interface PhiParse {
  phi: number | null;
  reason: string | null;
}

/** Antwort von GET /api/analyze-recession/buffett-phi. phi null = n/a, nie 0 als Platzhalter. */
export interface BuffettPhiBody {
  region: "US" | "EU" | "CN";
  phi: number | null;
  domesticShare: number | null;
  source: "llm" | "cache" | "fallback" | null;
  fallback: boolean;
  fallbackPhi: number;
  model: string | null;
  reason: string | null;
  asOf: string | null;
  fromCache: boolean;
}

export function parsePhiPayload(data: unknown): PhiParse {
  if (data == null || typeof data !== "object") {
    return { phi: null, reason: "LLM-Antwort ist kein JSON-Objekt" };
  }
  const raw = (data as { phi?: unknown }).phi;
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) return { phi: null, reason: "LLM-Antwort ohne Zahl phi" };
  if (value < PHI_RANGE_MIN || value > PHI_RANGE_MAX) {
    return { phi: null, reason: `LLM-Antwort ${value} liegt außerhalb ${PHI_RANGE_MIN}–${PHI_RANGE_MAX}` };
  }
  return { phi: value, reason: null };
}

/** Quote in Prozent nach Abzug des Auslandsumsatz-Anteils. null, nie 0, wenn Eingaben fehlen. */
export function globalizationAdjustedPct(rawPct: number, phi: number): number | null {
  if (!Number.isFinite(rawPct) || !Number.isFinite(phi)) return null;
  if (phi < 0 || phi >= 1) return null;
  return Math.round(rawPct * (1 - phi) * 10) / 10;
}
