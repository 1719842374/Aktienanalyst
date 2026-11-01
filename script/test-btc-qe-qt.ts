/**
 * FW-14 QE/QT-Bänder (nur Anzeige): Regime-Regel = walclComponent, Segmente, Score-Neutralität (deepEqual).
 * Ausführen: npx tsx script/test-btc-qe-qt.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { addDays, applyBtcLiquidityBlock, computeBtcLiquidityBlock, walclByDate, walclComponent, walclOverlayPoints, type LiquidityObs } from "../shared/btc-liquidity";
import { qeQtRegimeOf, qeQtSegments, walcl13wChangeByDate } from "../shared/btc-qe-qt";

let failed = 0;
const check = (n: string, c: boolean, d?: string) => { if (c) console.log(`  ✅ ${n}`); else { failed++; console.error(`  ❌ ${n}${d ? ` — ${d}` : ""}`); } };

// Synthetisch: 30 W flach, 30 W +1 %/W (QE), 30 W flach, 30 W −0,5 %/W (QT). Werte in Mio. USD wie FRED.
const walcl: LiquidityObs[] = [];
let v = 4_000_000;
for (let i = 0; i < 120; i++) {
  if (i >= 30 && i < 60) v *= 1.01; else if (i >= 90) v *= 0.995;
  walcl.push({ date: addDays("2020-01-01", i * 7), value: v });
}
const days = Array.from({ length: 119 * 7 + 1 }, (_, i) => addDays("2020-01-01", i));
const byDay = walclByDate(walclOverlayPoints(walcl), days);
const rows = days.map(date => ({ date, walcl: byDay[date] ?? null }));

console.log("Regel identisch zu walclComponent");
check("Schwellen: +1,6 → qe, −1,1 → qt, 0 → neutral, null → null",
  qeQtRegimeOf(1.6) === "qe" && qeQtRegimeOf(-1.1) === "qt" && qeQtRegimeOf(0) === "neutral" && qeQtRegimeOf(1.5) === "neutral" && qeQtRegimeOf(-1.0) === "neutral" && qeQtRegimeOf(null) === null);
const chg = new Map(walcl13wChangeByDate(rows).map(r => [r.date, r.changePct]));
let mism = 0, compared = 0;
for (const o of walcl.slice(14)) {
  const comp = walclComponent(walcl, addDays(o.date, 1));
  const r = qeQtRegimeOf(chg.get(o.date) ?? null);
  if (!comp.available || r == null) continue;
  compared++;
  if ((comp.score === 1 ? "qe" : comp.score === -1 ? "qt" : "neutral") !== r) mism++;
}
check(`Regime an jedem WALCL-Stichtag = walclComponent (${compared} verglichen)`, compared > 90 && mism === 0, `${mism} Abweichungen`);
check("erste 13 W ohne Vergleichswert → kein Band", chg.get("2020-02-01") === null);

console.log("Segmente");
const segs = qeQtSegments(rows);
check("Folge neutral → qe → neutral → qt", JSON.stringify(segs.map(s => s.regime)) === JSON.stringify(["neutral", "qe", "neutral", "qt"]), JSON.stringify(segs.map(s => s.regime)));
check("lückenlos aneinander, aufsteigend", segs.every((s, i) => s.x1 <= s.x2 && (i === 0 || s.x1 === segs[i - 1].x2)));
check("leere/fehlende WALCL → keine Bänder", qeQtSegments([]).length === 0 && qeQtSegments(days.map(date => ({ date, walcl: null }))).length === 0);

console.log("Score-Neutralität (deepEqual)");
const series = { walcl, bills: [], otherMarketable: [], dgs10: [] };
const base = [{ name: "X", value: "1", score: 0.5, weight: 1, weighted: 0.5, source: "t" }];
const asOf = addDays(walcl[walcl.length - 1].date, 2);
const rowsCopy = structuredClone(rows), walclCopy = structuredClone(walcl);
const blockBefore = computeBtcLiquidityBlock(structuredClone(series), asOf);
const gisBefore = applyBtcLiquidityBlock(base, blockBefore);
qeQtSegments(rows); walcl13wChangeByDate(rows);
const blockAfter = computeBtcLiquidityBlock(structuredClone(series), asOf);
const gisAfter = applyBtcLiquidityBlock(base, blockAfter);
let ok = true;
try { assert.deepEqual(blockAfter, blockBefore); assert.deepEqual(gisAfter, gisBefore); assert.deepEqual(rows, rowsCopy); assert.deepEqual(walcl, walclCopy); } catch (e) { ok = false; console.error(e); }
check("Block, GIS und Eingaben deepEqual vor/nach Bandberechnung", ok);
const offenders: string[] = [];
const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name) && readFileSync(p, "utf8").includes("btc-qe-qt")) offenders.push(p); } };
walk("server"); walk("shared");
check("kein Server-/Score-Pfad importiert btc-qe-qt (kein Gate BTC_QE_QT_REGIME)", offenders.filter(p => !p.endsWith("btc-qe-qt.ts")).length === 0, offenders.join(", "));

if (failed) { console.error(`\n${failed} Fehler`); process.exit(1); }
console.log("\nalle Checks grün");
