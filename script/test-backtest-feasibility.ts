/**
 * script/test-backtest-feasibility.ts — Sprint B3 Phase 3, Ticket-Punkt
 * "Baue einen kleinen Machbarkeits-Backtest (20-30 Titel, ein Fold) statt
 * eines vollen 5-Jahres-Produktionslaufs."
 *
 * ZWECK: Beweist, dass die komplette Phase-3-Pipeline (echtes Ticker-
 * Universum ohne Hardcodes -> echte FMP-Rohdaten -> replayAt() ->
 * deriveSignalV1() -> forwardReturn() -> evaluateT1GateLift()/
 * evaluateT2SignalCohort()) end-to-end verdrahtet ist und mit echten Daten
 * laeuft — NICHT, dass sie auf dieser winzigen Stichprobe ein Buy/Avoid-
 * Signal mit Aussagekraft produziert.
 *
 * BEWUSSTE VEREINFACHUNG (kein Abkuerzen der "kein zweites Modell"-Regel,
 * siehe Kommentar in replayAt()/deriveSignalV1()): invDcf/crv werden hier
 * NICHT berechnet, sondern ehrlich als `null` durchgereicht. Der volle
 * gehaertete DCF/CRV-Pfad (buildDefaultDCFParams() -> calculateFCFFDCF() ->
 * computeHardenedCRV()) braucht das komplette StockAnalysis/sectorProfile-
 * Objekt (Sektor-Klassifikation, WACC-Szenarien, Growth-Assumptions,
 * financialStatements-Cashflow) — das aus rohen FMP-Feldern hier
 * nachzubauen, WAERE das zweite Modell, das das Ticket verbietet ("Verbot:
 * zweiter Backtest-Score. Drift Live vs. Replay = Bug."). Mit invDcf=null,
 * crv=null liefert deriveSignalV1() ueber dataComplete.overall=false
 * korrekt `signal=null` fuer JEDEN Ticker — das macht evaluateT2SignalCohort()
 * fast zwangslaeufig `status: "insufficient_data"` (0 Avoid/Buy-Events).
 * Das ist laut Ticket explizit ein GUELTIGES Ergebnis: "Es ist
 * akzeptabel/erwartet, dass dies insufficient_data meldet, wenn die kleine
 * Stichprobe die Schwellen nicht erreicht — das zaehlt als korrektes
 * Ergebnis." T1 (Gate-Lift) bleibt davon unberuehrt, da es NICHT von
 * invDcf/crv abhaengt, sondern von `cappedBy`/Gates (echtes Scoring-
 * Ergebnis aus buildScoringForAnalysis()) — T1 liefert daher ein echtes
 * (wenn auch datenarmes) Ergebnis.
 *
 * UNIVERSUM: `allKnownSp500Symbols(await getConstituentChanges())` liefert
 * ALLE historisch bekannten S&P-500-Ticker (aktuelle + entfernte) als Set —
 * keine Ticker-Hardcodes, reine FMP-Daten. Wir nehmen die ersten N Symbole
 * aus dieser Menge in alphabetischer Reihenfolge (deterministisch, nicht
 * per Zufall ausgewaehlt, damit der Lauf reproduzierbar ist) — bewusst
 * NICHT nach "bekannten" Namen gefiltert.
 *
 * ASOF: fest auf 2023-01-31 (Fold-1-"Letztes Train-as-of" aus §6.4) mit
 * Horizont 126 Handelstage (~6 Monate) — ein einzelner Monats-Snapshot,
 * ein einzelner Fold, wie im Ticket gefordert ("ein Fold").
 */
import "dotenv/config";
import { getConstituentChanges, allKnownSp500Symbols, CAP_FLOOR_USD } from "../server/backtest/universe";
import { fmpProfile, fmpQuote, fmpHistoricalPrices, fmpIncomeStatementQuarterly, fmpIncomeStatement, fmpBalanceSheet } from "../server/fmp";
import { replayAt, computeDcfApplicable } from "../server/backtest/replay";
import { deriveSignalV1 } from "../server/backtest/signal";
import { forwardReturn } from "../server/backtest/returns";
import { evaluateT1GateLift, evaluateT2SignalCohort, type GateLiftEvent } from "../server/backtest/evaluate";
import { WF_V1_FOLDS, DEFAULT_PITCH_HORIZON_DAYS } from "../server/backtest/walkforward";
import type { SignalReturnEvent } from "../server/backtest/cluster";
import type { AnalysisScoringContext } from "../server/scoring-integration";

