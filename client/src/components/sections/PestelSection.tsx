import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight, Scale, RefreshCw, ExternalLink } from "lucide-react";
import { useState } from "react";
import { PolicyContextPanel } from "./PolicyContextPanel";
import { apiRequest } from "@/lib/queryClient";

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

export function PestelSection({ data }: Props) {
  const pestel = data.pestelAnalysis;
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);

  if (!pestel) {
    return (
      <SectionCard number={12} title="PESTEL-ANALYSE & MAKRO-EXPOSURE">
        <div className="text-xs text-muted-foreground">Keine PESTEL-Daten verfügbar.</div>
      </SectionCard>
    );
  }

  return (
    <SectionCard number={12} title="PESTEL-ANALYSE & MAKRO-EXPOSURE">
      <PolicyContextPanel data={data} testIdSuffix="pestel" />

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
                const eColors = exposureColors[cat.exposureRating] || exposureColors.Mittel;
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

      {/* WORK2.md §8 — Regulatory Exposure (LLM-Discovery, generische Achsen) */}
      <RegulatoryExposurePanel data={data} />
    </SectionCard>
  );
}

// ─── Regulatory Exposure (WORK2.md §8) ──────────────────────────────────────

const AXIS_LABEL: Record<string, string> = {
  price_regulation: "Preisregulierung",
  subsidy_incentive: "Subventionen",
  competition_antitrust: "Wettbewerbsrecht",
  environmental_climate: "Umwelt/Klima",
  data_privacy_tech: "Datenschutz/Tech",
  labor_social: "Arbeit/Soziales",
  trade_tariff: "Zölle/Handel",
  procurement_public: "Öff. Beschaffung",
  other: "Sonstige",
};

