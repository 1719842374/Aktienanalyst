/**
 * Test fuer Punkt 1 (HOCH-Ticket 05.08.2026): REGULATORY-Gate an die
 * Scoring-Pipeline verdrahten.
 *
 * Ist-Zustand vor diesem Fix: buildGates() unterstuetzte regulatoryGate schon
 * strukturell, aber AnalysisScoringContext (scoring-integration.ts) hatte kein
 * entsprechendes Feld und analyze-route.ts befuellte es nie — das Gate konnte
 * in der produktiven Pipeline nie erscheinen, obwohl die Gate-Logik selbst
 * unveraendert bleibt (nur die Verdrahtung wurde ergaenzt).
 *
 * Diese Datei prueft:
 *  1. deriveGateInputs() reicht ein uebergebenes regulatoryGate 1:1 durch.
 *  2. Ohne regulatoryGate (null/undefined) bleibt das Feld null — kein
 *     Fake-Default.
 *  3. buildScoringForAnalysis() liefert das REGULATORY_EXPOSURE-Gate in der
 *     finalen `gates`-Liste, wenn ein Assessment vorhanden ist.
 *  4. Der 7%-Kumulierungsregel-Cap (55/hard) aus regulatory.ts wird
 *     unveraendert uebernommen — diese Aenderung veraendert NUR die
 *     Verdrahtung, nicht die Gate-Berechnung selbst.
 *
 * Ausfuehren: npx tsx script/test-regulatory-gate-wiring.ts
 */
import { deriveGateInputs, buildScoringForAnalysis, type AnalysisScoringContext } from "../server/scoring-integration";
import type { Gate } from "../server/scoring-gates";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const baseCtx: Omit<AnalysisScoringContext, "regulatoryGate"> = {
  impliedGStar: null,
  quarterlyRevenueChronological: null,
  annualIncome: null,
  annualBalance: null,
  subjectRevenueGrowth: null,
  peerRevenueGrowths: null,
};

console.log("\n=== deriveGateInputs: regulatoryGate wird 1:1 durchgereicht ===");
{
  const regGate: Gate = {
    id: "REGULATORY_EXPOSURE",
    active: true,
    cap: 55,
    severity: "hard",
    rationale: "Materielles Risiko: Digital Markets Act Gatekeeper-Verpflichtungen (European Union)",
  };
  const gi = deriveGateInputs({ ...baseCtx, regulatoryGate: regGate });
  check("regulatoryGate identisch durchgereicht (gleiche Referenz-Werte)",
    gi.regulatoryGate?.id === "REGULATORY_EXPOSURE" &&
    gi.regulatoryGate?.cap === 55 &&
    gi.regulatoryGate?.severity === "hard" &&
    gi.regulatoryGate?.rationale === regGate.rationale
  );
}

console.log("\n=== Kein Assessment vorhanden → regulatoryGate bleibt null (kein Fake-Default) ===");
{
  const gi1 = deriveGateInputs({ ...baseCtx, regulatoryGate: null });
  check("explizit null → null", gi1.regulatoryGate === null);
  const gi2 = deriveGateInputs(baseCtx as AnalysisScoringContext);
  check("Feld komplett weggelassen (undefined) → null", gi2.regulatoryGate === null);
}

console.log("\n=== buildScoringForAnalysis: Gate erscheint in der finalen gates-Liste ===");
{
  const regGate: Gate = {
    id: "REGULATORY_EXPOSURE",
    active: true,
    cap: 55,
    severity: "hard",
    rationale: "Materielles Risiko: Medicare Drug Price Negotiation (United States)",
  };
  const result = buildScoringForAnalysis({
    ctx: { ...baseCtx, regulatoryGate: regGate },
    health: "Good",
    moatRating: "Narrow",
    technicalIndicators: null,
    catalysts: [],
    price: 100,
    asOfDate: "2026-08-05",
  });
  const found = result.gates.find(g => g.id === "REGULATORY_EXPOSURE");
  check("REGULATORY_EXPOSURE-Gate erscheint in gates[]", !!found);
  check("active=true unveraendert uebernommen", found?.active === true);
  check("cap=55 unveraendert uebernommen (7%-Kumulierungsregel-Ergebnis, KEINE Neuberechnung hier)", found?.cap === 55);
  check("severity=hard unveraendert uebernommen", found?.severity === "hard");
  check("finalScore wird durch das Regulatory-Gate mitgedeckelt (Cap 55)", result.finalScore <= 55);
}

console.log("\n=== Ohne Assessment: kein REGULATORY_EXPOSURE-Gate in gates[], andere Gates unbeeinflusst ===");
{
  const result = buildScoringForAnalysis({
    ctx: { ...baseCtx, regulatoryGate: null },
    health: "Excellent",
    moatRating: "Wide",
    technicalIndicators: { priceAboveMA200: true, ma50AboveMA200: true },
    catalysts: [],
    price: 100,
    asOfDate: "2026-08-05",
  });
  check("kein REGULATORY_EXPOSURE-Gate ohne Assessment (kein Fake-Default)",
    !result.gates.some(g => g.id === "REGULATORY_EXPOSURE"));
  check("finalScore unveraendert hoch, da kein Gate deckelt (Excellent+Wide -> qualityScore 88 * trend 1.1 = 96.8, kein Cap)",
    result.finalScore > 90, String(result.finalScore));
}

console.log(failed === 0 ? "\n✅ Alle Regulatory-Gate-Verdrahtungs-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
