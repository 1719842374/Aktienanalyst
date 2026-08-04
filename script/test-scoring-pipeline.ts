/**
 * Tests fuer buildGates() + runScoringPipeline() (WORK_SCORING_VORLAGE.md §17.8).
 *
 * §17.8 spezifiziert 4 Testfaelle als Tabellenzeilen (keine exakten Zahlen,
 * nur qualitative Signale + Ergebnis-Beschreibung). Diese Datei baut jeden
 * Fall als konkrete, numerische Fixture nach — mit realistischen, aus
 * oeffentlich bekannten Fundamentaldaten abgeleiteten Groessenordnungen fuer
 * Nike 2023 (Umsatzstagnation, China-Schwaeche, Rabatt-getriebene
 * Margenkompression, Marktanteilsverlust an On/Hoka) — nicht die exakten
 * historischen FMP-Zahlen (die wuerden einen Live-Fetch brauchen), sondern
 * eine plausible Fixture, die exakt die in §17.8 genannten Bedingungen erfuellt:
 *   "Realized 8Q schwach: ja | Reverse DCF hoch: ja | Fiscal high-conf: nein
 *    → Ergebnis: DCF_REALITY + PP + SHARE → score ≤ 55"
 *
 * Ausfuehren: npx tsx script/test-scoring-pipeline.ts
 */
import {
  buildGates, runScoringPipeline, softenGatesForFiscalMegatrend, GATE_THRESHOLDS, GATE_CAPS,
  type GateInputs, type ScoringPipelineInput,
} from "../server/scoring-gates";
import type { Catalyst } from "../shared/schema";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function makeCatalyst(overrides: Partial<Catalyst>): Catalyst {
  return {
    name: "Test-Katalysator",
    timeline: "2025-2028",
    pos: true,
    bruttoUpside: 0,
    einpreisungsgrad: 0,
    nettoUpside: 0,
    gb: 0,
    ...overrides,
  } as Catalyst;
}