const CONF_BADGE: Record<string, string> = {
  high: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  low: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

interface RegExposure {
  country: string; regulationAxis: string; title: string; description: string;
  revenueShareInCountry: number | null; estimatedImpactOnSales: number | null;
  probability: number; timeHorizon: string;
  source: { url: string; publishedAt: string; snippet: string };
  confidence: string; epsImpact: number | null; material: boolean; badgeOnly: boolean;
}

interface RegAssessment {
  exposures: RegExposure[]; discarded: number;
  gate: { cap: number; severity: string; rationale: string } | null;
  modelUsed: string; generatedAt: string;
}

function RegulatoryExposurePanel({ data }: { data: StockAnalysis }) {
  const [assessment, setAssessment] = useState<RegAssessment | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const topCountries = (data.geoSegments ?? []).map(g => ({
        countryOrRegion: g.name,
        percentage: g.percentage,
      }));
      const res = await apiRequest("POST", "/api/regulatory", {
        ticker: data.ticker,
        companyName: data.companyName,
        sector: data.sector,
        industry: data.industry,
        description: data.description,
        topCountries,
        totalRevenue: data.revenue,
        // operatingMargin liegt in der Analysis in Prozent vor (z.B. 46.78) —
        // die §8.5-EPS-Formel erwartet eine Dezimalzahl.
        operatingMargin: (data.financialStatements?.incomeStatement?.operatingMargin ?? 0) / 100,
        sharesOutstanding: data.sharesOutstanding,
      }, 120000);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setAssessment(await res.json());
    } catch (err: any) {
      setError(err?.message || "Analyse fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Regulatory Exposure ({data.ticker}) — KI-Discovery
          </h3>
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors disabled:opacity-50"
          data-testid="regulatory-run"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Analysiere …" : assessment ? "Neu analysieren" : "Regulatorik analysieren (KI)"}
        </button>
      </div>

      {!assessment && !loading && !error && (
        <p className="text-xs text-muted-foreground">
          Entdeckt materielle regulatorische und tarifäre Risiken/Chancen über generische
          Suchachsen (Preisregulierung, Subventionen, Wettbewerbsrecht, Zölle, …) auf Basis
          der Top-Umsatzländer — quantifiziert als EPS-Impact mit Gate-Entscheidung nach Test-Matrix.
        </p>
      )}

      {error && (
        <p className="text-xs text-amber-500">{error}</p>
      )}

      {assessment && (
        <div className="space-y-3">
          {/* Gate-Banner (§8.8) */}
          {assessment.gate ? (
            <div className={`rounded-lg p-3 border ${assessment.gate.severity === "hard" ? "bg-red-500/10 border-red-500/30" : "bg-amber-500/10 border-amber-500/30"}`}>
              <div className={`text-xs font-bold ${assessment.gate.severity === "hard" ? "text-red-500" : "text-amber-500"}`}>
                REGULATORY_EXPOSURE-Gate aktiv — Score-Cap {assessment.gate.cap} ({assessment.gate.severity === "hard" ? "hartes Veto" : "Warn-Deckel"})
              </div>
              <div className="text-xs text-muted-foreground mt-1">{assessment.gate.rationale}</div>
            </div>
          ) : (
            <div className="rounded-lg p-3 border bg-emerald-500/5 border-emerald-500/20">
              <div className="text-xs font-medium text-emerald-500">
                Kein Gate aktiv — keine materielle regulatorische Belastung nach Test-Matrix (§8.7)
              </div>
            </div>
          )}

          {/* Exposure-Karten */}
          {assessment.exposures.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Keine belastbaren Exposures gefunden ({assessment.discarded} Roh-Treffer vom Confidence-Filter verworfen).
            </p>
          ) : (
            <div className="space-y-2">
              {assessment.exposures.map((e, i) => (
                <div key={i} className={`rounded-lg p-3 border ${e.material ? "border-red-500/30 bg-red-500/5" : "border-border bg-muted/20"}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="text-xs font-semibold text-foreground">{e.title}</div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary border border-primary/20">
                        {AXIS_LABEL[e.regulationAxis] ?? e.regulationAxis}
                      </span>
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${CONF_BADGE[e.confidence] ?? CONF_BADGE.low}`}>
                        {e.confidence}
                      </span>
                      {e.badgeOnly && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-slate-500/15 text-slate-400 border border-slate-500/30">
                          nur Badge
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{e.description}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] font-mono tabular-nums">
                    <span className="text-muted-foreground">Land: <span className="text-foreground">{e.country}</span></span>
                    {e.estimatedImpactOnSales != null && (
                      <span className="text-muted-foreground">Umsatzwirkung: <span className={e.estimatedImpactOnSales < 0 ? "text-red-400" : "text-emerald-400"}>{(e.estimatedImpactOnSales * 100).toFixed(1)} %</span></span>
                    )}
                    <span className="text-muted-foreground">p: <span className="text-foreground">{(e.probability * 100).toFixed(0)} %</span></span>
                    <span className="text-muted-foreground">Horizont: <span className="text-foreground">{e.timeHorizon}</span></span>
                    {e.epsImpact != null && (
                      <span className="text-muted-foreground">EPS-Impact: <span className={e.epsImpact < 0 ? "text-red-400 font-bold" : "text-emerald-400 font-bold"}>{e.epsImpact >= 0 ? "+" : ""}{e.epsImpact.toFixed(2)} $</span></span>
                    )}
                  </div>
                  {e.source?.url && (
                    <a href={e.source.url} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 mt-1.5 text-[10px] text-primary hover:underline">
                      <ExternalLink className="w-3 h-3" />
                      Quelle{e.source.publishedAt ? ` (${e.source.publishedAt})` : ""}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="text-[10px] text-muted-foreground">
            Modell: {assessment.modelUsed} · {assessment.discarded} Treffer verworfen (§8.6) ·
            Anti-Hardcoding: Discovery über generische Achsen, Regime werden erst nach Extraktion benannt ·
            Quellen sind LLM-referenziert — vor Anlageentscheidung gegenprüfen
          </div>
        </div>
      )}
    </div>
  );
}
