/**
 * JOB A1 Nachzug (#253) — GET /api/credit-spread/market bei FRED-Fehlern.
 * Fetch-Fehler, Throw, Reject, HTTP 5xx, HTML und Timeout → gleiche Form wie leere Daten
 * (points [], stress null, Notiz), kein Cache, kein hängender Request, keine Unhandled Rejection.
 * Offline (globales fetch und Loader werden gestubbt). Ausführen: npx tsx script/test-credit-route-errors.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import express from "express";
import { fetchFredCsv } from "../server/fred-csv";
import {
  emptyCreditSpread, getMarketCreditSpread, loadMarketCreditSpread, registerCreditRoute, resetCreditSpreadCache,
} from "../server/credit-route";
import type { CreditSpreadResponse } from "../shared/schema";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const unhandled: unknown[] = [];
process.on("unhandledRejection", r => { unhandled.push(r); });
const SNAP = readFileSync("script/fixtures/credit/BAA10Y-2026-10-11.csv", "utf8");
const realFetch = globalThis.fetch;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// AbortSignal.timeout und der Deadline-Timer sind unref'd (im Server hält Express den Prozess); im Skript hält das hier ihn.
const keepAlive = setInterval(() => {}, 1000);

function assertEmptyShape(b: CreditSpreadResponse, notePart: RegExp) {
  assert.equal(b.seriesId, "BAA10Y");
  assert.ok(b.source && b.sourceUrl);
  assert.deepEqual(b.points, []);
  assert.equal(b.stress, null);
  assert.ok(typeof b.note === "string" && notePart.test(b.note), `Notiz: ${b.note}`);
  assert.deepEqual(Object.keys(b).sort(), ["note", "points", "seriesId", "source", "sourceUrl", "stress"]);
}

// 1) fetchFredCsv: Fehler → null, Retry nach Socket-Abbruch, Timeout hält das Budget
try {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } }); }) as typeof fetch;
  assert.equal(await fetchFredCsv("BAA10Y"), null);
  assert.equal(calls, 2);

  calls = 0;
  globalThis.fetch = (async () => { calls++; if (calls === 1) throw new TypeError("fetch failed"); return new Response(SNAP, { status: 200 }); }) as typeof fetch;
  assert.equal(await fetchFredCsv("BAA10Y"), SNAP);
  assert.equal(calls, 2);

  globalThis.fetch = (async () => new Response("err", { status: 503 })) as typeof fetch;
  assert.equal(await fetchFredCsv("BAA10Y"), null);

  // Hängender Server: fetch respektiert nur das AbortSignal
  globalThis.fetch = ((_u: unknown, init?: RequestInit) => new Promise((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
  })) as typeof fetch;
  const t0 = Date.now();
  assert.equal(await fetchFredCsv("BAA10Y", undefined, 300), null);
  const took = Date.now() - t0;
  assert.ok(took >= 280 && took < 1000, `Timeout-Budget ${took} ms`);
} finally {
  globalThis.fetch = realFetch;
}
ok("fetchFredCsv: Throw/5xx → null, 1 Retry nach Socket-Abbruch, hängender Server endet im Gesamtbudget");

// 2) loadMarketCreditSpread: Throw / Reject / null / HTML → leere Form mit Notiz
assertEmptyShape(await loadMarketCreditSpread({ fetchCsv: () => { throw new Error("boom sync"); } }), /fehlgeschlagen: boom sync/);
assertEmptyShape(await loadMarketCreditSpread({ fetchCsv: async () => { throw new Error("boom async"); } }), /fehlgeschlagen: boom async/);
assertEmptyShape(await loadMarketCreditSpread({ fetchCsv: async () => null }), /nicht erreichbar oder leer/);
assertEmptyShape(await loadMarketCreditSpread({ fetchCsv: async () => "<!DOCTYPE html><p>maintenance</p>" }), /nicht erreichbar oder leer/);
const good = await loadMarketCreditSpread({ fetchCsv: async () => SNAP });
assert.ok(good.points.length > 5000 && good.note === null);
ok("loadMarketCreditSpread: Throw/Reject/null/HTML → points [], stress null, Notiz; gleiche Schlüssel wie Erfolg");

// 3) getMarketCreditSpread: Fehler und Timeout werden nicht gecacht, Erfolg schon
resetCreditSpreadCache();
let loads = 0;
assertEmptyShape(await getMarketCreditSpread({ load: async () => { loads++; throw new Error("kaputt"); } }), /fehlgeschlagen: kaputt/);
const t1 = Date.now();
assertEmptyShape(await getMarketCreditSpread({ load: () => { loads++; return new Promise(() => {}); }, deadlineMs: 200 }), /Timeout/);
assert.ok(Date.now() - t1 < 1000);
// Später Reject nach Deadline erzeugt keine Unhandled Rejection
assertEmptyShape(await getMarketCreditSpread({ load: async () => { loads++; await sleep(150); throw new Error("zu spät"); }, deadlineMs: 50 }), /Timeout/);
const filled = await getMarketCreditSpread({ load: async () => { loads++; return good; } });
assert.equal(filled.points.length, good.points.length);
assert.equal(loads, 4, "jeder Fehlversuch hat neu geladen → nichts Leeres gecacht");
const cached = await getMarketCreditSpread({ load: async () => { loads++; throw new Error("darf nicht laufen"); } });
assert.equal(cached, filled);
assert.equal(loads, 4);
resetCreditSpreadCache();
ok("getMarketCreditSpread: Throw/Timeout → leere Form, kein Cache; Erfolg → Cache-Treffer");

// 4) Echte Express-Route über HTTP
async function hit(load: () => Promise<CreditSpreadResponse>, deadlineMs?: number) {
  resetCreditSpreadCache();
  const app = express();
  registerCreditRoute(app, { load, deadlineMs });
  const server = app.listen(0);
  await new Promise(r => server.once("listening", r));
  const { port } = server.address() as AddressInfo;
  const t = Date.now();
  try {
    const r = await realFetch(`http://127.0.0.1:${port}/api/credit-spread/market`, { signal: AbortSignal.timeout(5000) });
    return { status: r.status, body: await r.json() as CreditSpreadResponse, ms: Date.now() - t };
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
r = await hit(() => loadMarketCreditSpread({ fetchCsv: async () => { throw new Error("socket"); } }));
assertEmptyShape(r.body, /fehlgeschlagen: socket/);
r = await hit(async () => good);
assert.equal(r.body.points.length, good.points.length);
resetCreditSpreadCache();
ok("Route GET /api/credit-spread/market: Fehler/Hänger → 200 mit leerer Form + Notiz, Antwort < 2 s; Erfolg unverändert");

await sleep(300);
assert.deepEqual(unhandled, [], "Unhandled Rejections");
ok("keine Unhandled Rejection");

console.log(`\n${n} Checks grün`);
clearInterval(keepAlive);
process.exit(0);
