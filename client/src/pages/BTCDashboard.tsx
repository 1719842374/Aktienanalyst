import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useTheme } from "@/components/ThemeProvider";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { SectionCard } from "@/components/SectionCard";
import { RechenWeg } from "@/components/RechenWeg";
import { formatCurrency, formatLargeNumber, formatPercent, getChangeColor } from "@/lib/formatters";
import { useLocation } from "wouter";
import {
  Sun, Moon, Bitcoin, TrendingUp, Activity, Calculator,
  LineChart, Target, Scale, BarChart3, Dice6, Table2,
  Menu, X, ChevronRight, Gauge, Layers, ArrowLeft,
} from "lucide-react";
import {
  LineChart as ReLineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Area, AreaChart, BarChart, Bar,
  Cell, ReferenceLine, PieChart, Pie,
} from "recharts";

// === Types ===
interface BTCIndicator {
  name: string;
  value: string;
  score: number;
  weight: number;
  weighted: number;
  source: string;
}

interface BTCAnalysis {
  timestamp: string;
  btcPrice: number;
  btcChange24h: number;
  btcMarketCap: number;
  lastHalvingDate: string;
  monthsSinceHalving: number;
  nextHalvingEstimate: string;
  cyclePhase: string;
  indicators: BTCIndicator[];
  gis: number;
  gisCalculation: string;
  powerLaw: {
    daysSinceGenesis: number;
    fairValue: number;
    support: number;
    resistance: number;
    deviationPercent: number;
    fairValue6M: number;
    powerSignal: number;
  };
  gws: {
    gis: number;
    powerSignal: number;
    cycleSignal: number;
    value: number;
    mu: number;
    interpretation: string;
  };
  monteCarlo: {
    sigma: number;
    sigmaAdj: number;
    mu: number;
    threeMonth: {
      p10: number; p50: number; p90: number; mean: number;
      probBelow: number; probAbove120: number;
    };
    sixMonth: {
      p10: number; p50: number; p90: number; mean: number;
      probBelow: number; probAbove120: number;
    };
  };
  categories: { label: string; range: string; probability: number }[];
  cycleAssessment: {
    position: string;
    entryPoint: string;
    halvingCatalyst: string;
  };
  finalEstimate: {
    threeMonthRange: string;
    sixMonthRange: string;
    outlook: string;
    summary: string;
  };
  historicalPrices: { date: string; price: number }[];
  historicalPricesYear: { date: string; price: number }[];
  fearGreedIndex: number;
  fearGreedLabel: string;
  dxy: number;
  fedFundsRate: number;
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
  { id: 10, label: "Preis-Chart", icon: LineChart },
  { id: 11, label: "Fear & Greed", icon: Gauge },
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
  // Cycle progress bar: 0 to ~48 months
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

        {/* Cycle timeline */}
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

  // Build power-law visualization data
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

        {/* Power-Law Corridor visualization */}
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

  // GWS components bar chart
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

        {/* GWS Components Chart */}
        <div className="bg-muted/20 rounded-lg p-3 border border-border">
          <div className="text-xs font-medium text-muted-foreground mb-2">GWS Komponenten</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={gwsComponents} layout="vertical">
              <XAxis type="number" domain={[-0.6, 0.6]} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
              <Tooltip
                contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                formatter={(v: number) => v.toFixed(4)}
              />
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

  // Build distribution data for visualization
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
        {/* Parameters */}
        <div className="grid grid-cols-3 gap-3">
          <MetricCard label="σ (Basis)" value={mc.sigma.toFixed(4)} />
          <MetricCard label="σ (adjustiert)" value={mc.sigmaAdj.toFixed(4)} />
          <MetricCard label="μ (Drift)" value={mc.mu.toFixed(4)} />
        </div>

        {/* 3-Month Results */}
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

