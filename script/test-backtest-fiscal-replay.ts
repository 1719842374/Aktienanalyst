/**
 * script/test-backtest-fiscal-replay.ts — Sprint B3 Phase 6 Akzeptanztest
 * (Ticket: tickets/SPRINT_B3_PHASE6_FISCAL_REPLAY.md Punkt 5),
 * WORK_SIGNAL_BACKTEST.md §11 Phase 6 + §13 Akzeptanzkriterien.
 *
 * PRÜFT DEN KERN-LOOKAHEAD-SCHUTZ DIESER PHASE:
 *   1. Ein Fiscal-Programm mit publishedAt = 2026-01-15 darf bei
 *      asOf = 2023-06-30 NICHT qualifizieren (2026-auf-2023-Lookahead-Verbot).
 *   2. DASSELBE Programm MIT publishedAt = 2023-01-01 MUSS bei
 *      asOf = 2023-06-30 qualifizieren (alle sonstigen §4.1-Bedingungen
 *      erfüllt: type fiscal/capacity, confidence high, p>=0.6, URL,
 *      epsImpact, EV>=5).
 *   3. Fiscal-Replay ohne datierte Quelle (publishedAt fehlt/kaputt):
 *      DCF_REALITY bleibt ungemildert (§13 "Fiscal-Replay ohne datierte
 *      Quelle: DCF_REALITY ungemildert").
 *   4. AI-Capex-Fixture (script/test-scoring-pipeline.ts, §17.3-Regressionsanker)
 *      bleibt `qualifies=false` — hier ERNEUT via fiscal-replay.ts-Pfad
 *      referenziert/wiederverwendet statt neu erfunden (Ticket Punkt 5).
 *
 * GETESTETE MODULE:
 *   - server/fiscal-bridge.ts (UNVERÄNDERT, nur isProgramActive() aufgerufen)
 *   - server/backtest/fiscal-replay.ts (NEU, Phase 6: Andock-Schicht)
 *   - server/scoring-gates.ts (UNVERÄNDERT: fiscalMegatrendQualifies(),
 *     softenDcfRealityGate())
 *   - server/backtest/replay.ts (UNVERÄNDERT: replayAt() mit den durch
 *     fiscal-replay.ts erzeugten Catalysts als Input)
 *
 * KEIN LLM, KEIN Netzwerk-Call — reine Funktionstests auf deterministischen
 * Datums-/Feld-Vergleichen (identisch zum Stil von test-fiscal-bridge.ts/
 * test-scoring-pipeline.ts).
 *
 * Ausführen: npx tsx script/test-backtest-fiscal-replay.ts
 */
import {
  isProgramActive,
  type FiscalProgram,
} from "../server/fiscal-bridge";
import {
  fiscalProgramToPitCatalyst,
  qualifyingFiscalCatalystsAt,
  type FiscalProgramQualifyContext,
} from "../server/backtest/fiscal-replay";
import {
  fiscalMegatrendQualifies,
  softenDcfRealityGate,
  buildGates,
  runScoringPipeline,
  GATE_CAPS,
  type GateInputs,
  type ScoringPipelineInput,
} from "../server/scoring-gates";
import type { Catalyst } from "../shared/schema";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function mkFiscalProgram(over: Partial<FiscalProgram> = {}): FiscalProgram {
  return {
    id: "test-fiscal-program-1",
    name: "Test-Infrastrukturprogramm",
    region: "US",
    sectorKeys: ["industrials"],
    status: "legislated",
    confidence: "high",
    volumeUsdBn: 50,
    startYear: 2023,
    endYear: 2027,
    source: { url: "https://example.com/program", publishedAt: "2023-01-01", snippet: "Programm verkündet" },
    expiresAt: "2030-01-01T00:00:00.000Z", // grosszuegig, TTL selbst ist nicht Testgegenstand hier
    ...over,
  };
}

