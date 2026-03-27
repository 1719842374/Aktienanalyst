import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTheme } from "@/components/ThemeProvider";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { SectionCard } from "@/components/SectionCard";
import { useLocation } from "wouter";
import {
  Sun, Moon, AlertTriangle, TrendingDown, Activity,
  BarChart3, Shield, Gauge, BookOpen, ExternalLink,
  ArrowLeft, RefreshCw, Info,
} from "lucide-react";
import {
  ResponsiveContainer, RadialBarChart, RadialBar, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, ReferenceLine,
} from "recharts";

// Types matching the backend response
interface IndicatorResult {
  name: string;
  group: "recession" | "correction";
  subgroup: string;
  value: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  maxWeighted: number;
  zone: string;
  source: string;
  description: string;
}

interface SubgroupResult {
  name: string;
  label: string;
  horizon: string;
  indicators: string[];
  netScore: number;
  maxScore: number;
  probability: number;
  formula: string;
  nyFedAnchor?: number;
  finalProbability?: number;
}

interface RecessionAnalysis {
  date: string;
  indicators: IndicatorResult[];
  subgroups: SubgroupResult[];
  nyFedValue: number | null;
  googleTrendsAvailable: boolean;
  topDrivers: string[];
  interpretation: string;
  sources: { name: string; url: string }[];
}

// Color helpers
function getProbColor(p: number): string {
  if (p >= 70) return "text-red-500";
  if (p >= 50) return "text-orange-500";
  if (p >= 30) return "text-yellow-500";
  return "text-emerald-500";
}

function getProbBg(p: number): string {
  if (p >= 70) return "bg-red-500/10 border-red-500/30";
  if (p >= 50) return "bg-orange-500/10 border-orange-500/30";
  if (p >= 30) return "bg-yellow-500/10 border-yellow-500/30";
  return "bg-emerald-500/10 border-emerald-500/30";
}

function getProbLabel(p: number): string {
  if (p >= 70) return "Hoch";
  if (p >= 50) return "Moderat";
  if (p >= 30) return "Niedrig";
  return "Sehr niedrig";
}

function getScoreColor(score: number): string {
  if (score >= 4) return "text-red-500";
  if (score >= 2) return "text-orange-500";
  if (score > 0) return "text-yellow-500";
  if (score === 0) return "text-muted-foreground";
  if (score >= -2) return "text-emerald-500";
  return "text-emerald-600";
}

function getScoreBg(score: number): string {
  if (score >= 4) return "bg-red-500/15";
  if (score >= 2) return "bg-orange-500/15";
  if (score > 0) return "bg-yellow-500/15";
  if (score === 0) return "bg-muted/30";
  if (score >= -2) return "bg-emerald-500/10";
  return "bg-emerald-500/15";
}

function getGaugeColor(p: number): string {
  if (p >= 70) return "#ef4444";
  if (p >= 50) return "#f97316";
  if (p >= 30) return "#eab308";
  return "#10b981";
}

