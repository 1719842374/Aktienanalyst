/**
 * #265 v2: SAP.DE → SAP, VOW3.DE → VWAPY (Vorzug), Rückfall VWAGY („Proxy: Stammaktie“), sonst Yahoo.
 * Ohne Netz und ohne FMP-Key: FMP- und Yahoo-Antworten sind MOCKS, gebaut aus echten Prod-Feldern
 * (script/fixtures/fmp-adr-prod-2026-10-18.json, Prod 18.10.2026) und den Yahoo-Chart-Fixtures (#264).
 * Die Yahoo-MCap ist aus den in #265 v1 gemessenen MCap-Abweichungen zurückgerechnet (als Mock markiert).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fmpViaAdrData, type FmpViaAdrDeps } from "../server/analyze-helpers";
import { adrCandidatesFor, checkAdrPlausibility, ADR_PROXY_NOTE } from "../server/fmp-adr-map";
import { FX_CONVERTIBLE_FIELDS } from "../server/fmp";
import { normalizeListingToUsd, currencyInfoFromListingFx } from "../shared/listing-units";

let pass = 0, fail = 0;
const check = async (n: string, fn: () => void | Promise<void>) => { try { await fn(); pass++; console.log("  ✓", n); } catch (e: any) { fail++; console.log("  ✗", n, "—", String(e?.message).split("\n")[0]); } };

const fx = JSON.parse(readFileSync("script/fixtures/fmp-adr-prod-2026-10-18.json", "utf8"));
const EURUSD = fx.fx.EUR as number;
const A = fx.adr;
const chartMeta = (t: string) => JSON.parse(readFileSync(`script/fixtures/yahoo-chart-${t}.json`, "utf8")).chart.result[0].meta;

// MOCK Yahoo-MCap (EUR): aus v1-Abweichung FMP vs. Yahoo (SAP +1,51 %, VWAPY −0,65 %) zurückgerechnet.
const yahooMcapEur = { "SAP.DE": A.SAP.marketCap / 1.0151 / EURUSD, "VOW3.DE": A.VWAPY.marketCap / (1 - 0.0065) / EURUSD } as Record<string, number>;
const snapMock = (t: string) => {
  const m = chartMeta(t), p = m.regularMarketPrice;
  const bars = [0, 1, 2].map(i => ({ date: `2026-10-1${6 + i}`, open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 1, source: "yahoo" }));
  return { symbol: t, price: p, currency: m.currency, marketCap: yahooMcapEur[t], pe: null, eps: null, name: m.longName, exchange: m.exchangeName, bars };
};
// MOCK FMP-Bundle eines ADR aus Prod-Feldern (EPS je ADR, wie v1 für SAP/VWAPY/VWAGY gemessen).
const adrBundle = (sym: string) => {
  const a = A[sym];
  return {
    quote: { symbol: sym, price: a.currentPrice, marketCap: a.marketCap, volume: 123, eps: a.epsTTM, pe: a.peRatio },
    profile: { symbol: sym, companyName: sym, price: a.currentPrice, marketCap: a.marketCap, currency: "USD", sharesOutstanding: a.sharesOutstanding },
    financials: { income: [{ netIncome: a.netIncome, eps: a.epsTTM, epsDiluted: a.epsTTM, weightedAverageShsOutDil: a.sharesOutstanding }], cashflow: [], balanceSheet: [] },
    analyst: { priceTarget: { targetConsensus: a.analystPT.median, targetHigh: a.analystPT.high, targetLow: a.analystPT.low }, grades: [], estimates: [{ estimatedEpsAvg: a.epsConsensusNextFY }] },
    ohlcv: [{ date: "2026-10-17", close: a.currentPrice }], segments: [], geoSegments: [], peers: [], ratios: [{ bookValuePerShare: 10 }],
    source: "fmp" as const,
  };
};
const fail402 = { failure: { errorCode: "FMP_UPSTREAM_ERROR", fmpStatus: 402, message: "402" } };
const empty = (sym: string) => ({ ...adrBundle(sym), financials: { income: [], cashflow: [], balanceSheet: [] } });

const mkDeps = (fmp: Record<string, any>, calls: string[] = []): FmpViaAdrDeps => ({
  snapshot: (async (t: string) => snapMock(t)) as any,
  fetchAdr: (async (s: string) => { calls.push(s); return fmp[s] ?? fail402; }) as any,
  fxToUsd: async () => EURUSD,
  toUsd: async (_t, d) => normalizeListingToUsd(d, EURUSD, FX_CONVERTIBLE_FIELDS, { barsInMajor: true }),
});
const note = (r: any) => currencyInfoFromListingFx(r?.profile?._listingFx)?.note ?? "";

await check("Map: SAP.DE → SAP; VOW3.DE → VWAPY, dann VWAGY (proxy)", () => {
  assert.deepEqual(adrCandidatesFor("sap.de").map(c => c.symbol), ["SAP"]);
  assert.deepEqual(adrCandidatesFor("VOW3.DE").map(c => [c.symbol, !!c.proxy]), [["VWAPY", false], ["VWAGY", true]]);
  assert.deepEqual(adrCandidatesFor("BMW.DE"), []);
});

await check("Andere Ticker (MSFT, BMW.DE, VOW.DE): kein ADR-Abruf, null", async () => {
  const calls: string[] = [];
  for (const t of ["MSFT", "BMW.DE", "VOW.DE"]) assert.equal(await fmpViaAdrData(t, mkDeps({}, calls)), null);
  assert.equal(calls.length, 0);
});

await check("SAP.DE → SAP: Quelle fmp, Kurs lokal in USD, EPS je Aktie, Hinweis ohne Proxy", async () => {
  const r = await fmpViaAdrData("SAP.DE", mkDeps({ SAP: adrBundle("SAP") }));
  assert.ok(r); assert.equal(r.source, "fmp"); assert.equal(r.fmpSymbol, "SAP"); assert.equal(r.adr.proxy, false);
  assert.ok(Math.abs(r.quote.price - 199.22 * EURUSD) < 1e-9, "Kurs = SAP.DE × EURUSD");
  assert.ok(Math.abs(r.profile.marketCap - A.SAP.marketCap) < 1, "MCap = FMP (USD)");
  assert.ok(Math.abs(r.financials.income[0].epsDiluted - A.SAP.epsTTM) < 1e-9, "Ratio 1 → EPS unverändert");
  assert.ok(Math.abs(r.analyst.priceTarget.targetConsensus - 260) < 1e-9, "PT USD je Aktie (Ratio 1)");
  assert.equal(r.quote.eps, undefined); assert.equal(r.quote.volume, undefined);
  assert.match(note(r), /FMP über SAP/); assert.ok(!note(r).includes(ADR_PROXY_NOTE));
});

await check("VOW3.DE → VWAPY: EPS ÷ 0,1, PT ÷ 0,1, kein Proxy, VWAGY nicht abgefragt", async () => {
  const calls: string[] = [];
  const r = await fmpViaAdrData("VOW3.DE", mkDeps({ VWAPY: adrBundle("VWAPY"), VWAGY: adrBundle("VWAGY") }, calls));
  assert.equal(r.fmpSymbol, "VWAPY"); assert.equal(r.adr.proxy, false); assert.deepEqual(calls, ["VWAPY"]);
  assert.ok(Math.abs(r.financials.income[0].epsDiluted - A.VWAPY.epsTTM * 10) < 1e-9);
  assert.ok(Math.abs(r.analyst.estimates[0].estimatedEpsAvg - A.VWAPY.epsConsensusNextFY * 10) < 1e-9);
  assert.ok(Math.abs(r.ratios[0].bookValuePerShare - 100) < 1e-9);
  assert.ok(Math.abs(r.quote.price - 68.68 * EURUSD) < 1e-9);
  assert.ok(!note(r).includes(ADR_PROXY_NOTE));
});

await check("VOW3.DE: VWAPY 402 → VWAGY mit sichtbarem Hinweis „Proxy: Stammaktie“", async () => {
  const calls: string[] = [];
  const r = await fmpViaAdrData("VOW3.DE", mkDeps({ VWAPY: fail402, VWAGY: adrBundle("VWAGY") }, calls));
  assert.deepEqual(calls, ["VWAPY", "VWAGY"]); assert.equal(r.fmpSymbol, "VWAGY"); assert.equal(r.adr.proxy, true);
  assert.ok(note(r).includes(ADR_PROXY_NOTE), note(r));
  assert.ok(Math.abs(r.analyst.priceTarget.targetConsensus - 180) < 1e-9, "PT VWAGY 18 USD/ADR → 180 USD je Aktie");
});

await check("VOW3.DE: VWAPY leer (keine Statements) → VWAGY (Proxy)", async () => {
  const r = await fmpViaAdrData("VOW3.DE", mkDeps({ VWAPY: empty("VWAPY"), VWAGY: adrBundle("VWAGY") }));
  assert.equal(r.fmpSymbol, "VWAGY"); assert.ok(note(r).includes(ADR_PROXY_NOTE));
});

await check("VOW3.DE: VWAPY und VWAGY 402 → null (Aufrufer: Yahoo-Fallback wie main)", async () => {
  assert.equal(await fmpViaAdrData("VOW3.DE", mkDeps({ VWAPY: fail402, VWAGY: fail402 })), null);
});
await check("VOW3.DE: VWAPY leer, VWAGY leer → null", async () => {
  assert.equal(await fmpViaAdrData("VOW3.DE", mkDeps({ VWAPY: empty("VWAPY"), VWAGY: empty("VWAGY") })), null);
});
await check("SAP.DE: FMP-MCap +10 % (Mutation) → unplausibel → null", async () => {
  const b = adrBundle("SAP"); b.profile.marketCap *= 1.1; b.quote.marketCap *= 1.1;
  assert.equal(await fmpViaAdrData("SAP.DE", mkDeps({ SAP: b })), null);
});
await check("Yahoo-MCap fehlt → keine Gegenprobe → null", async () => {
  const d = mkDeps({ SAP: adrBundle("SAP") }); d.snapshot = (async (t: string) => ({ ...snapMock(t), marketCap: null })) as any;
  assert.equal(await fmpViaAdrData("SAP.DE", d), null);
});
await check("FX fehlt → null", async () => {
  const d = mkDeps({ SAP: adrBundle("SAP") }); d.fxToUsd = async () => 1;
  assert.equal(await fmpViaAdrData("SAP.DE", d), null);
});
await check("Fetch wirft (Netzfehler) bei VWAPY → VWAGY", async () => {
  const d = mkDeps({ VWAGY: adrBundle("VWAGY") }); const f = d.fetchAdr;
  d.fetchAdr = (async (s: string) => { if (s === "VWAPY") throw new Error("ECONNRESET"); return f(s); }) as any;
  assert.equal((await fmpViaAdrData("VOW3.DE", d)).fmpSymbol, "VWAGY");
});
await check("Plausibilität echte Prod-Werte: SAP/VWAPY strikt ok, VWAGY als Proxy ok", () => {
  const sap = checkAdrPlausibility({ localPrice: 199.22, fxToUsd: EURUSD, adrPrice: A.SAP.currentPrice, sharesPerAdr: 1, adrMarketCapUsd: A.SAP.marketCap, yahooMarketCapLocal: yahooMcapEur["SAP.DE"] });
  const vp = checkAdrPlausibility({ localPrice: 68.68, fxToUsd: EURUSD, adrPrice: A.VWAPY.currentPrice, sharesPerAdr: 0.1, adrMarketCapUsd: A.VWAPY.marketCap, yahooMarketCapLocal: yahooMcapEur["VOW3.DE"] });
  const vg = checkAdrPlausibility({ localPrice: 68.68, fxToUsd: EURUSD, adrPrice: A.VWAGY.currentPrice, sharesPerAdr: 0.1, proxy: true, adrMarketCapUsd: A.VWAGY.marketCap, yahooMarketCapLocal: yahooMcapEur["VOW3.DE"] });
  assert.ok(sap.ok && vp.ok && vg.ok, [sap.reason, vp.reason, vg.reason].join(" | "));
});
await check("currencyInfo-Hinweis ohne sourceNote bytegleich zu main", () => {
  const lfx = { from: "EUR", major: "EUR", factor: 1, rate: 1.1, converted: true };
  assert.equal(currencyInfoFromListingFx(lfx)!.note, "Listing in EUR; Kurs, Market Cap, Historie und Kursziel zu EURUSD = 1.1000 in USD umgerechnet, Statements in USD.");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
