import type { GoldAnalysis } from "../../../../shared/gold-schema";
import { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Area, ComposedChart,
} from "recharts";

interface Props { data: GoldAnalysis }

type TimeRange = "3M" | "6M" | "1Y" | "ALL";

export function GoldPriceChart({ data }: Props) {
  const [timeRange, setTimeRange] = useState<TimeRange>("1Y");

  const chartData = useMemo(() => {
    const prices = data.historicalPrices;
    if (!prices || prices.length === 0) return [];

    const now = new Date();
    let cutoff: Date;
    switch (timeRange) {
      case "3M": cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
      case "6M": cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000); break;
      case "1Y": cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
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
          <div className="ml-auto flex gap-1">
            {(["3M", "6M", "1Y", "ALL"] as TimeRange[]).map(r => (
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
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3">
        <div className="h-64 sm:h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
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
