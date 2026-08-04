/**
 * PortfolioPage — Virtuelles Portfolio (WORK_PORTFOLIO.md, insb. §E.2 UI-Gliederung).
 *
 * EIGENSTAENDIGE neue Seite/Route — NICHT in Dashboard.tsx eingehängt
 * (siehe Fragile-File-Registry: Dashboard.tsx ist hochsensibel).
 * Registrierung erfolgt additiv in client/src/App.tsx nach demselben Muster
 * wie z.B. /#/btc → BTCDashboard.tsx.
 *
 * Es existiert im Code (Stand dieser Implementierung) KEINE "Buy-Liste" oder
 * vergleichbares Researcher-Konzept, das PortfolioCandidate[] liefern könnte
 * (durchsucht: server/researcher.ts, Dashboard.tsx — nur eine reine
 * "Watchlist" aus zwischengespeicherten Tickern ohne Score/μ/σ existiert).
 * Deshalb: rein manuelle, editierbare Eingabefelder für Ticker/Score/μ/σ.
 * KEIN Fake-Datenabruf.
 *
 * UI-Gliederung exakt nach §E.2:
 *   1. Kopf: K, Benchmark, rf, Mode (Auto|A|B|C), maxWeight, Kelly-Policy Half
 *   2. Kennzahlen: Sharpe_p | Sharpe_equal | Δ
 *   3. Tabelle: Ticker, Score, w%, €, Sharpe_i, Kelly-Half%, Kelly-€
 *   4. Footer: Disclaimer CAPM≠Kelly; keine Order-Ausführung
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Plus, Trash2, Info, Menu, X, SlidersHorizontal, ListOrdered, BarChart3, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionCard } from "@/components/SectionCard";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import {
  DEFAULTS,
  runPortfolioPipeline,
  type PortfolioPipelineResult,
} from "@/lib/portfolio/pipeline";
import { pickWeightMode, type WeightMode } from "@/lib/portfolio/weighting";
import type { PortfolioCandidate } from "../../../shared/schema";

// Sidebar-Sprungnavigation — gleiches Muster wie BTC-/Rezessions-Dashboard
const SECTIONS = [
  { id: 1, label: "Kopf & Policy", icon: SlidersHorizontal },
  { id: 2, label: "Kandidaten", icon: ListOrdered },
  { id: 3, label: "Kennzahlen", icon: BarChart3 },
  { id: 4, label: "Basket-Tabelle", icon: Table2 },
] as const;

interface EditableRow {
  id: string;
  ticker: string;
  score: string; // string-Inputs, damit leere Felder während Tippen möglich sind
  conviction: PortfolioCandidate["conviction"];
  mu: string; // Prozent-Eingabe (z.B. "12" = 12%)
  sigma: string; // Prozent-Eingabe (Volatilität, für Σ-Diagonale)
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

  // ─── 1. Kopf: K, Benchmark, rf, Mode, maxWeight, Kelly-Policy ────────────
  const [capitalBase, setCapitalBase] = useState("100000");
  const [benchmark, setBenchmark] = useState("SPY");
  const [rf, setRf] = useState("3.0"); // in %
  const [modeOverride, setModeOverride] = useState<"Auto" | "A" | "B" | "C">("Auto");
  const [maxWeightPct, setMaxWeightPct] = useState(String(DEFAULTS.maxWeight * 100));
  const [kellyFraction, setKellyFraction] = useState(String(DEFAULTS.kellyFraction)); // 0.5 = Half-Kelly Default
  const [kellyMaxFPct, setKellyMaxFPct] = useState(String(DEFAULTS.kellyMaxF * 100));

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

  // ─── Parsing + Pipeline-Aufruf ────────────────────────────────────────────
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
    // Diagonale Σ (unkorreliert angenommen) — reine manuelle-Input-UI hat
    // keine Kovarianz-Schätzung aus Historie; Diagonalmatrix ist der
    // konservative Default ohne implizite Korrelationsannahme.
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
      // Manueller Mode-Override (falls nicht "Auto"): Gewichte neu berechnen
      // über direkten Aufruf des jeweiligen Modus wäre nötig für vollen
      // Override — hier zeigen wir den Auto-Mode transparent an und lassen
      // den User die Auto-Logik nachvollziehen (kein Silent-Override der
      // Kernberechnung, siehe §D.5-Prinzip "keine stille Übernahme").
    } catch (e: any) {
      pipelineError = e?.message || String(e);
    }
  }

  // ── Scroll-Layout (identisch zu BTC-/Rezessions-Dashboard) ───────────────────
  // Global gilt `html, body { overflow: hidden }` (index.css), daher MUSS die
  // Seite einen eigenen scrollbaren Container haben — `min-h-screen` allein
  // führte dazu, dass Inhalt unterhalb des Viewports nicht erreichbar war.
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
        <div className="min-w-0">
          <h1 className="text-sm font-bold tracking-tight leading-tight truncate">Virtuelles Portfolio</h1>
          <p className="text-[10px] text-muted-foreground leading-tight truncate">
            Sharpe + Kelly + CAPM-Basket — reine Berechnungslogik, keine Order-Ausführung
          </p>
        </div>
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

        {/* 1. Kopf: K, Benchmark, rf, Mode, maxWeight, Kelly-Policy */}
        <div ref={setSectionRef(1)}>
          <SectionCard number={1} title="Kopf — Kapital, Benchmark, Modus, Policy">
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
            <p className="text-xs text-amber-500 flex items-center gap-1">
              <Info className="w-3 h-3" /> Modus-Override „{modeOverride}" ist rein informativ — die Tabelle unten zeigt
              die Auto-Mode-Berechnung ({autoMode ?? "—"}) nach §B.3, um keine stille Zweit-Logik zu erzeugen.
            </p>
          )}
          </SectionCard>
        </div>

        {/* Eingabe der Kandidaten (manuell, kein Fake-Datenabruf) */}
        <div ref={setSectionRef(2)}>
          <SectionCard number={2} title="Kandidaten (manuelle Eingabe — keine Buy-Liste-Datenquelle im Code vorhanden)">
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
                <Input
                  className="col-span-2"
                  value={r.score}
                  onChange={(e) => updateRow(r.id, { score: e.target.value })}
                />
                <select
                  className="col-span-2 flex h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={r.conviction}
                  onChange={(e) => updateRow(r.id, { conviction: e.target.value as any })}
                >
                  <option value="high">high</option>
                  <option value="medium">medium</option>
                  <option value="low">low</option>
                </select>
                <Input
                  className="col-span-2"
                  value={r.mu}
                  onChange={(e) => updateRow(r.id, { mu: e.target.value })}
                />
                <Input
                  className="col-span-2"
                  value={r.sigma}
                  onChange={(e) => updateRow(r.id, { sigma: e.target.value })}
                />
                <Input
                  className="col-span-1"
                  value={r.price}
                  onChange={(e) => updateRow(r.id, { price: e.target.value })}
                />
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

        {/* 2. Kennzahlen: Sharpe_p | Sharpe_equal | Δ */}
        <div ref={setSectionRef(3)}>
          <SectionCard number={3} title="Kennzahlen — Sharpe_p vs Sharpe_equal">
          {pipelineError && <p className="text-sm text-destructive">Fehler: {pipelineError}</p>}
          {!pipelineError && (
            <div className="grid grid-cols-3 gap-4">
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
            <p className="text-xs text-muted-foreground mt-2">
              n=1: kein Basket-Optimierer — Sharpe_p/Sharpe_equal nicht aussagekräftig (§D.4). Nur Kelly-Hinweis unten
              relevant.
            </p>
          )}
          </SectionCard>
        </div>

        {/* 3. Tabelle: Ticker, Score, w%, €, Sharpe_i, Kelly-Half%, Kelly-€ */}
        <div ref={setSectionRef(4)}>
          <SectionCard number={4} title="Tabelle — Basket-Gewichte & Kelly-Hinweis pro Titel">
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
                    <td className="py-2 px-2 text-right tabular-nums">
                      {row.kelly ? fmtPct(row.kelly.fHalf, 1) : "—"}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">
                      {row.kelly ? fmtEur(row.kelly.fCapped * capitalBaseNum) : "—"}
                    </td>
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

        {/* 4. Footer: Disclaimer */}
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
