/**
 * Score-Ergänzungen hinter dem Flag `scoringAdditions` (Default AUS).
 *
 * Flag AUS: VOW3 4.735718, SAP 5.174758, MSFT 4.058138 — exakt der Pin
 * (script/fixtures/prod-analyze-dcf-2026-10-25.json, expectOldHead).
 * Flag AN: Moat-Rivalitäts-Dämpfung, Hybrid-Anteile, Earnings Yield, Accruals.
 * Fehlende Daten bleiben „n/a“, nie 0.
 *
 * Ausführen: npx tsx script/test-scoring-additions.ts
 */
import { readFileSync } from "fs";
import type { StockAnalysis } from "../shared/schema";
import { buildBiasDecision } from "../shared/bias-fixes";
import {
  accrualsRatio,
  applyMoatRivalryToScore,
  classifyHybrid,
  distributionStats,
  earningsYield,
  evaluateMoatRivalryDamping,
  scoringAdditionsEnabled,
  scoringAdditionsFromAnalysis,
  segmentLynchClass,
  MOAT_RIVALRY_DAMPING_SPAN,
} from "../shared/scoring-additions";

let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const pin = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
const EXPECTED: Record<string, string> = { VWAGY: "4.735718", SAP: "5.174758", MSFT: "4.058138" };

console.log("\n=== Flag AUS: Pin bleibt exakt ===");
for (const [ticker, score] of Object.entries(EXPECTED)) {
  check(`${ticker} Pin ${score}`, Number(pin[ticker].overallScore).toFixed(6) === score, String(pin[ticker].overallScore));
}
check("Flag fehlt → aus", scoringAdditionsEnabled({}) === false);
check("Flag false → aus", scoringAdditionsEnabled({ body: { scoringAdditions: false } }) === false);
check("Flag true → an", scoringAdditionsEnabled({ body: { scoringAdditions: true } }) === true);
check("Env leer → aus", scoringAdditionsEnabled({ env: undefined }) === false);
check("Env 1 → an", scoringAdditionsEnabled({ body: {}, env: "1" }) === true);

console.log("\n=== Verteilung: Schwellen aus den Daten ===");
{
  const stats = distributionStats([1, 2, 3, 4, 10], 4);
  check("Median der Stichprobe ist 3", stats.median === 3, String(stats.median));
  check("Perzentil zählt nur Werte ≤ Referenz", stats.percentile === 0.8, String(stats.percentile));
  const mean = (1 + 2 + 3 + 4 + 10) / 5;
  check("z-Score = (Referenz − Mittel) / Streuung", stats.zScore != null && Math.abs(stats.zScore - (4 - mean) / Math.sqrt([1, 2, 3, 4, 10].reduce((s, v) => s + (v - mean) ** 2, 0) / 5)) < 1e-9, String(stats.zScore));
  check("leere Stichprobe → kein Median", distributionStats([], 4).median == null);
}

console.log("\n=== Hybrid: Anteile aus Segmenten, keine feste 20-%-Schwelle ===");
{
  const tsla = classifyHybrid({
    fallbackClass: "cyclical",
    segments: [
      { name: "Automotive", percentage: 55, growth: 5 },
      { name: "Energy", percentage: 45, growth: 40 },
    ],
  });
  check("dominante Klasse bleibt der Firmen-Fallback", tsla.dominant?.lynchClass === "cyclical", tsla.label ?? "");
  check("über dem Median der eigenen Anteile erscheint die zweite Klasse", tsla.secondary?.lynchClass === "fast_grower", JSON.stringify(tsla.shares));
  check("Label nennt beide", tsla.label === "Zykliker / Fast Grower", tsla.label ?? "");
  const xpeng = classifyHybrid({
    fallbackClass: "cyclical",
    segments: [
      { name: "Fahrzeuge", percentage: 50, growth: 6 },
      { name: "Services", percentage: 10, growth: 30 },
      { name: "Software", percentage: 25, growth: 6 },
      { name: "Komponenten", percentage: 15, growth: -5 },
    ],
  });
  check("Nebenklasse über dem Median der kleineren Klassen wird sichtbar", xpeng.secondary?.lynchClass === "turnaround", `${xpeng.label} ${JSON.stringify(xpeng.shares)}`);
  check("Nebenklasse unter diesem Median bleibt unsichtbar", !xpeng.shares.some(s => s.lynchClass === "fast_grower" && xpeng.secondary?.lynchClass === "fast_grower"));
  check("ein Segment → n/a, kein erfundener Anteil", classifyHybrid({ fallbackClass: "cyclical", segments: [{ name: "Auto", percentage: 100, growth: 5 }] }).reason === "n/a — weniger als zwei Umsatzsegmente");
  check("ohne Lynch-Klasse → n/a", classifyHybrid({ fallbackClass: null, segments: [{ name: "A", percentage: 50, growth: 1 }, { name: "B", percentage: 50, growth: 2 }] }).reason === "n/a — Lynch-Klasse fehlt");
  check("Wachstum über dem Segment-Median → Fast Grower", segmentLynchClass(40, 5, "cyclical") === "fast_grower");
  check("ohne Wachstum → Firmenklasse", segmentLynchClass(null, 5, "cyclical") === "cyclical");
}

