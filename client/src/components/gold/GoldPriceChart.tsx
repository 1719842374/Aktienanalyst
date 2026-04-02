import type { GoldAnalysis } from "../../../../shared/gold-schema";
import { useMemo, useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea, Area, ComposedChart,
} from "recharts";
import { Ruler, X } from "lucide-react";

interface Props { data: GoldAnalysis }

type TimeRange = "3M" | "6M" | "1Y" | "3Y" | "5Y" | "ALL";

export function GoldPriceChart({ data }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRange>("1Y");

  // Measurement tool state
  const [measureMode, setMeasureMode] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<{ date: string; close: number }[]>([]);

  const handleChartClick = useCallback((e: any) => {
    if (!measureMode || !e?.activePayload?.[0]) return;
    const point = e.activePayload[0].payload;
    if (!point?.date || point.close == null) return;
    setMeasurePoints(prev => {
      if (prev.length >= 2) return [{ date: point.date, close: point.close }];
      return [...prev, { date: point.date, close: point.close }];
    });
  }, [measureMode]);

  const measurement = useMemo(() => {
    if (measurePoints.length !== 2) return null;
    const [a, b] = measurePoints;
    const diff = b.close - a.close;
    const pct = (diff / a.close) * 100;
    const isGain = diff >= 0;
    return { a, b, diff, pct, isGain };
  }, [measurePoints]);

  const formatDateFull = (d: string) =>
    new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });

  const chartData = useMemo(() => {
    const prices = data.historicalPrices;
    if (!prices || prices.length === 0) return [];

    const now = new Date();
    let cutoff: Date;
    switch (timeRange) {
      case "3M": cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
      case "6M": cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000); break;
      case "1Y": cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
      case "3Y": cutoff = new Date(now.getTime() - 3 * 365 * 24 * 60 * 60 * 1000); break;
      case "5Y": cutoff = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000); break;
      case "ALL": cutoff = new Date(0); break;
    }

    return prices
      .filter(p => new Date(p.date) >= cutoff)
      .map(p => ({
        date: p.date,
        close: p.close,
        ma200: p.ma200,
        dateLabel: new Date(p.date).toLocaleDateString("de-DE", { day: "2-digit", month: "short" }),
      }));
  }, [data.historicalPrices, timeRange]);

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    const prices = chartData.map(d => d.close).filter(Boolean);
    const ma200s = chartData.map(d => d.ma200).filter(Boolean) as number[];
    const allValues = [...prices, ...ma200s];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.05;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <div className="bg-card border border-card-border rounded-lg p-4">
        <div className="text-sm text-muted-foreground text-center">Keine Preisdaten verfügbar</div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/10 text-amber-500 text-xs font-bold tabular-nums">2</span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Gold-Preis-Chart</h2>
          <div className="ml-auto flex gap-1 items-center">
            {(["3M", "6M", "1Y", "3Y", "5Y", "ALL"] as TimeRange[]).map(r => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                  timeRange === r
                    ? "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {r}
              </button>
            ))}
            <div className="w-px h-4 bg-border mx-1" />
            <button
              onClick={() => { setMeasureMode(!measureMode); setMeasurePoints([]); }}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                measureMode
                  ? "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
              data-testid="toggle-measure-gold"
            >
              <Ruler className="w-2.5 h-2.5" />
              Messen
            </button>
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3">
        {/* Measurement instructions / result */}
        {measureMode && (
          <div className={`rounded-lg p-2.5 mb-3 border text-[10px] flex items-center justify-between ${
            measurement
              ? measurement.isGain ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30"
              : "bg-amber-500/10 border-amber-500/30"
          }`}>
            <div className="flex items-center gap-2">
              <Ruler className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              {!measurement ? (
                <span className="text-muted-foreground">
                  {measurePoints.length === 0
                    ? "Klicke auf den Chart um Punkt A zu setzen"
                    : "Klicke auf den Chart um Punkt B zu setzen"}
                  {measurePoints.length === 1 && (
                    <span className="ml-1.5 font-mono text-foreground">
                      A: {formatDateFull(measurePoints[0].date)} — ${measurePoints[0].close.toFixed(2)}
                    </span>
                  )}
                </span>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-muted-foreground">
                    {formatDateFull(measurement.a.date)} → {formatDateFull(measurement.b.date)}
                  </span>
                  <span className={`font-bold font-mono text-sm ${
                    measurement.isGain ? "text-emerald-500" : "text-red-500"
                  }`}>
                    {measurement.isGain ? "+" : ""}{measurement.diff.toFixed(2)} ({measurement.isGain ? "+" : ""}{measurement.pct.toFixed(2)}%)
                    {measurement.isGain ? " ↑" : " ↓"}
                  </span>
                  <span className="text-muted-foreground font-mono">
                    ${measurement.a.close.toFixed(2)} → ${measurement.b.close.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
            <button
              onClick={() => { setMeasurePoints([]); setMeasureMode(false); }}
              className="p-0.5 rounded hover:bg-muted/50 text-muted-foreground shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className={`h-64 sm:h-80 w-full ${measureMode ? "cursor-crosshair" : ""}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }} onClick={handleChartClick}>
              <defs>
                <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => {
                  const date = new Date(d);
                  return date.toLocaleDateString("de-DE", { month: "short", year: "2-digit" });
                }}
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                interval="preserveStartEnd"
                minTickGap={50}
              />
              <YAxis
                domain={yDomain}
                tickFormatter={(v: number) => `$${v.toLocaleString()}`}
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                width={60}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                  fontSize: "11px",
                }}
                labelFormatter={(d: string) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" })}
                formatter={(value: number, name: string) => {
                  const label = name === "close" ? "Gold" : "200-DMA";
                  return [`$${value.toFixed(2)}`, label];
                }}
              />
              {/* Fair Value reference */}
              <ReferenceLine
                y={data.fairValue.fvAdj}
                stroke="#a855f7"
                strokeDasharray="5 5"
                strokeOpacity={0.5}
              />
              <Area
                type="monotone"
                dataKey="close"
                fill="url(#goldGradient)"
                stroke="none"
              />
              <Line
                type="monotone"
                dataKey="close"
                stroke="#f59e0b"
                strokeWidth={1.5}
                dot={false}
                name="close"
              />
              <Line
                type="monotone"
                dataKey="ma200"
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="4 2"
                dot={false}
                name="ma200"
                connectNulls
              />

              {/* Measurement overlay */}
              {measurePoints.length >= 1 && (
                <ReferenceLine
                  x={measurePoints[0].date}
                  stroke="#f59e0b"
                  strokeDasharray="4 3"
                  strokeWidth={1.5}
                  label={{ value: "A", position: "top", fontSize: 10, fill: "#f59e0b", fontWeight: 700 }}
                />
              )}
              {measurement && (
                <>
                  <ReferenceArea
                    x1={measurement.a.date}
                    x2={measurement.b.date}
                    fill={measurement.isGain ? "rgba(16, 185, 129, 0.08)" : "rgba(239, 68, 68, 0.08)"}
                    stroke={measurement.isGain ? "#10b981" : "#ef4444"}
                    strokeDasharray="4 3"
                    strokeWidth={1}
                  />
                  <ReferenceLine
                    x={measurement.b.date}
                    stroke="#f59e0b"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{ value: "B", position: "top", fontSize: 10, fill: "#f59e0b", fontWeight: 700 }}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-amber-500 rounded-full" /> Gold
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-red-500 rounded-full border-dashed" style={{ borderTop: "1px dashed #ef4444" }} /> 200-DMA
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-purple-500 rounded-full border-dashed" style={{ borderTop: "1px dashed #a855f7" }} /> Fair Value
          </span>
        </div>
      </div>
    </div>
  );
}
