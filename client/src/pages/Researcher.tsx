import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, Globe2, TrendingUp, Search, Landmark, RefreshCw,
  Loader2, ShieldCheck, AlertTriangle, Sparkles, ChevronRight
} from "lucide-react";

type Region = "US" | "EU" | "ASIA";
type Tab = "macro" | "sectors" | "screener" | "capex";

const REGION_OPTIONS: { id: Region; label: string; flag: string }[] = [
  { id: "US", label: "USA", flag: "🇺🇸" },
  { id: "EU", label: "Europa", flag: "🇪🇺" },
  { id: "ASIA", label: "Asien", flag: "🌏" },
];

const TABS: { id: Tab; label: string; icon: any; description: string }[] = [
  { id: "macro", label: "Country Macro Pulse", icon: Globe2, description: "Risk-Free Rate, Liquidität, Fiskalpolitik, M2/M3" },
  { id: "sectors", label: "Sector Opportunity", icon: TrendingUp, description: "12 Megatrends gleichgewichtig bewertet (Anti-Bias)" },
  { id: "screener", label: "Undervalued Screener", icon: Search, description: "FMP-Screener + LLM Moat & Margin-Risk Ranking" },
  { id: "capex", label: "Capex & Fiscal", icon: Landmark, description: "Aktive Programme, Subventionen, Tax Reforms" },
];

const ACTION_COLORS: Record<string, string> = {
  Buy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Watch: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Avoid: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-500/10 text-emerald-400",
  medium: "bg-amber-500/10 text-amber-400",
  high: "bg-rose-500/10 text-rose-400",
};

const IMPACT_COLORS: Record<string, string> = {
  high: "bg-violet-500/15 text-violet-300",
  medium: "bg-sky-500/10 text-sky-300",
  low: "bg-foreground/10 text-foreground/60",
};

