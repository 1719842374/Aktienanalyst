/**
 * SAP.DE TAM-Schätzung: Peer-Anker über das ADR-Symbol, Teilübernahme, ein Retry.
 * Kein Netz. Fünf Läufe hintereinander ohne 422, plus MSFT-Regression.
 * Ausführen: npx tsx script/test-segment-tam-sap.ts
 *
 * Prod eb5857d0, 2026-11-02: POST /api/segment-tam-estimate mit den FMP-Segmenten
 * Cloud / Software support / Services / Software licenses (Wachstum 22.6 / -6.8 / -1.9 / -29.2,
 * im Report als Yahoo-Namen, vierte Zeile dort „Licenses“) antwortet für ticker SAP.DE
 * mit 422 INCOMPLETE_FILL und für ticker SAP mit 200. /api/segment-growth/SAP.DE bleibt
 * business=[] / geographic=[], weil der Growth-Route das .DE-Symbol reicht.
 * Ursache: loadPeerGrowthAnchor("SAP.DE") findet keine FMP-Peers. Der Prompt sagte
 * „Eine Zahl ohne eigene Quelle weglassen“, das Modell lieferte nichts Übernehmbares,
 * und die ganze Antwort wurde verworfen.
 */
import { adrCandidatesFor } from "../server/fmp-adr-map";
import { loadPeerGrowthAnchor, peerLookupSymbols } from "../server/peer-growth-anchor";
import { estimateSegmentTam } from "../server/segment-tam-estimate-route";
import { buildTamNaFillPrompt } from "../server/tam-na-fill";
import {
  TAM_ESTIMATE_MAX_RETRIES,
  TAM_NA_UNFILLED_REASON,
  adaptiveMinFilledCellRatio,
  type TamNaFill,
} from "../shared/tam-na-fill";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const SAP_SEGMENTS = [
  { segmentName: "Cloud", segmentRevenue: 21, segmentShare: 57.1, segmentGrowth: 22.6, matched: true, tamSize: 1500, tamCAGR: 16 },
  { segmentName: "Software support", segmentRevenue: 10.5, segmentShare: 28.6, segmentGrowth: -6.8, matched: false, tamSize: null, tamCAGR: null },
  { segmentName: "Services", segmentRevenue: 4.3, segmentShare: 11.6, segmentGrowth: -1.9, matched: false, tamSize: null, tamCAGR: null },
  { segmentName: "Software licenses", segmentRevenue: 1, segmentShare: 2.7, segmentGrowth: -29.2, matched: false, tamSize: null, tamCAGR: null },
];

const SUPPORT_FILL = {
  segmentName: "Software support",
  tamSize: 280,
  tamCAGR: 6.7,
  tamLabel: "Enterprise Software Support",
  tamSource: "Gartner Enterprise Software Support",
  formula: "TAM 280 = Rev. 10.5 / 3.75%",
  confidence: "med" as const,
  rationale: "Support-Markt größer als der Segmentumsatz",
};

