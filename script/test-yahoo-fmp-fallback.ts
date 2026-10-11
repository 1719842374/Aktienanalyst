/**
 * Mini-PR 4: Yahoo only after FMP 402 or a clear upstream failure.
 * VOW3.DE, BMW.DE, SAP.DE take the Yahoo path. AAPL with a quote stays on FMP.
 * An unknown ticker returns null / the existing error shape and does not throw.
 *
 * Run: npx tsx script/test-yahoo-fmp-fallback.ts
 */
import { classifyFmpError, type FmpFailure } from "../server/fmp";
import {
  betaForQuoteSource,
  clearYahooFetcherCacheForTests,
  fetchYahooAnalysisData,
  isYahooQuoteHistoryFallback,
  mapYahooToFmpFallback,
  routeQuoteSource,
  stripYahooFundamentalScores,
  YAHOO_COVERAGE_NOTE,
  YAHOO_PLAN_LIMIT_LABEL,
  YAHOO_SECTION_HINT,
  yahooListingSymbol,
  type YahooBasicData,
} from "../server/yahoo-fetcher";
import { formatCurrency } from "../client/src/lib/formatters";

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const http = (status: number) => Object.assign(new Error(`FMP ${status}: /quote`), { fmpStatus: status });
const failure = (status: number): FmpFailure => classifyFmpError(http(status));

console.log("\n=== route: .DE → Yahoo, AAPL stays FMP ===");
for (const ticker of ["VOW3.DE", "BMW.DE", "SAP.DE"]) {
  const decided = routeQuoteSource({ failure: failure(402) });
  check(`${ticker} on FMP 402 → yahoo`, decided === "yahoo", decided);
  check(`${ticker} symbol kept`, yahooListingSymbol(ticker.toLowerCase()) === ticker, yahooListingSymbol(ticker.toLowerCase()));
}
check("AAPL with quote stays fmp", routeQuoteSource({ quote: { price: 227 } }) === "fmp");
check("AAPL symbol not rewritten", yahooListingSymbol("aapl") === "AAPL");
check("invalid ticker FMP_NO_DATA is not yahoo", routeQuoteSource({
  failure: { errorCode: "FMP_NO_DATA", fmpStatus: null, message: "no quote for NOTAREAL" },
}) === "fmp-error");

console.log("\n=== which FMP failures open Yahoo ===");
check("402 → yahoo", isYahooQuoteHistoryFallback(failure(402)));
check("500 → yahoo", isYahooQuoteHistoryFallback(failure(500)));
check("503 → yahoo", isYahooQuoteHistoryFallback(failure(503)));
check("unreachable → yahoo", isYahooQuoteHistoryFallback(classifyFmpError(new Error("fetch failed"))));
check("429 stays rate limit", !isYahooQuoteHistoryFallback(failure(429)));
check("401 is not yahoo", !isYahooQuoteHistoryFallback(failure(401)));
check("403 is not yahoo", !isYahooQuoteHistoryFallback(failure(403)));
check("404 is not yahoo", !isYahooQuoteHistoryFallback(failure(404)));
check("missing key is not yahoo", !isYahooQuoteHistoryFallback(classifyFmpError(new Error("FMP_API_KEY not set"))));
check("coverage note names the plan limit", YAHOO_COVERAGE_NOTE.startsWith(YAHOO_PLAN_LIMIT_LABEL));
check("coverage note says Teilabdeckung", YAHOO_COVERAGE_NOTE.includes("Teilabdeckung"));

