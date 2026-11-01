/**
 * SHEL.L: beide Datenpfade in GBP, plus VOW3/SAP/MSFT Δ0 auf dem Fixture-Cache.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-shel-gbp-paths.ts
 *
 * Pfad FMP: Quote in GBp, Statements in USD, FX GBPUSD aus dem gemockten FMP-Quote (Quelle, kein fester Kurs).
 * Pfad FMP-402 → Yahoo (barsInMajor): Kurs schon in Pence, Bars nach yahooBarsToMajor in Pfund.
 *   Statements, die auf diesem Shape in USD liegen, müssen mit demselben FX nach GBP.
 * Kontrolle: script/fixtures/prod-analyze-dcf-2026-10-25.json expectOldHead.
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeListingToUsd } from "../shared/listing-units";
import { fazitEntryForExport } from "../shared/fazit-entry";
import { statementCurrency } from "../shared/currency-format";
import { buildBiasDecision } from "../shared/bias-fixes";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(path.join(HERE, "fixtures/prod-analyze-dcf-2026-10-25.json"), "utf8"));
const FX = 1.3329; // kommt im Test aus der Quelle (FMP-Quote GBPUSD), nicht aus dem Produktionscode
const PENCE = 3938;
const POUNDS = 39.38;
const MCAP = 224e9;
const REV_USD = 272e9;
const FCF_USD = 22_224_699_000;
const EPS_USD = 3.06;
const SHARES = Math.round(MCAP / POUNDS);

let failed = 0, total = 0;
function check(name: string, ok: boolean, detail = "") {
  total++;
  if (ok) console.log(`  ✅ ${name}${detail ? ` (${detail})` : ""}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const near = (a: unknown, b: number, eps = 1e-6) => typeof a === "number" && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

console.log("\n=== barsInMajor: Statements USD → GBP mit dem übergebenen FX ===");
const yahooShape: any = normalizeListingToUsd({
  quote: { price: PENCE, eps: 3.38, pe: 11.65, marketCap: MCAP, currency: "GBp" },
  profile: { currency: "GBp", price: PENCE, marketCap: MCAP },
  ohlcv: [{ close: POUNDS, open: POUNDS, high: POUNDS, low: POUNDS, volume: 10 }],
  financials: {
    income: [{ reportedCurrency: "USD", revenue: REV_USD, eps: EPS_USD, epsDiluted: EPS_USD }],
    cashflow: [{ reportedCurrency: "USD", freeCashFlow: FCF_USD }],
    balanceSheet: [{ reportedCurrency: "USD", totalDebt: 104e9, cashAndCashEquivalents: 30e9 }],
  },
  analyst: { estimates: [{ reportedCurrency: "USD", epsAvg: 6.05 }], priceTarget: { targetMedian: 4500 } },
} as any, FX, ["revenue", "eps", "epsDiluted", "freeCashFlow", "totalDebt", "cashAndCashEquivalents", "epsAvg"], { barsInMajor: true });
check("Yahoo-Shape: Kurs 3938 GBp → 39.38 GBP, Bars bleiben Pfund", near(yahooShape.quote.price, POUNDS) && near(yahooShape.ohlcv[0].close, POUNDS) && yahooShape.profile.currency === "GBP", `price=${yahooShape.quote.price} bar=${yahooShape.ohlcv[0].close} ccy=${yahooShape.profile.currency}`);
check("Yahoo-Shape: Statement-Umsatz USD/FX, Währung GBP", near(yahooShape.financials.income[0].revenue, REV_USD / FX) && yahooShape.financials.income[0].reportedCurrency === "GBP", `rev=${yahooShape.financials.income[0].revenue} ccy=${yahooShape.financials.income[0].reportedCurrency}`);
check("Yahoo-Shape: FCF und EPS ebenfalls /FX (dieselbe Quelle)", near(yahooShape.financials.cashflow[0].freeCashFlow, FCF_USD / FX) && near(yahooShape.financials.income[0].eps, EPS_USD / FX));
check("Yahoo-Shape: Schätzung epsAvg /FX", near(yahooShape.analyst.estimates[0].epsAvg, 6.05 / FX));
check("Yahoo-Shape: Quote-EPS bleibt Pfund (3.38), nicht /FX", yahooShape.quote.eps === 3.38, String(yahooShape.quote.eps));
check("Yahoo-Shape: Zeile in EUR ohne _fxConverted bleibt stehen", (() => {
  const eur = normalizeListingToUsd({
    quote: { price: PENCE, currency: "GBp" }, profile: { currency: "GBp", price: PENCE },
    ohlcv: [{ close: POUNDS }],
    financials: { income: [{ reportedCurrency: "EUR", revenue: 100 }], cashflow: [], balanceSheet: [] },
    analyst: { estimates: [] },
  } as any, FX, ["revenue"], { barsInMajor: true });
  return (eur as any).financials.income[0].revenue === 100;
})());

process.env.FMP_API_KEY = "test-key";
process.env.FMP_MIN_INTERVAL_MS = "0";
process.env.YAHOO_MIN_INTERVAL_MS = "0";
delete process.env.OPENROUTER_API_KEY;
delete process.env.PERPLEXITY_API_KEY;

const prod: Record<string, any> = FIX.prod;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
type Mode = "controls" | "fmp" | "yahoo";
let mode: Mode = "controls";

function shelBars(pence: boolean) {
  const day = 86400;
  const now = Math.floor(Date.now() / 1000);
  const n = 320;
  const px = pence ? PENCE : POUNDS;
  return {
    ts: Array.from({ length: n }, (_, i) => now - (n - i) * day),
    px,
  };
}

function fmpMock(pathname: string, sym: string, qs: URLSearchParams): Response {
  if (sym === "GBPUSD") return json([{ symbol: sym, price: FX }]);
  if (/^[A-Z]{3}USD$/.test(sym)) return json([{ symbol: sym, price: 1 }]);
  if (sym === "SHEL.L") {
    if (mode === "yahoo") return json({ "Error Message": "Premium Query Parameter" }, 402);
    if (pathname === "/quote") return json([{ symbol: sym, price: PENCE, marketCap: MCAP, pe: 11.93, yearHigh: 4000, yearLow: 2500 }]);
    if (pathname === "/profile") return json([{ symbol: sym, companyName: "Shell plc", currency: "GBp", exchange: "LSE", sector: "Energy", industry: "Oil & Gas Integrated", description: "Integrated oil and gas producer with upstream and marketing operations.", beta: 0.42, marketCap: MCAP, sharesOutstanding: SHARES, price: PENCE, country: "GB" }]);
    if (pathname === "/income-statement") {
      if (qs.get("period") === "quarter") return json(Array.from({ length: 8 }, (_, i) => ({ date: `2024-0${(i % 4) + 1}-01`, revenue: REV_USD / 4, reportedCurrency: "USD" })));
      return json([0, 1, 2].map(i => ({ date: `${2025 - i}-12-31`, fiscalYear: String(2025 - i), period: "FY", reportedCurrency: "USD", revenue: REV_USD * Math.pow(0.97, i), grossProfit: 80e9, operatingIncome: 40e9, netIncome: 18e9, ebitda: 55e9, eps: EPS_USD, epsDiluted: EPS_USD, weightedAverageShsOutDil: SHARES })));
    }
    if (pathname === "/cash-flow-statement") return json([0, 1, 2].map(i => ({ date: `${2025 - i}-12-31`, reportedCurrency: "USD", operatingCashFlow: 40e9, capitalExpenditure: -18e9, freeCashFlow: FCF_USD * Math.pow(0.97, i) })));
    if (pathname === "/balance-sheet-statement") return json([0, 1].map(i => ({ date: `${2025 - i}-12-31`, reportedCurrency: "USD", totalDebt: 104e9, cashAndCashEquivalents: 30e9, totalStockholdersEquity: 180e9, totalAssets: 400e9, totalCurrentAssets: 90e9, totalCurrentLiabilities: 70e9 })));
    if (pathname === "/historical-price-eod/full") {
      const { ts } = shelBars(true);
      return json(ts.slice().reverse().map(t => ({ date: new Date(t * 1000).toISOString().slice(0, 10), open: PENCE, high: PENCE, low: PENCE, close: PENCE, volume: 1e6 })));
    }
    if (pathname === "/ratios") return json([{ priceToEarningsRatio: 11.93, returnOnEquity: 0.1, priceToBookRatio: 1.2, enterpriseValueMultiple: 5, dividendYield: 0.039 }]);
    if (pathname === "/price-target-consensus") return json([{ targetMedian: 0, targetHigh: 0, targetLow: 0 }]);
    return json([]);
  }
  const d = prod[sym];
  if (!d) return json({ "Error Message": "Premium Query Parameter" }, 402);
  const fs = d.financialStatements ?? {};
  const inc = fs.incomeStatement ?? {}, bs = fs.balanceSheet ?? {}, cf = fs.cashFlow ?? {};
  const rev0 = d.revenue, rev1 = rev0 / (1 + (inc.revenueGrowth ?? 0) / 100);
  const yearRows = (n: number, mk: (i: number, f: number) => any) => Array.from({ length: n }, (_, i) => mk(i, Math.pow(0.95, i)));
  switch (pathname) {
    case "/quote": return json([{ symbol: sym, price: d.currentPrice, marketCap: d.marketCap, pe: d.peRatio, eps: d.epsTTM, yearHigh: d.yearHigh, yearLow: d.yearLow }]);
    case "/profile": return json([{ symbol: sym, companyName: d.companyName, currency: d.currency, exchange: d.exchange, sector: d.sector, industry: d.industry, description: d.description, beta: d.beta5Y, marketCap: d.marketCap, sharesOutstanding: d.sharesOutstanding, country: d.country }]);
    case "/income-statement":
      if (qs.get("period") === "quarter") return json(yearRows(16, (i, f) => ({ date: `Q${i}`, revenue: (rev0 / 4) * f })));
      return json(yearRows(3, (i, f) => ({ date: `${2025 - i}-12-31`, fiscalYear: String(2025 - i), period: "FY", revenue: i === 0 ? rev0 : rev1 * Math.pow(0.97, i - 1), grossProfit: d.grossProfit * f, operatingIncome: d.operatingIncome * f, netIncome: d.netIncome * f, ebitda: d.ebitda * f, epsDiluted: d.epsAdjFY * f, weightedAverageShsOutDil: d.sharesOutstanding })));
    case "/cash-flow-statement":
      return json(yearRows(3, (i, f) => ({ date: `${2025 - i}-12-31`, operatingCashFlow: (cf.operatingCashFlow ?? d.fcfTTM) * f, capitalExpenditure: -(cf.capex ?? 0) * f, freeCashFlow: d.fcfTTM * f })));
    case "/balance-sheet-statement":
      return json(yearRows(2, (i, f) => ({ date: `${2025 - i}-12-31`, totalDebt: d.totalDebt * f, cashAndCashEquivalents: d.cashEquivalents * f, totalStockholdersEquity: d.totalEquity * f, totalAssets: d.totalAssets * f, totalCurrentAssets: (bs.totalAssets ?? 0) * 0.3 * f, totalCurrentLiabilities: (bs.totalLiabilities ?? 0) * 0.25 * f, inventory: 1e9 * f })));
    case "/price-target-consensus": return json([{ symbol: sym, targetMedian: d.analystPT?.median ?? 0, targetHigh: d.analystPT?.high ?? 0, targetLow: d.analystPT?.low ?? 0 }]);
    case "/historical-price-eod/full": {
      const rows = (d.ohlcvData ?? d.historicalPrices).map((r: any) => ({ date: r.date, open: r.open ?? r.close, high: r.high ?? r.close, low: r.low ?? r.close, close: r.close, volume: r.volume ?? 1 }));
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
  if (url.includes("yahoo.com") && mode === "yahoo") {
    if (url.includes("fc.yahoo.com")) return new Response("", { status: 404, headers: { "set-cookie": "A3=t; Domain=.yahoo.com" } });
    if (url.includes("getcrumb")) return new Response("crumb", { status: 200 });
    const sym = decodeURIComponent((url.match(/\/(?:chart|quoteSummary)\/([^?]+)/) ?? [])[1] ?? "");
    if (sym !== "SHEL.L") return json({ chart: { result: null } }, 404);
    if (url.includes("quoteSummary")) {
      return json({ quoteSummary: { result: [{ price: { regularMarketPrice: { raw: PENCE }, marketCap: { raw: MCAP }, currency: "GBp", longName: "Shell plc", exchangeName: "LSE" }, summaryDetail: { trailingPE: { raw: 11.65 } }, defaultKeyStatistics: { trailingEps: { raw: 3.38 } } }] } });
    }
    const { ts, px } = shelBars(true);
    return json({ chart: { result: [{ meta: { currency: "GBp", longName: "Shell plc", exchangeName: "LSE", regularMarketPrice: px }, timestamp: ts, indicators: { quote: [{ open: ts.map(() => px), high: ts.map(() => px), low: ts.map(() => px), close: ts.map(() => px), volume: ts.map(() => 1) }] } }] } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

function reportShel(label: string, body: any) {
  const entry = fazitEntryForExport(body);
  const routeScore = body?.biasFix?.overallScore;
  let decided = routeScore;
  if (typeof decided !== "number") {
    try { decided = buildBiasDecision(body).overallScore; } catch { decided = undefined; }
  }
  console.log(`[harness] ${label}: currency=${body?.currency} price=${body?.currentPrice} fcf=${body?.fcfTTM} rev=${body?.revenue} dcf=${body?.dcfFairValue} stmt=${statementCurrency(body)} entry=${entry?.label ?? "null"} routeScore=${routeScore ?? "—"} score=${typeof decided === "number" ? decided.toFixed(12) : decided} src=${body?.dataSource}`);
  check(`${label}: Währung GBP`, body?.currency === "GBP" && statementCurrency(body) === "GBP", `${body?.currency} / ${statementCurrency(body)}`);
  check(`${label}: Kurs in Pfund (39.38), nicht USD`, near(body?.currentPrice, POUNDS, 1e-6), String(body?.currentPrice));
  check(`${label}: Entry-Währung GBP und Symbol £`, entry?.currency === "GBP" && typeof entry?.label === "string" && entry.label.startsWith("£"), entry?.label ?? "null");
  check(`${label}: overallScore endlich`, typeof decided === "number" && Number.isFinite(decided), String(decided));
  return { entry, score: decided, routeScore, body };
}

(async () => {
  const express = (await import("express")).default;
  const { registerAnalyzeRoute } = await import("../server/analyze-route.ts");
  const app = express();
  app.use(express.json());
  const server = app.listen(0);
  registerAnalyzeRoute(server, app);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  const post = async (ticker: string) => {
    const r = await realFetch(`http://127.0.0.1:${port}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker, useLLM: false, force: true }) });
    return { status: r.status, body: await r.json() };
  };

  console.log("\n=== Kontrolle VOW3/SAP/MSFT, gleicher Fixture-Cache ===");
  mode = "controls";
  const controls = ["VWAGY", "SAP", "MSFT"] as const;
  for (const t of controls) {
    const res = await post(t);
    const now = res.body?.biasFix?.overallScore;
    const old = FIX.expectOldHead[t].overallScore;
    console.log(`[harness] ${t}: ${typeof now === "number" ? now.toFixed(6) : now} (Baseline ${old.toFixed(6)})`);
    check(`${t}: HTTP 200`, res.status === 200, String(res.status));
    check(`${t}: overallScore Δ0`, now === old, `${now} / ${old}`);
    check(`${t}: finalScore Δ0`, res.body?.scoring?.finalScore === FIX.expectOldHead[t].finalScore, `${res.body?.scoring?.finalScore} / ${FIX.expectOldHead[t].finalScore}`);
    if (t !== "VWAGY") check(`${t}: dcfFairValue Δ0`, res.body?.dcfFairValue === FIX.expectOldHead[t].dcfFairValue, `${res.body?.dcfFairValue} / ${FIX.expectOldHead[t].dcfFairValue}`);
  }

  console.log("\n=== SHEL.L FMP ===");
  mode = "fmp";
  const fmp = await post("SHEL.L");
  check("FMP: HTTP 200, Quelle fmp", fmp.status === 200 && fmp.body?.dataSource === "fmp", `${fmp.status} ${fmp.body?.dataSource} ${fmp.body?.error ?? ""}`);
  const fmpR = reportShel("FMP", fmp.body);
  check("FMP: Umsatz und FCF in GBP (USD/FX aus GBPUSD-Quote)", near(fmp.body?.revenue, REV_USD / FX) && near(fmp.body?.fcfTTM, FCF_USD / FX), `rev=${fmp.body?.revenue} fcf=${fmp.body?.fcfTTM}`);
  check("FMP: DCF 31.32 GBP (nicht die USD-Größenordnung)", fmp.body?.dcfFairValue === 31.32, String(fmp.body?.dcfFairValue));
  check("FMP: Entry £34.68", fmpR.entry?.label === "£34.68", fmpR.entry?.label ?? "null");
  check("FMP: overallScore 6.490000 aus der Route", fmpR.routeScore === 6.49, String(fmpR.routeScore));

  console.log("\n=== SHEL.L FMP 402 → Yahoo ===");
  mode = "yahoo";
  const yh = await post("SHEL.L");
  check("Yahoo: HTTP 200, Quelle yahoo", yh.status === 200 && yh.body?.dataSource === "yahoo", `${yh.status} ${yh.body?.dataSource} ${yh.body?.error ?? ""}`);
  const yhR = reportShel("Yahoo", yh.body);
  check("Yahoo: kein USD-DCF neben GBP-Kurs (yahooOnly → n/a, nicht eine USD-Zahl)", yh.body?.dcfFairValue == null, String(yh.body?.dcfFairValue));
  check("Yahoo: Route ohne biasFix (yahooOnly, keine Statements)", yhR.routeScore == null, String(yhR.routeScore));
  check("Yahoo: Entry £17.06", yhR.entry?.label === "£17.06", yhR.entry?.label ?? "null");
  check("Yahoo: overallScore 0.213000 über buildBiasDecision (dieselbe Formel)", yhR.score === 0.21300000000000008, String(yhR.score));

  server.close();
  console.log(`\n${total - failed}/${total} Checks grün.`);
  if (fmpR.score != null) console.log(`SCORE FMP ${fmpR.score.toFixed(6)} Yahoo ${yhR?.score?.toFixed?.(6)}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
