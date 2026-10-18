/**
 * FMP über US-/ADR-Symbole (server/fmp-adr-map.ts + analyze-helpers fmpViaAdrData + analyze-route).
 *
 * Datenquellen (alle echt, nichts geschätzt):
 *  - script/fixtures/fmp-adr-prod-2026-10-18.json: Felder aus Prod-/api/analyze (FMP über ADR), 18.10.2026 22:09–22:11 Berlin.
 *  - script/fixtures/yahoo-ts-<T>.json (aus #264): echte v8-Chart- und fundamentals-timeseries-Antworten + quoteSummaryRef.
 * FMP-Rohantworten im Fetch-Stub sind MOCKS, aufgebaut nur aus diesen Prod-Feldern (Kurs, MCap, Jahresüberschuss, EPS,
 * Kursziel); fehlende Endpunkte liefern []. Sie prüfen die Verdrahtung, nicht FMP selbst (kein FMP-Key auf der Box).
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-fmp-adr-map.ts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.YAHOO_MIN_INTERVAL_MS = "0";
process.env.FMP_API_KEY = "test-key";
process.env.FMP_MIN_INTERVAL_MS = "0";
delete process.env.OPENROUTER_API_KEY;
delete process.env.PERPLEXITY_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LEGACY_PATH = `${ROOT}/server/__analyze-helpers-legacy-adr.test-tmp.ts`;
const PROD = JSON.parse(readFileSync(`${HERE}/fixtures/fmp-adr-prod-2026-10-18.json`, "utf8"));
const YTS: Record<string, any> = {};
for (const t of ["VOW3.DE", "SAP.DE", "BMW.DE", "NESN.SW", "7203.T", "MC.PA", "ASML.AS"]) YTS[t] = JSON.parse(readFileSync(`${HERE}/fixtures/yahoo-ts-${t}.json`, "utf8"));

let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail = "") => { n++; console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` (${detail})` : ""}`); if (!ok) fail++; };
const close = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

const M = await import("../server/fmp-adr-map");

// ─── 1. Zuordnung ───────────────────────────────────────────────────────────
console.log("=== Zuordnung ===");
const expectMap: Record<string, [string, number]> = {
  "VOW3.DE": ["VWAPY", 0.1], "VOW.DE": ["VWAGY", 0.1], "SAP.DE": ["SAP", 1], "BMW.DE": ["BMWKY", 1 / 3],
  "NESN.SW": ["NSRGY", 1], "7203.T": ["TM", 10], "MC.PA": ["LVMUY", 0.2], "ASML.AS": ["ASML", 1],
};
for (const [t, [sym, r]] of Object.entries(expectMap)) {
  const c = await M.resolveAdrCandidates(t, "irrelevant", async () => { throw new Error("Suche darf nicht laufen"); });
  check(`${t} → ${sym} (1 ADR = ${+r.toFixed(4)} Aktien, Map)`, c.length === 1 && c[0].symbol === sym && close(c[0].sharesPerAdr!, r) && c[0].origin === "map");
}
check("nie BAMXF (Map + Blocklist)", !JSON.stringify(M.FMP_ADR_MAP).includes("BAMXF") && M.ADR_BLOCKLIST.has("BAMXF"));
for (const t of ["MSFT", "NVO", "TM", "AAPL"]) {
  const c = await M.resolveAdrCandidates(t, "x", async () => { throw new Error("nein"); });
  check(`${t} (US-Ticker): kein ADR-Kandidat`, c.length === 0);
}
check("direktes ADR → Ratio: TM 10, LVMUY 0,2, VWAPY 0,1; NVO/MSFT null", M.directAdrSharesPerAdr("TM") === 10 && M.directAdrSharesPerAdr("LVMUY") === 0.2 && M.directAdrSharesPerAdr("vwapy") === 0.1 && M.directAdrSharesPerAdr("NVO") === null && M.directAdrSharesPerAdr("MSFT") === null);

// ─── 2. Such-Reserve ────────────────────────────────────────────────────────
console.log("\n=== Such-Reserve ===");
check("Name: Yahoo „VOLKSWAGEN AG      V“ → VOLKSWAGEN", M.normalizeSearchName("VOLKSWAGEN AG                 V") === "VOLKSWAGEN");
check("Name: Nestlé S.A. → Nestle", M.normalizeSearchName("Nestlé S.A.") === "Nestle", M.normalizeSearchName("Nestlé S.A."));
check("Name: Bayerische Motoren Werke AG → Bayerische Motoren Werke", M.normalizeSearchName("Bayerische Motoren Werke AG") === "Bayerische Motoren Werke");
const filtered = M.filterSearchCandidates([
  { symbol: "BMW.DE", exchange: "XETRA" }, { symbol: "BAMXF", exchange: "OTC" }, { symbol: "BMWKY", exchange: "OTC" },
  { symbol: "BMW.L", exchange: "LSE" }, { symbol: "BMWYY", exchange: "PNK" }, { symbol: "BMWX", exchange: "XETRA" },
]);
check("Suchfilter: nur US-Börsen, kein Suffix, nie BAMXF", JSON.stringify(filtered.map(c => c.symbol)) === '["BMWKY","BMWYY"]', JSON.stringify(filtered.map(c => c.symbol)));
M.clearAdrSearchCache();
let searches = 0;
const fakeSearch = async () => { searches++; return [{ symbol: "XYZY", exchange: "OTC" }]; };
const t0 = 1_800_000_000_000;
await M.resolveAdrCandidates("XYZ.DE", "Xyz AG", fakeSearch, t0);
await M.resolveAdrCandidates("XYZ.DE", "Xyz AG", fakeSearch, t0 + 23 * 3600e3);
check("Suche 24 h gecacht", searches === 1);
await M.resolveAdrCandidates("XYZ.DE", "Xyz AG", fakeSearch, t0 + 25 * 3600e3);
check("nach 24 h neue Suche", searches === 2);
let s2 = 0;
const emptySearch = async () => { s2++; return []; };
await M.resolveAdrCandidates("NOPE.DE", "Nope AG", emptySearch, t0);
await M.resolveAdrCandidates("NOPE.DE", "Nope AG", emptySearch, t0 + 1.5 * 3600e3);
await M.resolveAdrCandidates("NOPE.DE", "Nope AG", emptySearch, t0 + 2.5 * 3600e3);
check("leere Suche 2 h gecacht", s2 === 2);
check("snapNiceRatio: 9,938 → 10, 0,331 → 1/3, 0,457 → null", M.snapNiceRatio(9.938) === 10 && close(M.snapNiceRatio(0.331)!, 1 / 3) && M.snapNiceRatio(0.457) === null);

// ─── 3. Plausibilität mit echten Werten ─────────────────────────────────────
console.log("\n=== Plausibilität (Prod-FMP-ADR × Yahoo lokal, 18.10.2026) ===");
const FX = PROD.fx;
const pairs: Array<[string, string, string]> = [["VOW3.DE", "VWAPY", "EUR"], ["SAP.DE", "SAP", "EUR"], ["NESN.SW", "NSRGY", "CHF"], ["7203.T", "TM", "JPY"], ["MC.PA", "LVMUY", "EUR"], ["ASML.AS", "ASML", "EUR"]];
for (const [loc, adr, cur] of pairs) {
  const ref = YTS[loc].quoteSummaryRef, a = PROD.adr[adr];
  const p = M.checkAdrPlausibility({ localPrice: ref.price, fxToUsd: FX[cur], adrPrice: a.currentPrice, expectedSharesPerAdr: expectMap[loc][1], adrMarketCapUsd: a.marketCap, yahooMarketCapLocal: ref.marketCap });
  check(`${loc} ↔ ${adr}: ok (Ratio impl. ${p.impliedSharesPerAdr?.toFixed(4)}, ${p.ratioDeviationPct?.toFixed(2)} %; MCap ${p.mcapDeviationPct?.toFixed(2)} %)`, p.ok, p.reason);
}
{
  const ref = YTS["BMW.DE"].quoteSummaryRef, a = PROD.adr.BMWYY;
  const p1 = M.checkAdrPlausibility({ localPrice: ref.price, fxToUsd: FX.EUR, adrPrice: a.currentPrice, expectedSharesPerAdr: 1 / 3, adrMarketCapUsd: a.marketCap, yahooMarketCapLocal: ref.marketCap });
  const p2 = M.checkAdrPlausibility({ localPrice: ref.price, fxToUsd: FX.EUR, adrPrice: a.currentPrice, expectedSharesPerAdr: null, adrMarketCapUsd: a.marketCap, yahooMarketCapLocal: ref.marketCap });
  check(`BMW.DE ↔ BMWYY (FMP veraltet, letzter Kurs ${a.lastBarDate}): abgelehnt`, !p1.ok && !p2.ok, `${p1.reason} | ${p2.reason}`);
  const ref2 = YTS["VOW3.DE"].quoteSummaryRef;
  const p3 = M.checkAdrPlausibility({ localPrice: ref2.price, fxToUsd: FX.EUR, adrPrice: PROD.adr.VWAPY.currentPrice, expectedSharesPerAdr: 0.1, adrMarketCapUsd: PROD.adr.VWAPY.marketCap, yahooMarketCapLocal: null });
  check("Yahoo-MCap fehlt → abgelehnt (keine Gegenprobe)", !p3.ok && /Yahoo-MCap fehlt/.test(p3.reason));
  const p4 = M.checkAdrPlausibility({ localPrice: ref2.price, fxToUsd: FX.EUR, adrPrice: PROD.adr.VWAPY.currentPrice, expectedSharesPerAdr: 0.1, adrMarketCapUsd: PROD.adr.VWAPY.marketCap * 1.04, yahooMarketCapLocal: ref2.marketCap });
  check("MCap ×1,04 (Mutation, +3,3 % zu Yahoo) → abgelehnt", !p4.ok && /> ±3 %/.test(p4.reason), p4.reason);
  const p5 = M.checkAdrPlausibility({ localPrice: ref2.price, fxToUsd: FX.EUR, adrPrice: PROD.adr.VWAPY.currentPrice * 1.06, expectedSharesPerAdr: 0.1, adrMarketCapUsd: PROD.adr.VWAPY.marketCap, yahooMarketCapLocal: ref2.marketCap });
  check("Ratio +6 % (Mutation) → abgelehnt", !p5.ok && /> ±5 %/.test(p5.reason), p5.reason);
}

// ─── 4. Einheit der FMP-Per-Share-Felder ───────────────────────────────────
console.log("\n=== Per-Share-Einheit (Prod) ===");
for (const t of ["TM", "LVMUY", "VWAPY", "VWAGY", "SAP", "NSRGY", "ASML"]) {
  const a = PROD.adr[t];
  const u = M.detectPerShareUnit({ netIncome: a.netIncome, eps: a.epsTTM, marketCap: a.marketCap, price: a.currentPrice, sharesPerAdr: M.directAdrSharesPerAdr(t)! });
  check(`${t}: EPS je ADR (Kurs-Einheit) → keine Korrektur nötig`, u === "adr", String(u));
}
{
  const a = PROD.adr.BMWYY;
  check("BMWYY: NI/Aktien ÷ EPS = 3,0 → nicht ADR-Einheit", M.detectPerShareUnit({ netIncome: a.netIncome, eps: a.epsTTM, marketCap: a.marketCap, price: a.currentPrice, sharesPerAdr: 1 / 3 }) !== "adr");
}

// ─── Fetch-Stub ─────────────────────────────────────────────────────────────
type Mode = { ts?: "ok" | "429"; mcapK?: number; tmUnit?: "ordinary"; crumb?: "ok" };
const realFetch = globalThis.fetch;
let calls: string[] = [];
const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** FMP-MOCKS aus Prod-Feldern (siehe Kopf). */
function fmpMock(sym: string, ep: string, mode: Mode): unknown {
  const a = PROD.adr[sym];
  if (sym === "MSFT" || sym === "NVO") {
    const base = sym === "MSFT" ? { price: 529.05, marketCap: 3928487227499.9995, ni: 101.8e9, eps: 17.95 } : { price: 38.83, marketCap: 172269991687.86, ni: 15.4e9, eps: 3.4627908 };
    if (ep === "quote" || ep === "profile") return [{ symbol: sym, price: base.price, marketCap: base.marketCap, currency: "USD", companyName: sym, exchange: "NASDAQ" }];
    if (ep === "income-statement") return [{ symbol: sym, date: "2026-06-30", reportedCurrency: "USD", netIncome: base.ni, eps: base.eps, epsDiluted: base.eps, revenue: 300e9, weightedAverageShsOutDil: base.ni / base.eps }];
    if (ep === "price-target-consensus") return [{ targetHigh: 700, targetLow: 450, targetConsensus: 600, targetMedian: 600 }];
    return [];
  }
  if (!a || a.error) return ep === "quote" ? [] : [];
  const k = mode.mcapK ?? 1;
  const eps = sym === "TM" && mode.tmUnit === "ordinary" ? a.epsAdjFY / 10 : a.epsAdjFY; // Mutation „ordinary“ nur für TM-Test
  if (ep === "quote") return [{ symbol: sym, price: a.currentPrice, marketCap: a.marketCap * k }];
  if (ep === "profile") return [{ symbol: sym, price: a.currentPrice, marketCap: a.marketCap * k, currency: "USD", companyName: `${sym} (FMP)`, exchange: "OTC", lastDividend: 1 }];
  if (ep === "income-statement") return [{ symbol: sym, date: "2025-12-31", reportedCurrency: "USD", netIncome: a.netIncome, eps, epsDiluted: eps, revenue: 1e11, weightedAverageShsOutDil: a.netIncome / eps }];
  if (ep === "analyst-estimates") return [{ symbol: sym, date: "2099-12-31", epsAvg: a.epsConsensusNextFY * (sym === "TM" && mode.tmUnit === "ordinary" ? 0.1 : 1) }];
  if (ep === "price-target-consensus") return [{ symbol: sym, targetHigh: a.analystPT.high, targetLow: a.analystPT.low, targetConsensus: a.analystPT.median, targetMedian: a.analystPT.median }];
  if (ep === "ratios") return [{ symbol: sym, date: "2025-12-31", priceToEarningsRatio: a.peRatio, dividendPerShare: 0.5 }];
  return [];
}
function install(mode: Mode = {}) {
  calls = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url ?? input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    calls.push(url);
    if (url.includes("financialmodelingprep.com")) {
      const u = new URL(url);
      const ep = u.pathname.replace(/^\/stable\//, "").replace(/\/full$/, "");
      const sym = (u.searchParams.get("symbol") ?? "").toUpperCase();
      if (ep === "quote" && sym === "EURUSD") return jsonResp([{ symbol: "EURUSD", price: FX.EUR }]);
      if (ep === "quote" && sym === "JPYUSD") return jsonResp([{ symbol: "JPYUSD", price: FX.JPY }]);
      if (/\.[A-Z]+$/.test(sym)) return jsonResp({ "Error Message": "Premium Query Parameter" }, 402);
      return jsonResp(fmpMock(sym, ep.replace(/^historical-price-eod$/, "hist"), mode));
    }
    if (url.startsWith("https://fc.yahoo.com")) return new Response("", { status: 404, headers: { "set-cookie": "A3=test; Domain=.yahoo.com" } });
    if (url.includes("/v1/test/getcrumb")) return mode.crumb === "ok" ? new Response("testCrumb123", { status: 200 }) : new Response("Too Many Requests", { status: 429 }); // Standard wie Render
    if (url.includes("/v10/finance/quoteSummary/")) {
      // MOCK der quoteSummary-Antwort, nur aus quoteSummaryRef der #264-Fixture (echte Yahoo-Werte); nur bei crumb "ok" erreichbar.
      const qs = YTS[decodeURIComponent((url.match(/quoteSummary\/([^?]+)/) ?? [])[1] ?? "")]?.quoteSummaryRef;
      if (!qs) return new Response("nf", { status: 404 });
      return jsonResp({ quoteSummary: { result: [{ price: { regularMarketPrice: { raw: qs.price }, currency: qs.currency, marketCap: { raw: qs.marketCap }, longName: qs.name }, summaryDetail: { trailingPE: { raw: qs.pe } }, defaultKeyStatistics: { trailingEps: { raw: qs.eps } } }], error: null } });
    }
    const sym = decodeURIComponent((url.match(/\/(?:chart|timeseries)\/([^?]+)/) ?? [])[1] ?? "");
    const fx = YTS[sym];
    if (url.includes("/v8/finance/chart/")) return fx ? jsonResp({ chart: fx.chart }) : new Response("nf", { status: 404 });
    if (url.includes("/ws/fundamentals-timeseries/")) {
      if (!fx) return new Response("nf", { status: 404 });
      if (mode.ts === "429") return new Response("Too Many Requests", { status: 429 });
      return jsonResp({ timeseries: fx.timeseries });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
async function quiet<T>(fn: () => Promise<T>): Promise<{ v: T; lines: string[] }> {
  const w = console.warn, l = console.log, e = console.error; const lines: string[] = [];
  console.warn = console.log = console.error = (...a: any[]) => { lines.push(a.join(" ")); };
  try { return { v: await fn(), lines }; } finally { console.warn = w; console.log = l; console.error = e; }
}

// Legacy-Vergleich: analyze-helpers.ts von main 122762b3 (bit-gleich für US-Ticker).
writeFileSync(LEGACY_PATH, execSync("git show 122762b3:server/analyze-helpers.ts", { cwd: ROOT, encoding: "utf8" }));
try {
  const H = await import("../server/analyze-helpers");
  const Y = await import("../server/yahoo-fetcher");
  const L = await import(LEGACY_PATH);
  const reset = () => { Y.clearYahooCache(); M.clearAdrSearchCache(); };

  console.log("\n=== getFmpFallbackData (Stub: FMP-Mocks, Yahoo echt, getcrumb 429 wie Render) ===");
  for (const t of ["MSFT", "NVO"]) {
    install(); reset();
    const neu = await quiet(() => H.getFmpFallbackData(t));
    install(); reset();
    const alt = await quiet(() => L.getFmpFallbackData(t));
    check(`${t}: Ergebnis deepEqual main 122762b3, kein ADR-Feld`, JSON.stringify(neu.v) === JSON.stringify(alt.v) && !("fmpSymbol" in (neu.v as any)));
  }
  {
    install(); reset();
    const neu = await quiet(() => H.getFmpFallbackData("TM"));
    install(); reset();
    const alt = await quiet(() => L.getFmpFallbackData("TM"));
    check("TM direkt (Prod: EPS je ADR): unverändert ggü. main", JSON.stringify(neu.v) === JSON.stringify(alt.v));
    install({ tmUnit: "ordinary" }); reset();
    const o = (await quiet(() => H.getFmpFallbackData("TM"))).v as any;
    check(`TM direkt, Mutation EPS je Stammaktie: EPS × 10 → ${o.financials.income[0].epsDiluted.toFixed(4)} = Prod ${PROD.adr.TM.epsAdjFY}`, close(o.financials.income[0].epsDiluted, PROD.adr.TM.epsAdjFY, 1e-12) && close(o.analyst.estimates[0].epsAvg, PROD.adr.TM.epsConsensusNextFY, 1e-12));
  }

  const ref = YTS["VOW3.DE"].quoteSummaryRef;
  install(); reset();
  const v = await quiet(() => H.getFmpFallbackData("VOW3.DE"));
  const d: any = v.v;
  const snapPrice = Number(YTS["VOW3.DE"].chart.result[0].indicators.quote[0].close.filter((x: any) => x != null).at(-1));
  check("VOW3.DE: source fmp über VWAPY (FMP-Statements trotz 402)", d.source === "fmp" && d.fmpSymbol === "VWAPY" && d.adr?.fmpSymbol === "VWAPY", v.lines.filter(l => l.includes("[FMP-ADR]")).join(" | "));
  check(`VOW3.DE: Kurs lokal in USD = ${snapPrice} EUR × ${FX.EUR} = ${(snapPrice * FX.EUR).toFixed(4)} (nie ADR-Kurs ${PROD.adr.VWAPY.currentPrice})`, close(d.quote.price, snapPrice * FX.EUR) && d.profile.currency === "USD" && d.quote.price !== PROD.adr.VWAPY.currentPrice);
  check("VOW3.DE: Chart = lokale Bars × FX (neueste zuerst)", close(d.ohlcv[0].close, snapPrice * FX.EUR) && d.ohlcv.length === YTS["VOW3.DE"].chart.result[0].timestamp.length);
  check(`VOW3.DE: EPS je Aktie = VWAPY ${PROD.adr.VWAPY.epsAdjFY} ÷ 0,1 = ${(PROD.adr.VWAPY.epsAdjFY / 0.1).toFixed(4)} USD`, close(d.financials.income[0].epsDiluted, PROD.adr.VWAPY.epsAdjFY / 0.1));
  check("VOW3.DE: Konsens-EPS ÷ 0,1, Aktienzahl × 0,1", close(d.analyst.estimates[0].epsAvg, PROD.adr.VWAPY.epsConsensusNextFY / 0.1) && close(d.financials.income[0].weightedAverageShsOutDil, PROD.adr.VWAPY.netIncome / PROD.adr.VWAPY.epsAdjFY * 0.1));
  check("VOW3.DE: MCap = FMP-Firmen-MCap (USD), Abw. zu Yahoo (timeseries #264) ≤ 3 %", d.profile.marketCap === PROD.adr.VWAPY.marketCap && Math.abs(d.adr.mcapDeviationPct) <= 3, `${d.adr.mcapDeviationPct.toFixed(2)} %`);
  check("VOW3.DE: kein Yahoo-Marker (C1-Gate greift nicht)", d.quote._dataSource !== "yahoo" && d.profile._dataSource !== "yahoo");
  check("VOW3.DE: _listingFx wie #261 (EUR → USD, converted)", d.profile._listingFx?.converted === true && d.profile._listingFx.from === "EUR" && d.profile._listingFx.rate === FX.EUR);
  check("VOW3.DE: Yahoo-MCap aus #264 timeseries (getcrumb 429)", calls.some(u => u.includes("/ws/fundamentals-timeseries/") && u.includes("VOW3.DE")));

  install({ mcapK: 1.04 }); reset();
  const w = await quiet(() => H.getFmpFallbackData("VOW3.DE"));
  check("VOW3.DE, FMP-MCap +4 % (Mutation): Yahoo-Fallback", (w.v as any).source === "yahoo" && !("fmpSymbol" in (w.v as any)), w.lines.filter(l => l.includes("unplausibel")).join(" "));
  install({ ts: "429" }); reset();
  const x = await quiet(() => H.getFmpFallbackData("VOW3.DE"));
  check("VOW3.DE, timeseries 429 + getcrumb 429 (keine Yahoo-MCap): Yahoo-Fallback, nichts gemischt", (x.v as any).source === "yahoo" && (x.v as any).quote.marketCap == null);
  install(); reset();
  const b = await quiet(() => H.getFmpFallbackData("BMW.DE"));
  check("BMW.DE: BMWKY ohne FMP-Kurs → Yahoo-Fallback (kein BAMXF/BMWYY)", (b.v as any).source === "yahoo" && !calls.some(u => /symbol=(BAMXF|BMWYY)/.test(u)));
  install(); reset();
  const tmR = await quiet(() => H.getFmpFallbackData("7203.T"));
  check("7203.T, getcrumb 429 (Render): #264 ergänzt nur .DE → keine Währung/MCap → Yahoo-Fallback, kein TM-Bundle", (tmR.v as any).source === "yahoo" && !("fmpSymbol" in (tmR.v as any)), tmR.lines.filter(l => l.includes("[FMP-ADR]")).join(" | "));
  install({ crumb: "ok" }); reset();
  const tm = await quiet(() => H.getFmpFallbackData("7203.T"));
  const tmPx = Number(YTS["7203.T"].chart.result[0].indicators.quote[0].close.filter((x: any) => x != null).at(-1));
  check(`7203.T (quoteSummary ok) → TM: EPS ÷ 10 = ${(PROD.adr.TM.epsAdjFY / 10).toFixed(4)}, Kurs ${tmPx} JPY × ${FX.JPY}`, (tm.v as any).fmpSymbol === "TM" && close((tm.v as any).financials.income[0].epsDiluted, PROD.adr.TM.epsAdjFY / 10) && close((tm.v as any).quote.price, tmPx * FX.JPY), tm.lines.filter(l => l.includes("[FMP-ADR]")).join(" | "));
  check("7203.T (quoteSummary ok) → TM: Kursziel ÷ 10", close((tm.v as any).analyst.priceTarget.targetMedian, PROD.adr.TM.analystPT.median / 10));

  console.log("\n=== /api/analyze (VOW3.DE über VWAPY) ===");
  const express = (await import("express")).default;
  const { registerAnalyzeRoute } = await import("../server/analyze-route");
  const app = express(); app.use(express.json());
  const server = app.listen(0);
  registerAnalyzeRoute(server, app);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  install(); reset();
  const r = await quiet(() => realFetch(`http://127.0.0.1:${port}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: "VOW3.DE", useLLM: false, force: true }) }).then(async (q) => ({ status: q.status, body: await q.json() })));
  const a = r.v.body;
  check(`HTTP 200, dataSource fmp, adrSource VWAPY`, r.v.status === 200 && a.dataSource === "fmp" && a.adrSource?.fmpSymbol === "VWAPY", `${r.v.status} ${a.dataSource} ${a.error ?? ""}`);
  check(`currentPrice lokal in USD ${a.currentPrice?.toFixed?.(4)}, currency USD, historyDataSource yahoo`, close(a.currentPrice, snapPrice * FX.EUR) && a.currency === "USD" && a.historyDataSource === "yahoo");
  check(`marketCap ${(a.marketCap / 1e9).toFixed(2)} Mrd = FMP-MCap; sharesOutstanding = MCap ÷ lokaler USD-Kurs`, close(a.marketCap, PROD.adr.VWAPY.marketCap, 1e-6) && close(a.sharesOutstanding, Math.round(PROD.adr.VWAPY.marketCap / (snapPrice * FX.EUR)), 1e-6));
  check(`epsTTM ${a.epsTTM?.toFixed?.(4)} = VWAPY-EPS ÷ 0,1; Bewertung nicht gesperrt (dcfFairValue ${a.dcfFairValue}, scoring ${a.scoring ? "ja" : "nein"})`, close(a.epsTTM, PROD.adr.VWAPY.epsAdjFY / 0.1) && a.dcfFairValue !== null && a.scoring !== undefined && a.valuationNotice === undefined);
  check("Folge-FMP-Calls (earnings, Quartale) an VWAPY, nicht an VOW3.DE", calls.some(u => u.includes("/stable/earnings?") && u.includes("symbol=VWAPY")) && calls.some(u => u.includes("period=quarter") && u.includes("symbol=VWAPY")));
  server.close();
} finally {
  globalThis.fetch = realFetch;
  if (existsSync(LEGACY_PATH)) unlinkSync(LEGACY_PATH);
}
console.log(`\n${n - fail}/${n} Checks grün`);
process.exit(fail ? 1 : 0);
