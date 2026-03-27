import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { formatNumber, formatCurrency } from "../../lib/formatters";
import { calculateFCFFDCF, type FCFFDCFParams } from "../../lib/calculations";
import { Lightbulb, Clock, Zap, Info, ChevronDown, ChevronUp } from "lucide-react";
import { useState, useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section11({ data }: Props) {
  const catalysts = data.catalysts;
  const reasoning = data.catalystReasoning;
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Compute conservative FCFF DCF (same defaults as Section5/Section13)
  const netDebt = data.totalDebt - data.cashEquivalents;
  const sp = data.sectorProfile;
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

  const conservativeDCF = useMemo(() => calculateFCFFDCF({
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
  }), [data]);

  // Total GB — Catalyst-Adj. Target uses conservative DCF as base (per framework)
  // Fallback to analyst PT if DCF is unreasonably low (negative-EBIT companies)
  const totalGB = catalysts.reduce((sum, c) => sum + c.gb, 0);
  const catalystDCFBase = conservativeDCF.perShare > data.currentPrice * 0.05
    ? conservativeDCF.perShare
    : (data.analystPT.median > 0 ? data.analystPT.median : data.currentPrice);
  const catalystBaseFallback = catalystDCFBase !== conservativeDCF.perShare;
  const catalystAdjTarget = catalystDCFBase * (1 + totalGB / 100);

  return (
    <SectionCard number={11} title="KURSANSTIEG-KATALYSATOREN (Anti-Bias)">
      {/* === WARUM GERADE INTERESSANT === */}
      {reasoning && (
        <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Warum ist die Aktie gerade interessant?</span>
          </div>
          <p className="text-xs text-foreground/80 leading-relaxed">
            {reasoning.whyInteresting}
          </p>
          <div className="flex flex-wrap gap-2">
            {reasoning.keyDrivers.map((driver, i) => (
              <span
                key={i}
                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-primary/10 text-primary border border-primary/20"
              >
                <Zap className="w-3 h-3" />
                {driver}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/30 rounded-md p-2 border border-border/50">
            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-medium">Timing:</span>
            <span>{reasoning.timingRationale}</span>
          </div>
        </div>
      )}

      {/* Anti-bias disclaimer */}
      <div className="text-[10px] text-amber-500 bg-amber-500/5 rounded-md p-2 border border-amber-500/20">
        Anti-Bias-Protokoll: Kein selektiver Upside ohne symmetrischen Downside. PoS historisch begründet mit –10–15% Sicherheitsmarge.
        Einpreisungsgrad via Konsens/Reverse DCF geschätzt.
      </div>

      {/* === CATALYST TABLE === */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]" data-testid="catalyst-table">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 pr-2 text-left font-semibold text-muted-foreground w-6">Nr</th>
              <th className="py-2 pr-2 text-left font-semibold text-muted-foreground min-w-[160px]">Name & Kontext</th>
              <th className="py-2 pr-2 text-center font-semibold text-muted-foreground">Timeline</th>
              <th className="py-2 pr-2 text-center font-semibold text-muted-foreground whitespace-nowrap">
                <div>PoS %</div>
                <div className="text-[9px] font-normal opacity-60">hist. begründet</div>
              </th>
              <th className="py-2 pr-2 text-center font-semibold text-muted-foreground whitespace-nowrap">
                <div>Brutto-Upside %</div>
                <div className="text-[9px] font-normal opacity-60">Begründung</div>
              </th>
              <th className="py-2 pr-2 text-center font-semibold text-muted-foreground whitespace-nowrap">
                <div>Einpreisungsgrad %</div>
                <div className="text-[9px] font-normal opacity-60">via Konsens/Rev. DCF</div>
              </th>
              <th className="py-2 pr-2 text-center font-semibold text-muted-foreground">Netto-Upside %</th>
              <th className="py-2 text-right font-semibold text-muted-foreground">GB %</th>
            </tr>
          </thead>
          <tbody>
            {catalysts.map((c, i) => {
              const isExpanded = expandedRow === i;
              return (
                <tr
                  key={i}
                  className={`border-b border-border/50 cursor-pointer hover:bg-muted/20 transition-colors ${isExpanded ? "bg-muted/10" : ""}`}
                  onClick={() => setExpandedRow(isExpanded ? null : i)}
                  data-testid={`catalyst-row-${i}`}
                >
                  <td className="py-2 pr-2 font-mono text-muted-foreground">K{i + 1}</td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-1">
                      <span className="font-medium">{c.name}</span>
                      {isExpanded ? <ChevronUp className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                    </div>
                    {isExpanded && (
                      <div className="mt-1.5 text-[10px] text-muted-foreground leading-relaxed bg-muted/20 rounded p-2 border border-border/30">
                        <div className="flex items-start gap-1">
                          <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <div>
                            <div><span className="font-medium">PoS-Herleitung:</span> Historische Erfolgsrate vergleichbarer Katalysatoren ~{c.pos + 10}%, abzüglich 10% Sicherheitsmarge → {c.pos}%</div>
                            <div className="mt-1"><span className="font-medium">Brutto-Upside:</span> Umsatz-/Margeneffekt bei Eintreten des Katalysators → +{c.bruttoUpside}%</div>
                            <div className="mt-1"><span className="font-medium">Einpreisung:</span> {c.einpreisungsgrad}% — {c.einpreisungsgrad >= 60 ? "größtenteils" : c.einpreisungsgrad >= 40 ? "teilweise" : "niedrig"} in Konsens/Analyst PTs reflektiert</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-center font-mono tabular-nums text-[10px]">{c.timeline}</td>
                  <td className="py-2 pr-2 text-center">
                    <span className={`font-mono tabular-nums font-medium px-1.5 py-0.5 rounded ${
                      c.pos >= 70 ? "bg-emerald-500/10 text-emerald-500" :
                      c.pos >= 50 ? "bg-primary/10 text-primary" :
                      "bg-amber-500/10 text-amber-500"
                    }`}>
                      {c.pos}%
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-center font-mono tabular-nums text-emerald-500 font-medium">+{c.bruttoUpside}%</td>
                  <td className="py-2 pr-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary/60 rounded-full"
                          style={{ width: `${c.einpreisungsgrad}%` }}
                        />
                      </div>
                      <span className="font-mono tabular-nums text-[10px]">{c.einpreisungsgrad}%</span>
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-center font-mono tabular-nums font-medium text-emerald-400">
                    {formatNumber(c.nettoUpside, 2)}%
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums font-bold text-emerald-500">
                    +{formatNumber(c.gb, 2)}
                  </td>
                </tr>
              );
            })}
            {/* Totals row */}
            <tr className="border-t-2 border-primary/30 bg-primary/5">
              <td className="py-2 pr-2" colSpan={6}>
                <span className="font-bold text-xs">Total Catalyst Upside</span>
              </td>
              <td className="py-2 pr-2 text-center font-mono tabular-nums font-bold text-emerald-500">
                {formatNumber(catalysts.reduce((s, c) => s + c.nettoUpside, 0), 2)}%
              </td>
              <td className="py-2 text-right font-mono tabular-nums font-bold text-emerald-500 text-sm">
                +{formatNumber(totalGB, 2)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Catalyst-Adjusted Target */}
      {(() => {
        const catVsKurs = ((catalystAdjTarget / data.currentPrice - 1) * 100);
        const isBelowKurs = catalystAdjTarget < data.currentPrice;
        return (
          <>
            <div className={`rounded-lg border p-3 flex items-center justify-between ${
              isBelowKurs ? 'border-red-500/30 bg-red-500/5' : 'border-primary/30 bg-primary/5'
            }`}>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Catalyst-Adj. Target
                  {catalystBaseFallback && (
                    <span className="ml-1.5 text-amber-500 font-normal">(Basis: Analyst PT)</span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  = {catalystBaseFallback ? 'Analyst PT' : 'Kons. DCF'} × (1 + GB-Summe {formatNumber(totalGB, 2)}%)
                </div>
                <div className="text-[10px] text-muted-foreground">
                  = {formatCurrency(catalystDCFBase)} × (1 + {formatNumber(totalGB, 2)}%) = {formatCurrency(catalystAdjTarget)}
                </div>
                <div className={`text-[10px] font-medium mt-0.5 ${isBelowKurs ? 'text-red-500' : 'text-emerald-500'}`}>
                  vs. Kurs ({formatCurrency(data.currentPrice)}): {catVsKurs >= 0 ? '+' : ''}{formatNumber(catVsKurs, 1)}%
                  {isBelowKurs && ' — Target UNTER aktuellem Kurs'}
                </div>
              </div>
              <div className="text-right">
                <div className={`text-lg font-bold font-mono tabular-nums ${isBelowKurs ? 'text-red-500' : 'text-emerald-500'}`}>
                  {formatCurrency(catalystAdjTarget)}
                </div>
                <div className={`text-xs font-mono font-medium ${isBelowKurs ? 'text-red-500' : 'text-emerald-500'}`}>
                  {catVsKurs >= 0 ? '+' : ''}{formatNumber(catVsKurs, 1)}%
                </div>
              </div>
            </div>
            {catalystBaseFallback && (
              <div className="text-[10px] text-amber-500 bg-amber-500/5 rounded-md p-2 border border-amber-500/20">
                ⚠ DCF-Basis zu niedrig ({formatCurrency(conservativeDCF.perShare)}), verwende Analyst PT Median als Basis
              </div>
            )}
          </>
        );
      })()}

      {/* Symmetric downside catalysts (Anti-bias) */}
      <div className="space-y-1.5">
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Downside-Katalysatoren (Anti-Bias Pflicht)</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <tbody>
              <tr className="border-b border-border/30">
                <td className="py-1.5 pr-2 font-mono text-muted-foreground">D1</td>
                <td className="py-1.5 pr-2 font-medium">Earnings Miss / Guidance Cut</td>
                <td className="py-1.5 pr-2 text-center font-mono text-muted-foreground">Next Quarter</td>
                <td className="py-1.5 pr-2 text-center font-mono text-amber-500">25%</td>
                <td className="py-1.5 text-right font-mono text-red-500 font-medium">-15%</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-1.5 pr-2 font-mono text-muted-foreground">D2</td>
                <td className="py-1.5 pr-2 font-medium">Macro Shock / Black Swan</td>
                <td className="py-1.5 pr-2 text-center font-mono text-muted-foreground">Any time</td>
                <td className="py-1.5 pr-2 text-center font-mono text-amber-500">15%</td>
                <td className="py-1.5 text-right font-mono text-red-500 font-medium">-25%</td>
              </tr>
              <tr className="border-b border-border/30">
                <td className="py-1.5 pr-2 font-mono text-muted-foreground">D3</td>
                <td className="py-1.5 pr-2 font-medium">Regulierung / Kartellverfahren</td>
                <td className="py-1.5 pr-2 text-center font-mono text-muted-foreground">12-24M</td>
                <td className="py-1.5 pr-2 text-center font-mono text-amber-500">20%</td>
                <td className="py-1.5 text-right font-mono text-red-500 font-medium">-20%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}
