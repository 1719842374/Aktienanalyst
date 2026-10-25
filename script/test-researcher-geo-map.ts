/** GET /api/researcher/geo-map?layer=capex (Offen_WORK_CAPEX_SECTOR_MAP Slice 1). Run: npx tsx script/test-researcher-geo-map.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
const { registerGeoMapRoute } = await import("../server/researcher-geo-map-route");
const { GEO_MAP_COUNTRIES, aggregateCountry } = await import("../shared/geo-map");

const reg = readFileSync("server/routes-register.ts", "utf8");
assert.match(reg, /registerGeoMapRoute\(app\)/);
assert.ok(GEO_MAP_COUNTRIES.length >= 20, "Spec: ≥ 20 Länder");
assert.equal(new Set(GEO_MAP_COUNTRIES.map(c => c.iso2)).size, GEO_MAP_COUNTRIES.length);
// world-atlas ids existieren
const atlas = JSON.parse(readFileSync("node_modules/world-atlas/countries-110m.json", "utf8"));
const ids = new Set(atlas.objects.countries.geometries.map((g: any) => String(g.id)));
const missing = GEO_MAP_COUNTRIES.filter(c => !ids.has(c.isoNum)).map(c => c.iso2);
assert.ok(missing.every(m => ["HK", "SG"].includes(m)), `isoNum fehlt im Atlas: ${missing}`); // Stadtstaaten nur als Bubble

// aggregateCountry: Summe, YoY nur über Firmen mit Vorjahr, Sektor-Anteile = 100
const def = GEO_MAP_COUNTRIES[0];
const agg = aggregateCountry(def, [
  { symbol: "A", name: "A", sector: "Technology", capexUsd: 30, fiscalYear: "2025", yoyPct: null, reportedCurrency: "USD" },
  { symbol: "B", name: "B", sector: "Energy", capexUsd: 10, fiscalYear: "2025", yoyPct: null, reportedCurrency: "USD" },
  { symbol: "C", name: "C", sector: "Energy", capexUsd: null, fiscalYear: null, yoyPct: null, reportedCurrency: null },
], new Map([["A", 20]]));
assert.equal(agg.status, "ok");
assert.equal(agg.capexUsd, 40);
assert.equal(agg.yoyPct, 50); // 30 vs 20, B ohne Vorjahr ausgeschlossen
assert.deepEqual(agg.sectorShares, [{ sector: "Technology", pct: 75 }, { sector: "Energy", pct: 25 }]);
assert.equal(agg.companies[2].symbol, "C"); // n/a ganz unten, nicht entfernt
const none = aggregateCountry(def, [], new Map());
assert.equal(none.status, "n/a"); assert.equal(none.capexUsd, null);

async function run(deps: any) {
  const app = express();
  registerGeoMapRoute(app, deps, { useCache: false });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/researcher/geo-map`;
  const get = async (q: string) => { const r = await fetch(base + q); return { status: r.status, json: await r.json() }; };
  return { get, close: () => server.close() };
}

// 1) ohne Key → alle Länder n/a, kein Fake-Wert
{
  const t = await run({ hasKey: () => false, screenCountry: async () => { throw new Error("no"); }, capexYears: async () => { throw new Error("no"); } });
  const r = await t.get("?layer=capex");
  assert.equal(r.status, 200);
  assert.equal(r.json.coverage.withData, 0);
  assert.ok(r.json.countries.every((c: any) => c.status === "n/a" && c.capexUsd === null));
  assert.equal((await t.get("?layer=sector")).status, 400);
  t.close();
}
// 2) mit Daten: nur US hat Firmen, DE Screener-Fehler, Rest leer
{
  const t = await run({
    hasKey: () => true,
    screenCountry: async (iso: string) => {
      if (iso === "DE") throw new Error("FMP company-screener 429");
      return iso === "US" ? [{ symbol: "X", name: "X Corp", sector: "Technology", marketCap: 1e12 }, { symbol: "Y", name: "Y Inc", sector: "Energy", marketCap: 5e11 }] : [];
    },
    capexYears: async (s: string) => s === "X" ? { latest: { capexUsd: 2e10, fiscalYear: "2025", reportedCurrency: "USD" }, prevCapexUsd: 1e10 } : { latest: null, prevCapexUsd: null },
  });
  const r = await t.get("");
  assert.equal(r.status, 200);
  assert.equal(r.json.coverage.withData, 1);
  const us = r.json.countries.find((c: any) => c.iso2 === "US");
  assert.equal(us.capexUsd, 2e10); assert.equal(us.yoyPct, 100);
  assert.equal(us.companies[0].yoyPct, 100); assert.equal(us.companies[1].capexUsd, null);
  const de = r.json.countries.find((c: any) => c.iso2 === "DE");
  assert.equal(de.status, "n/a"); assert.match(de.note, /429/);
  t.close();
}
// 3) Kein Score-Pfad berührt
const route = readFileSync("server/researcher-geo-map.ts", "utf8");
assert.doesNotMatch(route, /analyze-route|scoring|computeScore/);
console.log("test-researcher-geo-map: OK");
