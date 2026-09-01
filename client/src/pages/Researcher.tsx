import { useState, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, Globe2, TrendingUp, Search, Landmark, RefreshCw,
  Loader2, ShieldCheck, AlertTriangle, Sparkles, ChevronRight,
  Zap, ArrowUp, ArrowDown, Minus, Flame, Activity, ListPlus
} from "lucide-react";
import { TickerAddButtons, bulkAddToWatchlist } from "@/components/portfolio/TickerAddButtons";
import { MacroPanel } from "@/components/researcher/MacroPanel";
import { SectorsPanel } from "@/components/researcher/SectorsPanel";
import { ScreenerPanel } from "@/components/researcher/ScreenerPanel";
import { CapexPanel } from "@/components/researcher/CapexPanel";

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
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [briefingData, setBriefingData] = useState<any>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState<string | null>(null);

  async function runBriefing(force = false) {
    setBriefingOpen(true);
    setBriefingLoading(true);
    setBriefingError(null);
    if (force) setBriefingData(null);
    try {
      const res = await apiRequest("POST", "/api/researcher/daily-briefing", { force });
      setBriefingData(await res.json());
    } catch (err: any) {
      const msg = err?.message || "";
      if (/^(503|504|408|499)/.test(msg) || /timeout/i.test(msg)) {
        try {
          await new Promise(r => setTimeout(r, 3000));
          const res2 = await apiRequest("POST", "/api/researcher/daily-briefing", { force: false });
          setBriefingData(await res2.json());
          return;
        } catch (e2: any) { /* fall through */ }
      }
      setBriefingError(msg || "Briefing fehlgeschlagen");
    } finally {
      setBriefingLoading(false);
    }
  }

  const mutation = useMutation({
    mutationFn: async ({ tab, force, region: mutRegion }: { tab: Tab; force?: boolean; region: Region }) => {
      const body: any = { region: mutRegion, force: !!force };
      if (tab === "screener") {
        body.marketCapMin = 1000;
        body.marketCapMax = 500000;
        body.peMax = 30;
        body.revenueGrowthMin = 5;
      }
      const MAX_RETRIES = 3;
      let lastErr: any = null;
      const wasForced = !!body.force;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const res = await apiRequest("POST", `/api/researcher/${tab}`, body);
          const json = await res.json();
          if (json?.__error) throw new Error(json.errorMessage || "Analyse fehlgeschlagen");
          return json;
        } catch (err: any) {
          lastErr = err;
          const msg = err?.message || "";
          if (!/^(503|504|408|499)/.test(msg) && !/timeout|abort|network|fetch/i.test(msg)) throw err;
          const waitMs = wasForced && attempt === 0 ? 40_000 : 3_000;
          body.force = false;
          await new Promise(r => setTimeout(r, waitMs));
        }
      }
      throw lastErr || new Error("Analyse fehlgeschlagen. Bitte erneut versuchen.");
    },
    onSuccess: (result, variables) => {
      setData(prev => ({ ...prev, [`${variables.tab}_${variables.region}`]: result }));
      setError(null);
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      let friendly = raw;
      if (/^(503|504|408|499)/.test(raw) || /timeout|abort/i.test(raw)) {
        friendly = "Verbindung zur Analyse unterbrochen. Die Analyse läuft noch im Hintergrund — bitte nochmals auf 'Analyse starten' klicken, das Ergebnis kommt dann sofort aus dem Cache.";
      } else if (raw.includes("Analyse-Timeout")) {
        friendly = "Analyse-Timeout: Der Server hat zu lange gebraucht. Bitte 'Analyse starten' nochmals klicken — das Ergebnis ist im Cache.";
      } else if (!raw || raw.length < 5) {
        friendly = "Analyse fehlgeschlagen — unbekannter Fehler. Bitte erneut versuchen.";
      }
      setError(friendly);
    },
  });

  const cacheKey = `${activeTab}_${region}`;
  const currentData = data[cacheKey];

  function runAnalysis(force = false) {
    setError(null);
    mutation.mutate({ tab: activeTab, force, region });
  }

  const isLoading = mutation.isPending;
  const loadingForCurrentView = isLoading
    && mutation.variables?.tab === activeTab
    && mutation.variables?.region === region;

  const isStaleRefreshing = !!currentData?._staleRefreshing;

  useEffect(() => {
    if (!isStaleRefreshing) return;
    const timer = setTimeout(() => runAnalysis(false), 32_000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStaleRefreshing, cacheKey]);

  const isStale = !!currentData && !isStaleRefreshing && (
    currentData._fallback === true ||
    currentData?.llmSynthesis?._fallback === true ||
    currentData?.modelUsed === "fallback" ||
    (Array.isArray(currentData.trends) && currentData.trends.length === 0) ||
    (Array.isArray(currentData.candidates) && currentData.candidates.length === 0) ||
    (Array.isArray(currentData.programmes) && currentData.programmes.length === 0)
  );

  // Selbstheilung: ein duenner Cache-Eintrag (isStale=true, z.B. Capex mit
  // programmes=[]) blieb bisher haengen, bis der Nutzer manuell "Aktualisieren"
  // klickte — isStaleRefreshing deckt nur den Fall ab, in dem der Server
  // BEREITS einen Hintergrund-Refresh gestartet hat (z.B. isStaleCache() bei
  // einem noch teilweise befuellten Eintrag). Ein komplett leerer/degradierter
  // Eintrag (kein Hintergrund-Refresh aktiv) loeste bislang gar keinen erneuten
  // Fetch aus. Max. 1 automatischer force-Retry pro cacheKey, damit ein
  // dauerhaft dünn liefernder Server (z.B. LLM down) nicht in eine Schleife
  // aus teuren force-Calls läuft — danach bleibt der manuelle Button die
  // einzige Eskalation, exakt wie im Normalfall.
  const autoHealedKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isStale) return;
    if (autoHealedKeysRef.current.has(cacheKey)) return;
    autoHealedKeysRef.current.add(cacheKey);
    const timer = setTimeout(() => runAnalysis(true), 500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStale, cacheKey]);

  return (
    <div className="h-screen overflow-y-auto bg-background text-foreground">
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2 sm:py-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/" className="flex items-center gap-1.5 text-foreground/60 hover:text-foreground text-sm transition-colors shrink-0">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
            <div className="flex-1 flex items-center gap-1.5 sm:gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
              <h1 className="text-sm font-semibold tracking-tight">Researcher</h1>
              <span className="text-[10px] text-foreground/40 hidden md:inline truncate">Hedge-Fund-Style Macro & Stock Discovery</span>
            </div>
            <button
              onClick={() => runBriefing(false)}
              className="h-8 px-2 sm:px-2.5 text-[11px] font-medium text-amber-400 hover:bg-amber-500/10 rounded-md transition-colors flex items-center gap-1.5 border border-amber-400/30 shrink-0"
              title="Pre-Market Briefing — Macro-Lage US + EU + ASIA"
              data-testid="button-briefing"
            >
              <Flame className="w-3 h-3" />
              <span className="hidden xs:inline sm:inline">Briefing</span>
            </button>
            <div className="hidden sm:flex items-center gap-1 bg-muted/30 rounded-md p-0.5 shrink-0">
              {REGION_OPTIONS.map(r => (
                <button
                  key={r.id}
                  onClick={() => setRegion(r.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                    region === r.id ? "bg-primary/15 text-primary" : "text-foreground/50 hover:text-foreground/80"
                  }`}
                  data-testid={`button-region-${r.id}`}
                >
                  <span className="mr-1">{r.flag}</span>{r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="sm:hidden flex items-center gap-1 bg-muted/30 rounded-md p-0.5 mt-2">
            {REGION_OPTIONS.map(r => (
              <button
                key={r.id}
                onClick={() => setRegion(r.id)}
                className={`flex-1 px-2 py-1.5 rounded text-[11px] font-medium transition-colors ${
                  region === r.id ? "bg-primary/15 text-primary" : "text-foreground/50"
                }`}
              >
                <span className="mr-1">{r.flag}</span>{r.label}
              </button>
            ))}
          </div>
        </div>

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

      <main className="max-w-6xl mx-auto p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3 mb-4 p-3 rounded-lg bg-muted/20 border border-border/30">
          <div className="flex-1">
            <div className="text-xs font-semibold text-foreground/80">
              {TABS.find(t => t.id === activeTab)?.label} — {REGION_OPTIONS.find(r => r.id === region)?.label}
            </div>
            <div className="text-[11px] text-foreground/50 mt-0.5">
              {TABS.find(t => t.id === activeTab)?.description}
            </div>
            {currentData?._cached && !isStale && (
              <div className="text-[10px] text-emerald-400/70 mt-1">
                Gecachte Analyse — vor {currentData._cacheAge < 60 ? `${currentData._cacheAge} Min` : `${Math.round(currentData._cacheAge / 60)} Std`} erstellt · 0 Credits
              </div>
            )}
            {isStaleRefreshing && (
              <div className="text-[10px] text-sky-400/80 mt-1 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                KI-Analyse wird im Hintergrund aktualisiert — in ~30s neu laden
              </div>
            )}
            {isStale && (
              <div className="text-[10px] text-amber-300/90 mt-1 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Gecachte Analyse ohne KI-Inhalt — bitte „Aktualisieren“ klicken
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!currentData && !loadingForCurrentView && (
              <button
                onClick={() => runAnalysis(false)}
                className="px-3 py-1.5 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[11px] font-medium hover:bg-violet-500/25 transition-colors flex items-center gap-1.5"
                data-testid="button-run-analysis"
              >
                <Sparkles className="w-3 h-3" /> Analyse starten
              </button>
            )}
            {currentData && !loadingForCurrentView && (
              <button
                onClick={() => runAnalysis(true)}
                className={
                  isStale
                    ? "px-3 py-1.5 rounded-md bg-amber-500/15 border border-amber-400/60 text-amber-200 text-[11px] font-semibold flex items-center gap-1.5 transition-all shadow-[0_0_12px_rgba(251,191,36,0.35)] hover:bg-amber-500/25"
                    : "px-2 py-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-muted/40 text-[10px] flex items-center gap-1 transition-colors"
                }
                title={isStale ? "KI-Inhalt fehlt — neu generieren" : "Neue Analyse erzwingen (verbraucht Credits)"}
                data-testid="button-refresh-analysis"
              >
                <RefreshCw className={isStale ? "w-3.5 h-3.5" : "w-3 h-3"} /> Aktualisieren
              </button>
            )}
            {loadingForCurrentView && (
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

        {!currentData && !loadingForCurrentView && !error && activeTab !== "sectors" && (
          <EmptyState />
        )}
        {!currentData && loadingForCurrentView && (
          <div className="flex items-center justify-center py-24">
            <div className="text-center max-w-md">
              <Loader2 className="w-8 h-8 text-violet-400/70 mx-auto mb-3 animate-spin" />
              <div className="text-sm font-semibold text-foreground/80">Analyse läuft…</div>
              <div className="text-[11px] text-foreground/50 mt-1.5 leading-relaxed">
                Echte Makro-Daten + LLM-Synthese (~25–60s)
              </div>
            </div>
          </div>
        )}

        <div className={loadingForCurrentView && currentData ? "relative opacity-60 transition-opacity" : "relative"}>
          {currentData && activeTab === "macro" && <MacroPanel data={currentData} />}
          {activeTab === "sectors" && <SectorsPanel data={currentData} region={region} />}
          {currentData && activeTab === "screener" && <ScreenerPanel data={currentData} region={region} />}
          {currentData && activeTab === "capex" && <CapexPanel data={currentData} region={region} />}
          {loadingForCurrentView && currentData && (
            <div className="absolute top-0 left-0 right-0 flex justify-center pointer-events-none">
              <div className="bg-card/95 border border-border rounded-full shadow-lg px-3 py-1 text-[11px] flex items-center gap-2 pointer-events-auto mt-2">
                <Loader2 className="w-3 h-3 animate-spin text-violet-400" />
                <span>Aktualisiere…</span>
              </div>
            </div>
          )}
        </div>
      </main>

      {briefingOpen && (
        <BriefingModal
          loading={briefingLoading}
          data={briefingData}
          error={briefingError}
          onClose={() => setBriefingOpen(false)}
          onRetry={() => runBriefing(false)}
          onForceRefresh={() => runBriefing(true)}
        />
      )}
    </div>
  );
}

function BriefingModal({ loading, data, error, onClose, onRetry, onForceRefresh }: {
  loading: boolean;
  data: any;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onForceRefresh: () => void;
}) {
  const briefing = data?.briefing;
  const diag = data?.diagnostics;
  const isCached = !!data?._cached;
  const cacheAge = data?._cacheAgeMin;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-3xl bg-card border border-border/50 rounded-lg shadow-2xl">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-gradient-to-r from-amber-500/10 to-orange-500/5">
          <Flame className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-foreground/95">Pre-Market Briefing</h2>
          {isCached && data && !loading ? (
            <span className="text-[10px] text-emerald-400/80 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-400/20">
              ✓ {cacheAge != null ? `vor ${cacheAge < 60 ? cacheAge + 'min' : Math.round(cacheAge / 60) + 'h'}` : 'gecacht'}
            </span>
          ) : (
            <span className="text-[10px] text-foreground/50">Macro-Lage US + EU + ASIA</span>
          )}
          {data && !loading && (
            <button
              onClick={onForceRefresh}
              className="text-[10px] text-foreground/50 hover:text-foreground px-1.5 py-0.5 rounded border border-border/40 hover:border-border/60 flex items-center gap-1"
              title="Briefing neu generieren"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Refresh
            </button>
          )}
          <button onClick={onClose} className="ml-auto text-foreground/40 hover:text-foreground/80 text-lg leading-none">×</button>
        </div>

        <div className="p-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 py-12 justify-center text-foreground/60 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Briefing wird erstellt…</span>
            </div>
          )}

          {error && !loading && (
            <div className="rounded border border-red-500/30 bg-red-500/5 p-3 text-[11px] text-red-300">
              <div className="font-medium mb-1">Fehler beim Erstellen des Briefings</div>
              <div className="text-red-300/80">{error}</div>
              <button onClick={onRetry} className="mt-2 text-[10px] px-2 py-1 rounded bg-red-500/15 hover:bg-red-500/25 border border-red-400/30">Erneut versuchen</button>
            </div>
          )}

          {briefing && !loading && (
            <>
              <div className="rounded-lg bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.04] border border-amber-500/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-amber-400/70 mb-1">Headline</div>
                <div className="text-sm font-semibold text-foreground">{briefing.headline}</div>
                <p className="text-[12px] text-foreground/80 leading-relaxed mt-2">{briefing.summary}</p>
              </div>

              {Array.isArray(briefing.topChanges) && briefing.topChanges.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-2">Top Changes</div>
                  <div className="space-y-2">
                    {briefing.topChanges.map((c: any) => (
                      <BriefingChangeCard key={c.rank} change={c} />
                    ))}
                  </div>
                </div>
              )}

              {briefing.keyMetricsShift && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <MetricShift label="Inflation" value={briefing.keyMetricsShift.inflationView} />
                  <MetricShift label="Zinsen / 10Y" value={briefing.keyMetricsShift.rateView} />
                  <MetricShift label="Equities" value={briefing.keyMetricsShift.equityView} />
                </div>
              )}

              {briefing.recommendation && (
                <div className="rounded border border-violet-400/30 bg-violet-500/[0.06] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-violet-300/80 mb-1">Pre-Market Action</div>
                  <p className="text-[12px] text-foreground/85 leading-relaxed">{briefing.recommendation}</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-emerald-400",
};

function BriefingChangeCard({ change }: { change: any }) {
  const dcf = change.dcfImplications || {};
  const tickers = Array.isArray(change.affectedTickers) ? change.affectedTickers : [];
  const actionText = change.action || change.dcfImplication || "";
  return (
    <div className="rounded border border-border/40 bg-background/40 p-3">
      <div className="flex items-start gap-2">
        <div className="text-[10px] font-mono text-foreground/40 mt-0.5">#{change.rank}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-[12px] font-semibold text-foreground">{change.title}</span>
            {change.region && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/[0.08] text-foreground/60 border border-border/30">{change.region}</span>
            )}
          </div>
          <p className="text-[11px] text-foreground/75 leading-relaxed mb-2">{change.description}</p>
          {tickers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1 items-center">
              {tickers.slice(0, 8).map((t: string, i: number) => (
                <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-500/10 text-[10px] font-mono text-violet-300/90 border border-violet-400/20">
                  {t}
                  <TickerAddButtons ticker={t} source="researcher" region={change.region} compact />
                </span>
              ))}
              <button
                type="button"
                className="text-[9px] px-1.5 py-0.5 rounded border border-border/40 text-foreground/60 hover:bg-muted/40"
                onClick={() => {
                  const r = bulkAddToWatchlist(tickers.slice(0, 12).map((t: string) => ({ ticker: t })), "researcher", change.region);
                  window.alert(`Watchlist: ${r.added} neu, ${r.skipped} übersprungen`);
                }}
              >
                Alle → Watchlist
              </button>
            </div>
          )}
          {actionText && (
            <div className="mt-2 text-[11px] text-foreground/85 italic border-l-2 border-violet-400/40 pl-2">{actionText}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricShift({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-background/40 border border-border/30 p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-foreground/40 mb-1">{label}</div>
      <p className="text-[11px] text-foreground/80 leading-relaxed">{value}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="text-center max-w-md">
        <Sparkles className="w-10 h-10 text-violet-400/40 mx-auto mb-3" />
        <div className="text-sm font-semibold text-foreground/80">Keine Analyse aktiv</div>
        <div className="text-[11px] text-foreground/50 mt-1.5 leading-relaxed">
          Wähle eine Region oben und drücke "Analyse starten". Echte Makro-Daten + LLM-Synthese (Claude 3.5 Haiku). Ergebnisse werden 7 Tage gecacht (0 Credits bei Wiederaufruf).
        </div>
      </div>
    </div>
  );
}
