import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useState } from "react";

interface Props { data: StockAnalysis }

const impactColors: Record<string, { bg: string; text: string; border: string }> = {
  Positiv: { bg: "bg-emerald-500/10", text: "text-emerald-500", border: "border-emerald-500/20" },
  Neutral: { bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/20" },
  Negativ: { bg: "bg-red-500/10", text: "text-red-500", border: "border-red-500/20" },
};

const corrColors: Record<string, { bg: string; text: string; border: string; label: string }> = {
  Positiv: { bg: "bg-emerald-500/15", text: "text-emerald-400", border: "border-emerald-500/30", label: "Kurstreiber" },
  Neutral: { bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/20", label: "Neutral" },
  Negativ: { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/30", label: "Kursrisiko" },
};

const severityColors: Record<string, { bg: string; text: string }> = {
  Hoch: { bg: "bg-red-500/15", text: "text-red-500" },
  Mittel: { bg: "bg-amber-500/15", text: "text-amber-500" },
  Niedrig: { bg: "bg-emerald-500/15", text: "text-emerald-500" },
};

const exposureColors: Record<string, { bg: string; text: string }> = {
  Hoch: { bg: "bg-red-500/15", text: "text-red-500" },
  Mittel: { bg: "bg-amber-500/15", text: "text-amber-500" },
  Niedrig: { bg: "bg-emerald-500/15", text: "text-emerald-500" },
};

function ImpactIcon({ impact }: { impact: string }) {
  if (impact === "Positiv") return <TrendingUp className="w-3 h-3 text-emerald-500" />;
  if (impact === "Negativ") return <TrendingDown className="w-3 h-3 text-red-500" />;
  return <Minus className="w-3 h-3 text-slate-400" />;
}

function StockCorrIcon({ corr }: { corr: string }) {
  if (corr === "Positiv") return <ArrowUpRight className="w-3 h-3 text-emerald-400" />;
  if (corr === "Negativ") return <ArrowDownRight className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-slate-400" />;
}

export function Section16({ data }: Props) {
  const pestel = data.pestelAnalysis;
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);

  if (!pestel) {
    return (
      <SectionCard number={16} title="PESTEL-ANALYSE & MAKRO-EXPOSURE">
        <div className="text-xs text-muted-foreground">Keine PESTEL-Daten verfügbar.</div>
      </SectionCard>
    );
  }

  return (
    <SectionCard number={16} title="PESTEL-ANALYSE & MAKRO-EXPOSURE">
      {/* Overview KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={`rounded-lg p-3 border ${
          pestel.overallExposure === "Hoch" ? "bg-red-500/5 border-red-500/20" :
          pestel.overallExposure === "Mittel" ? "bg-amber-500/5 border-amber-500/20" :
          "bg-emerald-500/5 border-emerald-500/20"
        }`}>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Gesamt-Exposure</div>
          <div className={`text-lg font-bold mt-1 ${
            pestel.overallExposure === "Hoch" ? "text-red-500" :
            pestel.overallExposure === "Mittel" ? "text-amber-500" :
            "text-emerald-500"
          }`}>{pestel.overallExposure}</div>
        </div>

        <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Geopolitischer Score</div>
          <div className={`text-lg font-bold font-mono tabular-nums mt-1 ${
            pestel.geopoliticalScore >= 7 ? "text-red-500" :
            pestel.geopoliticalScore >= 4 ? "text-amber-500" :
            "text-emerald-500"
          }`}>
            {pestel.geopoliticalScore} / 10
          </div>
        </div>

        <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Kategorie-Exposure</div>
          <div className="flex gap-1 mt-1.5">
            {pestel.factors.map((f, i) => (
              <span key={i} className={`text-base`} title={`${f.categoryDE}: ${f.exposureRating}`}>
                {f.icon}
              </span>
            ))}
          </div>
          <div className="flex gap-1 mt-0.5">
            {pestel.factors.map((f, i) => (
              <div key={i} className={`h-1 flex-1 rounded-full ${
                f.exposureRating === "Hoch" ? "bg-red-500" :
                f.exposureRating === "Mittel" ? "bg-amber-500" :
                "bg-emerald-500"
              }`} />
            ))}
          </div>
        </div>
      </div>

      {/* Macro Summary */}
      <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">Makro-Zusammenfassung</div>
        <div className="text-xs text-foreground/80 leading-relaxed">{pestel.macroSummary}</div>
      </div>

      {/* Interest Rate & Capital Costs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
            📈 Zinsen-Ausblick
          </div>
          <div className="text-xs text-foreground/80 leading-relaxed">{pestel.interestRateOutlook}</div>
        </div>
        <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
            💰 Kapitalkosten-Impact
          </div>
          <div className="text-xs text-foreground/80 leading-relaxed">{pestel.capitalCostImpact}</div>
        </div>
      </div>

      {/* PESTEL Factors Accordion */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">PESTEL-Faktoren</h3>
        <div className="space-y-2">
          {pestel.factors.map((category, ci) => {
            const isExpanded = expandedCategory === ci;
            const eColors = exposureColors[category.exposureRating] || exposureColors.Mittel;

            return (
              <div key={ci} className="rounded-lg border border-border/50 overflow-hidden">
                <button
                  onClick={() => setExpandedCategory(isExpanded ? null : ci)}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/20 transition-colors"
                  data-testid={`button-pestel-${category.category}`}
                >
                  <span className="text-base flex-shrink-0">{category.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold">{category.categoryDE}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {category.factors.length} Faktor{category.factors.length !== 1 ? "en" : ""}
                    </div>
                  </div>
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${eColors.bg} ${eColors.text}`}>
                    {category.exposureRating}
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t border-border/50 px-3 pb-3">
                    {/* Regional Outlook */}
                    <div className="bg-muted/10 rounded-md p-2.5 mt-2 mb-3 text-[11px] text-foreground/70 leading-relaxed">
                      <span className="text-muted-foreground font-medium">Regional Outlook: </span>
                      {category.regionalOutlook}
                    </div>

                    {/* Factor Details */}
                    <div className="space-y-2">
                      {category.factors.map((factor, fi) => {
                        const ic = impactColors[factor.impact] || impactColors.Neutral;
                        const sc = severityColors[factor.severity] || severityColors.Mittel;
                        const cc = corrColors[factor.stockCorrelation] || corrColors.Neutral;
                        const corrDiffers = factor.stockCorrelation !== factor.impact;
                        return (
                          <div key={fi} className={`rounded-md border p-2.5 ${corrDiffers ? cc.border : 'border-border/30'}`}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <ImpactIcon impact={factor.impact} />
                              <span className="text-xs font-medium flex-1">{factor.name}</span>
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold ${ic.bg} ${ic.text} border ${ic.border}`}>
                                Markt: {factor.impact}
                              </span>
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold ${sc.bg} ${sc.text}`}>
                                {factor.severity}
                              </span>
                            </div>
                            {/* Stock-Specific Correlation — prominently displayed */}
                            <div className={`flex items-center gap-1.5 mb-1.5 px-2 py-1 rounded ${cc.bg} border ${cc.border}`}>
                              <StockCorrIcon corr={factor.stockCorrelation} />
                              <span className={`text-[10px] font-bold ${cc.text} uppercase`}>
                                {data.ticker}: {cc.label}
                              </span>
                              <span className="text-[10px] text-foreground/60 ml-1">
                                {factor.stockCorrelationNote}
                              </span>
                            </div>
                            <div className="text-[11px] text-foreground/70 leading-relaxed">
                              {factor.description}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Exposure Summary Table */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Exposure-Matrix ({data.ticker})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Kategorie</th>
                <th className="text-center py-2 px-2 text-muted-foreground font-medium">Faktoren</th>
                <th className="text-center py-2 px-2 text-muted-foreground font-medium">Markt-Neg.</th>
                <th className="text-center py-2 px-2 text-muted-foreground font-medium">Kurstreiber</th>
                <th className="text-center py-2 px-2 text-muted-foreground font-medium">Kursrisiko</th>
                <th className="text-center py-2 px-2 text-muted-foreground font-medium">Exposure</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {pestel.factors.map((cat, i) => {
                const negCount = cat.factors.filter(f => f.impact === "Negativ").length;
                const corrPosCount = cat.factors.filter(f => f.stockCorrelation === "Positiv").length;
                const corrNegCount = cat.factors.filter(f => f.stockCorrelation === "Negativ").length;
                const eColors = exposureColors[cat.exposureRating];
                return (
                  <tr key={i}>
                    <td className="py-2 px-2 font-medium">
                      <span className="mr-1.5">{cat.icon}</span>
                      {cat.categoryDE}
                    </td>
                    <td className="py-2 px-2 text-center font-mono tabular-nums">{cat.factors.length}</td>
                    <td className="py-2 px-2 text-center">
                      {negCount > 0 ? (
                        <span className="text-red-500 font-mono tabular-nums font-bold">{negCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center">
                      {corrPosCount > 0 ? (
                        <span className="text-emerald-400 font-mono tabular-nums font-bold">{corrPosCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center">
                      {corrNegCount > 0 ? (
                        <span className="text-red-400 font-mono tabular-nums font-bold">{corrNegCount}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${eColors.bg} ${eColors.text}`}>
                        {cat.exposureRating}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}
