/**
 * F2-03 / F3-05 / F4-06: unofficial Google Trends interest (pytrends endpoint),
 * only after SerpApi misses. No new key, no paid vendor, no official Alpha API.
 * Run: npx tsx script/test-google-trends-pytrends.ts
 */
import { readFileSync } from "node:fs";
import {
  PYTRENDS_GEO,
  PYTRENDS_KEYWORD,
  PYTRENDS_TIME,
  parsePytrendsExplore,
  parsePytrendsMultiline,
  pytrendsExploreUrl,
  readPytrendsRecession,
} from "../server/cache/google-trends-pytrends";

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
  widgets: [
    { id: "GEO_MAP", token: "map", request: { geo: "US" } },
    {
      id: "TIMESERIES",
      token: "tok en",
      request: { time: "now 7-d", keyword: "Recession" },
    },
  ],
});

const multiline = `)]}',\n${JSON.stringify({
  default: {
    timelineData: [
      { time: "1793491200", formattedTime: "Nov 1, 2026", value: [50] },
      { time: "1793577600", formattedTime: "Nov 2, 2026", value: [70] },
    ],
  },
})}`;

console.log("\n=== pytrends bodies ===");
{
  const widget = parsePytrendsExplore(`)]}',\n${explore}`);
  check("explore drops the XSSI prefix and keeps the TIMESERIES widget", widget?.token === "tok en" && (widget?.request as { keyword?: string })?.keyword === "Recession", JSON.stringify(widget));
  check("HTML and an empty explore are misses", parsePytrendsExplore("<html>429</html>") === null && parsePytrendsExplore("") === null);
  check("a widget list without TIMESERIES is a miss", parsePytrendsExplore(JSON.stringify({ widgets: [{ id: "GEO_MAP", token: "x", request: {} }] })) === null);

  const parsed = parsePytrendsMultiline(multiline);
  check("7d average, latest and peak", parsed?.value === 60 && parsed.latest === 70 && parsed.peak === 70, JSON.stringify(parsed));
  check("source names pytrends, not SerpApi", parsed?.source.includes("pytrends") === true && parsed.source.includes("7d Ø=60") && !parsed.source.includes("SerpApi"), parsed?.source);
  check("daily points keep the unix date", parsed?.points?.[0]?.date === "2026-11-01" && parsed.points[1]?.value === 70, JSON.stringify(parsed?.points));
  check("a zero print is a real value", parsePytrendsMultiline(JSON.stringify({ default: { timelineData: [{ time: "1793491200", value: [0] }] } }))?.value === 0);
  check("an empty timeline is a miss", parsePytrendsMultiline(JSON.stringify({ default: { timelineData: [] } })) === null);
  check("broken JSON is a miss", parsePytrendsMultiline("{") === null);
}

console.log("\n=== one explore, then one multiline, then stop ===");
{
  const calls: string[] = [];
  const hit = readPytrendsRecession(url => {
    calls.push(url);
    if (url.includes("/trends/api/explore")) return `)]}',\n${explore}`;
    if (url.includes("/trends/api/widgetdata/multiline")) return multiline;
    return "";
  });
  check("keyword, geo and 7d window are on the explore URL", pytrendsExploreUrl().includes(encodeURIComponent(PYTRENDS_KEYWORD)) && pytrendsExploreUrl().includes(PYTRENDS_GEO) && pytrendsExploreUrl().includes(encodeURIComponent(PYTRENDS_TIME)));
  check("a hit asks explore then multiline", calls.length === 2 && calls[0].includes("/trends/api/explore") && calls[1].includes("/trends/api/widgetdata/multiline") && calls[1].includes("token="), calls.join(" | "));
  check("the hit is the 7d average", hit?.value === 60 && hit.ageHours === 0, JSON.stringify(hit));
  const missed = readPytrendsRecession(() => "<html>consent</html>");
  check("a consent wall is n/a and does not invent a number", missed === null);
}

console.log("\n=== wiring: after SerpApi, no official API, no Redis ===");
{
  const server = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  const scoreFn = server.slice(server.indexOf("function scoreGoogleTrends"), server.indexOf("function scoreCrowdLeg"));
  const serp = scoreFn.indexOf("serpapi.com/search.json");
  const py = scoreFn.indexOf("readPytrendsOutcome");
  const accept = scoreFn.indexOf("acceptGoogleTrendsFetch");
  check("pytrends is only reached after the SerpApi call and before last-good", serp !== -1 && py > serp && accept > py, `${serp} ${py} ${accept}`);
  const fresh = scoreFn.indexOf("freshGoogleTrends");
  check("a missing key still reaches the cache before pytrends", fresh !== -1 && fresh < py && !scoreFn.slice(0, fresh).includes("return googleReading(null)"));
  check("the official Trends API and Redis are not in this function", !scoreFn.includes("trends.googleapis.com") && !scoreFn.includes("REDIS_URL") && !scoreFn.includes("ioredis"));
  const pySrc = readFileSync(new URL("../server/cache/google-trends-pytrends.ts", import.meta.url), "utf8");
  check("the module states that the official Alpha API braucht Philip", pySrc.includes("braucht Philip"));
}

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
