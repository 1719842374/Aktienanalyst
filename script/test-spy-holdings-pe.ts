/**
 * F2-09: SPY-KGV = Σ Market Cap / Σ Earnings (TTM) über die Holdings.
 * Yahoo aus #414 und fillSpyValuationGaps aus #415 bleiben die Stufen danach.
 * Run: npx tsx script/test-spy-holdings-pe.ts
 */
import { readFileSync } from "node:fs";
import {
  SPY_HOLDINGS_PE_FORMULA,
  SPY_HOLDINGS_PE_SOURCE,
  TTM_QUARTER_COUNT,
  aggregateSpyHoldingsPe,
  dropHoldingsReplacedPeClauses,
  formatCoveragePct,
  largestHoldingWeightShare,
  parseSpyHoldingWeights,
  quoteSymbolBatches,
  spyPeValueSuffix,
  ttmNetIncomeFromStatement,
} from "../shared/spy-holdings-pe";
import {
  SPY_HOLDINGS_PE_CACHE_MS,
  loadSpyHoldingsAggregatePe,
  resetSpyHoldingsPeCacheForTests,
  type SpyHoldingsPeDeps,
} from "../server/spy-holdings-pe";
import { buildBiasDecision } from "../shared/bias-fixes";

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total += 1;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== Summe, negative Earnings, Deckung ===");
{
  const full = aggregateSpyHoldingsPe([
    { symbol: "A", weight: 60, marketCap: 100, earningsTtm: 10 },
    { symbol: "B", weight: 40, marketCap: 300, earningsTtm: 10 },
  ]);
  check("volle Deckung: Σ Cap / Σ Earnings", full.pe === 20 && full.estimate === false && full.coverage === 1 && full.source === SPY_HOLDINGS_PE_SOURCE, JSON.stringify(full));

  const negative = aggregateSpyHoldingsPe([
    { symbol: "A", weight: 50, marketCap: 100, earningsTtm: 30 },
    { symbol: "B", weight: 50, marketCap: 100, earningsTtm: -10 },
  ]);
  check("negatives Earnings bleibt in der Summe", negative.pe === 10 && negative.estimate === false, JSON.stringify(negative));

  const loss = aggregateSpyHoldingsPe([
    { symbol: "A", weight: 50, marketCap: 100, earningsTtm: -10 },
    { symbol: "B", weight: 50, marketCap: 100, earningsTtm: -10 },
  ]);
  check("negative Summe Earnings ergibt negatives KGV", loss.pe === -10, JSON.stringify(loss));

  const partial = aggregateSpyHoldingsPe([
    { symbol: "A", weight: 50, marketCap: 200, earningsTtm: 10 },
    { symbol: "B", weight: 30, marketCap: 100, earningsTtm: 10 },
    { symbol: "C", weight: 20, marketCap: null, earningsTtm: null },
  ]);
  check("lückenhafte Deckung ist Schätzung und rechnet nur belegte Positionen", partial.estimate === true && partial.pe === 15 && partial.coverage === 0.8 && partial.source != null, JSON.stringify(partial));
  check("Mindestabdeckung ist der größte Gewichtsanteil", largestHoldingWeightShare([50, 30, 20]) === 0.5);
  check("Deckung nur so breit wie die größte Position bleibt n/a", aggregateSpyHoldingsPe([
    { symbol: "A", weight: 50, marketCap: null, earningsTtm: null },
    { symbol: "B", weight: 30, marketCap: 100, earningsTtm: 10 },
    { symbol: "C", weight: 20, marketCap: 100, earningsTtm: 10 },
  ]).note === `n/a — PE: Abdeckung ${formatCoveragePct(0.5)} nicht breiter als die größte Einzelposition`);

  const noWeight = aggregateSpyHoldingsPe([
    { symbol: "A", weight: null, marketCap: 100, earningsTtm: 10 },
    { symbol: "B", weight: null, marketCap: 100, earningsTtm: 10 },
  ]);
  check("fehlende Gewichte sind Schätzung, nicht n/a", noWeight.estimate === true && noWeight.pe === 10 && noWeight.coverage === null, JSON.stringify(noWeight));
  check("eine Position ist kein SPY-KGV", aggregateSpyHoldingsPe([
    { symbol: "A", weight: 100, marketCap: 100, earningsTtm: 5 },
  ]).note === "n/a — PE: nicht breiter als eine Einzelposition");
  check("Earnings-Summe 0 bleibt n/a", aggregateSpyHoldingsPe([
    { symbol: "A", weight: 50, marketCap: 100, earningsTtm: 5 },
    { symbol: "B", weight: 50, marketCap: 100, earningsTtm: -5 },
  ]).note === "n/a — PE: Summe Earnings (TTM) ist 0");
  check("ohne Daten n/a mit Grund", aggregateSpyHoldingsPe([
    { symbol: "A", weight: 100, marketCap: null, earningsTtm: null },
  ]).note === "n/a — PE: Holdings ohne Market Cap und TTM-Net-Income");
}

