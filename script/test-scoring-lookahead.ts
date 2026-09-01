/**
 * WORK_SCORING_VORLAGE.md Kap. 17–18 — Lookahead + Fiscal-Ausnahme.
 * Pipeline nicht neu gebaut. Nur die Ampel-Lücke: AI false, NATO 65→75, PP hart.
 * npx tsx script/test-scoring-lookahead.ts
 */
import {
  fiscalMegatrendQualifies, softenDcfRealityGate, runScoringPipeline, GATE_CAPS,
} from "../server/scoring-gates";
import type { Catalyst } from "../shared/schema";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok ${name}`);
  else { failed++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function mkFiscal(over: Partial<Catalyst> = {}): Catalyst {
  return {
    name: "NATO-2%-Sondervermögen",
    timeline: "2025-2028",
    pos: 70, bruttoUpside: 20, einpreisungsgrad: 30, nettoUpside: 14, gb: 9.8,
    type: "fiscal", confidence: "high", probability: 0.7,
    source: { url: "https://bundeshaushalt.de/programm", publishedAt: "2023-06-01", snippet: "beschlossen" },
    epsImpact: 1.2, startYear: 2025, endYear: 2028,
    ...over,
  };
}

const asOf = "2024-06-30";
const gateInputsWeak = {
  impliedGrowthPercent: 18,
  realizedGrowth8QPercent: 2,
  marginDeltaYoYPp: 0,
  relativeGrowthDeltaYoYPp: 0,
  inventoryDaysDeltaYoYPct: null,
};

console.log("\n18: AI-/Cloud-Capex qualifies === false");
{
  const ai = mkFiscal({
    name: "Hyperscaler AI-Capex",
    type: "ai-capex",
    source: { url: "https://example.com/ai", publishedAt: "2023-01-01", snippet: "capex" },
  });
  const q = fiscalMegatrendQualifies([ai], asOf);
  check("AI qualifies=false", q.qualifies === false);
  const pipe = runScoringPipeline({
    qualityScore: 80, trendMultiplier: 1, catalysts: [ai], asOfDate: asOf,
    price: 100, gateInputs: gateInputsWeak,
  });
  const dcf = pipe.gatesBeforeFiscal.find(g => g.id === "DCF_REALITY_CHECK");
  const dcfAfter = softenDcfRealityGate(dcf!, { qualifies: pipe.fiscalQualifiedAndMaterial, catalystEV: pipe.fiscalEVPercent });
  check("AI: DCF-Cap bleibt 65", dcfAfter.cap === 65, JSON.stringify({ cap: dcfAfter.cap, q: pipe.fiscal.qualifies }));
}

console.log("\n18: NATO/Rüstung DCF 65→75, PP/SHARE hart");
{
  const nato = mkFiscal();
  const q = fiscalMegatrendQualifies([nato], asOf);
  check("NATO qualifies=true (publishedAt ≤ as-of)", q.qualifies === true, JSON.stringify(q));
  const pipe = runScoringPipeline({
    qualityScore: 80, trendMultiplier: 1, catalysts: [nato], asOfDate: asOf,
    price: 100,
    gateInputs: { ...gateInputsWeak, marginDeltaYoYPp: -3, relativeGrowthDeltaYoYPp: -4 },
  });
  check("Fiscal material (EV ≥ 5%)", pipe.fiscalQualifiedAndMaterial === true, String(pipe.fiscalEVPercent));
  const dcf = pipe.activeGates.find(g => g.id === "DCF_REALITY_CHECK");
  const pp = pipe.activeGates.find(g => g.id === "PRICING_POWER");
  const share = pipe.activeGates.find(g => g.id === "RELATIVE_GROWTH");
  check("NATO: DCF-Cap 75", dcf?.cap === 75, JSON.stringify(dcf));
  check("PP bleibt 55 hart", pp?.cap === 55 && pp?.severity === "hard", JSON.stringify(pp));
  check("SHARE/RELATIVE_GROWTH bleibt 60 hart", share?.cap === 60 && share?.severity === "hard", JSON.stringify(share));
  check("finalScore von PP gedeckelt (55)", pipe.score === 55 && pipe.cappedBy?.id === "PRICING_POWER", JSON.stringify({ score: pipe.score, by: pipe.cappedBy?.id }));
  check("Conflict-Text gesetzt", pipe.conflictTexts.some(t => t.includes("Fiscal-Megatrend aktiv")));
}

console.log("\n17.7 Lookahead-Sperre");
{
  const future = mkFiscal({
    source: { url: "https://bundeshaushalt.de/programm", publishedAt: "2026-01-15", snippet: "ex-post" },
  });
  const q = fiscalMegatrendQualifies([future], asOf);
  check("publishedAt > as-of → qualifies=false", q.qualifies === false);
}

console.log(failed === 0 ? "\nAlle Lookahead-/Fiscal-Fixtures bestanden" : `\n${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
