/**
 * WORK_RECESSION_MARKET_CHARTS — window, vol marks, PEG, FINRA strip.
 * Run: npx tsx script/test-recession-market-charts.ts
 */
import { deflateRawSync } from "node:zlib";
import {
  CHART_BOOKS,
  SERIES_FLOOR,
  VOL_Y_MAX,
  epsPrintFromEarningsRow,
  epsPrintFromRatioQuarter,
  epsPrintFromRow,
  epsYoyPercent,
  finraLeverage,
  forwardEstimateFieldNote,
  forwardNetIncomeFromEstimateRows,
  leverageForMarket,
  localVolMaxima,
  marginYoYAndZ,
  maxWindowStart,
  planAnalystEstimateCalls,
  parseFinraMarginSheetXml,
  peFromMetricsRow,
  pegDisplaySuffix,
  pegFromPeAndGrowth,
  ANALYST_ESTIMATES_CALL_CAP,
  aggregateLineForBook,
  analystEstimatesCapPerBook,
  assembleValuationMissing,
  bulkQuarterWindow,
  closeFromPriceRows,
  closeFromQuote,
  constituentFactsFromSources,
  epsFromIndexQuote,
  etfInfoHasShareEps,
  etfValuationNotes,
  incomePrintsFromBulkBody,
  indexValuationNotes,
  instrumentCanPriceEps,
  marketCapFromRow,
  marketsResponseSchema,
  membersFromHoldingRows,
  membersFromNportRows,
  membersFromSp500Rows,
  nportQuartersFor,
  valuationGapText,
  pickValuationInstrument,
  quarterlyNetIncomeFromRow,
  valuationLabelFor,
  realizedVol20,
  sliceByWindow,
  ttmEpsAt,
  valuationFromConstituentAggregates,
  valuationFromFmpRows,
  valuationFromIndexSources,
  valuationFromParts,
  volBandLabel,
  type ConstituentFacts,
} from "../shared/recession-market-charts";
import { MARKETS_CHART_CACHE_VERSION, unzipEntry } from "../server/recession-market-charts";
import { fmpAnalystEstimatesBatch } from "../server/fmp";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== Universum ===");
{
  check("vier Bücher SPY QQQ VGK ASHR", CHART_BOOKS.map((b) => b.id).join(",") === "SPY,QQQ,VGK,ASHR");
  check("ASHR realized, kein FXI", CHART_BOOKS.find((b) => b.id === "ASHR")?.volKind === "realized" && CHART_BOOKS.every((b) => b.etf !== "FXI"));
  check("QQQ VXNCLS implizit", CHART_BOOKS.find((b) => b.id === "QQQ")?.volId === "VXNCLS");
  check("VGK VSTOXX", CHART_BOOKS.find((b) => b.id === "VGK")?.volId === "^V2TX");
  check("Y-Skala fest 90", VOL_Y_MAX === 90);
  check("EU/ASHR analog", CHART_BOOKS.filter((b) => b.bandsAnalog).map((b) => b.id).join(",") === "VGK,ASHR");
}

console.log("\n=== Fenster ===");
{
  const dates = Array.from({ length: 30 }, (_, i) => `1998-12-${String(i + 1).padStart(2, "0")}`);
  dates.push("1999-01-03", "2013-11-01", "2024-01-02");
  const rows = dates.map((date) => ({ date }));
  const maxed = sliceByWindow(rows, "MAX");
  check("MAX startet nicht vor 1999", maxed.every((r) => r.date >= SERIES_FLOOR));
  check("MAX behält Serienstart nach 1999", maxed[0]?.date === "1999-01-03");
  check("maxWindowStart 1990 → 1999", maxWindowStart("1990-01-02") === SERIES_FLOOR);
  check("maxWindowStart 2013 bleibt", maxWindowStart("2013-11-01") === "2013-11-01");
  const year = Array.from({ length: 400 }, (_, i) => ({ date: `2020-01-${String((i % 28) + 1).padStart(2, "0")}` }));
  // unique ascending dates
  const asc = Array.from({ length: 400 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 1));
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10) };
  });
  check("1Y = 252 Handelstage", sliceByWindow(asc, "1Y").length === 252);
  const long = Array.from({ length: 2000 }, (_, i) => {
    const d = new Date(Date.UTC(2018, 0, 1));
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10) };
  });
  check("5Y = 1260", sliceByWindow(long, "5Y").length === 1260);
  void year;
}

console.log("\n=== Vol-Bänder und Marken ===");
{
  check("14.3 Complacency", volBandLabel(14.3) === "Complacency");
  check("20 Normal", volBandLabel(20) === "Normal");
  check("30 Fear", volBandLabel(30) === "Fear");
  check("40 Fear (nicht Extreme)", volBandLabel(40) === "Fear");
  check("40.01 Extreme Fear", volBandLabel(40.01) === "Extreme Fear");
  const vol = Array.from({ length: 80 }, (_, i) => ({ date: `2020-01-${String((i % 28) + 1).padStart(2, "0")}-${i}`, value: 12 }));
  vol[40] = { date: "2020-03-16", value: 82 };
  vol[10] = { date: "2020-01-15", value: 34 };
  const marks = localVolMaxima(vol);
  check("nur V>35", marks.length === 1 && marks[0].value === 82);
  check("30er-Spike keine Marke", marks.every((m) => m.value > 35));
  const flat = localVolMaxima(Array.from({ length: 50 }, (_, i) => ({ date: `d${i}`, value: 50 })));
  check("Plateau nur eine Marke", flat.length === 1);
}

console.log("\n=== Realized vol ===");
{
  const flat = Array.from({ length: 40 }, (_, i) => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, close: 100 }));
  const rv = realizedVol20(flat);
  check("konstanter Kurs → 0", rv.length > 0 && rv.every((p) => p.value === 0));
}

console.log("\n=== PEG / EPS (kein Lynch-Scorer) ===");
{
  const g = epsYoyPercent(118, 100);
  check("g in Prozent", g === 18);
  check("PEG = PE/g", pegFromPeAndGrowth(53.4, 17.8) != null && Math.abs((pegFromPeAndGrowth(53.4, 17.8) as number) - 3) < 0.001);
  check("PEG>3 teuer", (pegFromPeAndGrowth(54, 17.8) as number) > 3);
  check("g<=0 n/a", pegFromPeAndGrowth(20, 0) === null && pegFromPeAndGrowth(20, -4) === null);
  const prints = [1, 2, 3, 4, 5, 6, 7, 8].map((q, i) => ({ date: `2022-${String(i + 1).padStart(2, "0")}-01`, eps: q }));
  const ttm = ttmEpsAt(prints, "2022-08-15");
  check("TTM letzte 4", ttm.ttm === 5 + 6 + 7 + 8);
  check("TTM davor", ttm.prevTtm === 1 + 2 + 3 + 4);
  const v = valuationFromParts({
    price: 534,
    ttmEps: 10,
    prevTtmEps: 100 / 1.178,
    epsNtm: 12,
    allowForward: true,
    keyMetricsPe: null,
  });
  check("PE = Preis/EPS", v.pe === 53.4);
  check("Forward nur wenn erlaubt", v.peFwd != null && v.gCons != null);
  const hist = valuationFromParts({
    price: 400,
    ttmEps: 10,
    prevTtmEps: 9,
    epsNtm: 12,
    allowForward: false,
    keyMetricsPe: 99,
  });
  check("historischer Klick ohne Forward", hist.peFwd === null && hist.pegFwd === null);
  check("historisch kein aktuelles key-metrics-PE", hist.pe === 40);
  check("ETF-Proxy Schwelle", hist.pegExpensive === true);
  const vendorOnly = valuationFromParts({
    price: null,
    ttmEps: null,
    prevTtmEps: null,
    epsNtm: null,
    allowForward: true,
    keyMetricsPe: 27.4,
  });
  check("Vendor-PE ist kein PE", vendorOnly.pe === null, String(vendorOnly.pe));
}

