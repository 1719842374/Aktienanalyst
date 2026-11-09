/**
 * F1-14 (Future_1_Work.md:299 „>4 % attraktiv“): green band ≥ 4 % on the TA dividend axis. Display only, no score.
 * FIXTURES: NVO events/closes as in test-dividend-price-overlay (live /api/dividends 11.10.2026, Yahoo closes);
 * KO last point 3.01 % (same file). Run: npx tsx script/test-dividend-yield-band.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attractiveYieldBand, isAttractiveDividendYield, DIV_ATTRACTIVE_YIELD_PCT, dividendOverlaySeries } from "../shared/dividends";

assert.equal(DIV_ATTRACTIVE_YIELD_PCT, 4, "Spec: >4 % attraktiv");
// Threshold
assert.equal(isAttractiveDividendYield(4), true);
assert.equal(isAttractiveDividendYield(4.65), true);
assert.equal(isAttractiveDividendYield(3.99), false);
assert.equal(isAttractiveDividendYield(3.01), false);
assert.equal(isAttractiveDividendYield(null), false, "n/a stays unmarked");
assert.equal(isAttractiveDividendYield(undefined), false);
assert.equal(isAttractiveDividendYield(NaN), false);
// Band: same axis formula as the chart, axis is never stretched
const axis = (divMax: number) => Math.max(1, Math.ceil(divMax * 1.15));
assert.deepEqual(attractiveYieldBand(axis(4.65)), { y1: 4, y2: 6 }, "NVO 4.65 % → axis 6 → band 4..6");
assert.deepEqual(attractiveYieldBand(axis(8.34)), { y1: 4, y2: 10 });
assert.equal(attractiveYieldBand(axis(3.01)), null, "KO 3.01 % → axis 4 → no band");
assert.equal(attractiveYieldBand(axis(0.8)), null, "MSFT-like <1 % → axis 1 → no band");
assert.equal(attractiveYieldBand(axis(0)), null);
assert.equal(attractiveYieldBand(NaN), null);
// Any point ≥ 4 % ⇒ axis > 4 ⇒ band visible (status hint and band consistent)
for (const y of [4, 4.01, 4.65, 5, 12]) assert.ok(attractiveYieldBand(axis(y)), `band for ${y}`);
// Real series: NVO last point 4.65 %
const NVO = [
  { date: "2023-03-24", amount: 0.80357 }, { date: "2023-08-17", amount: 0.39 },
  { date: "2024-03-22", amount: 0.92933 }, { date: "2024-08-16", amount: 0.5169 },
  { date: "2025-03-31", amount: 1.14256 }, { date: "2025-08-18", amount: 0.58432 },
  { date: "2026-03-30", amount: 1.21738 }, { date: "2026-08-17", amount: 0.57919 },
];
const nv = dividendOverlaySeries([{ date: "2026-10-09", close: 38.64 }], NVO).points[0];
assert.equal(nv.yieldPct, 4.65); assert.equal(isAttractiveDividendYield(nv.yieldPct), true);

// UI wiring (inside existing dividend block only)
const ui = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
assert.match(ui, /\{dividend && divBand && \(\s*<>\s*<ReferenceArea yAxisId="div" y1=\{divBand\.y1\} y2=\{divBand\.y2\}/);
assert.match(ui, /<ReferenceLine yAxisId="div" y=\{DIV_ATTRACTIVE_YIELD_PCT\}/);
assert.match(ui, /domain=\{\[0, divAxisMax\]\}/);
assert.ok(ui.indexOf("<ReferenceArea yAxisId=\"div\"") < ui.indexOf("dataKey=\"_divYield\""), "band drawn behind the line");
assert.match(ui, /data-testid="dividend-tooltip-attractive"/);
assert.match(ui, /data-testid="dividend-overlay-attractive"/);
assert.doesNotMatch(ui, /score[^\n]*DIV_ATTRACTIVE|DIV_ATTRACTIVE[^\n]*score/i, "no score coupling");
console.log("test-dividend-yield-band: OK");
