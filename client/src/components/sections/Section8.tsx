import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis } from "../../../../shared/schema";
import { calculateDCF } from "../../lib/calculations";
import { formatCurrency, formatNumber, formatPercentNoSign } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section8({ data }: Props) {
  // Use backend risks directly
  const risks = data.risks;
  const sp = data.sectorProfile;

  const top3 = useMemo(() =>
    [...risks].sort((a, b) => b.expectedDamage - a.expectedDamage).slice(0, 3),
    [risks]
  );

  const totalExpectedDamage = risks.reduce((s, r) => s + r.expectedDamage, 0);
  const baseWACC = sp.waccScenarios.kons;
  const baseGrowth = sp.growthAssumptions.g1;
  const waccAdj = baseWACC + totalExpectedDamage / 10;
  const growthAdj = baseGrowth - totalExpectedDamage / 5;

  const netDebt = data.totalDebt - data.cashEquivalents;
  const haircut = data.fcfHaircut;

  const invertedDCF = useMemo(() => calculateDCF({
    fcfBase: data.fcfTTM,
    haircut,
    wacc: waccAdj,
    g1: Math.max(growthAdj, 1),
    g2: Math.max(growthAdj / 2, 0.5),
    terminalG: sp.growthAssumptions.terminal,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
  }), [data, waccAdj, growthAdj, sp, netDebt, haircut]);

  // AUTOMATIC WARNING if inverted DCF < current price
  const belowPrice = invertedDCF.perShare < data.currentPrice;

  return (
    <SectionCard number={8} title="INVERSION – RISIKOEINPREISUNG">
      {/* Automatic Warning */}
      {belowPrice && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
          <span className="text-red-500 text-lg">⚠</span>
          <div>
            <div className="text-xs font-bold text-red-500">WARNUNG: Inverted DCF &lt; aktueller Kurs</div>
            <div className="text-[11px] text-red-400 mt-0.5">
              Risikoadjustierter Fair Value ({formatCurrency(invertedDCF.perShare)}) unter Kurs ({formatCurrency(data.currentPrice)}).
              Anti-Bias: Erhöhte Vorsicht geboten.
            </div>
          </div>
        </div>
      )}

      {/* Risk Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Risk</th>
              <th className="text-center py-2 px-1 text-muted-foreground font-medium">Category</th>
              <th className="text-right py-2 px-1 text-muted-foreground font-medium">EW%</th>
              <th className="text-right py-2 px-1 text-muted-foreground font-medium">Impact%</th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">Exp. Damage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {risks.map((r, i) => {
              const isTop3 = top3.includes(r);
              return (
                <tr key={i} className={isTop3 ? "bg-red-500/5" : ""}>
                  <td className="py-1.5 px-2 font-medium">
                    {isTop3 && <span className="text-red-500 mr-1">●</span>}
                    {r.name}
                  </td>
                  <td className="py-1.5 px-1 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      r.category === "Binary" ? "bg-red-500/10 text-red-500" :
                      r.category === "Gradual" ? "bg-amber-500/10 text-amber-500" :
                      "bg-purple-500/10 text-purple-500"
                    }`}>
                      {r.category}
                    </span>
                  </td>
                  <td className="py-1.5 px-1 text-right font-mono tabular-nums">{r.ew}%</td>
                  <td className="py-1.5 px-1 text-right font-mono tabular-nums">{r.impact}%</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold text-red-500">{formatNumber(r.expectedDamage, 2)}%</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td colSpan={4} className="py-2 px-2">Total Expected Damage</td>
              <td className="py-2 px-2 text-right font-mono tabular-nums text-red-500">{formatNumber(totalExpectedDamage, 2)}%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Adjusted Parameters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AdjCard label="WACC Base" value={formatPercentNoSign(baseWACC)} />
        <AdjCard label="WACC Adj." value={formatPercentNoSign(waccAdj, 1)} highlight />
        <AdjCard label="Growth Base" value={formatPercentNoSign(baseGrowth, 1)} />
        <AdjCard label="Growth Adj." value={formatPercentNoSign(Math.max(growthAdj, 1), 1)} highlight />
      </div>

      {/* Inverted DCF */}
      <div className={`rounded-lg p-3 border ${belowPrice ? "bg-red-500/5 border-red-500/20" : "bg-emerald-500/5 border-emerald-500/20"}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold">Inverted Risk-Adjusted DCF</div>
            <div className="text-[10px] text-muted-foreground">Using WACC_adj and Growth_adj</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold font-mono tabular-nums">{formatCurrency(invertedDCF.perShare)}</div>
            <div className={`text-xs font-mono tabular-nums ${invertedDCF.perShare > data.currentPrice ? "text-emerald-500" : "text-red-500"}`}>
              {((invertedDCF.perShare / data.currentPrice - 1) * 100).toFixed(1)}% vs current
            </div>
          </div>
        </div>
      </div>

      <RechenWeg title="Risk Adjustment Rechenweg" steps={[
        `Total Expected Damage = Σ(EW% × Impact%) = ${formatNumber(totalExpectedDamage, 2)}%`,
        `WACC_adj = Base WACC + Total Damage / 10 = ${formatPercentNoSign(baseWACC)} + ${formatNumber(totalExpectedDamage / 10, 2)}% = ${formatPercentNoSign(waccAdj, 2)}`,
        `Growth_adj = Base Growth - Total Damage / 5 = ${formatPercentNoSign(baseGrowth, 1)} - ${formatNumber(totalExpectedDamage / 5, 2)}% = ${formatPercentNoSign(Math.max(growthAdj, 1), 2)}`,
        `Inverted DCF with adjusted inputs → ${formatCurrency(invertedDCF.perShare)} per share`,
        belowPrice ? `⚠ WARNUNG: ${formatCurrency(invertedDCF.perShare)} < ${formatCurrency(data.currentPrice)} → Downside dominiert` : `✓ ${formatCurrency(invertedDCF.perShare)} > ${formatCurrency(data.currentPrice)} → Upside-Potenzial vorhanden`,
      ]} />
    </SectionCard>
  );
}

function AdjCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md p-2.5 border text-center ${highlight ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-border/50"}`}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${highlight ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}
