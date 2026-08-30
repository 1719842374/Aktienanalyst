/**
 * server/backtest/walkforward.ts — Sprint B3 Phase 3 (T1/T2 Cluster + Walk-
 * Forward, WORK_SIGNAL_BACKTEST.md §6.3 "Purge" + §6.4 "Walk-Forward-Folds
 * (wf_v1, Horizont 126)" + §2.2 ("server/backtest/walkforward.ts — Folds,
 * Purge, Embargo") + Ticket Punkt 4.
 *
 * Zwei Bausteine:
 *   1. WF_V1_FOLDS — die EXAKTE Fold-Tabelle aus §6.4 (fest, benannte
 *      Konstante, kein Ticker-/Zahlen-Erfinden). Expanding Train ab 2021-01,
 *      3 Folds (2023/2024/2025 als jeweils letztes Train-as-of).
 *   2. validatePurge() — die Purge-Regel aus §6.3: Train-Label-Ende + Purge
 *      (>= h Handelstage) muss <= erstem Test-as-of liegen (kein Leakage).
 *
 * §4.2: Horizonte h ∈ {21, 63, 126, 252} Handelstage, Default-Pitch-Horizont
 * 126. Purge >= h Handelstage (§6.3-Tabelle).
 */

/** §4.2 Horizonte h — Handelstage. */
export const SUPPORTED_HORIZONS_DAYS = [21, 63, 126, 252] as const;
export type HorizonDays = typeof SUPPORTED_HORIZONS_DAYS[number];

/** Default-Pitch-Horizont (§4.2: "Default-Pitch-Horizont 126"). */
export const DEFAULT_PITCH_HORIZON_DAYS = 126;

/** min_n_avoid_per_fold — §4.2 + §13: "n Avoid/Fold < 80 → status:
 *  insufficient_data, keine Pitch-Zahl". */
export const MIN_N_AVOID_PER_FOLD = 80;

/**
 * EIN Walk-Forward-Fold nach §6.4-Tabelle. Alle Datumsfelder sind
 * Monatsultimo-Marker (yyyy-mm), Snapshot-Raster laut §4.2.
 */
export interface WalkForwardFold {
  foldId: number;
  lastTrainAsOf: string; // "Letztes Train-as-of"
  trainLabelEnd: string; // "Train-Label-Ende"
  firstTestAsOf: string; // "Erstes Test-as-of"
  testLabelEnd: string; // "Test-Label-Ende"
}

/**
 * wf_v1-Fold-Tabelle — WORTWOERTLICH aus §6.4 uebernommen (Expanding Train
 * ab 2021-01, Horizont 126 = 6M). Train-Start ist implizit 2021-01 fuer alle
 * drei Folds (expanding: Fold 2 und 3 nutzen mehr Traindaten als Fold 1,
 * aber alle beginnen am selben Ursprungsdatum) — hier NICHT als separates
 * Feld gefuehrt, weil §6.4 nur die vier tabellierten Spalten nennt; ein
 * Aufrufer, der den Train-Start explizit braucht, kann WF_V1_TRAIN_START
 * unten verwenden.
 */
export const WF_V1_TRAIN_START = "2021-01";

export const WF_V1_FOLDS: WalkForwardFold[] = [
  { foldId: 1, lastTrainAsOf: "2023-01", trainLabelEnd: "2023-07", firstTestAsOf: "2023-08", testLabelEnd: "2024-02" },
  { foldId: 2, lastTrainAsOf: "2024-01", trainLabelEnd: "2024-07", firstTestAsOf: "2024-08", testLabelEnd: "2025-02" },
  { foldId: 3, lastTrainAsOf: "2025-01", trainLabelEnd: "2025-07", firstTestAsOf: "2025-08", testLabelEnd: "2026-02" },
];

/**
 * Handelstage-Naeherung Monat -> Tage: ~21 Handelstage/Monat (Standard-
 * Naeherung, US/EU-Kalender). Wird NUR fuer die Purge-Validierung benutzt
 * (Monatsabstand in ungefaehre Handelstage umrechnen), nicht fuer die
 * eigentliche Return-Berechnung (die nutzt echte Handelstage aus den
 * Kursdaten, siehe returns.ts).
 */
const APPROX_TRADING_DAYS_PER_MONTH = 21;

