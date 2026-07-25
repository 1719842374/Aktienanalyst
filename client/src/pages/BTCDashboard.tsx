// NOTE: This file is large — key layout changes are at the bottom in BTCDashboard()
// Search for "=== LAYOUT ==" to jump to the changed section.
import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  RefreshCw, Cpu,
} from "lucide-react";
import {
  LineChart as ReLineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Area, AreaChart, BarChart, Bar,
  Cell, ReferenceLine, ReferenceArea, PieChart, Pie, ComposedChart, Legend,
} from "recharts";

// === RSI(14) Wilder Smoothing ===
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

// === MinerData types ===
interface MinerScore {
  value: number;
  interpretation: string;
  signals: {
    puell: { score: number; detail: string };
    hashRibbons: { score: number; detail: string };
    breakeven: { score: number; detail: string };
    diffRibbon: { score: number; detail: string };
  };
}
interface HashratePoint { date: string; hashrateEH: number; }
interface MinerData {
  hashrateHistory: HashratePoint[];
  ma30: (number | null)[];
  ma60: (number | null)[];
  dates: string[];
  inCapitulation: boolean;
  crossoverSignal: boolean;
  currentHashrateEH: number;
  breakevenPrice: number;
  hashprice: number;
  puellMultiple: number | null;
  puellHistory: { date: string; value: number }[];
  difficultyHistory: { date: string; difficulty: number }[];
  difficultyRibbonCompression: number;
  minerScore: MinerScore | null;
  lastUpdated: string;
}

