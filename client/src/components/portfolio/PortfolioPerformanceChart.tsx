/**
 * PortfolioPerformanceChart — Dual-Line (#70) + bench price + BTC-style Eye toggles.
 */
import { useMemo, useState } from "react";
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip as AreaTooltip, Legend, ReferenceLine, DefaultTooltipContent, type TooltipProps } from "recharts";
import { Eye, EyeOff } from "lucide-react";
import { timeframeCutoffIso, type PerformanceTimeframe } from "@/lib/portfolio/positions";
import { AMPEL_COLORS, attachAmpel, type ComboPoint } from "@/lib/comboBands";

type ChartSeriesKey = "pct" | "benchPct" | "combo" | "benchPrice" | "ampel";
const DEFAULT_VISIBLE: ChartSeriesKey[] = ["pct", "benchPct", "combo", "benchPrice", "ampel"];

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
  const row = props.payload?.[0]?.payload as { ampelLabel?: string | null } | undefined;
  const seen = new Set<string>();
  const payload = props.payload?.filter(entry => {
    if (!row?.ampelLabel) return true;
    const name = String(entry.name ?? "");
    if (name !== "Kombinationskurs") return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  }).map(entry =>
    typeof entry.color === "string" && entry.color.startsWith("url(")
      ? { ...entry, color: FENSTER_RENDITE_TOOLTIP_COLOR }
      : entry,
  );
  const tooltip = (
    <DefaultTooltipContent
      {...props}
      payload={payload}
      contentStyle={{ ...props.contentStyle, color: TOOLTIP_LABEL_COLOR }}
      labelStyle={{ ...props.labelStyle, color: TOOLTIP_LABEL_COLOR }}
    />
  );
  if (!row?.ampelLabel) return tooltip;
  return (
    <div>
      {tooltip}
      <div style={{ color: TOOLTIP_LABEL_COLOR, fontSize: 11, padding: "0 10px 6px" }}>{row.ampelLabel}</div>
    </div>
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
  ampelSourceSeries,
}: {
  series: Array<{ date: string; performancePct: number; value: number }>;
  timeframe: PerformanceTimeframe;
  benchmarkTicker?: string;
  benchmarkHistoricalPrices?: Array<{ date: string; close: number }> | undefined;
  /** Längere Kombinationskurs-Reihe (Warmup), nur für Ampel und Band. Die gezeichneten Kurse bleiben `series`. */
  ampelSourceSeries?: ComboPoint[];
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
  const ampelOn = visibleSeries.has("ampel");
  const seriesMeta: Array<{ key: ChartSeriesKey; label: string; color: string }> = [
    { key: "pct", label: "Fenster-Rendite", color: "#10b981" },
    { key: "benchPct", label: `${benchLabel} %`, color: "#f59e0b" },
    { key: "combo", label: "Kombinationskurs", color: "#38bdf8" },
    { key: "benchPrice", label: `${benchLabel}-Kurs`, color: "#a855f7" },
    { key: "ampel", label: "Ampel", color: AMPEL_COLORS.green },
  ];
  const showPctAxis = visibleSeries.has("pct") || visibleSeries.has("benchPct");
  const showPriceAxis = visibleSeries.has("combo") || visibleSeries.has("benchPrice");

  const visibleCombo = useMemo<ComboPoint[]>(() => series.map(pt => ({ date: pt.date, value: pt.value })), [series]);
  const overlay = useMemo(
    () => attachAmpel(visibleCombo, ampelSourceSeries && ampelSourceSeries.length ? ampelSourceSeries : visibleCombo, ampelOn),
    [visibleCombo, ampelSourceSeries, ampelOn],
  );

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
    return series.map((pt, index) => {
      const row = overlay.rows[index];
      return {
        date: pt.date,
        pct: pt.performancePct * 100,
        combo: pt.value,
        benchPct: benchPctByDate.get(pt.date),
        benchPrice: benchCloseByDate.get(pt.date),
        ...(ampelOn && row ? {
          ...row.segments,
          bandLo: row.bandLo ?? undefined,
          bandHi: row.bandHi ?? undefined,
          bandMedian: row.bandMedian ?? undefined,
          ampelLabel: row.ampelLabel,
        } : {}),
      };
    });
  }, [series, timeframe, benchmarkHistoricalPrices, overlay, ampelOn]);

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
    <div className="bg-card rounded-xl border border-border p-4" data-testid="portfolio-performance-chart">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">Performance</h3>
        {ampelOn && overlay.badge ? (
          <span
            data-testid="portfolio-ampel-badge"
            className="shrink-0 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-500"
          >
            Ampel: Starkes Kaufsignal
          </span>
        ) : null}
      </div>
      <p className="text-[10px] text-muted-foreground mb-2">
        {windowFrom && windowTo
          ? `${windowFrom} → ${windowTo} · Fenster ${windowReturnPct == null ? "—" : fmtPct(windowReturnPct)}${comboStart != null && comboEnd != null ? ` · Kombi-Kurs ${comboStart.toFixed(2)} → ${comboEnd.toFixed(2)}` : ""}`
          : "Fenster-Rendite ab Startpunkt (0%) + Kombinationskurs + Benchmark"}
      </p>
      {ampelOn ? (
        <p className="text-[10px] text-muted-foreground mb-2">Ampel auf dem Kombinationskurs (Kurs&gt;MA200, MA50&gt;MA200, MACD&gt;0, MACD↑). Gestrichelt: Median und P20–P80.</p>
      ) : null}
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
            aria-pressed={visibleSeries.has(s.key)}
            data-testid={`toggle-portfolio-${s.key}`}
          >
            {visibleSeries.has(s.key) ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
            {s.label}
          </button>
        ))}
      </div>
      {series.length === 0 ? (
        <div className="h-[360px] flex items-center justify-center text-xs text-muted-foreground">Keine Kursdaten verfügbar — Analyse für offene Positionen laden</div>
      ) : (
        <ResponsiveContainer width="100%" height={360}>
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
                name === "Kombinationskurs" || name.endsWith("-Kurs") || name === "Median" || name.startsWith("Band ")
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
            {visibleSeries.has("combo") && !ampelOn && (
              <Line yAxisId="combo" type="monotone" dataKey="combo" name="Kombinationskurs" stroke="#38bdf8" strokeWidth={1.5} dot={false} />
            )}
            {visibleSeries.has("combo") && ampelOn && overlay.segmentMeta.map(segment => (
              <Line
                key={segment.key}
                yAxisId="combo"
                type="monotone"
                dataKey={segment.key}
                name="Kombinationskurs"
                stroke={AMPEL_COLORS[segment.color]}
                strokeWidth={2}
                dot={false}
                legendType={segment.legend ? "line" : "none"}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
            {visibleSeries.has("combo") && ampelOn && (
              <Line yAxisId="combo" type="monotone" dataKey="bandMedian" name="Median" stroke="#64748b" strokeWidth={1} strokeDasharray="1 3" dot={false} legendType="none" connectNulls isAnimationActive={false} />
            )}
            {visibleSeries.has("combo") && ampelOn && (
              <Line yAxisId="combo" type="monotone" dataKey="bandLo" name="Band unten" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" dot={false} legendType="none" connectNulls isAnimationActive={false} />
            )}
            {visibleSeries.has("combo") && ampelOn && (
              <Line yAxisId="combo" type="monotone" dataKey="bandHi" name="Band oben" stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" dot={false} legendType="none" connectNulls isAnimationActive={false} />
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