console.log("\n=== Moat-Rivalität: nur schwach + über dem Porter-Median ===");
{
  const forces = [
    { force: "Rivalität unter Wettbewerbern", score: 5 },
    { name: "Neueinsteiger", score: 2 },
    { name: "Lieferanten", score: 2 },
    { name: "Kunden", score: 3 },
    { name: "Substitute", score: 2 },
  ];
  const weak = evaluateMoatRivalryDamping({ moatRating: "None", moatScore: 1, porterForces: forces, description: "automotive" });
  check("None + Rivalität über Median dämpft", weak.available && weak.factor < 1 && weak.factor >= 1 - MOAT_RIVALRY_DAMPING_SPAN, String(weak.factor));
  check("Begründung nennt die Dämpfung", weak.detail.includes("gedämpft"));
  const wide = evaluateMoatRivalryDamping({ moatRating: "Wide", moatScore: 8, porterForces: forces, description: "software" });
  check("Wide bleibt unberührt", wide.factor === 1 && !wide.moatWeak, wide.detail);
  const lowRivalry = evaluateMoatRivalryDamping({ moatRating: "Narrow", moatScore: 2, porterForces: forces.map(f => ({ ...f, score: f.force ? 1 : 4 })), description: "" });
  check("Rivalität unter dem Median dämpft nicht", lowRivalry.factor === 1, lowRivalry.detail);
  const heritage = evaluateMoatRivalryDamping({ moatRating: "Narrow", moatScore: 4, porterForces: forces, description: "premium brand with heritage" });
  check("Heritage wird erkannt und hebt den Moat nicht künstlich", heritage.heritageNoted && heritage.moatStrength === 0.6, String(heritage.moatStrength));
  check("ohne Rivalitäts-Kraft → n/a", evaluateMoatRivalryDamping({ moatRating: "None", moatScore: 1, porterForces: [{ name: "Kunden", score: 4 }], description: "" }).reason === "n/a — Porter-Kraft Rivalität fehlt");
  check("Flag AUS multipliziert nicht", applyMoatRivalryToScore(4.735718, weak, false) === 4.735718);
  check("Flag AN multipliziert mit dem Faktor", applyMoatRivalryToScore(4, weak, true) === 4 * weak.factor);
}

console.log("\n=== Earnings Yield und Accruals: Peer- bzw. Eigenlage, fehlend = n/a ===");
{
  const ey = earningsYield({ ebit: 120, marketCap: 1000, totalDebt: 200, cash: 50, peerYieldsPct: [5, 8, 11] });
  check("Earnings Yield = EBIT / EV", ey.available && Math.abs((ey.yieldPct ?? 0) - (120 / 1150) * 100) < 1e-9, String(ey.yieldPct));
  check("über dem Peer-Median → Richtung +1", ey.direction === 1 && ey.peerMedianPct === 8, String(ey.peerMedianPct));
  check("ohne Peers → n/a, Yield bleibt sichtbar", earningsYield({ ebit: 120, marketCap: 1000, totalDebt: 200, cash: 50, peerYieldsPct: [] }).reason === "n/a — keine Peer-Earnings-Yields");
  check("ohne EBIT → n/a", earningsYield({ ebit: null, marketCap: 1000, totalDebt: 0, cash: 0, peerYieldsPct: [5] }).reason === "n/a — EBIT fehlt");
  const acc = accrualsRatio({ netIncome: 100, operatingCashFlow: 90, history: [{ netIncome: 80, operatingCashFlow: 40 }, { netIncome: 80, operatingCashFlow: 70 }] });
  check("Accruals = |NI − OCF| / |NI|", acc.available && Math.abs((acc.ratio ?? 0) - 0.1) < 1e-9, String(acc.ratio));
  check("unter dem eigenen Median → Qualität +1", acc.direction === 1, String(acc.median));
  check("ohne Historie → n/a", accrualsRatio({ netIncome: 100, operatingCashFlow: 90, history: [] }).reason === "n/a — keine Accruals-Historie");
  check("Net Income 0 → n/a, nicht 0", accrualsRatio({ netIncome: 0, operatingCashFlow: 10, history: [] }).reason === "n/a — Net Income fehlt");
}

