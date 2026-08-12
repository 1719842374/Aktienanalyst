/**
 * Unit-Tests für M3-Klassifikations-Mix und M1-Beta-Floor
 * (client/src/lib/calculations.ts).
 *
 * Ausführen: npx tsx script/test-crv-m3-classification.ts
 */
import { worstCaseM1, worstCaseM1Label, worstCaseM3 } from "../client/src/lib/calculations";

let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function closeTo(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 1e-9;
}

const price = 100;
const sectorDrawdown = 35;

// 1. Fast Grower: 0.55 × 45 + 0.45 × 35 = 40.5% Drawdown.
const fastGrowerM3 = worstCaseM3(price, sectorDrawdown, "fast_grower");
check(
  "M3 Fast Grower mischt Klassifikation (45%) und Sektor (35%) zu 40.5%",
  closeTo(fastGrowerM3, 59.5),
  `M3=${fastGrowerM3}`,
);

// 2. Regression: fehlende Klassifikation verhält sich unverändert wie der reine Sektor-Drawdown.
const undefinedM3 = worstCaseM3(price, sectorDrawdown);
const nullM3 = worstCaseM3(price, sectorDrawdown, null);
check(
  "M3 ohne Klassifikation (undefined/null) bleibt reiner Sektor-Drawdown",
  closeTo(undefinedM3, 65) && closeTo(nullM3, 65),
  `undefined=${undefinedM3}, null=${nullM3}`,
);

// 3. Unbekannte Klassifikationen fallen ohne Fehler auf den sektorbasierten Altpfad zurück.
const unknownM3 = worstCaseM3(price, sectorDrawdown, "unbekannt");
check(
  "M3 mit unbekannter Klassifikation nutzt reinen Sektor-Drawdown",
  closeTo(unknownM3, 65),
  `M3=${unknownM3}`,
);

// 4. Beta unter 0.70 verwendet den Floor statt den unbeschränkten Altwert.
const lowBetaM1 = worstCaseM1(price, 0.40, sectorDrawdown);
const floorBetaM1 = worstCaseM1(price, 0.70, sectorDrawdown);
check(
  "M1 Beta 0.40 wird auf den Floor 0.70 angehoben",
  closeTo(lowBetaM1, floorBetaM1) && closeTo(lowBetaM1, 75.5),
  `beta=0.40: ${lowBetaM1}, beta=0.70: ${floorBetaM1}`,
);

// 5. Beta über dem Floor bleibt beim bisherigen Berechnungspfad.
const regularBetaM1 = worstCaseM1(price, 1.10, sectorDrawdown);
const expectedRegularBetaM1 = price * (1 - (1.10 * sectorDrawdown) / 100);
check(
  "M1 Beta 1.10 bleibt gegenüber der alten Formel unverändert",
  closeTo(regularBetaM1, expectedRegularBetaM1),
  `M1=${regularBetaM1}, erwartet=${expectedRegularBetaM1}`,
);

// 6. Der UI-Text dokumentiert den Floor ausschließlich, wenn er tatsächlich greift.
const floorLabel = worstCaseM1Label(0.40, sectorDrawdown);
const regularLabel = worstCaseM1Label(1.10, sectorDrawdown);
check(
  "M1-Label zeigt den Beta-Floor-Hinweis nur bei angewendetem Floor",
  floorLabel.includes("β-Floor 0.70 statt 0.40") && !regularLabel.includes("β-Floor"),
  `Floor-Label=${floorLabel}; reguläres Label=${regularLabel}`,
);

console.log(
  failed === 0
    ? "\n✅ Alle M3-Klassifikations- und M1-Beta-Floor-Tests bestanden (6 Fälle)"
    : `\n❌ ${failed} Test(s) fehlgeschlagen`,
);
process.exit(failed === 0 ? 0 : 1);
