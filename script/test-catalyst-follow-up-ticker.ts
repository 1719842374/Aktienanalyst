/**
 * P2 #494: Enrich-Nachzug darf ein inzwischen anderes Dashboard nicht übermalen.
 * Der reqId-Guard von setData(result) bleibt. RED auf aaf4b88f, GREEN danach.
 *
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-catalyst-follow-up-ticker.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCatalystFollowUp } from "../client/src/lib/catalystEnrichFlow";
import { buildBiasDecision } from "../shared/bias-fixes";

const msftCatalysts = [{ name: "Azure", pos: 60, bruttoUpside: 10, einpreisungsgrad: 20, nettoUpside: 8, gb: 4.8, timeline: "12M" }];
const aaplCatalysts = [{ name: "iPhone", pos: 50, bruttoUpside: 8, einpreisungsgrad: 10, nettoUpside: 7.2, gb: 3.6, timeline: "12M" }];

const aapl = {
  ticker: "AAPL",
  currentPrice: 190,
  growthThesis: "Apple bleibt",
  growthThesisGeneratedAt: "2026-11-01T00:00:00.000Z",
  catalysts: aaplCatalysts,
  execSummary: { fazit: "AAPL" },
};

const msft = {
  ticker: "MSFT",
  currentPrice: 420,
  growthThesis: "alt",
  growthThesisGeneratedAt: "2026-10-01T00:00:00.000Z",
  catalysts: [{ name: "generic" }],
  execSummary: { fazit: "alt" },
};

const switched = applyCatalystFollowUp(
  aapl,
  "MSFT",
  msftCatalysts,
  "These MSFT",
  "2026-11-18T12:00:00.000Z",
  { fazit: "MSFT" },
);
assert.equal(switched, aapl, "Tickerwechsel: altes Enrich darf das neue Dashboard nicht ersetzen");
assert.equal(switched?.currentPrice, 190);
assert.equal(switched?.catalysts, aaplCatalysts);
assert.equal(switched?.growthThesis, "Apple bleibt");
assert.deepEqual(switched?.execSummary, { fazit: "AAPL" });

const same = applyCatalystFollowUp(
  msft,
  "msft",
  msftCatalysts,
  "These MSFT",
  "2026-11-18T12:00:00.000Z",
  { fazit: "MSFT" },
);
assert.notEqual(same, msft);
assert.equal(same?.ticker, "MSFT");
assert.equal(same?.currentPrice, 420);
assert.equal(same?.catalysts, msftCatalysts);
assert.equal(same?.growthThesis, "These MSFT");
assert.equal(same?.growthThesisGeneratedAt, "2026-11-18T12:00:00.000Z");
assert.equal(same?.llmMode, true);
assert.equal(same?.catalystsSource, "llm");
assert.deepEqual(same?.execSummary, { fazit: "MSFT" });

const thesisKept = applyCatalystFollowUp(msft, "MSFT", msftCatalysts);
assert.equal(thesisKept?.growthThesis, "alt");
assert.equal(thesisKept?.growthThesisGeneratedAt, "2026-10-01T00:00:00.000Z");
assert.deepEqual(thesisKept?.execSummary, { fazit: "alt" });

assert.equal(applyCatalystFollowUp(null, "MSFT", msftCatalysts), null);

const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
assert.match(dash, /applyCatalystFollowUp\(prev, data\.ticker, enriched, growthThesis, growthThesisGeneratedAt, execSummary\)/);
assert.match(dash, /if \(variables\?\.reqId !== undefined && variables\.reqId !== requestIdRef\.current\)/);
assert.match(dash, /setData\(result\);/);

const llm = readFileSync("server/llm-openrouter.ts", "utf8");
const warnLine = llm.split("\n").find((line) => line.includes("token budget exhausted"));
assert.ok(warnLine);
assert.match(warnLine, /\$\{ticker\}/);
assert.match(warnLine, /\$\{msg\.substring\(0, 300\)\}/);
assert.equal(/apiKey|Authorization|OPENROUTER_API_KEY|headers/i.test(warnLine), false);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");
const bias = buildBiasDecision(JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8")));
assert.equal(bias.overallScore.toFixed(4), "5.6381");

console.log("catalyst follow-up ticker: OK");