console.log("\n=== Ganze Analyse: Flag AUS bitgleich, Flag AN nur mit belegter Dämpfung ===");
{
  const msft = JSON.parse(readFileSync(new URL("./fixtures/analysis-MSFT.json", import.meta.url), "utf8")) as StockAnalysis;
  const off = buildBiasDecision(msft);
  const on = buildBiasDecision({ ...msft, scoringAdditions: true });
  check("MSFT Flag AUS: scoringAdditions bleibt null", off.scoringAdditions == null);
  check("MSFT Flag AN: Payload vorhanden", on.scoringAdditions?.enabled === true);
  check("MSFT ohne Segmente: Hybrid n/a", on.scoringAdditions?.hybrid?.reason === "n/a — weniger als zwei Umsatzsegmente", on.scoringAdditions?.hybrid?.reason ?? "");
  check("MSFT Wide: keine Dämpfung, Score bitgleich", on.scoringAdditions?.moatRivalry?.factor === 1 && on.overallScore === off.overallScore, `${on.overallScore} / ${off.overallScore}`);
  check("MSFT Rating unverändert", on.overallRating === off.overallRating, `${on.overallRating} / ${off.overallRating}`);
  check("MSFT ohne Peer-Yields: Earnings Yield n/a", (on.scoringAdditions?.earningsYield?.reason ?? "").startsWith("n/a"), on.scoringAdditions?.earningsYield?.reason ?? "");

  const vow = JSON.parse(readFileSync(new URL("./fixtures/analysis-VOW3.DE-negfcf.json", import.meta.url), "utf8")) as StockAnalysis;
  const vowOff = buildBiasDecision(vow);
  const vowOn = buildBiasDecision({ ...vow, scoringAdditions: true });
  check("VOW3 Flag AUS: Score exakt wie ohne Feld", vowOff.overallScore === buildBiasDecision({ ...vow }).overallScore);
  const rivalry = (vow.moatAssessment?.porterForces ?? []).find(f => /rival|wettbewerb/i.test(String((f as { name?: string; force?: string }).name ?? (f as { force?: string }).force ?? "")));
  if (vowOn.scoringAdditions?.moatRivalry?.available && (vowOn.scoringAdditions.moatRivalry.factor < 1)) {
    check("VOW3 Flag AN: Dämpfung nur bei belegter Rivalität über dem Median", vowOn.overallScore < vowOff.overallScore && vowOn.overallScore === vowOff.overallScore * vowOn.scoringAdditions.moatRivalry.factor);
    check("VOW3 Begründung im Payload", vowOn.redFlags.some(f => f.includes("gedämpft")));
  } else {
    check("VOW3: Rivalität im Payload nicht über dem Median → Score bleibt", vowOn.overallScore === vowOff.overallScore, `Rivalität ${rivalry ? "vorhanden" : "fehlt"}: ${vowOn.scoringAdditions?.moatRivalry?.detail}`);
  }
  const withSegments = buildBiasDecision({
    ...vow,
    scoringAdditions: true,
    revenueSegments: [
      { name: "Fahrzeuge", revenue: 80, percentage: 70, growth: 2 },
      { name: "Financial Services", revenue: 20, percentage: 30, growth: 18 },
    ],
  });
  check("VOW3 mit Segmenten: Anteile sichtbar", withSegments.scoringAdditions?.hybrid?.available === true && (withSegments.scoringAdditions.hybrid.shares.length ?? 0) >= 2, withSegments.scoringAdditions?.hybrid?.label ?? "");

  const reading = scoringAdditionsFromAnalysis(msft, true);
  check("direkte Ableitung trägt den Flag", reading.enabled && reading.moatRivalry != null);
}

