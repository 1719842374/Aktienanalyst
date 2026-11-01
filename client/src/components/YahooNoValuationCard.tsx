/**
 * C1 / PR #252: Platzhalter für bewertende Sektionen, wenn die Analyse nur aus
 * dem Yahoo-Fallback stammt (FMP 402, keine Statements). Statt einer Rechnung
 * mit 0-Werten zeigt die Sektion n/a plus den Hinweis „Yahoo-Daten – keine Bewertung“.
 * Dashboard rendert diese Karte anstelle der Sektion (eigener Komponententyp,
 * daher kein Hook-Mismatch beim Wechsel zwischen FMP- und Yahoo-Ticker).
 */
import { AlertTriangle } from "lucide-react";
import { SectionCard } from "./SectionCard";
import type { StockAnalysis } from "../../../shared/schema";
import { YAHOO_NO_VALUATION_NOTICE } from "../../../shared/data-source";

export function YahooNoValuationNotice({ data }: { data: Pick<StockAnalysis, "valuationNotice"> }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 flex items-start gap-2 text-xs text-amber-400 break-words" data-testid="yahoo-no-valuation">
      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span>
        <span className="font-semibold">{data.valuationNotice ?? YAHOO_NO_VALUATION_NOTICE}</span>
        {" "}— FMP-Plan deckt dieses Symbol nicht ab (HTTP 402). Kurs, Market Cap, KGV, EPS und Historie kommen von Yahoo;
        ohne Finanzberichte bleiben DCF, Inverse-DCF, CRV/Upside, Score und Rating n/a.
      </span>
    </div>
  );
}

export function YahooNoValuationCard({ number, title, data }: {
  number: number;
  title: string;
  data: Pick<StockAnalysis, "valuationNotice">;
}) {
  return (
    <SectionCard number={number} title={title}>
      <YahooNoValuationNotice data={data} />
      <div className="text-xs text-muted-foreground" data-testid={`yahoo-na-${number}`}>n/a</div>
    </SectionCard>
  );
}
