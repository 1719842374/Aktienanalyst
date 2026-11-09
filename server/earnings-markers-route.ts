/**
 * GET /api/earnings-markers/:ticker — Beat/Miss für das Kurs-Chart.
 * Quelle: /stable/earnings-surprises.
 * Fallback: /stable/income-statement?period=quarter und
 * /stable/analyst-estimates?period=quarter, verbunden nur über dasselbe Datum.
 * Nur Anzeige. Kein Score.
 */
import type { Express, Request, Response } from "express";
import { fmpAnalystEstimatesQuarterly, fmpEarningsSurprises, fmpIncomeStatementQuarterly } from "./fmp";
import { buildEarningsMarkers, type EarningsRaw } from "../shared/earnings-markers";

const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;
/** Abruffenster für den Fallback, keine Klassifikationsschwelle. */
const STATEMENT_LIMIT = 40;

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function dateOf(row: Record<string, unknown>): string {
  return typeof row.date === "string" ? row.date.slice(0, 10) : "";
}

export function rowsFromFmp(raw: unknown): EarningsRaw[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: EarningsRaw[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = dateOf(r);
    if (!date) continue;
    out.push({
      date,
      revenueActual: num(r.revenueActual ?? r.actualRevenue ?? r.revenue),
      revenueEstimate: num(r.revenueEstimated ?? r.estimatedRevenue),
      epsActual: num(r.epsActual ?? r.actualEarningResult ?? r.eps),
      epsEstimate: num(r.epsEstimated ?? r.estimatedEarning),
    });
  }
  return out;
}

/**
 * Ist aus dem Income Statement, Schätzung nur bei exakt gleichem Datum.
 * Kein Nachbarquartal. Das Datum ist das Periodenende (Feld date).
 */
export function rowsFromStatements(incomeRaw: unknown, estimatesRaw: unknown): EarningsRaw[] {
  const income = Array.isArray(incomeRaw) ? incomeRaw : [];
  const estimates = Array.isArray(estimatesRaw) ? estimatesRaw : [];
  const byDate = new Map<string, { revenueEstimate: number | null; epsEstimate: number | null }>();
  for (const row of estimates) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = dateOf(r);
    if (!date || byDate.has(date)) continue;
    byDate.set(date, {
      revenueEstimate: num(r.revenueAvg ?? r.estimatedRevenueAvg ?? r.revenueEstimated),
      epsEstimate: num(r.epsAvg ?? r.estimatedEpsAvg ?? r.estimatedEarning),
    });
  }
  const out: EarningsRaw[] = [];
  for (const row of income) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = dateOf(r);
    if (!date) continue;
    const est = byDate.get(date);
    out.push({
      date,
      revenueActual: num(r.revenue),
      revenueEstimate: est?.revenueEstimate ?? null,
      epsActual: num(r.epsdiluted ?? r.epsDiluted ?? r.eps),
      epsEstimate: est?.epsEstimate ?? null,
    });
  }
  return out;
}

export async function loadEarningsMarkers(ticker: string, deps: {
  surprises: (t: string) => Promise<unknown>;
  income: (t: string) => Promise<unknown>;
  estimates: (t: string) => Promise<unknown>;
} = {
  surprises: fmpEarningsSurprises,
  income: (t) => fmpIncomeStatementQuarterly(t, STATEMENT_LIMIT),
  estimates: (t) => fmpAnalystEstimatesQuarterly(t, STATEMENT_LIMIT),
}) {
  let source: "earnings-surprises" | "income-statement+analyst-estimates" | "none" = "none";
  let note: string | null = null;
  let rows: EarningsRaw[] = [];
  try {
    rows = rowsFromFmp(await deps.surprises(ticker));
    source = rows.length ? "earnings-surprises" : "none";
    if (!rows.length) note = "earnings-surprises ohne Zeilen";
  } catch (err: any) {
    note = `earnings-surprises nicht erreichbar${err?.fmpStatus ? ` (HTTP ${err.fmpStatus})` : ""}`;
  }
  if (!rows.length) {
    let income: unknown = [];
    let estimates: unknown = [];
    let incomeErr: string | null = null;
    let estErr: string | null = null;
    try {
      income = await deps.income(ticker);
    } catch (err: any) {
      incomeErr = `income-statement fehlgeschlagen${err?.fmpStatus ? ` (HTTP ${err.fmpStatus})` : ""}`;
    }
    try {
      estimates = await deps.estimates(ticker);
    } catch (err: any) {
      estErr = `analyst-estimates fehlgeschlagen${err?.fmpStatus ? ` (HTTP ${err.fmpStatus})` : ""}`;
    }
    const fallback = rowsFromStatements(income, estimates);
    const parts = [note, incomeErr, estErr].filter((part): part is string => !!part);
    if (fallback.length) {
      rows = fallback;
      source = "income-statement+analyst-estimates";
      parts.push("Fallback Income Statement + Analyst Estimates");
      parts.push("Datum ist das Periodenende (FMP date), kein separates Ankündigungsdatum");
      note = parts.join(" · ");
    } else {
      parts.push("n/a — keine Earnings-Zeilen");
      note = parts.join(" · ");
    }
  }
  const built = buildEarningsMarkers(rows);
  return { ticker, source, note, ...built };
}

export function registerEarningsMarkersRoute(app: Express): void {
  app.get("/api/earnings-markers/:ticker", async (req: Request, res: Response) => {
    const ticker = String(req.params.ticker ?? "").trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: "Ungültiger Ticker" });
    res.json(await loadEarningsMarkers(ticker));
  });
}
