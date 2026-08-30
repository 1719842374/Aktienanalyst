/**
 * server/backtest/evaluate.ts — Sprint B3 Phase 3 (T1/T2 Cluster + Walk-
 * Forward, WORK_SIGNAL_BACKTEST.md §2.2 ("server/backtest/evaluate.ts —
 * T1/T2/T3 Reports"), Ticket Punkt 5.
 *
 * Fuehrt T1- und T2-Reports zusammen (T3 ist Phase 5, NICHT Teil dieses
 * Tickets — siehe Ticket-Kopfzeile "NUR Phase 3, T1 Gate-Lift + T2 Signal-
 * Kohorte, OHNE T3").
 *
 *   T1 Gate-Lift: derselbe Titel mit Gate aktiv vs. inaktiv (nutzt
 *     ScoringSnapshot.gates[]/cappedBy aus Phase 0), 0bp Kosten (§8.1).
 *   T2 Signal-Kohorte: Avoid vs. Buy, Buy-and-Hold ueber Horizont h, 1x
 *     Half-Spread als Kosten-Nebenzeile (§8, cost_v1 NUR hier, nicht in T1).
 *
 * Diese Datei ruft AUSSCHLIESSLICH bereits vorhandene Bausteine
 * (cluster.ts, walkforward.ts, costs.ts) auf — kein zweites Aggregations-
 * Modell, keine neue Statistik-Formel.
 */
import {
  clusterByMonthSignal,
  clusterByMonthSignalProfile,
  monthlyDeltas,
  foldDelta,
  headlinePitch,
  MIN_N_SIGNAL_PER_MONTH,
  type SignalReturnEvent,
  type MonthSignalCluster,
  type MonthDelta,
  type FoldDelta,
  type HeadlineResult,
} from "./cluster";
import {
  WF_V1_FOLDS,
  MIN_N_AVOID_PER_FOLD,
  validateAllFoldsPurge,
  testMonthsInFold,
  type WalkForwardFold,
} from "./walkforward";
import { t2EntryCost, type T2EntryCostResult } from "./costs";
import type { SignalV1 } from "./types";
import { biasGap, type BiasGapResult } from "./pit";

// ============================================================================
// T1 Gate-Lift (§1 Testtabelle, §8.1: 0bp Kosten)
// ============================================================================

/** Ein Event fuer T1: derselbe Titel, EINMAL mit Gate aktiv (cappedBy != null,
 *  wie tatsaechlich beobachtet), EINMAL mit Gate hypothetisch inaktiv (der
 *  Return, den der Titel ohne den Deckel gehabt haette — hier: derselbe
 *  realisierte Return, weil ein Gate den SCORE deckelt, nicht den
 *  tatsaechlichen Marktpreis. T1 misst also, ob Titel, DIE ein Gate aktiv
 *  hatten, hinterher schlechter liefen als Titel ohne aktives Gate — nicht
 *  einen kontrafaktischen Preis desselben Titels.). */
export interface GateLiftEvent {
  ticker: string;
  asOfMonth: string;
  gateActive: boolean;
  gateId: string | null;
  r: number;
  growthProfile?: string | null;
}

export interface T1GateLiftReport {
  mode: "t1_gate_lift";
  costBp: 0; // §8.1: T1 = 0bp, immer
  clustersGateActive: MonthSignalCluster[];
  clustersGateInactive: MonthSignalCluster[];
  monthDeltas: MonthDelta[]; // gateActive-Median minus gateInactive-Median, je Monat
  folds: Array<{ fold: WalkForwardFold; delta: FoldDelta; nAvoidLike: number; status: "ok" | "insufficient_data" }>;
  headline: HeadlineResult;
  status: "ok" | "insufficient_data";
  minNPerMonth: number;
}

/**
 * evaluateT1GateLift() — mapt GateLiftEvent[] auf dasselbe Cluster-Median-
 * Maschinerie wie T2, indem "gateActive" als Pseudo-Signal "Avoid" und
 * "gateInactive" als Pseudo-Signal "Buy" behandelt wird (identische
 * Median/δ_t/Δ_Fold-Logik, §7 gilt fuer JEDEN Zwei-Gruppen-Vergleich, nicht
 * nur fuer Avoid/Buy-Signale — das ist explizit dieselbe Cluster-Funktion,
 * kein zweites Modell).
 */
