/**
 * C1 / PR #252 Guard-Test über die echte /api/analyze-Route (Express, gemocktes fetch).
 *
 * - FMP-Ticker (AAPL, MSFT, SHEL.L, RY.TO): FMP-Mock aus den gespeicherten echten
 *   Prod-JSONs (/workspace/dod-jobD/before/<T>.json, 18.10. 14:46): Kurs, MCap,
 *   Statements, Kursziel und echte Kurshistorie. Ausgabe wird nach OUT geschrieben,
 *   damit main und Branch byte-genau verglichen werden können (compare-Modus).
 * - Yahoo-Ticker (VOW3.DE): FMP antwortet 402, Yahoo gemockt.
 *
 * Run (Branch, mit Assertions):
 *   npx tsx script/test-yahoo-no-valuation-route.ts
 * Run gegen anderen Stand (nur Ausgabe):
 *   ROOT=/pfad/zum/worktree OUT=/tmp/x.json NO_ASSERT=1 npx tsx script/test-yahoo-no-valuation-route.ts
 * Vergleich:
 *   npx tsx script/test-yahoo-no-valuation-route.ts --compare /tmp/main.json /tmp/branch.json
 * Läuft am besten in einem leeren cwd (data.db wird dort angelegt).
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT ?? path.resolve(HERE, "..");
const OUT = process.env.OUT ?? "";
const PROD_DIR = process.env.PROD_DIR ?? "/workspace/dod-jobD/before";
const FMP_TICKERS = ["AAPL", "MSFT", "SHEL.L", "RY.TO"];
const YAHOO_TICKER = "VOW3.DE";

let failed = 0, total = 0;
function check(name: string, ok: boolean, detail = "") {
  total++;
  if (ok) console.log(`  ✅ ${name}${detail ? ` (${detail})` : ""}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Felder, die sich pro Lauf ändern (Uhrzeit), werden für den Byte-Vergleich entfernt. */
const VOLATILE = new Set(["priceTimestamp", "dataTimestamp", "catalystsTimestamp", "generatedAt", "asOf"]);
function stripVolatile(v: any): any {
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) if (!VOLATILE.has(k)) o[k] = stripVolatile(x);
    return o;
  }
  return v;
}

if (process.argv[2] === "--compare") {
  const [a, b] = [process.argv[3], process.argv[4]].map((f) => JSON.parse(readFileSync(f, "utf8")));
  console.log(`\n=== FMP-Ticker: main vs. Branch (ohne ${[...VOLATILE].join(", ")}) ===`);
  for (const t of FMP_TICKERS) {
    const sa = JSON.stringify(stripVolatile(a[t]?.body));
    const sb = JSON.stringify(stripVolatile(b[t]?.body));
    check(`${t}: HTTP gleich`, a[t]?.status === b[t]?.status, `${a[t]?.status} / ${b[t]?.status}`);
    check(`${t}: Antwort byte-gleich`, sa === sb, `${sa.length} / ${sb.length} Bytes`);
    const pick = (x: any) => ({ finalScore: x?.scoring?.finalScore, rating: x?.biasFix?.overallRating, dcf: x?.dcfFairValue, crv: x?.crvBase, ds: x?.dataSource });
    console.log(`     main  ${JSON.stringify(pick(a[t]?.body))}\n     branch ${JSON.stringify(pick(b[t]?.body))}`);
  }
  console.log(`\n${total - failed}/${total} Checks grün.`);
  process.exit(failed ? 1 : 0);
}

process.env.FMP_API_KEY = "test-key";
process.env.FMP_MIN_INTERVAL_MS = "0";
process.env.YAHOO_MIN_INTERVAL_MS = "0";
delete process.env.OPENROUTER_API_KEY;
delete process.env.PERPLEXITY_API_KEY;

