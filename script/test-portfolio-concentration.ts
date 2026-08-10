/**
 * Unit-Tests für client/src/lib/portfolio/concentration.ts (Folge-Ticket
 * 10.08.2026 Punkt 1: HHI/Effective-N/Korrelations-Warnungen).
 *
 * Ausführen: npx tsx script/test-portfolio-concentration.ts
 */
import { computeHHI, computeCorrelationStats, assessConcentration } from "../client/src/lib/portfolio/concentration";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// === HHI/Effective-N ===

const equalWeights3 = [1 / 3, 1 / 3, 1 / 3];
const hhiEqual3 = computeHHI(equalWeights3);
check("HHI bei 3 gleichen Gewichten = 1/3", Math.abs(hhiEqual3.hhi - 1 / 3) < 1e-9, JSON.stringify(hhiEqual3));
check("Effective-N bei 3 gleichen Gewichten = 3", Math.abs(hhiEqual3.effectiveN - 3) < 1e-6, JSON.stringify(hhiEqual3));

const concentratedWeights = [0.9, 0.05, 0.05];
const hhiConcentrated = computeHHI(concentratedWeights);
check("HHI bei konzentriertem Portfolio deutlich höher als bei Equal-Weight", hhiConcentrated.hhi > hhiEqual3.hhi, JSON.stringify(hhiConcentrated));
check("Effective-N bei konzentriertem Portfolio deutlich < 3", hhiConcentrated.effectiveN < 1.5, JSON.stringify(hhiConcentrated));

const singleWeight = [1];
check("HHI bei n=1 (100% ein Titel) = 1", computeHHI(singleWeight).hhi === 1);
check("Effective-N bei n=1 = 1", computeHHI(singleWeight).effectiveN === 1);

check("HHI bei leerem Array -> kein Crash (hhi=1, effectiveN=0)", (() => {
  const r = computeHHI([]);
  return r.hhi === 1 && r.effectiveN === 0;
})());

// Normalisierung: Gewichte, die nicht exakt zu 1 summieren, werden intern normiert
const unnormalized = [2, 2]; // Summe 4, aber relativ gleich gewichtet
check("HHI normalisiert Gewichte, die nicht zu 1 summieren", Math.abs(computeHHI(unnormalized).hhi - 0.5) < 1e-9, JSON.stringify(computeHHI(unnormalized)));

// === Korrelationsstatistik ===

// Perfekt korrelierte 2 Titel: Sigma_12 = sigma1*sigma2
const perfectCorrSigma = [[0.04, 0.06], [0.06, 0.09]]; // sigma1=0.2, sigma2=0.3, cov=0.06=0.2*0.3*1.0
const corrPerfect = computeCorrelationStats(perfectCorrSigma);
check("Korrelation bei perfekt korrelierten Titeln ≈ 1", corrPerfect.avg != null && Math.abs(corrPerfect.avg - 1) < 1e-6, JSON.stringify(corrPerfect));

// Unkorrelierte Titel: Sigma_12 = 0
const uncorrSigma = [[0.04, 0], [0, 0.09]];
const corrZero = computeCorrelationStats(uncorrSigma);
check("Korrelation bei unkorrelierten Titeln = 0", corrZero.avg === 0, JSON.stringify(corrZero));

// 3 Titel, gemischte Korrelation -> avg zwischen min und max
const mixedSigma = [
  [0.04, 0.03, 0],
  [0.03, 0.09, 0.02],
  [0, 0.02, 0.16],
];
const corrMixed = computeCorrelationStats(mixedSigma);
check("Korrelation bei 3 Titeln: avg liegt zwischen 0 und max", corrMixed.avg != null && corrMixed.max != null && corrMixed.avg <= corrMixed.max && corrMixed.avg >= 0, JSON.stringify(corrMixed));

check("Korrelation bei n<2 -> null (nicht sinnvoll)", computeCorrelationStats([[0.04]]).avg === null);
check("Korrelation bei leerer Matrix -> null, kein Crash", computeCorrelationStats([]).avg === null);

// === assessConcentration: End-to-End inkl. Flags ===

const concentratedResult = assessConcentration([0.9, 0.05, 0.05], perfectCorrSigma.length === 3 ? mixedSigma : [[0.04, 0.03, 0], [0.03, 0.09, 0.02], [0, 0.02, 0.16]]);
check("assessConcentration liefert Effective-N-Warnung bei stark konzentrierten Gewichten", concentratedResult.flags.some(f => f.includes("Effective-N")), JSON.stringify(concentratedResult));

const highCorrResult = assessConcentration([0.5, 0.5], perfectCorrSigma);
check("assessConcentration liefert Korrelations-Warnung bei perfekt korrelierten Titeln", highCorrResult.flags.some(f => f.includes("Korrelation")), JSON.stringify(highCorrResult));

const healthyResult = assessConcentration([1 / 3, 1 / 3, 1 / 3], uncorrSigma.length === 2 ? [[0.04, 0, 0], [0, 0.09, 0], [0, 0, 0.16]] : uncorrSigma);
check("assessConcentration liefert KEINE Warnung bei gleich gewichteten, unkorrelierten Titeln", healthyResult.flags.length === 0, JSON.stringify(healthyResult));

check("assessConcentration: hhi/effectiveN konsistent mit computeHHI", (() => {
  const direct = computeHHI([0.6, 0.4]);
  const via = assessConcentration([0.6, 0.4], [[0.04, 0], [0, 0.09]]);
  return Math.abs(direct.hhi - via.hhi) < 1e-9 && Math.abs(direct.effectiveN - via.effectiveN) < 1e-9;
})());

console.log(failed === 0 ? `\n✅ Alle Concentration-Tests bestanden (15 Checks)` : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