// ============================================================================
// Fall 1 (§17.8 Zeile 1): Nike 2023
//   Realized 8Q schwach: ja | Reverse DCF hoch: ja | Fiscal: nein
//   → DCF_REALITY + PP + SHARE → score ≤ 55
// ============================================================================
console.log("\n=== Nike 2023 (§17.8 Zeile 1) ===");
{
  // Fixture-Begründung (öffentlich bekannt, FY2023/24): Nike-Umsatz stagnierte
  // (~+1% YoY in mehreren Quartalen, China-Schwäche), Bruttomarge fiel durch
  // aggressive Rabattaktionen (Abbau von Überbeständen), On/Hoka gewannen
  // Marktanteil im Laufsport-Segment. Reverse-DCF implizierte zu dieser Zeit
  // laut Marktbewertung (KGV ~28x bei damaligem Kurs) ein deutlich höheres
  // Wachstum, als die Realized-Rate stützte.
  const nikeInputs: GateInputs = {
    impliedGrowthPercent: 9.5,       // Reverse-DCF g* — Markt preist ~9.5% p.a. ein
    realizedGrowth8QPercent: 2.0,    // 8Q-realisiertes Umsatzwachstum — schwach
    marginDeltaYoYPp: -3.2,          // Bruttomarge bricht YoY um 3.2pp (Rabatte)
    relativeGrowthDeltaYoYPp: -4.5,  // Marktanteil ggü. On/Hoka verloren
    inventoryDaysDeltaYoYPct: 22,    // bekannter Lageraufbau-/Abverkaufszyklus
  };
  const gapRatio = nikeInputs.impliedGrowthPercent! / nikeInputs.realizedGrowth8QPercent!;
  check(`gapRatio = 4.75 (Fixture-Rechenkontrolle: ${gapRatio.toFixed(2)})`, Math.abs(gapRatio - 4.75) < 0.01);
  check(`gapRatio ≥ HIGH_GAP_RATIO-Schwelle (${GATE_THRESHOLDS.HIGH_GAP_RATIO})`, gapRatio >= GATE_THRESHOLDS.HIGH_GAP_RATIO);

  const gates = buildGates(nikeInputs);
  const byId = (id: string) => gates.find(g => g.id === id)!;

  check("§17.8: 'Realized 8Q schwach: ja' → RELATIVE_GROWTH aktiv", byId("RELATIVE_GROWTH").active);
  check("§17.8: 'Reverse DCF hoch: ja' → DCF_REALITY_CHECK aktiv", byId("DCF_REALITY_CHECK").active);
  check("§17.8: Marge bricht → PRICING_POWER aktiv ('PP' in der Ergebnis-Spalte)", byId("PRICING_POWER").active);
  check("Kein Fiscal-Katalysator im Input → keine Milderung möglich", true); // wird unten in der Pipeline geprüft

  const pipelineInput: ScoringPipelineInput = {
    qualityScore: 70,      // hypothetisch hohe Rohqualität (Marke, Cashflow) — trotzdem gedeckelt
    trendMultiplier: 1.1,
    catalysts: [], // §17.8: "Fiscal high-conf? nein" — bewusst KEIN fiscal-Katalysator
    asOfDate: "2023-09-30",
    price: 90,
    gateInputs: nikeInputs,
  };
  const result = runScoringPipeline(pipelineInput);

  check("Kein Fiscal-Katalysator → fiscal.qualifies = false", result.fiscal.qualifies === false);
  check("fiscalQualifiedAndMaterial = false (keine Milderung von DCF_REALITY)", result.fiscalQualifiedAndMaterial === false);
  check(
    "DCF_REALITY_CHECK bleibt bei Cap 65 (NICHT gemildert, da kein Fiscal-Katalysator)",
    result.activeGates.find(g => g.id === "DCF_REALITY_CHECK")?.cap === GATE_CAPS.DCF_REALITY
  );
  check(
    `§17.8 Nike-2023-Zielwert: finalScore ≤ 55 (tatsächlich: ${result.score})`,
    result.score <= 55,
    `rawScore=${result.rawScore}, score=${result.score}, cappedBy=${result.cappedBy?.id}`
  );
  check(
    "Score wurde durch PRICING_POWER (Cap 55, strengster Gate) gedeckelt",
    result.cappedBy?.id === "PRICING_POWER"
  );
  console.log(`  ℹ️  Nike-Fixture: rawScore=${result.rawScore.toFixed(1)}, finalScore=${result.score}, cappedBy=${result.cappedBy?.id}`);
}

