/**
 * PR 461 guard: exact Last-Good diff of server/recession.ts from
 * da608133d2ae16cadc6c0c7d6b464dff4bddd8df against
 * 01bf608981b842f5457695c92b5800a59cfec94f. Not a #326 approval.
 * Run: npx tsx script/test-guard-approved-461.ts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { onlyApproved326, withoutApproved326 } from "./guard-approved-326";
import {
  APPROVED_461_BASE,
  APPROVED_461_FILE,
  APPROVED_461_REVIEWED,
  exemptApproved461,
  onlyApproved461,
  reviewedRecessionDiff,
} from "./guard-approved-461";

let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function mutate(label: string, needle: string, replacement: string): string {
  if (!expected.includes(needle)) throw new Error(`${label}: needle missing`);
  const next = expected.replace(needle, replacement);
  if (next === expected) throw new Error(`${label}: mutation did not change the diff`);
  return next;
}

const expected = reviewedRecessionDiff();
const doc = JSON.parse(readFileSync("script/fixtures/approved-461-last-good-diff.json", "utf8")) as {
  baseline: string;
  reviewedHead: string;
  file: string;
  diff: string;
};
const reviewedBlob = execFileSync("git", ["rev-parse", `${APPROVED_461_REVIEWED}:${APPROVED_461_FILE}`], { encoding: "utf8" }).trim();
const baselineBlob = execFileSync("git", ["rev-parse", `${APPROVED_461_BASE}:${APPROVED_461_FILE}`], { encoding: "utf8" }).trim();

console.log("\n=== positive: reviewed diff against the pinned baseline ===");
check("fixture baseline is 01bf6089", APPROVED_461_BASE === "01bf608981b842f5457695c92b5800a59cfec94f" && doc.baseline === APPROVED_461_BASE);
check("fixture file is only recession.ts", APPROVED_461_FILE === "server/recession.ts" && doc.file === APPROVED_461_FILE);
check("reviewedHead da608133 is the diff source", APPROVED_461_REVIEWED === "da608133d2ae16cadc6c0c7d6b464dff4bddd8df" && doc.reviewedHead === APPROVED_461_REVIEWED);
check("fixture diff equals git diff of that commit", doc.diff === expected && expected.includes(reviewedBlob) && expected.includes(baselineBlob));
check("live worktree diff is approved", onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE));
check("the reviewed commit diff text is approved", onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, expected));

console.log("\n=== negative: order, frequency, position, context, other hunks ===");
const reordered = mutate(
  "order",
  "+    const kept = acceptGoogleTrendsFetch(null, cached, now);\n+    if (kept.value != null) {",
  "+    if (kept.value != null) {\n+    const kept = acceptGoogleTrendsFetch(null, cached, now);",
);
const frequency = mutate(
  "frequency",
  "+        ageHours: kept.ageHours ?? 0,\n+        isStale: kept.isStale,\n",
  "+        ageHours: kept.ageHours ?? 0,\n+        ageHours: kept.ageHours ?? 0,\n",
);
const substituted = mutate(
  "substitution",
  "+    const kept = acceptGoogleTrendsFetch(null, cached, now);\n",
  "+    const keptAgain = acceptGoogleTrendsFetch(null, cached, now);\n",
);
const moved = mutate(
  "position",
  "@@ -607,6 +607,14 @@ function scoreGoogleTrends(): IndicatorResult {",
  "@@ -900,6 +900,14 @@ function someOtherFunction(): IndicatorResult {",
);
const otherContext = mutate(
  "context",
  " // Order: fresh cache → SerpApi only when a key is set → pytrends → n/a with a reason.\n",
  " // Order: fresh cache → SerpApi only when a key is set → pytrends → moved context.\n",
);
const extraLine = mutate(
  "extra",
  "+    }\n     writeGoogleTrendsCache({",
  "+    }\n+    const notApproved = true;\n     writeGoogleTrendsCache({",
);
const changedLine = mutate(
  "changed",
  "+        isStale: kept.isStale,\n",
  "+        isStale: kept.isStale, \n",
);
const shorter = mutate(
  "shorter",
  "+        isStale: kept.isStale,\n",
  "",
);
const foreignHunk = `${expected}@@ -1200,0 +1210,1 @@ function elsewhere(): void {\n+    const kept = acceptGoogleTrendsFetch(null, cached, now);\n`;
const commentHunkOnly = expected.slice(0, expected.indexOf("@@ -607,6 +607,14 @@"));

check("reordered lines are refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, reordered));
check("duplicated line with a dropped line is refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, frequency));
check("same-length substitution is refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, substituted));
check("same text at another hunk position is refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, moved));
check("same text in another context is refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, otherContext));
check("an extra line is refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, extraLine));
check("a changed line is refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, changedLine));
check("a shorter hunk is refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, shorter));
check("an additional foreign hunk is refused", foreignHunk !== expected && !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, foreignHunk));
check("a missing hunk is refused", commentHunkOnly !== expected && commentHunkOnly.length > 0 && !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, commentHunkOnly));
check("an empty diff is refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, ""));
check("another baseline does not carry the exception", !onlyApproved461("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", APPROVED_461_FILE, expected));
check("analyze-route.ts is not covered", !onlyApproved461(APPROVED_461_BASE, "server/analyze-route.ts", expected));

console.log("\n=== caller: VIX score-path composition, including a synthetic post-merge base ===");
const listed = ["server/recession.ts", "server/analyze-route.ts", "server/researcher.ts"];
const blocked326 = withoutApproved326(APPROVED_461_BASE, listed);
check("326 still blocks recession.ts", blocked326.includes("server/recession.ts"));
check("326 does not treat recession.ts as an approved file", !onlyApproved326(APPROVED_461_BASE, "server/recession.ts"));
const after461 = exemptApproved461(APPROVED_461_BASE, blocked326);
check("461 drops only the exact recession.ts diff", !after461.includes("server/recession.ts") && after461.includes("server/analyze-route.ts") === false && after461.includes("server/researcher.ts"));

const mergeBase = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
const touched = execFileSync("git", ["diff", "--name-only", mergeBase], { encoding: "utf8" }).split("\n").filter(Boolean);
const blockedLive = exemptApproved461(mergeBase, withoutApproved326(mergeBase, touched));
check("real merge-base is the pinned baseline", mergeBase === APPROVED_461_BASE);
check("real caller drops recession.ts", touched.includes("server/recession.ts") && !blockedLive.includes("server/recession.ts"));

const postMerge = "cccccccccccccccccccccccccccccccccccccccc";
const blockedPost = exemptApproved461(postMerge, withoutApproved326(postMerge, touched));
check("post-merge base keeps recession.ts blocked", blockedPost.includes("server/recession.ts"));
check("approved diff text does not pass on the post-merge base", !onlyApproved461(postMerge, APPROVED_461_FILE, expected));

console.log(failed === 0 ? "\nguard-461 green" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
