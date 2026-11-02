/**
 * .DE → FMP-Symbol über Suche/Profil/ISIN/XETRA, ohne feste Ticker-Tabelle.
 * Aufruf: npx tsx script/test-fmp-listing-resolve.ts
 */
import { readFileSync } from "node:fs";
import { pickFmpListing, type FmpProfileHit, type FmpSearchHit } from "../server/fmp-listing-resolve";
import { combinePriceBars } from "../server/chart-peer-price-route";
import type { DailyBar } from "../server/history-fallback";
import { loadEarningsYield, loadRoicSeries, resetFundamentalCacheForTests } from "../server/earnings-yield-roic-route";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) {
    failures++;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    console.log(`✅ ${label}`);
  }
}

const hits: FmpSearchHit[] = [
  { symbol: "SAP.DE", name: "SAP SE", currency: "EUR", exchange: "XETRA", isin: "DE0007164600" },
  { symbol: "SAP", name: "SAP SE", currency: "USD", exchange: "NYSE", isin: null },
];
const profiles: FmpProfileHit[] = [
  { symbol: "SAP.DE", name: null, currency: null, exchange: null, isin: null, ok: false },
  { symbol: "SAP", name: "SAP SE", currency: "USD", exchange: "NYSE", isin: "DE0007164600", ok: true },
];
const sap = pickFmpListing("SAP.DE", hits, profiles);
check("SAP.DE wird über die XETRA-ISIN zu SAP aufgelöst", sap?.fmpSymbol === "SAP" && sap?.currency === "USD" && sap?.source.includes("DE0007164600") === true && sap?.source.includes("XETRA") === true, sap?.source ?? "");

const direct = pickFmpListing("SAP.DE", hits, [
  { symbol: "SAP.DE", name: "SAP SE", currency: "EUR", exchange: "XETRA", isin: "DE0007164600", ok: true },
]);
check("Lädt das XETRA-Profil, bleibt das .DE-Symbol", direct?.fmpSymbol === "SAP.DE" && direct?.currency === "EUR", direct?.source ?? "");

const clash: FmpProfileHit[] = [
  { symbol: "AAA", name: "Other", currency: "USD", exchange: "NYSE", isin: "US0000000001", ok: true },
];
check("fremde ISIN wird nicht genommen", pickFmpListing("SAP.DE", hits, clash) === null);

const named = pickFmpListing("VOW3.DE", [
  { symbol: "VOW3.DE", name: "Volkswagen AG Pref", currency: "EUR", exchange: "XETRA", isin: null },
], [
  { symbol: "VWAPY", name: "Volkswagen AG Pref", currency: "USD", exchange: "OTC", isin: null, ok: true },
  { symbol: "VOW3.DE", name: null, currency: null, exchange: null, isin: null, ok: false },
]);
check("ohne ISIN nur bei genau einem Namensgleich", named?.fmpSymbol === "VWAPY" && named?.source.includes("ISIN nicht") === true, named?.source ?? "");

const twoNames = pickFmpListing("VOW3.DE", [
  { symbol: "VOW3.DE", name: "Volkswagen AG Pref", currency: "EUR", exchange: "XETRA", isin: null },
], [
  { symbol: "VWAPY", name: "Volkswagen AG Pref", currency: "USD", exchange: "OTC", isin: null, ok: true },
  { symbol: "VWAGY", name: "Volkswagen AG Pref", currency: "USD", exchange: "OTC", isin: null, ok: true },
]);
check("zwei Namensgleiche ohne ISIN bleiben unaufgelöst", twoNames === null);

check("Auflöser importiert keine ADR-Tabelle", !readFileSync("server/fmp-listing-resolve.ts", "utf8").includes("FMP_ADR_MAP"));

const bar = (date: string, close: number, source: DailyBar["source"]): DailyBar => ({ date, open: close, high: close, low: close, close, volume: 1, source });
const mixed = combinePriceBars("2016-10-24", [bar("2021-01-04", 100, "fmp")], [bar("2016-10-24", 40, "yahoo"), bar("2021-01-04", 90, "yahoo")], "USD", "EUR");
check("FMP-USD zu kurz: Yahoo-EUR wird nicht angehängt, sondern als eigene Serie genommen", mixed.source.includes("Yahoo") && mixed.bars[0]?.date === "2016-10-24" && mixed.note?.includes("nicht mit") === true, mixed.note ?? "");
const covered = combinePriceBars("2016-10-24", [bar("2016-10-24", 40, "fmp"), bar("2026-11-02", 100, "fmp")], [], "EUR", "EUR");
check("FMP deckt Von ab: kein Yahoo nötig", covered.bars.length === 2 && covered.source.startsWith("FMP"));

resetFundamentalCacheForTests();
let yahoo = 0;
const ey = await loadEarningsYield("SAP.DE", {
  income: async () => [],
  enterpriseValues: async () => [],
  keyMetrics: async () => [],
  incomeQuarterly: async (sym) => sym === "SAP" ? [{ date: "2024-09-30", period: "Q1", epsDiluted: 1.2, filingDate: "2024-10-20" }] : [],
  search: async () => hits,
  profile: async (sym) => profiles.find(p => p.symbol === sym) ?? { symbol: sym, name: null, currency: null, exchange: null, isin: null, ok: false },
  yahooBundle: async () => {
    yahoo += 1;
    return { earningsYield: { points: [], source: "Yahoo", note: null }, roic: { points: [], source: "Yahoo", note: null }, epsQuarters: [], epsNote: "n/a — Yahoo ohne Quartal", ttmPrints: [], annualEps: [] };
  },
});
check("SAP.DE: Yahoo zuerst, fehlendes EPS kommt von FMP mit Profilwährung USD", yahoo === 1 && ey.source.includes("Yahoo") && ey.source.includes("FMP SAP") && ey.source.includes("USD") && ey.quarters[0]?.currency === "USD" && ey.quarters[0]?.eps === 1.2 && ey.quarters[0]?.source?.includes("FMP SAP") === true, ey.source);