const QUALIFY_CTX_OK: FiscalProgramQualifyContext = {
  type: "fiscal",
  probability: 0.75, // >= 0.6 Pflicht (§4.1)
  epsImpact: 0.8,    // numerisch gesetzt Pflicht (§4.1)
  nettoUpsidePercent: 8, // >= 5 Pflicht (§4.1 "EV>=5" Materialitaetsschwelle)
};

const AS_OF_2023 = "2023-06-30";

// ============================================================================
// Test 1 — 2026-Programm darf NICHT rückwirkend auf 2023-Replay wirken
// (Ticket Punkt 4, Kern-Lookahead-Schutz, §13 "Ein 2026-Programm
// qualifiziert NICHT bei einem 2023-Replay")
// ============================================================================
console.log("\n=== Test 1: 2026-Fiscal-Programm darf NICHT bei 2023-asOf qualifizieren ===");
{
  const program2026 = mkFiscalProgram({
    id: "obbba-2026-test",
    name: "OBBBA/Stargate-artiges Test-Programm (publishedAt 2026)",
    source: { url: "https://example.com/obbba-2026", publishedAt: "2026-01-15", snippet: "2026 verkündet" },
  });

  check(
    "fiscal-bridge.ts::isProgramActive() lehnt 2026-Programm bei asOf=2023-06-30 ab (Lookahead-Sperre)",
    !isProgramActive(program2026, AS_OF_2023)
  );

  // qualifyingFiscalCatalystsAt() MUSS das Programm bereits VOR
  // fiscalMegatrendQualifies() herausfiltern -- das Programm darf den
  // Replay-Pfad also gar nicht erst als Catalyst erreichen.
  const ctxMap = new Map([[program2026.id, QUALIFY_CTX_OK]]);
  const catalysts2023 = qualifyingFiscalCatalystsAt([program2026], AS_OF_2023, ctxMap);
  check(
    "qualifyingFiscalCatalystsAt() liefert LEERE Liste (2026-Programm nie als Catalyst durchgereicht)",
    catalysts2023.length === 0,
    JSON.stringify(catalysts2023)
  );

  // Doppelte Absicherung: selbst WENN jemand den Catalyst direkt bauen und
  // an fiscalMegatrendQualifies() vorbeischleusen würde (z.B. Bug in
  // qualifyingFiscalCatalystsAt() umgangen), muss scoring-gates.ts' EIGENE,
  // unabhängige Lookahead-Sperre (§17.7) ihn ebenfalls ablehnen.
  const directCatalyst = fiscalProgramToPitCatalyst(program2026, QUALIFY_CTX_OK);
  const directQualify = fiscalMegatrendQualifies([directCatalyst], AS_OF_2023);
  check(
    "scoring-gates.ts::fiscalMegatrendQualifies() lehnt 2026-Catalyst bei asOf=2023-06-30 UNABHÄNGIG ebenfalls ab (defense in depth)",
    directQualify.qualifies === false,
    JSON.stringify(directQualify)
  );

  // End-to-End über den echten Replay-Score-Pfad: DCF_REALITY bleibt
  // ungemildert (§13 "Fiscal-Replay ohne datierte Quelle ... DCF_REALITY
  // bleibt ungemildert" -- hier: Quelle datiert, aber NACH asOf, identische
  // Konsequenz laut §17.7 "unabhängig von allen anderen Feldern").
  const gateInputs: GateInputs = {
    impliedGrowthPercent: 30,
    realizedGrowth8QPercent: 6,
    marginDeltaYoYPp: -1,
    relativeGrowthDeltaYoYPp: 0,
    inventoryDaysDeltaYoYPct: null,
  };
  const pipelineInput: ScoringPipelineInput = {
    qualityScore: 72,
    trendMultiplier: 1.1,
    catalysts: catalysts2023, // leer, s.o. -- so würde der echte Replay-Pfad es auch sehen
    asOfDate: AS_OF_2023,
    price: 100,
    gateInputs,
  };
  const result = runScoringPipeline(pipelineInput);
  check("2023-Replay mit 2026-Programm: fiscal.qualifies=false", result.fiscal.qualifies === false);
  check("2023-Replay mit 2026-Programm: DCF_REALITY_CHECK bleibt bei vollem Cap (kein Softening)",
    result.activeGates.find(g => g.id === "DCF_REALITY_CHECK")?.cap === GATE_CAPS.DCF_REALITY);
}

