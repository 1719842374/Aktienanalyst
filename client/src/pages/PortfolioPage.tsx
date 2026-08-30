/**
 * PortfolioPage — Virtuelles Portfolio-Dashboard.
 *
 * Auftrag 10.08.2026 ("Portfolio-Engine – eine Optimierung ab 2 Positionen
 * (Kovarianz + CAPM/Kelly)"). KPI-Zeile, Pie-Chart (Gewichte), Performance-
 * Chart (Zeitreihe), Investments-Tabelle mit Analyse-Deep-Link, EIN
 * Optimierungs-Block (CAPM/Kelly) der automatisch ab 2 offenen Positionen
 * aus der echten Kurs-Historie rechnet (client/src/lib/portfolio/engine.ts).
 * Die fruehere manuelle "Kandidaten"-Tabelle wurde entfernt -- Overrides
 * pro Position kommen ueber "Aus Analyse übernehmen" (handleTakeoverFromAnalysis).
 * Die reinen Kelly/CAPM-Bausteine (client/src/lib/portfolio/{kelly,sharpe,
 * weighting}.ts) bleiben UNVERAENDERT und werden von engine.ts wiederverwendet.
 *
 * EIGENSTAENDIGE Seite/Route — NICHT in Dashboard.tsx eingehängt (siehe
 * Fragile-File-Registry). Registrierung in client/src/App.tsx unveraendert.
 *
 * Single Source of Truth fuer Fundamentals: /api/analyze (Analyse-Cache) +
 * darin enthaltene FMP-Kurse/-Historie. KEIN LLM fuer Kurse, Performance
 * oder Gewichte -- reine Berechnung ueber client/src/lib/portfolio/{positions,engine}.ts.
 *
 * WORK_RESEARCHER_PORTFOLIO Phase-1: Sidebar 5 Watchlist-Portfolio (P2),
 * Sidebar 6 Researcher-Portfolios (P3). P1 Investments unverändert.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Info, Menu, X, SlidersHorizontal, BarChart3, Table2, LayoutDashboard, RefreshCw, ListPlus, Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/SectionCard";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { apiRequest } from "@/lib/queryClient";
import type { StockAnalysis } from "../../../shared/schema";
import {
  makePosition, loadPositionsFromStorage, savePositionsToStorage,
  loadPolicyFromStorage, savePolicyToStorage, suggestConvictionFromScore,
  type PortfolioPosition, type PortfolioPolicy,
} from "@/lib/portfolio/positions";
import PortfolioOverview, { type TimeframeFilter, type DirectionFilter } from "@/components/portfolio/PortfolioOverview";
import PortfolioInvestmentsTable from "@/components/portfolio/PortfolioInvestmentsTable";
import PortfolioOptimizationPanel from "@/components/portfolio/PortfolioOptimizationPanel";
import WatchlistPortfolioPanel from "@/components/portfolio/WatchlistPortfolioPanel";
import ResearcherPortfoliosPanel from "@/components/portfolio/ResearcherPortfoliosPanel";
import { computePortfolioFromPositions, MIN_POSITIONS_FOR_OPTIMIZATION } from "@/lib/portfolio/engine";
import { suggestedMaxWeightDefault } from "@/lib/portfolio/weighting";
import { consumePendingPortfolioAdd } from "@/lib/portfolio/portfolioBridge";

const SECTIONS = [
  { id: 1, label: "Übersicht", icon: LayoutDashboard },
  { id: 2, label: "Investments", icon: Table2 },
  { id: 3, label: "Policy", icon: SlidersHorizontal },
  { id: 4, label: "Optimierung", icon: BarChart3 },
  { id: 5, label: "Watchlist-Portfolio", icon: ListPlus },
  { id: 6, label: "Researcher-Portfolios", icon: Globe2 },
] as const;

export default function PortfolioPage() {
  const [, setLocation] = useLocation();

  const [positions, setPositions] = useState<PortfolioPosition[]>(() => loadPositionsFromStorage());
  const [policy, setPolicy] = useState<PortfolioPolicy>(() => loadPolicyFromStorage());
  useEffect(() => { savePositionsToStorage(positions); }, [positions]);
  useEffect(() => { savePolicyToStorage(policy); }, [policy]);
  useEffect(() => {
    function syncPositions() { setPositions(loadPositionsFromStorage()); }
    window.addEventListener("aktienanalyst-portfolio-positions-changed", syncPositions);
    const pending = consumePendingPortfolioAdd();
    if (pending?.ticker) setPositions(loadPositionsFromStorage());
    return () => {
      window.removeEventListener("aktienanalyst-portfolio-positions-changed", syncPositions);
    };
  }, []);

  const [timeframe, setTimeframe] = useState<TimeframeFilter>("6M");
  const [direction, setDirection] = useState<DirectionFilter>("all");

  const [analysisByTicker, setAnalysisByTicker] = useState<Record<string, StockAnalysis | undefined>>({});
  const [loadingTickers, setLoadingTickers] = useState<Set<string>>(new Set());
  const fetchedTickersRef = useRef<Set<string>>(new Set());

  const fetchAnalysisForTicker = useCallback(async (ticker: string, force = false) => {
    const upper = ticker.toUpperCase();
    if (!force && fetchedTickersRef.current.has(upper)) return;
    fetchedTickersRef.current.add(upper);
    setLoadingTickers(prev => new Set(prev).add(upper));
    try {
      const res = await apiRequest("POST", "/api/analyze", { ticker: upper, useLLM: false, force });
      if (res.ok) {
        const data: StockAnalysis = await res.json();
        setAnalysisByTicker(prev => ({ ...prev, [upper]: data }));
      }
    } catch {
    } finally {
      setLoadingTickers(prev => { const next = new Set(prev); next.delete(upper); return next; });
    }
  }, []);

  useEffect(() => {
    const tickers = Array.from(new Set(positions.map(p => p.ticker.toUpperCase()).filter(Boolean)));
    tickers.forEach(t => fetchAnalysisForTicker(t));
  }, [positions, fetchAnalysisForTicker]);

  const lastPriceByTicker = useMemo(() => {
    const map: Record<string, number | null | undefined> = {};
    for (const [ticker, a] of Object.entries(analysisByTicker)) {
      map[ticker] = a?.currentPrice ?? null;
    }
    return map;
  }, [analysisByTicker]);

  const historicalPricesByTicker = useMemo(() => {
    const map: Record<string, Array<{ date: string; close: number }> | undefined> = {};
    for (const [ticker, a] of Object.entries(analysisByTicker)) {
      map[ticker] = a?.historicalPrices?.map(h => ({ date: h.date, close: h.close }));
    }
    return map;
  }, [analysisByTicker]);

  const cacheStatusByTicker = useMemo(() => {
    const map: Record<string, { cached: boolean; generatedAt?: string | null }> = {};
    for (const [ticker, a] of Object.entries(analysisByTicker)) {
      map[ticker] = { cached: !!a, generatedAt: a?.dataTimestamp ?? null };
    }
    return map;
  }, [analysisByTicker]);

  const pendingEntryPriceFillRef = useRef<Set<string>>(new Set());

  function handleAddPosition(ticker: string, name?: string) {
    const upper = ticker.trim().toUpperCase();
    if (!upper) return;
    if (positions.some(p => p.ticker.toUpperCase() === upper && p.status === "open")) return;
    const cached = analysisByTicker[upper];
    if (cached?.currentPrice == null) {
      pendingEntryPriceFillRef.current.add(upper);
    }
    setPositions(prev => [...prev, makePosition({
      ticker: upper,
      name: name ?? cached?.companyName,
      entryPrice: cached?.currentPrice ?? 0,
    })]);
    fetchAnalysisForTicker(upper);
  }

  useEffect(() => {
    if (pendingEntryPriceFillRef.current.size === 0) return;
    setPositions(prev => prev.map(p => {
      const upper = p.ticker.toUpperCase();
      if (!pendingEntryPriceFillRef.current.has(upper)) return p;
      const price = analysisByTicker[upper]?.currentPrice;
      if (price == null) return p;
      pendingEntryPriceFillRef.current.delete(upper);
      return p.entryPrice === 0 ? { ...p, entryPrice: price, name: p.name ?? analysisByTicker[upper]?.companyName } : p;
    }));
  }, [analysisByTicker]);

  function handleUpdatePosition(id: string, patch: Partial<PortfolioPosition>) {
    setPositions(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)));
  }

  function handleClosePosition(id: string, exitPrice: number) {
    setPositions(prev => prev.map(p => (p.id === id ? { ...p, status: "closed", closedAt: new Date().toISOString(), exitPrice } : p)));
  }

  function handleDeletePosition(id: string) {
    setPositions(prev => prev.filter(p => p.id !== id));
  }

  function handleRefreshAllAnalyses() {
    const tickers = Array.from(new Set(positions.map(p => p.ticker.toUpperCase()).filter(Boolean)));
    tickers.forEach(t => fetchAnalysisForTicker(t, true));
  }

  function handleTakeoverFromAnalysis(id: string) {
    const position = positions.find(p => p.id === id);
    if (!position) return;
    const cached = analysisByTicker[position.ticker.toUpperCase()];
    if (!cached) return;
    const score = (cached as any).scoring?.finalScore ?? (cached as any).scoring?.rawScore ?? null;
    const closes = (cached.historicalPrices ?? []).map(h => h.close).filter(c => c > 0);
    let sigmaAnnualized: number | null = null;
    if (closes.length > 20) {
      const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
      sigmaAnnualized = Math.sqrt(variance * 252);
    }
    const gStar = (cached as any).impliedGStar;
    setPositions(prev => prev.map(p => (p.id === id ? {
      ...p,
      scoreOverride: score,
      sigmaOverride: sigmaAnnualized,
      muOverride: typeof gStar === "number" ? gStar / 100 : p.muOverride,
      convictionOverride: suggestConvictionFromScore(score),
    } : p)));
  }

  const [capitalBase, setCapitalBase] = useState(String(policy.capital));
  const [benchmark, setBenchmark] = useState(policy.benchmark);
  const [rf, setRf] = useState(String(policy.rfPct));
  const [modeOverride, setModeOverride] = useState<"Auto" | "A" | "B" | "C">("Auto");
  const [maxWeightPct, setMaxWeightPct] = useState(String(policy.maxWeightPct));
  const [kellyFraction, setKellyFraction] = useState(String(policy.kellyFraction));
  const [kellyMaxFPct, setKellyMaxFPct] = useState(String(policy.kellyMaxFPct));
  useEffect(() => {
    setPolicy({
      capital: Number(capitalBase) || 0, benchmark, rfPct: Number(rf) || 0,
      maxWeightPct: Number(maxWeightPct) || 30, kellyFraction: Number(kellyFraction) || 0.5,
      kellyMaxFPct: Number(kellyMaxFPct) || 25, mode: modeOverride === "Auto" ? "auto" : "manual",
    });
  }, [capitalBase, benchmark, rf, maxWeightPct, kellyFraction, kellyMaxFPct, modeOverride]);

  const rfDecimal = (Number(rf) || 0) / 100;
  const capitalBaseNum = Number(capitalBase) || 0;
  const maxWeight = (Number(maxWeightPct) || 30) / 100;
  const kellyFractionNum = Number(kellyFraction) || 0.5;
  const kellyMaxF = (Number(kellyMaxFPct) || 25) / 100;

  const openLongPositionsCount = useMemo(
    () => positions.filter(p => p.status === "open" && p.side === "long").length,
    [positions]
  );
  const suggestedMaxWeightPct = openLongPositionsCount >= MIN_POSITIONS_FOR_OPTIMIZATION
    ? Math.round(suggestedMaxWeightDefault(openLongPositionsCount) * 100)
    : null;

  // PORTFOLIO_PHASE4_IST_ZIEL: engineResultForOverview liefert zusaetzlich zu den
  // bisherigen capmWeights (unveraendert weiterverwendet) auch weightMarketByTicker
  // (Ist-Gewicht, aus engine.ts EngineRow.weightMarket -- bereits vorhanden, jetzt
  // additiv in der UI genutzt) und solveFailed, damit Investments-Tabelle + Uebersicht
  // dieselbe EINE Optimierung anzeigen wie das Optimierungs-Panel (Section 4), ohne eine
  // zweite Berechnung zu duplizieren.
  const engineResultForOverview = useMemo(() => {
    const openLongPositions = positions.filter(p => p.status === "open" && p.side === "long");
    if (openLongPositions.length < MIN_POSITIONS_FOR_OPTIMIZATION) return null;
    const enginePositions = openLongPositions.map(p => ({
      ticker: p.ticker.toUpperCase(), qty: p.qty, entryPrice: p.entryPrice,
      lastPrice: lastPriceByTicker[p.ticker.toUpperCase()], side: p.side as "long",
      muOverride: p.muOverride, sigmaOverride: p.sigmaOverride, scoreOverride: p.scoreOverride,
    }));
    const histForEngine: Record<string, { date: string; close: number }[] | undefined> = {};
    for (const p of openLongPositions) histForEngine[p.ticker.toUpperCase()] = historicalPricesByTicker[p.ticker.toUpperCase()];
    return computePortfolioFromPositions({
      positions: enginePositions, historicalPricesByTicker: histForEngine,
      rf: rfDecimal, capital: capitalBaseNum, maxWeight, kellyFraction: kellyFractionNum, kellyMaxF,
    });
  }, [positions, lastPriceByTicker, historicalPricesByTicker, rfDecimal, capitalBaseNum, maxWeight, kellyFractionNum, kellyMaxF]);

  const capmWeights = useMemo(() => {
    if (!engineResultForOverview || engineResultForOverview.status !== "ok") return null;
    const map: Record<string, number> = {};
    engineResultForOverview.rows.forEach(r => { map[r.ticker] = r.weightCapm; });
    return map;
  }, [engineResultForOverview]);

  // Ist-Gewicht je Ticker direkt aus den EngineRows (weightMarket -- normiert auf
  // Summe=1 NUR wenn fuer ALLE usable Ticker ein Kurs vorliegt, siehe engine.ts).
  const weightMarketByTicker = useMemo(() => {
    if (!engineResultForOverview || engineResultForOverview.status !== "ok") return {};
    const map: Record<string, number | null | undefined> = {};
    engineResultForOverview.rows.forEach(r => { map[r.ticker] = r.weightMarket; });
    return map;
  }, [engineResultForOverview]);

  const solveFailed = engineResultForOverview?.status === "ok" ? engineResultForOverview.fallbackReason === "solve_failed" : false;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const scrollToSection = useCallback((id: number) => {
    const el = sectionRefs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setSidebarOpen(false);
  }, []);
  const setSectionRef = useCallback(
    (id: number) => (el: HTMLDivElement | null) => {
      sectionRefs.current[id] = el;
    },
    []
  );

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <header className="h-12 shrink-0 border-b border-border bg-card/50 backdrop-blur flex items-center gap-2 px-3">
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="lg:hidden h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted/50 transition-colors"
          aria-label="Sektionen"
        >
          {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
        </button>
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")} data-testid="button-back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-bold tracking-tight leading-tight truncate">Virtuelles Portfolio</h1>
          <p className="text-[10px] text-muted-foreground leading-tight truncate">
            Positions-Tracker + Sharpe/Kelly/CAPM — reine Berechnungslogik, keine Order-Ausführung
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefreshAllAnalyses} className="gap-1.5 shrink-0">
          <RefreshCw className="w-3.5 h-3.5" /> Alle aktualisieren
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
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
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs hover:bg-muted/50 transition-colors text-left group"
              >
                <s.icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 group-hover:text-emerald-500 transition-colors" />
                <span className="flex-1 truncate">{s.label}</span>
                <span className="text-[10px] font-mono tabular-nums text-muted-foreground/50">{s.id}</span>
              </button>
            ))}
          </nav>
          <div className="px-3 py-3 border-t border-border mt-2">
            <PerplexityAttribution />
          </div>
        </aside>

        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-20 lg:hidden top-12"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <main className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
          <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
            <div ref={setSectionRef(1)}>
              <PortfolioOverview
                positions={positions}
                lastPriceByTicker={lastPriceByTicker}
                historicalPricesByTicker={historicalPricesByTicker}
                timeframe={timeframe}
                direction={direction}
                onTimeframeChange={setTimeframe}
                onDirectionChange={setDirection}
                onSelectTicker={(ticker) => scrollToSection(2)}
                capmWeights={capmWeights}
                solveFailed={solveFailed}
              />
            </div>

            <div ref={setSectionRef(2)}>
              <PortfolioInvestmentsTable
                positions={positions}
                lastPriceByTicker={lastPriceByTicker}
                cacheStatusByTicker={cacheStatusByTicker}
                onAddPosition={handleAddPosition}
                onUpdatePosition={handleUpdatePosition}
                onClosePosition={handleClosePosition}
                onDeletePosition={handleDeletePosition}
                weightMarketByTicker={weightMarketByTicker}
                weightCapmByTicker={capmWeights ?? undefined}
              />
              {positions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {positions.filter(p => analysisByTicker[p.ticker.toUpperCase()]).map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleTakeoverFromAnalysis(p.id)}
                      className="text-[10px] px-2 py-1 rounded-md bg-muted/40 hover:bg-muted/70 transition-colors text-muted-foreground"
                      title="Score/σ/μ-Vorschläge aus der Analyse für diese Position übernehmen"
                    >
                      {p.ticker}: Aus Analyse übernehmen
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div ref={setSectionRef(3)}>
              <SectionCard number={3} title="Policy — Kapital, Benchmark, Modus, Kelly">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground">Kapital K (€)</label>
                    <Input value={capitalBase} onChange={(e) => setCapitalBase(e.target.value)} data-testid="input-capital" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Benchmark</label>
                    <Input value={benchmark} onChange={(e) => setBenchmark(e.target.value)} data-testid="input-benchmark" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">rf (% p.a.)</label>
                    <Input value={rf} onChange={(e) => setRf(e.target.value)} data-testid="input-rf" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground flex items-center justify-between gap-2">
                      <span>maxWeight (%)</span>
                      {/* Policy-Reset-Button (PORTFOLIO_PHASE4_IST_ZIEL Punkt 6): setzt maxWeight
                          IMMER auf suggestedMaxWeightDefault(n) zurueck -- statt eines festen
                          Wertes. n = aktuelle Anzahl offener Long-Positionen. Additiv neben der
                          bestehenden "Übernehmen"-Empfehlung unten, die nur bei Abweichung erscheint. */}
                      {openLongPositionsCount >= MIN_POSITIONS_FOR_OPTIMIZATION && (
                        <button
                          type="button"
                          className="text-[10px] text-muted-foreground hover:text-primary underline shrink-0"
                          title={`Setzt maxWeight auf den empfohlenen Default fuer ${openLongPositionsCount} Titel zurueck (suggestedMaxWeightDefault)`}
                          onClick={() => setMaxWeightPct(String(Math.round(suggestedMaxWeightDefault(openLongPositionsCount) * 100)))}
                          data-testid="button-reset-maxweight"
                        >
                          Zurücksetzen
                        </button>
                      )}
                    </label>
                    <Input value={maxWeightPct} onChange={(e) => setMaxWeightPct(e.target.value)} data-testid="input-maxweight" />
                    {suggestedMaxWeightPct != null && Number(maxWeightPct) !== suggestedMaxWeightPct && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Empfehlung bei {openLongPositionsCount} Titeln: {suggestedMaxWeightPct}%.{" "}
                        <button type="button" className="text-primary underline" onClick={() => setMaxWeightPct(String(suggestedMaxWeightPct))}>
                          Übernehmen
                        </button>
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Kelly-Fraction (0.5=Half)</label>
                    <Input value={kellyFraction} onChange={(e) => setKellyFraction(e.target.value)} data-testid="input-kelly-fraction" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Kelly maxF (%)</label>
                    <Input value={kellyMaxFPct} onChange={(e) => setKellyMaxFPct(e.target.value)} data-testid="input-kelly-maxf" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
                  <Info className="w-3 h-3" /> Der Optimierungs-Modus (A/B/C) wird automatisch aus μ/σ/Σ der echten Positionen gewählt (pickWeightMode) — siehe Block „Optimierung" unten.
                </p>
              </SectionCard>
            </div>

            <div ref={setSectionRef(4)}>
              <SectionCard number={4} title="Optimierung (CAPM/Kelly)">
                <PortfolioOptimizationPanel
                  positions={positions}
                  lastPriceByTicker={lastPriceByTicker}
                  historicalPricesByTicker={historicalPricesByTicker}
                  rf={rfDecimal}
                  capital={capitalBaseNum}
                  maxWeight={maxWeight}
                  kellyFraction={kellyFractionNum}
                  kellyMaxF={kellyMaxF}
                />
              </SectionCard>
            </div>

            <div ref={setSectionRef(5)}>
              <SectionCard number={5} title="Watchlist-Portfolio (P2)">
                <WatchlistPortfolioPanel policy={policy} />
              </SectionCard>
            </div>

            <div ref={setSectionRef(6)}>
              <SectionCard number={6} title="Researcher-Portfolios (P3)">
                <ResearcherPortfoliosPanel policy={policy} />
              </SectionCard>
            </div>

            <div className="text-xs text-muted-foreground border-t border-card-border pt-4 pb-8 space-y-1">
              <p>
                <strong>Disclaimer:</strong> CAPM-Basket-Gewichte (Modus A/B/C) und Kelly-Kriterium beantworten
                unterschiedliche Fragen — CAPM ≠ Kelly. Kelly-Werte sind ein Sizing-Hinweis pro Einzeltitel bezogen auf
                das Gesamtkapital K und ersetzen NICHT die Basket-Diversifikation. Half-Kelly ist Default, kein
                automatischer Full-Kelly.
              </p>
              <p>Diese Seite führt <strong>keine Order-Ausführung</strong> durch — reine Berechnungs-/Diagnose-Ansicht.</p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
