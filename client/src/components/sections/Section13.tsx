import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import {
  calculateFCFFDCF, type FCFFDCFParams,
  calculateCRV, calculateRSL, calculateReverseDCF,
  worstCaseM1, worstCaseM2, worstCaseM3, calculateCatalystUpside,
  gbmMonteCarlo, calculateGBMParams,
} from "../../lib/calculations";
import { formatCurrency, formatNumber, formatPercentNoSign, formatLargeNumber, formatRatio, getCRVColor } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section13({ data }: Props) {
  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;
  const haircut = data.fcfHaircut;

  // Derive FCFF DCF params from data (same defaults as Section5)
  const ebitMarginDefault = data.ebitda > 0 && data.revenue > 0
    ? (data.operatingIncome > 0 ? +((data.operatingIncome / data.revenue) * 100).toFixed(1) : +((data.ebitda / data.revenue) * 100 * 0.6).toFixed(1))
    : 15;
  const capexDefault = data.revenue > 0 && data.fcfTTM > 0
    ? +Math.max(2, Math.min(15, ((data.ebitda - data.fcfTTM) / data.revenue) * 100)).toFixed(1)
    : 5;
  const revenueGrowthDefault = sp.growthAssumptions.g1 || 10;

  // Derive sector-implied beta from avg WACC scenario (same logic as Section5)
  const rfS13 = 4.2;
  const erpS13 = 5.5;
  const taxS13 = 21;
  const rdS13 = 5.0;
  const debtRatioS13 = data.totalDebt > 0 ? +((data.totalDebt / (data.marketCap + data.totalDebt)) * 100).toFixed(0) : 10;
  const evFracS13 = (100 - debtRatioS13) / 100;
  const dvFracS13 = debtRatioS13 / 100;
  const targetWACCS13 = sp.waccScenarios.avg;
  const debtCostPartS13 = dvFracS13 * rdS13 * (1 - taxS13 / 100);
  const impliedBetaS13 = Math.max(0.5, Math.min(1.8,
    (targetWACCS13 - debtCostPartS13 - evFracS13 * rfS13) / (evFracS13 * erpS13)
  ));
  const dcfBetaS13 = +Math.min(impliedBetaS13, data.beta5Y + 0.1).toFixed(2);

  const baseParams: FCFFDCFParams = useMemo(() => ({
    revenueBase: data.revenue,
    revenueGrowthP1: revenueGrowthDefault,
    revenueGrowthP2: Math.max(3, +(revenueGrowthDefault * 0.6).toFixed(1)),
    ebitMargin: ebitMarginDefault,
    ebitMarginTerminal: +Math.max(8, ebitMarginDefault * 0.9).toFixed(1),
    capexPct: capexDefault,
    deltaWCPct: 5,
    taxRate: taxS13,
    daRatio: +Math.max(2, capexDefault * 0.8).toFixed(1),
    riskFreeRate: rfS13,
    beta: dcfBetaS13,
    erp: erpS13,
    debtRatio: debtRatioS13,
    costOfDebt: rdS13,
    terminalG: sp.growthAssumptions.terminal || 2.5,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
    minorityInterests: 0,
    fcfHaircut: haircut,
    actualEPS: data.epsTTM,
    forwardEPS: data.epsConsensusNextFY,
  }), [data, sp, netDebt, haircut, ebitMarginDefault, capexDefault, revenueGrowthDefault, dcfBetaS13, debtRatioS13]);

  const conservativeDCF = useMemo(() => calculateFCFFDCF(baseParams), [baseParams]);

  const optimisticDCF = useMemo(() => calculateFCFFDCF({
    ...baseParams,
    revenueGrowthP1: baseParams.revenueGrowthP1 * 1.5,
    revenueGrowthP2: baseParams.revenueGrowthP2 * 1.4,
    ebitMargin: baseParams.ebitMargin * 1.15,
    ebitMarginTerminal: baseParams.ebitMarginTerminal * 1.1,
    erp: baseParams.erp - 1,
  }), [baseParams]);

  const stressDCF = useMemo(() => calculateFCFFDCF({
    ...baseParams,
    revenueGrowthP1: Math.max(0, baseParams.revenueGrowthP1 * 0.3),
    revenueGrowthP2: Math.max(0, baseParams.revenueGrowthP2 * 0.3),
    ebitMargin: baseParams.ebitMargin * 0.7,
    ebitMarginTerminal: baseParams.ebitMarginTerminal * 0.75,
    erp: baseParams.erp + 2,
    terminalG: Math.max(1, baseParams.terminalG - 0.5),
  }), [baseParams]);

  // Use backend catalysts
  const catalysts = data.catalysts;
  // Catalyst-Adj. Target: use conservative DCF as base, but if DCF perShare is unreasonably low
  // (e.g. negative equity, negative EBIT companies), fall back to analyst PT median as base
  const catalystDCFBase = conservativeDCF.perShare > data.currentPrice * 0.05
    ? conservativeDCF.perShare
    : (data.analystPT.median > 0 ? data.analystPT.median : data.currentPrice);
  const catalystBaseFallback = catalystDCFBase !== conservativeDCF.perShare;
  const { totalUpside, adjustedTarget } = calculateCatalystUpside(catalysts, catalystDCFBase);

  const m1 = worstCaseM1(data.currentPrice, data.beta5Y, 50);
  const m2 = worstCaseM2(data.currentPrice, 35);
  const m3 = worstCaseM3(data.currentPrice, data.sectorMaxDrawdown);
  const worstCase = Math.min(m1, m2, m3);

  const prices26w = useMemo(() => {
    const sorted = [...data.historicalPrices].sort((a, b) => b.date.localeCompare(a.date));
    return sorted.slice(0, 130).map((p) => p.close);
  }, [data.historicalPrices]);
  const rsl = calculateRSL(data.currentPrice, prices26w);

  const reverseDCF = calculateReverseDCF({
    currentPrice: data.currentPrice, fcfBase: data.fcfTTM,
    wacc: conservativeDCF.wacc,
    sharesOutstanding: data.sharesOutstanding, netDebt,
  });

  // CRVs
  const crvConservative = calculateCRV(conservativeDCF.perShare, worstCase, data.currentPrice);
  const crvOptimistic = calculateCRV(optimisticDCF.perShare, worstCase, data.currentPrice);

  // DCF bei CRV 3:1 = max acceptable entry price for exactly 3:1 reward/risk
  const dcfBeiCRV3 = (conservativeDCF.perShare + 3 * worstCase) / 4;

  // Upside/Downside % for DCF scenarios
  const conservativeUpside = ((conservativeDCF.perShare / data.currentPrice - 1) * 100);
  const optimisticUpside = ((optimisticDCF.perShare / data.currentPrice - 1) * 100);
  const stressDownside = ((stressDCF.perShare / data.currentPrice - 1) * 100);

  const ptUpside = ((data.analystPT.median - data.currentPrice) / data.currentPrice) * 100;

  // RSL growth adjustment flag
  const rslGrowthAdj = rsl < 105 ? "-5% to -10%" : "none";

  // Monte Carlo downside probability
  const mcResult = useMemo(() => {
    const prices = data.historicalPrices.map(p => p.close);
    const params = calculateGBMParams(prices);
    return gbmMonteCarlo({
      currentPrice: data.currentPrice,
      mu: params.mu,
      sigma: params.sigma,
      iterations: 5000,
      tradingDays: 252,
    }, data.analystPT.median);
  }, [data]);

  return (
    <SectionCard number={17} title="ZUSAMMENFASSUNGSTABELLE">
      {/* DCF Upside/Downside Visual */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">DCF Szenarien — Upside / Downside (FCFF)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ScenarioCard
            label="Conservative DCF"
            value={conservativeDCF.perShare}
            currentPrice={data.currentPrice}
            pct={conservativeUpside}
            wacc={conservativeDCF.wacc}
          />
          <ScenarioCard
            label="Optimistic DCF"
            value={optimisticDCF.perShare}
            currentPrice={data.currentPrice}
            pct={optimisticUpside}
            wacc={optimisticDCF.wacc}
          />
          <ScenarioCard
            label="Macro-Stress DCF"
            value={stressDCF.perShare}
            currentPrice={data.currentPrice}
            pct={stressDownside}
            wacc={stressDCF.wacc}
            isStress
          />
        </div>
      </div>

      {/* Downside-Wahrscheinlichkeit (Monte Carlo) */}
      <div className="rounded-lg border-2 border-border p-3">
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          Downside-Wahrscheinlichkeit (Monte Carlo GBM, 1Y)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ProbCard
            label="P(Verlust)"
            value={mcResult.downsideProb}
            threshold={0.5}
          />
          <ProbCard
            label="P(≥10% Loss)"
            value={mcResult.downsideProb10}
            threshold={0.3}
          />
          <ProbCard
            label="P(≥20% Loss)"
            value={mcResult.downsideProb20}
            threshold={0.2}
          />
          <ProbCard
            label="P(Analyst PT)"
            value={mcResult.analystPTProb}
            threshold={-1}
            inverted
          />
        </div>
        {/* Probability bar */}
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
            <span>Downside {formatPercentNoSign(mcResult.downsideProb * 100, 0)}</span>
            <span>Upside {formatPercentNoSign((1 - mcResult.downsideProb) * 100, 0)}</span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden flex">
            <div className="bg-red-500/60" style={{ width: `${mcResult.downsideProb * 100}%` }} />
            <div className="bg-emerald-500/60" style={{ width: `${(1 - mcResult.downsideProb) * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Full Summary Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Metric</th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">Value</th>
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Assessment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            <SummaryRow label="Current Price" value={formatCurrency(data.currentPrice)} />
            <SummaryRow label="Market Cap" value={formatLargeNumber(data.marketCap)} />
            <SummaryRow label="Sector / Industry" value={`${data.sector} — ${data.industry}`} />
            <SummaryRow label="Cycle Class" value={sp.cycleClass} note={`Political: ${sp.politicalCycle}`} />
            <SummaryRow label="P/E (TTM)" value={formatNumber(data.peRatio, 1)} note={`Sector: ${formatNumber(data.sectorAvgPE, 1)}`} />
            <SummaryRow label="Forward P/E" value={formatNumber(data.forwardPE, 1)} note={`Sector: ${formatNumber(data.sectorAvgPE, 1)}`} />
            <SummaryRow label="PEG Ratio" value={formatNumber(data.pegRatio, 2)} note={data.pegRatio < 1 ? "Undervalued" : data.pegRatio < 2 ? "Fair" : "Premium"} />
            <SummaryRow label="EV/EBITDA" value={formatNumber(data.evEbitda, 1)} note={`Sector: ${formatNumber(data.sectorAvgEVEBITDA, 1)}`} />
            <SummaryRow label="Beta (5Y)" value={formatNumber(data.beta5Y)} />
            <SummaryRow label="FCF Margin" value={formatPercentNoSign(data.fcfMargin)} />
            <SummaryRow label="FCF Haircut" value={`${haircut}%`} note={haircut > 0 ? `Gov. exposure: ${formatPercentNoSign(data.governmentExposure)}` : "N/A"} />
            <SummaryRow label="Moat" value={data.moatRating} note={data.moatRating === "Wide" ? "Strong" : data.moatRating === "Narrow" ? "Moderate" : "Weak"} />
            <SummaryRow label="Analyst PT Median" value={formatCurrency(data.analystPT.median)} note={`${ptUpside >= 0 ? "+" : ""}${formatNumber(ptUpside, 1)}% upside`} />
            <SummaryRow label="WACC (CAPM)" value={formatPercentNoSign(conservativeDCF.wacc)} note={`Re=${formatPercentNoSign(conservativeDCF.costOfEquity)}, β=${formatNumber(data.beta5Y, 2)}`} />
            <tr className="bg-primary/5">
              <td className="py-2 px-2 font-semibold">Conservative DCF (FCFF)</td>
              <td className="py-2 px-2 text-right font-mono tabular-nums font-bold">{formatCurrency(conservativeDCF.perShare)}</td>
              <td className={`py-2 px-2 font-mono tabular-nums font-medium ${conservativeUpside >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {conservativeUpside >= 0 ? '+' : ''}{formatNumber(conservativeUpside, 1)}% Upside
              </td>
            </tr>
            <tr className="bg-emerald-500/5">
              <td className="py-2 px-2 font-semibold">Optimistic DCF (FCFF)</td>
              <td className="py-2 px-2 text-right font-mono tabular-nums font-bold">{formatCurrency(optimisticDCF.perShare)}</td>
              <td className={`py-2 px-2 font-mono tabular-nums font-medium ${optimisticUpside >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {optimisticUpside >= 0 ? '+' : ''}{formatNumber(optimisticUpside, 1)}% Upside
              </td>
            </tr>
            <tr className="bg-red-500/5">
              <td className="py-2 px-2 font-semibold">Macro-Stress DCF (FCFF)</td>
              <td className="py-2 px-2 text-right font-mono tabular-nums font-bold">{formatCurrency(stressDCF.perShare)}</td>
              <td className={`py-2 px-2 font-mono tabular-nums font-medium ${stressDownside >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {stressDownside >= 0 ? '+' : ''}{formatNumber(stressDownside, 1)}% Downside
              </td>
            </tr>
            <SummaryRow label="Safety Margin DCF (30%)" value={formatCurrency(conservativeDCF.perShare * 0.7)} />
            <SummaryRow label="Worst Case" value={formatCurrency(worstCase)} note="min(M1, M2, M3)" />
            <tr className={crvConservative >= 2.5 ? "bg-emerald-500/5" : crvConservative >= 2.0 ? "bg-amber-500/5" : "bg-red-500/5"}>
              <td className="py-2 px-2 font-semibold">CRV (Conservative)</td>
              <td className={`py-2 px-2 text-right font-mono tabular-nums font-bold ${getCRVColor(crvConservative)}`}>{formatRatio(crvConservative)}</td>
              <td className="py-2 px-2 text-muted-foreground">{crvConservative >= 2.5 ? "Attractive" : crvConservative >= 2.0 ? "Acceptable" : "Unfavorable"}</td>
            </tr>
            <tr className={crvOptimistic >= 2.5 ? "bg-emerald-500/5" : crvOptimistic >= 2.0 ? "bg-amber-500/5" : "bg-red-500/5"}>
              <td className="py-2 px-2 font-semibold">CRV (Optimistisch)</td>
              <td className={`py-2 px-2 text-right font-mono tabular-nums font-bold ${getCRVColor(crvOptimistic)}`}>{formatRatio(crvOptimistic)}</td>
              <td className="py-2 px-2 text-muted-foreground">{crvOptimistic >= 2.5 ? "Attractive" : crvOptimistic >= 2.0 ? "Acceptable" : "Unfavorable"}</td>
            </tr>
            <tr className={data.currentPrice <= dcfBeiCRV3 ? "bg-emerald-500/5" : "bg-red-500/5"}>
              <td className="py-2 px-2 font-semibold">DCF bei CRV 3:1</td>
              <td className="py-2 px-2 text-right font-mono tabular-nums font-bold">{formatCurrency(dcfBeiCRV3)}</td>
              <td className={`py-2 px-2 font-medium ${data.currentPrice <= dcfBeiCRV3 ? 'text-emerald-500' : 'text-red-500'}`}>
                {data.currentPrice <= dcfBeiCRV3 ? 'Kurs UNTER Max-Entry' : 'Kurs ÜBER Max-Entry'}
              </td>
            </tr>
            <SummaryRow label="RSL (Momentum)" value={formatNumber(rsl, 1)} note={rsl > 110 ? "Strong" : rsl > 105 ? "Neutral" : `Weak → growth adj. ${rslGrowthAdj}`} />
            <SummaryRow label="Reverse DCF g*" value={formatPercentNoSign(reverseDCF.impliedGrowth)} note={reverseDCF.rating} />
            <tr className={mcResult.downsideProb > 0.5 ? "bg-red-500/5" : ""}>
              <td className="py-2 px-2 font-semibold">Downside-Wahrscheinlichkeit</td>
              <td className={`py-2 px-2 text-right font-mono tabular-nums font-bold ${mcResult.downsideProb > 0.5 ? 'text-red-500' : mcResult.downsideProb > 0.35 ? 'text-amber-500' : 'text-emerald-500'}`}>
                {formatPercentNoSign(mcResult.downsideProb * 100, 1)}
              </td>
              <td className="py-2 px-2 text-muted-foreground">
                MC GBM 1Y ({formatPercentNoSign(mcResult.downsideProb10 * 100, 0)} bei ≥10%)
              </td>
            </tr>
            <SummaryRow label="Max Drawdown Ref." value={data.maxDrawdownHistory} note={data.maxDrawdownYear} />
          </tbody>
        </table>
      </div>

      {/* Catalyst Summary */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Catalyst Summary (Sector-Specific)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Catalyst</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">GB (Weighted)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {catalysts.map((c, i) => (
                <tr key={i}>
                  <td className="py-1.5 px-2">{c.name}</td>
                  <td className={`py-1.5 px-2 text-right font-mono tabular-nums ${c.gb >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {c.gb >= 0 ? '+' : ''}{formatNumber(c.gb, 2)}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-2 px-2">Total Catalyst Upside</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-emerald-500">+{formatNumber(totalUpside, 2)}%</td>
              </tr>
              {(() => {
                const catVsKurs = ((adjustedTarget / data.currentPrice - 1) * 100);
                const isBelowKurs = adjustedTarget < data.currentPrice;
                return (
                  <tr className={isBelowKurs ? 'bg-red-500/5 font-semibold' : 'bg-primary/5 font-semibold'}>
                    <td className="py-2 px-2">
                      Catalyst-Adj. Target
                      {catalystBaseFallback && (
                        <span className="text-[9px] text-amber-500 font-normal ml-1">(Basis: Analyst PT)</span>
                      )}
                      <span className={`text-[9px] font-normal ml-2 ${isBelowKurs ? 'text-red-500' : 'text-emerald-500'}`}>
                        vs. Kurs: {catVsKurs >= 0 ? '+' : ''}{formatNumber(catVsKurs, 1)}%
                      </span>
                    </td>
                    <td className={`py-2 px-2 text-right font-mono tabular-nums ${isBelowKurs ? 'text-red-500' : 'text-primary'}`}>
                      {formatCurrency(adjustedTarget)}
                    </td>
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </div>
      </div>

      {/* Control Calculation */}
      <div className="bg-muted/30 rounded-md p-3 border border-border/50 text-xs space-y-1">
        <div className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Control Calculation (FCFF-Based)</div>
        <div className="font-mono tabular-nums">
          WACC = E/V × Re + D/V × Rd × (1-t) = {formatPercentNoSign(conservativeDCF.wacc)}
        </div>
        <div className="font-mono tabular-nums">
          Kat.-adj. Zielwert = {catalystBaseFallback ? 'Analyst PT' : 'Kons. DCF'} × (1 + Σ GB / 100)
        </div>
        <div className="font-mono tabular-nums">
          = {formatCurrency(catalystDCFBase)} × (1 + {formatNumber(totalUpside, 2)}%) = {formatCurrency(adjustedTarget)}
        </div>
        {catalystBaseFallback && (
          <div className="text-amber-500 text-[10px]">
            ⚠ DCF-Basis zu niedrig ({formatCurrency(conservativeDCF.perShare)}), verwende Analyst PT Median als Basis
          </div>
        )}
        <div className="font-mono tabular-nums">
          CRV = (Fair Value - Worst Case) / (Kurs - Worst Case) = ({formatCurrency(conservativeDCF.perShare)} - {formatCurrency(worstCase)}) / ({formatCurrency(data.currentPrice)} - {formatCurrency(worstCase)}) = {formatNumber(crvConservative, 2)}:1
        </div>
        <div className="font-mono tabular-nums">
          DCF bei CRV 3:1 = (Kons. DCF + 3 × WC) / 4 = ({formatCurrency(conservativeDCF.perShare)} + 3 × {formatCurrency(worstCase)}) / 4 = {formatCurrency(dcfBeiCRV3)}
        </div>
      </div>

      {/* === FAZIT (Big Picture — all 13 sections integrated) === */}
      {(() => {
        // === Gather data from ALL sections ===
        const techStatus = data.technicalIndicators?.currentStatus;
        const risks = data.risks;
        const totalExpDmg = risks.reduce((s, r) => s + r.expectedDamage, 0);
        const riskDiscountFactor = 1 - totalExpDmg / 100;
        const raCrvCons = calculateCRV(conservativeDCF.perShare * riskDiscountFactor, worstCase, data.currentPrice);
        const pestel = data.pestelAnalysis;
        const moatAssess = data.moatAssessment;
        const macroCorr = data.macroCorrelations;

        // === Build signal lists from all 13 sections ===
        const positive: string[] = [];
        const negative: string[] = [];
        const neutral: string[] = [];

        // S1: Datenaktualität — P/E, EV/EBITDA vs sector
        if (data.peRatio > 0 && data.sectorAvgPE > 0) {
          const pePrem = ((data.peRatio / data.sectorAvgPE) - 1) * 100;
          if (pePrem < -20) positive.push(`P/E ${formatNumber(data.peRatio, 1)} vs. Sektor ${formatNumber(data.sectorAvgPE, 1)} \u2014 ${formatNumber(Math.abs(pePrem), 0)}% Discount`);
          else if (pePrem > 30) negative.push(`P/E ${formatNumber(data.peRatio, 1)} vs. Sektor ${formatNumber(data.sectorAvgPE, 1)} \u2014 ${formatNumber(pePrem, 0)}% Premium`);
        }

        // S2: Investmentthese — catalysts total upside
        if (totalUpside > 10) positive.push(`Katalysatoren-Upside +${formatNumber(totalUpside, 1)}% (${catalysts.length} Treiber)`);
        else if (totalUpside < 3) neutral.push(`Begrenzte Katalysatoren (+${formatNumber(totalUpside, 1)}%)`);

        // S3: Zyklusanalyse
        if (data.cycleClassification) {
          neutral.push(`Zyklusklassifikation: ${data.cycleClassification}, Politischer Zyklus: ${data.politicalCycle}`);
        }

        // S4: Bewertung — PEG
        if (data.pegRatio > 0 && data.pegRatio < 1) positive.push(`PEG ${formatNumber(data.pegRatio, 2)} < 1 \u2014 unterbewertet relativ zum Wachstum`);
        else if (data.pegRatio > 2) negative.push(`PEG ${formatNumber(data.pegRatio, 2)} > 2 \u2014 hohes Bewertungsniveau`);

        // S5: DCF-Modell
        if (conservativeUpside > 30) positive.push(`Kons. DCF deutet auf ${formatNumber(conservativeUpside, 0)}% Upside`);
        else if (conservativeUpside > 10) positive.push(`Kons. DCF mit ${formatNumber(conservativeUpside, 0)}% moderatem Upside`);
        else if (conservativeUpside < -10) negative.push(`Kons. DCF zeigt ${formatNumber(conservativeUpside, 0)}% Downside \u2014 \u00dcberbewertung`);
        else neutral.push(`DCF nahe am Kurs (${formatNumber(conservativeUpside, 0)}%)`);

        // S6: CRV (Base + Risk-Adjusted)
        if (crvConservative >= 2.5) positive.push(`CRV Base ${formatNumber(crvConservative, 1)}:1 \u2014 attraktiv`);
        else if (crvConservative >= 2.0) neutral.push(`CRV Base ${formatNumber(crvConservative, 1)}:1 \u2014 akzeptabel`);
        else negative.push(`CRV Base nur ${formatNumber(crvConservative, 1)}:1 \u2014 unzureichend`);

        // CRV Risk-Adjusted
        if (raCrvCons < 1.5) negative.push(`CRV Risikoadj. nur ${formatNumber(raCrvCons, 1)}:1 \u2014 Risiken nicht eingepreist`);
        else if (raCrvCons >= 2.5) positive.push(`CRV Risikoadj. ${formatNumber(raCrvCons, 1)}:1 \u2014 auch nach Risikoabschlag attraktiv`);

        // Entry Price
        if (data.currentPrice <= dcfBeiCRV3) positive.push(`Kurs UNTER Max-Entry (${formatCurrency(dcfBeiCRV3)})`);
        else negative.push(`Kurs (${formatCurrency(data.currentPrice)}) \u00dcBER Max-Entry (${formatCurrency(dcfBeiCRV3)}) bei CRV 3:1`);

        // S7: Relative Bewertung — already covered in P/E

        // S8: Risikoinversion
        if (totalExpDmg > 15) negative.push(`Expected Damage ${formatNumber(totalExpDmg, 1)}% \u2014 erhebliche Risiko-Exposition`);
        else if (totalExpDmg < 8) positive.push(`Expected Damage nur ${formatNumber(totalExpDmg, 1)}% \u2014 moderates Risikoprofil`);

        // S9: RSL-Momentum
        if (rsl > 110) positive.push(`RSL ${formatNumber(rsl, 0)} \u2014 starkes Momentum`);
        else if (rsl > 105) neutral.push(`RSL ${formatNumber(rsl, 0)} \u2014 neutrales Momentum`);
        else negative.push(`RSL ${formatNumber(rsl, 0)} \u2014 schwaches Momentum, Growth-Adj. -5% bis -10%`);

        // S10: Technische Analyse (MA200, MA50, MACD, Buy-Signal)
        if (techStatus) {
          const techBull: string[] = [];
          const techBear: string[] = [];
          if (techStatus.priceAboveMA200) techBull.push('Kurs > MA200');
          else techBear.push('Kurs < MA200');
          if (techStatus.ma50AboveMA200) techBull.push('MA50 > MA200 (Golden Cross)');
          else techBear.push('MA50 < MA200 (Death Cross)');
          if (techStatus.macdAboveZero && techStatus.macdRising) techBull.push('MACD > 0 & steigend');
          else if (!techStatus.macdAboveZero) techBear.push('MACD < 0');

          if (techStatus.buySignal) {
            positive.push(`Technisch: BUY-Signal (${techBull.join(', ')})`);
          } else if (techBear.length >= 2) {
            negative.push(`Technisch: KEIN Buy-Signal (${techBear.join(', ')})`);
          } else {
            neutral.push(`Technisch gemischt: ${[...techBull, ...techBear].join(', ')}`);
          }
        }

        // S11: Moat / Porter
        if (moatAssess) {
          if (moatAssess.overallRating === 'Wide') positive.push(`Breiter Moat \u2014 nachhaltiger Wettbewerbsvorteil`);
          else if (moatAssess.overallRating === 'None') negative.push(`Kein erkennbarer Moat \u2014 Wettbewerbsdruck`);
          else neutral.push(`Schmaler Moat \u2014 ${moatAssess.moatSources.slice(0, 2).join(', ')}`);
        }

        // S12: Monte Carlo
        if (mcResult.downsideProb > 0.55) negative.push(`MC-Simulation: ${formatNumber(mcResult.downsideProb * 100, 0)}% Verlustwahrscheinlichkeit (1Y)`);
        else if (mcResult.downsideProb < 0.35) positive.push(`MC-Simulation: nur ${formatNumber(mcResult.downsideProb * 100, 0)}% Verlustwahrscheinlichkeit`);

        // S13-extra: Reverse DCF
        if (reverseDCF.impliedGrowth > 8) negative.push(`Reverse-DCF impliziert ${formatNumber(reverseDCF.impliedGrowth, 1)}% Wachstum \u2014 sportlich eingepreist`);
        else if (reverseDCF.impliedGrowth < 3) positive.push(`Reverse-DCF nur ${formatNumber(reverseDCF.impliedGrowth, 1)}% impliziertes Wachstum`);

        // Beta / Risk
        if (data.beta5Y > 1.5) negative.push(`Hohe Volatilit\u00e4t (Beta ${formatNumber(data.beta5Y, 2)}) \u2014 \u00fcberdurchschnittliches Risiko`);
        else if (data.beta5Y < 0.8) positive.push(`Niedrige Volatilit\u00e4t (Beta ${formatNumber(data.beta5Y, 2)}) \u2014 defensiv`);

        // FCF Margin
        if (data.fcfMargin > 20) positive.push(`Starke FCF-Marge von ${formatNumber(data.fcfMargin, 1)}%`);
        else if (data.fcfMargin < 5) negative.push(`Schwache FCF-Marge (${formatNumber(data.fcfMargin, 1)}%)`);

        // PESTEL
        if (pestel) {
          if (pestel.overallExposure === 'Hoch') negative.push(`PESTEL: Hohe Makro-Exposition (Geopolitical Score ${pestel.geopoliticalScore}/10)`);
          else if (pestel.overallExposure === 'Niedrig') positive.push(`PESTEL: Niedrige Makro-Exposition`);
        }

        // Macro Correlations
        if (macroCorr) {
          if (macroCorr.overallMacroSensitivity === 'Hoch') negative.push(`Hohe Makro-Sensitivit\u00e4t \u2014 ${macroCorr.keyInsight.substring(0, 80)}`);
          else if (macroCorr.overallMacroSensitivity === 'Niedrig') positive.push(`Niedrige Makro-Sensitivit\u00e4t \u2014 resilient gegen\u00fcber Konjunkturschwankungen`);
        }

        // Gov Exposure
        if (data.governmentExposure > 20) negative.push(`Staatsabh\u00e4ngigkeit ${formatNumber(data.governmentExposure, 0)}% \u2014 FCF-Haircut`);

        // Macro Stress
        if (stressDownside < -30) negative.push(`Macro-Stress: ${formatNumber(stressDownside, 0)}% Downside`);

        // Analyst PT
        const ptUps = ((data.analystPT.median - data.currentPrice) / data.currentPrice) * 100;
        if (ptUps > 20) positive.push(`Analysten sehen ${formatNumber(ptUps, 0)}% Upside zum Median-Kursziel`);
        else if (ptUps > 0) neutral.push(`Analysten-Kursziel +${formatNumber(ptUps, 0)}% \u00fcber Kurs`);
        else if (ptUps < -5) negative.push(`Analysten-Kursziel ${formatNumber(ptUps, 0)}% unter Kurs`);

        // === Generate overall rating ===
        const score = positive.length - negative.length;
        let rating: string;
        let ratingColor: string;
        let ratingBg: string;
        if (score >= 4) {
          rating = "ATTRAKTIV";
          ratingColor = "text-emerald-400";
          ratingBg = "bg-emerald-500/10 border-emerald-500/30";
        } else if (score >= 2) {
          rating = "LEICHT ATTRAKTIV";
          ratingColor = "text-emerald-400";
          ratingBg = "bg-emerald-500/10 border-emerald-500/20";
        } else if (score >= -1) {
          rating = "NEUTRAL";
          ratingColor = "text-amber-400";
          ratingBg = "bg-amber-500/10 border-amber-500/20";
        } else if (score >= -3) {
          rating = "UNATTRAKTIV";
          ratingColor = "text-red-400";
          ratingBg = "bg-red-500/10 border-red-500/20";
        } else {
          rating = "STARK UNATTRAKTIV";
          ratingColor = "text-red-500";
          ratingBg = "bg-red-500/10 border-red-500/30";
        }

        // === Concluding Fazit sentence (dynamic, generic for any stock) ===
        const isBuy = score >= 2 && techStatus?.buySignal && data.currentPrice <= dcfBeiCRV3;
        const isOvervalued = conservativeUpside < -5 || (raCrvCons < 1.5 && rsl < 100);
        const isTechWeak = !techStatus?.priceAboveMA200 || !techStatus?.ma50AboveMA200;
        const isHighRisk = totalExpDmg > 15 || data.beta5Y > 1.5;
        const topRisks = [...risks].sort((a, b) => b.expectedDamage - a.expectedDamage).slice(0, 2).map(r => r.name).join(' und ');

        let fazitSatz = '';
        if (isBuy) {
          fazitSatz = `${data.companyName} (${data.ticker}) erscheint auf Basis der Gesamtanalyse attraktiv bewertet. Fundamental unterst\u00fctzt durch ${data.moatRating}-Moat, ein CRV von ${formatNumber(crvConservative, 1)}:1 und technisches Buy-Signal (Kurs > MA200, MA50 > MA200, MACD > 0). Der Einstieg ist bei aktuellem Kurs vertretbar.`;
        } else if (isOvervalued) {
          fazitSatz = `${data.companyName} (${data.ticker}) ist auf aktuellem Kursniveau ${rating === 'STARK UNATTRAKTIV' ? 'deutlich ' : ''}\u00fcberbewertet. Das risikoadjustierte CRV von nur ${formatNumber(raCrvCons, 1)}:1 zeigt, dass die Risiken (${topRisks}) nicht ausreichend eingepreist sind.${isTechWeak ? ' Technisch liegt der Kurs unter den gleitenden Durchschnitten \u2014 kein Kaufsignal.' : ''} Abwarten bis ${formatCurrency(dcfBeiCRV3)} oder tiefer.`;
        } else if (score <= -2) {
          fazitSatz = `${data.companyName} (${data.ticker}) bietet aktuell ein ung\u00fcnstiges Chance-Risiko-Verh\u00e4ltnis. Die Hauptrisiken (${topRisks}) dr\u00fccken den risikoadjustierten Fair Value auf ${formatCurrency(conservativeDCF.perShare * riskDiscountFactor)}. ${isTechWeak ? 'Technisch fehlt ein Buy-Signal.' : ''} Kurs liegt ${formatNumber(Math.abs(((data.currentPrice / dcfBeiCRV3) - 1) * 100), 0)}% \u00fcber dem Max-Einstiegskurs.`;
        } else if (score >= 2) {
          fazitSatz = `${data.companyName} (${data.ticker}) zeigt fundamental solide Kennzahlen mit ${formatNumber(conservativeUpside, 0)}% DCF-Upside und CRV ${formatNumber(crvConservative, 1)}:1. ${!techStatus?.buySignal ? 'Allerdings fehlt ein technisches Buy-Signal \u2014 Timing abwarten.' : 'Technisch ebenfalls positiv.'} ${isHighRisk ? `Erh\u00f6hte Risiken (${topRisks}) beachten.` : ''}`;
        } else {
          fazitSatz = `${data.companyName} (${data.ticker}) befindet sich in einer neutralen Zone. Das Base-CRV von ${formatNumber(crvConservative, 1)}:1 wirkt zwar ${crvConservative >= 2.0 ? 'akzeptabel' : 'schwach'}, wird aber durch ${formatNumber(totalExpDmg, 1)}% Expected Damage auf risikoadjustiert ${formatNumber(raCrvCons, 1)}:1 reduziert. ${isTechWeak ? 'Technisch kein Kaufsignal.' : 'Technisch gemischte Signale.'} ${topRisks ? `Hauptrisiken: ${topRisks}.` : ''} Empfehlung: Abwarten.`;
        }

        return (
          <div className={`rounded-lg border-2 p-4 ${ratingBg}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fazit</h3>
              <span className={`text-sm font-bold ${ratingColor}`}>{rating}</span>
            </div>

            {/* Concluding sentence */}
            <div className="mb-3 text-xs text-foreground/90 leading-relaxed bg-background/30 rounded-md p-2.5 border border-border/30">
              {fazitSatz}
            </div>

            {/* Positive signals */}
            {positive.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wider mb-1">Positive Faktoren ({positive.length})</div>
                <ul className="space-y-0.5">
                  {positive.map((p, i) => (
                    <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                      <span className="text-emerald-500 flex-shrink-0 mt-0.5">+</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Negative signals */}
            {negative.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-1">Negative Faktoren ({negative.length})</div>
                <ul className="space-y-0.5">
                  {negative.map((n, i) => (
                    <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                      <span className="text-red-500 flex-shrink-0 mt-0.5">{"\u2212"}</span>
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Neutral */}
            {neutral.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Neutral ({neutral.length})</div>
                <ul className="space-y-0.5">
                  {neutral.map((n, i) => (
                    <li key={i} className="text-xs text-foreground/60 flex items-start gap-1.5">
                      <span className="text-muted-foreground flex-shrink-0 mt-0.5">{"\u25cf"}</span>
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Score summary */}
            <div className="border-t border-border/30 pt-2 mt-2">
              <div className="text-[10px] text-muted-foreground">
                Signal-Score: {positive.length} positiv / {negative.length} negativ / {neutral.length} neutral = <span className={`font-semibold ${ratingColor}`}>{rating}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Sources */}
      <div className="text-[10px] text-muted-foreground space-y-0.5">
        <div className="font-semibold uppercase tracking-wider mb-1">Sources</div>
        <div>Real-time data from Yahoo Finance, Polygon API, analyst consensus</div>
        <div>WACC methodology: Damodaran (NYU Stern) — sector: {data.sector}</div>
        <div>DCF model: FCFF-based with WACC/CAPM, Gordon Growth terminal value, equity bridge</div>
        <div>Monte Carlo: GBM (Geometrische Brownsche Bewegung), {data.historicalPrices.length} historical data points</div>
      </div>
    </SectionCard>
  );
}

// === Sub-components ===

function SummaryRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <tr>
      <td className="py-1.5 px-2 text-muted-foreground">{label}</td>
      <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium">{value}</td>
      <td className="py-1.5 px-2 text-muted-foreground">{note || ""}</td>
    </tr>
  );
}

function ScenarioCard({ label, value, currentPrice, pct, wacc, isStress }: {
  label: string; value: number; currentPrice: number; pct: number; wacc: number; isStress?: boolean;
}) {
  const isUp = pct >= 0;
  return (
    <div className={`rounded-lg p-3 border ${
      isStress ? 'bg-red-500/5 border-red-500/20' :
      isUp ? 'bg-emerald-500/5 border-emerald-500/20' :
      'bg-red-500/5 border-red-500/20'
    }`}>
      <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</div>
      <div className="text-base font-bold font-mono tabular-nums mt-1">{formatCurrency(value)}</div>
      <div className={`text-sm font-bold font-mono tabular-nums ${isUp && !isStress ? 'text-emerald-500' : 'text-red-500'}`}>
        {isUp ? '+' : ''}{formatNumber(pct, 1)}%
        <span className="text-[10px] font-normal text-muted-foreground ml-1">{isUp && !isStress ? 'Upside' : 'Downside'}</span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">WACC: {formatPercentNoSign(wacc)}</div>
    </div>
  );
}

function ProbCard({ label, value, threshold, inverted }: {
  label: string; value: number; threshold: number; inverted?: boolean;
}) {
  const isAlert = inverted ? value < threshold : value > threshold;
  const color = inverted
    ? (value > 0.5 ? 'text-emerald-500' : value > 0.3 ? 'text-amber-500' : 'text-red-500')
    : (value > threshold ? 'text-red-500' : value > threshold * 0.6 ? 'text-amber-500' : 'text-emerald-500');

  return (
    <div className={`rounded-md p-2 border ${isAlert ? 'bg-red-500/5 border-red-500/20' : 'bg-muted/30 border-border/50'}`}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${color}`}>
        {formatPercentNoSign(value * 100, 1)}
      </div>
    </div>
  );
}
