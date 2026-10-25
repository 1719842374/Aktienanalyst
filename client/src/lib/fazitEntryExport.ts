/**
 * PDF + Chat: Max-Entry (CRV 3:1) und CRV Base/risikoadjustiert aus derselben Quelle wie das
 * S17/S20-Fazit (prepareFazitMetrics). Keine zweite Rechnung. Rein lesend: Score und Rating
 * der Analyse, des Fazits und des PDF-Verdicts bleiben unverändert.
 *
 * Hinweis Branch fix/exec-summary-entry-from-fazit (23c84cc, noch nicht auf main): dort liefert
 * prepareFazitEntry dieselben Werte ohne Monte Carlo. Bis zum Merge wird hier prepareFazitMetrics
 * mit einem leeren MC-Platzhalter aufgerufen — dcfBeiCRV3/crvConservative/raCrvCons hängen nicht
 * vom MC-Ergebnis ab (siehe fazit-signal.ts). Nach dem Merge reicht ein Wechsel auf prepareFazitEntry.
 */
import type { StockAnalysis } from "../../../shared/schema";
import type { ChatContext, ChatFactValue } from "../../../shared/chat-context";
import { prepareFazitMetrics } from "./fazit-signal";
import type { GBMMonteCarloResult } from "./calculations";
import { formatCurrency, statementCurrency } from "./formatters";

export const FAZIT_ENTRY_SOURCE = "S17-Fazit (prepareFazitMetrics, client/src/lib/fazit-signal.ts)";

export type FazitEntryExport = {
  /** Max-Entry bei CRV 3:1 — identisch mit „DCF bei CRV 3:1“ im Fazit. */
  maxEntry: number;
  crvBase: number;
  crvRiskAdj: number;
  /** Währung wie im Fazit (statementCurrency). */
  currency: string;
  /** Formatiert wie im Fazit, z.B. „£31.33“. */
  label: string;
  source: string;
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
// Nur ein Platzhalter, damit prepareFazitMetrics keine 10.000 Pfade simuliert; die Entry-Werte lesen ihn nicht.
const NO_MC = {} as GBMMonteCarloResult;

/** null = Fazit-Werte nicht berechenbar (Daten fehlen) → Aufrufer zeigt n/a bzw. seinen bisherigen Wert. */
export function fazitEntryForExport(data: StockAnalysis): FazitEntryExport | null {
  try {
    if (!data || !finite(data.currentPrice)) return null;
    const m = prepareFazitMetrics(data, NO_MC);
    if (!finite(m.dcfBeiCRV3)) return null;
    const currency = statementCurrency(data);
    return {
      maxEntry: m.dcfBeiCRV3,
      crvBase: m.crvConservative,
      crvRiskAdj: m.raCrvCons,
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
