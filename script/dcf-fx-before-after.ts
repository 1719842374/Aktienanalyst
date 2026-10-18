/**
 * DCF-FX Vorher/Nachher über die echte /api/analyze-Route (Express, gemocktes fetch). Kein Test der Suite
 * (braucht die Prod-Payloads), sondern der Generator für die Tabelle im PR-Body.
 *
 * FMP-Mock aus echten Prod-Antworten (POST /api/analyze, 18.10.2026 17:21–17:23 Berlin, PROD_DIR), in das ROHE
 * FMP-Format zurückgerechnet:
 *  - USD (AAPL, MSFT, NVO): unverändert.
 *  - RY.TO: Kurs/MCap/Historie/PT in CAD, Statements USD (so liefert fmp.ts sie, convertFmpRowsToUsd).
 *  - .L (SHEL, ULVR, BP): Prod-Payload ist nach #244 in GBP (Statements GBP) → roh: Kurs/Historie/PT in Pence
 *    (×100), MCap GBP, Statements USD (× GBPUSD).
 *  - Yahoo (VOW3.DE, SAP.DE, BMW.DE): FMP 402. Yahoo-Chart mit der echten Prod-Historie (EUR), meta.currency EUR.
 *    YAHOO_QS=empty (Prod-Realität: quoteSummary leer) oder full (Werte von der Box 18.10. 17:13).
 * FX (FMP-Mock und Yahoo EURUSD=X): Yahoo 18.10.2026 ~17:40 Berlin: EURUSD 1.1242, GBPUSD 1.3329, CADUSD 0.7075.
 *
 * Run: cd $(mktemp -d) && ROOT=<worktree> OUT=/tmp/x.json YAHOO_QS=empty npx tsx <worktree>/script/dcf-fx-before-after.ts
 * Tabelle: npx tsx script/dcf-fx-before-after.ts --table /tmp/main.json /tmp/branch.json
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT ?? path.resolve(HERE, "..");
const OUT = process.env.OUT ?? "";
const PROD_DIR = process.env.PROD_DIR ?? "/workspace/dod-dcf-fx/prod";
const YAHOO_QS = process.env.YAHOO_QS ?? "empty";
export const TICKERS = ["AAPL", "MSFT", "NVO", "SHEL.L", "ULVR.L", "BP.L", "RY.TO", "VOW3.DE", "SAP.DE", "BMW.DE"];
const YAHOO = new Set(["VOW3.DE", "SAP.DE", "BMW.DE"]);
const FX: Record<string, number> = { EUR: 1.1242, GBP: 1.3329, CAD: 0.7075 };
/** Yahoo quoteSummary von der Box (Tester /workspace/dod-252-prod/REPORT.md, 18.10. 17:13). */
const YQS: Record<string, { cap: number; pe: number; eps: number }> = {
  "VOW3.DE": { cap: 34.43e9, pe: 6.58, eps: 10.44 },
  "SAP.DE": { cap: 229_940_576_256, pe: 29.82, eps: 6.68 },
  "BMW.DE": { cap: 34.15e9, pe: 5.49, eps: 10.39 },
};

const VOLATILE = new Set(["priceTimestamp", "dataTimestamp", "catalystsTimestamp", "generatedAt", "asOf"]);
function stripVolatile(v: any): any {
  if (Array.isArray(v)) return v.map(stripVolatile);
  if (v && typeof v === "object") { const o: any = {}; for (const [k, x] of Object.entries(v)) if (!VOLATILE.has(k)) o[k] = stripVolatile(x); return o; }
  return v;
}

async function table(aFile: string, bFile: string) {
  const [a, b] = [aFile, bFile].map((f) => JSON.parse(readFileSync(f, "utf8")));
  const { buildFazitSignal, prepareFazitMetrics } = await import(`${ROOT}/client/src/lib/fazit-signal.ts`);
  const seed = () => { let s = 42; Math.random = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; };
  const fazit = (d: any) => { if (!d || d.dataSource === "yahoo") return "n/a"; try { seed(); const m = prepareFazitMetrics(d); return buildFazitSignal({ data: d, ...m }).rating; } catch (e: any) { return `ERR ${e?.message}`; } };
  const n = (v: any, dg = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(dg) : v === null ? "null" : v === undefined ? "–" : String(v));
  const rows: any[] = [];
  for (const t of TICKERS) {
    const x = a[t]?.body, y = b[t]?.body;
    const pick = (d: any) => ({ ccy: d?.currency, price: n(d?.currentPrice), mcap: d?.marketCap == null ? "null" : (d.marketCap / 1e9).toFixed(1) + "B", pe: n(d?.peRatio, 1), eps: n(d?.epsTTM), score: n(d?.biasFix?.overallScore), dps: n(d?.biasFix?.decisionPerShare), up: n(d?.biasFix?.decisionUpsidePct, 1), head: d?.execSummary?.headline ?? "–", rating: d?.biasFix?.overallRating ?? "n/a", fazit: fazit(d), dcf: n(d?.dcfFairValue), maxEntry: n(d?.maxEntryCrv3), crv: n(d?.crvBase), fwdPE: n(d?.forwardPE, 1), pt: n(d?.analystPT?.median), fx: d?.currencyInfo ? `${d.currencyInfo.fxPair} ${d.currencyInfo.fxRate} ${d.currencyInfo.converted ? "conv" : "NICHT conv"}` : "–" });
    const same = JSON.stringify(stripVolatile(x)) === JSON.stringify(stripVolatile(y));
    rows.push({ t, before: pick(x), after: pick(y), byteSame: same });
  }
  console.log(JSON.stringify(rows, null, 1));
}