export default function Researcher() {
  const [activeTab, setActiveTab] = useState<Tab>("macro");
  const [region, setRegion] = useState<Region>("US");
  const [data, setData] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ tab, force }: { tab: Tab; force?: boolean }) => {
      const body: any = { region, force: !!force };
      // For screener, default-filters; user can extend later
      if (tab === "screener") {
        body.marketCapMin = 1000;     // $1B+
        body.marketCapMax = 500000;   // $500B max (skip megacaps)
        body.peMax = 30;
        body.revenueGrowthMin = 5;
      }
      const res = await apiRequest("POST", `/api/researcher/${tab}`, body);
      return await res.json();
    },
    onSuccess: (result, variables) => {
      setData(prev => ({ ...prev, [`${variables.tab}_${region}`]: result }));
      setError(null);
    },
    onError: (err: any) => setError(err?.message || "Analyse fehlgeschlagen"),
  });

  const cacheKey = `${activeTab}_${region}`;
  const currentData = data[cacheKey];

  function runAnalysis(force = false) {
    setError(null);
    mutation.mutate({ tab: activeTab, force });
  }

  const isLoading = mutation.isPending;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-1.5 text-foreground/60 hover:text-foreground text-sm transition-colors">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <div className="flex-1 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <h1 className="text-sm font-semibold tracking-tight">Researcher</h1>
            <span className="text-[10px] text-foreground/40 hidden sm:inline">Hedge-Fund-Style Macro & Stock Discovery</span>
          </div>
          {/* Region selector */}
          <div className="flex items-center gap-1 bg-muted/30 rounded-md p-0.5">
            {REGION_OPTIONS.map(r => (
              <button
                key={r.id}
                onClick={() => setRegion(r.id)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  region === r.id
                    ? "bg-primary/15 text-primary"
                    : "text-foreground/50 hover:text-foreground/80"
                }`}
                data-testid={`button-region-${r.id}`}
              >
                <span className="mr-1">{r.flag}</span>{r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-3 sm:px-4 flex items-center gap-1 overflow-x-auto custom-scrollbar">
          {TABS.map(t => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? "border-violet-400 text-foreground"
                    : "border-transparent text-foreground/50 hover:text-foreground/80"
                }`}
                data-testid={`button-tab-${t.id}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto p-3 sm:p-4">
        {/* Tab description + run button */}
        <div className="flex items-start justify-between gap-3 mb-4 p-3 rounded-lg bg-muted/20 border border-border/30">
          <div className="flex-1">
            <div className="text-xs font-semibold text-foreground/80">
              {TABS.find(t => t.id === activeTab)?.label} — {REGION_OPTIONS.find(r => r.id === region)?.label}
            </div>
            <div className="text-[11px] text-foreground/50 mt-0.5">
              {TABS.find(t => t.id === activeTab)?.description}
            </div>
            {currentData?._cached && (
              <div className="text-[10px] text-emerald-400/70 mt-1">
                Gecachte Analyse — vor {currentData._cacheAge < 60 ? `${currentData._cacheAge} Min` : `${Math.round(currentData._cacheAge / 60)} Std`} erstellt · 0 Credits
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!currentData && !isLoading && (
              <button
                onClick={() => runAnalysis(false)}
                className="px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[11px] font-medium hover:bg-violet-500/25 transition-colors flex items-center gap-1.5"
                data-testid="button-run-analysis"
              >
                <Sparkles className="w-3 h-3" /> Analyse starten
              </button>
            )}
            {currentData && !isLoading && (
              <button
                onClick={() => runAnalysis(true)}
                className="px-2 py-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-muted/40 text-[10px] flex items-center gap-1 transition-colors"
                title="Neue Analyse erzwingen (verbraucht Credits)"
                data-testid="button-refresh-analysis"
              >
                <RefreshCw className="w-3 h-3" /> Aktualisieren
              </button>
            )}
            {isLoading && (
              <div className="px-3 py-1.5 text-[11px] text-foreground/60 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysiere…
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Tab content */}
        {!currentData && !isLoading && !error && (
          <EmptyState />
        )}

        {currentData && activeTab === "macro" && <MacroPanel data={currentData} />}
        {currentData && activeTab === "sectors" && <SectorsPanel data={currentData} />}
        {currentData && activeTab === "screener" && <ScreenerPanel data={currentData} />}
        {currentData && activeTab === "capex" && <CapexPanel data={currentData} />}
      </main>
    </div>
  );
}

// ============================================================
// Empty State
// ============================================================

function EmptyState() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="text-center max-w-md">
        <Sparkles className="w-10 h-10 text-violet-400/40 mx-auto mb-3" />
        <div className="text-sm font-semibold text-foreground/80">Keine Analyse aktiv</div>
        <div className="text-[11px] text-foreground/50 mt-1.5 leading-relaxed">
          Wähle eine Region oben und drücke "Analyse starten". Echte Makro-Daten + LLM-Synthese (Grok 4.1 Fast). Ergebnisse werden 7 Tage gecacht (0 Credits bei Wiederaufruf).
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Tab 1: Macro Pulse
// ============================================================

function MacroPanel({ data }: { data: any }) {
  const llm = data.llmSynthesis;
  const indicators = data.indicators || [];
  return (
    <div className="space-y-4">
      {llm && (
        <div className="rounded-lg border border-border/40 bg-card/30 p-4">
          <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2">Macro Synthesis</div>
          <p className="text-xs text-foreground/85 leading-relaxed">{llm.summary}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            <MacroBlock label="Risk-Free Rate" content={llm.riskFreeRateView} />
            <MacroBlock label="Liquidität" content={llm.liquidityView} />
            <MacroBlock label="Fiskalpolitik" content={llm.fiscalView} />
          </div>
          {Array.isArray(llm.keyDrivers) && llm.keyDrivers.length > 0 && (
            <div className="mt-4">
              <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1.5">Key Drivers</div>
              <ul className="space-y-1">
                {llm.keyDrivers.map((d: string, i: number) => (
                  <li key={i} className="text-[11px] text-foreground/75 flex gap-2">
                    <ChevronRight className="w-3 h-3 shrink-0 mt-0.5 text-violet-400" />{d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(llm.investmentImplications) && llm.investmentImplications.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-1.5">Investment Implications</div>
              <ul className="space-y-1">
                {llm.investmentImplications.map((d: string, i: number) => (
                  <li key={i} className="text-[11px] text-foreground/75 flex gap-2">
                    <ChevronRight className="w-3 h-3 shrink-0 mt-0.5 text-violet-400" />{d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {llm.actionRecommendation && (
            <div className="mt-4 p-2.5 rounded border border-border/30 bg-background/40 flex items-start gap-2">
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${ACTION_COLORS[llm.actionRecommendation] || ""}`}>
                {llm.actionRecommendation}
              </span>
              <span className="text-[11px] text-foreground/75 flex-1">{llm.actionRationale}</span>
            </div>
          )}
        </div>
      )}

      {/* Real macro data table */}
      {indicators.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-card/20 p-3">
          <div className="text-[10px] text-foreground/40 uppercase tracking-wider mb-2">Real Macro Data ({indicators.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-foreground/50 border-b border-border/30">
                  <th className="text-left font-medium py-1.5 px-2">Country</th>
                  <th className="text-left font-medium py-1.5 px-2">Indicator</th>
                  <th className="text-right font-medium py-1.5 px-2">Latest</th>
                  <th className="text-right font-medium py-1.5 px-2">Previous</th>
                  <th className="text-right font-medium py-1.5 px-2 hidden sm:table-cell">Date</th>
                </tr>
              </thead>
              <tbody>
                {indicators.map((i: any, idx: number) => (
                  <tr key={idx} className="border-b border-border/10 hover:bg-muted/10">
                    <td className="py-1.5 px-2 text-foreground/80">{i.country}</td>
                    <td className="py-1.5 px-2 text-foreground/70">{i.category}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-foreground/90">{i.latestValue} {i.unit}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-foreground/50">{i.previousValue}</td>
                    <td className="py-1.5 px-2 text-right text-foreground/40 hidden sm:table-cell">{i.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MacroBlock({ label, content }: { label: string; content: string }) {
  return (
    <div className="rounded-md bg-background/40 border border-border/30 p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-foreground/40 mb-1">{label}</div>
      <p className="text-[11px] text-foreground/80 leading-relaxed">{content}</p>
    </div>
  );
}

// ============================================================
// Tab 2: Sector Opportunity
// ============================================================

function SectorsPanel({ data }: { data: any }) {
  const trends: any[] = data.trends || [];
  const topPicks: string[] = data.topPicks || [];
  return (
    <div className="space-y-4">
      {topPicks.length > 0 && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
          <div className="text-[10px] text-violet-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Top Picks (nach Growth × Moat)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {topPicks.map(id => {
              const t = trends.find(x => x.id === id);
              if (!t) return null;
              return (
                <span key={id} className="px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-[10px] text-violet-200 font-medium">
                  {t.label} · G{t.growthScore}/M{t.moatScore}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {trends.map((t, idx) => (
          <div key={t.id} className="rounded-lg border border-border/40 bg-card/30 p-3">
            <div className="flex items-start gap-3">
              <div className="text-[10px] font-mono text-foreground/40 shrink-0 w-6 pt-0.5">#{idx + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xs font-semibold text-foreground/90">{t.label}</div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${ACTION_COLORS[t.actionRecommendation] || ""}`}>
                    {t.actionRecommendation}
                  </span>
                  <span className="text-[10px] text-foreground/40">· {t.timeline}</span>
                </div>
                <p className="text-[11px] text-foreground/70 mt-1.5 leading-relaxed">{t.reasoning}</p>
                {t.topPlayers?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.topPlayers.map((p: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-muted/40 text-[10px] font-mono text-foreground/70">{p}</span>
                    ))}
                  </div>
                )}
              </div>
              {/* Score bars */}
              <div className="shrink-0 grid grid-cols-2 gap-2 text-center">
                <div>
                  <div className="text-[9px] text-foreground/40 uppercase">Growth</div>
                  <div className="text-sm font-bold tabular-nums text-emerald-400">{t.growthScore}<span className="text-[10px] text-foreground/40">/10</span></div>
                </div>
                <div>
                  <div className="text-[9px] text-foreground/40 uppercase">Moat</div>
                  <div className="text-sm font-bold tabular-nums text-violet-400">{t.moatScore}<span className="text-[10px] text-foreground/40">/10</span></div>
                </div>
                <div className="col-span-2">
                  <span className={`inline-block text-[9px] font-medium px-1.5 py-0.5 rounded ${RISK_COLORS[t.marginRisk] || ""}`}>
                    Margin Risk: {t.marginRisk}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Tab 3: Screener
// ============================================================

function ScreenerPanel({ data }: { data: any }) {
  const candidates: any[] = data.candidates || [];
  if (!candidates.length) {
    return (
      <div className="text-center py-12 text-[11px] text-foreground/50">
        Keine Kandidaten gefunden. Filter anpassen oder andere Region wählen.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {candidates.map((c, idx) => (
        <div key={c.ticker || idx} className="rounded-lg border border-border/40 bg-card/30 p-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <div className="text-[10px] font-mono text-foreground/40">#{idx + 1}</div>
              <div className="text-base font-bold font-mono text-foreground/95">{c.ticker}</div>
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border inline-block mt-1 ${ACTION_COLORS[c.actionRecommendation] || ""}`}>
                {c.actionRecommendation}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-foreground/90 truncate">{c.companyName}</div>
              <div className="text-[10px] text-foreground/50">{c.sector} · {c.industry}</div>
              <p className="text-[11px] text-foreground/75 mt-1.5 leading-relaxed">{c.rationale}</p>
              {c.growthDrivers?.length > 0 && (
                <div className="mt-2">
                  <div className="text-[9px] uppercase text-foreground/40 mb-0.5">Growth Drivers</div>
                  <div className="flex flex-wrap gap-1">
                    {c.growthDrivers.map((d: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-[10px] text-emerald-300/90">{d}</span>
                    ))}
                  </div>
                </div>
              )}
              {c.risks?.length > 0 && (
                <div className="mt-1.5">
                  <div className="text-[9px] uppercase text-foreground/40 mb-0.5">Risks</div>
                  <div className="flex flex-wrap gap-1">
                    {c.risks.map((d: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-rose-500/10 text-[10px] text-rose-300/90">{d}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="shrink-0 grid grid-cols-2 gap-x-3 gap-y-1 text-right text-[10px]">
              <div className="text-foreground/40">MCap</div>
              <div className="font-mono tabular-nums text-foreground/85">${(c.marketCap / 1e9).toFixed(1)}B</div>
              <div className="text-foreground/40">P/E</div>
              <div className="font-mono tabular-nums text-foreground/85">{c.pe?.toFixed(1) || "—"}</div>
              <div className="text-foreground/40">RevGrth</div>
              <div className="font-mono tabular-nums text-foreground/85">{c.revenueGrowth?.toFixed(1) || "—"}%</div>
              <div className="text-foreground/40 pt-1">Moat</div>
              <div className="font-bold tabular-nums text-violet-400 pt-1">{c.moatScore}/10</div>
              <div className="text-foreground/40">M-Risk</div>
              <div className="font-bold tabular-nums text-amber-400">{c.marginRiskScore}/10</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Tab 4: Capex & Fiscal
// ============================================================

function CapexPanel({ data }: { data: any }) {
  const programmes: any[] = data.programmes || [];
  return (
    <div className="space-y-4">
      {(data.totalCapexEstimate || data.govSpendingTrend) && (
        <div className="rounded-lg border border-border/40 bg-card/30 p-3 space-y-2">
          {data.totalCapexEstimate && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-foreground/40">Total Capex / Fiscal Volume</div>
              <div className="text-sm font-semibold text-foreground/85 mt-0.5">{data.totalCapexEstimate}</div>
            </div>
          )}
          {data.govSpendingTrend && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-foreground/40">Gov Spending Trend</div>
              <div className="text-[11px] text-foreground/75 mt-0.5 leading-relaxed">{data.govSpendingTrend}</div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {programmes.map((p, idx) => (
          <div key={idx} className="rounded-lg border border-border/40 bg-card/30 p-3">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-foreground/90">{p.name}</div>
                <div className="text-[10px] text-foreground/50">{p.region} · {p.timeline}</div>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                {p.amountUSD && (
                  <span className="text-xs font-mono font-semibold text-violet-300">{p.amountUSD}</span>
                )}
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${IMPACT_COLORS[p.impact] || ""}`}>
                  {p.impact}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              <span className="px-1.5 py-0.5 rounded bg-muted/40 text-[10px] text-foreground/70">{p.category}</span>
              <span className="px-1.5 py-0.5 rounded bg-foreground/5 text-[10px] text-foreground/60">{p.status}</span>
            </div>
            <p className="text-[11px] text-foreground/75 leading-relaxed">{p.rationale}</p>
            {p.sectors?.length > 0 && (
              <div className="mt-2">
                <div className="text-[9px] uppercase text-foreground/40 mb-0.5">Sectors</div>
                <div className="flex flex-wrap gap-1">
                  {p.sectors.map((s: string, i: number) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-[10px] text-emerald-300/90">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {p.beneficiaries?.length > 0 && (
              <div className="mt-1.5">
                <div className="text-[9px] uppercase text-foreground/40 mb-0.5">Beneficiaries</div>
                <div className="flex flex-wrap gap-1">
                  {p.beneficiaries.map((b: string, i: number) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-violet-500/10 text-[10px] text-violet-300/90 font-mono">{b}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
