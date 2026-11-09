/**
 * #180 Mutationstest: ändert gesperrte Dateien und erwartet, dass die Wächter (test-buffett-robust,
 * test-vix-fred-retry-source Score-Pfad-Check) wieder anschlagen; ohne Mutation sind die #180-Hunks freigegeben.
 * M1: Score-Zeile in server/researcher.ts außerhalb der 4 Hunks (growthScore-Clamp) → rot.
 * M2: abweichender Text innerhalb eines freigegebenen Hunks (severity-Fallback) → rot.
 * M3: freigegebene Zeile doppelt (gleiche Zeilen-Menge, andere Anzahl) → rot.
 * M4: andere gesperrte Datei (shared/bias-fixes.ts) → rot.
 * Arbeitet auf der Arbeitskopie und stellt die Dateien danach immer wieder her.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-guard-180-mutation.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync, execFileSync } from "node:child_process";
import path from "node:path";
import { onlyApproved180, changedHunks180 } from "./guard-approved-180";

const R = "server/researcher.ts", B = "shared/bias-fixes.ts";
const origR = readFileSync(R, "utf8"), origB = readFileSync(B, "utf8");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); };
const run = (t: string) => spawnSync("npx", ["tsx", "--tsconfig", path.resolve("script/tsconfig.jsx.json"), path.resolve(`script/${t}.ts`)], { encoding: "utf8", timeout: 600_000 });
const buffettRed = () => run("test-buffett-robust").status !== 0;
const vixGuardRed = () => /✗ Score-Pfad unberührt/.test(run("test-vix-fred-retry-source").stdout ?? "");
const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
const replaceOnce = (src: string, a: string, b: string) => { if (src.split(a).length !== 2) throw new Error(`nicht eindeutig: ${a}`); return src.replace(a, b); };

ok("Selbsttest: kein Diff ist ok", onlyApproved180(base, R, []));
ok("Selbsttest: fremder Hunk ist nicht freigegeben", !onlyApproved180(base, R, [["+      score += 1;"]]));
ok("Selbsttest: nur ein Teil der freigegebenen Hunks ist nicht exakt", !onlyApproved180(base, R, changedHunks180(base, R).slice(1)));
ok("Selbsttest: aktueller Diff = exakt die freigegebenen Hunks", onlyApproved180(base, R), `${changedHunks180(base, R).length} Hunks`);
try {
  writeFileSync(R, replaceOnce(origR, "      growthScore: Math.max(1, Math.min(10, Number(t.growthScore) || 5)),\n", "      growthScore: Math.max(1, Math.min(10, Number(t.growthScore) || 6)),\n"));
  console.log("M1: researcher.ts außerhalb der 4 Hunks");
  ok("M1 test-buffett-robust schlägt an", buffettRed()); ok("M1 test-vix-fred-retry-source Score-Pfad schlägt an", vixGuardRed());
  writeFileSync(R, replaceOnce(origR, "        severity: card?.severity,\n", "        severity: card?.severity ?? \"high\",\n"));
  console.log("M2: abweichender Text im freigegebenen Hunk :1236–1261");
  ok("M2 test-buffett-robust schlägt an", buffettRed()); ok("M2 test-vix-fred-retry-source Score-Pfad schlägt an", vixGuardRed());
  writeFileSync(R, replaceOnce(origR, "        sourceIndex: c.sourceIndex,\n", "        sourceIndex: c.sourceIndex,\n        sourceIndex: c.sourceIndex,\n"));
  console.log("M3: freigegebene Zeile doppelt");
  ok("M3 test-buffett-robust schlägt an", buffettRed()); ok("M3 test-vix-fred-retry-source Score-Pfad schlägt an", vixGuardRed());
  writeFileSync(R, origR);
  writeFileSync(B, replaceOnce(origB, "export function buildBiasDecision(data: StockAnalysis): BiasFixPayload {\n", "export function buildBiasDecision(data: StockAnalysis): BiasFixPayload {\n  const mutation180 = 1; void mutation180;\n"));
  console.log("M4: andere gesperrte Datei shared/bias-fixes.ts");
  ok("M4 test-buffett-robust schlägt an", buffettRed());
} finally {
  writeFileSync(R, origR); writeFileSync(B, origB);
}
ok("researcher.ts und bias-fixes.ts wiederhergestellt", readFileSync(R, "utf8") === origR && readFileSync(B, "utf8") === origB);
ok("ohne Mutation test-buffett-robust grün", !buffettRed());
ok("ohne Mutation test-vix-fred-retry-source Score-Pfad grün", !vixGuardRed());
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
