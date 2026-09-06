/**
 * Thin FactPack apply helper for analyze-route.ts (keeps route file edits small).
 * Spec: docs/Doc_Soll_vs_Ist/FACTPACK_LLM.md
 */
import { applyFactPackToCatalysts, buildFactPackFromFmp } from "./factpack-validate";

export type FactPackFmpInputs = {
  ticker: string;
  estimates?: any[] | null;
  quote?: any | null;
  income?: any[] | null;
  price?: number | null;
  pe?: number | null;
  revenue?: number | null;
  revenueGrowthPct?: number | null;
};

/** Build FMP FactPack and strip LLM catalyst claims that miss the pack. */
export function applyFactPackFromFmpContext<T extends { context?: string; name?: string }>(
  catalysts: T[],
  inputs: FactPackFmpInputs,
): T[] {
  const pack = buildFactPackFromFmp(inputs);
  return applyFactPackToCatalysts(catalysts, pack);
}
