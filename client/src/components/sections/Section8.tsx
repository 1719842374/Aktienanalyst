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
  const GENERIC_RISK_NAMES = new Set([
    "Macro Recession / Demand Shock", "Earnings Miss / Guidance Cut",
    "Multiple Compression (Rising Rates)", "Regulatory / Antitrust Action",
    "Tech Disruption / Competitive Shift", "Government Contract / Policy Dependency",
    "Competitive Pressure / Margin Erosion", "Drug Pricing Reform / Patent Cliff",
    "Credit Quality Deterioration", "Commodity Price Collapse",
    "Consumer Spending Slowdown / China Weakness", "Brand Dilution / Competitive Shift",
  ]);

  const [risks, setRisks] = useState<Risk[]>(data.risks);
  const [expandedRisk, setExpandedRisk] = useState<number | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [hasKIAnalysis, setHasKIAnalysis] = useState(data.risks.some(r => r.explanation));
  const [refreshingRisks, setRefreshingRisks] = useState(false);

  const prevTickerRef = useRef(data.ticker);
  const prevLLMRef = useRef(useLLM);
  const autoTriggeredRef = useRef(false);
  const riskRefreshTriggeredRef = useRef<string | null>(null);

  // Auto-refresh generic template risks with company-specific LLM risks
  useEffect(() => {
    const allGeneric = data.risks.length > 0 && data.risks.every(r => GENERIC_RISK_NAMES.has(r.name));
    const alreadyTriggered = riskRefreshTriggeredRef.current === data.ticker;
    if (!allGeneric || alreadyTriggered || refreshingRisks) return;
    if (!data.description || !data.catalysts?.length) return;

    riskRefreshTriggeredRef.current = data.ticker;
    setRefreshingRisks(true);

    fetch("/api/refresh-risks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: data.ticker,
        companyName: data.companyName,
        description: data.description,
        sector: data.sectorProfile?.sector || "",
        industry: data.industry || "",
        revenue: data.revenue || 0,
        revenueGrowth: data.revenueGrowth || 0,
        fcfMargin: data.fcfMargin || 0,
        forwardPE: data.forwardPE || 0,
        beta: data.beta || 1.1,
        governmentExposure: data.governmentExposure || 0,
        catalysts: (data.catalysts || []).filter(c => !c.tags?.includes("capex-tailwind")),
        newsItems: (data.newsItems || []).slice(0, 4),
      }),
    })
      .then(r => r.json())
      .then(json => {
        if (json.risks && Array.isArray(json.risks) && json.risks.length >= 3) {
          setRisks(json.risks);
          console.log(`[Section8] Refreshed risks for ${data.ticker}:`, json.risks.map((r: Risk) => r.name));
        }
      })
      .catch(() => {})
      .finally(() => setRefreshingRisks(false));
  }, [data.ticker]);

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
  const analystPT = data.analystPT?.median ?? 0;
  const hasPT = analystPT > 0 && analystPT !== data.currentPrice;

  // === Primärer Risiko-adjustierter Zielkurs ===
  // Logik: Analyst PT × (1 - TotalExpectedDamage%) ist realistischer als reiner DCF
  // Beispiel: PT=$46, TotalDamage=21.95% → RiskTarget = $46 × 0.7805 = $35.90
  // Der konservative Inverted DCF ($8.55) ist zu stark von WACC-Modellannahmen dominiert.
  const riskAdjTarget = hasPT
    ? analystPT * (1 - totalExpectedDamage / 100)
    : invertedDCF.perShare; // Fallback auf DCF wenn kein Analyst PT
  const riskAdjVsPrice = (riskAdjTarget / data.currentPrice - 1) * 100;
  const riskAdjVsPT = hasPT ? (riskAdjTarget / analystPT - 1) * 100 : 0;
  const belowReference = riskAdjTarget < data.currentPrice;

  // Legacy: DCF vs Reference (für Rechenweg-Anzeige)
  const dcfVsReference = hasPT
    ? (invertedDCF.perShare / analystPT - 1) * 100
    : (invertedDCF.perShare / data.currentPrice - 1) * 100;

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
      if (json._llmSkipped) {
        if (json.risks && Array.isArray(json.risks)) setRisks(json.risks);
        setLlmError("KI-Analyse nicht verfügbar (Token-Budget erschöpft). Basis-Risiken werden angezeigt.");
      } else if (json.risks && Array.isArray(json.risks)) {
        const anyExpl = json.risks.some((r: Risk) => r.explanation);
        setRisks(json.risks);
        if (anyExpl) {
          setHasKIAnalysis(true);
          const first = json.risks.findIndex((r: Risk) => r.explanation);
          if (first >= 0) setExpandedRisk(first);
        } else {
          setLlmError("KI-Analyse nicht verfügbar (Token-Budget erschöpft). Basis-Risiken werden angezeigt.");
        }
      } else {
        setLlmError("Keine Erklärungen erhalten.");
      }
    } catch (err: any) {
      const msg = err?.message || "";
      if (/503|402/.test(msg)) {
        setLlmError("KI-Analyse nicht verfügbar (Token-Budget erschöpft). Basis-Risiken werden angezeigt.");
      } else {
        setLlmError(msg || "KI-Analyse fehlgeschlagen.");
      }
    } finally {
      setLlmLoading(false);
    }
  }

  return (
    <SectionCard number={8} title="INVERSION – RISIKOEINPREISUNG">

      {/* Warnung — Risiko-adjustierter Zielkurs vs. Kurs */}
      {belowReference && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
          <span className="text-red-500 text-lg">⚠</span>
          <div>
            <div className="text-xs font-bold text-red-500">
              WARNUNG: Risk-Adjusted Target unter aktuellem Kurs
            </div>
            <div className="text-[11px] text-red-400 mt-0.5">
              {hasPT
                ? `Analyst PT (${formatCurrency(analystPT)}) × (1−${totalExpectedDamage.toFixed(1)}% Risiko) = ${formatCurrency(riskAdjTarget)} — ${Math.abs(riskAdjVsPrice).toFixed(1)}% unter Kurs.`
                : `Risikoadjustierter Fair Value (${formatCurrency(riskAdjTarget)}) unter Kurs (${formatCurrency(data.currentPrice)}).`
              } Anti-Bias: Erhöhte Vorsicht geboten.
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
                {formatNumber(totalExpectedDamage, 1)}%
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

      {/* Risiko-adjustierter Zielkurs (Primär) + Inverted DCF (Sekundär) */}
      <div className={`rounded-lg p-3 border ${
        belowReference ? 'bg-red-500/5 border-red-500/20' : 'bg-emerald-500/5 border-emerald-500/20'
      }`}>

        {/* PRIMÄR: Analyst PT × (1 − Risk%) */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="text-xs font-semibold">
              {hasPT ? 'Risk-Adjusted Target' : 'Inverted Risk-Adjusted DCF'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {hasPT
                ? `Analyst PT × (1 − ${totalExpectedDamage.toFixed(1)}% Risikoabschlag)`
                : 'Basiert auf WACC_adj und Growth_adj'}
            </div>
            {hasPT && (
              <div className="text-[10px] text-muted-foreground/60 mt-1 font-mono">
                = {formatCurrency(analystPT)} × {(1 - totalExpectedDamage / 100).toFixed(4)} = {formatCurrency(riskAdjTarget)}
              </div>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl font-bold font-mono tabular-nums">{formatCurrency(riskAdjTarget)}</div>
            <div className={`text-sm font-mono tabular-nums font-semibold ${
              riskAdjVsPrice >= 0 ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {riskAdjVsPrice >= 0 ? '+' : ''}{riskAdjVsPrice.toFixed(1)}% vs Kurs
            </div>
            {hasPT && (
              <div className="text-[10px] text-muted-foreground/50 font-mono">
                {riskAdjVsPT.toFixed(1)}% vs Analyst PT
              </div>
            )}
          </div>
        </div>

        {/* Analyst PT Info + DCF-Vergleich */}
        {hasPT && (
          <div className="mt-3 pt-2 border-t border-border/20 grid grid-cols-2 gap-3 text-[10px]">
            <div className="space-y-0.5">
              <div className="text-muted-foreground">Analyst PT (Median)</div>
              <div className="font-mono font-semibold text-sm">{formatCurrency(analystPT)}</div>
              <div className={`font-mono ${
                analystPT > data.currentPrice ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {((analystPT / data.currentPrice - 1) * 100).toFixed(1)}% vs Kurs
              </div>
            </div>
            <div className="space-y-0.5">
              <div className="text-muted-foreground">Konservativer Inverted DCF</div>
              <div className="font-mono font-semibold text-sm text-foreground/50">{formatCurrency(invertedDCF.perShare)}</div>
              <div className="text-muted-foreground/50 font-mono">
                {dcfVsReference.toFixed(1)}% vs Analyst PT
              </div>
              <div className="text-muted-foreground/40">
                {Math.abs(dcfVsReference) > 50
                  ? '⚠ Reverse-DCF deutlich unter PT — Markt preist starkes Wachstum ein'
                  : Math.abs(dcfVsReference) > 30
                  ? '⚠ DCF-Modellannahmen sehr konservativ'
                  : 'DCF und PT konsistent'}
              </div>
              {/* Divergenz-Erklärung wenn Reverse-DCF stark vom Kurs abweicht */}
              {Math.abs(dcfVsReference) > 40 && (() => {
                const einpreisungsGradHoch = (risks || []).some((r: any) => r.einpreisungsgrad >= 55);
                const dcfBelowKurs = invertedDCF.perShare < data.currentPrice * 0.7;
                if (!dcfBelowKurs) return null;
                return (
                  <div className="mt-2 text-[10px] rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-amber-400/80">
                    <span className="font-semibold">Reverse-DCF ≠ Marktbewertung:</span>{' '}
                    Der Kurs impliziert höheres Wachstum als das DCF-Modell annimmt.
                    {einpreisungsGradHoch
                      ? ' Katalysatoren bereits stark eingepreist — Upside-Potenzial begrenzt.'
                      : ' Katalysatoren noch nicht eingepreist — Markt wettet auf Wachstum.'}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      <RechenWeg title="Risk Adjustment Rechenweg" steps={[
        `Total Expected Damage = Σ(EW% × Impact%) = ${formatNumber(totalExpectedDamage, 2)}%`,
        `WACC_adj = Base WACC + Total Damage / 10 = ${formatPercentNoSign(baseWACC)} + ${formatNumber(totalExpectedDamage / 10, 2)}% = ${formatPercentNoSign(waccAdj, 2)}`,
        `Growth_adj = Base Growth - Total Damage / 5 = ${formatPercentNoSign(baseGrowth, 1)} - ${formatNumber(totalExpectedDamage / 5, 2)}% = ${formatPercentNoSign(Math.max(growthAdj, 1), 2)}`,
        `Inverted DCF (konservativ, WACC_adj/Growth_adj) → ${formatCurrency(invertedDCF.perShare)} per share`,
        hasPT
          ? `Risk-Adjusted Target = Analyst PT × (1 − Risiko%) = ${formatCurrency(analystPT)} × ${(1 - totalExpectedDamage / 100).toFixed(4)} = ${formatCurrency(riskAdjTarget)}`
          : `Risk-Adjusted Target = Inverted DCF = ${formatCurrency(riskAdjTarget)}`,
        belowReference
          ? `⚠ WARNUNG: Risk-Adjusted Target (${formatCurrency(riskAdjTarget)}) = ${riskAdjVsPrice.toFixed(1)}% vs Kurs (${formatCurrency(data.currentPrice)}) → Abschlag dominiert`
          : `✓ Risk-Adjusted Target (${formatCurrency(riskAdjTarget)}) = +${riskAdjVsPrice.toFixed(1)}% vs Kurs → Risiko eingepreist`,
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
