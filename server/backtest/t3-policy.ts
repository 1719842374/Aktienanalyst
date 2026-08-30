/**
 * server/backtest/t3-policy.ts — Sprint B3 Phase 5b (T3 Policy-Portfolio),
 * tickets/SPRINT_B3_PHASE5_T3_POLICY.md Teil 5b, WORK_SIGNAL_BACKTEST.md
 * §1 (Testtabelle "T3 Policy-Portfolio"), §4.2 ("T3 Rebalance": quartalsweise,
 * max 15 Titel, nur |Δw| > 2pp gehandelt), §8.1/§8.3 (volle Round-Turn-
 * Kosten `cost_v1`).
 *
 * ZWECK: Simuliert ein Quartals-Rebalance-Portfolio, das zu jedem
 * Quartalsende die Ziel-Gewichte NEU aus dem aktuellen signal_v1
 * (Buy/Accumulate/Hold/Reduce/Avoid, aus deriveSignalV1()/signal.ts) ableitet
 * — KEIN zweites Score-/Gewichtungsmodell: die Signale selbst kommen
 * unveraendert aus derselben §9-Regel wie T1/T2 (der Aufrufer liefert sie
 * bereits fertig berechnet, analog zu SignalReturnEvent in cluster.ts).
 * Diese Datei fuegt NUR die Portfolio-Mechanik hinzu (Ziel-Gewichte je
 * Signal-Stufe, Rebalance-Trigger |Δw|>2pp, Notional-Handel, Round-Turn-
 * Kosten aus costs.ts, Equity-Curve).
 *
 * KOSTEN: `cost_v1` Round-Turn (costs.ts::roundTurnCostBp(), Phase 3 bereits
 * vorhanden, hier WIEDERVERWENDET, nicht neu gebaut) auf das GEHANDELTE
 * Notional (§8.3: "Trade nur wenn |Δw|>2pp. Hold ohne Fill = 0 Kosten.").
 *
 * EQUITY CURVE: dieselben Formeln wie Sprint B2
 * (`client/src/lib/portfolio/backtest.ts`, WORK_PORTFOLIO_BACKTEST.md) --
 * kumulative Rendite `cp *= 1 + r` und Max-Drawdown
 * (`computeDrawdownAnalysis()`) werden 1:1 AUS DIESER DATEI IMPORTIERT
 * (Server importiert client/src/lib/*, dasselbe etablierte Muster wie
 * server/regression-scan.ts <- client/src/lib/calculations.ts). KEIN
 * Formel-Drift, KEINE Duplizierung — siehe Ticket-Regel.
 *
 * GROSS/NET: Gross = Portfolio-Rendite VOR Kosten (reine Signal-Gewichtung).
 * Net = Gross MINUS der tatsaechlich angefallenen Round-Turn-Kosten in der
 * jeweiligen Rebalance-Periode (§8.1: "T3 Policy: Round-Turn voll auf
 * gehandeltes Notional").
 *
 * KEIN LLM, KEINE Ticker-Hardcodes -- Ticker kommen ausschliesslich aus den
 * vom Aufrufer uebergebenen Events (z.B. aus buildBacktestEvents(),
 * build-events.ts).
 */
import { capBucket, roundTurnCostBp, type CapBucket } from "./costs";
import { median, mean } from "./cluster";
import { computeDrawdownAnalysis, type DrawdownAnalysis } from "../../client/src/lib/portfolio/backtest";
import type { SignalV1 } from "./types";

// ============================================================================
// 1. Ziel-Gewichte je Signal-Stufe (T3-Policy, adaptiv -- kein Ticker-Bezug)
// ============================================================================

/**
 * Signal-Rang fuer die Titelauswahl (hoeher = attraktiver, §9-Reihenfolge
 * exakt uebernommen: Buy > Accumulate > Hold > Reduce > Avoid). Reine
 * Ordinalzahl fuer Ranking/Selektion, KEINE neue Score-Formel -- das Signal
 * selbst stammt unveraendert aus deriveSignalV1() (§9).
 */
const SIGNAL_RANK: Record<Exclude<SignalV1, null>, number> = {
  Buy: 4,
  Accumulate: 3,
  Hold: 2,
  Reduce: 1,
  Avoid: 0,
};

/** Nur Buy/Accumulate/Hold sind ueberhaupt fuer eine (Neu-)Position
 *  zulaessig (Reduce/Avoid -> Ziel-Gewicht 0, Position wird abgebaut/nicht
 *  aufgebaut) -- analog §9 "cappedBy hard -> kein Buy" / Avoid-Ausschluss. */
const ELIGIBLE_FOR_ENTRY: ReadonlySet<Exclude<SignalV1, null>> = new Set<Exclude<SignalV1, null>>(["Buy", "Accumulate", "Hold"]);

