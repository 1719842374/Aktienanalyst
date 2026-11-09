/**
 * PR 461 only. Not a #326 approval and not a file-wide unlock of recession.ts.
 * The exception holds only while the guard base is exactly the reviewed baseline
 * and the candidate diff of server/recession.ts is byte-for-byte the diff of
 * da608133d2ae16cadc6c0c7d6b464dff4bddd8df against that baseline, including
 * hunk order, line frequency, position, and context. After that baseline is
 * no longer the merge base, the exception does not apply.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const DOC = JSON.parse(readFileSync("script/fixtures/approved-461-last-good-diff.json", "utf8")) as {
  baseline: string;
  reviewedHead: string;
  file: string;
  diff: string;
};

export const APPROVED_461_BASE = "01bf608981b842f5457695c92b5800a59cfec94f";
export const APPROVED_461_REVIEWED = "da608133d2ae16cadc6c0c7d6b464dff4bddd8df";
export const APPROVED_461_FILE = "server/recession.ts";

const DIFF_ARGS = ["--no-color", "--no-ext-diff", "--full-index", "--unified=3", "--src-prefix=a/", "--dst-prefix=b/"];

/** Diff of the reviewed commit. reviewedHead is an input of this command, not a label. */
export function reviewedRecessionDiff(): string {
  return execFileSync(
    "git",
    ["diff", ...DIFF_ARGS, APPROVED_461_BASE, APPROVED_461_REVIEWED, "--", APPROVED_461_FILE],
    { encoding: "utf8" },
  );
}

function boundToReviewedCommit(expected: string): boolean {
  return DOC.baseline === APPROVED_461_BASE
    && DOC.reviewedHead === APPROVED_461_REVIEWED
    && DOC.file === APPROVED_461_FILE
    && DOC.diff === expected
    && expected.length > 0;
}

/** True only for the exact reviewed diff of server/recession.ts against the pinned baseline. */
export function onlyApproved461(base: string, file: string, diffText?: string): boolean {
  if (base !== APPROVED_461_BASE || file !== APPROVED_461_FILE) return false;
  const expected = reviewedRecessionDiff();
  if (!boundToReviewedCommit(expected)) return false;
  const got = diffText ?? execFileSync("git", ["diff", ...DIFF_ARGS, base, "--", file], { encoding: "utf8" });
  return got === expected;
}

/** Drops recession.ts from a blocked list only when onlyApproved461 matches. Other files stay. */
export function exemptApproved461(base: string, files: string[]): string[] {
  return files.filter(file => !onlyApproved461(base, file));
}
