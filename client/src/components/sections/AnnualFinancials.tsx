import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  FINANCIAL_HISTORY_ROUTE,
  formatDelta,
  formatMarginLevel,
  formatStatementAmount,
  type Delta,
  type FinancialHistory,
  type StatementYear,
} from "@shared/financial-history";
import { balanceSankey, incomeSankey, type SankeySegment } from "@shared/statement-sankey";
import { StatementSankey } from "./StatementSankey";
import { isUnregisteredRoute, readApiJson, type RequestFn } from "./SegmentSupplementView";

export type FinancialHistoryResponse = FinancialHistory & { ticker: string; source: string };

export async function fetchFinancialHistory(ticker: string, request: RequestFn = apiRequest): Promise<FinancialHistoryResponse> {
  const res = await request("GET", `${FINANCIAL_HISTORY_ROUTE}/${encodeURIComponent(ticker)}`);
  return await readApiJson(res, FINANCIAL_HISTORY_ROUTE) as FinancialHistoryResponse;
}

type RowSpec =
  | { kind: "money"; id: string; label: string; balance?: boolean; value: (year: StatementYear) => number | null; delta: (year: StatementYear) => Delta }
  | { kind: "margin"; id: string; label: string; value: (year: StatementYear) => number | null; reason: (year: StatementYear) => string | null; delta: (year: StatementYear) => Delta };

const ROWS: RowSpec[] = [
  { kind: "money", id: "revenue", label: "Umsatz", value: (year) => year.revenue, delta: (year) => year.revenueYoy },
  { kind: "money", id: "gross-profit", label: "Bruttogewinn", value: (year) => year.grossProfit, delta: (year) => year.grossProfitYoy },
  { kind: "margin", id: "gross-margin", label: "Bruttomarge", value: (year) => year.grossMarginPct, reason: (year) => year.grossMarginReason, delta: (year) => year.grossMarginYoyPp },
  { kind: "money", id: "operating-income", label: "Operatives Ergebnis", value: (year) => year.operatingIncome, delta: (year) => year.operatingIncomeYoy },
  { kind: "margin", id: "operating-margin", label: "Operative Marge", value: (year) => year.operatingMarginPct, reason: (year) => year.operatingMarginReason, delta: (year) => year.operatingMarginYoyPp },
  { kind: "money", id: "net-income", label: "Jahresüberschuss", value: (year) => year.netIncome, delta: (year) => year.netIncomeYoy },
  { kind: "margin", id: "net-margin", label: "Nettomarge", value: (year) => year.netMarginPct, reason: (year) => year.netMarginReason, delta: (year) => year.netMarginYoyPp },
  { kind: "money", id: "fcf", label: "Free Cash Flow", value: (year) => year.fcf, delta: (year) => year.fcfYoy },
  { kind: "margin", id: "fcf-margin", label: "FCF-Marge", value: (year) => year.fcfMarginPct, reason: (year) => year.fcfMarginReason, delta: (year) => year.fcfMarginYoyPp },
  { kind: "money", id: "assets", label: "Aktiva", balance: true, value: (year) => year.totalAssets, delta: (year) => year.totalAssetsYoy },
  { kind: "money", id: "equity", label: "Eigenkapital", balance: true, value: (year) => year.totalEquity, delta: (year) => year.totalEquityYoy },
  { kind: "money", id: "debt", label: "Schulden", balance: true, value: (year) => year.totalDebt, delta: (year) => year.totalDebtYoy },
  { kind: "money", id: "cash", label: "Cash", balance: true, value: (year) => year.cash, delta: (year) => year.cashYoy },
];

function deltaClass(delta: Delta): string {
  if (delta.value == null || delta.value === 0) return "text-muted-foreground";
  return delta.value > 0 ? "text-emerald-500" : "text-red-500";
}

