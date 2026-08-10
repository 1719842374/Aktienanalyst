/**
 * PortfolioOverview — KPI-Zeile + Pie-Chart (Gewichte) + Performance-Chart.
 *
 * Auftrag 10.08.2026 ("Portfolio UX (CAPM/Kelly)", Teil A, Screen 1).
 * Neue, eigenstaendige Komponente fuer client/src/pages/PortfolioPage.tsx --
 * greift NICHT in Dashboard.tsx / fragile Dateien ein.
 *
 * Zahlen ausschliesslich aus computePortfolioKPIs/computePortfolioWeights/
 * computePortfolioPerformanceSeries (client/src/lib/portfolio/positions.ts,
 * reine Funktionen, unit-getestet) -- KEIN LLM fuer Kurse/Performance/Gewichte.
 */
import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, Tooltip as PieTooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as AreaTooltip } from "recharts";
import { Target, Award, PiggyBank } from "lucide-react";
import {
  computePortfolioKPIs, computePortfolioWeights, computePortfolioPerformanceSeries,
  type PortfolioPosition,
} from "@/lib/portfolio/positions";

const PIE_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4",
  "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#a855f7", "#eab308",
];

function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
}

export type TimeframeFilter = "1M" | "3M" | "6M" | "YTD" | "1Y";
export type DirectionFilter = "all" | "long" | "short";

function filterByTimeframe<T extends { date: string }>(series: T[], timeframe: TimeframeFilter): T[] {
  if (series.length === 0) return series;
  const now = new Date();
  let cutoff: Date;
  switch (timeframe) {
    case "1M": cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); break;
    case "3M": cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()); break;
    case "6M": cutoff = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()); break;
    case "YTD": cutoff = new Date(now.getFullYear(), 0, 1); break;
    case "1Y": cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()); break;
    default: cutoff = new Date(0);
  }
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return series.filter(pt => pt.date >= cutoffStr);
}

