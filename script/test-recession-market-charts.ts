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
  leverageForMarket,
  localVolMaxima,
  marginYoYAndZ,
  maxWindowStart,
  parseFinraMarginSheetXml,
  peFromMetricsRow,
  pegDisplaySuffix,
  pegFromPeAndGrowth,
  assembleValuationMissing,
  closeFromPriceRows,
  closeFromQuote,
  instrumentCanPriceEps,
  pickValuationInstrument,
  valuationLabelFor,
  realizedVol20,
  sliceByWindow,
  ttmEpsAt,
  valuationFromFmpRows,
  valuationFromParts,
  volBandLabel,
} from "../shared/recession-market-charts";
import { MARKETS_CHART_CACHE_VERSION, unzipEntry } from "../server/recession-market-charts";

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
  check("ETF-Quartals-EPS schlägt den Index", picked.symbol === "SPY" && picked.price === 670);
  check("ETF-Zeile bleibt ETF-Proxy", valuationLabelFor(picked, "SPY") === "ETF-Proxy");
  const emptyEtf = { ...etf, ratioQuarterRows: [] as unknown[] };
  const indexPick = pickValuationInstrument(emptyEtf, index);
  check("ohne ETF-EPS nimmt Indexkurs und Index-EPS", indexPick.symbol === "^GSPC" && indexPick.price === 5800);
  check("Index-Zeile heißt Index ^GSPC", valuationLabelFor(indexPick, "SPY") === "Index ^GSPC");
  const unlabeled = pickValuationInstrument(emptyEtf, { ...index, price: null });
  check("Index ohne Kurs wird nicht mit dem ETF-Preis gepaart", unlabeled.symbol === "SPY");
  const fez = pickValuationInstrument(
    { ...emptyEtf, symbol: "VGK", price: 70 },
    { ...index, symbol: "FEZ", role: "fallback" as const, price: 52, ratioQuarterRows: quartersOf("FEZ", 1.1) },
  );
  check("FEZ bleibt FEZ, nicht VGK", fez.symbol === "FEZ" && fez.price === 52);
  check("FEZ-Zeile heißt ETF FEZ", valuationLabelFor(fez, "VGK") === "ETF FEZ");
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
  check("Cache-Key ist nicht mehr v3", MARKETS_CHART_CACHE_VERSION === "v4", MARKETS_CHART_CACHE_VERSION);
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
  const vgkPe = valuationFromFmpRows({
    price: vgkChosen.price,
    asOf: "2026-10-02",
    allowForward: false,
    incomeRows: [],
    earningsRows: [],
    ratioQuarterRows: vgkChosen.ratioQuarterRows,
    ratiosRow: null,
    keyMetricsRow: null,
    estimateRows: [],
  });
  check("VGK-Preis wird nicht durch FEZ-EPS geteilt", valuationLabelFor(vgkChosen, "VGK") === "ETF FEZ" && vgkPe.pe === 11.82, String(vgkPe.pe));

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

if (failed) {
  console.error(`\n${failed} fehlgeschlagen`);
  process.exit(1);
}
console.log("\nalles grün");
