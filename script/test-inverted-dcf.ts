/**
 * Unit-Tests fuer invertedDcf() (client/src/lib/calculations.ts).
 *
 * Regressions-Hintergrund: Section8.tsx rief calculateDCF() zuvor mit
 * gleichzeitig erhoehtem WACC (waccAdj = base + damage/10) UND reduziertem
 * Wachstum (growthAdj = base - damage/5) auf - beide aus demselben
 * totalExpectedDamage abgeleitet. Das ist der in WORK_ANTIBIAS_DCF.md §5.4
 * explizit verbotene Doppel-Penalty ("D- mappt EINMAL auf g ODER auf r,
 * nie beides"). invertedDcf() kapselt jetzt genau eine Mapping-Entscheidung.
 *
 * Ausfuehren: npx tsx script/test-inverted-dcf.ts
 */
import { invertedDcf } from "../client/src/lib/calculations";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const baseParams = {
  fcfBase: 1_000_000_000,
  gBase: 8,
  wacc: 9,
  terminalG: 2.5,
  sharesOutstanding: 100_000_000,
  netDebt: 500_000_000,
};

console.log("\ninvertedDcf — D-=0 muss FV_base reproduzieren (§ Checkliste: 'D-=0 -> FV_inv=FV_base')");
{
  const zero = invertedDcf({ ...baseParams, sigmaGbDown: 0, mode: "growth" });
  check("Dminus === 0", zero.Dminus === 0, `Dminus=${zero.Dminus}`);
  check("gAdj === gBase (keine Adjustierung)", zero.gAdj === baseParams.gBase, `gAdj=${zero.gAdj}`);
  check("waccAdj === wacc (keine Adjustierung)", zero.waccAdj === baseParams.wacc, `waccAdj=${zero.waccAdj}`);
}

console.log("\ninvertedDcf — mode='growth': NUR g wird adjustiert, wacc bleibt exakt Base");
{
  const r = invertedDcf({ ...baseParams, sigmaGbDown: -0.20, mode: "growth" });
  check("waccAdj unveraendert", r.waccAdj === baseParams.wacc, `waccAdj=${r.waccAdj} erwartet ${baseParams.wacc}`);
  check("gAdj < gBase (Downside wirkt)", r.gAdj < baseParams.gBase, `gAdj=${r.gAdj}`);
  check("gAdj = gBase*(1-Dminus)", Math.abs(r.gAdj - baseParams.gBase * (1 - 0.20)) < 1e-9, `gAdj=${r.gAdj}`);
}

console.log("\ninvertedDcf — mode='wacc': NUR wacc wird adjustiert, g bleibt exakt Base");
{
  const r = invertedDcf({ ...baseParams, sigmaGbDown: -0.20, mode: "wacc" });
  check("gAdj unveraendert", r.gAdj === baseParams.gBase, `gAdj=${r.gAdj} erwartet ${baseParams.gBase}`);
  check("waccAdj > wacc (Downside wirkt)", r.waccAdj > baseParams.wacc, `waccAdj=${r.waccAdj}`);
}

console.log("\ninvertedDcf — niemals BEIDE gleichzeitig veraendert (Kern-Regression-Guard)");
{
  for (const mode of ["growth", "wacc"] as const) {
    const r = invertedDcf({ ...baseParams, sigmaGbDown: -0.30, mode });
    const gChanged = r.gAdj !== baseParams.gBase;
    const waccChanged = r.waccAdj !== baseParams.wacc;
    check(
      `mode=${mode}: exakt einer von {g, wacc} veraendert, nicht beide`,
      gChanged !== waccChanged,
      `gChanged=${gChanged} waccChanged=${waccChanged}`
    );
  }
}

console.log("\ninvertedDcf — Dminus gedeckelt auf 0.35 (§5.2)");
{
  const r = invertedDcf({ ...baseParams, sigmaGbDown: -0.90, mode: "growth" });
  check("Dminus === 0.35 (Cap greift)", r.Dminus === 0.35, `Dminus=${r.Dminus}`);
}

console.log("\ninvertedDcf — positive sigmaGbDown (kein Downside) -> Dminus=0, wie D-=0-Fall");
{
  const r = invertedDcf({ ...baseParams, sigmaGbDown: 0.15, mode: "growth" });
  check("Dminus === 0 bei positivem sigmaGbDown", r.Dminus === 0, `Dminus=${r.Dminus}`);
}

console.log("\ninvertedDcf — haircut ist unabhaengiger Parameter, nicht aus sigmaGbDown abgeleitet");
{
  const withHaircut = invertedDcf({ ...baseParams, sigmaGbDown: -0.10, mode: "growth", haircut: 5 });
  const withoutHaircut = invertedDcf({ ...baseParams, sigmaGbDown: -0.10, mode: "growth", haircut: 0 });
  check(
    "haircut beeinflusst perShare unabhaengig von Dminus/gAdj/waccAdj",
    withHaircut.perShare < withoutHaircut.perShare &&
      withHaircut.Dminus === withoutHaircut.Dminus &&
      withHaircut.gAdj === withoutHaircut.gAdj,
    `withHaircut=${withHaircut.perShare} withoutHaircut=${withoutHaircut.perShare}`
  );
}

console.log(failed === 0 ? "\n✅ Alle invertedDcf-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
