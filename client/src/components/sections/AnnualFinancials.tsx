import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { StockAnalysis } from "@shared/schema";
import type { FinancialHistory, StatementYear } from "@shared/financial-history";
import { balanceSankey, incomeSankey } from "@shared/statement-sankey";
import { currencySymbol, statementCurrency } from "@/lib/formatters";
import { StatementSankey } from "./StatementSankey";

/**
 * 8–10 Jahres-Tabelle, YoY, Margen und optionales Sankey (WORK_DASHBOARD_FEATURES §1).
 * Piotroski und Jahre mit Gewinn (WORK_GURUFOCUS). Nur Anzeige.
 */
export function AnnualFinancials({ data }: { data: StockAnalysis }) {
  const [sankey, setSankey] = useState(false);
  const q = useQuery({
    queryKey: ["financial-history", data.ticker],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/financial-history/${encodeURIComponent(data.ticker)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<FinancialHistory & { note: string | null }>;
    },
  });
  const ccy = currencySymbol(statementCurrency(data));
  const years = q.data?.years ?? [];
  const fs = data.financialStatements;

  return (
    <div className="min-w-0 space-y-2" data-testid="annual-financials">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Jahresabschluss</h4>
        <button
          type="button"
          onClick={() => setSankey(v => !v)}
          className="min-h-9 rounded border border-border px-2 text-[10px] sm:min-h-7"
          data-testid="button-sankey"
          aria-pressed={sankey}
        >
          {sankey ? "Tabelle" : "Sankey"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2 text-[10px]">
        <span className="rounded border border-border px-2 py-1" data-testid="badge-piotroski">
          Piotroski {q.isLoading ? "…" : q.data?.piotroski.label ?? "n/a — Historie nicht geladen"}
        </span>
        <span className="rounded border border-border px-2 py-1" data-testid="badge-profit-years">
          {q.isLoading ? "…" : q.data?.profitYears.label ?? "n/a — Historie nicht geladen"}
        </span>
      </div>
      {q.isError && <p className="text-[10px] text-muted-foreground">n/a — Jahreszahlen nicht erreichbar</p>}
      {q.data?.note && <p className="text-[10px] text-muted-foreground">{q.data.note}</p>}
      {sankey ? (
        <div className="space-y-3">
          <StatementSankey model={incomeSankey({
            segments: (data.revenueSegments ?? []).map(s => ({ name: s.name, revenue: s.revenue > 0 ? s.revenue : null })),
            revenue: fs?.incomeStatement.revenue ?? null,
            grossProfit: fs?.incomeStatement.grossProfit ?? null,
            operatingIncome: fs?.incomeStatement.operatingIncome ?? null,
            netIncome: fs?.incomeStatement.netIncome ?? null,
          })} />
          <StatementSankey model={balanceSankey({
            totalAssets: fs?.balanceSheet.totalAssets ?? null,
            totalEquity: fs?.balanceSheet.totalEquity ?? null,
            totalDebt: fs?.balanceSheet.totalDebt ?? null,
          })} />
        </div>
      ) : (
        <YearTable years={years} ccy={ccy} />
      )}
    </div>
  );
}

function fmt(v: number | null, ccy: string): string {
  if (v == null) return "n/a";
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (a >= 1e12) return `${sign}${ccy}${(a / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${sign}${ccy}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}${ccy}${(a / 1e6).toFixed(1)}M`;
  return `${sign}${ccy}${a.toFixed(0)}`;
}

function yoyText(pct: number | null, reason: string | null): { text: string; className: string } {
  if (pct == null) return { text: reason ?? "n/a", className: "text-muted-foreground" };
  return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, className: pct >= 0 ? "text-emerald-500" : "text-red-500" };
}

const ROWS: { label: string; value: (y: StatementYear) => number | null; yoy?: (y: StatementYear) => { pct: number | null; reason: string | null } }[] = [
  { label: "Umsatz", value: y => y.revenue, yoy: y => ({ pct: y.revenueYoyPct, reason: y.revenueYoyReason }) },
  { label: "Bruttogewinn", value: y => y.grossProfit },
  { label: "Bruttomarge", value: y => y.grossMarginPct },
  { label: "Operatives Ergebnis", value: y => y.operatingIncome },
  { label: "Operative Marge", value: y => y.operatingMarginPct },
  { label: "Jahresüberschuss", value: y => y.netIncome },
  { label: "Nettomarge", value: y => y.netMarginPct },
  { label: "Free Cash Flow", value: y => y.fcf },
  { label: "FCF-Marge", value: y => y.fcfMarginPct },
  { label: "Aktiva", value: y => y.totalAssets },
  { label: "Eigenkapital", value: y => y.totalEquity },
  { label: "Schulden", value: y => y.totalDebt },
  { label: "Cash", value: y => y.cash },
];

function YearTable({ years, ccy }: { years: StatementYear[]; ccy: string }) {
  if (years.length === 0) return <p className="text-[10px] text-muted-foreground">n/a — keine Jahreszeilen</p>;
  const cols = years.slice().reverse();
  return (
    <div className="overflow-x-auto min-w-0" data-testid="annual-table">
      <table className="w-full min-w-[640px] text-[10px]">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1 pr-2 font-medium text-muted-foreground">Posten</th>
            {cols.map(y => <th key={y.fiscalYear} className="text-right py-1 px-1 font-medium">{y.fiscalYear}</th>)}
          </tr>
        </thead>
        <tbody>
          {ROWS.map(row => (
            <tr key={row.label} className="border-b border-border/40">
              <td className="py-1 pr-2 text-muted-foreground whitespace-nowrap">{row.label}</td>
              {cols.map(y => {
                const v = row.value(y);
                const margin = row.label.includes("Marge");
                const yoy = row.yoy?.(y);
                const shown = yoy ? yoyText(yoy.pct, yoy.reason) : null;
                return (
                  <td key={y.fiscalYear} className="py-1 px-1 text-right font-mono tabular-nums align-top">
                    <div>{v == null ? "n/a" : margin ? `${v.toFixed(1)}%` : fmt(v, ccy)}</div>
                    {shown && <div className={`text-[9px] ${shown.className}`}>{shown.text}</div>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
