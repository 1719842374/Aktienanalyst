/**
 * Mini-PR 3 — Gold chart MA50 and Golden/Death markers are visual only.
 * Ausführen: npx tsx script/test-gold-ma-cross.ts
 */
import { readFileSync } from "node:fs";
import { detectMaCrosses, trailingSma, withClientMa50 } from "../client/src/components/gold/goldChartMa";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nTrailing SMA matches the server cent-rounded window");
{
  const flat = Array.from({ length: 60 }, () => 100);
  const sma = trailingSma(flat, 50);
  check("first 49 bars have no MA50", sma.slice(0, 49).every((value) => value == null));
  check("bar 50 is the average", sma[49] === 100);
  const ramp = Array.from({ length: 50 }, (_, i) => i + 1);
  const rampSma = trailingSma(ramp, 50);
  check("sum 1..50 / 50 rounds to cents", rampSma[49] === 25.5);
  const attached = withClientMa50(flat.map((close, i) => ({ date: `d${i}`, close, ma200: 90 })));
  check("ma50 is attached without dropping ma200", attached[59].ma50 === 100 && attached[59].ma200 === 90);
  check("early bar stays null", attached[10].ma50 == null);
}

console.log("\nGolden and Death crosses");
{
  const points = [
    { date: "2024-01-01", close: 1, ma50: 10, ma200: 12 },
    { date: "2024-01-02", close: 1, ma50: 11, ma200: 11 },
    { date: "2024-01-03", close: 1, ma50: 12, ma200: 11 },
    { date: "2024-01-04", close: 1, ma50: 13, ma200: 11 },
    { date: "2024-01-05", close: 1, ma50: 10, ma200: 11 },
  ];
  const crosses = detectMaCrosses(points);
  check("touch then rise is one Golden Cross", crosses.length === 2 && crosses[0].type === "golden" && crosses[0].date === "2024-01-03");
  check("later fall is one Death Cross", crosses[1]?.type === "death" && crosses[1]?.date === "2024-01-05");
  check("no cross while both stay ordered", detectMaCrosses([
    { date: "a", ma50: 12, ma200: 10 },
    { date: "b", ma50: 13, ma200: 10 },
  ]).length === 0);
  check("missing MA200 does not invent a cross", detectMaCrosses([
    { date: "a", ma50: 10, ma200: null },
    { date: "b", ma50: 11, ma200: 10 },
  ]).length === 0);
}

console.log("\nScore path and volume stay out of this chart math");
{
  const routes = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf8");
  const start = routes.indexOf("function getTechnicalScore");
  const end = routes.indexOf("export function registerGoldRoutes");
  const fn = routes.slice(start, end);
  check("getTechnicalScore has no MA-cross or volume term", start >= 0 && end > start && !/ma50|Golden|Death|volume/i.test(fn));
  check(
    "closes are stored without a zero volume field",
    /historicalPrices\.push\(\{ date: dateStr, close \}\)/.test(routes),
  );
  const schema = readFileSync(new URL("../shared/gold-schema.ts", import.meta.url), "utf8");
  const point = schema.match(/export interface GoldPricePoint \{[\s\S]*?\n\}/)?.[0] ?? "";
  check("GoldPricePoint has no volume field", point.length > 0 && !/volume/.test(point));
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll gold MA-cross checks passed.");
