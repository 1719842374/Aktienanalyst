/**
 * Unit-Tests für die Regulatory-Exposure-Logik (WORK2.md §8.5–§8.8).
 * Läuft ohne Netzwerk/LLM — reine Funktionstests.
 *
 * Ausführen: npx tsx script/test-regulatory.ts
 */
import {
  calcRegulatoryEpsImpact, applyConfidenceFilter, matrixDecision,
  buildRegulatoryGate, buildRegulatorySearchQueries,
  type RegulatoryExposureRaw, type RegulatoryExposureScored,
} from "../server/regulatory";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function mkExposure(over: Partial<RegulatoryExposureRaw> = {}): RegulatoryExposureRaw {
  return {
    country: "USA",
    regulationAxis: "price_regulation",
    title: "Testregime",
    description: "Test",
    revenueShareInCountry: 0.5,
    estimatedImpactOnSales: -0.08,
    probability: 0.7,
    timeHorizon: "0-12m",
    source: { url: "https://example.gov/rule", publishedAt: "2026-05", snippet: "…" },
    confidence: "high",
    ...over,
  };
}

// ─── §8.5 calcRegulatoryEpsImpact ─────────────────────────────────────────────
console.log("\n§8.5 calcRegulatoryEpsImpact");
{
  // Handrechnung: Revenue 100 Mrd × Share 0.5 × Impact -0.08 = -4 Mrd Umsatz
  // × Margin 0.4 = -1.6 Mrd EBIT × (1-0.21) = -1.264 Mrd NI / 1 Mrd Aktien
  // = -1.264 $ × p 0.7 × decay 1.0 = -0.8848 → gerundet -0.88
  const eps = calcRegulatoryEpsImpact(mkExposure(), {
    totalRevenue: 100e9, operatingMargin: 0.4, sharesOutstanding: 1e9,
  });
  check("EPS-Formel exakt (-0.88 $)", eps === -0.88, `got ${eps}`);

  // Time-Decay: structural = 0.40 → -1.264 × 0.7 × 0.40 = -0.354 → -0.35
  const epsStruct = calcRegulatoryEpsImpact(mkExposure({ timeHorizon: "structural" }), {
    totalRevenue: 100e9, operatingMargin: 0.4, sharesOutstanding: 1e9,
  });
  check("Time-Decay structural (0.40)", epsStruct === -0.35, `got ${epsStruct}`);

  check("null bei fehlendem Impact", calcRegulatoryEpsImpact(mkExposure({ estimatedImpactOnSales: null }), { totalRevenue: 100e9, operatingMargin: 0.4, sharesOutstanding: 1e9 }) === null);
  check("null bei Revenue 0 (kein NaN)", calcRegulatoryEpsImpact(mkExposure(), { totalRevenue: 0, operatingMargin: 0.4, sharesOutstanding: 1e9 }) === null);
}

// ─── §8.6 Confidence-Filter ───────────────────────────────────────────────────
console.log("\n§8.6 applyConfidenceFilter");
{
  const { kept, discarded } = applyConfidenceFilter([
    mkExposure(),                                        // bleibt
    mkExposure({ probability: 0.2 }),                    // verworfen: p < 0.25
    mkExposure({ source: { url: "", publishedAt: "", snippet: "" } }), // verworfen: keine Quelle
    mkExposure({ confidence: "low" }),                   // bleibt (nur Badge, aber nicht verworfen)
  ]);
  check("2 behalten, 2 verworfen", kept.length === 2 && discarded === 2, `kept=${kept.length}, discarded=${discarded}`);
}

