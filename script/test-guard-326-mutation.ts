/**
 * #326 Mutationstest: bricht den Fix bzw. ändert den Score-Pfad und erwartet, dass die Wächter wieder anschlagen.
 * M1: dcfFairValue wieder mit 0 initialisiert (Fix kaputt) → test-dcf-negative-fcf-na + alle drei Wächter Exit ≠ 0.
 * M2: zusätzliche, nicht freigegebene Zeile in analyze-route.ts → alle drei Wächter Exit ≠ 0.
 * Arbeitet auf der Arbeitskopie und stellt server/analyze-route.ts danach immer wieder her.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-guard-326-mutation.ts
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { onlyApproved326 } from "./guard-approved-326";

const F = "server/analyze-route.ts";
const orig = readFileSync(F, "utf8");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); };
const run = (t: string) => spawnSync("npx", ["tsx", "--tsconfig", path.resolve("script/tsconfig.jsx.json"), path.resolve(`script/${t}.ts`)],
  { cwd: t.startsWith("test-dcf") ? mkdtempSync(path.join(tmpdir(), "m326-")) : process.cwd(), encoding: "utf8", timeout: 600_000 }).status;
const GUARDS = ["test-buffett-f171-benchmarks", "test-buffett-robust", "test-vix-fred-retry-source"];

ok("Selbsttest: fremde Zeile ist nicht freigegeben", !onlyApproved326("HEAD", F, ["+      score += 1;"]));
ok("Selbsttest: freigegebene Zeile allein ist ok", onlyApproved326("HEAD", F, ["-      let dcfFairValue = 0;"]));
try {
  const fixed = "      let dcfFairValue: number | null = null;\n";
  if (!orig.includes(fixed)) throw new Error("Fix-Zeile nicht gefunden");
  writeFileSync(F, orig.replace(fixed, "      let dcfFairValue: number | null = 0;\n"));
  console.log("M1: dcfFairValue = 0 (Fix kaputt)");
  ok("M1 test-dcf-negative-fcf-na schlägt an", run("test-dcf-negative-fcf-na") !== 0);
  for (const g of GUARDS) ok(`M1 ${g} schlägt an`, run(g) !== 0);
  writeFileSync(F, orig.replace(fixed, fixed + "      const mutation326 = 1; void mutation326;\n"));
  console.log("M2: nicht freigegebene Zeile");
  for (const g of GUARDS) ok(`M2 ${g} schlägt an`, run(g) !== 0);
} finally {
  writeFileSync(F, orig);
}
ok("analyze-route.ts wiederhergestellt", readFileSync(F, "utf8") === orig);
for (const g of GUARDS) ok(`ohne Mutation ${g} grün`, run(g) === 0);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
