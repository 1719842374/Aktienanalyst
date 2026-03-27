import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis, RevenueSegment } from "../../../../shared/schema";
import { calculateFCFFDCF, type FCFFDCFParams, calculateCatalystUpside } from "../../lib/calculations";
import { formatPercentNoSign, formatNumber, formatCurrency, formatLargeNumber } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section2({ data }: Props) {
  // Use backend catalysts directly
  const catalysts = data.catalysts;

  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;

  // Compute conservative FCFF DCF (same defaults as Section5/Section11/Section13)
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

  const baseDCF = useMemo(() => calculateFCFFDCF({
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
    fcfHaircut: data.fcfHaircut,
  }), [data, sp, netDebt]);

  // Catalyst base: use DCF perShare, but if it's unreasonably low, fall back to analyst PT median
  const catalystDCFBase = baseDCF.perShare > data.currentPrice * 0.05
    ? baseDCF.perShare
    : (data.analystPT.median > 0 ? data.analystPT.median : data.currentPrice);
  const catalystBaseFallback = catalystDCFBase !== baseDCF.perShare;

  const { totalUpside, adjustedTarget } = useMemo(
    () => calculateCatalystUpside(catalysts, catalystDCFBase),
    [catalysts, catalystDCFBase]
  );

  return (
    <SectionCard number={2} title="INVESTMENTTHESE & KATALYSATOREN">
      {/* Part A: Company thesis */}
      <div className="space-y-3">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Company Description</h3>
          <p className="text-xs text-foreground/80 leading-relaxed max-h-[200px] overflow-y-auto">{data.description}</p>
        </div>

        {/* Revenue Segments (Umsatzanteil nach Produkten/Segmenten) */}
        {data.revenueSegments && data.revenueSegments.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Umsatzanteil nach Segmenten</h3>
            <div className="space-y-1.5">
              {data.revenueSegments.map((seg, i) => (
                <div key={i} className="relative">
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="font-medium truncate mr-2">{seg.name}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {seg.growth !== undefined && seg.growth !== null && (
                        <span className={`text-[10px] font-mono tabular-nums ${seg.growth >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                          {seg.growth >= 0 ? '+' : ''}{formatNumber(seg.growth, 1)}%
                        </span>
                      )}
                      <span className="font-mono tabular-nums text-muted-foreground w-12 text-right">{formatNumber(seg.percentage, 1)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/60 transition-all duration-500"
                      style={{ width: `${Math.min(100, seg.percentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Growth Thesis & Catalyst Reasoning (expanded) */}
        <div className="bg-muted/30 rounded-md p-3 border border-border/50">
          <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Investment These & Katalysatoren-Logik</h3>
          <p className="text-xs text-foreground/80 leading-relaxed">{data.growthThesis}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <MiniCard label="Moat Assessment" value={data.moatRating} badge />
          <MiniCard label="FCF Strength" value={`${formatPercentNoSign(data.fcfMargin)} margin • ${formatLargeNumber(data.fcfTTM)} TTM`} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-muted/30 rounded-md p-3 border border-border/50">
            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Gov. Exposure</div>
            <div className="text-sm font-semibold tabular-nums mt-0.5">{formatPercentNoSign(data.governmentExposure)}</div>
            {data.govExposureDetail && (
              <div className="text-[10px] text-muted-foreground mt-1">{data.govExposureDetail}</div>
            )}
            {data.governmentExposure > 20 && (
              <div className="text-[10px] text-amber-500 mt-1">⚠ FCF haircut of {data.fcfHaircut}% applied</div>
            )}
          </div>
          {data.fcfHaircut > 0 && (
            <div className="bg-amber-500/10 rounded-md p-3 border border-amber-500/20">
              <div className="text-[10px] text-amber-500 font-medium uppercase tracking-wider">FCF Haircut</div>
              <div className="text-sm font-semibold tabular-nums text-amber-500 mt-0.5">{data.fcfHaircut}%</div>
              <div className="text-[10px] text-amber-500/70 mt-1">Applied due to gov. exposure &gt;20%</div>
            </div>
          )}
        </div>

        {/* Structural Trends */}
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wider">Structural Trends</h3>
          <div className="flex flex-wrap gap-2">
            {data.structuralTrends.map((trend, i) => (
              <span
                key={i}
                className="px-2.5 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary border border-primary/10"
              >
                {trend}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Part B: Catalyst table */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Katalysatoren (Sector-Specific)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Catalyst</th>
                <th className="text-left py-2 px-1 text-muted-foreground font-medium">Timeline</th>
                <th className="text-right py-2 px-1 text-muted-foreground font-medium">PoS%</th>
                <th className="text-right py-2 px-1 text-muted-foreground font-medium">Brutto↑</th>
                <th className="text-right py-2 px-1 text-muted-foreground font-medium">Einpr.%</th>
                <th className="text-right py-2 px-1 text-muted-foreground font-medium">Netto↑</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">GB</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {catalysts.map((c, i) => (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="py-1.5 px-2 font-medium">{c.name}</td>
                  <td className="py-1.5 px-1 text-muted-foreground">{c.timeline}</td>
                  <td className="py-1.5 px-1 text-right font-mono tabular-nums">{c.pos}%</td>
                  <td className="py-1.5 px-1 text-right font-mono tabular-nums text-emerald-500">+{formatNumber(c.bruttoUpside, 1)}%</td>
                  <td className="py-1.5 px-1 text-right font-mono tabular-nums">{c.einpreisungsgrad}%</td>
                  <td className="py-1.5 px-1 text-right font-mono tabular-nums text-emerald-500">+{formatNumber(c.nettoUpside, 2)}%</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold">{formatNumber(c.gb, 2)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td colSpan={6} className="py-2 px-2">Total Upside (Σ GB)</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-emerald-500">+{formatNumber(totalUpside, 2)}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Control Calculation */}
      <div className="bg-primary/5 rounded-md p-3 border border-primary/10">
        {(() => {
          const catVsKurs = ((adjustedTarget / data.currentPrice - 1) * 100);
          const isBelowKurs = adjustedTarget < data.currentPrice;
          return (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Conservative DCF (base, WACC {baseDCF.wacc.toFixed(1)}%)</span>
                <span className="font-mono tabular-nums font-semibold">{formatCurrency(baseDCF.perShare)}</span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-muted-foreground">
                  Kat.-adj. Zielwert = {catalystBaseFallback ? 'Analyst PT' : 'Kons. DCF'} × (1 + {formatNumber(totalUpside, 2)}%)
                  {catalystBaseFallback && <span className="text-amber-500 ml-1">⚠</span>}
                </span>
                <span className={`font-mono tabular-nums font-semibold ${isBelowKurs ? 'text-red-500' : 'text-primary'}`}>
                  {formatCurrency(adjustedTarget)}
                </span>
              </div>
              <div className={`flex items-center justify-between text-[10px] mt-0.5 ${isBelowKurs ? 'text-red-500' : 'text-emerald-500'}`}>
                <span>vs. Kurs ({formatCurrency(data.currentPrice)})</span>
                <span className="font-mono font-medium">{catVsKurs >= 0 ? '+' : ''}{formatNumber(catVsKurs, 1)}%</span>
              </div>
            </>
          );
        })()}
      </div>

      <RechenWeg
        title="DCF Rechenweg"
        steps={baseDCF.steps}
      />
    </SectionCard>
  );
}

function MiniCard({ label, value, badge }: { label: string; value: string; badge?: boolean }) {
  return (
    <div className="bg-muted/30 rounded-md p-3 border border-border/50">
      <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</div>
      {badge ? (
        <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-semibold ${
          value === "Wide" ? "bg-emerald-500/15 text-emerald-500" :
          value === "Narrow" ? "bg-amber-500/15 text-amber-500" :
          "bg-red-500/15 text-red-500"
        }`}>{value}</span>
      ) : (
        <div className="text-xs text-foreground/80 mt-1 leading-relaxed">{value}</div>
      )}
    </div>
  );
}
