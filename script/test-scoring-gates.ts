/**
 * Unit-Tests für die generische Gate-Infrastruktur + Lookahead-Bias-Regel
 * (WORK_SCORING_VORLAGE.md §0 + §17-18).
 * Läuft ohne Netzwerk/LLM — reine Funktionstests.
 *
 * Ausführen: npx tsx script/test-scoring-gates.ts
 */
import {
  applyGates, fiscalMegatrendQualifies, softenDcfRealityGate, softenGatesForFiscalMegatrend,
  fiscalMegatrendConflictText, GATE_CAPS,
  type Gate,
} from "../server/scoring-gates";
import type { Catalyst } from "../shared/schema";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function mkGate(over: Partial<Gate> = {}): Gate {
  return {
    id: "DCF_REALITY_CHECK",
    active: true,
    cap: GATE_CAPS.DCF_REALITY,
    severity: "warn",
    rationale: "Reverse-DCF impliziert Wachstum weit über 8Q-Realized-Trend",
    ...over,
  };
}

function mkCatalyst(over: Partial<Catalyst> = {}): Catalyst {
  return {
    name: "NATO-2%-Sondervermögen",
    timeline: "2025-2028",
    pos: 70,
    bruttoUpside: 20,
    einpreisungsgrad: 30,
    nettoUpside: 14,
    gb: 9.8,
    type: "fiscal",
    confidence: "high",
    probability: 0.7,
    source: { url: "https://bundeshaushalt.de/programm", publishedAt: "2025-06-01", snippet: "Sondervermögen beschlossen" },
    epsImpact: 1.2,
    startYear: 2025,
    endYear: 2028,
    ...over,
  };
}

// ─── §0 GATE_CAPS-Konstanten ───────────────────────────────────────────────────
console.log("\n§0 GATE_CAPS-Konstanten");
{
  check("PRICING_POWER = 55", GATE_CAPS.PRICING_POWER === 55);
  check("RELATIVE_GROWTH = 60", GATE_CAPS.RELATIVE_GROWTH === 60);
  check("DCF_REALITY = 65", GATE_CAPS.DCF_REALITY === 65);
  check("INVENTORY = 70", GATE_CAPS.INVENTORY === 70);
}

// ─── §0 applyGates ──────────────────────────────────────────────────────────────
console.log("\n§0 applyGates — finalScore = min(qualityScore × trendMultiplier, gateCap)");
{
  // Kein Gate aktiv → Roh-Score bleibt
  const r1 = applyGates(80, 1.0, []);
  check("Keine Gates → rawScore unverändert", r1.score === 80 && r1.cappedBy === null, JSON.stringify(r1));

  // Ein aktives Gate über dem Rohscore → greift nicht
  const r2 = applyGates(50, 1.0, [mkGate({ cap: 65 })]);
  check("Cap über rawScore → nicht gedeckelt", r2.score === 50 && r2.cappedBy === null, JSON.stringify(r2));

  // Ein aktives Gate unter dem Rohscore → deckelt
  const r3 = applyGates(80, 1.0, [mkGate({ id: "DCF_REALITY_CHECK", cap: 65 })]);
  check("Cap unter rawScore → gedeckelt auf 65", r3.score === 65 && r3.cappedBy?.id === "DCF_REALITY_CHECK", JSON.stringify(r3));

  // Mehrere aktive Gates → strengster (niedrigster Cap) gewinnt
  const r4 = applyGates(90, 1.0, [
    mkGate({ id: "DCF_REALITY_CHECK", cap: 65 }),
    mkGate({ id: "PRICING_POWER", cap: 55 }),
    mkGate({ id: "INVENTORY", cap: 70 }),
  ]);
  check("Mehrere Gates → strengster Cap (55) gewinnt", r4.score === 55 && r4.cappedBy?.id === "PRICING_POWER", JSON.stringify(r4));

  // Inaktive Gates werden ignoriert
  const r5 = applyGates(90, 1.0, [
    mkGate({ id: "PRICING_POWER", cap: 55, active: false }),
    mkGate({ id: "INVENTORY", cap: 70, active: true }),
  ]);
  check("Inaktives Gate ignoriert → Cap 70 greift", r5.score === 70 && r5.cappedBy?.id === "INVENTORY", JSON.stringify(r5));

  // trendMultiplier fließt in rawScore ein
  const r6 = applyGates(50, 1.5, []);
  check("trendMultiplier multipliziert korrekt (50×1.5=75)", r6.rawScore === 75 && r6.score === 75, JSON.stringify(r6));
}

