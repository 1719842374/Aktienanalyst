import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { StockAnalysis } from "../../../shared/schema";
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
import { Section10 } from "@/components/sections/Section10";
import { Section11 } from "@/components/sections/Section11";
import { Section12 } from "@/components/sections/Section12";
import { Section13 } from "@/components/sections/Section13";
import { TechnicalChart } from "@/components/sections/TechnicalChart";
import { Section15 } from "@/components/sections/Section15";
import { Section16 } from "@/components/sections/Section16";
import { Section17 } from "@/components/sections/Section17";
import {
  Sun, Moon, BarChart3, TrendingUp, Shield, Calculator,
  LineChart, Target, Scale, AlertTriangle, Activity,
  RotateCcw, Zap, Dice6, Table2, Menu, X, ChevronRight, Landmark, Globe, Bitcoin, Search, Star,
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [useLLM, setUseLLM] = useState(false);
  const [currentTicker, setCurrentTicker] = useState('');
  const [, navigate] = useLocation();
  const mainRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxRetries: number } | null>(null);

  const analyzeMutation = useMutation({
    mutationFn: async ({ ticker, llm, force }: { ticker: string; llm: boolean; force?: boolean }) => {
      const maxRetries = 3;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          setRetryInfo({ attempt, maxRetries });
          const res = await apiRequest("POST", "/api/analyze", { ticker, useLLM: llm, force: force === true });
          const result = await res.json() as StockAnalysis;
          setRetryInfo(null);
          return result;
        } catch (err: any) {
          lastError = err;
          const msg = err?.message || "";
          // 429 / RATE_LIMITED: don't waste retries — surface immediately so the user
          // sees a clear quota message instead of 3x "Verbindung fehlgeschlagen"
          if (msg.includes("RATE_LIMITED") || msg.includes("Tagesquota") || msg.includes("429")) {
            console.warn(`[Analyze] Rate-limit erkannt — keine Retries`);
            setRetryInfo(null);
            throw err;
          }
          console.warn(`[Analyze] Versuch ${attempt}/${maxRetries} fehlgeschlagen: ${msg.substring(0, 100)}`);
          if (attempt < maxRetries) {
            // Exponential backoff: 2s, 4s
            await new Promise(r => setTimeout(r, attempt * 2000));
          }
        }
      }
      setRetryInfo(null);
      throw lastError || new Error('Analyse fehlgeschlagen nach 3 Versuchen');
    },
    onSuccess: (result) => {
      setData(result);
      if (!result.llmMode || !data || data.companyName !== result.companyName) {
        mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
  });

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
      <header className="flex-shrink-0 h-12 border-b border-border bg-card flex items-center justify-between px-3 sm:px-4 z-20">
        <div className="flex items-center gap-3">
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

        <div className="flex items-center gap-3">
          {data && (
            <div className="hidden sm:flex items-center gap-2 text-xs">
              <span className="font-mono tabular-nums font-bold text-primary">{data.ticker}</span>
              <span className="text-muted-foreground">{data.companyName}</span>
              <span className="text-muted-foreground">•</span>
              <span className="font-mono tabular-nums font-semibold">${data.currentPrice.toFixed(2)}</span>
            </div>
          )}
          <TickerSearch
            onSearch={(ticker) => { setCurrentTicker(ticker); analyzeMutation.mutate({ ticker, llm: useLLM }); }}
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
          {/* KI-Katalysatoren Toggle */}
          <button
            onClick={() => {
              const next = !useLLM;
              setUseLLM(next);
              // If we have data and switching to LLM, re-analyze with LLM
              if (next && currentTicker) {
                analyzeMutation.mutate({ ticker: currentTicker, llm: true });
              }
            }}
            className={`h-8 px-2 text-[11px] font-medium rounded-md transition-all flex items-center gap-1 border ${
              useLLM
                ? 'bg-violet-500/15 text-violet-400 border-violet-500/30 hover:bg-violet-500/25'
                : 'text-foreground/40 border-border/50 hover:bg-muted/50 hover:text-foreground/60'
            }`}
            title={useLLM ? 'KI-Katalysatoren aktiv (LLM-Calls pro Analyse)' : 'KI-Katalysatoren aus (Sektor-Templates, keine LLM-Kosten)'}
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
            className="h-8 px-2.5 text-[11px] font-medium text-amber-500 hover:bg-amber-500/10 rounded-md transition-colors flex items-center gap-1.5 border border-amber-500/20"
          >
            <Scale className="w-3 h-3" />
            <span className="hidden sm:inline">Gold</span>
          </button>
          <button
            onClick={() => navigate("/screener")}
            className="h-8 px-2.5 text-[11px] font-medium text-cyan-500 hover:bg-cyan-500/10 rounded-md transition-colors flex items-center gap-1.5 border border-cyan-500/20"
          >
            <Search className="w-3 h-3" />
            <span className="hidden sm:inline">Screener</span>
          </button>
          <button
            onClick={() => navigate("/compare")}
            className="h-8 px-2.5 text-[11px] font-medium text-foreground/40 hover:bg-muted/50 hover:text-foreground/60 rounded-md transition-colors flex items-center gap-1 border border-border/50"
            title="Ticker-Vergleich"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            <span className="hidden sm:inline">VGL</span>
          </button>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors"
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
          {!data && !analyzeMutation.isPending ? (
            <WelcomeScreen onSearch={(ticker) => { setCurrentTicker(ticker); analyzeMutation.mutate({ ticker, llm: useLLM }); }} />
          ) : analyzeMutation.isPending ? (
            <LoadingScreen ticker={analyzeMutation.variables?.ticker || currentTicker || ""} retryInfo={retryInfo} />
          ) : analyzeMutation.isError ? (
            <ErrorScreen error={analyzeMutation.error} />
          ) : data ? (
            <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-3">
              <div ref={setSectionRef(1)}><Section1 data={data} onRefresh={() => { if (currentTicker) analyzeMutation.mutate({ ticker: currentTicker, llm: useLLM, force: true }); }} /></div>
              <div ref={setSectionRef(2)}><Section2 data={data} /></div>
              <FinancialStatements data={data} />
              <div ref={setSectionRef(3)}><Section3 data={data} /></div>
              <div ref={setSectionRef(4)}><Section4 data={data} /></div>
              <div ref={setSectionRef(5)}><Section5 data={data} /></div>
              <div ref={setSectionRef(6)}><Section6 data={data} /></div>
              <div ref={setSectionRef(7)}><Section7 data={data} /></div>
              <div ref={setSectionRef(8)}><Section8 data={data} /></div>
              <div ref={setSectionRef(9)}><Section9 data={data} /></div>
              <div ref={setSectionRef(10)}><TechnicalChart data={data} /></div>
              <div ref={setSectionRef(11)}><Section15 data={data} /></div>
              <div ref={setSectionRef(12)}><Section16 data={data} /></div>
              <div ref={setSectionRef(13)}><Section17 data={data} /></div>
              <div ref={setSectionRef(14)}><Section10 data={data} /></div>
              <div ref={setSectionRef(15)}><Section11 data={data} /></div>
              <div ref={setSectionRef(16)}><Section12 data={data} /></div>
              <div ref={setSectionRef(17)}><Section13 data={data} /></div>
              <div className="pb-8" />
            </div>
          ) : null}
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