console.log("\n=== Route: Flag AUS exakt, Flag AN gemessen (VOW3/SAP/MSFT) ===");
{
  process.env.FMP_API_KEY = "test-key";
  process.env.FMP_MIN_INTERVAL_MS = "0";
  process.env.YAHOO_MIN_INTERVAL_MS = "0";
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8"));
  const prod: Record<string, any> = fixture.prod;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fmpMock = (p: string, sym: string, qs: URLSearchParams): Response => {
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
  };
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

  const express = (await import("express")).default;
  const { registerAnalyzeRoute, readAnalyzeCacheResult } = await import("../server/analyze-route.ts");
  const { buildAnalyzeCacheKey } = await import("../server/peer-cache-key.ts");
  const { buildFazitSignal, prepareFazitMetrics } = await import("../client/src/lib/fazit-signal.ts");
  const app = express();
  app.use(express.json());
  const server = app.listen(0);
  registerAnalyzeRoute(server, app);
  await new Promise(r => server.once("listening", r));
  const port = (server.address() as any).port;
  const ask = async (ticker: string, scoringAdditions: boolean, force = true) => {
    const r = await realFetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker, useLLM: false, force, scoringAdditions }),
    });
    return r.json();
  };
  const liveP = (body: any): string => {
    if (!body?.biasFix) return "n/a — Yahoo-only, kein biasFix";
    const m = prepareFazitMetrics(body);
    return buildFazitSignal({ data: body, ...m }).rating;
  };
  const LABELS: Record<string, string> = { VWAGY: "VOW3", SAP: "SAP", MSFT: "MSFT" };
  for (const t of ["VWAGY", "SAP", "MSFT"]) {
    const off = await ask(t, false);
    const on = await ask(t, true);
    const scoreOff = off?.biasFix?.overallScore;
    const pinned = fixture.expectOldHead[t].overallScore;
    check(`${LABELS[t]} Flag AUS: Gesamtscore exakt ${Number(pinned).toFixed(6)}`, scoreOff === pinned, `${scoreOff} / ${pinned}`);
    check(`${LABELS[t]} Flag AUS: Rating exakt`, off?.biasFix?.overallRating === fixture.expectOldHead[t].overallRating, off?.biasFix?.overallRating);
    const pOff = liveP(off), pOn = liveP(on);
    console.log(`  ℹ ${LABELS[t]}: Score ${Number(scoreOff).toFixed(6)} → ${Number(on?.biasFix?.overallScore).toFixed(6)} | Rating ${off?.biasFix?.overallRating} → ${on?.biasFix?.overallRating} | Live-P ${pOff} → ${pOn} | ${on?.biasFix?.scoringAdditions?.moatRivalry?.detail ?? on?.biasFix?.scoringAdditions?.moatRivalry?.reason ?? "n/a"}`);
    check(`${LABELS[t]} Flag AN: Score nur verändert, wenn die Dämpfung belegt ist`, (() => {
      const factor = on?.biasFix?.scoringAdditions?.moatRivalry?.factor;
      return typeof factor === "number" && Math.abs(on.biasFix.overallScore - scoreOff * factor) < 1e-9;
    })(), `${on?.biasFix?.overallScore} / ${scoreOff}`);

    const cacheKey = buildAnalyzeCacheKey(t, false, [], []);
    const cached = readAnalyzeCacheResult(cacheKey);
    check(`${LABELS[t]} Cache nach Flag AN: Gesamtscore bleibt der Pin`, cached?.biasFix?.overallScore === pinned, String(cached?.biasFix?.overallScore));
    check(`${LABELS[t]} Cache nach Flag AN: scoringAdditions nicht gesetzt`, cached?.scoringAdditions !== true && cached?.biasFix?.scoringAdditions == null);
    const again = await ask(t, false, false);
    check(`${LABELS[t]} Flag AUS nach Flag AN: exakt der Pin`, again?.biasFix?.overallScore === pinned && again?.biasFix?.overallRating === fixture.expectOldHead[t].overallRating, `${again?.biasFix?.overallScore} ${again?.biasFix?.overallRating}`);
    const cachedAfter = readAnalyzeCacheResult(cacheKey);
    check(`${LABELS[t]} Cache-Objekt unverändert`, cachedAfter === cached && cachedAfter?.biasFix?.overallScore === pinned, String(cachedAfter?.biasFix?.overallScore));
  }
  server.close();
}

console.log(failed ? `\n${failed} Check(s) fehlgeschlagen` : "\nAlle Checks grün");
process.exit(failed ? 1 : 0);
