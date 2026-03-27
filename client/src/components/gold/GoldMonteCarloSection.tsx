import type { GoldAnalysis, MonteCarloResult } from "../../../../shared/gold-schema";
import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";

interface Props { data: GoldAnalysis }

export function GoldMonteCarloSection({ data }: Props) {
  const [selectedHorizon, setSelectedHorizon] = useState<"3M" | "6M" | "12M">("12M");

  const mcData = useMemo(() => {
    if (selectedHorizon === "3M") return data.monteCarlo3M;
    if (selectedHorizon === "6M") return data.monteCarlo6M;
    return data.monteCarlo12M;
  }, [selectedHorizon, data]);

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/10 text-amber-500 text-xs font-bold tabular-nums">5</span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Monte Carlo Simulation</h2>
          <div className="ml-auto flex gap-1">
            {(["3M", "6M", "12M"] as const).map(h => (
              <button
                key={h}
                onClick={() => setSelectedHorizon(h)}
                className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                  selectedHorizon === h
                    ? "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-4">
        {/* Parameters */}
        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <span>μ (ann.) = {(mcData.mu * 100).toFixed(1)}%</span>
          <span>σ (ann.) = {(mcData.sigma * 100).toFixed(1)}%</span>
          <span>T = {mcData.days} Tage</span>
          <span>Iterationen: {mcData.iterations.toLocaleString()}</span>
        </div>

        {/* Distribution Chart */}
        <MCDistributionChart mc={mcData} spotPrice={data.spotPrice} />

        {/* Percentiles */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { label: "P10", value: mcData.p10, color: "text-red-400" },
            { label: "P25", value: mcData.p25, color: "text-orange-400" },
            { label: "Median", value: mcData.median, color: "text-foreground font-bold" },
            { label: "P75", value: mcData.p75, color: "text-emerald-400" },
            { label: "P90", value: mcData.p90, color: "text-emerald-500" },
          ].map(p => (
            <div key={p.label} className="bg-muted/30 rounded-md p-2 border border-border text-center">
              <div className="text-[10px] text-muted-foreground">{p.label}</div>
              <div className={`text-sm font-mono tabular-nums ${p.color}`}>${p.value.toLocaleString()}</div>
            </div>
          ))}
        </div>

        {/* 12M Scenarios (only for 12M) */}
        {mcData.scenarios && (
          <div className="space-y-2">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">12M-Szenarien</div>
            <div className="grid grid-cols-3 gap-2">
              <ScenarioBox
                label="Bullish (>+10%)"
                pct={mcData.scenarios.bullish}
                color="emerald"
              />
              <ScenarioBox
                label="Neutral (±10%)"
                pct={mcData.scenarios.neutral}
                color="amber"
              />
              <ScenarioBox
                label="Bearish (<-10%)"
                pct={mcData.scenarios.bearish}
                color="red"
              />
            </div>
          </div>
        )}

        {/* Range */}
        <div className="text-[10px] text-muted-foreground">
          Simulierter Bereich: ${mcData.min.toLocaleString()} – ${mcData.max.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

function MCDistributionChart({ mc, spotPrice }: { mc: MonteCarloResult; spotPrice: number }) {
  const chartData = useMemo(() => {
    return mc.distribution.map(d => ({
      price: d.bin,
      count: d.count,
      label: `$${d.bin.toLocaleString()}`,
    }));
  }, [mc.distribution]);

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <XAxis
            dataKey="price"
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
            tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            width={30}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: "11px",
            }}
            formatter={(value: number) => [value, "Simulationen"]}
            labelFormatter={(v: number) => `$${v.toLocaleString()}`}
          />
          <ReferenceLine
            x={spotPrice}
            stroke="hsl(var(--amber-500, #f59e0b))"
            strokeDasharray="3 3"
            label={{ value: "Spot", fontSize: 9, fill: "#f59e0b" }}
          />
          <ReferenceLine
            x={mc.median}
            stroke="hsl(var(--foreground))"
            strokeDasharray="3 3"
            label={{ value: "Median", fontSize: 9, fill: "hsl(var(--foreground))" }}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.price < spotPrice * 0.9
                  ? "rgba(239, 68, 68, 0.5)"
                  : entry.price > spotPrice * 1.1
                    ? "rgba(34, 197, 94, 0.5)"
                    : "rgba(245, 158, 11, 0.4)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ScenarioBox({ label, pct, color }: { label: string; pct: number; color: "emerald" | "amber" | "red" }) {
  const colors = {
    emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-500",
    amber: "bg-amber-500/10 border-amber-500/20 text-amber-500",
    red: "bg-red-500/10 border-red-500/20 text-red-500",
  };

  return (
    <div className={`rounded-md p-2 border text-center ${colors[color]}`}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-lg font-bold font-mono tabular-nums">{pct.toFixed(1)}%</div>
    </div>
  );
}
