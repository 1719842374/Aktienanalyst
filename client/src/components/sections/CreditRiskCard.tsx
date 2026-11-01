import type { StockAnalysis } from "../../../../shared/schema";
import { useMarketCreditSpread } from "@/lib/useMarketCreditSpread";
import { useCompanyCreditMetrics } from "@/lib/useCompanyCreditMetrics";
import { CREDIT_SOURCE_LABEL, CREDIT_SOURCE_URL, creditStressHint, marketSpreadLabel } from "@shared/credit";
import {
  COVERAGE_FORMULA, DE_FORMULA, CREDIT_CARD_NO_SCORE, CREDIT_CARD_EXPECTED_DAMAGE_NOTE, CREDIT_CARD_ISSUER_NA,
  COMPANY_CREDIT_SOURCE, debtToEquityOf,
} from "@shared/credit-risk";

/**
 * Kreditrisiko-Karte in Sektion 10 „Risikoinversion“ (F1-21 mit F1-20).
 * Markt: FRED BAA10Y über useMarketCreditSpread → GET /api/credit-spread/market (#253, gleicher Query-Key wie das
 * TA-Overlay). Unternehmen: D/E aus dem Analyse-Payload (FMP-Bilanz), Zinsdeckung über useCompanyCreditMetrics →
 * GET /api/credit-risk/company/:ticker (FMP-GuV). Reine Anzeige, kein Score. Fehlt etwas → n/a.
 */
export function CreditRiskCard({ data }: { data: StockAnalysis }) {
  const market = useMarketCreditSpread(true);
  const company = useCompanyCreditMetrics(data.ticker);
  const de = debtToEquityOf(data.financialStatements?.balanceSheet);

  const m = market.data;
  const last = m && m.points.length > 0 ? m.points[m.points.length - 1] : null;
  const stress = m?.stress ?? null;
  const hint = creditStressHint(stress);
  const bp = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)} bp`;

  const c = company.data;

  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2.5" data-testid="credit-risk-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold">Kreditrisiko / Refinanzierung</span>
        <span className="text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground">
          kein Score-Einfluss
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {/* Markt-Spread BAA10Y */}
        <div className="rounded-md border border-border/50 bg-background/40 p-2.5" data-testid="credit-market">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Markt-Spread Baa</div>
          {market.isLoading ? (
            <div className="text-[11px] text-muted-foreground mt-1" data-testid="credit-market-loading">FRED wird geladen …</div>
          ) : !last ? (
            <div className="text-[11px] text-muted-foreground mt-1" data-testid="credit-market-na">
              n/a — {m?.note || "FRED BAA10Y nicht erreichbar"}
            </div>
          ) : (
            <>
              <div className="text-sm font-semibold font-mono tabular-nums mt-0.5" data-testid="credit-market-value">{last.value.toFixed(2)}%</div>
              <div className="text-[10px] text-muted-foreground">Stand {last.date}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5" data-testid="credit-market-3m">
                {stress
                  ? <>3M: <span className="font-mono">{bp(stress.change3MPp)}</span> · Rang P{Math.round(stress.percentileRank)} der 3M-Änderungen (20J)</>
                  : "3M-Änderung: n/a (zu wenig Historie)"}
              </div>
            </>
          )}
        </div>

        {/* Verschuldung / Eigenkapital (Payload, FMP-Bilanz) */}
        <div className="rounded-md border border-border/50 bg-background/40 p-2.5" data-testid="credit-de">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Verschuldung / EK</div>
          {de.value != null ? (
            <div className="text-sm font-semibold font-mono tabular-nums mt-0.5" data-testid="credit-de-value">{de.value.toFixed(2)}</div>
          ) : (
            <div className="text-[11px] text-muted-foreground mt-1" data-testid="credit-de-na">n/a — {de.note}</div>
          )}
          <div className="text-[10px] text-muted-foreground">FMP-Bilanz (Analyse)</div>
        </div>

        {/* Zinsdeckung (FMP-GuV über /api/credit-risk/company) */}
        <div className="rounded-md border border-border/50 bg-background/40 p-2.5" data-testid="credit-coverage">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Zinsdeckung</div>
          {company.isLoading ? (
            <div className="text-[11px] text-muted-foreground mt-1" data-testid="credit-coverage-loading">FMP wird geladen …</div>
          ) : c && c.interestCoverage != null ? (
            <>
              <div className="text-sm font-semibold font-mono tabular-nums mt-0.5" data-testid="credit-coverage-value">{c.interestCoverage.toFixed(1)}x</div>
              <div className="text-[10px] text-muted-foreground">
                {c.fiscalYear ? `GJ ${c.fiscalYear}` : "letztes GJ"}{c.fiscalDate ? ` (Stichtag ${c.fiscalDate})` : ""}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-muted-foreground mt-1" data-testid="credit-coverage-na">
              n/a — {c?.note || "FMP nicht erreichbar"}
            </div>
          )}
        </div>
      </div>

      {hint && (
        <div className="text-[11px] rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-amber-500" data-testid="credit-stress-hint">
          ⚠ {hint}
        </div>
      )}

      <div className="text-[10px] text-muted-foreground space-y-0.5 break-words">
        <div>{marketSpreadLabel(data.ticker)} · Quelle <a className="underline" href={CREDIT_SOURCE_URL} target="_blank" rel="noreferrer">{CREDIT_SOURCE_LABEL}</a></div>
        <div>{DE_FORMULA} · {COVERAGE_FORMULA} ({COMPANY_CREDIT_SOURCE})</div>
        <div data-testid="credit-issuer-na">{CREDIT_CARD_ISSUER_NA}</div>
        <div data-testid="credit-expected-damage-note">{CREDIT_CARD_EXPECTED_DAMAGE_NOTE}</div>
        <div>{CREDIT_CARD_NO_SCORE}</div>
      </div>
    </div>
  );
}
