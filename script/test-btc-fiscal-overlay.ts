/**
 * FW-09 — BTC-Fiscal-Overlay (FRED MTSO133FMS): reine Anzeige, kein Score.
 * Prüft: (1) 12M-Summe/YoY gegen Handrechnung auf echtem FRED-Snapshot,
 * (2) point-in-time (kein Wert vor Monatsanfang+1M+14T), Staleness → null (n/a),
 * (3) Zonenlogik + Zonen-Läufe, (4) Score-Dateien byte-gleich zu origin/main
 * (btcAnalysis.ts, analyze-route.ts, btc-macro.ts), (5) macro-history-Route unverändert.
 * Fixture (echt, 25.10.2026): script/fixtures/fiscal/MTSO133FMS-2026-10-25.csv
 * Ausführen: npx tsx script/test-btc-fiscal-overlay.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { parseFredCsv } from "../server/btc-macro";
import {
  buildFiscalYoy, classifyFiscalZone, fiscalForwardFill, fiscalVisibleFrom, fiscalZoneRuns,
} from "../shared/btc-fiscal";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("✓", name); };

const csv = readFileSync("script/fixtures/fiscal/MTSO133FMS-2026-10-25.csv", "utf-8");
const monthly = parseFredCsv(csv);
const pts = buildFiscalYoy(monthly);

ok("Fixture geparst, YoY-Reihe ab 2010", () => {
  assert.ok(monthly.length > 200);
  assert.equal(pts[0].month, "2009-12-01"); // 24 Monate ab 2008-01
});

ok("12M-Summe und YoY = Handrechnung (letzter Monat)", () => {
  const last = pts[pts.length - 1];
  const i = monthly.findIndex((m) => m.date.startsWith(last.month.slice(0, 7)));
  const s = (a: number, b: number) => monthly.slice(a, b + 1).reduce((x, m) => x + m.value, 0);
  const cur = s(i - 11, i), prev = s(i - 23, i - 12);
  assert.equal(last.sum12mBn, Math.round(cur / 10) / 100);
  assert.equal(last.yoyPct, Math.round((cur / prev - 1) * 10000) / 100);
});

ok("point-in-time: sichtbar erst ab +1M+14T", () => {
  assert.equal(fiscalVisibleFrom("2026-09-01"), "2026-10-15");
  const sep = pts.find((p) => p.month === "2026-09-01")!;
  const aug = pts.find((p) => p.month === "2026-08-01")!;
  const ff = fiscalForwardFill(pts, ["2026-10-14", "2026-10-15"]);
  assert.equal(ff["2026-10-14"]!.yoyPct, aug.yoyPct);
  assert.equal(ff["2026-10-15"]!.yoyPct, sep.yoyPct);
});

ok("Staleness / vor Historie → null (n/a, kein Ersatzwert)", () => {
  const ff = fiscalForwardFill(pts, ["2005-01-01", "2027-06-01"]);
  assert.equal(ff["2005-01-01"], null);
  assert.equal(ff["2027-06-01"], null);
});

ok("Zonen: Kontraktion / Wachstum / Verlangsamung / n/a", () => {
  assert.equal(classifyFiscalZone(-1, 2), "kontraktion");
  assert.equal(classifyFiscalZone(5, 3), "wachstum");
  assert.equal(classifyFiscalZone(3, 5), "verlangsamung");
  assert.equal(classifyFiscalZone(3, null), null);
  // 2020 (Corona-Ausgaben) muss als Wachstum, 2022 (Auslaufen) als Kontraktion erscheinen
  assert.equal(pts.find((p) => p.month === "2020-06-01")!.zone, "wachstum");
  assert.equal(pts.find((p) => p.month === "2022-06-01")!.zone, "kontraktion");
});

ok("Zonen-Läufe", () => {
  const runs = fiscalZoneRuns([
    { date: "a", fiscalZone: "wachstum" }, { date: "b", fiscalZone: "wachstum" },
    { date: "c", fiscalZone: null }, { date: "d", fiscalZone: "wachstum" }, { date: "e", fiscalZone: "kontraktion" },
  ]);
  assert.deepEqual(runs, [
    { x1: "a", x2: "b", zone: "wachstum" }, { x1: "d", x2: "d", zone: "wachstum" }, { x1: "e", x2: "e", zone: "kontraktion" },
  ]);
});

ok("Score-/Pflichtdateien byte-gleich zu main 73eff97e", () => {
  for (const f of ["client/src/lib/btcAnalysis.ts", "server/analyze-route.ts", "server/btc-macro.ts"]) {
    const base = execSync(`git show 73eff97e:${f}`, { maxBuffer: 64 << 20 });
    assert.ok(base.equals(readFileSync(f)), f);
  }
});

ok("macro-history-Route unverändert (Diff nur additiv)", () => {
  const diff = execSync("git diff 73eff97e -- server/btc-routes.ts").toString();
  assert.ok(!/^-(?!--)/m.test(diff), "keine entfernten Zeilen");
});

console.log(`\n${n} Tests grün`);