// ============================================================================
// Fall 2 (§17.8 Zeile 2): AI-Capex-Hype, Orders noch dünn
//   Realized 8Q schwach: ja | Reverse DCF hoch: ja | Fiscal: nein
//   → DCF_REALITY voll, Anti-Bias Pflicht (KEINE Milderung, auch wenn ein
//     "AI-Capex"-Katalysator vorhanden ist — er qualifiziert nicht als fiscal)
// ============================================================================
console.log("\n=== AI-Capex-Hype (§17.8 Zeile 2) ===");
{
  const aiCapexInputs: GateInputs = {
    impliedGrowthPercent: 35,
    realizedGrowth8QPercent: 8,
    marginDeltaYoYPp: -0.5,
    relativeGrowthDeltaYoYPp: 0,
    inventoryDaysDeltaYoYPct: null,
  };

  // Der Katalysator TRÄGT die AI-Erzählung, aber sein `type` ist NICHT
  // 'fiscal'/'capacity' — das ist exakt §17.3s "❌ AI-Capex der Hyperscaler →
  // privater Zyklus, Anti-Bias Pflicht". Selbst wenn jemand versehentlich
  // hohe confidence/probability vergibt, muss type allein schon disqualifizieren.
  const aiCapexCatalyst = makeCatalyst({
    name: "Hyperscaler AI-Capex-Ausweitung",
    type: "capex" as any, // bewusst NICHT 'fiscal'/'capacity'
    confidence: "high",
    probability: 0.85,
    source: { url: "https://example.com/earnings-call", publishedAt: "2023-06-01", snippet: "Guidance" },
    epsImpact: 0.5,
    bruttoUpside: 15,
    nettoUpside: 12,
  });

  const pipelineInput: ScoringPipelineInput = {
    qualityScore: 75,
    trendMultiplier: 1.2,
    catalysts: [aiCapexCatalyst],
    asOfDate: "2023-06-15",
    price: 400,
    gateInputs: aiCapexInputs,
  };
  const result = runScoringPipeline(pipelineInput);

  check("§17.3: AI-Capex-Katalysator (type='capex') → qualifies = false", result.fiscal.qualifies === false);
  check("reasons enthält 'no_high_confidence_fiscal' (fällt durch Kriterium 1: type)", result.fiscal.reasons.includes("no_high_confidence_fiscal"));
  check("fiscalQualifiedAndMaterial = false", result.fiscalQualifiedAndMaterial === false);
  check(
    "DCF_REALITY_CHECK bleibt bei vollem Cap 65 ('DCF_REALITY voll, Anti-Bias Pflicht')",
    result.activeGates.find(g => g.id === "DCF_REALITY_CHECK")?.cap === GATE_CAPS.DCF_REALITY
  );
  check("DCF_REALITY_CHECK ist aktiv (gapRatio 35/8=4.375 ≥ 1.5)", result.activeGates.some(g => g.id === "DCF_REALITY_CHECK"));
}