function amountCurrency(row: RowSpec, year: StatementYear): string | null {
  switch (row.kind) {
    case "margin":
      return null;
    case "money":
      if (row.id === "fcf") return year.cashflowCurrency;
      if (row.id === "assets" || row.id === "equity" || row.id === "debt" || row.id === "cash") return year.balanceCurrency;
      return year.incomeCurrency;
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
}

function cellText(row: RowSpec, year: StatementYear): { text: string; title?: string } {
  switch (row.kind) {
    case "money":
      return { text: formatStatementAmount(row.value(year), amountCurrency(row, year)) };
    case "margin": {
      const value = row.value(year);
      return { text: formatMarginLevel(value), title: value == null ? row.reason(year) ?? undefined : undefined };
    }
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
}

export function AnnualFinancialsView({
  history,
  segments,
  view = "table",
  onToggle,
  errorText,
}: {
  history: FinancialHistoryResponse | null;
  segments: readonly SankeySegment[];
  view?: "table" | "sankey";
  onToggle?: () => void;
  errorText?: string | null;
}) {
  const years = history?.years ?? [];
  const latest = years.length > 0 ? years[years.length - 1] : null;
  const income = latest
    ? incomeSankey({
      segments,
      revenue: latest.revenue,
      grossProfit: latest.grossProfit,
      operatingIncome: latest.operatingIncome,
      netIncome: latest.netIncome,
      statementYear: latest.fiscalYear,
      statementCurrency: latest.incomeCurrency,
    })
    : null;
  const balance = latest
    ? balanceSankey({
      totalAssets: latest.totalAssets,
      totalEquity: latest.totalEquity,
      totalDebt: latest.totalDebt,
    })
    : null;
  return (
    <div className="min-w-0 space-y-2" data-testid="annual-financials">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Jahresabschluss</h4>
        <button
          type="button"
          onClick={onToggle}
          className="min-h-9 rounded border border-border px-2 text-[10px] sm:min-h-7"
          data-testid="button-sankey"
          aria-pressed={view === "sankey"}
        >
          {view === "sankey" ? "Tabelle" : "Sankey"}
        </button>
      </div>
      {history?.currencyNote && <p className="text-[10px] text-muted-foreground" data-testid="annual-currency-note">{history.currencyNote}</p>}
      {history?.note && <p className="text-[10px] text-muted-foreground">{history.note}</p>}
      {errorText && <p className="text-[10px] text-muted-foreground" data-testid="annual-error">{errorText}</p>}
      {view === "sankey" ? (
        <div className="space-y-3">
          {income && <StatementSankey model={income} />}
          {balance && <StatementSankey model={balance} />}
          {!latest && <p className="text-[10px] text-muted-foreground">n/a — keine Jahreszeilen</p>}
        </div>
      ) : (
        <YearTable years={years} />
      )}
    </div>
  );
}

function YearTable({ years }: { years: StatementYear[] }) {
  if (years.length === 0) return <p className="text-[10px] text-muted-foreground" data-testid="annual-empty">n/a — keine Jahreszeilen</p>;
  return (
    <div className="overflow-x-auto min-w-0" data-testid="annual-table">
      <table className="w-full min-w-[640px] text-[10px]">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1 pr-2 font-medium text-muted-foreground">Posten</th>
            {years.map((year) => <th key={year.fiscalYear} className="text-right py-1 px-1 font-medium">{year.fiscalYear}</th>)}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.id} className="border-b border-border/40">
              <td className="py-1 pr-2 text-muted-foreground whitespace-nowrap">{row.label}</td>
              {years.map((year) => {
                const shown = cellText(row, year);
                const delta = row.delta(year);
                const balanceRow = row.kind === "money" && row.balance === true;
                return (
                  <td key={year.fiscalYear} className="py-1 px-1 text-right font-mono tabular-nums align-top" data-testid={`cell-${row.id}-${year.fiscalYear}`} title={shown.title}>
                    <div>{shown.text}</div>
                    {balanceRow ? null : <div className={`text-[9px] ${deltaClass(delta)}`} title={delta.reason ?? undefined}>{formatDelta(delta)}</div>}
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

/**
 * Jahres-Tabelle und Sankey unter den bestehenden TTM-Karten.
 * Solange die Route nicht registriert ist, bleibt die Ergänzung unsichtbar.
 */
export function AnnualFinancials({
  ticker,
  segments,
  history,
  errorText,
  request,
}: {
  ticker: string;
  segments: readonly SankeySegment[];
  history?: FinancialHistoryResponse | null;
  errorText?: string | null;
  request?: RequestFn;
}) {
  const [view, setView] = useState<"table" | "sankey">("table");
  const query = useQuery({
    queryKey: [FINANCIAL_HISTORY_ROUTE, ticker],
    enabled: history === undefined,
    retry: false,
    staleTime: 15 * 60 * 1000,
    queryFn: () => fetchFinancialHistory(ticker, request),
  });
  if (history !== undefined) {
    return (
      <AnnualFinancialsView
        history={history}
        segments={segments}
        view={view}
        onToggle={() => setView((current) => current === "table" ? "sankey" : "table")}
        errorText={errorText}
      />
    );
  }
  if (query.isLoading) {
    return <p className="text-[10px] text-muted-foreground" data-testid="annual-loading">Jahreszahlen …</p>;
  }
  if (isUnregisteredRoute(query.error)) return null;
  if (query.isError || !query.data) {
    return <AnnualFinancialsView history={null} segments={segments} view={view} errorText="n/a — Jahreszahlen nicht erreichbar" />;
  }
  return (
    <AnnualFinancialsView
      history={query.data}
      segments={segments}
      view={view}
      onToggle={() => setView((current) => current === "table" ? "sankey" : "table")}
    />
  );
}
