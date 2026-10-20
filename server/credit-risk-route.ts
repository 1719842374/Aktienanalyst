import type { Express, Request, Response } from "express";
import { fmpIncomeStatement, isFmpAvailable } from "./fmp";
import { normalizeDividendTicker } from "./dividend-route";
import { companyCreditFromIncome, emptyCompanyCredit, type CompanyCreditMetricsResponse } from "../shared/credit-risk";

/**
 * GET /api/credit-risk/company/:ticker — Zinsdeckung für die Kreditrisiko-Karte (Sektion 10, F1-20).
 * Bestehender FMP-Pfad: server/fmp.ts fmpIncomeStatement (fmpFetch mit Budget-Tracking, Abstand, Retry).
 * Ein FMP-Call je Ticker, 12h-Memory-Cache; Antworten ohne Zinsdeckung werden nicht gecacht.
 * Fehler, fehlender Key oder leere GuV → gleiche Form mit null-Werten und Notiz (n/a). Kein Score.
 * Die Analyse-Route (analyze-route.ts) wird nicht berührt.
 */
const CACHE_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; body: CompanyCreditMetricsResponse }>();

type Deps = { available: () => boolean; income: (ticker: string) => Promise<unknown> };
const defaultDeps: Deps = { available: isFmpAvailable, income: t => fmpIncomeStatement(t, 1) };

export async function loadCompanyCreditMetrics(ticker: string, deps: Deps = defaultDeps): Promise<CompanyCreditMetricsResponse> {
  if (!deps.available()) return emptyCompanyCredit(ticker, "FMP nicht konfiguriert");
  try {
    return companyCreditFromIncome(ticker, await deps.income(ticker));
  } catch (err: any) {
    const status = typeof err?.fmpStatus === "number" ? ` HTTP ${err.fmpStatus}` : "";
    return emptyCompanyCredit(ticker, `FMP-Fehler${status}`);
  }
}

/** Nur für Tests: Cache leeren. */
export function resetCompanyCreditCache(): void {
  cache.clear();
}

export function registerCreditRiskRoute(app: Express, deps: Deps = defaultDeps): void {
  app.get("/api/credit-risk/company/:ticker", async (req: Request, res: Response) => {
    const ticker = normalizeDividendTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: "Ungültiger Ticker" });
    const hit = cache.get(ticker);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body);
    const body = await loadCompanyCreditMetrics(ticker, deps);
    if (body.interestCoverage != null) cache.set(ticker, { at: Date.now(), body });
    res.json(body);
  });
}
