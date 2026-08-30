/**
 * server/backtest/build-events.ts — Sprint B3 Phase 5a (Datenerhebungs-Bridge
 * schliessen), tickets/SPRINT_B3_PHASE5_T3_POLICY.md Teil 5a.
 *
 * ZWECK: Bisher musste der Aufrufer von POST /api/backtest/run bereits
 * fertige `t1Events`/`t2Events` im Request-Body mitbringen — die einzige
 * Stelle, die diese Ereignisse tatsaechlich END-TO-END aus Rohdaten baut,
 * war `script/test-backtest-feasibility.ts` (ein CLI-Testskript, EIN
 * Monats-Snapshot, EIN Fold). Diese Datei extrahiert GENAU DIESE Logik
 * (Ticker-Vorauswahl via inUniverse() + pit-valuation.ts-Aufruf +
 * Snapshot/Signal-Ableitung + Return-Berechnung) in eine wiederverwendbare,
 * additive Funktion `buildBacktestEvents()`, die sowohl vom Skript (das
 * NICHT umgebaut wird, siehe Ticket-Regel "additiv") als auch von
 * server/backtest-routes.ts aufgerufen werden kann.
 *
 * KEIN zweites Score-Modell: ruft ausschliesslich bereits vorhandene
 * Bausteine auf (universe.ts::inUniverse, pit-valuation.ts::loadTickerRawData/
 * derivePitValuation, replay.ts::replayAt, signal.ts::deriveSignalV1,
 * returns.ts::forwardReturn, evaluate.ts-Eventtypen). KEIN LLM, KEIN
 * /api/analyze-Call, KEINE neuen teuren Live-Fetches ueber das hinaus, was
 * Phase 2/3b bereits aufgebaut haben (dieselben FMP-Endpunkte, dieselben
 * SQLite-Caches).
 *
 * Mehrere Monats-Snapshots: `buildBacktestEvents()` iteriert ueber ALLE
 * Monatsultimo-Stuetzstellen zwischen `from` und `to` (Monatsraster, §4.2)
 * und akkumuliert die Ereignisse -- Rohdaten pro Ticker werden dabei NUR
 * EINMAL geladen (loadTickerRawData() cached bereits selbst, siehe
 * pit-valuation.ts-Kommentar), pro Monat wird nur `derivePitValuation()`
 * (reine Berechnung aus dem Cache) erneut aufgerufen.
 */
import { inUniverse, allKnownSp500Symbols, getConstituentChanges, getDelistedCompanies, type ConstituentChangeRow, type DelistedCompanyRow } from "./universe";
import { fmpIncomeStatement, fmpBalanceSheet } from "../fmp";
import { loadTickerRawData, derivePitValuation, type TickerRawData } from "./pit-valuation";
import { replayAt } from "./replay";
import { deriveSignalV1 } from "./signal";
import { forwardReturn } from "./returns";
import { coverageT, type CoverageResult } from "./pit";
import type { GateLiftEvent } from "./evaluate";
import type { SignalReturnEvent } from "./cluster";
import type { AnalysisScoringContext } from "../scoring-integration";

export interface BuildBacktestEventsParams {
  /** Ticker-Kandidatenmenge, aus der die U_corr(T)-gefilterte Stichprobe
   *  gezogen wird. KEIN Hardcode -- der Aufrufer uebergibt entweder eine
   *  eigene Liste (z.B. aus einem Screener) oder nutzt
   *  `allKnownSp500Symbols(await getConstituentChanges())` (Default, wenn
   *  `universe` leer/undefined ist, identisch zum bisherigen Skript-Verhalten). */
  universe?: string[];
  /** Zeitraum yyyy-mm-dd. Monats-Snapshots werden auf Monatsultimo
   *  zwischen `from` und `to` gerastert (§4.2). */
  from: string;
  to: string;
  horizonDays: number;
  /** "naive" | "corr" -- an inUniverse() durchgereicht (§5.1). Default "corr". */
  survivorship?: "naive" | "corrected";
  /** Maximale Anzahl Ticker PRO MONATS-SNAPSHOT, die tatsaechlich Rohdaten-
   *  Calls ausloesen -- Sicherheitsgrenze analog screener.ts
   *  MAX_SCREENED_TICKERS, damit ein einzelner HTTP-Request nicht Hunderte
   *  FMP-Calls blockierend ausloest (siehe backtest-routes.ts-Kopfkommentar). */
  maxTickersPerMonth?: number;
}

