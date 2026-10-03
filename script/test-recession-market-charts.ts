/**
 * WORK_RECESSION_MARKET_CHARTS — window, vol marks, PEG factpack, FINRA z.
 * Run: npx tsx script/test-recession-market-charts.ts
 */
import fs from "node:fs";
import {
  MAX_FLOOR,
  RECESSION_CHART_MARKETS,
  buildEtfFactpack,
  leverageStats,
  localVolMaxima,
  parseFinraMarginSheetXml,
  pegFromDecimalGrowth,
  sliceTradingWindow,
  type MarginDebitPoint,
} from "../shared/recession-market-charts";

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
  const ids = RECESSION_CHART_MARKETS.map(m => `${m.etf}:${m.volId}:${m.volKind}`).join(",");
  check("vier Märkte SPY/QQQ/VGK/ASHR", ids === "SPY:VIXCLS:implied,QQQ:VXNCLS:implied,VGK:^V2TX:implied,ASHR:realized20:realized", ids);
  check("Hebel nur SPY", RECESSION_CHART_MARKETS.filter(m => m.leverage).map(m => m.id).join() === "spy");
  check("EU/ASHR analog", RECESSION_CHART_MARKETS.filter(m => m.bandScope === "analog").map(m => m.id).join() === "vgk,ashr");
}

console.log("\n=== Fenster ===");
{
  const rows = [
    { date: "1990-01-02" },
    { date: "1998-12-31" },
    { date: "1999-01-04" },
    { date: "2013-11-01" },
    { date: "2026-09-03" },
  ];
  const max = sliceTradingWindow(rows, "MAX").map(r => r.date);
  check("MAX beginnt bei max(1999, Serienstart)", max[0] === "1999-01-04" && max[0] >= MAX_FLOOR, max.join());
  const late = sliceTradingWindow([{ date: "2013-11-06" }, { date: "2026-09-03" }], "MAX");
  check("ASHR-Start nach 1999 bleibt Serienstart", late[0].date === "2013-11-06");
  const days: { date: string }[] = [];
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.UTC(2020, 0, 1 + i));
    days.push({ date: d.toISOString().slice(0, 10) });
  }
  check("1Y = 252 Handelstage", sliceTradingWindow(days, "1Y").length === 252);
  check("5Y kürzt auf 1260 wenn genug Bars", sliceTradingWindow(
    Array.from({ length: 2000 }, (_, i) => ({ date: new Date(Date.UTC(2010, 0, 1 + i)).toISOString().slice(0, 10) })),
    "5Y",
  ).length === 1260);
}

console.log("\n=== Vol-Marken ===");
{
  const vol = Array.from({ length: 80 }, (_, i) => ({ date: `2020-01-${String(i + 1).padStart(2, "0")}`, value: 20 }));
  vol[40] = { date: vol[40].date, value: 50 };
  vol[41] = { date: vol[41].date, value: 50 };
  vol[10] = { date: vol[10].date, value: 36 };
  const marks = localVolMaxima(vol);
  check("Plateau 50 zählt einmal", marks.filter(m => m.value === 50).length === 1, JSON.stringify(marks));
  check("36 ist lokales Max > 35", marks.some(m => m.value === 36));
  check("20 wird nicht markiert", marks.every(m => m.value > 35));
  const buried = vol.map((p, i) => (i === 40 ? { ...p, value: 34 } : { ...p, value: i === 41 ? 80 : 20 }));
  check("34 unter Schwelle fällt raus, 80 bleibt", localVolMaxima(buried).every(m => m.value === 80));
}

