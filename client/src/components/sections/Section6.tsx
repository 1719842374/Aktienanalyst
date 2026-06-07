import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis } from "../../../../shared/schema";
import {
  calculateFCFFDCF, buildDefaultDCFParams,
  worstCaseM1, worstCaseM1Label, worstCaseM2, worstCaseM3,
  calculateCRV, calculateCatalystUpside, selectCatalystBase,
} from "../../lib/calculations";
import { formatCurrency, formatNumber, getCRVColor, getCRVBgColor } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section6({ data }: Props) {
  const sp = data.sectorProfile;
  const haircut = data.fcfHaircut;

  // === SINGLE SOURCE OF TRUTH: identical defaults as Section5 / Section13 ===
  // Bug #1 + #6 fix: previously Section6 used data.beta5Y directly (market beta 1.93)
  // and a different capex proxy. Now both sections share buildDefaultDCFParams().
  const baseParams = useMemo(() => buildDefaultDCFParams(data), [data.ticker]);

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
  const sectorDD = data.sectorMaxDrawdown || 35;
  const m1 = worstCaseM1(data.currentPrice, data.beta5Y, sectorDD);
  const m2 = worstCaseM2(data.currentPrice, 35);
  const m3 = worstCaseM3(data.currentPrice, sectorDD);
  const worstCase = Math.min(m1, m2, m3);

  // M1 display label — matches implementation exactly (Bug #2 fix)
  const m1Label = worstCaseM1Label(data.beta5Y, sectorDD);

  // === Risk-Adjusted DCF ===
  const risks = data.risks ?? [];
  const totalExpectedDamage = risks.reduce((s, r) => s + r.expectedDamage, 0);
  const riskDiscountFactor = 1 - totalExpectedDamage / 100;
  const raConservativeFV = conservativeDCF.perShare * riskDiscountFactor;
  const raOptimisticFV = optimisticDCF.perShare * riskDiscountFactor;

  // Catalyst-adj target
  const catalysts = data.catalysts;
  const _rawUpsideS6 = (catalysts || []).reduce((s, c) => s + c.gb, 0);
  const _baseInfoS6 = selectCatalystBase(conservativeDCF.perShare, _rawUpsideS6, data.currentPrice, data.analystPT.median);
  const catalystDCFBase = _baseInfoS6.base;
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

  // DCF bei CRV 3:1
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
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Formel</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Ergebnis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              <tr>
                <td className="py-2 px-2 font-medium">M1: β-Adj. Drawdown</td>
                {/* Bug #2 fix: label now generated from worstCaseM1Label() — matches implementation */}
                <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground text-[10px]">
                  {formatCurrency(data.currentPrice)} × (1 − {m1Label})
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold text-red-500">{formatCurrency(m1)}</td>
              </tr>
              <tr>
                <td className="py-2 px-2 font-medium">M2: Most Likely Risk</td>
                <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground">
                  {formatCurrency(data.currentPrice)} × (1 − 35%)
                </td>
                <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold text-red-500">{formatCurrency(m2)}</td>
              </tr>
              <tr>
                <td className="py-2 px-2 font-medium">M3: Sektor-Drawdown</td>
                <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground">
                  {formatCurrency(data.currentPrice)} × (1 − {sectorDD}%)
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

      {/* DCF bei CRV 3:1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        ``,
        `=== M1 FORMEL (Implementierung) ===`,
        `effectiveDrawdown = min(beta × sectorDD, sectorDD × 1.5), gecapped bei 65%`,
        `M1 = ${formatCurrency(data.currentPrice)} × (1 - ${m1Label})`,
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
        {isFinite(value) && !isNaN(value) ? `${formatNumber(value, 1)}:1` : "n/a"}
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        Fair: {formatCurrency(fairValue)} | WC: {formatCurrency(worstCase)}
      </div>
      <div className={`text-[10px] mt-1 font-medium ${
        value >= 2.5 ? "text-emerald-500" :
        value >= 2.0 ? "text-amber-500" : "text-red-500"
      }`}>
        {!isFinite(value) || isNaN(value) ? "–" : value >= 2.5 ? "Attractive" : value >= 2.0 ? "Acceptable" : "Unfavorable"}
      </div>
    </div>
  );
}
