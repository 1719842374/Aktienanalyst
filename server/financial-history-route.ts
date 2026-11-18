/**
 * GET /api/financial-history/:ticker — Jahresabschlüsse für Sektion 4.
 * Nur Anzeige. Kein Score, kein neuer Provider.
 * Beträge über convertFmpRowsToUsd in USD, bevor die Tabelle und der Sankey sie lesen.
 * Fehlt der FX-Kurs, bleiben die Beträge n/a (kein Faktor 1).
 *
 * Registriert am Ende von registerRoutes in server/routes-register.ts.
 * Der Hype-Hunk von #466 (nach registerValueChainRoutes) bleibt außerhalb dieses Aufrufs.
 */
import type { Express, Request, Response } from "express";
import { convertFmpRowsToUsd, fmpBalanceSheet, fmpCashFlow, fmpIncomeStatement, isFmpAvailable } from "./fmp";
import {
  FINANCIAL_HISTORY_ROUTE,
  FINANCIAL_HISTORY_YEAR_LIMIT,
  buildFinancialHistory,
  type FinancialHistory,
} from "../shared/financial-history";

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,31}$/i;

export interface FinancialHistoryDeps {
  income: (ticker: string, limit: number) => Promise<unknown>;
  balance: (ticker: string, limit: number) => Promise<unknown>;
  cashflow: (ticker: string, limit: number) => Promise<unknown>;
  fmpAvailable: () => boolean;
}

export function defaultFinancialHistoryDeps(): FinancialHistoryDeps {
  return {
    income: fmpIncomeStatement,
    balance: fmpBalanceSheet,
    cashflow: fmpCashFlow,
    fmpAvailable: isFmpAvailable,
  };
}

export function normalizeHistoryTicker(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const ticker = String(value ?? "").trim().toUpperCase();
  return TICKER_RE.test(ticker) ? ticker : null;
}

function asRows(value: unknown): unknown[] | null {
  if (value == null) return null;
  return Array.isArray(value) ? value : null;
}

const HISTORY_MONEY_KEYS = [
  "revenue", "totalRevenue", "grossProfit", "operatingIncome", "netIncome",
  "freeCashFlow", "operatingCashFlow", "netCashProvidedByOperatingActivities",
  "capitalExpenditure", "capitalExpenditures",
  "totalAssets", "totalStockholdersEquity", "totalEquity", "totalDebt",
  "cashAndCashEquivalents", "cashAndShortTermInvestments", "totalLiabilities",
] as const;

function reportedCode(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const code = (row as { reportedCurrency?: unknown }).reportedCurrency;
  if (typeof code !== "string") return null;
  const trimmed = code.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(trimmed) ? trimmed : null;
}

function fxStamp(row: unknown): { from: string; rate: number } | null {
  if (!row || typeof row !== "object") return null;
  const fx = (row as { _fxConverted?: { from?: unknown; rate?: unknown } })._fxConverted;
  if (!fx || typeof fx.from !== "string") return null;
  const rate = Number(fx.rate);
  if (!(rate > 0) || rate === 1) return null;
  return { from: fx.from.trim().toUpperCase(), rate };
}

/** Nach convertFmpRowsToUsd: USD beschriften, sonst Beträge leeren. USD-Zeilen bleiben. */
export function labelHistoryRows(rows: unknown[]): { rows: unknown[]; note: string | null } {
  const sample = rows.find((row) => reportedCode(row));
  const code = reportedCode(sample);
  if (!code || code === "USD") return { rows, note: null };
  const fx = fxStamp(sample);
  if (fx && fx.from === code) {
    return {
      rows: rows.map((row) => (row && typeof row === "object" ? { ...row, reportedCurrency: "USD" } : row)),
      note: `umgerechnet aus ${code} @ ${fx.rate}, Quelle FMP ${code}USD`,
    };
  }
  return {
    rows: rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const next: Record<string, unknown> = { ...(row as Record<string, unknown>), reportedCurrency: null };
      for (const key of HISTORY_MONEY_KEYS) {
        if (typeof next[key] === "number") next[key] = null;
      }
      return next;
    }),
    note: `n/a — FX ${code}USD fehlt, kein Faktor 1`,
  };
}

async function usdHistoryRows(rows: unknown[] | null): Promise<{ rows: unknown[]; note: string | null }> {
  if (!rows) return { rows: [], note: null };
  const converted = await convertFmpRowsToUsd(rows as Record<string, unknown>[]);
  return labelHistoryRows(converted);
}

export async function loadFinancialHistory(
  ticker: string,
  deps: FinancialHistoryDeps = defaultFinancialHistoryDeps(),
): Promise<FinancialHistory & { ticker: string; source: "fmp" }> {
  if (!deps.fmpAvailable()) {
    const empty = buildFinancialHistory({ income: [], balance: [], cashflow: [] });
    return {
      ticker,
      ...empty,
      note: "n/a — FMP_API_KEY fehlt, Abschlüsse nicht geladen",
      source: "fmp",
    };
  }
  const [income, balance, cashflow] = await Promise.all([
    deps.income(ticker, FINANCIAL_HISTORY_YEAR_LIMIT).catch(() => null),
    deps.balance(ticker, FINANCIAL_HISTORY_YEAR_LIMIT).catch(() => null),
    deps.cashflow(ticker, FINANCIAL_HISTORY_YEAR_LIMIT).catch(() => null),
  ]);
  const incomeRows = asRows(income);
  const balanceRows = asRows(balance);
  const cashRows = asRows(cashflow);
  const [incomeUsd, balanceUsd, cashUsd] = await Promise.all([
    usdHistoryRows(incomeRows),
    usdHistoryRows(balanceRows),
    usdHistoryRows(cashRows),
  ]);
  const history = buildFinancialHistory({
    income: incomeUsd.rows,
    balance: balanceUsd.rows,
    cashflow: cashUsd.rows,
  });
  const fxNote = incomeUsd.note ?? balanceUsd.note ?? cashUsd.note;
  const missing = [incomeRows, balanceRows, cashRows].filter((rows) => rows == null).length;
  let note = history.note;
  if (missing === 3) note = "n/a — FMP-Abschlüsse nicht erreichbar";
  else if (missing > 0 && note == null) note = "n/a — nicht alle Abschluss-Endpunkte erreichbar";
  return {
    ticker,
    ...history,
    currencyNote: fxNote ?? history.currencyNote,
    note,
    source: "fmp",
  };
}

export function registerFinancialHistoryRoute(
  app: Express,
  deps: FinancialHistoryDeps = defaultFinancialHistoryDeps(),
): void {
  app.get(`${FINANCIAL_HISTORY_ROUTE}/:ticker`, async (req: Request, res: Response) => {
    const ticker = normalizeHistoryTicker(req.params.ticker);
    if (!ticker) {
      res.status(400).json({ error: "Ungültiger Ticker" });
      return;
    }
    res.json(await loadFinancialHistory(ticker, deps));
  });
}
