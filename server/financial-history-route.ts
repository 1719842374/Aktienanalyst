/**
 * GET /api/financial-history/:ticker — Jahresabschlüsse für Sektion 4.
 * Nur Anzeige. Kein Score, keine Umrechnung, kein neuer Provider.
 *
 * Nicht in server/routes-register.ts eingehängt (Schreibrecht Hype390).
 * Hunk, erst nach dessen Commit, erneutem Lesen und Folgeauftrag, vor der schließenden Klammer:
 *   const { registerFinancialHistoryRoute } = await import("./financial-history-route");
 *   registerFinancialHistoryRoute(app);
 */
import type { Express, Request, Response } from "express";
import { fmpBalanceSheet, fmpCashFlow, fmpIncomeStatement, isFmpAvailable } from "./fmp";
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
  const history = buildFinancialHistory({
    income: incomeRows ?? [],
    balance: balanceRows ?? [],
    cashflow: cashRows ?? [],
  });
  const missing = [incomeRows, balanceRows, cashRows].filter((rows) => rows == null).length;
  let note = history.note;
  if (missing === 3) note = "n/a — FMP-Abschlüsse nicht erreichbar";
  else if (missing > 0 && note == null) note = "n/a — nicht alle Abschluss-Endpunkte erreichbar";
  return { ticker, ...history, note, source: "fmp" };
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
