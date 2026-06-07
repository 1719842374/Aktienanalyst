import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import {
  ArrowLeft, Globe2, TrendingUp, Search, Landmark, RefreshCw,
  Loader2, ShieldCheck, AlertTriangle, Sparkles, ChevronRight,
  Zap, ArrowUp, ArrowDown, Minus, Flame, Activity
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
        // Likely proxy timeout; result is in cache—retry once (without force, hit cache)
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
      // For screener, default-filters; user can extend later
      if (tab === "screener") {
        body.marketCapMin = 1000;     // $1B+
        body.marketCapMax = 500000;   // $500B max (skip megacaps)
        body.peMax = 30;
        body.revenueGrowthMin = 5;
      }
      // Chat-First: single request, backend returns full result directly (no polling).
      // Retry only on network-level errors (not on rate-limit or auth errors).
      const MAX_RETRIES = 3;
      let lastErr: any = null;

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
          body.force = false;
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      throw lastErr || new Error("Analyse fehlgeschlagen. Bitte erneut versuchen.");
    },
    onSuccess: (result, variables) => {
      // Use the region captured at mutate-time, not current state — the user
      // may have switched regions while the request was in flight. Without this,
      // a slow US response could overwrite the EU cache key.
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
  // The user might switch tabs/regions WHILE a mutation is running. We only
  // want to show a spinner on the tab+region whose analysis is actually loading
  // — not draw a misleading spinner on a different view the user has navigated
  // to. Also lets us keep showing cached data on the *new* view immediately.
  const loadingForCurrentView = isLoading
    && mutation.variables?.tab === activeTab
    && mutation.variables?.region === region;

  // Stale cache detection — a cached result that has no real LLM content.
  // _staleRefreshing = backend is already refreshing in background (show info, not warning)
  const isStaleRefreshing = !!currentData?._staleRefreshing;
  const isStale = !!currentData && !isStaleRefreshing && (
    currentData._fallback === true ||
    currentData?.llmSynthesis?._fallback === true ||
    currentData?.modelUsed === "fallback" ||
    (Array.isArray(currentData.trends) && currentData.trends.length === 0) ||
    (Array.isArray(currentData.candidates) && currentData.candidates.length === 0) ||
    (Array.isArray(currentData.programmes) && currentData.programmes.length === 0)
  );

  return (
    <div className="h-screen overflow-y-auto bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/80 backdrop-blur sticky top-0 z-20">
        {/* Mobile-friendly two-row header on <sm */}
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2 sm:py-3">
          {/* Row 1: Back-link + title + Briefing button */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/" className="flex items-center gap-1.5 text-foreground/60 hover:text-foreground text-sm transition-colors shrink-0">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </Link>
            <div className="flex-1 flex items-center gap-1.5 sm:gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
              <h1 className="text-sm font-semibold tracking-tight">Researcher</h1>
              <span className="text-[10px] text-foreground/40 hidden md:inline truncate">Hedge-Fund-Style Macro &amp; Stock Discovery</span>
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
            {/* Region selector — desktop inline */}
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
          {/* Row 2 (mobile only): full-width region selector */}
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

        {/* Tab content — keep showing currentData even while a refresh is in flight,
            so the user never sees a blank panel mid-mutation. */}
        {!currentData && !loadingForCurrentView && !error && (
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
          {currentData && activeTab === "sectors" && <SectorsPanel data={currentData} />}
          {currentData && activeTab === "screener" && <ScreenerPanel data={currentData} />}
          {currentData && activeTab === "capex" && <CapexPanel data={currentData} />}
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

      {/* Daily Briefing Modal */}
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

// ============================================================
// Daily Briefing Modal
// ============================================================

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
  const cachedAt = data?._cachedAt ? new Date(data._cachedAt) : null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-3xl bg-card border border-border/50 rounded-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-gradient-to-r from-amber-500/10 to-orange-500/5">
          <Flame className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-foreground/95">Pre-Market Briefing</h2>
          {isCached && data && !loading ? (
            <span className="text-[10px] text-emerald-400/80 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-400/20">
              ✓ {cacheAge != null ? `vor ${cacheAge < 60 ? cacheAge + 'min' : Math.round(cacheAge / 60) + 'h'}` : 'gecacht'}
              {data?.diagnostics?.netNewEvents > 0
                ? ` · ${data.diagnostics.netNewEvents} neue Events`
                : data?.diagnostics?.eventsScanned > 0
                ? ` · ${data.diagnostics.eventsScanned} Events stabil`
                : ''}
            </span>
          ) : (
            <span className="text-[10px] text-foreground/50">Macro-Lage US + EU + ASIA</span>
          )}
          {data && !loading && (
            <button
              onClick={onForceRefresh}
              className="text-[10px] text-foreground/50 hover:text-foreground px-1.5 py-0.5 rounded border border-border/40 hover:border-border/60 flex items-center gap-1"
              title="Briefing neu generieren (kostet 1× LLM-Run)"
              data-testid="button-refresh-briefing"
            >
              <RefreshCw className="w-2.5 h-2.5" />
              Refresh
            </button>
          )}
          <button onClick={onClose} className="ml-auto text-foreground/40 hover:text-foreground/80 text-lg leading-none" data-testid="button-close-briefing">×</button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 py-12 justify-center text-foreground/60 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Briefing wird erstellt — Ö Macro für US/EU/ASIA, Diff vs. gestern, DCF-Implikationen … (~25–60s)</span>
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
              {/* Headline */}
              <div className="rounded-lg bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.04] border border-amber-500/30 p-3">
                <div className="text-[10px] uppercase tracking-wider text-amber-400/70 mb-1">Headline</div>
                <div className="text-sm font-semibold text-foreground">{briefing.headline}</div>
                <p className="text-[12px] text-foreground/80 leading-relaxed mt-2">{briefing.summary}</p>
              </div>

              {/* Top Changes */}
              {Array.isArray(briefing.topChanges) && briefing.topChanges.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-2">Top {briefing.topChanges.length} Changes &mdash; DCF Implications</div>
                  <div className="space-y-2">
                    {briefing.topChanges.map((c: any) => (
                      <BriefingChangeCard key={c.rank} change={c} />
                    ))}
                  </div>
                </div>
              )}

              {/* Metrics shift */}
              {briefing.keyMetricsShift && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <MetricShift label="Inflation" value={briefing.keyMetricsShift.inflationView} />
                  <MetricShift label="Zinsen / 10Y" value={briefing.keyMetricsShift.rateView} />
                  <MetricShift label="Equities" value={briefing.keyMetricsShift.equityView} />
                </div>
              )}

              {/* Recommendation */}
              {briefing.recommendation && (
                <div className="rounded border border-violet-400/30 bg-violet-500/[0.06] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-violet-300/80 mb-1">Pre-Market Action</div>
                  <p className="text-[12px] text-foreground/85 leading-relaxed">{briefing.recommendation}</p>
                </div>
              )}

              {/* Diagnostics */}
              {diag && (
                <div className="text-[10px] text-foreground/40 pt-2 border-t border-border/20">
                  {diag.eventsScanned > 0 ? (
                    <>
                      {diag.eventsScanned} Events analysiert &middot;{' '}
                      {diag.netNewEvents > 0
                        ? <span className="text-amber-400">{diag.netNewEvents} neue/geänderte Events</span>
                        : <span className="text-emerald-400/70">Keine materiellen Änderungen</span>
                      }{' '}
                      &middot; Regionen: {Array.isArray(diag.regionsAnalyzed) ? diag.regionsAnalyzed.join(", ") : "—"}
                      {data?.modelUsed && data.modelUsed !== 'fallback' && <> &middot; {data.modelUsed.split('/').pop()}</>}
                    </>
                  ) : (
                    <span className="text-amber-400/70">Macro-Daten werden geladen — bitte erneut öffnen</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BriefingChangeCard({ change }: { change: any }) {
  const dcf = change.dcfImplications || {};
  const exposureColors: Record<string, string> = {
    long: "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
    short: "bg-red-500/15 text-red-300 border-red-400/30",
    hedge: "bg-blue-500/15 text-blue-300 border-blue-400/30",
    reduce: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  };
  const changeColors: Record<string, string> = {
    NEW: "bg-violet-500/15 text-violet-300 border-violet-400/30",
    ESCALATED: "bg-red-500/15 text-red-300 border-red-400/30",
    DIRECTION_FLIP: "bg-amber-500/15 text-amber-300 border-amber-400/30",
  };
  // Fallback handling for the alternative topChanges shape (no-netNew / LLM-failure
  // branches) which use `category`/`impact`/`dcfImplication` singular instead of
  // `changeType`/`dcfImplications.{…}`.
  const affectedSectors = Array.isArray(dcf.affectedSectors) && dcf.affectedSectors.length > 0
    ? dcf.affectedSectors
    : Array.isArray(change.affectedTickers) ? change.affectedTickers : [];
  const tickers = Array.isArray(change.affectedTickers) ? change.affectedTickers : [];
  const hasWacc = !!dcf.waccDeltaBps;
  const hasDcfInfo = hasWacc || !!dcf.exposureType || affectedSectors.length > 0;
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
            {change.changeType ? (
              <span className={`text-[9px] px-1.5 py-0.5 rounded border ${changeColors[change.changeType] || ""}`}>{change.changeType}</span>
            ) : change.category ? (
              <span className="text-[9px] px-1.5 py-0.5 rounded border bg-foreground/[0.06] text-foreground/65 border-border/30">{change.category}</span>
            ) : null}
            {change.severity && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded border ${SEVERITY_DOT[change.severity] || ""} bg-opacity-30`}>{change.severity}</span>
            )}
          </div>
          <p className="text-[11px] text-foreground/75 leading-relaxed mb-2">{change.description}</p>
          {hasDcfInfo && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
              {hasWacc && (
                <span><span className="text-foreground/40">WACC:</span> <span className="font-mono font-medium text-foreground/90">{dcf.waccDeltaBps}</span></span>
              )}
              {dcf.exposureType && (
                <span className={`px-1.5 py-0.5 rounded border ${exposureColors[dcf.exposureType] || ""}`}>{dcf.exposureType}</span>
              )}
              {affectedSectors.length > 0 && (
                <span className="text-foreground/60">{affectedSectors.slice(0, 4).join(" · ")}</span>
              )}
            </div>
          )}
          {tickers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tickers.slice(0, 8).map((t: string, i: number) => (
                <span key={i} className="px-1.5 py-0.5 rounded bg-violet-500/10 text-[10px] font-mono text-violet-300/90 border border-violet-400/20">{t}</span>
              ))}
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
          Wähle eine Region oben und drücke "Analyse starten". Echte Makro-Daten + LLM-Synthese (Claude 3.5 Haiku). Ergebnisse werden 7 Tage gecacht (0 Credits bei Wiederaufruf).
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
          {/* anchor for unused prefix — keeps key drivers below */}
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

      {/* Key Events & Geopolitik — autonom erkannt */}
      {llm && Array.isArray(llm.keyEvents) && llm.keyEvents.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.04] to-orange-500/[0.02] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            <h2 className="text-xs font-semibold text-foreground/90">Aktuelle Key Events &amp; Geopolitik</h2>
            <span className="text-[10px] text-foreground/40">({llm.keyEvents.length} Events autonom erkannt)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {llm.keyEvents.map((ev: any, i: number) => (
              <KeyEventCard key={i} ev={ev} />
            ))}
          </div>
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

const CATEGORY_BADGES: Record<string, string> = {
  "Geopolitik": "bg-red-500/15 text-red-300 border-red-400/30",
  "Geldpolitik": "bg-blue-500/15 text-blue-300 border-blue-400/30",
  "Fiskalpolitik": "bg-indigo-500/15 text-indigo-300 border-indigo-400/30",
  "Konjunktur": "bg-teal-500/15 text-teal-300 border-teal-400/30",
  "Zentralbank": "bg-blue-500/15 text-blue-300 border-blue-400/30",
  "Wahl/Politik": "bg-purple-500/15 text-purple-300 border-purple-400/30",
  "Lieferkette": "bg-orange-500/15 text-orange-300 border-orange-400/30",
  "Energie/Rohstoffe": "bg-amber-500/15 text-amber-300 border-amber-400/30",
  "Naturkatastrophe": "bg-emerald-500/15 text-emerald-300 border-emerald-400/30",
  "Tech/Regulierung": "bg-cyan-500/15 text-cyan-300 border-cyan-400/30",
  "Sonstiges": "bg-foreground/10 text-foreground/60 border-border/40",
};

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-emerald-400",
};

function ImpactBadge({ label, value }: { label: string; value: string }) {
  const safe = value ?? "neutral";
  const isUp = /steigend|positiv/i.test(safe);
  const isDown = /fallend|negativ/i.test(safe);
  const isMixed = /gemischt/i.test(safe);
  // For inflation+rate: "steigend" = bearish for equity (red), "fallend" = bullish (green)
  // For equity: "positiv" = green, "negativ" = red
  const isEquity = label === "Aktien";
  let color = "text-foreground/50";
  let Icon = Minus;
  if (isEquity) {
    if (isUp) { color = "text-emerald-400"; Icon = ArrowUp; }
    else if (isDown) { color = "text-red-400"; Icon = ArrowDown; }
    else if (isMixed) { color = "text-amber-400"; Icon = Activity; }
  } else {
    if (isUp) { color = "text-red-300"; Icon = ArrowUp; }
    else if (isDown) { color = "text-emerald-300"; Icon = ArrowDown; }
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-[9px] uppercase tracking-wider text-foreground/40">{label}</span>
      <Icon className={`w-2.5 h-2.5 ${color}`} />
      <span className={`text-[10px] font-medium ${color}`}>{safe}</span>
    </div>
  );
}

function KeyEventCard({ ev }: { ev: any }) {
  const catClass = CATEGORY_BADGES[ev.category] || CATEGORY_BADGES.Sonstiges;
  const sevClass = SEVERITY_DOT[ev.severity] || "bg-foreground/30";
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-3 hover:bg-background/60 transition-colors">
      <div className="flex items-start gap-2 mb-2">
        <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${sevClass}`} title={`Severity: ${ev.severity}`} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-foreground/90 leading-tight">{ev.title}</div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <span className={`text-[9px] px-1.5 py-0.5 rounded border ${catClass}`}>{ev.category}</span>
            {ev.timeframe && <span className="text-[9px] text-foreground/50">· {ev.timeframe}</span>}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-foreground/75 leading-relaxed mb-2">{ev.description}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 pb-2 border-b border-border/20">
        <ImpactBadge label="Inflation" value={ev.inflationImpact} />
        <ImpactBadge label="Zinsen" value={ev.rateImpact} />
        <ImpactBadge label="Aktien" value={ev.equityImpact} />
      </div>
      {ev.rationale && (
        <p className="text-[10px] text-foreground/60 italic leading-relaxed mb-2">{ev.rationale}</p>
      )}
      {Array.isArray(ev.affectedSectors) && ev.affectedSectors.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {ev.affectedSectors.slice(0, 6).map((s: string, i: number) => (
            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-foreground/[0.06] text-foreground/65 border border-border/30">{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Tab 2: Sector Opportunity
// ============================================================

function SectorsPanel({ data }: { data: any }) {
  const trends: any[] = data.trends || [];
  const topPicks: string[] = data.topPicks || [];
  const sectorsStale = data?.modelUsed === "fallback" || trends.length === 0;
  return (
    <div className="space-y-4">
      {sectorsStale ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <div>
            <div className="text-[11px] font-semibold text-rose-200">KI nicht verfügbar — Daten veraltet</div>
            <div className="text-[10px] text-rose-300/80 mt-0.5">
              Keine Sector-Trends generiert. Bitte "Aktualisieren" oben klicken.
            </div>
          </div>
        </div>
      ) : data?._cached ? (
        <div className="text-[10px] text-emerald-400/70">
          Gecachte Analyse — vor {data._cacheAge < 60 ? `${data._cacheAge} Min` : `${Math.round(data._cacheAge / 60)} Std`} erstellt · 0 Credits
        </div>
      ) : null}
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
  const sectorExposure: any[] = Array.isArray(data.sectorExposure) ? data.sectorExposure : [];
  const isEmpty = programmes.length === 0 && !data.headline && !data.totalCapexEstimate;
  if (isEmpty) {
    return (
      <div className="text-center py-12 text-[11px] text-foreground/50">
        Keine Capex- oder Fiskalprogramme erfasst. Bitte „Aktualisieren" klicken.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {(data.headline || data.summary) && (
        <div className="rounded-lg border border-violet-400/30 bg-violet-500/[0.06] p-3">
          {data.headline && (
            <div className="text-sm font-semibold text-foreground/90">{data.headline}</div>
          )}
          {data.summary && (
            <p className="text-[11px] text-foreground/75 leading-relaxed mt-1.5">{data.summary}</p>
          )}
        </div>
      )}

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

      {sectorExposure.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-2">Sector Exposure ({sectorExposure.length})</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {sectorExposure.map((s: any, idx: number) => {
              const impact = String(s.impact || "neutral").toLowerCase();
              const impactClass = impact === "positiv"
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
                : impact === "negativ"
                ? "bg-rose-500/15 text-rose-300 border-rose-400/30"
                : "bg-foreground/10 text-foreground/60 border-border/40";
              return (
                <div key={idx} className="rounded-lg border border-border/40 bg-card/30 p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="text-xs font-semibold text-foreground/90">{s.sector}</div>
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${impactClass}`}>{s.impact}</span>
                  </div>
                  {s.timeline && (
                    <div className="text-[10px] text-foreground/50 mb-1.5">{s.timeline}</div>
                  )}
                  {s.reasoning && (
                    <p className="text-[11px] text-foreground/75 leading-relaxed">{s.reasoning}</p>
                  )}
                  {Array.isArray(s.programmes) && s.programmes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {s.programmes.map((p: string, i: number) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-violet-500/10 text-[10px] text-violet-300/90">{p}</span>
                      ))}
                    </div>
                  )}
                  {Array.isArray(s.listedBeneficiaries) && s.listedBeneficiaries.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/20">
                      <div className="text-[10px] font-medium text-muted-foreground mb-1.5">
                        📈 Börsennotierte Profiteure
                      </div>
                      <div className="space-y-1">
                        {s.listedBeneficiaries.map((b: any) => (
                          <div key={b.ticker} className="flex items-start gap-2 text-[10px]">
                            <span className="font-mono font-bold text-primary shrink-0 w-14">{b.ticker}</span>
                            <span className="text-muted-foreground">
                              {b.name && <span className="text-foreground/80 font-medium">{b.name}</span>}
                              {b.name && b.rationale && <span className="text-foreground/40"> · </span>}
                              {b.rationale}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
            {/* listedBeneficiaries (new format: [{ticker, name, rationale}]) */}
            {Array.isArray(p.listedBeneficiaries) && p.listedBeneficiaries.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/20">
                <div className="text-[9px] uppercase text-foreground/40 mb-1">📈 Börsennotierte Profiteure</div>
                <div className="space-y-1">
                  {p.listedBeneficiaries.map((b: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="font-mono font-bold text-primary shrink-0 min-w-[56px]">{b.ticker}</span>
                      <span className="text-muted-foreground">
                        {b.name && <span className="text-foreground/80 font-medium">{b.name}</span>}
                        {b.name && b.rationale && <span className="text-foreground/40"> · </span>}
                        {b.rationale}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Legacy beneficiaries (string array) */}
            {!p.listedBeneficiaries?.length && p.beneficiaries?.length > 0 && (
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
