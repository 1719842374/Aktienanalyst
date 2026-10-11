/**
 * Future_1 §11.1 / Offen_FUTURE_SOLL_IST PR 7 (KPI-Teil): Dividendenrendite nur zeigen, wenn > 0.
 * Input ist bereits Prozent (analyze-route normiert FMP-Dezimal/Prozent). Kein Wert erfunden.
 */
export function dividendYieldKpi(value: number | null | undefined): string | null {
  if (value == null || typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return `${value.toFixed(2)}%`;
}
