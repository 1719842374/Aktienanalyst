/**
 * μ-Winsorizing — dämpft extreme annualisierte Renditeschätzungen aus der
 * Kurs-Historie, bevor sie in Max-Sharpe (Modus A) einfließen.
 *
 * Auftrag 10.08.2026, Folge-Ticket Punkt 3 ("Implementiere μ-Winsorizing für
 * die historische Renditeschätzung"). Ohne Clipping kauft Max-Sharpe primär
 * den "Past-Winner" der Historie-Fensters (z.B. NVDA während der KI-Rally),
 * weil dessen realisierte annualisierte Rendite das μ̃ in w ∝ Σ⁻¹μ̃ dominiert
 * — unabhängig davon, ob diese Rendite künftig wiederholbar ist.
 *
 * Reine, generische Funktion (kein Ticker-Hardcode): clippt μ auf ein Band
 * [muMin, muMax] p.a. Default-Band [-20%, +40%] p.a. wie im Folge-Ticket
 * vorgeschlagen. Ändert NICHT Σ/σ — nur μ. Wird NUR auf die aus der Historie
 * geschätzten μ-Werte angewendet, NIEMALS auf explizite User-Overrides (der
 * User hat dort bewusst einen eigenen Wert gesetzt).
 */

export const DEFAULT_MU_WINSORIZE_MIN = -0.20; // -20% p.a.
export const DEFAULT_MU_WINSORIZE_MAX = 0.40; // +40% p.a.

export interface WinsorizeResult {
  mu: number; // geclipptes μ
  wasClipped: boolean;
  originalMu: number;
}

/**
 * Clippt einen einzelnen μ-Wert auf [muMin, muMax]. Reine Funktion.
 */
export function winsorizeMu(
  mu: number,
  muMin: number = DEFAULT_MU_WINSORIZE_MIN,
  muMax: number = DEFAULT_MU_WINSORIZE_MAX
): WinsorizeResult {
  if (!Number.isFinite(mu)) return { mu: 0, wasClipped: true, originalMu: mu };
  const clipped = Math.max(muMin, Math.min(muMax, mu));
  return { mu: clipped, wasClipped: clipped !== mu, originalMu: mu };
}

/**
 * Wendet Winsorizing auf ein Array von μ-Werten an, mit einem parallelen
 * Array, das markiert, welche Werte tatsächlich aus der Historie stammen
 * (nur diese werden geclippt — Overrides bleiben unverändert).
 */
export function winsorizeMuArray(
  muValues: number[],
  sources: ("override" | "historical")[],
  muMin: number = DEFAULT_MU_WINSORIZE_MIN,
  muMax: number = DEFAULT_MU_WINSORIZE_MAX
): { mu: number[]; clippedTickerIndices: number[] } {
  const clippedTickerIndices: number[] = [];
  const mu = muValues.map((m, i) => {
    if (sources[i] === "override") return m; // Overrides niemals clippen
    const result = winsorizeMu(m, muMin, muMax);
    if (result.wasClipped) clippedTickerIndices.push(i);
    return result.mu;
  });
  return { mu, clippedTickerIndices };
}
