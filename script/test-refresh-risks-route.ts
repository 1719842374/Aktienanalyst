/** POST /api/refresh-risks (Section 8). Run: npx tsx script/test-refresh-risks-route.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
delete process.env.OPENROUTER_API_KEY;
const { registerRefreshRisksRoute } = await import("../server/refresh-risks-route");

const reg = readFileSync("server/routes-register.ts", "utf8");
assert.match(reg, /import\("\.\/refresh-risks-route"\)/);
assert.match(reg, /registerRefreshRisksRoute\(app\)/);
// Client contract: Section8 posts here and only accepts json.risks with ≥3 entries
const s8 = readFileSync("client/src/components/sections/Section8.tsx", "utf8");
assert.match(s8, /fetch\("\/api\/refresh-risks"/);
assert.match(s8, /json\.risks\.length >= 3/);

const body = { ticker: "msft", companyName: "Microsoft", description: "Cloud and software.", sector: "Technology",
  catalysts: [{ name: "Azure AI", context: "growth" }, { name: "Capex", context: "", tags: ["capex-tailwind"] }, { name: "Copilot", context: "" }],
  newsItems: [{ title: "N1" }] };

async function run(deps: any) {
  const app = express(); app.use(express.json());
  registerRefreshRisksRoute(app, deps);
  const server = app.listen(0);
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/refresh-risks`;
  const post = async (b: any) => { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, type: r.headers.get("content-type") || "", json: await r.json() }; };
  return { post, close: () => server.close() };
}

// 1) Real generator, no OPENROUTER_API_KEY → clean JSON, no 500
{ const t = await run({ cacheGet: () => null, cacheSet: () => {} });
  const r = await t.post(body);
  assert.equal(r.status, 200); assert.match(r.type, /json/);
  assert.deepEqual(r.json, { risks: null, reason: "llm_unavailable" });
  const bad = await t.post({ ticker: "X" });
  assert.deepEqual(bad.json, { risks: null, reason: "insufficient_data" });
  t.close(); }

// 2) Generator throws → still 200 JSON
{ const t = await run({ generate: async () => { throw new Error("boom"); }, cacheGet: () => null, cacheSet: () => {} });
  const r = await t.post(body);
  assert.equal(r.status, 200); assert.deepEqual(r.json, { risks: null, reason: "llm_error" }); t.close(); }

// 3) Happy path: inputs mapped, capex-tailwind filtered, expectedDamage = EW × Impact, cache updated
{ let seen: any = null; const writes: any[] = [];
  const gen = async (i: any) => { seen = i; return [
    { name: "Azure outage", category: "Binary", ew: 20, impact: 30 },
    { name: "Copilot adoption stalls", category: "Gradual", ew: 35, impact: 15 },
    { name: "EU DMA fine", category: "Binary", ew: 15, impact: 10 }]; };
  const t = await run({ generate: gen, cacheGet: (k: string) => k === "MSFT" ? { ticker: "MSFT", risks: [] } : null, cacheSet: (k: string, d: any) => writes.push([k, d]) });
  const r = await t.post(body);
  assert.equal(r.status, 200);
  assert.equal(r.json.risks.length, 3);
  assert.deepEqual(r.json.risks.map((x: any) => x.expectedDamage), [6, 5.25, 1.5]);
  assert.deepEqual(seen.topCatalysts.map((c: any) => c.name), ["Azure AI", "Copilot"]);
  assert.deepEqual(seen.recentNewsHeadlines, ["N1"]);
  assert.equal(writes.length, 1); assert.equal(writes[0][0], "MSFT"); assert.equal(writes[0][1].risks[0].expectedDamage, 6);
  t.close(); }
console.log("test-refresh-risks-route: OK");