// ─── §17.4/§17.7 fiscalMegatrendQualifies ──────────────────────────────────────
console.log("\n§17.4/§17.7 fiscalMegatrendQualifies");
{
  const asOf = "2026-01-01";

  // Positiv-Fall: alle Kriterien erfüllt (NATO-Sondervermögen-artig)
  const q1 = fiscalMegatrendQualifies([mkCatalyst()], asOf);
  check("Alle Kriterien erfüllt → qualifies=true", q1.qualifies === true, JSON.stringify(q1));

  // §17.3 AI-Capex-Testfall: type nicht in {fiscal, capacity} → MUSS false liefern
  const aiCapex = mkCatalyst({ name: "Hyperscaler AI-Capex-Boom", type: "ai-capex" as any });
  const q2 = fiscalMegatrendQualifies([aiCapex], asOf);
  check("AI-Capex (type != fiscal/capacity) → qualifies=false (§17.3 Pflicht-Testfall)", q2.qualifies === false, JSON.stringify(q2));

  // AI-Capex ohne Staatsbezug, generischer Narrativ-Typ ('narrative')
  const narrative = mkCatalyst({ name: "Semiconductor Super-Cycle", type: "narrative" as any, confidence: "high", probability: 0.9 });
  const q3 = fiscalMegatrendQualifies([narrative], asOf);
  check("Narrative-Typ ('semiconductor super-cycle') → qualifies=false", q3.qualifies === false, JSON.stringify(q3));

  // §17.7 Lookahead-Sperre: publishedAt NACH asOfDate → darf NICHT qualifizieren
  const lookahead = mkCatalyst({ source: { url: "https://x.gov/y", publishedAt: "2026-06-01", snippet: "..." } });
  const q4 = fiscalMegatrendQualifies([lookahead], asOf);
  check("Lookahead-Sperre: publishedAt > asOfDate → qualifies=false", q4.qualifies === false, JSON.stringify(q4));

  // Lookahead-Grenzfall: publishedAt === asOfDate → zulässig (<=)
  const boundary = mkCatalyst({ source: { url: "https://x.gov/y", publishedAt: "2026-01-01", snippet: "..." } });
  const q5 = fiscalMegatrendQualifies([boundary], asOf);
  check("Lookahead-Grenzfall publishedAt === asOfDate → qualifies=true (<=, nicht <)", q5.qualifies === true, JSON.stringify(q5));

  // confidence != high → fällt durch
  const lowConf = mkCatalyst({ confidence: "medium" });
  const q6 = fiscalMegatrendQualifies([lowConf], asOf);
  check("confidence != 'high' → qualifies=false", q6.qualifies === false, JSON.stringify(q6));

  // probability < 0.6 → fällt durch
  const lowProb = mkCatalyst({ probability: 0.55 });
  const q7 = fiscalMegatrendQualifies([lowProb], asOf);
  check("probability < 0.6 → qualifies=false", q7.qualifies === false, JSON.stringify(q7));

  // fehlende source.url → fällt durch
  const noUrl = mkCatalyst({ source: { url: "", publishedAt: "2025-06-01", snippet: "..." } });
  const q8 = fiscalMegatrendQualifies([noUrl], asOf);
  check("fehlende source.url → qualifies=false", q8.qualifies === false, JSON.stringify(q8));

  // epsImpact null → fällt durch
  const noEps = mkCatalyst({ epsImpact: undefined });
  const q9 = fiscalMegatrendQualifies([noEps], asOf);
  check("epsImpact fehlt → qualifies=false", q9.qualifies === false, JSON.stringify(q9));

  // fehlendes/unparsbares publishedAt → defensiv false, unabhängig von anderen Feldern
  const badDate = mkCatalyst({ source: { url: "https://x.gov/y", publishedAt: "not-a-date", snippet: "..." } });
  const q10 = fiscalMegatrendQualifies([badDate], asOf);
  check("unparsbares publishedAt → qualifies=false (defensiv)", q10.qualifies === false, JSON.stringify(q10));

  // capacity-Typ ebenfalls zulässig (nicht nur fiscal)
  const capacity = mkCatalyst({ type: "capacity" });
  const q11 = fiscalMegatrendQualifies([capacity], asOf);
  check("type='capacity' ebenfalls qualifikationsfähig", q11.qualifies === true, JSON.stringify(q11));

  // Mehrere Katalysatoren, nur einer qualifiziert → insgesamt true, reasons zeigt count
  const q12 = fiscalMegatrendQualifies([aiCapex, mkCatalyst()], asOf);
  check("Mind. 1 qualifizierender Katalysator reicht → true", q12.qualifies === true && q12.reasons.some(r => r.includes("fiscal_count=1")), JSON.stringify(q12));
}