export default function PortfolioOverview({
  positions,
  lastPriceByTicker,
  historicalPricesByTicker,
  timeframe,
  direction,
  onTimeframeChange,
  onDirectionChange,
  onSelectTicker,
  capmWeights,
}: {
  positions: PortfolioPosition[];
  lastPriceByTicker: Record<string, number | null | undefined>;
  historicalPricesByTicker: Record<string, Array<{ date: string; close: number }> | undefined>;
  timeframe: TimeframeFilter;
  direction: DirectionFilter;
  onTimeframeChange: (t: TimeframeFilter) => void;
  onDirectionChange: (d: DirectionFilter) => void;
  onSelectTicker?: (ticker: string) => void;
  /** Ziel-Gewichte aus der CAPM-Optimierung (engine.ts), Ticker->Gewicht (0..1).
   * Optional -- wenn nicht gesetzt oder leer, wird nur "Ist-Marktwert" angezeigt
   * und der Toggle ausgeblendet (Auftrag 10.08.2026, Punkt 6). */
  capmWeights?: Record<string, number> | null;
}) {
  const [pieMode, setPieMode] = useState<"market" | "capm">("market");
  const hasCapmWeights = !!capmWeights && Object.keys(capmWeights).length > 0;
  const directionFiltered = useMemo(
    () => (direction === "all" ? positions : positions.filter(p => p.side === direction)),
    [positions, direction]
  );

  const kpis = useMemo(() => computePortfolioKPIs(directionFiltered, lastPriceByTicker), [directionFiltered, lastPriceByTicker]);
  const weights = useMemo(() => computePortfolioWeights(directionFiltered, lastPriceByTicker), [directionFiltered, lastPriceByTicker]);
  const rawSeries = useMemo(() => computePortfolioPerformanceSeries(directionFiltered, historicalPricesByTicker), [directionFiltered, historicalPricesByTicker]);
  const series = useMemo(() => filterByTimeframe(rawSeries, timeframe), [rawSeries, timeframe]);

  const marketPieData = weights
    .filter(w => w.weight != null && w.weight > 0)
    .map(w => ({ name: w.position.ticker, value: (w.weight ?? 0) * 100, ticker: w.position.ticker }));

  const capmPieData = hasCapmWeights
    ? Object.entries(capmWeights!)
        .filter(([, w]) => w > 0)
        .map(([ticker, w]) => ({ name: ticker, value: w * 100, ticker }))
    : [];

  const effectivePieMode = hasCapmWeights ? pieMode : "market";
  const pieData = effectivePieMode === "capm" ? capmPieData : marketPieData;

  return (
    <div className="space-y-4">
      {/* KPI-Zeile */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full border-2 border-indigo-400/40 flex items-center justify-center shrink-0">
            <Target className="w-5 h-5 text-indigo-400" />
          </div>
          <div className="min-w-0">
            <div className={`text-2xl font-bold tabular-nums ${(kpis.avgActivePerformance ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {fmtPct(kpis.avgActivePerformance)}
            </div>
            <div className="text-xs font-medium">Profit</div>
            <div className="text-[10px] text-muted-foreground leading-tight">Durchschnittliche Performance der aktiven Investments</div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full border-2 border-amber-400/40 flex items-center justify-center shrink-0">
            <Award className="w-5 h-5 text-amber-400" />
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-bold tabular-nums text-emerald-500">
              {kpis.bestPerformer ? fmtPct(kpis.bestPerformer.performance) : "—"}
            </div>
            <div className="text-xs font-medium truncate">
              Bester Performer{kpis.bestPerformer ? `: ${kpis.bestPerformer.position.ticker}` : ""}
            </div>
            <div className="text-[10px] text-muted-foreground leading-tight">Investment mit der besten Performance</div>
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
          <div className="w-11 h-11 rounded-full border-2 border-teal-400/40 flex items-center justify-center shrink-0">
            <PiggyBank className="w-5 h-5 text-teal-400" />
          </div>
          <div className="min-w-0">
            <div className={`text-2xl font-bold tabular-nums ${(kpis.avgRealizedPerformance ?? 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {fmtPct(kpis.avgRealizedPerformance)}
            </div>
            <div className="text-xs font-medium">Realisierter Profit</div>
            <div className="text-[10px] text-muted-foreground leading-tight">Durchschnittliche Performance abgeschlossener Investments</div>
          </div>
        </div>
      </div>

      {/* Filter-Leiste */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="text-xs bg-muted/30 border border-border/50 rounded-md px-2 py-1.5"
          value={timeframe}
          onChange={e => onTimeframeChange(e.target.value as TimeframeFilter)}
        >
          <option value="1M">1 Monat</option>
          <option value="3M">3 Monate</option>
          <option value="6M">6 Monate</option>
          <option value="YTD">YTD</option>
          <option value="1Y">1 Jahr</option>
        </select>
        <select
          className="text-xs bg-muted/30 border border-border/50 rounded-md px-2 py-1.5"
          value={direction}
          onChange={e => onDirectionChange(e.target.value as DirectionFilter)}
        >
          <option value="all">Long/Short</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
      </div>

      {/* Pie + Performance-Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className="text-sm font-semibold">Selektierte Aktien</h3>
            {hasCapmWeights && (
              <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => setPieMode("market")}
                  className={`px-2 py-1 rounded-md transition-colors ${effectivePieMode === "market" ? "bg-card shadow-sm font-semibold" : "text-muted-foreground"}`}
                >
                  Ist-Marktwert
                </button>
                <button
                  type="button"
                  onClick={() => setPieMode("capm")}
                  className={`px-2 py-1 rounded-md transition-colors ${effectivePieMode === "capm" ? "bg-card shadow-sm font-semibold" : "text-muted-foreground"}`}
                >
                  Ziel-Gewicht CAPM
                </button>
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mb-2">
            {effectivePieMode === "capm" ? "Ziel-Allokation aus CAPM-Optimierung (Modus A/B/C)" : "Prozentuale Verteilung (Marktwert-Gewichte)"}
          </p>
          {pieData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">
              Keine Positionen — Kandidat hinzufügen
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  onClick={(d: any) => onSelectTicker?.(d.ticker)}
                  className="cursor-pointer"
                  label={({ name, value }) => `${name} ${value.toFixed(0)}%`}
                  labelLine={false}
                  style={{ fontSize: "10px" }}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <PieTooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-semibold">Performance</h3>
          <p className="text-[10px] text-muted-foreground mb-2">Kumulative Portfolio-Performance (%)</p>
          {series.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">
              Keine Kursdaten verfügbar — Analyse für offene Positionen laden
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={224}>
              <AreaChart data={series.map(pt => ({ ...pt, pct: pt.performancePct * 100 }))}>
                <defs>
                  <linearGradient id="portfolioPerfGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={30} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}%`} width={36} />
                <AreaTooltip formatter={(v: number) => [`${v.toFixed(2)}%`, "Performance"]} labelFormatter={(l) => l} />
                <Area type="monotone" dataKey="pct" stroke="#10b981" strokeWidth={2} fill="url(#portfolioPerfGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