console.log("\n=== Parser, TTM, Quelle am Wert ===");
{
  const weights = parseSpyHoldingWeights([
    { asset: "brk.b", weightPercentage: 1.5 },
    { symbol: "AAPL", weightPercentage: 7 },
    { asset: "CASH USD", weightPercentage: 0.2 },
    { symbol: "AAPL", weightPercentage: 0.1 },
  ]);
  check("Holdings: Symbol, Summe gleicher Namen, Cash ohne Ticker fällt weg", weights.length === 2 && weights.find(row => row.symbol === "AAPL")?.weight === 7.1 && weights.some(row => row.symbol === "BRK.B"), JSON.stringify(weights));
  const ttm = ttmNetIncomeFromStatement({ netIncome: -12, reportedCurrency: "USD", period: "TTM" });
  check("eine TTM-Zeile wird nicht vervierfacht, negativ bleibt", ttm?.netIncome === -12 && ttm.currency === "USD");
  const quarters = ttmNetIncomeFromStatement([
    { date: "2026-09-30", period: "Q3", netIncome: 5, reportedCurrency: "USD" },
    { date: "2026-06-30", period: "Q2", netIncome: -2, reportedCurrency: "USD" },
    { date: "2026-03-31", period: "Q1", netIncome: 4, reportedCurrency: "USD" },
    { date: "2025-12-31", period: "Q4", netIncome: 3, reportedCurrency: "USD" },
    { date: "2025-09-30", period: "Q3", netIncome: 99, reportedCurrency: "USD" },
  ]);
  check(`vier neueste Quartale, das fünfte zählt nicht (n=${TTM_QUARTER_COUNT})`, quarters?.netIncome === 10, String(quarters?.netIncome));
  check("weniger als vier Quartale ist kein TTM", ttmNetIncomeFromStatement([
    { date: "2026-09-30", period: "Q3", netIncome: 5 },
    { date: "2026-06-30", period: "Q2", netIncome: 5 },
  ]) === null);
  const batches = quoteSymbolBatches(["AAAA", "BBBB", "CCCC"], 9);
  check("Quotes gehen in Batches, nicht ein Call je Symbol", batches.length === 2 && batches[0].join(",") === "AAAA,BBBB", JSON.stringify(batches));
  const suffix = spyPeValueSuffix({ source: SPY_HOLDINGS_PE_SOURCE, coverage: 0.8, estimate: true });
  check("Schätzung nennt Deckung, Quelle und Formel", suffix.includes("Schätzung") && suffix.includes("80,0 %") && suffix.includes(SPY_HOLDINGS_PE_SOURCE) && suffix.includes(SPY_HOLDINGS_PE_FORMULA), suffix);
  check("volle Deckung ist keine Schätzung", !spyPeValueSuffix({ source: SPY_HOLDINGS_PE_SOURCE, coverage: 1, estimate: false }).includes("Schätzung"));
  check("ohne Holdings-Quelle kein Zusatz", spyPeValueSuffix({ source: null, coverage: null, estimate: false }) === "");
  const yahooNote = "PE/EPS: Yahoo quoteSummary trailingEps (FMP leer) Forward: Yahoo quoteSummary earningsTrend (FMP analyst-estimates leer) g n/a: Yahoo ohne TTM-EPS neben dem Forward-EPS";
  const kept = dropHoldingsReplacedPeClauses(yahooNote);
  check("Forward-Satz von #415 bleibt, der ersetzte PE-Satz nicht", kept === "Forward: Yahoo quoteSummary earningsTrend (FMP analyst-estimates leer) g n/a: Yahoo ohne TTM-EPS neben dem Forward-EPS", kept ?? "");
}

