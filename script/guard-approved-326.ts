/**
 * #326 Wächter-Ausnahme, zeilengenau: server/analyze-route.ts und shared/schema.ts gelten nur dann als
 * „unberührt“, wenn JEDE geänderte Zeile (git diff -U0 gegen die Wächter-Basis, inkl. Arbeitskopie) exakt in
 * script/fixtures/approved-326-lines.json steht. Jede weitere Änderung (z. B. am Score) schlägt weiter an.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const APPROVED: Record<string, string[]> = JSON.parse(readFileSync("script/fixtures/approved-326-lines.json", "utf8")).files;

export function changedLines(base: string, file: string): string[] {
  const out = execFileSync("git", ["diff", "-U0", base, "--", file], { encoding: "utf8" });
  return out.split("\n").filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
}

/** true = Datei weicht nur um freigegebene #326-Zeilen von der Basis ab (oder gar nicht). */
export function onlyApproved326(base: string, file: string, lines = changedLines(base, file)): boolean {
  const ok = APPROVED[file];
  if (!ok) return lines.length === 0;
  const set = new Set(ok);
  return lines.every(l => set.has(l));
}

/** Gesperrte Dateien ohne die, die nur freigegebene #326-Zeilen tragen. */
export function withoutApproved326(base: string, files: string[]): string[] {
  return files.filter(f => !(f in APPROVED && onlyApproved326(base, f)));
}
