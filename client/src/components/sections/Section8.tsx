import React from "react";
import { SectionCard } from "../SectionCard";
import { RechenWeg } from "../RechenWeg";
import type { StockAnalysis, Risk } from "../../../../shared/schema";
import { calculateDCF } from "../../lib/calculations";
import { formatCurrency, formatNumber, formatPercentNoSign } from "../../lib/formatters";
import { useMemo, useState, useEffect, useRef } from "react";
import {
  ChevronDown, ChevronUp,
  AlertTriangle, TrendingDown, Shield, BarChart2,
  Sparkles, Loader2,
} from "lucide-react";
import { apiRequest } from "../../lib/queryClient";

interface Props {
  data: StockAnalysis;
  useLLM?: boolean; // Globaler KI-Toggle aus Dashboard
}

export function Section8({ data, useLLM = false }: Props) {
  const [risks, setRisks] = useState<Risk[]>(data.risks);
  const [expandedRisk, setExpandedRisk] = useState<number | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [hasKIAnalysis, setHasKIAnalysis] = useState(data.risks.some(r => r.explanation));

  const prevTickerRef = useRef(data.ticker);
  const prevLLMRef = useRef(useLLM);
  const autoTriggeredRef = useRef(false);

  // Wenn KI beim ersten Mount aktiv ist und noch keine Erklärungen vorhanden
  useEffect(() => {
    if (!autoTriggeredRef.current && useLLM && !data.risks.some(r => r.explanation)) {
      autoTriggeredRef.current = true;
      triggerKI();
    }
  }, []);

  // Reagiere auf Ticker-Wechsel oder KI-Toggle-Änderung
  useEffect(() => {
    const tickerChanged = data.ticker !== prevTickerRef.current;
    const llmTurnedOn = useLLM && !prevLLMRef.current;

    prevTickerRef.current = data.ticker;
    prevLLMRef.current = useLLM;

    if (tickerChanged) {
      setRisks(data.risks);
      setExpandedRisk(null);
      setLlmError(null);
      const hasExpl = data.risks.some(r => r.explanation);
      setHasKIAnalysis(hasExpl);
      if (useLLM && !hasExpl) triggerKI();
      return;
    }

    if (llmTurnedOn && !risks.some(r => r.explanation) && !llmLoading) {
      triggerKI();
    }
  }, [data.ticker, useLLM]);

  const sp = data.sectorProfile;

  const top3 = useMemo(() =>
    [...risks].sort((a, b) => b.expectedDamage - a.expectedDamage).slice(0, 3),
    [risks]
  );

  const totalExpectedDamage = risks.reduce((s, r) => s + r.expectedDamage, 0);
  const baseWACC  = sp.waccScenarios.kons;
  const baseGrowth = sp.growthAssumptions.g1;
  const waccAdj   = baseWACC + totalExpectedDamage / 10;
  const growthAdj = baseGrowth - totalExpectedDamage / 5;
  const netDebt   = data.totalDebt - data.cashEquivalents;
  const haircut   = data.fcfHaircut;

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

  const belowPrice = invertedDCF.perShare < data.currentPrice;

  // === KI Analyse Trigger (analog Katalysatoren – nur Grok) ===
  async function triggerKI() {
    setLlmLoading(true);
    setLlmError(null);
    try {
      const res = await apiRequest("POST", "/api/risk-explanations", {
        ticker: data.ticker,
        companyName: data.companyName,
        sector: data.sector,
        industry: data.industry,
        description: data.description,
        revenue: data.revenue,
        revenueGrowth: data.financialStatements?.incomeStatement?.revenueGrowth ?? 0,
        fcfMargin: data.fcfMargin,
        price: data.currentPrice,
        pe: data.peRatio,
        marketCap: data.marketCap,
        governmentExposure: data.governmentExposure,
        risks: data.risks,
      });
      const json = await res.json();
      if (json.risks && Array.isArray(json.risks)) {
        setRisks(json.risks);
        setHasKIAnalysis(true);
        const first = json.risks.findIndex((r: Risk) => r.explanation);
        if (first >= 0) setExpandedRisk(first);
      } else {
        setLlmError("Keine Erklärungen erhalten.");
      }
    } catch (err: any) {
      setLlmError(err?.message || "KI-Analyse fehlgeschlagen.");
    } finally {
      setLlmLoading(false);
    }
  }

  return (
    <SectionCard number={8} title="INVERSION – RISIKOEINPREISUNG">

      {/* Warnung */}
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

      {/* KI Analyse Button – analog Katalysatoren */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => !llmLoading && triggerKI()}
          disabled={llmLoading}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all ${
            hasKIAnalysis
              ? "bg-violet-500/15 text-violet-400 border-violet-500/30"
              : "text-foreground/50 border-border/50 hover:bg-muted/50 hover:text-foreground/70"
          } ${llmLoading ? "opacity-60 cursor-not-allowed" : ""}`}
          title="KI Analyse — unternehmensspezifische Risiko-Erklärungen via Grok"
          data-testid="button-risk-ki-analyse"
        >
          {llmLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Sparkles className="w-3 h-3" />
          )}
          KI Analyse
          {hasKIAnalysis && !llmLoading && (
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
          )}
        </button>

        {llmLoading && (
          <span className="text-[10px] text-muted-foreground animate-pulse">
            Generiere Risikoanalyse…
          </span>
        )}

        {hasKIAnalysis && !llmLoading && (
          <span className="ml-auto text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-violet-500/10 text-violet-400 border-violet-500/20">
            ✦ KI
          </span>
        )}
      </div>

      {llmError && (
        <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          ⚠ {llmError}
        </div>
      )}

      {/* Risikotabelle */}
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
              const isExpanded = expandedRisk === i;
              const hasExplanation = !!r.explanation;
              return (
                <React.Fragment key={i}>
                  <tr
                    className={`${isTop3 ? "bg-red-500/5" : ""} ${
                      hasExplanation ? "cursor-pointer hover:bg-muted/20 transition-colors" : ""
                    }`}
                    onClick={() => hasExplanation && setExpandedRisk(isExpanded ? null : i)}
                  >
                    <td className="py-1.5 px-2 font-medium">
                      <div className="flex items-center gap-1.5">
                        {isTop3 && <span className="text-red-500">●</span>}
                        <span>{r.name}</span>
                        {hasExplanation && (
                          isExpanded
                            ? <ChevronUp className="w-3 h-3 text-muted-foreground ml-0.5 flex-shrink-0" />
                            : <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5 flex-shrink-0" />
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 px-1 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        r.category === "Binary"  ? "bg-red-500/10 text-red-500" :
                        r.category === "Gradual" ? "bg-amber-500/10 text-amber-500" :
                                                   "bg-purple-500/10 text-purple-500"
                      }`}>
                        {r.category}
                      </span>
                    </td>
                    <td className="py-1.5 px-1 text-right font-mono tabular-nums">{r.ew}%</td>
                    <td className="py-1.5 px-1 text-right font-mono tabular-nums">{r.impact}%</td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold text-red-500">
                      {formatNumber(r.expectedDamage, 2)}%
                    </td>
                  </tr>

                  {/* Expandierbare KI-Erklärung – analog Katalysatoren */}
                  {isExpanded && r.explanation && (
                    <tr key={`${i}-detail`}>
                      <td colSpan={5} className="px-2 pb-3 pt-0">
                        <div className="mt-1.5 rounded-lg bg-muted/20 border border-border/30 p-3 space-y-2.5 text-[11px]">

                          {/* 1. Risiko-Kontext */}
                          {r.explanation.kontext && (
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                              <div>
                                <span className="font-semibold text-foreground/80">Risiko-Kontext: </span>
                                <span className="text-foreground/70 leading-relaxed">{r.explanation.kontext}</span>
                              </div>
                            </div>
                          )}

                          {/* 2. Gewichtungs-Begründung */}
                          {r.explanation.gewichtungsBegrundung && (
                            <div className="flex items-start gap-2 border-t border-border/20 pt-2">
                              <BarChart2 className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                              <div>
                                <span className="font-semibold text-foreground/80">
                                  Gewichtung (EW {r.ew}% / Impact {r.impact}%):
                                </span>{" "}
                                <span className="text-foreground/70 leading-relaxed">{r.explanation.gewichtungsBegrundung}</span>
                              </div>
                            </div>
                          )}

                          {/* 3. Bewertungsauswirkung */}
                          {r.explanation.bewertungsAuswirkung && (
                            <div className="flex items-start gap-2 border-t border-border/20 pt-2">
                              <TrendingDown className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                              <div>
                                <span className="font-semibold text-foreground/80">Bewertungsauswirkung: </span>
                                <span className="text-foreground/70 leading-relaxed">{r.explanation.bewertungsAuswirkung}</span>
                              </div>
                            </div>
                          )}

                          {/* 4. Mitigation */}
                          {r.explanation.mitigation && (
                            <div className="flex items-start gap-2 border-t border-border/20 pt-2">
                              <Shield className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                              <div>
                                <span className="font-semibold text-foreground/80">Gegenmaßnahmen: </span>
                                <span className="text-foreground/70 leading-relaxed">{r.explanation.mitigation}</span>
                              </div>
                            </div>
                          )}

                          {/* 5. Gesamteinschätzung + Unterschätzt-Flag */}
                          {r.explanation.gesamtEinschaetzung && (
                            <div className={`flex items-start gap-2 border-t border-border/20 pt-2 rounded-md p-2 -mx-1 ${
                              r.explanation.unterschaetzt
                                ? "bg-red-500/10 border border-red-500/20"
                                : "bg-muted/20"
                            }`}>
                              <div className="flex-1">
                                <span className="font-semibold text-foreground/80">Gesamteinschätzung: </span>
                                <span className="text-foreground/70 leading-relaxed">{r.explanation.gesamtEinschaetzung}</span>
                              </div>
                              {r.explanation.unterschaetzt && (
                                <span className="flex-shrink-0 text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded uppercase tracking-wide">
                                  Unterschätzt
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td colSpan={4} className="py-2 px-2">Total Expected Damage</td>
              <td className="py-2 px-2 text-right font-mono tabular-nums text-red-500">
                {formatNumber(totalExpectedDamage, 2)}%
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Adjusted Parameters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AdjCard label="WACC Base"   value={formatPercentNoSign(baseWACC)} />
        <AdjCard label="WACC Adj."   value={formatPercentNoSign(waccAdj, 1)} highlight />
        <AdjCard label="Growth Base" value={formatPercentNoSign(baseGrowth, 1)} />
        <AdjCard label="Growth Adj." value={formatPercentNoSign(Math.max(growthAdj, 1), 1)} highlight />
      </div>

      {/* Inverted DCF */}
      <div className={`rounded-lg p-3 border ${
        belowPrice ? "bg-red-500/5 border-red-500/20" : "bg-emerald-500/5 border-emerald-500/20"
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold">Inverted Risk-Adjusted DCF</div>
            <div className="text-[10px] text-muted-foreground">Using WACC_adj and Growth_adj</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold font-mono tabular-nums">{formatCurrency(invertedDCF.perShare)}</div>
            <div className={`text-xs font-mono tabular-nums ${
              invertedDCF.perShare > data.currentPrice ? "text-emerald-500" : "text-red-500"
            }`}>
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
        belowPrice
          ? `⚠ WARNUNG: ${formatCurrency(invertedDCF.perShare)} < ${formatCurrency(data.currentPrice)} → Downside dominiert`
          : `✓ ${formatCurrency(invertedDCF.perShare)} > ${formatCurrency(data.currentPrice)} → Upside-Potenzial vorhanden`,
      ]} />
    </SectionCard>
  );
}

function AdjCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md p-2.5 border text-center ${
      highlight ? "bg-primary/5 border-primary/20" : "bg-muted/30 border-border/50"
    }`}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-semibold font-mono tabular-nums mt-0.5 ${highlight ? "text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}
