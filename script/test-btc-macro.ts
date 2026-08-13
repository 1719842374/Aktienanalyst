/**
 * Reiner Unit-Test der M2-Overlay-Aufbereitung: YoY-Formel und taegliches
 * Forward-Fill. Kein Netzwerk, daher deterministisch.
 *
 * Ausfuehren: npx tsx script/test-btc-macro.ts
 */
import {
  buildM2AbsoluteForwardFill,
  buildM2YoyForwardFill,
  parseFredCsv,
  shiftSeriesForwardDays,
} from "../server/btc-macro";

let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== BTC M2 YoY: Formel und Forward-Fill ===");

const monthly = Array.from({ length: 14 }, (_, i) => {
  const date = new Date(Date.UTC(2024, i, 1)).toISOString().slice(0, 10);
  return { date, value: 100 + i };
});

const filled = buildM2YoyForwardFill(monthly, "2025-01-01", "2025-02-03");
const januaryExpected = ((112 / 100) - 1) * 100;
const februaryExpected = ((113 / 101) - 1) * 100;

check("YoY verwendet exakt den Wert 12 Monate zuvor", Math.abs(filled["2025-01-01"] - januaryExpected) < 1e-10, String(filled["2025-01-01"]));
check("Monatswert wird an Folgetagen fortgeschrieben", Math.abs(filled["2025-01-31"] - januaryExpected) < 1e-10, String(filled["2025-01-31"]));
check("Neuer Monatswert ersetzt den Forward-Fill am Beobachtungstag", Math.abs(filled["2025-02-01"] - februaryExpected) < 1e-10, String(filled["2025-02-01"]));
check("Forward-Fill gilt auch fuer Wochenenden", filled["2025-02-02"] === filled["2025-02-01"]);

console.log("\n=== BTC M2 Absolut: Umrechnung und Lag ===");

const absoluteFilled = buildM2AbsoluteForwardFill(
  [
    { date: "2025-01-01", value: 23000 },
    { date: "2025-02-01", value: 23150 },
  ],
  "2025-01-01",
  "2025-02-03",
);
check("M2 Absolut rechnet Mrd. USD in Billionen USD um", absoluteFilled["2025-01-01"] === 23, String(absoluteFilled["2025-01-01"]));
check("M2 Absolut schreibt Monatswert an Folgetagen fort", absoluteFilled["2025-01-31"] === 23, String(absoluteFilled["2025-01-31"]));
check("M2 Absolut uebernimmt neuen Monatswert am Beobachtungstag", absoluteFilled["2025-02-01"] === 23.15, String(absoluteFilled["2025-02-01"]));
check("M2 Absolut fuellt auch Wochenenden fort", absoluteFilled["2025-02-02"] === 23.15, String(absoluteFilled["2025-02-02"]));

const sourceSeries = { "2025-01-01": 23.0, "2025-02-01": 23.15 };
const shifted = shiftSeriesForwardDays(sourceSeries, 70);
check("M2 Lag verschiebt Datums-Keys exakt um 70 Tage", shifted["2025-03-12"] === 23.0 && shifted["2025-04-12"] === 23.15, JSON.stringify(shifted));
check("M2 Lag behaelt die Werte unveraendert", Object.values(shifted).every(value => value === 23.0 || value === 23.15), JSON.stringify(shifted));
check("M2 Lag mutiert das Originalobjekt nicht", JSON.stringify(sourceSeries) === "{\"2025-01-01\":23,\"2025-02-01\":23.15}", JSON.stringify(sourceSeries));

const parsed = parseFredCsv("DATE,M2SL\n2025-01-01,123.4\n2025-02-01,.\n");
check("FRED-CSV parser ignoriert fehlende Beobachtungen", parsed.length === 1 && parsed[0].value === 123.4);

console.log(failed === 0 ? "\n✅ Alle BTC-Makro-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
