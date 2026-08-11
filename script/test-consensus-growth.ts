import { deriveConsensusGrowth } from "../server/routes";
import { scoreGrowthCoverage } from "../server/thesis-strength";

let failed = 0, total = 0;
const check = (name: string, condition: boolean, details = "") => {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name} ${details}`); }
};

console.log("\n=== Consensus-Growth aus FMP ===");

const risingEstimates = [
  { date: "2028-06-30", epsAvg: 14.4, numAnalystsEps: 12 },
  { date: "2026-06-30", epsAvg: 10, numAnalystsEps: 12 },
  { date: "2027-06-30", epsAvg: 12, numAnalystsEps: 12 },
];
const positiveCagr = deriveConsensusGrowth(risingEstimates);
check("Drei belastbare steigende EPS-Schaetzungen liefern positiven CAGR", positiveCagr != null && positiveCagr > 0 && positiveCagr < 60, String(positiveCagr));

check(
  "Nur ein belastbar abgedecktes Fiskaljahr liefert null",
  deriveConsensusGrowth([
    { date: "2026-06-30", epsAvg: 10, numAnalystsEps: 4 },
    { date: "2027-06-30", epsAvg: 12, numAnalystsEps: 2 },
  ]) === null,
);
check(
  "Unter drei Analysten in allen Jahren liefert null",
  deriveConsensusGrowth([
    { date: "2026-06-30", epsAvg: 10, numAnalystsEps: 2 },
    { date: "2027-06-30", epsAvg: 12, numAnalystsEps: 1 },
  ]) === null,
);
check(
  "Extremer EPS-CAGR wird bei 60 Prozent gedeckelt",
  deriveConsensusGrowth([
    { date: "2026-06-30", epsAvg: 1, numAnalystsEps: 5 },
    { date: "2027-06-30", epsAvg: 10, numAnalystsEps: 5 },
    { date: "2028-06-30", epsAvg: 100, numAnalystsEps: 5 },
  ]) === 60,
);

const existingMaximum = scoreGrowthCoverage({ fcf: 1, gStar: 15, thesisGrowth: 20, sectorGrowthMedian: 12 });
const lowerConsensus = scoreGrowthCoverage({ fcf: 1, gStar: 15, thesisGrowth: 20, consensusGrowth: 14, sectorGrowthMedian: 12 });
const higherConsensus = scoreGrowthCoverage({ fcf: 1, gStar: 15, thesisGrowth: 20, consensusGrowth: 18, sectorGrowthMedian: 12 });
check(
  "Niedrigerer Consensus veraendert das bestehende Maximum nicht",
  lowerConsensus.gRequired === existingMaximum.gRequired && lowerConsensus.gRequired === 15,
  JSON.stringify(lowerConsensus.gRequiredBreakdown),
);
check(
  "Hoeherer Consensus wird als neues g_required-Maximum verwendet",
  higherConsensus.gRequired === 18 && higherConsensus.gRequiredBreakdown.usedSource === "Konsenswachstum",
  JSON.stringify(higherConsensus.gRequiredBreakdown),
);

console.log(`\n${total - failed}/${total} passed`);
if (failed) process.exit(1);
