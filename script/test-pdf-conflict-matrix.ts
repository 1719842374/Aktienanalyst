/** Auftrag 8: Konfliktmatrix im PDF-Export. Run: npx tsx script/test-pdf-conflict-matrix.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildConflictMatrix, conflictMatrixFromAnalysis } from "../shared/conflict-matrix";
import { renderConflictMatrixHtml, conflictMatrixHtmlForAnalysis } from "../server/pdf-conflict-matrix";
import * as clientLib from "../client/src/lib/conflictMatrix";

// Client path re-exports the same functions (one rule set)
assert.equal(clientLib.buildConflictMatrix, buildConflictMatrix);

const divergent = buildConflictMatrix({
  qualityScore: 76, marginDeltaYoYPp: -1.2, relativeGrowthDeltaYoYPp: -3, reverseDcfRating: "realistic", impliedGrowth: 4.2,
  technical: { priceAboveMA200: false, ma50AboveMA200: false, macdAboveZero: false, macdRising: true }, catalystUpsidePct: 6,
});
const html = renderConflictMatrixHtml(divergent);
assert.equal((html.match(/<td /g) || []).length, 5);
assert.match(html, /⚠ Divergenz: Qualität \(fundamental\), Reverse DCF positiv, aber Trend \/ Delta, Technik-Regime negativ\./);
assert.match(html, /g\* 4\.2% · realistic/);

// Old cache entry: no scoring, no technicalIndicators, no catalysts → n/a, no crash
const bare = conflictMatrixFromAnalysis({ ticker: "X", currentPrice: 10 });
assert.equal(bare.cells.find(c => c.id === "quality")!.signal, "n/a");
assert.equal(bare.cells.find(c => c.id === "trend")!.signal, "n/a");
assert.equal(bare.cells.find(c => c.id === "technical")!.signal, "n/a");
assert.equal(bare.cells.find(c => c.id === "catalysts")!.signal, "n/a");
assert.doesNotThrow(() => conflictMatrixHtmlForAnalysis(null));
assert.doesNotThrow(() => conflictMatrixHtmlForAnalysis({ scoring: { gateInputs: null } }));

// HTML escaping of values
assert.doesNotMatch(renderConflictMatrixHtml(divergent), /<script/);

// Placement: above the FAZIT box, Fazit logic untouched
const src = readFileSync("server/pdf-export.ts", "utf8");
const at = src.indexOf("${conflictMatrixHtmlForAnalysis(rawData)}");
assert.ok(at > 0 && at < src.indexOf("<!-- FAZIT BOX -->"), "matrix sits above the FAZIT box");
assert.ok(at > src.indexOf("17 &nbsp; ZUSAMMENFASSUNG & FAZIT"), "inside section 17");
assert.match(src, /const fazit = buildFazit\(data\);/);
console.log("test-pdf-conflict-matrix: OK");
