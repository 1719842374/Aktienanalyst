import { useMemo } from "react";
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useIsNarrow } from "@/hooks/use-mobile";
import { TA_OSC_MIN_PX, axisTick, xAxisIntervalProps } from "@/lib/taChartScale";
import { trailingDividendYield, type DividendHistoryResponse } from "@shared/dividends";

/**
 * Section-10 overlay: historical dividend yield (TTM dividends / close) for window A.
 * Rendered only when the overlay toggle is on AND the endpoint returned events. No fallback values.
 */
export function DividendYieldPane({
  bars, history, tickFormatter, formatDateFull, loading, failed,
}: {
  bars: Array<{ date: string; close: number }>;
  history: DividendHistoryResponse | undefined;
  tickFormatter: (date: string) => string;
  formatDateFull: (date: string) => string;
  loading: boolean;
  failed: boolean;
}) {
  const narrow = useIsNarrow();
  const tick = axisTick(narrow, 9, "var(--muted-foreground)");
  const points = useMemo(
    () => (history && history.events.length > 0 ? trailingDividendYield(bars, history.events) : []),
    [bars, history],
  );
  const hasLine = points.some(p => p.yieldPct != null);

  if (loading) {
    return <div className="mt-2 text-[10px] text-muted-foreground" data-testid="dividend-overlay-loading">Dividendenhistorie wird geladen …</div>;
  }
  if (failed || !history || history.events.length === 0 || !hasLine) {
    return (
      <div className="mt-2 text-[10px] text-muted-foreground" data-testid="dividend-overlay-empty">
        {failed
          ? "Dividendenhistorie nicht erreichbar — kein Overlay."
          : history && history.events.length > 0
            ? "Dividendenhistorie deckt dieses Fenster nicht mit 12 Monaten ab — kein Overlay."
            : "Keine Dividendenhistorie (FMP/Yahoo) — kein Overlay."}
      </div>
    );
  }
  const sourceLabel = history.source === "fmp" ? "FMP" : "Yahoo (Fallback)";
  return (
    <>
      <div className="mb-1 mt-2 flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <span className="truncate">Dividendenrendite (TTM)</span>
        <span className="truncate text-[9px] opacity-60">= Σ Dividenden 12M / Kurs · Quelle: {sourceLabel}</span>
      </div>
      <div className="h-[100px] sm:h-[120px] min-h-10 w-full shrink-0" style={{ minHeight: TA_OSC_MIN_PX }} data-testid="chart-dividend-yield">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 4, right: 10, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
            <XAxis dataKey="date" tickFormatter={tickFormatter} tick={tick} {...xAxisIntervalProps(narrow, Math.max(0, Math.floor(points.length / 8)))} axisLine={{ stroke: "var(--border)" }} />
            <YAxis tick={tick} width={52} axisLine={{ stroke: "var(--border)" }} tickFormatter={(v: number) => `${v.toFixed(1)}%`} domain={[0, "auto"]} />
            <Tooltip content={({ active, payload, label }) => {
              if (!active || !payload?.length || payload[0]?.value == null) return null;
              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-[10px]">
                  <div className="font-semibold mb-1">{formatDateFull(String(label ?? ""))}</div>
                  <div className="flex justify-between gap-3"><span className="text-teal-400">Div. Yield TTM</span><span className="font-mono">{Number(payload[0].value).toFixed(2)}%</span></div>
                  {typeof (payload[0].payload as any)?.ttmDividend === "number" && (
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Σ Dividenden 12M</span><span className="font-mono">{(payload[0].payload as any).ttmDividend.toFixed(2)} je Aktie (Kurswährung)</span></div>
                  )}
                </div>
              );
            }} />
            <Line type="stepAfter" dataKey="yieldPct" name="Div. Yield TTM" stroke="#14b8a6" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
