import { useState, useRef, useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { analyzeBTC } from "@/lib/btcAnalysis";
import { useTheme } from "@/components/ThemeProvider";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { SectionCard } from "@/components/SectionCard";
import { RechenWeg } from "@/components/RechenWeg";
import { formatCurrency, formatLargeNumber, formatPercent, getChangeColor } from "@/lib/formatters";
import { useLocation } from "wouter";
import {
  Sun, Moon, Bitcoin, TrendingUp, Activity, Calculator,
  LineChart as LineChartIcon, Target, Scale, BarChart3, Dice6,
  Menu, X, ChevronRight, Gauge, Layers, ArrowLeft,
  CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";
import {
  LineChart as ReLineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Area, AreaChart, BarChart, Bar,
  Cell, ReferenceLine, PieChart, Pie, ComposedChart, Legend,
} from "recharts";

// === Types ===
interface BTCAnalysis {
  timestamp: string;
  btcPrice: number;
  btcChange24h: number;
  btcMarketCap: number;
  lastHalvingDate: string;
  monthsSinceHalving: number;
  nextHalvingEstimate: string;
  cyclePhase: string;
  indicators: { name: string; value: string; score: number; weight: number; weighted: number; source: string; }[];
  gis: number;
  gisCalculation: string;
  powerLaw: {
    daysSinceGenesis: number; fairValue: number; support: number; resistance: number;
    deviationPercent: number; fairValue6M: number; powerSignal: number;
  };
  gws: { gis: number; powerSignal: number; cycleSignal: number; value: number; mu: number; interpretation: string; };
  monteCarlo: {
    sigma: number; sigmaAdj: number; mu: number;
    threeMonth: { p10: number; p50: number; p90: number; mean: number; probBelow: number; probAbove120: number; };
    sixMonth: { p10: number; p50: number; p90: number; mean: number; probBelow: number; probAbove120: number; };
  };
  categories: { label: string; range: string; probability: number; }[];
  cycleAssessment: { position: string; entryPoint: string; halvingCatalyst: string; };
  finalEstimate: { threeMonthRange: string; sixMonthRange: string; outlook: string; summary: string; };
  fearGreedIndex: number;
  fearGreedLabel: string;
  dxy: number;
  fedFundsRate: number;
  chartData: {
    prices1Y: { date: string; price: number; }[];
    prices3Y: { date: string; price: number; }[];
    prices5Y: { date: string; price: number; }[];
    prices10Y: { date: string; price: number; }[];
    allPrices: { date: string; price: number; }[];
  };
  technicalChart: { date: string; price: number; ma50: number | null; ma200: number | null; macd: number | null; signal: number | null; histogram: number | null; }[];
  technicalSignals: { date: string; type: "BUY" | "SELL"; reason: string; price: number; }[];
  bullConditions: { priceAboveMA200: boolean; ma50AboveMA200: boolean; macdAboveZero: boolean; macdAboveSignal: boolean; };
  isBull: boolean;
  currentMA50: number | null;
  currentMA200: number | null;
  currentMACD: number | null;
  currentSignal: number | null;
  fearGreedHistory: { date: string; value: number; classification: string; }[];
  fearGreedStats: { avg30: number | null; avg90: number | null; avg365: number | null; yearHigh: number | null; yearLow: number | null; };
}

// === Sidebar Sections ===
const SECTIONS = [
  { id: 1, label: "Status & Preis", icon: Bitcoin },
  { id: 2, label: "Halving-Zyklus", icon: Activity },
  { id: 3, label: "Indikatoren", icon: BarChart3 },
  { id: 4, label: "Power-Law", icon: Calculator },
  { id: 5, label: "GWS", icon: Target },
  { id: 6, label: "Monte Carlo", icon: Dice6 },
  { id: 7, label: "Kategorien A-E", icon: Layers },
  { id: 8, label: "Zyklus-Einsch.", icon: TrendingUp },
  { id: 9, label: "Finale Schätzung", icon: Scale },
  { id: 10, label: "Technische Analyse", icon: LineChartIcon },
  { id: 11, label: "Fear & Greed", icon: Gauge },
  { id: 12, label: "Signale", icon: Activity },
];

// === Helper Components ===
function MetricCard({ label, value, subValue, color }: {
  label: string; value: string; subValue?: string; color?: string;
}) {
  return (
    <div className="bg-muted/30 border border-border rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`text-lg font-bold font-mono tabular-nums mt-1 ${color || "text-foreground"}`}>{value}</div>
      {subValue && <div className="text-xs text-muted-foreground mt-0.5">{subValue}</div>}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score > 0 ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
    : score < 0 ? "bg-red-500/15 text-red-500 border-red-500/30"
    : "bg-amber-500/15 text-amber-500 border-amber-500/30";
  const label = score > 0 ? `+${score}` : `${score}`;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold font-mono border ${color}`}>
      {label}
    </span>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="w-full h-2 bg-muted/50 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// === Shared tooltip style ===
const tooltipStyle = { fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 };

// === Section Components ===

function Section1Status({ data }: { data: BTCAnalysis }) {
  const ts = new Date(data.timestamp);
  return (
    <SectionCard number={1} title="Analysezeitpunkt & Status">
      <div className="text-xs text-muted-foreground mb-3">
        {ts.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" })},{" "}
        {ts.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          label="BTC Preis"
          value={`$${data.btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          subValue={`${data.btcChange24h >= 0 ? "+" : ""}${data.btcChange24h.toFixed(2)}% (24h)`}
          color={data.btcChange24h >= 0 ? "text-emerald-500" : "text-red-500"}
        />
        <MetricCard
          label="Marktkapitalisierung"
          value={formatLargeNumber(data.btcMarketCap)}
        />
        <MetricCard
          label="Fear & Greed"
          value={`${data.fearGreedIndex}`}
          subValue={data.fearGreedLabel}
          color={data.fearGreedIndex < 30 ? "text-red-500" : data.fearGreedIndex > 70 ? "text-emerald-500" : "text-amber-500"}
        />
        <MetricCard
          label="DXY Index"
          value={data.dxy.toFixed(2)}
          subValue={data.dxy < 100 ? "Schwach (bullish BTC)" : data.dxy > 105 ? "Stark (bearish BTC)" : "Neutral"}
          color={data.dxy < 100 ? "text-emerald-500" : data.dxy > 105 ? "text-red-500" : "text-amber-500"}
        />
      </div>
    </SectionCard>
  );
}

function Section2Halving({ data }: { data: BTCAnalysis }) {
  const cycleLength = 48;
  const progress = Math.min(data.monthsSinceHalving / cycleLength * 100, 100);

  return (
    <SectionCard number={2} title="Halving-Zyklus">
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Letztes Halving" value="20.04.2024" subValue="Block 840,000" />
          <MetricCard label="Monate seit Halving" value={`${data.monthsSinceHalving}M`} />
          <MetricCard label="Nächstes Halving" value={data.nextHalvingEstimate} subValue="Block 1,050,000" />
          <MetricCard label="Zyklusphase" value={data.cyclePhase} />
        </div>

        <div className="bg-muted/20 rounded-lg p-3 border border-border">
          <div className="text-xs font-medium text-muted-foreground mb-2">Zyklus-Fortschritt</div>
          <div className="relative w-full h-4 bg-muted/50 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Halving</span>
            <span>12M</span>
            <span>24M</span>
            <span>36M</span>
            <span>48M</span>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function Section3Indicators({ data }: { data: BTCAnalysis }) {
  return (
    <SectionCard number={3} title="Indikatoren-Scoring">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Indikator</th>
              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Wert</th>
              <th className="text-center py-2 px-2 font-medium text-muted-foreground">Score</th>
              <th className="text-center py-2 px-2 font-medium text-muted-foreground">Gewicht</th>
              <th className="text-center py-2 px-2 font-medium text-muted-foreground">Gewichtet</th>
              <th className="text-left py-2 px-2 font-medium text-muted-foreground">Quelle</th>
            </tr>
          </thead>
          <tbody>
            {data.indicators.map((ind, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="py-2 px-2 font-medium">{ind.name}</td>
                <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground">{ind.value}</td>
                <td className="py-2 px-2 text-center"><ScoreBadge score={ind.score} /></td>
                <td className="py-2 px-2 text-center font-mono tabular-nums">{(ind.weight * 100).toFixed(0)}%</td>
                <td className="py-2 px-2 text-center font-mono tabular-nums font-bold">{ind.weighted.toFixed(3)}</td>
                <td className="py-2 px-2 text-muted-foreground">{ind.source}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border">
              <td className="py-2 px-2 font-bold" colSpan={4}>GIS (Gesamt-Indikator-Score)</td>
              <td className="py-2 px-2 text-center font-mono tabular-nums font-bold text-primary text-sm">
                {data.gis.toFixed(4)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <RechenWeg
        title="GIS Rechenweg"
        steps={data.gisCalculation.split(" + ").map(s => s.trim())}
      />
    </SectionCard>
  );
}

function Section4PowerLaw({ data }: { data: BTCAnalysis }) {
  const pl = data.powerLaw;
  const signalColor = pl.powerSignal > 0 ? "text-emerald-500" : pl.powerSignal < 0 ? "text-red-500" : "text-amber-500";

  const zones = [
    { name: "Support", value: pl.support, color: "#22c55e" },
    { name: "Fair Value", value: pl.fairValue, color: "#3b82f6" },
    { name: "BTC Preis", value: data.btcPrice, color: "#f59e0b" },
    { name: "Resistance", value: pl.resistance, color: "#ef4444" },
  ].sort((a, b) => a.value - b.value);

  return (
    <SectionCard number={4} title="Power-Law Bewertung">
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Tage seit Genesis" value={pl.daysSinceGenesis.toLocaleString()} subValue="03.01.2009" />
          <MetricCard
            label="Fair Value"
            value={`$${pl.fairValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          />
          <MetricCard
            label="Abweichung"
            value={`${pl.deviationPercent >= 0 ? "+" : ""}${pl.deviationPercent.toFixed(1)}%`}
            color={Math.abs(pl.deviationPercent) < 20 ? "text-amber-500" : pl.deviationPercent < 0 ? "text-emerald-500" : "text-red-500"}
          />
          <MetricCard label="Power Signal" value={pl.powerSignal.toFixed(1)} color={signalColor} />
        </div>

        <div className="bg-muted/20 rounded-lg p-4 border border-border space-y-3">
          <div className="text-xs font-medium text-muted-foreground">Power-Law Korridor</div>
          <div className="space-y-2">
            {zones.map((z) => {
              const maxVal = pl.resistance * 1.2;
              const pct = (z.value / maxVal) * 100;
              return (
                <div key={z.name} className="flex items-center gap-2">
                  <div className="w-24 text-[10px] font-medium text-right text-muted-foreground">{z.name}</div>
                  <div className="flex-1 relative h-5 bg-muted/30 rounded">
                    <div
                      className="absolute top-0 left-0 h-full rounded flex items-center justify-end pr-1"
                      style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: z.color + "30" }}
                    >
                      <span className="text-[9px] font-mono font-bold" style={{ color: z.color }}>
                        ${z.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="Support (0.4×FV)" value={`$${pl.support.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
          <MetricCard label="Resistance (2.5×FV)" value={`$${pl.resistance.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
        </div>
        <MetricCard
          label="Fair Value in 6 Monaten"
          value={`$${pl.fairValue6M.toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
          subValue={`+${(((pl.fairValue6M - pl.fairValue) / pl.fairValue) * 100).toFixed(1)}% vs. heute`}
        />

        <RechenWeg
          title="Power-Law Formel"
          steps={[
            `Tage = ${pl.daysSinceGenesis} (seit 03.01.2009)`,
            `FV = 1.0117e-17 × ${pl.daysSinceGenesis}^5.82 = $${pl.fairValue.toFixed(0)}`,
            `Support = FV × 0.4 = $${pl.support.toFixed(0)}`,
            `Resistance = FV × 2.5 = $${pl.resistance.toFixed(0)}`,
            `Abweichung = ($${data.btcPrice.toFixed(0)} - $${pl.fairValue.toFixed(0)}) / $${pl.fairValue.toFixed(0)} × 100 = ${pl.deviationPercent.toFixed(1)}%`,
          ]}
        />
      </div>
    </SectionCard>
  );
}

function Section5GWS({ data }: { data: BTCAnalysis }) {
  const g = data.gws;
  const gwsColor = g.value > 0.2 ? "text-emerald-500" : g.value < -0.2 ? "text-red-500" : "text-amber-500";

  const gwsComponents = [
    { name: "GIS×0.30", value: g.gis * 0.30, fill: "#3b82f6" },
    { name: "Power×0.50", value: g.powerSignal * 0.50, fill: "#8b5cf6" },
    { name: "Zyklus×0.20", value: g.cycleSignal * 0.20, fill: "#f59e0b" },
  ];

  return (
    <SectionCard number={5} title="GWS (Gesamt-Weighted-Score)">
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="GIS" value={g.gis.toFixed(4)} />
          <MetricCard label="Power Signal" value={g.powerSignal.toFixed(1)} />
          <MetricCard label="Zyklus Signal" value={g.cycleSignal.toFixed(1)} />
          <MetricCard label="GWS" value={g.value.toFixed(4)} color={gwsColor} />
        </div>

        <div className="bg-muted/20 rounded-lg p-3 border border-border">
          <div className="text-xs font-medium text-muted-foreground mb-2">GWS Komponenten</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={gwsComponents} layout="vertical">
              <XAxis type="number" domain={[-0.6, 0.6]} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => v.toFixed(4)} />
              <ReferenceLine x={0} stroke="hsl(var(--border))" />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {gwsComponents.map((c, i) => (
                  <Cell key={i} fill={c.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="Drift (μ)" value={g.mu.toFixed(4)} subValue="Tägliche Drift für Monte Carlo" />
          <div className="bg-muted/30 border border-border rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Interpretation</div>
            <div className={`text-sm font-medium mt-1 ${gwsColor}`}>{g.interpretation}</div>
          </div>
        </div>

        <RechenWeg
          title="GWS Rechenweg"
          steps={[
            `GWS = GIS×0.30 + Power×0.50 + Zyklus×0.20`,
            `GWS = ${g.gis.toFixed(4)}×0.30 + ${g.powerSignal.toFixed(1)}×0.50 + ${g.cycleSignal.toFixed(1)}×0.20`,
            `GWS = ${(g.gis * 0.30).toFixed(4)} + ${(g.powerSignal * 0.50).toFixed(4)} + ${(g.cycleSignal * 0.20).toFixed(4)}`,
            `GWS = ${g.value.toFixed(4)}`,
            `μ-Mapping: GWS=${g.value.toFixed(4)} → μ=${g.mu.toFixed(4)}`,
          ]}
        />
      </div>
    </SectionCard>
  );
}

function Section6MonteCarlo({ data }: { data: BTCAnalysis }) {
  const mc = data.monteCarlo;
  const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  const distData3M = [
    { name: "P10", value: mc.threeMonth.p10, fill: "#ef4444" },
    { name: "P50", value: mc.threeMonth.p50, fill: "#3b82f6" },
    { name: "Mean", value: mc.threeMonth.mean, fill: "#8b5cf6" },
    { name: "P90", value: mc.threeMonth.p90, fill: "#22c55e" },
  ];

  const distData6M = [
    { name: "P10", value: mc.sixMonth.p10, fill: "#ef4444" },
    { name: "P50", value: mc.sixMonth.p50, fill: "#3b82f6" },
    { name: "Mean", value: mc.sixMonth.mean, fill: "#8b5cf6" },
    { name: "P90", value: mc.sixMonth.p90, fill: "#22c55e" },
  ];

  return (
    <SectionCard number={6} title="Monte Carlo Simulation">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="σ (Basis)" value={mc.sigma.toFixed(4)} />
          <MetricCard label="σ (adjustiert)" value={mc.sigmaAdj.toFixed(4)} />
          <MetricCard label="μ (Drift)" value={mc.mu.toFixed(4)} />
        </div>

        <div className="bg-muted/20 rounded-lg p-3 border border-border space-y-3">
          <div className="text-xs font-medium text-foreground">3-Monats-Prognose (T=90)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricCard label="P10 (pessimist.)" value={fmt(mc.threeMonth.p10)} color="text-red-500" />
            <MetricCard label="P50 (Median)" value={fmt(mc.threeMonth.p50)} color="text-blue-500" />
            <MetricCard label="Mean" value={fmt(mc.threeMonth.mean)} color="text-purple-500" />
            <MetricCard label="P90 (optimist.)" value={fmt(mc.threeMonth.p90)} color="text-emerald-500" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="P(< aktueller Preis)" value={`${mc.threeMonth.probBelow.toFixed(1)}%`} />
            <MetricCard label="P(> +20%)" value={`${mc.threeMonth.probAbove120.toFixed(1)}%`} />
          </div>

          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={distData3M}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis hide />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(v)} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {distData3M.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-muted/20 rounded-lg p-3 border border-border space-y-3">
          <div className="text-xs font-medium text-foreground">6-Monats-Prognose (T=180)</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricCard label="P10 (pessimist.)" value={fmt(mc.sixMonth.p10)} color="text-red-500" />
            <MetricCard label="P50 (Median)" value={fmt(mc.sixMonth.p50)} color="text-blue-500" />
            <MetricCard label="Mean" value={fmt(mc.sixMonth.mean)} color="text-purple-500" />
            <MetricCard label="P90 (optimist.)" value={fmt(mc.sixMonth.p90)} color="text-emerald-500" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <MetricCard label="P(< aktueller Preis)" value={`${mc.sixMonth.probBelow.toFixed(1)}%`} />
            <MetricCard label="P(> +20%)" value={`${mc.sixMonth.probAbove120.toFixed(1)}%`} />
          </div>

          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={distData6M}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis hide />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(v)} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {distData6M.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <RechenWeg
          title="Monte Carlo Parameter"
          steps={[
            `10.000 Iterationen (GBM)`,
            `S(T) = S₀ × exp((μ - σ²/2) × T + σ × √T × Z)`,
            `σ_basis = ${mc.sigma}, σ_adj = ${mc.sigmaAdj} (×${mc.sigmaAdj > mc.sigma ? "1.2 late-cycle" : "1.0"})`,
            `μ = ${mc.mu.toFixed(4)}`,
            `S₀ = $${data.btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
          ]}
        />
      </div>
    </SectionCard>
  );
}

function Section7Categories({ data }: { data: BTCAnalysis }) {
  const catColors: Record<string, string> = {
    A: "#22c55e", B: "#84cc16", C: "#f59e0b", D: "#f97316", E: "#ef4444",
  };

  return (
    <SectionCard number={7} title="Wahrscheinlichkeits-Kategorien (3M)">
      <div className="space-y-4">
        <div className="space-y-2">
          {data.categories.map((cat) => (
            <div key={cat.label} className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-md flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                style={{ backgroundColor: catColors[cat.label] }}
              >
                {cat.label}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground truncate pr-2">{cat.range}</span>
                  <span className="text-xs font-bold font-mono tabular-nums">{cat.probability.toFixed(1)}%</span>
                </div>
                <div className="w-full h-2 bg-muted/50 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(cat.probability / 50 * 100, 100)}%`, backgroundColor: catColors[cat.label] }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-muted/20 rounded-lg p-3 border border-border">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data.categories.map(c => ({ name: c.label, value: c.probability }))}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value.toFixed(1)}%`}
              >
                {data.categories.map((c, i) => (
                  <Cell key={i} fill={catColors[c.label]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}%`} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="text-xs text-muted-foreground">
          Summe: {data.categories.reduce((s, c) => s + c.probability, 0).toFixed(1)}%
          {data.monthsSinceHalving > 18 && (
            <span className="ml-2 text-amber-500">(Late-Cycle-Adjustment angewendet: E×0.78)</span>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

function Section8CycleAssessment({ data }: { data: BTCAnalysis }) {
  return (
    <SectionCard number={8} title="Zyklus-Einschätzung">
      <div className="space-y-3">
        <div className="bg-muted/20 rounded-lg p-3 border border-border">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/15 text-blue-500 border border-blue-500/30">Block A</span>
            <span className="text-xs font-medium text-foreground">Zyklus-Position</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.cycleAssessment.position}</p>
        </div>

        <div className="bg-muted/20 rounded-lg p-3 border border-border">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/15 text-purple-500 border border-purple-500/30">Block B</span>
            <span className="text-xs font-medium text-foreground">Einstiegspunkt-Bewertung</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.cycleAssessment.entryPoint}</p>
        </div>

        <div className="bg-muted/20 rounded-lg p-3 border border-border">
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">Block C</span>
            <span className="text-xs font-medium text-foreground">Nächstes Halving als Katalysator</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.cycleAssessment.halvingCatalyst}</p>
        </div>
      </div>
    </SectionCard>
  );
}

function Section9FinalEstimate({ data }: { data: BTCAnalysis }) {
  const outlookColor = data.finalEstimate.outlook === "Bullish" ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/30"
    : data.finalEstimate.outlook === "Bearish" ? "text-red-500 bg-red-500/10 border-red-500/30"
    : "text-amber-500 bg-amber-500/10 border-amber-500/30";

  return (
    <SectionCard number={9} title="Finale Preis-Schätzung">
      <div className="space-y-4">
        <div className={`inline-flex items-center px-3 py-1.5 rounded-lg border text-sm font-bold ${outlookColor}`}>
          {data.finalEstimate.outlook}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-muted/30 border border-border rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">3-Monats-Range</div>
            <div className="text-xl font-bold font-mono tabular-nums mt-1 text-primary">
              {data.finalEstimate.threeMonthRange}
            </div>
            <div className="text-xs text-muted-foreground mt-1">P10 – P90 (80% Konfidenz)</div>
          </div>
          <div className="bg-muted/30 border border-border rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">6-Monats-Range</div>
            <div className="text-xl font-bold font-mono tabular-nums mt-1 text-primary">
              {data.finalEstimate.sixMonthRange}
            </div>
            <div className="text-xs text-muted-foreground mt-1">P10 – P90 (80% Konfidenz)</div>
          </div>
        </div>

        <div className="bg-muted/20 rounded-lg p-3 border border-border">
          <div className="text-xs font-medium text-muted-foreground mb-1">Zusammenfassung</div>
          <p className="text-sm leading-relaxed text-foreground">{data.finalEstimate.summary}</p>
        </div>
      </div>
    </SectionCard>
  );
}

// === NEW Section 10: Technical Analysis Chart ===
type ChartRange = "1Y" | "3Y" | "5Y" | "10Y" | "MAX";

function Section10TechnicalChart({ data }: { data: BTCAnalysis }) {
  const [range, setRange] = useState<ChartRange>("1Y");

  const filteredData = useMemo(() => {
    const tc = data.technicalChart;
    if (!tc || tc.length === 0) return [];
    if (range === "MAX") return tc;

    const yearsMap: Record<ChartRange, number> = { "1Y": 1, "3Y": 3, "5Y": 5, "10Y": 10, MAX: 999 };
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - yearsMap[range]);
    const cutoffStr = cutoff.toISOString().split("T")[0];
    return tc.filter(d => d.date >= cutoffStr);
  }, [data.technicalChart, range]);

  if (!data.technicalChart || data.technicalChart.length === 0) {
    return (
      <SectionCard number={10} title="Technische Analyse">
        <div className="text-xs text-muted-foreground text-center py-8">Keine Chart-Daten verfügbar</div>
      </SectionCard>
    );
  }

  // Downsample for performance: max ~500 points
  const downsampled = useMemo(() => {
    if (filteredData.length <= 500) return filteredData;
    const step = Math.ceil(filteredData.length / 500);
    const result = filteredData.filter((_, i) => i % step === 0);
    // Always include the last data point
    if (result[result.length - 1] !== filteredData[filteredData.length - 1]) {
      result.push(filteredData[filteredData.length - 1]);
    }
    return result;
  }, [filteredData]);

  const formatYAxis = (v: number) => {
    if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `$${(v / 1000).toFixed(0)}k`;
    return `$${v.toFixed(0)}`;
  };

  const formatDateTick = (d: string) => {
    const date = new Date(d);
    if (range === "1Y") return date.toLocaleDateString("de-DE", { month: "short" });
    return date.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
  };

  const ranges: ChartRange[] = ["1Y", "3Y", "5Y", "10Y", "MAX"];

  return (
    <SectionCard number={10} title="Technische Analyse">
      <div className="space-y-3">
        {/* Range buttons */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {ranges.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  range === r
                    ? "bg-amber-500 text-white"
                    : "bg-muted/50 hover:bg-muted text-muted-foreground"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {downsampled.length} Datenpunkte
          </div>
        </div>

        {/* Price chart with MA lines */}
        <div className="bg-muted/10 rounded-lg border border-border p-2">
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={downsampled} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="btcTechGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9 }}
                tickFormatter={formatDateTick}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 9 }}
                tickFormatter={formatYAxis}
                domain={["auto", "auto"]}
                width={55}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number | null, name: string) => {
                  if (v === null || v === undefined) return ["–", name];
                  return [`$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, name];
                }}
                labelFormatter={(l) => new Date(l).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" })}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                iconType="line"
              />
              <Area
                type="monotone"
                dataKey="price"
                name="BTC Preis"
                stroke="#f59e0b"
                strokeWidth={1.5}
                fill="url(#btcTechGrad)"
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="ma50"
                name="MA50"
                stroke="#eab308"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="ma200"
                name="MA200"
                stroke="#f43f5e"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="6 3"
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* MACD subplot */}
        <div className="bg-muted/10 rounded-lg border border-border p-2">
          <div className="text-[10px] font-medium text-muted-foreground px-2 mb-1">MACD (12, 26, 9)</div>
          <ResponsiveContainer width="100%" height={130}>
            <ComposedChart data={downsampled} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9 }}
                tickFormatter={formatDateTick}
                interval="preserveStartEnd"
                minTickGap={40}
              />
              <YAxis
                tick={{ fontSize: 9 }}
                tickFormatter={(v) => v >= 1000 || v <= -1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(0)}
                width={45}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number | null, name: string) => {
                  if (v === null || v === undefined) return ["–", name];
                  return [v.toFixed(2), name];
                }}
                labelFormatter={(l) => new Date(l).toLocaleDateString("de-DE")}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
              <Bar dataKey="histogram" name="Histogram" maxBarSize={3}>
                {downsampled.map((d, i) => (
                  <Cell
                    key={i}
                    fill={(d.histogram ?? 0) >= 0 ? "#22c55e" : "#ef4444"}
                    fillOpacity={0.6}
                  />
                ))}
              </Bar>
              <Line type="monotone" dataKey="macd" name="MACD" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls />
              <Line type="monotone" dataKey="signal" name="Signal" stroke="#f97316" strokeWidth={1.5} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Current values */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MetricCard label="MA50" value={data.currentMA50 !== null ? `$${data.currentMA50.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "–"} />
          <MetricCard label="MA200" value={data.currentMA200 !== null ? `$${data.currentMA200.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "–"} />
          <MetricCard label="MACD" value={data.currentMACD !== null ? data.currentMACD.toFixed(2) : "–"} color={data.currentMACD !== null && data.currentMACD > 0 ? "text-emerald-500" : "text-red-500"} />
          <MetricCard label="Signal" value={data.currentSignal !== null ? data.currentSignal.toFixed(2) : "–"} />
        </div>
      </div>
    </SectionCard>
  );
}

// === NEW Section 11: Fear & Greed Professional ===
function FearGreedGauge({ value, label }: { value: number; label: string }) {
  // SVG semicircle gauge like CNN's Fear & Greed
  const cx = 150, cy = 130, r = 100;
  const startAngle = Math.PI; // 180 deg (left)
  const endAngle = 0; // 0 deg (right)

  // Colored arc segments: 0-25 (extreme fear), 25-45 (fear), 45-55 (neutral), 55-75 (greed), 75-100 (extreme greed)
  const segments = [
    { start: 0, end: 25, color: "#ef4444" },
    { start: 25, end: 45, color: "#f97316" },
    { start: 45, end: 55, color: "#eab308" },
    { start: 55, end: 75, color: "#84cc16" },
    { start: 75, end: 100, color: "#22c55e" },
  ];

  function polarToCartesian(angle: number) {
    return {
      x: cx + r * Math.cos(angle),
      y: cy - r * Math.sin(angle),
    };
  }

  function arcPath(startPct: number, endPct: number) {
    const a1 = startAngle - (startPct / 100) * Math.PI;
    const a2 = startAngle - (endPct / 100) * Math.PI;
    const p1 = polarToCartesian(a1);
    const p2 = polarToCartesian(a2);
    const largeArc = (endPct - startPct) > 50 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y}`;
  }

  // Needle angle
  const needleAngle = startAngle - (value / 100) * Math.PI;
  const needleLen = r - 15;
  const needleTip = {
    x: cx + needleLen * Math.cos(needleAngle),
    y: cy - needleLen * Math.sin(needleAngle),
  };

  const needleColor = value < 25 ? "#ef4444" : value < 45 ? "#f97316" : value < 55 ? "#eab308" : value < 75 ? "#84cc16" : "#22c55e";

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 300 160" className="w-full max-w-xs h-auto">
        {/* Colored arc segments */}
        {segments.map((seg, i) => (
          <path
            key={i}
            d={arcPath(seg.start, seg.end)}
            fill="none"
            stroke={seg.color}
            strokeWidth={18}
            strokeLinecap="butt"
          />
        ))}
        {/* Tick marks at segment boundaries */}
        {[0, 25, 45, 55, 75, 100].map((pct, i) => {
          const a = startAngle - (pct / 100) * Math.PI;
          const inner = { x: cx + (r - 12) * Math.cos(a), y: cy - (r - 12) * Math.sin(a) };
          const outer = { x: cx + (r + 12) * Math.cos(a), y: cy - (r + 12) * Math.sin(a) };
          return (
            <line key={i} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
              stroke="hsl(var(--background))" strokeWidth={2}
            />
          );
        })}
        {/* Needle */}
        <line x1={cx} y1={cy} x2={needleTip.x} y2={needleTip.y}
          stroke={needleColor} strokeWidth={3} strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={6} fill={needleColor} />
        <circle cx={cx} cy={cy} r={3} fill="hsl(var(--background))" />
        {/* Value text */}
        <text x={cx} y={cy + 32} textAnchor="middle" className="text-3xl font-bold font-mono" fill={needleColor} fontSize={36}>
          {value}
        </text>
        <text x={cx} y={cy + 50} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={12}>
          {label}
        </text>
        {/* Labels */}
        <text x={40} y={cy + 18} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={8}>Extreme Fear</text>
        <text x={260} y={cy + 18} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize={8}>Extreme Greed</text>
      </svg>
    </div>
  );
}

function Section11FearGreed({ data }: { data: BTCAnalysis }) {
  const fgh = data.fearGreedHistory || [];
  const stats = data.fearGreedStats;

  // Historical comparison values
  const yesterday = fgh.length >= 2 ? fgh[fgh.length - 2] : null;
  const oneWeek = fgh.length >= 8 ? fgh[fgh.length - 8] : null;
  const oneMonth = fgh.length >= 31 ? fgh[fgh.length - 31] : null;
  const oneYear = fgh.length >= 366 ? fgh[fgh.length - 366] : (fgh.length > 0 ? fgh[0] : null);

  function fgBadgeColor(val: number) {
    if (val < 25) return "bg-red-500/15 text-red-500 border-red-500/30";
    if (val < 45) return "bg-orange-500/15 text-orange-500 border-orange-500/30";
    if (val < 55) return "bg-yellow-500/15 text-yellow-500 border-yellow-500/30";
    if (val < 75) return "bg-lime-500/15 text-lime-500 border-lime-500/30";
    return "bg-emerald-500/15 text-emerald-500 border-emerald-500/30";
  }

  function fgLabel(val: number) {
    if (val < 25) return "Extreme Fear";
    if (val < 45) return "Fear";
    if (val < 55) return "Neutral";
    if (val < 75) return "Greed";
    return "Extreme Greed";
  }

  // Downsample history for chart: max 365 points
  const chartHistory = useMemo(() => {
    if (fgh.length <= 365) return fgh;
    const step = Math.ceil(fgh.length / 365);
    return fgh.filter((_, i) => i % step === 0);
  }, [fgh]);

  return (
    <SectionCard number={11} title="Fear & Greed Index">
      <div className="space-y-4">
        {/* Gauge */}
        <FearGreedGauge value={data.fearGreedIndex} label={data.fearGreedLabel} />

        {/* Historical comparison cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Gestern", data: yesterday },
            { label: "1 Woche", data: oneWeek },
            { label: "1 Monat", data: oneMonth },
            { label: "1 Jahr", data: oneYear },
          ].map((item) => (
            <div key={item.label} className="bg-muted/30 border border-border rounded-lg p-2.5 text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{item.label}</div>
              {item.data ? (
                <>
                  <div className="text-lg font-bold font-mono tabular-nums mt-1">{item.data.value}</div>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border mt-1 ${fgBadgeColor(item.data.value)}`}>
                    {fgLabel(item.data.value)}
                  </span>
                </>
              ) : (
                <div className="text-sm text-muted-foreground mt-1">–</div>
              )}
            </div>
          ))}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          <MetricCard label="30-Tage-Schnitt" value={stats.avg30 !== null ? stats.avg30.toFixed(0) : "–"} />
          <MetricCard label="90-Tage-Schnitt" value={stats.avg90 !== null ? stats.avg90.toFixed(0) : "–"} />
          <MetricCard label="Jahres-Schnitt" value={stats.avg365 !== null ? stats.avg365.toFixed(0) : "–"} />
          <MetricCard label="Jahreshoch" value={stats.yearHigh !== null ? `${stats.yearHigh}` : "–"} color="text-emerald-500" />
          <MetricCard label="Jahrestief" value={stats.yearLow !== null ? `${stats.yearLow}` : "–"} color="text-red-500" />
        </div>

        {/* Historical F&G chart with colored zones */}
        {chartHistory.length > 0 && (
          <div className="bg-muted/10 rounded-lg border border-border p-2">
            <div className="text-[10px] font-medium text-muted-foreground px-2 mb-1">Fear & Greed Verlauf (365 Tage)</div>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={chartHistory} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fgAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 9 }}
                  tickFormatter={(d) => new Date(d).toLocaleDateString("de-DE", { month: "short" })}
                  interval="preserveStartEnd"
                  minTickGap={50}
                />
                <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} width={30} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number) => [v, "F&G"]}
                  labelFormatter={(l) => new Date(l).toLocaleDateString("de-DE")}
                />
                {/* Zone reference areas - use ReferenceLine since ReferenceArea may not be imported */}
                <ReferenceLine y={25} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.4} />
                <ReferenceLine y={45} stroke="#f97316" strokeDasharray="3 3" strokeOpacity={0.4} />
                <ReferenceLine y={55} stroke="#eab308" strokeDasharray="3 3" strokeOpacity={0.4} />
                <ReferenceLine y={75} stroke="#84cc16" strokeDasharray="3 3" strokeOpacity={0.4} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  fill="url(#fgAreaGrad)"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="flex justify-between px-2 mt-1">
              <span className="text-[9px] text-red-500">Extreme Fear (&lt;25)</span>
              <span className="text-[9px] text-orange-500">Fear (25-45)</span>
              <span className="text-[9px] text-yellow-500">Neutral (45-55)</span>
              <span className="text-[9px] text-lime-500">Greed (55-75)</span>
              <span className="text-[9px] text-emerald-500">Extreme Greed (&gt;75)</span>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// === NEW Section 12: Bull/Bear Status & Signal Table ===
function Section12Signals({ data }: { data: BTCAnalysis }) {
  const bc = data.bullConditions;
  const signals = data.technicalSignals || [];
  const last20 = signals.slice(-20).reverse(); // newest first

  const conditions = [
    { label: "Kurs > MA200", active: bc.priceAboveMA200 },
    { label: "MA50 > MA200", active: bc.ma50AboveMA200 },
    { label: "MACD > 0", active: bc.macdAboveZero },
    { label: "MACD > Signal", active: bc.macdAboveSignal },
  ];

  return (
    <SectionCard number={12} title="Bull/Bear Status & Signale">
      <div className="space-y-4">
        {/* 4 status tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {conditions.map((c) => (
            <div
              key={c.label}
              className={`border rounded-lg p-3 flex items-center gap-2.5 ${
                c.active
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : "bg-red-500/10 border-red-500/30"
              }`}
            >
              {c.active ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              )}
              <div>
                <div className="text-xs font-medium">{c.label}</div>
                <div className={`text-[10px] font-bold ${c.active ? "text-emerald-500" : "text-red-500"}`}>
                  {c.active ? "Erfüllt" : "Nicht erfüllt"}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Status banner */}
        <div className={`rounded-lg p-3 border flex items-center gap-3 ${
          data.isBull
            ? "bg-emerald-500/10 border-emerald-500/30"
            : "bg-red-500/10 border-red-500/30"
        }`}>
          {data.isBull ? (
            <TrendingUp className="w-6 h-6 text-emerald-500 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0" />
          )}
          <div>
            <div className={`text-sm font-bold ${data.isBull ? "text-emerald-500" : "text-red-500"}`}>
              {data.isBull ? "BULL-Bedingungen erfüllt" : "BEAR-Warnung"}
            </div>
            <div className="text-xs text-muted-foreground">
              {data.isBull
                ? "Alle 4 technischen Bedingungen sind bullisch."
                : `${conditions.filter(c => c.active).length}/4 Bedingungen erfüllt — Vorsicht geboten.`
              }
            </div>
          </div>
        </div>

        {/* Current values */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MetricCard
            label="MA50"
            value={data.currentMA50 !== null ? `$${data.currentMA50.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "–"}
          />
          <MetricCard
            label="MA200"
            value={data.currentMA200 !== null ? `$${data.currentMA200.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "–"}
          />
          <MetricCard
            label="MACD"
            value={data.currentMACD !== null ? data.currentMACD.toFixed(2) : "–"}
            color={data.currentMACD !== null && data.currentMACD > 0 ? "text-emerald-500" : "text-red-500"}
          />
          <MetricCard
            label="Signal-Linie"
            value={data.currentSignal !== null ? data.currentSignal.toFixed(2) : "–"}
          />
        </div>

        {/* Signal Table */}
        {last20.length > 0 && (
          <div className="bg-muted/10 rounded-lg border border-border overflow-hidden">
            <div className="px-3 py-2 border-b border-border">
              <span className="text-xs font-medium">Letzte 20 Signale</span>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/20 sticky top-0">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Datum</th>
                    <th className="text-center py-2 px-3 font-medium text-muted-foreground">Signal</th>
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Grund</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Preis</th>
                  </tr>
                </thead>
                <tbody>
                  {last20.map((sig, i) => (
                    <tr key={i} className={`border-b border-border/30 ${i % 2 === 0 ? "bg-muted/5" : ""}`}>
                      <td className="py-2 px-3 font-mono tabular-nums text-muted-foreground">
                        {new Date(sig.date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                      </td>
                      <td className="py-2 px-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                          sig.type === "BUY"
                            ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                            : "bg-red-500/15 text-red-500 border-red-500/30"
                        }`}>
                          {sig.type}
                        </span>
                      </td>
                      <td className="py-2 px-3">{sig.reason}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        ${sig.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

// === Main Dashboard ===
export default function BTCDashboard() {
  const { theme, toggleTheme } = useTheme();
  const [data, setData] = useState<BTCAnalysis | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [, setLocation] = useLocation();

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      try {
        return await analyzeBTC() as BTCAnalysis;
      } catch {
        const fallback = await fetch("./btc-data.json");
        if (!fallback.ok) throw new Error("BTC-Daten konnten nicht geladen werden");
        return fallback.json() as Promise<BTCAnalysis>;
      }
    },
    onSuccess: (result) => {
      setData(result);
      mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  const scrollToSection = useCallback((id: number) => {
    const el = sectionRefs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
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
          <div className="flex items-center gap-2">
            <Bitcoin className="w-5 h-5 text-amber-500" />
            <span className="text-sm font-semibold tracking-tight hidden sm:block">BTC-Analyse</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <div className="hidden sm:flex items-center gap-2 text-xs">
              <span className="font-mono tabular-nums font-bold text-amber-500">BTC</span>
              <span className="text-muted-foreground">Bitcoin</span>
              <span className="text-muted-foreground">&bull;</span>
              <span className="font-mono tabular-nums font-semibold">
                ${data.btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>
            </div>
          )}
          <button
            onClick={() => setLocation("/")}
            className="h-8 px-3 text-xs font-medium bg-muted/50 hover:bg-muted border border-border rounded-md transition-colors flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3 h-3" />
            Aktien
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
        <aside className={`
          fixed lg:relative inset-y-0 left-0 top-12 lg:top-0 z-30 lg:z-0
          w-52 bg-card border-r border-border
          transition-transform duration-200 ease-in-out
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          overflow-y-auto overscroll-contain custom-scrollbar
        `}>
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

        {/* Main content */}
        <main ref={mainRef} className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar">
          {!data && !analyzeMutation.isPending ? (
            <BTCWelcomeScreen onAnalyze={() => analyzeMutation.mutate()} />
          ) : analyzeMutation.isPending ? (
            <BTCLoadingScreen />
          ) : analyzeMutation.isError ? (
            <BTCErrorScreen error={analyzeMutation.error} />
          ) : data ? (
            <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-3">
              <div ref={setSectionRef(1)}><Section1Status data={data} /></div>
              <div ref={setSectionRef(2)}><Section2Halving data={data} /></div>
              <div ref={setSectionRef(3)}><Section3Indicators data={data} /></div>
              <div ref={setSectionRef(4)}><Section4PowerLaw data={data} /></div>
              <div ref={setSectionRef(5)}><Section5GWS data={data} /></div>
              <div ref={setSectionRef(6)}><Section6MonteCarlo data={data} /></div>
              <div ref={setSectionRef(7)}><Section7Categories data={data} /></div>
              <div ref={setSectionRef(8)}><Section8CycleAssessment data={data} /></div>
              <div ref={setSectionRef(9)}><Section9FinalEstimate data={data} /></div>
              <div ref={setSectionRef(10)}><Section10TechnicalChart data={data} /></div>
              <div ref={setSectionRef(11)}><Section11FearGreed data={data} /></div>
              <div ref={setSectionRef(12)}><Section12Signals data={data} /></div>
              <div className="pb-8" />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function BTCWelcomeScreen({ onAnalyze }: { onAnalyze: () => void }) {
  const [, setLocation] = useLocation();
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="max-w-lg text-center space-y-6">
        <div className="flex justify-center">
          <Bitcoin className="w-12 h-12 text-amber-500 opacity-60" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">BTC-Analyse</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Umfassende Bitcoin-Bewertung mit Power-Law-Modell, Monte Carlo Simulation,
            Halving-Zyklus-Analyse und 7-Indikatoren-Scoring.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={onAnalyze}
            className="px-6 py-3 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 transition-colors flex items-center gap-2"
          >
            <Bitcoin className="w-4 h-4" />
            BTC-Analyse starten
          </button>
          <button
            onClick={() => setLocation("/")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <ArrowLeft className="w-3 h-3" />
            Zurück zur Aktien-Analyse
          </button>
        </div>
        <div className="flex items-center gap-2 justify-center text-[10px] text-muted-foreground/50">
          <ChevronRight className="w-3 h-3" />
          Daten von CoinGecko, FRED, Yahoo Finance
        </div>
      </div>
    </div>
  );
}

function BTCLoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="text-center space-y-4">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <div>
          <div className="text-sm font-medium">Bitcoin wird analysiert...</div>
          <div className="text-xs text-muted-foreground mt-1">Power-Law, Monte Carlo, Indikatoren</div>
        </div>
      </div>
    </div>
  );
}

function BTCErrorScreen({ error }: { error: Error }) {
  return (
    <div className="flex items-center justify-center min-h-full p-8">
      <div className="text-center space-y-3 max-w-sm">
        <div className="text-red-500 text-xl">&#9888;</div>
        <div className="text-sm font-medium">BTC-Analyse fehlgeschlagen</div>
        <div className="text-xs text-muted-foreground">{error.message}</div>
      </div>
    </div>
  );
}
