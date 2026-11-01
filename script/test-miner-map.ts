/**
 * Bitcoin-Miner-Karte. Run: npx tsx script/test-miner-map.ts
 * Standorte aus Filings, Live-Kontext aus der Miner-Pipeline, kein Score.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  MINER_MAP_SITES,
  MINER_MAP_GAPS,
  MINER_BUBBLE_ROLES,
  bubbleCapacitySample,
  decorateMinerSites,
  buildMinerMapBody,
  pipelineFromMiner,
  siteHasFigure,
} from "../shared/miner-map";

const { buildMinerMap } = await import("../server/miner-map");
const { registerGeoMapRoute } = await import("../server/researcher-geo-map-route");

const routesSrc = readFileSync("server/routes.ts", "utf8");
const minerSrc = readFileSync("server/miner-map.ts", "utf8");
const sharedSrc = readFileSync("shared/miner-map.ts", "utf8");
assert.match(routesSrc, /app\.get\("\/api\/btc\/miner-map"/);
assert.doesNotMatch(minerSrc, /analyze-route|overallScore|computeScore/);
assert.doesNotMatch(sharedSrc, /analyze-route|overallScore/);

assert.ok(MINER_MAP_SITES.length >= 10, `Standorte ${MINER_MAP_SITES.length}`);
const tickers = new Set(MINER_MAP_SITES.flatMap(s => s.operators.map(o => o.ticker)));
for (const t of ["MARA", "RIOT", "CLSK", "BITF", "IREN"]) {
  assert.ok(tickers.has(t), `Ticker fehlt: ${t}`);
}
assert.equal(new Set(MINER_MAP_SITES.map(s => s.id)).size, MINER_MAP_SITES.length);

const atlas = JSON.parse(readFileSync("node_modules/world-atlas/countries-110m.json", "utf8"));
const ids = new Set(atlas.objects.countries.geometries.map((g: { id: string }) => String(g.id)));
const missingIso = MINER_MAP_SITES.filter(s => !ids.has(s.isoNum)).map(s => s.iso2);
assert.deepEqual(missingIso, []);

function sourced(n: { value: number; asOf: string; sourceUrl: string; scope: string } | null, note: string | null, label: string) {
  if (n == null) {
    assert.ok(note?.startsWith("n/a — "), `${label} ohne n/a-Grund: ${note}`);
    return;
  }
  assert.ok(n.value > 0, `${label} ist 0 oder negativ`);
  assert.ok(n.asOf && n.sourceUrl && n.scope, `${label} ohne Quelle`);
  assert.equal(note, null, `${label} hat Zahl und n/a-Text`);
}

for (const s of MINER_MAP_SITES) {
  sourced(s.capacityMw, s.capacityNote, s.id);
  assert.ok(s.energyNote && s.regulatoryNote, s.id);
  if (s.operators.length === 0) assert.ok(s.operatorNote?.startsWith("n/a — "), s.id);
  else assert.equal(s.operatorNote, null, s.id);
  for (const o of s.operators) {
    sourced(o.siteHashrateEHs, o.siteHashrateNote, `${s.id} ${o.ticker} site EH`);
    sourced(o.companyHashrateEHs, o.companyHashrateNote, `${s.id} ${o.ticker} company EH`);
    sourced(o.companyPowerUsdPerKwh, o.companyPowerNote, `${s.id} ${o.ticker} power`);
  }
}
for (const g of MINER_MAP_GAPS) assert.ok(g.note.startsWith("n/a — "), g.id);

const sample = bubbleCapacitySample(MINER_MAP_SITES);
assert.ok(sample.length >= 8, `Stichprobe ${sample.length}`);
assert.ok(!sample.includes(2000), "erwartete 2 GW dürfen die Stichprobe nicht skalieren");
for (const role of sample) assert.ok(role > 0);

const decorated = decorateMinerSites(MINER_MAP_SITES);
const byId = new Map(decorated.map(s => [s.id, s]));
const rockdale = byId.get("us-tx-rockdale")!;
const flats = byId.get("ca-bc-canal-flats")!;
const childress = byId.get("us-tx-childress")!;
const matagorda = byId.get("us-tx-matagorda")!;
const oman = byId.get("om-country")!;
assert.ok(rockdale.bubble.radiusPx! > flats.bubble.radiusPx!, "größere MW → größerer Radius");
assert.ok(childress.bubble.radiusPx! >= rockdale.bubble.radiusPx!);
assert.equal(matagorda.bubble.radiusPx, null);
assert.ok(matagorda.bubble.note?.startsWith("n/a — "));
assert.equal(oman.bubble.radiusPx, null);
assert.equal(oman.capacityMw, null);
assert.ok(decorated.filter(siteHasFigure).length >= 10);

const body = buildMinerMapBody(pipelineFromMiner(null, "Test ohne Pipeline"), "2026-11-01T00:00:00.000Z");
assert.equal(body.layer, "miner");
assert.equal(body.pipeline.networkHashrateEH, null);
assert.ok(body.pipeline.networkHashrateNote?.startsWith("n/a — "));
assert.equal(body.pipeline.hashpriceUsdPerThDay, null);
assert.ok(body.pipeline.hashpriceUsdNote?.startsWith("n/a — "));
assert.ok(body.countryShareNote.startsWith("n/a — "));
assert.equal(body.pipeline.breakevenUsd, null);

const live = buildMinerMapBody(pipelineFromMiner({
  currentHashrateEH: 900,
  hashprice: 0.0000004,
  breakevenPrice: 42000,
  puellMultiple: null,
  hashrateSource: "mempool.space",
  lastUpdated: "2026-11-01T00:00:00.000Z",
}, null));
assert.equal(live.pipeline.networkHashrateEH, 900);
assert.equal(live.pipeline.breakevenUsd, 42000);
assert.equal(live.pipeline.puellMultiple, null);
assert.ok(live.pipeline.puellNote?.startsWith("n/a — "));
assert.equal(live.sites.find(s => s.id === "us-tx-rockdale")?.capacityMw?.value, 700);

const zeroed = pipelineFromMiner({ currentHashrateEH: 0, hashprice: 0, breakevenPrice: 0, puellMultiple: null }, "leer");
assert.equal(zeroed.networkHashrateEH, null);
assert.equal(zeroed.hashpriceBtcPerThDay, null);
assert.equal(zeroed.breakevenUsd, null);

const built = await buildMinerMap({
  fetchMiner: async () => ({ currentHashrateEH: 880, hashprice: 1e-7, breakevenPrice: 39000, puellMultiple: null, hashrateSource: "mempool.space", lastUpdated: "2026-11-01T00:00:00.000Z" }),
  waitMs: 1000,
  now: () => Date.parse("2026-11-01T12:00:00.000Z"),
});
assert.equal(built.pipeline.networkHashrateEH, 880);
assert.equal(built.sites.length, MINER_MAP_SITES.length);
assert.ok(!("overallScore" in built));

const timed = await buildMinerMap({
  fetchMiner: () => new Promise(() => {}),
  waitMs: 30,
  now: () => Date.parse("2026-11-01T12:00:00.000Z"),
});
assert.equal(timed.pipeline.networkHashrateEH, null);
assert.ok(timed.pipeline.unavailableNote?.includes("30"));
assert.ok(timed.sites.length >= 10);

let capexCalled = false;
{
  const app = express();
  registerGeoMapRoute(app, {
    hasKey: () => { capexCalled = true; return false; },
    screenCountry: async () => { capexCalled = true; return []; },
    capexYears: async () => { capexCalled = true; return { latest: null, prevCapexUsd: null }; },
  }, {
    useCache: false,
    buildMinerMap: async () => buildMinerMapBody(pipelineFromMiner(null, "injiziert")),
  });
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  try {
    const miner = await fetch(`http://127.0.0.1:${port}/api/researcher/geo-map?layer=miner`);
    const minerJson = await miner.json();
    assert.equal(miner.status, 200);
    assert.equal(minerJson.layer, "miner");
    assert.ok(minerJson.sites.length >= 10);
    assert.equal(capexCalled, false, "Miner-Layer darf den Capex-Fetcher nicht starten");
    const sector = await fetch(`http://127.0.0.1:${port}/api/researcher/geo-map?layer=sector`);
    const sectorJson = await sector.json();
    assert.equal(sector.status, 200);
    assert.equal(sectorJson.layer, "sector");
  } finally {
    server.close();
  }
}

assert.ok((MINER_BUBBLE_ROLES as readonly string[]).includes("developed"));
assert.equal((MINER_BUBBLE_ROLES as readonly string[]).includes("planned"), false);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
const scores = {
  VOW3: Number(pin.VWAGY.overallScore).toFixed(6),
  SAP: Number(pin.SAP.overallScore).toFixed(6),
  MSFT: Number(pin.MSFT.overallScore).toFixed(6),
};
assert.equal(scores.VOW3, "4.735718");
assert.equal(scores.SAP, "5.174758");
assert.equal(scores.MSFT, "4.058138");
console.log("Score-Pin (Fixture expectOldHead, unverändert):", scores);
console.log("test-miner-map: OK");
