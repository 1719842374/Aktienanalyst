/**
 * Isolierter Test fuer Prompt- und Validierungslogik der nachgelagerten
 * Management-Score-KI-Interpretation. Kein HTTP-Server und kein LLM-Aufruf.
 *
 * Ausfuehren: npx tsx script/test-management-score-interpret-route.ts
 */
import {
  buildManagementInterpretPrompt,
  buildManagementInterpretSystemPrompt,
  validateManagementInterpretRequest,
} from "../server/management-score-interpret";

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const validBody = {
  ticker: "TEST",
  companyName: "Testunternehmen AG",
  breakdown: {
    score1to10: 5.4,
    delivery: { score: 0.82 },
    segment: { score: 0.31 },
    capital: { score: 0.64 },
    credibility: { score: 0.77 },
    qualNews: {
      score: 0.22,
      adjustments: [{ type: "insider_selling_positive_story", delta: -0.1, rationale: "Netto-Insiderverkäufe" }],
    },
    allFlags: ["Fallback wegen unvollständiger Segmenthistorie"],
  },
};

console.log("\n=== Management-Score-KI-Interpretation: Prompt ===");
const prompt = buildManagementInterpretPrompt(validBody);
check("Delivery-Prozentwert ist korrekt", prompt.includes("Delivery (30%): 82%"), prompt);
check("niedriger Segment-Prozentwert ist korrekt", prompt.includes("Segment-Shift (25%): 31%"), prompt);
check("Qual-News-Prozentwert ist korrekt", prompt.includes("Qual + News (10%): 22%"), prompt);
check("Governance-Anpassungen werden übergeben", prompt.includes("insider_selling_positive_story"), prompt);
check("Transparenz-Flag wird übergeben", prompt.includes("unvollständiger Segmenthistorie"), prompt);
check("System-Prompt verlangt JSON mit allen Kernfeldern", ["gesamteinschaetzung", "staerken", "schwaechen", "governanceSignal", "datenlueckenHinweis", "fazit"].every(field => buildManagementInterpretSystemPrompt().includes(field)));

console.log("\n=== Management-Score-KI-Interpretation: Validierung ===");
check("gültiger Request wird akzeptiert", validateManagementInterpretRequest(validBody) === null);
check("fehlender Ticker liefert 400-Fehlertext", validateManagementInterpretRequest({ breakdown: validBody.breakdown }) === "ticker fehlt");
check("fehlender Breakdown liefert 400-Fehlertext", validateManagementInterpretRequest({ ticker: "TEST" }) === "breakdown fehlt");

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
