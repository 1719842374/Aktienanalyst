import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import {
  calculateFCFFDCF, buildDefaultDCFParams, type FCFFDCFParams,
  calculateCRV, calculateRiskAdjustedCRV, calculateRSL, calculateReverseDCF,
  worstCaseM1, worstCaseM2, worstCaseM3, calculateCatalystUpside, selectCatalystBase,
  gbmMonteCarlo, calculateGBMParams, type GBMMonteCarloResult,
} from "../../lib/calculations";
import { formatCurrency, formatNumber, formatPercentNoSign, formatLargeNumber, formatRatio, getCRVColor } from "../../lib/formatters";
import { buildFazitSignal } from "../../lib/fazit-signal";
import { useMemo } from "react";

interface Props { data: StockAnalysis; sharedMonteCarlo?: GBMMonteCarloResult | null }

export function SummarySection({ data, sharedMonteCarlo }: Props) {
  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;
  const haircut = data.fcfHaircut;

  // === SINGLE SOURCE OF TRUTH: identical defaults as Section5 / Section6 ===
  // DCF-Parameter: via buildDefaultDCFParams — einheitliche Basis mit Section5 + Section6
  // inline (third DCF path), which diverged from Section5/Section6. Now all
  // consumers share buildDefaultDCFParams().
  const baseParams: FCFFDCFParams = useMemo(() => buildDefaultDCFParams(data), [data.ticker]);

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
  const rawTotalUpside = catalysts.reduce((sum, c) => sum + c.gb, 0);
  const catalystBaseInfo = selectCatalystBase(
    conservativeDCF.perShare,
    rawTotalUpside,
    data.currentPrice,
    data.analystPT.median
  );
  const catalystDCFBase = catalystBaseInfo.base;
  const catalystBaseFallback = catalystBaseInfo.source !== "dcf";
  const { totalUpside, adjustedTarget } = calculateCatalystUpside(catalysts, catalystDCFBase);

  const m1 = worstCaseM1(data.currentPrice, data.beta5Y, data.sectorMaxDrawdown || 35);
  // M2: größter Einzelrisiko-Impact (brutto) aus der Risikoinversion, Fallback 35% — identisch mit Section6
  const m2Impact = data.risks?.length ? Math.max(...data.risks.map(r => Math.abs(r.impact))) : 35;
  const m2 = worstCaseM2(data.currentPrice, m2Impact);
  const m3 = worstCaseM3(data.currentPrice, data.sectorMaxDrawdown || 35, data.lynchClass);
  const worstCase = Math.min(m1, m2, m3);

  const prices26w = useMemo(() => {
    const sorted = [...data.historicalPrices].sort((a, b) => b.date.localeCompare(a.date));
    return sorted.slice(0, 130).map((p) => p.close);
  }, [data.historicalPrices]);
  const rsl = calculateRSL(data.currentPrice, prices26w);

  // === Reverse DCF — identisch mit Section10 (relative Schwellen) ===
  const reverseDCF = calculateReverseDCF({
    currentPrice: data.currentPrice,
    fcfBase: data.fcfTTM,
    wacc: conservativeDCF.wacc,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
    fcfHaircut: data.fcfHaircut ?? 0,
    sectorG1: sp.growthAssumptions?.g1 ?? 0,
    epsGrowthNext5Y: data.epsGrowth5Y ?? 0,
  });

  // CRVs
  const crvConservative = calculateCRV(conservativeDCF.perShare, worstCase, data.currentPrice);
  const crvOptimistic = calculateCRV(optimisticDCF.perShare, worstCase, data.currentPrice);

  // DCF bei CRV 3:1 = max acceptable entry price for exactly 3:1 reward/risk
  // CRV = (FV - WC) / (P - WC) = 3 aufgelöst nach P: P = (FV + 2·WC) / 3
  const dcfBeiCRV3 = (conservativeDCF.perShare + 2 * worstCase) / 3;

  // Upside/Downside % for DCF scenarios
  const conservativeUpside = ((conservativeDCF.perShare / data.currentPrice - 1) * 100);
  const optimisticUpside = ((optimisticDCF.perShare / data.currentPrice - 1) * 100);
  const stressDownside = ((stressDCF.perShare / data.currentPrice - 1) * 100);

  const ptUpside = ((data.analystPT.median - data.currentPrice) / data.currentPrice) * 100;

  // RSL growth adjustment flag (rsl = null → keine ausreichende Kurshistorie, kein Malus)
  const rslGrowthAdj = rsl != null && rsl < 105 ? "-5% to -10%" : "none";

  const localMC = useMemo(() => {
    // Lazy: nur rechnen, wenn kein geteiltes Ergebnis (Section16) vorliegt — spart 10.000 Pfade
    if (sharedMonteCarlo) return null;
    const prices = data.historicalPrices.map(p => p.close);
    const params = calculateGBMParams(prices);
    return gbmMonteCarlo({
      currentPrice: data.currentPrice,
      mu: params.mu,
      sigma: params.sigma,
      iterations: 10000,
      tradingDays: 252,
    }, data.analystPT.median);
  }, [data, sharedMonteCarlo]);
  // Genau eines von beiden ist immer gesetzt (localMC wird nur bei fehlendem sharedMonteCarlo berechnet)
  const mcResult = (sharedMonteCarlo ?? localMC)!;

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
          <ProbCard label="P(Verlust)" value={mcResult.downsideProb} threshold={0.5} />
          <ProbCard label="P(≥10% Loss)" value={mcResult.downsideProb10} threshold={0.3} />
          <ProbCard label="P(≥20% Loss)" value={mcResult.downsideProb20} threshold={0.2} />
          <ProbCard label="P(Analyst PT)" value={mcResult.analystPTProb} threshold={-1} inverted />
        </div>
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

      {/* Methodischer Hinweis: Monte Carlo (historisch) vs. DCF (fundamental) */}
      {mcResult && (() => {
        const mcExpectedReturn = (mcResult.expectedReturn ?? 0) * 100;
        const dcfUpside = conservativeDCF.perShare > 0
          ? ((conservativeDCF.perShare / data.currentPrice) - 1) * 100
          : null;
        const divergence = dcfUpside !== null ? mcExpectedReturn - dcfUpside : null;
        if (divergence === null || Math.abs(divergence) < 20) return null;
        return (
          <div className="text-[10px] text-muted-foreground bg-muted/20 border border-border/50 rounded px-2 py-1.5">
            <span className="font-semibold text-foreground/70">⚠ Monte Carlo vs. DCF:</span>{' '}
            Monte Carlo (historisch-empirisch, μ aus Kursrenditen) impliziert{' '}
            <span className={mcExpectedReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}>{mcExpectedReturn >= 0 ? '+' : ''}{mcExpectedReturn.toFixed(1)}%</span>,
            {' '}DCF (fundamental) impliziert{' '}
            <span className={dcfUpside >= 0 ? 'text-emerald-400' : 'text-red-400'}>{dcfUpside >= 0 ? '+' : ''}{dcfUpside.toFixed(1)}%</span>
            {' '}— Differenz {Math.abs(divergence).toFixed(0)} Pp.
            Beide Methoden messen unterschiedliche Dinge: Monte Carlo extrapoliert historischen Kursimpuls,
            DCF bewertet fundamentale Ertragskraft. Große Divergenz signalisiert: entweder Momentum-überschuss oder DCF-Annahmen zu konservativ.
          </div>
        );
      })()}

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
            <SummaryRow label="Forward P/E" value={formatNumber(data.forwardPE, 1)} note={`Sector: ${formatNumber(data.sectorAvgForwardPE > 0 ? data.sectorAvgForwardPE : data.sectorAvgPE, 1)}`} />
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
                {conservativeUpside >= 0 ? '+' : ''}{formatNumber(conservativeUpside, 1)}% {conservativeUpside >= 0 ? 'Upside' : 'Downside'}
              </td>
            </tr>
            <tr className="bg-emerald-500/5">
              <td className="py-2 px-2 font-semibold">Optimistic DCF (FCFF)</td>
              <td className="py-2 px-2 text-right font-mono tabular-nums font-bold">{formatCurrency(optimisticDCF.perShare)}</td>
              <td className={`py-2 px-2 font-mono tabular-nums font-medium ${optimisticUpside >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {optimisticUpside >= 0 ? '+' : ''}{formatNumber(optimisticUpside, 1)}% {optimisticUpside >= 0 ? 'Upside' : 'Downside'}
              </td>
            </tr>
            <tr className="bg-red-500/5">
              <td className="py-2 px-2 font-semibold">Macro-Stress DCF (FCFF)</td>
              <td className="py-2 px-2 text-right font-mono tabular-nums font-bold">{formatCurrency(stressDCF.perShare)}</td>
              <td className={`py-2 px-2 font-mono tabular-nums font-medium ${stressDownside >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                {stressDownside >= 0 ? '+' : ''}{formatNumber(stressDownside, 1)}% {stressDownside >= 0 ? 'Upside' : 'Downside'}
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
            <SummaryRow
              label="RSL (Momentum)"
              value={rsl != null ? formatNumber(rsl, 1) : "n/a"}
              note={rsl == null ? "n/a — keine ausreichende Kurshistorie" : rsl > 110 ? "Strong" : rsl >= 105 ? "Neutral" : `Weak → growth adj. ${rslGrowthAdj}`}
            />
            <SummaryRow
              label="Reverse DCF g*"
              value={formatPercentNoSign(reverseDCF.impliedGrowth)}
              note={`${reverseDCF.rating} (Ref: ${formatPercentNoSign(reverseDCF.referenceGrowth)})`}
            />
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
          DCF bei CRV 3:1 = (Kons. DCF + 2 × WC) / 3 = ({formatCurrency(conservativeDCF.perShare)} + 2 × {formatCurrency(worstCase)}) / 3 = {formatCurrency(dcfBeiCRV3)}
        </div>
      </div>

      {/* === FAZIT (Big Picture — all 13 sections integrated) === */}
      {(() => {
        const risks = data.risks;
        const totalExpDmg = risks.reduce((s, r) => s + r.expectedDamage, 0);
        const raCrvCons = calculateRiskAdjustedCRV(conservativeDCF.perShare, worstCase, data.currentPrice, totalExpDmg);
        const {
          positive, negative, neutral, rating, ratingColor, ratingBg, fazitSatz,
        } = buildFazitSignal({
          data,
          conservativeDCF,
          totalUpside,
          crvConservative,
          dcfBeiCRV3,
          raCrvCons,
          rsl,
          reverseDCF,
          stressDownside,
          conservativeUpside,
          mcResult,
          totalExpDmg,
          worstCase,
        });

        return (
          <div className={`rounded-lg border-2 p-4 ${ratingBg}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fazit</h3>
              <span className={`text-sm font-bold ${ratingColor}`}>{rating}</span>
            </div>

            <div className="mb-3 text-xs text-foreground/90 leading-relaxed bg-background/30 rounded-md p-2.5 border border-border/30">
              {fazitSatz}
            </div>

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

            <div className="border-t border-border/30 pt-2 mt-2">
              <div className="text-[10px] text-muted-foreground">
                Signal-Score: {positive.length} positiv / {negative.length} negativ / {neutral.length} neutral = <span className={`font-semibold ${ratingColor}`}>{rating}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Scoring-Pipeline (WORK_SCORING_VORLAGE.md §0 + §17) — serverseitig aus
          echten Analyse-Daten berechnet. Optional: fehlt bei alten Cache-
          Eintraegen (vor der Verdrahtung) — dann wird der Block nicht gerendert. */}
      {data.scoring && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Scoring-Pipeline — Gates & Anti-Bias
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-lg font-bold font-mono tabular-nums ${
                data.scoring.finalScore >= 65 ? "text-emerald-400" :
                data.scoring.finalScore >= 50 ? "text-amber-400" : "text-red-400"
              }`}>
                {data.scoring.finalScore}
              </span>
              <span className="text-[10px] text-muted-foreground">
                / 100 {data.scoring.cappedBy
                  ? `(roh ${data.scoring.rawScore} — gedeckelt durch ${data.scoring.cappedBy})`
                  : `(roh ${data.scoring.rawScore}, kein Gate greift)`}
              </span>
            </div>
          </div>

          <div className="text-[10px] text-muted-foreground">
            Quality {data.scoring.qualityScore} × Trend {data.scoring.trendMultiplier} = {data.scoring.rawScore} —
            {" "}min(rohScore, strengster aktiver Gate-Cap) = {data.scoring.finalScore}
          </div>

          {/* Gates */}
          <div className="space-y-1">
            {data.scoring.gates.map(g => (
              <div key={g.id} className={`flex items-start gap-2 text-[11px] rounded px-2 py-1 ${
                g.active ? "bg-red-500/10 border border-red-500/20" : "bg-muted/30"
              }`}>
                <span className={`font-mono font-semibold shrink-0 ${g.active ? "text-red-400" : "text-muted-foreground/60"}`}>
                  {g.active ? "\u26a0" : "\u2713"} {g.id}
                </span>
                <span className={`font-mono shrink-0 ${g.active ? "text-red-400" : "text-muted-foreground/50"}`}>
                  Cap {g.cap}
                </span>
                <span className={g.active ? "text-foreground/80" : "text-muted-foreground/50"}>
                  {g.rationale}
                </span>
              </div>
            ))}
          </div>

          {/* Gate-Inputs (Transparenz: welche echten Zahlen die Gates gesteuert haben) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[10px] text-muted-foreground border-t border-border/30 pt-2">
            <div>g* (Reverse-DCF): <span className="font-mono text-foreground/70">{data.scoring.gateInputs.impliedGrowthPercent != null ? `${data.scoring.gateInputs.impliedGrowthPercent.toFixed(1)}%` : "n/a"}</span></div>
            <div>Realized 8Q: <span className="font-mono text-foreground/70">{data.scoring.gateInputs.realizedGrowth8QPercent != null ? `${data.scoring.gateInputs.realizedGrowth8QPercent.toFixed(1)}%` : "n/a"}</span>{data.scoring.gateInputs.realizedGrowth8QPercent != null && <span className="text-muted-foreground/50"> ({data.scoring.gateInputs.realizedGrowthQuartersUsed}Q)</span>}</div>
            <div>Margen-Δ YoY: <span className="font-mono text-foreground/70">{data.scoring.gateInputs.marginDeltaYoYPp != null ? `${data.scoring.gateInputs.marginDeltaYoYPp > 0 ? "+" : ""}${data.scoring.gateInputs.marginDeltaYoYPp.toFixed(1)}pp` : "n/a"}</span></div>
            <div>Rel. Wachstum vs. Peers: <span className="font-mono text-foreground/70">{data.scoring.gateInputs.relativeGrowthDeltaYoYPp != null ? `${data.scoring.gateInputs.relativeGrowthDeltaYoYPp > 0 ? "+" : ""}${data.scoring.gateInputs.relativeGrowthDeltaYoYPp.toFixed(1)}pp` : "n/a"}</span></div>
            <div>Inventory Δ YoY: <span className="font-mono text-foreground/70">{data.scoring.gateInputs.inventoryDaysDeltaYoYPct != null ? `${data.scoring.gateInputs.inventoryDaysDeltaYoYPct > 0 ? "+" : ""}${data.scoring.gateInputs.inventoryDaysDeltaYoYPct.toFixed(1)}%` : "n/a"}</span></div>
            <div>Fiscal-Ausnahme: <span className={`font-mono ${data.scoring.fiscal.qualifies ? "text-amber-400" : "text-foreground/70"}`}>{data.scoring.fiscal.qualifies ? `aktiv (EV ${data.scoring.fiscal.evPercent}%)` : "nicht aktiv"}</span></div>
          </div>

          {data.scoring.conflictTexts.length > 0 && (
            <div className="text-[10px] text-amber-400/90 border-t border-border/30 pt-2">
              {data.scoring.conflictTexts.map((t, i) => <div key={i}>{"\u26a0"} {t}</div>)}
            </div>
          )}
        </div>
      )}

      {/* Sources */}
      <div className="text-[10px] text-muted-foreground space-y-0.5">
        <div className="font-semibold uppercase tracking-wider mb-1">Sources</div>
        <div>Quellen: Perplexity Finance API / FMP, Damodaran (NYU Stern), SEC EDGAR, Google News (EN/DE)</div>
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
