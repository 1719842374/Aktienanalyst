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

// No FX (fetch failed → 1 / NaN / null): NO conversion at all — price, OHLCV, statements exactly as before, flagged partial
for (const bad of [1, NaN, null, undefined, 0, -1]) {
  const raw = shel();
  const nf = normalizeMinorUnitListing(raw, bad as any, FIELDS);
  assert.equal(nf.quote.price, 3793.5, `fx=${bad}: price unchanged (pence)`);
  assert.equal(nf.ohlcv[0].close, 3793.5);
  assert.equal(nf.profile.currency, "GBp", "currency unchanged");
  assert.equal(nf.financials.balanceSheet[0].totalDebt, 104614097000, "statements unchanged (USD)");
  assert.equal(nf.analyst.estimates[0].epsAvg, 6.05397);
  assert.deepEqual(nf.profile._minorUnit, { from: "GBp", factor: 100, partial: true, warning: "FX GBPUSD fehlt" });
}
assert.equal(n.profile._minorUnit.partial, false);
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
// Dividends of a pence listing → pounds (FMP .L amounts are pence; price is pounds after normalisation)
import { dividendsToMajor } from "../shared/listing-units";
import { loadDividendHistory } from "../server/dividend-route";
assert.deepEqual(dividendsToMajor([{ date: "2026-08-13", amount: 28.92 }], "GBp"), { events: [{ date: "2026-08-13", amount: 0.2892 }], currency: "GBP" });
assert.equal(dividendsToMajor([{ date: "x", amount: 1 }], "USD"), null);
const shelDiv = await loadDividendHistory("SHEL.L", { fmp: async () => [{ date: "2026-08-13", dividend: 28.92 }, { date: "2026-05-21", dividend: 29.18 }], yahoo: async () => [] as any, listingCurrency: async () => "GBp" });
assert.equal(shelDiv.currency, "GBP"); assert.equal(shelDiv.events.find(e => e.date === "2026-08-13")!.amount, 0.2892);
const koDiv = await loadDividendHistory("KO", { fmp: async () => [{ date: "2026-09-15", dividend: 0.53 }], yahoo: async () => [] as any, listingCurrency: async () => { throw new Error("must not be called for US tickers"); } });
assert.equal(koDiv.events[0].amount, 0.53);
const yDiv = await loadDividendHistory("AZN.L", { fmp: async () => [], yahoo: async () => Object.assign([{ date: "2026-08-06", amount: 79.5 }], { currency: "GBP", rawCurrency: "GBp" }) as any, listingCurrency: async () => null });
assert.equal(yDiv.currency, "GBP"); assert.equal(yDiv.events[0].amount, 0.795);
// UI warning + cache invalidation wiring
import { listingFxWarning } from "../shared/listing-units";
assert.equal(listingFxWarning("GBp"), "FX GBPUSD fehlt – Werte unkonvertiert (Kurs in GBp, Bilanz in USD)");
assert.equal(listingFxWarning("GBP"), null); assert.equal(listingFxWarning("USD"), null); assert.equal(listingFxWarning(undefined), null);
const s1 = readFileSync("client/src/components/sections/Section1.tsx", "utf8");
assert.match(s1, /\{listingFxWarning\(data\.currency\) && \([\s\S]{0,300}data-testid="fx-partial-warning"/);
assert.match(readFileSync("server/analyze-route.ts", "utf8"), /currency: reportedCurrency \|\| "USD",/, "flag path: profile.currency → response.currency (route unchanged)");
const dr = readFileSync("server/dividend-route.ts", "utf8");
assert.match(dr, /const CACHE_VERSION = "v2";/); assert.match(dr, /cache\.get\(cacheKey\(ticker\)\)/); assert.match(dr, /cache\.set\(cacheKey\(ticker\),/);
assert.match(readFileSync("client/src/lib/useDividendHistory.ts", "utf8"), /queryKey: \["dividends", "v2", ticker\]/);
assert.match(readFileSync("server/disk-cache.ts", "utf8"), /if \(minorUnitInfo\(data\.currency\)\) \{/);
console.log("test-listing-units: OK");
