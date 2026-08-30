/**
 * script/test-backtest-survivorship.ts — Sprint B3 Phase 2 Akzeptanztest,
 * WORK_SIGNAL_BACKTEST.md §13 + tickets/SPRINT_B3_PHASE2_PIT_UNIVERSE.md
 * Punkt 7:
 *   "Naive vs. corr Fixture — ein synthetischer Fall mit einem 2023
 *    delisteten Namen muss in U_corr(2022-06) auftauchen, aber NICHT in
 *    einer naiven 'heutiger Index'-Logik."
 *   "Kein Ticker mit cap_T < 1e9 oder listingDate > T darf in U_corr(T)
 *    landen."
 *
 * Rein synthetische Fixtures (KEINE echten Ticker-Namen als Hardcode-Logik —
 * die Ticker-Strings hier sind reine Testdaten, keine if(ticker===...)-
 * Verzweigung im Produktionscode, siehe server/backtest/universe.ts: die
 * Funktion selbst enthaelt keinen einzigen Ticker-String). Nutzt die in
 * inUniverse() vorgesehenen Override-Parameter (opts.changes/opts.delisted/
 * opts.profileOverride), damit der Test ohne echte FMP-Calls deterministisch
 * läuft (kein Netzwerk-Flake in der CI, kein API-Budget-Verbrauch fuer reine
 * Logikpruefung).
 *
 * Ausfuehren: npx tsx script/test-backtest-survivorship.ts
 */
import { inUniverse, CAP_FLOOR_USD, type ConstituentChangeRow, type DelistedCompanyRow } from "../server/backtest/universe";
import { coverageT, biasGap, terminalReturn } from "../server/backtest/pit";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ============================================================
// Fixture: "ZZZDELIST" — 2023 aus dem Index entfernt (M&A), also HEUTE
// NICHT mehr Indexmitglied, aber im Juni 2022 (asOf) noch handelbar,
// notiert, cap_T über der Schwelle.
// ============================================================
const FIXTURE_CHANGES: ConstituentChangeRow[] = [
  {
    dateAdded: "January 03, 2019",
    addedSecurity: "ZZZ Delist Corp",
    removedTicker: "",
    removedSecurity: "",
    date: "2019-01-03",
    symbol: "ZZZDELIST",
    reason: "Fixture: Aufnahme in den Index 2019",
  },
  {
    dateAdded: "March 15, 2023",
    addedSecurity: "ZZZ Survivor Inc.",
    removedTicker: "ZZZDELIST",
    removedSecurity: "ZZZ Delist Corp",
    date: "2023-03-15",
    symbol: "ZZZSURVIVOR",
    reason: "Fixture: ZZZ Delist Corp was acquired 2023",
  },
];

const FIXTURE_DELISTED: DelistedCompanyRow[] = [
  {
    symbol: "ZZZDELIST",
    companyName: "ZZZ Delist Corp",
    exchange: "NYSE",
    ipoDate: "2015-06-01",
    delistedDate: "2023-03-15",
  },
];

