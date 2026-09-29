/**
 * PortfolioPerformanceChart — Dual-Line (#70) + bench price + BTC-style Eye toggles.
 */
import { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip as AreaTooltip, Legend, ReferenceLine, DefaultTooltipContent, type TooltipProps } from "recharts";
import { Eye, EyeOff } from "lucide-react";
import { timeframeCutoffIso, type PerformanceTimeframe } from "@/lib/portfolio/positions";

type ChartSeriesKey = "pct" | "benchPct" | "combo" | "benchPrice";
const DEFAULT_VISIBLE: ChartSeriesKey[] = ["pct", "benchPct", "combo", "benchPrice"];

/** Same solid used by the Fenster-Rendite eye toggle and the green zone stop. */
const FENSTER_RENDITE_TOOLTIP_COLOR = "#10b981";
/** Date label on the white Recharts tooltip. Dark-mode foreground is near-white and disappears. */
const TOOLTIP_LABEL_COLOR = "#0f172a";

/**
 * Recharts copies Area `stroke` into the tooltip item `color`.
 * `url(#portfolioPerfStroke)` is not a CSS color, so that row — and the date
 * label, which has no color of its own — inherit the theme foreground onto
 * the white tooltip. Other series already pass solid hex strokes.
 */
function portfolioPerfTooltipContent(props: TooltipProps<number, string>) {
  const payload = props.payload?.map(entry =>
    typeof entry.color === "string" && entry.color.startsWith("url(")
      ? { ...entry, color: FENSTER_RENDITE_TOOLTIP_COLOR }
      : entry,
  );
  return (
    <DefaultTooltipContent
      {...props}
      payload={payload}
      contentStyle={{ ...props.contentStyle, color: TOOLTIP_LABEL_COLOR }}
      labelStyle={{ ...props.labelStyle, color: TOOLTIP_LABEL_COLOR }}
    />
  );
}

function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
}