export const T3_MAX_TITLES = 15; // §4.2 "T3 Rebalance ... max 15 Titel"
export const T3_REBALANCE_THRESHOLD_PP = 2; // §4.2 "Δw > 2 pp"

export interface T3TickerSignalAtQuarter {
  ticker: string;
  quarterEnd: string; // yyyy-mm-dd, Quartalsultimo
  signal: SignalV1;
  /** Cap-Bucket-Basis (USD) am Quartalsultimo -- fuer die Kosten-Bucket-
   *  Zuordnung (mega/large/mid nach Marktkap., §8.2). null => kein Handel
   *  in cost_v1 abbildbar (Ticket-Testanforderung "Kosten-Bucket-Zuordnung
   *  nach Marktkap." -- ohne capUsd wird die Position konservativ NICHT neu
   *  aufgebaut, siehe buildTargetWeights()). */
  capUsd: number | null;
  /** Forward-Return DIESES Quartals (Q -> Q+1), Dezimal. Wird fuer die
   *  Equity-Curve-Fortschreibung dieser Haltedauer verwendet. null wenn
   *  keine Kursdaten verfuegbar (Zahlen-Prinzip: kein Raten -- Position
   *  traegt dann 0 zur Portfoliorendite bei UND wird aus dem Portfolio
   *  entfernt, siehe simulateT3Policy()). */
  quarterReturn: number | null;
}

/**
 * Zielgewichte fuer EIN Quartalsende: Kandidaten sind alle Ticker mit
 * signal in {Buy, Accumulate, Hold} UND bekanntem capUsd (Kosten-Bucket
 * muss zuordenbar sein, sonst kein Handel). Ranking nach SIGNAL_RANK
 * (hoechste Stufe zuerst), bei Gleichstand alphabetisch (deterministisch,
 * kein Ticker-Bevorzugungs-Hardcode). Top T3_MAX_TITLES werden GLEICHGEWICHTET
 * (1/n) -- die einfachste adaptive Regel, die weder eine Ticker-Praeferenz
 * noch ein zweites Score-/Ranking-Modell einfuehrt (die Reihenfolge selbst
 * kommt ausschliesslich aus dem bereits vorhandenen signal_v1).
 */
export function buildTargetWeights(signalsAtQuarter: T3TickerSignalAtQuarter[]): Map<string, number> {
  const candidates = signalsAtQuarter
    .filter(s => s.signal != null && ELIGIBLE_FOR_ENTRY.has(s.signal as Exclude<SignalV1, null>) && s.capUsd != null && capBucket(s.capUsd) != null)
    .sort((a, b) => {
      const rankDiff = SIGNAL_RANK[b.signal as Exclude<SignalV1, null>] - SIGNAL_RANK[a.signal as Exclude<SignalV1, null>];
      if (rankDiff !== 0) return rankDiff;
      return a.ticker.localeCompare(b.ticker);
    })
    .slice(0, T3_MAX_TITLES);

  const weights = new Map<string, number>();
  if (candidates.length === 0) return weights;
  const w = 1 / candidates.length;
  for (const c of candidates) weights.set(c.ticker, w);
  return weights;
}

// ============================================================================
// 2. Rebalance-Trades: nur |Δw| > 2pp wird tatsaechlich gehandelt (§4.2/§8.3)
// ============================================================================

export interface T3Trade {
  ticker: string;
  quarterEnd: string;
  fromWeight: number;
  toWeight: number;
  deltaWeightPp: number; // (toWeight - fromWeight) * 100
  traded: boolean; // |Δw| > T3_REBALANCE_THRESHOLD_PP
  bucket: CapBucket | null;
  costRtBp: number; // 0 wenn !traded (§8.3: "Hold ohne Fill = 0 Kosten")
  /** Kosten in Portfolio-Prozentpunkten: |Δw| (als Anteil des Gesamtportfolios,
   *  Notional-Approximation) * costRtBp/10000 * 100. */
  costPortfolioPp: number;
}

/**
 * Vergleicht Alt- und Neu-Gewichte fuer EIN Rebalance-Datum und bestimmt,
 * welche Positionen tatsaechlich gehandelt werden (§4.2: nur |Δw|>2pp).
 * `capByTicker` liefert die Marktkap.-Basis fuer die Kosten-Bucket-
 * Zuordnung (§8.2 mega/large/mid) -- Ticker ohne bekannten Bucket werden
 * konservativ mit costRtBp=0/traded=false behandelt NUR wenn deltaWeightPp
 * ohnehin unter der Schwelle liegt; liegt sie darueber, aber kein Bucket
 * bekannt ist, wird der Trade dennoch ausgefuehrt (Gewichtsaenderung ist
 * real), aber costRtBp bleibt 0 mit einer expliziten Diagnose-Markierung
 * ueber `bucket=null` (kein Kosten-Raten ohne Cap-Info).
 */