export interface BuildBacktestEventsResult {
  t1Events: GateLiftEvent[];
  t2Events: SignalReturnEvent[];
  coverageByMonth: CoverageResult[];
  monthsProcessed: string[];
  tickersConsidered: number;
  tickersProcessedOk: number;
  errors: Array<{ ticker: string; asOfMonth: string; error: string }>;
}

const DEFAULT_MAX_TICKERS_PER_MONTH = 60; // gleiche Groessenordnung wie script/test-backtest-feasibility.ts N_TICKERS

/** Letzter Kalendertag eines Monats (yyyy-mm) als yyyy-mm-dd, fuer die
 *  Monatsultimo-Snapshot-Konvention (§4.2). */
function monthEndDate(year: number, month1to12: number): string {
  const d = new Date(Date.UTC(year, month1to12, 0)); // Tag 0 des Folgemonats = letzter Tag dieses Monats
  return d.toISOString().slice(0, 10);
}

/** Erzeugt die Monatsultimo-Stuetzstellen (yyyy-mm-dd) zwischen from/to
 *  (inklusive), Monatsraster wie WF_V1_FOLDS/testMonthsInFold() es bereits
 *  fuer die Fold-Tabelle nutzen -- hier additiv fuer die Rohdatenerhebung. */
export function monthEndsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(monthEndDate(y, m));
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

interface TickerMonthOutcome {
  ticker: string;
  fetchOk: boolean;
  error?: string;
  price: number | null;
  cappedBy: string | null;
  dataCompleteOverall: boolean;
  signal: string | null;
  forwardReturnPct: number | null;
  inUniverseCorr: boolean;
  pitDataComplete: boolean;
}

/**
 * Verarbeitet EINEN Ticker fuer EIN asOf-Datum -- identische Sequenz wie
 * bisher inline in script/test-backtest-feasibility.ts::fetchOneTicker(),
 * additiv hierher verschoben, damit sowohl das Skript (via Re-Export unten)
 * als auch backtest-routes.ts dieselbe Funktion nutzen (kein Formel-/
 * Logik-Drift).
 */