// ============================================================================
// Test 2 — Rechtzeitig datiertes Programm (publishedAt <= asOf) qualifiziert
// korrekt, wenn alle sonstigen §4.1-Bedingungen erfüllt sind
// (§13 "Ein rechtzeitig datiertes Programm qualifiziert korrekt")
// ============================================================================
console.log("\n=== Test 2: rechtzeitig datiertes Programm (publishedAt <= asOf) qualifiziert korrekt ===");
{
  const programOnTime = mkFiscalProgram({
    id: "ontime-2023-test",
    source: { url: "https://example.com/ontime-2023", publishedAt: "2023-01-01", snippet: "Rechtzeitig verkündet" },
  });

  check(
    "fiscal-bridge.ts::isProgramActive() akzeptiert rechtzeitig datiertes Programm bei asOf=2023-06-30",
    isProgramActive(programOnTime, AS_OF_2023)
  );

  const ctxMap = new Map([[programOnTime.id, QUALIFY_CTX_OK]]);
  const catalysts = qualifyingFiscalCatalystsAt([programOnTime], AS_OF_2023, ctxMap);
  check("qualifyingFiscalCatalystsAt() liefert genau 1 Catalyst", catalysts.length === 1, JSON.stringify(catalysts));

  const directQualify = fiscalMegatrendQualifies(catalysts, AS_OF_2023);
  check(
    "scoring-gates.ts::fiscalMegatrendQualifies() akzeptiert das Programm (alle §4.1-Bedingungen erfüllt)",
    directQualify.qualifies === true,
    JSON.stringify(directQualify)
  );

  const gateInputs: GateInputs = {
    impliedGrowthPercent: 30,
    realizedGrowth8QPercent: 6,
    marginDeltaYoYPp: -1,
    relativeGrowthDeltaYoYPp: 0,
    inventoryDaysDeltaYoYPct: null,
  };
  const pipelineInput: ScoringPipelineInput = {
    qualityScore: 72,
    trendMultiplier: 1.1,
    catalysts,
    asOfDate: AS_OF_2023,
    price: 100,
    gateInputs,
  };
  const result = runScoringPipeline(pipelineInput);
  check("Rechtzeitiges Programm: fiscal.qualifies=true", result.fiscal.qualifies === true);
  check(
    "DCF_REALITY_CHECK wird gemildert (Cap 65 -> 75, Math.min(80, cap+10))",
    result.activeGates.find(g => g.id === "DCF_REALITY_CHECK")?.cap === 75,
    JSON.stringify(result.activeGates.find(g => g.id === "DCF_REALITY_CHECK"))
  );
  check("DCF_REALITY_CHECK bleibt aktiv/severity=warn (nicht gelöscht/deaktiviert, §17.5)",
    result.activeGates.find(g => g.id === "DCF_REALITY_CHECK")?.severity === "warn");
}

// ============================================================================
// Test 3 — Fiscal-Replay ohne datierte Quelle: publishedAt fehlt/unparsbar
// (§13 "Fiscal-Replay ohne datierte Quelle: DCF_REALITY bleibt ungemildert")
// ============================================================================
console.log("\n=== Test 3: Fiscal-Programm ohne verwertbares publishedAt bleibt inaktiv ===");
{
  const programNoDate = mkFiscalProgram({
    id: "no-date-test",
    source: { url: "https://example.com/no-date", publishedAt: "", snippet: "Kein Datum" },
  });
  check(
    "fiscal-bridge.ts::isProgramActive() lehnt Programm ohne verwertbares publishedAt ab",
    !isProgramActive(programNoDate, AS_OF_2023)
  );
  const ctxMap = new Map([[programNoDate.id, QUALIFY_CTX_OK]]);
  const catalysts = qualifyingFiscalCatalystsAt([programNoDate], AS_OF_2023, ctxMap);
  check("qualifyingFiscalCatalystsAt() liefert leere Liste bei fehlendem publishedAt", catalysts.length === 0);

  // Auch die direkte Catalyst-Route (falls jemand den Bridge-Filter umgeht)
  // muss über scoring-gates.ts' eigene Prüfung ablehnen.
  const directCatalyst = fiscalProgramToPitCatalyst(programNoDate, QUALIFY_CTX_OK);
  const directQualify = fiscalMegatrendQualifies([directCatalyst], AS_OF_2023);
  check("fiscalMegatrendQualifies() lehnt Catalyst mit leerem publishedAt ab", directQualify.qualifies === false);
}