export function evaluateT1GateLift(
  events: GateLiftEvent[],
  folds: WalkForwardFold[] = WF_V1_FOLDS
): T1GateLiftReport {
  const asSignalEvents: SignalReturnEvent[] = events.map(e => ({
    ticker: e.ticker,
    asOfMonth: e.asOfMonth,
    signal: (e.gateActive ? "Avoid" : "Buy") as SignalV1,
    r: e.r,
    growthProfile: e.growthProfile ?? null,
  }));

  const clusters = clusterByMonthSignal(asSignalEvents);
  const clustersGateActive = clusters.filter(c => c.signal === "Avoid");
  const clustersGateInactive = clusters.filter(c => c.signal === "Buy");
  const deltas = monthlyDeltas(clusters);

  const foldReports = folds.map(fold => {
    const monthsInFold = new Set(testMonthsInFold(fold));
    const deltasInFold = deltas.filter(d => monthsInFold.has(d.asOfMonth));
    const nAvoidLike = deltasInFold.reduce((s, d) => s + d.nAvoid, 0);
    return {
      fold,
      delta: foldDelta(deltasInFold),
      nAvoidLike,
      status: (nAvoidLike >= MIN_N_AVOID_PER_FOLD ? "ok" : "insufficient_data") as "ok" | "insufficient_data",
    };
  });

  const headline = headlinePitch(foldReports.map(f => f.delta));
  const anyOk = foldReports.some(f => f.status === "ok");

  return {
    mode: "t1_gate_lift",
    costBp: 0,
    clustersGateActive,
    clustersGateInactive,
    monthDeltas: deltas,
    folds: foldReports,
    headline,
    status: anyOk ? "ok" : "insufficient_data",
    minNPerMonth: MIN_N_SIGNAL_PER_MONTH,
  };
}

// ============================================================================
// T2 Signal-Kohorte (§1 Testtabelle, §8.1: 1x Half-Spread als Nebenzeile)
// ============================================================================

export interface T2SignalCohortReport {
  mode: "t2_signal_cohort";
  horizonDays: number;
  clusters: MonthSignalCluster[];
  clustersByProfile: ReturnType<typeof clusterByMonthSignalProfile>;
  monthDeltas: MonthDelta[];
  folds: Array<{
    fold: WalkForwardFold;
    delta: FoldDelta;
    nAvoid: number;
    nBuy: number;
    status: "ok" | "insufficient_data";
  }>;
  /** Headline auf BRUTTO-Returns (vor Kosten) — §7.2 Pitch-Zahl selbst. */
  headlineGross: HeadlineResult;
  /** §8.1 Nebenzeile: 1x Half-Spread + Slippage als Kosten-Info, NICHT in
   *  die Headline selbst eingerechnet (reine Transparenz-Zeile je
   *  Cap-Bucket, damit der Leser weiss wie gross der Effekt waere). */
  costNoteByBucket: T2EntryCostResult[];
  status: "ok" | "insufficient_data";
  minNAvoidPerFold: number;
}

/**
 * evaluateT2SignalCohort() — Avoid-vs-Buy Cluster-Median ueber Buy-and-Hold-
 * Returns eines festen Horizonts h. §13: "n Avoid/Fold < 80 -> status
 * insufficient_data, keine Pitch-Zahl" — wird PRO FOLD geprueft (nicht
 * global), damit ein einzelner datenarmer Fold die anderen nicht
 * automatisch mit "ok" markiert.
 *
 * `sampleCapsUsd` ist optional: Cap-Werte je Ticker (an einem Referenz-
 * Zeitpunkt, z.B. Analyse-Zeitpunkt), NUR fuer die Kosten-Nebenzeile
 * (costNoteByBucket) — beeinflusst die Headline-Returns NICHT (§8.1: Kosten
 * sind Nebenzeile, nicht Teil der Brutto-Pitch-Zahl).
 */
