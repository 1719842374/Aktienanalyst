/**
 * F10-33 — Backtest der MA-Kreuz-Signale auf Gold.
 * Ausführen: npx tsx script/test-gold-ma-backtest.ts
 * Fixture: echter Yahoo-GC=F-Payload (script/fixtures/gold-gcf-daily.json), keine erfundenen Kurse.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGoldMaBacktest, fmtPct } from "../client/src/components/gold/goldMaBacktest";
import { detectMaCrosses, trailingSma } from "../client/src/components/gold/goldChartMa";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const day = (i: number) => new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10);

console.log("\nInput guards (n/a statt Ersatzwerte)");
{
  const short = Array.from({ length: 150 }, (_, i) => ({ date: day(i), close: 100 + i }));
  const r = runGoldMaBacktest(short);
  check("too short → reason, no stats", r.reason != null && r.events.length === 0 && r.strategy.totalReturnPct == null);
  const unsorted = Array.from({ length: 300 }, (_, i) => ({ date: day(299 - i), close: 100 }));
  check("unsorted → reason", runGoldMaBacktest(unsorted).reason?.includes("sortiert") === true);
  check("fmtPct(null) = n/a", fmtPct(null) === "n/a" && fmtPct(1.234) === "+1.2%");
}

console.log("\nNo look-ahead: fill on the next bar, cross on the last bar stays pending");
{
  // 260 bars falling, then rising: golden cross somewhere in the rise.
  const closes = [...Array.from({ length: 260 }, (_, i) => 300 - i * 0.5), ...Array.from({ length: 200 }, (_, i) => 170 + i * 2)];
  const bars = closes.map((close, i) => ({ date: day(i), close }));
  const r = runGoldMaBacktest(bars);
  const g = r.events.find((e) => e.type === "golden");
  check("golden cross found", g != null);
  if (g) {
    const i = bars.findIndex((b) => b.date === g.signalDate);
    check("fill = close of bar t+1", g.fillDate === bars[i + 1].date && g.fillClose === bars[i + 1].close);
    const fill = i + 1;
    check("+20T measured from fill close", Math.abs(g.forward[20]! - (bars[fill + 20].close / bars[fill].close - 1) * 100) < 1e-9);
    check("horizon past end → null (n/a)", fill + 250 >= bars.length ? g.forward[250] === null : true);
    // Cut the series exactly on the signal bar → no fill available.
    const cut = runGoldMaBacktest(bars.slice(0, i + 1));
    check("signal on last bar → pending, not traded", cut.pending.length === 1 && cut.events.every((e) => e.signalDate !== g.signalDate) && cut.trades.length === 0);
  }
}

console.log("\nReal gold payload (Yahoo GC=F fixture)");
const fx = JSON.parse(readFileSync(path.join(root, "script/fixtures/gold-gcf-daily.json"), "utf8"));
const rows: { date: string; close: number }[] = fx.rows;
const r = runGoldMaBacktest(rows);
{
  check("fixture labelled as real Yahoo GC=F payload", /GC=F/.test(fx.source) && rows.length > 6000);
  const c = rows.map((x) => x.close);
  const m50 = trailingSma(c, 50);
  const m200 = trailingSma(c, 200);
  const chartCrosses = detectMaCrosses(rows.map((b, i) => ({ date: b.date, ma50: m50[i], ma200: m200[i] })));
  const bt = [...r.events, ...r.pending].map((e) => `${e.signalDate}:${e.type}`);
  check("same crosses as the chart markers (detectMaCrosses)", JSON.stringify(bt) === JSON.stringify(chartCrosses.map((x) => `${x.date}:${x.type}`)), `${bt.length} vs ${chartCrosses.length}`);
  check("31 crosses 2001–2026, alternating types", r.events.length === 31 && r.events.every((e, i) => i === 0 || e.type !== r.events[i - 1].type));
  check("evalStart = first bar with MA200", r.evalStart === rows[199].date);
  const last = r.events[r.events.length - 1];
  check("last death cross 2026-07-01: +120T/+250T n/a", last.signalDate === "2026-07-01" && last.forward[120] === null && last.forward[250] === null);
  const d120 = r.stats.find((s) => s.type === "death")!.byHorizon[120];
  check("n/a events left out of stats (death +120T n=15 of 16)", d120.n === 15);
  // Look-ahead invariance: results for signals up to 2015 do not change when later data is removed.
  const early = runGoldMaBacktest(rows.filter((b) => b.date <= "2016-12-31"));
  const a = early.events.filter((e) => e.signalDate <= "2015-12-31").map((e) => JSON.stringify(e));
  const b = r.events.filter((e) => e.signalDate <= "2015-12-31").map((e) => JSON.stringify(e));
  check("truncating future data leaves earlier signals byte-identical", a.length > 0 && JSON.stringify(a) === JSON.stringify(b));
  check("buy&hold and strategy reported", r.strategy.buyHoldReturnPct != null && r.strategy.totalReturnPct != null);
  const withCost = runGoldMaBacktest(rows, { costBps: 5 });
  check("costs lower the strategy return", withCost.strategy.totalReturnPct! < r.strategy.totalReturnPct!);
}

console.log("\nNo score / gate / route wiring");
{
  const src = readFileSync(path.join(root, "client/src/components/gold/goldMaBacktest.ts"), "utf8");
  check("module imports only goldChartMa", [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).join() === "./goldChartMa");
  const importers: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      if (f === "node_modules" || f.startsWith(".") || f === "dist") continue;
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && readFileSync(p, "utf8").includes("goldMaBacktest")) importers.push(path.relative(root, p));
    }
  };
  for (const d of ["client", "server", "shared"]) walk(path.join(root, d));
  check("no client/server/shared file imports the backtest", importers.length === 0, importers.join(", "));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
