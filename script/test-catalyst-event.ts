/** S17 „Event hinzufügen“ (§4b Stufe 1). Run: npx tsx script/test-catalyst-event.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
delete process.env.OPENROUTER_API_KEY;
const { eventToCatalyst, validateCatalystEventImpact, isDownsideEventBelowThreshold, isUserEvent } = await import("../shared/catalyst-event");
const { registerCatalystEventRoute } = await import("../server/catalyst-event-route");
const { sumUpsideGb, isNegativeCatalyst } = await import("../shared/bias-fixes");

// 1) Formel identisch zu catalyst-engine.ts (Netto = Brutto × (1 − E/100), GB = PoS/100 × Netto)
const eng = readFileSync("server/catalyst-engine.ts", "utf8");
assert.match(eng, /c\.nettoUpside = \+\(c\.bruttoUpside \* \(1 - c\.einpreisungsgrad \/ 100\)\)\.toFixed\(2\);/);
assert.match(eng, /c\.gb = \+\(c\.pos \/ 100 \* c\.nettoUpside\)\.toFixed\(2\);/);
const ok = (x: any) => { const v = validateCatalystEventImpact(x); assert.ok("impact" in v, JSON.stringify(v)); return (v as any).impact; };
const a = eventToCatalyst(ok({ name: "A", variable: "marge", deltaPct: 10, horizonMonths: 12, pos: 50, einpreisungsgrad: 30 }));
assert.equal(a.nettoUpside, 7); assert.equal(a.gb, 3.5); assert.equal(a.timeline, "12M"); assert.ok(isUserEvent(a)); assert.equal(isNegativeCatalyst(a), false);
// kein Extra-Cap: großes Delta bleibt unverändert
assert.equal(eventToCatalyst(ok({ name: "X", variable: "umsatz", deltaPct: 80, horizonMonths: 6, pos: 90, einpreisungsgrad: 0 })).gb, 72);
// 2) bestehende Logik: zusätzlicher Katalysator addiert sich, ersetzt nichts
const base = [{ name: "K1", pos: 60, bruttoUpside: 10, einpreisungsgrad: 0, nettoUpside: 10, gb: 6, timeline: "12M" }];
assert.equal(sumUpsideGb([...base, a] as any), 9.5);
// 3) Downside: ▼ über bestehenden Pfad; ≤ 50 % = nicht berücksichtigt
const d60 = eventToCatalyst(ok({ name: "D", variable: "umsatz", deltaPct: -15, horizonMonths: 6, pos: 60 }));
const d40 = eventToCatalyst(ok({ name: "D", variable: "umsatz", deltaPct: -15, horizonMonths: 6, pos: 40 }));
const d50 = eventToCatalyst(ok({ name: "D", variable: "umsatz", deltaPct: -15, horizonMonths: 6, pos: 50 }));
assert.equal(d60.flag, "▼"); assert.ok(isNegativeCatalyst(d60)); assert.equal(d60.gb, -9);
assert.equal(isDownsideEventBelowThreshold(d60), false); assert.equal(isDownsideEventBelowThreshold(d40), true); assert.equal(isDownsideEventBelowThreshold(d50), true);
assert.equal(isDownsideEventBelowThreshold(a), false);
// 4) Validierung
for (const bad of [{}, { name: "x", deltaPct: 0, horizonMonths: 1, pos: 1 }, { name: "x", deltaPct: 5, horizonMonths: 1, pos: 101 }, { name: "x", variable: "foo", deltaPct: 5, horizonMonths: 1, pos: 5 }])
  assert.ok("error" in validateCatalystEventImpact(bad));
// 5) Route
async function run(deps: any) {
  const app = express(); app.use(express.json()); registerCatalystEventRoute(app, deps);
  const server = app.listen(0); const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/catalyst-event`;
  const post = async (b: any) => { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json() }; };
  return { post, close: () => server.close() };
}
{ const t = await run({});
  assert.deepEqual((await t.post({ ticker: "MSFT", text: "Guidance angehoben" })).json, { catalyst: null, reason: "llm_unavailable" });
  const s = await t.post({ ticker: "msft", structured: { name: "A", variable: "marge", deltaPct: "10", horizonMonths: "12", pos: "50", einpreisungsgrad: "30" } });
  assert.equal(s.status, 200); assert.equal(s.json.catalyst.gb, 3.5); assert.equal(s.json.source, "structured");
  assert.equal((await t.post({ ticker: "MSFT", structured: { name: "A" } })).status, 400);
  assert.equal((await t.post({ text: "x" })).status, 400);
  t.close(); }
{ let prompt = ""; const t = await run({ llm: async (o: any) => { prompt = o.prompt; return { data: { name: "Margen-Guidance", variable: "marge", deltaPct: 8, horizonMonths: 9, pos: 65, einpreisungsgrad: 25, rationale: "Call" }, modelUsed: "m" }; } });
  const r = await t.post({ ticker: "NVO", companyName: "Novo", text: "Q3-Call: Marge +150bp", existing: ["K1"] });
  assert.equal(r.json.source, "llm"); assert.equal(r.json.catalyst.gb, 3.9); assert.match(prompt, /Q3-Call/); assert.match(prompt, /K1/);
  t.close(); }
{ const t = await run({ llm: async () => ({ data: { name: "x" }, modelUsed: "m" }) });
  assert.equal((await t.post({ ticker: "NVO", text: "irgendwas" })).json.reason, "llm_invalid"); t.close(); }
{ const t = await run({ llm: async () => { throw new Error("boom"); } });
  assert.equal((await t.post({ ticker: "NVO", text: "irgendwas" })).json.reason, "llm_error"); t.close(); }
// 6) Verdrahtung: routes.ts registriert, analyze-route unberührt, Client postet hierher, Dashboard hängt an
const routes = readFileSync("server/routes.ts", "utf8");
assert.match(routes, /import\("\.\/catalyst-event-route"\)/); assert.match(routes, /registerCatalystEventRoute\(app\)/);
assert.ok(!readFileSync("server/analyze-route.ts", "utf8").includes("catalyst-event"));
const s17 = readFileSync("client/src/components/sections/CatalystsSection.tsx", "utf8");
assert.match(s17, /"\/api\/catalyst-event"/); assert.match(s17, /isDownsideEventBelowThreshold\(cat\)/); assert.match(s17, /nicht berücksichtigt/);
assert.match(readFileSync("client/src/pages/Dashboard.tsx", "utf8"), /onUserEvent=\{\(cat\) => \{[\s\S]*catalysts: \[\.\.\.\(prev\.catalysts \?\? \[\]\), cat\]/);
console.log("test-catalyst-event: OK");
