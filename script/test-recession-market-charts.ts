/**
 * WORK_RECESSION_MARKET_CHARTS — window, vol marks, PEG, FINRA strip.
 * Run: npx tsx script/test-recession-market-charts.ts
 */
import { deflateRawSync } from "node:zlib";
import {
  CHART_BOOKS,
  SERIES_FLOOR,
  VOL_Y_MAX,
  epsYoyPercent,
  finraLeverage,
  leverageForMarket,
  localVolMaxima,
  marginYoYAndZ,
  maxWindowStart,
  parseFinraMarginSheetXml,
  pegFromPeAndGrowth,
  realizedVol20,
  sliceByWindow,
  ttmEpsAt,
  valuationFromParts,
  volBandLabel,
} from "../shared/recession-market-charts";
import { unzipEntry } from "../server/recession-market-charts";

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
