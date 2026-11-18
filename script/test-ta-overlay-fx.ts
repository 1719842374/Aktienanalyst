/**
 * TA-Overlay: Nicht-USD-Berichtswährung vor dem Verhältnis zum USD-Kurs.
 * NVO-ADR: EPS in DKK, Kurs schon USD (currencyInfo.converted false).
 * Fixture, kein Live-Abruf.
 *
 * Ausführen: npx tsx script/test-ta-overlay-fx.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildBiasDecision } from "../shared/bias-fixes";
import {
  earningsYieldFromTtm,
  joinFundamentalsOntoPrices,
  priceFxForOverlay,
  type EpsQuarter,
} from "../shared/earnings-yield-roic";
import { loadEarningsYield, resetFundamentalCacheForTests } from "../server/earnings-yield-roic-route";

const nvoQuarters: EpsQuarter[] = [
  { periodEnd: "2025-09-30", asOf: "2025-11-05", eps: 5, currency: "DKK" },
  { periodEnd: "2025-12-31", asOf: "2026-02-04", eps: 5, currency: "DKK" },
  { periodEnd: "2026-03-31", asOf: "2026-05-06", eps: 5, currency: "DKK" },
  { periodEnd: "2026-06-30", asOf: "2026-08-05", eps: 5, currency: "DKK" },
];
const dkkUsd = [{ date: "2026-08-11", rate: 0.146, source: "Yahoo DKKUSD=X" }];
const nvoFx = priceFxForOverlay({
  priceCurrency: "USD",
  statementCurrency: "DKK",
  fxHistory: dkkUsd,
  listing: { converted: false, reportedCurrency: "USD", tradingCurrency: "USD", fxRate: 1 },
});

const nvo = joinFundamentalsOntoPrices(["2026-08-12"], {
  earningsYield: null,
  epsQuarters: nvoQuarters,
  priceCurrency: "USD",
  priceFx: nvoFx,
  roic: null,
  peerRoic: null,
  peerBars: null,
  subjectCloses: [50],
  showEarningsYield: true,
  showRoic: false,
  showPeerRoic: false,
  showPeerPrice: false,
});
const nvoYield = (20 * 0.146 / 50) * 100;
assert.equal(nvoFx?.rate, 0, "USD-ADR skaliert den Kurs nicht noch einmal");
assert.ok(nvo[0].earningsYieldPct != null && Math.abs(nvo[0].earningsYieldPct - nvoYield) < 1e-9, String(nvo[0].earningsYieldPct));
assert.match(nvo[0].earningsYieldNote ?? "", /umgerechnet DKK→USD/);
assert.match(nvo[0].earningsYieldNote ?? "", /0\.146/);
assert.match(nvo[0].earningsYieldNote ?? "", /2026-08-11/);
assert.match(nvo[0].earningsYieldNote ?? "", /Quelle/);

const msft = earningsYieldFromTtm(4, 98.5, "USD", "USD");
assert.equal(msft.value, (4 / 98.5) * 100);
assert.equal(msft.note, null);
assert.equal(priceFxForOverlay({
  priceCurrency: "USD",
  statementCurrency: "USD",
  fxHistory: dkkUsd,
  listing: null,
}), null);

const missing = earningsYieldFromTtm(20, 50, "DKK", "USD");
assert.equal(missing.value, null);
assert.match(missing.note ?? "", /FX DKKUSD fehlt/);
assert.match(missing.note ?? "", /kein Faktor 1/);

const factorOne = earningsYieldFromTtm(20, 50, "DKK", "USD", {
  from: "DKK",
  to: "USD",
  rate: 0,
  history: [{ date: "2026-08-11", rate: 1, source: "Yahoo DKKUSD=X" }],
  asOf: "2026-08-12",
});
assert.equal(factorOne.value, null);
assert.match(factorOne.note ?? "", /kein Faktor 1/);

const late = earningsYieldFromTtm(20, 50, "DKK", "USD", {
  from: "DKK",
  to: "USD",
  rate: 0,
  history: [{ date: "2026-08-13", rate: 0.146, source: "Yahoo DKKUSD=X" }],
  asOf: "2026-08-12",
});
assert.equal(late.value, null);
assert.match(late.note ?? "", /kein DKKUSD bis 2026-08-12/);
assert.match(late.note ?? "", /kein Faktor 1/);

const listing = priceFxForOverlay({
  priceCurrency: "USD",
  statementCurrency: "EUR",
  fxHistory: [{ date: "2023-09-29", rate: 1.05, source: "Yahoo EURUSD=X" }],
  listing: { converted: true, reportedCurrency: "EUR", tradingCurrency: "USD", fxRate: 1.12016 },
});
const listed = earningsYieldFromTtm(4.55, 100 * 1.12016, "EUR", "USD", { ...listing!, asOf: "2023-09-30" });
assert.ok(listed.value != null && Math.abs(listed.value - 4.55) < 1e-9, String(listed.value));
assert.match(listed.note ?? "", /^EURUSD 1\.05 am 2023-09-29, Quelle Yahoo EURUSD=X$/);

resetFundamentalCacheForTests();
const now = Date.parse("2026-08-12T00:00:00Z");
const income = [
  { date: "2010-03-31", period: "Q1", epsDiluted: 1, reportedCurrency: "DKK", filingDate: "2010-05-01" },
  { date: "2026-06-30", period: "Q2", epsDiluted: 5, reportedCurrency: "DKK", filingDate: "2026-08-05" },
];
const deps = {
  income: async () => [],
  enterpriseValues: async () => [],
  keyMetrics: async () => [],
  incomeQuarterly: async () => income,
  yahooBundle: async () => {
    throw new Error("Yahoo-Fundamentals nicht nötig");
  },
  fxBars: async (symbol: string) => {
    assert.equal(symbol, "DKKUSD=X");
    return [{ date: "2026-08-11", open: 0.146, high: 0.146, low: 0.146, close: 0.146, volume: 0, source: "yahoo" as const }];
  },
};
const loaded = await loadEarningsYield("NVO", deps, now);
assert.equal(loaded.fxHistory?.[0]?.rate, 0.146);
assert.equal(loaded.fxHistory?.[0]?.source, "Yahoo DKKUSD=X");
assert.equal(loaded.quarters.find(row => row.currency)?.currency, "DKK");

resetFundamentalCacheForTests();
const msftLoaded = await loadEarningsYield("MSFT", {
  ...deps,
  incomeQuarterly: async () => [{ date: "2010-03-31", period: "Q1", epsDiluted: 2, reportedCurrency: "USD", filingDate: "2010-05-01" }],
  fxBars: async () => {
    throw new Error("USD holt keinen FX-Kurs");
  },
}, now);
assert.deepEqual(msftLoaded.fxHistory, []);

const chart = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
assert.match(chart, /priceFxForOverlay\(/);
assert.doesNotMatch(chart, /currencyInfo\?\.converted && eyQuery\.data\?\.fxHistory/);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(pin.MSFT.overallScore, 4.058137820476081);
const buffett = buildBiasDecision(JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8")));
assert.equal(buffett.overallScore, 5.638130012567666);

console.log("ta-overlay-fx: ok");