console.log("\n=== mapping is quote/history only ===");
const sample: YahooBasicData = {
  symbol: "VOW3.DE",
  shortName: "Volkswagen AG",
  price: 68,
  currency: "EUR",
  exchange: "GER",
  marketCap: 34_088_077_312,
  pe: 6.68,
  eps: 10.18,
  historical: [{ date: "2026-10-09", open: 67, high: 69, low: 66, close: 68, volume: 1_000 }],
};
const mapped = mapYahooToFmpFallback(sample);
check("maps price", mapped?.quote.price === 68);
check("keeps VOW3.DE", mapped?.quote.symbol === "VOW3.DE");
check("maps market cap, pe, eps", mapped?.quote.marketCap === sample.marketCap && mapped?.quote.pe === 6.68 && mapped?.quote.eps === 10.18);
check("history passed through", mapped?.ohlcv.length === 1 && mapped.ohlcv[0].close === 68);
check("no income", mapped?.financials.income.length === 0);
check("no cashflow", mapped?.financials.cashflow.length === 0);
check("no balance sheet", mapped?.financials.balanceSheet.length === 0);
check("no analyst grades", mapped?.analyst.grades.length === 0 && mapped?.analyst.estimates.length === 0);
check("no ratios", mapped?.ratios.length === 0);
check("no dividend on quote", mapped != null && !("dividendYield" in mapped.quote));
check("no beta on profile", mapped != null && !("beta" in mapped.profile));
check("empty fundamentals map to null without price", mapYahooToFmpFallback({ ...sample, price: null, historical: [] }) === null);

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
  });
}

console.log("\n=== injected fetch: symbol, empty ticker, throw-safe ===");
clearYahooFetcherCacheForTests();
const seen: string[] = [];
const mockFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  seen.push(url);
  if (url.includes("fc.yahoo.com")) {
    return new Response("", { status: 404, headers: { "set-cookie": "A3=testcookie; Path=/; Domain=.yahoo.com" } });
  }
  if (url.includes("getcrumb")) return new Response("testcrumb");
  if (url.includes("/v7/finance/quote")) {
    if (url.includes("NOTAREAL")) return jsonResponse({ quoteResponse: { result: [] } });
    if (url.includes("VOW3.DE")) {
      return jsonResponse({
        quoteResponse: {
          result: [{
            symbol: "VOW3.DE",
            shortName: "Volkswagen AG",
            regularMarketPrice: 68,
            currency: "EUR",
            exchange: "GER",
            marketCap: 100,
            trailingPE: 6.5,
            epsTrailingTwelveMonths: 10,
          }],
        },
      });
    }
    return jsonResponse({ quoteResponse: { result: [] } });
  }
  if (url.includes("/v8/finance/chart/")) {
    if (url.includes("NOTAREAL")) return jsonResponse({ chart: { result: null } }, 404);
    const now = Math.floor(Date.now() / 1000);
    return jsonResponse({
      chart: {
        result: [{
          meta: { symbol: "VOW3.DE", currency: "EUR", regularMarketPrice: 68, exchangeName: "GER" },
          timestamp: [now - 86400, now],
          indicators: { quote: [{ open: [67, 68], high: [70, 69], low: [66, 67], close: [68, 68.2], volume: [10, 11] }] },
        }],
      },
    });
  }
  return jsonResponse({}, 500);
}) as typeof fetch;

const vow = await fetchYahooAnalysisData("vow3.de", { fetchImpl: mockFetch });
check("mock VOW3.DE returns price", vow?.price === 68, String(vow?.price));
check("mock symbol stays VOW3.DE", vow?.symbol === "VOW3.DE", vow?.symbol);
check("mock history present", (vow?.historical.length ?? 0) > 0);
check("request kept .DE", seen.some((url) => url.includes("VOW3.DE")));
check("request did not strip to VOW3", !seen.some((url) => /symbols=VOW3(&|$)/.test(url) || /chart\/VOW3\?/.test(url)));
const mappedVow = mapYahooToFmpFallback(vow);
check("mock maps without fundamentals", mappedVow?.financials.income.length === 0 && mappedVow?.source === "yahoo");

let threw = false;
let invalid: YahooBasicData | null = null;
try {
  invalid = await fetchYahooAnalysisData("NOTAREAL.DE", { fetchImpl: mockFetch });
} catch {
  threw = true;
}
check("invalid ticker does not throw", !threw);
check("invalid ticker is null", invalid === null);

let blankThrew = false;
try {
  await fetchYahooAnalysisData("   ", { fetchImpl: mockFetch });
} catch {
  blankThrew = true;
}
check("blank ticker does not throw", !blankThrew);

