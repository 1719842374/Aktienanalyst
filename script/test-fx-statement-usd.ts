/**
 * USD-Umrechnung der belegten Lücken (Prod 18.11.2026, main 1c4c2e7c).
 * NVO/TSM/ASML: Umsatz schon USD, totalLiabilities und Segmente in der Berichtswährung.
 * Jahresreihe und Segment-Wachstum ebenfalls. Kurs 1 rechnet nicht.
 *
 * Ausführen: npx tsx script/test-fx-statement-usd.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applySegmentFx, convertMoneyFields, scaleSegmentationRows } from "../server/fmp";
import { labelHistoryRows } from "../server/financial-history-route";

const rate = 0.15;
const row = {
  reportedCurrency: "DKK",
  revenue: 200,
  totalLiabilities: 400,
  totalCurrentAssets: 40,
  totalCurrentLiabilities: 20,
  totalRevenue: 200,
  capitalExpenditures: -10,
  cashAndShortTermInvestments: 8,
  eps: 10,
  weightedAverageShsOut: 5,
};

const usd = convertMoneyFields(row, rate);
assert.equal(usd.revenue, 30);
assert.equal(usd.totalLiabilities, 60);
assert.equal(usd.totalCurrentAssets, 6);
assert.equal(usd.totalCurrentLiabilities, 3);
assert.equal(usd.totalCurrentAssets / usd.totalCurrentLiabilities, row.totalCurrentAssets / row.totalCurrentLiabilities);
assert.equal(usd.totalRevenue, 30);
assert.equal(usd.capitalExpenditures, -1.5);
assert.equal(usd.cashAndShortTermInvestments, 1.2);
assert.equal(usd.eps, 1.5);
assert.equal(usd.weightedAverageShsOut, 5);
assert.equal(usd.reportedCurrency, "DKK");

const untouched = convertMoneyFields(row, 1);
assert.equal(untouched.totalLiabilities, 400);
assert.equal(untouched.revenue, 200);
assert.equal(untouched, row);

const segments = [{
  name: "North America",
  revenue: 1000,
  prevRevenue: 800,
  percentage: 63.4,
  growth: 25,
  date: "2025-12-31",
  reportedCurrency: "DKK",
}];
const scaled = applySegmentFx(segments, rate, "DKK");
assert.equal(scaled[0].revenue, 150);
assert.equal(scaled[0].prevRevenue, 120);
assert.equal(scaled[0].percentage, 63.4);
assert.equal(scaled[0].growth, 25);
assert.equal(scaled[0].reportedCurrency, "USD");
assert.equal(scaled[0].fxFrom, "DKK");
assert.equal(scaled[0].fxRate, rate);

const missing = applySegmentFx(segments, 1, "dkk");
assert.equal(missing[0].revenue, 1000);
assert.equal(missing[0].reportedCurrency, "DKK");
assert.match(missing[0].fxNaReason ?? "", /kein Faktor 1/);
assert.equal(missing[0].fxRate, undefined);

const raw = scaleSegmentationRows([
  { reportedCurrency: "EUR", date: "2025-12-31", data: { China: 100, Taiwan: 50 } },
], 2);
const data = (raw[0] as { data: { China: number; Taiwan: number }; reportedCurrency: string }).data;
assert.equal(data.China, 200);
assert.equal(data.Taiwan, 100);
assert.equal((raw[0] as { reportedCurrency: string }).reportedCurrency, "EUR");
assert.equal(scaleSegmentationRows(raw, 1), raw);

const labeled = labelHistoryRows([
  { reportedCurrency: "DKK", revenue: 30, totalLiabilities: 60, _fxConverted: { from: "DKK", rate } },
]);
assert.equal((labeled.rows[0] as { reportedCurrency: string }).reportedCurrency, "USD");
assert.equal((labeled.rows[0] as { revenue: number }).revenue, 30);
assert.match(labeled.note ?? "", /umgerechnet aus DKK @ 0\.15/);

const blanked = labelHistoryRows([{ reportedCurrency: "TWD", revenue: 9, totalLiabilities: 12 }]);
assert.equal((blanked.rows[0] as { revenue: number | null }).revenue, null);
assert.equal((blanked.rows[0] as { totalLiabilities: number | null }).totalLiabilities, null);
assert.match(blanked.note ?? "", /FX TWDUSD fehlt, kein Faktor 1/);

const usdRows = labelHistoryRows([{ reportedCurrency: "USD", revenue: 266 }]);
assert.equal(usdRows.note, null);
assert.equal((usdRows.rows[0] as { revenue: number }).revenue, 266);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(pin.VWAGY.overallScore, 4.735717539863326);
assert.equal(pin.SAP.overallScore, 5.1747584412891205);
assert.equal(pin.MSFT.overallScore, 4.058137820476081);

console.log("fx-statement-usd: ok");
