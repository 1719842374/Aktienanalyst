/**
 * Mini-PR 2 — Google Trends last-good cache.
 * Chain: RecessionDashboard → POST /api/analyze-recession → scoreGoogleTrends
 * → server/cache/google-trends-cache.ts → SerpApi. One cache, no new route.
 * Run: npx tsx script/test-google-trends-cache.ts
 */
import { readFileSync } from "node:fs";
import {
  GOOGLE_TRENDS_FRESH_MS,
  GOOGLE_TRENDS_LAST_GOOD_MS,
  GOOGLE_TRENDS_STALE_AFTER_HOURS,
  acceptGoogleTrendsFetch,
  freshGoogleTrends,
  parseSerpApiGoogleTrends,
  readGoogleTrendsCache,
  resetGoogleTrendsCache,
  writeGoogleTrendsCache,
  type GoogleTrendsCacheEntry,
} from "../server/cache/google-trends-cache";
import { googleReading, probabilityFromNet, scoredTotals, vixReading } from "../server/recession";

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-11T12:00:00.000Z");

function entry(ageMs: number, value = 59.1): GoogleTrendsCacheEntry {
  return {
    value,
    timestamp: NOW - ageMs,
    source: "Google Trends via SerpApi (7d Ø=59.1, Latest=53, Peak=100)",
  };
}

console.log("\n=== SerpApi body ===");
{
  const ok = parseSerpApiGoogleTrends(JSON.stringify({
    interest_over_time: {
      timeline_data: [
        { values: [{ extracted_value: 50 }] },
        { values: [{ value: "70" }] },
      ],
    },
  }));
  check("7d average, latest and peak stay on the source string", ok?.value === 60 && ok.latest === 70 && ok.peak === 70 && ok.source.includes("7d Ø=60") && ok.source.includes("Latest=70") && ok.source.includes("Peak=70"), JSON.stringify(ok));
  check("a zero print is a real value", parseSerpApiGoogleTrends(JSON.stringify({
    interest_over_time: { timeline_data: [{ values: [{ extracted_value: 0 }] }] },
  }))?.value === 0);
  check("429 error is a miss", parseSerpApiGoogleTrends(JSON.stringify({ error: "Your account has run out of searches." })) === null);
  check("empty timeline is a miss", parseSerpApiGoogleTrends(JSON.stringify({ interest_over_time: { timeline_data: [] } })) === null);
  check("status Error is a miss", parseSerpApiGoogleTrends(JSON.stringify({
    search_metadata: { status: "Error" },
    interest_over_time: { timeline_data: [{ values: [{ extracted_value: 40 }] }] },
  })) === null);
  check("HTML and an empty body are misses", parseSerpApiGoogleTrends("<html>429</html>") === null && parseSerpApiGoogleTrends("") === null);
  check("broken JSON is a miss", parseSerpApiGoogleTrends("{") === null);
}

console.log("\n=== Fresh 12h, last good 48h, stale after 24h ===");
{
  check("fresh window is 12h", GOOGLE_TRENDS_FRESH_MS === 12 * HOUR);
  check("last good window is 48h", GOOGLE_TRENDS_LAST_GOOD_MS === 48 * HOUR);
  check("stale mark is over 24h", GOOGLE_TRENDS_STALE_AFTER_HOURS === 24);

  const almostFresh = freshGoogleTrends(entry(12 * HOUR - 1), NOW);
  check("11h 59m is served from cache", almostFresh?.value === 59.1 && almostFresh.isStale === false, JSON.stringify(almostFresh));
  check("exactly 12h is not fresh", freshGoogleTrends(entry(12 * HOUR), NOW) === null);

  const kept = acceptGoogleTrendsFetch(null, entry(30 * HOUR), NOW);
  check("a 429 at 30h keeps the print and marks it stale", kept.value === 59.1 && kept.isStale === true && kept.ageHours === 30 && kept.store === null, JSON.stringify(kept));
  const day = acceptGoogleTrendsFetch(null, entry(24 * HOUR), NOW);
  check("exactly 24h is kept and not yet veraltet", day.value === 59.1 && day.ageHours === 24 && day.isStale === false, JSON.stringify(day));
  const edge = acceptGoogleTrendsFetch(null, entry(48 * HOUR), NOW);
  check("exactly 48h is still the last good value", edge.value === 59.1 && edge.store === null, JSON.stringify(edge));
  const gone = acceptGoogleTrendsFetch(null, entry(48 * HOUR + 1), NOW);
  check("older than 48h closes the slot", gone.value === null && gone.ageHours === null && gone.store === null);
  check("a miss with no cache closes the slot", acceptGoogleTrendsFetch(null, null, NOW).value === null);

  const stored = acceptGoogleTrendsFetch({ value: 80, source: "Google Trends via SerpApi (7d Ø=80, Latest=80, Peak=80)" }, entry(20 * HOUR, 10), NOW);
  check("a fresh print replaces the cache at age 0", stored.value === 80 && stored.ageHours === 0 && stored.isStale === false && stored.store?.timestamp === NOW && stored.store.value === 80, JSON.stringify(stored));
}

