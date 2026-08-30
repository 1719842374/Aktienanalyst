/**
 * script/test-backtest-purge.ts — Sprint B3 Phase 3 Akzeptanztest,
 * WORK_SIGNAL_BACKTEST.md §6.3 "Purge" + §6.4 Fold-Tabelle (wf_v1) +
 * Ticket Punkt 9.
 *
 * Beweist zwei Dinge:
 *   1. Die drei fest hinterlegten wf_v1-Folds (§6.4) erfuellen die
 *      Purge-Regel fuer den Default-Horizont 126 (kein Leakage).
 *   2. validatePurge() erkennt eine KUENSTLICH verletzte Purge-Distanz
 *      korrekt als ungueltig (Overlap-Leakage-Test) — d.h. die Funktion
 *      unterscheidet echte Faelle, statt immer "valid" zurueckzugeben.
 *
 * Ausfuehren: npx tsx script/test-backtest-purge.ts
 */
import {
  WF_V1_FOLDS,
  DEFAULT_PITCH_HORIZON_DAYS,
  SUPPORTED_HORIZONS_DAYS,
  validatePurge,
  validateAllFoldsPurge,
  testMonthsInFold,
} from "../server/backtest/walkforward";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("=== §6.4-Fold-Tabelle: exakte Datumswerte ===");
check("Genau 3 Folds (wf_v1)", WF_V1_FOLDS.length === 3, `got ${WF_V1_FOLDS.length}`);

const expected = [
  { foldId: 1, lastTrainAsOf: "2023-01", trainLabelEnd: "2023-07", firstTestAsOf: "2023-08", testLabelEnd: "2024-02" },
  { foldId: 2, lastTrainAsOf: "2024-01", trainLabelEnd: "2024-07", firstTestAsOf: "2024-08", testLabelEnd: "2025-02" },
  { foldId: 3, lastTrainAsOf: "2025-01", trainLabelEnd: "2025-07", firstTestAsOf: "2025-08", testLabelEnd: "2026-02" },
];
for (const exp of expected) {
  const actual = WF_V1_FOLDS.find(f => f.foldId === exp.foldId);
  check(
    `Fold ${exp.foldId}: Datumswerte exakt wie §6.4`,
    JSON.stringify(actual) === JSON.stringify(exp),
    `expected ${JSON.stringify(exp)}, got ${JSON.stringify(actual)}`
  );
}

console.log("\n=== Purge-Validierung: alle wf_v1-Folds, Default-Horizont 126 ===");
// wf_v1: letztes Train-as-of -> erstes Test-as-of = 7 Kalendermonate (z.B.
// 2023-01 -> 2023-08) ≈ 147 approximierte Handelstage. Das deckt h=126
// (Default-Pitch-Horizont) und alles darunter, aber NICHT h=252 (§6.3-
// Tabelle waere fuer h=252 ein eigener wf_v1_h252-Fold-Satz mit groesserem
// Abstand — hier bewusst nur der Default-Horizont geprueft, siehe naechster
// Block fuer die volle Horizont-Matrix).
const purgeResultsDefault = validateAllFoldsPurge(WF_V1_FOLDS, DEFAULT_PITCH_HORIZON_DAYS);
for (const r of purgeResultsDefault) {
  check(`Fold ${r.foldId}: Purge OK bei h=${DEFAULT_PITCH_HORIZON_DAYS} (kein Leakage, Label-Fenster ueberlappen nicht UND Gesamtabstand >= h)`, r.valid, r.message);
}

console.log("\n=== Purge-Validierung: alle unterstuetzten Horizonte (§4.2) gegen die FESTE wf_v1-Fold-Tabelle ===");
// Die wf_v1-Tabelle (§6.4) ist explizit fuer Horizont 126 konstruiert (7
// Monate ≈ 147 Handelstage Abstand). Fuer kleinere Horizonte (21/63) MUSS
// dieselbe Tabelle also ebenfalls purge-valide sein (147 >= 63, 21). Fuer
// den groesseren Horizont 252 MUSS sie dagegen als NICHT ausreichend erkannt
// werden (147 < 252) — das ist ein bewusster Negativ-Test: die Fold-Tabelle
// ist nicht automatisch fuer JEDEN Horizont gueltig, ein h=252-Backtest
// braeuchte eine eigene wf_v1_h252-Tabelle mit groesserem Abstand.
for (const h of SUPPORTED_HORIZONS_DAYS) {
  const results = validateAllFoldsPurge(WF_V1_FOLDS, h);
  const allValid = results.every(r => r.valid);
  if (h <= 126) {
    check(`Horizont h=${h}: wf_v1-Tabelle (7-Monats-Abstand ~147 Handelstage) ist purge-valide`, allValid, JSON.stringify(results.map(r => r.message)));
  } else {
    check(`Horizont h=${h}: wf_v1-Tabelle (nur ~147 Handelstage Abstand) wird korrekt als NICHT ausreichend erkannt (h=252 braucht eine eigene, groessere Fold-Tabelle)`, !allValid, JSON.stringify(results.map(r => r.message)));
  }
}

