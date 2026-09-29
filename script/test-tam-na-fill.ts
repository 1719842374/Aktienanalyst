// script/test-tam-na-fill.ts
//
// KI-N/A-Fill für Segment-TAM. Prüft Validierung, lokale Ableitung von
// marketShare/vs-TAM, fail-closed ohne LLM, und dass der MSFT-Faktenpfad
// (Coverage ~59%, matched Zellen) unangetastet bleibt.
// Lauf: `npx tsx script/test-tam-na-fill.ts`

import { generateTAMAnalysis } from "../server/sector-data";
import { requestTamNaFills } from "../server/tam-na-fill";
import {
  catalogCoverageNote,
  deriveOutperforming,
  deriveTamShare,
  validateTamNaFills,
} from "../shared/tam-na-fill";

let passed = 0;
let failed = 0;

function expect(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
    console.log(`       expected: ${JSON.stringify(expected)}`);
    console.log(`       actual:   ${JSON.stringify(actual)}`);
  }
}

function expectTrue(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
  }
}

console.log("=== validateTamNaFills ===");

{
  const requested = [
    { segmentName: "Server", segmentRevenue: 129.4, segmentGrowth: 31.5 },
    { segmentName: "Other / nicht segmentiert", segmentRevenue: 8.3, segmentGrowth: null },
  ];
  const fills = validateTamNaFills(requested, {
    fills: [
      { segmentName: "Server", tamSize: 400, tamCAGR: 8, tamLabel: "Enterprise Infrastructure", tamSource: "IDC", marketShare: 1, segmentGrowth: 99, outperforming: false },
      { segmentName: "Not A Segment", tamSize: 50, tamCAGR: 5, tamLabel: "X", tamSource: "Y" },
      { segmentName: "Other / nicht segmentiert", tamSize: 0, tamCAGR: 4, tamLabel: "Other", tamSource: "n/a" },
      { segmentName: "Other / nicht segmentiert", tamSize: 80, tamCAGR: 3, tamLabel: "Residual IT", tamSource: "Schätzung" },
    ],
  });
  expect(fills.length, 2, "gültige Fills: Server + Other; tamSize 0 und fremder Name fallen weg");
  expect(fills[0].segmentName, "Server", "Server bleibt im Request-Namen");
  expect(fills[0].marketShare, deriveTamShare(129.4, 400), "marketShare aus Rev/TAM, nicht aus LLM (1)");
  expect(fills[0].outperforming, true, "vs-TAM aus echtem YoY 31.5 > CAGR 8, nicht aus LLM false");
  expect(fills[0].marketShare === 1, false, "LLM-marketShare 1 wird nicht übernommen");
  expect(fills[1].outperforming, null, "Other ohne Vorjahreszahl -> outperforming null (kein erfundenes YoY)");
  expectTrue(!("segmentGrowth" in fills[1]), "Fill enthält kein segmentGrowth-Feld");
}

{
  const fills = validateTamNaFills(
    [{ segmentName: "Server", segmentRevenue: 10, segmentGrowth: null }],
    { fills: [{ segmentName: "server", tamSize: 100, tamCAGR: 5, tamLabel: "Infra", tamSource: "Gartner" }] },
  );
  expect(fills[0]?.segmentName, "Server", "Name-Match ist case-insensitiv, kanonischer Request-Name bleibt");
  expect(fills[0]?.outperforming, null, "null-Wachstum bleibt null");
}

{
  const fills = validateTamNaFills(
    [{ segmentName: "Server", segmentRevenue: 10, segmentGrowth: 4 }],
    { fills: [{ segmentName: "Server", tamSize: -5, tamCAGR: 5, tamLabel: "X", tamSource: "Y" }] },
  );
  expect(fills.length, 0, "tamSize <= 0 wird verworfen");
}

console.log("\n=== catalog coverage note ===");
expect(catalogCoverageNote(58.5), "Catalog-Coverage unverändert 59%", "58.5% rundet wie der Banner auf 59, ohne den Fakt anzuheben");
expect(catalogCoverageNote(null), "Catalog-Coverage unverändert", "fehlende Coverage erfindet keine Prozentzahl");
expect(deriveOutperforming(null, 8), null, "deriveOutperforming(null) ist null");

console.log("\n=== requestTamNaFills fail-closed ===");

{
  let calls = 0;
  const result = await requestTamNaFills({
    ticker: "MSFT",
    coveragePct: 58.5,
    segments: [{ segmentName: "Server", segmentRevenue: 129.4, segmentGrowth: 31.5, matched: false }],
  }, {
    isLLMAvailable: () => false,
    callLLMJson: async () => { calls++; return { data: { fills: [] }, modelUsed: "x" }; },
  });
  expect(calls, 0, "ohne LLM wird callLLMJson nicht aufgerufen");
  expect(result.ok, false, "fail-closed: ok false");
  if (!result.ok) {
    expect(result.status, 503, "fail-closed: 503");
    expect(result.code, "LLM_UNAVAILABLE", "fail-closed: LLM_UNAVAILABLE");
  }
}

