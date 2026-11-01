/**
 * Gewinnwachstum und Growth Gap unter der Rezessions-TA.
 * useQuery → apiRequest → GET /api/analyze-recession/earnings-growth.
 * Nur Anzeige. 375px stapelt (eine Spalte), ab dem TA-Breakpoint zwei Spalten.
 */
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiRequest } from "@/lib/queryClient";
import { TaPlotScroll } from "@/components/sections/TaPlotFrame";
import { TA_NARROW_MAX_PX, TA_PLOT_MIN_PX } from "@/lib/taChartScale";
import {
  EARNINGS_GROWTH_PARAMS,
  volShock,
  type EarningsGrowthPayload,
  type GrowthReading,
} from "@shared/recession-earnings-growth";
import type { DatedValue } from "@shared/recession-rest-overlays";
import type { RecessionTaRegion } from "@shared/recession-ta";

/** 375px → eine Spalte, 1440px → zwei Spalten. Grenze = TA-Schmalbreakpoint (Tailwind sm). */
export function growthLayout(viewportPx: number): "stack" | "row" {
  return viewportPx <= TA_NARROW_MAX_PX ? "stack" : "row";
}

function de(v: number, digits = 1): string {
  const sign = v < 0 ? "−" : "";
  return sign + Math.abs(v).toFixed(digits).replace(".", ",");
}

function show(r: GrowthReading, unit: string): string {
  if (r.value == null) return `n/a — ${r.reason}`;
  const sign = r.value > 0 ? "+" : "";
  return `${sign}${de(r.value)} ${unit}`;
}

function rowsOf(data: EarningsGrowthPayload) {
  const yoy = new Map(data.historical.map(p => [p.date.slice(0, 4), p.yoyPct]));
  const years = new Set<string>([
    ...data.prices.map(p => p.date.slice(0, 4)),
    ...data.historical.map(p => p.date.slice(0, 4)),
  ]);
  return Array.from(years).sort().map(year => {
    const price = data.prices.find(p => p.date.startsWith(year));
    return {
      date: price?.date ?? `${year}-12-31`,
      price: price?.close ?? null,
      yoy: yoy.get(year) ?? null,
    };
  });
}

export function RecessionGrowthPanel({
  region,
  volPoints,
}: {
  region: RecessionTaRegion;
  volPoints: DatedValue[];
}) {
  const query = useQuery({
    queryKey: ["recession-earnings-growth", region],
    staleTime: EARNINGS_GROWTH_PARAMS.cacheTtlMs,
    queryFn: async (): Promise<EarningsGrowthPayload> => {
      const res = await apiRequest("GET", `/api/analyze-recession/earnings-growth?region=${region}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.historical || !body?.forward) {
        throw new Error(String(body?.notes?.[0] ?? `HTTP ${res.status}`));
      }
      return body as EarningsGrowthPayload;
    },
  });

  const data = query.data ?? null;
  const shock = volShock(volPoints);
  const chart = data ? rowsOf(data) : [];
  const hasLine = chart.some(r => r.price != null || r.yoy != null);

  return (
    <div className="mt-2 min-w-0 space-y-2" data-testid="recession-growth" data-layout-rule={growthLayout(TA_NARROW_MAX_PX) === "stack" ? "narrow-stacks" : "narrow-row"}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Gewinnwachstum · nur Anzeige, kein Score
      </div>
      {query.isPending ? (
        <p className="text-xs text-muted-foreground" data-testid="recession-growth-loading">wird geladen …</p>
      ) : query.isError || !data ? (
        <p className="text-xs break-words" data-testid="recession-growth-error">n/a — {String((query.error as Error)?.message ?? "keine Daten")}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="recession-growth-grid">
            <Stat testId="recession-growth-realized" label="EPS YoY zuletzt" value={show(data.latestRealized, "%")} />
            <Stat testId="recession-growth-forward" label="Forward-Konsens" value={show(data.forward, "%")} />
            <Stat testId="recession-growth-gap" label="Growth Gap" value={show(data.growthGap, "Pp")} />
            <Stat testId="recession-growth-implied" label="Implied Gap (g* − realisiert)" value={show(data.impliedGap, "Pp")} />
            <Stat testId="recession-growth-median" label="Median 10J" value={show(data.realisticMedian, "%")} />
            <Stat testId="recession-growth-trend" label="5Y-Trend" value={show(data.trend5y, "%")} />
          </div>
          <p className={`text-[11px] break-words ${data.warning.active ? "text-amber-500" : "text-muted-foreground"}`} data-testid="recession-growth-warning">
            {data.warning.reason}
          </p>
          <p className="text-[11px] break-words text-muted-foreground" data-testid="recession-growth-shock">{shock.reason}</p>
          <p className="text-[10px] break-words text-muted-foreground">
            g* {show(data.gStar, "%")} · FCF/EV {show(data.fcfToEvPct, "%")}
            {data.earningsSymbol ? ` · EPS ${data.earningsSymbol}` : ""}
            {data.notes.length ? ` · ${data.notes.slice(0, 2).join(" · ")}` : ""}
          </p>
          {hasLine ? (
            <TaPlotScroll minWidth={TA_PLOT_MIN_PX} testId="recession-growth-plot">
              <div className="h-[160px] w-full min-h-10">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} minTickGap={28} />
                    <YAxis yAxisId="price" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} width={44} domain={["auto", "auto"]} />
                    <YAxis yAxisId="yoy" orientation="right" tick={{ fontSize: 9, fill: "var(--muted-foreground)" }} width={40} unit="%" domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                      formatter={(value: unknown, name: unknown) => {
                        const n = typeof value === "number" ? value : null;
                        if (n == null) return ["n/a", String(name)];
                        return [name === "Kurs" ? de(n, 2) : `${de(n)} %`, String(name)];
                      }}
                    />
                    <Line yAxisId="price" type="monotone" dataKey="price" name="Kurs" stroke="#94a3b8" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                    <Line yAxisId="yoy" type="stepAfter" dataKey="yoy" name="EPS YoY" stroke="#38bdf8" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </TaPlotScroll>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="recession-growth-no-plot">n/a — keine Jahresreihe für den Plot</p>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ testId, label, value }: { testId: string; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/30 px-2 py-1.5" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="break-words text-xs font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