const MSFT_SEGMENTS = [
  { segmentName: "Server", segmentRevenue: 129.4, segmentShare: 39, segmentGrowth: 31.5, matched: false, tamSize: null, tamCAGR: null },
  { segmentName: "Microsoft 365 Commercial", segmentRevenue: 102, segmentShare: 30.7, segmentGrowth: 16.2, matched: true, tamSize: 600, tamCAGR: 12 },
  { segmentName: "XBOX", segmentRevenue: 21.8, segmentShare: 6.6, segmentGrowth: null, matched: true, tamSize: 400, tamCAGR: 3 },
  { segmentName: "Search advertising", segmentRevenue: 15.2, segmentShare: 4.6, segmentGrowth: null, matched: true, tamSize: 1000, tamCAGR: 10 },
  { segmentName: "Other / nicht segmentiert", segmentRevenue: 8.4, segmentShare: 2.5, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
];

type Llm = (opts: { prompt: string }) => Promise<{ data: unknown; modelUsed: string } | null>;

console.log("\nParameter");
{
  check("Retry-Obergrenze ist 1", TAM_ESTIMATE_MAX_RETRIES === 1);
  check("SAP-Mindestanteil ist die kleinste Zeile / Matrix", adaptiveMinFilledCellRatio([2, 2, 2]) === 2 / 6);
  check("MSFT-Mindestanteil fällt mit der einzeiligen Wachstumslücke", adaptiveMinFilledCellRatio([2, 1, 1, 3]) === 1 / 7);
  check("leere Matrix verlangt nichts unter 1", adaptiveMinFilledCellRatio([]) === 1);
}

console.log("\nPeer-Symbole");
{
  check("SAP.DE sucht Listing, dann SAP", JSON.stringify(peerLookupSymbols("SAP.DE")) === JSON.stringify(["SAP.DE", "SAP"]));
  check("Map bleibt die bestehende ADR-Zeile", adrCandidatesFor("SAP.DE")[0]?.symbol === "SAP");
  check("MSFT hat keinen ADR-Kandidaten", peerLookupSymbols("MSFT").join() === "MSFT");
  const seen: string[] = [];
  const anchor = await loadPeerGrowthAnchor("SAP.DE", {
    available: () => true,
    peers: async (symbol) => {
      seen.push(symbol);
      if (symbol === "SAP") return ["ORCL", "MSFT", "ADBE"];
      return [];
    },
    income: async (symbol) => {
      const revenue = symbol === "ORCL" ? 110 : symbol === "MSFT" ? 130 : symbol === "ADBE" ? 90 : 0;
      return [{ revenue }, { revenue: 100 }];
    },
  });
  check("leeres SAP.DE fällt auf SAP", seen[0] === "SAP.DE" && seen.includes("SAP"), seen.join(","));
  check("Anker kommt aus den SAP-Peers", anchor?.peerCount === 3 && anchor.source.endsWith(" SAP"), JSON.stringify(anchor));
  const direct: string[] = [];
  await loadPeerGrowthAnchor("SAP.DE", {
    available: () => true,
    peers: async (symbol) => {
      direct.push(symbol);
      return symbol === "SAP.DE" ? ["ORCL"] : ["UNERWARTET"];
    },
    income: async () => [{ revenue: 110 }, { revenue: 100 }],
  });
  check("hat das Listing Peers, bleibt es dabei", direct.join() === "SAP.DE", direct.join());
}

console.log("\nPrompt ohne Peer-Anker verwirft nicht die ganze Antwort");
{
  const prompt = buildTamNaFillPrompt({
    ticker: "SAP.DE",
    companyName: "SAP SE",
    sector: "Technology",
    industry: "Software - Application",
    peerAnchor: null,
    segments: SAP_SEGMENTS,
  }, SAP_SEGMENTS.filter((s) => s.matched === false).map((s) => ({
    segmentName: s.segmentName,
    segmentRevenue: s.segmentRevenue,
    segmentGrowth: s.segmentGrowth,
    matched: false,
    tamSize: null,
    tamCAGR: null,
  })));
  check("kein pauschales Weglassen", !prompt.includes("Eine Zahl ohne eigene Quelle weglassen"));
  check("Zelle ohne Beleg bleibt einzeln n/a", prompt.includes("andere belegte Felder derselben Antwort bleiben gültig"));
}

const badFirst: unknown[] = [
  { fills: [{ segmentName: "Licenses", tamSize: 40, tamCAGR: 2, tamSource: "Kurzname", formula: "nicht die Tabellenzeile", confidence: "low", rationale: "Report-Kurzname" }] },
  { "Software support": { tamSize: 280, tamCAGR: 6.7 } },
  { fills: [] },
  { fills: [{ segmentName: "Software support", tamSize: "280", tamCAGR: "6%", tamSource: "Text", formula: "String ist keine Zahl" }] },
  null,
];

console.log("\nSAP.DE fünf Läufe");
for (let run = 1; run <= 5; run++) {
  let calls = 0;
  let retryPrompt = "";
  const result = await estimateSegmentTam({
    ticker: "SAP.DE",
    companyName: "SAP SE",
    sector: "Technology",
    industry: "Software - Application",
    coveragePct: 57.1,
    peerAnchor: { peerCount: 5, medianRevenueYoyPct: 6.7, p25RevenueYoyPct: 6.5, p75RevenueYoyPct: 7.6, source: "FMP income-statement Peer-Umsatz-YoY SAP" },
    segments: SAP_SEGMENTS,
  }, {
    isLLMAvailable: () => true,
    callLLMJson: (async (opts) => {
      calls += 1;
      if (calls > 1) retryPrompt = opts.prompt;
      if (run === 5 || calls > 1) return { modelUsed: "test", data: { fills: [SUPPORT_FILL] } };
      return { modelUsed: "test", data: badFirst[run - 1] };
    }) as Llm,
  });
  const support = result.ok ? result.fills.find((f) => f.segmentName === "Software support") : undefined;
  const services = result.ok ? result.fills.find((f) => f.segmentName === "Services") : undefined;
  const interpolated = Math.round(280 * (4.3 / 10.5) * 10) / 10;
  check(`Lauf ${run} ist kein 422`, result.ok === true, JSON.stringify(result));
  check(`Lauf ${run} höchstens ein Retry`, calls <= TAM_ESTIMATE_MAX_RETRIES + 1 && calls >= 1, String(calls));
  check(`Lauf ${run} übernimmt Software support`, support?.tamSize === 280 && support.tamCAGR === 6.7 && support.tamSource === SUPPORT_FILL.tamSource && support.formula === SUPPORT_FILL.formula);
  check(`Lauf ${run} überschreibt das Fakt-Wachstum nicht`, support != null && support.segmentGrowth == null);
  check(`Lauf ${run} Cloud bleibt Fact`, result.ok && !result.fills.some((f) => f.segmentName === "Cloud"));
  check(`Lauf ${run} Services bleibt ohne Zahl`, services?.tamSize == null && services?.tamCAGR == null);
  check(`Lauf ${run} kein interpolierter Services-TAM`, result.ok && !result.fills.some((f) => f.tamSize === interpolated));
  if (result.ok) {
    check(
      `Lauf ${run} Services-TAM nennt den Grund`,
      result.naReasons.some((r) => r.segmentName === "Services" && r.field === "tam" && r.reason === TAM_NA_UNFILLED_REASON.tam),
    );
    check(
      `Lauf ${run} Lizenzen-CAGR nennt den Grund`,
      result.naReasons.some((r) => r.segmentName === "Software licenses" && r.field === "cagr" && r.reason === TAM_NA_UNFILLED_REASON.cagr),
    );
  }
  if (run < 5) {
    check(`Lauf ${run} Retry nennt den Tabellennamen`, retryPrompt.includes("Software licenses") && retryPrompt.includes("keine Interpolation"), retryPrompt.slice(0, 180));
    check(`Lauf ${run} hat genau einmal wiederholt`, calls === TAM_ESTIMATE_MAX_RETRIES + 1, String(calls));
  } else {
    check("Lauf 5 braucht keinen Retry", calls === 1, String(calls));
  }
}

console.log("\nMSFT-Regression");
{
  let calls = 0;
  const result = await estimateSegmentTam({
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    sector: "Technology",
    industry: "Software - Infrastructure",
    coveragePct: 58.5,
    peerAnchor: { peerCount: 5, medianRevenueYoyPct: 9.6, p25RevenueYoyPct: 8, p75RevenueYoyPct: 12, source: "FMP income-statement Peer-Umsatz-YoY MSFT" },
    segments: MSFT_SEGMENTS,
  }, {
    isLLMAvailable: () => true,
    callLLMJson: (async () => {
      calls += 1;
      return {
        modelUsed: "test",
        data: {
          fills: [
            { segmentName: "Server", tamSize: 1200, tamCAGR: 9.6, tamLabel: "Cloud Infrastructure", tamSource: "Peer-Median 9.6%", formula: "TAM 1200, CAGR = Peer-Median 9.6%", confidence: "med", rationale: "über Peer-Median", segmentGrowth: 99 },
            { segmentName: "XBOX", segmentGrowth: 3, formula: "3% unter Peer-Median 9.6%", confidence: "low", rationale: "reifer Gaming-Markt" },
          ],
        },
      };
    }) as Llm,
  });
  const server = result.ok ? result.fills.find((f: TamNaFill) => f.segmentName === "Server") : undefined;
  const xbox = result.ok ? result.fills.find((f) => f.segmentName === "XBOX") : undefined;
  const search = result.ok ? result.fills.find((f) => f.segmentName === "Search advertising") : undefined;
  check("MSFT bleibt 200", result.ok === true, JSON.stringify(result).slice(0, 300));
  check("ein Abruf reicht, wenn die kleinste Zeile geschlossen ist", calls === 1, String(calls));
  check("Server-TAM bleibt die gelieferte Zahl", server?.tamSize === 1200 && server.tamCAGR === 9.6 && server.formula?.includes("9.6%"));
  check("Fakt-Wachstum 31.5 wird nicht durch 99 ersetzt", server?.segmentGrowth == null);
  check("XBOX-Wachstum bleibt die Schätzung", xbox?.segmentGrowth === 3 && xbox.formula?.includes("3%"));
  check("Search wird nicht aus XBOX aufgefüllt", search?.segmentGrowth == null);
  if (result.ok) {
    check(
      "Search bleibt n/a mit Grund",
      result.naReasons.some((r) => r.segmentName === "Search advertising" && r.field === "growth" && r.reason === TAM_NA_UNFILLED_REASON.growth),
    );
  }
}

console.log("\nTeilübernahme unter dem Mindestanteil");
{
  let calls = 0;
  const result = await estimateSegmentTam({
    ticker: "MSFT",
    coveragePct: 58.5,
    peerAnchor: null,
    segments: [MSFT_SEGMENTS[0], MSFT_SEGMENTS[4]],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: (async () => {
      calls += 1;
      if (calls === 1) {
        return {
          modelUsed: "thin",
          data: { fills: [{ segmentName: "Other / nicht segmentiert", segmentGrowth: 4, formula: "4% Rest", confidence: "low", rationale: "Rest" }] },
        };
      }
      return {
        modelUsed: "second",
        data: { fills: [{ segmentName: "Server", tamSize: 1200, tamCAGR: 9.6, tamSource: "Peer-Median", formula: "TAM 1200", confidence: "med", rationale: "Server" }] },
      };
    }) as Llm,
  });
  check("zweiter Abruf nach zu dünner erster Antwort", calls === 2, String(calls));
  check("beide belegten Zeilen bleiben, ohne Mittelwert", result.ok === true && result.ok && result.fills.some((f) => f.segmentName === "Other / nicht segmentiert" && f.segmentGrowth === 4) && result.fills.some((f) => f.segmentName === "Server" && f.tamSize === 1200));
}

console.log(failed === 0 ? "\n✅ SAP.DE TAM" : `\n❌ ${failed} fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