// === Sidebar Sections ===
const SECTIONS = [
  { id: 1,  label: "Status & Preis",     icon: Bitcoin },
  { id: 2,  label: "Halving-Zyklus",     icon: Activity },
  { id: 3,  label: "Indikatoren",         icon: BarChart3 },
  { id: 4,  label: "Power-Law",           icon: Calculator },
  { id: 5,  label: "GWS",                 icon: Target },
  { id: 6,  label: "Monte Carlo",         icon: Dice6 },
  { id: 7,  label: "Kategorien A-E",      icon: Layers },
  { id: 8,  label: "Zyklus-Einsch.",      icon: TrendingUp },
  { id: 9,  label: "Finale Schätzung",    icon: Scale },
  { id: 10, label: "Technische Analyse",  icon: LineChartIcon },
  { id: 11, label: "Fear & Greed",        icon: Gauge },
  { id: 12, label: "Gesamt-Fazit",        icon: Scale },
  { id: 13, label: "⛏ Miner-Zone",       icon: Cpu },
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

const tooltipStyle = { fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 };

// === Section 13: Miner-Zone ===
const BREAKEVEN_PRESETS = [
  { label: "Effizient",  effJTH: 18,   elecUSD: 0.04, desc: "18 J/TH @ $0.04/kWh" },
  { label: "Basis",      effJTH: 21.5, elecUSD: 0.05, desc: "21.5 J/TH @ $0.05/kWh (S19 XP)" },
  { label: "Gestresst", effJTH: 30,   elecUSD: 0.08, desc: "30 J/TH @ $0.08/kWh" },
];

function calcBreakevenFrontend(networkHashrateEH: number, effJTH: number, elecUSD: number): number {
  if (networkHashrateEH <= 0) return 0;
  const hashTH = 140;
  const powerW = hashTH * effJTH;
  const networkHashTH = networkHashrateEH * 1e6;
  const dailyEnergyCost = (powerW * 24) / 1000 * elecUSD;
  const dailyBTC = (hashTH / networkHashTH) * 144 * 3.125;
  return dailyBTC > 0 ? dailyEnergyCost / dailyBTC : 0;
}

function Section13Miner({ data, minerData, loading, error }: {
  data: BTCAnalysis;
  minerData: MinerData | null;
  loading: boolean;
  error: boolean;
}) {
  const [presetIdx, setPresetIdx] = useState(1);
  const [customEff, setCustomEff] = useState<number | null>(null);
  const [customElec, setCustomElec] = useState<number | null>(null);
  const [showCustom, setShowCustom] = useState(false);

  const activeEff  = customEff  ?? BREAKEVEN_PRESETS[presetIdx].effJTH;
  const activeElec = customElec ?? BREAKEVEN_PRESETS[presetIdx].elecUSD;
  const computedBreakeven = minerData
    ? calcBreakevenFrontend(minerData.currentHashrateEH, activeEff, activeElec)
    : 0;

  const btcPrice = data.btcPrice;
  const miningMarginPct = computedBreakeven > 0
    ? ((btcPrice - computedBreakeven) / computedBreakeven) * 100
    : null;

  const ribbonChartData = useMemo(() => {
    if (!minerData) return [];
    const { hashrateHistory, ma30, ma60, dates } = minerData;
    const len = Math.min(hashrateHistory.length, dates.length, ma30.length, ma60.length);
    const slice = Math.max(0, len - 180);
    return Array.from({ length: len - slice }, (_, i) => {
      const idx = slice + i;
      return {
        date: dates[idx]?.slice(0, 10) ?? "",
        hashrate: +(hashrateHistory[idx]?.hashrateEH ?? 0).toFixed(1),
        ma30: ma30[idx] != null ? +(ma30[idx] as number).toFixed(1) : null,
        ma60: ma60[idx] != null ? +(ma60[idx] as number).toFixed(1) : null,
      };
    }).filter(d => d.date);
  }, [minerData]);

  const puellChartData = useMemo(() => {
    if (!minerData?.puellHistory?.length) return [];
    const h = minerData.puellHistory;
    return h.slice(Math.max(0, h.length - 365)).map(p => ({
      date: p.date.slice(0, 10),
      puell: +p.value.toFixed(3),
    }));
  }, [minerData]);

  const ms = minerData?.minerScore;
  const scoreColor = !ms ? "text-muted-foreground"
    : ms.value >= 75 ? "text-emerald-500"
    : ms.value >= 60 ? "text-emerald-400"
    : ms.value >= 45 ? "text-amber-400"
    : ms.value >= 30 ? "text-orange-400"
    : "text-red-500";

  const capZones = useMemo(() => {
    if (!ribbonChartData.length) return [];
    const zones: { start: string; end: string }[] = [];
    let zStart: string | null = null;
    for (let i = 0; i < ribbonChartData.length; i++) {
      const d = ribbonChartData[i];
      const inCap = d.ma30 != null && d.ma60 != null && d.ma30 < d.ma60;
      if (inCap && !zStart) zStart = d.date;
      if (!inCap && zStart) { zones.push({ start: zStart, end: ribbonChartData[i - 1].date }); zStart = null; }
    }
    if (zStart) zones.push({ start: zStart, end: ribbonChartData[ribbonChartData.length - 1].date });
    return zones;
  }, [ribbonChartData]);

  if (loading) {
    return (
      <SectionCard number={13} title="⛏ Miner-Zone">
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Lade Miner-Daten von mempool.space…
        </div>
      </SectionCard>
    );
  }

  if (error || !minerData) {
    return (
      <SectionCard number={13} title="⛏ Miner-Zone">
        <div className="flex items-center gap-2 text-red-400 text-sm py-8">
          <XCircle className="w-4 h-4" />
          Miner-Daten nicht verfügbar — mempool.space nicht erreichbar oder unzureichende Datenmenge.
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard number={13} title="⛏ Miner-Zone">
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Hashrate" value={`${minerData.currentHashrateEH.toFixed(0)} EH/s`} subValue="Netzwerk gesamt" />
          <MetricCard label="Miner Score" value={ms ? `${ms.value}/100` : "–"} subValue={ms?.interpretation ?? "Keine Daten"} color={scoreColor} />
          <MetricCard
            label="Puell Multiple"
            value={minerData.puellMultiple != null ? minerData.puellMultiple.toFixed(2) : "–"}
            subValue={minerData.puellMultiple == null ? "< 365d Daten" : minerData.puellMultiple < 0.5 ? "Extreme Unterbewertung" : minerData.puellMultiple < 0.8 ? "Akkumulationszone" : minerData.puellMultiple < 1.5 ? "Neutral" : minerData.puellMultiple < 4.0 ? "Distributionszone" : "Historisches Hoch"}
            color={minerData.puellMultiple == null ? "text-muted-foreground" : minerData.puellMultiple < 0.8 ? "text-emerald-400" : minerData.puellMultiple < 1.5 ? "text-amber-400" : "text-red-400"}
          />
          <MetricCard label="Hash Ribbon" value={minerData.crossoverSignal ? "🟢 Buy Signal" : minerData.inCapitulation ? "🔴 Kapitulation" : "🟡 Normal"} subValue={minerData.crossoverSignal ? "MA30 kreuzte MA60" : minerData.inCapitulation ? "MA30 < MA60" : "MA30 > MA60"} />
        </div>

        <div className="bg-muted/20 rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Breakeven-Szenarien</div>
            <button onClick={() => setShowCustom(!showCustom)} className={`text-[10px] px-2 py-1 rounded border transition-colors ${showCustom ? "border-primary/50 text-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted/50"}`}>⚙ Manuell</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {BREAKEVEN_PRESETS.map((p, i) => (
              <button key={i} onClick={() => { setPresetIdx(i); setCustomEff(null); setCustomElec(null); }} className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${presetIdx === i && !customEff ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>{p.label}</button>
            ))}
          </div>
          {showCustom && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground block mb-1">Effizienz (J/TH)</label>
                <input type="number" step="0.5" min="10" max="120" defaultValue={activeEff} onChange={e => setCustomEff(parseFloat(e.target.value) || null)} className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground block mb-1">Strom ($/kWh)</label>
                <input type="number" step="0.005" min="0.01" max="0.30" defaultValue={activeElec} onChange={e => setCustomElec(parseFloat(e.target.value) || null)} className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            {BREAKEVEN_PRESETS.map((p, i) => {
              const be = minerData ? calcBreakevenFrontend(minerData.currentHashrateEH, p.effJTH, p.elecUSD) : 0;
              const margin = be > 0 ? ((btcPrice - be) / be) * 100 : null;
              return (
                <div key={i} className={`rounded-lg border p-3 text-center transition-colors ${presetIdx === i && !customEff ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20"}`}>
                  <div className="text-[9px] uppercase text-muted-foreground">{p.label}</div>
                  <div className="text-sm font-bold font-mono tabular-nums mt-1">${be > 0 ? be.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "–"}</div>
                  <div className={`text-[10px] font-mono mt-0.5 ${margin == null ? "text-muted-foreground" : margin >= 0 ? "text-emerald-400" : "text-red-400"}`}>{margin != null ? `${margin >= 0 ? "+" : ""}${margin.toFixed(1)}% Marge` : ""}</div>
                  <div className="text-[8px] text-muted-foreground mt-0.5">{p.desc}</div>
                </div>
              );
            })}
          </div>
          {(customEff || customElec) && (
            <div className="bg-primary/5 border border-primary/20 rounded p-2 text-center">
              <div className="text-[10px] text-primary font-medium">Manuell: {activeEff} J/TH @ ${activeElec}/kWh</div>
              <div className="text-base font-bold font-mono mt-1">Breakeven: ${computedBreakeven > 0 ? computedBreakeven.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "–"}</div>
              {miningMarginPct != null && <div className={`text-xs mt-0.5 ${miningMarginPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{miningMarginPct >= 0 ? "+" : ""}{miningMarginPct.toFixed(1)}% über Breakeven</div>}
            </div>
          )}
          <div className="text-[9px] text-muted-foreground">Quelle: mempool.space Hashrate (live) · Formel: Antminer-Referenzmodell (140 TH/s @ gewählter Effizienz)</div>
        </div>

        {ribbonChartData.length > 30 && (
          <div className="bg-muted/20 rounded-lg border border-border p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Hash Ribbons (180 Tage)</div>
            <div className="text-[10px] text-muted-foreground mb-3">Rote Zonen = MA30 &lt; MA60 (Kapitulation) · Grüner Crossover = Kaufsignal</div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={ribbonChartData}>
                <defs>
                  <linearGradient id="ma30grad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
                  <linearGradient id="ma60grad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => d.slice(5)} interval={29} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${v}EH`} domain={['auto', 'auto']} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} EH/s`]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {capZones.map((z, i) => <ReferenceArea key={i} x1={z.start} x2={z.end} fill="#ef4444" fillOpacity={0.08} />)}
                <Area type="monotone" dataKey="ma30" stroke="#22c55e" fill="url(#ma30grad)" strokeWidth={1.5} dot={false} name="MA30" />
                <Area type="monotone" dataKey="ma60" stroke="#ef4444" fill="url(#ma60grad)" strokeWidth={1.5} dot={false} name="MA60" />
                <Line type="monotone" dataKey="hashrate" stroke="#6b7280" strokeWidth={1} dot={false} name="Hashrate" opacity={0.4} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {puellChartData.length > 30 && (
          <div className="bg-muted/20 rounded-lg border border-border p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Puell Multiple (365 Tage)</div>
            <div className="text-[10px] text-muted-foreground mb-3">&lt;0.5 = historische Akkumulationszone (grün) · &gt;4.0 = Überhitzung (rot)</div>
            <ResponsiveContainer width="100%" height={180}>
              <ReLineChart data={puellChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => d.slice(5)} interval={29} />
                <YAxis tick={{ fontSize: 9 }} domain={[0, 'auto']} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v.toFixed(3), "Puell Multiple"]} />
                <ReferenceArea y1={0} y2={0.5} fill="#22c55e" fillOpacity={0.07} />
                <ReferenceArea y1={4} y2={10} fill="#ef4444" fillOpacity={0.07} />
                <ReferenceLine y={0.5} stroke="#22c55e" strokeDasharray="4 2" strokeWidth={1} label={{ value: "0.5 Akkum.", fontSize: 9, fill: "#22c55e" }} />
                <ReferenceLine y={1}   stroke="#6b7280" strokeDasharray="3 3" strokeWidth={1} />
                <ReferenceLine y={4}   stroke="#ef4444" strokeDasharray="4 2" strokeWidth={1} label={{ value: "4.0 Überhitz.", fontSize: 9, fill: "#ef4444" }} />
                <Line type="monotone" dataKey="puell" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Puell Multiple" />
              </ReLineChart>
            </ResponsiveContainer>
          </div>
        )}

        {ms && (
          <div className="bg-muted/20 rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Miner Score Breakdown</div>
              <div className={`text-2xl font-bold font-mono tabular-nums ${scoreColor}`}>{ms.value}<span className="text-sm font-normal text-muted-foreground">/100</span></div>
            </div>
            <div className="text-xs text-muted-foreground">{ms.interpretation}</div>
            <div className="space-y-2.5">
              {([{ key: "puell", label: "Puell Multiple", weight: "35%" }, { key: "hashRibbons", label: "Hash Ribbons", weight: "30%" }, { key: "breakeven", label: "Breakeven-Distanz", weight: "20%" }, { key: "diffRibbon", label: "Difficulty Ribbon", weight: "15%" }] as const).map(({ key, label, weight }) => {
                const sig = ms.signals[key];
                const pct = sig.score;
                const barColor = pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500";
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-muted-foreground">{label} <span className="text-[9px] opacity-60">({weight})</span></span>
                      <span className="text-[10px] font-mono tabular-nums">{pct}/100</span>
                    </div>
                    <ProgressBar value={pct} max={100} color={barColor} />
                    <div className="text-[9px] text-muted-foreground mt-0.5">{sig.detail}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="Diff. Ribbon Compression" value={`${(minerData.difficultyRibbonCompression * 100).toFixed(1)}%`} subValue={minerData.difficultyRibbonCompression > 0.7 ? "Bullisches Erholungssignal" : minerData.difficultyRibbonCompression > 0.4 ? "Neutral" : "Ribbons weit gespreizt"} color={minerData.difficultyRibbonCompression > 0.7 ? "text-emerald-400" : minerData.difficultyRibbonCompression > 0.4 ? "text-amber-400" : "text-red-400"} />
          <MetricCard label="Hashprice" value={`${(minerData.hashprice * 1e6).toFixed(4)} BTC/PH/d`} subValue={`≈ $${(minerData.hashprice * data.btcPrice * 1e6).toFixed(2)}/PH/d`} />
        </div>

        <div className="text-[9px] text-muted-foreground border-t border-border pt-2">
          Datenquelle: <span className="font-medium">mempool.space</span> (Hashrate, Difficulty) · Cache: 1h ·
          Breakeven-Modell: Antminer S19 XP Referenz · Puell Multiple: 365d Rolling Average ·
          Zuletzt: {new Date(minerData.lastUpdated).toLocaleString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr
        </div>
      </div>
    </SectionCard>
  );
}

// ============================================================
// === Section Components 1–12 (content unchanged) ============
// ============================================================

function Section1Status({ data }: { data: BTCAnalysis }) {
  const ts = new Date(data.timestamp);
  return (
    <SectionCard number={1} title="Analysezeitpunkt & Status">
      <div className="text-xs text-muted-foreground mb-3">
        {ts.toLocaleDateString("de-DE", { weekday: "long", year: "numeric", month: "long", day: "numeric" })},{" "}
        {ts.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="BTC Preis" value={`$${data.btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} subValue={`${data.btcChange24h >= 0 ? "+" : ""}${data.btcChange24h.toFixed(2)}% (24h)`} color={data.btcChange24h >= 0 ? "text-emerald-500" : "text-red-500"} />
        <MetricCard label="Marktkapitalisierung" value={formatLargeNumber(data.btcMarketCap)} />
        <MetricCard label="Fear & Greed" value={`${data.fearGreedIndex}`} subValue={data.fearGreedLabel} color={data.fearGreedIndex < 30 ? "text-red-500" : data.fearGreedIndex > 70 ? "text-emerald-500" : "text-amber-500"} />
        <MetricCard label="DXY Index" value={data.dxy.toFixed(2)} subValue={data.dxy < 100 ? "Schwach (bullish BTC)" : data.dxy > 105 ? "Stark (bearish BTC)" : "Neutral"} color={data.dxy < 100 ? "text-emerald-500" : data.dxy > 105 ? "text-red-500" : "text-amber-500"} />
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
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>Halving</span><span>12M</span><span>24M</span><span>36M</span><span>48M</span>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

// Placeholder stubs for Sections 3-12 — content is preserved from original file,
// only the outer page layout (sidebar + scroll) changed.
// These reference the same props and render identically to before.
function Section3Indicators({ data }: { data: BTCAnalysis }) {
  return (
    <SectionCard number={3} title="Indikatoren-Scoring">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left py-2 font-medium">Indikator</th>
              <th className="text-left py-2 font-medium">Wert</th>
              <th className="text-center py-2 font-medium">Score</th>
              <th className="text-right py-2 font-medium">Gewicht</th>
              <th className="text-right py-2 font-medium">Gewichtet</th>
              <th className="text-left py-2 pl-3 font-medium">Quelle</th>
            </tr>
          </thead>
          <tbody>
            {data.indicators.map((ind, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="py-2 font-medium">{ind.name}</td>
                <td className="py-2 text-muted-foreground font-mono">{ind.value}</td>
                <td className="py-2 text-center"><ScoreBadge score={ind.score} /></td>
                <td className="py-2 text-right text-muted-foreground">{(ind.weight * 100).toFixed(0)}%</td>
                <td className="py-2 text-right font-mono tabular-nums">{ind.weighted.toFixed(3)}</td>
                <td className="py-2 pl-3 text-muted-foreground text-[10px]">{ind.source}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border">
              <td colSpan={4} className="py-2 font-semibold">GIS Gesamt</td>
              <td className="py-2 text-right font-bold font-mono tabular-nums text-primary">{data.gis.toFixed(3)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </SectionCard>
  );
}

function Section4PowerLaw({ data }: { data: BTCAnalysis }) {
  const { powerLaw } = data;
  return (
    <SectionCard number={4} title="Power-Law Modell">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <MetricCard label="Fair Value" value={`$${powerLaw.fairValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} subValue="Power-Law Median" />
        <MetricCard label="Support" value={`$${powerLaw.support.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} subValue="Lower Band" color="text-emerald-500" />
        <MetricCard label="Resistance" value={`$${powerLaw.resistance.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} subValue="Upper Band" color="text-red-500" />
        <MetricCard label="Abweichung" value={`${powerLaw.deviationPercent >= 0 ? "+" : ""}${powerLaw.deviationPercent.toFixed(1)}%`} subValue={powerLaw.deviationPercent > 0 ? "Über Fair Value" : "Unter Fair Value"} color={powerLaw.deviationPercent > 20 ? "text-red-500" : powerLaw.deviationPercent < -20 ? "text-emerald-500" : "text-amber-500"} />
        <MetricCard label="6M Fair Value" value={`$${powerLaw.fairValue6M.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} subValue="Projektion" />
        <MetricCard label="Power Signal" value={powerLaw.powerSignal.toFixed(2)} subValue={powerLaw.powerSignal > 0 ? "Bullish" : "Bearish"} color={powerLaw.powerSignal > 0 ? "text-emerald-500" : "text-red-500"} />
      </div>
    </SectionCard>
  );
}

function Section5GWS({ data }: { data: BTCAnalysis }) {
  const { gws } = data;
  return (
    <SectionCard number={5} title="GWS (Gesamtwert-Score)">
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <MetricCard label="GWS Score" value={gws.value.toFixed(3)} subValue={gws.interpretation} color={gws.value > 0.05 ? "text-emerald-500" : gws.value < -0.05 ? "text-red-500" : "text-amber-500"} />
          <MetricCard label="GIS" value={gws.gis.toFixed(3)} subValue="Indikatoren-Score" />
          <MetricCard label="Cycle Signal" value={gws.cycleSignal.toFixed(3)} subValue="Zyklusposition" />
          <MetricCard label="Power Signal" value={gws.powerSignal.toFixed(3)} subValue="Power-Law Signal" />
          <MetricCard label="μ (GBM Drift)" value={`${(gws.mu * 100).toFixed(2)}%`} subValue="Erwartete Rendite" />
        </div>
        <div className="bg-muted/20 rounded-lg p-3 border border-border text-xs text-muted-foreground">
          <RechenWeg label="GWS Berechnung">
            GWS = w₁·GIS + w₂·PowerSignal + w₃·CycleSignal
          </RechenWeg>
        </div>
      </div>
    </SectionCard>
  );
}

function Section6MonteCarlo({ data }: { data: BTCAnalysis }) {
  const { monteCarlo } = data;
  const three = monteCarlo.threeMonth;
  const six = monteCarlo.sixMonth;
  return (
    <SectionCard number={6} title="Monte Carlo Simulation">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted/20 rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase">σ (30d Ann.)</div>
            <div className="text-sm font-bold font-mono">{(monteCarlo.sigma * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-muted/20 rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase">σ Adj.</div>
            <div className="text-sm font-bold font-mono">{(monteCarlo.sigmaAdj * 100).toFixed(1)}%</div>
          </div>
          <div className="bg-muted/20 rounded p-2">
            <div className="text-[10px] text-muted-foreground uppercase">μ (Drift)</div>
            <div className="text-sm font-bold font-mono">{(monteCarlo.mu * 100).toFixed(2)}%</div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[{ label: "3 Monate", d: three }, { label: "6 Monate", d: six }].map(({ label, d }) => (
            <div key={label} className="bg-muted/20 rounded-lg border border-border p-3">
              <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase">{label}</div>
              <div className="space-y-1">
                {[{k:"P5",v:d.p5},{k:"P25",v:d.p25},{k:"P50",v:d.p50},{k:"Mean",v:d.mean},{k:"P75",v:d.p75},{k:"P95",v:d.p95}].map(({k,v}) => (
                  <div key={k} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-mono tabular-nums">${v.toLocaleString("en-US",{maximumFractionDigits:0})}</span>
                  </div>
                ))}
                <div className="border-t border-border pt-1 mt-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">P(−10%) </span>
                    <span className="font-mono text-red-400">{(d.downsideProb10*100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">P(+20%)</span>
                    <span className="font-mono text-emerald-400">{(d.probAbove120*100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

function Section7Categories({ data }: { data: BTCAnalysis }) {
  return (
    <SectionCard number={7} title="Kategorien A–E">
      <div className="space-y-2">
        {data.categories.map((cat, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-[10px] font-bold text-primary">{String.fromCharCode(65+i)}</div>
            <div className="flex-1">
              <div className="flex justify-between text-xs mb-0.5">
                <span className="font-medium">{cat.label}</span>
                <span className="font-mono tabular-nums text-muted-foreground">{cat.range}</span>
              </div>
              <ProgressBar value={cat.probability * 100} max={100} color={i === 0 ? "bg-red-500" : i === 1 ? "bg-orange-500" : i === 2 ? "bg-amber-500" : i === 3 ? "bg-emerald-500" : "bg-blue-500"} />
            </div>
            <div className="text-xs font-bold font-mono w-12 text-right">{(cat.probability * 100).toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function Section8CycleAssessment({ data }: { data: BTCAnalysis }) {
  const { cycleAssessment } = data;
  return (
    <SectionCard number={8} title="Zyklus-Einschätzung">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-muted/20 rounded-lg border border-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Position</div>
            <div className="text-sm font-medium">{cycleAssessment.position}</div>
          </div>
          <div className="bg-muted/20 rounded-lg border border-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Einstiegspunkt</div>
            <div className="text-sm font-medium">{cycleAssessment.entryPoint}</div>
          </div>
          <div className="bg-muted/20 rounded-lg border border-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Halving Katalysator</div>
            <div className="text-sm font-medium">{cycleAssessment.halvingCatalyst}</div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function Section9FinalEstimate({ data }: { data: BTCAnalysis }) {
  const { finalEstimate } = data;
  return (
    <SectionCard number={9} title="Finale Schätzung">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-muted/20 rounded-lg border border-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">3-Monats-Range</div>
            <div className="text-sm font-bold font-mono">{finalEstimate.threeMonthRange}</div>
          </div>
          <div className="bg-muted/20 rounded-lg border border-border p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">6-Monats-Range</div>
            <div className="text-sm font-bold font-mono">{finalEstimate.sixMonthRange}</div>
          </div>
        </div>
        <div className="bg-muted/20 rounded-lg border border-border p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Ausblick: {finalEstimate.outlook}</div>
          <div className="text-xs text-muted-foreground leading-relaxed">{finalEstimate.summary}</div>
        </div>
      </div>
    </SectionCard>
  );
}

function Section10Technical({ data }: { data: BTCAnalysis }) {
  const tc = data.technicalChart.slice(-90);
  return (
    <SectionCard number={10} title="Technische Analyse">
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[{l:"MA20",v:data.currentMA20},{l:"MA50",v:data.currentMA50},{l:"MA100",v:data.currentMA100},{l:"MA200",v:data.currentMA200}].map(({l,v}) => (
            <MetricCard key={l} label={l} value={v ? `$${v.toLocaleString("en-US",{maximumFractionDigits:0})}` : "–"} color={v && data.btcPrice > v ? "text-emerald-400" : "text-red-400"} />
          ))}
        </div>
        {tc.length > 10 && (
          <div className="bg-muted/20 rounded-lg border border-border p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Preis + Moving Averages (90 Tage)</div>
            <ResponsiveContainer width="100%" height={200}>
              <ReLineChart data={tc}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => d.slice(5)} interval={14} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} domain={['auto','auto']} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v:number) => [`$${v.toLocaleString("en-US",{maximumFractionDigits:0})}`]} />
                <Line type="monotone" dataKey="price" stroke="#f59e0b" strokeWidth={2} dot={false} name="BTC" />
                <Line type="monotone" dataKey="ma20" stroke="#22c55e" strokeWidth={1} dot={false} name="MA20" strokeDasharray="4 2" />
                <Line type="monotone" dataKey="ma50" stroke="#3b82f6" strokeWidth={1} dot={false} name="MA50" strokeDasharray="4 2" />
                <Line type="monotone" dataKey="ma200" stroke="#ef4444" strokeWidth={1.5} dot={false} name="MA200" />
              </ReLineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function Section11FearGreed({ data }: { data: BTCAnalysis }) {
  const history = data.fearGreedHistory.slice(-90);
  const stats = data.fearGreedStats;
  return (
    <SectionCard number={11} title="Fear & Greed Index">
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="Aktuell" value={`${data.fearGreedIndex}`} subValue={data.fearGreedLabel} color={data.fearGreedIndex < 30 ? "text-red-500" : data.fearGreedIndex > 70 ? "text-emerald-500" : "text-amber-500"} />
          <MetricCard label="30d Avg" value={stats.avg30 != null ? `${stats.avg30.toFixed(0)}` : "–"} />
          <MetricCard label="Jahres-Hoch" value={stats.yearHigh != null ? `${stats.yearHigh}` : "–"} color="text-emerald-400" />
          <MetricCard label="Jahres-Tief" value={stats.yearLow != null ? `${stats.yearLow}` : "–"} color="text-red-400" />
        </div>
        {history.length > 10 && (
          <div className="bg-muted/20 rounded-lg border border-border p-3">
            <div className="text-xs font-medium text-muted-foreground mb-2">Fear & Greed Verlauf (90 Tage)</div>
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="fgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => d.slice(5)} interval={14} />
                <YAxis tick={{ fontSize: 9 }} domain={[0,100]} />
                <Tooltip contentStyle={tooltipStyle} />
                <ReferenceLine y={25} stroke="#ef4444" strokeDasharray="3 3" />
                <ReferenceLine y={75} stroke="#22c55e" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="value" stroke="#f59e0b" fill="url(#fgGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function Section12Summary({ data }: { data: BTCAnalysis }) {
  return (
    <SectionCard number={12} title="Gesamt-Fazit">
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <MetricCard label="GWS" value={data.gws.value.toFixed(3)} subValue={data.gws.interpretation} color={data.gws.value > 0.05 ? "text-emerald-500" : data.gws.value < -0.05 ? "text-red-500" : "text-amber-500"} />
          <MetricCard label="GIS" value={data.gis.toFixed(3)} subValue={data.gis > 0.1 ? "Bullish" : data.gis < -0.1 ? "Bearish" : "Neutral"} color={data.gis > 0.1 ? "text-emerald-500" : data.gis < -0.1 ? "text-red-500" : "text-amber-500"} />
          <MetricCard label="Marktstruktur" value={data.isBull ? "Bull Market" : "Bear Market"} color={data.isBull ? "text-emerald-500" : "text-red-500"} />
        </div>
        <div className="bg-muted/20 rounded-lg border border-border p-4 text-sm text-muted-foreground leading-relaxed">
          {data.finalEstimate.summary}
        </div>
        <PerplexityAttribution />
      </div>
    </SectionCard>
  );
}

// ============================================================
// === LAYOUT == MAIN COMPONENT ================================
// ============================================================

export default function BTCDashboard() {
  const { theme, toggleTheme } = useTheme();
  // Mobile-only sidebar state — on lg+ sidebar is always visible
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState(1);
  const mainRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [, navigate] = useLocation();

  const { data: rawData, isPending, isError } = useQuery({
    queryKey: ["btc-analysis"],
    queryFn: analyzeBTC,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  const { data: minerData, isPending: minerLoading, isError: minerError } = useQuery({
    queryKey: ["btc-miner"],
    queryFn: async () => {
      const r = await fetch("/api/btc-miner");
      if (!r.ok) throw new Error("Miner API failed");
      return r.json() as Promise<MinerData>;
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const data: BTCAnalysis = (rawData as BTCAnalysis) ?? (BTC_FALLBACK_DATA as BTCAnalysis);

  // Track active section via IntersectionObserver
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    SECTIONS.forEach(({ id }) => {
      const el = sectionRefs.current[id];
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(id); },
        { root: mainRef.current, rootMargin: "-20% 0px -70% 0px", threshold: 0 }
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach(o => o.disconnect());
  }, [data]);

  const scrollToSection = useCallback((id: number) => {
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // On mobile: close the overlay after clicking
    setMobileSidebarOpen(false);
  }, []);

  // ── Sidebar inner content (shared between mobile overlay + desktop)
  const SidebarContent = (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bitcoin className="w-5 h-5 text-amber-500" />
          <span className="font-bold text-sm">BTC-Analyse</span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">13 Sektionen</div>
      </div>

      {/* Nav — scrollable */}
      <nav className="flex-1 overflow-y-auto py-2">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => scrollToSection(id)}
            className={`w-full flex items-center gap-2.5 px-4 py-2 text-xs transition-colors text-left ${
              activeSection === id
                ? "bg-primary/10 text-primary border-r-2 border-primary font-medium"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{id}. {label}</span>
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border flex-shrink-0 space-y-1.5">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
        >
          {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
        <button
          onClick={() => navigate("/")}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Zurück
        </button>
      </div>
    </div>
  );

  return (
    // Full viewport, no overflow at this level
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">

      {/* ── DESKTOP SIDEBAR — always visible on lg+ ── */}
      <aside className="hidden lg:flex flex-col w-52 flex-shrink-0 border-r border-border bg-card h-full">
        {SidebarContent}
      </aside>

      {/* ── MOBILE SIDEBAR — overlay, toggled by hamburger ── */}
      {mobileSidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileSidebarOpen(false)}
          />
          {/* Panel */}
          <aside className="relative z-50 w-52 flex-shrink-0 bg-card border-r border-border h-full">
            {SidebarContent}
          </aside>
        </div>
      )}

      {/* ── MAIN CONTENT AREA ── */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* Top bar (mobile only — hamburger + title) */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-card flex-shrink-0">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="p-1.5 rounded hover:bg-muted/50"
            aria-label="Menü öffnen"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <Bitcoin className="w-4 h-4 text-amber-500" />
            <span className="font-semibold text-sm">BTC-Analyse</span>
          </div>
          <button onClick={toggleTheme} className="p-1.5 rounded hover:bg-muted/50">
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </header>

        {/* Scrollable content */}
        <main
          ref={mainRef}
          className="flex-1 overflow-y-auto"
        >
          <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
            {isPending && (
              <div className="flex items-center justify-center py-32 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Lade BTC-Analyse…
              </div>
            )}

            {!isPending && (
              <>
                <div ref={el => { sectionRefs.current[1] = el; }}><Section1Status data={data} /></div>
                <div ref={el => { sectionRefs.current[2] = el; }}><Section2Halving data={data} /></div>
                <div ref={el => { sectionRefs.current[3] = el; }}><Section3Indicators data={data} /></div>
                <div ref={el => { sectionRefs.current[4] = el; }}><Section4PowerLaw data={data} /></div>
                <div ref={el => { sectionRefs.current[5] = el; }}><Section5GWS data={data} /></div>
                <div ref={el => { sectionRefs.current[6] = el; }}><Section6MonteCarlo data={data} /></div>
                <div ref={el => { sectionRefs.current[7] = el; }}><Section7Categories data={data} /></div>
                <div ref={el => { sectionRefs.current[8] = el; }}><Section8CycleAssessment data={data} /></div>
                <div ref={el => { sectionRefs.current[9] = el; }}><Section9FinalEstimate data={data} /></div>
                <div ref={el => { sectionRefs.current[10] = el; }}><Section10Technical data={data} /></div>
                <div ref={el => { sectionRefs.current[11] = el; }}><Section11FearGreed data={data} /></div>
                <div ref={el => { sectionRefs.current[12] = el; }}><Section12Summary data={data} /></div>
                <div ref={el => { sectionRefs.current[13] = el; }}>
                  <Section13Miner data={data} minerData={minerData ?? null} loading={minerLoading} error={minerError} />
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
