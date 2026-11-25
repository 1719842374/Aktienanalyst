/**
 * Draft DCF-Bilanz-Kalibrierung: shared/bias-fixes.ts und shared/schema.ts gelten nur dann als
 * freigegeben, wenn jede Diff-Zeile gegen die Wächter-Basis exakt in
 * script/fixtures/approved-dcf-calibration-lines.json oder in der älteren #326-Liste steht.
 * Die Schema-Liste enthält nur die 15 Zeilen des Felds calibration?.
 * Der Score-Pin MSFT 5.638130012567666 bleibt zusätzlich die Abnahme.
 * Jede weitere Zeile schlägt weiter an.
 *
 * Aufruf:
 *   npx tsx script/guard-approved-dcf-calibration.ts            → Exit 0, wenn der Ist-Diff in der Whitelist liegt
 *   npx tsx script/guard-approved-dcf-calibration.ts --negativ  → Exit 1, fremde Schema-Zeile "+}" ist nicht freigegeben
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

/** Dieselbe Freigabe wie onlyApproved, auf explizite Diff-Zeilen. */
export function calibrationGuardAllows(file: string, lines: string[]): boolean {
  if (!(file in APPROVED)) return false;
  const ours = new Set(APPROVED[file] ?? []);
  const prior = new Set(PRIOR[file] ?? []);
  return lines.every(l => ours.has(l) || prior.has(l));
}

function onlyApproved(base: string, file: string): boolean {
  return calibrationGuardAllows(file, changedLines(base, file));
}

function runCli(): void {
  const negativ = process.argv.includes("--negativ");
  if (negativ) {
    const foreign = "+}";
    const schema = APPROVED["shared/schema.ts"] ?? [];
    const allowed = schema.includes(foreign) || calibrationGuardAllows("shared/schema.ts", [foreign]);
    if (allowed) {
      console.error("Guard hat die fremde Schema-Zeile +} freigegeben");
      process.exit(0);
    }
    console.error("Guard rot: +} liegt außerhalb des calibration-Blocks und ist nicht freigegeben");
    process.exit(1);
  }
  const schema = APPROVED["shared/schema.ts"] ?? [];
  const bias = APPROVED["shared/bias-fixes.ts"] ?? [];
  if (schema.length !== 15 || bias.length !== 43) {
    console.error(`Whitelist schema ${schema.length} bias ${bias.length}`);
    process.exit(1);
  }
  if (!schema.some(l => l.includes("calibration?:")) || schema.includes("+}") || schema.some(l => /dividendYield|betaLive|CreditStance|GoldMiner|earnings-yield/.test(l))) {
    console.error("Schema-Whitelist ist nicht auf calibration? begrenzt");
    process.exit(1);
  }
  const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
  for (const file of ["shared/schema.ts", "shared/bias-fixes.ts"]) {
    const lines = changedLines(base, file);
    if (!calibrationGuardAllows(file, lines)) {
      const ours = new Set(APPROVED[file] ?? []);
      console.error(file, lines.filter(l => !ours.has(l)));
      process.exit(1);
    }
  }
  console.log(`Guard positiv: schema ${schema.length}, bias-fixes ${bias.length}, Basis ${base.slice(0, 8)}`);
  process.exit(0);
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("guard-approved-dcf-calibration.ts") || import.meta.url === pathToFileURL(invoked).href) {
  runCli();
}

/** Gesperrte Dateien ohne die, die nur die freigegebenen Kalibrierungszeilen tragen. */
export function withoutApprovedDcfCalibration(base: string, files: string[]): string[] {
  return files.filter(f => !(f in APPROVED && onlyApproved(base, f)));
}
