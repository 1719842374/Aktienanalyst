/**
 * Dividend yield TTM as overlay in the TA price chart + spike handling.
 * FIXTURES: dividend events = live GET /api/dividends (aktienanalyst.onrender.com, 11.10.2026);
 * closes = Yahoo daily closes on the named dates (NVO), KO price fixed. Non-payer = empty event list.
 * Run: npx tsx script/test-dividend-price-overlay.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dividendOverlaySeries, trailingDividendYield, paymentsPerYear, specialDividendDates } from "../shared/dividends";

const NVO = [
  { date: "2023-03-24", amount: 0.80357 }, { date: "2023-08-17", amount: 0.39 },
  { date: "2024-03-22", amount: 0.92933 }, { date: "2024-08-16", amount: 0.5169 },
  { date: "2025-03-31", amount: 1.14256 }, { date: "2025-08-18", amount: 0.58432 },
  { date: "2026-03-30", amount: 1.21738 }, { date: "2026-08-17", amount: 0.57919 },
];
const KO = [{"date":"2023-06-15","amount":0.46},{"date":"2023-09-14","amount":0.46},{"date":"2023-11-30","amount":0.46},{"date":"2024-03-14","amount":0.485},{"date":"2024-06-14","amount":0.485},{"date":"2024-09-13","amount":0.485},{"date":"2024-11-29","amount":0.485},{"date":"2025-03-14","amount":0.51},{"date":"2025-06-13","amount":0.51},{"date":"2025-09-15","amount":0.51},{"date":"2025-12-01","amount":0.51},{"date":"2026-03-13","amount":0.53},{"date":"2026-06-15","amount":0.53},{"date":"2026-09-15","amount":0.53}];

// ── Spike root cause: ex-date drift, not a special dividend ──
const nvoBars = [
  { date: "2026-03-27", close: 36.0 }, { date: "2026-03-30", close: 35.29 }, { date: "2026-03-31", close: 36.75 },
  { date: "2026-08-14", close: 45.0 }, { date: "2026-08-17", close: 44.88 }, { date: "2026-08-18", close: 44.9 },
  { date: "2026-10-09", close: 38.64 },
];
const raw = trailingDividendYield(nvoBars, NVO);
assert.equal(raw[1].yieldPct, 8.34, "old line: 30.03.2026 spikes to 8.34 % (3 payments in the window)");
assert.equal(raw[1].ttmDividend, 2.9443);
assert.equal(paymentsPerYear(NVO), 2);
assert.equal(specialDividendDates(NVO).size, 0, "NVO final ≈ 2× interim is regular, not special");
const s = dividendOverlaySeries(nvoBars, NVO);
const p30 = s.points[1];
assert.equal(p30.yieldPct, 5.11, "corrected: 1.21738 + 0.58432 = 1.8017 / 35.29");
assert.equal(p30.rawYieldPct, 8.34, "raw value kept visibly");
assert.deepEqual(p30.droppedExDates, ["2025-03-31"]);
const p817 = s.points[4];
assert.equal(raw[4].yieldPct, 5.31); assert.equal(p817.rawYieldPct, 5.31); assert.deepEqual(p817.droppedExDates, ["2025-08-18"]);
assert.equal(s.points[2].rawYieldPct, null, "next day the window is regular again");
assert.equal(s.points[6].yieldPct, 4.65, "last point unchanged: 1.7966 / 38.64");
assert.equal(s.points[6].ttmDividend, 1.7966);
assert.equal(s.correctedBars, 2);

// ── KO: quarterly, 29.11.2024 boundary (5 payments) corrected, last point 2.10 / price ──
const koBars = [{ date: "2024-11-29", close: 64.0 }, { date: "2025-12-01", close: 70.0 }, { date: "2026-10-09", close: 69.86 }];
const ko = dividendOverlaySeries(koBars, KO);
assert.equal(paymentsPerYear(KO), 4);
assert.equal(trailingDividendYield(koBars, KO)[0].ttmDividend, 2.4, "raw: 5 quarterly payments");
assert.equal(ko.points[0].ttmDividend, 1.94); assert.deepEqual(ko.points[0].droppedExDates, ["2023-11-30"]);
assert.equal(ko.points[2].yieldPct, 3.01); assert.equal(ko.points[2].ttmDividend, 2.1);

// ── Special dividend: labelled and counted in full ──
const SPEC = [...KO.slice(0, 12), { date: "2026-04-01", amount: 3.0 }, ...KO.slice(12)];
const sp = dividendOverlaySeries([{ date: "2026-10-09", close: 69.86 }], SPEC);
assert.deepEqual(sp.specialExDates, ["2026-04-01"]);
assert.deepEqual(sp.points[0].specialExDates, ["2026-04-01"]);
assert.equal(sp.points[0].ttmDividend, 5.1, "special counted on top of 4 regular payments");

// ── Non-payer: no events → n/a everywhere ──
const none = dividendOverlaySeries([{ date: "2026-10-09", close: 220 }], []);
assert.equal(none.points[0].yieldPct, null); assert.equal(none.paymentsPerYear, 0);

// ── UI wiring: overlay in the price chart, pane gone, chip unchanged, KPI labelled ──
const ui = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
assert.ok(!existsSync("client/src/components/sections/DividendYieldPane.tsx"), "separate pane removed");
assert.doesNotMatch(ui, /DividendYieldPane/);
assert.match(ui, /yAxisId="div"\s+orientation="right"/);
assert.match(ui, /dataKey="_divYield"/);
assert.match(ui, /dividend=\{dividendOverlay\}/);
assert.match(ui, /data-testid="button-dividend"/);
assert.match(ui, /Div\. Yield: n\/a — keine Dividendenhistorie/);
assert.match(ui, /Dividende 12M je Aktie/);
assert.match(ui, /geglättet: roh/);
const s1 = readFileSync("client/src/components/sections/Section1.tsx", "utf8");
assert.match(s1, /<KPI label="Div\. Yield" value=\{divKpi\} sub="GJ \(FMP\)" \/>/);
console.log("test-dividend-price-overlay: OK");

// ── Opposite drift: KO 14.09.2025 window misses the 13.09.2024 payment → re-added, marked ──
const koDip = dividendOverlaySeries([{ date: "2025-09-14", close: 68 }, { date: "2025-09-16", close: 68 }], KO);
assert.equal(trailingDividendYield([{ date: "2025-09-14", close: 68 }], KO)[0].ttmDividend, 1.505, "raw: only 3 payments");
assert.deepEqual(koDip.points[0].addedExDates, ["2024-09-13"]);
assert.equal(koDip.points[0].ttmDividend, 1.99); assert.equal(koDip.points[0].rawYieldPct, 2.21);
assert.deepEqual(koDip.points[1].addedExDates, []); assert.equal(koDip.points[1].rawYieldPct, null);
// NVO 4.65 % last point untouched by the dip rule
assert.equal(dividendOverlaySeries([{ date: "2026-10-09", close: 38.64 }], NVO).points[0].yieldPct, 4.65);
console.log("test-dividend-price-overlay (dip): OK");