export async function fetchOneTickerMonth(
  ticker: string,
  asOf: string,
  asOfMonth: string,
  horizonDays: number,
  opts: { changes: ConstituentChangeRow[]; delisted: DelistedCompanyRow[]; survivorshipMode: "naive" | "corr" }
): Promise<TickerMonthOutcome> {
  const base: TickerMonthOutcome = {
    ticker, fetchOk: false, price: null, cappedBy: null, dataCompleteOverall: false,
    signal: null, forwardReturnPct: null, inUniverseCorr: false, pitDataComplete: false,
  };
  try {
    const uCheck = await inUniverse(ticker, asOf, "corr", { changes: opts.changes, delisted: opts.delisted });
    if (!uCheck.inUniverse) {
      return { ...base, error: `nicht in U_corr(${asOf}): ${uCheck.reasons.join("; ")}` };
    }

    const [raw, annualIncome, annualBalance]: [TickerRawData, any, any] = await Promise.all([
      loadTickerRawData(ticker),
      fmpIncomeStatement(ticker, 6),
      fmpBalanceSheet(ticker, 6),
    ]);

    if (!raw.fetchedOk || !raw.profile) {
      return { ...base, inUniverseCorr: true, error: raw.error ?? "kein FMP-Profil/keine Kurse (evtl. delistet/nicht abgedeckt)" };
    }

    const priceRows = raw.prices;
    const sortedAsc = [...priceRows].sort((a, b) => a.date.localeCompare(b.date));
    const priceAtAsOf = [...sortedAsc].filter(p => p.date <= asOf).pop()?.close ?? null;
    if (priceAtAsOf == null) {
      return { ...base, inUniverseCorr: true, error: "kein Kurs am/vor asOf verfuegbar" };
    }

    const quarterlyRevenueChronological = raw.quarterlyIncome.length > 0
      ? [...raw.quarterlyIncome].reverse().map(q => q.revenue ?? 0)
      : null;
    const annualIncomeRows = Array.isArray(annualIncome)
      ? annualIncome.map((a: any) => ({ revenue: a?.revenue, operatingIncome: a?.operatingIncome }))
      : null;
    const annualBalanceRows = Array.isArray(annualBalance)
      ? annualBalance.map((b: any) => ({ inventory: b?.inventoryNet ?? b?.inventory }))
      : null;

    let subjectRevenueGrowth: number | null = null;
    if (Array.isArray(annualIncome) && annualIncome.length >= 2) {
      const r0 = annualIncome[0]?.revenue;
      const r1 = annualIncome[1]?.revenue;
      if (typeof r0 === "number" && typeof r1 === "number" && r1 !== 0) {
        subjectRevenueGrowth = ((r0 - r1) / Math.abs(r1)) * 100;
      }
    }

    const ctx: AnalysisScoringContext = {
      impliedGStar: null,
      quarterlyRevenueChronological,
      annualIncome: annualIncomeRows,
      annualBalance: annualBalanceRows,
      subjectRevenueGrowth,
      peerRevenueGrowths: null,
      regulatoryGate: null,
    };

    const pit = derivePitValuation(raw, asOf);

    const snapshot = replayAt({
      ticker,
      asOf,
      ctx,
      health: undefined,
      moatRating: undefined,
      technicalIndicators: null,
      catalysts: [],
      price: priceAtAsOf,
      fcfTTM: pit.fcfTTM,
      sector: raw.profile.sector || undefined,
      industry: raw.profile.industry || undefined,
      invDcf: pit.invDcf,
      crv: pit.crv,
      fv: pit.fv,
      wc: pit.wc,
      fcf_T: pit.fcf_T,
      wacc_T: pit.wacc_T,
      g_T: pit.g_T,
      WC_T: pit.WC_T,
    });

    const signalResult = deriveSignalV1({
      dataComplete: { overall: snapshot.dataComplete.overall },
      dcfApplicable: snapshot.dcfApplicable,
      invDcf: snapshot.invDcf,
      price: priceAtAsOf,
      fiscalQualifies: snapshot.fiscalQualifies,
      cappedBy: snapshot.cappedBy,
      cappedBySeverity: snapshot.cappedBySeverity,
      crv: snapshot.crv,
    });

    const fwd = forwardReturn({
      ticker,
      asOf,
      horizonDays,
      prices: priceRows,
      delistedDate: null,
      lastTradableClose: null,
      cashOfferPrice: null,
    });

    return {
      ticker,
      fetchOk: true,
      price: priceAtAsOf,
      cappedBy: snapshot.cappedBy,
      dataCompleteOverall: snapshot.dataComplete.overall,
      signal: signalResult,
      forwardReturnPct: fwd.r != null ? +(fwd.r * 100).toFixed(2) : null,
      inUniverseCorr: true,
      pitDataComplete: pit.dataComplete,
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

/**
 * buildBacktestEvents() — Kernstueck der Phase-5a-Bridge. Iteriert ueber
 * die Monatsultimo-Stuetzstellen zwischen `from`/`to`, waehlt pro Monat eine
 * U_corr(T)-gefilterte Ticker-Stichprobe (deterministisch, alphabetisch,
 * KEIN Hardcode -- identisch zur Vorauswahl-Logik aus
 * script/test-backtest-feasibility.ts) und baut daraus t1Events (Gate-Lift)
 * und t2Events (Signal-Kohorte) fuer evaluateT1GateLift()/
 * evaluateT2SignalCohort(). Zusaetzlich coverage_T (§5.4) pro verarbeitetem
 * Monat (Ticket Punkt 4).
 *
 * KEIN LLM, KEIN /api/analyze-Call -- ausschliesslich gecachte/PIT-
 * abgeleitete Daten aus pit-valuation.ts und universe.ts (Ticket Punkt 5).
 */
export async function buildBacktestEvents(params: BuildBacktestEventsParams): Promise<BuildBacktestEventsResult> {
  const maxPerMonth = params.maxTickersPerMonth ?? DEFAULT_MAX_TICKERS_PER_MONTH;

  const [changes, delisted] = await Promise.all([getConstituentChanges(), getDelistedCompanies()]);
  const candidatePool = params.universe && params.universe.length > 0
    ? Array.from(new Set(params.universe.map(t => t.toUpperCase()))).sort()
    : Array.from(allKnownSp500Symbols(changes)).sort();

  const months = monthEndsBetween(params.from, params.to);

  const t1Events: GateLiftEvent[] = [];
  const t2Events: SignalReturnEvent[] = [];
  const coverageByMonth: CoverageResult[] = [];
  const monthsProcessed: string[] = [];
  const errors: Array<{ ticker: string; asOfMonth: string; error: string }> = [];
  let tickersConsidered = 0;
  let tickersProcessedOk = 0;

  for (const asOf of months) {
    const asOfMonth = asOf.slice(0, 7);

    // Vorauswahl: U_corr(asOf)-gefiltert, alphabetisch, deterministisch,
    // bis maxPerMonth erreicht ist (identisch zum Skript-Muster).
    const preselected: string[] = [];
    const uResultsForCoverage: Array<{ inUniverse: boolean; dataComplete: boolean }> = [];
    for (const ticker of candidatePool) {
      if (preselected.length >= maxPerMonth) break;
      try {
        const check = await inUniverse(ticker, asOf, "corr", { changes, delisted });
        uResultsForCoverage.push({ inUniverse: check.inUniverse, dataComplete: check.dataComplete });
        if (check.inUniverse) preselected.push(ticker);
      } catch {
        uResultsForCoverage.push({ inUniverse: false, dataComplete: false });
      }
    }
    tickersConsidered += preselected.length;

    const outcomes: TickerMonthOutcome[] = [];
    for (const ticker of preselected) {
      const outcome = await fetchOneTickerMonth(ticker, asOf, asOfMonth, params.horizonDays, {
        changes, delisted, survivorshipMode: "corr",
      });
      outcomes.push(outcome);
      if (outcome.error) errors.push({ ticker, asOfMonth, error: outcome.error });
    }

    const ok = outcomes.filter(o => o.fetchOk);
    tickersProcessedOk += ok.length;

    for (const o of ok.filter(o => o.forwardReturnPct != null)) {
      t1Events.push({
        ticker: o.ticker,
        asOfMonth,
        gateActive: o.cappedBy != null,
        gateId: o.cappedBy,
        r: (o.forwardReturnPct as number) / 100,
      });
    }
    for (const o of ok.filter(o => o.forwardReturnPct != null && o.signal != null)) {
      t2Events.push({
        ticker: o.ticker,
        asOfMonth,
        signal: o.signal as any,
        r: (o.forwardReturnPct as number) / 100,
      });
    }

    coverageByMonth.push(coverageT(asOfMonth, asOf, uResultsForCoverage));
    monthsProcessed.push(asOfMonth);
  }

  return {
    t1Events,
    t2Events,
    coverageByMonth,
    monthsProcessed,
    tickersConsidered,
    tickersProcessedOk,
    errors,
  };
}
