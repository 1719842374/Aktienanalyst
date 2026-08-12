/**
 * Reiner Unit-Test der M2-Overlay-Aufbereitung: YoY-Formel und taegliches
 * Forward-Fill. Kein Netzwerk, daher deterministisch.
 *
 * Ausfuehren: npx tsx script/test-btc-macro.ts
 */
import { buildM2YoyForwardFill, parseFredCsv } from "../server/btc-macro";

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

const parsed = parseFredCsv("DATE,M2SL\n2025-01-01,123.4\n2025-02-01,.\n");
check("FRED-CSV parser ignoriert fehlende Beobachtungen", parsed.length === 1 && parsed[0].value === 123.4);

console.log(failed === 0 ? "\n✅ Alle BTC-Makro-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
