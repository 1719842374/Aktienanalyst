/**
 * #326 Guard: negativer FCF → Server-DCF n/a (null) mit Grund „negativer FCF“ statt erfundener 0.
 * Echte /api/analyze-Route (Express) mit gemocktem FMP aus echten Prod-Payloads
 * (script/fixtures/prod-analyze-dcf-2026-10-25.json, Prod 25.10.2026, Felder unverändert). Kein FMP-Key nötig.
 * VWAGY = FMP-Datenquelle von VOW3.DE (ADR-Proxy, FCF-TTM −10,06 Mrd. USD), SAP = Quelle von SAP.DE, MSFT = Kontrolle.
 * Score/Rating müssen exakt den Werten des alten Heads entsprechen (expectOldHead, gemessen mit derselben Route-Harness).
 * Negativkontrolle: auf dem alten Head (dcfFairValue = 0) Exit 1, auf dem neuen Exit 0.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-dcf-negative-fcf-na.ts
 *   ROOT=/pfad OUT=/tmp/x.json NO_ASSERT=1 … (nur Ausgabe, z. B. für den alten Head)
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.ROOT ?? path.resolve(HERE, "..");
const OUT = process.env.OUT ?? "";
const FIX = JSON.parse(readFileSync(path.join(HERE, "fixtures/prod-analyze-dcf-2026-10-25.json"), "utf8"));
const TICKERS = ["VWAGY", "SAP", "MSFT"];

let failed = 0, total = 0;
function check(name: string, ok: boolean, detail = "") {
  total++;
  if (ok) console.log(`  ✅ ${name}${detail ? ` (${detail})` : ""}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

process.env.FMP_API_KEY = "test-key";
process.env.FMP_MIN_INTERVAL_MS = "0";
process.env.YAHOO_MIN_INTERVAL_MS = "0";
delete process.env.OPENROUTER_API_KEY;
delete process.env.PERPLEXITY_API_KEY;

const prod: Record<string, any> = FIX.prod;
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

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input?.url ?? input);
  if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
  if (url.includes("financialmodelingprep.com")) {
    const u = new URL(url);
    return fmpMock(u.pathname.replace(/^\/stable/, ""), u.searchParams.get("symbol") ?? "", u.searchParams);
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const pick = (b: any) => ({ dcfFairValue: b?.dcfFairValue, dcfNaReason: b?.dcfNaReason ?? null, finalScore: b?.scoring?.finalScore, overallScore: b?.biasFix?.overallScore, overallRating: b?.biasFix?.overallRating, execFv: b?.execSummary ? "present" : null });

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
  for (const t of TICKERS) {
    const r = await realFetch(`http://127.0.0.1:${port}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: t, useLLM: false, force: true }) });
    out[t] = { status: r.status, body: await r.json() };
    console.log(`[harness] ${t}: HTTP ${r.status} ${JSON.stringify(pick(out[t].body))}`);
  }
  server.close();
  if (OUT) writeFileSync(OUT, JSON.stringify(Object.fromEntries(TICKERS.map(t => [t, pick(out[t].body)]))));
  if (process.env.NO_ASSERT) process.exit(0);

  const vw = out.VWAGY.body;
  console.log("\n=== VWAGY (Quelle VOW3.DE): negativer FCF ===");
  check("Payload-FCF-TTM ist negativ (echte Prod-Zahl)", prod.VWAGY.fcfTTM < 0, String(prod.VWAGY.fcfTTM));
  check("HTTP 200, dataSource fmp", out.VWAGY.status === 200 && vw.dataSource === "fmp", `${out.VWAGY.status} ${vw.dataSource}`);
  check("dcfFairValue = null (n/a), nicht 0", vw.dcfFairValue === null, String(vw.dcfFairValue));
  check("dcfNaReason = „negativer FCF“", vw.dcfNaReason === "negativer FCF", String(vw.dcfNaReason));
  check("upsidePotential unverändert = Analystenziel-Fallback", vw.upsidePotential === Math.round((prod.VWAGY.analystPT.median / vw.currentPrice - 1) * 1000) / 10, String(vw.upsidePotential));

  console.log("\n=== Kontrolle SAP / MSFT (positiver FCF) ===");
  for (const t of ["SAP", "MSFT"]) {
    const b = out[t].body;
    check(`${t}: dcfFairValue Zahl > 0, kein dcfNaReason-Feld`, typeof b.dcfFairValue === "number" && b.dcfFairValue > 0 && !("dcfNaReason" in b), String(b.dcfFairValue));
  }

  console.log("\n=== Score/Rating exakt wie alter Head (keine Wirkung über n/a hinaus) ===");
  for (const t of TICKERS) {
    const now = pick(out[t].body), old = FIX.expectOldHead[t];
    for (const k of ["finalScore", "overallScore", "overallRating"] as const) check(`${t}: ${k} = alter Head`, now[k] === old[k], `${now[k]} / ${old[k]}`);
    if (t !== "VWAGY") check(`${t}: dcfFairValue = alter Head`, now.dcfFairValue === old.dcfFairValue, `${now.dcfFairValue} / ${old.dcfFairValue}`);
  }

  console.log("\n=== Fazit/PDF/Chat-Kette: Exec-Summary ohne Bias-Wert fällt nicht auf 0 ===");
  const { buildExecSummaryInputFromAnalysis } = await import(`${ROOT}/server/exec-summary-attach.ts`);
  const noBias = buildExecSummaryInputFromAnalysis({ ...vw, biasFix: undefined });
  check("dcfConservative = null (nicht 0), wenn kein Bias-Entscheidungswert", noBias.dcfConservative === null, String(noBias.dcfConservative));
  const withBias = buildExecSummaryInputFromAnalysis(vw);
  check("mit Bias-Wert: Fazit-Basis unverändert = biasFix.decisionPerShare", withBias.dcfConservative === vw.biasFix?.decisionPerShare, `${withBias.dcfConservative}`);

  console.log(`\n${total - failed}/${total} Checks grün.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
