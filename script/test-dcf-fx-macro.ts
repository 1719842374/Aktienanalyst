// DCF-FX Befund A: Nach listingToUsd steht profile.currency auf USD. Die FX-Korrelation (GBP/USD, CAD/USD …) und
// damit overallMacroSensitivity müssen trotzdem aus der Original-Listing-Währung kommen, also identisch zu main sein.
// Run: npx tsx script/test-dcf-fx-macro.ts
import { readFileSync } from "fs";
import { normalizeListingToUsd, currencyInfoFromListingFx } from "../shared/listing-units";
import { generateMacroCorrelations } from "../server/macro-correlations";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const STMT = ["revenue"];
/** Währung, die analyze-route an generateMacroCorrelations gibt (gleiche Ausdrücke wie im Route-Code). */
const macroCcy = (norm: any) => currencyInfoFromListingFx(norm.profile?._listingFx)?.reportedCurrency ?? String(norm.profile?.currency ?? "USD");
const mc = (ccy: string, sector = "Financial Services", industry = "Banks - Diversified") =>
  generateMacroCorrelations(sector, industry, "Bank", 0.8, ccy);
const fxRows = (r: any) => r.correlations.filter((c: any) => /^[A-Z]{3}\/USD$/.test(c.name)).map((c: any) => `${c.name}:${c.strength}`);

const ry = { quote: { price: 280.01, marketCap: 388e9 }, profile: { currency: "CAD", price: 280.01 }, ohlcv: { historical: [{ close: 280.01, volume: 1 }] } };
const ryU: any = normalizeListingToUsd(ry as any, 0.7075, STMT);
check("RY.TO: Kurse in USD (#261 unverändert)", ryU.profile.currency === "USD" && ryU.profile._listingFx?.converted === true);
check("RY.TO: Makro-Währung = CAD", macroCcy(ryU) === "CAD", macroCcy(ryU));
check("RY.TO: macroCorrelations == main (CAD)", JSON.stringify(mc(macroCcy(ryU))) === JSON.stringify(mc("CAD")));
check("RY.TO: CAD/USD Stark vorhanden", fxRows(mc(macroCcy(ryU))).includes("CAD/USD:Stark"), fxRows(mc(macroCcy(ryU))).join(","));
check("Regression-Nachweis: mit USD fehlt CAD/USD", !fxRows(mc("USD")).some((x: string) => x.startsWith("CAD")));

const sh = { quote: { price: 3938, marketCap: 224e9 }, profile: { currency: "GBp", price: 3938 }, ohlcv: [{ close: 39.38 }] };
const shU: any = normalizeListingToUsd(sh as any, 1.3329, STMT, { barsInMajor: true });
check("SHEL.L: GBp → Makro-Währung GBP (Major, nicht GBp)", macroCcy(shU) === "GBP", macroCcy(shU));
check("SHEL.L: GBP/USD Stark", fxRows(mc(macroCcy(shU), "Energy", "Oil & Gas Integrated")).includes("GBP/USD:Stark"));

const eur = { quote: { price: 68.68 }, profile: { currency: "EUR", price: 68.68 } };
const eurU: any = normalizeListingToUsd(eur as any, 1.1242, STMT);
check("EUR umgerechnet: EUR/USD bleibt Stark (wie main)", JSON.stringify(mc(macroCcy(eurU))) === JSON.stringify(mc("EUR")));
const eurNo: any = normalizeListingToUsd(eur as any, null, STMT);
check("EUR ohne FX: Makro-Währung EUR", macroCcy(eurNo) === "EUR");

const usd = { quote: { price: 343.46 }, profile: { currency: "USD", price: 343.46 } };
const usdU: any = normalizeListingToUsd(usd as any, 1, STMT);
check("AAPL/USD: unverändert USD, identisch zu main", macroCcy(usdU) === "USD" && JSON.stringify(mc(macroCcy(usdU), "Technology", "Consumer Electronics")) === JSON.stringify(mc("USD", "Technology", "Consumer Electronics")));

const route = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
check("analyze-route: generateMacroCorrelations bekommt listingCurrencyInfo?.reportedCurrency ?? reportedCurrency",
  /generateMacroCorrelations\(\s*effectiveSector, effectiveIndustry, description, beta, listingCurrencyInfo\?\.reportedCurrency \?\? reportedCurrency\s*\)/.test(route));
check("analyze-route: listingCurrencyInfo = currencyInfoFromListingFx(profile._listingFx)", /const listingCurrencyInfo = currencyInfoFromListingFx\(\(profile as any\)\?\._listingFx\)/.test(route));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
