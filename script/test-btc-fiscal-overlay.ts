/**
 * FW-09 — BTC-Fiscal-Overlay (FRED MTSO133FMS): reine Anzeige, kein Score.
 * Prüft: (1) 12M-Summe/YoY gegen Handrechnung auf echtem FRED-Snapshot,
 * (2) point-in-time (kein Wert vor Monatsanfang+1M+14T), Staleness → null (n/a),
 * (3) Zonenlogik + Zonen-Läufe, (4) inhaltlich ohne festen SHA: analyzeBTC Branch == origin/main,
 * btc-macro Branch == origin/main (FRED-Snapshots), analyze-route.ts vom Branch unberührt, (5) Scoring-Ausgabe inhaltlich: echter analyzeBTC()
 * auf Fixtures (script/fixtures/btc-liquidity) mit vs. ohne fiscal-history-Route identisch (merge-robust).
 * Fixture (echt, 25.10.2026): script/fixtures/fiscal/MTSO133FMS-2026-10-25.csv
 * Ausführen: npx tsx script/test-btc-fiscal-overlay.ts
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
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

// Inhaltlich statt Diff gegen einen festen SHA (robust gegen andere BTC-Merges):
// echter analyzeBTC() auf festen Fixtures (script/fixtures/btc-liquidity, Stichtag 2026-10-18).
// „main“ = /api/analyze-btc/fiscal-history existiert nicht (404, Zustand vor FW-09);
// „FW-09“ = Route liefert die echte Fiscal-Antwort. Gesamte Analyse-/Score-Ausgabe muss identisch sein.
async function scoringParity() {
  const FIX = "script/fixtures/btc-liquidity";
  const rj = (f: string) => JSON.parse(readFileSync(`${FIX}/${f}`, "utf8"));
  const asOf = "2026-10-18";
  const cutoffSec = Math.floor(Date.parse(`${asOf}T23:59:59Z`) / 1000);
  const blockchain = rj("blockchain-market-price-all.json");
  const fng = (rj("fng-all.json").data as any[]).filter((d) => Number(d.timestamp) <= cutoffSec);
  const hashrate = rj("mempool-hashrate-all.json");
  const fedfunds = readFileSync(`${FIX}/FEDFUNDS.csv`, "utf8");
  const fiscalBody = {
    source: "FRED MTSO133FMS", series: "MTSO133FMS", points: pts, global: null, globalNote: "n/a",
  };
  const json = (b: unknown, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { "content-type": "application/json" } });
  const text = (b: string, st = 200) => new Response(b, { status: st });
  const fiscalCalls = { n: 0 };
  const mkFetch = (withFiscal: boolean) => async (input: any): Promise<Response> => {
    const url = String(typeof input === "string" ? input : input?.url ?? input);
    if (url.includes("/api/analyze-btc/fiscal-history")) { fiscalCalls.n++; return withFiscal ? json(fiscalBody) : text("not found", 404); }
    if (url.startsWith("https://api.alternative.me/fng/?limit=1")) return json({ data: fng.slice(0, 1) });
    if (url.startsWith("https://api.alternative.me/fng/")) return json({ data: fng.slice(0, 2000) });
    if (url.includes("fredgraph.csv?id=FEDFUNDS")) return text(fedfunds);
    if (url.startsWith("https://api.blockchain.info/charts/market-price")) return json({ ...blockchain, values: (blockchain.values as any[]).filter((v) => v.x <= cutoffSec) });
    if (url.startsWith("https://mempool.space/api/v1/mining/hashrate/3m")) {
      const hs = (hashrate.hashrates as any[]).filter((h) => h.timestamp > cutoffSec - 90 * 86400 && h.timestamp <= cutoffSec);
      return json({ hashrates: hs, currentHashrate: hs.length ? hs[hs.length - 1].avgHashrate : 0 });
    }
    if (url.includes("/api/analyze-btc/fiscal-frontend")) return json(rj("fiscal-frontend-heute.json"));
    return text("offline (Test)", 404); // übrige Quellen: definierter Ausfall, in beiden Läufen gleich
  };
  const { analyzeBTC } = await import("../client/src/lib/btcAnalysis");
  let analyzeBTCRef: any = analyzeBTC;
  const RealDate = Date;
  const fixed = RealDate.parse(`${asOf}T23:59:59Z`);
  class FakeDate extends RealDate {
    constructor(...a: any[]) { if (a.length === 0) super(fixed); else super(...(a as [any])); }
    static now() { return fixed; }
  }
  const run = async (withFiscal: boolean) => {
    const rf = globalThis.fetch, rl = console.log, rw = console.warn, re = console.error, rr = Math.random;
    let seed = 42; // Monte Carlo deterministisch (mulberry32), in beiden Läufen gleich
    Math.random = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    (globalThis as any).Date = FakeDate; globalThis.fetch = mkFetch(withFiscal) as any;
    console.log = console.warn = console.error = () => {};
    try { return await analyzeBTCRef(true); }
    finally { (globalThis as any).Date = RealDate; globalThis.fetch = rf; console.log = rl; console.warn = rw; console.error = re; Math.random = rr; }
  };
  // main-Stand von btcAnalysis.ts (origin/main zur Laufzeit, kein fester SHA) neben die Datei legen,
  // damit relative Imports gleich auflösen; mit denselben Mocks rechnen.
  const mainSrc = execSync("git show origin/main:client/src/lib/btcAnalysis.ts", { maxBuffer: 64 << 20 }).toString();
  const tmp = "client/src/lib/.main-btcAnalysis.tmp.ts";
  writeFileSync(tmp, mainSrc);
  let mainAnalyze: any;
  try { mainAnalyze = (await import(pathToFileURL(resolve(tmp)).href)).analyzeBTC; } finally { unlinkSync(tmp); }
  const runWith = async (fn: any) => { const keep = analyzeBTCRef; analyzeBTCRef = fn; try { return await run(false); } finally { analyzeBTCRef = keep; } };
  const mainCode = await runWith(mainAnalyze);
  const mainState = await run(false);
  const fw09 = await run(true);
  assert.equal(fiscalCalls.n, 0, "analyzeBTC darf fiscal-history nicht abfragen");
  assert.ok(Number.isFinite(mainState.gis) && Number.isFinite(mainState.gws?.value), "Score auf Fixture berechnet");
  assert.equal(fw09.gis, mainState.gis);
  assert.equal(fw09.gws.value, mainState.gws.value);
  const strip = (a: any) => JSON.stringify({ ...a, timestamp: undefined });
  assert.equal(strip(fw09), strip(mainState), "gesamte Analyse-Ausgabe identisch");
  assert.equal(strip(mainState), strip(mainCode), "analyzeBTC Branch == analyzeBTC origin/main (gleiche Fixtures)");
  return { gis: mainState.gis, gws: mainState.gws.value };
}

const parity = await scoringParity();
n++; console.log("✓ analyzeBTC-Ausgabe (Branch) == analyzeBTC von origin/main auf denselben Fixtures");

// btc-macro inhaltlich: main-Version vs. Branch, gleiche FRED-Snapshots (curl = Fixture-Skript)
{
  const bin = mkdtempSync(join(tmpdir(), "fw09-curl-"));
  writeFileSync(join(bin, "curl"), `#!/bin/sh
for a; do url="$a"; done
case "$url" in *id=DFII10*) cat "${resolve("script/fixtures/real10y/DFII10-2026-10-18.csv")}";; *id=M2SL*) cat "${resolve("script/fixtures/real10y/M2SL-2026-10-18.csv")}";; *) exit 22;; esac
`);
  chmodSync(join(bin, "curl"), 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  const tmp = "server/.main-btc-macro.tmp.ts";
  writeFileSync(tmp, execSync("git show origin/main:server/btc-macro.ts", { maxBuffer: 64 << 20 }));
  try {
    const mainMacro = await import(pathToFileURL(resolve(tmp)).href);
    const branchMacro = await import("../server/btc-macro");
    const a = await branchMacro.fetchBTCMacroHistory("2020-01-01", "2026-10-18");
    const b = await mainMacro.fetchBTCMacroHistory("2020-01-01", "2026-10-18");
    assert.ok(Object.keys(a.real10yByDate).length > 100);
    assert.deepEqual(a, b);
  } finally { unlinkSync(tmp); process.env.PATH = oldPath; }
  n++; console.log("✓ btc-macro: fetchBTCMacroHistory Branch == origin/main (echte FRED-Snapshots)");
}

// analyze-route: liegt nicht im BTC-Pfad; Branch ändert sie nicht (gegen merge-base, kein fester SHA)
{
  const mb = execSync("git merge-base HEAD origin/main").toString().trim();
  execSync(`git diff --quiet ${mb} HEAD -- server/analyze-route.ts`);
  n++; console.log("✓ analyze-route.ts vom Branch unberührt (merge-base mit origin/main)");
}
n++; console.log(`✓ Scoring-Ausgabe (analyzeBTC auf Fixture) gleich main-Zustand ohne Fiscal-Route (GIS ${parity.gis}, GWS ${parity.gws})`);

console.log(`\n${n} Tests grün`);
