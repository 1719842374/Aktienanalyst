/**
 * A3 — GET /api/treasury-10y/market bei FRED-Fehlern (Muster: script/test-credit-route-errors.ts, #253).
 * Throw, Reject, null, HTML und Timeout → gleiche Form wie leere Daten (points [], Notiz), kein Cache,
 * kein hängender Request, keine Unhandled Rejection.
 * Offline (Loader werden gestubbt). Ausführen: npx tsx script/test-treasury10y-route-errors.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  getMarketTreasury10Y, loadMarketTreasury10Y, registerTreasury10YRoute, resetTreasury10YCache,
} from "../server/treasury10y-route";
import type { Treasury10YResponse } from "../shared/schema";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const unhandled: unknown[] = [];
process.on("unhandledRejection", r => { unhandled.push(r); });
const SNAP = readFileSync("script/fixtures/treasury10y/DGS10-2026-10-18.csv", "utf8");
const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const keepAlive = setInterval(() => {}, 1000);

function assertEmptyShape(b: Treasury10YResponse, notePart: RegExp) {
  assert.equal(b.seriesId, "DGS10");
  assert.ok(b.source && b.sourceUrl);
  assert.deepEqual(b.points, []);
  assert.ok(typeof b.note === "string" && notePart.test(b.note), `Notiz: ${b.note}`);
  assert.deepEqual(Object.keys(b).sort(), ["note", "points", "seriesId", "source", "sourceUrl"]);
}

// 1) loadMarketTreasury10Y: Throw / Reject / null / HTML → leere Form mit Notiz
assertEmptyShape(await loadMarketTreasury10Y({ fetchCsv: () => { throw new Error("boom sync"); } }), /fehlgeschlagen: boom sync/);
assertEmptyShape(await loadMarketTreasury10Y({ fetchCsv: async () => { throw new Error("boom async"); } }), /fehlgeschlagen: boom async/);
assertEmptyShape(await loadMarketTreasury10Y({ fetchCsv: async () => null }), /nicht erreichbar oder leer/);
assertEmptyShape(await loadMarketTreasury10Y({ fetchCsv: async () => "<!DOCTYPE html><p>maintenance</p>" }), /nicht erreichbar oder leer/);
assertEmptyShape(await loadMarketTreasury10Y({ fetchCsv: async () => "observation_date,DGS10\n2026-10-15,.\n" }), /nicht erreichbar oder leer/);
const good = await loadMarketTreasury10Y({ fetchCsv: async () => SNAP });
assert.ok(good.points.length > 6000 && good.note === null);
assert.deepEqual(Object.keys(good).sort(), ["note", "points", "seriesId", "source", "sourceUrl"]);
ok("loadMarketTreasury10Y: Throw/Reject/null/HTML/nur '.' → points [], Notiz; gleiche Schlüssel wie Erfolg");

// 2) getMarketTreasury10Y: Fehler und Timeout werden nicht gecacht, Erfolg schon
resetTreasury10YCache();
let loads = 0;
assertEmptyShape(await getMarketTreasury10Y({ load: async () => { loads++; throw new Error("kaputt"); } }), /fehlgeschlagen: kaputt/);
const t1 = Date.now();
assertEmptyShape(await getMarketTreasury10Y({ load: () => { loads++; return new Promise(() => {}); }, deadlineMs: 200 }), /Timeout/);
assert.ok(Date.now() - t1 < 1000);
assertEmptyShape(await getMarketTreasury10Y({ load: async () => { loads++; await sleep(150); throw new Error("zu spät"); }, deadlineMs: 50 }), /Timeout/);
const filled = await getMarketTreasury10Y({ load: async () => { loads++; return good; } });
assert.equal(filled.points.length, good.points.length);
assert.equal(loads, 4, "jeder Fehlversuch hat neu geladen → nichts Leeres gecacht");
const cached = await getMarketTreasury10Y({ load: async () => { loads++; throw new Error("darf nicht laufen"); } });
assert.equal(cached, filled);
assert.equal(loads, 4);
// Cache läuft nach 12 h ab
const later = await getMarketTreasury10Y({ now: Date.now() + 13 * 3600 * 1000, load: async () => { loads++; return good; } });
assert.equal(loads, 5);
assert.equal(later.points.length, good.points.length);
resetTreasury10YCache();
ok("getMarketTreasury10Y: Throw/Timeout → leere Form, kein Cache; Erfolg → Cache-Treffer; nach 12 h neu geladen");

// 3) Echte Express-Route über HTTP
async function hit(load: () => Promise<Treasury10YResponse>, deadlineMs?: number) {
  resetTreasury10YCache();
  const app = express();
  registerTreasury10YRoute(app, { load, deadlineMs });
  const server = app.listen(0);
  await new Promise(r => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  const t = Date.now();
  try {
    const r = await realFetch(`http://127.0.0.1:${port}/api/treasury-10y/market`, { signal: AbortSignal.timeout(5000) });
    return { status: r.status, body: await r.json() as Treasury10YResponse, ms: Date.now() - t };
  } finally {
    server.close();
  }
}
let r = await hit(async () => { throw new Error("FRED weg"); });
assert.equal(r.status, 200);
assertEmptyShape(r.body, /fehlgeschlagen: FRED weg/);
r = await hit(() => new Promise(() => {}), 300);
assert.equal(r.status, 200);
assertEmptyShape(r.body, /Timeout/);
assert.ok(r.ms < 2000, `Route antwortet nach ${r.ms} ms`);
r = await hit(() => loadMarketTreasury10Y({ fetchCsv: async () => { throw new Error("socket"); } }));
assertEmptyShape(r.body, /fehlgeschlagen: socket/);
r = await hit(async () => good);
assert.equal(r.body.points.length, good.points.length);
assert.deepEqual(r.body.points[r.body.points.length - 1], good.points[good.points.length - 1]);
resetTreasury10YCache();
ok("Route GET /api/treasury-10y/market: Fehler/Hänger → 200 mit leerer Form + Notiz, Antwort < 2 s; Erfolg unverändert");

await sleep(300);
assert.deepEqual(unhandled, [], "Unhandled Rejections");
ok("keine Unhandled Rejection");

console.log(`\n${n} Checks grün`);
clearInterval(keepAlive);
globalThis.fetch = realFetch;
process.exit(0);
