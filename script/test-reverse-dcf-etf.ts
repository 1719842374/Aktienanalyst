/** Auftrag 9: Reverse DCF n/a for ETFs/funds. FIXTURES (not live). Run: npx tsx script/test-reverse-dcf-etf.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { conflictMatrixFromAnalysis, reverseDcfFromAnalysis, conflictInputsFromAnalysis, buildConflictMatrix, isEtfOrFund } from "../shared/conflict-matrix";
import { renderConflictMatrixHtml } from "../server/pdf-conflict-matrix";
import { calculateReverseDCF } from "../shared/valuation-signal";

const base = (o: any) => ({
  currentPrice: 100, beta5Y: 1, totalDebt: 0, cashEquivalents: 0, marketCap: 500e9, revenue: 0, ebitda: 0, operatingIncome: 0,
  sharesOutstanding: 5e9, epsTTM: 25, fcfTTM: 12e9, fcfHaircut: 0, governmentExposure: 0, peRatio: 25, epsGrowth5Y: 5, lynchClass: "stalwart",
  historicalPrices: [], financialStatements: { cashFlow: { operatingCashFlow: 12e9, capex: 0, fcf: 12e9, fcfMargin: 0 } },
  sectorProfile: { sector: "Financial Services", waccScenarios: { kons: 10.5, avg: 9, opt: 7.5 }, growthAssumptions: { g1: 5, g2: 4, terminal: 2.5 } },
  scoring: { qualityScore: 68, gateInputs: { marginDeltaYoYPp: 1, relativeGrowthDeltaYoYPp: 1 } },
  technicalIndicators: { currentStatus: { priceAboveMA200: true, ma50AboveMA200: true, macdAboveZero: true, macdRising: false } },
  catalysts: [],
  ...o,
});
const SPY = base({ ticker: "SPY", companyName: "SPDR S&P 500 ETF Trust", isEtf: true, isFund: false, currentPrice: 660, sharesOutstanding: 1e9, fcfTTM: 0 });
const MSFT = base({ ticker: "MSFT", companyName: "Microsoft", isEtf: false, isFund: false, currentPrice: 510, sharesOutstanding: 7.43e9, fcfTTM: 70e9, epsGrowth5Y: 14, revenue: 280e9, ebitda: 150e9, operatingIncome: 120e9 });

const before = (d: any) => reverseDcfFromAnalysis({ ...d, isEtf: undefined, isFund: undefined });
const rows: string[] = ["| Fixture | vorher g* | nachher g* | Matrix-Zelle nachher |", "|---|---|---|---|"];
for (const d of [SPY, MSFT]) {
  const b = before(d)!, a = reverseDcfFromAnalysis(d)!;
  const cell = conflictMatrixFromAnalysis(d).cells.find(c => c.id === "reverseDcf")!;
  rows.push(`| ${d.ticker} (isEtf ${d.isEtf}) | ${b.rating === "n/a" ? "n/a" : `${b.impliedGrowth.toFixed(1)}% ${b.rating}`} | ${a.rating === "n/a" ? "n/a" : `${a.impliedGrowth.toFixed(1)}% ${a.rating}`} | ${cell.signal} / ${cell.value} |`);
}
console.log(rows.join("\n"));

// SPY → n/a everywhere
assert.equal(reverseDcfFromAnalysis(SPY)!.rating, "n/a");
const spyCell = conflictMatrixFromAnalysis(SPY).cells.find(c => c.id === "reverseDcf")!;
assert.equal(spyCell.signal, "n/a"); assert.equal(spyCell.value, "n/a — ETF/Fonds, Reverse DCF nicht anwendbar");
// UI path: SummarySection passes its own calculateReverseDCF result → still n/a for ETF
const uiRdcf = calculateReverseDCF({ currentPrice: 660, fcfBase: 30e9, wacc: 9, sharesOutstanding: 1e9, netDebt: 0, sectorG1: 5 });
assert.notEqual(uiRdcf.rating, "n/a");
assert.equal(buildConflictMatrix(conflictInputsFromAnalysis(SPY, uiRdcf, 0)).cells.find(c => c.id === "reverseDcf")!.signal, "n/a");
assert.equal(isEtfOrFund({ isFund: true }), true);
assert.equal(reverseDcfFromAnalysis(base({ isFund: true }))!.rating, "n/a");

// MSFT unchanged
assert.deepEqual(reverseDcfFromAnalysis(MSFT), before(MSFT));
assert.notEqual(reverseDcfFromAnalysis(MSFT)!.rating, "n/a");
// Old cache entry without the flag keeps g*
assert.equal(isEtfOrFund({}), false);

// Other cells, counts besides reverseDcf unchanged (score/rating untouched)
const strip = (d: any) => conflictMatrixFromAnalysis(d).cells.filter(c => c.id !== "reverseDcf");
assert.deepEqual(strip(SPY), strip({ ...SPY, isEtf: undefined }));
assert.match(renderConflictMatrixHtml(conflictMatrixFromAnalysis(SPY)), /Reverse DCF<\/div>\s*<div[^>]*>– n\/a/);

// Exact minimal edits in the unlocked files
const route = readFileSync("server/analyze-route.ts", "utf8");
assert.match(route, /isEtf: profile\?\.isEtf === true,\n\s+isFund: profile\?\.isFund === true,/);
const schema = readFileSync("shared/schema.ts", "utf8");
assert.match(schema, /revenueSegmentsMessage\?: string;\n  isEtf\?: boolean;\n  isFund\?: boolean;\n\}/);
const pdf = readFileSync("server/pdf-export.ts", "utf8");
assert.match(pdf, /ETF\/Fonds — Reverse DCF nicht anwendbar/);
assert.match(pdf, /const fazit = buildFazit\(data(, fazitEntry)?\);/);
// Summary table row "Reverse DCF g*": n/a for ETF/Fonds, like the matrix and PDF section 14
const ui = readFileSync("client/src/components/sections/SummarySection.tsx", "utf8");
assert.match(ui, /value=\{isEtfOrFund\(data\) \? "n\/a" : formatPercentNoSign\(reverseDCF\.impliedGrowth\)\}/);
assert.match(ui, /note=\{isEtfOrFund\(data\) \? "ETF\/Fonds — Reverse DCF nicht anwendbar" :/);
assert.match(ui, /import \{ buildConflictMatrix, conflictInputsFromAnalysis, isEtfOrFund \} from "..\/..\/lib\/conflictMatrix";/);
console.log("test-reverse-dcf-etf: OK");
