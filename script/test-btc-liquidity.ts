/**
 * Liquiditätsblock im BTC-Score: Regeln, Point-in-time, n/a/Renormalisierung,
 * GIS-Einbindung, Server-Fehlerpfade, WALCL-Overlay. Kein Netzwerk.
 *
 * Ausführen: npx tsx script/test-btc-liquidity.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fredCsvObservations } from "../server/fred-csv";
import {
  BTC_LIQUIDITY_CONFIG,
  addDays,
  applyBtcLiquidityBlock,
  billsComponent,
  computeBtcLiquidityBlock,
  dgs10Component,
  pointInTime,
  walclByDate,
  walclComponent,
  walclOverlayPoints,
  type LiquidityObs,
} from "../shared/btc-liquidity";
import {
  getBtcLiquidity,
  loadBtcLiquidity,
  resetBtcLiquidityCache,
} from "../server/btc-liquidity";

let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const near = (a: number | null | undefined, b: number, eps = 1e-9) => a != null && Math.abs(a - b) < eps;

// Synthetische Reihen (Testeingaben, keine Marktdaten)
function weekly(start: string, n: number, f: (i: number) => number): LiquidityObs[] {
  return Array.from({ length: n }, (_, i) => ({ date: addDays(start, 7 * i), value: f(i) }));
}
function businessDays(start: string, n: number, f: (i: number) => number): LiquidityObs[] {
  const out: LiquidityObs[] = [];
  let d = start;
  while (out.length < n) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push({ date: d, value: f(out.length) });
    d = addDays(d, 1);
  }
  return out;
}
function quarterly(startYear: number, n: number, f: (i: number) => number): LiquidityObs[] {
  return Array.from({ length: n }, (_, i) => {
    const y = startYear + Math.floor(i / 4);
    const m = (i % 4) * 3 + 1;
    return { date: `${y}-${String(m).padStart(2, "0")}-01`, value: f(i) };
  });
}
const lastDate = (o: LiquidityObs[]) => o[o.length - 1].date;

console.log("\n=== WALCL: 13W-Regel (Future_Work.md:121–122) ===");
{
  const up = weekly("2024-01-03", 20, i => 7_000_000 * (1 + 0.002 * i));      // 13W ≈ +2,6 %
  const flat = weekly("2024-01-03", 20, i => 7_000_000 * (1 + 0.0005 * i));   // ≈ +0,65 %
  const down = weekly("2024-01-03", 20, i => 7_000_000 * (1 - 0.001 * i));    // ≈ −1,3 %
  const asOf = addDays(lastDate(up), 2);
  check("> +1,5 % → +1", walclComponent(up, asOf).score === 1, String(walclComponent(up, asOf).metric));
  check("zwischen → 0", walclComponent(flat, asOf).score === 0);
  check("< −1,0 % → −1", walclComponent(down, asOf).score === -1);
  const exact = weekly("2024-01-03", 14, i => (i === 13 ? 101.5 : 100));
  check("genau +1,5 % ist nicht > +1,5 % → 0", walclComponent(exact, addDays(lastDate(exact), 2)).score === 0);
  check("veraltet (> 21 T.) → n/a", walclComponent(up, addDays(lastDate(up), 30)).available === false);
  check("zu kurz → n/a", walclComponent(up.slice(0, 13), asOf).available === false);
  const gap = up.filter((_, i) => i !== 10 && i !== 11 && i !== 12);
  check("Lücke im 13W-Fenster → n/a statt falscher Spanne", walclComponent(gap, asOf).available === false);
  check("leer/null → n/a ohne Throw", walclComponent(null as any, asOf).available === false);
}

console.log("\n=== Point-in-time ===");
{
  const obs = [{ date: "2022-10-26", value: 1 }, { date: "2022-10-31", value: 2 }];
  check("Wert vom Stichtag ist bei lag 1 noch nicht sichtbar", pointInTime(obs, "2022-10-31", 1).length === 1);
  check("am Folgetag sichtbar", pointInTime(obs, "2022-11-01", 1).length === 2);
  const z1Lag = BTC_LIQUIDITY_CONFIG.bills.z1VisibilityLagDays;
  check("Z.1-Sichtbarkeit = FRED-Datum (Quartalsanfang) + 180 T.", z1Lag === 180);
  const q2 = [{ date: "2020-04-01", value: 1 }];
  check("Z.1 Q2/2020 am 2020-09-13 NICHT sichtbar (alte Regel +165, vor Release 2020-09-21)", pointInTime(q2, "2020-09-13", z1Lag).length === 0);
  check("Z.1 Q2/2020 am 2020-09-21 (Release-Tag) noch nicht sichtbar", pointInTime(q2, "2020-09-21", z1Lag).length === 0);
  check("Z.1 Q2/2020 ab 2020-09-28 sichtbar", pointInTime(q2, "2020-09-27", z1Lag).length === 0 && pointInTime(q2, "2020-09-28", z1Lag).length === 1);
  check("Z.1 Q2/2020 am 2020-09-30 sichtbar", pointInTime(q2, "2020-09-30", z1Lag).length === 1);
  // Echte FRED-Fixtures (script/fixtures/btc-liquidity): Komponentenstand vor/nach Sichtbarkeit
  const fx = (id: string) => fredCsvObservations(readFileSync(`script/fixtures/btc-liquidity/${id}.csv`, "utf8"));
  const fb = fx("BOGZ1FL313161110Q"), fo = fx("BOGZ1FL313161275Q");
  const at0913 = billsComponent(fb, fo, "2020-09-13");
  const at0930 = billsComponent(fb, fo, "2020-09-30");
  check("Fixtures: Bills am 2020-09-13 noch Stand Q1/2020", at0913.available && at0913.asOf === "2020-01-01", `${at0913.asOf} ${at0913.value}`);
  check("Fixtures: Bills am 2020-09-30 Stand Q2/2020", at0930.available && at0930.asOf === "2020-04-01", `${at0930.asOf} ${at0930.value}`);
}

console.log("\n=== DGS10: 63-Beobachtungs-Trend, fallend = positiv ===");
{
  const mk = (deltaBp: number) => businessDays("2024-01-02", 70, i => 4 + (i >= 6 ? deltaBp / 100 : 0) * ((i - 6) / 63));
  const cases: [number, number][] = [[-40, 1], [-15, 0.5], [0, 0], [15, -0.5], [40, -1]];
  for (const [bp, exp] of cases) {
    const s = mk(bp);
    const comp = dgs10Component(s, addDays(lastDate(s), 1));
    check(`Δ ${bp} bp → ${exp}`, comp.score === exp, `${comp.metric} → ${comp.score}`);
  }
  const s = mk(-40);
  const truncated = [...s.slice(0, 40)];
  check("abgeschnittene CSV (letzter Wert alt) → n/a", dgs10Component(truncated, addDays(lastDate(s), 1)).available === false);
}

console.log("\n=== T-Bill-Anteil (Z.1): 4Q-Änderung, Perzentil 20J ===");
{
  const n = 100; // 25 Jahre
  // Bill-Anteil schwingt zwischen ~15 und ~25 %; letzte 4Q starker Anstieg
  const shareAt = (i: number) => 20 + 5 * Math.sin(i / 3) + (i >= n - 4 ? (i - (n - 5)) * 1.5 : 0);
  const total = 20_000_000;
  const bills = quarterly(2000, n, i => total * shareAt(i) / 100);
  const other = quarterly(2000, n, i => total * (1 - shareAt(i) / 100));
  const asOf = addDays(lastDate(bills), BTC_LIQUIDITY_CONFIG.bills.z1VisibilityLagDays + 5); // letztes Quartal gerade sichtbar
  const comp = billsComponent(bills, other, asOf);
  check("starker Anstieg des Bill-Anteils → +1 (letztes Quartal verwendet)", comp.score === 1 && comp.asOf === lastDate(bills), `${comp.asOf} ${comp.value}`);
  check("Wert nennt Bills in Bio. $ und Anteil", /Bio\. \$/.test(comp.value) && /Anteil/.test(comp.value), comp.value);
  const before = billsComponent(bills, other, addDays(lastDate(bills), 100));
  check("letztes Quartal vor Veröffentlichung nicht verwendet", before.asOf !== lastDate(bills), String(before.asOf));
  check("> maxAgeDays → n/a", billsComponent(bills, other, addDays(lastDate(bills), BTC_LIQUIDITY_CONFIG.bills.maxAgeDays + 5)).available === false);
  check("zu wenig Historie → n/a", billsComponent(bills.slice(-20), other.slice(-20), asOf).available === false);
  check("nur Bills, Gegenreihe fehlt → n/a", billsComponent(bills, [], asOf).available === false);
}

console.log("\n=== Block: Renormalisierung, minCoverage, n/a ===");
{
  const w = weekly("2024-01-03", 20, i => 7_000_000 * (1 + 0.002 * i));
  const asOf = addDays(lastDate(w), 2);
  const d = businessDays(addDays(asOf, -110), 75, i => 4 - 0.006 * i).filter(o => o.date < asOf);
  const full = computeBtcLiquidityBlock({ walcl: w, bills: [], otherMarketable: [], dgs10: d }, asOf);
  check("WALCL+DGS10 verfügbar, Bills n/a → Block verfügbar", full.available, full.note ?? "");
  check("Abdeckung 0,80", near(full.coverage, 0.8));
  const ws = full.components.find(c => c.key === "walcl")!;
  const ds = full.components.find(c => c.key === "dgs10")!;
  check("renormalisierte Anteile 0,5625 / 0,4375 / 0", near(ws.effectiveSubWeight, 0.45 / 0.8) && near(ds.effectiveSubWeight, 0.35 / 0.8)
    && full.components.find(c => c.key === "bills")!.effectiveSubWeight === 0);
  check("Score = gewichtetes Mittel der verfügbaren", near(full.score, ((ws.score as number) * 0.45 + (ds.score as number) * 0.35) / 0.8));
  check("Hinweis nennt n/a-Komponente", /T-Bill/.test(full.note ?? ""));
  const onlyBills = computeBtcLiquidityBlock({ walcl: [], bills: [], otherMarketable: [], dgs10: [] }, asOf);
  check("nichts verfügbar → Block n/a, score null", !onlyBills.available && onlyBills.score === null);
  check("Subgewichte summieren 1", near(Object.values(BTC_LIQUIDITY_CONFIG.subWeights).reduce((a, b) => a + b, 0), 1));
  check("Bills allein (0,20) < minCoverage 0,35", BTC_LIQUIDITY_CONFIG.subWeights.bills < BTC_LIQUIDITY_CONFIG.minCoverage
    && BTC_LIQUIDITY_CONFIG.subWeights.dgs10 >= BTC_LIQUIDITY_CONFIG.minCoverage);
}

console.log("\n=== GIS-Einbindung ===");
{
  const base = [
    { name: "A", value: "", score: 1, weight: 0.2, source: "" },
    { name: "B", value: "", score: -0.5, weight: 0.15, source: "" },
    { name: "C", value: "", score: 0, weight: 0.1, source: "" },
    { name: "D", value: "", score: 0.5, weight: 0.1, source: "" },
    { name: "E", value: "", score: -1, weight: 0.15, source: "" },
    { name: "F", value: "", score: 1, weight: 0.15, source: "" },
    { name: "G", value: "", score: 0.5, weight: 0.15, source: "" },
  ].map(i => ({ ...i, weighted: i.score * i.weight }));
  const oldGis = base.reduce((s, i) => s + i.weighted, 0);
  const na = applyBtcLiquidityBlock(base, null);
  check("Block null → GIS bit-identisch", na.gis === oldGis, `${na.gis} vs ${oldGis}`);
  check("n/a-Zeile sichtbar, Gewicht 0, available false", na.indicators.length === 8 && na.indicators[7].weight === 0 && na.indicators[7].available === false);
  check("Rechenweg zeigt n/a × 0", /n\/a × 0/.test(na.gisCalculation));
  const naBlock = computeBtcLiquidityBlock({ walcl: [], bills: [], otherMarketable: [], dgs10: [] }, "2026-10-18");
  check("Block n/a → GIS bit-identisch", applyBtcLiquidityBlock(base, naBlock).gis === oldGis);
  const block = { ...naBlock, available: true, score: 0.5625, coverage: 0.8 };
  const on = applyBtcLiquidityBlock(base, block);
  check("Block verfügbar → GIS = 0,85·alt + 0,15·round(L,2)", near(on.gis, 0.85 * oldGis + 0.15 * 0.56), `${on.gis}`);
  check("Gewichte summieren 1", near(on.indicators.reduce((s, i) => s + i.weight, 0), 1));
  check("Rechenweg-Summe passt", on.gisCalculation.endsWith(`= ${on.gis.toFixed(4)}`));
}

console.log("\n=== Server: FRED-Fehler → n/a, kein Throw, kein Cache ===");
{
  const allNull = await loadBtcLiquidity({ fetchCsv: async () => null, now: new Date("2026-10-18T12:00:00Z") });
  check("alle Reihen null → Block n/a", !allNull.block.available && allNull.block.score === null && allNull.walcl.length === 0);
  const throwing = await loadBtcLiquidity({ fetchCsv: async () => { throw new Error("boom"); } });
  check("fetch wirft → Block n/a, kein Throw", !throwing.block.available);
  const html = await loadBtcLiquidity({ fetchCsv: async () => "<!DOCTYPE html><html>" });
  check("HTML statt CSV → n/a", !html.block.available);
  resetBtcLiquidityCache();
  const rejected = await getBtcLiquidity({ load: async () => { throw new Error("x"); }, now: 1 });
  check("Loader wirft → n/a mit Hinweis", !rejected.block.available && /fehlgeschlagen/.test(rejected.block.note ?? ""));
  const t0 = Date.now();
  const slow = await getBtcLiquidity({ load: () => new Promise(() => {}), deadlineMs: 50, now: 2 });
  check("hängender Abruf → Deadline → n/a", !slow.block.available && /Timeout/.test(slow.block.note ?? "") && Date.now() - t0 < 2000);
  let calls = 0;
  const okBody = { ...slow, block: { ...slow.block, available: true, score: 0 } };
  await getBtcLiquidity({ load: async () => { calls++; return okBody; }, now: 10 });
  await getBtcLiquidity({ load: async () => { calls++; return okBody; }, now: 20 });
  check("verfügbarer Block wird gecacht, n/a nicht", calls === 1, String(calls));
  resetBtcLiquidityCache();

  // CSV-Pfad über fredCsvObservations
  const csv = (rows: LiquidityObs[], id: string) => `observation_date,${id}\n` + rows.map(r => `${r.date},${r.value}`).join("\n") + "\n";
  const w = weekly("2026-06-03", 20, i => 6_600_000 + 1000 * i);
  const ok = await loadBtcLiquidity({
    fetchCsv: async id => (id === "WALCL" ? csv(w, id) : null),
    now: new Date(`${addDays(lastDate(w), 2)}T12:00:00Z`),
  });
  check("nur WALCL (0,45 ≥ 0,35) → Block verfügbar, Overlay gefüllt", ok.block.available && ok.walcl.length === 20 && near(ok.walcl[0].valueTn, 6.6));
}

console.log("\n=== WALCL-Overlay ===");
{
  const pts = walclOverlayPoints([{ date: "2026-01-07", value: 6_500_000 }, { date: "2026-01-14", value: 6_510_000 }, { date: "x", value: 1 }]);
  check("Mio. → Bio., ungültige Zeilen raus", pts.length === 2 && near(pts[1].valueTn, 6.51));
  const byDate = walclByDate(pts, ["2026-01-06", "2026-01-07", "2026-01-10", "2026-01-14", "2026-01-27", "2026-01-29"]);
  check("vor erstem Wert kein Wert", byDate["2026-01-06"] === undefined);
  check("Forward-Fill innerhalb der Woche", near(byDate["2026-01-10"], 6.5));
  check("≤ 14 T. fortgeschrieben, danach leer", near(byDate["2026-01-27"], 6.51) && byDate["2026-01-29"] === undefined);
}

console.log("\n=== Gewichte (Philip-Freigabe 18.10.2026 22:37) ===");
{
  const cfg = BTC_LIQUIDITY_CONFIG;
  check("Block zählt genau 15 % im GIS", cfg.blockWeight === 0.15);
  check("innen WALCL 45 % / DGS10 35 % / Bill-Anteil 20 %", cfg.subWeights.walcl === 0.45 && cfg.subWeights.dgs10 === 0.35 && cfg.subWeights.bills === 0.20);
  const base = [0.20, 0.15, 0.10, 0.10, 0.15, 0.15, 0.15].map((w, i) => ({ name: `I${i}`, value: "", score: 1, weight: w, weighted: w, source: "" }));
  const block = { ...computeBtcLiquidityBlock({ walcl: [], bills: [], otherMarketable: [], dgs10: [] }, "2026-10-18"), available: true, score: 1, coverage: 1 };
  const on = applyBtcLiquidityBlock(base, block);
  const liq = on.indicators[on.indicators.length - 1];
  const others = on.indicators.slice(0, -1).reduce((s, i) => s + i.weight, 0);
  check("angewendet: Blockzeile Gewicht 0,15, übrige 7 zusammen 0,85", liq.weight === 0.15 && near(others, 0.85), `${liq.weight} / ${others}`);
  check("alle Scores +1 → GIS 1 (Anteile summieren exakt)", near(on.gis, 1));
  // Innen: Block-Score = 0,45·W + 0,35·D + 0,20·B bei voller Abdeckung
  const fx = (id: string) => fredCsvObservations(readFileSync(`script/fixtures/btc-liquidity/${id}.csv`, "utf8"));
  const meta = JSON.parse(readFileSync("script/fixtures/btc-liquidity/meta.json", "utf8"));
  const today = computeBtcLiquidityBlock({
    walcl: fx("WALCL"), bills: fx("BOGZ1FL313161110Q"), otherMarketable: fx("BOGZ1FL313161275Q"), dgs10: fx("DGS10"),
  }, meta.today);
  const comp = (k: string) => today.components.find(c => c.key === k)!;
  check("Fixture heute: volle Abdeckung, effektive Anteile 0,45/0,35/0,20",
    today.available && near(today.coverage, 1) && near(comp("walcl").effectiveSubWeight, 0.45) && near(comp("dgs10").effectiveSubWeight, 0.35) && near(comp("bills").effectiveSubWeight, 0.20));
  check("Fixture heute: L = 0,45·W + 0,35·D + 0,20·B", near(today.score, 0.45 * comp("walcl").score! + 0.35 * comp("dgs10").score! + 0.20 * comp("bills").score!));
  const bp = comp("dgs10").metric!;
  check(`Fixture heute (${meta.today}): DGS10 3M ${bp.toFixed(1)} bp → +53 bp gerundet, Score −1`, Math.round(bp) === 53 && comp("dgs10").score === -1, String(bp));
  check("Fixture heute: WALCL 0, Bills +0,5 → L = −0,25 (leicht negativ, getrieben von DGS10)",
    comp("walcl").score === 0 && comp("bills").score === 0.5 && near(today.score, -0.25));
}

console.log("\n=== FRED-Ausfall / Mindestabdeckung → GIS byte-gleich ===");
{
  const base = [
    { s: 1, w: 0.20 }, { s: -0.5, w: 0.15 }, { s: 0.5, w: 0.10 }, { s: 0, w: 0.10 }, { s: 0.5, w: 0.15 }, { s: 0.8, w: 0.15 }, { s: -1, w: 0.15 },
  ].map((x, i) => ({ name: `I${i}`, value: "", score: x.s, weight: x.w, weighted: x.s * x.w, source: "" }));
  const oldGis = base.reduce((sum, i) => sum + i.weighted, 0);
  const fx = (id: string) => fredCsvObservations(readFileSync(`script/fixtures/btc-liquidity/${id}.csv`, "utf8"));
  const down = computeBtcLiquidityBlock({ walcl: [], bills: [], otherMarketable: [], dgs10: [] }, "2026-10-18");
  const low = computeBtcLiquidityBlock({ walcl: [], bills: fx("BOGZ1FL313161110Q"), otherMarketable: fx("BOGZ1FL313161275Q"), dgs10: [] }, "2026-10-18");
  check("nur Bills verfügbar (0,20) → unter Mindestabdeckung → Block n/a", !low.available && low.score === null
    && low.components.find(c => c.key === "bills")!.available, low.note ?? "");
  for (const [name, b] of [["FRED-Ausfall", down], ["unter Mindestabdeckung", low]] as const) {
    const r = applyBtcLiquidityBlock(base, b);
    check(`${name}: GIS byte-gleich (===)`, r.gis === oldGis, `${r.gis} vs ${oldGis}`);
    check(`${name}: alte Gewichte unverändert`, r.indicators.slice(0, 7).every((x, i) => x.weight === base[i].weight && x.weighted === base[i].weighted));
    // GWS-Formel aus analyzeBTC: gis·0.30 + power·0.50 + cycle·0.20 → bei gleichem GIS bitgleich
    const gws = (g: number) => g * 0.30 + 0.5 * 0.50 + -0.5 * 0.20;
    check(`${name}: GWS byte-gleich`, gws(r.gis) === gws(oldGis));
  }
  const srvDown = await loadBtcLiquidity({ fetchCsv: async () => null, now: new Date("2026-10-18T12:00:00Z") });
  check("Server bei FRED-Ausfall → GIS byte-gleich", applyBtcLiquidityBlock(base, srvDown.block).gis === oldGis);
  console.log("  (End-to-End mit echtem analyzeBTC vs. main: script/btc-liquidity-history.ts, Zeile „FRED-Ausfall / unter Mindestabdeckung“)");
}

console.log("\n=== Verdrahtung / Sperren ===");
{
  const routes = readFileSync("server/btc-routes.ts", "utf8");
  check("Route /api/analyze-btc/liquidity registriert", routes.includes('app.get("/api/analyze-btc/liquidity"'));
  const srv = readFileSync("server/btc-liquidity.ts", "utf8");
  check("Server nutzt fetchFredCsv aus fred-csv.ts", /from "\.\/fred-csv"/.test(srv) && /fetchFredCsv\(/.test(srv) && !/execFile|curl/.test(srv));
  check("DGS10 über bestehenden 10Y-Loader (treasury10y-route, kein zweiter Abruf)", /from "\.\/treasury10y-route"/.test(srv) && /getMarketTreasury10Y\(\)/.test(srv));
  const client = readFileSync("client/src/lib/btcAnalysis.ts", "utf8");
  check("Client lädt über apiRequest + applyBtcLiquidityBlock", /apiRequest\("GET", "\/api\/analyze-btc\/liquidity"/.test(client) && /applyBtcLiquidityBlock\(baseIndicators/.test(client));
  const dash = readFileSync("client/src/pages/BTCDashboard.tsx", "utf8");
  check("Dashboard: WALCL-Toggle, default aus", /toggle-btc-walcl/.test(dash) && /\[showWalcl, setShowWalcl\] = useState\(false\)/.test(dash) && /yAxisId="walcl"/.test(dash));
  let analyzeRouteDiff = "";
  try {
    analyzeRouteDiff = execFileSync("git", ["diff", "--name-only", "35ead515", "--", "server/analyze-route.ts"], { encoding: "utf8" }).trim()
      + execFileSync("git", ["status", "--porcelain", "--", "server/analyze-route.ts"], { encoding: "utf8" }).trim();
  } catch (e: any) {
    analyzeRouteDiff = `git-Fehler: ${e?.message}`;
  }
  check("server/analyze-route.ts unverändert (Philip-Sperre)", analyzeRouteDiff === "", analyzeRouteDiff);
}

if (failed > 0) {
  console.error(`\n❌ ${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log("\n✅ Alle Liquiditätsblock-Tests bestanden");