// ============================================================================
// Fall 3 (§17.8 Zeile 3): Rüstung nach NATO-2%-Beschluss, Backlog sichtbar
//   Realized 8Q: teils | Reverse DCF hoch: ja | Fiscal high-conf: JA
//   → DCF_REALITY Cap 65→75; PP/SHARE unverändert
// ============================================================================
console.log("\n=== Rüstung nach NATO-Beschluss, Backlog sichtbar (§17.8 Zeile 3) ===");
{
  const defenseInputs: GateInputs = {
    impliedGrowthPercent: 18,
    realizedGrowth8QPercent: 9,    // "teils" schwach — moderat, nicht dramatisch
    marginDeltaYoYPp: 0.3,          // Marge stabil/leicht besser — PP soll NICHT greifen
    relativeGrowthDeltaYoYPp: 1.0,  // kein Share-Loss — RELATIVE_GROWTH soll NICHT greifen
    inventoryDaysDeltaYoYPct: 5,
  };

  const natoFiscalCatalyst = makeCatalyst({
    name: "NATO 2%-Ziel — mehrjähriges Verteidigungsbudget",
    type: "fiscal",
    confidence: "high",
    probability: 0.8,
    source: { url: "https://www.nato.int/cps/en/natohq/topics_49198.htm", publishedAt: "2022-06-29", snippet: "NATO Defence Investment Pledge" },
    epsImpact: 1.2,
    startYear: 2023,
    endYear: 2028,
    bruttoUpside: 12,
    nettoUpside: 9, // ≥ 5% Materialitätsschwelle (§17.6)
  });

  const gates = buildGates(defenseInputs);
  check("Marge stabil → PRICING_POWER NICHT aktiv", !gates.find(g => g.id === "PRICING_POWER")!.active);
  check("Kein Share-Loss + Realized nicht unter Schwelle → RELATIVE_GROWTH NICHT aktiv", !gates.find(g => g.id === "RELATIVE_GROWTH")!.active);
  check("gapRatio 18/9=2.0 ≥ 1.5 → DCF_REALITY_CHECK aktiv (vor Milderung)", gates.find(g => g.id === "DCF_REALITY_CHECK")!.active);

  const pipelineInput: ScoringPipelineInput = {
    qualityScore: 68,
    trendMultiplier: 1.05,
    catalysts: [natoFiscalCatalyst],
    asOfDate: "2023-07-01", // NACH publishedAt (2022-06-29) — kein Lookahead-Verstoß
    price: 250,
    gateInputs: defenseInputs,
  };
  const result = runScoringPipeline(pipelineInput);

  check("NATO-Katalysator qualifiziert (type=fiscal, confidence=high, probability≥0.6, source+epsImpact gesetzt)", result.fiscal.qualifies === true);
  check(`fiscalEVPercent ≥ 5% Materialitätsschwelle (tatsächlich: ${result.fiscalEVPercent}%)`, result.fiscalEVPercent >= 5);
  check("fiscalQualifiedAndMaterial = true → Milderung greift", result.fiscalQualifiedAndMaterial === true);

  // activeGates enthält nur AKTIVE Gates (PP/SHARE sind hier inaktiv, siehe
  // oben) — für den "bleibt unverändert"-Check muss die VOLLSTÄNDIGE, nach
  // Fiscal-Milderung entstandene Gate-Liste durchsucht werden, nicht nur die
  // aktiven. runScoringPipeline gibt diese nicht direkt zurück, daher hier
  // erneut buildGates() + softenGatesForFiscalMegatrend() nachbauen, um an
  // die vollständige (auch inaktive) Gate-Liste zu kommen.
  const allGatesAfter = softenGatesForFiscalMegatrend(
    buildGates(defenseInputs),
    { qualifies: result.fiscalQualifiedAndMaterial, catalystEV: result.fiscalEVPercent }
  );
  const dcfGateAfter = allGatesAfter.find(g => g.id === "DCF_REALITY_CHECK");
  check(
    `§17.8: 'DCF_REALITY Cap 65→75' (tatsächlich: ${dcfGateAfter?.cap})`,
    dcfGateAfter?.cap === 75
  );
  check("DCF_REALITY_CHECK severity wird zu 'warn' (nicht mehr 'hard')", dcfGateAfter?.severity === "warn");
  check(
    "PP/SHARE bleiben unverändert (waren schon vor Fiscal inaktiv UND ihr Cap ändert sich durch Fiscal nicht)",
    allGatesAfter.find(g => g.id === "PRICING_POWER")!.active === false &&
    allGatesAfter.find(g => g.id === "PRICING_POWER")!.cap === GATE_CAPS.PRICING_POWER &&
    allGatesAfter.find(g => g.id === "RELATIVE_GROWTH")!.active === false &&
    allGatesAfter.find(g => g.id === "RELATIVE_GROWTH")!.cap === GATE_CAPS.RELATIVE_GROWTH
  );
  check("Conflict-Text wird erzeugt, wenn Fiscal-Ausnahme greift", result.conflictTexts.length === 1 && result.conflictTexts[0].includes("Fiscal-Megatrend aktiv"));
}

