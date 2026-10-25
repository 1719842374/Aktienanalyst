/**
 * FW-09 — Client-Hook für das US-Fiscal-Overlay im BTC-Technik-Chart.
 * Reine Anzeige: liest /api/analyze-btc/fiscal-history, ändert keine
 * Analyse-/Score-Daten (btcAnalysis.ts bleibt unberührt).
 */
import { useQuery } from "@tanstack/react-query";
import type { FiscalHistoryResponse } from "@shared/btc-fiscal";

export const FISCAL_OVERLAY = {
  color: "#f472b6",
  label: "Fiskal US YoY",
  lineName: "Fiskal US (12M-Ausgaben YoY)",
  chipTitle:
    "US-Bundesausgaben (FRED MTSO133FMS), rollierende 12M-Summe YoY, point-in-time (+1M+14T). Zonen: grün = Wachstum beschleunigt, amber = Verlangsamung, rot = Kontraktion. Reine Anzeige, kein Score.",
  globalLabel: "Fiskal Global n/a",
  globalTitle: "Globales Fiscal Spending: keine freie, konsistente Zeitreihe verfügbar — n/a statt Schätzwert.",
} as const;

export function useBtcFiscalHistory() {
  return useQuery<FiscalHistoryResponse | null>({
    queryKey: ["/api/analyze-btc/fiscal-history"],
    queryFn: async () => {
      const r = await fetch("/api/analyze-btc/fiscal-history");
      if (!r.ok) return null;
      return (await r.json()) as FiscalHistoryResponse;
    },
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });
}

export function fiscalDomain(values: number[]): [number, number] {
  if (values.length === 0) return [-5, 10];
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const pad = Math.max(1, (hi - lo) * 0.1);
  return [Math.floor(lo - pad), Math.ceil(hi + pad)];
}
