/**
 * Exec Summary, Lage-Satz: DCF-Wert aus derselben Quelle wie die S6-Anzeige „Entscheidungsrelevante Basis“
 * (buildBiasDecision im Client → shared/fazit-entry fairValue), Währung wie S6: DCF in statementCurrency,
 * Kurs/Analystenziel in Listing-Währung (data.currency).
 * Der Wortlaut der Basis ist valuationBaseLabel. Der erste Satz nutzt das Ampel-Rating aus
 * buildFazitSignal (dasselbe Objekt wie die Karte, sonst fazitRatingForLage). Die Zahl bleibt der
 * bisherige Fair Value. Score und Schwellen werden nicht geschrieben.
 */
import type { StockAnalysis } from "../../../shared/schema";
import { buildFazit } from "../../../server/exec-summary";
import { buildExecSummaryInputFromAnalysis, fazitRatingForLage } from "../../../server/exec-summary-attach";
import { fazitEntryForExport } from "../../../shared/fazit-entry";

/** null = Fazit-Wert nicht berechenbar → Karte zeigt unverändert den Server-Satz. */
export function execLageFromFazit(data: StockAnalysis, fazitRating?: string | null): string | null {
  try {
    const fe = fazitEntryForExport(data);
    if (!fe) return null;
    const base = buildExecSummaryInputFromAnalysis(data);
    const currency = typeof data.currency === "string" && data.currency.trim() ? data.currency.trim() : null;
    const rating = typeof fazitRating === "string" && fazitRating.trim()
      ? fazitRating.trim()
      : fazitRatingForLage(data);
    return buildFazit({
      ...base,
      dcfConservative: fe.fairValue,
      currency,
      statementCurrency: fe.currency,
      ...(rating ? { fazitRating: rating } : {}),
    }).lage;
  } catch {
    return null;
  }
}