export default function RecessionDashboard() {
  const { theme, toggleTheme } = useTheme();
  const [, navigate] = useLocation();
  const [data, setData] = useState<RecessionAnalysis | null>(null);

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      try {
        const res = await apiRequest("POST", "/api/analyze-recession", {});
        const json = await res.json();
        // Validate it's actual recession data, not HTML parsed as something else
        if (!json || !json.indicators || !Array.isArray(json.indicators)) {
          throw new Error("Invalid response format");
        }
        return json as RecessionAnalysis;
      } catch {
        // API unavailable (static deployment) — try pre-built fallback data
        const fallback = await fetch("./recession-data.json");
        if (!fallback.ok) throw new Error("Rezessions-Daten konnten nicht geladen werden");
        return (await fallback.json()) as RecessionAnalysis;
      }
    },
    onSuccess: (result) => {
      setData(result);
    },
  });

  const startAnalysis = useCallback(() => {
    analyzeMutation.mutate();
  }, [analyzeMutation]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 h-12 border-b border-border bg-card flex items-center justify-between px-3 sm:px-4 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Aktien-Analyse</span>
          </button>
          <div className="w-px h-5 bg-border" />
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-semibold tracking-tight">Rezessions-Dashboard</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className="hidden sm:inline text-xs text-muted-foreground">
              Stand: {data.date}
            </span>
          )}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
        {!data && !analyzeMutation.isPending ? (
          <WelcomeScreen onStart={startAnalysis} />
        ) : analyzeMutation.isPending ? (
          <LoadingScreen />
        ) : analyzeMutation.isError ? (
          <ErrorScreen error={analyzeMutation.error} onRetry={startAnalysis} />
        ) : data ? (
          <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-3">
            {/* Section 1: Aktuelle Bewertung */}
            <SectionCard number={1} title={`Aktuelle Bewertung zum ${data.date}`}>
              <CurrentAssessment data={data} />
            </SectionCard>

            {/* Section 2: NY Fed / FRED Referenz */}
            <SectionCard number={2} title="NY Fed / FRED Referenz">
              <NYFedReference data={data} />
            </SectionCard>

            {/* Section 3: Scoring-Regeln */}
            <SectionCard number={3} title="Scoring-Regeln">
              <ScoringRules />
            </SectionCard>

            {/* Section 4: Scoring-Zonen */}
            <SectionCard number={4} title="Scoring-Zonen">
              <ScoringZones />
            </SectionCard>

            {/* Section 5: Indikatoren-Tabelle */}
            <SectionCard number={5} title="Indikatoren-Tabelle (17 Indikatoren)">
              <IndicatorTable indicators={data.indicators} />
            </SectionCard>

            {/* Section 6: Score-Übersicht (5 Untergruppen) */}
            <SectionCard number={6} title="Score-Übersicht (5 Untergruppen)">
              <SubgroupOverview subgroups={data.subgroups} />
            </SectionCard>

            {/* Section 7: Prozentschätzungen */}
            <SectionCard number={7} title="Prozentschätzungen">
              <ProbabilityEstimates subgroups={data.subgroups} />
            </SectionCard>

            {/* Section 8: Zusammenfassung + Top-3 Treiber */}
            <SectionCard number={8} title="Zusammenfassung & Top-3 Treiber">
              <Summary data={data} />
            </SectionCard>

            {/* Section 9: Quellenliste */}
            <SectionCard number={9} title="Quellenliste">
              <SourcesList sources={data.sources} />
            </SectionCard>

            <div className="pb-4">
              <PerplexityAttribution />
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

// ============================================================
// Welcome Screen
// ============================================================
function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-lg text-center space-y-6">
        <div className="flex justify-center">
          <div className="relative">
            <AlertTriangle className="w-12 h-12 text-orange-500 opacity-60" />
            <Activity className="w-5 h-5 text-primary absolute -bottom-1 -right-1" />
          </div>
        </div>
        <div>
          <h1 className="text-xl font-semibold">Rezessions- & Korrektur-Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Objektive Analyse basierend auf 17 definierten Indikatoren.
            Berechnet Wahrscheinlichkeiten für Rezession und Marktkorrektur
            über 3, 6 und 12 Monate.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-left text-xs">
          <div className="p-3 rounded-lg bg-card border border-card-border">
            <div className="font-semibold text-foreground mb-1">7 Rezessions-Indikatoren</div>
            <div className="text-muted-foreground">Sahm, Zinskurve, PMI, Durable Goods, M2, Kredit, Konsum</div>
          </div>
          <div className="p-3 rounded-lg bg-card border border-card-border">
            <div className="font-semibold text-foreground mb-1">10 Korrektur-Indikatoren</div>
            <div className="text-muted-foreground">Buffett, CAPE, VIX, CNN F&G, AAII, Put/Call, AD-Line u.a.</div>
          </div>
        </div>

        <button
          onClick={onStart}
          className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors"
        >
          Analyse starten
        </button>

        <div className="flex items-center gap-2 justify-center text-[10px] text-muted-foreground/50">
          <Info className="w-3 h-3" />
          Anti-Bias: Formel-Ergebnis ist mathematisch bindend
        </div>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="text-center space-y-4">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <div>
          <div className="text-sm font-medium">Analysiere 17 Indikatoren...</div>
          <div className="text-xs text-muted-foreground mt-1">FRED, CNN, AAII, ISM und weitere Quellen werden abgefragt</div>
        </div>
      </div>
    </div>
  );
}

function ErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="text-center space-y-3 max-w-sm">
        <div className="text-red-500 text-xl">⚠</div>
        <div className="text-sm font-medium">Analyse fehlgeschlagen</div>
        <div className="text-xs text-muted-foreground">{error.message}</div>
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors flex items-center gap-2 mx-auto"
        >
          <RefreshCw className="w-3 h-3" />
          Erneut versuchen
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Section 1: Current Assessment with Gauges
// ============================================================
function CurrentAssessment({ data }: { data: RecessionAnalysis }) {
  const keySubgroups = data.subgroups;

  return (
    <div className="space-y-4">
      {/* Probability Gauges Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {keySubgroups.map((sg) => (
          <div
            key={sg.name}
            className={`p-4 rounded-lg border ${getProbBg(sg.probability)} flex flex-col items-center`}
          >
            <div className="text-xs font-medium text-muted-foreground mb-1">{sg.label}</div>
            <div className="text-[10px] text-muted-foreground/70 mb-2">Horizont: {sg.horizon}</div>
            <GaugeMini value={sg.probability} />
            <div className={`text-2xl font-bold tabular-nums mt-2 ${getProbColor(sg.probability)}`}>
              {sg.probability}%
            </div>
            <div className={`text-xs font-medium ${getProbColor(sg.probability)}`}>
              {getProbLabel(sg.probability)}
            </div>
          </div>
        ))}
      </div>

      {/* Indicator Summary Bar */}
      <div className="flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-muted-foreground">
            Bearish: {data.indicators.filter(i => i.weightedScore > 0).length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
          <span className="text-muted-foreground">
            Neutral: {data.indicators.filter(i => i.weightedScore === 0).length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">
            Bullish: {data.indicators.filter(i => i.weightedScore < 0).length}
          </span>
        </div>
      </div>
    </div>
  );
}

function GaugeMini({ value }: { value: number }) {
  const color = getGaugeColor(value);
  const data = [
    { name: "value", val: value },
    { name: "remaining", val: 100 - value },
  ];

  return (
    <div className="w-20 h-12 relative">
      <ResponsiveContainer width="100%" height={48}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="90%"
            startAngle={180}
            endAngle={0}
            innerRadius={28}
            outerRadius={38}
            paddingAngle={0}
            dataKey="val"
            stroke="none"
          >
            <Cell fill={color} />
            <Cell fill="hsl(var(--muted))" opacity={0.3} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============================================================
// Section 2: NY Fed Reference
// ============================================================
function NYFedReference({ data }: { data: RecessionAnalysis }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border">
        <Gauge className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-medium">NY Fed Rezessionswahrscheinlichkeit (RECPROUSM156N)</div>
          <div className="text-xs text-muted-foreground mt-1">
            {data.nyFedValue !== null
              ? `Aktueller Wert: ${data.nyFedValue.toFixed(2)}% — Anker: ${(data.nyFedValue * 10).toFixed(1)}%`
              : "Daten nicht verfügbar"
            }
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Wird als 30%-Anker in die 12M-Rezessionsschätzung integriert (Formel: P×0.7 + Anker×0.3)
          </div>
        </div>
      </div>
      {data.nyFedValue !== null && (
        <div className="text-xs text-muted-foreground">
          Quelle: <a href="https://fred.stlouisfed.org/series/RECPROUSM156N" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">fred.stlouisfed.org</a>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Section 3: Scoring Rules Table
// ============================================================
function ScoringRules() {
  const recessionRules = [
    { name: "Sahm-Regel (≥0.5pp)", scorePositive: "+4", scoreNegative: "-3", weight: "×1", max: "4" },
    { name: "Inv. Zinskurve (10Y-2Y <0)", scorePositive: "+4", scoreNegative: "-3", weight: "×1", max: "4" },
    { name: "PMI (Mfg+Serv Ø <45)", scorePositive: "+3", scoreNegative: "-3", weight: "×1", max: "3" },
    { name: "Durable Goods (YoY >-5%)", scorePositive: "+3", scoreNegative: "-2", weight: "×1", max: "3" },
    { name: "M2 Wachstum (Zonen)", scorePositive: "+3 bis -2", scoreNegative: "", weight: "×1", max: "3" },
    { name: "Kreditspreads BAA-Trs (Zonen)", scorePositive: "+3 bis -2", scoreNegative: "", weight: "×1", max: "3" },
    { name: "Konsumklima CCI<80/CSI<60", scorePositive: "+3", scoreNegative: "-2", weight: "×1", max: "3" },
  ];

  const correctionRules = [
    { name: "Buffett Ind. (TMC/GDP)", scorePositive: "+8 bis -8", scoreNegative: "", weight: "×2", max: "16" },
    { name: "Shiller CAPE", scorePositive: "+7 bis -9", scoreNegative: "", weight: "×1.8", max: "12.6" },
    { name: "Margin Debt", scorePositive: "+4", scoreNegative: "-2", weight: "×1", max: "4" },
    { name: "Google Trends \"Recession\"", scorePositive: "+7 bis -6.8", scoreNegative: "", weight: "×1.7", max: "11.9" },
    { name: "VIX", scorePositive: "+4 bis -3", scoreNegative: "", weight: "×1", max: "4" },
    { name: "Advance-Decline-Line", scorePositive: "+3 bis -2", scoreNegative: "", weight: "×1", max: "3" },
    { name: "CNN Fear & Greed", scorePositive: "+6 bis -8", scoreNegative: "", weight: "×1.6", max: "9.6" },
    { name: "AAII Sentiment", scorePositive: "+4", scoreNegative: "-4", weight: "×1", max: "4" },
    { name: "CBOE Put/Call Ratio", scorePositive: "+4", scoreNegative: "-4", weight: "×1", max: "4" },
    { name: "Investors Intelligence", scorePositive: "+4", scoreNegative: "-4", weight: "×1", max: "4" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
          <TrendingDown className="w-3.5 h-3.5 text-red-500" />
          Rezessions-Indikatoren (7)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Indikator</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Score</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Gewicht</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Max</th>
              </tr>
            </thead>
            <tbody>
              {recessionRules.map((r) => (
                <tr key={r.name} className="border-b border-border/50">
                  <td className="py-1.5 px-2 font-medium">{r.name}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums">{r.scorePositive}{r.scoreNegative ? `/${r.scoreNegative}` : ""}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums">{r.weight}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums font-semibold">{r.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-orange-500" />
          Korrektur-Indikatoren (10)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Indikator</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Score</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Gewicht</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Max</th>
              </tr>
            </thead>
            <tbody>
              {correctionRules.map((r) => (
                <tr key={r.name} className="border-b border-border/50">
                  <td className="py-1.5 px-2 font-medium">{r.name}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums">{r.scorePositive}{r.scoreNegative ? `/${r.scoreNegative}` : ""}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums">{r.weight}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums font-semibold">{r.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Section 4: Scoring Zones
// ============================================================
function ScoringZones() {
  const zones = [
    { indicator: "M2", zones: "Kontraktion/<2%: +3 | 2-4%: +1 | 4-10%: 0 | >10%: -2" },
    { indicator: "Kreditspreads", zones: ">2.5%: +3 | 2.0-2.5%: +2 | 1.5-2.0%: 0 | 1.0-1.5%: -1 | <1.0%: -2" },
    { indicator: "VIX", zones: ">30: +4 | 20-30: +1 | 15-20: 0 | <15: -3" },
    { indicator: "Google (0-100)", zones: ">75: +11.9 | 60-75: +6.8 | 30-60: 0 | <30: -6.8" },
    { indicator: "Buffett", zones: ">200%: +16 | 165-200%: +10 | 140-165%: +4 | <140%: -8" },
    { indicator: "Shiller CAPE", zones: ">35: +12.6 | 30-35: +5.4 | 15-30: 0 | <15: -9" },
    { indicator: "CNN F&G", zones: ">75: +9.6 | 55-75: +3.2 | 45-55: 0 | 25-45: -3.2 | <25: -8" },
    { indicator: "AD-Line", zones: "Divergenz: +3 | Schwäche: 0 | Parallel: -2" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1.5 px-2 text-muted-foreground font-medium w-28">Indikator</th>
            <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Zonen → Gewichteter Score</th>
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => (
            <tr key={z.indicator} className="border-b border-border/50">
              <td className="py-1.5 px-2 font-medium">{z.indicator}</td>
              <td className="py-1.5 px-2 font-mono tabular-nums text-muted-foreground">{z.zones}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// Section 5: Indicator Table (full 17 indicators)
// ============================================================
function IndicatorTable({ indicators }: { indicators: IndicatorResult[] }) {
  const recession = indicators.filter(i => i.group === "recession");
  const correction = indicators.filter(i => i.group === "correction");

  const renderTable = (items: IndicatorResult[], title: string, icon: React.ReactNode) => (
    <div>
      <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Indikator</th>
              <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Wert</th>
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Zone</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Raw</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">×Gew.</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Gewichtet</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Max</th>
            </tr>
          </thead>
          <tbody>
            {items.map((ind) => (
              <tr key={ind.name} className="border-b border-border/50 hover:bg-muted/20">
                <td className="py-1.5 px-2">
                  <div className="font-medium">{ind.name}</div>
                  <div className="text-[10px] text-muted-foreground/70">{ind.source}</div>
                </td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold">{ind.value}</td>
                <td className="py-1.5 px-2">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${getScoreBg(ind.weightedScore)} ${getScoreColor(ind.weightedScore)}`}>
                    {ind.zone}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums">{ind.rawScore > 0 ? "+" : ""}{ind.rawScore}</td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums text-muted-foreground">×{ind.weight}</td>
                <td className={`py-1.5 px-2 text-center font-mono tabular-nums font-bold ${getScoreColor(ind.weightedScore)}`}>
                  {ind.weightedScore > 0 ? "+" : ""}{ind.weightedScore}
                </td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums text-muted-foreground">{ind.maxWeighted}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-2 px-2" colSpan={5}>Summe</td>
              <td className={`py-2 px-2 text-center font-mono tabular-nums ${getScoreColor(items.reduce((s, i) => s + i.weightedScore, 0))}`}>
                {items.reduce((s, i) => s + i.weightedScore, 0) > 0 ? "+" : ""}
                {items.reduce((s, i) => s + i.weightedScore, 0).toFixed(1)}
              </td>
              <td className="py-2 px-2 text-center font-mono tabular-nums">
                {items.reduce((s, i) => s + i.maxWeighted, 0).toFixed(1)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {renderTable(recession, "Rezessions-Indikatoren (7)", <TrendingDown className="w-3.5 h-3.5 text-red-500" />)}
      {renderTable(correction, "Korrektur-Indikatoren (10)", <BarChart3 className="w-3.5 h-3.5 text-orange-500" />)}

      {/* Heatmap visualization */}
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-2">Indikator-Heatmap</h3>
        <div className="flex flex-wrap gap-1">
          {indicators.map((ind) => (
            <div
              key={ind.name}
              className={`px-2 py-1 rounded text-[10px] font-medium ${getScoreBg(ind.weightedScore)} ${getScoreColor(ind.weightedScore)} border border-current/10`}
              title={`${ind.name}: ${ind.value} → ${ind.weightedScore > 0 ? "+" : ""}${ind.weightedScore}`}
            >
              {ind.name.length > 16 ? ind.name.substring(0, 14) + "..." : ind.name}
              <span className="ml-1 font-bold">{ind.weightedScore > 0 ? "+" : ""}{ind.weightedScore}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Section 6: Subgroup Overview
// ============================================================
function SubgroupOverview({ subgroups }: { subgroups: SubgroupResult[] }) {
  // Bar chart data
  const chartData = subgroups.map(sg => ({
    name: sg.label.replace("Rezession ", "Rez. ").replace("Korrektur ", "Korr. "),
    netScore: sg.netScore,
    maxScore: sg.maxScore,
    probability: sg.probability,
  }));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Untergruppe</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Horizont</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Netto-Score</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Max-Score</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Wahrsch.</th>
            </tr>
          </thead>
          <tbody>
            {subgroups.map((sg) => (
              <tr key={sg.name} className="border-b border-border/50">
                <td className="py-1.5 px-2 font-medium">{sg.label}</td>
                <td className="py-1.5 px-2 text-center">
                  <span className="px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground text-[10px]">
                    {sg.horizon}
                  </span>
                </td>
                <td className={`py-1.5 px-2 text-center font-mono tabular-nums font-bold ${getScoreColor(sg.netScore)}`}>
                  {sg.netScore > 0 ? "+" : ""}{sg.netScore.toFixed(1)}
                </td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums">{sg.maxScore.toFixed(1)}</td>
                <td className={`py-1.5 px-2 text-center font-mono tabular-nums font-bold ${getProbColor(sg.probability)}`}>
                  {sg.probability}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bar chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{
                fontSize: 11,
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
              }}
              formatter={(value: number) => [`${value}%`, "Wahrscheinlichkeit"]}
            />
            <Bar dataKey="probability" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={getGaugeColor(entry.probability)} />
              ))}
            </Bar>
            <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================
// Section 7: Probability Estimates (Pflicht-Format)
// ============================================================
function ProbabilityEstimates({ subgroups }: { subgroups: SubgroupResult[] }) {
  return (
    <div className="space-y-4">
      {subgroups.map((sg) => (
        <div key={sg.name} className={`p-3 rounded-lg border ${getProbBg(sg.probability)}`}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-sm font-bold">{sg.label}</span>
              <span className="ml-2 text-xs text-muted-foreground">({sg.horizon})</span>
            </div>
            <span className={`text-xl font-bold tabular-nums ${getProbColor(sg.probability)}`}>
              {sg.probability}%
            </span>
          </div>

          {/* Pflicht-Format block */}
          <div className="bg-card/50 rounded p-2 font-mono text-[11px] leading-relaxed space-y-0.5 border border-border/50">
            <div>
              <span className="text-muted-foreground">Indikatoren: </span>
              <span>{sg.indicators.join(", ")}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Netto-Score: </span>
              <span className={getScoreColor(sg.netScore)}>
                {sg.netScore > 0 ? "+" : ""}{sg.netScore.toFixed(1)}
              </span>
              <span className="text-muted-foreground"> / Max: </span>
              <span>{sg.maxScore.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Formel: </span>
              <span>{sg.formula}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Gerundet: → </span>
              <span className={`font-bold ${getProbColor(sg.probability)}`}>{sg.probability}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Section 8: Summary + Top-3 Drivers
// ============================================================
function Summary({ data }: { data: RecessionAnalysis }) {
  return (
    <div className="space-y-4">
      {/* Interpretation */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border">
        <div className="flex items-start gap-2">
          <Shield className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm leading-relaxed">{data.interpretation}</div>
        </div>
      </div>

      {/* Top 3 Drivers */}
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-2">Top-3 Treiber (nach absolutem Gewicht)</h3>
        <div className="space-y-1.5">
          {data.topDrivers.map((driver, i) => (
            <div key={i} className="flex items-center gap-2 text-xs p-2 rounded bg-muted/20">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                {i + 1}
              </span>
              <span className="font-mono tabular-nums">{driver}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Google Trends Note */}
      {!data.googleTrendsAvailable && (
        <div className="flex items-start gap-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-xs">
          <Info className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <span className="text-muted-foreground">
            Google Trends nicht verfügbar. Score auf 0 gesetzt, effektiver Max-Score für Korrektur Vollständig auf 61.2 reduziert.
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Section 9: Sources
// ============================================================
function SourcesList({ sources }: { sources: { name: string; url: string }[] }) {
  return (
    <div className="space-y-1.5">
      {sources.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs p-2 rounded hover:bg-muted/30 transition-colors group"
        >
          <BookOpen className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary flex-shrink-0" />
          <span className="text-foreground group-hover:text-primary">{s.name}</span>
          <ExternalLink className="w-3 h-3 text-muted-foreground/50 ml-auto" />
        </a>
      ))}
    </div>
  );
}