async function main() {
  console.log("=== Test: naive vs. corr — 2023 delisteter Fixture-Name ===");

  // --- U_corr(2022-06): ZZZDELIST muss ENTHALTEN sein ---
  // (listingDate 2015-06-01 <= 2022-06-30, delistedDate 2023-03-15 > 2022-06-30,
  //  cap_T ueber Schwelle via profileOverride)
  const corrJune2022 = await inUniverse("ZZZDELIST", "2022-06-30", "corr", {
    changes: FIXTURE_CHANGES,
    delisted: FIXTURE_DELISTED,
    profileOverride: { marketCap: 5e9, ipoDate: "2015-06-01" },
  });
  check(
    "U_corr(2022-06) enthaelt ZZZDELIST (vor Delisting, cap_T ok, listingDate ok)",
    corrJune2022.inUniverse === true,
    JSON.stringify(corrJune2022)
  );
  check("U_corr(2022-06) dataComplete=true fuer ZZZDELIST", corrJune2022.dataComplete === true);

  // --- U_naive: ZZZDELIST ist HEUTE kein Indexmitglied mehr (durch
  // ZZZSURVIVOR ersetzt) -> naive Logik ("heutiger Index-Mitglied") darf
  // ZZZDELIST NICHT enthalten, unabhaengig vom cap-Wert. ---
  const naiveToday = await inUniverse("ZZZDELIST", "2022-06-30", "naive", {
    changes: FIXTURE_CHANGES,
    profileOverride: { marketCap: 5e9, ipoDate: "2015-06-01" },
  });
  check(
    "U_naive (heutiger Index) enthaelt ZZZDELIST NICHT (2023 durch ZZZSURVIVOR ersetzt)",
    naiveToday.inUniverse === false,
    JSON.stringify(naiveToday)
  );

  check(
    "naive und corr liefern fuer denselben Ticker/Datum unterschiedliche Ergebnisse",
    corrJune2022.inUniverse !== naiveToday.inUniverse
  );

  // --- U_corr NACH Delisting (2023-06-01): ZZZDELIST darf NICHT mehr drin sein ---
  const corrAfterDelist = await inUniverse("ZZZDELIST", "2023-06-01", "corr", {
    changes: FIXTURE_CHANGES,
    delisted: FIXTURE_DELISTED,
    profileOverride: { marketCap: 5e9, ipoDate: "2015-06-01" },
  });
  check(
    "U_corr(2023-06) enthaelt ZZZDELIST NICHT mehr (delistedDate 2023-03-15 <= asOf)",
    corrAfterDelist.inUniverse === false,
    JSON.stringify(corrAfterDelist)
  );

  console.log("\n=== Test: Akzeptanzkriterium — kein Ticker mit cap_T < 1e9 in U_corr(T) ===");
  const lowCap = await inUniverse("ZZZLOWCAP", "2022-06-30", "corr", {
    changes: [],
    delisted: [],
    profileOverride: { marketCap: 4e8, ipoDate: "2015-06-01" }, // 400 Mio < 1 Mrd
  });
  check(
    `cap_T ${4e8} < CAP_FLOOR_USD ${CAP_FLOOR_USD} -> NICHT in U_corr(T)`,
    lowCap.inUniverse === false
  );

  console.log("\n=== Test: Akzeptanzkriterium — kein Ticker mit listingDate > T in U_corr(T) ===");
  const notYetListed = await inUniverse("ZZZFUTUREIPO", "2022-06-30", "corr", {
    changes: [],
    delisted: [],
    profileOverride: { marketCap: 5e9, ipoDate: "2023-01-01" }, // IPO NACH asOf
  });
  check(
    "listingDate (2023-01-01) > asOf (2022-06-30) -> NICHT in U_corr(T)",
    notYetListed.inUniverse === false
  );

  console.log("\n=== Test: fehlende PIT-Felder -> dataComplete=false statt Raten ===");
  const missingData = await inUniverse("ZZZNODATA", "2022-06-30", "corr", {
    changes: [],
    delisted: [],
    profileOverride: { marketCap: null, ipoDate: null },
  });
  check("dataComplete=false wenn cap_T und listingDate fehlen", missingData.dataComplete === false);
  check("inUniverse=false (konservativ) wenn dataComplete=false", missingData.inUniverse === false);

  console.log("\n=== Test: coverage_T (§5.4) ===");
  const cov = coverageT("2022-06", "2022-06-30", [
    { inUniverse: true, dataComplete: true },
    { inUniverse: true, dataComplete: true },
    { inUniverse: true, dataComplete: false },
    { inUniverse: false, dataComplete: false }, // nicht im Universum -> zaehlt nicht in nUniverse
  ]);
  check("nUniverse=3 (nur inUniverse=true zaehlt)", cov.nUniverse === 3, JSON.stringify(cov));
  check("nDataComplete=2", cov.nDataComplete === 2, JSON.stringify(cov));
  check("coverage=2/3", Math.abs((cov.coverage ?? -1) - 2 / 3) < 1e-9, JSON.stringify(cov));

  const covEmpty = coverageT("2022-07", "2022-07-31", []);
  check("coverage=null wenn nUniverse=0 (kein Divide-by-zero-Raten)", covEmpty.coverage === null);

  console.log("\n=== Test: Bias-Gap (§5.5, synthetische Werte) ===");
  const gapPositive = biasGap(0.08, 0.065); // naive 8% vs corr 6.5%
  check("Gap = 0.08 - 0.065 = 0.015", Math.abs(gapPositive.gap - 0.015) < 1e-9, JSON.stringify(gapPositive));
  check("Gap > 0 -> Survivor-only-Interpretation im Text", gapPositive.interpretation.includes("Survivor-only"));

  const gapZero = biasGap(0.05, 0.05);
  check("Gap = 0 bei identischen Deltas", gapZero.gap === 0);

  console.log("\n=== Test: Terminal-Return (§5.3) — kein Drop, kein r=0 ===");
  const tCashMa = terminalReturn({ pEntry: 50, pLast: 48, cashOfferPrice: 55 });
  check("Cash-M&A-Pfad: r = 55/50 - 1 = 0.10", Math.abs(tCashMa.r - 0.1) < 1e-9, JSON.stringify(tCashMa));
  check("method=cash_ma_offer", tCashMa.method === "cash_ma_offer");

  const tLastClose = terminalReturn({ pEntry: 50, pLast: 12 });
  check("Letzter-Close-Pfad: r = 12/50 - 1 = -0.76", Math.abs(tLastClose.r - (-0.76)) < 1e-9, JSON.stringify(tLastClose));
  check("method=last_tradable_close", tLastClose.method === "last_tradable_close");

  const tInsolvency = terminalReturn({ pEntry: null, pLast: null });
  check(
    "Insolvenz-Pfad: r im dokumentierten Bereich [-1.0, -0.8], NICHT r=0",
    tInsolvency.r <= -0.8 && tInsolvency.r >= -1.0 && tInsolvency.r !== 0
  );
  check("method=insolvency_range", tInsolvency.method === "insolvency_range");
  check("range=[-1.0, -0.8] dokumentiert", JSON.stringify(tInsolvency.range) === JSON.stringify([-1.0, -0.8]));

  console.log(`\n${failed === 0 ? "✅ ALLE TESTS BESTANDEN" : `❌ ${failed} TEST(S) FEHLGESCHLAGEN`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error("Fataler Fehler im Testlauf:", err);
  process.exit(1);
});
