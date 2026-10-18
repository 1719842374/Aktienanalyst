/**
 * F9-07 Konzentration, F9-10 Managing-Score, F9-11 Makro-Widersprüche — Offline-Tests.
 * Fixtures: script/fixtures/macro/{SPY-RSP-2026-10-16.json, multpl-eps-2026-10-18.csv, multpl-eps-snippet.html, DFII10/DFF}.
 * Ausführen: npx tsx script/test-f9-macro-gaps.ts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RECESSION_FALLBACK_DATA } from "../client/src/lib/recessionFallbackData";
import { MacroLayerCard } from "../client/src/components/recession/MacroLayerCard";
import { probabilityFromNet, scoredTotals } from "../server/recession";
import { computeMacroLayer, resetMacroLayerCaches, sanitizeIndicators, type MacroLayerDeps } from "../server/macro-layer";
import { MULTPL_EPS_URL, parseMultplMonthlyTable } from "../server/macro-layer-gaps";
import {
  CONTRADICTION_PAIRS, MACRO_GAPS, computeConcentration, computeContradictions, computeManaging, epsGrowthVsTrend, gapInputs, levyRsl, weeklyCloses,
  type PriceBar,
} from "../shared/macro-layer-gaps";
import { buildMacroWeightPrompt, calculateAdaptiveWeights, detectHabitat, type MacroIndicatorInput } from "../shared/macro-layer";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const close = (a: number | null | undefined, b: number, eps = 1e-9) => assert.ok(a != null && Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const FX = "script/fixtures/macro";
const PRICES = JSON.parse(readFileSync(`${FX}/SPY-RSP-2026-10-16.json`, "utf8")) as { SPY: PriceBar[]; RSP: PriceBar[] };
const EPS_CSV = readFileSync(`${FX}/multpl-eps-2026-10-18.csv`, "utf8");
const EPS = EPS_CSV.trim().split("\n").slice(1).map(l => { const [date, v] = l.split(","); return { date, value: Number(v) }; });
const EPS_HTML = `<table>${EPS.slice().reverse().map(p => {
  const [y, m, d] = p.date.split("-");
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return `<tr><td>${mon} ${Number(d)}, ${y}</td><td>&#x2002;${p.value}</td></tr>`;
}).join("")}</table>`;
const DFII10 = readFileSync(`${FX}/DFII10-2026-10-18.csv`, "utf8");
const DFF = readFileSync(`${FX}/DFF-2026-10-18.csv`, "utf8");
const NOW = Date.parse("2026-10-18T20:00:00Z");
const IND = sanitizeIndicators({ indicators: RECESSION_FALLBACK_DATA.indicators });

function deps(over: Partial<MacroLayerDeps> = {}): MacroLayerDeps {
  return {
    fetchCsv: async id => (id === "DFII10" ? DFII10 : id === "DFF" ? DFF : null),
    llmAvailable: () => false,
    llm: async () => null,
    now: () => NOW,
    fetchBars: async s => (s === "SPY" ? PRICES.SPY : s === "RSP" ? PRICES.RSP : []),
    fetchText: async url => (url === MULTPL_EPS_URL ? EPS_HTML : null),
    ...over,
  };
}
const slot = (name: string, group: "recession" | "correction", ws: number, max: number, extra: Partial<MacroIndicatorInput> = {}): MacroIndicatorInput =>
  ({ name, group, weightedScore: ws, maxWeighted: max, ...extra });

async function main() {
  console.log("F9-07 Konzentration (Levy-RSL SPY − RSP)");
  assert.equal(levyRsl(Array(27).fill(100)), 1);
  close(levyRsl([...Array(26).fill(100), 127]), 127 / 101);
  assert.equal(levyRsl(Array(26).fill(100)), null);
  ok("RSL = letzter Wochenschluss / Mittel der letzten 27 Wochen; < 27 Wochen → null");
  const wk = weeklyCloses([{ date: "2026-10-12", close: 1 }, { date: "2026-10-16", close: 3 }, { date: "2026-10-14", close: 2 }, { date: "2026-10-19", close: 4 }, { date: "x", close: 9 }, { date: "2026-10-20", close: NaN }]);
  assert.deepEqual(wk, [{ week: "2026-10-12", date: "2026-10-16", value: 3 }, { week: "2026-10-19", date: "2026-10-19", value: 4 }]);
  ok("Wochenschluss = letzter gültiger Handelstag der ISO-Woche, ungültige Bars verworfen");
  const conc = computeConcentration(PRICES.SPY, PRICES.RSP);
  assert.equal(conc.asOf, "2026-10-16");
  close(conc.value, Math.round((conc.rslCap! - conc.rslEqual!) * 1e4) / 1e4, 2e-4);
  const spyW = weeklyCloses(PRICES.SPY).map(p => p.value), rspW = weeklyCloses(PRICES.RSP).map(p => p.value);
  close(conc.rslCap, Math.round(levyRsl(spyW)! * 1e4) / 1e4); close(conc.rslEqual, Math.round(levyRsl(rspW)! * 1e4) / 1e4);
  assert.ok(conc.z != null && Math.abs(conc.z) < 6);
  assert.ok(conc.value! < 0.4, "Fixture-Wert unter Schwelle");
  ok(`Fixture 16.10.: RSL SPY ${conc.rslCap} − RSP ${conc.rslEqual} = ${conc.value} (z ${conc.z}) → Regel > 0,4 nicht aktiv`);
  const short = computeConcentration(PRICES.SPY.slice(-60), PRICES.RSP.slice(-60));
  assert.equal(short.value, null); assert.match(short.note, /^n\/a/);
  const empty = computeConcentration([], PRICES.RSP);
  assert.equal(empty.value, null); assert.match(empty.note, /keine Kurse/);
  const noZ = computeConcentration(PRICES.SPY.slice(-400), PRICES.RSP.slice(-400));
  assert.ok(noZ.value != null); assert.equal(noZ.z, null);
  ok("< 27 gemeinsame Wochen / eine Reihe leer → n/a; < 104 Wochen Historie → z n/a, Wert bleibt");
  const habHi = detectHabitat({ realYieldMonthly: [], fedFunds: [], concentration: 0.41 });
  close(calculateAdaptiveWeights(IND, habHi).dimensions.find(d => d.id === "bewertung")!.habitatMultiplier, 1.15);
  const habFx = detectHabitat({ realYieldMonthly: [], fedFunds: [], concentration: conc.value });
  close(calculateAdaptiveWeights(IND, habFx).dimensions.find(d => d.id === "bewertung")!.habitatMultiplier, 1);
  assert.ok(!habFx.notes.some(t => /Konzentration/.test(t)));
  ok("Konzentration speist Habitat-Regel wörtlich (0,41 → ×1,15; Fixture → ×1); n/a-Hinweis entfällt mit Wert");

  console.log("F9-10 Managing-Score");
  assert.deepEqual(parseMultplMonthlyTable(readFileSync(`${FX}/multpl-eps-snippet.html`, "utf8")),
    [{ date: "2026-04-30", value: 276.16 }, { date: "2026-05-31", value: 285.71 }, { date: "2026-06-30", value: 298.03 }]);
  assert.deepEqual(parseMultplMonthlyTable("<html>Just a moment...</html>"), []);
  assert.deepEqual(parseMultplMonthlyTable(null), []);
  assert.equal(parseMultplMonthlyTable(EPS_HTML).length, EPS.length);
  ok("multpl-Parser: echte Zeilen (Snippet), Bot-Seite/leer → []");
  const eg = epsGrowthVsTrend(EPS);
  const last = EPS[EPS.length - 1], prev = EPS.find(p => p.date.slice(0, 7) === `${Number(last.date.slice(0, 4)) - 1}${last.date.slice(4, 7)}`)!;
  close(eg.yoy, Math.round((last.value / prev.value - 1) * 1e4) / 100, 1e-9);
  assert.ok(eg.percentile != null && eg.percentile >= 0 && eg.percentile <= 100);
  close(eg.z, Math.round(2 * (eg.percentile! / 100 - 0.5) * MACRO_GAPS.Z_SCALE * 100) / 100, 0.011);
  assert.equal(eg.asOf, "2026-06-30");
  assert.equal(epsGrowthVsTrend(EPS.slice(-50)).z, null);
  assert.equal(epsGrowthVsTrend([{ date: "2020-01-31", value: -1 }, { date: "2021-01-31", value: 5 }]).yoy, null);
  ok(`EPS TTM YoY ${eg.yoy} % = Perzentil ${eg.percentile} (Komponente 2·P−1); < 60 Monate → n/a; Vorjahr ≤ 0 → übersprungen`);
  const m = computeManaging({ eps: { yoy: 10, z: 1, note: "" }, realYield: 2, realYieldZ: 2, concentration: { ...conc, z: 4 } });
  const c = Object.fromEntries(m.components.map(x => [x.id, x.component]));
  assert.equal(c.capex, null); close(c.eps, 0.5); close(c.realzins, -1); close(c.konzentration, -1);
  close(m.score, Math.round(((0.5 - 1 - 1) / 3) * 1000) / 1000);
  ok("Vorzeichen: EPS über Trend +, Realzins/Konzentration über Trend −, z/2 auf ±1 begrenzt, CAPEX n/a (F9-08), Score = Mittel");
  const m1 = computeManaging({ eps: null, realYield: 2, realYieldZ: 1, concentration: null });
  assert.equal(m1.score, null); assert.match(m1.note, /nur 1 von 4/);
  ok("< 2 Komponenten → Managing n/a (kein Fake)");
  const gi = gapInputs({ concentration: conc, managing: m, widersprueche: { score: 0.3, pairs: [], note: "", assumption: "" } });
  assert.deepEqual(gi.map(i => [i.group, i.dimension, i.weightedScore, i.maxWeighted, i.layerOnly]), [
    ["correction", "managing", -m.score!, 1, true], ["recession", "widersprueche", 0.3, 1, true], ["correction", "widersprueche", 0.3, 1, true],
  ]);
  ok("Eingänge: Managing nur Korrektur (Spec §5) mit Risiko = −Managing; Widersprüche beide Gruppen; layerOnly");

  console.log("F9-11 Makro-Widersprüche (Annahme)");
  assert.equal(CONTRADICTION_PAIRS.length, 3);
  const w1 = computeContradictions([slot("Kreditspreads (BAA-Trs)", "recession", -3, 3), slot("Sahm-Regel", "recession", 4, 4), slot("Shiller CAPE", "correction", 12.6, 12.6), slot("VIX", "correction", -4, 4)]);
  const pc = Object.fromEntries(w1.pairs.map(p => [p.id, p.contradiction]));
  close(pc["kredit-real"], 1); close(pc["bewertung-kredit"], 1); assert.equal(pc["vix-kredit"], 0);
  close(w1.score, Math.round((2 / 3) * 1000) / 1000);
  ok("entgegengesetzt → |a−b|/2, gleichgerichtet → 0, Score = Mittel ≥ 0");
  const w2 = computeContradictions([slot("Kreditspreads (BAA-Trs)", "recession", 3, 3), slot("VIX-Proxy", "correction", -3, 4), slot("VIX", "correction", 2, 4, { available: false }),
    slot("Shiller CAPE", "correction", 9, 12.6, { layerOnly: true })]);
  assert.ok(w2.pairs.every(p => p.contradiction == null)); assert.equal(w2.score, null);
  ok("VIX-Proxy, n/a-Slots und layerOnly-Eingänge zählen nicht; keine Seite → n/a");
  assert.match(w1.assumption, /^ANNAHME F9-11/);
  for (let i = 0; i < 200; i++) {
    const rnd = () => Math.round((Math.random() * 2 - 1) * 10) / 10;
    const w = computeContradictions([slot("Kreditspreads (BAA-Trs)", "recession", rnd(), 1), slot("Aktivität (IP / Auslastung)", "recession", rnd(), 1), slot("Shiller CAPE", "correction", rnd(), 1), slot("VIX", "correction", rnd(), 1)]);
    assert.ok(w.score != null && w.score >= 0 && w.score <= 1);
  }
  ok("200 Zufallsfälle: Score ∈ [0, 1]");

  console.log("Integration Makro-Ebene");
  resetMacroLayerCaches();
  const base = await computeMacroLayer(IND, deps({ fetchBars: undefined, fetchText: undefined }));
  resetMacroLayerCaches();
  const full = await computeMacroLayer(IND, deps());
  assert.ok(full.gaps);
  assert.equal(full.habitat.concentration, full.gaps!.concentration.value);
  const mg = full.dimensions.find(d => d.id === "managing")!;
  assert.equal(mg.available, true); close(mg.habitatMultiplier, 1.2); close(mg.score, -full.gaps!.managing.score!, 1e-9);
  assert.deepEqual(mg.indicators, ["Managing-Score (F9-10)"]);
  const wd = full.dimensions.find(d => d.id === "widersprueche")!;
  assert.equal(wd.available, true); close(wd.score, full.gaps!.widersprueche.score!);
  ok(`Managing (${full.gaps!.managing.score}) und Widersprüche (${full.gaps!.widersprueche.score}) als Dimensionen; managing ×1,2 im restriktiven Habitat`);
  for (const g of ["recession", "correction"] as const) {
    const t = scoredTotals(RECESSION_FALLBACK_DATA.indicators.filter(i => i.group === g) as any);
    assert.equal(full[g].reference, probabilityFromNet(t.net, t.max));
    assert.equal(full[g].reference, base[g].reference);
  }
  assert.ok(!full.unmapped.some(u => /F9-1[01]/.test(u)));
  ok(`Referenz (bestehende Formel) unverändert: Rez ${full.recession.reference}% / Korr ${full.correction.reference}% — Lücken nur in der Makro-Ebene (Rez ${full.recession.layer}% / Korr ${full.correction.layer}%)`);
  const prompt = buildMacroWeightPrompt(full.habitat, full.dimensions);
  assert.match(prompt, /- managing: score=/); assert.match(prompt, new RegExp(`Konzentration \\(Cap-Equal RSL\\): ${full.gaps!.concentration.value!.toFixed(2)}`));
  ok("KI-Prompt enthält Managing und Konzentration (statt n/a)");
  const injected = sanitizeIndicators({ indicators: [{ name: "Managing-Score (F9-10)", group: "correction", weightedScore: 9, maxWeighted: 1, dimension: "managing", layerOnly: true }] });
  assert.deepEqual(injected, [{ name: "Managing-Score (F9-10)", group: "correction", weightedScore: 9, maxWeighted: 1, available: undefined }]);
  ok("Client kann dimension/layerOnly nicht einschleusen (sanitize)");

  console.log("Ausfälle → n/a, nicht gecacht");
  resetMacroLayerCaches();
  let barCalls = 0, textCalls = 0;
  const down = deps({ fetchBars: async () => { barCalls++; throw new Error("429"); }, fetchText: async () => { textCalls++; return "<html>Just a moment...</html>"; } });
  const l1 = await computeMacroLayer(IND, down);
  assert.equal(l1.gaps!.concentration.value, null); assert.equal(l1.habitat.concentration, null);
  assert.equal(l1.gaps!.managing.components.find(c => c.id === "eps")!.available, false);
  assert.equal(l1.gaps!.managing.score, null); assert.equal(l1.dimensions.find(d => d.id === "managing")!.finalWeight, null);
  await computeMacroLayer(IND, down);
  assert.equal(barCalls, 4); assert.equal(textCalls, 2);
  ok("Kurs-/multpl-Ausfall → Konzentration/EPS/Managing n/a, erneuter Versuch beim nächsten Aufruf");
  resetMacroLayerCaches();
  let okCalls = 0;
  const counting = deps({ fetchBars: async s => { okCalls++; return s === "SPY" ? PRICES.SPY : PRICES.RSP; } });
  await computeMacroLayer(IND, counting); await computeMacroLayer(IND, counting);
  assert.equal(okCalls, 2);
  ok("Erfolg wird gecacht (6 h Konzentration)");

  console.log("Byte-Gleichheit bestehender Scores");
  const before = JSON.stringify(RECESSION_FALLBACK_DATA);
  const copy = JSON.parse(before);
  resetMacroLayerCaches();
  await computeMacroLayer(sanitizeIndicators(copy), deps());
  assert.equal(JSON.stringify(copy), before); assert.equal(JSON.stringify(RECESSION_FALLBACK_DATA), before);
  ok("Eingaben nach dem Lauf byte-identisch");
  const importers = execSync(`git grep -l "macro-layer" -- server shared client`, { encoding: "utf8" }).split("\n").filter(Boolean).sort();
  for (const f of importers) assert.ok(/macro-layer|MacroLayer|routes-register\.ts$/.test(f), `Import in ${f}`);
  assert.ok(importers.includes("server/macro-layer-gaps.ts") && importers.includes("server/macro-layer.ts"));
  ok("kein Score-Modul importiert Makro-Ebene/Lücken (nur routes-register.ts und Makro-Ebene-Dateien)");

  console.log("UI und Historie");
  const html = renderToStaticMarkup(createElement(MacroLayerCard, { layer: full, loading: false, error: false, fallback: false }));
  assert.match(html, /macro-layer-concentration/); assert.match(html, /Konzentration \(F9-07\)/); assert.match(html, /\(nicht aktiv\)/);
  assert.match(html, /Managing-Score \(F9-10\)/); assert.match(html, /CAPEX Hyperscaler vs\. Trend: n\/a/);
  assert.match(html, /Makro-Widersprüche \(F9-11\)/); assert.match(html, /ANNAHME F9-11/);
  const htmlNa = renderToStaticMarkup(createElement(MacroLayerCard, { layer: l1, loading: false, error: false, fallback: false }));
  assert.match(htmlNa, /Cap−Equal RSL n\/a/);
  assert.doesNotMatch(html, /Makro-Widersprüche \(F9-11\), Makro-Widersprüche \(F9-11\)/);
  ok("Karte zeigt Konzentration/Managing-Komponenten/Widerspruchs-Paare + Annahme, n/a bei Ausfall");
  const hg = JSON.parse(readFileSync(`${FX}/f9-history-gaps-2026-10-18.json`, "utf8"));
  assert.equal(hg.rows.length, 8);
  for (const r of hg.rows) {
    if (r.asOf < "2003-05-01") assert.equal(r.concentration.value, null, r.asOf);
    else assert.ok(r.concentration.value != null, r.asOf);
    for (const v of [r.recession.layerGaps, r.correction.layerGaps]) assert.ok(v == null || (v >= 5 && v <= 95 && v % 5 === 0));
    assert.equal(r.managing.components.find((c: any) => c.id === "capex").component, null);
  }
  ok("F9-17-Erweiterung: 8 Stichtage, Konzentration vor RSP-Start (2003) n/a, CAPEX überall n/a");

  console.log(`\n${n} Checks grün.`);
}

main().catch(err => { console.error(err); process.exit(1); });