function WelcomeScreen({ onSearch }: { onSearch: (ticker: string) => void }) {
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
  const is404 = !isRateLimited && (error.message.includes('404') || error.message.includes('Failed to fetch'));
  const isTimeout = error.message.includes('timeout') || error.message.includes('Timeout');
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="text-center space-y-4 max-w-md">
        <div className="text-2xl">{isRateLimited ? '⏳' : is404 ? '🔌' : '⚠️'}</div>
        <div className="text-sm font-semibold">
          {isRateLimited ? 'Tagesquota erreicht' : is404 ? 'Server nicht erreichbar' : isTimeout ? 'Timeout' : 'Analyse fehlgeschlagen'}
        </div>
        <div className="text-xs text-muted-foreground leading-relaxed">
          {isRateLimited ? (
            <>
              Die Finance-API hat das tagesgebündelte Quota dieser Sandbox erreicht.
              Reset typischerweise nach 12–24 Stunden.
              <br /><br />
              <strong>Was jetzt:</strong> Bereits analysierte Tickers (in der Watchlist links) funktionieren weiterhin aus dem Cache — 0 Credits, keine API-Calls.
              Neue Analysen sind erst nach dem Reset wieder möglich.
            </>
          ) : is404 ? (
            <>
              Der Backend-Server oder Proxy-Token ist abgelaufen. Das passiert wenn die Sandbox-Session endet (~24h).
              <br /><br />
              <strong>Lösung:</strong> Schreibe im Chat <code className="bg-muted/50 px-1.5 py-0.5 rounded text-foreground/70">Deploy neu</code> — dann wird der Server mit frischem Token neu gestartet.
            </>
          ) : (
            error.message
          )}
        </div>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 text-xs font-medium transition-colors"
        >
          Seite neu laden
        </button>
      </div>
    </div>
  );
}
