/** Unknown /api/* → JSON 404; every registered route still reachable.
 *  Run: npx tsx script/test-api-json-404.ts            (unit + wiring)
 *       BASE=http://127.0.0.1:5099 npx tsx script/test-api-json-404.ts   (+ probe every registered route on a running build) */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerApiNotFound } from "../server/api-not-found";

// Wiring: after registerRoutes, before error handler and serveStatic/setupVite
const idx = readFileSync("server/index.ts", "utf8");
const at = idx.indexOf("registerApiNotFound(app)");
assert.ok(at > idx.indexOf("await registerRoutes(httpServer, app)"));
assert.ok(at < idx.indexOf("serveStatic(app)") && at < idx.indexOf("setupVite(httpServer, app)"));

// Unit: registered routes win, unknown /api → JSON 404, non-API paths fall through to the SPA
{
  const app = express();
  app.get("/api/known", (_q, r) => r.json({ ok: true }));
  registerApiNotFound(app);
  app.use((_q, r) => r.type("html").send("<!DOCTYPE html>SPA"));
  const s = app.listen(0); const b = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  try {
    assert.deepEqual(await (await fetch(`${b}/api/known`)).json(), { ok: true });
    const r = await fetch(`${b}/api/nope/deep?x=1`, { method: "POST" });
    assert.equal(r.status, 404); assert.match(r.headers.get("content-type") || "", /json/);
    assert.deepEqual(await r.json(), { error: "not_found", message: "Unknown API route: POST /api/nope/deep" });
    const spa = await fetch(`${b}/gold`); assert.equal(spa.status, 200); assert.match(await spa.text(), /SPA/);
    const apiish = await fetch(`${b}/apiary`); assert.match(await apiish.text(), /SPA/, "/apiary is not /api");
  } finally { s.close(); }
}

// All registered routes from source
function files(d: string): string[] { return readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : []; }); }
const routes = new Set<string>();
for (const f of files("server")) for (const m of readFileSync(f, "utf8").matchAll(/app\.(get|post|put|delete|patch)\(\s*["`](\/api\/[^"`]+)["`]/g)) routes.add(`${m[1].toUpperCase()} ${m[2]}`);
assert.ok(routes.size > 40, `found ${routes.size} routes`);
console.log(`registered routes in source: ${routes.size}`);

const BASE = process.env.BASE;
if (BASE) {
  const missing: string[] = [];
  for (const r of Array.from(routes).sort()) {
    const [method, p] = r.split(" ");
    const url = BASE + p.replace(/:[A-Za-z]+/g, "TEST");
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 4000);
    try {
      const res = await fetch(url, { method, signal: ac.signal, headers: { "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
      const txt = await res.text();
      if (res.status === 404 && txt.includes('"error":"not_found"') && txt.includes("Unknown API route")) missing.push(r);
    } catch { /* aborted = handler is running = route exists */ } finally { clearTimeout(t); ac.abort(); }
  }
  assert.deepEqual(missing, [], `routes swallowed by the 404 handler: ${missing.join(", ")}`);
  const u = await fetch(`${BASE}/api/does-not-exist`);
  assert.equal(u.status, 404); assert.match(u.headers.get("content-type") || "", /json/);
  const home = await fetch(`${BASE}/`); assert.match(await home.text(), /<!DOCTYPE html>/i);
  console.log(`probed ${routes.size} routes against ${BASE}: none hit the JSON 404`);
}
console.log("test-api-json-404: OK");
