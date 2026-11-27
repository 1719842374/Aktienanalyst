/**
 * POST /api/valuechain/hype — Proxy-Hype aus bestehenden FMP-Abschlüssen.
 * Mechanismus aus PR 390. Kein Google-Trends-, kein LLM-, kein Mail-Call.
 * Bei knappem Budget oder ohne Key: n/a, kein Ersatz. Kein Gartner-Datensatz.
 */
import type { Express, Request, Response } from "express";
import { fmpAnalystEstimates, fmpCashFlow, fmpIncomeStatement, fmpRatios, wouldExceedBudget } from "./fmp";
import { HYPE_HISTORY_YEARS, assessHypeCycle, type HypeCompanyInput, type HypeCyclePayload } from "../shared/hype-cycle";

const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;

export type HypeFetcher = (ticker: string, limit: number) => Promise<unknown>;

export interface HypeLoadDeps {
  ratios: HypeFetcher;
  income: HypeFetcher;
  cashflow: HypeFetcher;
  estimates: HypeFetcher;
  budgetBlocked?: boolean;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function yearRows(raw: unknown): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

/** Gleicher Jahresschlüssel wie PR 390: calendarYear, sonst date. */
function datedRows(raw: unknown): { rows: { year: string; asOf: string | null; row: Record<string, unknown> }[]; droppedUndated: number } {
  let droppedUndated = 0;
  const rows = yearRows(raw).flatMap(row => {
    const year = String(row.calendarYear ?? row.date ?? "");
    if (!year) {
      droppedUndated += 1;
      return [];
    }
    const asOf = typeof row.date === "string" && row.date.trim() ? row.date.trim() : year;
    return [{ year, asOf, row }];
  });
  rows.sort((a, b) => a.year.localeCompare(b.year));
  return { rows, droppedUndated };
}

function dropNote(family: string, n: number): string | null {
  if (n <= 0) return null;
  return `n/a — ${n} ${family}-Zeilen ohne Datum, nicht in die Reihe genommen`;
}

export function companyFromRows(ticker: string, ratios: unknown, income: unknown, cashflow: unknown, estimates: unknown): HypeCompanyInput {
  const inc = datedRows(income);
  const cf = datedRows(cashflow);
  const ratioRows = datedRows(ratios);
  const estimateRows = datedRows(estimates);
  const cfByYear = new Map(cf.rows.map(r => [r.year.slice(0, 4), r]));
  const capexIntensityByYear = inc.rows.map(({ year, row }) => {
    const revenue = num(row.revenue);
    const cash = cfByYear.get(year.slice(0, 4));
    const capex = cash ? num(cash.row.capitalExpenditure ?? cash.row.capitalExpenditures) : null;
    if (revenue == null || revenue === 0 || capex == null) return null;
    return Math.abs(capex) / Math.abs(revenue);
  });
  const capexAsOf = inc.rows.map(({ year }) => cfByYear.get(year.slice(0, 4))?.asOf ?? null);
  const dataNotes = [
    dropNote("income-statement", inc.droppedUndated),
    dropNote("cash-flow-statement", cf.droppedUndated),
    dropNote("ratios", ratioRows.droppedUndated),
    dropNote("analyst-estimates", estimateRows.droppedUndated),
  ].filter((n): n is string => n != null);
  return {
    ticker,
    peByYear: ratioRows.rows.map(({ row }) => num(row.priceToEarningsRatio ?? row.peRatio)),
    peAsOf: ratioRows.rows.map(r => r.asOf),
    capexIntensityByYear,
    capexAsOf,
    epsEstimate: estimateRows.rows.map(({ row }) => num(row.estimatedEpsAvg ?? row.epsAvg)),
    epsAsOf: estimateRows.rows.map(r => r.asOf),
    dataNotes,
  };
}

export async function loadHypeCycle(tickers: readonly string[], deps: HypeLoadDeps): Promise<HypeCyclePayload> {
  const clean = Array.from(new Set(tickers.map(t => t.trim().toUpperCase()).filter(t => TICKER_RE.test(t))));
  if (deps.budgetBlocked) {
    const empty = assessHypeCycle([]);
    return {
      ...empty,
      notes: [...empty.notes, "n/a — FMP-Budget reicht für den Hype-Abruf nicht. Keine Werte erfunden."],
      skipped: clean,
    };
  }
  if (!clean.length) {
    const empty = assessHypeCycle([]);
    return { ...empty, notes: [...empty.notes, "n/a — kein gültiger Ticker"], skipped: [] };
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

export function registerHypeCycleRoute(app: Express, deps?: HypeLoadDeps): void {
  app.post("/api/valuechain/hype", async (req: Request, res: Response) => {
    const raw = req.body?.tickers;
    if (!Array.isArray(raw) || raw.length === 0) {
      return res.status(400).json({ error: "tickers fehlt" });
    }
    const tickers = raw.map((t: unknown) => String(t));
    const budgetBlocked = deps?.budgetBlocked ?? wouldExceedBudget(tickers.length * 4);
    try {
      const body = await loadHypeCycle(tickers, {
        ratios: deps?.ratios ?? fmpRatios,
        income: deps?.income ?? fmpIncomeStatement,
        cashflow: deps?.cashflow ?? fmpCashFlow,
        estimates: deps?.estimates ?? fmpAnalystEstimates,
        budgetBlocked,
      });
      res.json(body);
    } catch {
      res.status(500).json({ error: "n/a — Hype-Abruf fehlgeschlagen" });
    }
  });
}
