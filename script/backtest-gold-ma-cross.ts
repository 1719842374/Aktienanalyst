/**
 * F10-33 — MA-Kreuz-Backtest auf Gold, Ergebnis als Text/JSON.
 *   npx tsx script/backtest-gold-ma-cross.ts            # echter Payload aus script/fixtures/gold-gcf-daily.json
 *   npx tsx script/backtest-gold-ma-cross.ts --live     # frisch über yahooFetch("GC=F") (server/history-fallback.ts)
 *   npx tsx script/backtest-gold-ma-cross.ts --json     # Rohergebnis als JSON
 *   --cost=5                                             # Kosten je Seite in bp (Standard 0 = brutto)
 * Nur Lesen. Kein Score, kein Gate, keine Route.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runGoldMaBacktest, fmtPct, BACKTEST_HORIZONS, type BacktestBar } from "../client/src/components/gold/goldMaBacktest";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const costArg = args.find((a) => a.startsWith("--cost="));
const costBps = costArg ? Number(costArg.slice(7)) : 0;

async function load(): Promise<{ bars: BacktestBar[]; source: string }> {
  if (args.includes("--live")) {
    const { yahooFetch } = await import("../server/history-fallback");
    const to = new Date().toISOString().slice(0, 10);
    const raw = await yahooFetch("GC=F", "2000-01-01", to);
    return { bars: raw.map((b) => ({ date: b.date, close: b.close })), source: `Yahoo GC=F live (${to})` };
  }
  const fx = JSON.parse(readFileSync(path.join(here, "fixtures/gold-gcf-daily.json"), "utf8"));
  return { bars: fx.rows, source: `${fx.source} — Fixture vom ${fx.fetchedAt}` };
}

const { bars, source } = await load();
const r = runGoldMaBacktest(bars, { costBps });
if (args.includes("--json")) {
  console.log(JSON.stringify({ source, ...r }, null, 2));
} else {
  console.log(`Quelle: ${source}`);
  console.log(`Kurse: ${r.bars} (${r.firstDate ?? "n/a"} … ${r.lastDate ?? "n/a"}), Auswertung ab ${r.evalStart ?? "n/a"}`);
  if (r.reason) console.log(`n/a: ${r.reason}`);
  console.log(`Fill: Schlusskurs am Tag nach dem Kreuz. Kosten: ${costBps} bp je Seite.`);
  console.log(`\nKreuze: ${r.events.length} gehandelt, ${r.pending.length} ohne Folgetag (offen)`);
  for (const s of r.stats) {
    console.log(`\n${s.type === "golden" ? "Golden Cross" : "Death Cross"} (n=${s.count})  Treffer = Kurs ${s.type === "golden" ? "höher" : "tiefer"}`);
    for (const h of BACKTEST_HORIZONS) {
      const b = s.byHorizon[h];
      console.log(`  +${String(h).padStart(3)}T  n=${String(b.n).padStart(2)}  Ø ${fmtPct(b.meanPct).padStart(7)}  Median ${fmtPct(b.medianPct).padStart(7)}  Trefferquote ${b.hitRate == null ? "n/a" : `${(b.hitRate * 100).toFixed(0)}%`}`);
    }
  }
  console.log(`\nLong/Flat (long ab Golden-Fill bis Death-Fill): ${fmtPct(r.strategy.totalReturnPct)}  vs. Buy&Hold ab ${r.evalStart}: ${fmtPct(r.strategy.buyHoldReturnPct)}  Zeit im Markt ${r.strategy.timeInMarketPct == null ? "n/a" : r.strategy.timeInMarketPct.toFixed(0) + "%"}`);
  console.log(`\nSignal        Fill        Typ     +20T     +60T    +120T    +250T`);
  for (const e of r.events) {
    console.log(`${e.signalDate}  ${e.fillDate}  ${e.type.padEnd(6)} ${BACKTEST_HORIZONS.map((h) => fmtPct(e.forward[h]).padStart(8)).join(" ")}`);
  }
}