export function evaluateT2SignalCohort(
  events: SignalReturnEvent[],
  horizonDays: number,
  opts: { folds?: WalkForwardFold[]; sampleCapsUsd?: number[] } = {}
): T2SignalCohortReport {
  const folds = opts.folds ?? WF_V1_FOLDS;
  const clusters = clusterByMonthSignal(events);
  const clustersByProfile = clusterByMonthSignalProfile(events);
  const deltas = monthlyDeltas(clusters);

  const foldReports = folds.map(fold => {
    const monthsInFold = new Set(testMonthsInFold(fold));
    const deltasInFold = deltas.filter(d => monthsInFold.has(d.asOfMonth));
    const nAvoid = deltasInFold.reduce((s, d) => s + d.nAvoid, 0);
    const nBuy = deltasInFold.reduce((s, d) => s + d.nBuy, 0);
    return {
      fold,
      delta: foldDelta(deltasInFold),
      nAvoid,
      nBuy,
      status: (nAvoid >= MIN_N_AVOID_PER_FOLD ? "ok" : "insufficient_data") as "ok" | "insufficient_data",
    };
  });

  const headlineGross = headlinePitch(foldReports.map(f => f.delta));
  const anyOk = foldReports.some(f => f.status === "ok");

  const uniqueBuckets = new Set<number>();
  for (const cap of opts.sampleCapsUsd ?? []) uniqueBuckets.add(cap);
  const costNoteByBucket = Array.from(uniqueBuckets)
    .map(cap => t2EntryCost(cap))
    .filter((c): c is T2EntryCostResult => c != null)
    // dedupe per bucket
    .filter((c, i, arr) => arr.findIndex(x => x.bucket === c.bucket) === i);

  return {
    mode: "t2_signal_cohort",
    horizonDays,
    clusters,
    clustersByProfile,
    monthDeltas: deltas,
    folds: foldReports,
    headlineGross,
    costNoteByBucket,
    status: anyOk ? "ok" : "insufficient_data",
    minNAvoidPerFold: MIN_N_AVOID_PER_FOLD,
  };
}

// ============================================================================
// Kombinierter Report + Purge-Validierung + Survivorship-Gap (§5.5)
// ============================================================================

export interface CombinedBacktestReport {
  scoringVersion: string;
  universe: string;
  horizonDays: number;
  survivorship: "naive" | "corrected";
  t1: T1GateLiftReport | null;
  t2: T2SignalCohortReport | null;
  purgeChecks: ReturnType<typeof validateAllFoldsPurge>;
  gap: BiasGapResult | null;
  generatedAt: string;
}

/**
 * buildCombinedReport() — der eigentliche `GET /api/backtest/report`-Payload
 * (§12: "FoldResult[] + headline Δ_med_corr + Δ_mean_corr + gap + coverage +
 * strata"). Kein LLM, keine Ticker-Hardcodes — reine Zusammenfuehrung
 * bereits berechneter Reports.
 */
export function buildCombinedReport(params: {
  scoringVersion: string;
  universe: string;
  horizonDays: number;
  survivorship: "naive" | "corrected";
  t1?: T1GateLiftReport | null;
  t2?: T2SignalCohortReport | null;
  folds?: WalkForwardFold[];
  naiveHeadlineMedian?: number | null;
  corrHeadlineMedian?: number | null;
}): CombinedBacktestReport {
  const folds = params.folds ?? WF_V1_FOLDS;
  const purgeChecks = validateAllFoldsPurge(folds, params.horizonDays);

  const gap =
    params.naiveHeadlineMedian != null && params.corrHeadlineMedian != null
      ? biasGap(params.naiveHeadlineMedian, params.corrHeadlineMedian)
      : null;

  return {
    scoringVersion: params.scoringVersion,
    universe: params.universe,
    horizonDays: params.horizonDays,
    survivorship: params.survivorship,
    t1: params.t1 ?? null,
    t2: params.t2 ?? null,
    purgeChecks,
    gap,
    generatedAt: new Date().toISOString(),
  };
}
