/**
 * GET /api/analyze-recession/earnings-growth?region=US|EU|AS
 * Index-EPS YoY, Forward-Konsens, Growth Gap. Nur Anzeige, kein Score.
 * Kette: Route → bestehende FMP-Helfer und loadEtfBars → assembleEarningsGrowth.
 * Fehlende Felder: reason, nie 0. Die Analyse-Route bleibt unberührt.
 */
import type { Express, Request, Response } from "express";
import { isFmpAvailable, fmpIncomeStatement, fmpIncomeStatementQuarterly, fmpAnalystEstimates, fmpCashFlow, fmpKeyMetrics, fmpRatiosTtm } from "./fmp";
import { loadEtfBars } from "./recession-ta-route";
import { epsPrintFromRow, ntmEpsFromEstimateRows, ttmEpsFromRatiosTtmRow } from "../shared/recession-market-charts";
import { parseTaRegion, type RecessionTaRegion } from "../shared/recession-ta";
import {
  EARNINGS_GROWTH_PARAMS,
  assembleEarningsGrowth,
  earningsBook,
  fcfToEvPct,
  forwardGrowthPct,
  impliedGStarPct,
  na,
  type EarningsGrowthPayload,
  type GrowthReading,
} from "../shared/recession-earnings-growth";

let cache: { key: string; at: number; body: EarningsGrowthPayload } | null = null;

export function resetEarningsGrowthCache(): void {
  cache = null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function waccFromMetrics(row: unknown): number | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return num(r.wacc) ?? num(r.weightedAverageCostOfCapital);
}

function evFromMetrics(row: unknown): number | null {
  if (!row || typeof row !== "object") return null;
  return num((row as Record<string, unknown>).enterpriseValue);
}

function fcfFromCashflow(rows: unknown[]): number | null {
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const fcf = num((row as Record<string, unknown>).freeCashFlow);
    if (fcf != null) return fcf;
  }
  return null;
}

async function rowsOf(load: () => Promise<unknown>): Promise<unknown[]> {
  const raw = await load();
  return Array.isArray(raw) ? raw : [];
}