export default function PortfolioPerformanceChart({
  series,
  timeframe,
  benchmarkTicker,
  benchmarkHistoricalPrices,
}: {
  series: Array<{ date: string; performancePct: number; value: number }>;
  timeframe: PerformanceTimeframe;
  benchmarkTicker?: string;
  benchmarkHistoricalPrices?: Array<{ date: string; close: number }> | undefined;
}) {
  const [visibleSeries, setVisibleSeries] = useState<Set<ChartSeriesKey>>(() => new Set(DEFAULT_VISIBLE));
  const toggleSeries = (key: ChartSeriesKey) => {
    setVisibleSeries(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const benchLabel = benchmarkTicker || "SPY";
  const seriesMeta: Array<{ key: ChartSeriesKey; label: string; color: string }> = [
    { key: "pct", label: "Fenster-Rendite", color: "#10b981" },
    { key: "benchPct", label: `${benchLabel} %`, color: "#f59e0b" },
    { key: "combo", label: "Kombinationskurs", color: "#38bdf8" },
    { key: "benchPrice", label: `${benchLabel}-Kurs`, color: "#a855f7" },
  ];
  const showPctAxis = visibleSeries.has("pct") || visibleSeries.has("benchPct");
  const showPriceAxis = visibleSeries.has("combo") || visibleSeries.has("benchPrice");

  const chartData = useMemo(() => {
    const cutoff = timeframeCutoffIso(timeframe);
    const benchSorted = (benchmarkHistoricalPrices ?? [])
      .filter(pt => pt.date >= cutoff && Number.isFinite(pt.close) && pt.close > 0)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    const closeFrom = benchSorted[0]?.close;
    const benchPctByDate = new Map<string, number>();
    const benchCloseByDate = new Map<string, number>();
    for (const pt of benchSorted) {
      benchCloseByDate.set(pt.date, pt.close);
      if (closeFrom != null && Number.isFinite(closeFrom) && closeFrom > 0) {
        benchPctByDate.set(pt.date, (pt.close / closeFrom - 1) * 100);
      }
    }
    return series.map(pt => ({
      date: pt.date,
      pct: pt.performancePct * 100,
      combo: pt.value,
      benchPct: benchPctByDate.get(pt.date),
      benchPrice: benchCloseByDate.get(pt.date),
    }));
  }, [series, timeframe, benchmarkHistoricalPrices]);

  // Y-gradient: top = dataMax, bottom = dataMin. Offset is the share of the range above 0%.
  const zeroOffset = useMemo(() => {
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (const pt of chartData) {
      if (!Number.isFinite(pt.pct)) continue;
      if (pt.pct < dataMin) dataMin = pt.pct;
      if (pt.pct > dataMax) dataMax = pt.pct;
    }
    if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return 1;
    if (dataMax <= 0) return 0;
    if (dataMin >= 0) return 1;
    return dataMax / (dataMax - dataMin);
  }, [chartData]);

  const windowReturnPct = series.length ? series[series.length - 1].performancePct : null;
  const comboStart = series[0]?.value ?? null;
  const comboEnd = series.length ? series[series.length - 1].value : null;
  const windowFrom = series[0]?.date ?? null;
  const windowTo = series.length ? series[series.length - 1].date : null;

  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <h3 className="text-sm font-semibold">Performance</h3>
      <p className="text-[10px] text-muted-foreground mb-2">
        {windowFrom && windowTo
          ? `${windowFrom} → ${windowTo} · Fenster ${windowReturnPct == null ? "—" : fmtPct(windowReturnPct)}${comboStart != null && comboEnd != null ? ` · Kombi-Kurs ${comboStart.toFixed(2)} → ${comboEnd.toFixed(2)}` : ""}`
          : "Fenster-Rendite ab Startpunkt (0%) + Kombinationskurs + Benchmark"}
      </p>
      <div className="flex flex-wrap gap-1 mb-2">
        {seriesMeta.map(s => (
          <button
            key={s.key}
            type="button"
            onClick={() => toggleSeries(s.key)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
              visibleSeries.has(s.key) ? "border-current opacity-100" : "border-border opacity-40 hover:opacity-60"
            }`}
            style={{ color: s.color }}
            title={`${s.label} ein-/ausblenden`}
            data-testid={`toggle-portfolio-${s.key}`}
          >
            {visibleSeries.has(s.key) ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
            {s.label}
          </button>
        ))}
      </div>
      {series.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">Keine Kursdaten verfügbar — Analyse für offene Positionen laden</div>
      ) : (
        <ResponsiveContainer width="100%" height={224}>
          <ComposedChart data={chartData}>
            <defs>
              <linearGradient id="portfolioPerfStroke" x1="0" y1="0" x2="0" y2="1">
                {zeroOffset > 0 && <stop offset={0} stopColor="#10b981" stopOpacity={1} />}
                {zeroOffset > 0 && <stop offset={zeroOffset} stopColor="#10b981" stopOpacity={1} />}
                {zeroOffset < 1 && <stop offset={zeroOffset} stopColor="#ef4444" stopOpacity={1} />}
                {zeroOffset < 1 && <stop offset={1} stopColor="#ef4444" stopOpacity={1} />}
              </linearGradient>
              <linearGradient id="portfolioPerfFill" x1="0" y1="0" x2="0" y2="1">
                {zeroOffset > 0 && <stop offset={0} stopColor="#10b981" stopOpacity={0.35} />}
                {zeroOffset > 0 && <stop offset={zeroOffset} stopColor="#10b981" stopOpacity={0.08} />}
                {zeroOffset < 1 && <stop offset={zeroOffset} stopColor="#ef4444" stopOpacity={0.08} />}
                {zeroOffset < 1 && <stop offset={1} stopColor="#ef4444" stopOpacity={0.35} />}
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={30} />
            {showPctAxis && <YAxis yAxisId="pct" tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}%`} width={40} />}
            {showPriceAxis && <YAxis yAxisId="combo" orientation="right" tick={{ fontSize: 9 }} tickFormatter={(v) => Number(v).toFixed(0)} width={44} />}
            <AreaTooltip
              content={portfolioPerfTooltipContent}
              formatter={(v: number, name: string) =>
                name === "Kombinationskurs" || name.endsWith("-Kurs")
                  ? [Number(v).toFixed(2), name]
                  : [`${Number(v).toFixed(2)}%`, name]
              }
              labelFormatter={(l) => l}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {visibleSeries.has("pct") && (
              <Area yAxisId="pct" type="monotone" dataKey="pct" name="Fenster-Rendite" stroke="url(#portfolioPerfStroke)" strokeWidth={2} fill="url(#portfolioPerfFill)" fillOpacity={1} />
            )}
            {showPctAxis && (
              <ReferenceLine yAxisId="pct" y={0} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            )}
            {visibleSeries.has("benchPct") && (
              <Line yAxisId="pct" type="monotone" dataKey="benchPct" name={`${benchLabel} %`} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
            )}
            {visibleSeries.has("combo") && (
              <Line yAxisId="combo" type="monotone" dataKey="combo" name="Kombinationskurs" stroke="#38bdf8" strokeWidth={1.5} dot={false} />
            )}
            {visibleSeries.has("benchPrice") && (
              <Line yAxisId="combo" type="monotone" dataKey="benchPrice" name={`${benchLabel}-Kurs`} stroke="#a855f7" strokeWidth={1.5} strokeDasharray="2 2" dot={false} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
