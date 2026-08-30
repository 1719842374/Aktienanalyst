/**
 * server/backtest/cluster.ts — Sprint B3 Phase 3 (T1/T2 Cluster + Walk-Forward,
 * WORK_SIGNAL_BACKTEST.md §7 "Cluster-Median vs. Mean" + §2.2 ("server/
 * backtest/cluster.ts — Median inner/outer, Mean-Nebenrechnung") + Ticket
 * Punkt 3.
 *
 * Implementiert die drei Stufen aus §7.2 EXAKT:
 *
 *   Stufe 1 — innerhalb Monat t, Signal s: median(returns), n >= 8 sonst
 *             N/A (NICHT 0).
 *   Stufe 2 — Monatsdelta: δ_t = median_Avoid,t - median_Buy,t
 *   Stufe 3 — ueber Test-Monate eines Folds: Δ_Fold = median_t(δ_t)
 *
 * Mean wird PARALLEL auf jeder Stufe berechnet (§7.4: Mean ist Pflicht fuer
 * "was waere aus 1€ geworden", aber NIEMALS alleinige Headline-Zahl — immer
 * neben dem Median ausgewiesen). Diese Datei liefert auf jeder Stufe beide
 * Werte; der Aufrufer (evaluate.ts) entscheidet, wie er sie praesentiert,
 * druckt aber laut Regel den Median IMMER als Headline.
 *
 * Cluster primaer nach (asOfMonth, signal); zusaetzlich (asOfMonth, signal,
 * GrowthProfile) als Strata (§7.5) — beide Gruppierungen werden hier als
 * separate Funktionen angeboten (clusterByMonthSignal / clusterByMonthSignalProfile),
 * damit der Aufrufer beide parallel berechnen kann, ohne Code zu duplizieren.
 *
 * KEIN zweites Score-Modell hier — diese Datei aggregiert nur bereits
 * vorhandene (ticker, asOf, signal, return)-Tupel, die aus replayAt() +
 * deriveSignalV1() + forwardReturn() stammen.
 */
import type { SignalV1 } from "./types";

/** min_n_signal_per_month — §4.2: "n >= 8, sonst N/A (NICHT 0)". */
export const MIN_N_SIGNAL_PER_MONTH = 8;

/** Ein einzelnes (ticker, asOf)-Return-Event mit zugehoerigem Signal — die
 *  minimale Eingabeform fuer alle Cluster-Funktionen in dieser Datei. */
export interface SignalReturnEvent {
  ticker: string;
  asOfMonth: string; // yyyy-mm (Monatsraster, §7.1)
  signal: SignalV1;
  r: number; // Forward-Return (Dezimal), aus forwardReturn().r
  growthProfile?: string | null; // fuer §7.5 Profil-Strata, optional
}

/** Median einer Zahlenliste. Gerade Laenge: Mittelwert der beiden mittleren
 *  Werte (Standarddefinition) — keine eigene Interpolation erfunden. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Stufe-1-Ergebnis: EIN (Monat, Signal)-Cluster. */
export interface MonthSignalCluster {
  asOfMonth: string;
  signal: SignalV1;
  n: number;
  /** null wenn n < MIN_N_SIGNAL_PER_MONTH — §7.2 "sonst N/A (nicht 0)". */
  medianReturn: number | null;
  meanReturn: number | null;
  belowMinN: boolean;
}

/**
 * clusterByMonthSignal() — Stufe 1 (§7.2). Gruppiert Events nach
 * (asOfMonth, signal) und berechnet Median+Mean je Gruppe. "Ein Monat = eine
 * Stimme" (§7.1) wird hier NICHT durch Downsampling erzwungen — das passiert
 * erst in Stufe 2/3 (dort wird pro Monat genau EIN δ_t-Wert produziert,
 * unabhaengig davon wie viele Ticker im Monat stecken).
 */
