/** Future_Work §8 Konfliktmatrix — Run: npx tsx script/test-conflict-matrix.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conflictInputsFromAnalysis, buildConflictMatrix, reverseDcfSignal, technicalSignal, trendSignal, qualitySignal, catalystSignal } from "../client/src/lib/conflictMatrix";

assert.equal(qualitySignal(72), "positiv"); assert.equal(qualitySignal(55), "neutral"); assert.equal(qualitySignal(42), "negativ"); assert.equal(qualitySignal(undefined), "n/a");
assert.equal(trendSignal(1, 2), "positiv"); assert.equal(trendSignal(-1, -2), "negativ"); assert.equal(trendSignal(1, -2), "neutral"); assert.equal(trendSignal(null, -0.5), "negativ"); assert.equal(trendSignal(null, undefined), "n/a");
assert.equal(reverseDcfSignal("realistic"), "positiv"); assert.equal(reverseDcfSignal("negativ"), "positiv"); assert.equal(reverseDcfSignal("sportlich"), "neutral"); assert.equal(reverseDcfSignal("unrealistic"), "negativ"); assert.equal(reverseDcfSignal("n/a"), "n/a");
assert.deepEqual(technicalSignal({ priceAboveMA200: true, ma50AboveMA200: true, macdAboveZero: true, macdRising: false }), { signal: "positiv", score: 3 });
assert.deepEqual(technicalSignal({ priceAboveMA200: false }), { signal: "negativ", score: 0 });
assert.equal(technicalSignal(null).signal, "n/a");
assert.equal(catalystSignal(12), "positiv"); assert.equal(catalystSignal(5), "neutral"); assert.equal(catalystSignal(1), "negativ"); assert.equal(catalystSignal(NaN), "n/a");

// Divergent case: strong quality + cheap reverse DCF, but technicals and trend broken
const m = buildConflictMatrix({
  qualityScore: 76, marginDeltaYoYPp: -1.2, relativeGrowthDeltaYoYPp: -3, reverseDcfRating: "realistic", impliedGrowth: 4.2,
  technical: { priceAboveMA200: false, ma50AboveMA200: false, macdAboveZero: false, macdRising: true }, catalystUpsidePct: 6,
});
assert.equal(m.positives, 2); assert.equal(m.negatives, 2); assert.equal(m.divergent, true);
assert.match(m.summary, /^Divergenz: Qualität \(fundamental\), Reverse DCF positiv, aber Trend \/ Delta, Technik-Regime negativ\.$/);

// All missing → nothing invented
const empty = buildConflictMatrix({ qualityScore: null, marginDeltaYoYPp: null, relativeGrowthDeltaYoYPp: null, reverseDcfRating: "n/a", impliedGrowth: 0, technical: null, catalystUpsidePct: null });
assert.ok(empty.cells.every(c => c.signal === "n/a" && c.value === "n/a")); assert.equal(empty.divergent, false); assert.equal(empty.summary, "Kein klares Signal.");

const aligned = buildConflictMatrix({ qualityScore: 80, marginDeltaYoYPp: 1, relativeGrowthDeltaYoYPp: 2, reverseDcfRating: "realistic", impliedGrowth: 3, technical: { priceAboveMA200: true, ma50AboveMA200: true, macdAboveZero: true, macdRising: true }, catalystUpsidePct: 15 });
assert.equal(aligned.summary, "Gleichgerichtet positiv (5/5)."); assert.equal(aligned.divergent, false);

// Missing gateInputs / scoring / technicalIndicators → no crash, n/a
const noGate = conflictInputsFromAnalysis({ scoring: { qualityScore: 70 } }, { rating: "sportlich", impliedGrowth: 8 }, 4);
assert.equal(noGate.marginDeltaYoYPp, undefined); assert.equal(noGate.relativeGrowthDeltaYoYPp, undefined);
const mg = buildConflictMatrix(noGate);
assert.equal(mg.cells.find(c => c.id === "trend")!.signal, "n/a"); assert.equal(mg.cells.find(c => c.id === "quality")!.signal, "positiv");
assert.equal(mg.cells.find(c => c.id === "technical")!.signal, "n/a");
assert.doesNotThrow(() => buildConflictMatrix(conflictInputsFromAnalysis({ scoring: { gateInputs: null } }, null, null)));
assert.doesNotThrow(() => buildConflictMatrix(conflictInputsFromAnalysis(undefined, undefined, undefined)));

const ui = readFileSync("client/src/components/sections/SummarySection.tsx", "utf8");
assert.ok(ui.indexOf("<ConflictMatrixPanel") < ui.indexOf("=== FAZIT"), "matrix sits above the Fazit");
assert.match(ui, /conflictInputsFromAnalysis\(data, reverseDCF, totalUpside\)/);
assert.doesNotMatch(ui, /scoring\?\.gateInputs\./, "no unguarded gateInputs chain");
assert.match(ui, /buildFazitSignal\(\{/, "Fazit rating path untouched");
console.log("test-conflict-matrix: OK");