console.log("\n=== FINRA nur SPY ===");
{
  const levels = Array.from({ length: 80 }, (_, i) => 1000 + i);
  levels[levels.length - 1] = 4000;
  const z = marginYoYAndZ(levels);
  check("Ausreißer z>1", z.z5y != null && z.z5y > 1);
  const calm = Array.from({ length: 80 }, () => 1000);
  check("konstante Serie z 0", marginYoYAndZ(calm).z5y === 0);
  const xml = `<row r="3"><c r="A3" t="inlineStr"><is><t>2026-07</t></is></c><c r="B3"><v>1417225</v></c></row>`;
  const parsed = parseFinraMarginSheetXml(xml);
  check("Jul 26 1 417 225 Mio", parsed[0]?.debitMillions === 1417225 && parsed[0]?.date === "2026-07-01");
  const strip = finraLeverage([
    ...Array.from({ length: 24 }, (_, i) => ({ date: `2024-${String((i % 12) + 1).padStart(2, "0")}-01`, debitMillions: 1_000_000 })),
    { date: "2026-07-01", debitMillions: 1_417_225 },
  ]);
  check("Mrd aus Millionen", strip != null && Math.round(strip.billions) === 1417);
  check("SPY behält Streifen", leverageForMarket("SPY", strip) === strip);
  check("QQQ ohne Streifen", leverageForMarket("QQQ", strip) === null);
  check("VGK ohne Streifen", leverageForMarket("VGK", strip) === null);
  check("ASHR ohne Streifen", leverageForMarket("ASHR", strip) === null);
  const monthly = Array.from({ length: 140 }, (_, i) => {
    const d = new Date(Date.UTC(2014, 0, 1));
    d.setUTCMonth(d.getUTCMonth() + i);
    return { date: d.toISOString().slice(0, 10), debitMillions: i === 139 ? 5_000_000 : 1_000_000 + i * 1000 };
  });
  const ten = finraLeverage(monthly, "10Y");
  const one = finraLeverage(monthly, "1Y");
  const three = finraLeverage(monthly, "3Y");
  const five = finraLeverage(monthly, "5Y");
  const max = finraLeverage(monthly, "MAX");
  check("10Y mehr als 60 Margin-Punkte", ten != null && ten.points.length > 60, String(ten?.points.length));
  check("10Y nimmt 120 Monate wenn die Serie länger ist", ten != null && ten.points.length === 120, String(ten?.points.length));
  check("1Y Margin sind 12 Monate", one != null && one.points.length === 12, String(one?.points.length));
  check("3Y Margin sind 36 Monate", three != null && three.points.length === 36, String(three?.points.length));
  check("5Y Margin bleiben 60 Monate", five != null && five.points.length === 60, String(five?.points.length));
  check("MAX Margin nimmt die Serie ab 1999", max != null && max.points.length === 140, String(max?.points.length));
  check("z5y bleibt die 5-Jahres-Statistik in jedem Fenster", one?.z5y === ten?.z5y && one?.z5y === three?.z5y && one?.z5y === five?.z5y && one?.z5y === max?.z5y, `${one?.z5y} ${ten?.z5y}`);
}

console.log("\n=== FMP-Felder, kein erfundener PE ===");
{
  check("ratios priceToEarningsRatio wird PE", peFromMetricsRow({ priceToEarningsRatio: 27.4 }) === 27.4);
  check("key-metrics peRatio bleibt gültig", peFromMetricsRow({ peRatio: 21.5 }) === 21.5);
  check("priceEarningsRatio Alias", peFromMetricsRow({ priceEarningsRatio: 18.2 }) === 18.2);
  check("0 und leeres Objekt bleiben n/a", peFromMetricsRow({ priceToEarningsRatio: 0, pe: 0 }) === null && peFromMetricsRow({}) === null);
  check("epsDiluted ist ein Quartalsprint", epsPrintFromRow({ date: "2024-12-31", epsDiluted: 1.2 })?.eps === 1.2);
  check("epsdiluted kleingeschrieben bleibt lesbar", epsPrintFromRow({ date: "2024-09-30", epsdiluted: 1.1 })?.eps === 1.1);
  const fromRatios = valuationFromFmpRows({
    price: 670,
    asOf: "2026-10-02",
    allowForward: true,
    incomeRows: [],
    earningsRows: [],
    ratiosRow: { priceToEarningsRatio: 27.4, priceToEarningsGrowthRatio: 1.82, forwardPriceToEarningsGrowthRatio: 1.64 },
    keyMetricsRow: { peRatio: null, returnOnInvestedCapital: 0.2 },
    estimateRows: [{ date: "2027-09-30", epsAvg: 32.5 }],
  });
  check("Vendor priceToEarningsRatio allein bleibt n/a", fromRatios.pe === null, String(fromRatios.pe));
  check("epsAvg wird Forward-PE", fromRatios.peFwd != null && Math.abs(fromRatios.peFwd - 670 / 32.5) < 0.02, String(fromRatios.peFwd));
  check("Vendor-PEG füllt nur die Lücke und ist markiert", fromRatios.peg === 1.82 && fromRatios.pegKind === "vendor", `${fromRatios.peg} ${fromRatios.pegKind}`);
  check("Vendor-PEG fwd nur ohne Konsens-g", fromRatios.pegFwd === 1.64 && fromRatios.pegFwdKind === "vendor", `${fromRatios.pegFwd} ${fromRatios.pegFwdKind}`);
  const fromIncome = valuationFromFmpRows({
    price: 400,
    asOf: "2024-12-31",
    allowForward: true,
    incomeRows: [1, 1, 1, 1, 1.2, 1.2, 1.2, 1.2].map((eps, i) => ({
      date: `202${i < 4 ? 3 : 4}-${String(((i % 4) * 3) + 3).padStart(2, "0")}-28`,
      epsDiluted: eps,
    })),
    earningsRows: [],
    ratiosRow: { peRatio: null },
    keyMetricsRow: {},
    estimateRows: [{ date: "2025-12-31", estimatedEpsDiluted: 6 }],
  });
  check("epsDiluted liefert PE und EPS YoY", fromIncome.pe != null && fromIncome.epsYoy === 20, `pe=${fromIncome.pe} yoy=${fromIncome.epsYoy}`);
  check("historisches key-metrics-PE überschreibt den Kurs nicht", fromIncome.pe === 83.33, String(fromIncome.pe));
  const hist = valuationFromFmpRows({
    price: 400,
    asOf: "2024-12-31",
    allowForward: false,
    incomeRows: [1, 1, 1, 1, 1.2, 1.2, 1.2, 1.2].map((eps, i) => ({
      date: `202${i < 4 ? 3 : 4}-${String(((i % 4) * 3) + 3).padStart(2, "0")}-28`,
      epsDiluted: eps,
    })),
    earningsRows: [],
    ratiosRow: { priceToEarningsRatio: 99 },
    keyMetricsRow: { peRatio: 88 },
    estimateRows: [{ date: "2025-12-31", epsAvg: 6 }],
  });
  check("historischer Klick ignoriert heutige Ratio-PE", hist.pe === 83.33 && hist.peFwd === null, `pe=${hist.pe} fwd=${hist.peFwd}`);
  const indexOnly = [200, 200, 200, 200, 220, 220, 220, 220].map((eps, i) => ({
    date: `202${i < 4 ? 3 : 4}-${String(((i % 4) * 3) + 3).padStart(2, "0")}-28`,
    epsDiluted: eps,
  }));
  const mixed = valuationFromFmpRows({
    price: 670,
    asOf: "2024-12-31",
    allowForward: true,
    incomeRows: [],
    earningsRows: [],
    indexIncomeRows: indexOnly,
    ratiosRow: { priceToEarningsRatio: 27.4 },
    keyMetricsRow: null,
    estimateRows: [],
  });
  check("Index-EPS wird nicht durch den ETF-Preis geteilt", mixed.pe == null, String(mixed.pe));
  check("Index-YoY wird nicht an den ETF-Proxy gehängt", mixed.epsYoy == null, String(mixed.epsYoy));
  check("ohne ETF-Schätzung bleibt Forward-PE n/a", mixed.peFwd == null, String(mixed.peFwd));
  check("Null-epsActual ist kein Druck", epsPrintFromEarningsRow({ date: "2024-09-30", epsActual: null, epsEstimated: 1.2 }) == null);
  check("Jahres-netIncomePerShare ist kein Quartal", epsPrintFromRatioQuarter({ date: "2024-12-31", period: "FY", netIncomePerShare: 10 }) == null);

  const quarters = [2, 2, 2, 2, 2.5, 2.5, 2.5, 2.5].map((eps, i) => ({
    date: `202${i < 4 ? 3 : 4}-${String(((i % 4) * 3) + 3).padStart(2, "0")}-28`,
    period: i % 4 === 3 ? "Q4" : `Q${(i % 4) + 1}`,
    netIncomePerShare: eps,
    priceToEarningsRatio: 99,
  }));
  const fromQuarterRatios = valuationFromFmpRows({
    price: 250,
    asOf: "2024-12-31",
    allowForward: true,
    incomeRows: [],
    earningsRows: [{ date: "2024-12-31", epsActual: null, epsEstimated: 3 }],
    ratioQuarterRows: quarters,
    ratiosRow: { priceToEarningsRatio: 99, priceToEarningsGrowthRatio: 9.9, forwardPriceToEarningsGrowthRatio: 8.8 },
    keyMetricsRow: { peRatio: 88 },
    estimateRows: [{ date: "2025-12-31", epsAvg: 12 }],
  });
  check("Quartals-netIncomePerShare: PE = Preis / Summe", fromQuarterRatios.pe === 25, String(fromQuarterRatios.pe));
  check("Quartals-netIncomePerShare: EPS YoY", fromQuarterRatios.epsYoy === 25, String(fromQuarterRatios.epsYoy));
  check("Quartals-netIncomePerShare: PEG = PE/g", fromQuarterRatios.peg === 1 && fromQuarterRatios.pegKind === "formula", `${fromQuarterRatios.peg} ${fromQuarterRatios.pegKind}`);
  check("Forward-PE = Preis / epsAvg", fromQuarterRatios.peFwd === 20.83, String(fromQuarterRatios.peFwd));
  check("Forward-PEG = PE fwd / g Konsens", fromQuarterRatios.pegFwd === 1.04 && fromQuarterRatios.pegFwdKind === "formula", `${fromQuarterRatios.pegFwd} ${fromQuarterRatios.pegFwdKind}`);

  const incomeWins = valuationFromFmpRows({
    price: 96,
    asOf: "2024-12-31",
    allowForward: false,
    incomeRows: [1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.2].map((eps, i) => ({
      date: `202${i < 4 ? 3 : 4}-${String(((i % 4) * 3) + 3).padStart(2, "0")}-28`,
      epsDiluted: eps,
    })),
    earningsRows: [],
    ratioQuarterRows: quarters,
    ratiosRow: { priceToEarningsRatio: 99 },
    keyMetricsRow: null,
    estimateRows: [],
  });
  check("epsDiluted schlägt ratios-EPS", incomeWins.pe === 20, String(incomeWins.pe));
  const zeroIncome = valuationFromFmpRows({
    price: 250,
    asOf: "2024-12-31",
    allowForward: false,
    incomeRows: [0, 0, 0, 0, 0, 0, 0, 0].map((eps, i) => ({
      date: `202${i < 4 ? 3 : 4}-${String(((i % 4) * 3) + 3).padStart(2, "0")}-28`,
      epsDiluted: eps,
    })),
    earningsRows: [],
    ratioQuarterRows: quarters,
    ratiosRow: null,
    keyMetricsRow: null,
    estimateRows: [],
  });
  check("Income-Nullen fallen auf Quartals-EPS", zeroIncome.pe === 25, String(zeroIncome.pe));

  const shrunk = valuationFromFmpRows({
    price: 160,
    asOf: "2024-12-31",
    allowForward: true,
    incomeRows: [3, 3, 3, 3, 2, 2, 2, 2].map((eps, i) => ({
      date: `202${i < 4 ? 3 : 4}-${String(((i % 4) * 3) + 3).padStart(2, "0")}-28`,
      epsDiluted: eps,
    })),
    earningsRows: [],
    ratiosRow: { priceToEarningsGrowthRatio: 1.5, forwardPriceToEarningsGrowthRatio: 1.2 },
    keyMetricsRow: null,
    estimateRows: [{ date: "2025-12-31", epsAvg: 7 }],
  });
  check("g<=0 bleibt n/a trotz Vendor-PEG", shrunk.pe === 20 && shrunk.epsYoy != null && shrunk.epsYoy < 0 && shrunk.peg == null && shrunk.pegKind == null, `pe=${shrunk.pe} yoy=${shrunk.epsYoy} peg=${shrunk.peg}`);
  check("g Konsens <=0 bleibt n/a trotz Vendor-PEG fwd", shrunk.pegFwd == null && shrunk.pegFwdKind == null, String(shrunk.pegFwd));

  const ttmOnly = valuationFromFmpRows({
    price: 500,
    asOf: "2026-10-02",
    allowForward: true,
    incomeRows: [],
    earningsRows: [],
    ratioQuarterRows: [{ date: "2026-06-30", netIncomePerShareTTM: 10, period: "Q2" }],
    ratiosTtmRow: { netIncomePerShareTTM: 25, priceToEarningsRatioTTM: 40 },
    ratiosRow: { priceToEarningsGrowthRatioTTM: 2.1 },
    keyMetricsRow: null,
    estimateRows: [{ date: "2027-09-30", epsAvg: 30 }],
  });
  check("ratios-ttm EPS ist ein TTM, keine Summe", ttmOnly.pe === 20, String(ttmOnly.pe));
  check("ratios-ttm ohne Vorquartale lässt YoY n/a", ttmOnly.epsYoy == null, String(ttmOnly.epsYoy));
  check("Forward aus demselben Kurs und epsAvg", ttmOnly.peFwd === 16.67 && ttmOnly.pegFwdKind === "formula", `${ttmOnly.peFwd} ${ttmOnly.pegFwdKind}`);

  const indexPriced = valuationFromFmpRows({
    price: 5280,
    asOf: "2024-12-31",
    allowForward: true,
    incomeRows: [50, 50, 50, 50, 55, 55, 55, 55].map((eps, i) => ({
      date: `202${i < 4 ? 3 : 4}-${String(((i % 4) * 3) + 3).padStart(2, "0")}-28`,
      epsDiluted: eps,
    })),
    earningsRows: [],
    ratiosRow: null,
    keyMetricsRow: null,
    estimateRows: [{ date: "2025-12-31", epsAvg: 242 }],
  });
  check("Indexkurs / Index-EPS ist PE", indexPriced.pe === 24, String(indexPriced.pe));
  check("Indexkurs / Index-EPS liefert YoY", indexPriced.epsYoy === 10, String(indexPriced.epsYoy));
  check("Formel-PEG ohne Zusatz", pegDisplaySuffix("formula") === "");
  check("Vendor-PEG sagt Vendor-Ratio", pegDisplaySuffix("vendor") === " (Vendor-Ratio)");
}

