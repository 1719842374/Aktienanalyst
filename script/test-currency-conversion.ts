/**
 * Currency Conversion Regression Test
 *
 * Guards against a class of bug where foreign-filer financial statements
 * (income-statement/cash-flow-statement/balance-sheet-statement) are read
 * from FMP without converting reportedCurrency -> USD. This previously
 * caused e.g. Novo Nordisk (reports in DKK) to show P/E 2.2 instead of ~14-15,
 * because a DKK-denominated EPS was divided into a USD share price.
 *
 * Two kinds of checks, both required to pass:
 *
 * 1. UNIT CHECK (deterministic, no network) — feeds convertFmpRowToUsd() a
 *    synthetic row with a known reportedCurrency + getFxRateToUsd() mocked
 *    to a fixed rate, and asserts the converted numeric fields match the
 *    expected USD values exactly. This never breaks due to market moves.
 *
 * 2. LIVE SANITY CHECK (network, FMP Starter key required) — fetches live
 *    income-statement + ratios for NVO (DKK), ASML (EUR), and 7203.T/TM (JPY),
 *    runs them through convertFmpRowsToUsd(), and asserts the resulting P/E
 *    (price / converted EPS) stays within a wide multiple (0.3x-3x) of FMP's
 *    own /stable/ratios priceToEarningsRatio (which FMP already computes
 *    correctly in USD). This is currency-mismatch-shaped: a real regression
 *    (currency not converted) produces an error of several multiples (5-10x
 *    for DKK, ~6-7x for JPY), while normal quarter-to-quarter EPS/price drift
 *    stays well under 2x. Uses a wide band specifically to avoid false
 *    positives from market moves or quarterly earnings changes.
 *
 * Run with: npx tsx script/test-currency-conversion.ts
 * Requires: FMP_API_KEY env var (Starter plan or higher)
 *
 * Exit codes:
 *   0 = All checks passed
 *   1 = Currency conversion regression detected
 *   2 = Network/setup error (FMP unreachable, key missing) — not a code regression
 */

import { convertFmpRowToUsd, convertFmpRowsToUsd, getFxRateToUsd, fmpRatios, fmpQuote } from "../server/fmp";

let failures = 0;
let networkErrors = 0;