resetFundamentalCacheForTests();
const kept = await loadEarningsYield("SAP.DE", {
  income: async () => [],
  enterpriseValues: async () => [],
  keyMetrics: async () => [],
  incomeQuarterly: async () => [{ date: "2020-03-31", period: "Q1", epsDiluted: 9, filingDate: "2020-04-20" }],
  search: async () => hits,
  profile: async (sym) => profiles.find(p => p.symbol === sym) ?? { symbol: sym, name: null, currency: null, exchange: null, isin: null, ok: false },
  yahooBundle: async () => ({
    earningsYield: { points: [], source: "Yahoo", note: null },
    roic: { points: [], source: "Yahoo", note: null },
    epsQuarters: [{ periodEnd: "2024-09-30", asOf: "2024-10-20", eps: 1.5, currency: "EUR" }],
    epsNote: null,
    ttmPrints: [],
    annualEps: [],
  }),
});
check("Yahoo-EUR bleibt, FMP-USD wird nicht dazugemischt", kept.quarters.length === 1 && kept.quarters[0]?.currency === "EUR" && kept.source.includes("nicht mit") === true, kept.source);

resetFundamentalCacheForTests();
const roic = await loadRoicSeries("SAP.DE", {
  income: async (sym) => sym === "SAP" ? [{ date: "2024-09-30", filingDate: "2024-10-20" }] : [],
  enterpriseValues: async () => [],
  keyMetrics: async (sym) => sym === "SAP" ? [{ date: "2024-09-30", returnOnInvestedCapital: 0.2 }] : [],
  search: async () => hits,
  profile: async (sym) => profiles.find(p => p.symbol === sym) ?? { symbol: sym, name: null, currency: null, exchange: null, isin: null, ok: false },
  yahooBundle: async () => {
    yahoo += 1;
    return {
      earningsYield: { points: [], source: "Yahoo", note: null },
      roic: { points: [{ date: "2023-01-30", value: 15, note: null }], source: "Yahoo ROIC", note: null },
      epsQuarters: [],
      epsNote: null,
      ttmPrints: [],
      annualEps: [],
    };
  },
});
check("ROIC: Jahresreihe wird nicht als Stufen gezeichnet", roic.points.every(p => p.date !== "2023-01-30") && (roic.note ?? "").includes("nicht als Stufen") === true && roic.source.includes("Yahoo") === true, `${roic.label} ${roic.note ?? ""} ${roic.source}`);

resetFundamentalCacheForTests();
const roicTtm = await loadRoicSeries("SAP.DE", {
  income: async () => [],
  enterpriseValues: async () => [],
  keyMetrics: async () => [],
  incomeQuarterly: async (sym) => sym === "SAP" ? [
    { date: "2024-03-31", period: "Q1", filingDate: "2024-04-25" },
    { date: "2024-06-30", period: "Q2", filingDate: "2024-07-25" },
    { date: "2024-09-30", period: "Q3", filingDate: "2024-10-25" },
    { date: "2024-12-31", period: "Q4", filingDate: "2025-01-25" },
  ] : [],
  keyMetricsQuarterly: async (sym) => sym === "SAP" ? [
    { date: "2024-03-31", returnOnInvestedCapital: 0.022 },
    { date: "2024-06-30", returnOnInvestedCapital: 0.020 },
    { date: "2024-09-30", returnOnInvestedCapital: 0.019 },
    { date: "2024-12-31", returnOnInvestedCapital: 0.019 },
  ] : [],
  search: async () => hits,
  profile: async (sym) => profiles.find(p => p.symbol === sym) ?? { symbol: sym, name: null, currency: null, exchange: null, isin: null, ok: false },
  yahooBundle: async () => ({
    earningsYield: { points: [], source: "Yahoo", note: null },
    roic: { points: [{ date: "2023-01-30", value: 15, note: null }], source: "Yahoo ROIC", note: null },
    epsQuarters: [],
    epsNote: null,
    ttmPrints: [],
    annualEps: [],
  }),
});
const ttmPoint = roicTtm.points.find(p => p.date === "2025-01-25");
check("ROIC: letzter FMP-Punkt ist die TTM-Summe und trägt dieses Label", roicTtm.label === "ROIC TTM" && ttmPoint?.value === 8 && ttmPoint.note?.includes("Formel:") === true && ttmPoint.note?.includes("FMP SAP") === true && roicTtm.points.every(p => p.date !== "2023-01-30"), `${roicTtm.label} ${ttmPoint?.value ?? "—"} ${ttmPoint?.note ?? ""}`);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead as {
  VWAGY: { overallScore: number }; SAP: { overallScore: number }; MSFT: { overallScore: number };
};
check("VOW3 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718");
check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758");
check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");

if (failures > 0) {
  console.error(`\n${failures} Fehler`);
  process.exit(1);
}
console.log("\nFMP-Listing-Auflösung ok");
