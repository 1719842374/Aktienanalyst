/**
 * POST /api/valuechain/hype — Proxy-Hype aus bestehenden FMP-Abschlüssen.
 * Kein Google-Trends-, kein LLM-Call. Bei knappem Budget oder ohne Key: n/a, kein Ersatz.
 */
import type { Express, Request, Response } from "express";
import { fmpAnalystEstimates, fmpCashFlow, fmpIncomeStatement, fmpRatios, wouldExceedBudget } from "./fmp";
import { HYPE_HISTORY_YEARS, assessHypeCycle, type HypeCompanyInput } from "../shared/hype-cycle";

const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function yearRows(raw: unknown): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

export function companyFromRows(ticker: string, ratios: unknown, income: unknown, cashflow: unknown, estimates: unknown): HypeCompanyInput {
  const byYear = (rows: Record<string, unknown>[]) =>
    rows
      .map(r => ({ year: String(r.calendarYear ?? r.date ?? ""), row: r }))
      .filter(r => r.year)
      .sort((a, b) => a.year.localeCompare(b.year));
  const inc = byYear(yearRows(income));
  const cf = byYear(yearRows(cashflow));
  const cfByYear = new Map(cf.map(r => [r.year.slice(0, 4), r.row]));
  const capexIntensityByYear = inc.map(({ year, row }) => {
    const revenue = num(row.revenue);
    const cash = cfByYear.get(year.slice(0, 4));
    const capex = cash ? num(cash.capitalExpenditure) : null;
    if (revenue == null || revenue === 0 || capex == null) return null;
    return Math.abs(capex) / Math.abs(revenue);
  });
  const peByYear = byYear(yearRows(ratios)).map(({ row }) => num(row.priceToEarningsRatio ?? row.peRatio));
  const epsEstimate = byYear(yearRows(estimates)).map(({ row }) => num(row.estimatedEpsAvg ?? row.epsAvg));
  return { ticker, peByYear, capexIntensityByYear, epsEstimate };
}

export async function loadHypeCycle(tickers: readonly string[], deps: {
  ratios: (t: string, limit: number) => Promise<unknown>;
  income: (t: string, limit: number) => Promise<unknown>;
  cashflow: (t: string, limit: number) => Promise<unknown>;
  estimates: (t: string, limit: number) => Promise<unknown>;
  budgetBlocked?: boolean;
} ) {
  const clean = Array.from(new Set(tickers.map(t => t.trim().toUpperCase()).filter(t => TICKER_RE.test(t))));
  if (deps.budgetBlocked) {
    return {
      ...assessHypeCycle([]),
      notes: ["n/a — FMP-Budget reicht für den Hype-Abruf nicht. Keine Werte erfunden."],
      skipped: clean,
    };
  }
  const inputs: HypeCompanyInput[] = [];
  const skipped: string[] = [];
  for (const ticker of clean) {
    try {
      const [ratios, income, cashflow, estimates] = await Promise.all([
        deps.ratios(ticker, HYPE_HISTORY_YEARS),
        deps.income(ticker, HYPE_HISTORY_YEARS),
        deps.cashflow(ticker, HYPE_HISTORY_YEARS),
        deps.estimates(ticker, HYPE_HISTORY_YEARS),
      ]);
      inputs.push(companyFromRows(ticker, ratios, income, cashflow, estimates));
    } catch {
      skipped.push(ticker);
    }
  }
  const assessed = assessHypeCycle(inputs);
  if (skipped.length) assessed.notes.push(`n/a — Abruf fehlgeschlagen: ${skipped.join(", ")}`);
  return { ...assessed, skipped };
}

export function registerHypeCycleRoute(app: Express): void {
  app.post("/api/valuechain/hype", async (req: Request, res: Response) => {
    const tickers = Array.isArray(req.body?.tickers) ? req.body.tickers.map((t: unknown) => String(t)) : [];
    if (!tickers.length) return res.status(400).json({ error: "tickers fehlt" });
    const body = await loadHypeCycle(tickers, {
      ratios: fmpRatios,
      income: fmpIncomeStatement,
      cashflow: fmpCashFlow,
      estimates: fmpAnalystEstimates,
      budgetBlocked: wouldExceedBudget(tickers.length * 4),
    });
    res.json(body);
  });
}
