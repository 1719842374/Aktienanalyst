/**
 * Regional liquidity books — catalog, s(z), inverse-vol mix, ?region= payload.
 * Run: npx tsx script/test-liquidity-index.ts
 */
import express from "express";
import { CATALOG, type Region, type SeriesSpec } from "../server/liquidity-index-catalog";
import {
  H_MIN,
  discoverBooks,
  jpnAssetsToTn,
  mixInverseVol,
  policyBookDelta,
  sOfZ,
  scoreCatalog,
  type Obs,
} from "../server/liquidity-index-math";
import { buildLiquidityIndex, parseLiquidityRegion } from "../server/liquidity-index";
import { registerLiquidityRoute } from "../server/researcher-liquidity-route";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

function monthly(n: number, value: number, last?: number, start = "2023-01-01"): Obs[] {
  const out: Obs[] = [];
  const d = new Date(`${start}T00:00:00.000Z`);
  for (let i = 0; i < n; i++) {
    out.push({
      date: d.toISOString().slice(0, 10),
      value: i === n - 1 && last != null ? last : value,
    });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

function spec(region: Region, cacheKey: string): SeriesSpec | undefined {
  return CATALOG[region].find(s => s.cacheKey === cacheKey);
}

console.log("liquidity index regional books");

ok("s(0)=50", sOfZ(0) === 50);
ok("s(2)=100", sOfZ(2) === 100);
ok("s(-2)=0", sOfZ(-2) === 0);
ok("s clips past ±2", sOfZ(4) === 100 && sOfZ(-4) === 0);

ok("JPNASSETS 6446620 → 644.66 tn yen", jpnAssetsToTn(6_446_620) === 644.66);
ok("APP+PEPP July book Δ = -52.0", policyBookDelta(-27.17, -24.82) === -52);

const even = mixInverseVol([
  { score: 80, sigma: 1 },
  { score: 20, sigma: 1 },
]);
ok("inverse-vol mix of two equal slots", even === 50, String(even));
const one = mixInverseVol([{ score: 80, sigma: 1 }]);
ok("missing slot drops out of the mix", one === 80, String(one));
const capped = mixInverseVol([
  { score: 100, sigma: 1 },
  { score: 0, sigma: 0.01, weightCap: 0.1 },
]);
ok("China M2 weight cap ≤ 0.10", capped != null && capped >= 90, String(capped));

const keys = (region: Region) => CATALOG[region].map(s => s.cacheKey);
ok("US WALCL key", keys("US").includes("liqidx_US__WALCL"));
ok("US SOMA key", keys("US").includes("liqidx_US__soma"));
ok("US TGA key", keys("US").includes("liqidx_US__tga"));
ok("US MSPD key", keys("US").includes("liqidx_US__mspd"));
ok("US buybacks key", keys("US").includes("liqidx_US__buybacks"));
ok("US QRA key", keys("US").includes("fiscal__qra_2026Q3"));
ok("QRA valid through 2026-11-04", spec("US", "fiscal__qra_2026Q3")?.validUntil === "2026-11-04");
ok("EU assets/app/df/rate/m3/gov/bonds/bund",
  ["liqidx_EU__assets", "liqidx_EU__app_pepp", "liqidx_EU__df", "liqidx_EU__ecbdfr", "liqidx_EU__m3", "liqidx_EU__govdep", "liqidx_EU__eubonds", "liqidx_EU__bund"]
    .every(k => keys("EU").includes(k)));
ok("ASIA jpnassets/jgb/rate/m2/iss/gov/cn",
  ["liqidx_ASIA__jpnassets", "liqidx_ASIA__jgb_px", "liqidx_ASIA__rate", "liqidx_ASIA__m2", "liqidx_ASIA__jgb_iss", "liqidx_ASIA__govdep", "liqidx_ASIA__cn_m2"]
    .every(k => keys("ASIA").includes(k)));

ok("EU bonds are book F", spec("EU", "liqidx_EU__eubonds")?.book === "F");
ok("APP/PEPP is book M", spec("EU", "liqidx_EU__app_pepp")?.book === "M");
ok("M3 is channel C, not book M or F", spec("EU", "liqidx_EU__m3")?.book === "C");
ok("CN M2 weight cap on the spec", spec("ASIA", "liqidx_ASIA__cn_m2")?.weightCap === 0.1);
ok("ASIA catalog has no US TGA", !CATALOG.ASIA.some(s => s.id === "WTREGEN" || s.cacheKey.includes("tga")));
ok("no M2V in any catalog", !(["US", "EU", "ASIA"] as Region[]).some(r => CATALOG[r].some(s => s.id.includes("M2V"))));

const catalogBlob = JSON.stringify(CATALOG);
ok("catalog has no Bessent", !/Bessent/i.test(catalogBlob));
ok("catalog has no GENIUS", !catalogBlob.includes("GENIUS"));
ok("catalog has no NGEU/CHIPS capex", !catalogBlob.includes("NGEU") && !catalogBlob.includes("CHIPS"));

const flat = monthly(H_MIN + 8, 3400);
const shocked = monthly(H_MIN + 8, 3400, 3400 - 52);
const base = scoreCatalog("EU", { "liqidx_EU__app_pepp": { points: flat } });
const moved = scoreCatalog("EU", { "liqidx_EU__app_pepp": { points: shocked } });
ok("flat policy book scores", base.li === 50, String(base.li));
ok("APP/PEPP monthly stock moves EU-LI", moved.li != null && base.li != null && moved.li < base.li, `${base.li} → ${moved.li}`);
ok("shocked book is QT-like", moved.discovered.cbQT === true && moved.discovered.cbBuying === false);

const asia = scoreCatalog("ASIA", {
  "liqidx_ASIA__jpnassets": { points: monthly(H_MIN + 8, 640, 630) },
});
ok("ASIA books expose JPNASSETS in M", asia.books.M.some(s => s.cacheKey === "liqidx_ASIA__jpnassets" && typeof s.available === "boolean"));
ok("ASIA payload has no TGA slot", ![...asia.books.M, ...asia.books.F].some(s => s.id === "WTREGEN"));

const euBooks = scoreCatalog("EU", {});
ok("every M and F slot has available", [...euBooks.books.M, ...euBooks.books.F].every(s => typeof s.available === "boolean"));
ok("empty EU still lists bonds in F", euBooks.books.F.some(s => s.cacheKey === "liqidx_EU__eubonds"));
ok("bonds are not in book M", !euBooks.books.M.some(s => s.cacheKey === "liqidx_EU__eubonds"));
const payloadBlob = JSON.stringify(euBooks);
ok("payload has no Bessent", !/Bessent/i.test(payloadBlob));
ok("payload has no GENIUS", !payloadBlob.includes("GENIUS"));

const issuance = monthly(H_MIN + 8, 100, 180);
const flood = scoreCatalog("EU", { "liqidx_EU__eubonds": { points: issuance } });
ok("issuance spike is fiscalFlood", flood.discovered.fiscalFlood === true, JSON.stringify(flood.discovered));
ok("flood slot stays in book F", flood.books.F.some(s => s.cacheKey === "liqidx_EU__eubonds" && s.available));

const sameLevels = monthly(H_MIN + 8, 100, 140);
const usScore = scoreCatalog("US", { "liqidx_US__WALCL": { points: sameLevels } });
const euScore = scoreCatalog("EU", { "liqidx_EU__assets": { points: sameLevels } });
const asiaScore = scoreCatalog("ASIA", { "liqidx_ASIA__jpnassets": { points: sameLevels } });
ok("same mixer on US/EU/ASIA asset slots",
  usScore.books.M.find(s => s.role === "assets")?.score === euScore.books.M.find(s => s.role === "assets")?.score
  && euScore.books.M.find(s => s.role === "assets")?.score === asiaScore.books.M.find(s => s.role === "assets")?.score,
  [usScore, euScore, asiaScore].map(p => p.books.M.find(s => s.role === "assets")?.score).join(","));

const tgaUp = scoreCatalog("US", { "liqidx_US__tga": { points: monthly(H_MIN + 8, 700, 900) } });
const tgaSlot = tgaUp.books.F.find(s => s.cacheKey === "liqidx_US__tga");
ok("rising TGA scores tight", tgaSlot?.available === true && (tgaSlot.score ?? 100) < 50, String(tgaSlot?.score));

const bills = monthly(H_MIN + 8, 500, 580);
const notes = monthly(H_MIN + 8, 4000, 4000);
const soma = scoreCatalog("US", { "liqidx_US__soma": { points: notes, parts: { bills } } });
ok("SOMA bills up and notes flat is RMP, not QE", soma.discovered.rmpLike === true && soma.discovered.cbBuying === false,
  JSON.stringify(soma.discovered));

ok("parse region", parseLiquidityRegion("eu") === "EU" && parseLiquidityRegion(undefined) === null && parseLiquidityRegion("UK") === "invalid");

const seen: string[] = [];
const indexed = await buildLiquidityIndex("US", {
  now: new Date("2026-10-03T00:00:00.000Z"),
  cache: {
    get: () => null,
    set: (key) => seen.push(key),
  },
  fetchBundle: async (s) => {
    seen.push("fetch:" + s.id);
    if (s.cacheKey === "liqidx_US__WALCL") return { points: sameLevels };
    return { points: [] };
  },
  fetchStocks: async () => ({}),
});
ok("builder does not fetch M2V", !seen.some(s => s.includes("M2V") || s.includes("M2SL")));
ok("builder writes catalog cache keys only", indexed.books.M.some(s => s.cacheKey === "liqidx_US__WALCL" && s.available));
ok("discover helper agrees on QT", discoverBooks({ policyZ: -1.4, policyDelta: -52, issuanceZ: 0.2 }).cbQT === true);

async function withServer(run: (base: string, calls: { c2: number }) => Promise<void>) {
  const calls = { c2: 0 };
  const app = express();
  registerLiquidityRoute(app, {
    buildIndex: async (region) => scoreCatalog(region, {}),
    fetchC2: async () => {
      calls.c2 += 1;
      return { regimeScore: 1, source: "c2-stub" };
    },
  });
  const server = await new Promise<import("http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    await run(`http://127.0.0.1:${port}`, calls);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
}

await withServer(async (base, calls) => {
  const eu = await fetch(`${base}/api/researcher/liquidity?region=EU`);
  const body = await eu.json();
  ok("GET ?region=EU is 200", eu.status === 200, String(eu.status));
  ok("EU body has books.M and books.F", Array.isArray(body.books?.M) && Array.isArray(body.books?.F));
  ok("region path does not build C2/M2V", calls.c2 === 0, String(calls.c2));
  const bad = await fetch(`${base}/api/researcher/liquidity?region=UK`);
  ok("unknown region is 400", bad.status === 400, String(bad.status));
  const c2 = await fetch(`${base}/api/researcher/liquidity?refresh=1`);
  const c2body = await c2.json();
  ok("no region keeps the C2 route", c2.status === 200 && c2body.regimeScore === 1 && calls.c2 === 1, JSON.stringify(c2body));
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
