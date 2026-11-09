// script/test-tam-na-fill.ts
//
// KI-N/A-Fill v2 für Segment-TAM. Prüft die Section7-Matrix im Prompt,
// lokale Formeln (Anteil am TAM / vs. TAM), Wachstum-Fill nur bei Fact-n/a,
// Partial-Apply (gültige Fills bleiben, offene Zellen bleiben n/a),
// Revenue null/0 ausserhalb von Tabelle und Scope, LLM leer/fail als Fehler,
// und dass der MSFT-Faktenpfad (Coverage ~59%, Katalog, quality, tamTotal)
// nur geechot wird.
// Lauf: `npx tsx script/test-tam-na-fill.ts`

import { generateTAMAnalysis } from "../server/sector-data";
import { requestTamNaFills } from "../server/tam-na-fill";
import {
  applicableTamNaFills,
  catalogCoverageNote,
  countScopeRestNa,
  deriveOutperforming,
  deriveTamShare,
  hasPositiveSegmentRevenue,
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
      { segmentName: "XBOX", segmentRevenue: 21.8, segmentGrowth: 4, matched: true, tamSize: 400, tamCAGR: 3, segmentShare: 6.6 },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => { throw new Error("should not be called"); },
  });
  expect(result.ok, false, "Zeile ohne N/A wird nicht an das LLM gegeben");
  if (!result.ok) expect(result.status, 400, "keine N/A-Zelle -> 400");
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
  const allRows = (fact.segments ?? []).map((s: {
    segmentName: string;
    segmentRevenue: number;
    segmentGrowth: number | null;
    segmentShare: number;
    matched?: boolean;
    tamSize: number | null;
    tamCAGR: number | null;
  }) => ({
    segmentName: s.segmentName,
    segmentRevenue: s.segmentRevenue,
    segmentGrowth: s.segmentGrowth,
    segmentShare: s.segmentShare,
    matched: s.matched === false ? false as const : true as const,
    tamSize: s.tamSize,
    tamCAGR: s.tamCAGR,
  }));

  let matrixPrompt = "";
  const result = await requestTamNaFills({
    ticker: "MSFT",
    companyName: "Microsoft",
    sector: "Technology",
    industry: "Software",
    coveragePct: fact.coveragePct,
    segments: allRows,
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async (opts) => {
      matrixPrompt = opts.prompt;
      return {
        modelUsed: "test-model",
        data: {
          fills: allRows.map((s) => {
            const fill: Record<string, unknown> = {
              segmentName: s.segmentName,
              confidence: "med",
              rationale: "Testschätzung",
              marketShare: 99,
              outperforming: false,
            };
            if (s.segmentGrowth == null) fill.segmentGrowth = s.segmentName === "Other / nicht segmentiert" ? 12 : 4;
            if (s.matched === false) {
              fill.tamSize = s.segmentName === "Server" ? 500 : 90;
              fill.tamCAGR = s.segmentName === "Server" ? 7 : 3;
              fill.tamLabel = "Enterprise IT";
              fill.tamSource = "IDC";
            }
            return fill;
          }),
        },
      };
    },
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
    expectTrue(matrixPrompt.includes("Segment | Rev. | Anteil | Wachstum | TAM | CAGR | Anteil am TAM | vs. TAM"), "Prompt nennt die Section7-Spaltenköpfe");
    for (const row of allRows) {
      expectTrue(matrixPrompt.includes(row.segmentName), `Prompt enthält Zeile ${row.segmentName}`);
    }
    expectTrue(matrixPrompt.includes("Other / nicht segmentiert"), "Rest-Zeile steht mit dem UI-Label im Prompt");
    expectTrue(!matrixPrompt.includes("Kein segmentGrowth"), "Prompt verbietet segmentGrowth nicht mehr");
    const xbox = result.fills.find((f) => f.segmentName === "XBOX");
    expect(xbox?.segmentGrowth, 4, "XBOX Wachstum-n/a wird geschätzt");
    expectTrue(!xbox || xbox.tamSize === undefined, "Katalog-TAM von XBOX wird nicht überschrieben");
    expect(xbox?.outperforming, deriveOutperforming(4, 3), "XBOX vs-TAM aus KI-Wachstum 4 gegen Fakt-CAGR 3");
    const server = result.fills.find((f) => f.segmentName === "Server");
    expectTrue(!!server && server.marketShare === deriveTamShare(129.4, 500), "Server-Share lokal aus 129.4/500");
    expectTrue(!server || !("segmentGrowth" in server), "Server-Fact-YoY 31.5 wird nicht durch KI ersetzt");
    expect(server?.outperforming, deriveOutperforming(31.5, 7), "Server vs-TAM aus berichtetem 31.5, nicht aus LLM");
    const otherRow = allRows.find((s) => s.segmentName === "Other / nicht segmentiert");
    const other = result.fills.find((f) => f.segmentName === "Other / nicht segmentiert");
    expect(other?.segmentGrowth, 12, "Rest-Zeile Wachstum-n/a wird geschätzt");
    expect(other?.marketShare, otherRow ? deriveTamShare(otherRow.segmentRevenue, 90) : null, "Rest Anteil am TAM ist Formel, nicht LLM-99");
    expect(other?.outperforming, deriveOutperforming(12, 3), "Rest vs-TAM aus KI-Wachstum 12 > CAGR 3");
    expectTrue(fact.tamCAGR === null && fact.quality === "unreliable", "gewichteter CAGR und quality bleiben nach dem Fill unverändert");
  }
}

