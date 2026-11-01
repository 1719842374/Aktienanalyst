/**
 * g* unification: server impliedGStar (calcImpliedGStar with company) == client calculateReverseDCF (Section 16/17)
 * and both use companyDcfWaccPct == calculateFCFFDCF(buildDefaultDCFParams(data)).wacc.
 * Fixture: script/fixtures/analysis-MSFT.json (live 11.10.2026).
 * Run: npx tsx script/test-gstar-unified.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calcImpliedGStar } from "../server/catalyst-engine";
import { companyDcfWaccPct, buildDefaultDCFParams, calculateFCFFDCF, calculateReverseDCF, calculateWACC } from "../shared/valuation-signal";
import * as clientCalc from "../client/src/lib/calculations";

const d = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const nd = d.totalDebt - d.cashEquivalents;
const w = companyDcfWaccPct(d);
assert.equal(w, calculateFCFFDCF(buildDefaultDCFParams(d)).wacc, "one WACC");
assert.equal(w.toFixed(2), "10.06");
const ui = calculateReverseDCF({ currentPrice: d.currentPrice, fcfBase: d.fcfTTM, wacc: w, sharesOutstanding: d.sharesOutstanding, netDebt: nd, fcfHaircut: d.fcfHaircut ?? 0 });
const srv = calcImpliedGStar({ price: d.currentPrice, sharesOutstanding: d.sharesOutstanding, netDebt: nd, fcf: d.fcfTTM, wacc: d.wacc, company: { beta5Y: d.beta5Y, totalDebt: d.totalDebt, marketCap: d.marketCap, lynchClass: d.lynchClass } })!;
assert.equal(srv.toFixed(2), ui.impliedGrowth.toFixed(2)); assert.equal(srv.toFixed(2), "8.42");
// Sector path unchanged (calcEinpreisungsgrad)
assert.equal(calcImpliedGStar({ price: d.currentPrice, sharesOutstanding: d.sharesOutstanding, netDebt: nd, fcf: d.fcfTTM, wacc: 9 })!.toFixed(2), "7.36");
// Client re-exports the shared functions (no duplicate)
assert.equal(clientCalc.calculateWACC, calculateWACC); assert.equal(clientCalc.companyDcfWaccPct, companyDcfWaccPct);
assert.equal(calculateWACC(1, 0.04, 0.05, 0.2, 0.05, 0.21).toFixed(4), "0.0799");
// analyze-route: exactly the one line
const ar = readFileSync("server/analyze-route.ts", "utf8");
assert.match(ar, /const impliedGStar = calcImpliedGStar\(\{ price, sharesOutstanding, netDebt, fcf: fcfTTM, wacc, company: \{ beta5Y: beta, totalDebt, marketCap, lynchClass \} \}\);/);
console.log("test-gstar-unified: OK (MSFT WACC 10.06 %, g* 8.42 % server = UI)");

// ── #238 soft: PDF never prints "WACC NaN%" ──
import { pdfWaccSuffix } from "../server/pdf-export";
{
  const ok = pdfWaccSuffix({ beta5Y: 1.1, marketCap: 3e12, totalDebt: 6e10 });
  if (!/^ \(WACC \d+\.\d{2}%\)$/.test(ok)) throw new Error("WACC suffix with inputs: " + ok);
  for (const bad of [{}, { beta5Y: 1.1 }, { beta5Y: NaN, marketCap: 3e12, totalDebt: 0 }, { beta5Y: 1, marketCap: 0, totalDebt: 1 }, { beta5Y: 1, marketCap: 3e12 }, null]) {
    const s = pdfWaccSuffix(bad);
    if (s !== "" || /NaN/.test(s)) throw new Error("missing inputs must omit WACC: " + JSON.stringify(bad) + " -> " + s);
  }
  console.log("test-gstar-unified (pdf WACC guard): OK", ok);
}

// ── #238 tester soft: no "WACC NaN%" / "0.00 %" in the client either ──
import { safeCompanyDcfWaccPct, waccSuffix } from "../shared/valuation-signal";
import * as fs from "node:fs";
{
  assert.equal(safeCompanyDcfWaccPct({ beta5Y: 1.1, totalDebt: 6e10 } as any), null, "missing marketCap");
  assert.equal(safeCompanyDcfWaccPct({ beta5Y: 1.1, totalDebt: 6e10, marketCap: 0 }), null, "marketCap 0");
  assert.equal(safeCompanyDcfWaccPct({ beta5Y: NaN, totalDebt: 0, marketCap: 1e12 }), null);
  assert.equal(safeCompanyDcfWaccPct(null), null);
  assert.ok(safeCompanyDcfWaccPct({ beta5Y: 1.1, totalDebt: 6e10, marketCap: 3e12 })! > 0);
  assert.equal(waccSuffix(null), ""); assert.equal(waccSuffix(NaN), ""); assert.equal(waccSuffix(10.064), " (WACC 10.1%)");
  const sum = fs.readFileSync("client/src/components/sections/SummarySection.tsx", "utf8");
  const rdcf = fs.readFileSync("client/src/components/sections/ReverseDCFSection.tsx", "utf8");
  const att = fs.readFileSync("server/exec-summary-attach.ts", "utf8");
  assert.doesNotMatch(sum, /[^e]companyDcfWaccPct\(data\)/, "Summary uses only the guarded helper");
  assert.equal((sum.match(/safeCompanyDcfWaccPct\(data\)/g) || []).length >= 3, true);
  assert.match(rdcf, /Number\.isFinite\(dcfWacc\) \? formatPercentNoSign\(dcfWacc\) : "—"/);
  assert.match(att, /: safeCompanyDcfWaccPct\(a\),/);
  console.log("test-gstar-unified (client WACC guard): OK");
}

// ── server: calcImpliedGStar with missing company inputs → null, never NaN ──
{
  const base = { price: 400, sharesOutstanding: 7.4e9, netDebt: 0, fcf: 7e10, wacc: 9 };
  assert.equal(calcImpliedGStar({ ...base, company: { beta5Y: 1.1, totalDebt: 6e10, marketCap: NaN } }), null);
  assert.equal(calcImpliedGStar({ ...base, company: { beta5Y: NaN, totalDebt: 6e10, marketCap: 3e12 } }), null);
  assert.equal(calcImpliedGStar({ ...base, company: { beta5Y: 1.1, totalDebt: undefined as any, marketCap: 3e12 } }), null);
  assert.ok(Number.isFinite(calcImpliedGStar({ ...base, company: { beta5Y: 1.1, totalDebt: 6e10, marketCap: 3e12 } })!));
  assert.match(readFileSync("server/catalyst-engine.ts", "utf8"), /const cw = safeCompanyDcfWaccPct\(params\.company\);/);
  console.log("test-gstar-unified (server WACC guard): OK");
}
