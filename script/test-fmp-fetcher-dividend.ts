/**
 * fmp-fetcher dividendYield uses the #215 helper. FIXTURE values, no live FMP.
 * Run: npx tsx script/test-fmp-fetcher-dividend.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeDividendYieldPct } from "../server/dividend-yield-normalize";

/** Verbatim copy of the old fmp-fetcher expression. */
function oldFetcher(r: any, profile: any): number {
  return (r.dividendYield != null && r.dividendYield > 0)
    ? r.dividendYield * 100
    : (profile.lastAnnualDividend && profile.price > 0) ? (profile.lastAnnualDividend / profile.price) * 100 : 0;
}
function newFetcher(r: any, profile: any): number {
  return normalizeDividendYieldPct({
    price: profile.price,
    ratioDividendYield: r.dividendYield,
    ratioDividendYieldPercentage: r.dividendYieldPercentage,
    ratioDividendPerShare: r.dividendPerShare,
    profileLastDividend: profile.lastDividend ?? profile.lastAnnualDividend,
  }).pct;
}
const cases = [
  { t: "KO", r: { dividendYield: 0.0284, dividendYieldPercentage: 2.84, dividendPerShare: 1.94 }, p: { price: 70, lastDividend: 2.04 }, want: 2.84 },
  { t: "KO (nur Profil legacy $)", r: {}, p: { price: 70, lastAnnualDividend: 2.04 }, want: 2.91 },
  { t: "KO (nur Profil stable lastDividend $)", r: {}, p: { price: 70, lastDividend: 2.04 }, want: 2.91 },
  { t: "NVO", r: { dividendYield: 0.0225, dividendPerShare: 1.7 }, p: { price: 50, lastDividend: 1.7 }, want: 2.25 },
  { t: "NVO (a: Prozent <1 im Dezimalfeld)", r: { dividendYield: 0.9, dividendPerShare: 0.45 }, p: { price: 50 }, want: 0.9 },
  { t: "AMZN", r: { dividendYield: 0, dividendPerShare: 0 }, p: { price: 220, lastDividend: 0 }, want: 0 },
];
const rows = ["| Fall | vorher | nachher |", "|---|---|---|"];
for (const c of cases) {
  const before = +oldFetcher(c.r, c.p).toFixed(2);
  const after = newFetcher(c.r, c.p);
  assert.equal(after, c.want, c.t);
  rows.push(`| ${c.t} | ${before}% | ${after}% |`);
}
console.log(rows.join("\n"));
const src = readFileSync("server/fmp-fetcher.ts", "utf8");
assert.match(src, /normalizeDividendYieldPct\(\{/);
assert.doesNotMatch(src, /ratiosLatest\.dividendYield \* 100/, "old ×100 path gone");
console.log("test-fmp-fetcher-dividend: OK");