function quartersOf(symbol: string, eps: number) {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((q) => ({
    date: `202${q < 5 ? 3 : 4}-0${((q - 1) % 4) + 1}-28`,
    symbol,
    netIncomePerShare: eps,
    period: "Q1",
  }));
}

console.log("\n=== Gleiche Einheit, ehrliches Label ===");
{
  const etf = {
    symbol: "SPY",
    role: "etf" as const,
    price: 670,
    incomeRows: [] as unknown[],
    earningsRows: [] as unknown[],
    ratioQuarterRows: quartersOf("SPY", 2),
    ratiosTtmRow: null,
    vendorRatiosRow: null,
    keyMetricsRow: null,
    estimateRows: [] as unknown[],
  };
  const index = {
    ...etf,
    symbol: "^GSPC",
    role: "fallback" as const,
    price: 5800,
    ratioQuarterRows: quartersOf("^GSPC", 55),
  };
  const picked = pickValuationInstrument(etf, index);
  check("ETF-Quartals-EPS füllt die Zeile nicht", picked.symbol === "^GSPC" && picked.price === 5800);
  check("Index-Zeile heißt Index ^GSPC", valuationLabelFor(picked, "SPY") === "Index ^GSPC");
  const emptyEtf = { ...etf, ratioQuarterRows: [] as unknown[] };
  const indexPick = pickValuationInstrument(emptyEtf, index);
  check("ohne ETF-EPS nimmt Indexkurs und Index-EPS", indexPick.symbol === "^GSPC" && indexPick.price === 5800);
  check("leerer ETF bleibt beim Index-Label", valuationLabelFor(indexPick, "SPY") === "Index ^GSPC");
  const unlabeled = pickValuationInstrument(emptyEtf, { ...index, price: null });
  check("Index ohne Kurs wird nicht mit dem ETF-Preis gepaart", unlabeled.symbol === "SPY");
  const fez = pickValuationInstrument(
    { ...emptyEtf, symbol: "VGK", price: 70 },
    { ...index, symbol: "FEZ", role: "fallback" as const, price: 52, ratioQuarterRows: quartersOf("FEZ", 1.1) },
  );
  check("FEZ-Quartale füllen VGK nicht", fez.symbol === "VGK" && fez.price === 70);
  const zeroEtf = {
    ...emptyEtf,
    incomeRows: [0, 0, 0, 0, 0, 0, 0, 0].map((eps, i) => ({
      date: `2024-0${(i % 8) + 1}-28`,
      epsDiluted: eps,
    })),
  };
  check("Income-Nullen sind kein Share-EPS", pickValuationInstrument(zeroEtf, index).symbol === "^GSPC");
}

const SPY_EARNINGS_NOTE = "GET /stable/earnings?symbol=SPY hat 1 EPS-Drucke, TTM braucht 4";
const SPY_EMPTY_NOTES = [
  "GET /stable/income-statement?symbol=SPY&period=quarter leer",
  SPY_EARNINGS_NOTE,
  "GET /stable/ratios?symbol=SPY&period=quarter leer",
  "GET /stable/ratios-ttm?symbol=SPY leer",
];
const GSPC_EMPTY_NOTES = [
  "GET /stable/income-statement?symbol=^GSPC&period=quarter leer",
  "GET /stable/earnings?symbol=^GSPC leer",
  "GET /stable/ratios?symbol=^GSPC&period=quarter leer",
  "GET /stable/ratios-ttm?symbol=^GSPC leer",
];

