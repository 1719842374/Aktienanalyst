/**
 * PR 461 only. Not a #326 approval and not a file-wide unlock of recession.ts.
 * The exception holds only while the guard base is exactly the reviewed baseline
 * and the changed lines are exactly the reviewed Last-Good hunk. After that
 * baseline is no longer the merge base, the exception does not apply.
 */
import { readFileSync } from "node:fs";
import { changedLines } from "./guard-approved-326";

const DOC = JSON.parse(readFileSync("script/fixtures/approved-461-last-good-lines.json", "utf8")) as {
  baseline: string;
  file: string;
  lines: string[];
};

export const APPROVED_461_BASE = DOC.baseline;
export const APPROVED_461_FILE = DOC.file;
const APPROVED = DOC.lines;

/** True only for the exact reviewed hunk of server/recession.ts against the pinned baseline. */
export function onlyApproved461(base: string, file: string, lines?: string[]): boolean {
  if (base !== APPROVED_461_BASE || file !== APPROVED_461_FILE) return false;
  const got = lines ?? changedLines(base, file);
  if (got.length !== APPROVED.length) return false;
  const allowed = new Set(APPROVED);
  return got.every(line => allowed.has(line));
}

/** Drops recession.ts from a blocked list only when onlyApproved461 matches. Other files stay. */
export function exemptApproved461(base: string, files: string[]): string[] {
  return files.filter(file => !onlyApproved461(base, file));
}