if (process.argv[2] === "--table") {
  table(process.argv[3], process.argv[4]).then(() => process.exit(0));
} else {
  run().catch((e) => { console.error(e); process.exit(1); });
}

async function run() {
  process.env.FMP_API_KEY = "test-key";
  process.env.FMP_MIN_INTERVAL_MS = "0";
  process.env.YAHOO_MIN_INTERVAL_MS = "0";
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  const prod: Record<string, any> = {};
  for (const t of TICKERS) {
    const f = `${PROD_DIR}/${t}.json`;
    if (!existsSync(f)) { console.error(`fehlt: ${f}`); process.exit(2); }
    prod[t] = JSON.parse(readFileSync(f, "utf8"));
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const isL = (t: string) => t.endsWith(".L");

  function fmpMock(p: string, sym: string, qs: URLSearchParams): Response {
    if (/^[A-Z]{3}USD$/.test(sym)) { const r = FX[sym.slice(0, 3)]; return r ? json([{ symbol: sym, price: r }]) : json([]); }
    const d = prod[sym];
    if (!d || YAHOO.has(sym)) return json({ "Error Message": "Premium Query Parameter" }, 402);
    // Roh-Einheiten: .L Kurs in Pence, Statements USD; sonst wie im Payload.
    const px = isL(sym) ? 100 : 1;
    const st = isL(sym) ? FX.GBP : 1;
    const listing = isL(sym) ? "GBp" : d.currency;
    const fs = d.financialStatements ?? {};
    const inc = fs.incomeStatement ?? {}, bs = fs.balanceSheet ?? {}, cf = fs.cashFlow ?? {};
    const rev0 = d.revenue * st, rev1 = rev0 / (1 + (inc.revenueGrowth ?? 0) / 100);
    const quarter = qs.get("period") === "quarter";
    const yearRows = (n: number, mk: (i: number, f: number) => any) => Array.from({ length: n }, (_, i) => mk(i, Math.pow(0.95, i)));
    switch (p) {
      case "/quote": return json([{ symbol: sym, price: d.currentPrice * px, marketCap: d.marketCap, yearHigh: d.yearHigh * px, yearLow: d.yearLow * px }]);
      case "/profile": return json([{ symbol: sym, companyName: d.companyName, currency: listing, exchange: d.exchange, sector: d.sector, industry: d.industry, description: d.description, beta: d.beta5Y, marketCap: d.marketCap, price: d.currentPrice * px, sharesOutstanding: d.sharesOutstanding, country: d.country }]);
      case "/income-statement":
        if (quarter) return json(yearRows(16, (i, f) => ({ date: `Q${i}`, revenue: (rev0 / 4) * f })));
        return json(yearRows(3, (i, f) => ({ date: `${2025 - i}-12-31`, fiscalYear: String(2025 - i), period: "FY", revenue: i === 0 ? rev0 : rev1 * Math.pow(0.97, i - 1), grossProfit: d.grossProfit * st * f, operatingIncome: d.operatingIncome * st * f, netIncome: d.netIncome * st * f, ebitda: d.ebitda * st * f, epsDiluted: d.epsTTM * st * f, weightedAverageShsOutDil: d.sharesOutstanding })));
      case "/cash-flow-statement":
        return json(yearRows(3, (i, f) => ({ date: `${2025 - i}-12-31`, operatingCashFlow: (cf.operatingCashFlow ?? d.fcfTTM) * st * f, capitalExpenditure: -(cf.capex ?? 0) * st * f, freeCashFlow: d.fcfTTM * st * f })));
      case "/balance-sheet-statement":
        return json(yearRows(2, (i, f) => ({ date: `${2025 - i}-12-31`, totalDebt: d.totalDebt * st * f, cashAndCashEquivalents: d.cashEquivalents * st * f, totalStockholdersEquity: d.totalEquity * st * f, totalAssets: d.totalAssets * st * f, totalCurrentAssets: (bs.totalAssets ?? 0) * st * 0.3 * f, totalCurrentLiabilities: (bs.totalLiabilities ?? 0) * st * 0.25 * f, inventory: 1e9 * f })));
      case "/price-target-consensus": return json([{ symbol: sym, targetMedian: (d.analystPT?.median ?? 0) * px, targetHigh: (d.analystPT?.high ?? 0) * px, targetLow: (d.analystPT?.low ?? 0) * px, numberOfAnalysts: d.analystPT?.count ?? 0 }]);
      case "/historical-price-eod/full": {
        const rows = (d.ohlcvData ?? d.historicalPrices).map((r: any) => ({ date: r.date, open: (r.open ?? r.close) * px, high: (r.high ?? r.close) * px, low: (r.low ?? r.close) * px, close: r.close * px, volume: r.volume ?? 1 }));
        return json([...rows].reverse());
      }
      case "/ratios": return json([{ priceToEarningsRatio: d.peRatio, returnOnEquity: d.returnOnEquity, priceToBookRatio: d.pbRatio, enterpriseValueMultiple: d.evEbitda, dividendYield: (d.dividendYield ?? 0) / 100 }]);
      default: return json([]);
    }
  }

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url ?? input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    if (url.includes("financialmodelingprep.com")) {
      const u = new URL(url);
      return fmpMock(u.pathname.replace(/^\/stable/, ""), u.searchParams.get("symbol") ?? "", u.searchParams);
    }
    if (url.includes("yahoo.com")) {
      if (url.includes("fc.yahoo.com")) return new Response("", { status: 404, headers: { "set-cookie": "A3=test; Domain=.yahoo.com" } });
      if (url.includes("getcrumb")) return YAHOO_QS === "empty" ? new Response("", { status: 401 }) : new Response("crumbXYZ", { status: 200 });
      const sym = decodeURIComponent((url.match(/\/(?:chart|quoteSummary)\/([^?]+)/) ?? [])[1] ?? "");
      const fxm = /^([A-Z]{3})USD=X$/.exec(sym);
      if (fxm) return FX[fxm[1]] ? json({ chart: { result: [{ meta: { currency: "USD", regularMarketPrice: FX[fxm[1]] }, timestamp: [], indicators: { quote: [{}] } }] } }) : json({}, 404);
      const d = prod[sym];
      if (!d || !YAHOO.has(sym)) return json({ chart: { result: null, error: { code: "Not Found" } } }, 404);
      const bars = d.historicalPrices as any[];
      const last = bars[bars.length - 1].close;
      if (url.includes("quoteSummary")) {
        if (YAHOO_QS === "empty") return json({ quoteSummary: { result: null, error: { code: "Unauthorized" } } }, 401);
        const q = YQS[sym];
        return json({ quoteSummary: { result: [{ price: { regularMarketPrice: { raw: +last.toFixed(2) }, marketCap: { raw: q.cap }, currency: "EUR", longName: d.companyName, exchangeName: "GER" }, summaryDetail: { trailingPE: { raw: q.pe } }, defaultKeyStatistics: { trailingEps: { raw: q.eps } } }] } });
      }
      const ts = bars.map((b) => Math.floor(Date.parse(b.date + "T12:00:00Z") / 1000));
      const c = bars.map((b) => b.close);
      return json({ chart: { result: [{ meta: { currency: "EUR", regularMarketPrice: last, longName: d.companyName, fullExchangeName: "XETRA" }, timestamp: ts, indicators: { quote: [{ open: c, high: c, low: c, close: c, volume: ts.map(() => 1) }] } }] } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const express = (await import("express")).default;
  const { registerAnalyzeRoute } = await import(`${ROOT}/server/analyze-route.ts`);
  const app = express();
  app.use(express.json());
  const server = app.listen(0);
  registerAnalyzeRoute(server, app);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  const out: Record<string, { status: number; body: any }> = {};
  for (const t of TICKERS) {
    const r = await realFetch(`http://127.0.0.1:${port}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: t, useLLM: false, force: true }) });
    out[t] = { status: r.status, body: await r.json() };
    console.log(`[harness] ${t}: HTTP ${r.status} ${out[t].body?.currency} ${out[t].body?.currentPrice}`);
  }
  server.close();
  if (OUT) writeFileSync(OUT, JSON.stringify(out));
  process.exit(0);
}