function blankInstrument(symbol: string, role: "etf" | "fallback", price: number | null) {
  return {
    symbol,
    role,
    price,
    incomeRows: [] as unknown[],
    earningsRows: [] as unknown[],
    ratioQuarterRows: [] as unknown[],
    ratiosTtmRow: null,
    vendorRatiosRow: null,
    keyMetricsRow: null,
    estimateRows: [] as unknown[],
  };
}

console.log("\n=== Live-Payloads 2026-10-02 ===");
{
  check("Cache-Key ist nicht mehr v3 bis v8", MARKETS_CHART_CACHE_VERSION === "v9", MARKETS_CHART_CACHE_VERSION);
  check("Analyst-Schätzungen: 20 je Buch, 80 je Anfrage", analystEstimatesCapPerBook(4) === 20 && ANALYST_ESTIMATES_CALL_CAP === 80 && analystEstimatesCapPerBook(4) * 4 === ANALYST_ESTIMATES_CALL_CAP);
  const prior = closeFromPriceRows(
    [{ date: "2026-10-03", close: 99999 }, { date: "2026-10-01", price: 6700 }],
    "2026-10-02",
  );
  check("^NDX-Kurs vom Vortag zählt, der Folgetag nicht", prior === 6700, String(prior));
  check("Indexzeile nur mit price-Feld", closeFromPriceRows([{ date: "2026-10-02", price: 20000 }], "2026-10-02") === 20000);
  check("Kurs nach dem ETF-Tag bleibt draußen", closeFromPriceRows([{ date: "2026-10-03", close: 1 }], "2026-10-02") == null);
  check("Quote-Preis am selben Tag", closeFromQuote({ price: 20100, timestamp: Date.parse("2026-10-02T20:00:00Z") / 1000 }, "2026-10-02") === 20100);
  check("Quote nach dem ETF-Tag bleibt draußen", closeFromQuote({ price: 20100, date: "2026-10-03" }, "2026-10-02") == null);

  const spyOne = {
    ...blankInstrument("SPY", "etf", 670),
    earningsRows: [{ date: "2026-09-30", epsActual: 1.84, epsEstimated: null }],
  };
  check("ein Earnings-Druck ist kein TTM", instrumentCanPriceEps(spyOne) === false);
  const gspcPrice = closeFromPriceRows([{ date: "2026-10-01", price: 6700 }], "2026-10-02");
  const gspc = {
    ...blankInstrument("^GSPC", "fallback", gspcPrice),
    ratioQuarterRows: quartersOf("^GSPC", 55),
  };
  const spyChosen = pickValuationInstrument(spyOne, gspc);
  check("SPY mit einem Druck nimmt ^GSPC", spyChosen.symbol === "^GSPC" && spyChosen.price === 6700);
  check("SPY-Fallback heißt nicht ETF-Proxy", valuationLabelFor(spyChosen, "SPY") === "Index ^GSPC");
  const spyPe = valuationFromFmpRows({
    price: spyChosen.price,
    asOf: "2026-10-02",
    allowForward: false,
    incomeRows: [],
    earningsRows: [],
    ratioQuarterRows: spyChosen.ratioQuarterRows,
    ratiosRow: { priceToEarningsRatio: 27.4 },
    keyMetricsRow: null,
    estimateRows: [],
  });
  check("PE ist ^GSPC-Kurs / ^GSPC-EPS", spyPe.pe === 30.45, String(spyPe.pe));

  const spyGap = assembleValuationMissing({
    chartEtf: "SPY",
    chosenSymbol: "SPY",
    valuationLabel: "ETF-Proxy",
    pe: null,
    peFwd: null,
    epsYoy: null,
    peg: null,
    pegFwd: null,
    gCons: null,
    allowForward: true,
    etfNotes: SPY_EMPTY_NOTES,
    fallbackNotes: GSPC_EMPTY_NOTES,
    priceNote: null,
    extraNotes: ["GET /stable/key-metrics?symbol=SPY leer"],
    fwdNote: "GET /stable/analyst-estimates?symbol=SPY&period=annual leer",
  });
  check("leeres ^GSPC bleibt in der SPY-Lücke", spyGap != null && spyGap.includes(SPY_EARNINGS_NOTE) && spyGap.includes("symbol=^GSPC"), spyGap ?? "");

  const qqq = {
    ...blankInstrument("QQQ", "etf", 500),
    earningsRows: [{ date: "2026-09-30", epsActual: null, epsEstimated: 3.2 }],
  };
  const ndxPrice = closeFromPriceRows([{ date: "2026-10-02", price: 20000 }], "2026-10-02");
  const ndx = {
    ...blankInstrument("^NDX", "fallback", ndxPrice),
    incomeRows: [40, 40, 40, 40, 50, 50, 50, 50].map((eps, i) => ({
      date: `202${i < 4 ? 3 : 4}-${String(((i % 4) * 3) + 3).padStart(2, "0")}-28`,
      epsDiluted: eps,
    })),
  };
  const qqqChosen = pickValuationInstrument(qqq, ndx);
  check("QQQ ohne epsActual nimmt ^NDX", qqqChosen.symbol === "^NDX" && valuationLabelFor(qqqChosen, "QQQ") === "Index ^NDX");
  const qqqPe = valuationFromFmpRows({
    price: qqqChosen.price,
    asOf: "2026-10-02",
    allowForward: true,
    incomeRows: qqqChosen.incomeRows,
    earningsRows: [],
    ratiosRow: null,
    keyMetricsRow: null,
    estimateRows: [{ date: "2027-09-30", epsAvg: 220 }],
  });
  check("QQQ-Fallback PE ist eine Zahl", qqqPe.pe === 100 && qqqPe.peFwd === 90.91, `pe=${qqqPe.pe} fwd=${qqqPe.peFwd}`);

  const qqqEmpty = assembleValuationMissing({
    chartEtf: "QQQ",
    chosenSymbol: "QQQ",
    valuationLabel: "ETF-Proxy",
    pe: null,
    peFwd: null,
    epsYoy: null,
    peg: null,
    pegFwd: null,
    gCons: null,
    allowForward: true,
    etfNotes: [
      "GET /stable/income-statement?symbol=QQQ&period=quarter leer",
      "GET /stable/earnings?symbol=QQQ ohne epsActual",
      "GET /stable/ratios?symbol=QQQ&period=quarter leer",
      "GET /stable/ratios-ttm?symbol=QQQ leer",
    ],
    fallbackNotes: [
      "GET /stable/income-statement?symbol=^NDX&period=quarter leer",
      "GET /stable/earnings?symbol=^NDX leer",
      "GET /stable/ratios?symbol=^NDX&period=quarter leer",
      "GET /stable/ratios-ttm?symbol=^NDX leer",
    ],
    priceNote: "GET /stable/historical-price-eod/full?symbol=^NDX ohne Kurs am 2026-10-02",
    extraNotes: ["GET /stable/key-metrics?symbol=QQQ leer"],
    fwdNote: "GET /stable/analyst-estimates?symbol=QQQ&period=annual leer",
  });
  check("QQQ ohne Kurs nennt ^NDX", qqqEmpty != null && qqqEmpty.includes("ohne Kurs am 2026-10-02") && qqqEmpty.includes("ohne epsActual"), qqqEmpty ?? "");

  const vgk = blankInstrument("VGK", "etf", 70);
  const fezLive = {
    ...blankInstrument("FEZ", "fallback", 52),
    ratioQuarterRows: quartersOf("FEZ", 1.1),
  };
  const vgkChosen = pickValuationInstrument(vgk, fezLive);
  const vgkMixed = valuationFromIndexSources({
    indexPrice: 52,
    etfPrice: 70,
    quote: { symbol: "FEZ", price: 52, eps: 4.4, pe: 11.8 },
    keyMetricsTtmRow: { symbol: "FEZ", netIncomePerShareTTM: 4.4, peRatioTTM: 11.8 },
    estimateRows: [{ date: "2027-09-30", symbol: "FEZ", epsAvg: 5 }],
    sectorPeRow: { date: "2026-10-02", sector: "Financial Services", exchange: "NYSE", pe: 14 },
    asOf: "2026-10-02",
    allowForward: true,
  });
  check("VGK-Preis wird nicht durch FEZ-EPS geteilt", vgkChosen.symbol === "VGK" && vgkMixed.pe == null && vgkMixed.peFwd == null, String(vgkMixed.pe));

  const ashrGap = assembleValuationMissing({
    chartEtf: "ASHR",
    chosenSymbol: "ASHR",
    valuationLabel: "ETF-Proxy",
    pe: null,
    peFwd: null,
    epsYoy: null,
    peg: null,
    pegFwd: null,
    gCons: null,
    allowForward: true,
    etfNotes: [
      "GET /stable/income-statement?symbol=ASHR&period=quarter leer",
      "GET /stable/earnings?symbol=ASHR leer",
      "GET /stable/ratios?symbol=ASHR&period=quarter leer",
      "GET /stable/ratios-ttm?symbol=ASHR leer",
    ],
    fallbackNotes: null,
    priceNote: null,
    extraNotes: ["GET /stable/key-metrics?symbol=ASHR leer"],
    fwdNote: "GET /stable/analyst-estimates?symbol=ASHR&period=annual leer",
  });
  check("ASHR bleibt n/a ohne Index", ashrGap != null && ashrGap.includes("symbol=ASHR") && !ashrGap.includes("^"), ashrGap ?? "");
}

