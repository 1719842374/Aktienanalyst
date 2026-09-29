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
  countKiFilledCells,
  countScopeRestNa,
  deriveOutperforming,
  deriveTamShare,
  kiFillMetaLine,
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

{
  const fills = validateTamNaFills(
    [{ segmentName: "Upstream", segmentRevenue: 20, segmentGrowth: null, matched: true, tamSize: 80, tamCAGR: 3 }],
    { fills: [{ segmentName: "Upstream", segmentGrowth: 12, tamSize: 999, marketShare: 50, outperforming: false, confidence: "med", rationale: "YoY-Schätzung" }] },
  );
  expect(fills.length, 1, "matched Zeile mit Wachstum-n/a bekommt einen Fill");
  expect(fills[0].segmentGrowth, 12, "KI-segmentGrowth nur weil Fact-YoY null war");
  expectTrue(!("tamSize" in fills[0]), "Fact-TAM 80 wird nicht durch LLM-tamSize 999 ersetzt");
  expectTrue(!("marketShare" in fills[0]), "LLM-marketShare 50 wird gedroppt");
  expect(fills[0].outperforming, true, "vs-TAM Formel: KI-Wachstum 12 > Fact-CAGR 3, nicht LLM false");
}

{
  const fills = validateTamNaFills(
    [{ segmentName: "Upstream", segmentRevenue: 20, segmentGrowth: null, matched: true, tamSize: 80, tamCAGR: 3 }],
    { fills: [{ segmentName: "Upstream", segmentGrowth: 250, tamSize: 999, tamCAGR: 9, tamLabel: "X", tamSource: "Y" }] },
  );
  expect(fills.length, 0, "segmentGrowth 250 liegt ausserhalb −80…+200 und wird gedroppt; Fact-TAM bleibt");
}

{
  const fills = validateTamNaFills(
    [{ segmentName: "Upstream", segmentRevenue: 20, segmentGrowth: -4, matched: true, tamSize: 80, tamCAGR: 3 }],
    { fills: [{ segmentName: "Upstream", segmentGrowth: 40, tamSize: 10, tamCAGR: 1, tamLabel: "X", tamSource: "Y" }] },
  );
  expect(fills.length, 0, "vorhandenes Fact-YoY wird nicht durch KI ersetzt und Fact-TAM nicht angefasst");
}

console.log("\n=== Formel Anteil am TAM / vs. TAM ===");
expect(deriveTamShare(20, 80), 25, "marketSharePct = 100 * 20 / 80");
expect(deriveTamShare(129.4, 400), Math.round((129.4 / 400) * 10000) / 100, "Rundung bleibt die bestehende Formel");
expect(deriveOutperforming(null, 3), null, "vs-TAM ohne Wachstum ist null");
expect(deriveOutperforming(3, null), null, "vs-TAM ohne CAGR ist null");
expect(deriveOutperforming(3, 3), false, "growth > CAGR, Gleichstand ist nicht Über");
expect(deriveOutperforming(3.1, 3), true, "3.1 > 3 ist Über");
expect(deriveOutperforming(-2, 3), false, "negatives Wachstum unter positiver CAGR ist Unter");

console.log("\n=== Rest-n/a / XOM-ähnlich ===");
{
  const xom = [
    { segmentName: "Upstream", segmentRevenue: 20, segmentGrowth: null, matched: true, tamSize: 4000, tamCAGR: 3 },
    { segmentName: "Downstream", segmentRevenue: 15, segmentGrowth: null, matched: true, tamSize: 2000, tamCAGR: 2 },
  ];
  expectTrue(countScopeRestNa(xom, null) > 0, "matched + Wachstum n/a ist fillable, nicht nur unmatched TAM");
  const partial = validateTamNaFills(xom, {
    fills: [{ segmentName: "Upstream", segmentGrowth: 4, confidence: "low", rationale: "a" }],
  });
  expectTrue(countScopeRestNa(xom, partial) > 0, "Teilfill lässt Downstream-Wachstum n/a");
  const full = validateTamNaFills(xom, {
    fills: [
      { segmentName: "Upstream", segmentGrowth: 4, confidence: "low", rationale: "a" },
      { segmentName: "Downstream", segmentGrowth: 1, confidence: "med", rationale: "b" },
    ],
  });
  expect(countScopeRestNa(xom, full), 0, "beide Wachstum-n/a zu, vs-TAM per Formel zu, Rest-n/a = 0");
  expect(countKiFilledCells(xom, full), 4, "zwei Wachstum-Zellen + zwei vs-TAM-Formel-Zellen");
  expect(kiFillMetaLine(4, 58.5), "KI-Schätzung: 4 Zellen · Catalog-Coverage unverändert 59% · Wachstum-KI zählt nicht in Segment-gew. Wachstum", "Meta nennt Zellzahl und lässt Coverage unverändert");
  expectTrue(full.every((f) => !("tamSize" in f)), "XOM-Fact-TAM bleibt in jedem Fill unangetastet");
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
  let calls = 0;
  const result = await requestTamNaFills({
    ticker: "MSFT",
    coveragePct: 58.5,
    segments: [
      { segmentName: "XBOX", segmentRevenue: 21.8, segmentGrowth: 4, matched: true, tamSize: 200, tamCAGR: 6 },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => { calls++; return { data: { fills: [] }, modelUsed: "x" }; },
  });
  expect(calls, 0, "Fact-komplette Zeile (matched, YoY vorhanden) ruft das LLM nicht auf");
  expect(result.ok, false, "keine N/A-Zelle → kein Fill");
  if (!result.ok) expect(result.status, 400, "keine N/A-Zelle → 400");
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
    expect(other?.segmentGrowth, 12, "Other ohne Fact-YoY übernimmt KI-segmentGrowth 12");
    expect(other?.outperforming, true, "Other vs-TAM Formel: KI-Wachstum 12 > CAGR 3");
    expectTrue(!!server && !("segmentGrowth" in server), "Server-Fact-YoY 31.5 wird nicht durch LLM-segmentGrowth 0 ersetzt");
    expectTrue(!("segmentWeightedGrowth" in result) && !("quality" in result) && !("tamTotal" in result), "Response hebt quality/tamTotal/segmentWeightedGrowth nicht an");
    expect(countScopeRestNa(
      unmatched.map((s: { segmentName: string; segmentRevenue: number; segmentGrowth: number | null; matched?: boolean }) => ({
        segmentName: s.segmentName,
        segmentRevenue: s.segmentRevenue,
        segmentGrowth: s.segmentGrowth,
        matched: false,
      })),
      result.fills,
    ), 0, "Success nur weil die gesendeten Scope-N/A geschlossen sind");
    expectTrue(fact.tamCAGR === null && fact.quality === "unreliable", "gewichteter CAGR und quality bleiben nach dem Fill unverändert");
  }
}

