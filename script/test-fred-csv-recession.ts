/**
 * JOB A1 — Rezessionspfad unverändert nach Extraktion des FRED-Parse-Kerns (server/fred-csv.ts).
 * Vergleicht die bisherige Implementierung von getLatestFredValue (wörtlich aus recession.ts @ main 17c488e0
 * übernommen, unten als legacy*) mit dem neuen gemeinsamen Kern — auf dem echten BAA10Y-Snapshot,
 * auf jedem Präfix-Schnitt davon und auf Randfällen — und prüft, dass der Slot „Kreditspreads (BAA-Trs)“
 * (creditReading) für jeden Wert identisch bleibt.
 * Ausführen: npx tsx script/test-fred-csv-recession.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BAA10Y_SERIES_ID, fredCsvObservations, fredCsvUrl, latestFredCsvValue } from "../server/fred-csv";
import { creditReading } from "../server/recession";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

// ── legacy: Body von getLatestFredValue vor A1 (URL + Parse), 1:1 ──
function legacyUrl(seriesId: string, cosd: string): string {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${cosd}`;
}
function legacyLatest(csv: string): number {
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return NaN;
  const lines = csv.trim().split("\n").slice(1);
  const validLines = lines.filter(l => {
    const val = l.split(",")[1]?.trim();
    return val && val !== "." && !isNaN(parseFloat(val));
  });
  if (validLines.length === 0) return NaN;
  return parseFloat(validLines[validLines.length - 1].split(",")[1].trim());
}
const same = (a: number, b: number) => (Number.isNaN(a) && Number.isNaN(b)) || Object.is(a, b);

// URL
for (const [id, cosd] of [["BAA10Y", "2024-10-18"], ["T10Y3M", "2024-01-01"], ["VIXCLS", "2025-02-28"]]) {
  assert.equal(fredCsvUrl(id, cosd), legacyUrl(id, cosd));
}
assert.equal(BAA10Y_SERIES_ID, "BAA10Y");
ok("fredCsvUrl(id, cosd) == bisherige URL; Serien-ID BAA10Y");

// Echter Snapshot + jeder 50. Präfix-Schnitt (auch Schnitte auf "."-Tagen)
const csv = readFileSync("script/fixtures/credit/BAA10Y-2026-10-11.csv", "utf8");
assert.ok(same(latestFredCsvValue(csv), legacyLatest(csv)));
const lines = csv.split("\n");
let cuts = 0;
for (let k = 1; k <= lines.length; k += 50) {
  const part = lines.slice(0, k).join("\n");
  assert.ok(same(latestFredCsvValue(part), legacyLatest(part)), `Schnitt ${k}`);
  cuts++;
}
console.log(`     Snapshot letzter Wert ${latestFredCsvValue(csv)} (alt ${legacyLatest(csv)}), ${cuts} Präfix-Schnitte identisch`);
ok("BAA10Y-Snapshot: neuer Kern == alter getLatestFredValue (voll + Präfixe)");

// Randfälle
const edge = [
  "", "<html><body>Error</body></html>", "<!DOCTYPE html><p>x</p>", "observation_date,BAA10Y",
  "observation_date,BAA10Y\n2026-10-07,.", "observation_date,BAA10Y\n2026-10-07,1.46\n2026-10-08,.",
  "observation_date,BAA10Y\r\n2026-10-07,1.46\r\n2026-10-08,1.48\r\n", "observation_date,BAA10Y\n2026-10-07,1.46abc",
  "observation_date,BAA10Y\n2026-10-07,\n2026-10-08,  1.50 ", "observation_date,BAA10Y\n2026-10-07,1.46,9\n",
  "observation_date,BAA10Y\n\n\n2026-10-07,-0.25\n\n", "observation_date,BAA10Y\n2026-10-07,1e2",
];
for (const e of edge) assert.ok(same(latestFredCsvValue(e), legacyLatest(e)), JSON.stringify(e));
assert.ok(Number.isNaN(latestFredCsvValue(null)));
ok(`Randfälle (${edge.length}): HTML, leer, '.', CRLF, Müll, Leerzeilen, Exponent → identisch`);

// Beobachtungen: Datei-Reihenfolge, gleiche Werte wie die gültigen Zeilen
const obs = fredCsvObservations(csv);
assert.equal(obs[obs.length - 1].value, legacyLatest(csv));
assert.ok(obs.every(o => Number.isFinite(o.value)));
ok(`fredCsvObservations: ${obs.length} gültige Zeilen, nur endliche Werte`);

// Rezessions-Slot identisch (creditReading wird vom Rezessionspfad unverändert mit dem Wert aufgerufen)
for (let k = 1; k <= lines.length; k += 500) {
  const part = lines.slice(0, k).join("\n");
  assert.deepEqual(creditReading(latestFredCsvValue(part)), creditReading(legacyLatest(part)));
}
assert.deepEqual(creditReading(latestFredCsvValue(csv)), creditReading(legacyLatest(csv)));
const slot = creditReading(latestFredCsvValue(csv));
console.log(`     Slot: ${slot.name} = ${slot.value}, Zone ${slot.zone}, Score ${slot.weightedScore}/${slot.maxWeighted}`);
ok("creditReading (Rezession, Kreditspreads BAA-Trs) identisch");

// Quelltext: recession.ts nutzt den gemeinsamen Kern und hat keinen zweiten BAA10Y-Parser
const rec = readFileSync("server/recession.ts", "utf8");
assert.ok(rec.includes('from "./fred-csv"'));
assert.ok(rec.includes("latestFredCsvValue(fetchUrl(fredCsvUrl(seriesId, getDateNMonthsAgo(24))))"));
assert.ok(rec.includes("getLatestFredValue(BAA10Y_SERIES_ID)"));
assert.ok(rec.includes('getLatestFredValue("BAA")') && rec.includes('getLatestFredValue("GS10")'), "Fallback BAA − GS10 bleibt");
const route = readFileSync("server/credit-route.ts", "utf8");
assert.ok(route.includes('from "./fred-csv"') && !route.includes("fred.stlouisfed.org/graph"), "Credit-Route ohne eigenen FRED-Parser/URL");
ok("Quelltext: Rezession + Credit-Route teilen server/fred-csv.ts, Fallback BAA−GS10 unverändert");

console.log(`\n${n} Checks grün`);
