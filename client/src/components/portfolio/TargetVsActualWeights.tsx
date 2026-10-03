/**
 * TargetVsActualWeights — Soll vs. Ist, volle Breite
 * (Offen_WORK_PORTFOLIO_SOLL_IST.md §4–§5).
 *
 * Additiv unter Pie und Performance-Kurve. Pie, Frontier und Backtest
 * bleiben unverändert. Ohne Soll-Gewichte kein Equal-Weight-Platzhalter.
 */
import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import {
  compareTargetActual,
  type ActiveStatus,
  type CompareTargetActualRow,
} from "@/lib/portfolio/compareTargetActual";

const SOLL_BAR = "#38bdf8";
const IST_BAR = "#f59e0b";
const ACTIVE_POS = "#10b981";
const ACTIVE_NEG = "#ef4444";

function fmtWeight(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(2)} %`;
}

function fmtActive(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(2)} %`;
}

function fmtNotional(x: number): string {
  const abs = Math.abs(x).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (x > 0) return `+${abs}`;
  if (x < 0) return `−${abs}`;
  return abs;
}

const STATUS_LABEL: Record<ActiveStatus, string> = {
  on_target: "on target",
  slight: "leicht off",
  off: "off target",
};

const STATUS_CLASS: Record<ActiveStatus, string> = {
  on_target: "text-emerald-500",
  slight: "text-amber-500",
  off: "text-red-500",
};

function KpiCard({ label, value, testId, hint }: { label: string; value: string; testId: string; hint?: string }) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="text-2xl font-bold tabular-nums" data-testid={testId}>{value}</div>
      <div className="text-xs font-medium">{label}</div>
      {hint && <div className="text-[10px] text-muted-foreground leading-tight">{hint}</div>}
    </div>
  );
}

function weightTooltip(value: number) {
  return fmtWeight(value);
}

export default function TargetVsActualWeights({
  target,
  actual,
  nav,
  onSelectTicker,
}: {
  target: Record<string, number> | null;
  actual: Record<string, number>;
  nav: number;
  onSelectTicker?: (ticker: string) => void;
}) {
  const result = useMemo(
    () => compareTargetActual(target, actual, nav),
    [target, actual, nav],
  );

  if (!result.hasTarget) {
    return (
      <div className="bg-card rounded-xl border border-border p-4" data-testid="panel-target-vs-actual">
        <h3 className="text-sm font-semibold mb-2">Soll vs. Ist</h3>
        <div className="h-56 flex items-center justify-center text-xs text-muted-foreground" data-testid="status-target-vs-actual-empty">
          Optimierung muss Soll liefern
        </div>
      </div>
    );
  }

  const chartHeight = Math.max(180, result.chartRows.length * 28 + 48);
  const chartData = result.chartRows.map(row => ({
    ticker: row.ticker,
    target: row.target,
    actual: row.actual,
    active: row.active,
  }));

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4" data-testid="panel-target-vs-actual">
      <h3 className="text-sm font-semibold">Soll vs. Ist</h3>

      {result.denominatorMismatch && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3" data-testid="status-denominator-mismatch">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-500">Soll und Ist haben nicht denselben Nenner (CASH nur auf einer Seite). Kein Vergleich.</p>
        </div>
      )}

      {result.targetSumOff && result.targetSum != null && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3" data-testid="status-target-sum">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-600">
            Summe Soll = {(result.targetSum * 100).toFixed(2)} % — Abweichung von 1 größer als 2 pp. Gewichte werden nicht renormiert.
          </p>
        </div>
      )}

      {!result.denominatorMismatch && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard label="MAE" value={fmtWeight(result.mae)} testId="text-mae" />
            <KpiCard label="Turnover" value={fmtWeight(result.turnover)} testId="text-turnover" hint="L1/2" />
            <KpiCard label="Max |Active|" value={fmtWeight(result.maxAbsActive)} testId="text-max-active" />
            <KpiCard label="Off-Count" value={String(result.offCount)} testId="text-off-count" />
          </div>

          {chartData.length > 0 && (
            <>
              <div data-testid="chart-soll-ist">
                <p className="text-xs font-medium text-muted-foreground mb-1">Soll vs. Ist</p>
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                    <YAxis type="category" dataKey="ticker" width={72} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={weightTooltip} />
                    <Legend />
                    <Bar dataKey="target" name="Soll" fill={SOLL_BAR} />
                    <Bar dataKey="actual" name="Ist" fill={IST_BAR} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div data-testid="chart-active-weight">
                <p className="text-xs font-medium text-muted-foreground mb-1">Active Weight</p>
                <ResponsiveContainer width="100%" height={chartHeight}>
                  <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} />
                    <YAxis type="category" dataKey="ticker" width={72} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => fmtActive(v)} />
                    <ReferenceLine x={0} stroke="hsl(var(--border))" />
                    <Bar dataKey="active" name="Active">
                      {chartData.map(row => (
                        <Cell key={row.ticker} fill={row.active >= 0 ? ACTIVE_POS : ACTIVE_NEG} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-muted-foreground uppercase tracking-wide border-b border-border/50">
                  <th className="text-left py-2 px-2">Ticker</th>
                  <th className="text-right py-2 px-2">Soll</th>
                  <th className="text-right py-2 px-2">Ist</th>
                  <th className="text-right py-2 px-2">Active</th>
                  <th className="text-right py-2 px-2">Trade</th>
                  <th className="text-left py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map(row => (
                  <WeightRow key={row.ticker} row={row} onSelectTicker={onSelectTicker} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function WeightRow({
  row,
  onSelectTicker,
}: {
  row: CompareTargetActualRow;
  onSelectTicker?: (ticker: string) => void;
}) {
  const activeColor = row.active > 0 ? ACTIVE_POS : row.active < 0 ? ACTIVE_NEG : undefined;
  const sideLabel = row.side === "buy" ? "Buy" : row.side === "sell" ? "Sell" : "—";
  return (
    <tr className="border-b border-border/30" data-testid={`row-target-actual-${row.ticker}`}>
      <td className="py-2 px-2">
        <button
          type="button"
          className="font-mono hover:underline"
          onClick={() => onSelectTicker?.(row.ticker)}
          data-testid={`button-target-actual-${row.ticker}`}
        >
          {row.ticker}
        </button>
      </td>
      <td className="py-2 px-2 text-right tabular-nums">{fmtWeight(row.target)}</td>
      <td className="py-2 px-2 text-right tabular-nums">{fmtWeight(row.actual)}</td>
      <td className="py-2 px-2 text-right tabular-nums" style={{ color: activeColor }}>{fmtActive(row.active)}</td>
      <td className="py-2 px-2 text-right tabular-nums">
        {fmtNotional(row.trade)}{" "}
        <span style={{ color: row.side === "buy" ? ACTIVE_POS : row.side === "sell" ? ACTIVE_NEG : undefined }}>{sideLabel}</span>
      </td>
      <td className={`py-2 px-2 ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</td>
    </tr>
  );
}
