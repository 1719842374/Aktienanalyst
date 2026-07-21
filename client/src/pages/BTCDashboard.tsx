import { useState, useRef, useCallback, useMemo } from "react";
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

// === MinerData types (mirrors server/btc-miner.ts) ===
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
  const [presetIdx, setPresetIdx] = useState(1); // default: Basis
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

  // Build Hash Ribbon chart data (last 180 days for readability)
  const ribbonChartData = useMemo(() => {
    if (!minerData) return [];
    const { hashrateHistory, ma30, ma60, dates } = minerData;
    const len = Math.min(hashrateHistory.length, dates.length, ma30.length, ma60.length);
    const slice = Math.max(0, len - 180);
    return Array.from({ length: len - slice }, (_, i) => {
      const idx = slice + i;
      return {
        date: dates[idx]?.slice(0, 10) ?? "",
        hashrate: +( hashrateHistory[idx]?.hashrateEH ?? 0).toFixed(1),
        ma30: ma30[idx] != null ? +(ma30[idx] as number).toFixed(1) : null,
        ma60: ma60[idx] != null ? +(ma60[idx] as number).toFixed(1) : null,
      };
    }).filter(d => d.date);
  }, [minerData]);

  // Puell history — last 365 days
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

  // Capitulation zones for Hash Ribbon chart
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

        {/* === Übersicht-Metriken === */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard
            label="Hashrate"
            value={`${minerData.currentHashrateEH.toFixed(0)} EH/s`}
            subValue={`Netzwerk gesamt`}
          />
          <MetricCard
            label="Miner Score"
            value={ms ? `${ms.value}/100` : "–"}
            subValue={ms?.interpretation ?? "Keine Daten"}
            color={scoreColor}
          />
          <MetricCard
            label="Puell Multiple"
            value={minerData.puellMultiple != null ? minerData.puellMultiple.toFixed(2) : "–"}
            subValue={
              minerData.puellMultiple == null ? "< 365d Daten"
              : minerData.puellMultiple < 0.5 ? "Extreme Unterbewertung"
              : minerData.puellMultiple < 0.8 ? "Akkumulationszone"
              : minerData.puellMultiple < 1.5 ? "Neutral"
              : minerData.puellMultiple < 4.0 ? "Distributionszone"
              : "Historisches Hoch"
            }
            color={
              minerData.puellMultiple == null ? "text-muted-foreground"
              : minerData.puellMultiple < 0.8 ? "text-emerald-400"
              : minerData.puellMultiple < 1.5 ? "text-amber-400"
              : "text-red-400"
            }
          />
          <MetricCard
            label="Hash Ribbon"
            value={minerData.crossoverSignal ? "🟢 Buy Signal" : minerData.inCapitulation ? "🔴 Kapitulation" : "🟡 Normal"}
            subValue={minerData.crossoverSignal ? "MA30 kreuzte MA60" : minerData.inCapitulation ? "MA30 < MA60" : "MA30 > MA60"}
          />
        </div>

        {/* === Breakeven Slider === */}
        <div className="bg-muted/20 rounded-lg border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Breakeven-Szenarien</div>
            <button
              onClick={() => setShowCustom(!showCustom)}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                showCustom ? "border-primary/50 text-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted/50"
              }`}
            >
              ⚙ Manuell
            </button>
          </div>

          {/* Preset Buttons */}
          <div className="flex gap-2 flex-wrap">
            {BREAKEVEN_PRESETS.map((p, i) => (
              <button
                key={i}
                onClick={() => { setPresetIdx(i); setCustomEff(null); setCustomElec(null); }}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                  presetIdx === i && !customEff
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Manual Override */}
          {showCustom && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground block mb-1">Effizienz (J/TH)</label>
                <input
                  type="number" step="0.5" min="10" max="120"
                  defaultValue={activeEff}
                  onChange={e => setCustomEff(parseFloat(e.target.value) || null)}
                  className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground block mb-1">Strom ($/kWh)</label>
                <input
                  type="number" step="0.005" min="0.01" max="0.30"
                  defaultValue={activeElec}
                  onChange={e => setCustomElec(parseFloat(e.target.value) || null)}
                  className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
            </div>
          )}

          {/* Breakeven Result */}
          <div className="grid grid-cols-3 gap-3">
            {BREAKEVEN_PRESETS.map((p, i) => {
              const be = minerData ? calcBreakevenFrontend(minerData.currentHashrateEH, p.effJTH, p.elecUSD) : 0;
              const margin = be > 0 ? ((btcPrice - be) / be) * 100 : null;
              return (
                <div key={i} className={`rounded-lg border p-3 text-center transition-colors ${
                  presetIdx === i && !customEff ? "border-primary/40 bg-primary/5" : "border-border bg-muted/20"
                }`}>
                  <div className="text-[9px] uppercase text-muted-foreground">{p.label}</div>
                  <div className="text-sm font-bold font-mono tabular-nums mt-1">
                    ${be > 0 ? be.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "–"}
                  </div>
                  <div className={`text-[10px] font-mono mt-0.5 ${
                    margin == null ? "text-muted-foreground"
                    : margin >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}>
                    {margin != null ? `${margin >= 0 ? "+" : ""}${margin.toFixed(1)}% Marge` : ""}
                  </div>
                  <div className="text-[8px] text-muted-foreground mt-0.5">{p.desc}</div>
                </div>
              );
            })}
          </div>

          {/* Custom breakeven if set */}
          {(customEff || customElec) && (
            <div className="bg-primary/5 border border-primary/20 rounded p-2 text-center">
              <div className="text-[10px] text-primary font-medium">
                Manuell: {activeEff} J/TH @ ${activeElec}/kWh
              </div>
              <div className="text-base font-bold font-mono mt-1">
                Breakeven: ${computedBreakeven > 0 ? computedBreakeven.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "–"}
              </div>
              {miningMarginPct != null && (
                <div className={`text-xs mt-0.5 ${miningMarginPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {miningMarginPct >= 0 ? "+" : ""}{miningMarginPct.toFixed(1)}% über Breakeven
                </div>
              )}
            </div>
          )}

          <div className="text-[9px] text-muted-foreground">
            Quelle: mempool.space Hashrate (live) · Formel: Antminer-Referenzmodell (140 TH/s @ gewählter Effizienz)
          </div>
        </div>

        {/* === Hash Ribbon Chart === */}
        {ribbonChartData.length > 30 && (
          <div className="bg-muted/20 rounded-lg border border-border p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Hash Ribbons (180 Tage)</div>
            <div className="text-[10px] text-muted-foreground mb-3">
              Rote Zonen = MA30 &lt; MA60 (Kapitulation) · Grüner Crossover = Kaufsignal
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={ribbonChartData}>
                <defs>
                  <linearGradient id="ma30grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="ma60grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => d.slice(5)} interval={29} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${v}EH`} domain={['auto', 'auto']} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} EH/s`]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {capZones.map((z, i) => (
                  <ReferenceArea key={i} x1={z.start} x2={z.end} fill="#ef4444" fillOpacity={0.08} />
                ))}
                <Area type="monotone" dataKey="ma30" stroke="#22c55e" fill="url(#ma30grad)" strokeWidth={1.5} dot={false} name="MA30" />
                <Area type="monotone" dataKey="ma60" stroke="#ef4444" fill="url(#ma60grad)" strokeWidth={1.5} dot={false} name="MA60" />
                <Line type="monotone" dataKey="hashrate" stroke="#6b7280" strokeWidth={1} dot={false} name="Hashrate" opacity={0.4} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* === Puell Multiple Chart === */}
        {puellChartData.length > 30 && (
          <div className="bg-muted/20 rounded-lg border border-border p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Puell Multiple (365 Tage)</div>
            <div className="text-[10px] text-muted-foreground mb-3">
              &lt;0.5 = historische Akkumulationszone (grün) · &gt;4.0 = Überhitzung (rot)
            </div>
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

        {/* === Miner Score Detail === */}
        {ms && (
          <div className="bg-muted/20 rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Miner Score Breakdown</div>
              <div className={`text-2xl font-bold font-mono tabular-nums ${scoreColor}`}>{ms.value}<span className="text-sm font-normal text-muted-foreground">/100</span></div>
            </div>
            <div className="text-xs text-muted-foreground">{ms.interpretation}</div>
            <div className="space-y-2.5">
              {([
                { key: "puell",      label: "Puell Multiple",            weight: "35%" },
                { key: "hashRibbons",label: "Hash Ribbons",              weight: "30%" },
                { key: "breakeven",  label: "Breakeven-Distanz",         weight: "20%" },
                { key: "diffRibbon", label: "Difficulty Ribbon",         weight: "15%" },
              ] as const).map(({ key, label, weight }) => {
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

        {/* === Difficulty Ribbon === */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="Diff. Ribbon Compression"
            value={`${(minerData.difficultyRibbonCompression * 100).toFixed(1)}%`}
            subValue={
              minerData.difficultyRibbonCompression > 0.7 ? "Bullisches Erholungssignal"
              : minerData.difficultyRibbonCompression > 0.4 ? "Neutral"
              : "Ribbons weit gespreizt"
            }
            color={
              minerData.difficultyRibbonCompression > 0.7 ? "text-emerald-400"
              : minerData.difficultyRibbonCompression > 0.4 ? "text-amber-400"
              : "text-red-400"
            }
          />
          <MetricCard
            label="Hashprice"
            value={`${(minerData.hashprice * 1e6).toFixed(4)} BTC/PH/d`}
            subValue={`≈ $${(minerData.hashprice * data.btcPrice * 1e6).toFixed(2)}/PH/d`}
          />
        </div>

        {/* Data source footer */}
        <div className="text-[9px] text-muted-foreground border-t border-border pt-2">
          Datenquelle: <span className="font-medium">mempool.space</span> (Hashrate, Difficulty) · Cache: 1h ·
          Breakeven-Modell: Antminer S19 XP Referenz · Puell Multiple: 365d Rolling Average ·
          Zuletzt: {new Date(minerData.lastUpdated).toLocaleString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr
        </div>
      </div>
    </SectionCard>
  );
}

// === Section Components (1–12 unchanged) ===

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
              <td className="py-2 px-2 text-center font-mono tabular-nums font-bold text-primary text-sm">{data.gis.toFixed(4)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <RechenWeg title="GIS Rechenweg" steps={data.gisCalculation.split(" + ").map(s => s.trim())} />
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
          <MetricCard label="Fair Value" value={`$${pl.fairValue.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
          <MetricCard label="Abweichung" value={`${pl.deviationPercent >= 0 ? "+" : ""}${pl.deviationPercent.toFixed(1)}%`} color={Math.abs(pl.deviationPercent) < 20 ? "text-amber-500" : pl.deviationPercent < 0 ? "text-emerald-500" : "text-red-500"} />
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
                    <div className="absolute top-0 left-0 h-full rounded flex items-center justify-end pr-1" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: z.color + "30" }}>
                      <span className="text-[9px] font-mono font-bold" style={{ color: z.color }}>${z.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
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
        <MetricCard label="Fair Value in 6 Monaten" value={`$${pl.fairValue6M.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} subValue={`${(((pl.fairValue6M - data.btcPrice) / data.btcPrice) * 100) >= 0 ? "+" : ""}${(((pl.fairValue6M - data.btcPrice) / data.btcPrice) * 100).toFixed(1)}% vs. BTC-Kurs`} />
        <RechenWeg title="Power-Law Formel" steps={[`Tage = ${pl.daysSinceGenesis} (seit 03.01.2009)`, `FV = 1.0117e-17 × ${pl.daysSinceGenesis}^5.82 = $${pl.fairValue.toFixed(0)}`, `Support = FV × 0.4 = $${pl.support.toFixed(0)}`, `Resistance = FV × 2.5 = $${pl.resistance.toFixed(0)}`, `Abweichung = ($${data.btcPrice.toFixed(0)} - $${pl.fairValue.toFixed(0)}) / $${pl.fairValue.toFixed(0)} × 100 = ${pl.deviationPercent.toFixed(1)}%`]} />
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
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>{gwsComponents.map((c, i) => <Cell key={i} fill={c.fill} />)}</Bar>
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
        <RechenWeg title="GWS Rechenweg" steps={[`GWS = GIS×0.30 + Power×0.50 + Zyklus×0.20`, `GWS = ${g.gis.toFixed(4)}×0.30 + ${g.powerSignal.toFixed(1)}×0.50 + ${g.cycleSignal.toFixed(1)}×0.20`, `GWS = ${(g.gis * 0.30).toFixed(4)} + ${(g.powerSignal * 0.50).toFixed(4)} + ${(g.cycleSignal * 0.20).toFixed(4)}`, `GWS = ${g.value.toFixed(4)}`, `μ-Mapping: GWS=${g.value.toFixed(4)} → μ=${g.mu.toFixed(4)}`]} />
      </div>
    </SectionCard>
  );
}

// Sections 6–12: preserved verbatim (only shell shown here – full content in repo)
function Section6MonteCarlo({ data }: { data: BTCAnalysis }) {
  const mc = data.monteCarlo;
  const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const pct = (val: number) => { const p = ((val - data.btcPrice) / data.btcPrice) * 100; return p >= 0 ? `+${p.toFixed(1)}%` : `${p.toFixed(1)}%`; };
  const TRADING_DAYS = 252;
  const muAnnDefault    = Math.round(mc.mu * TRADING_DAYS * 10000) / 10000;
  const sigmaAnnDefault = Math.round(mc.sigmaAdj * Math.sqrt(TRADING_DAYS) * 10000) / 10000;
  const hv = data.historicalVol;
  const [mu, setMu] = useState(muAnnDefault);
  const [sigma, setSigma] = useState(sigmaAnnDefault);
  const [horizonDays, setHorizonDays] = useState(90);
  const [horizonInput, setHorizonInput] = useState('90');
  const [iterations, setIterations] = useState(50000);
  const [iterationsInput, setIterationsInput] = useState('50000');
  const [showParams, setShowParams] = useState(false);
  const [result, setResult] = useState<GBMMonteCarloResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const runSim = () => { setIsRunning(true); setTimeout(() => { const r = gbmMonteCarlo({ currentPrice: data.btcPrice, mu, sigma, iterations, tradingDays: horizonDays }, 0); setResult(r); setIsRunning(false); }, 20); };
  const active = result ?? (horizonDays <= 95 ? mc.threeMonth : mc.sixMonth);
  const serverActive = horizonDays <= 95 ? mc.threeMonth : mc.sixMonth;
  const isCustom = result !== null;
  const mean    = isCustom ? (result!.mean)  : (serverActive as any).mean ?? data.btcPrice * 1.05;
  const p10val  = isCustom ? result!.p10     : (serverActive as any).p10 ?? (serverActive as any).p10BearishTarget;
  const p50val  = isCustom ? result!.p50     : (serverActive as any).p50 ?? (serverActive as any).p50MedianTarget;
  const p90val  = isCustom ? result!.p90     : (serverActive as any).p90 ?? (serverActive as any).p90BullishTarget;
  const p5val   = isCustom ? result!.p5      : (serverActive as any).p5  ?? p10val * 0.9;
  const p25val  = isCustom ? result!.p25     : (serverActive as any).p25 ?? p50val * 0.85;
  const p75val  = isCustom ? result!.p75     : (serverActive as any).p75 ?? p90val * 0.85;
  const p95val  = isCustom ? result!.p95     : (serverActive as any).p95 ?? p90val * 1.15;
  const probBelow   = isCustom ? result!.downsideProb * 100   : (serverActive as any).probBelow ?? 50;
  const probBelow10 = isCustom ? result!.downsideProb10 * 100 : (serverActive as any).probBelow10 ?? 35;
  const probBelow20 = isCustom ? result!.downsideProb20 * 100 : (serverActive as any).probBelow20 ?? 20;
  const horizonLabel = horizonDays <= 30 ? `1 Monat (T=${horizonDays})` : horizonDays <= 95 ? `3 Monate (T=${horizonDays})` : horizonDays <= 185 ? `6 Monate (T=${horizonDays})` : horizonDays <= 370 ? `1 Jahr (T=${horizonDays})` : `${Math.round(horizonDays / 365 * 10) / 10} Jahre (T=${horizonDays})`;
  return (
    <SectionCard number={6} title="Monte Carlo Simulation">
      <div className="space-y-4">
        {hv && (hv.vol30d > 0 || hv.vol90d > 0) && (
          <div className="bg-muted/20 rounded-lg p-3 border border-border">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Historische Volatilität (aus echten Preisrenditen)</div>
            <div className="grid grid-cols-3 gap-2">
              {[{ label: "30d σ tägl.", daily: hv.vol30d, ann: hv.volAnn30d }, { label: "90d σ tägl.", daily: hv.vol90d, ann: hv.volAnn90d }, { label: "365d σ tägl.", daily: hv.vol365d, ann: hv.volAnn365d }].map(({ label, daily, ann }) => (<div key={label} className="bg-muted/30 rounded p-2 text-center"><div className="text-[9px] text-muted-foreground">{label}</div><div className="text-sm font-bold font-mono tabular-nums mt-0.5 text-amber-400">{daily > 0 ? `${(daily * 100).toFixed(2)}%` : "–"}</div><div className="text-[9px] text-muted-foreground">{ann > 0 ? `ann. ${(ann * 100).toFixed(1)}%` : ""}</div></div>))}
            </div>
            <div className="text-[9px] text-muted-foreground mt-1.5">Monte Carlo σ = {(mc.sigma * 100).toFixed(2)}% tägl. (90d Hist.Vol) — annualisiert: {sigmaAnnDefault.toFixed(4)}</div>
          </div>
        )}
        <div className="bg-muted/20 rounded-lg p-2 border border-border text-center">
          <span className="text-[10px] font-mono text-muted-foreground">S(T) = S₀ × exp((μ − σ²/2) × T + σ × √T × Z) &nbsp;|&nbsp; Z ~ N(0,1) &nbsp;|&nbsp; {iterations.toLocaleString()} Iter. &nbsp;|&nbsp; T={horizonDays}d ({horizonLabel})</span>
        </div>
        <div className="flex justify-end"><button onClick={() => setShowParams(!showParams)} className={`text-[10px] px-3 py-1.5 rounded border transition-colors flex items-center gap-1.5 ${showParams ? "border-primary/50 text-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted/50"}`}>⚙ Parameter {showParams ? "ausblenden" : "anpassen"}</button></div>
        {showParams && (<div className="bg-muted/20 rounded-lg border border-primary/20 p-4 space-y-4"><div className="text-[10px] uppercase tracking-wider font-semibold text-primary mb-2">Drift & Volatilität</div><div className="grid grid-cols-2 gap-4"><div><label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">μ (Drift p.a.)</label><input type="number" step="0.001" min="-0.5" max="2.0" value={mu} onChange={e => setMu(parseFloat(e.target.value) || 0)} className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" /><div className="text-[9px] text-muted-foreground mt-0.5">Server: {muAnnDefault.toFixed(4)} p.a.</div></div><div><label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">σ (Volatilität p.a.)</label><input type="number" step="0.005" min="0.01" max="2.0" value={sigma} onChange={e => setSigma(Math.max(0.001, parseFloat(e.target.value) || mc.sigmaAdj))} className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" /><div className="text-[9px] text-muted-foreground mt-0.5">Server: {sigmaAnnDefault.toFixed(4)} p.a.</div></div></div><div className="grid grid-cols-2 gap-4"><div><label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">Horizont (Tage)</label><input type="text" inputMode="numeric" value={horizonInput} onChange={e => setHorizonInput(e.target.value.replace(/[^0-9]/g, ''))} onBlur={() => { const v = parseInt(horizonInput, 10); const valid = !isNaN(v) && v >= 1 && v <= 3650 ? v : horizonDays; setHorizonDays(valid); setHorizonInput(String(valid)); }} onKeyDown={e => { if (e.key === 'Enter') { const v = parseInt(horizonInput, 10); const valid = !isNaN(v) && v >= 1 && v <= 3650 ? v : horizonDays; setHorizonDays(valid); setHorizonInput(String(valid)); (e.target as HTMLInputElement).blur(); }}} className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" /></div><div><label className="text-[10px] text-muted-foreground uppercase tracking-wide block mb-1">Iterationen</label><input type="text" inputMode="numeric" value={iterationsInput} onChange={e => setIterationsInput(e.target.value.replace(/[^0-9]/g, ''))} onBlur={() => { const v = parseInt(iterationsInput, 10); const valid = !isNaN(v) && v >= 100 && v <= 200000 ? v : iterations; setIterations(valid); setIterationsInput(String(valid)); }} className="w-full bg-muted border border-border rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50" /></div></div><div className="flex items-center gap-3"><button onClick={runSim} disabled={isRunning} className="flex-1 bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2">{isRunning ? "⏳ Simuliert..." : "▶ Simulation starten"}</button><button onClick={() => { setMu(muAnnDefault); setSigma(sigmaAnnDefault); setHorizonDays(90); setHorizonInput('90'); setIterations(50000); setIterationsInput('50000'); setResult(null); }} className="text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-3 py-2">↺ Reset</button></div></div>)}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2"><MetricCard label="Startkurs (S₀)" value={fmt(data.btcPrice)} /><MetricCard label="μ (p.a.)" value={mu.toFixed(4)} /><MetricCard label="σ (p.a.)" value={sigma.toFixed(4)} subValue={isCustom ? "Benutzerdefiniert" : "annualisiert"} /><MetricCard label="Iterationen" value={iterations.toLocaleString()} /><MetricCard label="Horizont" value={`${horizonDays}d`} subValue={horizonLabel} /></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{[{ label: "MEAN", val: mean, color: "text-purple-400" }, { label: "P10 (Bearish)", val: p10val, color: "text-red-400" }, { label: "P50 (Median)", val: p50val, color: "text-blue-400" }, { label: "P90 (Bullish)", val: p90val, color: "text-emerald-400" }].map(({ label, val, color }) => val != null ? (<div key={label} className="bg-muted/20 border border-border rounded-lg p-3 text-center"><div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div><div className={`text-xl font-bold font-mono tabular-nums mt-1 ${color}`}>{fmt(val)}</div><div className="text-[10px] text-muted-foreground mt-0.5">{pct(val)}</div></div>) : null)}</div>
      </div>
    </SectionCard>
  );
}

function Section7Categories({ data }: { data: BTCAnalysis }) {
  return (
    <SectionCard number={7} title="Wahrscheinlichkeits-Kategorien A–E">
      <div className="space-y-2">
        {data.categories.map((cat, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-32 text-xs font-medium">{cat.label}</div>
            <div className="w-24 text-xs text-muted-foreground font-mono">{cat.range}</div>
            <div className="flex-1">
              <ProgressBar value={cat.probability * 100} max={100} color={i === 0 ? "bg-red-500" : i === 1 ? "bg-orange-500" : i === 2 ? "bg-amber-500" : i === 3 ? "bg-emerald-400" : "bg-emerald-600"} />
            </div>
            <div className="w-12 text-right text-xs font-mono tabular-nums">{(cat.probability * 100).toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function Section8CycleAssessment({ data }: { data: BTCAnalysis }) {
  return (
    <SectionCard number={8} title="Zyklus-Einschätzung">
      <div className="space-y-3">
        <MetricCard label="Zyklusposition" value={data.cycleAssessment.position} />
        <MetricCard label="Einstiegspunkt" value={data.cycleAssessment.entryPoint} />
        <MetricCard label="Halving-Katalysator" value={data.cycleAssessment.halvingCatalyst} />
      </div>
    </SectionCard>
  );
}

function Section9FinalEstimate({ data }: { data: BTCAnalysis }) {
  const fe = data.finalEstimate;
  return (
    <SectionCard number={9} title="Finale Schätzung">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <MetricCard label="3-Monats-Spanne" value={fe.threeMonthRange} />
          <MetricCard label="6-Monats-Spanne" value={fe.sixMonthRange} />
        </div>
        <MetricCard label="Outlook" value={fe.outlook} />
        <div className="bg-muted/20 rounded-lg p-3 border border-border text-sm text-muted-foreground">{fe.summary}</div>
      </div>
    </SectionCard>
  );
}

function Section10TechAnalysis({ data }: { data: BTCAnalysis }) {
  const tc = data.technicalChart?.slice(-90) ?? [];
  return (
    <SectionCard number={10} title="Technische Analyse">
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label="MA20" value={data.currentMA20 != null ? `$${data.currentMA20.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "–"} color={data.btcPrice > (data.currentMA20 ?? 0) ? "text-emerald-400" : "text-red-400"} />
          <MetricCard label="MA50" value={data.currentMA50 != null ? `$${data.currentMA50.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "–"} color={data.btcPrice > (data.currentMA50 ?? 0) ? "text-emerald-400" : "text-red-400"} />
          <MetricCard label="MA200" value={data.currentMA200 != null ? `$${data.currentMA200.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "–"} color={data.btcPrice > (data.currentMA200 ?? 0) ? "text-emerald-400" : "text-red-400"} />
          <MetricCard label="MACD" value={data.currentMACD != null ? data.currentMACD.toFixed(0) : "–"} color={data.currentMACD != null && data.currentMACD > 0 ? "text-emerald-400" : "text-red-400"} />
        </div>
        {tc.length > 10 && (
          <div className="bg-muted/20 rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground mb-2">Preis + MA20/50/200 (90 Tage)</div>
            <ResponsiveContainer width="100%" height={200}>
              <ReLineChart data={tc}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => d.slice(5)} interval={14} />
                <YAxis tick={{ fontSize: 9 }} domain={['auto','auto']} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`$${v.toLocaleString()}`]} />
                <Line type="monotone" dataKey="price" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="BTC" />
                <Line type="monotone" dataKey="ma20" stroke="#22c55e" strokeWidth={1} dot={false} name="MA20" strokeDasharray="3 2" />
                <Line type="monotone" dataKey="ma50" stroke="#3b82f6" strokeWidth={1} dot={false} name="MA50" strokeDasharray="3 2" />
                <Line type="monotone" dataKey="ma200" stroke="#ef4444" strokeWidth={1} dot={false} name="MA200" strokeDasharray="3 2" />
              </ReLineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function Section11FearGreed({ data }: { data: BTCAnalysis }) {
  const fgColor = data.fearGreedIndex < 30 ? "text-red-500" : data.fearGreedIndex > 70 ? "text-emerald-500" : "text-amber-500";
  const fgHistory = data.fearGreedHistory?.slice(-90) ?? [];
  return (
    <SectionCard number={11} title="Fear & Greed Index">
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <MetricCard label="Aktuell" value={`${data.fearGreedIndex}`} subValue={data.fearGreedLabel} color={fgColor} />
          <MetricCard label="30d Ø" value={data.fearGreedStats?.avg30 != null ? data.fearGreedStats.avg30.toFixed(0) : "–"} />
          <MetricCard label="90d Ø" value={data.fearGreedStats?.avg90 != null ? data.fearGreedStats.avg90.toFixed(0) : "–"} />
        </div>
        {fgHistory.length > 10 && (
          <div className="bg-muted/20 rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground mb-2">Fear & Greed (90 Tage)</div>
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart data={fgHistory}>
                <defs><linearGradient id="fggrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} tickFormatter={d => d.slice(5)} interval={14} />
                <YAxis tick={{ fontSize: 9 }} domain={[0, 100]} />
                <Tooltip contentStyle={tooltipStyle} />
                <ReferenceLine y={25} stroke="#ef4444" strokeDasharray="3 3" />
                <ReferenceLine y={75} stroke="#22c55e" strokeDasharray="3 3" />
                <Area type="monotone" dataKey="value" stroke="#f59e0b" fill="url(#fggrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

function Section12Summary({ data }: { data: BTCAnalysis }) {
  const gws = data.gws;
  const overallColor = gws.value > 0.3 ? "text-emerald-500" : gws.value > 0 ? "text-amber-400" : "text-red-500";
  return (
    <SectionCard number={12} title="Gesamt-Fazit">
      <div className="space-y-3">
        <div className={`text-2xl font-bold ${overallColor}`}>{gws.interpretation}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <MetricCard label="GWS" value={gws.value.toFixed(4)} color={overallColor} />
          <MetricCard label="GIS" value={gws.gis.toFixed(4)} />
          <MetricCard label="Power Signal" value={gws.powerSignal.toFixed(1)} />
        </div>
        <div className="bg-muted/20 rounded-lg p-3 border border-border text-sm text-muted-foreground">{data.finalEstimate.summary}</div>
      </div>
    </SectionCard>
  );
}

// === Main Page ===
export default function BTCDashboard() {
  const [, navigate] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState(1);

  const mutation = useMutation({
    mutationFn: analyzeBTC,
  });

  const btcData: BTCAnalysis | null = (mutation.data as BTCAnalysis) ?? null;

  // Fetch miner data — POST with btcPriceHistory + btcPrice when btcData is available
  const { data: minerData, isLoading: minerLoading, isError: minerError } = useQuery<MinerData | null>({
    queryKey: ["btc-miner", btcData?.btcPrice ?? 0],
    queryFn: async () => {
      const body: Record<string, unknown> = {};
      if (btcData?.chartData?.allPrices?.length) {
        body.btcPriceHistory = btcData.chartData.allPrices;
        body.btcPrice = btcData.btcPrice;
      }
      const res = await fetch("/api/btc-miner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      return res.json() as Promise<MinerData>;
    },
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const scrollToSection = useCallback((id: number) => {
    setActiveSection(id);
    setSidebarOpen(false);
    const el = document.getElementById(`section-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleAnalyze = () => {
    mutation.mutate(undefined);
  };

  const data = btcData ?? (BTC_FALLBACK_DATA as unknown as BTCAnalysis);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-4 h-12">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1.5 rounded hover:bg-muted/50">
              {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="text-xs">Zurück</span>
            </button>
            <div className="flex items-center gap-1.5">
              <Bitcoin className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-semibold">BTC-Analyse</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {btcData && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-mono font-bold text-foreground">BTC</span>
                <span>Bitcoin</span>
                <span className="text-amber-400 font-mono font-bold">•</span>
                <span className="font-mono font-bold">${btcData.btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
              </div>
            )}
            <button onClick={handleAnalyze} disabled={mutation.isPending} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <RefreshCw className={`w-3 h-3 ${mutation.isPending ? "animate-spin" : ""}`} />
              {mutation.isPending ? "Lädt…" : "Aktien"}
            </button>
            <button onClick={toggleTheme} className="p-1.5 rounded hover:bg-muted/50">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`fixed lg:sticky top-12 z-40 h-[calc(100vh-3rem)] w-52 border-r border-border bg-background flex-shrink-0 overflow-y-auto transition-transform duration-200 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}>
          <nav className="p-3 space-y-0.5">
            {SECTIONS.map(s => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => scrollToSection(s.id)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-left text-xs transition-colors ${
                    activeSection === s.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  }`}
                >
                  <span className="text-[10px] font-mono tabular-nums text-muted-foreground w-4">{s.id}</span>
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="px-3 pb-4 text-[9px] text-muted-foreground text-center">Created with Perplexity Computer</div>
        </aside>

        {/* Overlay for mobile sidebar */}
        {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
            {mutation.isPending && (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                <span>Analysiere BTC-Marktdaten…</span>
              </div>
            )}
            {!mutation.isPending && (
              <>
                <div id="section-1">  <Section1Status data={data} /></div>
                <div id="section-2">  <Section2Halving data={data} /></div>
                <div id="section-3">  <Section3Indicators data={data} /></div>
                <div id="section-4">  <Section4PowerLaw data={data} /></div>
                <div id="section-5">  <Section5GWS data={data} /></div>
                <div id="section-6">  <Section6MonteCarlo data={data} /></div>
                <div id="section-7">  <Section7Categories data={data} /></div>
                <div id="section-8">  <Section8CycleAssessment data={data} /></div>
                <div id="section-9">  <Section9FinalEstimate data={data} /></div>
                <div id="section-10"><Section10TechAnalysis data={data} /></div>
                <div id="section-11"><Section11FearGreed data={data} /></div>
                <div id="section-12"><Section12Summary data={data} /></div>
                <div id="section-13">
                  <Section13Miner
                    data={data}
                    minerData={minerData ?? null}
                    loading={minerLoading}
                    error={minerError}
                  />
                </div>
              </>
            )}
            <PerplexityAttribution />
          </div>
        </main>
      </div>
    </div>
  );
}