console.log("\n=== Index-Quote und key-metrics-ttm, kein ETF-Share-EPS ===");
{
  const documentedQuote = {
    symbol: "^GSPC",
    name: "S&P 500",
    price: 6700,
    changePercentage: 0.1,
    change: 6,
    volume: 0,
    dayLow: 6680,
    dayHigh: 6710,
    yearHigh: 6900,
    yearLow: 5100,
    marketCap: null,
    priceAvg50: 6500,
    priceAvg200: 6100,
    exchange: "INDEX",
    open: 6690,
    previousClose: 6694,
    timestamp: Date.parse("2026-10-02T20:00:00Z") / 1000,
    pe: 27.4,
  };
  check("dokumentiertes Quote ohne eps ist kein EPS", epsFromIndexQuote(documentedQuote) == null);
  const quoteOnly = valuationFromIndexSources({
    indexPrice: 6700,
    etfPrice: 670,
    quote: documentedQuote,
    keyMetricsTtmRow: null,
    estimateRows: [],
    sectorPeRow: { date: "2026-10-02", sector: "Technology", exchange: "NASDAQ", pe: 32.1 },
    asOf: "2026-10-02",
    allowForward: true,
  });
  check("Quote-pe und Sector-pe bleiben n/a", quoteOnly.pe == null && quoteOnly.peFwd == null, String(quoteOnly.pe));
  const emptyNotes = indexValuationNotes("^GSPC", documentedQuote, null);
  check("leeres Quote nennt ohne eps und verwirft pe", emptyNotes.some((n) => n.includes("quote?symbol=^GSPC ohne eps")) && emptyNotes.some((n) => n.includes("pe ist kein Kurs/EPS")), emptyNotes.join(" | "));
  check("leeres key-metrics-ttm bleibt genannt", emptyNotes.some((n) => n.includes("key-metrics-ttm?symbol=^GSPC leer")));

  const withEps = valuationFromIndexSources({
    indexPrice: 6700,
    etfPrice: 670,
    quote: { ...documentedQuote, eps: 180 },
    keyMetricsTtmRow: { symbol: "^GSPC", netIncomePerShareTTM: 220, peRatioTTM: 27.4, earningsYieldTTM: 0.036 },
    estimateRows: [{ date: "2027-09-30", symbol: "^GSPC", epsAvg: 250 }],
    sectorPeRow: { date: "2026-10-02", sector: "Technology", exchange: "NASDAQ", pe: 32.1 },
    asOf: "2026-10-02",
    allowForward: true,
  });
  check("PE ist Indexkurs / key-metrics-ttm EPS", withEps.pe === 30.45, String(withEps.pe));
  check("ETF-Kurs 670 wird nicht durch Index-EPS geteilt", withEps.pe !== 3.05);
  check("peRatioTTM 27.4 ist nicht der PE", withEps.pe !== 27.4);
  check("Forward-PE ist Indexkurs / epsAvg", withEps.peFwd === 26.8, String(withEps.peFwd));
  check("ein TTM hat kein EPS YoY und kein PEG", withEps.epsYoy == null && withEps.peg == null);
  check("Forward-PEG kommt aus epsAvg gegen das TTM", withEps.pegFwd === 1.97 && withEps.pegFwdKind === "formula", String(withEps.pegFwd));

  const quoteEps = valuationFromIndexSources({
    indexPrice: closeFromQuote({ ...documentedQuote, eps: 220 }, "2026-10-02"),
    etfPrice: 670,
    quote: { ...documentedQuote, eps: 220 },
    keyMetricsTtmRow: null,
    estimateRows: [],
    sectorPeRow: null,
    asOf: "2026-10-02",
    allowForward: true,
  });
  check("Quote-eps derselben Zeile ergibt PE, Quote-pe nicht", quoteEps.pe === 30.45 && quoteEps.peFwd == null, String(quoteEps.pe));

  const spyInfo = {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    expenseRatio: 0.000945,
    assetsUnderManagement: 500000000000,
    nav: 670,
    navCurrency: "USD",
    holdingsCount: 503,
  };
  check("ETF-Info NAV ist kein EPS", etfInfoHasShareEps(spyInfo) === false);
  const ashrNotes = etfValuationNotes("ASHR", null, { symbol: "ASHR", expenseRatio: 0.0065, nav: 28, holdingsCount: 300 });
  check("ASHR nennt etf/info und den ETF-Kurs", ashrNotes.some((n) => n.includes("etf/info?symbol=ASHR ohne EPS")) && ashrNotes.some((n) => n.includes("quote?symbol=ASHR ist ETF-Kurs")), ashrNotes.join(" | "));
  const vgkNotes = etfValuationNotes("VGK", "FEZ", spyInfo);
  check("VGK nennt FEZ als ETF, nicht als Index", vgkNotes.some((n) => n.includes("quote?symbol=FEZ ist ETF-Kurs")) && !vgkNotes.some((n) => n.includes("^")), vgkNotes.join(" | "));
  const gap = assembleValuationMissing({
    chartEtf: "SPY",
    chosenSymbol: "^GSPC",
    valuationLabel: "Index ^GSPC",
    pe: null,
    peFwd: null,
    epsYoy: null,
    peg: null,
    pegFwd: null,
    gCons: null,
    allowForward: true,
    etfNotes: [],
    fallbackNotes: emptyNotes,
    priceNote: null,
    extraNotes: [],
    fwdNote: "GET /stable/analyst-estimates?symbol=^GSPC&period=annual leer",
  });
  check("SPY-Lücke nennt ^GSPC-Quote und key-metrics-ttm, nicht die ETF-GuV", gap != null && gap.includes("Formel auf ^GSPC") && gap.includes("key-metrics-ttm") && !gap.includes("income-statement?symbol=SPY"), gap ?? "");
}

function fact(partial: Partial<ConstituentFacts> & Pick<ConstituentFacts, "symbol">): ConstituentFacts {
  return {
    cik: null,
    marketCap: null,
    netIncomeTtm: null,
    netIncomePrevTtm: null,
    netIncomeFwd: null,
    reportedCurrency: "USD",
    broken: null,
    ...partial,
  };
}

