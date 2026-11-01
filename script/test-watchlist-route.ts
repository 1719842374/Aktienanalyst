/** GET /api/watchlist (+ /api/cache) from the disk cache. Run: npx tsx script/test-watchlist-route.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerWatchlistRoutes, tickerFromCacheKey, buildWatchlist } from "../server/watchlist-route";

const reg = readFileSync("server/routes-register.ts", "utf8");
assert.match(reg, /registerWatchlistRoutes\(app\)/);
const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
assert.match(dash, /queryKey: \['\/api\/watchlist'\]/);
assert.match(dash, /\(watchlistQuery\.data as any\)\?\.tickers \|\| \[\]/);
assert.match(dash, /w\.lastPrice\.toFixed\(0\)/);

assert.equal(tickerFromCacheKey("MSFT"), "MSFT");
assert.equal(tickerFromCacheKey("analyze:nvda:llm:v3"), "NVDA");
assert.equal(tickerFromCacheKey("analyze:NVDA:peers:x"), null);
assert.equal(tickerFromCacheKey(""), null);

const row = (ticker: string, age: number) => ({ ticker, cachedAt: new Date(Date.UTC(2026, 9, 11) - age * 60000).toISOString(), ageMinutes: age, sizeKB: 1 });
const rows = [row("AAPL", 300), row("analyze:MSFT:llm", 5), row("MSFT", 900), row("analyze:MSFT:peers:x", 1), row("NVDA", 50)];
const data: Record<string, any> = { "analyze:MSFT:llm": { currentPrice: 413.96, companyName: "Microsoft" }, NVDA: { currentPrice: "bad" }, AAPL: null };
const wl = buildWatchlist(rows, k => data[k] ?? null);
assert.deepEqual(wl.tickers.map(t => t.ticker), ["MSFT", "NVDA", "AAPL"], "deduped, newest first, peers skipped");
assert.equal(wl.tickers[0].lastPrice, 413.96);
assert.equal(wl.tickers[0].companyName, "Microsoft");
assert.equal(wl.tickers[1].lastPrice, undefined);
assert.equal(buildWatchlist(Array.from({ length: 30 }, (_, i) => row(`T${i}`, i)), () => null).tickers.length, 20);

async function serve(deps: any) {
  const app = express(); registerWatchlistRoutes(app, deps);
  const s = app.listen(0); const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return { get: async (p: string) => { const r = await fetch(base + p); return { status: r.status, type: r.headers.get("content-type") || "", json: await r.json() }; }, close: () => s.close() };
}
{ const t = await serve({ list: () => [], get: () => null });
  const r = await t.get("/api/watchlist");
  assert.equal(r.status, 200); assert.match(r.type, /json/); assert.deepEqual(r.json, { tickers: [] });
  assert.deepEqual((await t.get("/api/cache")).json, { cached: 0, limit: 50, items: [] }); t.close(); }
{ const t = await serve({ list: () => { throw new Error("db"); }, get: () => null });
  assert.deepEqual((await t.get("/api/watchlist")).json, { tickers: [] }); t.close(); }
{ let calls = 0; const t = await serve({ list: () => { calls++; return rows; }, get: (k: string) => data[k] ?? null });
  const r = await t.get("/api/watchlist"); await t.get("/api/watchlist");
  assert.equal(r.json.tickers[0].ticker, "MSFT"); assert.equal(calls, 1, "60 s memo");
  const c = await t.get("/api/cache"); assert.equal(c.json.cached, 5); assert.equal(c.json.items[0].ticker, "analyze:MSFT:peers:x"); t.close(); }
{ const many = Array.from({ length: 80 }, (_, i) => row(`T${i}`, 80 - i));
  const t = await serve({ list: () => many, get: () => null });
  const c = (await t.get("/api/cache")).json;
  assert.equal(c.cached, 80, "cached = total"); assert.equal(c.limit, 50);
  assert.equal(c.items.length, 50, "/api/cache capped at 50");
  assert.equal(c.items[0].ticker, "T79", "newest first"); assert.equal(c.items[49].ticker, "T30");
  t.close(); }
// both blocks registered after the merge with main
const rr = readFileSync("server/routes-register.ts", "utf8");
assert.ok(rr.indexOf("registerRefreshRisksRoute(app)") > 0 && rr.indexOf("registerWatchlistRoutes(app)") > rr.indexOf("registerRefreshRisksRoute(app)"));
console.log("test-watchlist-route: OK");
