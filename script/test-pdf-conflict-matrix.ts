/** Auftrag 8: Konfliktmatrix im PDF-Export. Run: npx tsx script/test-pdf-conflict-matrix.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildConflictMatrix, conflictMatrixFromAnalysis, reverseDcfFromAnalysis } from "../shared/conflict-matrix";
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

// One g* in the whole PDF: section 14 and the matrix both use reverseDcfFromAnalysis (UI formula)
const fx: any = {
  ticker: "FIX", currentPrice: 100, beta5Y: 1.4, totalDebt: 20e9, cashEquivalents: 5e9, marketCap: 80e9,
  enterpriseValue: 95e9, revenue: 50e9, ebitda: 15e9, operatingIncome: 12e9, sharesOutstanding: 1e9,
  epsTTM: 5, fcfTTM: 8e9, fcfHaircut: 0, governmentExposure: 0, peRatio: 20, epsGrowth5Y: 12, lynchClass: "stalwart",
  historicalPrices: [], financialStatements: { cashFlow: { operatingCashFlow: 10e9, capex: 2e9, fcf: 8e9, fcfMargin: 16 } },
  sectorProfile: { sector: "Technology", waccScenarios: { kons: 9.5, avg: 8, opt: 6.5 }, growthAssumptions: { g1: 10, g2: 6, terminal: 2.5 } },
};
const oldS14 = +(fx.sectorProfile.waccScenarios.avg - (fx.fcfTTM / fx.enterpriseValue) * 100).toFixed(2);
const r = reverseDcfFromAnalysis(fx)!;
assert.ok(r && r.rating !== "n/a");
const cell = conflictMatrixFromAnalysis(fx).cells.find(c => c.id === "reverseDcf")!;
assert.equal(cell.value, `g* ${r.impliedGrowth.toFixed(1)}% · ${r.rating}`, "matrix shows the same g* as section 14");
console.log(`Fixture FIX: S14 vorher g* ${oldS14}% (PDF-Näherung WACC avg − FCF/EV) · nachher S14 = Matrix g* ${r.impliedGrowth.toFixed(2)}% (${r.rating}, Ref ${r.referenceGrowth}%)`);
assert.equal(reverseDcfFromAnalysis(null), null);
assert.match(src, /const rdcf = reverseDcfFromAnalysis\(rawData\);/);
assert.match(src, /f\(rdcf\.impliedGrowth,2\)/);
assert.doesNotMatch(src, /data\.reverseDCF/, "no second reverse-DCF path left in the PDF");

console.log("test-pdf-conflict-matrix: OK");
