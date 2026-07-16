import { useState, useRef, useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { analyzeBTC } from "@/lib/btcAnalysis";
import { BTC_FALLBACK_DATA } from "@/lib/btcFallbackData";
import { useTheme } from "@/components/ThemeProvider";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { SectionCard } from "@/components/SectionCard";
import { RechenWeg } from "@/components/RechenWeg";
import { formatCurrency, formatLargeNumber, formatPercent, getChangeColor } from "@/lib/formatters";
import { gbmMonteCarlo, type GBMMonteCarloResult } from "@/lib/calculations";
import { useLocation } from "wouter";
import {
  Sun, Moon, Bitcoin, TrendingUp, TrendingDown, Activity, Calculator,
  LineChart as LineChartIcon, Target, Scale, BarChart3, Dice6,
  Menu, X, ChevronRight, Gauge, Layers, ArrowLeft,
  CheckCircle2, XCircle, AlertTriangle, Eye, EyeOff,
  RefreshCw, Search, Sparkles,
} from "lucide-react";
import {
  LineChart as ReLineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Area, AreaChart, BarChart, Bar,
  Cell, ReferenceLine, ReferenceArea, PieChart, Pie, ComposedChart, Legend,
} from "recharts";

// === RSI(14) Wilder Smoothing (analog TechnicalChart.tsx) ===
function calcRSI(prices: number[], period = 14): (number | null)[] {
  const rsi: (number | null)[] = [];
  if (prices.length < period + 1) return prices.map(() => null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    diff > 0 ? (avgGain += diff / period) : (avgLoss += Math.abs(diff) / period);
  }
  for (let i = 0; i < period; i++) rsi.push(null);
  const rs0 = avgGain / (avgLoss || 1e-10);
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0));
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    const rs = avgGain / (avgLoss || 1e-10);
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + rs));
  }
  return rsi;
}

// === Types ===
interface TechChartPoint {
  date: string; price: number;
  volume?: number; _volNorm?: number; _volUp?: boolean;
  ma20: number | null; ma50: number | null; ma100: number | null; ma200: number | null;
  ema9: number | null; ema12: number | null; ema26: number | null;
  macd: number | null; signal: number | null; histogram: number | null;
  ma730: number | null; ma730x5: number | null;
  ma111: number | null; ma350x2: number | null; ma350: number | null;
  ma1400: number | null;
  rsi14?: number | null;
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
    threeMonth: { p5: number; p10: number; p25: number; p50: number; p75: number; p90: number; p95: number; mean: number; probBelow: number; probAbove120: number; downsideProb10: number; downsideProb20: number; histogram: { bin: string; count: number; midPrice: number; }[]; };
    sixMonth: { p5: number; p10: number; p25: number; p50: number; p75: number; p90: number; p95: number; mean: number; probBelow: number; probAbove120: number; downsideProb10: number; downsideProb20: number; histogram: { bin: string; count: number; midPrice: number; }[]; };
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
  technicalChart: TechChartPoint[];
  technicalChartFull: TechChartPoint[];
  technicalSignals: { date: string; type: "BUY" | "SELL"; reason: string; price: number; }[];
  bullConditions: { priceAboveMA200: boolean; ma50AboveMA200: boolean; macdAboveZero: boolean; macdAboveSignal: boolean; macdRising: boolean; };
  isBull: boolean;
  currentMA20: number | null;
  currentMA50: number | null;
  currentMA100: number | null;
  currentMA200: number | null;
  currentEMA9: number | null;
  currentMACD: number | null;
  currentSignal: number | null;
  fearGreedHistory: { date: string; value: number; classification: string; }[];
  fearGreedStats: { avg30: number | null; avg90: number | null; avg365: number | null; yearHigh: number | null; yearLow: number | null; };
  historicalVol?: {
    vol30d: number; vol90d: number; vol365d: number;
    volAnn30d: number; volAnn90d: number; volAnn365d: number;
  };
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
  { id: 12, label: "Gesamt-Fazit", icon: Scale },
];

const DASHBOARD_LINKS = [
  { label: "Aktien", href: "/", icon: ArrowLeft, color: "text-primary", border: "border-primary/25", bg: "hover:bg-primary/10" },
  { label: "Gold", href: "/gold", icon: Scale, color: "text-amber-500", border: "border-amber-500/25", bg: "hover:bg-amber-500/10" },
  { label: "Rezession", href: "/recession", icon: AlertTriangle, color: "text-orange-500", border: "border-orange-500/25", bg: "hover:bg-orange-500/10" },
  { label: "Screener", href: "/screener", icon: Search, color: "text-cyan-500", border: "border-cyan-500/25", bg: "hover:bg-cyan-500/10" },
  { label: "Researcher", href: "/researcher", icon: Sparkles, color: "text-violet-400", border: "border-violet-400/25", bg: "hover:bg-violet-500/10" },
  { label: "Vergleich", href: "/compare", icon: BarChart3, color: "text-muted-foreground", border: "border-border", bg: "hover:bg-muted/50" },
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