// ─── §8.7 Test-Matrix ─────────────────────────────────────────────────────────
console.log("\n§8.7 matrixDecision");
{
  const r1 = matrixDecision("high", -0.08, 0.70);
  check("Nr 1: high/8%/0.70 → Cap 55 hard", r1.gate && r1.cap === 55 && r1.severity === "hard" && r1.row === 1, JSON.stringify(r1));
  const r2 = matrixDecision("high", -0.04, 0.55);
  check("Nr 2: high/4%/0.55 → Cap 65 warn", r2.gate && r2.cap === 65 && r2.severity === "warn" && r2.row === 2, JSON.stringify(r2));
  const r3 = matrixDecision("medium", 0.06, 0.60);
  check("Nr 3: medium/6%/0.60 → Cap 65 warn (Betrag zählt, auch positiv)", r3.gate && r3.cap === 65 && r3.row === 3, JSON.stringify(r3));
  const r4 = matrixDecision("medium", -0.035, 0.55);
  check("Nr 4: medium/3.5%/0.55 → Cap 70 warn", r4.gate && r4.cap === 70 && r4.row === 4, JSON.stringify(r4));
  const r5 = matrixDecision("low", -0.10, 0.40);
  check("Nr 5: low → kein Gate", !r5.gate && r5.row === 5, JSON.stringify(r5));
  const r6 = matrixDecision("high", -0.01, 0.80);
  check("Nr 6: <3% Impact → kein Gate", !r6.gate && r6.row === 6, JSON.stringify(r6));
  const r7 = matrixDecision("high", -0.08, 0.20);
  check("Nr 7: p<0.25 → kein Gate", !r7.gate && r7.row === 7, JSON.stringify(r7));
  const rEdge = matrixDecision("high", -0.06, 0.50);
  check("high/6%/p=0.50 → kein Gate (Nr 1 braucht p≥0.55, Nr 2 braucht <5% Impact)", !rEdge.gate, JSON.stringify(rEdge));
}

// ─── §8.8 buildRegulatoryGate ─────────────────────────────────────────────────
console.log("\n§8.8 buildRegulatoryGate");
{
  const scored = (over: Partial<RegulatoryExposureScored>[]): RegulatoryExposureScored[] =>
    over.map(o => ({ ...mkExposure(), epsImpact: -0.5, material: true, badgeOnly: false, ...o }));

  // Einzelnes hartes Exposure (Matrix Nr 1)
  const g1 = buildRegulatoryGate(scored([{}]));
  check("Hartes Einzel-Exposure → Gate cap 55 hard", g1?.active === true && g1.cap === 55 && g1.severity === "hard", JSON.stringify(g1));
  check("Rationale nennt entdeckten Titel", g1?.rationale.includes("Testregime") === true, g1?.rationale);

  // Kein materielles Exposure → kein Gate
  const g2 = buildRegulatoryGate(scored([{ material: false }]));
  check("Nicht-material → kein Gate", g2 === null);

  // Kumulierung: 2 × (Share 0.5 × Impact -0.04 × p 0.9) = 2 × 0.018 = 0.036 < 0.07 → kein Kumulier-Override
  // aber einzeln: high/4%/0.9 → Nr 2 → Cap 65 warn... epsImpact klein halten damit EPS-Regeln nicht greifen
  const g3 = buildRegulatoryGate(scored([
    { estimatedImpactOnSales: -0.04, probability: 0.9, epsImpact: -0.2 },
    { estimatedImpactOnSales: -0.04, probability: 0.9, epsImpact: -0.2 },
  ]));
  check("Unter 7% kumuliert → Cap 65 warn bleibt", g3?.cap === 65 && g3.severity === "warn", JSON.stringify(g3));

  // Kumulierung ≥ 7%: 2 × (0.5 × -0.08 × 0.9) = 2 × 0.036 = 0.072 → Cap 55 hard
  const g4 = buildRegulatoryGate(scored([
    { estimatedImpactOnSales: -0.08, probability: 0.9, epsImpact: -0.2 },
    { estimatedImpactOnSales: -0.08, probability: 0.9, epsImpact: -0.2 },
  ]));
  check("Kumulierung ≥7% → immer Cap 55 hard", g4?.cap === 55 && g4.severity === "hard", JSON.stringify(g4));
}

// ─── §8.4 Query-Builder (Anti-Hardcoding) ─────────────────────────────────────
console.log("\n§8.4 buildRegulatorySearchQueries");
{
  const queries = buildRegulatorySearchQueries({
    sector: "Healthcare", industry: "Pharma",
    topCountries: [
      { countryOrRegion: "USA", percentage: 55 },
      { countryOrRegion: "EU", percentage: 30 },
      { countryOrRegion: "Rest", percentage: 3 }, // < 5 % → ignoriert
    ],
  });
  check("8 Achsen × 2 materielle Länder = 16 Queries", queries.length === 16, `got ${queries.length}`);
  check("Länder < 5 % Umsatz ignoriert", !queries.some(q => q.includes("Rest")));
  // Anti-Hardcoding-Regel: keine konkreten Programmnamen in den Queries
  const forbidden = ["Medicaid", "IRA", "CBAM", "Section 301", "CHIPS"];
  check("Keine hardcodierten Programmnamen", !queries.some(q => forbidden.some(f => q.includes(f))));
  check("Branche + Land im Kontext", queries.some(q => q.includes("Pharma") && q.includes("USA")));
}

console.log(failed === 0 ? "\n✅ Alle Regulatory-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
