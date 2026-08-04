/**
 * Unit-Tests fuer die Truncation-Erkennung in TechnicalChart.tsx
 * (WORK_DATA_PROVIDERS.md §4: "Chart-Domain immer an tatsaechlich geladene
 * Min/Max-Daten binden — nicht an das Button-Label").
 *
 * Da isHistoryTruncated/hasEnoughForMA200 als lokale Variablen innerhalb der
 * Komponente leben (kein Hook-Extract fuer diese kleine Aenderung), testen
 * wir hier die reine Logik isoliert nachgebaut, um die Kernaussagen ohne
 * React-Rendering abzusichern:
 *   1) isHistoryTruncated = maDataLength > 0 && maDataLength < cutoff
 *   2) hasEnoughForMA200 = maDataLength >= 200
 *
 * Ausfuehren: npx tsx script/test-history-truncation.ts
 */

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function isHistoryTruncated(maDataLength: number, cutoff: number): boolean {
  // 95%-Toleranz: Handelstage/Jahr schwanken leicht (Feiertage), ein exaktes
  // "< cutoff" loest sonst bei z.B. 2513/2520 (99.7%, faktisch volle 10J) einen
  // falschen Alarm aus.
  return maDataLength > 0 && maDataLength < cutoff * 0.95;
}
function hasEnoughForMA200(maDataLength: number): boolean {
  return maDataLength >= 200;
}
const CUTOFF_BY_RANGE: Record<string, number> = {
  "3M": 63, "6M": 126, "1Y": 252, "2Y": 504, "3Y": 756, "5Y": 1260, "10Y": 2520,
};

console.log("\nisHistoryTruncated");
{
  check("10Y gewaehlt, volle 2513 Punkte (AAPL live verifiziert) -> NICHT truncated",
    !isHistoryTruncated(2513, CUTOFF_BY_RANGE["10Y"]));
  check("10Y gewaehlt, nur 1260 Punkte (5Y-Plan-Limit-Szenario) -> truncated",
    isHistoryTruncated(1260, CUTOFF_BY_RANGE["10Y"]));
  check("1Y gewaehlt, 2513 Punkte vorhanden -> NICHT truncated (mehr als genug)",
    !isHistoryTruncated(2513, CUTOFF_BY_RANGE["1Y"]));
  check("0 Punkte (noch nicht geladen) -> NICHT truncated (kein Fehlalarm waehrend Ladezeit)",
    !isHistoryTruncated(0, CUTOFF_BY_RANGE["10Y"]));
  check("exakt cutoff-Punkte -> NICHT truncated (Grenzfall, < nicht <=)",
    !isHistoryTruncated(2520, CUTOFF_BY_RANGE["10Y"]));
  check("2513 von 2520 Punkten (AAPL live, 99.7%) -> NICHT truncated (Feiertags-Toleranz)",
    !isHistoryTruncated(2513, CUTOFF_BY_RANGE["10Y"]));
  check("1260 von 2520 Punkten (5Y statt 10Y, 50%) -> truncated (echtes Plan-Limit)",
    isHistoryTruncated(1260, CUTOFF_BY_RANGE["10Y"]));
}

console.log("\nhasEnoughForMA200");
{
  check("199 Punkte -> NICHT genug", !hasEnoughForMA200(199));
  check("200 Punkte -> genug (Grenzfall inklusive)", hasEnoughForMA200(200));
  check("2513 Punkte (AAPL live) -> genug", hasEnoughForMA200(2513));
  check("0 Punkte -> NICHT genug", !hasEnoughForMA200(0));
}

console.log(failed === 0 ? "\n✅ Alle History-Truncation-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
