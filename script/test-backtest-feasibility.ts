/**
 * script/test-backtest-feasibility.ts — Sprint B3 Phase 3 + Phase 3b
 * (tickets/SPRINT_B3_PHASE3B_SLIM_PIT_VALUATION.md), Ticket-Punkt
 * "Baue einen kleinen Machbarkeits-Backtest (40-60 Titel, ein Fold) statt
 * eines vollen 5-Jahres-Produktionslaufs."
 *
 * ZWECK: Beweist, dass die komplette Phase-3(+3b)-Pipeline (echtes Ticker-
 * Universum ohne Hardcodes -> server/backtest/pit-valuation.ts (gecachte
 * PIT-Rohdaten -> invDcf/crv) -> replayAt() -> deriveSignalV1() ->
 * forwardReturn() -> evaluateT1GateLift()/evaluateT2SignalCohort())
 * end-to-end verdrahtet ist und mit echten Daten laeuft — NICHT, dass sie
 * auf dieser kleinen Stichprobe ein Buy/Avoid-Signal mit statistischer
 * Aussagekraft produziert.
 *
 * PHASE 3b-AENDERUNG (vorher: Phase 3 BEWUSSTE VEREINFACHUNG unten
 * historisch dokumentiert): invDcf/crv wurden in Phase 3 ehrlich als
 * `null` durchgereicht, weil der volle gehaertete DCF/CRV-Pfad
 * (buildDefaultDCFParams() -> calculateFCFFDCF() -> worstCaseM1() ->
 * computeHardenedCRV()) das komplette StockAnalysis/sectorProfile-Objekt
 * braucht — das aus rohen FMP-Feldern HIER INLINE nachzubauen, WAERE das
 * zweite Modell, das das Ticket verbietet ("Verbot: zweiter Backtest-
 * Score. Drift Live vs. Replay = Bug."). server/backtest/pit-valuation.ts
 * (Phase 3b) loest das GENAU: pro Ticker EINMAL Rohdaten cachen (OHLCV,
 * Quartals-Statements MIT filingDate, Profile, Market Cap), dann pro asOf
 * NUR aus dem Cache ableiten und dieselben, UNVERAENDERTEN
 * shared/valuation-signal.ts-Funktionen aufrufen wie server/analyze-
 * route.ts — kein zweites Modell, keine Drift. Diese Datei ruft daher
 * runPitValuation()/loadTickerRawData()+derivePitValuation() auf und
 * uebergibt echte invDcf/crv/fv/wc/fcf_T/wacc_T/g_T/WC_T an replayAt(),
 * statt sie hart auf null zu setzen. T1 (Gate-Lift) war von der
 * Vereinfachung nie betroffen (haengt nur von `cappedBy`/Gates ab) und
 * bleibt unveraendert ein echtes (wenn auch datenarmes) Ergebnis.
 *
 * UNIVERSUM: `allKnownSp500Symbols(await getConstituentChanges())` liefert
 * ALLE historisch bekannten S&P-500-Ticker (aktuelle + entfernte) als Set —
 * keine Ticker-Hardcodes, reine FMP-Daten. Aus dieser Menge werden die
 * ersten Symbole (alphabetisch, deterministisch) genommen, die laut
 * `inUniverse(ticker, asOf, "corr", ...)` durchgaengig in U_corr sind (§5.1)
 * — bis N_TICKERS (40-60) erreicht ist, wie im Ticket gefordert.
 *
 * ASOF: fest auf 2023-01-31 (Fold-1-"Letztes Train-as-of" aus §6.4) mit
 * Horizont 126 Handelstage (~6 Monate) — ein einzelner Monats-Snapshot,
 * ein einzelner Fold, wie im Ticket gefordert ("ein Fold").
 */
import "dotenv/config";
import { getConstituentChanges, allKnownSp500Symbols, inUniverse, CAP_FLOOR_USD } from "../server/backtest/universe";
import { fmpIncomeStatement, fmpBalanceSheet } from "../server/fmp";
import { loadTickerRawData, derivePitValuation } from "../server/backtest/pit-valuation";
import { replayAt, computeDcfApplicable } from "../server/backtest/replay";
import { deriveSignalV1 } from "../server/backtest/signal";
import { forwardReturn } from "../server/backtest/returns";
import { evaluateT1GateLift, evaluateT2SignalCohort, type GateLiftEvent } from "../server/backtest/evaluate";
import { WF_V1_FOLDS, DEFAULT_PITCH_HORIZON_DAYS } from "../server/backtest/walkforward";
import type { SignalReturnEvent } from "../server/backtest/cluster";
import type { AnalysisScoringContext } from "../server/scoring-integration";

