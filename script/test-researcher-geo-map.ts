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
assert.equal(agg.dominantSector, "Technology");
assert.deepEqual(agg.sectorShares, [{ sector: "Technology", pct: 75 }, { sector: "Energy", pct: 25 }]);
assert.equal(agg.companies[2].symbol, "C"); // n/a ganz unten, nicht entfernt
const none = aggregateCountry(def, [], new Map());
assert.equal(none.status, "n/a"); assert.equal(none.capexUsd, null); assert.equal(none.dominantSector, null);

async function run(deps: any, opts: Record<string, unknown> = {}) {
  const app = express();
  registerGeoMapRoute(app, deps, { useCache: false, ...opts });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/researcher/geo-map`;
  const get = async (q: string) => { const r = await fetch(base + q); return { status: r.status, json: await r.json(), type: r.headers.get("content-type") || "" }; };
  return { get, close: () => server.close() };
}

// 1) ohne Key → alle Länder n/a, kein Fake-Wert
{
  const t = await run({ hasKey: () => false, screenCountry: async () => { throw new Error("no"); }, capexYears: async () => { throw new Error("no"); } });
  const r = await t.get("?layer=capex");
  assert.equal(r.status, 200);
  assert.equal(r.json.coverage.withData, 0);
  assert.ok(r.json.countries.every((c: any) => c.status === "n/a" && c.capexUsd === null && c.dominantSector === null));
  const sector = await t.get("?layer=sector");
  assert.equal(sector.status, 200);
  assert.equal(sector.json.layer, "sector");
  assert.equal(sector.json.coverage.withData, 0);
  const gold = await t.get("?layer=gold");
  assert.equal(gold.status, 200);
  assert.equal(gold.json.layer, "gold");
  const nem = gold.json.goldCompanies.find((c: any) => c.symbol === "NEM");
  assert.equal(typeof nem.aiscUsdPerOz, "number");
  assert.ok(nem.aiscUsdPerOz > 0);
  assert.equal(nem.productionOz, null);
  const aiscFile = JSON.parse(readFileSync("server/data/gold-aisc.json", "utf8"));
  assert.ok(Array.isArray(aiscFile.companies.B.aliases) && aiscFile.companies.B.aliases.includes("GOLD"), "Barrick-Alias steht in der Datei, nicht als Einzelfall im UI");
  const bRows = aiscFile.values.filter((v: any) => v.company === "B").sort((a: any, b: any) => String(a.quarter).localeCompare(String(b.quarter)));
  const barrick = gold.json.goldCompanies.find((c: any) => c.symbol === "GOLD");
  assert.equal(barrick.aiscUsdPerOz, bRows[bRows.length - 1].aisc);
  assert.equal(barrick.productionOz, null);
  assert.doesNotMatch(barrick.note, /nicht als GOLD/);
  const { metricTonsToTroyOunces } = await import("../shared/gold-mine-production");
  const production = JSON.parse(readFileSync("server/data/gold-mine-production.json", "utf8"));
  const yearColumns = [...production.yearColumns].sort((a: any, b: any) => Number(b.year) - Number(a.year));
  const year = yearColumns[0].year;
  const world = production.rows.find((row: any) => row.role === "world").tonnes[year];
  const countryRows = production.rows.filter((row: any) => row.role === "country" && typeof row.tonnes[year] === "number" && row.tonnes[year] > 0);
  const chinaTonnes = production.rows.find((row: any) => row.iso2 === "CN").tonnes[year];
  const cn = gold.json.countries.find((c: any) => c.iso2 === "CN");
  assert.equal(gold.json.countries.length, countryRows.length);
  assert.equal(gold.json.coverage.withData, countryRows.length);
  assert.equal(gold.json.coverage.total, countryRows.length);
  assert.ok(Math.abs(cn.countrySharePct - (chinaTonnes / world) * 100) < 1e-9);
  assert.ok(Math.abs(cn.productionOz - metricTonsToTroyOunces(chinaTonnes)) < 1e-6);
  const shareSum = gold.json.countries.reduce((sum: number, c: any) => sum + c.countrySharePct, 0);
  const countrySum = countryRows.reduce((sum: number, row: any) => sum + row.tonnes[year], 0);
  assert.ok(Math.abs(shareSum - (countrySum / world) * 100) < 1e-6);
  assert.ok(gold.json.countries.some((c: any) => c.iso2 === "BF"));
  assert.ok(gold.json.countries.some((c: any) => c.iso2 === "TZ"));
  assert.equal(gold.json.countries.some((c: any) => /other/i.test(c.name)), false);
  assert.match(gold.json.note, /Other Countries/);
  assert.match(gold.json.note, /kein einzelnes Land/);
  const accounted = production.rows.filter((row: any) => row.role !== "world").reduce((sum: number, row: any) => sum + (row.tonnes[year] || 0), 0);
  if (accounted !== world) {
    assert.match(gold.json.note, /nicht auf Länder verteilt/);
    assert.equal(gold.json.remainder.label, "Rest/Sonstige");
    assert.equal(gold.json.remainder.tonnes, world - accounted);
    assert.equal(gold.json.countries.some((c: { name: string }) => c.name === "Rest/Sonstige"), false);
  }
  const kgc = gold.json.goldCompanies.find((c: { symbol: string }) => c.symbol === "KGC");
  const wpm = gold.json.goldCompanies.find((c: { symbol: string }) => c.symbol === "WPM");
  const fnv = gold.json.goldCompanies.find((c: { symbol: string }) => c.symbol === "FNV");
  assert.equal(kgc.aiscUsdPerOz, 1917);
  assert.match(kgc.note, /By-Product/);
  assert.equal(kgc.productionOz, null);
  assert.equal(wpm.aiscUsdPerOz, 568);
  assert.match(wpm.note, /kein WGC-AISC/);
  assert.equal(fnv.aiscUsdPerOz, 347);
  assert.match(fnv.note, /Cash Costs per GEO/);
  assert.match(gold.json.attribution, /Weltvolumen/);
  assert.match(gold.json.source, /USGS/);
  const au = gold.json.countries.find((c: any) => c.iso2 === "AU");
  assert.ok(au.lat < 0 && au.lon > 100, `Australien-Mittelpunkt ${au.lat},${au.lon}`);
  const vc = await t.get("?layer=valuechain");
  assert.equal(vc.status, 200);
  assert.equal(vc.json.countries.length, 0);
  assert.match(vc.json.note, /^n\/a — /);
  assert.equal(vc.json.chains.find((c: any) => c.key === "semiconductors").href, "#/valuechain?industry=semiconductors");
  assert.equal((await t.get("?layer=nope")).status, 400);
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
    geoSegments: async (s: string) => s === "X" ? [{ name: "United States", percentage: 70, revenue: 100 }, { name: "Europe", percentage: 30, revenue: 40 }] : [],
  });
  const r = await t.get("");
  assert.equal(r.status, 200);
  assert.equal(r.json.coverage.withData, 1);
  const us = r.json.countries.find((c: any) => c.iso2 === "US");
  assert.equal(us.capexUsd, 2e10); assert.equal(us.yoyPct, 100);
  assert.equal(us.dominantSector, "Technology");
  assert.equal(us.companies[0].yoyPct, 100); assert.equal(us.companies[1].capexUsd, null);
  assert.equal(us.companies[0].geoSegments[0].iso2, "US");
  assert.equal(us.companies[0].geoSegments[1].iso2, null);
  assert.match(us.companies[0].geoSegments[1].note, /^n\/a — /);
  assert.equal(us.capexUsd, 2e10);
  const sector = await t.get("?layer=sector");
  assert.equal(sector.status, 200);
  assert.equal(sector.json.countries.find((c: any) => c.iso2 === "US").dominantSector, "Technology");
  const de = r.json.countries.find((c: any) => c.iso2 === "DE");
  assert.equal(de.status, "n/a"); assert.match(de.note, /429/);
  t.close();
}
// 3) Kein Score-Pfad berührt
const route = readFileSync("server/researcher-geo-map.ts", "utf8");
assert.doesNotMatch(route, /analyze-route|scoring|computeScore/);
const routeHttp = readFileSync("server/researcher-geo-map-route.ts", "utf8");
assert.match(routeHttp, /GEO_MAP_CACHE_TTL_MS/);
assert.match(routeHttp, /GEO_MAP_STALE_WHILE_REVALIDATE_MS/);
assert.match(routeHttp, /warmGeoMapCache/);
assert.doesNotMatch(routeHttp, /analyze-route/);
assert.match(readFileSync("server/index.ts", "utf8"), /warmGeoMapCache\(\)/);
const panel = readFileSync("client/src/components/researcher/GeoMapPanel.tsx", "utf8");
assert.match(panel, /readApiJson/);
assert.match(panel, /GEO_MAP_CLIENT_TIMEOUT_MS/);
assert.doesNotMatch(panel, /yoyColor/);
assert.doesNotMatch(panel, /symbol === "GOLD"/);
assert.doesNotMatch(readFileSync("shared/geo-map-layers.ts", "utf8"), /symbol === "GOLD"/);
assert.match(panel, /sectorLegendShares/);
assert.match(panel, /geo-legend-/);
assert.match(panel, /goldCountryHasProduction/);
assert.match(panel, /geo-gold-na/);
assert.match(panel, /geo-gold-remainder/);
assert.match(panel, /Länderanteil am Weltvolumen/);
assert.match(routeHttp, /loadGoldMapProduction/);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");

// 4) Perzentil steuert Größe und Farbe, nicht eine feste YoY-Schwelle
{
  const { metricPercentiles, radiusForPercentile, colorForPercentile, GEO_BUBBLE_GEOMETRY, GEO_SCALE_COLORS } = await import("../shared/geo-map");
  const pcts = metricPercentiles([10, 30, 20, null]);
  assert.ok(pcts[1]! > pcts[2]! && pcts[2]! > pcts[0]!, "höheres Capex → höheres Perzentil");
  assert.equal(pcts[3], null);
  assert.equal(radiusForPercentile(null), GEO_BUBBLE_GEOMETRY.minPx);
  assert.equal(radiusForPercentile(0), GEO_BUBBLE_GEOMETRY.minPx);
  assert.equal(radiusForPercentile(1), GEO_BUBBLE_GEOMETRY.maxPx);
  assert.ok(radiusForPercentile(pcts[1]!) > radiusForPercentile(pcts[0]!));
  assert.notEqual(colorForPercentile(0, "yoy"), colorForPercentile(1, "yoy"));
  assert.equal(colorForPercentile(null, "capex"), GEO_SCALE_COLORS.na);
  // +5 und +50 liegen in einer Zwei-Stichprobe an den Enden, nicht beide über einer +10-Schwelle.
  const ends = metricPercentiles([5, 50]);
  assert.ok(ends[0]! < ends[1]!);
}

// 5) HTML und Timeout werden zu n/a, nie zur Parser-Meldung
{
  const { readApiJson, naReasonFromError } = await import("../shared/read-api-json");
  const html = await readApiJson(new Response("<!DOCTYPE html><html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }));
  assert.equal(html.ok, false);
  if (!html.ok) {
    assert.match(html.reason, /^n\/a —/);
    assert.doesNotMatch(html.reason, /Unexpected token/);
  }
  const json = await readApiJson(new Response(JSON.stringify({ layer: "capex" }), { headers: { "content-type": "application/json" } }));
  assert.equal(json.ok, true);
  assert.match(naReasonFromError(new Error("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON")), /^n\/a —/);
  assert.match(naReasonFromError(new Error("Timeout: Server hat nicht innerhalb von 20s geantwortet")), /Zeitüberschreitung/);
}

// 6) Miner-Layer: Netzwerte aus der Injizierung, Standorte n/a, kein erfundener Anteil
{
  const t = await run(
    { hasKey: () => false, screenCountry: async () => [], capexYears: async () => ({ latest: null, prevCapexUsd: null }) },
    {
      minerNetwork: async () => ({ hashrateEH: 600, hashpriceBtcPerThDay: 0.00005, breakevenUsd: 40000, source: "fixture", note: null }),
      minerRegions: async () => [],
    },
  );
  const r = await t.get("?layer=miner");
  assert.equal(r.status, 200);
  assert.match(r.type, /json/);
  assert.equal(r.json.regions.length, 0);
  assert.match(r.json.locationNote, /n\/a/);
  assert.match(r.json.locationNote, /recaptcha/);
  assert.equal(r.json.network.hashrateEH, 600);
  assert.equal(r.json.namedOperators[0].hashrateEH, null);
  assert.equal(r.json.namedOperators[0].powerMw, null);
  assert.ok(r.json.namedOperators.length >= 7);
  t.close();
}

// 6b) Zählung und Blasenradius aus sites (decorateMinerSites). regions bleibt der leere Länderanteil.
{
  const { MINER_MAP_SITES, decorateMinerSites } = await import("../shared/miner-map");
  const decorated = decorateMinerSites(MINER_MAP_SITES);
  const t = await run(
    { hasKey: () => false, screenCountry: async () => [], capexYears: async () => ({ latest: null, prevCapexUsd: null }) },
    { minerNetwork: async () => ({ hashrateEH: 600, hashpriceBtcPerThDay: 0.00005, breakevenUsd: 40000, source: "fixture", note: null }) },
  );
  const r = await t.get("?layer=miner");
  assert.equal(r.status, 200);
  assert.equal(r.json.regions.length, 0);
  assert.equal(r.json.sites.length, decorated.length);
  assert.ok(r.json.sites.length > r.json.regions.length);
  for (const site of decorated) {
    const got = r.json.sites.find((row: { id: string }) => row.id === site.id);
    assert.ok(got, site.id);
    assert.equal(got.bubble.radiusPx, site.bubble.radiusPx, `${site.id} radius`);
  }
  assert.match(r.json.countryShareNote, /^Schätzung \/ keine Primärquelle/);
  assert.equal(r.json.countryShares.find((row: { iso2: string }) => row.iso2 === "KZ").sharePct, 13.22);
  const standortLine = panel.match(/\{[^}\n]+\} Standorte/);
  assert.ok(standortLine, "Zählzeile Standorte fehlt");
  assert.match(standortLine[0], /minerSites\.length/);
  assert.doesNotMatch(standortLine[0], /regions/);
  assert.match(panel, /minerSites\.map/);
  assert.doesNotMatch(panel, /minerData\.regions\.map/);
  assert.match(panel, /function minerBubbleRadius/);
  assert.match(panel, /bubble\?\.radiusPx/);
  assert.match(panel, /spreadMarkerOffsets/);
  assert.match(panel, /MINER_MAP_RADIUS\.naPx/);
  assert.doesNotMatch(panel, /radiusPx == null\) return null/);
  assert.match(panel, /countryShareNote/);
  const { geoEqualEarth } = await import("d3-geo");
  const { MINER_MAP_RADIUS, spreadMarkerOffsets } = await import("../shared/miner-map");
  const drawnRadius = (site: { bubble: { radiusPx: number | null } }) => {
    const radiusPx = site.bubble.radiusPx;
    return typeof radiusPx === "number" && Number.isFinite(radiusPx) ? radiusPx : MINER_MAP_RADIUS.naPx;
  };
  const proj = geoEqualEarth().translate([400, 200]).scale(160);
  const placed = decorated.filter(site => typeof site.lat === "number" && typeof site.lon === "number");
  assert.ok(placed.length < decorated.length, "Vega ohne Koordinate bleibt ohne Pin");
  const points = placed.map(site => {
    const xy = proj([site.lon as number, site.lat as number]);
    assert.ok(xy, site.id);
    return { id: site.id, x: xy[0], y: xy[1], radiusPx: drawnRadius(site) };
  });
  assert.equal(points.length, placed.length);
  const pairOverlaps = (offsets: Map<string, { dx: number; dy: number }> | null) => {
    const pairs: string[] = [];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        const oa = offsets?.get(a.id) ?? { dx: 0, dy: 0 };
        const ob = offsets?.get(b.id) ?? { dx: 0, dy: 0 };
        const dist = Math.hypot(a.x + oa.dx - (b.x + ob.dx), a.y + oa.dy - (b.y + ob.dy));
        if (dist + 1e-6 < a.radiusPx + b.radiusPx) pairs.push(`${a.id}|${b.id}`);
      }
    }
    return pairs;
  };
  const raw = pairOverlaps(null);
  assert.ok(raw.length >= 9, `ohne Versatz ${raw.length} Paare`);
  for (const pair of ["us-tx-rockdale|us-tx-childress", "us-ky-riot|us-oh-hannibal"]) {
    assert.ok(raw.includes(pair), pair);
  }
  assert.ok(raw.some(pair => pair.includes("ca-bc-")), "BC-Standorte überlappen roh");
  const spread = new Map(spreadMarkerOffsets(points).map(item => [item.id, item]));
  assert.deepEqual(pairOverlaps(spread), []);
  t.close();
}

// 7) Kaltstart über dem Budget: JSON mit n/a, nicht hängen und nicht HTML
{
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = process.cwd();
  let release: () => void = () => {};
  const gate = new Promise<void>(r => { release = r; });
  process.chdir(mkdtempSync(join(tmpdir(), "geo-map-budget-")));
  try {
    const t = await run({
      hasKey: () => true,
      screenCountry: async () => { await gate; return []; },
      capexYears: async () => ({ latest: null, prevCapexUsd: null }),
    }, { useCache: true, responseBudgetMs: 80 });
    const started = Date.now();
    const r = await t.get("?layer=capex");
    assert.ok(Date.now() - started < 2000, "Antwortbudget darf den Request nicht bis zum Gateway halten");
    assert.equal(r.status, 200);
    assert.match(r.type, /json/);
    assert.equal(r.json.pending, true);
    assert.match(r.json.countries[0].note, /n\/a/);
    assert.equal(r.json.countries[0].capexUsd, null);
    release();
    t.close();
  } finally {
    release();
    process.chdir(root);
  }
}

// 8) Stale-While-Revalidate: veralteter Cache kommt sofort, Neubau läuft daneben
{
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = process.cwd();
  process.chdir(mkdtempSync(join(tmpdir(), "geo-map-swr-")));
  let clock = Date.parse("2026-11-01T00:00:00Z");
  let blockRebuild = false;
  let releaseRebuild: () => void = () => {};
  const rebuildGate = new Promise<void>(r => { releaseRebuild = r; });
  try {
    const t = await run({
      hasKey: () => true,
      screenCountry: async (iso: string) => {
        if (blockRebuild && iso === "US") await rebuildGate;
        return iso === "US" ? [{ symbol: "X", name: "X Corp", sector: "Technology", marketCap: 1e12 }] : [];
      },
      capexYears: async () => ({ latest: { capexUsd: 1e10, fiscalYear: "2025", reportedCurrency: "USD" }, prevCapexUsd: 5e9 }),
    }, { useCache: true, now: () => clock, responseBudgetMs: 2000 });
    const first = await t.get("?layer=capex");
    assert.equal(first.json.coverage.withData, 1);
    assert.equal(first.json._stale, undefined);
    clock += 48 * 60 * 60 * 1000;
    blockRebuild = true;
    const started = Date.now();
    const stale = await t.get("?layer=capex");
    assert.ok(Date.now() - started < 1000, "veralteter Cache darf nicht auf den Neubau warten");
    assert.equal(stale.status, 200);
    assert.equal(stale.json._stale, true);
    assert.equal(stale.json.countries.find((c: any) => c.iso2 === "US").capexUsd, 1e10);
    releaseRebuild();
    t.close();
  } finally {
    releaseRebuild();
    process.chdir(root);
  }
}

{
  const { matchGeoSegmentIso2, mapGeoSegmentRows, sectorLegendShares } = await import("../shared/geo-map");
  assert.equal(matchGeoSegmentIso2("Taiwan"), "TW");
  assert.equal(matchGeoSegmentIso2("North America"), null);
  assert.equal(mapGeoSegmentRows([]).lines, null);
  assert.match(mapGeoSegmentRows([]).note || "", /^n\/a — /);
  const legend = sectorLegendShares([
    { status: "ok", capexUsd: 40, sectorShares: [{ sector: "Technology", pct: 75 }, { sector: "Energy", pct: 25 }] },
    { status: "ok", capexUsd: 60, sectorShares: [{ sector: "Technology", pct: 50 }, { sector: "Industrials", pct: 50 }] },
    { status: "n/a", capexUsd: null, sectorShares: [{ sector: "Energy", pct: 100 }] },
  ]);
  assert.deepEqual(legend, [
    { sector: "Technology", pct: 60 },
    { sector: "Industrials", pct: 30 },
    { sector: "Energy", pct: 10 },
  ]);
  // Real Estate 0 % im Land und ein Rest, der auf 0,0 % rundet, fehlen in der Legende.
  const hiddenZero = sectorLegendShares([
    { status: "ok", capexUsd: 1e12, sectorShares: [{ sector: "Technology", pct: 100 }, { sector: "Real Estate", pct: 0 }] },
    { status: "ok", capexUsd: 1e6, sectorShares: [{ sector: "Real Estate", pct: 100 }] },
  ]);
  assert.deepEqual(hiddenZero.map(row => row.sector), ["Technology"]);
  assert.ok(hiddenZero.every(row => row.pct > 0));
}

{
  const { lookupAliasCodes, tickerAliasGroupsFromCompanies } = await import("../shared/gold-aisc");
  const groups = tickerAliasGroupsFromCompanies({
    B: { ticker: "B", aliases: ["GOLD", "ABX"] },
    NEM: { ticker: "NEM" },
  });
  assert.deepEqual(lookupAliasCodes("GOLD", groups).codes.sort(), ["ABX", "B", "GOLD"]);
  assert.equal(lookupAliasCodes("GOLD", groups).ambiguous, false);
  assert.deepEqual(lookupAliasCodes("NEM", groups).codes, ["NEM"]);
  const clash = tickerAliasGroupsFromCompanies({
    B: { ticker: "B", aliases: ["GOLD"] },
    X: { ticker: "X", aliases: ["GOLD"] },
  });
  assert.equal(lookupAliasCodes("GOLD", clash).ambiguous, true);
  const { goldCountriesFromFacts, goldCountryHasProduction } = await import("../shared/geo-map-layers");
  assert.equal(goldCountryHasProduction({ productionOz: null, countrySharePct: null }), false);
  assert.equal(goldCountryHasProduction({ productionOz: 0, countrySharePct: null }), false);
  const kept = goldCountriesFromFacts([
    { iso2: "AU", isoNum: "036", name: "Australien", lat: -25, lon: 134, productionOz: null, countrySharePct: null },
    { iso2: "CA", isoNum: "124", name: "Kanada", lat: 56, lon: -106, productionOz: 1_000_000, countrySharePct: 12 },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].iso2, "CA");
  assert.equal(kept[0].productionOz, 1_000_000);
  assert.equal(kept[0].countrySharePct, 12);
  const { resolveGoldProduction, metricTonsToTroyOunces: toOz } = await import("../shared/gold-mine-production");
  const { buildGoldMapLayer } = await import("../shared/geo-map-layers");
  const missing = resolveGoldProduction(null);
  assert.equal(missing.facts.length, 0);
  assert.match(missing.note || "", /nicht interpoliert/);
  const emptyLayer = buildGoldMapLayer("2026-11-01T00:00:00.000Z", [], [], null);
  assert.equal(emptyLayer.countries.length, 0);
  assert.match(emptyLayer.note || "", /nicht interpoliert/);
  const place = (iso2: string, isoNum: string, name: string) => ({ iso2, isoNum, name, lat: 10, lon: 10 });
  const skipped = resolveGoldProduction({
    source: "t",
    sourceUrl: "u",
    unit: "metric tons",
    yearColumns: [{ year: "2023", estimated: false }, { year: "2024", estimated: true }],
    rows: [
      { country: "China", iso2: "CN", isoNum: "156", role: "country", tonnes: { "2023": 10, "2024": 40 } },
      { country: "Ghana", iso2: "GH", isoNum: "288", role: "country", tonnes: { "2023": 90, "2024": null } },
      { country: "World total", role: "world", tonnes: { "2023": 100, "2024": 50 } },
    ],
  }, [place("CN", "156", "China"), place("GH", "288", "Ghana")]);
  assert.equal(skipped.year, "2024");
  assert.equal(skipped.facts.length, 1);
  assert.equal(skipped.facts[0].iso2, "CN");
  assert.ok(Math.abs((skipped.facts[0].countrySharePct ?? 0) - 80) < 1e-9);
  assert.match(skipped.note || "", /Ghana/);
  assert.match(skipped.note || "", /nicht aus einem anderen Jahr/);
  const noWorld = resolveGoldProduction({
    source: "t",
    sourceUrl: "u",
    unit: "metric tons",
    rows: [{ country: "China", iso2: "CN", role: "country", tonnes: { "2024": 10 } }],
  }, []);
  assert.equal(noWorld.unavailable, true);
  assert.equal(noWorld.facts.length, 0);
  assert.match(noWorld.note || "", /keine eindeutige Weltzeile/);
  const dup = resolveGoldProduction({
    source: "t",
    sourceUrl: "u",
    unit: "metric tons",
    rows: [
      { country: "China", iso2: "CN", role: "country", tonnes: { "2024": 10 } },
      { country: "China again", iso2: "CN", role: "country", tonnes: { "2024": 20 } },
      { country: "World", role: "world", tonnes: { "2024": 100 } },
    ],
  }, [place("CN", "156", "China")]);
  assert.equal(dup.facts.length, 0);
  assert.match(dup.note || "", /nicht addiert/);
  const tiny = resolveGoldProduction({
    source: "t",
    sourceUrl: "u",
    unit: "metric tons",
    rows: [
      { country: "Mali", iso2: "ML", role: "country", tonnes: { "2024": 1 } },
      { country: "China", iso2: "CN", role: "country", tonnes: { "2024": 9999 } },
      { country: "World", role: "world", tonnes: { "2024": 10000 } },
    ],
  }, [place("ML", "466", "Mali"), place("CN", "156", "China")]);
  assert.equal(tiny.facts.length, 2);
  assert.ok(tiny.facts.some(fact => fact.iso2 === "ML" && Math.abs((fact.countrySharePct ?? 0) - 0.01) < 1e-9));
  const kg = resolveGoldProduction({
    source: "t",
    sourceUrl: "u",
    unit: "kilograms",
    rows: [
      { country: "China", iso2: "CN", role: "country", tonnes: { "2024": 10 } },
      { country: "World", role: "world", tonnes: { "2024": 100 } },
    ],
  }, [place("CN", "156", "China")]);
  assert.equal(kg.facts[0].productionOz, null);
  assert.ok(Math.abs((kg.facts[0].countrySharePct ?? 0) - 10) < 1e-9);
  assert.match(kg.note || "", /nicht in Unzen umgerechnet/);
  assert.ok(Math.abs(toOz(1) - (1_000_000 / 31.1034768)) < 1e-9);
}

{
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { diskResearcherDelete } = await import("../server/disk-cache");
  const { capexPayloadCarriesGeoSegments } = await import("../server/researcher-geo-map-route");
  assert.equal(capexPayloadCarriesGeoSegments({ countries: [{ companies: [{ symbol: "X" }] }] }), false);
  assert.equal(capexPayloadCarriesGeoSegments({ countries: [{ companies: [{ symbol: "X", geoSegments: null }] }] }), true);
  const root = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "geo-map-seg-"));
  process.chdir(dir);
  diskResearcherDelete("geo-map-capex__global");
  try {
    const cacheDir = join(dir, ".cache", "researcher");
    mkdirSync(cacheDir, { recursive: true });
    const stale = {
      layer: "capex",
      asOf: new Date().toISOString(),
      source: "alt",
      attribution: "alt",
      coverage: { withData: 1, total: 25 },
      countries: [{
        iso2: "US", isoNum: "840", name: "USA", lat: 39, lon: -98,
        status: "ok", capexUsd: 1, yoyPct: null,
        companies: [{ symbol: "OLD", name: "Old", sector: "Technology", capexUsd: 1, fiscalYear: "2024", yoyPct: null, reportedCurrency: "USD" }],
        sectorShares: [{ sector: "Technology", pct: 100 }],
        dominantSector: "Technology",
      }],
      _cachedAt: new Date().toISOString(),
    };
    writeFileSync(join(cacheDir, "geo-map-capex__global.json"), JSON.stringify(stale));
    const t = await run({
      hasKey: () => true,
      screenCountry: async (iso: string) => iso === "US" ? [{ symbol: "X", name: "X Corp", sector: "Technology", marketCap: 1e12 }] : [],
      capexYears: async () => ({ latest: { capexUsd: 5, fiscalYear: "2025", reportedCurrency: "USD" }, prevCapexUsd: null }),
      geoSegments: async () => [{ name: "United States", percentage: 80, revenue: 10 }],
    }, { useCache: true, responseBudgetMs: 5000 });
    const r = await t.get("?layer=capex");
    assert.equal(r.status, 200);
    const us = r.json.countries.find((c: any) => c.iso2 === "US");
    assert.notEqual(us.companies[0].symbol, "OLD");
    assert.equal(us.companies[0].geoSegments[0].iso2, "US");
    assert.ok(r.json.countries.every((c: any) => (c.companies || []).every((co: any) => Object.prototype.hasOwnProperty.call(co, "geoSegments"))));
    t.close();
  } finally {
    diskResearcherDelete("geo-map-capex__global");
    process.chdir(root);
  }
}

// 9) Primärlisting: NEO-CDR (Cboe Canada) verliert gegen die Heimatbörse, auch bei höherem oder gleichem Cap.
{
  const { selectPrimaryListings } = await import("../server/researcher-geo-map");
  const us = [
    { symbol: "AMZN.NE", name: "Amazon.com, Inc.", sector: "Consumer Cyclical", marketCap: 2.6e12, exchangeShortName: "NEO", exchange: "Cboe Canada", currency: "CAD", country: "US" },
    { symbol: "AMZN", name: "Amazon.com, Inc.", sector: "Consumer Cyclical", marketCap: 2.6e12, exchangeShortName: "NASDAQ", exchange: "NASDAQ", currency: "USD", country: "US" },
    { symbol: "MSFT.NE", name: "Microsoft Corporation", sector: "Technology", marketCap: 3.9e12, exchangeShortName: "NEO", exchange: "Cboe Canada", currency: "USD", country: "US" },
    { symbol: "MSFT", name: "Microsoft Corporation", sector: "Technology", marketCap: 3.2e12, exchangeShortName: "NASDAQ", exchange: "NASDAQ", currency: "USD", country: "US" },
    { symbol: "GOOG.NE", name: "Alphabet Inc.", sector: "Communication Services", marketCap: 2.1e12, exchangeShortName: "NEO", currency: "CAD", country: "US" },
    { symbol: "GOOG", name: "Alphabet Inc.", sector: "Communication Services", marketCap: 2.0e12, exchangeShortName: "NASDAQ", currency: "USD", country: "US" },
  ];
  const picked = selectPrimaryListings(us, "US", 6).map((r: { symbol: string }) => r.symbol);
  assert.deepEqual(picked, ["MSFT", "AMZN", "GOOG"]);
  // Screener liefert nur das CDR: Stamm-Ticker der US-Heimatbörse, ohne zweiten FMP-Call.
  const onlyCdr = selectPrimaryListings([
    { symbol: "AMZN.NE", name: "Amazon.com, Inc.", sector: "Consumer Cyclical", marketCap: 2e12, exchangeShortName: "NEO", currency: "CAD" },
    { symbol: "MSFT.NE", name: "Microsoft Corporation", sector: "Technology", marketCap: 3e12, exchangeShortName: "NEO", currency: "CAD" },
    { symbol: "GOOG.NE", name: "Alphabet Inc.", sector: "Communication Services", marketCap: 1e12, exchangeShortName: "NEO", currency: "CAD" },
  ], "US", 6).map((r: { symbol: string }) => r.symbol);
  assert.deepEqual(onlyCdr, ["MSFT", "AMZN", "GOOG"]);
  // Heimatbörse DE schlägt die NYSE-Zeile, auch wenn die ADR-Cap höher ist.
  const de = selectPrimaryListings([
    { symbol: "SAP", name: "SAP SE", sector: "Technology", marketCap: 3e11, exchangeShortName: "NYSE", currency: "USD", country: "DE" },
    { symbol: "SAP.DE", name: "SAP SE", sector: "Technology", marketCap: 2.5e11, exchangeShortName: "XETRA", currency: "EUR", country: "DE" },
  ], "DE", 6);
  assert.equal(de[0].symbol, "SAP.DE");
  // NEO ist für einen kanadischen Emittenten die passende Börse und bleibt.
  const ca = selectPrimaryListings([
    { symbol: "NRTH.NE", name: "Northwind Ltd.", sector: "Technology", marketCap: 1e11, exchangeShortName: "NEO", currency: "CAD", country: "CA" },
  ], "CA", 6);
  assert.equal(ca[0].symbol, "NRTH.NE");
  const { capexPayloadPrimaryListings } = await import("../server/researcher-geo-map");
  const country = (iso2: string, symbol: string) => ({ iso2, companies: [{ symbol, geoSegments: null }] });
  assert.equal(capexPayloadPrimaryListings({ countries: [country("US", "AMZN.NE"), country("US", "MSFT.NE"), country("US", "GOOG.NE")] }), false);
  assert.equal(capexPayloadPrimaryListings({ countries: [country("US", "AMZN"), country("US", "MSFT"), country("US", "GOOG"), country("DE", "SAP.DE"), country("CA", "NRTH.NE")] }), true);
  assert.doesNotMatch(readFileSync("server/researcher-geo-map.ts", "utf8"), /["']AMZN|["']MSFT|["']GOOG/);
}

// 10) Frischer Cache mit NEO-CDR wird verworfen. Der Neubau läuft einmal, der zweite Read ist ein Treffer.
{
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { diskResearcherDelete } = await import("../server/disk-cache");
  const root = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "geo-map-neo-"));
  process.chdir(dir);
  diskResearcherDelete("geo-map-capex__global");
  let screenCalls = 0;
  try {
    const cacheDir = join(dir, ".cache", "researcher");
    mkdirSync(cacheDir, { recursive: true });
    const firm = (symbol: string, name: string) => ({
      symbol, name, sector: "Technology", capexUsd: 1e9, fiscalYear: "2025", yoyPct: null, reportedCurrency: "USD", geoSegments: [],
    });
    const stale = {
      layer: "capex",
      asOf: new Date().toISOString(),
      source: "alt",
      attribution: "alt",
      coverage: { withData: 1, total: 25 },
      countries: [{
        iso2: "US", isoNum: "840", name: "USA", lat: 39, lon: -98,
        status: "ok", capexUsd: 3e9, yoyPct: null,
        companies: [firm("AMZN.NE", "Amazon.com, Inc."), firm("MSFT.NE", "Microsoft Corporation"), firm("GOOG.NE", "Alphabet Inc.")],
        sectorShares: [{ sector: "Technology", pct: 100 }],
        dominantSector: "Technology",
      }],
      _cachedAt: new Date().toISOString(),
    };
    writeFileSync(join(cacheDir, "geo-map-capex__global.json"), JSON.stringify(stale));
    const t = await run({
      hasKey: () => true,
      screenCountry: async (iso: string) => {
        screenCalls += 1;
        if (iso !== "US") return [];
        return [
          { symbol: "AMZN", name: "Amazon.com, Inc.", sector: "Consumer Cyclical", marketCap: 2e12 },
          { symbol: "MSFT", name: "Microsoft Corporation", sector: "Technology", marketCap: 3e12 },
          { symbol: "GOOG", name: "Alphabet Inc.", sector: "Communication Services", marketCap: 1e12 },
        ];
      },
      capexYears: async () => ({ latest: { capexUsd: 1e9, fiscalYear: "2025", reportedCurrency: "USD" }, prevCapexUsd: null }),
      geoSegments: async () => [],
    }, { useCache: true, responseBudgetMs: 5000 });
    const first = await t.get("?layer=capex");
    const symbols = first.json.countries.find((c: { iso2: string }) => c.iso2 === "US").companies.map((c: { symbol: string }) => c.symbol);
    assert.deepEqual(symbols, ["AMZN", "MSFT", "GOOG"]);
    const built = screenCalls;
    assert.ok(built > 0, "falscher Cache muss einmal neu gebaut werden");
    const second = await t.get("?layer=capex");
    assert.equal(screenCalls, built, "zweiter Read darf keinen weiteren Screener-Lauf starten");
    assert.equal(second.json._cached, true);
    assert.deepEqual(second.json.countries.find((c: { iso2: string }) => c.iso2 === "US").companies.map((c: { symbol: string }) => c.symbol), ["AMZN", "MSFT", "GOOG"]);
    t.close();
  } finally {
    diskResearcherDelete("geo-map-capex__global");
    process.chdir(root);
  }
}

{
  const { loadGoldMapProduction } = await import("../server/gold-mine-production");
  const { feature } = await import("topojson-client");
  const { geoContains } = await import("d3-geo");
  const atlas = JSON.parse(readFileSync("node_modules/world-atlas/countries-110m.json", "utf8"));
  const collection = feature(atlas, atlas.objects.countries);
  const byId = new Map(collection.features.map((entry: { id?: string | number; geometry: unknown }) => [String(entry.id).padStart(3, "0"), entry]));
  const loaded = loadGoldMapProduction();
  assert.ok(loaded);
  const countryRows = JSON.parse(readFileSync("server/data/gold-mine-production.json", "utf8")).rows.filter((row: { role?: string }) => row.role === "country");
  assert.equal(loaded.placements.length, countryRows.length);
  for (const place of loaded.placements) {
    assert.ok(place.lon >= -180 && place.lon <= 180, `${place.iso2} lon ${place.lon}`);
    assert.ok(place.lat >= -90 && place.lat <= 90, `${place.iso2} lat ${place.lat}`);
    const entry = byId.get(place.isoNum.padStart(3, "0"));
    assert.ok(entry, place.iso2);
    assert.equal(geoContains(entry, [place.lon, place.lat]), true, `${place.iso2} ${place.lon},${place.lat} liegt nicht im Land`);
  }
  const panelSrc = readFileSync("client/src/components/researcher/GeoMapPanel.tsx", "utf8");
  assert.match(panelSrc, /Quelle: \{goldData\.source\}<\/div>/);
  assert.doesNotMatch(panelSrc, /goldData\.source\}\./);
  assert.match(panelSrc, /spreadMarkerOffsets/);
}

console.log("test-researcher-geo-map: OK");