console.log("\n=== Yahoo path: beta stays null, no numeric scores ===");
check("section hint is the plan-limit phrase", YAHOO_SECTION_HINT === "Plan-Limit, nur Kurs/History", YAHOO_SECTION_HINT);
check("yahoo beta is null even if a number is present", betaForQuoteSource(true, 1.4, 0.8) === null);
check("yahoo beta is null when both sides are missing", betaForQuoteSource(true, undefined, undefined) === null);
check("FMP beta still defaults to 1", betaForQuoteSource(false, undefined, undefined) === 1);
check("FMP beta keeps the profile value", betaForQuoteSource(false, "1.35", undefined) === 1.35);

const yahooScores = {
  quoteCoverage: "yahoo-quote-history" as const,
  quoteCoverageNote: YAHOO_COVERAGE_NOTE,
  ticker: "VOW3.DE",
  companyName: "Volkswagen AG",
  currentPrice: 68,
  marketCap: 34_000_000_000,
  peRatio: 6.68,
  epsTTM: 10.18,
  currency: "EUR",
  historicalPrices: [{ date: "2026-10-09", close: 68 }],
  historyDataSource: "yahoo",
  beta: 1,
  beta5Y: 1,
  lynchClass: "stalwart",
  lynchPEGBasis: "cagr",
  peg: 1.2,
  pegRatio: 1.2,
  forwardPE: 8,
  evEbitda: 5,
  scoring: { finalScore: 72, rawScore: 80, qualityScore: 3 },
  impliedGStar: 4,
  dcfFairValue: 90,
  upsidePotential: 32,
  wacc: 8.5,
  risks: [{ name: "Macro Recession / Demand Shock", impact: 20, expectedDamage: 4 }],
  catalysts: [{ name: "template", gb: 3 }],
  growthThesis: "Schein-These aus leeren Financials",
  moatRating: "None",
  moatAssessment: { overallRating: "None" },
  pestelAnalysis: { geopoliticalScore: 5 },
  macroCorrelations: { correlations: [{ name: "VIX", value: 0.4 }] },
  peerComparison: { peers: [{ ticker: "BMW.DE" }] },
  peerSet: { relativeApplies: true },
  revenueSegments: [{ name: "Auto", percentage: 100 }],
  geoSegments: [{ name: "Europe" }],
  financialStatements: { health: "Weak", healthReasons: ["Negative FCF-Marge"] },
  tamAnalysis: { tamCAGR: 5 },
  governmentExposure: 10,
  sectorMaxDrawdown: 35,
  cycleClassification: "Mixed Cyclical",
  epsGrowth5Y: 7,
  epsAdjFY: 9,
  epsConsensusNextFY: 11,
  crvBase: 1.4,
  crvRiskAdj: 0.8,
  maxEntryCrv3: 50,
  execSummary: { fazit: { lage: "kaufen" } },
  sectorAvgPE: 20,
  sectorProfile: { waccScenarios: { avg: 8.5 } },
  fcfMargin: 0,
  fcfTTM: 0,
  revenue: 0,
};
stripYahooFundamentalScores(yahooScores);
const yahooScoreKeys = [
  "beta", "beta5Y", "forwardPE", "evEbitda", "pegRatio", "peg", "dcfFairValue", "upsidePotential",
  "wacc", "impliedGStar", "epsGrowth5Y", "epsAdjFY", "epsConsensusNextFY", "governmentExposure",
  "sectorMaxDrawdown", "crvBase", "crvRiskAdj", "maxEntryCrv3", "fcfMargin", "fcfTTM", "revenue", "sectorAvgPE",
] as const;
for (const key of yahooScoreKeys) {
  check(`yahoo ${key} is not a number`, typeof yahooScores[key] !== "number", `${key}=${yahooScores[key]}`);
}
check("yahoo beta is null", yahooScores.beta === null);
check("yahoo beta5Y is null", yahooScores.beta5Y === null);
check("yahoo scoring removed", yahooScores.scoring == null);
check("yahoo lynch class removed", yahooScores.lynchClass == null);
check("yahoo health removed", yahooScores.financialStatements == null);
check("yahoo risks empty", Array.isArray(yahooScores.risks) && yahooScores.risks.length === 0);
check("yahoo catalysts empty", Array.isArray(yahooScores.catalysts) && yahooScores.catalysts.length === 0);
check("yahoo peers removed", yahooScores.peerComparison == null);
check("yahoo segments empty", Array.isArray(yahooScores.revenueSegments) && yahooScores.revenueSegments.length === 0);
check("yahoo thesis cleared", yahooScores.growthThesis === "");
check("yahoo exec summary removed", yahooScores.execSummary == null);
check("yahoo payload has no finalScore", !JSON.stringify(yahooScores).includes("finalScore"));
check("yahoo payload has no health label", !JSON.stringify(yahooScores).includes("Weak"));
check("yahoo price kept", yahooScores.currentPrice === 68);
check("yahoo market cap kept", yahooScores.marketCap === 34_000_000_000);
check("yahoo pe kept", yahooScores.peRatio === 6.68);
check("yahoo eps kept", yahooScores.epsTTM === 10.18);
check("yahoo history kept", yahooScores.historicalPrices.length === 1);

