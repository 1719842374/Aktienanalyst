/**
 * Draft DCF-Bilanz-Kalibrierung: shared/bias-fixes.ts und shared/schema.ts gelten nur dann als
 * freigegeben, wenn jede Diff-Zeile gegen die Wächter-Basis (Squash #274) exakt in
 * script/fixtures/approved-dcf-calibration-lines.json oder in der älteren #326-Liste steht.
 * Die Schema-Liste enthält auch Zeilen, die main seit #274 schon hat und die #326 nicht mehr abdeckt.
 * Sonst schlägt jeder Schema-Edit an, obwohl der Score-Pin unverändert ist.
 * Der Score-Pin MSFT 5.638130012567666 in diesem Test bleibt zusätzlich die Abnahme.
 * Jede weitere Zeile schlägt weiter an.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const APPROVED: Record<string, string[]> = JSON.parse(
  readFileSync("script/fixtures/approved-dcf-calibration-lines.json", "utf8"),
).files;
const PRIOR: Record<string, string[]> = JSON.parse(
  readFileSync("script/fixtures/approved-326-lines.json", "utf8"),
).files;

function changedLines(base: string, file: string): string[] {
  const out = execFileSync("git", ["diff", "-U0", base, "--", file], { encoding: "utf8" });
  return out.split("\n").filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
}

function onlyApproved(base: string, file: string): boolean {
  const ours = new Set(APPROVED[file] ?? []);
  const prior = new Set(PRIOR[file] ?? []);
  return changedLines(base, file).every(l => ours.has(l) || prior.has(l));
}

/** Gesperrte Dateien ohne die, die nur die freigegebenen Kalibrierungszeilen tragen. */
export function withoutApprovedDcfCalibration(base: string, files: string[]): string[] {
  return files.filter(f => !(f in APPROVED && onlyApproved(base, f)));
}