{
  const result = await requestTamNaFills({
    ticker: "MSFT",
    coveragePct: 58.5,
    segments: [{ segmentName: "Server", segmentRevenue: 129.4, segmentGrowth: 31.5, matched: false }],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => null,
  });
  expect(result.ok, false, "leere LLM-Antwort ist kein Fill");
  if (!result.ok) expect(result.code, "LLM_FAILED", "LLM_FAILED lässt die Tabelle unverändert (kein Fill)");
}

{
  const result = await requestTamNaFills({
    ticker: "MSFT",
    coveragePct: 58.5,
    segments: [
      { segmentName: "XBOX", segmentRevenue: 21.8, segmentGrowth: null, matched: true },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => { throw new Error("should not be called"); },
  });
  expect(result.ok, false, "matched-only Request wird nicht an das LLM gegeben");
  if (!result.ok) expect(result.status, 400, "matched-only -> 400");
}

console.log("\n=== MSFT fact path stays put ===");

{
  const msftSegments = [
    { name: "Server", revenue: 129.4e9, percentage: 39.0, growth: 31.5 },
    { name: "Microsoft 365 Commercial", revenue: 102.0e9, percentage: 30.7, growth: 16.2 },
    { name: "XBOX", revenue: 21.8e9, percentage: 6.6, growth: null },
    { name: "Linked In", revenue: 19.8e9, percentage: 6.0, growth: null },
    { name: "Windows", revenue: 17.1e9, percentage: 5.1, growth: null },
    { name: "Search Advertising", revenue: 15.2e9, percentage: 4.6, growth: null },
    { name: "Microsoft 365 Consumer", revenue: 9.2e9, percentage: 2.8, growth: null },
    { name: "Dynamics", revenue: 9.0e9, percentage: 2.7, growth: null },
  ];
  const fact = generateTAMAnalysis("Technology", "Software", "Microsoft ... Azure ... cloud ...", 331.8e9, 17.8, msftSegments);
  const before = JSON.stringify(fact);
  expectTrue(fact.quality === "unreliable", "MSFT quality bleibt unreliable");
  expectTrue(fact.tamTotal === null, "MSFT tamTotal bleibt null");
  expectTrue(typeof fact.coveragePct === "number" && fact.coveragePct < 70, `MSFT coverage bleibt < 70 (ist ${fact.coveragePct})`);
  expect(catalogCoverageNote(fact.coveragePct), "Catalog-Coverage unverändert 59%", "Meta zeigt ~59% und hebt Coverage nicht an");

  const matchedBefore = JSON.stringify((fact.segments ?? []).filter((s: { matched?: boolean }) => s.matched !== false));
  const unmatched = (fact.segments ?? []).filter((s: { matched?: boolean }) => s.matched === false);

  const result = await requestTamNaFills({
    ticker: "MSFT",
    companyName: "Microsoft",
    sector: "Technology",
    industry: "Software",
    coveragePct: fact.coveragePct,
    segments: unmatched.map((s: { segmentName: string; segmentRevenue: number; segmentGrowth: number | null; segmentShare: number; matched?: boolean }) => ({
      segmentName: s.segmentName,
      segmentRevenue: s.segmentRevenue,
      segmentGrowth: s.segmentGrowth,
      segmentShare: s.segmentShare,
      matched: false,
    })),
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => ({
      modelUsed: "test-model",
      data: {
        fills: [
          { segmentName: "Server", tamSize: 500, tamCAGR: 7, tamLabel: "Enterprise IT", tamSource: "IDC", marketShare: 99, segmentGrowth: 0 },
          { segmentName: "XBOX", tamSize: 400, tamCAGR: 4, tamLabel: "Should drop", tamSource: "nope" },
          { segmentName: "Other / nicht segmentiert", tamSize: 90, tamCAGR: 3, tamLabel: "Other", tamSource: "Schätzung", segmentGrowth: 12 },
        ],
      },
    }),
  });

  expect(JSON.stringify(fact), before, "generateTAMAnalysis-Objekt wird durch den KI-Fill nicht mutiert");
  expect(
    JSON.stringify((fact.segments ?? []).filter((s: { matched?: boolean }) => s.matched !== false)),
    matchedBefore,
    "matched Zellen bleiben byte-identisch",
  );
  expectTrue(result.ok === true, "gültiger KI-Fill liefert ok");
  if (result.ok) {
    expect(result.coveragePct, fact.coveragePct, "Response-coveragePct ist der Faktwert, nicht angehoben");
    expect(result.coverageNote, catalogCoverageNote(fact.coveragePct), "coverageNote aus dem Faktwert");
    expectTrue(!result.fills.some((f) => f.segmentName === "XBOX"), "XBOX (matched, nicht im Request) wird verworfen");
    const server = result.fills.find((f) => f.segmentName === "Server");
    expectTrue(!!server && server.marketShare === deriveTamShare(129.4, 500), "Server-Share lokal aus 129.4/500");
    expect(server?.outperforming, deriveOutperforming(31.5, 7), "Server vs-TAM aus berichtetem 31.5, nicht aus LLM-0");
    const other = result.fills.find((f) => f.segmentName === "Other / nicht segmentiert");
    expect(other?.outperforming, null, "Other-YoY bleibt n/a trotz LLM-segmentGrowth 12");
    expectTrue(fact.tamCAGR === null && fact.quality === "unreliable", "gewichteter CAGR und quality bleiben nach dem Fill unverändert");
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