export function clusterByMonthSignal(events: SignalReturnEvent[]): MonthSignalCluster[] {
  const groups = new Map<string, SignalReturnEvent[]>();
  for (const e of events) {
    if (e.signal == null) continue; // §9 Zeile 1: kein Signal -> nicht clusterbar
    const key = `${e.asOfMonth}__${e.signal}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const result: MonthSignalCluster[] = [];
  for (const [key, arr] of Array.from(groups.entries())) {
    const [asOfMonth, signal] = key.split("__") as [string, SignalV1];
    const returns = arr.map(e => e.r);
    const n = returns.length;
    const belowMinN = n < MIN_N_SIGNAL_PER_MONTH;
    result.push({
      asOfMonth,
      signal,
      n,
      medianReturn: belowMinN ? null : median(returns),
      meanReturn: belowMinN ? null : mean(returns),
      belowMinN,
    });
  }
  return result.sort((a, b) => a.asOfMonth.localeCompare(b.asOfMonth) || String(a.signal).localeCompare(String(b.signal)));
}

/** Wie clusterByMonthSignal(), aber zusaetzlich nach growthProfile gestrata
 *  (§7.5 "Vier Cluster-Mediane + Gesamt"). Events ohne growthProfile werden
 *  ausgelassen (kein Strata-Wert erfunden). */
export function clusterByMonthSignalProfile(events: SignalReturnEvent[]): Array<MonthSignalCluster & { growthProfile: string }> {
  const groups = new Map<string, SignalReturnEvent[]>();
  for (const e of events) {
    if (e.signal == null || !e.growthProfile) continue;
    const key = `${e.asOfMonth}__${e.signal}__${e.growthProfile}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const result: Array<MonthSignalCluster & { growthProfile: string }> = [];
  for (const [key, arr] of Array.from(groups.entries())) {
    const [asOfMonth, signal, growthProfile] = key.split("__") as [string, SignalV1, string];
    const returns = arr.map(e => e.r);
    const n = returns.length;
    const belowMinN = n < MIN_N_SIGNAL_PER_MONTH;
    result.push({
      asOfMonth,
      signal,
      growthProfile,
      n,
      medianReturn: belowMinN ? null : median(returns),
      meanReturn: belowMinN ? null : mean(returns),
      belowMinN,
    });
  }
  return result.sort(
    (a, b) =>
      a.asOfMonth.localeCompare(b.asOfMonth) ||
      String(a.signal).localeCompare(String(b.signal)) ||
      a.growthProfile.localeCompare(b.growthProfile)
  );
}

/** Stufe-2-Ergebnis: EIN Monatsdelta δ_t (Avoid vs. Buy). */
export interface MonthDelta {
  asOfMonth: string;
  nAvoid: number;
  nBuy: number;
  /** δ_t = median_Avoid,t - median_Buy,t. null wenn n_avoid<8 ODER n_buy<8
   *  (§13 Akzeptanzkriterium: "δ_t nur wenn n_avoid>=8 UND n_buy>=8"). */
  deltaMedian: number | null;
  deltaMean: number | null;
  eligible: boolean;
}

/**
 * monthlyDeltas() — Stufe 2 (§7.2 + §13). δ_t nur wenn BEIDE Seiten
 * (Avoid UND Buy) n >= MIN_N_SIGNAL_PER_MONTH erfuellen — sonst δ_t = null
 * (kein Delta aus einer Seite mit zu wenig Daten erfinden).
 */
export function monthlyDeltas(clusters: MonthSignalCluster[]): MonthDelta[] {
  const byMonth = new Map<string, MonthSignalCluster[]>();
  for (const c of clusters) {
    const arr = byMonth.get(c.asOfMonth) ?? [];
    arr.push(c);
    byMonth.set(c.asOfMonth, arr);
  }

  const result: MonthDelta[] = [];
  for (const [asOfMonth, arr] of Array.from(byMonth.entries())) {
    const avoid = arr.find(c => c.signal === "Avoid");
    const buy = arr.find(c => c.signal === "Buy");
    const nAvoid = avoid?.n ?? 0;
    const nBuy = buy?.n ?? 0;
    const eligible =
      nAvoid >= MIN_N_SIGNAL_PER_MONTH &&
      nBuy >= MIN_N_SIGNAL_PER_MONTH &&
      avoid?.medianReturn != null &&
      buy?.medianReturn != null;

    result.push({
      asOfMonth,
      nAvoid,
      nBuy,
      deltaMedian: eligible ? (avoid!.medianReturn as number) - (buy!.medianReturn as number) : null,
      deltaMean:
        eligible && avoid?.meanReturn != null && buy?.meanReturn != null
          ? (avoid.meanReturn as number) - (buy.meanReturn as number)
          : null,
      eligible,
    });
  }
  return result.sort((a, b) => a.asOfMonth.localeCompare(b.asOfMonth));
}

/** Stufe-3-Ergebnis: EIN Δ_Fold (Median + Mean der Monatsdeltas eines Folds). */
export interface FoldDelta {
  /** Anzahl Monate MIT eligible δ_t (nicht die Gesamtzahl der Testmonate —
   *  Monate ohne genug Avoid/Buy tragen nicht zur Fold-Aggregation bei). */
  nEligibleMonths: number;
  nTotalMonths: number;
  deltaFoldMedian: number | null;
  deltaFoldMean: number | null;
}

/**
 * foldDelta() — Stufe 3 (§7.2): Δ_Fold = median_t(δ_t) UND Mean_t(δ_t)
 * (parallel, §7.4) ueber die Testmonate EINES Folds. Nur Monate mit
 * eligible=true (n_avoid>=8 UND n_buy>=8) gehen ein.
 */
export function foldDelta(monthDeltas: MonthDelta[]): FoldDelta {
  const eligible = monthDeltas.filter(d => d.eligible && d.deltaMedian != null);
  const medians = eligible.map(d => d.deltaMedian as number);
  const means = eligible
    .filter(d => d.deltaMean != null)
    .map(d => d.deltaMean as number);

  return {
    nEligibleMonths: eligible.length,
    nTotalMonths: monthDeltas.length,
    deltaFoldMedian: medians.length > 0 ? median(medians) : null,
    deltaFoldMean: means.length > 0 ? mean(means) : null,
  };
}

/**
 * headlinePitch() — §7.2 "Headline: Δ_6M_pitch = median(Δ_Fold1, Δ_Fold2, Δ_Fold3)".
 * Mean parallel (§7.4), niemals alleinige Aussage. Nimmt die deltaFoldMedian/
 * deltaFoldMean-Werte mehrerer Folds entgegen (ein Wert je Fold, null wenn
 * der Fold selbst keine eligible Monate hatte) und aggregiert ueber die
 * Folds hinweg mit derselben Median/Mean-Logik.
 */
export interface HeadlineResult {
  nFoldsUsed: number;
  nFoldsTotal: number;
  headlineMedian: number | null;
  headlineMean: number | null;
}
export function headlinePitch(folds: FoldDelta[]): HeadlineResult {
  const usable = folds.filter(f => f.deltaFoldMedian != null);
  const medians = usable.map(f => f.deltaFoldMedian as number);
  const meansUsable = folds.filter(f => f.deltaFoldMean != null);
  const means = meansUsable.map(f => f.deltaFoldMean as number);

  return {
    nFoldsUsed: usable.length,
    nFoldsTotal: folds.length,
    headlineMedian: medians.length > 0 ? median(medians) : null,
    headlineMean: means.length > 0 ? mean(means) : null,
  };
}
