import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis } from "../../../../shared/schema";
import { calculateReverseDCF } from "../../lib/calculations";
import { formatNumber, formatPercentNoSign } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section10({ data }: Props) {
  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;

  // Use sector profile WACC for reverse DCF
  const result = useMemo(() => calculateReverseDCF({
    currentPrice: data.currentPrice,
    fcfBase: data.fcfTTM,
    wacc: sp.waccScenarios.avg,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
  }), [data, sp, netDebt]);

  const ratingColor = result.rating === "realistic" ? "text-emerald-500" :
    result.rating === "sportlich" ? "text-amber-500" : "text-red-500";
  const ratingBg = result.rating === "realistic" ? "bg-emerald-500/10 border-emerald-500/20" :
    result.rating === "sportlich" ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20";

  return (
    <SectionCard number={14} title="REVERSE DCF">
      {/* Automatic Warning for unrealistic implied growth */}
      {result.rating === "unrealistic" && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
          <span className="text-red-500 text-lg">⚠</span>
          <div>
            <div className="text-xs font-bold text-red-500">WARNUNG: Implizierte Wachstumsrate unrealistisch</div>
            <div className="text-[11px] text-red-400 mt-0.5">
              Der Markt preist g* = {formatPercentNoSign(result.impliedGrowth)} ein — deutlich über nachhaltigem GDP-Wachstum.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Implied Perpetual Growth Rate g*</div>
          <div className={`text-3xl font-bold font-mono tabular-nums ${ratingColor}`}>
            {formatPercentNoSign(result.impliedGrowth)}
          </div>
          <div className={`inline-block mt-2 px-2.5 py-1 rounded-md text-xs font-semibold border ${ratingBg} ${ratingColor}`}>
            {result.rating === "realistic" ? "Realistic" : result.rating === "sportlich" ? "Ambitious (sportlich)" : "Unrealistic"}
          </div>
        </div>

        <div className="space-y-3">
          <div className="bg-muted/30 rounded-md p-3 border border-border/50 text-xs space-y-1.5">
            <div className="font-semibold text-muted-foreground">Formula</div>
            <div className="font-mono tabular-nums">EV = FCF / (WACC - g*)</div>
            <div className="font-mono tabular-nums">g* = WACC - FCF / EV</div>
          </div>

          <div className="bg-muted/30 rounded-md p-3 border border-border/50 text-xs text-muted-foreground">
            <span className="font-semibold">Difference to Inverted DCF:</span> The Reverse DCF asks "what growth rate does the market price imply?" while the Inverted DCF applies risk-adjusted parameters to find a fair value.
          </div>
        </div>
      </div>

      <RechenWeg title="Reverse DCF Rechenweg" steps={[
        `EV = Price × Shares + Net Debt`,
        `EV = $${formatNumber(data.currentPrice)} × ${formatNumber(data.sharesOutstanding / 1e9, 2)}B + $${formatNumber(netDebt / 1e9, 2)}B`,
        `EV = $${formatNumber((data.currentPrice * data.sharesOutstanding + netDebt) / 1e9, 2)}B`,
        `g* = WACC - FCF/EV = ${formatPercentNoSign(sp.waccScenarios.avg)} - $${formatNumber(data.fcfTTM / 1e9, 2)}B / $${formatNumber((data.currentPrice * data.sharesOutstanding + netDebt) / 1e9, 2)}B`,
        `g* = ${formatPercentNoSign(result.impliedGrowth)}`,
        `Rating: ${result.rating === "realistic" ? "< 5% = realistic" : result.rating === "sportlich" ? "5-8% = ambitious (sportlich)" : "> 8% = unrealistic"}`,
      ]} />
    </SectionCard>
  );
}
