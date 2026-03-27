import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis } from "../../../../shared/schema";
import { worstCaseM1, worstCaseM2, worstCaseM3, calculateCRV, calculateDCF, calculateCatalystUpside } from "../../lib/calculations";
import { formatCurrency, formatNumber, getCRVColor, getCRVBgColor } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section6({ data }: Props) {
  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;
  const haircut = data.fcfHaircut;

  // Use sector max drawdown for M3, and maxDrawdownHistory for context
  const m1 = worstCaseM1(data.currentPrice, data.beta5Y, 50);
  const m2 = worstCaseM2(data.currentPrice, 35);
  const m3 = worstCaseM3(data.currentPrice, data.sectorMaxDrawdown);
  const worstCase = Math.min(m1, m2, m3);

  const conservativeDCF = useMemo(() => calculateDCF({
    fcfBase: data.fcfTTM, haircut,
    wacc: sp.waccScenarios.kons,
    g1: sp.growthAssumptions.g1,
    g2: sp.growthAssumptions.g2,
    terminalG: sp.growthAssumptions.terminal,
    sharesOutstanding: data.sharesOutstanding, netDebt,
  }), [data, sp, netDebt, haircut]);

  const optimisticDCF = useMemo(() => calculateDCF({
    fcfBase: data.fcfTTM, haircut,
    wacc: sp.waccScenarios.opt,
    g1: sp.growthAssumptions.g1 * 1.5,
    g2: sp.growthAssumptions.g2 * 1.5,
    terminalG: sp.growthAssumptions.terminal + 0.5,
    sharesOutstanding: data.sharesOutstanding, netDebt,
  }), [data, sp, netDebt, haircut]);

  // Use backend catalysts
  const catalysts = data.catalysts;
  const { adjustedTarget } = calculateCatalystUpside(catalysts, conservativeDCF.perShare);

  // CORRECT CRV formula: (Fair Value - Worst Case) / (Kurs - Worst Case)
  const crvConservative = calculateCRV(conservativeDCF.perShare, worstCase, data.currentPrice);
  const crvOptimistic = calculateCRV(optimisticDCF.perShare, worstCase, data.currentPrice);
  const crvCatalyst = calculateCRV(adjustedTarget, worstCase, data.currentPrice);

  // DCF bei CRV 3:1 = max acceptable entry price for exactly 3:1
  const dcfBeiCRV3 = (conservativeDCF.perShare + 3 * worstCase) / 4;

  const crvs = [
    { label: "Conservative", value: crvConservative, fairValue: conservativeDCF.perShare },
    { label: "Optimistic", value: crvOptimistic, fairValue: optimisticDCF.perShare },
    { label: "Catalyst-Adjusted", value: crvCatalyst, fairValue: adjustedTarget },
  ];

  return (
    <SectionCard number={6} title="RISIKOADJUSTIERTES CRV">
      {/* Worst Case Methods */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Worst Case Methods</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Method</th>
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Formula</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              <tr>
                <td className="py-2 px-2 font-medium">M1: Beta × Max Drawdown</td>
                <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground">
                  {formatCurrency(data.currentPrice)} × (1 - min(90%, {formatNumber(data.beta5Y)} × 50%))
                  {data.beta5Y * 50 > 90 && (
                    <span className="ml-1 text-amber-500 text-[10px]">⚠ capped (raw: {formatNumber(data.beta5Y * 50, 0)}%)</span>
                  )}
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold text-red-500">{formatCurrency(m1)}</td>
              </tr>
              <tr>
                <td className="py-2 px-2 font-medium">M2: Most Likely Risk</td>
                <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground">
                  {formatCurrency(data.currentPrice)} × (1 - 35%)
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold text-red-500">{formatCurrency(m2)}</td>
              </tr>
              <tr>
                <td className="py-2 px-2 font-medium">M3: Sector Drawdown</td>
                <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground">
                  {formatCurrency(data.currentPrice)} × (1 - {data.sectorMaxDrawdown}%)
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold text-red-500">{formatCurrency(m3)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border">
                <td colSpan={2} className="py-2 px-2 font-bold">Worst Case = min(M1, M2, M3)</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums font-bold text-red-500">{formatCurrency(worstCase)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {/* Historical drawdown reference */}
        <div className="mt-2 text-[10px] text-muted-foreground bg-muted/30 rounded-md p-2 border border-border/50">
          <span className="font-semibold">Max Drawdown Reference:</span> {data.maxDrawdownHistory} ({data.maxDrawdownYear})
        </div>
      </div>

      {/* CRV Calculations */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">CRV (Chance-Risiko-Verhältnis)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {crvs.map((crv, i) => (
            <div key={i} className={`rounded-lg p-3 border ${getCRVBgColor(crv.value)}`}>
              <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{crv.label}</div>
              <div className={`text-xl font-bold font-mono tabular-nums mt-1 ${getCRVColor(crv.value)}`}>
                {formatNumber(crv.value, 1)}:1
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Fair: {formatCurrency(crv.fairValue)} | WC: {formatCurrency(worstCase)}
              </div>
              <div className={`text-[10px] mt-1 font-medium ${
                crv.value >= 2.5 ? "text-emerald-500" :
                crv.value >= 2.0 ? "text-amber-500" : "text-red-500"
              }`}>
                {crv.value >= 2.5 ? "Attractive" : crv.value >= 2.0 ? "Acceptable" : "Unfavorable"}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DCF bei CRV 3:1 — Max. Einstiegskurs */}
      <div className={`rounded-lg p-3 border-2 ${data.currentPrice <= dcfBeiCRV3 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">DCF bei CRV 3:1 (Max. Einstiegskurs)</div>
            <div className="text-lg font-bold font-mono tabular-nums mt-0.5">{formatCurrency(dcfBeiCRV3)}</div>
          </div>
          <div className="text-right">
            <div className={`text-sm font-bold ${data.currentPrice <= dcfBeiCRV3 ? 'text-emerald-500' : 'text-red-500'}`}>
              {data.currentPrice <= dcfBeiCRV3 ? 'Kurs UNTER Max-Entry ✔' : 'Kurs ÜBER Max-Entry ⚠'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Kurs: {formatCurrency(data.currentPrice)} | Differenz: {formatCurrency(dcfBeiCRV3 - data.currentPrice)}
            </div>
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground mt-2 font-mono">
          = (Kons. DCF + 3 × WC) / 4 = ({formatCurrency(conservativeDCF.perShare)} + 3 × {formatCurrency(worstCase)}) / 4 = {formatCurrency(dcfBeiCRV3)}
        </div>
      </div>

      <RechenWeg title="CRV Rechenweg (korrigierte Formel)" steps={[
        `CRV = (Fair Value - Worst Case) / (Kurs - Worst Case)`,
        `Conservative CRV = (${formatCurrency(conservativeDCF.perShare)} - ${formatCurrency(worstCase)}) / (${formatCurrency(data.currentPrice)} - ${formatCurrency(worstCase)})`,
        `= ${formatCurrency(conservativeDCF.perShare - worstCase)} / ${formatCurrency(data.currentPrice - worstCase)}`,
        `= ${formatNumber(crvConservative, 2)}:1`,
        ``,
        `DCF bei CRV 3:1 = (Kons. DCF + 3 × Worst Case) / 4`,
        `= (${formatCurrency(conservativeDCF.perShare)} + 3 × ${formatCurrency(worstCase)}) / 4`,
        `= ${formatCurrency(dcfBeiCRV3)}`,
      ]} />
    </SectionCard>
  );
}
