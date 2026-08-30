/**
 * PortfolioBacktestPanel — ex-post Performance-Attribution vs. Benchmark (P1).
 *
 * Sprint B2 (SPRINT_B2_PORTFOLIO_BACKTEST.md / WORK_PORTFOLIO_BACKTEST.md).
 * Rein additive, eigenstaendige Komponente -- wird von PortfolioOverview.tsx
 * NACH dem bestehenden Inhalt (KPI-Zeile, Pie/Performance-Chart, Efficient-
 * Frontier-Panel) eingehaengt (UI-Platzierung Empfehlung A, Spec §6). Ersetzt
 * NICHTS Bestehendes.
 *
 * Zahlen kommen ausschliesslich aus computePortfolioBacktest() (reine
 * Funktion, backtest.ts) -- KEIN LLM. Bei status "insufficient_data" wird
 * KEIN Block gerendert (Ticket-Vorgabe: "Zahlen-Prinzip ... status
 * insufficient_data statt geschaetzter/interpolierter Werte").
 */
import { useMemo, useState } from "react";
import {
  ComposedChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceDot,
} from "recharts";
import { TrendingUp, TrendingDown, Info } from "lucide-react";
import {
  computePortfolioBacktest, toBacktestPositionInputs,
  type PortfolioBacktestResult, type HoldingAttribution,
} from "@/lib/portfolio/backtest";
import type { PortfolioPosition } from "@/lib/portfolio/positions";

const MIN_OPEN_LONG_POSITIONS = 2;

function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${x >= 0 ? "+" : ""}${x.toFixed(digits)}%`;
}
function fmtPlainPct(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${x.toFixed(digits)}%`;
}
function fmtNum(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}
function colorForSign(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "text-muted-foreground";
  return x >= 0 ? "text-emerald-400" : "text-rose-400";
}

type SortKey = "weightPct" | "contributionPct" | "alphaPct" | "maxDdPct" | "retVol";

function MetricTile({ label, value, valueClassName, hint }: { label: string; value: string; valueClassName?: string; hint?: string }) {
  return (
    <div className="bg-muted/20 rounded-lg border border-border/50 p-2.5">
      <div className={`text-sm font-bold tabular-nums ${valueClassName ?? ""}`}>{value}</div>
      <div className="text-[10px] font-medium text-muted-foreground">{label}</div>
      {hint && <div className="text-[9px] text-muted-foreground/70 leading-tight mt-0.5">{hint}</div>}
    </div>
  );
}