console.log("\n=== matrix prompt + formulas + incomplete fill ===");

{
  let prompt = "";
  const segments = [
    { segmentName: "Server", segmentRevenue: 129.4, segmentShare: 39, segmentGrowth: 31.5, matched: false as const, tamSize: null, tamCAGR: null },
    { segmentName: "XBOX", segmentRevenue: 21.8, segmentShare: 6.6, segmentGrowth: null, matched: true as const, tamSize: 400, tamCAGR: 3 },
    { segmentName: "Other / nicht segmentiert", segmentRevenue: 8.3, segmentShare: 2.5, segmentGrowth: null, matched: false as const, tamSize: null, tamCAGR: null },
  ];
  const result = await requestTamNaFills({
    ticker: "XOM",
    companyName: "Exxon Mobil",
    sector: "Energy",
    industry: "Oil & Gas",
    coveragePct: 40,
    segments,
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async (opts) => {
      prompt = opts.prompt;
      return {
        modelUsed: "test-model",
        data: {
          fills: [
            { segmentName: "Server", tamSize: 400, tamCAGR: 8, tamLabel: "Energy Services", tamSource: "IEA", marketShare: 1, outperforming: false, segmentGrowth: 99 },
            { segmentName: "XBOX", segmentGrowth: 9, tamSize: 9999, tamCAGR: 50, marketShare: 77, outperforming: false, confidence: "high", rationale: "YoY-Lücke" },
            { segmentName: "Other / nicht segmentiert", segmentGrowth: 12, tamSize: 80, tamCAGR: 3, tamLabel: "Residual", tamSource: "Schätzung", marketShare: 5, outperforming: false },
          ],
        },
      };
    },
  });
  const header = "Segment | Rev. | Anteil | Wachstum | TAM | CAGR | Anteil am TAM | vs. TAM";
  expectTrue(prompt.includes(header), "Prompt listet die UI-Spaltenköpfe");
  expectTrue(prompt.includes("Rest-Zeile"), "Prompt markiert die Rest-Zeile, wenn sie sichtbar ist");
  for (const name of ["Server", "XBOX", "Other / nicht segmentiert"]) {
    expectTrue(prompt.includes(name), `Prompt-Zeile ${name}`);
  }
  expectTrue(prompt.includes("31.5") && prompt.includes("n/a"), "Prompt zeigt Fact-Zahl und n/a");
  expectTrue(prompt.includes("(Fact, nicht überschreiben)"), "Fact-Zellen sind als nicht überschreibbar markiert");
  expectTrue(!prompt.includes("Kein segmentGrowth"), "Wachstum-n/a darf im Prompt nicht verboten sein");
  expectTrue(!/"marketShare"\s*:/.test(prompt) && !prompt.includes("outperforming"), "Formel-Spalten sind keine LLM-Felder");
  expectTrue(result.ok === true, "vollständige Matrix schließt alle Scope-N/A");
  if (result.ok) {
    const server = result.fills.find((f) => f.segmentName === "Server");
    expectTrue(!server || !("segmentGrowth" in server), "Fact-Wachstum 31.5 bleibt");
    expect(server?.marketShare, deriveTamShare(129.4, 400), "Anteil am TAM = Rev/TAM, LLM-1 verworfen");
    expect(server?.outperforming, true, "vs. TAM = 31.5 > 8");
    const xbox = result.fills.find((f) => f.segmentName === "XBOX");
    expect(xbox?.segmentGrowth, 9, "Wachstum-n/a auf gematchter Zeile");
    expectTrue(xbox?.tamSize === undefined, "Fakt-TAM 400 wird nicht durch 9999 ersetzt");
    expect(xbox?.outperforming, deriveOutperforming(9, 3), "vs. TAM nutzt KI-Wachstum gegen Fakt-CAGR");
    const rest = result.fills.find((f) => f.segmentName === "Other / nicht segmentiert");
    expect(rest?.segmentGrowth, 12, "Rest Wachstum");
    expect(rest?.marketShare, deriveTamShare(8.3, 80), "Rest Anteil am TAM Formel");
    expect(rest?.outperforming, true, "Rest vs. TAM 12 > 3, nicht LLM-false");
    expect(result.coveragePct, 40, "coveragePct wird geechot, nicht angehoben");
  }
}

