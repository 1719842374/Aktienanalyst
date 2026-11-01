/**
 * dividendYield unit fix (analyze-route block). FIXTURE values, not live FMP.
 * Run: npx tsx script/test-dividend-yield-normalize.ts
 */
import assert from "node:assert/strict";
import { normalizeDividendYieldPct } from "../server/dividend-yield-normalize";
import { classifyLynch, calcLynchPEG } from "../server/catalyst-engine";

/** Verbatim copy of the old block (analyze-route ~709–719 before this PR), for the before column. */
function oldYield(quote: any, ratio: any, profile: any, price: number): number {
  const raw = Number(quote?.dividendYield ?? ratio.dividendYield ?? profile?.lastAnnualDividend ?? 0) || 0;
  if (raw <= 0) return 0;
  if (raw < 1) return raw * 100;
  if (raw > 25 && price > 0) return (raw / price) * 100;
  return raw;
}
function newYield(quote: any, ratio: any, profile: any, price: number): number {
  return normalizeDividendYieldPct({
    price,
    ratioDividendYield: ratio.dividendYield,
    ratioDividendYieldPercentage: ratio.dividendYieldPercentage,
    ratioDividendPerShare: ratio.dividendPerShare,
    profileLastDividend: profile?.lastDividend ?? profile?.lastAnnualDividend,
    quoteDividendYield: quote?.dividendYield,
  }).pct;
}

// --- Unit rules ---
const N = normalizeDividendYieldPct;
assert.deepEqual(N({ price: 70, ratioDividendYield: 0.0284, ratioDividendPerShare: 1.94 }), { pct: 2.84, basis: "ratios.dividendYield" });
// (a) percent below 1 in the decimal field: 0.44 with DPS 0.99 @ 225 (=0.44 %) → 0.44, not 44
assert.deepEqual(N({ price: 225, ratioDividendYield: 0.44, ratioDividendPerShare: 0.99 }), { pct: 0.44, basis: "ratios.dividendYield" });
assert.equal(N({ price: 225, ratioDividendYieldPercentage: 0.44 }).pct, 0.44, "named percent field used as percent");
// (b) dollar fallback is converted via price, never read as percent
assert.deepEqual(N({ price: 50, profileLastDividend: 1.7 }), { pct: 3.4, basis: "dividendPerShare/price" });
assert.deepEqual(N({ price: 0, profileLastDividend: 1.7 }), { pct: 0, basis: "none" }, "no price → N/A");
// legacy quote field without reference → dropped
assert.deepEqual(N({ price: 100, quoteDividendYield: 0.5 }), { pct: 0, basis: "none" });
// inconsistent field vs reference → reference wins
assert.equal(N({ price: 100, ratioDividendYield: 0.9, ratioDividendPerShare: 3 }).pct, 3);
assert.deepEqual(N({ price: 180 }), { pct: 0, basis: "none" });
assert.equal(N({ price: 100, ratioDividendYield: "0.03" }).pct, 3, "string input");

