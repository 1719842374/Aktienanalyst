// Pence/pound normalisation for minor-unit listings (shared/listing-units.ts). Inputs mirror live SHEL.L (11.10.2026).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { minorUnitInfo, normalizeMinorUnitListing, yahooBarsToMajor } from "../shared/listing-units";

const FIELDS = ["revenue", "netIncome", "eps", "epsDiluted", "freeCashFlow", "totalDebt", "cashAndCashEquivalents", "epsAvg"];
const GBPUSD = 1.3234;
const shel = () => ({
  quote: { price: 3793.5, yearHigh: 3806.5, yearLow: 2553.77, priceAvg50: 3600, marketCap: 209917009782, pe: 11.93 },
  profile: { currency: "GBp", price: 3793.5, mktCap: 209917009782, range: "2553.77-3806.5", lastDividend: 1.43, beta: 0.4 },
  financials: {
    income: [{ reportedCurrency: "USD", revenue: 272485350000, eps: 3.06, epsDiluted: 3.06 }],
    cashflow: [{ reportedCurrency: "USD", freeCashFlow: 22224699000 }],
    balanceSheet: [{ reportedCurrency: "USD", totalDebt: 104614097000, cashAndCashEquivalents: 30227008000 }],
  },
  analyst: { priceTarget: null, grades: [], estimates: [{ reportedCurrency: "USD", epsAvg: 6.05397 }] },
  ohlcv: [{ date: "2026-10-09", open: 3780, high: 3800, low: 3770, close: 3793.5, volume: 1e7 }],
});

assert.deepEqual(minorUnitInfo("GBp"), { minor: "GBp", major: "GBP", factor: 100 });
assert.equal(minorUnitInfo("GBP"), null);
assert.equal(minorUnitInfo("USD"), null);

const n = normalizeMinorUnitListing(shel(), GBPUSD, FIELDS);
assert.equal(n.quote.price, 37.935);
assert.equal(n.profile.currency, "GBP");
assert.equal(n.profile.mktCap, 209917009782, "market cap is already in pounds");
assert.equal(n.profile.range, "25.5377-38.065");
assert.equal(n.ohlcv[0].close, 37.935); assert.equal(n.ohlcv[0].volume, 1e7);
assert.equal(n.quote.pe, 11.93, "ratios untouched");
// shares = mktCap / price now ≈ 5.53 bn (live before: 55.3 m)
assert.ok(Math.abs(n.profile.mktCap / n.quote.price - 5.5336e9) < 1e6);
// statements USD → GBP
assert.ok(Math.abs(n.financials.balanceSheet[0].totalDebt - 104614097000 / GBPUSD) < 1);
assert.equal(n.financials.balanceSheet[0].reportedCurrency, "GBP");
assert.ok(Math.abs(n.analyst.estimates[0].epsAvg - 6.05397 / GBPUSD) < 1e-9);
// forward P/E sane: 37.935 / (6.054/1.3234) ≈ 8.3 (before 627)
assert.ok(Math.abs(n.quote.price / n.analyst.estimates[0].epsAvg - 8.29) < 0.05);
// dividend yield sane: 1.43 / 37.935 ≈ 3.8 % (before 0.04 %)
assert.ok(Math.abs(n.profile.lastDividend / n.quote.price * 100 - 3.77) < 0.01);

// No FX (fetch failed → 1): pence fix still applies, statements stay USD (no guessed FX)
const nf = normalizeMinorUnitListing(shel(), 1, FIELDS);
assert.equal(nf.quote.price, 37.935);
assert.equal(nf.financials.balanceSheet[0].totalDebt, 104614097000);
// Row whose USD conversion failed (still EUR, no _fxConverted) is not touched
const eur = shel(); eur.financials.income = [{ reportedCurrency: "EUR", revenue: 100, eps: 1, epsDiluted: 1 }];
assert.equal(normalizeMinorUnitListing(eur, GBPUSD, FIELDS).financials.income[0].revenue, 100);
// Converted EUR→USD row is treated as USD
const conv = shel(); (conv.financials.income[0] as any) = { reportedCurrency: "EUR", _fxConverted: { from: "EUR", rate: 1.1 }, revenue: 1323.4 };
assert.ok(Math.abs(normalizeMinorUnitListing(conv, GBPUSD, FIELDS).financials.income[0].revenue - 1000) < 1e-9);

// USD / GBP listings unchanged (same object)
const us = { ...shel(), profile: { currency: "USD", price: 400 } };
assert.equal(normalizeMinorUnitListing(us, GBPUSD, FIELDS), us);

// Yahoo bars
assert.equal(yahooBarsToMajor([{ open: 3780, high: 3800, low: 3770, close: 3793.5, volume: 5 }], "GBp")[0].close, 37.935);
assert.equal(yahooBarsToMajor([{ open: 1, high: 1, low: 1, close: 1 }], "USD")[0].close, 1);

// Wiring: getFmpFallbackData normalises before returning; Yahoo history too; analyze-route untouched
const helpers = readFileSync("server/analyze-helpers.ts", "utf8");
assert.match(helpers, /normalizeMinorUnitListing\(out, majorToUsd, FX_CONVERTIBLE_FIELDS\)/);
assert.match(readFileSync("server/history-fallback.ts", "utf8"), /return yahooBarsToMajor\(bars, result\.meta\?\.currency\);/);
console.log("test-listing-units: OK");
