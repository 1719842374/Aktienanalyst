/**
 * F2-03 / F3-05 / F4-06: without SERPAPI_KEY the order is
 * cache → (no SerpApi) → pytrends → n/a with a reason.
 * A Google 429 is n/a and is not written into the cache.
 * Run: npx tsx script/test-google-trends-no-key.ts
 */
import {
  readGoogleTrendsCache,
  resetGoogleTrendsCache,
  setGoogleTrendsDiskDirForTests,
  writeGoogleTrendsCache,
} from "../server/cache/google-trends-cache";
import { GOOGLE_TRENDS_RATE_LIMIT_NA } from "../server/cache/google-trends-pytrends";
import {
  scoreGoogleTrendsForTests,
  setGoogleTrendsTransportForTests,
  type GoogleTrendsTransport,
} from "../server/recession";

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

const explore = JSON.stringify({
  widgets: [{ id: "TIMESERIES", token: "tok", request: { time: "now 7-d" } }],
});
const multiline = JSON.stringify({
  default: { timelineData: [{ time: "1793491200", value: [40] }, { time: "1793577600", value: [80] }] },
});

const savedKey = process.env.SERPAPI_KEY;
const savedAlt = process.env.SERPAPI_API_KEY;
delete process.env.SERPAPI_KEY;
delete process.env.SERPAPI_API_KEY;
setGoogleTrendsDiskDirForTests(null);

function restore(): void {
  setGoogleTrendsTransportForTests(null);
  resetGoogleTrendsCache();
  if (savedKey === undefined) delete process.env.SERPAPI_KEY;
  else process.env.SERPAPI_KEY = savedKey;
  if (savedAlt === undefined) delete process.env.SERPAPI_API_KEY;
  else process.env.SERPAPI_API_KEY = savedAlt;
}

console.log("\n=== no key: fresh cache, transport stays idle ===");
{
  resetGoogleTrendsCache();
  const calls: string[] = [];
  const transport: GoogleTrendsTransport = url => {
    calls.push(url);
    return { status: 500, body: "" };
  };
  setGoogleTrendsTransportForTests(transport);
  writeGoogleTrendsCache({
    value: 42,
    timestamp: Date.now() - 60 * 60 * 1000,
    source: "Google Trends via pytrends (7d Ø=42, Latest=42, Peak=42)",
  });
  const reading = scoreGoogleTrendsForTests();
  check("the cached 42 is scored", reading.value.startsWith("42") && reading.available !== false && reading.weight === 1.7, reading.value);
  check("SerpApi and pytrends are not called", calls.length === 0, calls.join(" | "));
  resetGoogleTrendsCache();
}

console.log("\n=== no key: pytrends mock fills the slot and is cached ===");
{
  resetGoogleTrendsCache();
  const calls: string[] = [];
  setGoogleTrendsTransportForTests(url => {
    calls.push(url);
    if (url.includes("serpapi.com")) return { status: 200, body: "should-not-run" };
    if (url.includes("/trends/api/explore")) return { status: 200, body: explore };
    if (url.includes("/trends/api/widgetdata/multiline")) return { status: 200, body: multiline };
    return { status: 404, body: "" };
  });
  const reading = scoreGoogleTrendsForTests();
  const stored = readGoogleTrendsCache();
  check("SerpApi is not called", !calls.some(url => url.includes("serpapi.com")), calls.join(" | "));
  check("explore then multiline", calls.length === 2 && calls[0].includes("/trends/api/explore") && calls[1].includes("multiline"), calls.join(" | "));
  check("the 7d average is scored", reading.value.startsWith("60") && reading.source.includes("pytrends") && reading.weight === 1.7, `${reading.value} ${reading.source}`);
  check("the print is cached", stored?.value === 60, JSON.stringify(stored));
  resetGoogleTrendsCache();
}

console.log("\n=== Google 429: reason is cached and the next read returns it ===");
{
  resetGoogleTrendsCache();
  setGoogleTrendsTransportForTests(() => ({ status: 429, body: "Too Many Requests" }));
  const first = scoreGoogleTrendsForTests();
  const stored = readGoogleTrendsCache();
  check("the first result names the 429 and is not scored", first.value === GOOGLE_TRENDS_RATE_LIMIT_NA && first.available === false && first.weight === 0 && first.maxWeighted === 0, first.value);
  check("the cache stores the reason, not a print", stored?.value == null && stored?.naReason === GOOGLE_TRENDS_RATE_LIMIT_NA, JSON.stringify(stored));
  let calls = 0;
  setGoogleTrendsTransportForTests(() => {
    calls += 1;
    return { status: 500, body: "should-not-run" };
  });
  const second = scoreGoogleTrendsForTests();
  check("the second read comes from the cache with the same reason", second.value === GOOGLE_TRENDS_RATE_LIMIT_NA && calls === 0, `${second.value} calls=${calls}`);
  resetGoogleTrendsCache();
}

restore();
console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