{
  let prompt = "";
  const result = await requestTamNaFills({
    ticker: "AMZN",
    coveragePct: 40,
    segments: [
      { segmentName: "Third-Party Seller Services", segmentRevenue: 172.2, segmentShare: 24, segmentGrowth: 10.3, matched: false, tamSize: null, tamCAGR: null },
      { segmentName: "Other Services", segmentRevenue: 5.9, segmentShare: 0.8, segmentGrowth: 9.4, matched: false, tamSize: null, tamCAGR: null },
      { segmentName: "Other / nicht segmentiert", segmentRevenue: 0, segmentShare: 0, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async (opts) => {
      prompt = opts.prompt;
      return {
        modelUsed: "test-model",
        data: {
          fills: [
            { segmentName: "Third-Party Seller Services", tamSize: 800, tamCAGR: 11, tamLabel: "3P Marketplace", tamSource: "eMarketer", marketShare: 99, outperforming: false, confidence: "med", rationale: "Markt" },
            { segmentName: "Other / nicht segmentiert", segmentGrowth: 1, tamSize: 10, tamCAGR: 2, tamLabel: "Rest", tamSource: "n/a", confidence: "low", rationale: "leer" },
          ],
        },
      };
    },
  });
  expectTrue(!prompt.includes("Other / nicht segmentiert"), "0-Rev-Zeile steht nicht im Prompt");
  expectTrue(!prompt.includes("Rest-Zeile"), "0-Rev-Restzeile ist nicht als sichtbar markiert");
  expectTrue(prompt.includes("Third-Party Seller Services"), "Zeile mit Rev. > 0 steht im Prompt");
  expectTrue(prompt.includes("Other Services"), "offene Zeile mit Rev. > 0 steht im Prompt");
  expectTrue(!prompt.includes("Teilliste wird verworfen"), "Prompt verwirft keine Teilliste mehr");
  expect(result.ok, true, "Partial-Apply mit offenem Rest ist Success");
  if (result.ok) {
    expect(result.fills.length, 1, "nur der valide Fill wird übernommen");
    const tp = result.fills.find((f) => f.segmentName === "Third-Party Seller Services");
    expect(tp?.marketShare, deriveTamShare(172.2, 800), "Anteil am TAM lokal, LLM-99 verworfen");
    expect(tp?.outperforming, deriveOutperforming(10.3, 11), "vs. TAM aus Fact-Wachstum 10.3 gegen KI-CAGR 11");
    expectTrue(!tp || !("segmentGrowth" in tp), "Fact-Wachstum 10.3 wird nicht überschrieben");
    expectTrue(!result.fills.some((f) => f.segmentName === "Other Services"), "fehlende Zelle bleibt ohne Fill");
    expectTrue(!result.fills.some((f) => f.segmentName === "Other / nicht segmentiert"), "0-Rev-Fill wird nicht übernommen");
    expect(result.coveragePct, 40, "coveragePct wird geechot, nicht neu berechnet");
    expectTrue(!("tamTotal" in result), "Response enthält kein tamTotal");
  }
}

{
  const result = await requestTamNaFills({
    ticker: "AMZN",
    coveragePct: 12,
    segments: [
      { segmentName: "Other Services", segmentRevenue: 5.9, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => ({
      modelUsed: "test-model",
      data: {
        fills: [{ segmentName: "Other Services", segmentGrowth: 9.4, tamSize: -1, confidence: "low", rationale: "nur Wachstum", outperforming: true, marketShare: 50 }],
      },
    }),
  });
  expect(result.ok, true, "Wachstum ohne gültiges TAM ist Partial-Success");
  if (result.ok) {
    const row = result.fills[0];
    expect(row?.segmentGrowth, 9.4, "Wachstum-n/a übernommen");
    expectTrue(row?.tamSize === undefined, "ungültiges TAM nicht übernommen");
    expect(row?.outperforming, null, "vs. TAM bleibt null ohne CAGR");
    expectTrue(row?.marketShare === undefined, "Anteil am TAM ohne TAM nicht gesetzt");
    expect(result.coveragePct, 12, "coveragePct bleibt der Faktwert");
  }
}

{
  let calls = 0;
  const result = await requestTamNaFills({
    ticker: "AMZN",
    segments: [
      { segmentName: "Online Stores", segmentRevenue: 269.3, segmentGrowth: 9, matched: true, tamSize: 6300, tamCAGR: 11 },
      { segmentName: "Other / nicht segmentiert", segmentRevenue: 0, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => { calls++; return { data: { fills: [] }, modelUsed: "x" }; },
  });
  expect(calls, 0, "0-Rev-Zeile allein öffnet keinen LLM-Call");
  expect(result.ok, false, "keine positive N/A-Zeile");
  if (!result.ok) expect(result.status, 400, "400 wenn nur die 0-Rev-Zeile n/a wäre");
}

{
  const result = await requestTamNaFills({
    ticker: "AMZN",
    segments: [
      { segmentName: "Other Services", segmentRevenue: 5.9, segmentGrowth: null, matched: true, tamSize: 100, tamCAGR: 4 },
      { segmentName: "Other / nicht segmentiert", segmentRevenue: 0, segmentGrowth: null, matched: false },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => ({
      modelUsed: "test-model",
      data: { fills: [{ segmentName: "Other / nicht segmentiert", segmentGrowth: 3, tamSize: 20, tamCAGR: 2, confidence: "low", rationale: "nur nullzeile" }] },
    }),
  });
  expect(result.ok, false, "Fill nur für 0-Rev ist kein Success");
  if (!result.ok) {
    expect(result.status, 422, "nichts Brauchbares → 422");
    expect(result.code, "INCOMPLETE_FILL", "nichts Brauchbares → INCOMPLETE_FILL");
    expect(result.error, "KI-Schätzung unvollständig — nichts übernommen", "Fehlertext wenn nichts übernommen");
    expectTrue(!("fills" in result), "Fehler trägt keine fills");
  }
}

{
  const result = await requestTamNaFills({
    ticker: "AMZN",
    segments: [
      { segmentName: "Other Services", segmentRevenue: 5.9, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => ({ modelUsed: "test-model", data: { fills: [] } }),
  });
  expect(result.ok, false, "leeres fills-Array ist kein Success");
  if (!result.ok) {
    expect(result.code, "INCOMPLETE_FILL", "leeres fills-Array → INCOMPLETE_FILL");
    expectTrue(!("fills" in result), "leeres Success gibt es nicht");
  }
}

{
  const result = await requestTamNaFills({
    ticker: "XOM",
    coveragePct: 40,
    segments: [
      { segmentName: "XBOX", segmentRevenue: 21.8, segmentShare: 6.6, segmentGrowth: null, matched: true, tamSize: 400, tamCAGR: 3 },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async () => ({
      modelUsed: "test-model",
      data: { fills: [{ segmentName: "XBOX", segmentGrowth: 250, confidence: "low", rationale: "zu hoch" }] },
    }),
  });
  expect(result.ok, false, "Wachstum außerhalb −80…+200 schließt die Zelle nicht");
  if (!result.ok) expect(result.code, "INCOMPLETE_FILL", "Out-of-range Wachstum → INCOMPLETE_FILL");
}

{
  const kept = validateTamNaFills(
    [{ segmentName: "XBOX", segmentRevenue: 21.8, segmentGrowth: null, matched: true, tamSize: 400, tamCAGR: 3 }],
    { fills: [{ segmentName: "XBOX", segmentGrowth: -80, confidence: "low", rationale: "unteres Ende" }] },
  );
  expect(kept[0]?.segmentGrowth, -80, "−80 bleibt im Wachstum-Fenster");
  const dropped = validateTamNaFills(
    [{ segmentName: "XBOX", segmentRevenue: 21.8, segmentGrowth: null, matched: true, tamSize: 400, tamCAGR: 3 }],
    { fills: [{ segmentName: "XBOX", segmentGrowth: -81, confidence: "low", rationale: "darunter" }] },
  );
  expect(dropped.length, 0, "−81 wird gedroppt, nicht geklemmt");
  expect(deriveOutperforming(12, 3), true, "Formel vs. TAM: Wachstum > CAGR");
  expect(deriveOutperforming(null, 3), null, "Formel vs. TAM ohne Wachstum ist null");
  expect(deriveTamShare(8.3, 80), Math.round((8.3 / 80) * 10000) / 100, "Formel Anteil am TAM");
}

console.log("\n=== zero revenue stays out of scope ===");
{
  expect(hasPositiveSegmentRevenue(0), false, "Revenue 0 ist nicht positiv");
  expect(hasPositiveSegmentRevenue(null), false, "Revenue null ist nicht positiv");
  expect(hasPositiveSegmentRevenue(0.1), true, "Revenue > 0 bleibt im Scope");
  const droppedZero = validateTamNaFills(
    [{ segmentName: "Other / nicht segmentiert", segmentRevenue: 0, segmentGrowth: null, matched: false }],
    { fills: [{ segmentName: "Other / nicht segmentiert", tamSize: 10, tamCAGR: 2, tamLabel: "R", tamSource: "S", confidence: "low", rationale: "x" }] },
  );
  expect(droppedZero.length, 0, "Revenue 0 ist kein Fill-Ziel");
  const droppedNull = validateTamNaFills(
    [{ segmentName: "Leer", segmentRevenue: null as unknown as number, segmentGrowth: null, matched: false }],
    { fills: [{ segmentName: "Leer", segmentGrowth: 3, confidence: "low", rationale: "x" }] },
  );
  expect(droppedNull.length, 0, "Revenue null ist kein Fill-Ziel");
  expect(countScopeRestNa([
    { segmentName: "Other / nicht segmentiert", segmentRevenue: 0, segmentGrowth: null, matched: false },
  ], null), 0, "0-Rev zählt nicht als offene Scope-Zelle");
  const rows = [
    { segmentName: "Third-Party Seller Services", segmentRevenue: 172.2, segmentGrowth: 10.3, matched: false as const, tamSize: null, tamCAGR: null },
    { segmentName: "Other Services", segmentRevenue: 5.9, segmentGrowth: 9.4, matched: false as const, tamSize: null, tamCAGR: null },
    { segmentName: "Other / nicht segmentiert", segmentRevenue: 0, segmentGrowth: null, matched: false as const, tamSize: null, tamCAGR: null },
  ];
  const validated = validateTamNaFills(rows, {
    fills: [
      { segmentName: "Third-Party Seller Services", tamSize: 800, tamCAGR: 11, tamLabel: "3P", tamSource: "eMarketer", marketShare: 99, outperforming: false, confidence: "med", rationale: "Markt" },
      { segmentName: "Other / nicht segmentiert", segmentGrowth: 1, tamSize: 10, tamCAGR: 2, confidence: "low", rationale: "leer" },
    ],
  });
  const applied = applicableTamNaFills(rows, validated);
  expect(applied.map((f) => f.segmentName), ["Third-Party Seller Services"], "Apply übernimmt nur Revenue > 0 mit geschlossener Zelle");
  expect(applied[0]?.marketShare, deriveTamShare(172.2, 800), "übernommener Anteil am TAM ist die lokale Formel");
  expect(applied[0]?.outperforming, deriveOutperforming(10.3, 11), "übernommenes vs. TAM ist die lokale Formel");
  expect(countScopeRestNa(rows, applied) > 0, true, "Other Services bleibt n/a, 0-Rev zählt nicht mit");
}

{
  const shared = await import("../shared/tam-na-fill.ts");
  expectTrue(typeof shared.countScopeRestNa === "function", "countScopeRestNa ist exportiert");
  expectTrue(typeof shared.kiFillMetaLine === "function", "kiFillMetaLine ist exportiert");
  if (typeof shared.countScopeRestNa === "function" && typeof shared.kiFillMetaLine === "function") {
    const rows = [
      { segmentName: "Server", segmentRevenue: 10, segmentGrowth: 5, matched: false as const, tamSize: null, tamCAGR: null },
    ];
    expectTrue(shared.countScopeRestNa(rows, null) > 0, "ohne Fill bleiben Scope-N/A");
    const closed = validateTamNaFills(rows, {
      fills: [{ segmentName: "Server", tamSize: 100, tamCAGR: 4, tamLabel: "M", tamSource: "S", confidence: "high", rationale: "ok" }],
    });
    expect(shared.countScopeRestNa(rows, closed), 0, "TAM+CAGR+Formel schließen die unmatched Zeile mit Fact-Wachstum");
    expect(
      shared.kiFillMetaLine(3, 58.5),
      "KI-Schätzung: 3 Zellen · Catalog-Coverage unverändert 59% · Wachstum-KI zählt nicht in Segment-gew. Wachstum",
      "Meta-Zeile nach Success, Coverage nur geechot",
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
