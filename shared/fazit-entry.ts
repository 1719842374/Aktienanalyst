/**
 * PDF + Chat: Max-Entry (CRV 3:1) und CRV Base/risikoadjustiert wie im S17/S20-Fazit.
 * Reine Logik in shared/, damit server/pdf-export.ts nicht aus client/ importiert.
 *
 * computeFazitEntry rechnet Zeile für Zeile dasselbe wie die Entry-Teile von prepareFazitMetrics
 * (client/src/lib/fazit-signal.ts) — nur shared-Funktionen (valuation-signal, bias-fixes), kein
 * Monte Carlo. script/test-pdf-chat-entry-from-fazit.ts prüft die Gleichheit mit prepareFazitMetrics
 * (SHEL.L, MSFT). fazit-signal.ts bleibt hier unverändert, weil fix/exec-summary-entry-from-fazit
 * (#312) genau diese Zeilen als prepareFazitEntry herauszieht; nach dessen Merge kann
 * prepareFazitEntry auf computeFazitEntry zeigen (eine Quelle).
 * Rein lesend: Score und Rating von Analyse, Fazit und PDF-Verdict bleiben unverändert.
 */
import type { StockAnalysis } from "./schema";
import type { ChatContext, ChatFactValue } from "./chat-context";
import {
  buildDefaultDCFParams,
  calculateFCFFDCF,
  calculateCRV,
  calculateRiskAdjustedCRV,
  worstCaseM1,
  worstCaseM2,
  worstCaseM3,
} from "./valuation-signal";
import { buildBiasDecision } from "./bias-fixes";
import { formatCurrency, statementCurrency } from "./currency-format";

export const FAZIT_ENTRY_SOURCE = "S17-Fazit (prepareFazitMetrics, client/src/lib/fazit-signal.ts)";

export type FazitEntryValues = {
  decisionPerShare: number;
  worstCase: number;
  crvConservative: number;
  /** Max-Entry bei CRV 3:1 = (Entscheidungsbasis + 2 × Worst Case) / 3. */
  dcfBeiCRV3: number;
  totalExpDmg: number;
  raCrvCons: number;
};

/** Gleiche Formeln wie prepareFazitMetrics (Entry-Teil). */
export function computeFazitEntry(data: StockAnalysis): FazitEntryValues {
  const baseParams = buildDefaultDCFParams(data);
  const conservativeDCF = calculateFCFFDCF(baseParams);
  const bias = buildBiasDecision(data);
  const decisionPerShare = Number.isFinite(bias.decisionPerShare) ? bias.decisionPerShare : conservativeDCF.perShare;
  const m1 = worstCaseM1(data.currentPrice, data.beta5Y, data.sectorMaxDrawdown || 35);
  const m2Impact = data.risks?.length ? Math.max(...data.risks.map(r => Math.abs(r.impact))) : 35;
  const m2 = worstCaseM2(data.currentPrice, m2Impact);
  const m3 = worstCaseM3(data.currentPrice, data.sectorMaxDrawdown || 35, data.lynchClass);
  const worstCase = Math.min(m1, m2, m3);
  const crvConservative = calculateCRV(decisionPerShare, worstCase, data.currentPrice);
  const dcfBeiCRV3 = (decisionPerShare + 2 * worstCase) / 3;
  const totalExpDmg = (data.risks || []).reduce((s, r) => s + r.expectedDamage, 0);
  const raCrvCons = calculateRiskAdjustedCRV(decisionPerShare, worstCase, data.currentPrice, totalExpDmg);
  return { decisionPerShare, worstCase, crvConservative, dcfBeiCRV3, totalExpDmg, raCrvCons };
}

export type FazitEntryExport = {
  /** Max-Entry bei CRV 3:1 — identisch mit „DCF bei CRV 3:1“ im Fazit. */
  maxEntry: number;
  crvBase: number;
  crvRiskAdj: number;
  /** Worst Case = min(M1,M2,M3) wie im Fazit (Listing-Währung, Kursbasis). */
  worstCase: number;
  /** Entscheidungsbasis des Fazits (Bias-Decision bzw. konservatives FCFF-DCF), Statement-Währung. */
  fairValue: number;
  /** Währung wie im Fazit (statementCurrency). */
  currency: string;
  /** Formatiert wie im Fazit, z.B. „£31.33“. */
  label: string;
  source: string;
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** null = Fazit-Werte nicht berechenbar (Daten fehlen) → Aufrufer zeigt n/a. */
export function fazitEntryForExport(data: StockAnalysis): FazitEntryExport | null {
  try {
    if (!data || !finite(data.currentPrice)) return null;
    const m = computeFazitEntry(data);
    if (!finite(m.dcfBeiCRV3)) return null;
    const currency = statementCurrency(data);
    return {
      maxEntry: m.dcfBeiCRV3,
      crvBase: m.crvConservative,
      crvRiskAdj: m.raCrvCons,
      worstCase: m.worstCase,
      fairValue: m.decisionPerShare,
      currency,
      label: formatCurrency(m.dcfBeiCRV3, 2, currency),
      source: FAZIT_ENTRY_SOURCE,
    };
  } catch {
    return null;
  }
}

const r2 = (v: number) => (finite(v) ? Math.round(v * 100) / 100 : null);

/**
 * Chat-Kontext: Fazit-Entry in S1 (Executive Summary) und S20 (Zusammenfassung) ergänzen.
 * Reine Funktion, mutiert ctx nicht. Ohne berechenbaren Wert: Felder = null (n/a).
 */
export function withFazitEntryChatFacts(ctx: ChatContext, data: StockAnalysis): ChatContext {
  const e = fazitEntryForExport(data);
  const facts: Record<string, ChatFactValue> = {
    maxEntryCRV3_fazit: e ? r2(e.maxEntry) : null,
    maxEntryCRV3_fazit_text: e ? e.label : null,
    maxEntryWaehrung: e ? e.currency : null,
    crvBase_fazit: e ? r2(e.crvBase) : null,
    crvRisikoadj_fazit: e ? r2(e.crvRiskAdj) : null,
    maxEntryQuelle: FAZIT_ENTRY_SOURCE,
  };
  return {
    ...ctx,
    sections: ctx.sections.map(s => (s.id === 1 || s.id === 20 ? { ...s, facts: { ...s.facts, ...facts } } : s)),
  };
}
