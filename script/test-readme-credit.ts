/**
 * Perplexity-Credit ist aus dem README-Footer. Score-Pins bleiben die Fixture.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-readme-credit.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const readme = readFileSync("README.md", "utf8");
assert.doesNotMatch(readme, /perplexity\.ai\/computer/);
assert.match(readme, /Erstellt von Philip Diaz Rohr/);
const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");
console.log("readme credit: OK");
