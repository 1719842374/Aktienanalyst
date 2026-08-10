/**
 * Synthetic regression tests for the 13F Star-Investor screener.
 * No SEC or FMP request is made here: all source data is supplied as fixtures.
 *
 * Run: npx tsx script/test-screener-star-investors.ts
 */
import {
  buildScreenerDataFromResults,
  buildNormalizedStockList,
  calculateCrv,
  parseYearRange,
  resolveTickerFromNormalizedList,
  type InvestorHoldings,
  type SecHolding,
  type StockListRow,
} from "../server/screener";
import type { StarInvestor } from "../server/star-investors";

let failed = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const investorA: StarInvestor = { name: "Fund Alpha", manager: "Alpha", cik: "0000000001" };
const investorB: StarInvestor = { name: "Fund Beta", manager: "Beta", cik: "0000000002" };
const investorFailed: StarInvestor = { name: "Fund Failed", manager: "Failed", cik: "0000000003" };

const apple: SecHolding = { issuer: "Apple Inc", cusip: "037833100", value: 10_000_000 };
const appleSecondFund: SecHolding = { issuer: "Apple Inc", cusip: "037833100", value: 5_000_000 };
const microsoft: SecHolding = { issuer: "Microsoft Corp", cusip: "594918104", value: 3_000_000 };

const fulfilledA: PromiseFulfilledResult<InvestorHoldings> = {
  status: "fulfilled",
  value: { investor: investorA, holdings: [apple, microsoft] },
};
const fulfilledB: PromiseFulfilledResult<InvestorHoldings> = {
  status: "fulfilled",
  value: { investor: investorB, holdings: [appleSecondFund] },
};
const rejected: PromiseRejectedResult = {
  status: "rejected",
  reason: new Error(`${investorFailed.name} SEC timeout`),
};

const normalCrv = calculateCrv(100, 130, 80);
check("CRV-Formel: Upside = (130-100)/100 = 30%", normalCrv.upside === 30, JSON.stringify(normalCrv));
check("CRV-Formel: Downside = (100-80)/100 = 20%", normalCrv.downside === 20, JSON.stringify(normalCrv));
check("CRV-Formel: CRV = 30/20 = 1.5", normalCrv.crv === 1.5 && !normalCrv.crvPass, JSON.stringify(normalCrv));

const zeroDownside = calculateCrv(100, 150, 100);
check(
  "CRV Edge-Case: downside <= 0 liefert neutrales CRV statt Infinity/NaN",
  zeroDownside.downside === 0 && zeroDownside.crv === 0 && Number.isFinite(zeroDownside.crv) && !zeroDownside.crvPass,
  JSON.stringify(zeroDownside),
);

const enrichmentCalls: string[] = [];
const data = await buildScreenerDataFromResults(
  [fulfilledA, fulfilledB, rejected],
  (holding) => ({ "037833100": "AAPL", "594918104": "MSFT" }[holding.cusip] || null),
  async (ticker) => {
    enrichmentCalls.push(ticker);
    return ticker === "AAPL"
      ? {
          name: "Apple Inc.",
          price: 100, marketCap: 1_000_000_000, pe: 20, forwardPE: 18, sector: "Technology", beta: 1.1,
          targetPrice: 150, yearHigh: 170, yearLow: 80, fcfMargin: 25,
        }
      : {
          name: "Microsoft Corp.",
          price: 200, marketCap: 2_000_000_000, pe: 30, forwardPE: 25, sector: "Technology", beta: 0.9,
          targetPrice: 220, yearHigh: 230, yearLow: 150, fcfMargin: 30,
        };
  },
);

const aapl = data.screenedStocks.find((stock) => stock.ticker === "AAPL");
check("Dedup: gemeinsamer Ticker erscheint genau einmal", data.screenedStocks.filter((stock) => stock.ticker === "AAPL").length === 1);
check("Dedup: investorCount für AAPL ist 2", aapl?.investorCount === 2, JSON.stringify(aapl));
check(
  "Dedup: investors[] enthält beide Fonds",
  aapl?.investors.length === 2 && aapl.investors.includes("Fund Alpha") && aapl.investors.includes("Fund Beta"),
  JSON.stringify(aapl?.investors),
);
check("Dedup: Positionswerte werden aggregiert", aapl?.totalValue === 15_000_000, String(aapl?.totalValue));
check(
  "FMP-Anreicherung erfolgt einmal je dedupliziertem Ticker",
  enrichmentCalls.filter((ticker) => ticker === "AAPL").length === 1 && enrichmentCalls.length === 2,
  JSON.stringify(enrichmentCalls),
);
check(
  "Graceful degradation: fehlender SEC-Filer vermindert nur totalInvestors",
  data.totalInvestors === 2 && data.totalHoldings === 3 && data.screenedStocks.length === 2,
  JSON.stringify({ totalInvestors: data.totalInvestors, totalHoldings: data.totalHoldings, stocks: data.screenedStocks.length }),
);