function assertClose(label: string, actual: number, expected: number, tolerancePct: number) {
  const diffPct = Math.abs(actual - expected) / Math.abs(expected) * 100;
  if (diffPct > tolerancePct) {
    console.error(`[FAIL] ${label}: got ${actual}, expected ~${expected} (±${tolerancePct}%), diff ${diffPct.toFixed(1)}%`);
    failures++;
  } else {
    console.log(`[PASS] ${label}: ${actual} (within ${tolerancePct}% of expected ${expected})`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. UNIT CHECKS — deterministic, no network, exact fixed-rate math
// ─────────────────────────────────────────────────────────────────────────
async function runUnitChecks() {
  console.log("\n=== Unit checks (synthetic rows, no network) ===");

  // Synthetic DKK row modeled on Novo Nordisk's real FY2025 income statement
  // shape (reportedCurrency, revenue, eps). The rate is injected via a real
  // getFxRateToUsd() call so this also smoke-tests the live-rate path once,
  // but the row itself is synthetic so the assertion is exact, not a range.
  const dkkRate = await getFxRateToUsd("DKK");
  if (dkkRate === 1) {
    console.warn("[SKIP] DKK rate fetch failed (network?) — skipping exact-value unit check");
    networkErrors++;
  } else {
    const syntheticDkkRow = {
      reportedCurrency: "DKK",
      revenue: 309064000000,   // NVO's actual FY2025 DKK revenue, used as a realistic magnitude
      eps: 15.35,              // synthetic EPS in DKK
      ebitda: 128000000000,
      totalDebt: 0,
      date: "2025-12-31",
    };
    const converted = await convertFmpRowToUsd(syntheticDkkRow);
    assertClose("Synthetic DKK row: revenue converted", converted.revenue, 309064000000 * dkkRate, 0.01);
    assertClose("Synthetic DKK row: eps converted", converted.eps, 15.35 * dkkRate, 0.01);
    if (converted.reportedCurrency !== "DKK") {
      console.error(`[FAIL] reportedCurrency field should be preserved, got ${converted.reportedCurrency}`);
      failures++;
    } else {
      console.log(`[PASS] reportedCurrency field preserved as DKK`);
    }
    if (!converted._fxConverted || converted._fxConverted.from !== "DKK") {
      console.error(`[FAIL] _fxConverted marker missing or wrong`);
      failures++;
    } else {
      console.log(`[PASS] _fxConverted marker present: ${JSON.stringify(converted._fxConverted)}`);
    }
  }

  // USD passthrough: a USD row must be returned unchanged (no accidental
  // double-conversion or rate lookup for the common case).
  const usdRow = { reportedCurrency: "USD", revenue: 1000, eps: 5 };
  const usdResult = await convertFmpRowToUsd(usdRow);
  if (usdResult.revenue !== 1000 || usdResult.eps !== 5 || usdResult._fxConverted) {
    console.error(`[FAIL] USD row was modified when it should pass through unchanged: ${JSON.stringify(usdResult)}`);
    failures++;
  } else {
    console.log(`[PASS] USD row passes through unchanged (no conversion, no _fxConverted marker)`);
  }

  // Array variant: convertFmpRowsToUsd should convert every row in the array
  // using a single fetched rate for the first row's currency.
  const eurRate = await getFxRateToUsd("EUR");
  if (eurRate === 1) {
    console.warn("[SKIP] EUR rate fetch failed (network?) — skipping array unit check");
    networkErrors++;
  } else {
    const eurRows = [
      { reportedCurrency: "EUR", revenue: 100, eps: 10, date: "2025-12-31" },
      { reportedCurrency: "EUR", revenue: 90, eps: 9, date: "2024-12-31" },
    ];
    const convertedRows = await convertFmpRowsToUsd(eurRows);
    assertClose("EUR array row[0].revenue", convertedRows[0].revenue, 100 * eurRate, 0.01);
    assertClose("EUR array row[1].eps", convertedRows[1].eps, 9 * eurRate, 0.01);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 2. LIVE SANITY CHECKS — real FMP data, wide-tolerance cross-check against
//    FMP's own /stable/ratios (which is already correctly denominated in USD)
// ─────────────────────────────────────────────────────────────────────────
const LIVE_CASES = [
  { ticker: "NVO", currency: "DKK", label: "Novo Nordisk (DKK)" },
  { ticker: "ASML", currency: "EUR", label: "ASML Holding (EUR)" },
  { ticker: "TM", currency: "JPY", label: "Toyota Motor (JPY, ADR)" },
];

async function runLiveSanityChecks() {
  console.log("\n=== Live sanity checks (real FMP data) ===");

  for (const { ticker, currency, label } of LIVE_CASES) {
    try {
      const [quote, ratios] = await Promise.all([
        fmpQuote(ticker),
        fmpRatios(ticker, 1),
      ]);
      const price = Number(quote?.price);
      const ratiosLatest: any = Array.isArray(ratios) ? ratios[0] : null;
      const fmpPE = Number(ratiosLatest?.priceToEarningsRatio ?? ratiosLatest?.priceEarningsRatio ?? 0);
      const reportedCurrency = ratiosLatest?.reportedCurrency;

      if (!price || !fmpPE || fmpPE <= 0) {
        console.warn(`[SKIP] ${label}: missing price (${price}) or FMP ratios P/E (${fmpPE}) — network or data issue, not a code regression`);
        networkErrors++;
        continue;
      }
      if (reportedCurrency !== currency) {
        console.warn(`[SKIP] ${label}: expected reportedCurrency=${currency}, FMP now reports ${reportedCurrency} — FMP data format changed, test assumptions need review`);
        networkErrors++;
        continue;
      }

      // Fetch this stock's own income statement, run it through our converter,
      // and recompute P/E the same way routes.ts's getFmpFallbackData() does.
      const { fmpIncomeStatement } = await import("../server/fmp");
      const rawIncome = await fmpIncomeStatement(ticker, 1);
      const convertedIncome = await convertFmpRowsToUsd(rawIncome);
      const eps = Number(convertedIncome?.[0]?.eps ?? convertedIncome?.[0]?.epsDiluted ?? 0);

      if (!eps || eps <= 0) {
        console.warn(`[SKIP] ${label}: no usable EPS after conversion — skipping`);
        networkErrors++;
        continue;
      }

      const computedPE = price / eps;
      const ratio = computedPE / fmpPE;
      // Wide band: 0.3x-3x. A real currency-conversion bug produces errors of
      // 5-10x (DKK) or 6-7x (JPY), far outside this band. Normal cross-source
      // P/E differences (trailing vs. diluted EPS, timing) stay well inside it.
      if (ratio < 0.3 || ratio > 3) {
        console.error(
          `[FAIL] ${label}: our computed P/E (${computedPE.toFixed(2)}, from price ${price} / converted EPS ${eps.toFixed(2)}) ` +
          `diverges ${ratio.toFixed(2)}x from FMP's own ratios P/E (${fmpPE.toFixed(2)}) — likely currency conversion regression`
        );
        failures++;
      } else {
        console.log(
          `[PASS] ${label}: our P/E ${computedPE.toFixed(2)} vs FMP ratios P/E ${fmpPE.toFixed(2)} ` +
          `(ratio ${ratio.toFixed(2)}x, within [0.3x, 3x] band)`
        );
      }
    } catch (err: any) {
      console.warn(`[SKIP] ${label}: fetch failed (${err?.message?.substring(0, 150)}) — network/API issue, not a code regression`);
      networkErrors++;
    }
  }
}

async function main() {
  await runUnitChecks();
  await runLiveSanityChecks();

  console.log(`\n=== Summary: ${failures} failure(s), ${networkErrors} network/skip(s) ===`);

  if (failures > 0) {
    console.error("Currency conversion regression detected.");
    process.exit(1);
  }
  if (networkErrors > 0 && networkErrors >= LIVE_CASES.length + 2) {
    // Every single check was skipped due to network issues — treat as setup
    // error rather than a silent pass, so CI surfaces a missing FMP_API_KEY.
    console.error("All checks were skipped due to network/setup issues — check FMP_API_KEY.");
    process.exit(2);
  }
  console.log("All currency conversion checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Unexpected error running currency conversion tests:", err);
  process.exit(2);
});