console.log("\n=== Cache, ein Quote-Aufruf, FX ===");
{
  resetSpyHoldingsPeCacheForTests();
  let holdingsCalls = 0;
  let quoteCalls = 0;
  let earningsCalls = 0;
  const deps: SpyHoldingsPeDeps = {
    holdings: async () => {
      holdingsCalls += 1;
      return [
        { symbol: "AAA", weightPercentage: 40 },
        { symbol: "BBB", weightPercentage: 30 },
        { symbol: "SPY", weightPercentage: 0 },
        { symbol: "CCC", weightPercentage: 30 },
      ];
    },
    quotes: async symbols => {
      quoteCalls += 1;
      return symbols.filter(symbol => symbol !== "CCC").map(symbol => ({ symbol, marketCap: 100, currency: "USD" }));
    },
    earningsTtm: async symbol => {
      earningsCalls += 1;
      if (symbol === "BBB") return { netIncome: 10, reportedCurrency: "DKK", period: "TTM" };
      if (symbol === "CCC") return { netIncome: 5, reportedCurrency: "USD", period: "TTM" };
      return { netIncome: 10, reportedCurrency: "USD", period: "TTM" };
    },
    fxToUsd: async currency => (currency === "DKK" ? 0.15 : null),
    now: () => 1_000,
  };
  const first = await loadSpyHoldingsAggregatePe(deps);
  const quoteCallsAfterFirst = quoteCalls;
  const earningsAfterFirst = earningsCalls;
  const second = await loadSpyHoldingsAggregatePe(deps);
  check("DKK-Earnings werden umgerechnet, CCC ohne Market Cap bleibt draußen", first.pe === 17.39, JSON.stringify(first));
  check("CCC ohne Market Cap senkt die Deckung, bleibt Schätzung", first.coverage === 0.7 && first.estimate === true, JSON.stringify(first));
  check("zweiter Abruf liest den Cache", second.pe === first.pe && holdingsCalls === 1 && quoteCalls === quoteCallsAfterFirst && earningsCalls === earningsAfterFirst, `h=${holdingsCalls} q=${quoteCalls} e=${earningsCalls}`);
  check("ein Quote-Aufruf für alle Symbole, nicht einer je Position", quoteCallsAfterFirst === 1 && earningsAfterFirst === 3, `q=${quoteCallsAfterFirst} e=${earningsAfterFirst}`);

  resetSpyHoldingsPeCacheForTests();
  let again = 0;
  const cold = { ...deps, holdings: async () => { again += 1; return []; }, now: () => 5_000 };
  await loadSpyHoldingsAggregatePe(cold);
  cold.now = () => 5_000 + SPY_HOLDINGS_PE_CACHE_MS;
  await loadSpyHoldingsAggregatePe(cold);
  check("nach der Haltedauer wird neu geladen", again === 2, String(again));
}

console.log("\n=== Reihenfolge gegen #414 und #415, Pins ===");
{
  const charts = readFileSync(new URL("../server/recession-market-charts.ts", import.meta.url), "utf8");
  const load = charts.slice(charts.indexOf("async function loadValuation"), charts.indexOf("export async function buildChartMarket"));
  const holdingsAt = load.indexOf("await loadSpyHoldingsAggregatePe");
  const yahooAt = load.indexOf("await yahooFundamentalsWhenFmpEmpty");
  const fillAt = load.indexOf("fillSpyValuationGaps(fmpCore");
  check("Holdings vor Yahoo, Yahoo vor fillSpyValuationGaps", holdingsAt > -1 && yahooAt > holdingsAt && fillAt > yahooAt, `h=${holdingsAt} y=${yahooAt} f=${fillAt}`);
  check("fillSpy läuft weiter auf fmpCore und keptPe", load.includes("const keptPe = core.pe") && load.includes("if (keptPe != null) core = { ...core, pe: keptPe }"));
  check("Yahoo-Stufe nur bei leerem KGV", load.includes('book.etf === "SPY" && core.pe == null && bar.close > 0'));
  const ui = readFileSync(new URL("../client/src/components/recession/RecessionMarketChartsSection.tsx", import.meta.url), "utf8");
  check("PE-Zelle zeigt die Holdings-Quelle", ui.includes("spyPeValueSuffix") && ui.includes("displayNa"));
  const analyze = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
  check("analyze-route und schema bleiben ohne Holdings-KGV", !analyze.includes("spy-holdings-pe") && !schema.includes("spy-holdings-pe"));
  const pin = JSON.parse(readFileSync(new URL("../script/fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
  const msft = buildBiasDecision(JSON.parse(readFileSync(new URL("../script/fixtures/analysis-MSFT.json", import.meta.url), "utf8")));
  check("VOW3 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718");
  check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758");
  check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");
  check("buildBias 5.6381", msft.overallScore.toFixed(4) === "5.6381" && msft.overallRating === "NEUTRAL", `${msft.overallScore} ${msft.overallRating}`);
}

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