function HoldingsAttributionTable({ holdings, sectorAggregates }: {
  holdings: HoldingAttribution[];
  sectorAggregates: PortfolioBacktestResult["sectorAggregates"];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("contributionPct");
  const [sortDesc, setSortDesc] = useState(true);

  const bySector = useMemo(() => {
    const map = new Map<string, HoldingAttribution[]>();
    for (const h of holdings) {
      const sector = h.sector ?? "Unknown";
      const list = map.get(sector) ?? [];
      list.push(h);
      map.set(sector, list);
    }
    for (const list of Array.from(map.values())) {
      list.sort((a: HoldingAttribution, b: HoldingAttribution) => (sortDesc ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));
    }
    return map;
  }, [holdings, sortKey, sortDesc]);

  const sectorOrder = useMemo(
    () => [...sectorAggregates].sort((a, b) => b.weightPct - a.weightPct).map(s => s.sector),
    [sectorAggregates]
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDesc(v => !v);
    else { setSortKey(key); setSortDesc(true); }
  }

  const columns: { key: SortKey; label: string }[] = [
    { key: "weightPct", label: "Weight %" },
    { key: "contributionPct", label: "Contrib %" },
    { key: "alphaPct", label: "α %" },
    { key: "retVol", label: "Ret/Vol" },
    { key: "maxDdPct", label: "Max DD %" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b border-border/50">
            <th className="text-left py-1.5 px-2 font-medium">Ticker</th>
            {columns.map(c => (
              <th
                key={c.key}
                className="text-right py-1.5 px-2 font-medium cursor-pointer hover:text-foreground select-none"
                onClick={() => toggleSort(c.key)}
                title="Sortieren"
              >
                {c.label}{sortKey === c.key ? (sortDesc ? " ▼" : " ▲") : ""}
              </th>
            ))}
            <th className="text-right py-1.5 px-2 font-medium">Vol %</th>
            <th className="text-right py-1.5 px-2 font-medium">β</th>
            <th className="text-right py-1.5 px-2 font-medium">Days</th>
          </tr>
        </thead>
        <tbody>
          {sectorOrder.map(sector => {
            const sectorAgg = sectorAggregates.find(s => s.sector === sector);
            const rows = bySector.get(sector) ?? [];
            return (
              <>
                <tr key={`sector-${sector}`} className="bg-muted/30">
                  <td className="py-1 px-2 font-semibold" colSpan={2}>{sector}</td>
                  <td className={`text-right py-1 px-2 font-semibold tabular-nums ${colorForSign(sectorAgg?.contributionPct)}`}>
                    {fmtPct(sectorAgg?.contributionPct)}
                  </td>
                  <td className="py-1 px-2" colSpan={5} />
                </tr>
                {rows.map(h => (
                  <tr key={h.ticker} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="py-1.5 px-2 font-medium">{h.ticker}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums">{fmtPlainPct(h.weightPct)}</td>
                    <td className={`text-right py-1.5 px-2 tabular-nums font-medium ${colorForSign(h.contributionPct)}`}>{fmtPct(h.contributionPct)}</td>
                    <td className={`text-right py-1.5 px-2 tabular-nums font-medium ${colorForSign(h.alphaPct)}`}>{fmtPct(h.alphaPct)}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums">{fmtNum(h.retVol)}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-rose-400/90">{fmtPlainPct(h.maxDdPct)}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums">{fmtPlainPct(h.volPct)}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums">{fmtNum(h.beta)}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums text-muted-foreground">{h.days}</td>
                  </tr>
                ))}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PortfolioBacktestPanel({
  positions,
  historicalPricesByTicker,
  sectorByTicker,
  benchmarkTicker,
  benchmarkHistoricalPrices,
  riskFreeRateAnnual,
}: {
  positions: PortfolioPosition[];
  historicalPricesByTicker: Record<string, Array<{ date: string; close: number }> | undefined>;
  /** ticker(uppercase) -> Sektor aus dem Analyse-Cache (StockAnalysis.sector). */
  sectorByTicker: Record<string, string | undefined>;
  benchmarkTicker: string;
  benchmarkHistoricalPrices: Array<{ date: string; close: number }> | undefined;
  /** Dezimal, z.B. 0.03 = 3% p.a. -- aus policy.rfPct. */
  riskFreeRateAnnual: number;
}) {
  const openLongCount = useMemo(
    () => positions.filter(p => p.status === "open" && p.side === "long").length,
    [positions]
  );

  const result = useMemo(() => {
    if (openLongCount < MIN_OPEN_LONG_POSITIONS) return null;
    const backtestPositions = toBacktestPositionInputs(positions, sectorByTicker);
    return computePortfolioBacktest({
      positions: backtestPositions,
      historicalPricesByTicker,
      benchmarkTicker,
      benchmarkPrices: benchmarkHistoricalPrices,
      riskFreeRateAnnual,
    });
  }, [openLongCount, positions, sectorByTicker, historicalPricesByTicker, benchmarkTicker, benchmarkHistoricalPrices, riskFreeRateAnnual]);

  // Akzeptanzkriterium: bei < 2 offenen Long-Positionen erscheint der Block gar nicht.
  if (openLongCount < MIN_OPEN_LONG_POSITIONS || !result) return null;

  if (result.status === "insufficient_data") {
    return (
      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold mb-1">Performance &amp; Attribution vs. Benchmark</h3>
        <div className="flex items-start gap-2 bg-muted/30 rounded-lg p-3 mt-2">
          <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Noch nicht genug gemeinsame Kurshistorie für einen Backtest vs. {benchmarkTicker.toUpperCase()}
            {" "}({result.commonTradingDays} Handelstage, {result.reason}).
          </p>
        </div>
      </div>
    );
  }

  const r: PortfolioBacktestResult = result;
  const chartData = r.series.map(pt => ({
    date: pt.date,
    portfolioPct: pt.portfolioCum * 100,
    benchmarkPct: pt.benchmarkCum * 100,
  }));
  const drawdownData = r.series.map(pt => ({ date: pt.date, ddPct: pt.drawdown * 100 }));
  const worstPoint = r.series.find(pt => pt.date === r.maxDrawdownEnd);

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Performance &amp; Attribution vs. Benchmark</h3>
          <p className="text-[10px] text-muted-foreground">
            Ex-post Backtest (Buy-and-Hold, Gewichte fix ab Entry) — {r.startDate} bis {r.endDate}, {r.tradingDays} Handelstage · Benchmark {r.benchmark}
          </p>
        </div>
        {r.alphaAnnualPct >= 0 ? (
          <TrendingUp className="w-4 h-4 text-emerald-400 shrink-0" />
        ) : (
          <TrendingDown className="w-4 h-4 text-rose-400 shrink-0" />
        )}
      </div>

      {/* Key-Metrics-Leiste (Spec §5.3) */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <MetricTile label="Up Capture" value={fmtPlainPct(r.upCapturePct)} />
        <MetricTile label="Down Capture" value={fmtPlainPct(r.downCapturePct)} />
        <MetricTile label="Hit Rate" value={fmtPlainPct(r.hitRatePct)} />
        <MetricTile label="Profit Factor" value={fmtNum(r.profitFactor)} />
        <MetricTile label="Avg Win" value={fmtPct(r.avgWinPct)} valueClassName="text-emerald-400" />
        <MetricTile label="Avg Loss" value={fmtPct(r.avgLossPct)} valueClassName="text-rose-400" />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        <MetricTile label="Alpha p.a." value={fmtPct(r.alphaAnnualPct)} valueClassName={colorForSign(r.alphaAnnualPct)} />
        <MetricTile label="Beta" value={fmtNum(r.beta)} />
        <MetricTile label="Information Ratio" value={fmtNum(r.informationRatio)} valueClassName={colorForSign(r.informationRatio)} />
        <MetricTile
          label="Max Drawdown"
          value={fmtPlainPct(r.maxDrawdownPct)}
          valueClassName="text-rose-400"
          hint={`${r.maxDrawdownDays}d · ${r.maxDrawdownStart} → ${r.maxDrawdownEnd}`}
        />
        <MetricTile label="Trading Days" value={String(r.tradingDays)} />
      </div>

      {/* Cumulative Return Chart (Spec §5.1) */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1">Equity Curve — Portfolio vs. Benchmark (kumulative Rendite, %)</p>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={50} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}%`} width={40} />
            <Tooltip
              formatter={(v: number, name: string) => [`${v.toFixed(2)}%`, name]}
              labelFormatter={(l) => l}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey="portfolioPct" name="Portfolio" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="benchmarkPct" name={r.benchmark} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Underwater / Drawdown Chart (Spec §5.2) */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1">
          Underwater — Drawdown ab letztem Hoch (%). Schlimmste Phase: {fmtPlainPct(r.maxDrawdownPct)} · {r.maxDrawdownDays}d · {r.maxDrawdownStart}
        </p>
        <ResponsiveContainer width="100%" height={130}>
          <AreaChart data={drawdownData}>
            <defs>
              <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7f1d1d" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#7f1d1d" stopOpacity={0.65} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
            <XAxis dataKey="date" tick={{ fontSize: 9 }} minTickGap={50} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${v}%`} width={40} />
            <Tooltip formatter={(v: number) => [`${v.toFixed(2)}%`, "Drawdown"]} labelFormatter={(l) => l} />
            <Area type="monotone" dataKey="ddPct" stroke="#7f1d1d" strokeWidth={1} fill="url(#drawdownGradient)" />
            {worstPoint && (
              <ReferenceDot
                x={worstPoint.date}
                y={worstPoint.drawdown * 100}
                r={4}
                fill="#7f1d1d"
                stroke="#fff"
                label={{
                  value: `${fmtPlainPct(r.maxDrawdownPct)} · ${r.maxDrawdownDays}d · ${r.maxDrawdownStart}`,
                  position: "top",
                  fontSize: 9,
                  fill: "#7f1d1d",
                }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Holdings-Attribution-Tabelle (Spec §5.4) */}
      <div>
        <p className="text-[10px] text-muted-foreground mb-1">Holdings-Attribution — sortierbar nach Spaltenkopf</p>
        <HoldingsAttributionTable holdings={r.holdings} sectorAggregates={r.sectorAggregates} />
      </div>
    </div>
  );
}