console.log("\n=== incomplete fill is fail-closed ===");

{
  let calls = 0;
  const result = await requestTamNaFills({
    ticker: "XOM",
    coveragePct: 40,
    segments: [
      { segmentName: "Upstream", segmentRevenue: 20, segmentGrowth: null, matched: true, tamSize: 4000, tamCAGR: 3 },
      { segmentName: "Downstream", segmentRevenue: 15, segmentGrowth: null, matched: true, tamSize: 2000, tamCAGR: 2 },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => {
      calls++;
      return {
        modelUsed: "test-model",
        data: { fills: [{ segmentName: "Upstream", segmentGrowth: 5, tamSize: 1, confidence: "high", rationale: "nur eine Zeile" }] },
      };
    },
  });
  expect(calls, 1, "Wachstum-n/a auf matched Zeilen geht an das LLM, nicht an Apollo");
  expect(result.ok, false, "Teilfill ist kein Success");
  if (!result.ok) {
    expect(result.code, "INCOMPLETE_FILL", "INCOMPLETE_FILL");
    expect(result.status, 422, "Teilfill → 422");
    expect(result.error, "KI-Schätzung unvollständig — nichts übernommen", "Fehlertext ohne Partial-Success");
  }
  expectTrue(!("fills" in result), "Teilfill liefert kein fills-Array zum Übernehmen");
}

{
  const result = await requestTamNaFills({
    ticker: "XOM",
    coveragePct: 40,
    segments: [
      { segmentName: "Upstream", segmentRevenue: 20, segmentGrowth: null, matched: true, tamSize: 4000, tamCAGR: 3 },
      { segmentName: "Downstream", segmentRevenue: 15, segmentGrowth: null, matched: true, tamSize: 2000, tamCAGR: 2 },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => ({
      modelUsed: "test-model",
      data: {
        fills: [
          { segmentName: "Upstream", segmentGrowth: 5, tamSize: 9, marketShare: 80, outperforming: false, confidence: "med", rationale: "Upstream YoY" },
          { segmentName: "Downstream", segmentGrowth: 1, tamSize: 9, marketShare: 80, outperforming: true, confidence: "low", rationale: "Downstream YoY" },
        ],
      },
    }),
  });
  expectTrue(result.ok === true, "vollständiger Wachstum-Fill auf Fact-TAM ist Success");
  if (result.ok) {
    expect(countScopeRestNa([
      { segmentName: "Upstream", segmentRevenue: 20, segmentGrowth: null, matched: true, tamSize: 4000, tamCAGR: 3 },
      { segmentName: "Downstream", segmentRevenue: 15, segmentGrowth: null, matched: true, tamSize: 2000, tamCAGR: 2 },
    ], result.fills), 0, "nach Apply Rest-n/a = 0");
    expect(result.coveragePct, 40, "coveragePct wird nur geechot");
    expectTrue(result.fills.every((f) => !("tamSize" in f) && !("marketShare" in f)), "kein Apollo-TAM und kein LLM-marketShare im XOM-Fill");
    expect(result.fills.find((f) => f.segmentName === "Upstream")?.outperforming, true, "Upstream 5 > 3 per Formel");
    expect(result.fills.find((f) => f.segmentName === "Downstream")?.outperforming, false, "Downstream 1 > 2 ist false per Formel, nicht LLM true");
  }
}

{
  const result = await requestTamNaFills({
    ticker: "XOM",
    coveragePct: 40,
    segments: [
      { segmentName: "Chemicals", segmentRevenue: 8, segmentGrowth: 6, matched: false },
      { segmentName: "Other", segmentRevenue: 2, segmentGrowth: null, matched: false },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => ({
      modelUsed: "test-model",
      data: {
        fills: [
          { segmentName: "Chemicals", tamSize: 100, tamCAGR: 4, tamLabel: "Chemicals", tamSource: "Schätzung", segmentGrowth: 99, marketShare: 1 },
        ],
      },
    }),
  });
  expect(result.ok, false, "TAM für eine Zeile ohne Wachstum der anderen ist kein Success");
  if (!result.ok) expect(result.code, "INCOMPLETE_FILL", "unvollständiger TAM+Wachstum-Fill ist INCOMPLETE_FILL");
  expectTrue(!("fills" in result), "kein Partial-Overlay bei fehlendem Other");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