// ─── §17.5 softenDcfRealityGate — UNVERÄNDERLICHE TABELLE ─────────────────────
console.log("\n§17.5 softenDcfRealityGate — nur DCF_REALITY_CHECK milderbar");
{
  const qualified = { qualifies: true, catalystEV: 6 };
  const notQualified = { qualifies: false, catalystEV: 0 };

  // DCF_REALITY_CHECK + qualifies → Cap 65→75, severity warn, rationale erweitert
  const g1 = mkGate({ id: "DCF_REALITY_CHECK", cap: 65, severity: "warn" });
  const softened1 = softenDcfRealityGate(g1, qualified);
  check("DCF_REALITY_CHECK: Cap 65→75", softened1.cap === 75, JSON.stringify(softened1));
  check("DCF_REALITY_CHECK: severity bleibt 'warn'", softened1.severity === "warn");
  check("DCF_REALITY_CHECK: rationale erweitert (nicht ersetzt)", softened1.rationale.includes("Fiscal-Megatrend belegt") && softened1.rationale.includes(g1.rationale));

  // Cap-Deckel bei 80 (Math.min(80, cap+10))
  const g1b = mkGate({ id: "DCF_REALITY_CHECK", cap: 75 });
  const softened1b = softenDcfRealityGate(g1b, qualified);
  check("Cap-Obergrenze Math.min(80, cap+10) greift (75+10=85→80)", softened1b.cap === 80, JSON.stringify(softened1b));

  // DCF_REALITY_CHECK, aber nicht qualifiziert → unverändert
  const softened2 = softenDcfRealityGate(g1, notQualified);
  check("DCF_REALITY_CHECK ohne qualifies → unverändert", softened2.cap === 65 && softened2 === g1);

  // DCF_REALITY_CHECK inaktiv → unverändert, selbst wenn qualifies=true
  const g1Inactive = mkGate({ id: "DCF_REALITY_CHECK", cap: 65, active: false });
  const softened3 = softenDcfRealityGate(g1Inactive, qualified);
  check("Inaktives DCF_REALITY_CHECK → unverändert trotz qualifies", softened3 === g1Inactive);

  // §17.5-Tabelle: PRICING_POWER NIEMALS milderbar
  const gPP = mkGate({ id: "PRICING_POWER", cap: GATE_CAPS.PRICING_POWER });
  const softenedPP = softenDcfRealityGate(gPP, qualified);
  check("PRICING_POWER NIEMALS milderbar (Anti-Bias-Garantie)", softenedPP === gPP && softenedPP.cap === 55);

  // RELATIVE_GROWTH NIEMALS milderbar
  const gRG = mkGate({ id: "RELATIVE_GROWTH", cap: GATE_CAPS.RELATIVE_GROWTH });
  const softenedRG = softenDcfRealityGate(gRG, qualified);
  check("RELATIVE_GROWTH NIEMALS milderbar (Anti-Bias-Garantie)", softenedRG === gRG && softenedRG.cap === 60);

  // INVENTORY NIEMALS milderbar
  const gInv = mkGate({ id: "INVENTORY", cap: GATE_CAPS.INVENTORY });
  const softenedInv = softenDcfRealityGate(gInv, qualified);
  check("INVENTORY NIEMALS milderbar", softenedInv === gInv && softenedInv.cap === 70);

  // REGULATORY_EXPOSURE NIEMALS milderbar
  const gReg = mkGate({ id: "REGULATORY_EXPOSURE", cap: 55, severity: "hard" });
  const softenedReg = softenDcfRealityGate(gReg, qualified);
  check("REGULATORY_EXPOSURE NIEMALS milderbar", softenedReg === gReg && softenedReg.cap === 55 && softenedReg.severity === "hard");

  // softenGatesForFiscalMegatrend — Batch: nur DCF_REALITY_CHECK verändert sich
  const gates = [gPP, gRG, g1, gInv, gReg];
  const batch = softenGatesForFiscalMegatrend(gates, qualified);
  check("Batch: PRICING_POWER unverändert", batch[0].cap === 55);
  check("Batch: RELATIVE_GROWTH unverändert", batch[1].cap === 60);
  check("Batch: DCF_REALITY_CHECK gemildert (65→75)", batch[2].cap === 75);
  check("Batch: INVENTORY unverändert", batch[3].cap === 70);
  check("Batch: REGULATORY_EXPOSURE unverändert", batch[4].cap === 55);
}

