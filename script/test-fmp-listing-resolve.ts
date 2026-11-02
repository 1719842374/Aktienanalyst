/**
 * .DE → FMP-Symbol über Suche/Profil/ISIN/XETRA, ohne feste Ticker-Tabelle.
 * Aufruf: npx tsx script/test-fmp-listing-resolve.ts
 */
import { readFileSync } from "node:fs";
import { pickFmpListing, type FmpProfileHit, type FmpSearchHit } from "../server/fmp-listing-resolve";
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

resetFundamentalCacheForTests();
let yahoo = 0;
const ey = await loadEarningsYield("SAP.DE", {
  income: async () => [],
  enterpriseValues: async () => [],
  keyMetrics: async () => [],
  incomeQuarterly: async (sym) => sym === "SAP" ? [{ date: "2024-09-30", period: "Q1", epsDiluted: 1.2, filingDate: "2024-10-20" }] : [],
  search: async () => hits,
  profile: async (sym) => profiles.find(p => p.symbol === sym) ?? { symbol: sym, name: null, currency: null, exchange: null, isin: null, ok: false },
  yahooBundle: async () => { yahoo += 1; return { earningsYield: { points: [], source: "Yahoo", note: null }, roic: { points: [], source: "Yahoo", note: null }, epsQuarters: [], epsNote: null, ttmPrints: [], annualEps: [] }; },
});
check("SAP.DE EY kommt von FMP-Symbol SAP, Währung USD, ohne Yahoo", yahoo === 0 && ey.source.includes("FMP SAP") && ey.source.includes("USD") && ey.quarters[0]?.currency === "USD" && ey.quarters[0]?.eps === 1.2, ey.source);

resetFundamentalCacheForTests();
const roic = await loadRoicSeries("SAP.DE", {
  income: async (sym) => sym === "SAP" ? [{ date: "2024-09-30", filingDate: "2024-10-20" }] : [],
  enterpriseValues: async () => [],
  keyMetrics: async (sym) => sym === "SAP" ? [{ date: "2024-09-30", returnOnInvestedCapital: 0.2 }] : [],
  search: async () => hits,
  profile: async (sym) => profiles.find(p => p.symbol === sym) ?? { symbol: sym, name: null, currency: null, exchange: null, isin: null, ok: false },
  yahooBundle: async () => { yahoo += 1; throw new Error("Yahoo darf für .DE nicht laufen"); },
});
check("SAP.DE ROIC kommt vom aufgelösten FMP-Symbol und nennt die Quelle", roic.points.length === 1 && roic.points[0]?.date === "2024-10-20" && roic.source.includes("SAP") && roic.source.includes("FMP") && yahoo === 0, roic.source);

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