export function computeT3Trades(
  quarterEnd: string,
  previousWeights: Map<string, number>,
  targetWeights: Map<string, number>,
  capByTicker: Map<string, number | null>
): T3Trade[] {
  const allTickers = new Set<string>([...Array.from(previousWeights.keys()), ...Array.from(targetWeights.keys())]);
  const trades: T3Trade[] = [];
  for (const ticker of Array.from(allTickers).sort()) {
    const fromWeight = previousWeights.get(ticker) ?? 0;
    const toWeight = targetWeights.get(ticker) ?? 0;
    const deltaWeightPp = (toWeight - fromWeight) * 100;
    const traded = Math.abs(deltaWeightPp) > T3_REBALANCE_THRESHOLD_PP;

    const capUsd = capByTicker.get(ticker) ?? null;
    const bucket = capUsd != null ? capBucket(capUsd) : null;
    const costRtBp = traded && bucket != null ? roundTurnCostBp(bucket) : 0;
    // Kosten-Notional-Approximation: |Δw| des Gesamtportfolios wird zum
    // Round-Turn-Satz verrechnet (Standardnaeherung: Kosten proportional
    // zum GEHANDELTEN Gewichtsanteil, nicht zum gehaltenen Bestand -- §8.1
    // "voll auf gehandeltes Notional").
    const costPortfolioPp = traded ? (Math.abs(deltaWeightPp) / 100) * (costRtBp / 10000) * 100 : 0;

    trades.push({ ticker, quarterEnd, fromWeight, toWeight, deltaWeightPp, traded, bucket, costRtBp, costPortfolioPp });
  }
  return trades;
}

// ============================================================================
// 3. Vollstaendige Quartals-Simulation: Equity Curve Gross/Net (§1/§8.3)
// ============================================================================

export interface T3QuarterResult {
  quarterEnd: string;
  nCandidates: number;
  nHeld: number;
  trades: T3Trade[];
  nTraded: number;
  turnoverPp: number; // Summe |Δw| aller getradeten Positionen, in pp
  grossReturn: number; // gewichtete Portfoliorendite dieses Quartals VOR Kosten
  costPp: number; // Summe costPortfolioPp aller Trades dieses Quartals, in pp (Dezimal unten)
  netReturn: number; // grossReturn - costPp/100
}

export interface T3PolicyReport {
  mode: "t3_policy_portfolio";
  maxTitles: number;
  rebalanceThresholdPp: number;
  quarters: T3QuarterResult[];
  /** Equity-Curve GROSS (vor Kosten) -- kumulative Rendite, dieselbe Formel
   *  wie client/src/lib/portfolio/backtest.ts (cp *= 1+r, C_t = cp-1). */
  equityCurveGross: number[]; // gleiche Laenge wie quarters, C_t je Quartalsende
  /** Equity-Curve NET (nach Kosten). */
  equityCurveNet: number[];
  totalReturnGrossPct: number;
  totalReturnNetPct: number;
  costDragTotalPct: number; // totalReturnGrossPct - totalReturnNetPct
  maxDrawdownGrossPct: number;
  maxDrawdownNetPct: number;
  medianQuarterlyTurnoverPp: number | null;
  meanQuarterlyTurnoverPp: number | null;
  status: "ok" | "insufficient_data";
}

/**
 * simulateT3Policy() — Haupteinstieg. `signalsByQuarter` ist eine
 * Zeitreihe: fuer JEDES Quartalsende die vollstaendige Liste der
 * kandidierenden Ticker mit ihrem Signal/capUsd/quarterReturn (siehe
 * T3TickerSignalAtQuarter) -- der Aufrufer (z.B. eine spaetere
 * Orchestrierung ueber buildBacktestEvents()) liefert diese Zeitreihe
 * bereits fertig, diese Funktion selbst holt KEINE Rohdaten (kein I/O, kein
 * LLM, reine Simulation).
 */