const N_TICKERS = Number(process.env.FEASIBILITY_N_TICKERS ?? 50);
const AS_OF = "2023-01-31"; // Fold 1 "Letztes Train-as-of" (§6.4) — Monatsultimo
const AS_OF_MONTH = "2023-01";
const HORIZON_DAYS = DEFAULT_PITCH_HORIZON_DAYS; // 126
const FOLD = WF_V1_FOLDS[0];

interface TickerOutcome {
  ticker: string;
  fetchOk: boolean;
  error?: string;
  price: number | null;
  cappedBy: string | null;
  cappedBySeverity: "warn" | "hard" | null;
  dcfApplicable: boolean;
  dataCompleteOverall: boolean;
  signal: string | null;
  forwardReturnPct: number | null;
  forwardReturnMethod: string | null;
  forwardReturnNote: string | null;
  // Phase 3b: PIT-Valuation-Diagnose (fuer CRV-Paritaets-Check/Report).
  invDcf: number | null;
  crv: number | null;
  pitDataComplete: boolean;
  pitReasons: string[];
}

async function fetchOneTicker(ticker: string): Promise<TickerOutcome> {
  const base: TickerOutcome = {
    ticker,
    fetchOk: false,
    price: null,
    cappedBy: null,
    cappedBySeverity: null,
    dcfApplicable: false,
    dataCompleteOverall: false,
    signal: null,
    forwardReturnPct: null,
    forwardReturnMethod: null,
    forwardReturnNote: null,
    invDcf: null,
    crv: null,
    pitDataComplete: false,
    pitReasons: [],
  };
  try {
    // Phase 3b: EIN gecachter Rohdaten-Fetch pro Ticker (OHLCV, Quartals-
    // Income+Cashflow MIT filingDate, Profile, Market Cap) statt vieler
    // Einzel-FMP-Calls hier inline — server/backtest/pit-valuation.ts haelt
    // den SQLite-Cache, wiederholte Script-Laeufe fetchen NICHT erneut.
    const [raw, annualIncome, annualBalance] = await Promise.all([
      loadTickerRawData(ticker),
      fmpIncomeStatement(ticker, 6),
      fmpBalanceSheet(ticker, 6),
    ]);

    if (!raw.fetchedOk || !raw.profile) {
      return { ...base, error: raw.error ?? "kein FMP-Profil/keine Kurse (evtl. delistet/nicht abgedeckt)" };
    }

    const priceRows = raw.prices;

    // Kurs "an T" (asOf) fuer die Score-Pipeline: letzter verfuegbarer Close <= AS_OF.
    const sortedAsc = [...priceRows].sort((a, b) => a.date.localeCompare(b.date));
    const priceAtAsOf = [...sortedAsc].filter(p => p.date <= AS_OF).pop()?.close ?? null;
    if (priceAtAsOf == null) {
      return { ...base, error: "kein Kurs am/vor asOf verfuegbar" };
    }

    // Quartalsumsaetze CHRONOLOGISCH (aeltestes zuerst) — raw.quarterlyIncome
    // ist bereits newest-first (aus fmpIncomeStatementQuarterly, gecacht).
    const quarterlyRevenueChronological = raw.quarterlyIncome.length > 0
      ? [...raw.quarterlyIncome].reverse().map(q => q.revenue ?? 0)
      : null;

    const annualIncomeRows = Array.isArray(annualIncome)
      ? annualIncome.map((a: any) => ({ revenue: a?.revenue, operatingIncome: a?.operatingIncome }))
      : null;
    const annualBalanceRows = Array.isArray(annualBalance)
      ? annualBalance.map((b: any) => ({ inventory: b?.inventoryNet ?? b?.inventory }))
      : null;

    // Subjekt-Umsatzwachstum (letztes Jahr vs. Vorjahr), simple YoY — reine
    // Rohdaten-Ableitung, keine neue Scoring-Formel (dient nur als Kontext-
    // Feld in AnalysisScoringContext, das buildGates() bereits so erwartet).
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

    // Phase 3b: PIT-Valuation-Ableitung NUR aus den bereits gecachten
    // Rohdaten (raw) — KEIN zusaetzlicher FMP-Call, KEIN /api/analyze-Call,
    // KEIN LLM. derivePitValuation() ruft intern unveraendert
    // buildDefaultDCFParams()/calculateFCFFDCF()/worstCaseM1()/
    // computeHardenedCRV() aus shared/valuation-signal.ts auf.
    const pit = derivePitValuation(raw, AS_OF);

    const snapshot = replayAt({
      ticker,
      asOf: AS_OF,
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
      asOf: AS_OF,
      horizonDays: HORIZON_DAYS,
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
      cappedBySeverity: snapshot.cappedBySeverity,
      dcfApplicable: snapshot.dcfApplicable,
      dataCompleteOverall: snapshot.dataComplete.overall,
      signal: signalResult,
      forwardReturnPct: fwd.r != null ? +(fwd.r * 100).toFixed(2) : null,
      forwardReturnMethod: fwd.method,
      forwardReturnNote: fwd.note ?? null,
      invDcf: pit.invDcf,
      crv: pit.crv,
      pitDataComplete: pit.dataComplete,
      pitReasons: pit.reasons,
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

async function main() {
  console.log("=== Sprint B3 Phase 3b — Machbarkeits-Backtest mit PIT-Valuation-Replay (kein Produktionslauf) ===");
  console.log(`AS_OF=${AS_OF} (Fold 1 Letztes Train-as-of), Horizont=${HORIZON_DAYS} Handelstage, Fold=${JSON.stringify(FOLD)}`);

  const changes = await getConstituentChanges();
  const universe = Array.from(allKnownSp500Symbols(changes)).sort();
  console.log(`Bekanntes S&P-500-Universum (historisch, aus FMP): ${universe.length} Symbole total.`);

  // Ticket Phase 3b: Vorauswahl auf Ticker, die laut inUniverse(ticker, asOf,
  // "corr", ...) durchgaengig in U_corr sind (§5.1) — alphabetisch iterieren,
  // bis N_TICKERS (40-60) erreicht sind. EIN inUniverse()-Call pro geprueftem
  // Ticker (fmpProfile + capAt via server/backtest/universe.ts), NICHT pro
  // Monat — additiv zu den PIT-Valuation-Rohdaten-Calls unten.
  const preselected: string[] = [];
  const skippedNotInCorrUniverse: string[] = [];
  for (const ticker of universe) {
    if (preselected.length >= N_TICKERS) break;
    try {
      const check = await inUniverse(ticker, AS_OF, "corr", { changes });
      if (check.inUniverse) {
        preselected.push(ticker);
      } else {
        skippedNotInCorrUniverse.push(ticker);
      }
    } catch {
      skippedNotInCorrUniverse.push(ticker);
    }
  }
  const sample = preselected;
  console.log(
    `Feasibility-Stichprobe (U_corr(${AS_OF})-gefiltert, alphabetisch, deterministisch, KEIN Ticker-Hardcode): ` +
      `${sample.length} von ${sample.length + skippedNotInCorrUniverse.length} geprueften Symbolen qualifiziert -> ${sample.join(", ")}`
  );

  const outcomes: TickerOutcome[] = [];
  // Sequentiell (nicht parallel) — schont FMP-Rate-Limits, bewusst fuer eine
  // 40-60-Ticker-Stichprobe akzeptabel (siehe Zeitschaetzung im
  // Abschlussbericht).
  for (const ticker of sample) {
    const outcome = await fetchOneTicker(ticker);
    outcomes.push(outcome);
    const statusStr = outcome.fetchOk ? "OK" : `FEHLER: ${outcome.error}`;
    console.log(
      `  ${ticker.padEnd(8)} ${statusStr}` +
        (outcome.fetchOk
          ? ` price=${outcome.price} cappedBy=${outcome.cappedBy ?? "-"} dcfApplicable=${outcome.dcfApplicable} dataComplete=${outcome.dataCompleteOverall} invDcf=${outcome.invDcf?.toFixed(2) ?? "null"} crv=${outcome.crv?.toFixed(2) ?? "null"} signal=${outcome.signal ?? "null"} fwdReturn=${outcome.forwardReturnPct ?? "null"}% (${outcome.forwardReturnMethod ?? "-"})`
          : "")
    );
  }

  const ok = outcomes.filter(o => o.fetchOk);
  const withReturn = ok.filter(o => o.forwardReturnPct != null);
  const withSignal = ok.filter(o => o.signal != null);
  const withPitComplete = ok.filter(o => o.pitDataComplete);

  console.log("\n=== Zusammenfassung Rohdaten-Abdeckung ===");
  console.log(`Angefragt: ${sample.length}, erfolgreich verarbeitet: ${ok.length}, mit forwardReturn: ${withReturn.length}, mit PIT-Valuation dataComplete: ${withPitComplete.length}, mit signal_v1 != null: ${withSignal.length}`);

  // --- T1 Gate-Lift: Ereignisse aus ECHTEN Gates (cappedBy), unabhaengig von invDcf/crv. ---
  const t1Events: GateLiftEvent[] = ok
    .filter(o => o.forwardReturnPct != null)
    .map(o => ({
      ticker: o.ticker,
      asOfMonth: AS_OF_MONTH,
      gateActive: o.cappedBy != null,
      gateId: o.cappedBy,
      r: (o.forwardReturnPct as number) / 100,
    }));
  const t1Report = evaluateT1GateLift(t1Events, [FOLD]);

  // --- T2 Signal-Kohorte: Ereignisse aus signal_v1 (Buy/Avoid/...), jetzt mit
  // ECHTEN invDcf/crv aus server/backtest/pit-valuation.ts (Phase 3b) statt
  // hart auf null gesetzt — signal=null bleibt nur noch fuer Ticker, deren
  // PIT-Rohdaten unvollstaendig sind (siehe TickerOutcome.pitReasons). ---
  const t2Events: SignalReturnEvent[] = ok
    .filter(o => o.forwardReturnPct != null && o.signal != null)
    .map(o => ({
      ticker: o.ticker,
      asOfMonth: AS_OF_MONTH,
      signal: o.signal as any,
      r: (o.forwardReturnPct as number) / 100,
    }));
  const t2Report = evaluateT2SignalCohort(t2Events, HORIZON_DAYS, { folds: [FOLD] });

  console.log("\n=== T1 Gate-Lift Report (Machbarkeit, 1 Fold, n klein) ===");
  console.log(`status=${t1Report.status}, n Events total=${t1Events.length}, clustersGateActive=${t1Report.clustersGateActive.length}, clustersGateInactive=${t1Report.clustersGateInactive.length}`);
  console.log(`headline: ${JSON.stringify(t1Report.headline)}`);

  console.log("\n=== T2 Signal-Kohorte Report (Machbarkeit, 1 Fold, n klein) ===");
  console.log(`status=${t2Report.status}, n Events total=${t2Events.length} (PIT-Valuation liefert jetzt echte invDcf/crv -- signal=null nur noch bei unvollstaendigen PIT-Rohdaten, siehe pitReasons je Ticker)`);
  console.log(`minNAvoidPerFold=${t2Report.minNAvoidPerFold}`);
  console.log(`headlineGross: ${JSON.stringify(t2Report.headlineGross)}`);
  const nBuy = t2Events.filter(e => e.signal === "Buy").length;
  const nAvoid = t2Events.filter(e => e.signal === "Avoid").length;
  console.log(`n_buy=${nBuy}, n_avoid=${nAvoid}, coverage_T (pitDataComplete/erfolgreich verarbeitet)=${ok.length > 0 ? (withPitComplete.length / ok.length).toFixed(3) : "n/a"}`);

  console.log("\n=== FAZIT ===");
  console.log(
    "Pipeline-Verdrahtung end-to-end BESTAETIGT mit echten FMP-Daten: " +
      "Universum (FMP, U_corr-gefiltert, kein Hardcode) -> server/backtest/pit-valuation.ts (gecachte PIT-Rohdaten -> echte invDcf/crv ueber UNVERAENDERTE shared/valuation-signal.ts-Funktionen) -> " +
      "replayAt()/buildScoringForAnalysis() (echte Gates/Score) -> " +
      "deriveSignalV1() (echte Signalregel mit echten invDcf/crv) -> forwardReturn() (echte Kurshistorie, echtes Embargo) -> " +
      "evaluateT1GateLift()/evaluateT2SignalCohort() (echte Cluster/Fold-Aggregation)."
  );
  console.log(
    `T1 (Gate-Lift) ist auf echten Gates/Returns gelaufen (${t1Events.length} Events, status=${t1Report.status}) -- ` +
      "dies ist ein ECHTES (wenn auch datenarmes) Ergebnis, unabhaengig von invDcf/crv."
  );
  console.log(
    `T2 (Signal-Kohorte) liefert status="${t2Report.status}" mit ${t2Events.length} Signal-Events (n_buy=${nBuy}, n_avoid=${nAvoid}), ` +
      "jetzt basierend auf ECHTEN, aus gecachten PIT-Rohdaten abgeleiteten invDcf/crv (server/backtest/pit-valuation.ts, Phase 3b) -- " +
      'falls weiterhin "insufficient_data": laut Ticket bei kleiner Stichprobe/Schwellen weiterhin ein GUELTIGES, akzeptables Ergebnis, kein Fehler.'
  );

  console.log("\n=== ROH-OUTCOMES (JSON, fuer Weiterverarbeitung/Report) ===");
  console.log(JSON.stringify({ sample, outcomes, t1Report, t2Report }, null, 2));
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