function monthDiff(fromYm: string, toYm: string): number {
  const [fy, fm] = fromYm.split("-").map(Number);
  const [ty, tm] = toYm.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export interface PurgeValidationResult {
  valid: boolean;
  horizonDays: number;
  requiredPurgeDays: number;
  actualGapMonths: number;
  actualGapApproxDays: number;
  message: string;
}

/**
 * validatePurge() — §6.3:
 *   Train-as-of <= T_tr --h--> letztes Train-Label-Ende
 *                          --purge >= h--> erstes Test-as-of
 *
 * PRAEZISIERUNG DER SEMANTIK (aus dem konkreten wf_v1-Fold-Beispiel §6.4
 * abgeleitet, da die Prosa-Formel allein mehrdeutig ist): "Train-Label-Ende"
 * ist bereits das ENDE des Label-Fensters der letzten Trainings-Stuetzstelle
 * (Train-as-of + h). Das Label-Fenster des ersten Test-Snapshots beginnt bei
 * `firstTestAsOf + 1` und laeuft bis `firstTestAsOf + h`. "Purge" ist damit
 * per Konstruktion bereits erfuellt, SOBALD sich diese beiden Label-Fenster
 * nicht ueberlappen, d.h. sobald `trainLabelEnd <= firstTestAsOf` gilt (das
 * Trainings-Label-Fenster endet, BEVOR das Test-Label-Fenster ueberhaupt
 * beginnt — exakt das im wf_v1-Beispiel beobachtete Muster: Train-Label-Ende
 * 2023-07, Test-as-of 2023-08, keine gemeinsame Handelstage-Ueberlappung).
 * Zusaetzlich pruefen wir additiv, dass der GESAMTABSTAND von `lastTrainAsOf`
 * bis `firstTestAsOf` mindestens `horizonDays` betraegt (das ist die
 * eigentliche "Purge >= h"-Groesse aus der Tabelle in §6.3: Train-as-of ->
 * [h] -> Train-Label-Ende -> [dieser Rest] -> Test-as-of; addiert man beide
 * Strecken, muss die GESAMTE Trainings-Spanne bereits >= h weit VOR dem
 * Test-as-of enden, was im wf_v1-Beispiel mit 7 Monaten Abstand (2023-01 ->
 * 2023-08 ≈ 147 Handelstage >= h=126) tatsaechlich erfuellt ist). Beide
 * Bedingungen muessen gelten, sonst `valid=false` (Leakage-Risiko) — Ticket
 * Punkt 8: "sonst Fehler/Warnung".
 */
export function validatePurge(params: {
  /** Letztes Train-as-of (Beginn der Trainings-Stuetzstelle, VOR dem
   *  h-Schritt zu trainLabelEnd). Optional fuer Abwaertskompatibilitaet mit
   *  Aufrufern, die nur trainLabelEnd/firstTestAsOf kennen — wenn nicht
   *  gesetzt, wird nur die Ueberlappungs-Bedingung (trainLabelEnd <=
   *  firstTestAsOf) geprueft, nicht die Gesamtabstands-Bedingung. */
  lastTrainAsOf?: string; // yyyy-mm
  trainLabelEnd: string; // yyyy-mm
  firstTestAsOf: string; // yyyy-mm
  horizonDays: number;
}): PurgeValidationResult {
  // Bedingung 1 (immer geprueft): keine Ueberlappung der Label-Fenster.
  const noOverlap = params.trainLabelEnd <= params.firstTestAsOf;

  // Bedingung 2 (nur wenn lastTrainAsOf bekannt): Gesamtabstand Train-as-of
  // -> Test-as-of muss >= h Handelstage betragen (deckt sowohl den h-Schritt
  // zu Train-Label-Ende als auch die Restdistanz zu Test-as-of ab).
  const gapMonths = params.lastTrainAsOf != null ? monthDiff(params.lastTrainAsOf, params.firstTestAsOf) : monthDiff(params.trainLabelEnd, params.firstTestAsOf);
  const gapApproxDays = gapMonths * APPROX_TRADING_DAYS_PER_MONTH;
  const totalSpanOk = params.lastTrainAsOf == null || gapApproxDays >= params.horizonDays;

  const valid = noOverlap && totalSpanOk;

  const parts: string[] = [];
  parts.push(
    noOverlap
      ? `Label-Fenster ueberlappen NICHT (Train-Label-Ende ${params.trainLabelEnd} <= Test-as-of ${params.firstTestAsOf}).`
      : `LEAKAGE: Label-Fenster ueberlappen (Train-Label-Ende ${params.trainLabelEnd} > Test-as-of ${params.firstTestAsOf}).`
  );
  if (params.lastTrainAsOf != null) {
    parts.push(
      totalSpanOk
        ? `Gesamtabstand Train-as-of ${params.lastTrainAsOf} -> Test-as-of ${params.firstTestAsOf} = ${gapMonths} Monate (~${gapApproxDays} Handelstage) >= h=${params.horizonDays}.`
        : `LEAKAGE-RISIKO: Gesamtabstand Train-as-of ${params.lastTrainAsOf} -> Test-as-of ${params.firstTestAsOf} = ${gapMonths} Monate (~${gapApproxDays} Handelstage) < h=${params.horizonDays}.`
    );
  }

  return {
    valid,
    horizonDays: params.horizonDays,
    requiredPurgeDays: params.horizonDays,
    actualGapMonths: gapMonths,
    actualGapApproxDays: gapApproxDays,
    message: (valid ? "Purge OK: " : "PURGE-VERLETZUNG: ") + parts.join(" "),
  };
}

/** Validiert ALLE Folds einer Fold-Tabelle gegen einen Horizont — Convenience
 *  fuer den Feasibility-Runner/Tests, damit nicht jeder Fold einzeln
 *  aufgerufen werden muss. */
export function validateAllFoldsPurge(
  folds: WalkForwardFold[],
  horizonDays: number
): Array<PurgeValidationResult & { foldId: number }> {
  return folds.map(f => ({
    foldId: f.foldId,
    ...validatePurge({ lastTrainAsOf: f.lastTrainAsOf, trainLabelEnd: f.trainLabelEnd, firstTestAsOf: f.firstTestAsOf, horizonDays }),
  }));
}

/**
 * Generiert die Monats-Snapshot-Liste (yyyy-mm) innerhalb eines Folds
 * zwischen firstTestAsOf und testLabelEnd (inklusive) — die "Testmonate
 * eines Folds" aus §7.2 Stufe 3. Snapshot-Raster ist Monatsultimo (§4.2).
 */
export function testMonthsInFold(fold: WalkForwardFold): string[] {
  const months: string[] = [];
  let [y, m] = fold.firstTestAsOf.split("-").map(Number);
  const [endY, endM] = fold.testLabelEnd.split("-").map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}
