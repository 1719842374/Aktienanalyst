/**
 * FMP-Proxy des Hype-Cycles. Keine Trends-Quelle.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-hype-cycle-proxy.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { assessHypeCycle, HYPE_WEIGHTS, HYPE_HISTORY_YEARS } = await import("../shared/hype-cycle.ts");
const series = (last: number) => [10, 10, 10, 10, last];
const hype = assessHypeCycle([
  { ticker: "A", peByYear: series(10), capexIntensityByYear: series(0.2), epsEstimate: [1, 1] },
  { ticker: "B", peByYear: series(20), capexIntensityByYear: series(0.4), epsEstimate: [1, 1.2] },
]);
for (const c of hype.companies) {
  const news = c.signals.find(s => s.id === "newsVolume");
  assert.equal(news?.gap, null);
  assert.match(news?.reason ?? "", /nicht abgefragt/);
  assert.ok(c.weightUsed < 1);
}
assert.equal(HYPE_HISTORY_YEARS, 5);
assert.ok(Math.abs(HYPE_WEIGHTS.valuationVsHistory + HYPE_WEIGHTS.capexMaterial + HYPE_WEIGHTS.analystRevisions - 0.55) < 1e-9);
const src = readFileSync("server/hype-cycle-route.ts", "utf8") + readFileSync("shared/hype-cycle.ts", "utf8");
assert.doesNotMatch(src, /serpapi|trends\.google/i);
assert.match(readFileSync("client/src/components/valuechain/HypeCyclePanel.tsx", "utf8"), /FMP-Proxy/);
const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");
console.log("hype proxy: OK");
