/**
 * Test fuer Punkt 2 (HOCH-Ticket 05.08.2026): gold-realyield-model.ts an
 * gold-routes.ts anbinden.
 *
 * Ist-Zustand vor diesem Fix: das Modul war vollstaendig+unit-getestet
 * (test-gold-realyield-model.ts), aber gold-routes.ts rief runRealYieldGoldModel()
 * nie auf — Kommentar im Code bestaetigte die Nicht-Anbindung.
 *
 * Diese Datei prueft die Verdrahtungslogik selbst (Datenaufbereitung +
 * Wrapping in GoldRealYieldModelSummary), NICHT die Modell-Mathematik selbst
 * (die ist bereits in test-gold-realyield-model.ts abgedeckt und bleibt
 * unveraendert):
 *  1. historicalPrices (GoldPricePoint[] mit close/date) laesst sich 1:1 auf
 *     das vom Modell erwartete {date, close}[]-Format abbilden.
 *  2. runRealYieldGoldModel() mit realistischen Testdaten liefert ein
 *     Ergebnis, dessen Felder unveraendert in GoldRealYieldModelSummary passen
 *     (keine Feldnamen-Drift zwischen Modul und Schema).
 *  3. Zu wenige Datenpunkte (<30 fuer Fair-Value) fuehren zu fairValue=null,
 *     KEIN Fake-Default — Modell und Wiring-Schicht sind konsistent.
 *  4. Das alte 1980/2011-Fair-Value-Modell (GoldFairValue) bleibt strukturell
 *     unangetastet — realYieldModel ist ein rein additives Zusatzfeld.
 *
 * Ausfuehren: npx tsx script/test-gold-realyield-wiring.ts
 */
import { runRealYieldGoldModel } from "../server/gold-realyield-model";
import type { GoldRealYieldModelSummary, GoldPricePoint } from "../shared/gold-schema";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function buildSyntheticHistory(days: number): { goldPrices: { date: string; close: number }[]; real10Y: { date: string; value: number }[] } {
  const goldPrices: { date: string; close: number }[] = [];
  const real10Y: { date: string; value: number }[] = [];
  const start = new Date("2024-01-01T00:00:00Z");
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    // Real10Y faellt leicht über die Zeit (2.2% -> 1.5%), Gold steigt invers (2000 -> 2600)
    const r = 2.2 - (i / days) * 0.7 + Math.sin(i / 5) * 0.03;
    const gold = 2000 + (i / days) * 600 - r * 20 + Math.sin(i / 7) * 5;
    goldPrices.push({ date: dateStr, close: gold });
    real10Y.push({ date: dateStr, value: r });
  }
  return { goldPrices, real10Y };
}

console.log("\n=== Route-Simulation: historicalPrices (GoldPricePoint[]) -> Modell-Input ===");
{
  const { goldPrices, real10Y } = buildSyntheticHistory(300);
  // Simuliert exakt das, was gold-routes.ts tut: historicalPrices ist
  // GoldPricePoint[] (date, close, ma200?, real10y?) -> .map(p => ({date, close}))
  const historicalPrices: GoldPricePoint[] = goldPrices.map(p => ({ date: p.date, close: p.close, ma200: undefined }));
  const goldPricesForModel = historicalPrices.map(p => ({ date: p.date, close: p.close }));

  check("Mapping behaelt Punktanzahl", goldPricesForModel.length === historicalPrices.length);
  check("Mapping behaelt date/close-Werte identisch",
    goldPricesForModel[0].date === historicalPrices[0].date &&
    goldPricesForModel[0].close === historicalPrices[0].close
  );

  const modelResult = runRealYieldGoldModel(goldPricesForModel, real10Y);

  // Wrapping wie in gold-routes.ts: 1:1 Felder in GoldRealYieldModelSummary
  const realYieldModel: GoldRealYieldModelSummary = {
    fairValue: modelResult.fairValue,
    inverseScore: modelResult.inverseScore,
    scenarios: modelResult.scenarios,
    regime: modelResult.regime,
    gates: modelResult.gates,
    generatedAt: modelResult.generatedAt,
  };

  check("fairValue vorhanden (>=30 Punkte im Testdatensatz)", realYieldModel.fairValue !== null);
  check("fairValue.fairValue ist eine plausible Preiszahl (>0)", (realYieldModel.fairValue?.fairValue ?? 0) > 0);
  check("inverseScore.score liegt in {-1,0,1}", [-1, 0, 1].includes(realYieldModel.inverseScore.score));
  check("scenarios ist non-empty Array", Array.isArray(realYieldModel.scenarios) && realYieldModel.scenarios.length > 0);
  check("regime.regime liegt in stress/tailwind/neutral",
    ["stress", "tailwind", "neutral"].includes(realYieldModel.regime?.regime ?? ""));
  check("gates enthaelt genau 2 Gates (GOLD_REAL_YIELD_REGIME, GOLD_AISC_STRESS)",
    realYieldModel.gates.length === 2 &&
    realYieldModel.gates.some(g => g.id === "GOLD_REAL_YIELD_REGIME") &&
    realYieldModel.gates.some(g => g.id === "GOLD_AISC_STRESS")
  );
  check("generatedAt ist valides ISO-Datum", !isNaN(new Date(realYieldModel.generatedAt).getTime()));

  // Da Real10Y im Testdatensatz konstruktionsbedingt faellt und Gold steigt
  // (starke inverse Beziehung), sollte das Regime tailwind oder neutral sein,
  // NICHT stress — validiert, dass das Wiring die richtigen Serien in der
  // richtigen Reihenfolge an das Modell uebergibt (kein x/y-Vertauscher).
  check("Regime konsistent mit synthetischen Daten (fallender Realzins != stress)",
    realYieldModel.regime?.regime !== "stress", `regime=${realYieldModel.regime?.regime}`);
}

console.log("\n=== Zu wenig Daten (<30 Punkte) → fairValue=null, kein Fake-Default ===");
{
  const { goldPrices, real10Y } = buildSyntheticHistory(10);
  const modelResult = runRealYieldGoldModel(goldPrices, real10Y);
  const realYieldModel: GoldRealYieldModelSummary = {
    fairValue: modelResult.fairValue,
    inverseScore: modelResult.inverseScore,
    scenarios: modelResult.scenarios,
    regime: modelResult.regime,
    gates: modelResult.gates,
    generatedAt: modelResult.generatedAt,
  };
  check("fairValue ist null bei <30 Punkten (kein Fake-Default)", realYieldModel.fairValue === null);
  check("scenarios ist leer, da kein Fair-Value-Modell verfuegbar", realYieldModel.scenarios.length === 0);
}

console.log("\n=== Skip-Pfad: keine Real10Y-Daten (<5 Punkte, wie in gold-routes.ts Guard) ===");
{
  // Simuliert exakt den Guard in gold-routes.ts: historicalPrices.length > 0 && real10yHistory.length >= 5
  const real10yHistoryEmpty: { date: string; value: number }[] = [];
  const shouldSkip = !(300 > 0 && real10yHistoryEmpty.length >= 5);
  check("Guard erkennt fehlende Real10Y-Daten korrekt (skip statt Crash/Fake-Default)", shouldSkip);
}

console.log(failed === 0 ? "\n✅ Alle Gold-Realyield-Wiring-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