export function simulateT3Policy(signalsByQuarter: T3TickerSignalAtQuarter[][]): T3PolicyReport {
  const quarters: T3QuarterResult[] = [];
  let previousWeights = new Map<string, number>();

  for (const quarterSignals of signalsByQuarter) {
    if (quarterSignals.length === 0) continue;
    const quarterEnd = quarterSignals[0].quarterEnd;

    const targetWeights = buildTargetWeights(quarterSignals);
    const capByTicker = new Map<string, number | null>(quarterSignals.map(s => [s.ticker, s.capUsd]));
    const trades = computeT3Trades(quarterEnd, previousWeights, targetWeights, capByTicker);

    // Tatsaechlich gehaltene Gewichte nach dieser Rebalance-Runde: getradete
    // Positionen erreichen ihr Zielgewicht, NICHT getradete bleiben beim
    // alten Gewicht (§4.2: |Δw|<=2pp wird NICHT ausgefuehrt, Bestand bleibt
    // unveraendert -- "Hold ohne Fill").
    const heldWeights = new Map<string, number>();
    for (const t of trades) {
      const w = t.traded ? t.toWeight : t.fromWeight;
      if (w > 0) heldWeights.set(t.ticker, w);
    }

    const returnByTicker = new Map<string, number | null>(quarterSignals.map(s => [s.ticker, s.quarterReturn]));

    // Gross-Rendite: gewichtete Summe der Quartalsrenditen der GEHALTENEN
    // Positionen. Fehlender Return (null, z.B. Datenlücke) traegt 0 bei
    // (konservativ, analog client/src/lib/portfolio/backtest.ts §2.1-Kommentar
    // "einzelne Datenluecke soll nicht die ganze Serie zerstoeren").
    let grossReturn = 0;
    for (const [ticker, w] of Array.from(heldWeights.entries())) {
      const r = returnByTicker.get(ticker);
      if (typeof r === "number" && isFinite(r)) grossReturn += w * r;
    }

    const nTradedList = trades.filter(t => t.traded);
    const turnoverPp = nTradedList.reduce((s, t) => s + Math.abs(t.deltaWeightPp), 0);
    const costPp = nTradedList.reduce((s, t) => s + t.costPortfolioPp, 0);
    const netReturn = grossReturn - costPp / 100;

    quarters.push({
      quarterEnd,
      nCandidates: quarterSignals.length,
      nHeld: heldWeights.size,
      trades,
      nTraded: nTradedList.length,
      turnoverPp,
      grossReturn,
      costPp,
      netReturn,
    });

    previousWeights = heldWeights;
  }

  if (quarters.length === 0) {
    return {
      mode: "t3_policy_portfolio",
      maxTitles: T3_MAX_TITLES,
      rebalanceThresholdPp: T3_REBALANCE_THRESHOLD_PP,
      quarters: [],
      equityCurveGross: [],
      equityCurveNet: [],
      totalReturnGrossPct: 0,
      totalReturnNetPct: 0,
      costDragTotalPct: 0,
      maxDrawdownGrossPct: 0,
      maxDrawdownNetPct: 0,
      medianQuarterlyTurnoverPp: null,
      meanQuarterlyTurnoverPp: null,
      status: "insufficient_data",
    };
  }

  // Equity Curve — IDENTISCHE Formel wie Sprint B2
  // (client/src/lib/portfolio/backtest.ts computePortfolioBacktest():
  // `cp *= 1 + r; cum.push(cp - 1)`), hier auf Quartalsbasis statt taeglich,
  // aber dieselbe kumulative Multiplikationsformel -- kein Formel-Drift.
  const equityCurveGross: number[] = [];
  const equityCurveNet: number[] = [];
  let cpGross = 1, cpNet = 1;
  for (const q of quarters) {
    cpGross *= 1 + q.grossReturn;
    cpNet *= 1 + q.netReturn;
    equityCurveGross.push(cpGross - 1);
    equityCurveNet.push(cpNet - 1);
  }

  const quarterEnds = quarters.map(q => q.quarterEnd);
  // computeDrawdownAnalysis() — 1:1 aus client/src/lib/portfolio/backtest.ts
  // importiert (siehe Datei-Kopfkommentar), NICHT neu implementiert.
  const ddGross: DrawdownAnalysis = computeDrawdownAnalysis(quarterEnds, equityCurveGross);
  const ddNet: DrawdownAnalysis = computeDrawdownAnalysis(quarterEnds, equityCurveNet);

  const turnovers = quarters.map(q => q.turnoverPp);
  const totalReturnGrossPct = equityCurveGross[equityCurveGross.length - 1] * 100;
  const totalReturnNetPct = equityCurveNet[equityCurveNet.length - 1] * 100;

  return {
    mode: "t3_policy_portfolio",
    maxTitles: T3_MAX_TITLES,
    rebalanceThresholdPp: T3_REBALANCE_THRESHOLD_PP,
    quarters,
    equityCurveGross,
    equityCurveNet,
    totalReturnGrossPct,
    totalReturnNetPct,
    costDragTotalPct: totalReturnGrossPct - totalReturnNetPct,
    maxDrawdownGrossPct: ddGross.maxDrawdownPct * 100,
    maxDrawdownNetPct: ddNet.maxDrawdownPct * 100,
    medianQuarterlyTurnoverPp: median(turnovers),
    meanQuarterlyTurnoverPp: mean(turnovers),
    status: "ok",
  };
}
