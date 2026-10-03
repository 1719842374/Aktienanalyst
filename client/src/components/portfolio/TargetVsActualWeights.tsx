/**
 * Soll-vs-Ist-Karte — gruppierte Balken, Active Weight, Tracking-KPIs, Trade-Notional.
 * Spec: Offen_WORK_PORTFOLIO_SOLL_IST.md §4–§7. Additiv, kein neues Backend.
 * Zahlen nur aus compareTargetActual (pure). Kein LLM, keine erfundenen Soll-Gewichte.
 */
import { useMemo } from "react";
import {
  Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import {
  compareTargetActual,
  type ActiveStatus,
  type TargetActualRow,
} from "@/lib/portfolio/compareTargetActual";

const SOLL_BAR = "#38bdf8";
const IST_BAR = "#f59e0b";
const ACTIVE_POS = "#10b981";
const ACTIVE_NEG = "#ef4444";

function fmtPct(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

function fmtSignedPct(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
}

function fmtTrade(row: TargetActualRow): string {
  const amount = Math.abs(row.trade).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  if (row.side === "buy") return `Buy ${amount}`;
  if (row.side === "sell") return `Sell ${amount}`;
  return amount;
}

const STATUS_LABEL: Record<ActiveStatus, string> = {
  "on-target": "on target",
  slight: "leicht off",
  off: "off target",
};

const STATUS_CLASS: Record<ActiveStatus, string> = {
  "on-target": "text-emerald-500",
  slight: "text-amber-500",
  off: "text-red-500",
};

export default function TargetVsActualWeights({
  target,
  actual,
  nav,
  onSelectTicker,
}: {
  target: Record<string, number> | null | undefined;
  actual: Record<string, number>;
  nav: number;
  onSelectTicker?: (ticker: string) => void;
}) {
  const result = useMemo(
    () => compareTargetActual({ target, actual, nav }),
    [target, actual, nav],
  );

  const grouped = result.chartRows.map(r => ({
    ticker: r.ticker,
    soll: r.target * 100,
    ist: r.actual * 100,
  }));
  const activeBars = result.activeChartRows.map(r => ({
    ticker: r.ticker,
    active: r.active * 100,
  }));

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-4" data-testid="target-vs-actual">
      <div>
        <h3 className="text-sm font-semibold">Soll vs. Ist</h3>
        <p className="text-[10px] text-muted-foreground">Active Weight · Turnover = L1/2 · Trade = (Soll − Ist) × NAV</p>
      </div>

      {result.empty ? (
        <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
          Optimierung muss Soll liefern
        </div>
      ) : (
        <>
          {(result.sumTargetOff || result.cashMixed) && (
            <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                {result.cashMixed && (
                  <p className="text-xs text-amber-600">Cash nur, wenn Soll und Ist beide eine CASH-Quote haben. CASH ist aus diesem Vergleich genommen.</p>
                )}
                {result.sumTargetOff && (
                  <p className="text-xs text-amber-600">
                    Summe Soll weicht um {(Math.abs(result.targetSum - 1) * 100).toFixed(2)} pp von 1 ab ({fmtPct(result.targetSum)}). Keine Renormierung.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-muted/20 rounded-lg p-3">
              <div className="text-xs text-muted-foreground">MAE</div>
              <div className="text-base font-semibold tabular-nums">{fmtPct(result.mae)}</div>
              <div className="text-[10px] text-muted-foreground">L1/n</div>
            </div>
            <div className="bg-muted/20 rounded-lg p-3">
              <div className="text-xs text-muted-foreground">Turnover</div>
              <div className="text-base font-semibold tabular-nums">{fmtPct(result.turnover)}</div>
              <div className="text-[10px] text-muted-foreground">L1/2</div>
            </div>
            <div className="bg-muted/20 rounded-lg p-3">
              <div className="text-xs text-muted-foreground">Max |Active|</div>
              <div className="text-base font-semibold tabular-nums">{fmtPct(result.maxAbsActive)}</div>
            </div>
            <div className="bg-muted/20 rounded-lg p-3">
              <div className="text-xs text-muted-foreground">Off-Count</div>
              <div className="text-base font-semibold tabular-nums">{result.offCount}</div>
              <div className="text-[10px] text-muted-foreground">|a| ≥ 100 bp</div>
            </div>
          </div>

          {grouped.length > 0 && (
            <div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-1">
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SOLL_BAR }} />Soll</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: IST_BAR }} />Ist</span>
              </div>
              <ResponsiveContainer width="100%" height={Math.max(120, grouped.length * 28 + 16)}>
                <BarChart data={grouped} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
                  <YAxis type="category" dataKey="ticker" tick={{ fontSize: 10 }} width={88} />
                  <Tooltip formatter={(v: number) => `${Number(v).toFixed(2)}%`} />
                  <Bar dataKey="soll" name="Soll" fill={SOLL_BAR} onClick={(d: { ticker?: string }) => { if (d?.ticker) onSelectTicker?.(d.ticker); }} className="cursor-pointer" />
                  <Bar dataKey="ist" name="Ist" fill={IST_BAR} onClick={(d: { ticker?: string }) => { if (d?.ticker) onSelectTicker?.(d.ticker); }} className="cursor-pointer" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {activeBars.length > 0 && (
            <div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-1">
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: ACTIVE_POS }} />Active +</span>
                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: ACTIVE_NEG }} />Active −</span>
              </div>
              <ResponsiveContainer width="100%" height={Math.max(120, activeBars.length * 28 + 16)}>
                <BarChart data={activeBars} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
                  <YAxis type="category" dataKey="ticker" tick={{ fontSize: 10 }} width={88} />
                  <Tooltip formatter={(v: number) => `${Number(v).toFixed(2)}%`} />
                  <ReferenceLine x={0} stroke="hsl(var(--border))" />
                  <Bar dataKey="active" name="Active" onClick={(d: { ticker?: string }) => { if (d?.ticker) onSelectTicker?.(d.ticker); }} className="cursor-pointer">
                    {activeBars.map(row => (
                      <Cell key={row.ticker} fill={row.active >= 0 ? ACTIVE_POS : ACTIVE_NEG} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
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
                  <th className="text-right py-2 px-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map(row => (
                  <tr key={row.ticker} className="border-b border-border/30">
                    <td className="py-2 px-2">
                      <button type="button" data-testid={`button-target-vs-actual-${row.ticker}`} className="font-mono font-medium hover:underline" onClick={() => onSelectTicker?.(row.ticker)}>
                        {row.ticker}
                      </button>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums">{fmtPct(row.target)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{fmtPct(row.actual)}</td>
                    <td className={`py-2 px-2 text-right tabular-nums ${row.active >= 0 ? "text-emerald-500" : "text-red-500"}`}>{fmtSignedPct(row.active)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{fmtTrade(row)}</td>
                    <td className={`py-2 px-2 text-right ${STATUS_CLASS[row.status]}`}>{STATUS_LABEL[row.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
