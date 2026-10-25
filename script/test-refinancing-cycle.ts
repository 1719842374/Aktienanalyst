/**
 * F1-26 — Verschuldungs-/Refinanzierungsblock in Sektion 5. Nur Anzeige.
 * Run: npx tsx script/test-refinancing-cycle.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let failed = 0;
let total = 0;
function check(name: string, ok: boolean, detail = "") {
  total++;
  if (ok) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const modPath = "shared/refinancing-cycle.ts";
check("shared/refinancing-cycle.ts exists", existsSync(modPath));
if (!existsSync(modPath)) {
  console.log(`\n${total - failed}/${total} passed`);
  process.exit(1);
}
const { refinancingRows, latestTreasury } = await import("../shared/refinancing-cycle");

console.log("\n=== MSFT fixture (real analyze payload, script/fixtures/analysis-MSFT.json) ===");
const msft = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const rows = refinancingRows(msft, { value: 4.02, date: "2026-10-22" });
const by = (k: string) => rows.find((r: any) => r.key === k)!;
for (const r of rows) console.log(`    ${r.label}: ${r.value} — ${r.note}`);
check("six rows in fixed order", rows.map((r: any) => r.key).join() === "netDebt,netDebtEbitda,debtToEquity,treasury10y,maturities,interestCoverage");
check("net debt = balanceSheet.netDebt 107.9 Mrd.", by("netDebt").value === "107.9 Mrd.", by("netDebt").value);
check("Net Debt/EBITDA uses FS EBITDA 207.5 Mrd. (top-level ebitda is null)", by("netDebtEbitda").value === "0.52x", by("netDebtEbitda").value);
check("D/E 0.29", by("debtToEquity").value === "0.29");
check("10Y shown with date", by("treasury10y").value === "4.02%" && by("treasury10y").note.includes("2026-10-22"));
check("maturities n/a with reason", by("maturities").value === "n/a" && /Fälligkeitsprofil/.test(by("maturities").note));
check("interest coverage n/a with reason", by("interestCoverage").value === "n/a" && by("interestCoverage").note.startsWith("n/a:"));

console.log("\n=== Missing data stays n/a, nothing substituted ===");
const empty = refinancingRows({ totalDebt: 100, cashEquivalents: null as any, ebitda: null, financialStatements: { incomeStatement: { ebitda: 0 } } }, null);
check("net debt n/a without cash", empty[0].value === "n/a" && empty[0].note.startsWith("n/a:"));
check("EBITDA 0 → n/a", empty[1].value === "n/a" && /EBITDA/.test(empty[1].note));
check("no treasury → n/a", empty[3].value === "n/a" && /DGS10/.test(empty[3].note));
check("every n/a row carries a reason", [...rows, ...empty].every((r: any) => r.available || r.note.startsWith("n/a:")));
check("latestTreasury takes last point", latestTreasury([{ date: "a", value: 1 }, { date: "b", value: 2 }])?.value === 2 && latestTreasury([]) === null);
check("input not mutated", JSON.stringify(msft) === readFileSync("script/fixtures/analysis-MSFT.json", "utf8").trim() || msft.financialStatements.balanceSheet.netDebt === 107873300000);

console.log("\n=== Display only: no score / rating / analyze path reads it ===");
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(dir, e.name))) : [join(dir, e.name)]);
}
const importers = [...walk("server"), ...walk("shared"), ...walk("client/src")]
  .filter(f => /\.(ts|tsx)$/.test(f) && readFileSync(f, "utf8").includes("refinancing-cycle"))
  .filter(f => f !== modPath);
check("only Section3.tsx imports refinancing-cycle", importers.join() === "client/src/components/sections/Section3.tsx", importers.join());
const ui = readFileSync("client/src/components/sections/Section3.tsx", "utf8");
check("Section 5 renders the block", /data-testid="refinancing-cycle"/.test(ui) && /refinancing\.map/.test(ui));
check("block labelled as display only", /Fließt nicht in Score, Rating oder CRV ein/.test(ui));

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
