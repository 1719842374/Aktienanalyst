/**
 * #180 Wächter-Ausnahme, zeilengenau (Freigabe Philip 09.11.2026 21:59 Europe/Madrid: „die 4 Briefing-Hunks von #180
 * in researcher.ts zeilengenau wie bei #326 freigeben“). server/researcher.ts gilt nur dann als „unberührt“, wenn
 * der git diff -U0 gegen die Wächter-Basis (inkl. Arbeitskopie) EXAKT die Hunks aus script/fixtures/approved-180-lines.json
 * ergibt: gleiche Hunks, gleiche Reihenfolge, gleiche Zeilen, gleiche Anzahl. Freigegeben sind nur die 4 Briefing-Hunks
 * (:34 Import briefingCardForChange, :927–940 topChanges-Typ, :1157–1165 inputs-Map, :1236–1261 briefingCardForChange);
 * jede weitere oder abweichende Änderung (z. B. am Score) schlägt weiter an. Alle anderen gesperrten Dateien bleiben gesperrt.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const APPROVED: Record<string, string[][]> = JSON.parse(readFileSync("script/fixtures/approved-180-lines.json", "utf8")).files;

/** Geänderte Zeilen je -U0-Hunk (fester Diff-Algorithmus, damit die Hunk-Grenzen reproduzierbar sind). */
export function changedHunks180(base: string, file: string): string[][] {
  const out = execFileSync("git", ["diff", "--no-color", "--no-ext-diff", "--diff-algorithm=myers", "--indent-heuristic", "-U0", base, "--", file], { encoding: "utf8" });
  const hunks: string[][] = [];
  for (const l of out.split("\n")) {
    if (l.startsWith("@@")) hunks.push([]);
    else if (hunks.length && /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)) hunks[hunks.length - 1].push(l);
  }
  return hunks;
}

/** true = Datei weicht gar nicht oder exakt um die freigegebenen #180-Hunks von der Basis ab. */
export function onlyApproved180(base: string, file: string, hunks = changedHunks180(base, file)): boolean {
  if (hunks.length === 0) return true;
  const ok = APPROVED[file];
  return !!ok && JSON.stringify(hunks) === JSON.stringify(ok);
}

/** Gesperrte Dateien ohne die, die nur die freigegebenen #180-Hunks tragen. */
export function withoutApproved180(base: string, files: string[]): string[] {
  return files.filter(f => !(f in APPROVED && onlyApproved180(base, f)));
}
