import { scoreContractual } from "../server/thesis-strength";

let failed = 0;
let total = 0;
const check = (name: string, condition: boolean, detail = "") => {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log("\n=== A-Score RPO/Contracted ===");

const highRpoAndContracted = scoreContractual({
  rpoLatest: 120,
  rpoPrevious: 100,
  deferredRevenue: 16,
  totalRevenue: 100,
});
check(
  "Hohes RPO-YoY-Wachstum und hohe Deferred-Revenue-Quote ergeben 0.87",
  Math.abs(highRpoAndContracted.score - .87) < 1e-12,
  JSON.stringify(highRpoAndContracted)
);

const noData = scoreContractual({
  rpoLatest: null,
  rpoPrevious: null,
  deferredRevenue: null,
  totalRevenue: null,
});
check(
  "Ohne Daten bleibt der Nicht-US-Fallback bei 0.375",
  noData.score === .375 && noData.flags.length === 2,
  JSON.stringify(noData)
);

const rpoOnly = scoreContractual({
  rpoLatest: 120,
  rpoPrevious: 100,
  deferredRevenue: null,
  totalRevenue: null,
});
check(
  "RPO ohne Deferred Revenue nutzt den neutralen Contracted-Fallback",
  Math.abs(rpoOnly.score - (.70 * .90 + .30 * .375)) < 1e-12 && rpoOnly.flags.includes("keine Deferred-Revenue-Daten verfügbar"),
  JSON.stringify(rpoOnly)
);

const legacyTrue = scoreContractual(true);
const legacyFalse = scoreContractual(false);
check(
  "Alte Boolean-Signatur bleibt unverändert funktionsfähig",
  legacyTrue.score === .65 && legacyTrue.flags.length === 0 && legacyFalse.score === .375 && legacyFalse.flags.includes("keine RPO/Backlog-Daten verfügbar"),
  JSON.stringify({ legacyTrue, legacyFalse })
);

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
