/**
 * Exec Summary, Lage-Satz: DCF-Wert aus derselben Quelle wie die S6-Anzeige „Entscheidungsrelevante Basis“
 * (buildBiasDecision im Client → shared/fazit-entry fairValue), Währung wie S6: DCF in statementCurrency,
 * Kurs/Analystenziel in Listing-Währung (data.currency).
 * Der Server-Satz (execSummary.fazit.lage) nutzt biasFix.decisionPerShare aus dem gehärteten Server-Pfad
 * (SHEL.L 49,45) und ist bei Alt-Payloads ohne currency fest „Dollar“. Satzbau unverändert aus
 * server/exec-summary (buildFazit, rein) — Score und Rating werden nicht berührt.
 */
import type { StockAnalysis } from "../../../shared/schema";
import { buildFazit } from "../../../server/exec-summary";
import { buildExecSummaryInputFromAnalysis } from "../../../server/exec-summary-attach";
import { fazitEntryForExport } from "../../../shared/fazit-entry";

/** null = Fazit-Wert nicht berechenbar → Karte zeigt unverändert den Server-Satz. */
export function execLageFromFazit(data: StockAnalysis): string | null {
  try {
    const fe = fazitEntryForExport(data);
    if (!fe) return null;
    const base = buildExecSummaryInputFromAnalysis(data);
    const currency = typeof data.currency === "string" && data.currency.trim() ? data.currency.trim() : null;
    return buildFazit({ ...base, dcfConservative: fe.fairValue, currency, statementCurrency: fe.currency }).lage;
  } catch {
    return null;
  }
}
