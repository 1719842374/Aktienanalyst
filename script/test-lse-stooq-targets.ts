// JOB 21: Stooq .L history (pence → pounds via shared/listing-units) + .L analyst targets in the price unit.
// Fixtures: prices = live SHEL.L/AZN.L/ULVR.L 11.10.2026 (Yahoo GBp); targets = synthetic (FMP gives no .L consensus on the current plan).
import assert from "node:assert/strict";
import { normalizeMinorUnitListing, priceTargetToListingUnit, stooqListing } from "../shared/listing-units";
import { altSeamUnitMismatch, fetchDailyHistory, stooqFetch, type DailyBar } from "../server/history-fallback";

// Symbol mapping
assert.deepEqual(stooqListing("SHEL.L"), { stooqSymbol: "shel.uk", quoteCurrency: "GBp" });
assert.deepEqual(stooqListing("ulvr.l"), { stooqSymbol: "ulvr.uk", quoteCurrency: "GBp" });
assert.deepEqual(stooqListing("AAPL"), { stooqSymbol: "aapl.us", quoteCurrency: null }, "unchanged");
assert.deepEqual(stooqListing("SAP.DE"), { stooqSymbol: "sap.de", quoteCurrency: null }, "unchanged");

// stooqFetch with a mocked CSV (Stooq LSE quotes in pence)
const realFetch = globalThis.fetch;
let lastUrl = "";
globalThis.fetch = (async (url: any) => { lastUrl = String(url); return new Response(lastUrl.includes("shel.uk")
  ? "Date,Open,High,Low,Close,Volume\n2015-01-02,2150,2170,2140,2160.5,100\n2015-01-05,2160,2180,2150,2175,200\n"
  : "Date,Open,High,Low,Close,Volume\n2015-01-02,110,111,109,110.5,100\n", { status: 200 }); }) as any;
const shel = await stooqFetch("SHEL.L", "2015-01-01", "2015-12-31");
assert.match(lastUrl, /s=shel\.uk&/);
assert.equal(shel.length, 2); assert.equal(shel[0].close, 21.605); assert.equal(shel[0].open, 21.5); assert.equal(shel[0].volume, 100, "volume untouched");
assert.equal(shel[0].source, "stooq");
const aapl = await stooqFetch("AAPL", "2015-01-01", "2015-12-31");
assert.match(lastUrl, /s=aapl\.us&/); assert.equal(aapl[0].close, 110.5, "US unchanged");
globalThis.fetch = realFetch;

// Seam guard: pence alt left of pound FMP is dropped, pound alt is merged
const fmp: DailyBar[] = [{ date: "2020-01-02", open: 23, high: 23, low: 23, close: 23, volume: 1, source: "fmp" }];
const pence: DailyBar[] = [{ date: "2019-12-31", open: 2300, high: 2300, low: 2300, close: 2300, volume: 1, source: "stooq" }];
const pounds: DailyBar[] = [{ date: "2019-12-31", open: 22.8, high: 22.8, low: 22.8, close: 22.8, volume: 1, source: "stooq" }];
assert.equal(altSeamUnitMismatch(fmp, pence), true);
assert.equal(altSeamUnitMismatch(fmp, pounds), false);
assert.equal(altSeamUnitMismatch([], pence), false);
const dropped = await fetchDailyHistory({ symbol: "SHEL.L", timeframe: "10Y", fmpFetch: async () => fmp.slice(), altFetch: async () => pence });
assert.equal(dropped.bars.length, 1); assert.equal(dropped.source, "fmp"); assert.equal(dropped.truncated, true);
const merged = await fetchDailyHistory({ symbol: "SHEL.L", timeframe: "10Y", fmpFetch: async () => fmp.slice(), altFetch: async () => pounds });
assert.equal(merged.bars.length, 2); assert.equal(merged.source, "fmp+alt");

// Analyst targets in the price unit
assert.deepEqual(priceTargetToListingUnit({ targetHigh: 4200, targetLow: 3000, targetConsensus: 3650, targetMedian: 3600 }, 37.935, 100),
  { targetHigh: 42, targetLow: 30, targetConsensus: 36.5, targetMedian: 36, _unit: { ensured: true, scale: 0.01 } }, "pence → pounds");
assert.deepEqual(priceTargetToListingUnit({ targetHigh: 42, targetLow: 30, targetConsensus: 36.5, targetMedian: 36 }, 37.935, 100),
  { targetHigh: 42, targetLow: 30, targetConsensus: 36.5, targetMedian: 36, _unit: { ensured: true, scale: 1 } }, "already pounds");
const amb = priceTargetToListingUnit({ targetHigh: 9e6, targetMedian: 9e6 }, 37.935, 100);
assert.equal(amb.targetMedian, null); assert.equal(amb.targetHigh, null); assert.equal(amb._unit.ensured, false, "implausible → n/a");
assert.equal(priceTargetToListingUnit({ targetMedian: 3600 }, undefined, 100).targetMedian, null, "no price → n/a");
assert.equal(priceTargetToListingUnit(null, 37.9, 100), null);
const empty = { symbol: "SHEL.L", targetHigh: 0, targetLow: 0, targetConsensus: 0, targetMedian: 0 };
assert.equal(priceTargetToListingUnit(empty, 37.9, 100), empty, "no target → unchanged (n/a as before)");

// Wired in normalizeMinorUnitListing
const base = (pt: any) => ({ quote: { price: 11998 }, profile: { currency: "GBp", price: 11998 }, financials: { income: [], cashflow: [], balanceSheet: [] }, analyst: { priceTarget: pt, grades: [], estimates: [] }, ohlcv: [] });
const n = normalizeMinorUnitListing(base({ targetMedian: 13000, targetHigh: 15000, targetLow: 10000 }), 1.3234, []);
assert.equal(n.quote.price, 119.98); assert.equal(n.analyst.priceTarget.targetMedian, 130); assert.equal(n.analyst.priceTarget.targetLow, 100);
const partial = normalizeMinorUnitListing(base({ targetMedian: 13000 }), null, []);
assert.equal(partial.analyst.priceTarget.targetMedian, 13000, "FX missing → untouched like everything else");
const us = { ...base({ targetMedian: 500 }), profile: { currency: "USD", price: 400 } };
assert.equal(normalizeMinorUnitListing(us, 1.3, []), us);
console.log("test-lse-stooq-targets: OK");
