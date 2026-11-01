/** Sektor-Ampel neben dominantSector (#397) und sectorLegendShares (#402). Run: npx tsx script/test-sector-ampel.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerGeoMapRoute } from "../server/researcher-geo-map-route";
import {
  GEO_MAP_COUNTRIES,
  SECTOR_CANON,
  SECTOR_LAYER_PARAMS,
  projectSectorLayer,
  sectorLegendShares,
  type GeoMapCountry,
  type GeoMapResponse,
} from "../shared/geo-map";

assert.ok(SECTOR_CANON.length >= 8 && SECTOR_CANON.length <= 12, "8–12 unterscheidbare Sektoren");
assert.equal(new Set(SECTOR_CANON.map(s => s.color)).size, SECTOR_CANON.length);
assert.equal(SECTOR_LAYER_PARAMS.capexShareWeight, 1);
assert.equal(SECTOR_LAYER_PARAMS.greenPct, 2 / 3);
assert.equal(SECTOR_LAYER_PARAMS.redPct, 1 / 3);
assert.ok(SECTOR_LAYER_PARAMS.minCountries > 2);
assert.equal(SECTOR_LAYER_PARAMS.midRankTieWeight, 0.5);

const geo = readFileSync("shared/geo-map.ts", "utf8");
assert.match(geo, /export function sectorLegendShares/);
assert.match(geo, /export function projectSectorLayer/);
assert.match(geo, /export function dominantSectorOf/);
const route = readFileSync("server/researcher-geo-map-route.ts", "utf8");
assert.match(route, /projectSectorLayer/);
assert.match(route, /function withDominant/);
assert.match(route, /function readCapex/);
assert.match(route, /capexPayloadCarriesGeoSegments/);
assert.match(route, /goldLayerInput/);
const panel = readFileSync("client/src/components/researcher/GeoMapPanel.tsx", "utf8");
assert.match(panel, /sectorLegendShares/);
assert.match(panel, /geo-legend-/);
assert.match(panel, /goldCountryHasProduction/);
assert.match(panel, /geo-gold-na/);
assert.match(panel, /geo-sector-ampel-/);
assert.match(panel, /shareBand/);
assert.match(panel, /sectorColor/);
assert.doesNotMatch(panel, /symbol === "GOLD"/);

function sectorBase(rows: { iso2: string; shares: { sector: string; pct: number }[]; capex?: number | null; dominantSector: string | null }[]): GeoMapResponse {
  return {
    layer: "capex",
    asOf: "2026-11-01T00:00:00.000Z",
    source: "test",
    attribution: "test",
    coverage: { withData: rows.filter(r => r.capex !== null).length, total: rows.length },
    countries: rows.map(r => {
      const country = GEO_MAP_COUNTRIES.find(c => c.iso2 === r.iso2)!;
      const capex = r.capex === undefined ? 1 : r.capex;
      const row: GeoMapCountry = {
        ...country,
        status: capex == null ? "n/a" : "ok",
        capexUsd: capex,
        yoyPct: null,
        companies: [],
        sectorShares: r.shares,
        dominantSector: r.dominantSector,
        note: capex == null ? "FMP nicht konfiguriert" : undefined,
      };
      return row;
    }),
  };
}

{
  const base = sectorBase([
    { iso2: "US", shares: [{ sector: "Technology", pct: 10 }], capex: 10, dominantSector: "Technology" },
    { iso2: "DE", shares: [{ sector: "Consumer Cyclical", pct: 40 }], capex: 40, dominantSector: "Consumer Cyclical" },
    { iso2: "TW", shares: [{ sector: "Technology", pct: 70 }], capex: 70, dominantSector: "Technology" },
    { iso2: "KR", shares: [{ sector: "Technology", pct: 90 }], capex: 90, dominantSector: "Technology" },
  ]);
  const snapshot = JSON.stringify(base);
  const projected = projectSectorLayer(base);
  assert.equal(JSON.stringify(base), snapshot, "Projektion mutiert die Capex-Antwort nicht");
  assert.equal(projected.layer, "sector");
  assert.equal(projected.sectorLayer.peerN, 4);
  assert.equal(projected.sectorLayer.peerMedianSharePct, 55);
  assert.equal(projected.sectorLayer.params, SECTOR_LAYER_PARAMS);
  const band = (iso: string) => projected.countries.find(c => c.iso2 === iso)!;
  assert.equal(band("US").sectorAmpel.shareBand, "red");
  assert.equal(band("DE").sectorAmpel.shareBand, "yellow");
  assert.equal(band("TW").sectorAmpel.shareBand, "yellow");
  assert.equal(band("KR").sectorAmpel.shareBand, "green");
  assert.equal(band("KR").sectorAmpel.dominantSector, "Technology");
  assert.equal(band("KR").dominantSector, "Technology");
  assert.equal(band("DE").sectorAmpel.dominantSector, "Consumer Cyclical");
  assert.equal(band("DE").dominantSector, "Consumer Cyclical");
  assert.ok(Math.abs((band("US").sectorAmpel.sharePercentile as number) - 0.125) < 1e-12);
  assert.ok(Math.abs((band("KR").sectorAmpel.shareZ as number) - ((90 - 52.5) / 35)) < 1e-12);
  assert.equal(band("KR").capexUsd, 90);
  assert.equal(projected.sectorLayer.legend.find(s => s.id === "technology")!.countries, 3);
  const legend = sectorLegendShares(projected.countries);
  assert.equal(legend[0].sector, "Technology");
  assert.ok(legend[0].pct > legend.find(s => s.sector === "Consumer Cyclical")!.pct);
}

{
  const projected = projectSectorLayer(sectorBase([
    { iso2: "JP", shares: [{ sector: "Consumer Cyclical", pct: 50 }, { sector: "Industrials", pct: 50 }], dominantSector: "Consumer Cyclical" },
    { iso2: "CL", shares: [], capex: null, dominantSector: null },
  ]));
  const jp = projected.countries.find(c => c.iso2 === "JP")!;
  assert.equal(jp.dominantSector, "Consumer Cyclical");
  assert.equal(jp.sectorAmpel.dominantSector, null);
  assert.equal(jp.sectorAmpel.dominantSharePct, null);
  assert.match(jp.sectorAmpel.sectorNote || "", /^n\/a — Gleichstand/);
  assert.equal(jp.sectorAmpel.shareBand, "neutral");
  const cl = projected.countries.find(c => c.iso2 === "CL")!;
  assert.equal(cl.dominantSector, null);
  assert.equal(cl.sectorAmpel.dominantSharePct, null);
  assert.match(cl.sectorAmpel.sectorNote || "", /^n\/a — /);
  assert.ok(!/:\s*0\b/.test(cl.sectorAmpel.sectorNote || ""));
}

{
  const projected = projectSectorLayer(sectorBase([
    { iso2: "AU", shares: [{ sector: "Basic Materials", pct: 80 }], capex: 5, dominantSector: "Basic Materials" },
    { iso2: "IN", shares: [{ sector: "Technology", pct: 20 }], capex: 8, dominantSector: "Technology" },
  ]));
  assert.ok(projected.countries.every(c => c.sectorAmpel.shareBand === "neutral" && c.sectorAmpel.sharePercentile == null));
  assert.match(projected.countries[0].sectorAmpel.sectorNote || "", /Ampel nicht belastbar/);
  assert.equal(projected.countries.find(c => c.iso2 === "AU")!.sectorAmpel.dominantSector, "Basic Materials");
  assert.equal(projected.countries.find(c => c.iso2 === "AU")!.dominantSector, "Basic Materials");
  assert.equal(projected.countries.find(c => c.iso2 === "IN")!.capexUsd, 8);
}

async function run(deps: any) {
  const app = express();
  registerGeoMapRoute(app, deps, { useCache: false });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/researcher/geo-map`;
  const get = async (q: string) => {
    const r = await fetch(base + q);
    return { status: r.status, json: await r.json() };
  };
  return { get, close: () => server.close() };
}

{
  const t = await run({
    hasKey: () => true,
    screenCountry: async (iso: string) => (
      iso === "US" ? [{ symbol: "X", name: "X Corp", sector: "Technology", marketCap: 1e12 }, { symbol: "Y", name: "Y Inc", sector: "Energy", marketCap: 5e11 }] : []
    ),
    capexYears: async (s: string) => (
      s === "X"
        ? { latest: { capexUsd: 2e10, fiscalYear: "2025", reportedCurrency: "USD" }, prevCapexUsd: 1e10 }
        : { latest: null, prevCapexUsd: null }
    ),
    geoSegments: async () => [],
  });
  const capex = await t.get("?layer=capex");
  assert.equal(capex.status, 200);
  const usCapex = capex.json.countries.find((c: any) => c.iso2 === "US");
  assert.equal(usCapex.dominantSector, "Technology");
  assert.equal(usCapex.sectorAmpel, undefined);
  assert.equal(usCapex.capexUsd, 2e10);
  const sector = await t.get("?layer=sector");
  assert.equal(sector.status, 200);
  assert.equal(sector.json.layer, "sector");
  const us = sector.json.countries.find((c: any) => c.iso2 === "US");
  assert.equal(us.dominantSector, "Technology");
  assert.equal(us.sectorAmpel.dominantSector, "Technology");
  assert.equal(us.sectorAmpel.dominantSharePct, 100);
  assert.equal(us.sectorAmpel.shareBand, "neutral");
  assert.equal(us.sectorAmpel.sharePercentile, null);
  assert.match(us.sectorAmpel.sectorNote, /Ampel nicht belastbar/);
  assert.equal(us.capexUsd, 2e10);
  assert.equal(sector.json.sectorLayer.params.greenPct, 2 / 3);
  assert.equal(sector.json.sectorLayer.params.capexShareWeight, 1);
  t.close();
}

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");

console.log("test-sector-ampel: OK");