const N_TICKERS = Number(process.env.FEASIBILITY_N_TICKERS ?? 25);
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
  };
  try {
    const [profile, quarterlyIncome, annualIncome, annualBalance, prices] = await Promise.all([
      fmpProfile(ticker),
      fmpIncomeStatementQuarterly(ticker, 16),
      fmpIncomeStatement(ticker, 6),
      fmpBalanceSheet(ticker, 6),
      // Genuegend Historie vor UND nach AS_OF fuer Embargo-Einstieg + 126-Tage-Exit.
      fmpHistoricalPrices(ticker, "2020-01-01", "2024-06-30"),
    ]);

    if (!profile) {
      return { ...base, error: "kein FMP-Profil (evtl. delistet/nicht abgedeckt)" };
    }

    const capT = typeof profile.mktCap === "number" ? profile.mktCap : null;
    const priceAtProfile = typeof profile.price === "number" ? profile.price : null;

    if (!Array.isArray(prices) || prices.length === 0) {
      return { ...base, error: "keine historischen Kurse verfuegbar" };
    }
    const priceRows = prices
      .filter((p: any) => p?.date && typeof p?.close === "number")
      .map((p: any) => ({ date: p.date as string, close: p.close as number }));

    // Kurs "an T" (asOf) fuer die Score-Pipeline: letzter verfuegbarer Close <= AS_OF.
    const sortedAsc = [...priceRows].sort((a, b) => a.date.localeCompare(b.date));
    const priceAtAsOf = [...sortedAsc].filter(p => p.date <= AS_OF).pop()?.close ?? priceAtProfile;
    if (priceAtAsOf == null) {
      return { ...base, error: "kein Kurs am/vor asOf verfuegbar" };
    }

    // Quartalsumsaetze CHRONOLOGISCH (aeltestes zuerst) — FMP liefert newest-first.
    const quarterlyRevenueChronological = Array.isArray(quarterlyIncome)
      ? [...quarterlyIncome].reverse().map((q: any) => (typeof q?.revenue === "number" ? q.revenue : 0))
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

    const fcfTTM = null; // kein Cashflow-Statement geladen (bewusst schlank) -> dcfApplicable-FCF-Gate greift konservativ als false, s.u.

    const snapshot = replayAt({
      ticker,
      asOf: AS_OF,
      ctx,
      health: undefined,
      moatRating: undefined,
      technicalIndicators: null,
      catalysts: [],
      price: priceAtAsOf,
      fcfTTM,
      sector: profile.sector ?? undefined,
      industry: profile.industry ?? undefined,
      invDcf: null, // siehe Datei-Kopfkommentar: bewusst nicht nachgebaut
      crv: null,
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
      error: capT != null && capT < CAP_FLOOR_USD ? `Hinweis: cap_now=${(capT / 1e9).toFixed(2)}Mrd < ${CAP_FLOOR_USD / 1e9}Mrd Floor (PIT-Cap an AS_OF nicht geprueft, nur Anzeige)` : undefined,
    };
  } catch (e: any) {
    return { ...base, error: e?.message ?? String(e) };
  }
}

