import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { StockAnalysis } from "../../../shared/schema";
import { gbmMonteCarlo, calculateGBMParams, type GBMMonteCarloResult } from "@/lib/calculations";
import { TickerSearch } from "@/components/TickerSearch";
import { useTheme } from "@/components/ThemeProvider";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { Section1 } from "@/components/sections/Section1";
import { Section2 } from "@/components/sections/Section2";
import { FinancialStatements } from "@/components/sections/FinancialStatements";
import { Section3 } from "@/components/sections/Section3";
import { Section4 } from "@/components/sections/Section4";
import { Section5 } from "@/components/sections/Section5";
import { Section6 } from "@/components/sections/Section6";
import { Section7 } from "@/components/sections/Section7";
import { Section8 } from "@/components/sections/Section8";
import { Section9 } from "@/components/sections/Section9";
import { ReverseDCFSection } from "@/components/sections/ReverseDCFSection";
import { CatalystsSection } from "@/components/sections/CatalystsSection";
import { MonteCarloSection } from "@/components/sections/MonteCarloSection";
import { SummarySection } from "@/components/sections/SummarySection";
import { TechnicalChart } from "@/components/sections/TechnicalChart";
import { MoatPorterSection } from "@/components/sections/MoatPorterSection";
import { PestelSection } from "@/components/sections/PestelSection";
import { MacroCorrelationsSection } from "@/components/sections/MacroCorrelationsSection";
import {
  Sun, Moon, BarChart3, TrendingUp, Shield, Calculator,
  LineChart, Target, Scale, AlertTriangle, Activity,
  RotateCcw, Zap, Dice6, Table2, Menu, X, ChevronRight, Landmark, Globe, Bitcoin, Search, Star, Sparkles,
} from "lucide-react";
import { useLocation } from "wouter";

const SECTIONS = [
  { id: 1, label: "Datenaktualität", icon: BarChart3 },
  { id: 2, label: "Investmentthese", icon: TrendingUp },
  { id: 3, label: "Zyklusanalyse", icon: Activity },
  { id: 4, label: "Bewertung", icon: Calculator },
  { id: 5, label: "DCF-Modell", icon: LineChart },
  { id: 6, label: "CRV", icon: Target },
  { id: 7, label: "Rel. Bewertung", icon: Scale },
  { id: 8, label: "Risikoinversion", icon: AlertTriangle },
  { id: 9, label: "RSL-Momentum", icon: Activity },
  { id: 10, label: "Tech. Analyse", icon: LineChart },
  { id: 11, label: "Moat / Porter", icon: Landmark },
  { id: 12, label: "PESTEL", icon: Globe },
  { id: 13, label: "Makro-Korr.", icon: BarChart3 },
  { id: 14, label: "Reverse DCF", icon: RotateCcw },
  { id: 15, label: "Katalysatoren", icon: Zap },
  { id: 16, label: "Monte Carlo", icon: Dice6 },
  { id: 17, label: "Zusammenfassung", icon: Table2 },
];

