/**
 * NVO tester FAIL (KPI "30.12 % TTM"). FIXTURES: overlay events = live /api/dividends output (11.10.2026),
 * prices = Yahoo 11.10.2026 (NVO 38.64 USD); ratio fields for the KPI are fixtures shaped like FMP /stable/ratios.
 * Run: npx tsx script/test-dividend-currency-adr.ts
 */
import assert from "node:assert/strict";
import { normalizeDividendYieldPct } from "../server/dividend-yield-normalize";
import { trailingDividendYield } from "../shared/dividends";

// ── KPI path (analyze-route → normalizeDividendYieldPct) ──
// Old rule, verbatim: no yield field matches DPS/price → DPS/price wins.
function oldKpi(i: any): number {
  const price = i.price, dps = i.ratioDividendPerShare ?? i.profileLastDividend;
  const ref = (dps / price) * 100;
  const near = (a: number) => a / ref <= 2.5 && ref / a <= 2.5;
  for (const v of [i.ratioDividendYieldPercentage, i.ratioDividendYield]) {
    if (v == null) continue;
    if (near(v)) return Math.round(v * 100) / 100;
    if (near(v * 100)) return Math.round(v * 10000) / 100;
  }
  return Math.round(ref * 100) / 100;
}
const KO = { price: 69.86, ratioDividendYield: 0.0292, ratioDividendYieldPercentage: 2.92, ratioDividendPerShare: 2.04 };
// NVO files in DKK: DPS 11.64 DKK (FY), ADR price 38.64 USD. FMP's own yield fields are single-currency.
const NVO = { price: 38.64, ratioDividendYield: 0.036, ratioDividendYieldPercentage: 3.6, ratioDividendPerShare: 11.64 };
const rows = ["| Fall | vorher | nachher |", "|---|---|---|"];
for (const [name, f] of [["KO KPI", KO], ["NVO KPI", NVO]] as const) {
  rows.push(`| ${name} | ${oldKpi(f)}% | ${normalizeDividendYieldPct(f).pct}% (${normalizeDividendYieldPct(f).basis}) |`);
}
assert.equal(oldKpi(NVO), 30.12, "reproduces the tester value");
assert.deepEqual(normalizeDividendYieldPct(NVO), { pct: 3.6, basis: "ratios.dividendYieldPercentage" });
// Decimal field alone stays ambiguous (v or v×100) → #215 rule kept: reference wins (soft, see PR)
assert.equal(normalizeDividendYieldPct({ ...NVO, ratioDividendYieldPercentage: undefined }).pct, 30.12);
assert.equal(normalizeDividendYieldPct(KO).pct, 2.92, "KO unchanged");
// #215 cases unchanged: percent <1 in decimal field (verified), dollars only
assert.equal(normalizeDividendYieldPct({ price: 50, ratioDividendYield: 0.9, ratioDividendPerShare: 0.45 }).pct, 0.9);
assert.equal(normalizeDividendYieldPct({ price: 70, profileLastDividend: 2.04 }).pct, 2.91);
assert.equal(normalizeDividendYieldPct({ price: 220, ratioDividendYield: 0, ratioDividendPerShare: 0 }).pct, 0);

// ── Overlay path (/api/dividends → trailingDividendYield) ──
// Live FMP events are USD per ADR (cross-checked: Yahoo USD 1.275 / 0.579 for the same ex-dates).
const nvoEvents = [
  { date: "2024-03-22", amount: 0.92933 }, { date: "2024-08-16", amount: 0.5169 },
  { date: "2025-03-31", amount: 1.14256 }, { date: "2025-08-18", amount: 0.58432 },
  { date: "2026-03-30", amount: 1.21738 }, { date: "2026-08-17", amount: 0.57919 },
];
const nvoLast = trailingDividendYield([{ date: "2026-10-09", close: 38.64 }], nvoEvents)[0];
assert.equal(nvoLast.yieldPct, 4.65, "overlay = 1.7966 USD / 38.64 USD");
assert.equal(nvoLast.ttmDividend, 1.7966);
const koEvents = [
  { date: "2025-09-15", amount: 0.51 }, { date: "2025-12-01", amount: 0.51 }, { date: "2026-03-13", amount: 0.53 },
  { date: "2026-06-15", amount: 0.53 }, { date: "2026-09-15", amount: 0.53 }, { date: "2024-09-13", amount: 0.485 },
].sort((a, b) => a.date.localeCompare(b.date));
const koLast = trailingDividendYield([{ date: "2026-10-09", close: 69.86 }], koEvents)[0];
assert.equal(koLast.ttmDividend, 2.1);
rows.push(`| NVO Overlay letzter Punkt | 4.65% | ${nvoLast.yieldPct}% (Σ12M ${nvoLast.ttmDividend} USD / 38.64) — unverändert, war korrekt |`);
rows.push(`| KO Overlay (Kurs-Fixture 69.86) | ${koLast.yieldPct}% | ${koLast.yieldPct}% (Σ12M ${koLast.ttmDividend}) |`);
console.log(rows.join("\n"));
console.log("test-dividend-currency-adr: OK");
