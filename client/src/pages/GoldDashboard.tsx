import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { GoldAnalysis } from "../../../shared/gold-schema";
import { GOLD_FALLBACK_DATA } from "@/lib/goldFallbackData";
import { useTheme } from "@/components/ThemeProvider";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { GoldPriceSection } from "@/components/gold/GoldPriceSection";
import { GoldIndicatorsSection } from "@/components/gold/GoldIndicatorsSection";
import { GoldFairValueSection } from "@/components/gold/GoldFairValueSection";
import { GoldMonteCarloSection } from "@/components/gold/GoldMonteCarloSection";
import { GoldCycleSection } from "@/components/gold/GoldCycleSection";
import { GoldSummarySection } from "@/components/gold/GoldSummarySection";
import { GoldPriceChart } from "@/components/gold/GoldPriceChart";
import {
  Sun, Moon, TrendingUp, BarChart3, Calculator,
  Dice6, Activity, Table2, Menu, X, LineChart, Target,
  RefreshCw, Loader2, ArrowLeft, Scale,
} from "lucide-react";
import { useLocation } from "wouter";

const SECTIONS = [
  { id: 1, label: "Preis & Status", icon: TrendingUp },
  { id: 2, label: "Preis-Chart", icon: LineChart },
  { id: 3, label: "Indikatoren", icon: BarChart3 },
  { id: 4, label: "Fair Value", icon: Calculator },
  { id: 5, label: "Monte Carlo", icon: Dice6 },
  { id: 6, label: "Preisschätzung", icon: Target },
  { id: 7, label: "Zyklus", icon: Activity },
  { id: 8, label: "Zusammenfassung", icon: Table2 },
];

export default function GoldDashboard() {
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [, navigate] = useLocation();

  const { data, isLoading, isError, error, refetch } = useQuery<GoldAnalysis>({
    queryKey: ["/api/analyze-gold"],
    queryFn: async () => {
      // Try live API first, fallback to bundled static data
      try {
        const res = await apiRequest("GET", "/api/analyze-gold");
        return res.json();
      } catch {
        // Return pre-computed data bundled at build time
        return GOLD_FALLBACK_DATA;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
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
          >
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-amber-500/20">
              <Scale className="w-4 h-4 text-amber-500" />
            </div>
            <span className="text-sm font-semibold tracking-tight hidden sm:block">Gold-Analyse</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {data && (
            <div className="hidden sm:flex items-center gap-2 text-xs">
              <span className="font-mono tabular-nums font-bold text-amber-500">GOLD</span>
              <span className="text-muted-foreground">•</span>
              <span className="font-mono tabular-nums font-semibold">${data.spotPrice.toFixed(2)}</span>
              <span className={`font-mono tabular-nums text-[10px] ${data.changePercent >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                {data.changePercent >= 0 ? "+" : ""}{data.changePercent.toFixed(2)}%
              </span>
            </div>
          )}
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="h-8 px-3 text-xs font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            <span className="hidden sm:inline">{isLoading ? "Laden..." : "Aktualisieren"}</span>
          </button>
          <button
            onClick={() => navigate("/")}
            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/50 transition-colors flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" />
            <span className="hidden sm:inline">Aktien</span>
          </button>
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors"
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
          <nav className="py-2 px-2 space-y-0.5">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollToSection(s.id)}
                disabled={!data}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-left group"
              >
                <s.icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 group-hover:text-amber-500 transition-colors" />
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
        >
          {isLoading ? (
            <GoldLoadingScreen />
          ) : isError ? (
            <GoldErrorScreen error={error as Error} onRetry={() => refetch()} />
          ) : data ? (
            <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-3">
              <div ref={setSectionRef(1)}><GoldPriceSection data={data} /></div>
              <div ref={setSectionRef(2)}><GoldPriceChart data={data} /></div>
              <div ref={setSectionRef(3)}><GoldIndicatorsSection data={data} /></div>
              <div ref={setSectionRef(4)}><GoldFairValueSection data={data} /></div>
              <div ref={setSectionRef(5)}><GoldMonteCarloSection data={data} /></div>
              <div ref={setSectionRef(6)}><GoldPriceEstimateSection data={data} /></div>
              <div ref={setSectionRef(7)}><GoldCycleSection data={data} /></div>
              <div ref={setSectionRef(8)}><GoldSummarySection data={data} /></div>
              <div className="pb-8" />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function GoldPriceEstimateSection({ data }: { data: GoldAnalysis }) {
  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/10 text-amber-500 text-xs font-bold tabular-nums">6</span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Probabilistische Preisschätzung</h2>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: "3 Monate", est: data.priceEstimate.threeMonth },
            { label: "6 Monate", est: data.priceEstimate.sixMonth },
            { label: "12 Monate", est: data.priceEstimate.twelveMonth },
          ].map(({ label, est }) => (
            <div key={label} className="bg-muted/30 rounded-lg p-3 border border-border">
              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</div>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground">P10 (pessimistisch)</span>
                  <span className="text-xs font-mono tabular-nums text-red-400">${est.low.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground font-medium">Median</span>
                  <span className="text-sm font-mono tabular-nums font-bold text-foreground">${est.mid.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground">P90 (optimistisch)</span>
                  <span className="text-xs font-mono tabular-nums text-emerald-400">${est.high.toLocaleString()}</span>
                </div>
              </div>
              {/* Visual bar */}
              <div className="mt-3 relative h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="absolute h-full bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 rounded-full"
                  style={{
                    left: `${Math.max(0, ((est.low - est.low) / (est.high - est.low)) * 100)}%`,
                    width: "100%",
                  }}
                />
                <div
                  className="absolute w-1.5 h-3 bg-white rounded-full top-1/2 -translate-y-1/2 shadow-sm border border-border"
                  style={{
                    left: `${Math.min(100, Math.max(0, ((est.mid - est.low) / (est.high - est.low)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GoldLoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="text-center space-y-4">
        <div className="relative mx-auto w-12 h-12">
          <div className="absolute inset-0 border-2 border-amber-500/20 rounded-full" />
          <div className="absolute inset-0 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <Scale className="absolute inset-0 m-auto w-5 h-5 text-amber-500" />
        </div>
        <div>
          <div className="text-sm font-medium">Gold-Analyse wird geladen...</div>
          <div className="text-xs text-muted-foreground mt-1">Indikatoren, Fair Value & Monte Carlo berechnen</div>
        </div>
      </div>
    </div>
  );
}

function GoldErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="text-center space-y-3 max-w-sm">
        <div className="text-red-500 text-xl">⚠</div>
        <div className="text-sm font-medium">Gold-Analyse fehlgeschlagen</div>
        <div className="text-xs text-muted-foreground">{error.message}</div>
        <button
          onClick={onRetry}
          className="mt-2 px-4 py-2 text-xs font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
        >
          Erneut versuchen
        </button>
      </div>
    </div>
  );
}
