/**
 * C1: FMP 402 → Yahoo-Fallback (Kurs, Market Cap, PE, EPS, Historie), AAPL bleibt FMP.
 * fetch wird gemockt: FMP antwortet für .DE mit 402, für AAPL mit 200.
 * Default: Yahoo ebenfalls gemockt (offline). Mit --live geht Yahoo echt ins Netz.
 * Run: npx tsx script/test-yahoo-fallback-402.ts [--live]
 */
process.env.FMP_API_KEY = "test-key";
process.env.FMP_MIN_INTERVAL_MS = "0";
process.env.YAHOO_MIN_INTERVAL_MS = "50";
const LIVE = process.argv.includes("--live");

let failed = 0, total = 0;
function check(name: string, ok: boolean, detail = "") {
  total++;
  if (ok) console.log(`  ✅ ${name}${detail ? ` (${detail})` : ""}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const realFetch = globalThis.fetch;
const calls: string[] = [];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const day = 86400;
const now = Math.floor(Date.now() / 1000);
const MOCK_YAHOO: Record<string, { price: number; cap: number; pe: number; eps: number }> = {
  "VOW3.DE": { price: 90, cap: 46e9, pe: 4.5, eps: 20 },
  "BMW.DE": { price: 80, cap: 50e9, pe: 6, eps: 13.3 },
  "SAP.DE": { price: 200, cap: 230e9, pe: 30, eps: 6.67 },
};
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input?.url ?? input);
  calls.push(url);
  if (url.includes("financialmodelingprep.com")) {
    const sym = new URL(url).searchParams.get("symbol") ?? "";
    if (sym === "AAPL") {
      if (url.includes("/quote")) return json([{ symbol: "AAPL", price: 250, marketCap: 3.7e12, pe: 33, eps: 7.5 }]);
      if (url.includes("/profile")) return json([{ symbol: "AAPL", companyName: "Apple Inc.", currency: "USD" }]);
      return json([]);
    }
    return json({ "Error Message": "Premium Query Parameter" }, 402);
  }
  if (url.includes("yahoo.com")) {
    if (LIVE) return realFetch(input, init);
    if (url.includes("fc.yahoo.com")) return new Response("", { status: 404, headers: { "set-cookie": "A3=test; Domain=.yahoo.com" } });
    if (url.includes("getcrumb")) return new Response("crumbXYZ", { status: 200 });
    const sym = decodeURIComponent((url.match(/\/(?:chart|quoteSummary)\/([^?]+)/) ?? [])[1] ?? "");
    const m = MOCK_YAHOO[sym];
    if (!m) return json({ chart: { result: null, error: { code: "Not Found" } } }, 404);
    if (url.includes("quoteSummary")) return json({ quoteSummary: { result: [{
      price: { regularMarketPrice: { raw: m.price }, marketCap: { raw: m.cap }, currency: "EUR", longName: sym, exchangeName: "GER" },
      summaryDetail: { trailingPE: { raw: m.pe } }, defaultKeyStatistics: { trailingEps: { raw: m.eps } } }] } });
    const ts = Array.from({ length: 300 }, (_, i) => now - (300 - i) * day);
    return json({ chart: { result: [{ meta: { currency: "EUR" }, timestamp: ts,
      indicators: { quote: [{ open: ts.map(() => m.price), high: ts.map(() => m.price), low: ts.map(() => m.price), close: ts.map(() => m.price), volume: ts.map(() => 1) }] } }] } });
  }
  return json({}, 404);
}) as typeof fetch;

(async () => {
  const { getFmpFallbackData, fmpFallbackFailureResponse } = await import("../server/analyze-helpers");
  const { clearYahooCache, getYahooSnapshot } = await import("../server/yahoo-fetcher");
  console.log(`\n=== FMP 402 → Yahoo (${LIVE ? "LIVE Yahoo" : "Yahoo gemockt"}) ===`);
  for (const t of ["VOW3.DE", "BMW.DE", "SAP.DE"]) {
    const r: any = await getFmpFallbackData(t);
    check(`${t}: kein failure`, !("failure" in r), "failure" in r ? JSON.stringify(r.failure) : "");
    if ("failure" in r) continue;
    check(`${t}: source=yahoo`, r.source === "yahoo" && r.quote._dataSource === "yahoo" && r.profile._dataSource === "yahoo");
    check(`${t}: Kurs > 0`, r.quote.price > 0, `${r.quote.price} ${r.quote.currency}`);
    check(`${t}: Market Cap`, r.quote.marketCap > 0, String(r.quote.marketCap));
    check(`${t}: PE und EPS vorhanden`, r.quote.pe != null && r.quote.eps != null, `PE ${r.quote.pe?.toFixed?.(2)} EPS ${r.quote.eps}`);
    check(`${t}: Historie ≥ 200 Bars`, r.ohlcv.length >= 200, String(r.ohlcv.length));
    check(`${t}: Symbol nicht umgelöst`, r.quote.symbol === t && calls.some((u) => u.includes(`/chart/${encodeURIComponent(t)}`)));
    check(`${t}: Statements leer, nichts erfunden`, r.financials.income.length === 0 && r.analyst.priceTarget === null);
  }

  console.log("\n=== Cache ===");
  const before = calls.filter((u) => u.includes("yahoo.com")).length;
  await getYahooSnapshot("SAP.DE");
  const after = calls.filter((u) => u.includes("yahoo.com")).length;
  check("zweiter Abruf SAP.DE aus Cache (0 Yahoo-Calls)", after === before, `${after - before}`);

  console.log("\n=== Rate-Limit ===");
  clearYahooCache();
  const t0 = Date.now();
  if (!LIVE) await Promise.all([getYahooSnapshot("VOW3.DE"), getYahooSnapshot("BMW.DE")]);
  const dt = Date.now() - t0;
  check("Yahoo-Calls serialisiert mit Mindestabstand", LIVE || dt >= 50 * 5, `${dt} ms`);

  console.log("\n=== AAPL bleibt FMP ===");
  const yBefore = calls.filter((u) => u.includes("yahoo.com")).length;
  const a: any = await getFmpFallbackData("AAPL");
  check("AAPL source=fmp", !("failure" in a) && a.source === "fmp");
  check("AAPL ohne _dataSource-Marker", !("failure" in a) && a.quote._dataSource === undefined);
  check("AAPL: 0 Yahoo-Calls", calls.filter((u) => u.includes("yahoo.com")).length === yBefore);

  console.log("\n=== Ungültiger Ticker (402 + Yahoo ohne Daten) ===");
  const bad: any = await getFmpFallbackData("ZZZZINVALID.DE");
  check("kein Crash, failure 402", "failure" in bad && bad.failure.fmpStatus === 402);
  if ("failure" in bad) {
    const resp = fmpFallbackFailureResponse("ZZZZINVALID.DE", bad.failure);
    check("klarer Text statt 'FMP-Fehler HTTP 402'", !resp.body.error.startsWith("FMP-Fehler") && resp.body.error.includes("nicht ab"), resp.body.error);
  }
  const up = fmpFallbackFailureResponse("X", { errorCode: "FMP_UPSTREAM_ERROR", fmpStatus: 500, message: "" });
  check("500 bleibt unverändert", up.body.error === "FMP-Fehler HTTP 500 für X.");

  console.log(`\n${total - failed}/${total} Checks grün.`);
  process.exit(failed ? 1 : 0);
})();
