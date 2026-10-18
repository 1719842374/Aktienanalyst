/**
 * F9 Makro-Ebene (Future_9 F9-09/12/13/16) — Offline-Tests.
 * Fixtures: script/fixtures/macro/DFII10|DFF-2026-10-18.csv (FRED fredgraph.csv), Indikatoren = RECESSION_FALLBACK_DATA.
 * Ausführen: npx tsx script/test-f9-macro-layer.ts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import express from "express";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RECESSION_FALLBACK_DATA } from "../client/src/lib/recessionFallbackData";
import { MacroLayerCard } from "../client/src/components/recession/MacroLayerCard";
import { fredCsvObservations } from "../server/fred-csv";
import { probabilityFromNet, scoredTotals } from "../server/recession";
import {
  MACRO_AI_CACHE_TTL_MS, computeMacroLayer, registerMacroLayerRoute, resetMacroLayerCaches, sanitizeIndicators, type MacroLayerDeps,
} from "../server/macro-layer";
import {
  MACRO_BASE_WEIGHTS, applyAiWeights, buildMacroWeightPrompt, calculateAdaptiveWeights, detectHabitat, dimensionOfIndicator,
  type MacroHabitat, type MacroIndicatorInput,
} from "../shared/macro-layer";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const close = (a: number | null, b: number, eps = 1e-9) => assert.ok(a != null && Math.abs(a - b) < eps, `${a} ≠ ${b}`);
// Basis = Abzweigpunkt von main (Auftrag: 35ead515; main ist inzwischen auf 4dd43ab8 ohne Überschneidung).
const BASE = (() => {
  try { return execSync("git merge-base HEAD origin/main", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().slice(0, 8); } catch { return "35ead515"; }
})();
const DFII10 = readFileSync("script/fixtures/macro/DFII10-2026-10-18.csv", "utf8");
const DFF = readFileSync("script/fixtures/macro/DFF-2026-10-18.csv", "utf8");
const NOW = Date.parse("2026-10-18T20:00:00Z");
const IND = sanitizeIndicators({ indicators: RECESSION_FALLBACK_DATA.indicators });

function deps(over: Partial<MacroLayerDeps> = {}): MacroLayerDeps {
  return {
    fetchCsv: async id => (id === "DFII10" ? DFII10 : id === "DFF" ? DFF : null),
    llmAvailable: () => false,
    llm: async () => { throw new Error("darf nicht aufgerufen werden"); },
    now: () => NOW,
    ...over,
  };
}
const NO_HAB: MacroHabitat = detectHabitat({ realYieldMonthly: [], fedFunds: [], concentration: null });

async function main() {
  console.log("F9-09 Basisgewichte / Mapping");
  assert.deepEqual(MACRO_BASE_WEIGHTS, { bewertung: 1.8, kredit: 1.2, realwirtschaft: 1.0, geldpolitik: 1.0, sentiment: 0.8, managing: 1.5, widersprueche: 1.3 });
  ok("Basisgewichte = Future_9 §4 Z.62–70");
  // Live-Slots aus server/recession.ts (name: "…" in den Indikator-Objekten) müssen alle zugeordnet sein.
  const src = readFileSync("server/recession.ts", "utf8");
  const liveNames = Array.from(new Set(Array.from(src.matchAll(/^\s+name: "([^"]+)",\n\s+group: "(?:recession|correction)"/gm), m => m[1])));
  liveNames.push("Sahm-Regel", "Aktivität (IP / Auslastung)", "VIX-Proxy");
  assert.ok(liveNames.length >= 14, `nur ${liveNames.length} Live-Namen`);
  assert.deepEqual(liveNames.filter(nm => dimensionOfIndicator(nm) == null), []);
  // Fallback-Stand 20.04. enthält 4 Alt-Slots, die recession.ts nicht mehr liefert: bewusst nicht zugeordnet (kein Raten).
  const unmapped = RECESSION_FALLBACK_DATA.indicators.filter(i => dimensionOfIndicator(i.name) == null).map(i => i.name);
  assert.deepEqual(unmapped.sort(), ["AAII Sentiment", "Advance-Decline-Line", "CBOE Put/Call Ratio", "Investors Intelligence"]);
  assert.equal(dimensionOfIndicator("Shiller CAPE"), "bewertung");
  assert.equal(dimensionOfIndicator("Kreditspreads (BAA-Trs)"), "kredit");
  assert.equal(dimensionOfIndicator("Margin Debt"), "kredit");
  assert.equal(dimensionOfIndicator("Sahm-Regel"), "realwirtschaft");
  assert.equal(dimensionOfIndicator("Inv. Zinskurve (10Y-2Y)"), "geldpolitik");
  assert.equal(dimensionOfIndicator("M2 Geldmenge (YoY)"), "geldpolitik");
  assert.equal(dimensionOfIndicator("VIX-Proxy"), "sentiment");
  assert.equal(dimensionOfIndicator("Google Trends \"Recession\""), "sentiment");
  ok(`alle ${liveNames.length} Live-Slots aus recession.ts zugeordnet; 4 Alt-Slots des Fallbacks als „nicht zugeordnet“ gelistet`);

  console.log("Habitat");
  const hab = detectHabitat({ realYieldMonthly: fredCsvObservations(DFII10), fedFunds: fredCsvObservations(DFF), concentration: null });
  assert.equal(hab.realYieldAsOf, "2026-10-15");
  assert.equal(hab.realYield, 2.78);
  assert.ok(hab.realYieldZ != null && hab.realYieldZ >= 0.5, `z=${hab.realYieldZ}`);
  assert.equal(hab.regime, "restrictive");
  assert.ok(hab.fedFundsChange12mPp != null && hab.fedFundsChange12mPp < 1);
  ok(`Fixture 18.10.: DFII10 ${hab.realYield} % z=${hab.realYieldZ} → restrictive (DFF 12M ${hab.fedFundsChange12mPp} pp)`);
  const flat = Array.from({ length: 400 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1) + i * 864e5).toISOString().slice(0, 10), value: i < 200 ? 2 : 3.1 }));
  assert.equal(detectHabitat({ realYieldMonthly: [], fedFunds: flat, concentration: null }).regime, "restrictive");
  const cut = flat.map(p => ({ ...p, value: p.value === 2 ? 4 : 2.9 }));
  assert.equal(detectHabitat({ realYieldMonthly: [], fedFunds: cut, concentration: null }).regime, "easing");
  assert.equal(detectHabitat({ realYieldMonthly: [], fedFunds: flat.map(p => ({ ...p, value: 2 })), concentration: null }).regime, "neutral");
  assert.equal(NO_HAB.regime, null);
  ok("DFF +1,1 pp → restrictive, −1,1 pp → easing, flach → neutral, keine Daten → n/a");

  console.log("F9-09 calculateAdaptiveWeights");
  const q = calculateAdaptiveWeights(IND, hab);
  const bw = q.dimensions.find(d => d.id === "bewertung")!;
  close(bw.habitatMultiplier, 1.3);
  close(bw.quantWeight, 1.8 * 1.3 * (0.7 + bw.strength! * 0.6));
  const gp = q.dimensions.find(d => d.id === "geldpolitik")!;
  close(gp.quantWeight, 1.0 * 1.2 * (0.7 + gp.strength! * 0.6));
  const rw = q.dimensions.find(d => d.id === "realwirtschaft")!;
  close(rw.habitatMultiplier, 1);
  ok("final = Basis × Habitat(restrictive: bewertung 1,3 / geldpolitik 1,2) × (0,7 + Stärke × 0,6)");
  const qn = calculateAdaptiveWeights(IND, NO_HAB);
  assert.ok(qn.dimensions.every(d => d.habitatMultiplier === 1));
  ok("Habitat n/a → keine Habitat-Multiplikatoren");
  const qc = calculateAdaptiveWeights(IND, { ...NO_HAB, concentration: 0.45 });
  close(qc.dimensions.find(d => d.id === "bewertung")!.habitatMultiplier, 1.15);
  close(calculateAdaptiveWeights(IND, { ...NO_HAB, concentration: 0.4 }).dimensions.find(d => d.id === "bewertung")!.habitatMultiplier, 1);
  ok("Konzentration > 0,4 → bewertung ×1,15 (= 0,4 nicht); null → nicht angewendet");
  for (const id of ["managing", "widersprueche"] as const) {
    const d = q.dimensions.find(x => x.id === id)!;
    assert.equal(d.available, false); assert.equal(d.finalWeight, null); assert.equal(d.score, null);
    assert.match(d.note, /^n\/a/);
  }
  ok("managing (F9-10) und widersprueche (F9-11) → n/a, kein Gewicht, kein Fake-0");
  const allNa = IND.map(i => ({ ...i, available: false }));
  const lNa = await computeMacroLayer(allNa, deps());
  assert.equal(lNa.available, false); assert.equal(lNa.recession.layer, null); assert.equal(lNa.correction.layer, null);
  ok("alle Slots n/a → Makro-Ebene n/a (P null)");

  console.log("Layer-P / Referenz = bestehende Formel");
  resetMacroLayerCaches();
  const layer = await computeMacroLayer(IND, deps());
  for (const g of ["recession", "correction"] as const) {
    const slots = RECESSION_FALLBACK_DATA.indicators.filter(i => i.group === g);
    const t = scoredTotals(slots as any);
    assert.equal(layer[g].reference, probabilityFromNet(t.net, t.max), g);
    assert.ok(layer[g].layer != null && layer[g].layer! >= 5 && layer[g].layer! <= 95 && layer[g].layer! % 5 === 0);
  }
  ok(`Referenz = probabilityFromNet(scoredTotals) (Rez ${layer.recession.reference}% / Korr ${layer.correction.reference}%); Layer Rez ${layer.recession.layer}% / Korr ${layer.correction.layer}%`);
  assert.equal(layer.weightSource, "deterministisch"); assert.equal(layer.ai.status, "no-key"); assert.equal(layer.scoreImpact, "keiner");
  ok("ohne Key: deterministisch, ai.status no-key, LLM nicht aufgerufen");

  console.log("F9-12/13 KI-Pfad (injiziert)");
  resetMacroLayerCaches();
  let calls = 0;
  let lastPrompt = "";
  const llmDeps = (data: any, now = NOW) => deps({
    llmAvailable: () => true,
    now: () => now,
    llm: async opts => { calls++; lastPrompt = opts.prompt; return data instanceof Error ? (() => { throw data; })() : data; },
  });
  const qw = q.dimensions;
  const sugg = { adjustedWeights: { bewertung: 99, kredit: 0, realwirtschaft: String(qw.find(d => d.id === "realwirtschaft")!.quantWeight! * 1.1), sentiment: "x", managing: 5, foo: 3 }, riskFlag: 1, reason: "Test" };
  const l1 = await computeMacroLayer(IND, llmDeps({ data: sugg, modelUsed: "test/model" }));
  assert.equal(calls, 1); assert.equal(l1.weightSource, "openrouter"); assert.equal(l1.ai.model, "test/model"); assert.equal(l1.ai.riskFlag, 1);
  const d1 = (id: string) => l1.dimensions.find(d => d.id === id)!;
  close(d1("bewertung").finalWeight, d1("bewertung").quantWeight! * 1.25);
  close(d1("kredit").finalWeight, d1("kredit").quantWeight! * 0.75);
  close(d1("realwirtschaft").finalWeight, d1("realwirtschaft").quantWeight! * 1.1);
  assert.equal(d1("sentiment").aiWeight, null); close(d1("sentiment").finalWeight, d1("sentiment").quantWeight!);
  assert.equal(d1("managing").finalWeight, null);
  assert.deepEqual([...l1.ai.clamped].sort(), ["bewertung", "kredit"]);
  ok("KI ±25 % geklemmt (99 → +25 %, 0 → −25 %), String-Zahl ok, ungültig/unbekannt/n/a-Dimension ignoriert");
  assert.match(lastPrompt, /max ±25%/); assert.match(lastPrompt, /Gewinnmomentum \(z-Score\): n\/a/); assert.doesNotMatch(lastPrompt, /managing:/);
  ok("Prompt nach Future_9 §9, fehlende Werte als n/a, nur verfügbare Dimensionen");
  const l2 = await computeMacroLayer(IND, llmDeps({ data: sugg, modelUsed: "test/model" }, NOW + MACRO_AI_CACHE_TTL_MS - 1000));
  assert.equal(calls, 1); assert.equal(l2.ai.cached, true); assert.equal(l2.weightSource, "openrouter");
  await computeMacroLayer(IND, llmDeps({ data: sugg, modelUsed: "test/model" }, NOW + MACRO_AI_CACHE_TTL_MS + 1000));
  assert.equal(calls, 2);
  ok("Cache 6 h: Treffer vor Ablauf, neuer Abruf danach");
  for (const [label, resp, status] of [["null", null, "failed"], ["throw", new Error("boom"), "failed"], ["kein adjustedWeights", { data: { foo: 1 }, modelUsed: "m" }, "invalid"], ["alles ungültig", { data: { adjustedWeights: { bewertung: "abc" } }, modelUsed: "m" }, "invalid"]] as const) {
    resetMacroLayerCaches();
    const lf = await computeMacroLayer(IND, llmDeps(resp));
    assert.equal(lf.weightSource, "deterministisch", label); assert.equal(lf.ai.status, status, label);
    assert.deepEqual(lf.dimensions.map(d => d.finalWeight), layer.dimensions.map(d => d.finalWeight), label);
  }
  ok("KI-Fehler/ungültig → Fallback auf quantitative Gewichte (identisch zum No-Key-Pfad)");
  const applied = applyAiWeights(qw, { adjustedWeights: { bewertung: Number.NaN } });
  assert.equal(applied.valid, false); assert.equal(applied.dimensions, qw);
  ok("NaN-Vorschlag → unverändert");

  console.log("Keine Key-Werte im Log");
  const SECRET = "sk-or-test-SECRET-123";
  const prevKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = SECRET;
  const logs: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  try {
    resetMacroLayerCaches();
    await computeMacroLayer(IND, llmDeps(new Error("401")));
    const p = buildMacroWeightPrompt(hab, qw);
    logs.push(p);
  } finally {
    Object.assign(console, orig);
    if (prevKey == null) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prevKey;
  }
  assert.ok(!logs.join("\n").includes(SECRET));
  ok("Key taucht weder im Log noch im Prompt auf");

  console.log("FRED-Ausfall → n/a, kein Cache");
  resetMacroLayerCaches();
  let fetches = 0;
  const down = deps({ fetchCsv: async () => { fetches++; return null; } });
  const lDown = await computeMacroLayer(IND, down);
  assert.equal(lDown.habitat.regime, null); assert.equal(lDown.habitat.realYield, null);
  assert.ok(lDown.dimensions.every(d => d.habitatMultiplier === 1)); assert.equal(lDown.available, true);
  await computeMacroLayer(IND, down);
  assert.equal(fetches, 4);
  resetMacroLayerCaches();
  const lThrow = await computeMacroLayer(IND, deps({ fetchCsv: async () => { throw new Error("ECONNRESET"); } }));
  assert.equal(lThrow.habitat.regime, null);
  ok("null/Throw → Habitat n/a, Layer ohne Habitat, Ausfall nicht gecacht");

  console.log("Bestehende Scores byte-identisch");
  const before = JSON.stringify(RECESSION_FALLBACK_DATA);
  const rawCopy = JSON.parse(before);
  resetMacroLayerCaches();
  await computeMacroLayer(sanitizeIndicators(rawCopy), deps());
  assert.equal(JSON.stringify(RECESSION_FALLBACK_DATA), before); assert.equal(JSON.stringify(rawCopy), before);
  ok("Eingabe-Indikatoren nach dem Lauf byte-identisch (keine Mutation)");
  const protectedFiles = [
    "server/recession.ts", "server/recession-sahm.ts", "server/analyze-route.ts", "shared/recession-regions.ts",
    "shared/recession-market-charts.ts", "client/src/components/recession/recessionDashboardPartsA.tsx",
    "client/src/components/recession/recessionDashboardPartsB.tsx", "client/src/components/recession/recessionDashboardShared.tsx",
    "client/src/lib/recessionFallbackData.ts",
  ];
  execSync(`git diff --quiet ${BASE} -- ${protectedFiles.join(" ")}`);
  ok(`Score-/Rezessions-Dateien und analyze-route.ts unverändert gegen ${BASE}`);
  const changed = execSync(`git diff --name-only ${BASE}`, { encoding: "utf8" }).split("\n").filter(Boolean);
  const untracked = execSync("git ls-files --others --exclude-standard", { encoding: "utf8" }).split("\n").filter(Boolean);
  const allowed = new Set(["server/routes-register.ts", "client/src/pages/RecessionDashboard.tsx"]);
  for (const f of changed) assert.ok(allowed.has(f) || /macro-layer|MacroLayer|f9-macro|fixtures\/macro/.test(f), `unerwartete Änderung ${f}`);
  for (const f of untracked) assert.ok(/macro-layer|MacroLayer|f9-macro|fixtures\/macro/.test(f), `unerwartete neue Datei ${f}`);
  const importers = execSync(`git grep -l "macro-layer" -- server shared client`, { encoding: "utf8" }).split("\n").filter(Boolean).sort();
  for (const f of importers) assert.ok(/macro-layer|MacroLayer|routes-register\.ts$/.test(f), `Import in ${f}`);
  ok("geänderte Bestandsdateien nur routes-register.ts + RecessionDashboard.tsx; kein Score-Modul importiert die Makro-Ebene");

  console.log("Route POST /api/recession/macro-layer");
  resetMacroLayerCaches();
  const app = express();
  app.use(express.json());
  registerMacroLayerRoute(app, deps());
  const srv = app.listen(0);
  try {
    const port = (srv.address() as AddressInfo).port;
    const r = await fetch(`http://127.0.0.1:${port}/api/recession/macro-layer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ indicators: RECESSION_FALLBACK_DATA.indicators }) });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.available, true); assert.equal(b.scoreImpact, "keiner"); assert.equal(b.dimensions.length, 7);
    assert.deepEqual(b.recession, layer.recession);
    const bad = await (await fetch(`http://127.0.0.1:${port}/api/recession/macro-layer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ indicators: "x" }) })).json();
    assert.equal(bad.available, false); assert.match(bad.notes[0], /n\/a/);
    const junk = sanitizeIndicators({ indicators: [{ name: "VIX", group: "x", weightedScore: 1, maxWeighted: 2 }, { name: "VIX", group: "correction", weightedScore: "a", maxWeighted: 2 }, null] });
    assert.deepEqual(junk, []);
  } finally { srv.close(); }
  ok("200 + gleiche Werte wie computeMacroLayer; ungültiger Body → available false / n/a");

  console.log("F9-16 Karte");
  const html = renderToStaticMarkup(createElement(MacroLayerCard, { layer, loading: false, error: false, fallback: false }));
  assert.match(html, /kein Einfluss auf die P-Werte oben/); assert.match(html, /Gewichte: deterministisch/);
  assert.match(html, /macro-layer-dim-bewertung/); assert.match(html, /Managing \(F9-10\)/); assert.match(html, /restriktiv/);
  assert.match(html, /●/);
  const htmlAi = renderToStaticMarkup(createElement(MacroLayerCard, { layer: l1, loading: false, error: false, fallback: false }));
  assert.match(htmlAi, /KI \(OpenRouter, test\/model\)/); assert.match(htmlAi, /geklemmt: bewertung, kredit|geklemmt: kredit, bewertung/);
  for (const props of [{ layer: null, loading: false, error: true, fallback: false }, { layer: null, loading: false, error: false, fallback: true }, { layer: lNa, loading: false, error: false, fallback: false }]) {
    assert.match(renderToStaticMarkup(createElement(MacroLayerCard, props)), /macro-layer-na/);
  }
  ok("Karte: Basis/Habitat/Stärke/KI/Final, Anpassungs-Marker, KI-Quelle, n/a bei Fehler/Fallback/keine Daten");

  console.log("F9-17 Historie (Ergebnisdatei)");
  const hist = JSON.parse(readFileSync("script/fixtures/macro/f9-history-2026-10-18.json", "utf8"));
  assert.deepEqual(hist.rows.map((r: any) => r.asOf), ["2000-03-31", "2000-09-29", "2007-10-31", "2007-12-31", "2008-09-30", "2022-01-31", "2022-06-30", "2026-10-15"]);
  for (const r of hist.rows) {
    for (const v of [r.recession.formula, r.recession.anchored, r.recession.layer, r.correction.formula, r.correction.layer]) {
      assert.ok(v === null || (v >= 5 && v <= 95 && v % 5 === 0), `${r.asOf}: ${v}`);
    }
    assert.equal(r.weights.managing, null); assert.equal(r.weights.widersprueche, null);
    assert.ok(r.naSlots.includes("Buffett Indikator (TMC/GDP)"));
  }
  ok("8 Stichtage 2000/2007/2008/2022/2026, P in 5–95 oder n/a, nicht nachbaubare Slots als n/a gelistet");

  console.log(`\n${n} Checks grün.`);
}

main().catch(err => { console.error(err); process.exit(1); });