console.log("\n=== Overlap-Leakage-Test: kuenstlich verletzte Purge-Distanz muss erkannt werden ===");
// Kuenstlicher Fall 1 (direkte Label-Fenster-Ueberlappung): Test-as-of liegt
// VOR Train-Label-Ende -- das Trainings-Label-Fenster ist zum Test-Snapshot-
// Zeitpunkt noch nicht abgeschlossen, das Modell haette also Zukunftsdaten
// relativ zum Test-Snapshot gesehen. Offensichtliche Leakage-Verletzung.
const leakyCase = validatePurge({
  trainLabelEnd: "2023-07",
  firstTestAsOf: "2023-05", // VOR Train-Label-Ende -- Label-Fenster ueberlappen
  horizonDays: DEFAULT_PITCH_HORIZON_DAYS,
});
check("Leakage-Fall (Test-as-of vor Train-Label-Ende) wird als invalid erkannt", leakyCase.valid === false, leakyCase.message);

// Kuenstlicher Fall 2 (Gesamtabstand-Verletzung): Label-Fenster ueberlappen
// sich zwar nicht (trainLabelEnd <= firstTestAsOf), aber der Gesamtabstand
// von lastTrainAsOf bis firstTestAsOf ist kuerzer als h -- z.B. eine
// verkuerzte Fold-Tabelle mit nur 3 Monaten Abstand statt der wf_v1-7-Monate.
const nearMissCase = validatePurge({
  lastTrainAsOf: "2023-05",
  trainLabelEnd: "2023-07",
  firstTestAsOf: "2023-08", // Gesamtabstand lastTrainAsOf->firstTestAsOf = 3 Monate ~63 Handelstage < 126
  horizonDays: DEFAULT_PITCH_HORIZON_DAYS,
});
check("Randfall (Gesamtabstand 3 Monate ~63 Handelstage < h=126) wird als invalid erkannt, obwohl Label-Fenster selbst nicht ueberlappen", nearMissCase.valid === false, nearMissCase.message);

// Positivfall: EXAKT der wf_v1-Fold-1-Abstand (lastTrainAsOf 2023-01 bis
// firstTestAsOf 2023-08 = 7 Monate ~147 Handelstage >= 126) -- muss als
// valid erkannt werden.
const exactCase = validatePurge({
  lastTrainAsOf: "2023-01",
  trainLabelEnd: "2023-07",
  firstTestAsOf: "2023-08",
  horizonDays: DEFAULT_PITCH_HORIZON_DAYS,
});
check("7-Monats-Gesamtabstand (~147 Handelstage, wf_v1-Fold-1-Muster) bei h=126 wird als valid erkannt", exactCase.valid === true, exactCase.message);

console.log("\n=== testMonthsInFold(): Testmonate-Liste je Fold ===");
const fold1Months = testMonthsInFold(WF_V1_FOLDS[0]);
check(
  "Fold 1 Testmonate = [2023-08 .. 2024-02] (7 Monate)",
  JSON.stringify(fold1Months) === JSON.stringify(["2023-08", "2023-09", "2023-10", "2023-11", "2023-12", "2024-01", "2024-02"]),
  JSON.stringify(fold1Months)
);
check("Fold 1 Testmonate: erster Monat = firstTestAsOf", fold1Months[0] === WF_V1_FOLDS[0].firstTestAsOf);
check("Fold 1 Testmonate: letzter Monat = testLabelEnd", fold1Months[fold1Months.length - 1] === WF_V1_FOLDS[0].testLabelEnd);

console.log(`\n${failed === 0 ? "✅ ALLE TESTS BESTANDEN" : `❌ ${failed} TEST(S) FEHLGESCHLAGEN`}`);
process.exit(failed === 0 ? 0 : 1);
