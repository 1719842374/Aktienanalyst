/** #283 Doublecheck: ?refresh=1 darf den Capex-Map-Cache höchstens alle 10 Min neu aufbauen (FMP-Quota).
 * Run: npx tsx script/test-geo-map-refresh-throttle.ts — läuft in einem Temp-cwd (eigener .cache/ + data.db). */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";

process.chdir(mkdtempSync(join(tmpdir(), "geo-map-throttle-")));
const { registerGeoMapRoute } = await import("../server/researcher-geo-map-route");

let screenCalls = 0;
const deps = {
  hasKey: () => true,
  screenCountry: async (iso: string) => { screenCalls++; return iso === "US" ? [{ symbol: "X", name: "X Corp", sector: "Technology", marketCap: 1e12 }] : []; },
  capexYears: async () => ({ latest: { capexUsd: 1e10, fiscalYear: "2025", reportedCurrency: "USD" }, prevCapexUsd: 5e9 }),
};
const app = express();
registerGeoMapRoute(app, deps as any);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/researcher/geo-map?layer=capex`;
const get = async (q = "") => { const r = await fetch(base + q); return { status: r.status, json: await r.json() }; };

try {
  const r1 = await get();                       // Erstaufbau
  assert.equal(r1.status, 200);
  const perBuild = screenCalls;
  assert.ok(perBuild > 0, "Erstaufbau muss fetchen");
  const r2 = await get("&refresh=1");           // erster Refresh: erlaubt
  assert.equal(r2.status, 200);
  assert.equal(screenCalls, 2 * perBuild, "erster Refresh baut neu");
  const r3 = await get("&refresh=1");           // zweiter Refresh < 10 Min: kein Fetch
  assert.equal(r3.status, 200);
  assert.equal(screenCalls, 2 * perBuild, "zweiter Refresh innerhalb 10 Min darf nicht fetchen");
  assert.equal(r3.json._refreshThrottled, true);
  assert.equal(r3.json.coverage.withData, 1);   // bestehende Felder unverändert geliefert
  assert.equal(r3.json.countries.find((c: any) => c.iso2 === "US").capexUsd, 1e10);
  console.log("test-geo-map-refresh-throttle: OK");
} finally {
  server.close();
}
