/**
 * PortfolioOverview — KPI-Zeile + Pie + Performance (Fenster-Rendite + Kombinationskurs).
 */
import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, Tooltip as PieTooltip, ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip as AreaTooltip, Legend } from "recharts";
import { Target, Award, PiggyBank, AlertTriangle, TrendingUp } from "lucide-react";
import {
  computePortfolioKPIs, computePortfolioWeights, computePortfolioPerformanceSeries,
  rebasePerformanceSeries, timeframeCutoffIso,
  type PortfolioPosition, type PerformanceTimeframe,
} from "@/lib/portfolio/positions";
import { computeMarketWeights } from "@/lib/portfolio/engine";
import { computeCapmExpectedReturn } from "@/lib/portfolio/capmExpectedReturn";
import EfficientFrontierPanel from "./EfficientFrontierPanel";
import PortfolioBacktestPanel from "./PortfolioBacktestPanel";

const PIE_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4",
  "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#a855f7", "#eab308",
];

function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
}

export type TimeframeFilter = PerformanceTimeframe;
export type DirectionFilter = "all" | "long" | "short";

export default function PortfolioOverview({
  positions, lastPriceByTicker, historicalPricesByTicker, timeframe, direction,
  onTimeframeChange, onDirectionChange, onSelectTicker, capmWeights, solveFailed,
  sectorByTicker, benchmarkTicker, benchmarkHistoricalPrices, riskFreeRateAnnual,
}: {
  positions: PortfolioPosition[];
  lastPriceByTicker: Record<string, number | null | undefined>;
  historicalPricesByTicker: Record<string, Array<{ date: string; close: number }> | undefined>;
  timeframe: TimeframeFilter;
  direction: DirectionFilter;
  onTimeframeChange: (t: TimeframeFilter) => void;
  onDirectionChange: (d: DirectionFilter) => void;
  onSelectTicker?: (ticker: string) => void;
  capmWeights?: Record<string, number> | null;
  solveFailed?: boolean;
  sectorByTicker?: Record<string, string | undefined>;
  benchmarkTicker?: string;
  benchmarkHistoricalPrices?: Array<{ date: string; close: number }> | undefined;
  riskFreeRateAnnual?: number;
}) {
  const [pieMode, setPieMode] = useState<"market" | "capm">("market");
  const hasCapmWeights = !!capmWeights && Object.keys(capmWeights).length > 0;
  const directionFiltered = useMemo(
    () => (direction === "all" ? positions : positions.filter(p => p.side === direction)),
    [positions, direction]
  );

  const kpis = useMemo(() => computePortfolioKPIs(directionFiltered, lastPriceByTicker), [directionFiltered, lastPriceByTicker]);
  const weights = useMemo(() => computePortfolioWeights(directionFiltered, lastPriceByTicker), [directionFiltered, lastPriceByTicker]);
  const capmEr = useMemo(() => {
    const openLong = directionFiltered.filter(p => p.status === "open" && p.side === "long");
    const tickers = Array.from(new Set(openLong.map(p => p.ticker.toUpperCase())));
    const wMarket = computeMarketWeights(openLong, lastPriceByTicker);
    return computeCapmExpectedReturn({
      tickers,
      weightsByTicker: Object.keys(wMarket).length ? wMarket : (capmWeights ?? {}),
      historicalPricesByTicker,
      benchmarkTicker: benchmarkTicker || "SPY",
      benchmarkPrices: benchmarkHistoricalPrices,
      rfAnnual: riskFreeRateAnnual ?? 0,
    });
  }, [directionFiltered, lastPriceByTicker, historicalPricesByTicker, benchmarkTicker, benchmarkHistoricalPrices, riskFreeRateAnnual, capmWeights]);

  const rawSeries = useMemo(() => computePortfolioPerformanceSeries(directionFiltered, historicalPricesByTicker), [directionFiltered, historicalPricesByTicker]);
  const series = useMemo(() => rebasePerformanceSeries(rawSeries, timeframeCutoffIso(timeframe)), [rawSeries, timeframe]);
  const windowReturnPct = series.length ? series[series.length - 1].performancePct : null;
  const comboStart = series[0]?.value ?? null;
  const comboEnd = series.length ? series[series.length - 1].value : null;
  const windowFrom = series[0]?.date ?? null;
  const windowTo = series.length ? series[series.length - 1].date : null;

  const marketPieData = weights
    .filter(w => w.weight != null && w.weight > 0)
    .map(w => ({ name: w.position.ticker, value: (w.weight ?? 0) * 100, ticker: w.position.ticker }));
  const capmPieData = hasCapmWeights
    ? Object.entries(capmWeights!).filter(([, w]) => w > 0).map(([ticker, w]) => ({ name: ticker, value: w * 100, ticker }))
    : [];
  const effectivePieMode = hasCapmWeights ? pieMode : "market";
  const pieData = effectivePieMode === "capm" ? capmPieData : marketPieData;

  const openLongPositions = useMemo(() => directionFiltered.filter(p => p.status === "open" && p.side === "long"), [directionFiltered]);
  const marketWeightsForDelta = useMemo(() => computeMarketWeights(openLongPositions, lastPriceByTicker), [openLongPositions, lastPriceByTicker]);
  const maxDeviationPp = useMemo(() => {
    if (!hasCapmWeights) return null;
    let maxAbs: number | null = null;
    for (const ticker of Object.keys(marketWeightsForDelta)) {
      const capmW = capmWeights?.[ticker];
      if (capmW == null) continue;
      const diff = Math.abs(marketWeightsForDelta[ticker] - capmW);
      if (maxAbs == null || diff > maxAbs) maxAbs = diff;
    }
    return maxAbs;
  }, [hasCapmWeights, marketWeightsForDelta, capmWeights]);
  const showDeviationBanner = maxDeviationPp != null && maxDeviationPp > 0.10;

  const frontierTickers = useMemo(() => Array.from(new Set(openLongPositions.map(p => p.ticker.toUpperCase()))), [openLongPositions]);
  const frontierCurrentWeights = useMemo(() => {
    const map: Record<string, { market?: number | null; capm?: number | null }> = {};
    for (const ticker of frontierTickers) map[ticker] = { market: marketWeightsForDelta[ticker] ?? null, capm: capmWeights?.[ticker] ?? null };
    return map;
  }, [frontierTickers, marketWeightsForDelta, capmWeights]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full border-2 border-indigo-400/40 flex items-center justify-center shrink-0"><Target className="w-5 h-5 text-indigo-400" /></div>
          <div className="min-w-0">
            <div className={`text-2xl font-bold tabular-nums ${(kpis.avgActivePerformance ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>{fmtPct(kpis.avgActivePerformance)}</div>
            <div className="text-xs font-medium">Profit</div>
            <div className="text-[10px] text-muted-foreground leading-tight">Durchschnittliche Performance der aktiven Investments</div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full border-2 border-sky-400/40 flex items-center justify-center shrink-0"><TrendingUp className="w-5 h-5 text-sky-400" /></div>
          <div className="min-w-0">
            <div className={`text-2xl font-bold tabular-nums ${(capmEr.muPortfolio ?? 0) >= 0 ? "text-sky-400" : "text-red-500"}`}>{fmtPct(capmEr.muPortfolio)}</div>
            <div className="text-xs font-medium truncate">Erw. Rendite CAPM</div>
            <div className="text-[10px] text-muted-foreground leading-tight">{capmEr.available ? `r_f+β(r_m−r_f) vs. ${capmEr.benchmark} · ${capmEr.nTickersUsed} Titel` : (capmEr.flags[0] ?? "SML sobald Historie ≥60 Tage")}</div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full border-2 border-amber-400/40 flex items-center justify-center shrink-0"><Award className="w-5 h-5 text-amber-400" /></div>
          <div className="min-w-0">
            <div className="text-2xl font-bold tabular-nums text-emerald-500">{kpis.bestPerformer ? fmtPct(kpis.bestPerformer.performance) : "—"}</div>
            <div className="text-xs font-medium truncate">Bester Performer{kpis.bestPerformer ? `: ${kpis.bestPerformer.position.ticker}` : ""}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">Investment mit der besten Performance</div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full border-2 border-teal-400/40 flex items-center justify-center shrink-0"><PiggyBank className="w-5 h-5 text-teal-400" /></div>
          <div className="min-w-0">
            <div className={`text-2xl font-bold tabular-nums ${(kpis.avgRealizedPerformance ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>{fmtPct(kpis.avgRealizedPerformance)}</div>
            <div className="text-xs font-medium">Realisierter Profit</div>
            <div className="text-[10px] text-muted-foreground leading-tight">Durchschnittliche Performance abgeschlossener Investments</div>
          </div>
        </div>
      </div>

      {(showDeviationBanner || solveFailed) && (
        <div className="space-y-2">
          {showDeviationBanner && (
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600">Ist- und Ziel-Gewichte weichen deutlich ab (max. Δ = {(maxDeviationPp! * 100).toFixed(1)} pp). KPI „Profit“ folgt dem Ist-Portfolio.</p>
            </div>
          )}
          {solveFailed && (
            <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-500">Optimierung konnte Ziel nicht exakt erreichen — Fallback verwendet.</p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select className="text-xs bg-muted/30 border border-border/50 rounded-md px-2 py-1.5" value={timeframe} onChange={e => onTimeframeChange(e.target.value as TimeframeFilter)}>
          <option value="6M">6 Monate</option>
          <option value="1Y">1 Jahr</option>
          <option value="2Y">2 Jahre</option>
        </select>
        <select className="text-xs bg-muted/30 border border-border/50 rounded-md px-2 py-1.5" value={direction} onChange={e => onDirectionChange(e.target.value as DirectionFilter)}>
          <option value="all">Long/Short</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-semibold">Selektierte Aktien</h3>
            {hasCapmWeights && (
              <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-0.5 text-[10px]">
                <button type="button" onClick={() => setPieMode("market")} className={`px-2 py-1 rounded-md transition-colors ${effectivePieMode === "market" ? "bg-card shadow-sm font-semibold" : "text-muted-foreground"}`}>Ist-Marktwert</button>
                <button type="button" onClick={() => setPieMode("capm")} className={`px-2 py-1 rounded-md transition-colors ${effectivePieMode === "capm" ? "bg-card shadow-sm font-semibold" : "text-muted-foreground"}`}>Ziel-Gewicht CAPM</button>
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mb-2">{effectivePieMode === "capm" ? "Ziel-Allokation aus CAPM-Optimierung (Modus A/B/C)" : "Prozentuale Verteilung (Marktwert-Gewichte)"}</p>
          {pieData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">Keine Positionen — Kandidat hinzufügen</div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} onClick={(d: any) => onSelectTicker?.(d.ticker)} className="cursor-pointer" label={({ name, value }) => `${name} ${value.toFixed(0)}%`} labelLine={false} style={{ fontSize: "10px" }}>
                  {pieData.map((_, i) => (<Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />))}
                </Pie>
                <PieTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold">Performance</h3>
          <p className="text-[10px] text-muted-foreground mb-2">
            {windowFrom && windowTo
              ? `${windowFrom} → ${windowTo} · Fenster ${windowReturnPct == null ? "—" : fmtPct(windowReturnPct)}${comboStart != null && comboEnd != null ? ` · Kombi-Kurs ${comboStart.toFixed(2)} → ${comboEnd.toFixed(2)}` : ""}`
              : "Fenster-Rendite ab Startpunkt (0%) + Kombinationskurs"}
          </p>
          {series.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">Keine Kursdaten verfügbar — Analyse für offene Positionen laden</div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <ComposedChart data={series.map(pt => ({ date: pt.date, pct: pt.performancePct * 100, combo: pt.value }))}>
                <defs>
                  <linearGradient id="portfolioPerfGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={30} />
                <YAxis yAxisId="pct" tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}%`} width={40} />
                <YAxis yAxisId="combo" orientation="right" tick={{ fontSize: 9 }} tickFormatter={(v) => Number(v).toFixed(0)} width={44} />
                <AreaTooltip formatter={(v: number, name: string) => name === "Kombinationskurs" ? [v.toFixed(2), name] : [`${v.toFixed(2)}%`, name]} labelFormatter={(l) => l} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Area yAxisId="pct" type="monotone" dataKey="pct" name="Fenster-Rendite" stroke="#10b981" strokeWidth={2} fill="url(#portfolioPerfGradient)" />
                <Line yAxisId="combo" type="monotone" dataKey="combo" name="Kombinationskurs" stroke="#38bdf8" strokeWidth={1.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <EfficientFrontierPanel tickers={frontierTickers} historicalPricesByTicker={historicalPricesByTicker} currentWeights={frontierCurrentWeights} />

      {benchmarkTicker && (
        <PortfolioBacktestPanel
          positions={positions}
          historicalPricesByTicker={historicalPricesByTicker}
          sectorByTicker={sectorByTicker ?? {}}
          benchmarkTicker={benchmarkTicker}
          benchmarkHistoricalPrices={benchmarkHistoricalPrices}
          riskFreeRateAnnual={riskFreeRateAnnual ?? 0}
        />
      )}
    </div>
  );
}