          {/* Bar visualization */}
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={distData3M}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                formatter={(v: number) => fmt(v)}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {distData3M.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 6-Month Results */}
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
              <Tooltip
                contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                formatter={(v: number) => fmt(v)}
              />
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
                <ProgressBar value={cat.probability} max={50} color={`bg-[${catColors[cat.label]}]`} />
                <div className="w-full h-2 bg-muted/50 rounded-full overflow-hidden -mt-2">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(cat.probability / 50 * 100, 100)}%`, backgroundColor: catColors[cat.label] }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Pie chart */}
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
              <Tooltip
                contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                formatter={(v: number) => `${v.toFixed(1)}%`}
              />
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

function Section10PriceChart({ data }: { data: BTCAnalysis }) {
  const [range, setRange] = useState<"1M" | "1Y">("1M");
  const chartData = range === "1M" ? data.historicalPrices : data.historicalPricesYear;

  if (chartData.length === 0) {
    return (
      <SectionCard number={10} title="Preis-Chart">
        <div className="text-xs text-muted-foreground text-center py-8">Keine Chart-Daten verfügbar</div>
      </SectionCard>
    );
  }

  return (
    <SectionCard number={10} title="Preis-Chart">
      <div className="space-y-3">
        <div className="flex gap-1">
          {(["1M", "1Y"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                range === r ? "bg-primary text-primary-foreground" : "bg-muted/50 hover:bg-muted text-muted-foreground"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="btcGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(d) => {
                const date = new Date(d);
                return date.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
              }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
              formatter={(v: number) => [`$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, "BTC"]}
              labelFormatter={(l) => new Date(l).toLocaleDateString("de-DE")}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#btcGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}

function Section11FearGreed({ data }: { data: BTCAnalysis }) {
  const fgi = data.fearGreedIndex;
  const color = fgi < 25 ? "#ef4444" : fgi < 40 ? "#f97316" : fgi < 60 ? "#f59e0b" : fgi < 75 ? "#84cc16" : "#22c55e";
  const rotation = (fgi / 100) * 180 - 90; // -90 to 90 degrees

  return (
    <SectionCard number={11} title="Fear & Greed Index">
      <div className="flex flex-col items-center space-y-3">
        {/* Gauge visualization */}
        <div className="relative w-48 h-28">
          <svg viewBox="0 0 200 110" className="w-full h-full">
            {/* Background arc */}
            <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="hsl(var(--border))" strokeWidth="12" strokeLinecap="round" />
            {/* Colored segments */}
            <path d="M 20 100 A 80 80 0 0 1 52 42" fill="none" stroke="#ef4444" strokeWidth="12" strokeLinecap="round" />
            <path d="M 52 42 A 80 80 0 0 1 100 20" fill="none" stroke="#f97316" strokeWidth="12" strokeLinecap="round" />
            <path d="M 100 20 A 80 80 0 0 1 148 42" fill="none" stroke="#f59e0b" strokeWidth="12" strokeLinecap="round" />
            <path d="M 148 42 A 80 80 0 0 1 180 100" fill="none" stroke="#22c55e" strokeWidth="12" strokeLinecap="round" />
            {/* Needle */}
            <line
              x1="100" y1="100"
              x2={100 + 60 * Math.cos((rotation * Math.PI) / 180)}
              y2={100 - 60 * Math.sin((rotation * Math.PI) / 180)}
              stroke={color}
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="100" cy="100" r="5" fill={color} />
          </svg>
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold font-mono" style={{ color }}>{fgi}</div>
          <div className="text-sm font-medium text-muted-foreground">{data.fearGreedLabel}</div>
        </div>
        <div className="flex justify-between w-full text-[10px] text-muted-foreground px-4">
          <span>Extreme Fear</span>
          <span>Fear</span>
          <span>Neutral</span>
          <span>Greed</span>
          <span>Extreme Greed</span>
        </div>
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
      const res = await apiRequest("POST", "/api/analyze-btc", {});
      return res.json() as Promise<BTCAnalysis>;
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
              <div ref={setSectionRef(10)}><Section10PriceChart data={data} /></div>
              <div ref={setSectionRef(11)}><Section11FearGreed data={data} /></div>
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