// ============================================================================
// Fall 4 (§17.8 Zeile 4): Rüstung, aber Marge bricht + Share-Loss
//   Realized 8Q schwach: ja | Reverse DCF hoch: ja | Fiscal: ja
//   → PP/SHARE deckeln weiter auf 55/60 — Fiscal hilft NICHT
// ============================================================================
console.log("\n=== Rüstung, aber Marge bricht + Share-Loss (§17.8 Zeile 4) ===");
{
  const defenseBadInputs: GateInputs = {
    impliedGrowthPercent: 20,
    realizedGrowth8QPercent: 3,      // schwach
    marginDeltaYoYPp: -4.0,          // Marge bricht deutlich (Kostenüberschreitung, Fixpreis-Verträge)
    relativeGrowthDeltaYoYPp: -3.5,  // Share-Loss an Wettbewerber
    inventoryDaysDeltaYoYPct: 10,
  };

  const natoFiscalCatalyst = makeCatalyst({
    name: "NATO 2%-Ziel — mehrjähriges Verteidigungsbudget",
    type: "fiscal",
    confidence: "high",
    probability: 0.8,
    source: { url: "https://www.nato.int/cps/en/natohq/topics_49198.htm", publishedAt: "2022-06-29", snippet: "NATO Defence Investment Pledge" },
    epsImpact: 1.0,
    bruttoUpside: 10,
    nettoUpside: 8,
  });

  const pipelineInput: ScoringPipelineInput = {
    qualityScore: 60,
    trendMultiplier: 1.0,
    catalysts: [natoFiscalCatalyst],
    asOfDate: "2023-07-01",
    price: 100,
    gateInputs: defenseBadInputs,
  };
  const result = runScoringPipeline(pipelineInput);

  check("Fiscal-Katalysator qualifiziert weiterhin (gleiche Kriterien erfüllt)", result.fiscal.qualifies === true);
  check("fiscalQualifiedAndMaterial = true (Fiscal-Ausnahme greift grundsätzlich)", result.fiscalQualifiedAndMaterial === true);

  const ppGate = result.activeGates.find(g => g.id === "PRICING_POWER");
  const shareGate = result.activeGates.find(g => g.id === "RELATIVE_GROWTH");
  check("PRICING_POWER aktiv trotz Fiscal-Ausnahme (Marge bricht)", ppGate?.active === true);
  check(`§17.8: PRICING_POWER Cap bleibt 55 unverändert ('Fiscal hilft NICHT') — tatsächlich: ${ppGate?.cap}`, ppGate?.cap === GATE_CAPS.PRICING_POWER);
  check("RELATIVE_GROWTH aktiv (Realized schwach + Share-Loss)", shareGate?.active === true);
  check(`§17.8: RELATIVE_GROWTH Cap bleibt 60 unverändert — tatsächlich: ${shareGate?.cap}`, shareGate?.cap === GATE_CAPS.RELATIVE_GROWTH);
  check(
    `§17.8-Zielaussage: 'PP/SHARE deckeln weiter auf 55/60' → finalScore ≤ 55 (tatsächlich: ${result.score})`,
    result.score <= 55
  );
  check("Score wird durch PRICING_POWER (strengster Cap=55) gedeckelt, NICHT durch das gemilderte DCF_REALITY", result.cappedBy?.id === "PRICING_POWER");
}

// ============================================================================
// §17.7 Lookahead-Regel — explizit als eigener Test (Backtest-Sicherheit)
// ============================================================================
console.log("\n=== §17.7 Lookahead-Sperre ===");
{
  const futureCatalyst = makeCatalyst({
    name: "Zukünftig veröffentlichter Fiscal-Katalysator",
    type: "fiscal",
    confidence: "high",
    probability: 0.9,
    source: { url: "https://example.com/future-budget-law", publishedAt: "2024-01-01", snippet: "..." },
    epsImpact: 2.0,
    bruttoUpside: 20,
    nettoUpside: 15,
  });
  const inputs: GateInputs = {
    impliedGrowthPercent: 15, realizedGrowth8QPercent: 10,
    marginDeltaYoYPp: 0, relativeGrowthDeltaYoYPp: 0, inventoryDaysDeltaYoYPct: null,
  };
  const result = runScoringPipeline({
    qualityScore: 70, trendMultiplier: 1.0,
    catalysts: [futureCatalyst],
    asOfDate: "2023-06-01", // VOR publishedAt (2024-01-01) — Lookahead-Verstoß
    price: 100, gateInputs: inputs,
  });
  check("Katalysator mit publishedAt NACH asOfDate → qualifies = false (kein Lookahead)", result.fiscal.qualifies === false);
  check("fiscalQualifiedAndMaterial = false trotz sonst perfekter Kriterien", result.fiscalQualifiedAndMaterial === false);
}

console.log(failed === 0 ? "\n✅ Alle Scoring-Pipeline-Tests bestanden (Nike, AI-Capex, Rüstung ×2, Lookahead)" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
