/**
 * DCF-FX (Philip 18.10.2026 17:20 „ja fixen alles in dollar … also umrechnen“) + Tester #252-Prod (VOW3.DE).
 * Offline: fetch gemockt, keine Prod-Dateien nötig.
 * Run: npx tsx script/test-dcf-fx.ts
 */
import { readFileSync } from "fs";
process.env.FMP_API_KEY = "test-key";
process.env.FMP_MIN_INTERVAL_MS = "0";
process.env.YAHOO_MIN_INTERVAL_MS = "0";

let failed = 0, total = 0;
function check(name: string, ok: boolean, detail = "") {
  total++;
  if (ok) console.log(`  ✅ ${name}${detail ? ` (${detail})` : ""}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const near = (a: any, b: number, eps = 1e-9) => typeof a === "number" && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let QS: "empty" | "full" = "empty";
let FMP_FX: Record<string, number> = { EURUSD: 1.1242 };
const day = 86400, now = Math.floor(Date.now() / 1000);
globalThis.fetch = (async (input: any) => {
  const url = String(typeof input === "string" ? input : input?.url ?? input);
  if (url.includes("financialmodelingprep.com")) {
    const sym = new URL(url).searchParams.get("symbol") ?? "";
    if (FMP_FX[sym]) return json([{ symbol: sym, price: FMP_FX[sym] }]);
    if (/^[A-Z]{3}USD$/.test(sym)) return json([]);
    return json({ "Error Message": "Premium Query Parameter" }, 402);
  }
  if (url.includes("yahoo.com")) {
    if (url.includes("fc.yahoo.com")) return new Response("", { status: 404, headers: { "set-cookie": "A3=t; Domain=.yahoo.com" } });
    if (url.includes("getcrumb")) return QS === "empty" ? new Response("", { status: 401 }) : new Response("crumb", { status: 200 });
    const sym = decodeURIComponent((url.match(/\/(?:chart|quoteSummary)\/([^?]+)/) ?? [])[1] ?? "");
    if (sym === "EURUSD=X") return json({ chart: { result: [{ meta: { currency: "USD", regularMarketPrice: 1.1 }, timestamp: [], indicators: { quote: [{}] } }] } });
    if (sym !== "VOW3.DE" && sym !== "XYZ.DE") return json({ chart: { result: null } }, 404);
    if (url.includes("quoteSummary")) {
      if (QS === "empty") return json({ quoteSummary: { result: null } }, 401);
      return json({ quoteSummary: { result: [{ price: { regularMarketPrice: { raw: 68.68 }, marketCap: { raw: 34.43e9 }, currency: "EUR", longName: "Volkswagen AG", exchangeName: "GER" }, summaryDetail: { trailingPE: { raw: 6.58 } }, defaultKeyStatistics: { trailingEps: { raw: 10.44 } } }] } });
    }
    const ts = Array.from({ length: 300 }, (_, i) => now - (300 - i) * day);
    const meta = sym === "XYZ.DE" ? {} : { currency: "EUR", longName: "Volkswagen AG Vz.", fullExchangeName: "XETRA", regularMarketPrice: 68.68 };
    return json({ chart: { result: [{ meta, timestamp: ts, indicators: { quote: [{ open: ts.map(() => 68.68), high: ts.map(() => 68.68), low: ts.map(() => 68.68), close: ts.map(() => 68.68), volume: ts.map(() => 1) }] } }] } });
  }
  return json({}, 404);
}) as typeof fetch;

(async () => {
  const LU = await import("../shared/listing-units");
  const { normalizeListingToUsd, normalizeMinorUnitListing, currencyFromTickerSuffix, currencyInfoFromListingFx, dividendsToUsd, scaleBarsToUsd, epsUnitFactor } = LU;
  const STMT = ["revenue", "netIncome", "eps"];

  console.log("\n=== USD-Listing: unverändert (bit-gleich) ===");
  const usd = { quote: { price: 250, marketCap: 3.7e12, eps: 7.5 }, profile: { currency: "USD", price: 250 }, ohlcv: [{ close: 250 }], financials: { income: [{ revenue: 1 }] } };
  check("USD → dasselbe Objekt", normalizeListingToUsd(usd, 1, STMT) === usd);
  const noCcy = { quote: { price: 10 }, profile: {} };
  check("ohne Währungsangabe → dasselbe Objekt (nie raten)", normalizeListingToUsd(noCcy, 1.1, STMT) === noCcy);

  console.log("\n=== RY.TO (CAD, FMP): Marktseite → USD, Statements bleiben USD ===");
  const ry = {
    quote: { price: 280.01, marketCap: 388.26e9, yearHigh: 306.38, yearLow: 200, priceAvg200: 250 },
    profile: { currency: "CAD", price: 280.01, marketCap: 388.26e9, range: "200-306.38" },
    ohlcv: { historical: [{ date: "2026-10-16", open: 279.45, high: 281.79, low: 278.75, close: 280.01, volume: 4e6 }] },
    financials: { income: [{ revenue: 97e9, eps: 9.95 }] },
    analyst: { priceTarget: { targetMedian: 300, targetHigh: 330, targetLow: 270 } },
  };
  const ryU: any = normalizeListingToUsd(ry, 0.7075, STMT);
  check("Kurs 280.01 CAD × 0.7075", near(ryU.quote.price, 280.01 * 0.7075), String(ryU.quote.price));
  check("Market Cap × 0.7075", near(ryU.quote.marketCap, 388.26e9 * 0.7075) && near(ryU.profile.marketCap, 388.26e9 * 0.7075));
  check("Historie × 0.7075, Volumen unverändert", near(ryU.ohlcv.historical[0].close, 280.01 * 0.7075) && ryU.ohlcv.historical[0].volume === 4e6);
  check("Kursziel × 0.7075", near(ryU.analyst.priceTarget.targetMedian, 300 * 0.7075));
  check("yearHigh, MA200, range umgerechnet", near(ryU.quote.yearHigh, 306.38 * 0.7075) && near(ryU.quote.priceAvg200, 250 * 0.7075) && ryU.profile.range === `${+(200 * 0.7075).toFixed(6)}-${+(306.38 * 0.7075).toFixed(6)}`);
  check("Statements unangetastet (schon USD)", ryU.financials === ry.financials);
  check("currency = USD, _listingFx converted", ryU.profile.currency === "USD" && ryU.profile._listingFx?.converted === true && ryU.profile._listingFx.rate === 0.7075);
  check("Eingabe nicht mutiert", ry.quote.price === 280.01 && ry.profile.currency === "CAD");
  const ci = currencyInfoFromListingFx(ryU.profile._listingFx)!;
  check("currencyInfo: CADUSD 0.7075 converted", ci.converted && ci.fxPair === "CADUSD" && ci.fxRate === 0.7075 && ci.tradingCurrency === "USD" && /CAD/.test(ci.note), ci.note);
  check("RSL/MA-Verhältnisse bleiben (konstanter Faktor)", near(ryU.ohlcv.historical[0].close / ryU.quote.priceAvg200, 280.01 / 250));

  console.log("\n=== SHEL.L (GBp, FMP): Pence → Pfund → USD in einem Schritt ===");
  const sh = {
    quote: { price: 3938, marketCap: 224e9 }, profile: { currency: "GBp", price: 3938 },
    ohlcv: [{ close: 3938, open: 3900, high: 3950, low: 3890 }], financials: { income: [{ revenue: 272e9 }] },
    analyst: { priceTarget: { targetMedian: 4500 } },
  };
  const shU: any = normalizeListingToUsd(sh, 1.3329, STMT);
  check("Kurs 3938 GBp → 39.38 GBP × 1.3329", near(shU.quote.price, 39.38 * 1.3329), String(shU.quote.price));
  check("Bars ÷100 × 1.3329", near(shU.ohlcv[0].close, 39.38 * 1.3329));
  check("Market Cap (FMP schon GBP) × 1.3329, nicht ÷100", near(shU.quote.marketCap, 224e9 * 1.3329));
  check("Kursziel in Pence erkannt → 45 GBP × 1.3329", near(shU.analyst.priceTarget.targetMedian, 45 * 1.3329), String(shU.analyst.priceTarget.targetMedian));
  check("Statements bleiben USD (kein #244-USD→GBP mehr)", shU.financials === sh.financials);
  check("currencyInfo nennt Pence-Faktor", /÷ 100/.test(currencyInfoFromListingFx(shU.profile._listingFx)!.note));

  console.log("\n=== FX fehlt ===");
  const eurNoFx: any = normalizeListingToUsd({ quote: { price: 68.68 }, profile: { currency: "EUR", price: 68.68 } }, 1, STMT);
  check("EUR ohne FX: Werte bleiben EUR, markiert converted:false", eurNoFx.quote.price === 68.68 && eurNoFx.profile.currency === "EUR" && eurNoFx.profile._listingFx?.converted === false);
  const ciNo = currencyInfoFromListingFx(eurNoFx.profile._listingFx)!;
  check("currencyInfo: Warnung „FX EURUSD fehlt“", ciNo.converted === false && /FX EURUSD fehlt/.test(ciNo.note), ciNo.note);
  const shNo = normalizeListingToUsd(sh, 1, STMT);
  check("GBp (FMP) ohne FX: exakt wie #244 normalizeMinorUnitListing", JSON.stringify(shNo) === JSON.stringify(normalizeMinorUnitListing(sh, 1, STMT)));
  const yL: any = normalizeListingToUsd({ quote: { price: 3938, eps: 3.38, pe: 11.65, currency: "GBp" }, profile: { currency: "GBp", price: 3938 }, ohlcv: [{ close: 39.38 }] }, 1, [], { barsInMajor: true });
  check("GBp (Yahoo) ohne FX: Kurs → 39.38 GBP, Bars (schon GBP) unverändert", near(yL.quote.price, 39.38) && yL.ohlcv[0].close === 39.38 && yL.profile.currency === "GBP" && yL.profile._listingFx.converted === false);

  console.log("\n=== Yahoo-Shape (Bars Major, Quote-EPS) ===");
  const yS: any = normalizeListingToUsd({ quote: { price: 3938, eps: 3.38, pe: 11.65, marketCap: 224e9, currency: "GBp" }, profile: { currency: "GBp", price: 3938, marketCap: 224e9 }, ohlcv: [{ close: 39.38 }] }, 1.3329, [], { barsInMajor: true });
  check("Yahoo SHEL.L: Bars × 1.3329 (nicht ÷100)", near(yS.ohlcv[0].close, 39.38 * 1.3329));
  check("Yahoo SHEL.L: EPS 3.38 ist Pfund (Kurs/EPS ≠ KGV) → × 1.3329", near(yS.quote.eps, 3.38 * 1.3329), String(yS.quote.eps));
  check("KGV bleibt (Verhältnis)", yS.quote.pe === 11.65);
  check("epsUnitFactor: EPS in Pence erkannt", epsUnitFactor({ price: 3938, eps: 338, pe: 11.65 }, 100) === 100 && epsUnitFactor({ price: 3938, eps: 3.38, pe: 11.65 }, 100) === 1);

  console.log("\n=== Börsen-Suffix ===");
  check(".DE→EUR .L→GBp .TO→CAD, US/unbekannt → null", currencyFromTickerSuffix("VOW3.DE") === "EUR" && currencyFromTickerSuffix("BP.L") === "GBp" && currencyFromTickerSuffix("RY.TO") === "CAD" && currencyFromTickerSuffix("AAPL") === null && currencyFromTickerSuffix("X.QQ") === null);

  console.log("\n=== Dividenden & Alt-Historie ===");
  const dv = dividendsToUsd([{ date: "2026-01-01", amount: 1.54 }], "CAD", 0.7075)!;
  check("Dividende CAD × 0.7075 → USD", dv.currency === "USD" && near(dv.events[0].amount, 1.54 * 0.7075));
  check("Dividende USD / ohne FX / Minor → null", dividendsToUsd([{ date: "x", amount: 1 }], "USD", 1) === null && dividendsToUsd([{ date: "x", amount: 1 }], "EUR", 1) === null && dividendsToUsd([{ date: "x", amount: 1 }], "GBp", 1.3) === null);
  check("Alt-Bars × rate nur bei converted", near(scaleBarsToUsd([{ close: 10, volume: 5 }], { from: "EUR", major: "EUR", factor: 1, rate: 1.1, converted: true })[0].close, 11) && scaleBarsToUsd([{ close: 10 }], null)[0].close === 10);
  const { loadDividendHistory } = await import("../server/dividend-route");
  const divRes = await loadDividendHistory("RY.TO", { fmp: async () => [{ date: "2026-07-24", dividend: 1.54, adjDividend: 1.54 }], yahoo: async () => Object.assign([], { currency: null }), listingCurrency: async () => "CAD", fxToUsd: async () => 0.7075 });
  check("loadDividendHistory RY.TO: Beträge USD", divRes.currency === "USD" && near(divRes.events[0]?.amount, 1.54 * 0.7075), JSON.stringify(divRes).slice(0, 160));
  const divOld = await loadDividendHistory("RY.TO", { fmp: async () => [{ date: "2026-07-24", dividend: 1.54, adjDividend: 1.54 }], yahoo: async () => Object.assign([], { currency: null }), listingCurrency: async () => "CAD" });
  check("ohne fxToUsd-Dep: Verhalten wie bisher", divOld.events[0]?.amount === 1.54);

  console.log("\n=== Disk-Cache: gezielt verwerfen ===");
  const { isPreDcfFxEntry } = await import("../server/disk-cache");
  check("RY.TO CAD ohne currencyInfo → verwerfen", isPreDcfFxEntry("RY.TO", { currency: "CAD" }) === true);
  check("VOW3.DE Yahoo „USD“ ohne currencyInfo → verwerfen", isPreDcfFxEntry("VOW3.DE", { currency: "USD", dataSource: "yahoo" }) === true);
  check("AAPL/NVO USD → behalten", isPreDcfFxEntry("AAPL", { currency: "USD", dataSource: "fmp" }) === false && isPreDcfFxEntry("NVO", { currency: "USD" }) === false);
  check("umgerechnet → behalten, FX fehlte → neu versuchen", isPreDcfFxEntry("RY.TO", { currency: "USD", currencyInfo: { converted: true } }) === false && isPreDcfFxEntry("RY.TO", { currency: "CAD", currencyInfo: { converted: false } }) === true);

  console.log("\n=== Yahoo-Fallback, quoteSummary LEER (Prod-Fall VOW3.DE) ===");
  const { yahooFallbackData } = await import("../server/analyze-helpers");
  const Y = await import("../server/yahoo-fetcher");
  QS = "empty"; Y.clearYahooCache?.();
  const ye: any = await yahooFallbackData("VOW3.DE");
  check("Snapshot da (Kurs aus Chart)", !!ye && ye.source === "yahoo");
  check("Market Cap / KGV / EPS = null (nicht 0)", ye.quote.marketCap == null && ye.quote.pe == null && ye.quote.eps == null, JSON.stringify({ mc: ye.quote.marketCap, pe: ye.quote.pe, eps: ye.quote.eps }));
  check("Währung aus Chart-Meta (EUR) → nach USD (FMP-FX 1.1242)", ye.profile._listingFx?.from === "EUR" && ye.profile.currency === "USD" && near(ye.quote.price, 68.68 * 1.1242, 1e-6), `${ye.profile._listingFx?.from} ${ye.quote.price}`);
  check("Name aus Chart-Meta", ye.profile.companyName === "Volkswagen AG Vz.", ye.profile.companyName);
  check("Bars × 1.1242", near(ye.ohlcv[0].close, 68.68 * 1.1242, 1e-6));
  // getFxRateToUsd cacht EUR schon (fmp.ts) → Yahoo-FX-Ersatz direkt prüfen.
  check("Yahoo-FX-Ersatz EURUSD=X (für FMP ohne FX)", (await Y.fetchYahooFxToUsd("EUR")) === 1.1 && (await Y.fetchYahooFxToUsd("USD")) === null);
  Y.clearYahooCache?.();
  const yx: any = await yahooFallbackData("XYZ.DE");
  check("ohne Meta-Währung → Börsen-Suffix .DE = EUR (nie USD)", yx.profile._listingFx?.from === "EUR", String(yx.profile._listingFx?.from));
  check("resolveSnapshotCurrency: Kurs aus Bars + GBp → GBP", Y.resolveSnapshotCurrency({ symbol: "BP.L", qsCurrency: null, metaCurrency: "GBp", priceFromBars: true }).currency === "GBP");
  check("resolveSnapshotCurrency: nichts bekannt → null (nicht USD)", Y.resolveSnapshotCurrency({ symbol: "FOO", qsCurrency: null, metaCurrency: null, priceFromBars: true }).currency === null);

  console.log("\n=== Yahoo-Fallback, quoteSummary voll ===");
  QS = "full"; Y.clearYahooCache?.();
  const yv: any = await yahooFallbackData("VOW3.DE");
  check("MCap 34.43 Mrd EUR → USD", near(yv.quote.marketCap, 34.43e9 * 1.1242, 1e-6));
  check("EPS 10.44 EUR → USD, KGV 6.58 bleibt", near(yv.quote.eps, 10.44 * 1.1242, 1e-6) && yv.quote.pe === 6.58);

  console.log("\n=== UI-Weiche n/a ===");
  const { yahooValueMissing } = await import("../shared/data-source");
  check("Yahoo null/0 → n/a", yahooValueMissing({ dataSource: "yahoo" }, null) && yahooValueMissing({ dataSource: "yahoo" }, 0));
  check("Yahoo-Wert vorhanden → anzeigen", !yahooValueMissing({ dataSource: "yahoo" }, 6.58));
  check("FMP nie betroffen (bit-gleich)", !yahooValueMissing({ dataSource: "fmp" }, 0) && !yahooValueMissing({}, null));

  console.log("\n=== Statische Checks (Route/UI) ===");
  const route = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
  check("Route: fehlende Yahoo-Währung nicht still USD (Suffix)", /profile\?\.currency \?\? \(yahooOnly \? currencyFromTickerSuffix\(upperTicker\) : null\)/.test(route));
  check("Route: marketCap/peRatio/epsTTM/forwardPE bei Yahoo null statt 0", /marketCap: yahooOnly && !\(marketCap > 0\) \? null/.test(route) && /peRatio: yahooOnly && !\(pe > 0\) \? null/.test(route) && /epsTTM: yahooOnly && quote\?\.eps == null/.test(route) && /forwardPE: yahooOnly && !\(forwardPE > 0\) \? null/.test(route));
  check("Route: currencyInfo in der Antwort", /currencyInfo: listingCurrencyInfo/.test(route));
  check("Route: Alt-Historie auf USD", /scaleBarsToUsd\(await altFetchYahooThenStooq/.test(route));
  const s7 = readFileSync(new URL("../client/src/components/sections/Section7.tsx", import.meta.url), "utf8");
  check("S9 (Section7): Discount nur bei Fwd P/E > 0", /const isDiscount = fwdPEValid && fwdPEPremium < 0/.test(s7) && /data-testid="discount-na"/.test(s7));
  const s1 = readFileSync(new URL("../client/src/components/sections/Section1.tsx", import.meta.url), "utf8");
  check("S2 (Section1): Market Cap / P/E / EPS TTM mit n/a-Weiche", /label="Market Cap" value=\{yahooValueMissing\(data, data\.marketCap\)/.test(s1) && /label="P\/E" value=\{yNum\(data\.peRatio, 1\)\} sub/.test(s1) && /label="EPS TTM" value=\{yahooValueMissing\(data, data\.epsTTM\)/.test(s1));

  console.log(`\n${total - failed}/${total} Checks grün.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
