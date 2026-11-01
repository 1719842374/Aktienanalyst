/**
 * GET /api/financial-history/:ticker — Jahresabschlüsse für die Tabelle in Sektion 4.
 * Nur Anzeige. Die Analyse-Route und der Score bleiben unberührt.
 */
import type { Express, Request, Response } from "express";
import { fmpBalanceSheet, fmpCashFlow, fmpIncomeStatement } from "./fmp";
import { buildFinancialHistory } from "../shared/financial-history";

const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;
const YEAR_LIMIT = 10;

export function normalizeHistoryTicker(raw: unknown): string | null {
  const t = String(raw ?? "").trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

export async function loadFinancialHistory(ticker: string, deps: {
  income: (t: string, limit: number) => Promise<unknown>;
  balance: (t: string, limit: number) => Promise<unknown>;
  cashflow: (t: string, limit: number) => Promise<unknown>;
} = {
  income: fmpIncomeStatement,
  balance: fmpBalanceSheet,
  cashflow: fmpCashFlow,
}) {
  try {
    const [income, balance, cashflow] = await Promise.all([
      deps.income(ticker, YEAR_LIMIT).catch(() => null),
      deps.balance(ticker, YEAR_LIMIT).catch(() => null),
      deps.cashflow(ticker, YEAR_LIMIT).catch(() => null),
    ]);
    const history = buildFinancialHistory({
      income: Array.isArray(income) ? income : [],
      balance: Array.isArray(balance) ? balance : [],
      cashflow: Array.isArray(cashflow) ? cashflow : [],
    });
    const note = history.note
      ?? (income == null && balance == null && cashflow == null ? "n/a — FMP-Abschlüsse nicht erreichbar" : null);
    return { ticker, ...history, note, source: "fmp" };
  } catch (err: any) {
    const history = buildFinancialHistory({ income: [], balance: [], cashflow: [] });
    return { ticker, ...history, note: `n/a — ${err?.message || "Abschluss-Abruf fehlgeschlagen"}`, source: "fmp" };
  }
}

export function registerFinancialHistoryRoute(app: Express): void {
  app.get("/api/financial-history/:ticker", async (req: Request, res: Response) => {
    const ticker = normalizeHistoryTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: "Ungültiger Ticker" });
    res.json(await loadFinancialHistory(ticker));
  });
}
