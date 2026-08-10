/**
 * PortfolioPage — Virtuelles Portfolio-Dashboard.
 *
 * Auftrag 10.08.2026 ("Portfolio UX (CAPM/Kelly) + Peer-Add/Remove Fix",
 * Teil A). Von einer reinen Form-Seite zu einem Investment-Dashboard
 * umgebaut: KPI-Zeile, Pie-Chart (Gewichte), Performance-Chart (Zeitreihe),
 * Investments-Tabelle mit Analyse-Deep-Link -- die bestehende Kelly/CAPM-
 * Logik (client/src/lib/portfolio/{kelly,pipeline,sharpe,weighting}.ts)
 * bleibt UNVERAENDERT und wird nur visuell untergeordnet (Ticket A5, Punkt 5).
 *
 * EIGENSTAENDIGE Seite/Route — NICHT in Dashboard.tsx eingehängt (siehe
 * Fragile-File-Registry). Registrierung in client/src/App.tsx unveraendert.
 *
 * Single Source of Truth fuer Fundamentals: /api/analyze (Analyse-Cache) +
 * darin enthaltene FMP-Kurse/-Historie. KEIN LLM fuer Kurse, Performance
 * oder Gewichte -- reine Berechnung ueber client/src/lib/portfolio/positions.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Plus, Trash2, Info, Menu, X, SlidersHorizontal, ListOrdered, BarChart3, Table2, LayoutDashboard, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/SectionCard";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { apiRequest } from "@/lib/queryClient";
import {
  DEFAULTS,
  runPortfolioPipeline,
  type PortfolioPipelineResult,
} from "@/lib/portfolio/pipeline";
import { pickWeightMode, type WeightMode } from "@/lib/portfolio/weighting";
import type { PortfolioCandidate, StockAnalysis } from "../../../shared/schema";
import {
  makePosition, loadPositionsFromStorage, savePositionsToStorage,
  loadPolicyFromStorage, savePolicyToStorage, suggestConvictionFromScore,
  type PortfolioPosition, type PortfolioPolicy,
} from "@/lib/portfolio/positions";
import PortfolioOverview, { type TimeframeFilter, type DirectionFilter } from "@/components/portfolio/PortfolioOverview";
import PortfolioInvestmentsTable from "@/components/portfolio/PortfolioInvestmentsTable";

// Sidebar-Sprungnavigation — gleiches Muster wie BTC-/Rezessions-Dashboard
const SECTIONS = [
  { id: 1, label: "Übersicht", icon: LayoutDashboard },
  { id: 2, label: "Investments", icon: Table2 },
  { id: 3, label: "Policy", icon: SlidersHorizontal },
  { id: 4, label: "Kandidaten", icon: ListOrdered },
  { id: 5, label: "CAPM/Kelly", icon: BarChart3 },
] as const;

interface EditableRow {
  id: string;
  ticker: string;
  score: string;
  conviction: PortfolioCandidate["conviction"];
  mu: string;
  sigma: string;
  price: string;
}

function mkRow(over: Partial<EditableRow> = {}): EditableRow {
  return {
    id: Math.random().toString(36).slice(2),
    ticker: "",
    score: "70",
    conviction: "medium",
    mu: "10",
    sigma: "20",
    price: "100",
    ...over,
  };
}

function fmtPct(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

function fmtEur(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

function fmtSharpe(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return x.toFixed(3);
}

export default function PortfolioPage() {
  const [, setLocation] = useLocation();

  // ─── Positions-Tracker-State (neu, Ticket Teil A) ─────────────────────────
  const [positions, setPositions] = useState<PortfolioPosition[]>(() => loadPositionsFromStorage());
  const [policy, setPolicy] = useState<PortfolioPolicy>(() => loadPolicyFromStorage());
  useEffect(() => { savePositionsToStorage(positions); }, [positions]);
  useEffect(() => { savePolicyToStorage(policy); }, [policy]);

  const [timeframe, setTimeframe] = useState<TimeframeFilter>("6M");
  const [direction, setDirection] = useState<DirectionFilter>("all");

  // Analyse-Cache-Anbindung: fuer jeden Portfolio-Ticker /api/analyze (force:
  // false) aufrufen -- liefert Preis + Historie + Score aus dem bestehenden
  // Cache, OHNE einen Voll-Refresh zu erzwingen (Ticket A3, Schritt 1).
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
      // Netzwerkfehler: Position bleibt mit "Kurs n/a" sichtbar (Ticket #7),
      // kein Crash, kein Fake-Preis.
    } finally {
      setLoadingTickers(prev => { const next = new Set(prev); next.delete(upper); return next; });
    }
  }, []);

  // Beim Laden der Seite: fuer alle Portfolio-Ticker Analyse-Cache batchen
  // (Ticket A3, Schritt 1: "Beim Öffnen Portfolio: für alle Ticker Quotes
  // batchen + Cache-Status der Analysen laden").
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

  // Positionen, deren Einstiegspreis noch aus dem (zum Add-Zeitpunkt evtl.
  // noch nicht geladenen) Analyse-Cache nachgezogen werden soll -- verhindert
  // einen dauerhaften "Ø 0"-Einstiegspreis, wenn die Analyse erst NACH dem
  // Hinzufuegen der Position eintrifft (typischer Fall bei neuen Tickern).
  const pendingEntryPriceFillRef = useRef<Set<string>>(new Set());

  function handleAddPosition(ticker: string, name?: string) {
    const upper = ticker.trim().toUpperCase();
    if (!upper) return;
    if (positions.some(p => p.ticker.toUpperCase() === upper && p.status === "open")) return; // keine Dubletten unter offenen Positionen
    // Vorschlag aus Analyse-Cache falls schon geladen (Ticket A2), sonst
    // 0/leer -- der User setzt Volumen/Einstieg manuell. Falls die Analyse
    // noch nicht geladen ist, wird der Preis nachgezogen sobald sie eintrifft
    // (siehe Effect unten).
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

  // Zieht den Einstiegspreis fuer frisch hinzugefuegte Positionen nach,
  // sobald deren Analyse-Cache eintrifft (siehe pendingEntryPriceFillRef oben).
  useEffect(() => {
    if (pendingEntryPriceFillRef.current.size === 0) return;
    setPositions(prev => prev.map(p => {
      const upper = p.ticker.toUpperCase();
      if (!pendingEntryPriceFillRef.current.has(upper)) return p;
      const price = analysisByTicker[upper]?.currentPrice;
      if (price == null) return p;
      pendingEntryPriceFillRef.current.delete(upper);
      // Nur befuellen wenn der User den Preis in der Zwischenzeit nicht
      // bereits manuell geaendert hat (entryPrice noch 0 = unveraendert).
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
    // "Aus Analyse übernehmen" (Ticket A3, Schritt 2): Score aus dem
    // Scoring-Ergebnis (falls vorhanden), σ aus historischer Preis-
    // Volatilität approximiert (annualisiert), μ NUR wenn eine belastbare
    // Quelle im Cache existiert (impliedGStar) -- sonst leer/manuell, wie
    // vom Ticket verlangt ("nur wenn im Cache vorhanden, sonst leer").
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

  // ─── 3. Policy-Kopf (bestehende Felder, jetzt kompakt) ────────────────────
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

  // ─── 4. Kandidaten (bestehende manuelle CAPM/Kelly-Eingabe, unveraendert) ─
  const [rows, setRows] = useState<EditableRow[]>([
    mkRow({ ticker: "AAPL", score: "78", mu: "12", sigma: "22", price: "230", conviction: "high" }),
    mkRow({ ticker: "MSFT", score: "74", mu: "11", sigma: "20", price: "420", conviction: "high" }),
    mkRow({ ticker: "NVO", score: "68", mu: "9", sigma: "28", price: "80", conviction: "medium" }),
  ]);

  function updateRow(id: string, patch: Partial<EditableRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, mkRow()]);
  }
  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  // ─── Parsing + Pipeline-Aufruf (UNVERAENDERTE Kelly/CAPM-Logik) ───────────
  const parsed = useMemo(() => {
    const valid = rows.filter((r) => r.ticker.trim().length > 0);
    const candidates: PortfolioCandidate[] = valid.map((r) => ({
      ticker: r.ticker.trim().toUpperCase(),
      score: Number(r.score) || 0,
      conviction: r.conviction,
      mu: (Number(r.mu) || 0) / 100,
      price: Number(r.price) || 0,
      status: "active",
      source: "manual",
    }));
    const sigmas = valid.map((r) => (Number(r.sigma) || 0) / 100);
    const n = candidates.length;
    const Sigma: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? sigmas[i] * sigmas[i] : 0))
    );
    return { candidates, Sigma, n };
  }, [rows]);

  const rfDecimal = (Number(rf) || 0) / 100;
  const capitalBaseNum = Number(capitalBase) || 0;
  const maxWeight = (Number(maxWeightPct) || 30) / 100;
  const kellyFractionNum = Number(kellyFraction) || 0.5;
  const kellyMaxF = (Number(kellyMaxFPct) || 25) / 100;

  const autoMode: WeightMode | null =
    parsed.n >= 1
      ? pickWeightMode({ n: parsed.n, mu: parsed.candidates.map((c) => c.mu ?? 0), Sigma: parsed.Sigma, rf: rfDecimal })
      : null;

  let result: PortfolioPipelineResult | null = null;
  let pipelineError: string | null = null;
  if (parsed.n >= 1) {
    try {
      result = runPortfolioPipeline({
        candidates: parsed.candidates,
        Sigma: parsed.Sigma,
        rf: rfDecimal,
        capitalBase: capitalBaseNum,
        maxWeight,
        kellyFraction: kellyFractionNum,
        kellyMaxF,
      });
    } catch (e: any) {
      pipelineError = e?.message || String(e);
    }
  }

  // ── Scroll-Layout (identisch zu BTC-/Rezessions-Dashboard) ───────────────────
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
      {/* Header (fix, scrollt nicht mit) */}
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
        {/* Sidebar mit Sprungnavigation */}
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

        {/* Overlay auf Mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-20 lg:hidden top-12"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Scrollbarer Hauptbereich */}
        <main className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
          <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">

            {/* 1. Übersicht: KPI-Zeile + Pie + Performance-Chart */}
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
              />
            </div>

            {/* 2. Investments-Tabelle mit Analyse-Deep-Link */}
            <div ref={setSectionRef(2)}>
              <PortfolioInvestmentsTable
                positions={positions}
                lastPriceByTicker={lastPriceByTicker}
                cacheStatusByTicker={cacheStatusByTicker}
                onAddPosition={handleAddPosition}
                onUpdatePosition={handleUpdatePosition}
                onClosePosition={handleClosePosition}
                onDeletePosition={handleDeletePosition}
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

            {/* 3. Policy-Kopf (kompakt) */}
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
                    <label className="text-xs text-muted-foreground">Modus</label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={modeOverride}
                      onChange={(e) => setModeOverride(e.target.value as any)}
                      data-testid="select-mode"
                    >
                      <option value="Auto">Auto (pickWeightMode)</option>
                      <option value="A">A — Max-Sharpe</option>
                      <option value="B">B — Risk-Parity</option>
                      <option value="C">C — Score-Tilt</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">maxWeight (%)</label>
                    <Input value={maxWeightPct} onChange={(e) => setMaxWeightPct(e.target.value)} data-testid="input-maxweight" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Kelly-Fraction (0.5=Half)</label>
                    <Input value={kellyFraction} onChange={(e) => setKellyFraction(e.target.value)} data-testid="input-kelly-fraction" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Kelly maxF (%)</label>
                    <Input value={kellyMaxFPct} onChange={(e) => setKellyMaxFPct(e.target.value)} data-testid="input-kelly-maxf" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Auto-Mode (berechnet)</label>
                    <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/30 text-sm font-mono">
                      {autoMode ?? "—"}
                    </div>
                  </div>
                </div>
                {modeOverride !== "Auto" && (
                  <p className="text-xs text-amber-500 flex items-center gap-1 mt-2">
                    <Info className="w-3 h-3" /> Modus-Override „{modeOverride}" ist rein informativ — die Tabelle unten zeigt
                    die Auto-Mode-Berechnung ({autoMode ?? "—"}), um keine stille Zweit-Logik zu erzeugen.
                  </p>
                )}
              </SectionCard>
            </div>

            {/* 4. Kandidaten (bestehende manuelle CAPM/Kelly-Eingabe) */}
            <div ref={setSectionRef(4)}>
              <SectionCard number={4} title="Kandidaten (manuelle CAPM/Kelly-Eingabe)">
                <div className="space-y-2">
                  <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground font-medium px-1">
                    <div className="col-span-2">Ticker</div>
                    <div className="col-span-2">Score (0-100)</div>
                    <div className="col-span-2">Conviction</div>
                    <div className="col-span-2">μ erwartet (%/a)</div>
                    <div className="col-span-2">σ (%/a)</div>
                    <div className="col-span-1">Preis</div>
                    <div className="col-span-1"></div>
                  </div>
                  {rows.map((r) => (
                    <div key={r.id} className="grid grid-cols-12 gap-2 items-center">
                      <Input
                        className="col-span-2"
                        value={r.ticker}
                        onChange={(e) => updateRow(r.id, { ticker: e.target.value })}
                        placeholder="AAPL"
                        data-testid={`input-ticker-${r.id}`}
                      />
                      <Input className="col-span-2" value={r.score} onChange={(e) => updateRow(r.id, { score: e.target.value })} />
                      <select
                        className="col-span-2 flex h-9 rounded-md border border-input bg-background px-2 text-sm"
                        value={r.conviction}
                        onChange={(e) => updateRow(r.id, { conviction: e.target.value as any })}
                      >
                        <option value="high">high</option>
                        <option value="medium">medium</option>
                        <option value="low">low</option>
                      </select>
                      <Input className="col-span-2" value={r.mu} onChange={(e) => updateRow(r.id, { mu: e.target.value })} />
                      <Input className="col-span-2" value={r.sigma} onChange={(e) => updateRow(r.id, { sigma: e.target.value })} />
                      <Input className="col-span-1" value={r.price} onChange={(e) => updateRow(r.id, { price: e.target.value })} />
                      <Button variant="ghost" size="icon" className="col-span-1" onClick={() => removeRow(r.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={addRow} className="mt-2">
                    <Plus className="w-4 h-4 mr-1" /> Kandidat hinzufügen
                  </Button>
                </div>
              </SectionCard>
            </div>

            {/* 5. CAPM/Kelly-Kennzahlen + Basket-Gewichte (bestehende Logik) */}
            <div ref={setSectionRef(5)}>
              <SectionCard number={5} title="CAPM/Kelly — Kennzahlen & Basket-Gewichte">
                {pipelineError && <p className="text-sm text-destructive">Fehler: {pipelineError}</p>}
                {!pipelineError && (
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="bg-muted/30 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">Sharpe_p (Basket)</div>
                      <div className="text-xl font-bold tabular-nums">{fmtSharpe(result?.sharpePortfolio)}</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">Sharpe_equal (1/n)</div>
                      <div className="text-xl font-bold tabular-nums">{fmtSharpe(result?.sharpeEqualWeight)}</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-3">
                      <div className="text-xs text-muted-foreground">Δ vs Equal-Weight</div>
                      <div className="text-xl font-bold tabular-nums">{fmtSharpe(result?.deltaVsEqual)}</div>
                    </div>
                  </div>
                )}
                {parsed.n === 1 && (
                  <p className="text-xs text-muted-foreground mb-3">
                    n=1: kein Basket-Optimierer — Sharpe_p/Sharpe_equal nicht aussagekräftig. Nur Kelly-Hinweis unten relevant.
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b border-card-border">
                        <th className="text-left py-2 px-2">Ticker</th>
                        <th className="text-right py-2 px-2">Score</th>
                        <th className="text-right py-2 px-2">w%</th>
                        <th className="text-right py-2 px-2">Basket-€</th>
                        <th className="text-right py-2 px-2">Sharpe_i</th>
                        <th className="text-right py-2 px-2">Kelly-Half %</th>
                        <th className="text-right py-2 px-2">Kelly-€</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(result?.rows ?? []).map((row) => (
                        <tr key={row.ticker} className="border-b border-card-border/50">
                          <td className="py-2 px-2 font-mono font-medium">{row.ticker}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{row.score}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtPct(row.weight, 1)}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtEur(row.amount)}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{fmtSharpe(row.sharpeSingle)}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{row.kelly ? fmtPct(row.kelly.fHalf, 1) : "—"}</td>
                          <td className="py-2 px-2 text-right tabular-nums">{row.kelly ? fmtEur(row.kelly.fCapped * capitalBaseNum) : "—"}</td>
                        </tr>
                      ))}
                      {(!result || result.rows.length === 0) && (
                        <tr>
                          <td colSpan={7} className="text-center py-6 text-muted-foreground text-xs">
                            Keine Kandidaten — Ticker oben hinzufügen.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {result && result.notes.length > 0 && (
                  <ul className="text-xs text-muted-foreground mt-3 space-y-1">
                    {result.notes.map((n, i) => (
                      <li key={i}>• {n}</li>
                    ))}
                  </ul>
                )}
              </SectionCard>
            </div>

            {/* Footer: Disclaimer */}
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
