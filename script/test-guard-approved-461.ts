/**
 * PR 461 guard: exact Last-Good hunk of server/recession.ts against
 * 01bf608981b842f5457695c92b5800a59cfec94f. Not a #326 approval.
 * Run: npx tsx script/test-guard-approved-461.ts
 */
import { readFileSync } from "node:fs";
import { onlyApproved326, withoutApproved326 } from "./guard-approved-326";
import { APPROVED_461_BASE, APPROVED_461_FILE, exemptApproved461, onlyApproved461 } from "./guard-approved-461";

let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const doc = JSON.parse(readFileSync("script/fixtures/approved-461-last-good-lines.json", "utf8")) as { lines: string[] };
const exact = doc.lines;
const extra = [...exact, "+    const notApproved = true;"];
const swapped = exact.map((line, i) => (i === 0 ? line + " " : line));

console.log("\n=== positive: reviewed hunk against the pinned baseline ===");
check("fixture baseline is 01bf6089", APPROVED_461_BASE === "01bf608981b842f5457695c92b5800a59cfec94f");
check("fixture file is only recession.ts", APPROVED_461_FILE === "server/recession.ts");
check("exact lines are approved", onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, exact));
check("live diff of recession.ts matches the fixture", onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE));

console.log("\n=== negative: any other line, base, or file stays closed ===");
check("an extra recession.ts line is refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, extra));
check("a changed hunk line is refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, swapped));
check("a shorter hunk is refused", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, exact.slice(0, -1)));
check("another baseline does not carry the exception", !onlyApproved461("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", APPROVED_461_FILE, exact));
check("analyze-route.ts is not covered", !onlyApproved461(APPROVED_461_BASE, "server/analyze-route.ts", exact));
check("an empty diff is not an approval", !onlyApproved461(APPROVED_461_BASE, APPROVED_461_FILE, []));

console.log("\n=== #326 guard is unchanged ===");
const listed = ["server/recession.ts", "server/analyze-route.ts", "server/researcher.ts"];
const blocked326 = withoutApproved326(APPROVED_461_BASE, listed);
check("326 still blocks recession.ts", blocked326.includes("server/recession.ts"));
check("326 does not treat recession.ts as an approved file", !onlyApproved326(APPROVED_461_BASE, "server/recession.ts"));
const after461 = exemptApproved461(APPROVED_461_BASE, blocked326);
check("461 drops only the exact recession.ts hunk", !after461.includes("server/recession.ts") && after461.includes("server/researcher.ts"));
check("wrong baseline leaves recession.ts blocked", exemptApproved461("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", blocked326).includes("server/recession.ts"));

console.log(failed === 0 ? "\nguard-461 green" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
