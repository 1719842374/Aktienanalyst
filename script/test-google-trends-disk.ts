/**
 * F5-08: the Trends print survives a process restart on the local disk.
 * Redis stays unwired (braucht Philip). No new env var.
 * Run: npx tsx script/test-google-trends-disk.ts
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  GOOGLE_TRENDS_DISK_NAME,
  forgetGoogleTrendsMemoryForTests,
  readGoogleTrendsCache,
  resetGoogleTrendsCache,
  setGoogleTrendsDiskDirForTests,
  writeGoogleTrendsCache,
} from "../server/cache/google-trends-cache";

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

const dir = mkdtempSync(path.join(tmpdir(), "trends-disk-"));
setGoogleTrendsDiskDirForTests(dir);
resetGoogleTrendsCache();

console.log("\n=== local file, no Redis ===");
{
  const file = path.join(dir, GOOGLE_TRENDS_DISK_NAME);
  writeGoogleTrendsCache({
    value: 59.1,
    timestamp: Date.parse("2026-11-02T12:00:00.000Z"),
    source: "Google Trends via SerpApi (7d Ø=59.1, Latest=53, Peak=100)",
    points: [{ date: "2026-11-02", value: 53 }],
  });
  check("the file is the named local cache", readFileSync(file, "utf8").includes("59.1"), file);
  forgetGoogleTrendsMemoryForTests();
  const restored = readGoogleTrendsCache();
  check("a restart reads the same print back", restored?.value === 59.1 && restored.source.includes("SerpApi") && restored.points?.[0]?.value === 53, JSON.stringify(restored));
  resetGoogleTrendsCache();
  check("reset removes the local file", readGoogleTrendsCache() === null);

  writeFileSync(file, "{not json", "utf8");
  forgetGoogleTrendsMemoryForTests();
  check("a broken file is a miss, not a made-up number", readGoogleTrendsCache() === null);
  writeFileSync(file, JSON.stringify({ value: "nope", timestamp: 1, source: "x" }), "utf8");
  forgetGoogleTrendsMemoryForTests();
  check("a file without a finite print is a miss", readGoogleTrendsCache() === null);

  const src = readFileSync(new URL("../server/cache/google-trends-cache.ts", import.meta.url), "utf8");
  check("Redis is not wired; the note says braucht Philip", !src.includes("ioredis") && !src.includes("REDIS_URL") && src.includes("braucht Philip"));
}

setGoogleTrendsDiskDirForTests(null);
resetGoogleTrendsCache();

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
