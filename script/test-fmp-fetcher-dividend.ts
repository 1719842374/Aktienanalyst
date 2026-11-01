/**
 * fmp-fetcher dividendYield uses the same normalizer as analyze-route (#215). Ersatz für #217.
 * FIXTURE values for the unit rules, no live FMP.
 * Run: npx tsx script/test-fmp-fetcher-dividend.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeDividendYieldPct } from "../server/dividend-yield-normalize";

/** Verbatim copy of the old fmp-fetcher expression (main 4820aaa3, lines 123–130). */
function oldFetcher(r: any, profile: any): number {
  return (r.dividendYield != null && r.dividendYield > 0)
    ? r.dividendYield * 100
    : (profile.lastAnnualDividend && profile.price > 0) ? (profile.lastAnnualDividend / profile.price) * 100 : 0;
}
/** Same call as the new fmp-fetcher block. */
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
  { t: "decimal field (normal)", r: { dividendYield: 0.0284, dividendYieldPercentage: 2.84, dividendPerShare: 1.94 }, p: { price: 70, lastDividend: 2.04 }, want: 2.84 },
  { t: "only profile legacy lastAnnualDividend $", r: {}, p: { price: 70, lastAnnualDividend: 2.04 }, want: 2.91 },
  { t: "only profile stable lastDividend $", r: {}, p: { price: 70, lastDividend: 2.04 }, want: 2.91 },
  { t: "percent <1 in decimal field", r: { dividendYield: 0.9, dividendPerShare: 0.45 }, p: { price: 50 }, want: 0.9 },
  { t: "ADR: DPS in reporting ccy, percent field wins", r: { dividendYield: 0.036, dividendYieldPercentage: 3.6, dividendPerShare: 11.64 }, p: { price: 38.64 }, want: 3.6 },
  { t: "no dividend", r: { dividendYield: 0, dividendPerShare: 0 }, p: { price: 220, lastDividend: 0 }, want: 0 },
];
let pass = 0;
const rows = ["| Fall | vorher | nachher |", "|---|---|---|"];
for (const c of cases) {
  const before = +oldFetcher(c.r, c.p).toFixed(2);
  const after = newFetcher(c.r, c.p);
  assert.equal(after, c.want, c.t); pass++;
  rows.push(`| ${c.t} | ${before}% | ${after}% |`);
}
console.log(rows.join("\n"));
const src = readFileSync("server/fmp-fetcher.ts", "utf8");
assert.match(src, /import \{ normalizeDividendYieldPct \} from "\.\/dividend-yield-normalize";/); pass++;
assert.match(src, /const dividendYield = normalizeDividendYieldPct\(\{/); pass++;
assert.doesNotMatch(src, /ratiosLatest\.dividendYield \* 100/, "old ×100 path gone"); pass++;
console.log(`test-fmp-fetcher-dividend: ${pass}/${pass} OK`);
