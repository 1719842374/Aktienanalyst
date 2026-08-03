/**
 * Unit-Tests für calcPuellMultiple / blockRewardForDate (server/btc-miner.ts).
 *
 * Regressions-Hintergrund: Vor diesem Fix nutzte calcPuellMultiple einen
 * konstanten (Post-2024-Halving) BLOCK_REWARD_BTC=3.125 für die gesamte
 * Preishistorie UND einen index-basierten rollingAvg(365) statt eines
 * kalendertag-basierten Fensters. Beide Bugs zusammen führten dazu, dass
 * Puell Multiple in der kompletten verfügbaren Historie (2012-2026) NIE
 * unter 0.5 fiel — obwohl die dokumentierten Bärenmarkt-Böden (Dez. 2018,
 * Jun-Sep 2022) real Werte um 0.4-0.5 hatten. Das machte die Kapitulations-
 * bedingung (Spot<Breakeven AND Puell<0.5 AND MA30<MA60) permanent
 * unerfüllbar — keine einzige rote Kapitulationszone wurde je gerendert.
 *
 * Ausführen: npx tsx script/test-puell-multiple.ts
 * Exit-Code 0 = alle Tests bestanden, 1 = Fehler.
 */
import { calcPuellMultiple, blockRewardForDate } from "../server/btc-miner";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nblockRewardForDate — historischer Block-Reward pro Halving-Ära");
{
  check("Vor erstem Halving (2010) = 50 BTC", blockRewardForDate("2010-01-01") === 50);
  check("Nach 1. Halving (2013) = 25 BTC", blockRewardForDate("2013-01-01") === 25);
  check("Nach 2. Halving (2017) = 12.5 BTC", blockRewardForDate("2017-01-01") === 12.5);
  check("Nach 3. Halving (2021) = 6.25 BTC", blockRewardForDate("2021-08-01") === 6.25);
  check("Nach 4. Halving (2025) = 3.125 BTC", blockRewardForDate("2025-01-01") === 3.125);
  check("Exakt am Halving-Datum 2024-04-20 bereits neuer Reward",
    blockRewardForDate("2024-04-20") === 3.125);
  check("Tag vor Halving 2024-04-20 noch alter Reward",
    blockRewardForDate("2024-04-19") === 6.25);
}

console.log("\ncalcPuellMultiple — synthetische Serie, konstanter Preis + Emissionsdrop am Halving");
{
  // 800 Tage konstanter Preis, mit einem synthetischen Halving in der Mitte.
  // Bei konstantem Preis ist Puell Multiple ohne Halving-Grenze immer nahe 1.0.
  // Direkt nach einem Halving muss die Emission (und damit der Multiple)
  // sprunghaft auf ~0.5 fallen, weil der Tagesumsatz sich halbiert, aber der
  // 365-Tage-MA noch die alte (höhere) Emission mitmittelt.
  const history: { date: string; price: number }[] = [];
  const start = new Date("2023-10-01T00:00:00Z");
  for (let i = 0; i < 800; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    history.push({ date: d.toISOString().split("T")[0], price: 50000 });
  }
  const { puellHistory, puellMultiple } = calcPuellMultiple(history);
  check("puellHistory nicht leer", puellHistory.length > 0, `len=${puellHistory.length}`);
  check("puellMultiple ist ein Number", typeof puellMultiple === "number");

  // Direkt nach dem 2024-04-20-Halving sollte der Multiple sichtbar unter 1
  // fallen (Emission halbiert sich, 365d-MA reagiert verzögert). Die Funktion
  // liefert erst ab ~335 Tagen Historie überhaupt einen Wert (siehe
  // spanDays-Guard) — bei Start 2023-10-01 ist das erst Ende August 2024.
  const rightAfterHalving = puellHistory.find(p => p.date === "2024-08-31");
  check("Multiple fällt kurz nach synthetischem Halving deutlich unter 1.0",
    !!rightAfterHalving && rightAfterHalving.value < 0.9,
    JSON.stringify(rightAfterHalving));
}

console.log("\ncalcPuellMultiple — zu kurze Historie liefert null (kein Fake-Default)");
{
  const shortHistory = Array.from({ length: 100 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    price: 60000,
  }));
  const { puellMultiple, puellHistory } = calcPuellMultiple(shortHistory);
  check("puellMultiple ist null bei <365 Datenpunkten", puellMultiple === null);
  check("puellHistory ist leer bei <365 Datenpunkten", puellHistory.length === 0);
}

console.log(failed === 0 ? "\n✅ Alle Puell-Multiple-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
