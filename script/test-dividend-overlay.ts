/** Mini-PR 7 overlay — Run: npx tsx script/test-dividend-overlay.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanDividendEvents, parseFmpDividends, parseYahooDividends, trailingDividendYield } from "../shared/dividends";
import { loadDividendHistory, normalizeDividendTicker } from "../server/dividend-route";

// FMP parser: adjDividend first, newest-first input → ascending, junk dropped
const fmp = parseFmpDividends([
  { date: "2025-11-10", adjDividend: 0.26, dividend: 0.26 },
  { date: "2025-08-11", adjDividend: 0, dividend: 0.25 },
  { date: "bad", dividend: 1 },
  { date: "2025-05-12", dividend: -1 },
]);
assert.deepEqual(fmp, [{ date: "2025-08-11", amount: 0.25 }, { date: "2025-11-10", amount: 0.26 }]);
assert.deepEqual(parseFmpDividends({ historical: [{ date: "2024-01-02", dividend: 1 }] }), [{ date: "2024-01-02", amount: 1 }]);
assert.deepEqual(parseFmpDividends(null), []);

// Yahoo parser
const y = parseYahooDividends({ chart: { result: [{ events: { dividends: {
  a: { amount: 0.5, date: Date.UTC(2024, 2, 1) / 1000 }, b: { amount: 0.5, date: Date.UTC(2024, 5, 1) / 1000 },
} } }] } });
assert.deepEqual(y.map(e => e.date), ["2024-03-01", "2024-06-01"]);
assert.deepEqual(parseYahooDividends({}), []);
assert.equal(cleanDividendEvents([{ date: "2024-01-01", amount: 1 }, { date: "2024-01-01", amount: 2 }]).length, 1);

// Trailing yield: quarterly 1.00 → 4.00 per year, close 100 → 4 %
const ev = ["2023-01-15", "2023-04-15", "2023-07-15", "2023-10-15", "2024-01-15", "2024-04-15"].map(date => ({ date, amount: 1 }));
const bars = [
  { date: "2023-06-01", close: 100 },   // < 12M of record → null
  { date: "2024-01-20", close: 100 },   // window (2023-01-20, 2024-01-20]: Apr, Jul, Oct, Jan = 4
  { date: "2024-05-01", close: 200 },   // (2023-05-01, 2024-05-01]: Jul, Oct, Jan, Apr = 4 → 2 %
  { date: "2024-06-01", close: 0 },     // no close → null
];
assert.deepEqual(trailingDividendYield(bars, ev).map(p => p.yieldPct), [null, 4, 2, null]);
assert.ok(trailingDividendYield(bars, []).every(p => p.yieldPct === null), "no events → no line");

// Route: FMP first, Yahoo only when FMP empty/fails, both empty → []
(async () => {
  let yahooCalls = 0;
  const yahoo = async () => { yahooCalls++; return [{ date: "2024-01-02", amount: 1 }]; };
  const a = await loadDividendHistory("AAPL", { fmp: async () => [{ date: "2024-02-09", dividend: 0.24 }], yahoo });
  assert.equal(a.source, "fmp"); assert.equal(yahooCalls, 0);
  const b = await loadDividendHistory("SAP.DE", { fmp: async () => { throw Object.assign(new Error("x"), { fmpStatus: 402 }); }, yahoo });
  assert.equal(b.source, "yahoo"); assert.match(b.note!, /402/);
  const c = await loadDividendHistory("TSLA", { fmp: async () => [], yahoo: async () => [] });
  assert.equal(c.source, "none"); assert.deepEqual(c.events, []);
  assert.equal(normalizeDividendTicker("sap.de"), "SAP.DE");
  assert.equal(normalizeDividendTicker("../etc"), null);
  assert.equal(normalizeDividendTicker(""), null);

  const ui = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
  assert.match(ui, /useDividendHistory\(data\.ticker, showDividend\)/, "chart enables the shared query only while the overlay is on (Section-1 KPI uses the same cached query)");
  assert.match(ui, /useState\(false\);\n\s+const dividendQuery/, "overlay default off");
  assert.ok(ui.indexOf("const dividendQuery") < ui.indexOf("if (!ti || !ohlcv"), "hook before the early return");
  const reg = readFileSync("server/routes-register.ts", "utf8");
  assert.match(reg, /registerDividendRoute\(app\)/);
  console.log("test-dividend-overlay: OK");
})();
