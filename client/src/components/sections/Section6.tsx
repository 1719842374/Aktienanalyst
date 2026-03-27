import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis } from "../../../../shared/schema";
import {
  calculateFCFFDCF, type FCFFDCFParams,
  worstCaseM1, worstCaseM2, worstCaseM3, calculateCRV, calculateCatalystUpside,
} from "../../lib/calculations";
import { formatCurrency, formatNumber, formatPercentNoSign, getCRVColor, getCRVBgColor } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section6({ data }: Props) {
  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;
  const haircut = data.fcfHaircut;

  // === FCFF DCF params (IDENTICAL to Section 5 / Section 13 for consistency) ===
  const ebitMarginDefault = data.ebitda > 0 && data.revenue > 0
    ? +((data.ebitda / data.revenue) * 100).toFixed(1) : 15;
  const capexDefault = data.revenue > 0 && data.fcfTTM > 0
    ? +Math.max(2, Math.min(15, ((data.ebitda - data.fcfTTM) / data.revenue) * 100)).toFixed(1) : 5;
  const revenueGrowthDefault = sp.growthAssumptions.g1 || 10;
  const rf = 4.2, erp = 5.5, taxR = 21, rd = 5.0;
  const debtRatioVal = data.totalDebt > 0 ? +((data.totalDebt / (data.marketCap + data.totalDebt)) * 100).toFixed(0) : 10;
  const evFrac = (100 - debtRatioVal) / 100;
  const dvFrac = debtRatioVal / 100;
  const targetWACC = sp.waccScenarios.avg;
  const debtCostPart = dvFrac * rd * (1 - taxR / 100);
  const impliedBeta = Math.max(0.5, Math.min(1.8,
    (targetWACC - debtCostPart - evFrac * rf) / (evFrac * erp)
  ));
  const dcfBeta = +Math.min(impliedBeta, data.beta5Y + 0.1).toFixed(2);

  const baseParams: FCFFDCFParams = useMemo(() => ({
    revenueBase: data.revenue,
    revenueGrowthP1: revenueGrowthDefault,
    revenueGrowthP2: Math.max(3, +(revenueGrowthDefault * 0.6).toFixed(1)),
    ebitMargin: ebitMarginDefault,
    ebitMarginTerminal: +Math.max(8, ebitMarginDefault * 0.9).toFixed(1),
    capexPct: capexDefault,
    deltaWCPct: 5,
    taxRate: taxR,
    daRatio: +Math.max(2, capexDefault * 0.8).toFixed(1),
    riskFreeRate: rf,
    beta: dcfBeta,
    erp,
    debtRatio: debtRatioVal,
    costOfDebt: rd,
    terminalG: sp.growthAssumptions.terminal || 2.5,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
    minorityInterests: 0,
    fcfHaircut: haircut,
  }), [data, sp, netDebt, haircut, ebitMarginDefault, capexDefault, revenueGrowthDefault, dcfBeta, debtRatioVal]);

  const conservativeDCF = useMemo(() => calculateFCFFDCF(baseParams), [baseParams]);

  const optimisticDCF = useMemo(() => calculateFCFFDCF({
    ...baseParams,
    revenueGrowthP1: baseParams.revenueGrowthP1 * 1.5,
    revenueGrowthP2: baseParams.revenueGrowthP2 * 1.4,
    ebitMargin: baseParams.ebitMargin * 1.15,
    ebitMarginTerminal: baseParams.ebitMarginTerminal * 1.1,
    erp: baseParams.erp - 1,
  }), [baseParams]);

  // Worst Case methods
  const m1 = worstCaseM1(data.currentPrice, data.beta5Y, 50);
  const m2 = worstCaseM2(data.currentPrice, 35);
  const m3 = worstCaseM3(data.currentPrice, data.sectorMaxDrawdown);
  const worstCase = Math.min(m1, m2, m3);

  // === Risk-Adjusted DCF: discount Fair Values by total expected risk damage ===
  const risks = data.risks;
  const totalExpectedDamage = risks.reduce((s, r) => s + r.expectedDamage, 0);
  const riskDiscountFactor = 1 - totalExpectedDamage / 100;
  const raConservativeFV = conservativeDCF.perShare * riskDiscountFactor;
  const raOptimisticFV = optimisticDCF.perShare * riskDiscountFactor;

  // Catalyst-adj target (base)
  const catalysts = data.catalysts;
  const catalystDCFBase = conservativeDCF.perShare > data.currentPrice * 0.05
    ? conservativeDCF.perShare
    : (data.analystPT.median > 0 ? data.analystPT.median : data.currentPrice);
  const { adjustedTarget } = calculateCatalystUpside(catalysts, catalystDCFBase);
  const raAdjustedTarget = adjustedTarget * riskDiscountFactor;

  // === BASE CRV ===
  const crvConservative = calculateCRV(conservativeDCF.perShare, worstCase, data.currentPrice);
  const crvOptimistic = calculateCRV(optimisticDCF.perShare, worstCase, data.currentPrice);
  const crvCatalyst = calculateCRV(adjustedTarget, worstCase, data.currentPrice);

  // === RISK-ADJUSTED CRV ===
  const raCrvConservative = calculateCRV(raConservativeFV, worstCase, data.currentPrice);
  const raCrvOptimistic = calculateCRV(raOptimisticFV, worstCase, data.currentPrice);
  const raCrvCatalyst = calculateCRV(raAdjustedTarget, worstCase, data.currentPrice);

  // DCF bei CRV 3:1 (base and risk-adjusted)
  const dcfBeiCRV3 = (conservativeDCF.perShare + 3 * worstCase) / 4;
  const raDcfBeiCRV3 = (raConservativeFV + 3 * worstCase) / 4;

  const baseCRVs = [
    { label: "Conservative", value: crvConservative, fairValue: conservativeDCF.perShare },
    { label: "Optimistic", value: crvOptimistic, fairValue: optimisticDCF.perShare },
    { label: "Catalyst-Adjusted", value: crvCatalyst, fairValue: adjustedTarget },
  ];

  const riskAdjCRVs = [
    { label: "Conservative", value: raCrvConservative, fairValue: raConservativeFV },
    { label: "Optimistic", value: raCrvOptimistic, fairValue: raOptimisticFV },
    { label: "Catalyst-Adjusted", value: raCrvCatalyst, fairValue: raAdjustedTarget },
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
        <div className="mt-2 text-[10px] text-muted-foreground bg-muted/30 rounded-md p-2 border border-border/50">
          <span className="font-semibold">Max Drawdown Reference:</span> {data.maxDrawdownHistory} ({data.maxDrawdownYear})
        </div>
      </div>

      {/* === BASE CRV (without risk discount) === */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">CRV — Base (ohne Risiko-Abschlag)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {baseCRVs.map((crv, i) => (
            <CRVCard key={i} label={crv.label} value={crv.value} fairValue={crv.fairValue} worstCase={worstCase} />
          ))}
        </div>
      </div>

      {/* === RISK-ADJUSTED CRV === */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
          CRV — Risikoadjustiert (nach Expected Damage)
        </h3>
        <div className="text-[10px] text-muted-foreground mb-2">
          Fair Values abgeschlagen um Total Expected Damage von <span className="font-semibold text-red-400">{formatNumber(totalExpectedDamage, 1)}%</span> (Σ EW% × Impact% aus Risikoinversion)
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {riskAdjCRVs.map((crv, i) => (
            <CRVCard key={i} label={crv.label} value={crv.value} fairValue={crv.fairValue} worstCase={worstCase} riskAdj />
          ))}
        </div>
      </div>

      {/* DCF bei CRV 3:1 — both Base and Risk-Adjusted */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Base */}
        <div className={`rounded-lg p-3 border-2 ${data.currentPrice <= dcfBeiCRV3 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
          <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">DCF bei CRV 3:1 — Base</div>
          <div className="text-lg font-bold font-mono tabular-nums mt-0.5">{formatCurrency(dcfBeiCRV3)}</div>
          <div className={`text-xs font-bold mt-0.5 ${data.currentPrice <= dcfBeiCRV3 ? 'text-emerald-500' : 'text-red-500'}`}>
            {data.currentPrice <= dcfBeiCRV3 ? 'Kurs UNTER Max-Entry ✔' : 'Kurs ÜBER Max-Entry ⚠'}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            = ({formatCurrency(conservativeDCF.perShare)} + 3 × {formatCurrency(worstCase)}) / 4
          </div>
        </div>
        {/* Risk-Adjusted */}
        <div className={`rounded-lg p-3 border-2 ${data.currentPrice <= raDcfBeiCRV3 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
          <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">DCF bei CRV 3:1 — Risikoadj.</div>
          <div className="text-lg font-bold font-mono tabular-nums mt-0.5">{formatCurrency(raDcfBeiCRV3)}</div>
          <div className={`text-xs font-bold mt-0.5 ${data.currentPrice <= raDcfBeiCRV3 ? 'text-emerald-500' : 'text-red-500'}`}>
            {data.currentPrice <= raDcfBeiCRV3 ? 'Kurs UNTER Max-Entry ✔' : 'Kurs ÜBER Max-Entry ⚠'}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1 font-mono">
            = ({formatCurrency(raConservativeFV)} + 3 × {formatCurrency(worstCase)}) / 4
          </div>
        </div>
      </div>

      <RechenWeg title="CRV Rechenweg (FCFF-basiert)" steps={[
        `=== BASE CRV ===`,
        `CRV = (Fair Value - Worst Case) / (Kurs - Worst Case)`,
        `Conservative CRV = (${formatCurrency(conservativeDCF.perShare)} - ${formatCurrency(worstCase)}) / (${formatCurrency(data.currentPrice)} - ${formatCurrency(worstCase)}) = ${formatNumber(crvConservative, 2)}:1`,
        ``,
        `=== RISIKOADJUSTIERT ===`,
        `Total Expected Damage = ${formatNumber(totalExpectedDamage, 2)}%`,
        `Risk-Adj. Fair Value = ${formatCurrency(conservativeDCF.perShare)} × (1 - ${formatNumber(totalExpectedDamage, 1)}%) = ${formatCurrency(raConservativeFV)}`,
        `Risk-Adj. CRV = (${formatCurrency(raConservativeFV)} - ${formatCurrency(worstCase)}) / (${formatCurrency(data.currentPrice)} - ${formatCurrency(worstCase)}) = ${formatNumber(raCrvConservative, 2)}:1`,
        ``,
        `DCF bei CRV 3:1 (Base) = (${formatCurrency(conservativeDCF.perShare)} + 3 × ${formatCurrency(worstCase)}) / 4 = ${formatCurrency(dcfBeiCRV3)}`,
        `DCF bei CRV 3:1 (Risk-Adj.) = (${formatCurrency(raConservativeFV)} + 3 × ${formatCurrency(worstCase)}) / 4 = ${formatCurrency(raDcfBeiCRV3)}`,
      ]} />
    </SectionCard>
  );
}

function CRVCard({ label, value, fairValue, worstCase, riskAdj }: {
  label: string; value: number; fairValue: number; worstCase: number; riskAdj?: boolean;
}) {
  return (
    <div className={`rounded-lg p-3 border ${getCRVBgColor(value)}`}>
      <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
        {label} {riskAdj && <span className="text-amber-500">(RA)</span>}
      </div>
      <div className={`text-xl font-bold font-mono tabular-nums mt-1 ${getCRVColor(value)}`}>
        {formatNumber(value, 1)}:1
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        Fair: {formatCurrency(fairValue)} | WC: {formatCurrency(worstCase)}
      </div>
      <div className={`text-[10px] mt-1 font-medium ${
        value >= 2.5 ? "text-emerald-500" :
        value >= 2.0 ? "text-amber-500" : "text-red-500"
      }`}>
        {value >= 2.5 ? "Attractive" : value >= 2.0 ? "Acceptable" : "Unfavorable"}
      </div>
    </div>
  );
}
