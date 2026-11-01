/**
 * Custom Screen. Fehlende Felder sind n/a, nie 0.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-screener-criteria.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { decideCustomScreen, emptyCriteria, UNDERVALUED_SCREEN_PRESET } = await import("../shared/custom-screen.ts");
const missing = decideCustomScreen(
  { marketCap: 2e9, industry: "Software", country: null, roic: null, forwardPe: 18 },
  { ...emptyCriteria(), roicMin: 10 },
);
assert.equal(missing.pass, false);
assert.match(missing.skipped[0].reason, /n\/a — ROIC fehlt/);
const pass = decideCustomScreen(
  { marketCap: 2e9, industry: "Software", country: "DE", roic: 15, forwardPe: 12 },
  { marketCapMin: 1e9, marketCapMax: null, industryIncludes: "soft", countryIncludes: "de", roicMin: 10, forwardPeMax: 20 },
);
assert.equal(pass.pass, true);
assert.equal(UNDERVALUED_SCREEN_PRESET.peMax, 30);
assert.match(readFileSync("client/src/pages/ScreenerDashboard.tsx", "utf8"), /screener-custom-criteria/);
assert.match(readFileSync("client/src/pages/Researcher.tsx", "utf8"), /custom-screen-form/);
const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");
console.log("screener criteria: OK");
