/**
 * Exec Summary, Lage-Satz: DCF-Wert aus derselben Quelle wie die S6-Anzeige „Entscheidungsrelevante Basis“
 * (buildBiasDecision im Client → shared/fazit-entry fairValue), Währung wie S6: DCF in statementCurrency,
 * Kurs/Analystenziel in Listing-Währung (data.currency).
 * Der erste Satz nutzt das Ampel-Rating aus buildFazitSignal (dasselbe Objekt wie die Karte,
 * sonst fazitRatingForLage). Die Zahl bleibt fazitEntryForExport.fairValue.
 * Das Wort davor ist das valuationBaseLabel derselben frischen buildBiasDecision, wenn deren
 * decisionPerShare diese Zahl ist. Ein älteres biasFix-Label wird dann nicht daneben gestellt.
 * Score und Schwellen werden nicht geschrieben.
 */
import type { StockAnalysis } from "../../../shared/schema";
import { buildFazit } from "../../../server/exec-summary";
import { buildExecSummaryInputFromAnalysis, fazitRatingForLage } from "../../../server/exec-summary-attach";
import { buildBiasDecision } from "../../../shared/bias-fixes";
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
    const fresh = buildBiasDecision(data);
    const freshLabel = typeof fresh.valuationBaseLabel === "string" ? fresh.valuationBaseLabel.trim() : "";
    const labelMatchesNumber = fresh.decisionPerShare === fe.fairValue && freshLabel.length > 0;
    return buildFazit({
      ...base,
      dcfConservative: fe.fairValue,
      currency,
      statementCurrency: fe.currency,
      ...(labelMatchesNumber ? { valuationBaseLabel: freshLabel, biasSwitched: fresh.switched } : {}),
      ...(rating ? { fazitRating: rating } : {}),
    }).lage;
  } catch {
    return null;
  }
}