console.log("\n=== PEG Factpack (nicht der Aktien-Scorer) ===");
{
  const peg = pegFromDecimalGrowth(25, 0.178);
  check("PE/(g*100) mit g=0.178", peg != null && Math.abs(peg - 25 / 17.8) < 1e-9, String(peg));
  check("g<=0 → n/a", pegFromDecimalGrowth(25, 0) === null && pegFromDecimalGrowth(25, -0.1) === null);
  check("PE fehlt → n/a", pegFromDecimalGrowth(null, 0.1) === null);
  const quarters = [1, 1.1, 1.2, 1.3, 1.2, 1.3, 1.4, 1.5].map((eps, i) => ({
    date: `2024-${String(i + 1).padStart(2, "0")}-01`,
    eps,
  }));
  const ttm = 1.2 + 1.3 + 1.4 + 1.5;
  const prev = 1 + 1.1 + 1.2 + 1.3;
  const g = (ttm - prev) / prev;
  const pack = buildEtfFactpack({
    date: "2024-08-15",
    price: ttm * 20,
    volume: 1000,
    rsi: 54.2,
    macd: 0.72,
    signal: 0.4,
    macdHist: 0.32,
    quarters,
    annual: [],
    estimates: [{ date: "2025-06-30", eps: ttm * 1.178 }],
  });
  check("g in Prozent, nicht 0.178", pack.gEps === Math.round(g * 1000) / 10, String(pack.gEps));
  check("PE ttm = Preis / EPS ttm", pack.pe === 20, String(pack.pe));
  check("PEG ttm = PE / g%", pack.peg != null && Math.abs(pack.peg - 20 / (g * 100)) < 0.02, String(pack.peg));
  check("Label ETF-Proxy", pack.proxy === "ETF-Proxy");
  check("RSI/MACD aus dem Balken", pack.rsi === 54.2 && pack.macdHist === 0.32);
  const expensive = buildEtfFactpack({
    date: "2024-08-15",
    price: 100,
    volume: null,
    rsi: null,
    macd: null,
    signal: null,
    macdHist: null,
    quarters: [
      { date: "2023-03-01", eps: 1 },
      { date: "2023-06-01", eps: 1 },
      { date: "2023-09-01", eps: 1 },
      { date: "2023-12-01", eps: 1 },
      { date: "2024-03-01", eps: 1.02 },
      { date: "2024-06-01", eps: 1.02 },
      { date: "2024-09-01", eps: 1.02 },
      { date: "2024-12-01", eps: 1.02 },
    ],
    annual: [],
    estimates: [],
  });
  check("PEG>3 bei positivem g markiert teuer", expensive.peg != null && expensive.peg > 3 && expensive.pegExpensive, String(expensive.peg));
  const neg = buildEtfFactpack({
    date: "2024-08-15",
    price: 100,
    volume: null,
    rsi: null,
    macd: null,
    signal: null,
    macdHist: null,
    quarters: [
      { date: "2023-03-01", eps: 2 },
      { date: "2023-06-01", eps: 2 },
      { date: "2023-09-01", eps: 2 },
      { date: "2023-12-01", eps: 2 },
      { date: "2024-03-01", eps: 1 },
      { date: "2024-06-01", eps: 1 },
      { date: "2024-09-01", eps: 1 },
      { date: "2024-12-01", eps: 1 },
    ],
    annual: [],
    estimates: [],
  });
  check("negatives g → PEG n/a", neg.peg === null && neg.gEps != null && neg.gEps < 0, String(neg.gEps));
  const stale = buildEtfFactpack({
    date: "2010-01-04",
    price: 100,
    volume: null,
    rsi: 50,
    macd: null,
    signal: null,
    macdHist: null,
    quarters: [],
    annual: [],
    estimates: [{ date: "2026-12-31", eps: 10 }],
  });
  check("alter Klick ohne PIT-Konsens → Forward n/a", stale.peFwd === null && stale.pegFwd === null);
}

console.log("\n=== FINRA Hebel ===");
{
  const xml = `
    <row r="1"><c r="A1" t="inlineStr"><is><t>Year-Month</t></is></c><c r="B1"><v>0</v></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>2026-07</t></is></c><c r="B2"><v>1417225</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>2025-07</t></is></c><c r="B3"><v>1000000</v></c></row>
  `;
  const parsed = parseFinraMarginSheetXml(xml);
  check("Jul 26 Debit 1 417 225 Mio", parsed.some(p => p.date === "2026-07-01" && p.millions === 1417225), JSON.stringify(parsed));
  const points: MarginDebitPoint[] = [];
  for (let i = 0; i < 80; i++) {
    const d = new Date(Date.UTC(2018, 0, 1));
    d.setUTCMonth(i);
    const millions = 1000 * Math.pow(1.01, i);
    points.push({ date: d.toISOString().slice(0, 10), millions });
  }
  points[points.length - 1] = { date: points[points.length - 1].date, millions: points[points.length - 2].millions * 1.8 };
  const stats = leverageStats(points);
  check("Mrd. $ = Mio / 1000", stats.latestBillions != null && Math.abs(stats.latestBillions - points[points.length - 1].millions / 1000) < 1e-6);
  check("Sprung z(YoY)>1 = Hebel hoch", stats.z5y != null && stats.z5y > 1 && stats.elevated, String(stats.z5y));
  const calm = leverageStats(points.slice(0, -1));
  check("ruhige Serie nicht automatisch erhöht", calm.elevated === false || (calm.z5y != null && calm.z5y <= 1));
}

console.log("\n=== keine Scorer-Kante ===");
{
  const markets = fs.readFileSync("server/recession-markets.ts", "utf8");
  const charts = fs.readFileSync("server/recession-market-charts.ts", "utf8");
  const shared = fs.readFileSync("shared/recession-market-charts.ts", "utf8");
  check("charts importiert recession.ts nicht", !/from\s+["']\.\/recession["']/.test(charts) && !charts.includes("recession-sahm"));
  check("shared importiert den Scorer nicht", !shared.includes("recession.ts") && !shared.includes("pegRatio"));
  check("region-Route bleibt", markets.includes('queryString(req.query.region) === ""') && markets.includes("buildRegionMarket"));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