export async function buildEarningsGrowth(region: RecessionTaRegion): Promise<EarningsGrowthPayload> {
  const book = earningsBook(region);
  const notes: string[] = [];
  const barsResult = await loadEtfBars(book.etf).catch((err: unknown) => {
    notes.push(`Kurs ${book.etf}: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    return { bars: [] as { date: string; close: number }[], source: null, error: notes[notes.length - 1] };
  });
  if (barsResult.error) notes.push(barsResult.error);

  let earningsSymbol: string | null = null;
  let annual: { date: string; eps: number }[] = [];
  const candidates = [book.etf, book.indexFallback].filter((s): s is string => !!s);

  if (!isFmpAvailable()) {
    notes.push("FMP nicht konfiguriert — EPS, Konsens und g* n/a");
  } else {
    for (const symbol of candidates) {
      try {
        const income = await rowsOf(() => fmpIncomeStatement(symbol, EARNINGS_GROWTH_PARAMS.annualStatementLimit));
        const prints = income.map(epsPrintFromRow).filter((p): p is { date: string; eps: number } => p != null);
        if (prints.length >= EARNINGS_GROWTH_PARAMS.minAnnualPrints) {
          earningsSymbol = symbol;
          annual = prints;
          break;
        }
        notes.push(`${symbol}: Income Statement ohne zwei EPS-Jahre`);
      } catch (err) {
        notes.push(`${symbol}: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
      }
    }
  }

  let forward: GrowthReading = na(notes.find(n => n.startsWith("FMP")) ?? "Forward-Konsens: kein EPS-Symbol");
  let gStar: GrowthReading = na("g*: Index-WACC liegt in keiner angebundenen Quelle (kein angenommener Satz)");
  let fcfYield: GrowthReading = na("FCF/EV: keine Jahreszahlen");

  if (earningsSymbol && isFmpAvailable()) {
    const asOf = barsResult.bars.length ? barsResult.bars[barsResult.bars.length - 1].date : new Date().toISOString().slice(0, 10);
    let ttm: number | null = null;
    try {
      ttm = ttmEpsFromRatiosTtmRow(await fmpRatiosTtm(earningsSymbol));
    } catch (err) {
      notes.push(`ratios-ttm: ${String((err as Error)?.message ?? err).slice(0, 80)}`);
    }
    if (ttm == null) {
      try {
        const quarters = (await rowsOf(() => fmpIncomeStatementQuarterly(earningsSymbol!, EARNINGS_GROWTH_PARAMS.quartersPerYear * 2)))
          .map(epsPrintFromRow)
          .filter((p): p is { date: string; eps: number } => p != null)
          .sort((a, b) => a.date.localeCompare(b.date));
        const last4 = quarters.slice(-EARNINGS_GROWTH_PARAMS.quartersPerYear);
        if (last4.length < EARNINGS_GROWTH_PARAMS.quartersPerYear) notes.push("TTM-EPS: weniger als 4 Quartalsdrucke und kein ratios-ttm");
        else ttm = last4.reduce((s, p) => s + p.eps, 0);
      } catch (err) {
        notes.push(`Quartals-EPS: ${String((err as Error)?.message ?? err).slice(0, 80)}`);
      }
    }
    let consensus: number | null = null;
    try {
      consensus = ntmEpsFromEstimateRows(await fmpAnalystEstimates(earningsSymbol, EARNINGS_GROWTH_PARAMS.quartersPerYear * 2), asOf);
      if (consensus == null) notes.push("analyst-estimates ohne epsAvg");
    } catch (err) {
      notes.push(`analyst-estimates: ${String((err as Error)?.message ?? err).slice(0, 80)}`);
    }
    forward = forwardGrowthPct(consensus, ttm);

    let fcf: number | null = null;
    let ev: number | null = null;
    let wacc: number | null = null;
    try {
      fcf = fcfFromCashflow(await rowsOf(() => fmpCashFlow(earningsSymbol!, 2)));
      if (fcf == null) notes.push("cash-flow ohne freeCashFlow");
    } catch (err) {
      notes.push(`cash-flow: ${String((err as Error)?.message ?? err).slice(0, 80)}`);
    }
    try {
      const metrics = await rowsOf(() => fmpKeyMetrics(earningsSymbol!, 1));
      ev = evFromMetrics(metrics[0]);
      wacc = waccFromMetrics(metrics[0]);
      if (ev == null) notes.push("key-metrics ohne enterpriseValue");
      if (wacc == null) notes.push("key-metrics ohne WACC");
    } catch (err) {
      notes.push(`key-metrics: ${String((err as Error)?.message ?? err).slice(0, 80)}`);
    }
    fcfYield = fcfToEvPct(fcf, ev);
    gStar = impliedGStarPct(wacc, fcf, ev);
  }

  return assembleEarningsGrowth({
    region,
    earningsSymbol,
    bars: barsResult.bars,
    annualEps: annual,
    forward,
    gStar,
    fcfToEvPct: fcfYield,
    notes,
  });
}

function usable(body: EarningsGrowthPayload): boolean {
  return body.prices.length > 0 || body.historical.length > 0 || body.forward.value != null;
}

export function registerEarningsGrowthRoute(app: Express): void {
  app.get("/api/analyze-recession/earnings-growth", async (req: Request, res: Response) => {
    const region = parseTaRegion(req.query.region);
    const now = Date.now();
    if (cache && cache.key === region && now - cache.at < EARNINGS_GROWTH_PARAMS.cacheTtlMs) {
      return res.json(cache.body);
    }
    try {
      const body = await buildEarningsGrowth(region);
      if (usable(body)) cache = { key: region, at: now, body };
      res.json(body);
    } catch (err) {
      const detail = String((err as Error)?.message ?? err).slice(0, 160);
      const book = earningsBook(region);
      res.json(assembleEarningsGrowth({
        region,
        earningsSymbol: null,
        bars: [],
        annualEps: [],
        forward: na(`n/a — ${detail}`),
        gStar: na(`n/a — ${detail}`),
        fcfToEvPct: na(`n/a — ${detail}`),
        notes: [`${book.etf}: ${detail}`],
      }));
    }
  });
}
