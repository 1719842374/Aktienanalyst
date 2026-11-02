/**
 * F9-08 — Abruf der Hyperscaler-CAPEX.
 * Kette: fmpCashFlowQuarterly (server/fmp.ts) → printsFromFmpPayload → computeHyperscalerCapex.
 * Ohne FMP_API_KEY kein Aufruf. Fehlende Zeilen: n/a mit Grund, nie 0 und nie eine Lücke auffüllen.
 */
import { fmpCashFlowQuarterly } from "./fmp";
import {
  computeHyperscalerCapex,
  HYPERSCALER_CAPEX_PARAMS,
  HYPERSCALER_CAPEX_UNIVERSE,
  printsFromFmpPayload,
  unavailableHyperscalerCapex,
  type CapexPrint,
  type HyperscalerCapexView,
} from "../shared/hyperscaler-capex";

export type CashFlowLoad = (symbol: string, limit: number) => Promise<unknown>;

export async function fetchHyperscalerCapex(opts: {
  load?: CashFlowLoad;
  hasKey?: () => boolean;
} = {}): Promise<HyperscalerCapexView> {
  const hasKey = opts.hasKey ?? (() => Boolean(process.env.FMP_API_KEY));
  if (!hasKey()) {
    return unavailableHyperscalerCapex("n/a — FMP_API_KEY fehlt");
  }
  const load = opts.load ?? ((symbol, limit) => fmpCashFlowQuarterly(symbol, limit));
  const prints: CapexPrint[] = [];
  const problems: Record<string, string> = {};
  await Promise.all(HYPERSCALER_CAPEX_UNIVERSE.map(async entry => {
    try {
      const payload = await load(entry.symbol, HYPERSCALER_CAPEX_PARAMS.fetchQuarters);
      const parsed = printsFromFmpPayload(entry.symbol, payload);
      if (parsed.problem && parsed.prints.length === 0) problems[entry.symbol] = parsed.problem;
      prints.push(...parsed.prints);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      problems[entry.symbol] = /FMP_API_KEY/.test(message)
        ? "n/a — FMP_API_KEY fehlt"
        : `n/a — FMP ${entry.symbol} nicht erreichbar`;
    }
  }));
  return computeHyperscalerCapex(prints, problems);
}
