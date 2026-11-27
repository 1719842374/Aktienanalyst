/**
 * F1-36 / F1-37 / F1-40 — globalisierungsbereinigte Buffett-Quote, nur Anzeige.
 *
 * Domestic Market Cap / BIP = (Marktwert / BIP) × (1 − φ).
 * φ ist der geschätzte Auslandsumsatz-Anteil, keine eingesetzte Bewertungsschwelle.
 * Gültige LLM-Spanne: Future_1_Work.md Z.470 (0,25–0,55).
 * Fällt der LLM aus, gilt der letzte gültige Cache-Wert, sonst der Median der
 * gespeicherten Schätzungen. Ohne Historie bleibt φ leer (n/a), nie eine feste Zahl.
 * Handelsbilanz (α) und Reservewährungs-Prämie (β) werden hier nicht multipliziert:
 * dafür gibt es kein aus den Reihen abgeleitetes Gewicht. Sie bleiben eigene Zeilen.
 */
export const PHI_RANGE_MIN = 0.25;
export const PHI_RANGE_MAX = 0.55;
/** Future_1_Work.md Z.459: Schätzung wöchentlich, nicht bei jedem Chart-Abruf. */
export const PHI_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

export const PHI_US_ONLY_REASON = "Auslandsumsatz-Anteil φ ist nur für die USA geschätzt";
/** Keine gespeicherte Schätzung. Die Anzeige setzt davor „n/a — “. */
export const PHI_UNAVAILABLE_REASON = "kein φ verfügbar";

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
  /** Gesetzter Fallback-Wert (Cache oder Median). null, wenn keiner abgeleitet wurde. */
  fallbackPhi: number | null;
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

/** Median der gültigen gespeicherten φ. Leer → null, nie eine eingesetzte Zahl. */
export function medianOfPhi(values: readonly number[]): number | null {
  const sorted = values.filter(value => Number.isFinite(value) && value >= PHI_RANGE_MIN && value <= PHI_RANGE_MAX).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Fallback, wenn kein frischer LLM-Wert da ist.
 * 1. letzter gültiger Cache-Wert, 2. Median der Historie, 3. keiner.
 */
export function derivePhiFallback(
  lastCache: number | null | undefined,
  history: readonly number[],
): { phi: number | null; kind: "cache" | "median" | "none" } {
  if (typeof lastCache === "number" && Number.isFinite(lastCache) && lastCache >= PHI_RANGE_MIN && lastCache <= PHI_RANGE_MAX) {
    return { phi: lastCache, kind: "cache" };
  }
  const median = medianOfPhi(history);
  if (median != null) return { phi: median, kind: "median" };
  return { phi: null, kind: "none" };
}

/** Quote in Prozent nach Abzug des Auslandsumsatz-Anteils. null, nie 0, wenn Eingaben fehlen. */
export function globalizationAdjustedPct(rawPct: number, phi: number): number | null {
  if (!Number.isFinite(rawPct) || !Number.isFinite(phi)) return null;
  if (phi < 0 || phi >= 1) return null;
  return Math.round(rawPct * (1 - phi) * 10) / 10;
}