// --- KO / NVO / AMZN fixtures (approximate public figures, rounded; NOT a live pull) ---
type Case = { t: string; price: number; quote: any; ratio: any; profile: any; lynch: any };
const cases: Case[] = [
  { t: "KO", price: 70, quote: {}, ratio: { dividendYield: 0.0284, dividendYieldPercentage: 2.84, dividendPerShare: 1.94 }, profile: { lastDividend: 2.04 },
    lynch: { epsGrowth5Y: 6, revenueGrowth: 3, sector: "Consumer Defensive", industry: "Beverages - Non-Alcoholic", fcfMargin: 13, pe: 25, forwardPE: 22, pbRatio: 10, epsGrowthFwd: 6 } },
  { t: "KO (b: nur Profil-$)", price: 70, quote: {}, ratio: {}, profile: { lastAnnualDividend: 2.04 },
    lynch: { epsGrowth5Y: 6, revenueGrowth: 3, sector: "Consumer Defensive", industry: "Beverages - Non-Alcoholic", fcfMargin: 13, pe: 25, forwardPE: 22, pbRatio: 10, epsGrowthFwd: 6 } },
  { t: "NVO", price: 50, quote: {}, ratio: { dividendYield: 0.0225, dividendPerShare: 1.7 }, profile: { lastDividend: 1.7 },
    lynch: { epsGrowth5Y: 18, revenueGrowth: 15, sector: "Healthcare", industry: "Drug Manufacturers - General", fcfMargin: 25, pe: 14, forwardPE: 13, pbRatio: 10, epsGrowthFwd: 7 } },
  { t: "NVO (b: nur Profil-$)", price: 50, quote: {}, ratio: {}, profile: { lastAnnualDividend: 1.7 },
    lynch: { epsGrowth5Y: 18, revenueGrowth: 15, sector: "Healthcare", industry: "Drug Manufacturers - General", fcfMargin: 25, pe: 14, forwardPE: 13, pbRatio: 10, epsGrowthFwd: 7 } },
  { t: "NVO (a: Prozent <1 im Dezimalfeld)", price: 50, quote: {}, ratio: { dividendYield: 0.9, dividendPerShare: 0.45 }, profile: {},
    lynch: { epsGrowth5Y: 4, revenueGrowth: 6, sector: "Healthcare", industry: "Drug Manufacturers - General", fcfMargin: 25, pe: 14, forwardPE: 13, pbRatio: 10, epsGrowthFwd: 7 } },
  { t: "AMZN", price: 220, quote: {}, ratio: { dividendYield: 0, dividendPerShare: 0 }, profile: { lastDividend: 0 },
    lynch: { epsGrowth5Y: 40, revenueGrowth: 11, sector: "Consumer Cyclical", industry: "Internet Retail", fcfMargin: 6, pe: 35, forwardPE: 30, pbRatio: 7, epsGrowthFwd: 15 } },
];
const rows: string[] = ["| Fall | dividendYield vorher | nachher | Lynch vorher | nachher | PEG vorher | nachher |", "|---|---|---|---|---|---|---|"];
const results: Record<string, { before: number; after: number; pegB: number | null; pegA: number | null; clsB: string; clsA: string }> = {};
for (const c of cases) {
  const before = +oldYield(c.quote, c.ratio, c.profile, c.price).toFixed(2);
  const after = newYield(c.quote, c.ratio, c.profile, c.price);
  const clsB = classifyLynch({ ...c.lynch, dividendYield: before });
  const clsA = classifyLynch({ ...c.lynch, dividendYield: after });
  const pegB = calcLynchPEG({ ...c.lynch, lynchClass: clsB, dividendYield: before }).peg;
  const pegA = calcLynchPEG({ ...c.lynch, lynchClass: clsA, dividendYield: after }).peg;
  results[c.t] = { before, after, pegB, pegA, clsB, clsA };
  rows.push(`| ${c.t} | ${before}% | ${after}% | ${clsB} | ${clsA} | ${pegB ?? "n/a"} | ${pegA ?? "n/a"} |`);
}
console.log(rows.join("\n"));
assert.equal(results["KO"].after, 2.84); assert.equal(results["KO"].pegA, results["KO"].pegB, "KO normal path unchanged");
assert.equal(results["KO (b: nur Profil-$)"].after, 2.91);
assert.equal(results["NVO (b: nur Profil-$)"].before, 1.7); assert.equal(results["NVO (b: nur Profil-$)"].after, 3.4);
assert.equal(results["NVO (a: Prozent <1 im Dezimalfeld)"].before, 90); assert.equal(results["NVO (a: Prozent <1 im Dezimalfeld)"].after, 0.9);
assert.equal(results["AMZN"].after, 0); assert.equal(results["AMZN"].pegA, results["AMZN"].pegB);
console.log("test-dividend-yield-normalize: OK");