console.log("\n=== Zones stay; only availability changes P_korr12 ===");
{
  const stale = googleReading(50, "cached", { ageHours: 30, isStale: true });
  const live = googleReading(50);
  check("stale 50 stays zone 0 ×1.7, max 11.9", stale.rawScore === 0 && stale.weight === 1.7 && stale.weightedScore === 0 && stale.maxWeighted === 11.9 && stale.available !== false && stale.isStale === true && stale.ageHours === 30, `raw=${stale.rawScore} w=${stale.weight}`);
  check("the same print without a cache flag scores the same zone", live.rawScore === stale.rawScore && live.weightedScore === stale.weightedScore && live.maxWeighted === stale.maxWeighted && live.ageHours == null);
  check(">75 is still +7", googleReading(80, "x", { ageHours: 30, isStale: true }).rawScore === 7 && googleReading(80).weightedScore === 11.9);
  check("60–75 is still +4", googleReading(60).rawScore === 4);
  check("<30 is still −4", googleReading(20).rawScore === -4 && googleReading(20).weightedScore === -6.8);
  check("no print is still out of net and max", googleReading(null).available === false && googleReading(null).maxWeighted === 0 && googleReading(null).weight === 0);

  const vix = vixReading(31);
  const closed = scoredTotals([vix, googleReading(null)]);
  const neutral = scoredTotals([vix, googleReading(50, "cached", { ageHours: 30, isStale: true })]);
  const panic = scoredTotals([vix, googleReading(80)]);
  const calm = scoredTotals([vix, googleReading(20)]);
  const pClosed = probabilityFromNet(closed.net, closed.max);
  const pNeutral = probabilityFromNet(neutral.net, neutral.max);
  const pPanic = probabilityFromNet(panic.net, panic.max);
  const pCalm = probabilityFromNet(calm.net, calm.max);
  check("dropping the slot leaves VIX 31 at P 95", pClosed === 95 && closed.net === 4 && closed.max === 4, `${closed.net}/${closed.max} → ${pClosed}`);
  check("a stale neutral print adds max 11.9 and moves P to 65", pNeutral === 65 && neutral.net === 4 && neutral.max === 15.9, `${neutral.net}/${neutral.max} → ${pNeutral}`);
  check("a panic print stays at the clamp", pPanic === 95 && panic.max === 15.9, `${panic.net}/${panic.max} → ${pPanic}`);
  check("a low print moves P from 95 to 40", pCalm === 40 && calm.net === -2.8 && calm.max === 15.9, `${calm.net}/${calm.max} → ${pCalm}`);
  check("the stale flag does not change the probability of the same print", probabilityFromNet(neutral.net, neutral.max) === probabilityFromNet(scoredTotals([vix, googleReading(50)]).net, scoredTotals([vix, googleReading(50)]).max));
}

console.log("\n=== One memory layer, wired in front of SerpApi ===");
{
  resetGoogleTrendsCache();
  check("empty cache", readGoogleTrendsCache() === null);
  writeGoogleTrendsCache(entry(HOUR, 42));
  const hit = freshGoogleTrends(readGoogleTrendsCache(), NOW);
  check("the store round-trips one entry", hit?.value === 42 && hit.ageHours === 1, JSON.stringify(hit));
  resetGoogleTrendsCache();
  check("reset drops the only entry", readGoogleTrendsCache() === null);

  const server = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  const scoreFn = server.slice(server.indexOf("function scoreGoogleTrends"), server.indexOf("function scoreCrowdLeg"));
  check("fresh cache is consulted before SerpApi", scoreFn.indexOf("freshGoogleTrends") !== -1 && scoreFn.indexOf("freshGoogleTrends") < scoreFn.indexOf("serpapi.com/search.json"));
  check("the SerpApi call stays on the same route path", scoreFn.includes("serpapi.com/search.json") && scoreFn.includes("engine=google_trends"));
  check("a miss asks the last-good helper", scoreFn.includes("acceptGoogleTrendsFetch"));
  check("no key still closes the slot", scoreFn.includes("SERPAPI_KEY not set"));
  check("scoreGoogleTrends does not open a route or a second store", !scoreFn.includes("app.get") && !scoreFn.includes("app.post") && !scoreFn.includes("redis") && !scoreFn.includes("pytrends") && !scoreFn.includes("diskCache"));
  const routes = server.slice(server.indexOf("export function registerRecessionRoutes"));
  check("the analysis route is still the one POST", routes.includes('app.post("/api/analyze-recession"') && !routes.includes("app.get(\"/api/analyze-recession"));
  check("schema version stays 1", server.includes("export const RECESSION_SCHEMA_VERSION = 1"));

  const cacheSrc = readFileSync(new URL("../server/cache/google-trends-cache.ts", import.meta.url), "utf8");
  check("the cache module is process memory only", !cacheSrc.includes("ioredis") && !cacheSrc.includes("better-sqlite3") && !cacheSrc.includes("diskCache"));

  const note = readFileSync(new URL("../client/src/components/recession/recessionDashboardPartsB2.tsx", import.meta.url), "utf8");
  check("the 61.2 sentence is gone", !note.includes("61.2") && !note.includes("Score auf 0 gesetzt"));
  check("the summary shows the age and the stale mark", note.includes("letzter Wert von vor") && note.includes("(veraltet)") && note.includes("text-google-trends-age"));
  check("a closed slot is described as closed", note.includes("Der Slot bleibt geschlossen"));
  check("the driver block is untouched", note.includes('data-testid="text-recession-drivers"') && note.includes("unauffällig"));

  const table = readFileSync(new URL("../client/src/components/recession/recessionDashboardPartsB1.tsx", import.meta.url), "utf8");
  check("the indicator row shows the age", table.includes("ind.ageHours") && table.includes("(veraltet)"));
  const zones = readFileSync(new URL("../client/src/components/recession/recessionDashboardPartsA2.tsx", import.meta.url), "utf8");
  check("the zone table is untouched", zones.includes('name: "Google Trends \\"Recession\\""') && zones.includes("×1.7") && zones.includes("11.9"));
}

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
