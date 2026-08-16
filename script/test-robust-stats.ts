/**
 * test-robust-stats.ts
 * -------------------
 * Unit-Tests für client/src/lib/robustStats.ts
 * Ausführen: npx tsx script/test-robust-stats.ts
 */

import {
  quantileR7,
  winsorize,
  winsorizedMedian,
  trimmedMean,
  computeBasketGrowth,
} from "../client/src/lib/robustStats";

const DATA = [-18.2, 3.1, 8.4, 11.0, 13.7, 15.9, 21.4, 94.6];

let passed = 0;
let failed = 0;

function assertAlmostEqual(actual: number, expected: number, places = 3, msg = "") {
  const tol = Math.pow(10, -places);
  if (Math.abs(actual - expected) > tol) {
    console.error(`FAIL: ${msg} expected ${expected}, got ${actual}`);
    failed++;
  } else {
    console.log(`PASS: ${msg}`);
    passed++;
  }
}

function assertEqual<T>(actual: T, expected: T, msg = "") {
  if (actual !== expected) {
    console.error(`FAIL: ${msg} expected ${expected}, got ${actual}`);
    failed++;
  } else {
    console.log(`PASS: ${msg}`);
    passed++;
  }
}

// --- Quantile R-7 (Excel-kompatibel) ---
const q05 = quantileR7(DATA, 0.05);
const q95 = quantileR7(DATA, 0.95);
assertAlmostEqual(q05, -10.745, 3, "Q5 (R-7 / Excel)");
assertAlmostEqual(q95, 68.98, 2, "Q95 (R-7 / Excel)");
assertEqual(quantileR7(DATA, 0), -18.2, "Q0 = min");
assertEqual(quantileR7(DATA, 1), 94.6, "Q1 = max");
assertEqual(quantileR7([5.0], 0.5), 5.0, "single value");

// --- Winsorize ---
const w = winsorize(DATA, 0.05, 0.95);
assertEqual(w.length, 8, "winsorize keeps n");
assertAlmostEqual(Math.min(...w), -10.745, 3, "winsorize min = Q5");
assertAlmostEqual(Math.max(...w), 68.98, 2, "winsorize max = Q95");

// small sample → no change
const small = [1.0, 2.0, 100.0];
const wSmall = winsorize(small);
assertEqual(wSmall.length, 3, "small sample unchanged length");
assertEqual(wSmall[2], 100.0, "small sample no clip");

// --- Winsorized Median ---
const med = winsorizedMedian(DATA);
assertAlmostEqual(med!, 12.35, 2, "winsorized median");

// --- Trimmed Mean ---
const tm = trimmedMean(DATA, 0.05);
const classicMean = DATA.reduce((a, b) => a + b, 0) / DATA.length;
assertAlmostEqual(tm!, classicMean, 5, "5% trim on n=8 is near no-op");

const tm2 = trimmedMean(DATA, 0.125);
assertAlmostEqual(tm2!, 12.25, 2, "12.5% trimmed mean");

// --- Basket Growth ---
const rev = [0.04, 0.09, 0.11, 0.14, 0.16, 0.22, 0.87, -0.12];
const eps = [0.03, 0.08, 0.10, 0.13, 0.15, 0.20, 0.70, -0.15];
const gBasket = computeBasketGrowth(rev, eps);
console.log(`Basket growth (60/40): ${(gBasket! * 100).toFixed(2)}%`);
if (gBasket != null && gBasket > 0 && gBasket < 0.5) {
  console.log("PASS: computeBasketGrowth returns sensible value");
  passed++;
} else {
  console.error("FAIL: computeBasketGrowth out of expected range");
  failed++;
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---");
process.exit(failed > 0 ? 1 : 0);