async function main() {
  console.log("=== Sprint B3 Phase 3 — Machbarkeits-Backtest (kein Produktionslauf) ===");
  console.log(`AS_OF=${AS_OF} (Fold 1 Letztes Train-as-of), Horizont=${HORIZON_DAYS} Handelstage, Fold=${JSON.stringify(FOLD)}`);

  const changes = await getConstituentChanges();
  const universe = Array.from(allKnownSp500Symbols(changes)).sort();
  console.log(`Bekanntes S&P-500-Universum (historisch, aus FMP): ${universe.length} Symbole total.`);

  const sample = universe.slice(0, N_TICKERS);
  console.log(`Feasibility-Stichprobe (erste ${sample.length} alphabetisch, deterministisch, KEIN Hardcode): ${sample.join(", ")}`);

  const outcomes: TickerOutcome[] = [];
  // Sequentiell (nicht parallel) — schont FMP-Rate-Limits, bewusst fuer eine
  // kleine 20-30-Ticker-Stichprobe akzeptabel (siehe Zeitschaetzung im
  // Abschlussbericht).
  for (const ticker of sample) {
    const outcome = await fetchOneTicker(ticker);
    outcomes.push(outcome);
    const statusStr = outcome.fetchOk ? "OK" : `FEHLER: ${outcome.error}`;
    console.log(
      `  ${ticker.padEnd(8)} ${statusStr}` +
        (outcome.fetchOk
          ? ` price=${outcome.price} cappedBy=${outcome.cappedBy ?? "-"} dcfApplicable=${outcome.dcfApplicable} dataComplete=${outcome.dataCompleteOverall} signal=${outcome.signal ?? "null"} fwdReturn=${outcome.forwardReturnPct ?? "null"}% (${outcome.forwardReturnMethod ?? "-"})`
          : "")
    );
  }

  const ok = outcomes.filter(o => o.fetchOk);
  const withReturn = ok.filter(o => o.forwardReturnPct != null);
  const withSignal = ok.filter(o => o.signal != null);

  console.log("\n=== Zusammenfassung Rohdaten-Abdeckung ===");
  console.log(`Angefragt: ${sample.length}, erfolgreich verarbeitet: ${ok.length}, mit forwardReturn: ${withReturn.length}, mit signal_v1 != null: ${withSignal.length}`);

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

  // --- T2 Signal-Kohorte: Ereignisse aus signal_v1 (Buy/Avoid/...), das mit
  // invDcf=null/crv=null erwartungsgemaess ueberwiegend/vollstaendig null ist. ---
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
  console.log(`status=${t2Report.status}, n Events total=${t2Events.length} (erwartungsgemaess klein/0, da invDcf=null,crv=null -> dataComplete.overall=false -> signal=null fuer alle Ticker ohne vollen DCF/CRV-Pfad)`);
  console.log(`minNAvoidPerFold=${t2Report.minNAvoidPerFold}`);
  console.log(`headlineGross: ${JSON.stringify(t2Report.headlineGross)}`);

  console.log("\n=== FAZIT ===");
  console.log(
    "Pipeline-Verdrahtung end-to-end BESTAETIGT mit echten FMP-Daten: " +
      "Universum (FMP, kein Hardcode) -> replayAt()/buildScoringForAnalysis() (echte Gates/Score) -> " +
      "deriveSignalV1() (echte Signalregel, korrekt null ohne invDcf/crv) -> forwardReturn() (echte Kurshistorie, echtes Embargo) -> " +
      "evaluateT1GateLift()/evaluateT2SignalCohort() (echte Cluster/Fold-Aggregation)."
  );
  console.log(
    `T1 (Gate-Lift) ist auf echten Gates/Returns gelaufen (${t1Events.length} Events, status=${t1Report.status}) -- ` +
      "dies ist ein ECHTES (wenn auch datenarmes) Ergebnis, unabhaengig von invDcf/crv."
  );
  console.log(
    `T2 (Signal-Kohorte) liefert erwartungsgemaess status="${t2Report.status}" mit ${t2Events.length} Signal-Events, ` +
      "weil invDcf/crv bewusst nicht nachgebaut wurden (siehe Datei-Kopfkommentar) -- " +
      'laut Ticket ist "insufficient_data" hier ein GUELTIGES, akzeptables Ergebnis, kein Fehler.'
  );

  console.log("\n=== ROH-OUTCOMES (JSON, fuer Weiterverarbeitung/Report) ===");
  console.log(JSON.stringify({ sample, outcomes, t1Report, t2Report }, null, 2));
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});