// ─── §17.8 Gegenüberstellung — Szenario-Tests aus der Tabelle ─────────────────
console.log("\n§17.8 Gegenüberstellung (Szenario-Integrationstests)");
{
  const asOf = "2026-01-01";

  // AI-Capex-Hype, Orders noch dünn: fiscal nicht qualifiziert → DCF_REALITY bleibt voll (65)
  const aiCapexCatalysts: Catalyst[] = [mkCatalyst({ name: "AI-Capex Hyperscaler", type: "ai-capex" as any })];
  const fiscalAI = fiscalMegatrendQualifies(aiCapexCatalysts, asOf);
  const dcfGateAI = mkGate({ id: "DCF_REALITY_CHECK", cap: 65 });
  const softenedAI = softenDcfRealityGate(dcfGateAI, fiscalAI);
  check("AI-Capex-Hype: DCF_REALITY bleibt bei Cap 65 (Anti-Bias Pflicht)", softenedAI.cap === 65, JSON.stringify(softenedAI));

  // Rüstung nach NATO-2%-Beschluss, Backlog sichtbar: fiscal qualifiziert → DCF_REALITY 65→75, PP/SHARE unverändert
  const defenseCatalysts: Catalyst[] = [mkCatalyst()];
  const fiscalDefense = fiscalMegatrendQualifies(defenseCatalysts, asOf);
  const dcfGateDefense = mkGate({ id: "DCF_REALITY_CHECK", cap: 65 });
  const ppGateDefense = mkGate({ id: "PRICING_POWER", cap: 55 });
  const softenedDefenseDcf = softenDcfRealityGate(dcfGateDefense, fiscalDefense);
  const softenedDefensePP = softenDcfRealityGate(ppGateDefense, fiscalDefense);
  check("Rüstung/NATO: DCF_REALITY 65→75", softenedDefenseDcf.cap === 75, JSON.stringify(softenedDefenseDcf));
  check("Rüstung/NATO: PRICING_POWER unverändert bei 55", softenedDefensePP.cap === 55, JSON.stringify(softenedDefensePP));

  // Rüstung, aber Marge bricht + Share-Loss: Fiscal hilft PP/SHARE nicht — Endergebnis via applyGates prüfen
  const finalScoreResult = applyGates(70, 1.0, [
    softenedDefenseDcf,                       // 75, warn
    mkGate({ id: "PRICING_POWER", cap: 55, severity: "hard" }), // Marge bricht → hart gedeckelt
  ]);
  check("Rüstung + Margenbruch: finalScore trotz Fiscal-Ausnahme bei 55 gedeckelt (PP dominiert)", finalScoreResult.score === 55 && finalScoreResult.cappedBy?.id === "PRICING_POWER", JSON.stringify(finalScoreResult));
}

// ─── fiscalMegatrendConflictText ───────────────────────────────────────────────
console.log("\nfiscalMegatrendConflictText");
{
  const text = fiscalMegatrendConflictText();
  check("Conflict-Text enthält 'Fiscal-Megatrend aktiv'", text.includes("Fiscal-Megatrend aktiv"));
  check("Conflict-Text enthält Hinweis auf Bilanz-/Order-Risiko", text.includes("Bilanz-/Order-Risiko"));
}

console.log(failed === 0 ? "\n✅ Alle Scoring-Gates-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