// Regression: parseYearRange muss FMPs echtes 52-Wochen-Range-Format
// "low-high" (z.B. "196-287.2") korrekt parsen. Ein naiver Zahlen-Regex mit
// optionalem führendem "-" liest den trennenden Bindestrich als Minuszeichen
// der zweiten Zahl und liefert dadurch faelschlich yearLow=yearHigh=0 fuer
// praktisch jeden echten FMP-Wert (live auf Render am 10.08.2026 beobachtet:
// AMZN/TSM/etc. hatten trotz korrektem price/pe ueberall yearLow=0, was die
// CRV-downside-Formel auf den 100%-Fallback zwang).
console.log("\n=== parseYearRange: FMP-Format \"low-high\" ===");
check("AMZN-Beispiel '196-287.2' -> {196, 287.2}", JSON.stringify(parseYearRange("196-287.2")) === JSON.stringify({ yearLow: 196, yearHigh: 287.2 }), JSON.stringify(parseYearRange("196-287.2")));
check("Dreistellige Range '1000-1250.5' -> {1000, 1250.5}", JSON.stringify(parseYearRange("1000-1250.5")) === JSON.stringify({ yearLow: 1000, yearHigh: 1250.5 }), JSON.stringify(parseYearRange("1000-1250.5")));
check("Leerer String -> {0, 0} (kein Crash)", JSON.stringify(parseYearRange("")) === JSON.stringify({ yearLow: 0, yearHigh: 0 }));
check("Nur eine Zahl -> {0, 0} (kein Rateergebnis)", JSON.stringify(parseYearRange("150")) === JSON.stringify({ yearLow: 0, yearHigh: 0 }));
check("null/undefined -> {0, 0} (kein Crash)", JSON.stringify(parseYearRange(null)) === JSON.stringify({ yearLow: 0, yearHigh: 0 }) && JSON.stringify(parseYearRange(undefined)) === JSON.stringify({ yearLow: 0, yearHigh: 0 }));

// Regression: die Ticker-Aufloesung darf die Stock-Liste NICHT pro Holding
// neu normalisieren/durchsuchen. Live-Vorfall am 10.08.2026: die alte
// .find()-Implementierung rief normalizeCompanyName() (5 Regex-Passes) fuer
// JEDE Zeile der kompletten FMP-Stock-Liste bei JEDEM der ~5700 SEC-Holdings
// auf -- das blockierte den Node-Event-Loop so lange, dass die gesamte
// Render-App (inkl. /api/health) 10+ Minuten unerreichbar wurde. Der Fix
// normalisiert die Stock-Liste einmal (buildNormalizedStockList) und nutzt
// eine Map fuer den exakten Treffer -- dieser Test baut eine synthetische
// 20.000-Zeilen-Liste und misst, dass 500 Aufloesungen dagegen deutlich
// unter einer Sekunde dauern (die alte Implementierung haette bei dieser
// Groessenordnung bereits mehrere Sekunden gebraucht, bei der echten
// Produktionsgroesse von ~65.000 Zeilen und ~5700 Holdings mehrere Minuten).
console.log("\n=== Performance: Ticker-Aufloesung skaliert nicht mit holdings×liste ===");
{
  const bigList: StockListRow[] = [];
  for (let i = 0; i < 20000; i++) {
    bigList.push({ symbol: `SYM${i}`, companyName: `Synthetic Company Number ${i} Inc` });
  }
  bigList.push({ symbol: "AAPL", companyName: "Apple Inc" });
  bigList.push({ symbol: "MSFT", companyName: "Microsoft Corp" });

  const normalizedList = buildNormalizedStockList(bigList);
  const exactByName = new Map<string, string>();
  for (const row of normalizedList) {
    if (!exactByName.has(row.normalizedName)) exactByName.set(row.normalizedName, row.symbol);
  }

  const start = Date.now();
  let resolvedCount = 0;
  for (let i = 0; i < 500; i++) {
    const issuer = i % 2 === 0 ? "Apple Inc" : "Microsoft Corp";
    const ticker = resolveTickerFromNormalizedList(issuer, normalizedList, exactByName);
    if (ticker) resolvedCount++;
  }
  const elapsedMs = Date.now() - start;
  check("500 Auflösungen gegen 20k-Zeilen-Liste unter 1000ms (kein O(holdings×liste)-Rescan)", elapsedMs < 1000, `${elapsedMs}ms`);
  check("Alle 500 Auflösungen liefern korrekten Ticker", resolvedCount === 500, String(resolvedCount));
}
console.log("\n=== Ticker-Auflösung: Korrektheit exakter vs. fuzzy Treffer ===");
{
  const list: StockListRow[] = [
    { symbol: "AAPL", companyName: "Apple Inc" },
    { symbol: "BRKB", companyName: "Berkshire Hathaway Inc Class B" },
    { symbol: "XYZ", companyName: "NotAMatch Corp" },
  ];
  const normalizedList = buildNormalizedStockList(list);
  const exactByName = new Map<string, string>();
  for (const row of normalizedList) {
    if (!exactByName.has(row.normalizedName)) exactByName.set(row.normalizedName, row.symbol);
  }
  check("Exakter Treffer 'Apple Inc' -> AAPL", resolveTickerFromNormalizedList("Apple Inc", normalizedList, exactByName) === "AAPL");
  check("Fuzzy Treffer 'Berkshire Hathaway' -> BRKB", resolveTickerFromNormalizedList("Berkshire Hathaway", normalizedList, exactByName) === "BRKB");
  check("Kein Treffer für unbekannten Issuer -> null", resolveTickerFromNormalizedList("Completely Unknown Company", normalizedList, exactByName) === null);
}

console.log(failed === 0 ? "\n✅ Alle Screener-Star-Investor-Tests bestanden" : `\n❌ ${failed} Screener-Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