const prod: Record<string, any> = {};
for (const t of FMP_TICKERS) {
  const f = `${PROD_DIR}/${t}.json`;
  if (!existsSync(f)) { console.error(`fehlt: ${f}`); process.exit(2); }
  prod[t] = JSON.parse(readFileSync(f, "utf8"));
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fmpMock(p: string, sym: string, qs: URLSearchParams): Response {
  if (/^[A-Z]{3}USD$/.test(sym)) return json([{ symbol: sym, price: 1 }]);
  const d = prod[sym];
  if (!d) return json({ "Error Message": "Premium Query Parameter" }, 402);
  const fs = d.financialStatements ?? {};
  const inc = fs.incomeStatement ?? {}, bs = fs.balanceSheet ?? {}, cf = fs.cashFlow ?? {};
  const rev0 = d.revenue, rev1 = rev0 / (1 + (inc.revenueGrowth ?? 0) / 100);
  const quarter = qs.get("period") === "quarter";
  const yearRows = (n: number, mk: (i: number, f: number) => any) => Array.from({ length: n }, (_, i) => mk(i, Math.pow(0.95, i)));
  switch (p) {
    case "/quote": return json([{ symbol: sym, price: d.currentPrice, marketCap: d.marketCap, pe: d.peRatio, eps: d.epsTTM, yearHigh: d.yearHigh, yearLow: d.yearLow }]);
    case "/profile": return json([{ symbol: sym, companyName: d.companyName, currency: d.currency, exchange: d.exchange, sector: d.sector, industry: d.industry, description: d.description, beta: d.beta5Y, marketCap: d.marketCap, sharesOutstanding: d.sharesOutstanding, country: d.country }]);
    case "/income-statement":
      if (quarter) return json(yearRows(16, (i, f) => ({ date: `Q${i}`, revenue: (rev0 / 4) * f })));
      return json(yearRows(3, (i, f) => ({ date: `${2025 - i}-12-31`, fiscalYear: String(2025 - i), period: "FY", revenue: i === 0 ? rev0 : rev1 * Math.pow(0.97, i - 1), grossProfit: d.grossProfit * f, operatingIncome: d.operatingIncome * f, netIncome: d.netIncome * f, ebitda: d.ebitda * f, epsDiluted: d.epsAdjFY * f, weightedAverageShsOutDil: d.sharesOutstanding })));
    case "/cash-flow-statement":
      return json(yearRows(3, (i, f) => ({ date: `${2025 - i}-12-31`, operatingCashFlow: (cf.operatingCashFlow ?? d.fcfTTM) * f, capitalExpenditure: -(cf.capex ?? 0) * f, freeCashFlow: d.fcfTTM * f })));
    case "/balance-sheet-statement":
      return json(yearRows(2, (i, f) => ({ date: `${2025 - i}-12-31`, totalDebt: d.totalDebt * f, cashAndCashEquivalents: d.cashEquivalents * f, totalStockholdersEquity: d.totalEquity * f, totalAssets: d.totalAssets * f, totalCurrentAssets: (bs.totalAssets ?? 0) * 0.3 * f, totalCurrentLiabilities: (bs.totalLiabilities ?? 0) * 0.25 * f, inventory: 1e9 * f })));
    case "/price-target-consensus": return json([{ symbol: sym, targetMedian: d.analystPT?.median ?? 0, targetHigh: d.analystPT?.high ?? 0, targetLow: d.analystPT?.low ?? 0, numberOfAnalysts: d.analystPT?.count ?? 0 }]);
    case "/historical-price-eod/full": {
      const rows = (d.ohlcvData ?? d.historicalPrices).map((r: any) => ({ date: r.date, open: r.open ?? r.close, high: r.high ?? r.close, low: r.low ?? r.close, close: r.close, volume: r.volume ?? 1 }));
      return json([...rows].reverse());
    }
    case "/ratios": return json([{ priceToEarningsRatio: d.peRatio, returnOnEquity: d.returnOnEquity, priceToBookRatio: d.pbRatio, enterpriseValueMultiple: d.evEbitda, dividendYield: (d.dividendYield ?? 0) / 100 }]);
    default: return json([]);
  }
}

const day = 86400, now = Math.floor(Date.now() / 1000);
const realFetch = globalThis.fetch;
const calls: string[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input?.url ?? input);
  if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
  calls.push(url);
  if (url.includes("financialmodelingprep.com")) {
    const u = new URL(url);
    return fmpMock(u.pathname.replace(/^\/stable/, ""), u.searchParams.get("symbol") ?? "", u.searchParams);
  }
  if (url.includes("yahoo.com")) {
    if (url.includes("fc.yahoo.com")) return new Response("", { status: 404, headers: { "set-cookie": "A3=test; Domain=.yahoo.com" } });
    if (url.includes("getcrumb")) return new Response("crumbXYZ", { status: 200 });
    const sym = decodeURIComponent((url.match(/\/(?:chart|quoteSummary)\/([^?]+)/) ?? [])[1] ?? "");
    if (sym !== YAHOO_TICKER) return json({ chart: { result: null, error: { code: "Not Found" } } }, 404);
    if (url.includes("quoteSummary")) return json({ quoteSummary: { result: [{
      price: { regularMarketPrice: { raw: 90 }, marketCap: { raw: 46e9 }, currency: "EUR", longName: "Volkswagen AG Vz.", exchangeName: "GER" },
      summaryDetail: { trailingPE: { raw: 4.5 } }, defaultKeyStatistics: { trailingEps: { raw: 20 } } }] } });
    const ts = Array.from({ length: 2900 }, (_, i) => now - (2900 - i) * day);
    const close = ts.map((_, i) => 80 + 10 * Math.sin(i / 40));
    return json({ chart: { result: [{ meta: { currency: "EUR" }, timestamp: ts, indicators: { quote: [{ open: close, high: close, low: close, close, volume: ts.map(() => 1) }] } }] } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

(async () => {
  const express = (await import("express")).default;
  const { registerAnalyzeRoute } = await import(`${ROOT}/server/analyze-route.ts`);
  const app = express();
  app.use(express.json());
  const server = app.listen(0);
  registerAnalyzeRoute(server, app);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  const out: Record<string, { status: number; body: any }> = {};
  for (const t of [...FMP_TICKERS, YAHOO_TICKER]) {
    const r = await realFetch(`http://127.0.0.1:${port}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: t, useLLM: false, force: true }) });
    out[t] = { status: r.status, body: await r.json() };
    console.log(`[harness] ${t}: HTTP ${r.status}`);
  }
  server.close();
  if (OUT) writeFileSync(OUT, JSON.stringify(out));

  if (!process.env.NO_ASSERT) {
    const y = out[YAHOO_TICKER].body;
    console.log(`\n=== ${YAHOO_TICKER}: FMP 402 → Yahoo, keine Bewertung ===`);
    check("HTTP 200", out[YAHOO_TICKER].status === 200, String(out[YAHOO_TICKER].status));
    check("dataSource = yahoo", y.dataSource === "yahoo", String(y.dataSource));
    check("historyDataSource = yahoo", y.historyDataSource === "yahoo", String(y.historyDataSource));
    check("Hinweis „Yahoo-Daten – keine Bewertung“", y.valuationNotice === "Yahoo-Daten – keine Bewertung", String(y.valuationNotice));
    check("Kurs > 0", y.currentPrice > 0, String(y.currentPrice));
    check("Market Cap > 0", y.marketCap > 0, String(y.marketCap));
    check("KGV und EPS vorhanden", y.peRatio > 0 && y.epsTTM > 0, `PE ${y.peRatio} EPS ${y.epsTTM}`);
    check("Historie ≥ 200 Punkte", (y.historicalPrices?.length ?? 0) >= 200, String(y.historicalPrices?.length));
    check("dcfFairValue = null (nicht 0)", y.dcfFairValue === null, String(y.dcfFairValue));
    check("upsidePotential = null (nicht 0)", y.upsidePotential === null, String(y.upsidePotential));
    check("impliedGStar (Inverse-DCF g*) = null", y.impliedGStar === null, String(y.impliedGStar));
    check("kein scoring (Score n/a)", y.scoring === undefined, JSON.stringify(y.scoring)?.slice(0, 60));
    check("kein biasFix (Rating n/a)", y.biasFix === undefined);
    check("kein execSummary", y.execSummary === undefined);
    check("kein Server-CRV (crvBase/crvRiskAdj/maxEntryCrv3)", y.crvBase === undefined && y.crvRiskAdj === undefined && y.maxEntryCrv3 === undefined);
    const zeroValuation = ["dcfFairValue", "upsidePotential", "impliedGStar", "crvBase", "crvRiskAdj", "maxEntryCrv3"].filter((k) => y[k] === 0);
    check("keine 0 in DCF/Score-Feldern", zeroValuation.length === 0, zeroValuation.join(","));
    const { isYahooOnly } = await import(`${ROOT}/shared/data-source.ts`);
    check("Client-Weiche isYahooOnly(VOW3.DE) = true", isYahooOnly(y) === true);
    console.log(`\n=== FMP-Ticker bleiben FMP ===`);
    for (const t of FMP_TICKERS) {
      const b = out[t].body;
      check(`${t}: HTTP 200, dataSource fmp, kein valuationNotice`, out[t].status === 200 && b.dataSource === "fmp" && !("valuationNotice" in b));
      check(`${t}: Score + Rating vorhanden`, typeof b.scoring?.finalScore === "number" && typeof b.biasFix?.overallRating === "string", `${b.scoring?.finalScore} ${b.biasFix?.overallRating}`);
      check(`${t}: Client-Weiche isYahooOnly = false`, isYahooOnly(b) === false);
    }
    console.log(`\n=== gespeicherte echte Prod-JSONs (Client-Pfad) ===`);
    for (const t of [...FMP_TICKERS, "BP.L", "ULVR.L"]) {
      const d = JSON.parse(readFileSync(`${PROD_DIR}/${t}.json`, "utf8"));
      check(`${t} (Prod 14:46): isYahooOnly = false → Sektionen unverändert`, isYahooOnly(d) === false, String(d.dataSource));
    }
    console.log(`\n${total - failed}/${total} Checks grün.`);
    process.exit(failed ? 1 : 0);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