export default function Dashboard() {
  const { theme, toggleTheme } = useTheme();
  const [data, setData] = useState<StockAnalysis | null>(null);
  // Canonical Monte Carlo run — computed once and shared by Section16 (display)
  // and Section17 (summary) so both show identical figures instead of two
  // independent random runs with divergent probabilities.
  const sharedMonteCarlo = useMemo<GBMMonteCarloResult | null>(() => {
    if (!data || !data.historicalPrices?.length) return null;
    const prices = data.historicalPrices.map(p => p.close);
    const params = calculateGBMParams(prices);
    return gbmMonteCarlo({
      currentPrice: data.currentPrice,
      mu: params.mu,
      sigma: params.sigma,
      iterations: 10000,
      tradingDays: 252,
    }, data.analystPT.median);
  }, [data]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [useLLM, setUseLLM] = useState(false);
  const [currentTicker, setCurrentTicker] = useState('');
  const [, navigate] = useLocation();
  const mainRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxRetries: number } | null>(null);
  const [serverReady, setServerReady] = useState<boolean | null>(null); // null=checking, true=ready, false=down

  const [financeQuotaOk, setFinanceQuotaOk] = useState<boolean | null>(null);

  // Cold-Start Warmup Strategy:
  // Published *.pplx.app containers shut down after inactivity and need 15-30s to restart.
  // We fire /api/health immediately on page load to wake the sandbox as early as possible.
  // Retries every 4s up to 4x (covers 16s warmup window).
  // On success, also check /api/cache to confirm the finance connector is token-refreshed.
  useEffect(() => {
    let cancelled = false;

    const ping = async (attempt = 1) => {
      try {
        const res = await apiRequest("GET", "/api/health", undefined, 25000);
        if (!cancelled && (res.ok || res.status === 503)) {
          setServerReady(true);
          // Fire a second lightweight request to ensure the finance connector
          // token gets refreshed (the proxy injects it on every frontend request)
          apiRequest("GET", "/api/cache", undefined, 10000).catch(() => {});
          setFinanceQuotaOk(true);
        }
      } catch {
        if (!cancelled && attempt < 5) {
          // Exponential-ish backoff: 3s, 5s, 8s, 12s — covers up to ~28s cold start
          const delays = [3000, 5000, 8000, 12000];
          setTimeout(() => ping(attempt + 1), delays[attempt - 1] ?? 12000);
        } else if (!cancelled) {
          setServerReady(false);
        }
      }
    };

    ping();
    return () => { cancelled = true; };
  }, []);

  // Stale-response guard: every mutate() bumps requestIdRef. onSuccess only
  // applies the result if its captured request id matches the current one,
  // so a fast user (rapid ticker clicks, KI-toggle while in-flight) never
  // sees an out-of-order older response overwrite a newer one.
  const requestIdRef = useRef(0);
  // Mirror of `data` to avoid stale closures inside onSuccess (scroll-suppress
  // logic was previously reading captured-at-render state).
  const dataRef = useRef<StockAnalysis | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  // Refs for values used inside callbacks to avoid stale closures
  // (currentTicker and useLLM can change between renders, callbacks capture old values)
  const currentTickerRef = useRef(currentTicker);
  useEffect(() => { currentTickerRef.current = currentTicker; }, [currentTicker]);
  const useLLMRef = useRef(useLLM);
  useEffect(() => { useLLMRef.current = useLLM; }, [useLLM]);

  // Tagged mutate: assigns a fresh reqId on every kick-off so onSuccess can
  // reject stale responses. Use this everywhere instead of mutation.mutate().
  const startAnalyze = useCallback((args: { ticker: string; llm: boolean; force?: boolean }) => {
    requestIdRef.current += 1;
    const reqId = requestIdRef.current;
    analyzeMutationRef.current.mutate({ ...args, reqId });
  }, []);
  // Forward-decl ref so startAnalyze can reference the mutation before it's declared
  const analyzeMutationRef = useRef<any>(null);

  const analyzeMutation = useMutation({
    mutationFn: async ({ ticker, llm, force }: { ticker: string; llm: boolean; force?: boolean; reqId?: number }) => {
      const maxRetries = 5;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          setRetryInfo({ attempt, maxRetries });
          // On last attempt: always use force=false to hit cache if available
          // This prevents blank screen when server is warming up but cache has data
          const useForce = attempt < maxRetries ? (force === true) : false;
          const res = await apiRequest("POST", "/api/analyze", { ticker, useLLM: llm, force: useForce });
          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            const errMsg = errJson?.error || errJson?.message || `HTTP ${res.status}`;
            // 429 / RATE_LIMITED: surface immediately, no retries
            if (res.status === 429 || errJson?.errorCode === 'RATE_LIMITED') {
              console.warn(`[Analyze] Rate-limit erkannt — keine Retries`);
              setRetryInfo(null);
              setData(null);
              setFinanceQuotaOk(false);
              throw Object.assign(new Error(errMsg), { errorCode: 'RATE_LIMITED' });
            }
            throw new Error(errMsg);
          }
          const json = await res.json();
          // Surface RATE_LIMITED from a 200 response body too
          if (json?.errorCode === 'RATE_LIMITED') {
            setRetryInfo(null);
            setData(null);
            setFinanceQuotaOk(false);
            throw Object.assign(new Error(json.error || 'RATE_LIMITED'), { errorCode: 'RATE_LIMITED' });
          }
          // Guard: if JSON has errorCode despite HTTP 200, handle it
          if (json?.errorCode) {
            const ec = json.errorCode;
            if (ec === 'RATE_LIMITED') {
              setRetryInfo(null);
              setData(null);
              setFinanceQuotaOk(false);
              throw Object.assign(new Error(json.error || 'RATE_LIMITED'), { errorCode: 'RATE_LIMITED' });
            }
            // Other error codes (BINARY_MISSING, TIMEOUT etc.): treat as transient, retry
            throw new Error(json.error || `API error: ${ec}`);
          }
          // Guard: result must have currentPrice to be a valid analysis
          if (!json?.currentPrice && !json?.companyName) {
            throw new Error('Ungültige Antwort vom Server — erneut versuchen');
          }
          const result = json as StockAnalysis;
          setRetryInfo(null);
          return result;
        } catch (err: any) {
          lastError = err;
          const msg = err?.message || "";
          // RATE_LIMITED already handled above — re-throw immediately
          if (err?.errorCode === 'RATE_LIMITED' || msg.includes("RATE_LIMITED") || msg.includes("Tagesquota")) {
            throw err;
          }
          console.warn(`[Analyze] Versuch ${attempt}/${maxRetries} fehlgeschlagen: ${msg.substring(0, 100)}`);
          if (attempt < maxRetries) {
            // Cold-start backoff: 3s, 6s, 10s, 15s
            const backoffs = [3000, 6000, 10000, 15000];
            await new Promise(r => setTimeout(r, backoffs[attempt - 1] ?? 15000));
          }
        }
      }
      setRetryInfo(null);
      throw lastError || new Error('Analyse fehlgeschlagen nach 5 Versuchen');
    },
    onSuccess: (result, variables: any) => {
      // Stale guard: if the user kicked off another request after this one,
      // ignore this older response. Without this, a fast click sequence
      // (HCC -> AAPL -> NVDA) could let HCC's response arrive last and
      // overwrite the NVDA view. Same applies to KI-toggle races.
      if (variables?.reqId !== undefined && variables.reqId !== requestIdRef.current) {
        console.log(`[Analyze] Ignoring stale response (reqId ${variables.reqId} ≠ current ${requestIdRef.current})`);
        return;
      }
      setData(result);
      setFinanceQuotaOk(true); // Clear any quota warning on success
      const prev = dataRef.current;
      if (!result.llmMode || !prev || prev.companyName !== result.companyName) {
        mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    onError: (err: any, variables: any) => {
      // Stale-guard: ignore errors from superseded requests
      if (variables?.reqId !== undefined && variables.reqId !== requestIdRef.current) {
        console.log(`[Analyze] Ignoring stale error (reqId ${variables.reqId} ≠ current ${requestIdRef.current})`);
        return;
      }
      // If we already have data from a previous analysis, keep showing it.
      // Only clear data for RATE_LIMITED (needs explicit empty state for quota warning UI).
      // For all other errors: old data > blank screen.
      const ec = (err as any)?.errorCode;
      if (ec !== 'RATE_LIMITED' && dataRef.current) {
        console.log('[Analyze] Error but keeping previous data visible');
        // Reset mutation state so the overlay disappears — keep old data
        // We do this by calling reset() which clears isError/isPending
        // Note: React Query v5 exposes analyzeMutation.reset() but we can't call it here
        // directly. Instead we set retryInfo=null — the overlay only shows when isPending.
        setRetryInfo(null);
        // The isError state will naturally clear on next mutate() call.
        // For now, the overlay disappears (no longer isPending) and old data shows.
      }
    },
  });

  // Wire the mutation to its ref so startAnalyze() can call it.
  // Must come AFTER useMutation since mutation isn't defined yet at the
  // useRef declaration site.
  analyzeMutationRef.current = analyzeMutation;

  const scrollToSection = useCallback((id: number) => {
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setSidebarOpen(false);
  }, []);

  const setSectionRef = useCallback((id: number) => (el: HTMLDivElement | null) => {
    sectionRefs.current[id] = el;
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 h-12 border-b border-border bg-card flex items-center px-3 sm:px-4 z-20 gap-2">
        <div className="flex items-center gap-3 shrink-0">
          <button
            className="lg:hidden p-1.5 rounded-md hover:bg-muted/50"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            data-testid="button-sidebar-toggle"
          >
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          {/* Logo */}
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-label="Stock Analyst Pro logo">
              <rect x="2" y="2" width="20" height="20" rx="4" stroke="currentColor" strokeWidth="1.5" className="text-primary" />
              <path d="M6 16L10 10L14 13L18 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary" />
              <circle cx="18" cy="7" r="1.5" fill="currentColor" className="text-primary" />
            </svg>
            <span className="text-sm font-semibold tracking-tight hidden sm:block">Stock Analyst Pro</span>
          </div>
        </div>

        {/* Scrollable action-bar on mobile (invisible scrollbar via .scrollbar-hide)
            — fixes problem where Researcher/Compare buttons were clipped on <640px */}
        <div className="flex-1 flex items-center justify-end gap-2 sm:gap-3 overflow-x-auto scrollbar-hide ml-auto">
          {data && (
            <div className="hidden sm:flex items-center gap-2 text-xs">
              <span className="font-mono tabular-nums font-bold text-primary">{data.ticker}</span>
              <span className="text-muted-foreground">{data.companyName}</span>
              <span className="text-muted-foreground">•</span>
              <span className="font-mono tabular-nums font-semibold">${data.currentPrice.toFixed(2)}</span>
            </div>
          )}
          <TickerSearch
            onSearch={(ticker) => { setCurrentTicker(ticker); startAnalyze({ ticker, llm: useLLMRef.current }); }}
            isLoading={analyzeMutation.isPending}
          />
          {/* PDF Export */}
          {data && (
            <button
              onClick={async () => {
                const { exportAnalysisPdf } = await import('../lib/exportPdf');
                exportAnalysisPdf(data);
              }}
              className="h-8 px-2 text-[11px] font-medium rounded-md text-foreground/40 border border-border/50 hover:bg-muted/50 hover:text-foreground/60 transition-all flex items-center gap-1"
              title="Analyse als PDF exportieren"
              data-testid="button-pdf-export"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span className="hidden sm:inline">PDF</span>
            </button>
          )}
          {/* KI-Katalysatoren Toggle (kostet ~3-4 Credits pro Analyse) */}
          <button
            onClick={() => {
              const next = !useLLM;
              // No window.confirm() — native browser dialogs are unreliable in
              // the Perplexity Computer iframe (silently return false). The
              // tooltip + visible violet badge already make the cost obvious.
              setUseLLM(next);
              if (next && currentTicker) {
                startAnalyze({ ticker: currentTickerRef.current, llm: true });
              } else if (!next && currentTickerRef.current && data?.llmMode) {
                startAnalyze({ ticker: currentTickerRef.current, llm: false });
              }
            }}
            className={`h-8 px-2 text-[11px] font-medium rounded-md transition-all flex items-center gap-1 border shrink-0 ${
              useLLM
                ? 'bg-violet-500/15 text-violet-400 border-violet-500/30 hover:bg-violet-500/25'
                : 'text-foreground/40 border-border/50 hover:bg-muted/50 hover:text-foreground/60'
            }`}
            title={useLLM
              ? 'KI-Modus aktiv — Claude 3.5 Haiku via OpenRouter (7-Tage-Cache, geringe Kosten pro Analyse)'
              : 'KI aktivieren — erzeugt unternehmensspezifische Katalysatoren + News-Sentiment via Claude 3.5 Haiku. Cache-Hits sind gratis.'}
            data-testid="button-llm-toggle"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5v1h-4v-1c-1.2-.7-2-2-2-3.5a4 4 0 0 1 4-4z"/>
              <path d="M10 10.5v2.5h4v-2.5"/>
              <path d="M10 15h4"/>
              <path d="M11 15v2"/>
              <path d="M13 15v2"/>
            </svg>
            <span className="hidden sm:inline">KI</span>
            {useLLM && <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />}
          </button>
          <NavToBTC />
          <button
            onClick={() => navigate("/gold")}
            className="h-8 px-2.5 text-[11px] font-medium text-amber-500 hover:bg-amber-500/10 rounded-md transition-colors flex items-center gap-1.5 border border-amber-500/20 shrink-0"
          >
            <Scale className="w-3 h-3" />
            <span className="hidden sm:inline">Gold</span>
          </button>
          <button
            onClick={() => navigate("/screener")}
            className="h-8 px-2.5 text-[11px] font-medium text-cyan-500 hover:bg-cyan-500/10 rounded-md transition-colors flex items-center gap-1.5 border border-cyan-500/20 shrink-0"
          >
            <Search className="w-3 h-3" />
            <span className="hidden sm:inline">Screener</span>
          </button>
          <button
            onClick={() => navigate("/researcher")}
            className="h-8 px-2.5 text-[11px] font-medium text-violet-400 hover:bg-violet-500/10 rounded-md transition-colors flex items-center gap-1.5 border border-violet-400/30 shrink-0"
            title="Researcher — autonomous macro & sector discovery"
            data-testid="button-researcher"
          >
            <Sparkles className="w-3 h-3" />
            <span className="hidden sm:inline">Researcher</span>
          </button>
          <button
            onClick={() => navigate("/compare")}
            className="h-8 px-2.5 text-[11px] font-medium text-foreground/40 hover:bg-muted/50 hover:text-foreground/60 rounded-md transition-colors flex items-center gap-1 border border-border/50 shrink-0"
            title="Ticker-Vergleich"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            <span className="hidden sm:inline">VGL</span>
          </button>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors shrink-0"
            data-testid="button-theme-toggle"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`
            fixed lg:relative inset-y-0 left-0 top-12 lg:top-0 z-30 lg:z-0
            w-52 bg-card border-r border-border
            transition-transform duration-200 ease-in-out
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
            overflow-y-auto overscroll-contain custom-scrollbar
          `}
        >
          <nav className="py-2 px-2 space-y-0.5" data-testid="nav-sidebar">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollToSection(s.id)}
                disabled={!data}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-left group"
                data-testid={`nav-section-${s.id}`}
              >
                <s.icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
                <span className="flex-1 truncate">{s.label}</span>
                <span className="text-[10px] font-mono tabular-nums text-muted-foreground/50">{s.id}</span>
              </button>
            ))}
          </nav>

          <div className="px-3 py-3 border-t border-border mt-2">
            <PerplexityAttribution />
          </div>
        </aside>

        {/* Sidebar overlay on mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-20 lg:hidden top-12"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main Content */}
        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar"
          data-testid="main-content"
        >
          {analyzeMutation.isError && !data && !analyzeMutation.isPending &&
           (analyzeMutation.error as any)?.errorCode !== 'RATE_LIMITED' ? (
            <ErrorScreen error={analyzeMutation.error} />
          ) : !data && !analyzeMutation.isPending &&
            (!analyzeMutation.isError || (analyzeMutation.error as any)?.errorCode === 'RATE_LIMITED') ? (
            <WelcomeScreen
              onSearch={(ticker) => { setCurrentTicker(ticker); startAnalyze({ ticker, llm: useLLMRef.current }); }}
              serverReady={serverReady}
              financeQuotaOk={financeQuotaOk}
              onAnalyzeDone={(isRateLimited) => { if (isRateLimited) setFinanceQuotaOk(false); }}
            />
          ) : !data && analyzeMutation.isPending ? (
            // No previous data — show full loading screen
            <LoadingScreen ticker={analyzeMutation.variables?.ticker || currentTickerRef.current || ""} retryInfo={retryInfo} />
          ) : data ? (
            // data exists — show sections even while re-analyzing (optimistic: keep old content visible)
            <div className="relative max-w-5xl mx-auto p-3 sm:p-4 space-y-3">
              {/* Loading overlay when re-analyzing with existing data */}
              {analyzeMutation.isPending && (
                <div className="sticky top-0 z-30 -mx-3 sm:-mx-4 px-4 py-2 bg-background/90 backdrop-blur border-b border-border/50 flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="w-3 h-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  Analysiere {analyzeMutation.variables?.ticker || currentTickerRef.current}…
                  {retryInfo && <span className="text-amber-400">Versuch {retryInfo.attempt}/{retryInfo.maxRetries}</span>}
                </div>
              )}
              <div ref={setSectionRef(1)}><Section1 data={data} onRefresh={() => { if (currentTickerRef.current) startAnalyze({ ticker: currentTickerRef.current, llm: useLLMRef.current, force: true }); }} /></div>
              <div ref={setSectionRef(2)}><Section2 data={data} /></div>
              <FinancialStatements data={data} />
              <div ref={setSectionRef(3)}><Section3 data={data} /></div>
              <div ref={setSectionRef(4)}><Section4 data={data} /></div>
              <div ref={setSectionRef(5)}><Section5 data={data} /></div>
              <div ref={setSectionRef(6)}><Section6 data={data} /></div>
              <div ref={setSectionRef(7)}><Section7 data={data} /></div>
              <div ref={setSectionRef(8)}><Section8 data={data} useLLM={useLLM} /></div>
              <div ref={setSectionRef(9)}><Section9 data={data} /></div>
              <div ref={setSectionRef(10)}><TechnicalChart data={data} /></div>
              <div ref={setSectionRef(11)}><MoatPorterSection data={data} /></div>
              <div ref={setSectionRef(12)}><PestelSection data={data} /></div>
              <div ref={setSectionRef(13)}><MacroCorrelationsSection data={data} /></div>
              <div ref={setSectionRef(14)}><ReverseDCFSection data={data} /></div>
              <div ref={setSectionRef(15)}><CatalystsSection
                data={data}
                onCatalystsEnriched={(enriched) => {
                  // Persist enriched catalysts into Dashboard state so they
                  // survive tab switches and don't reset to generic on re-render
                  setData(prev => prev ? { ...prev, catalysts: enriched } : prev);
                }}
              /></div>
              <div ref={setSectionRef(16)}><MonteCarloSection data={data} sharedResult={sharedMonteCarlo} /></div>
              <div ref={setSectionRef(17)}><SummarySection data={data} sharedMonteCarlo={sharedMonteCarlo} /></div>
              <div className="pb-8" />
            </div>
          ) : (
            // Fallback: data=null + not pending + no error (stale guard race condition)
            // Always show WelcomeScreen instead of blank white screen
            <WelcomeScreen
              onSearch={(ticker) => { setCurrentTicker(ticker); startAnalyze({ ticker, llm: useLLMRef.current }); }}
              serverReady={serverReady}
              financeQuotaOk={financeQuotaOk}
              onAnalyzeDone={(isRateLimited) => { if (isRateLimited) setFinanceQuotaOk(false); }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function NavToBTC() {
  const [, setLocation] = useLocation();
  return (
    <button
      onClick={() => setLocation("/btc")}
      className="h-8 px-3 text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 rounded-md transition-colors flex items-center gap-1.5"
    >
      <Bitcoin className="w-3 h-3" />
      <span className="hidden sm:inline">BTC</span>
    </button>
  );
}

function WelcomeScreen({ onSearch, serverReady, financeQuotaOk, onAnalyzeDone }: {
  onSearch: (ticker: string) => void;
  serverReady?: boolean | null;
  financeQuotaOk?: boolean | null;
  onAnalyzeDone?: (isRateLimited: boolean) => void;
}) {
  const [, setLocation] = useLocation();
  const tickers = ["AAPL", "MSFT", "NVDA", "GOOGL", "TSLA", "AMZN"];

  // Fetch watchlist from server
  const watchlistQuery = useQuery({
    queryKey: ['/api/watchlist'],
    staleTime: 0,
  });
  const watchlist = (watchlistQuery.data as any)?.tickers || [];

  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-lg text-center space-y-6">
        {/* Server + Finance-API status indicators */}
        <div className="flex flex-col items-center gap-1">
          {/* Server status */}
          {serverReady === null && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 animate-pulse" />
              Server startet… (kann 15–30s dauern bei erstem Aufruf)
            </span>
          )}
          {serverReady === false && (
            <div className="text-[10px] text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-lg max-w-sm text-center">
              <div className="font-medium mb-0.5">Server kalt gestartet</div>
              <div className="text-muted-foreground/70">
                Veröffentlichte Apps werden nach Inaktivität heruntergefahren.
                Die erste Analyse startet den Server — bitte 20–30s warten.
              </div>
            </div>
          )}
          {serverReady === true && financeQuotaOk !== false && (
            <span className="flex items-center gap-1.5 text-[10px] text-emerald-500/70">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Bereit
            </span>
          )}
          {financeQuotaOk === false && (
            <div className="text-[10px] text-amber-500/90 bg-amber-500/10 border border-amber-500/20 px-3 py-2 rounded-lg max-w-sm text-center">
              <div className="font-medium mb-0.5">⏳ Finance-API Tageslimit erreicht</div>
              <div className="text-muted-foreground/70">
                Neue Analysen sind bis Mitternacht pausiert. Bereits analysierte Tickers in der
                Watchlist funktionieren weiterhin aus dem Cache.
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-center">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" className="text-primary opacity-60">
            <rect x="2" y="2" width="20" height="20" rx="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 16L10 10L14 13L18 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="18" cy="7" r="1.5" fill="currentColor" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-semibold">Stock Analyst Pro</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Comprehensive stock analysis with DCF modeling, Monte Carlo simulations,
            risk assessment, and 13 detailed analysis sections.
          </p>
        </div>

        {/* Watchlist (recent tickers) */}
        {watchlist.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2 flex items-center justify-center gap-1">
              <Star className="w-3 h-3 text-amber-400" /> Zuletzt analysiert:
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {watchlist.slice(0, 8).map((w: any) => (
                <button
                  key={w.ticker}
                  onClick={() => onSearch(w.ticker)}
                  className="group px-2.5 py-1.5 rounded-md bg-primary/5 hover:bg-primary/15 border border-primary/20 hover:border-primary/40 text-xs font-mono transition-all"
                >
                  <span className="font-bold text-primary">{w.ticker}</span>
                  {w.lastPrice ? <span className="text-foreground/40 ml-1.5">${w.lastPrice.toFixed(0)}</span> : null}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs text-muted-foreground mb-3">Try a ticker:</p>
          <div className="flex flex-wrap justify-center gap-2">
            {tickers.map((t) => (
              <button
                key={t}
                onClick={() => onSearch(t)}
                className="px-3 py-1.5 rounded-md bg-muted/50 hover:bg-primary/10 hover:text-primary border border-border text-xs font-mono tabular-nums font-medium transition-colors"
                data-testid={`button-quick-${t}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        {/* Dashboard Links */}
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground mb-2">Weitere Dashboards:</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => setLocation("/btc")}
              className="px-3 py-1.5 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-xs font-medium text-amber-500 transition-colors flex items-center gap-1.5"
            >
              <Bitcoin className="w-3 h-3" />
              BTC-Analyse
            </button>
            <button
              onClick={() => setLocation("/recession")}
              className="px-3 py-1.5 rounded-md bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 text-xs font-medium text-orange-600 dark:text-orange-400 transition-colors flex items-center gap-1.5"
            >
              <AlertTriangle className="w-3 h-3" />
              Rezessions-Dashboard
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-center text-[10px] text-muted-foreground/50">
          <ChevronRight className="w-3 h-3" />
          Enter any ticker symbol in the search bar above
        </div>
      </div>
    </div>
  );
}

function LoadingScreen({ ticker, retryInfo }: { ticker: string; retryInfo?: { attempt: number; maxRetries: number } | null }) {
  const isRetrying = retryInfo && retryInfo.attempt > 1;
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="text-center space-y-4">
        <div className={`w-8 h-8 border-2 ${isRetrying ? 'border-amber-400' : 'border-primary'} border-t-transparent rounded-full animate-spin mx-auto`} />
        <div>
          <div className="text-sm font-medium">
            {isRetrying ? `Retry ${retryInfo!.attempt}/${retryInfo!.maxRetries}` : `Analysiere ${ticker}...`}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {isRetrying
              ? `Verbindung fehlgeschlagen — neuer Versuch läuft...`
              : 'Umfassende Analyse wird erstellt'
            }
          </div>
          {retryInfo && (
            <div className="flex items-center justify-center gap-1.5 mt-3">
              {Array.from({ length: retryInfo.maxRetries }).map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i < retryInfo.attempt - 1 ? 'bg-red-400/60' : i === retryInfo.attempt - 1 ? 'bg-amber-400 animate-pulse' : 'bg-foreground/15'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorScreen({ error }: { error: Error }) {
  const isRateLimited = error.message.includes('RATE_LIMITED') || error.message.includes('Tagesquota') || error.message.includes('429');
  const is404 = !isRateLimited && (error.message.includes('404') || error.message.includes('Not Found') || error.message.includes('Failed to fetch') || error.message.includes('NetworkError'));
  const isTimeout = !isRateLimited && !is404 && (error.message.includes('timeout') || error.message.includes('Timeout'));

  // Estimate reset time: next midnight UTC+2 (CEST)
  const resetTime = (() => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const diffH = Math.ceil((nextMidnight.getTime() - now.getTime()) / 3600000);
    return diffH <= 1 ? 'in ca. 1 Stunde' : `in ca. ${diffH} Stunden`;
  })();

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <div className="text-center space-y-5 max-w-lg">
        {/* Icon */}
        <div className="text-4xl">{isRateLimited ? '⏳' : is404 ? '🔌' : isTimeout ? '⌛' : '⚠️'}</div>

        {/* Title */}
        <div className="space-y-1">
          <div className="text-base font-semibold text-foreground">
            {isRateLimited ? 'Finance-API Tageslimit erreicht' :
             is404 ? 'Server nicht erreichbar' :
             isTimeout ? 'Verbindungs-Timeout' :
             'Analyse fehlgeschlagen'}
          </div>
          {isRateLimited && (
            <div className="text-xs text-amber-500 font-medium">Reset {resetTime}</div>
          )}
        </div>

        {/* Body */}
        <div className="text-xs text-muted-foreground leading-relaxed bg-muted/20 rounded-lg p-4 text-left space-y-2">
          {isRateLimited ? (
            <>
              <p>Der Finance-Connector ist nicht verfügbar — entweder Tages-Limit erreicht oder der Server-Token ist noch nicht initialisiert.</p>
              <p><span className="text-foreground/80 font-medium">Lösung 1 (sofort):</span> Seite im Browser neu laden — der Token wird beim nächsten Seitenaufruf automatisch refreshed.</p>
              <p><span className="text-foreground/80 font-medium">Lösung 2:</span> Bereits analysierte Tickers in der Watchlist (linke Sidebar) laden sofort aus dem Cache.</p>
              <p><span className="text-foreground/80 font-medium">Falls Tageslimit:</span> Reset {resetTime}.</p>
            </>
          ) : is404 ? (
            <>
              <p>Der Backend-Server antwortet nicht. Die Sandbox-Session ist möglicherweise abgelaufen (~24h Laufzeit).</p>
              <p><span className="text-foreground/80 font-medium">Lösung:</span> Schreibe im Perplexity-Chat <code className="bg-muted/50 px-1 py-0.5 rounded">Deploy neu</code> — der Server wird mit frischem Token neu gestartet.</p>
            </>
          ) : isTimeout ? (
            <p>Die Analyse hat zu lange gedauert. Bitte erneut versuchen — bei komplexen Tickers kann die erste Anfrage länger dauern.</p>
          ) : (
            <p className="font-mono text-[10px] break-all opacity-70">{error.message.substring(0, 300)}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-center">
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium transition-colors"
          >
            Seite neu laden
          </button>
        </div>
      </div>
    </div>
  );
}