const fmpUntouched = {
  beta: 1.2,
  beta5Y: 1.2,
  scoring: { finalScore: 70 },
  lynchClass: "fast_grower",
  financialStatements: { health: "Good" },
  risks: [{ name: "real" }],
  dcfFairValue: 180,
  wacc: 9,
  currentPrice: 227,
};
stripYahooFundamentalScores(fmpUntouched);
check("FMP object without coverage is not stripped", fmpUntouched.beta === 1.2 && fmpUntouched.beta5Y === 1.2);
check("FMP score stays numeric", fmpUntouched.scoring.finalScore === 70);
check("FMP lynch stays", fmpUntouched.lynchClass === "fast_grower");
check("FMP health stays", fmpUntouched.financialStatements.health === "Good");
check("FMP risks stay", fmpUntouched.risks.length === 1);
check("FMP dcf stays", fmpUntouched.dcfFairValue === 180 && fmpUntouched.wacc === 9);

console.log("\n=== quote currency on the price, USD path unchanged ===");
check("USD default still starts with $", formatCurrency(68.5) === `$${Number(68.5).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
check("explicit USD still starts with $", formatCurrency(68.5, 2, "USD").startsWith("$"));
check("EUR price does not use $", !formatCurrency(68.5, 2, "EUR").includes("$"), formatCurrency(68.5, 2, "EUR"));
check("EUR price names the quote currency", /€|EUR/.test(formatCurrency(68.5, 2, "EUR")), formatCurrency(68.5, 2, "EUR"));

console.log("\n=== live Yahoo: VOW3.DE, BMW.DE, SAP.DE, invalid ===");
clearYahooFetcherCacheForTests();
for (const ticker of ["VOW3.DE", "BMW.DE", "SAP.DE"] as const) {
  let live: YahooBasicData | null = null;
  let liveThrew = false;
  try {
    live = await fetchYahooAnalysisData(ticker);
  } catch {
    liveThrew = true;
  }
  check(`${ticker} live does not throw`, !liveThrew);
  check(`${ticker} live price`, (live?.price ?? 0) > 0, String(live?.price));
  check(`${ticker} live symbol`, live?.symbol === ticker, live?.symbol ?? "");
  check(`${ticker} live history`, (live?.historical.length ?? 0) > 50, String(live?.historical.length));
  check(`${ticker} live market cap or pe or eps`, (live?.marketCap ?? 0) > 0 || (live?.pe ?? 0) > 0 || live?.eps != null, `mcap=${live?.marketCap} pe=${live?.pe} eps=${live?.eps}`);
  const liveMapped = mapYahooToFmpFallback(live);
  check(`${ticker} live map has no income`, liveMapped?.financials.income.length === 0);
}

let badThrew = false;
let bad: YahooBasicData | null = { symbol: "x", shortName: null, price: 1, currency: null, exchange: null, marketCap: null, pe: null, eps: null, historical: [] };
try {
  bad = await fetchYahooAnalysisData("NOTAREALTICKERZZZ999");
} catch {
  badThrew = true;
}
check("live invalid does not throw", !badThrew);
check("live invalid is null", bad === null, bad ? `price=${bad.price} symbol=${bad.symbol}` : "");

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
