/**
 * Katalysator-Basis (DCF → Analyst-PT → Kurs) — unverändert verschoben aus client/src/lib/calculations.ts,
 * damit server/pdf-export.ts dieselbe Funktion wie die UI (CatalystsSection) nutzen kann, ohne aus client/ zu importieren.
 * client/src/lib/calculations.ts re-exportiert sie → eine Quelle für UI und PDF.
 */
export function selectCatalystBase(
  conservativeDCFPerShare: number,
  totalCatalystUpsidePct: number,
  currentPrice: number,
  analystPTMedian: number
): { base: number; source: "dcf" | "analyst-pt" | "current-price"; reason: string } {
  const dcfWithCatalysts = conservativeDCFPerShare * (1 + totalCatalystUpsidePct / 100);
  const realisticThreshold = currentPrice * 0.70;

  if (conservativeDCFPerShare > 0 && dcfWithCatalysts >= realisticThreshold) {
    return {
      base: conservativeDCFPerShare,
      source: "dcf",
      reason: `DCF + Catalysts ($${dcfWithCatalysts.toFixed(2)}) liegt im plausiblen Bereich (≥70% des Kurses).`,
    };
  }

  if (analystPTMedian > 0) {
    return {
      base: analystPTMedian,
      source: "analyst-pt",
      reason: `DCF $${conservativeDCFPerShare.toFixed(2)} + Catalysts hätte $${dcfWithCatalysts.toFixed(2)} (<70% Kurs) ergeben — Verzerrung wahrscheinlich. Fallback auf Analyst-PT-Median.`,
    };
  }

  return {
    base: currentPrice,
    source: "current-price",
    reason: `DCF & Analyst-PT nicht verwertbar — Kurs als Basis (Catalysts modifizieren ab Marktpreis).`,
  };
}