console.log("\n=== Index-Aggregat, keine Durchschnitts-P/Es ===");
{
  const spy = aggregateLineForBook("SPY");
  const qqq = aggregateLineForBook("QQQ");
  const vgk = aggregateLineForBook("VGK");
  const ashr = aggregateLineForBook("ASHR");
  check("SPY heißt Aggregat NPORT und liest funds/disclosure", spy.label === "Aggregat NPORT SPY" && spy.blocked == null && spy.methodNote != null && spy.methodNote.includes("funds/disclosure?symbol=SPY") && spy.methodNote.includes("valUsd") && spy.methodNote.includes("balance"));
  check("QQQ heißt Aggregat NPORT und liest funds/disclosure", qqq.label === "Aggregat NPORT QQQ" && qqq.blocked == null && qqq.methodNote != null && qqq.methodNote.includes("funds/disclosure?symbol=QQQ") && !qqq.methodNote.includes("nasdaq-constituent"));
  check("VGK liest die NPORT-Datei, nicht FEZ", vgk.label === "Aggregat NPORT VGK" && vgk.blocked == null && vgk.methodNote != null && vgk.methodNote.includes("funds/disclosure?symbol=VGK") && !vgk.methodNote.includes("FEZ") && !vgk.methodNote.includes("^"));
  check("ASHR liest die NPORT-Datei und erfindet kein Indexsymbol", ashr.label === "Aggregat NPORT ASHR" && ashr.blocked == null && ashr.methodNote != null && ashr.methodNote.includes("funds/disclosure?symbol=ASHR") && !ashr.methodNote.includes("^") && !ashr.methodNote.includes("CSI"));

  const three = [
    fact({ symbol: "A", marketCap: 100, netIncomeTtm: 10, netIncomePrevTtm: 8, netIncomeFwd: 12 }),
    fact({ symbol: "B", marketCap: 100, netIncomeTtm: 5, netIncomePrevTtm: 4, netIncomeFwd: 6 }),
    fact({ symbol: "C", marketCap: 100, netIncomeTtm: 1, netIncomePrevTtm: 1, netIncomeFwd: 2 }),
  ];
  const agg = valuationFromConstituentAggregates({
    constituents: three,
    etfClose: 670,
    indexLevel: 6700,
    vendorPe: 27.4,
    allowForward: true,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("PE ist Summe Cap / Summe netIncome, nicht der Mittelwert", agg.core.pe === 18.75, String(agg.core.pe));
  check("arithmetisches Mittel der P/Es ist nicht das Ergebnis", agg.core.pe !== 43.33);
  check("ETF-Close und Indexstand ändern das Aggregat nicht", agg.core.pe !== 670 / 16 && agg.core.pe !== 6700 / 16);
  check("Vendor-pe 27.4 ist nicht der PE", agg.core.pe !== 27.4);
  check("EPS YoY aus demselben Constituenten-Set", agg.core.epsYoy === 23.08, String(agg.core.epsYoy));
  check("PEG = Aggregat-PE / Aggregat-g", agg.core.peg === 0.81 && agg.core.pegKind === "formula", String(agg.core.peg));
  check("Forward-PE ist Summe Cap / Summe netIncomeAvg", agg.core.peFwd === 15, String(agg.core.peFwd));
  check("Forward-PEG aus demselben Aggregat", agg.core.pegFwd === 0.6 && agg.core.pegFwdKind === "formula", String(agg.core.pegFwd));

  const loss = valuationFromConstituentAggregates({
    constituents: [
      fact({ symbol: "A", marketCap: 100, netIncomeTtm: 10, netIncomePrevTtm: 10 }),
      fact({ symbol: "B", marketCap: 100, netIncomeTtm: -2, netIncomePrevTtm: 1 }),
    ],
    etfClose: null,
    indexLevel: null,
    vendorPe: null,
    allowForward: true,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("negatives netIncome bleibt in der Summe", loss.core.pe === 25, String(loss.core.pe));
  const wiped = valuationFromConstituentAggregates({
    constituents: [
      fact({ symbol: "A", marketCap: 100, netIncomeTtm: -5, netIncomePrevTtm: 4 }),
      fact({ symbol: "B", marketCap: 100, netIncomeTtm: 4, netIncomePrevTtm: 4 }),
    ],
    etfClose: null,
    indexLevel: null,
    vendorPe: null,
    allowForward: false,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("Summe netIncome <= 0 lässt PE n/a", wiped.core.pe == null && wiped.peReasons.some((r) => r.includes("Summe netIncome <= 0")), wiped.peReasons.join(" | "));
  const zeroNi = valuationFromConstituentAggregates({
    constituents: [
      fact({ symbol: "A", marketCap: 100, netIncomeTtm: 0, netIncomePrevTtm: 1 }),
      fact({ symbol: "B", marketCap: 100, netIncomeTtm: 10, netIncomePrevTtm: 8 }),
    ],
    etfClose: null,
    indexLevel: null,
    vendorPe: null,
    allowForward: false,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("netIncome 0 ist eine Zahl und fehlt nicht", zeroNi.core.pe === 20, String(zeroNi.core.pe));

  const missingCap = valuationFromConstituentAggregates({
    constituents: [
      fact({ symbol: "A", marketCap: 100, netIncomeTtm: 10, netIncomePrevTtm: 8 }),
      fact({ symbol: "C", marketCap: null, netIncomeTtm: 1, netIncomePrevTtm: 1 }),
    ],
    etfClose: 670,
    indexLevel: 6700,
    vendorPe: 22,
    allowForward: true,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("fehlende Marktkapitalisierung bleibt draußen, A bleibt eine Zahl", missingCap.core.pe === 10 && missingCap.core.epsYoy === 25 && missingCap.core.peg === 0.4, `pe=${missingCap.core.pe} yoy=${missingCap.core.epsYoy} peg=${missingCap.core.peg}`);
  check("Deckung nennt C und verwirft den Vendor-pe", missingCap.coverageNote != null && missingCap.coverageNote.includes("C") && missingCap.coverageNote.includes("Marktkapitalisierung") && missingCap.core.pe !== 22, missingCap.coverageNote ?? "");
  const missingPrev = valuationFromConstituentAggregates({
    constituents: [
      fact({ symbol: "A", marketCap: 100, netIncomeTtm: 10, netIncomePrevTtm: 8 }),
      fact({ symbol: "B", marketCap: 100, netIncomeTtm: 5, netIncomePrevTtm: null }),
    ],
    etfClose: null,
    indexLevel: null,
    vendorPe: null,
    allowForward: true,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("ein fehlendes Vorjahr bleibt draußen, A hat PE, YoY und PEG", missingPrev.core.pe === 10 && missingPrev.core.epsYoy === 25 && missingPrev.core.peg === 0.4, `pe=${missingPrev.core.pe} yoy=${missingPrev.core.epsYoy} peg=${missingPrev.core.peg}`);
  check("Deckung nennt das fehlende Vorjahres-netIncome", missingPrev.coverageNote != null && missingPrev.coverageNote.includes("B") && missingPrev.coverageNote.includes("Vorjahres-netIncome"), missingPrev.coverageNote ?? "");

  const epsOnly = valuationFromConstituentAggregates({
    constituents: three.map((row) => ({ ...row, netIncomeFwd: null })),
    etfClose: null,
    indexLevel: null,
    vendorPe: null,
    allowForward: true,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("ohne netIncomeAvg bleibt Forward leer und nennt analyst-estimates", epsOnly.core.pe === 18.75 && epsOnly.core.peFwd == null && epsOnly.core.pegFwd == null && epsOnly.fwdReason != null && epsOnly.fwdReason.includes("analyst-estimates") && epsOnly.fwdReason.includes("netIncomeAvg") && epsOnly.fwdReason.includes("Deckel") && !epsOnly.fwdReason.includes("Forward-EPS") && !epsOnly.fwdReason.includes("fwd fehlt") && !epsOnly.fwdReason.includes("n/a"), epsOnly.fwdReason ?? "");
  const partialFwd = valuationFromConstituentAggregates({
    constituents: [
      fact({ symbol: "A", marketCap: 100, netIncomeTtm: 10, netIncomePrevTtm: 8, netIncomeFwd: 12 }),
      fact({ symbol: "B", marketCap: 100, netIncomeTtm: 5, netIncomePrevTtm: 4, netIncomeFwd: 6 }),
      fact({ symbol: "C", marketCap: 100, netIncomeTtm: 1, netIncomePrevTtm: 1, netIncomeFwd: null }),
    ],
    etfClose: null,
    indexLevel: null,
    vendorPe: 27.4,
    allowForward: true,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("Forward-Deckung lässt C draußen und bildet PE fwd aus A und B", partialFwd.core.pe === 18.75 && partialFwd.core.peFwd === 11.11 && partialFwd.core.pegFwd === 0.56, `pe=${partialFwd.core.pe} fwd=${partialFwd.core.peFwd} pegFwd=${partialFwd.core.pegFwd}`);
  check("Forward-Deckung nennt C, Vendor-pe bleibt draußen", partialFwd.coverageNote != null && partialFwd.coverageNote.includes("Forward-Deckung 2/3") && partialFwd.coverageNote.includes("C") && partialFwd.core.peFwd !== 27.4, partialFwd.coverageNote ?? "");
  const mixedFx = valuationFromConstituentAggregates({
    constituents: [
      fact({ symbol: "A", marketCap: 100, netIncomeTtm: 10, netIncomePrevTtm: 8, reportedCurrency: "USD" }),
      fact({ symbol: "D", marketCap: 100, netIncomeTtm: 10, netIncomePrevTtm: 8, reportedCurrency: "USD" }),
      fact({ symbol: "B", marketCap: 100, netIncomeTtm: 5, netIncomePrevTtm: 4, reportedCurrency: "EUR" }),
    ],
    etfClose: null,
    indexLevel: null,
    vendorPe: null,
    allowForward: true,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("fremde Währung bleibt draußen, die Mehrheit bleibt die Summe", mixedFx.core.pe === 10 && mixedFx.core.epsYoy === 25 && mixedFx.coverageNote != null && mixedFx.coverageNote.includes("B") && mixedFx.coverageNote.includes("EUR"), `${mixedFx.core.pe} ${mixedFx.coverageNote}`);
  const tiedFx = valuationFromConstituentAggregates({
    constituents: [
      fact({ symbol: "A", marketCap: 100, netIncomeTtm: 10, netIncomePrevTtm: 8, reportedCurrency: "USD" }),
      fact({ symbol: "B", marketCap: 100, netIncomeTtm: 5, netIncomePrevTtm: 4, reportedCurrency: "EUR" }),
    ],
    etfClose: null,
    indexLevel: null,
    vendorPe: null,
    allowForward: false,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("Währungs-Gleichstand bleibt n/a", tiedFx.core.pe == null && tiedFx.peReasons.some((r) => r.includes("USD") && r.includes("EUR")), tiedFx.peReasons.join(" | "));
  const classes = valuationFromConstituentAggregates({
    constituents: [
      fact({ symbol: "GOOG", cik: "1652044", marketCap: 100, netIncomeTtm: 10, netIncomePrevTtm: 8, netIncomeFwd: 12 }),
      fact({ symbol: "GOOGL", cik: "1652044", marketCap: 80, netIncomeTtm: 10, netIncomePrevTtm: 8, netIncomeFwd: 12 }),
    ],
    etfClose: null,
    indexLevel: null,
    vendorPe: null,
    allowForward: true,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("zwei Klassen, ein netIncome: Cap-Summe / ein Gewinn", classes.core.pe === 18 && classes.core.peFwd === 15, `pe=${classes.core.pe} fwd=${classes.core.peFwd}`);
  const hist = valuationFromConstituentAggregates({
    constituents: three,
    etfClose: 670,
    indexLevel: null,
    vendorPe: null,
    allowForward: false,
    useCurrentMarketCap: false,
    marketCapUnavailable: "GET /stable/historical-market-capitalization je Name nicht geladen",
  });
  check("heutige Caps werden am Stichtag nicht zum PE", hist.core.pe == null && hist.core.peFwd == null && hist.peReasons.some((r) => r.includes("historical-market-capitalization")), hist.peReasons.join(" | "));
  check("Vorjahres-Summe bleibt am Stichtag ein YoY", hist.core.epsYoy === 23.08, String(hist.core.epsYoy));

  const members = membersFromSp500Rows([
    { symbol: "AAPL", name: "Apple", sector: "Technology", subSector: "Consumer Electronics", headQuarter: "Cupertino", dateFirstAdded: "1982-11-30", cik: "320193", founded: "1976" },
    { symbol: "AAPL", cik: "320193" },
    { symbol: "MSFT", cik: "789019" },
  ]);
  check("sp500-constituent liest symbol und cik, ohne Doppel", members.length === 2 && members[0]?.cik === "320193");
  const holdings = membersFromHoldingRows([
    { symbol: "QQQ", asset: "AAPL", weightPercentage: 9, marketValue: 999 },
    { symbol: "QQQ", asset: "CASH", weightPercentage: 0.2, marketValue: 10 },
    { symbol: "MSFT", weightPercentage: 8, marketValue: 800 },
  ], "QQQ");
  check("Holdings liefern Tickers, nicht marketValue", holdings.map((m) => m.symbol).join(",") === "AAPL,MSFT");
  check("Holding-marketValue ist keine Marktkapitalisierung", marketCapFromRow({ symbol: "AAPL", marketValue: 999, weightPercentage: 9 }) == null);
  const documentedNport = {
    cik: "0000857489",
    date: "2023-10-31",
    acceptedDate: "2023-12-28 09:26:13",
    symbol: "000089.SZ",
    name: "Shenzhen Airport Co Ltd",
    lei: "3003009W045RIKRBZI44",
    title: "SHENZ AIRPORT-A",
    cusip: "N/A",
    isin: "CNE000000VK1",
    balance: 2438784,
    units: "NS",
    cur_cd: "CNY",
    valUsd: 2255873.6,
    pctVal: 0.0023838966190458206,
    payoffProfile: "Long",
    assetCat: "EC",
    issuerCat: "CORP",
    invCountry: "CN",
    isRestrictedSec: "N",
    fairValLevel: "2",
    isCashCollateral: "N",
    isNonCashCollateral: "N",
    isLoanByFund: "N",
  };
  const nportMembers = membersFromNportRows([
    documentedNport,
    { ...documentedNport, symbol: "B", valUsd: 800, pctVal: 0.01, balance: 10 },
    { ...documentedNport, symbol: "SPY", valUsd: 1, balance: 1 },
    { ...documentedNport, symbol: "CASH", assetCat: "EC" },
    { ...documentedNport, symbol: "BOND", assetCat: "DBT", payoffProfile: "Long" },
    { ...documentedNport, symbol: "SHORT", assetCat: "EC", payoffProfile: "Short", valUsd: -100, balance: -5 },
  ], "SPY");
  check("NPORT nimmt nur assetCat EC und kopiert den Fonds-cik nicht", nportMembers.length === 2 && nportMembers.every((m) => m.cik == null) && nportMembers.map((m) => m.symbol).join(",") === "000089.SZ,B");
  check("valUsd, pctVal und balance sind keine Marktkapitalisierung", marketCapFromRow(documentedNport) == null);
  const quarters = nportQuartersFor("2026-10-02");
  check("NPORT sucht die zwei letzten abgeschlossenen Quartale", quarters.length === 2 && quarters[0]?.year === 2026 && quarters[0]?.quarter === 3 && quarters[1]?.year === 2026 && quarters[1]?.quarter === 2, JSON.stringify(quarters));
  const fromNport = valuationFromConstituentAggregates({
    constituents: [
      fact({ symbol: "000089.SZ", cik: null, marketCap: 100, netIncomeTtm: 10, netIncomePrevTtm: 8 }),
      fact({ symbol: "B", cik: null, marketCap: 100, netIncomeTtm: 5, netIncomePrevTtm: 4 }),
    ],
    etfClose: 670,
    indexLevel: 6700,
    vendorPe: 27.4,
    allowForward: true,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  const positionOverShares = documentedNport.valUsd / documentedNport.balance;
  const invertedWeight = 1 / documentedNport.pctVal;
  const invertedAggregate = 15 / 200;
  check("gleicher Fonds-cik bleibt zwei Firmen: 200/15", fromNport.core.pe === 13.33, String(fromNport.core.pe));
  check("valUsd/balance, 1/pctVal und netIncome/Cap sind nicht der PE", fromNport.core.pe !== positionOverShares && fromNport.core.pe !== invertedWeight && fromNport.core.pe !== invertedAggregate && fromNport.core.pe !== 27.4);
  check("marketCap-Batch-Feld ist die Marktkapitalisierung", marketCapFromRow({ symbol: "AAPL", date: "2026-10-02", marketCap: 3_000 })?.marketCap === 3000);
  check("FY-netIncome ist kein Quartal", quarterlyNetIncomeFromRow({ symbol: "AAPL", date: "2024-12-31", period: "FY", netIncome: 99, reportedCurrency: "USD" }) == null);

  const csv = [
    "symbol,date,period,reportedCurrency,netIncome,eps",
    "AAPL,2023-03-31,Q1,USD,1,0.1",
    "AAPL,2023-06-30,Q2,USD,1,0.1",
    "AAPL,2023-09-30,Q3,USD,1,0.1",
    "AAPL,2023-12-31,Q4,USD,1,0.1",
    "AAPL,2024-03-31,Q1,USD,2,0.2",
    "AAPL,2024-06-30,Q2,USD,2,0.2",
    "AAPL,2024-09-30,Q3,USD,2,0.2",
    "AAPL,2024-12-31,Q4,USD,2,0.2",
    "AAPL,2024-12-31,FY,USD,99,9",
    "MSFT,2024-12-31,Q4,USD,50,1",
  ].join("\n");
  const prints = incomePrintsFromBulkBody(csv, new Set(["AAPL"]));
  const built = constituentFactsFromSources({
    members: [{ symbol: "AAPL", cik: "320193" }],
    prints,
    marketCaps: [{ symbol: "AAPL", marketCap: 80 }],
    estimateRows: [
      { symbol: "AAPL", date: "2025-12-31", epsAvg: 9, period: "annual" },
      { symbol: "AAPL", date: "2025-12-31", netIncomeAvg: 12, period: "annual" },
    ],
    asOf: "2024-12-31",
  });
  check("Bulk filtert auf Mitglieder und verwirft FY", prints.length === 8 && prints.every((p) => p.symbol === "AAPL"));
  const fromBulk = valuationFromConstituentAggregates({
    constituents: built,
    etfClose: 670,
    indexLevel: 6700,
    vendorPe: 27.4,
    allowForward: true,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
  });
  check("acht Quartale: TTM 8, Vorjahr 4, PE 10", fromBulk.core.pe === 10 && fromBulk.core.epsYoy === 100, `pe=${fromBulk.core.pe} yoy=${fromBulk.core.epsYoy}`);
  check("epsAvg wird nicht zum Forward-Gewinn; netIncomeAvg schon", fromBulk.core.peFwd === 6.67, String(fromBulk.core.peFwd));
  const window8 = bulkQuarterWindow("2026-10-02");
  check("acht abgeschlossene Bulk-Quartale bis Q3 2026", window8.length === 8 && window8[0]?.period === "Q4" && window8[0]?.year === 2024 && window8[7]?.period === "Q3" && window8[7]?.year === 2026, JSON.stringify(window8));

  const quoteRows = [
    { symbol: "A", price: 50, marketCap: 100, pe: 27.4 },
    { symbol: "B", price: 40, marketCap: 100, pe: 22 },
    { symbol: "C", price: 10, marketCap: 100, pe: 9 },
  ];
  check("Quote-price allein ist keine Marktkapitalisierung", marketCapFromRow({ symbol: "A", price: 50, pe: 27.4 }) == null);
  const quoteCaps = quoteRows.flatMap((row) => {
    const cap = marketCapFromRow(row);
    return cap ? [cap] : [];
  });
  check("Quote-marketCap wird gelesen und price nicht als Cap", quoteCaps.length === 3 && quoteCaps[0]?.marketCap === 100 && quoteCaps[1]?.marketCap === 100);
  const estimatePlan = planAnalystEstimateCalls(["A", "B", "A", "C"], 2);
  check("Schätz-Plan dedupliziert und lässt den Rest unter dem Deckel", estimatePlan.load.join(",") === "A,B" && estimatePlan.skipped.join(",") === "C");
  const quarterDates = ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
  const quarterPrints = (symbol: string, prevEach: number, ttmEach: number) => quarterDates.map((date, i) => ({
    symbol,
    date,
    period: `Q${(i % 4) + 1}`,
    reportedCurrency: "USD",
    netIncome: i < 4 ? prevEach : ttmEach,
  }));
  const estimateRows = [
    { symbol: "A", date: "2027-09-27", period: "annual", epsAvg: 5, netIncomeAvg: 12 },
    { symbol: "B", date: "2027-09-27", period: "annual", epsAvg: 4, netIncomeAvg: 6 },
    { symbol: "C", date: "2027-09-27", period: "annual", epsAvg: 1, netIncomeAvg: 3 },
  ].filter((row) => estimatePlan.load.indexOf(row.symbol) >= 0);
  const joined = constituentFactsFromSources({
    members: [
      { symbol: "A", cik: null },
      { symbol: "B", cik: null },
      { symbol: "C", cik: null },
    ],
    prints: [
      ...quarterPrints("A", 2, 2.5),
      ...quarterPrints("B", 1, 1.25),
      ...quarterPrints("C", 0.25, 0.25),
    ],
    marketCaps: quoteCaps,
    estimateRows,
    asOf: "2026-10-02",
  });
  const joinedVal = valuationFromConstituentAggregates({
    constituents: joined,
    etfClose: 670,
    indexLevel: 6700,
    vendorPe: 27.4,
    allowForward: true,
    useCurrentMarketCap: true,
    marketCapUnavailable: null,
    unloadedForwardSymbols: estimatePlan.skipped,
    estimatesCap: 2,
  });
  const priceOverEps = (50 + 40) / (5 + 4);
  check("Quote-Cap / netIncomeAvg ist das Forward-PE", joinedVal.core.peFwd === 11.11 && joinedVal.core.pegFwd === 0.56, `fwd=${joinedVal.core.peFwd} pegFwd=${joinedVal.core.pegFwd}`);
  check("price/epsAvg, Vendor-pe und ETF-Close sind nicht das Forward-PE", joinedVal.core.peFwd !== priceOverEps && joinedVal.core.peFwd !== 27.4 && joinedVal.core.peFwd !== 670 / 9 && joinedVal.core.peFwd !== 5);
  check("der Deckel lässt C draußen und löscht A und B nicht", joinedVal.core.pe === 18.75 && joinedVal.coverageNote != null && joinedVal.coverageNote.includes("Forward-Deckung 2/3") && joinedVal.coverageNote.includes("nicht geladen (Deckel 2)") && joinedVal.coverageNote.includes("C"), joinedVal.coverageNote ?? "");
  check("epsAvg ohne netIncomeAvg bleibt kein Forward-Gewinn", forwardNetIncomeFromEstimateRows([{ symbol: "A", date: "2027-09-27", period: "annual", epsAvg: 5 }], "2026-10-02") == null);

  const gap = assembleValuationMissing({
    chartEtf: "SPY",
    chosenSymbol: "SPY",
    valuationLabel: "Aggregat NPORT SPY",
    pe: 18.75,
    peFwd: null,
    epsYoy: 23.08,
    peg: 0.81,
    pegFwd: null,
    gCons: null,
    allowForward: true,
    etfNotes: [],
    fallbackNotes: [],
    priceNote: null,
    extraNotes: [],
    fwdNote: forwardEstimateFieldNote(20),
    methodNote: spy.methodNote,
  });
  check("Aggregat-Zeile sagt die Summe, nicht Kurs/EPS", gap != null && gap.includes("Summe Marktkapitalisierung / Summe netIncome") && gap.includes("funds/disclosure?symbol=SPY") && !gap.includes("Kurs und EPS") && !gap.includes("sp500-constituent"), gap ?? "");
  check("Forward und Forward-PEG nennen analyst-estimates und sagen nicht fwd fehlt", gap != null && gap.includes("Forward-PE:") && gap.includes("Forward-PEG:") && gap.includes("analyst-estimates") && gap.includes("netIncomeAvg") && gap.includes("Deckel 20") && !gap.includes("Forward-EPS") && !gap.includes("fwd fehlt") && !gap.includes("n/a"), gap ?? "");
  check("die Zeile zeigt die Zahl und sonst das benannte Feld", valuationGapText(gap, "Forward-PE:").includes("netIncomeAvg") && valuationGapText(gap, "Forward-PE:").includes("Deckel") && !valuationGapText(gap, "Forward-PE:").includes("Forward-EPS") && valuationGapText(gap, "PE fehlt:") === "PE fehlt" && !valuationGapText(gap, "Forward-PE:").includes("n/a"));
  const shaped = marketsResponseSchema.safeParse({
    asOf: "2026-10-02",
    window: "10Y",
    markets: ["SPY", "QQQ", "VGK", "ASHR"].map((id) => ({
      id,
      etf: id,
      name: id,
      volId: id === "ASHR" ? "realized20" : "VIXCLS",
      volKind: id === "ASHR" ? "realized" : "implied",
      bandsAnalog: id === "VGK" || id === "ASHR",
      volYMax: 90,
      volNote: null,
      ohlcv: [],
      vol: [],
      marks: [],
      snapshot: {
        pe: id === "SPY" ? 18.75 : null,
        peFwd: null,
        peg: id === "SPY" ? 0.81 : null,
        pegFwd: null,
        pegKind: id === "SPY" ? "formula" : null,
        pegFwdKind: null,
        epsYoy: id === "SPY" ? 23.08 : null,
        rsi: 54.5,
        macdHist: -0.06,
        missing: null,
      },
      leverage: null,
      leverageNote: null,
      valuationLabel: aggregateLineForBook(id).label,
    })),
  });
  check("Antwortform bleibt am UI-Schema", shaped.success, shaped.success ? "" : JSON.stringify(shaped.error.issues[0]));
}

console.log("\n=== xlsx unzip ===");
{
  const payload = Buffer.from("<t>2026-07</t>", "utf8");
  const packed = deflateRawSync(payload);
  const name = Buffer.from("xl/worksheets/sheet1.xml");
  const hdr = Buffer.alloc(30);
  hdr.writeUInt32LE(0x04034b50, 0);
  hdr.writeUInt16LE(20, 4);
  hdr.writeUInt16LE(8, 8);
  hdr.writeUInt32LE(packed.length, 18);
  hdr.writeUInt32LE(payload.length, 22);
  hdr.writeUInt16LE(name.length, 26);
  const zip = Buffer.concat([hdr, name, packed]);
  const out = unzipEntry(zip, "xl/worksheets/sheet1.xml");
  check("deflate entry", out?.toString("utf8") === payload.toString("utf8"));
}

async function proveEstimateBatchWithoutKey(): Promise<void> {
  if (process.env.FMP_API_KEY) {
    console.log("  (FMP_API_KEY ist gesetzt — der Fixture-Pfad bleibt der Beweis, kein Live-Abruf)");
    return;
  }
  const started = Date.now();
  const batch = await fmpAnalystEstimatesBatch(["AAPL", "MSFT", "NVDA"], ANALYST_ESTIMATES_CALL_CAP);
  const elapsed = Date.now() - started;
  check(
    "ohne Key ruft analyst-estimates an und stoppt nach dem ersten Fehler",
    batch.keyMissing && batch.stoppedEarly && batch.rows.length === 0 && batch.loaded.length === 0 && batch.failed.join(",") === "AAPL" && batch.skipped.join(",") === "MSFT,NVDA" && elapsed < 2000,
    `failed=${batch.failed.join(",")} skipped=${batch.skipped.join(",")} elapsed=${elapsed}`,
  );
}

proveEstimateBatchWithoutKey().then(() => {
  if (failed) {
    console.error(`\n${failed} fehlgeschlagen`);
    process.exit(1);
  }
  console.log("\nalles grün");
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