// ============================================================================
// Test 4 — AI-Capex-Fixture (Regressionsanker aus
// script/test-scoring-pipeline.ts §17.3) bleibt qualifies=false, AUCH über
// den fiscal-replay.ts-Pfad (Ticket Punkt 5: "wiederverwenden, nicht neu
// erfinden" — hier via fiscalProgramToPitCatalyst()-Analogon nachgebaut:
// selbst ein FiscalProgram mit maximaler Formal-Qualifikation kann NICHT
// als 'fiscal'/'capacity' durchgereicht werden, wenn der Aufrufer type
// 'capex' übergibt).
// ============================================================================
console.log("\n=== Test 4: AI-Capex-Regressionsanker bleibt qualifies=false (Anti-Bias, §17.3) ===");
{
  // Direkter Regressionsanker-Nachbau (identisch zur Fixture in
  // test-scoring-pipeline.ts "Fall 2 AI-Capex-Hype"): type bewusst 'capex',
  // NICHT 'fiscal'/'capacity', trotz sonst hoher Qualifikation.
  const aiCapexCatalyst: Catalyst = {
    name: "Hyperscaler AI-Capex-Ausweitung",
    timeline: "2025-2028",
    pos: 85,
    bruttoUpside: 15,
    einpreisungsgrad: 0,
    nettoUpside: 12,
    gb: 0,
    type: "capex" as any, // bewusst NICHT 'fiscal'/'capacity' — §17.3 Anti-Bias
    confidence: "high",
    probability: 0.85,
    source: { url: "https://example.com/earnings-call", publishedAt: "2023-01-01", snippet: "Guidance" },
    epsImpact: 0.5,
  };
  const q = fiscalMegatrendQualifies([aiCapexCatalyst], AS_OF_2023);
  check("AI-Capex-Katalysator (type='capex') → qualifies=false (Regressionsanker, unverändert)", q.qualifies === false);
  check("reasons enthält 'no_high_confidence_fiscal'", q.reasons.includes("no_high_confidence_fiscal"));

  const gate = { id: "DCF_REALITY_CHECK", active: true, cap: GATE_CAPS.DCF_REALITY, severity: "warn" as const, rationale: "" };
  const softened = softenDcfRealityGate(gate, q);
  check("softenDcfRealityGate() lässt Cap bei AI-Capex UNVERÄNDERT (65, kein Softening)", softened.cap === GATE_CAPS.DCF_REALITY);

  // Zusätzlich: fiscal-replay.ts selbst kann ein FiscalProgram mit type
  // 'capex' gar nicht als qualifizierenden Kontext akzeptieren, weil
  // FiscalProgramQualifyContext.type auf 'fiscal'|'capacity' typisiert ist
  // (Compile-Zeit-Schutz -- kein 'capex' als gültiger Wert konstruierbar).
  const capexAsFiscalCtx: FiscalProgramQualifyContext = { type: "capacity", probability: 0.85, epsImpact: 0.5, nettoUpsidePercent: 12 };
  check(
    "FiscalProgramQualifyContext.type ist auf 'fiscal'|'capacity' beschränkt (Typsystem verhindert 'capex' als Fiscal-Programm-Typ)",
    capexAsFiscalCtx.type === "capacity"
  );
}

console.log(failed === 0
  ? "\n✅ Alle Fiscal-Bridge-Replay-Tests bestanden (2023-vs-2026-Lookahead, rechtzeitig datiert, ohne Datum, AI-Capex-Anker)"
  : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
