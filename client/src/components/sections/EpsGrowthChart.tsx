import { useMemo } from "react";
import type { StockAnalysis } from "@shared/schema";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";

export default function EpsGrowthChart({ data }: { data: StockAnalysis }) {
  const pc = data.peerComparison;
  if (!pc?.epsHistory || pc.epsHistory.length < 3) return null;

  const { epsHistory, peerAvgEpsHistory, sectorMedian } = pc;
  const sectorGrowth = sectorMedian?.epsGrowth || 10;

  // Build unified chart data: merge subject, peer avg, sector projected line
  const chartData = useMemo(() => {
    const years = new Set(epsHistory!.map(h => h.year));
    if (peerAvgEpsHistory) peerAvgEpsHistory.forEach(h => years.add(h.year));
    const sortedYears = [...years].sort();

    // Limit to last ~8 historical + forward
    const lastHistorical = epsHistory!.filter(h => !h.isEstimate);
    const startYear = lastHistorical.length > 8 ? lastHistorical[lastHistorical.length - 8].year : sortedYears[0];
    const filtered = sortedYears.filter(y => y >= startYear);

    // Build sector projected EPS using sector growth rate from earliest year's subject EPS
    const baseEps = epsHistory!.find(h => h.year === filtered[0])?.eps || 1;

    return filtered.map(year => {
      const subjectPoint = epsHistory!.find(h => h.year === year);
      const peerPoint = peerAvgEpsHistory?.find(h => h.year === year);
      const yearsSinceBase = year - filtered[0];
      const sectorProjectedEps = +(baseEps * Math.pow(1 + sectorGrowth / 100, yearsSinceBase)).toFixed(2);

      return {
        year: year.toString(),
        eps: subjectPoint?.eps ?? null,
        epsHistorical: subjectPoint && !subjectPoint.isEstimate ? subjectPoint.eps : null,
        epsEstimate: subjectPoint?.isEstimate ? subjectPoint.eps : null,
        peerAvg: peerPoint?.eps ?? null,
        sectorLine: sectorProjectedEps,
        isEstimate: subjectPoint?.isEstimate || false,
      };
    });
  }, [epsHistory, peerAvgEpsHistory, sectorGrowth]);

  if (chartData.length < 3) return null;

  // Find the transition point between historical and estimated
  const firstEstimateIdx = chartData.findIndex(d => d.isEstimate);
  const lastHistIdx = firstEstimateIdx > 0 ? firstEstimateIdx - 1 : chartData.length - 1;

  // For the bridging point: add the last historical value also as the first estimate point
  const displayData = chartData.map((d, i) => ({
    ...d,
    // Bridge: last historical point also has estimate value for continuity
    epsEstimate: d.epsEstimate ?? (i === lastHistIdx && firstEstimateIdx > 0 ? d.epsHistorical : null),
  }));

  // Growth rates for display
  const hist = epsHistory!.filter(h => !h.isEstimate);
  const histGrowth = hist.length >= 2
    ? +(((hist[hist.length - 1].eps / hist[Math.max(0, hist.length - 6)].eps) ** (1 / Math.min(5, hist.length - 1)) - 1) * 100).toFixed(1)
    : null;
  const est = epsHistory!.filter(h => h.isEstimate);
  const estGrowth = est.length >= 2 && hist.length > 0
    ? +(((est[est.length - 1].eps / hist[hist.length - 1].eps) ** (1 / est.length) - 1) * 100).toFixed(1)
    : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Earnings Growth Vergleich
        </h4>
        <div className="flex items-center gap-3 text-[10px]">
          {histGrowth != null && (
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 rounded bg-primary inline-block" />
              <span className="text-foreground/60">Hist. {histGrowth}% p.a.</span>
            </span>
          )}
          {estGrowth != null && (
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-0.5 rounded bg-primary/50 inline-block border border-primary/30 border-dashed" />
              <span className="text-foreground/60">Est. {estGrowth}% p.a.</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 rounded bg-amber-400/60 inline-block" />
            <span className="text-foreground/60">Ø Peers</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 rounded bg-foreground/20 inline-block border border-foreground/10 border-dashed" />
            <span className="text-foreground/60">Sektor {sectorGrowth}%</span>
          </span>
        </div>
      </div>

      <div className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={displayData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="epsGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.15} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="estGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.08} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="year"
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={{ stroke: "hsl(var(--border))" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `$${v}`}
              width={45}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "8px",
                fontSize: "11px",
                padding: "8px 12px",
              }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  epsHistorical: "EPS (Historisch)",
                  epsEstimate: "EPS (Schätzung)",
                  peerAvg: "Ø Peers EPS",
                  sectorLine: "Sektor-Projektion",
                };
                return [`$${value?.toFixed(2) || "—"}`, labels[name] || name];
              }}
              labelFormatter={(label) => `FY ${label}`}
            />

            {/* Sector growth projection — dashed gray line */}
            <Line
              type="monotone"
              dataKey="sectorLine"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1}
              strokeDasharray="4 4"
              strokeOpacity={0.4}
              dot={false}
              connectNulls
            />

            {/* Peer average EPS — amber line */}
            <Line
              type="monotone"
              dataKey="peerAvg"
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeOpacity={0.6}
              dot={false}
              connectNulls
            />

            {/* Historical EPS — solid primary area */}
            <Area
              type="monotone"
              dataKey="epsHistorical"
              fill="url(#epsGradient)"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ fill: "hsl(var(--primary))", r: 3, strokeWidth: 0 }}
              connectNulls
            />

            {/* Estimated EPS — dashed primary area */}
            <Area
              type="monotone"
              dataKey="epsEstimate"
              fill="url(#estGradient)"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={{ fill: "hsl(var(--primary))", r: 3, strokeWidth: 1, stroke: "hsl(var(--background))" }}
              connectNulls
            />

            {/* Vertical line at estimate boundary */}
            {firstEstimateIdx > 0 && (
              <ReferenceLine
                x={chartData[lastHistIdx].year}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="2 2"
                strokeOpacity={0.3}
                label={{
                  value: "Est.",
                  position: "top",
                  fill: "hsl(var(--muted-foreground))",
                  fontSize: 9,
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Growth rate comparison badges */}
      <div className="flex items-center gap-2 flex-wrap">
        {histGrowth != null && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-primary/10 border border-primary/20">
            <span className="text-[10px] text-foreground/60">Hist. CAGR:</span>
            <span className={`text-[11px] font-mono font-semibold ${histGrowth > sectorGrowth ? "text-emerald-400" : "text-foreground/70"}`}>
              {histGrowth > 0 ? "+" : ""}{histGrowth}%
            </span>
          </div>
        )}
        {estGrowth != null && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-primary/5 border border-primary/10">
            <span className="text-[10px] text-foreground/60">Fwd. CAGR:</span>
            <span className={`text-[11px] font-mono font-semibold ${estGrowth > sectorGrowth ? "text-emerald-400" : "text-foreground/70"}`}>
              {estGrowth > 0 ? "+" : ""}{estGrowth}%
            </span>
          </div>
        )}
        <div className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/5 border border-amber-500/10">
          <span className="text-[10px] text-foreground/60">Ø Peers:</span>
          <span className="text-[11px] font-mono font-semibold text-amber-400/80">
            +{pc.peerAvg.epsGrowth5Y?.toFixed(1) || "—"}%
          </span>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 border border-foreground/10">
          <span className="text-[10px] text-foreground/60">Sektor:</span>
          <span className="text-[11px] font-mono text-foreground/50">+{sectorGrowth}%</span>
        </div>
      </div>
    </div>
  );
}
