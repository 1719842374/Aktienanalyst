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
import { estimateSegmentTam, resetTamEstimateCacheForTests } from "../server/segment-tam-estimate-route";
import { buildTamNaFillPrompt } from "../server/tam-na-fill";
import {
  TAM_ESTIMATE_MAX_RETRIES,
  adaptiveMinFilledCellRatio,
  adaptiveTamRatioBounds,
  factTamRevenueRatios,
  tamEstimateCallCeiling,
  type PeerSegmentEvidence,
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
  check("Retry-Obergrenze je Zeile ist 1", TAM_ESTIMATE_MAX_RETRIES === 1);
  check("Gesamtobergrenze folgt aus den offenen Zeilen", tamEstimateCallCeiling(3) === 3 * (TAM_ESTIMATE_MAX_RETRIES + 1));
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

const SAP_PEERS: PeerSegmentEvidence[] = [
  { symbol: "ORCL", segmentName: "Services", revenueB: 4.3, sharePct: 100 / 30 },
  { symbol: "CRM", segmentName: "Software support", revenueB: 10.5, sharePct: 100 / 40 },
  { symbol: "ADBE", segmentName: "Software licenses", revenueB: 1, sharePct: 100 / 35 },
];

console.log("\nSAP.DE fünf Läufe, Formel statt schwankender LLM-TAM");
{
  resetTamEstimateCacheForTests();
  let signature = "";
  for (let run = 1; run <= 5; run++) {
    let calls = 0;
    const result = await estimateSegmentTam({
      ticker: "SAP.DE",
      companyName: "SAP SE",
      sector: "Technology",
      industry: "Software - Application",
      coveragePct: 57.1,
      peerAnchor: { peerCount: 5, medianRevenueYoyPct: 6.7, p25RevenueYoyPct: 6.5, p75RevenueYoyPct: 7.6, source: "FMP income-statement Peer-Umsatz-YoY SAP" },
      peerEvidence: SAP_PEERS,
      segments: SAP_SEGMENTS,
    }, {
      isLLMAvailable: () => true,
      callLLMJson: (async () => {
        calls += 1;
        return {
          modelUsed: "unstable",
          data: {
            fills: [{
              segmentName: "Software licenses",
              tamSize: run % 2 === 0 ? 120 : 320,
              tamCAGR: 12,
              tamSource: "Peer-CAGR 12%",
              formula: "~320x der Rev.",
              confidence: "low",
              rationale: "schwankt",
            }],
          },
        };
      }) as Llm,
    });
    const licenses = result.ok ? result.fills.find((f) => f.segmentName === "Software licenses") : undefined;
    const services = result.ok ? result.fills.find((f) => f.segmentName === "Services") : undefined;
    const support = result.ok ? result.fills.find((f) => f.segmentName === "Software support") : undefined;
    const stamp = result.ok ? result.fills.map((f) => `${f.segmentName}:${f.tamSize}:${f.tamCAGR}:${f.formula}`).sort().join(";") : "fail";
    if (run === 1) signature = stamp;
    check(`Lauf ${run} ist kein 422`, result.ok === true, JSON.stringify(result).slice(0, 400));
    check(`Lauf ${run} bleibt in der Abruf-Obergrenze`, calls <= tamEstimateCallCeiling(3), String(calls));
    check(`Lauf ${run} schätzt alle drei offenen Segmente`, services?.tamSize === 129 && support?.tamSize === 420 && licenses?.tamSize === 35);
    check(`Lauf ${run} CAGR ist der Wachstums-Proxy`, services?.tamCAGR === -1.9 && support?.tamCAGR === -6.8 && licenses?.tamCAGR === -29.2);
    check(`Lauf ${run} nennt Formel und Quelle`, Boolean(services?.formula?.includes("CAGR-Proxy") && services.formula.includes("Peer-Umsatz") && services.tamSource?.includes("ORCL")));
    check(`Lauf ${run} übernimmt 120/320 nicht`, result.ok && !result.fills.some((f) => f.tamSize === 120 || f.tamSize === 320));
    check(`Lauf ${run} überschreibt kein Fakt-Wachstum`, support?.segmentGrowth == null && services?.segmentGrowth == null);
    check(`Lauf ${run} Cloud bleibt Fact`, result.ok && !result.fills.some((f) => f.segmentName === "Cloud"));
    check(`Lauf ${run} ist identisch zum ersten`, stamp === signature, stamp);
  }
}

console.log("\nok ohne Zellen");
{
  resetTamEstimateCacheForTests();
  let calls = 0;
  const result = await estimateSegmentTam({
    ticker: "SAP.DE",
    coveragePct: 57.1,
    peerAnchor: null,
    peerEvidence: [],
    segments: SAP_SEGMENTS,
  }, {
    isLLMAvailable: () => true,
    callLLMJson: (async () => {
      calls += 1;
      return { modelUsed: "empty", data: { fills: [] } };
    }) as Llm,
  });
  check("leere LLM-Antwort bleibt ok", result.ok === true, JSON.stringify(result).slice(0, 300));
  check("Abrufe bleiben unter der Obergrenze", calls <= tamEstimateCallCeiling(3) && calls === TAM_ESTIMATE_MAX_RETRIES + 1, String(calls));
  for (const name of ["Software support", "Services", "Software licenses"]) {
    const row = result.ok ? result.fills.find((f) => f.segmentName === name) : undefined;
    check(`${name} hat den CAGR-Proxy`, row?.formula?.includes("CAGR-Proxy") === true && row.tamSource?.includes("Proxy") === true);
    check(`${name} TAM bleibt n/a mit konkretem Grund`, row?.tamSize == null && result.ok && result.naReasons.some((r) => r.segmentName === name && r.field === "tam" && r.reason.includes(name)));
  }
  const again = await estimateSegmentTam({
    ticker: "SAP.DE",
    coveragePct: 57.1,
    peerAnchor: null,
    peerEvidence: [],
    segments: SAP_SEGMENTS,
  }, {
    isLLMAvailable: () => true,
    callLLMJson: (async () => {
      calls += 1;
      return { modelUsed: "other", data: { fills: [{ segmentName: "Software licenses", tamSize: 320, tamCAGR: 9, tamSource: "Peer-CAGR 9%", formula: "~320x der Rev.", confidence: "low", rationale: "neu" }] } };
    }) as Llm,
  });
  const before = result.ok ? result.fills.map((f) => `${f.segmentName}:${f.tamCAGR}`).sort().join(";") : "";
  const after = again.ok ? again.fills.map((f) => `${f.segmentName}:${f.tamCAGR}`).sort().join(";") : "";
  check("zweiter Lauf liest den Cache und ändert die Zahl nicht", before === after && calls === TAM_ESTIMATE_MAX_RETRIES + 1, `${before} vs ${after}, calls ${calls}`);
}

console.log("\nMSFT-Regression");
{
  resetTamEstimateCacheForTests();
  const bounds = adaptiveTamRatioBounds(factTamRevenueRatios(MSFT_SEGMENTS));
  const serverTam = bounds ? Math.round(bounds.mid * 129.4 * 10) / 10 : 0;
  let calls = 0;
  const result = await estimateSegmentTam({
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    sector: "Technology",
    industry: "Software - Infrastructure",
    coveragePct: 58.5,
    peerAnchor: { peerCount: 5, medianRevenueYoyPct: 9.6, p25RevenueYoyPct: 8, p75RevenueYoyPct: 12, source: "FMP income-statement Peer-Umsatz-YoY MSFT" },
    peerEvidence: [],
    segments: MSFT_SEGMENTS,
  }, {
    isLLMAvailable: () => true,
    callLLMJson: (async () => {
      calls += 1;
      if (calls === 1) {
        return {
          modelUsed: "test",
          data: {
            fills: [
              { segmentName: "Server", tamSize: 1200, tamCAGR: 9.6, tamLabel: "Cloud Infrastructure", tamSource: "Peer-Median 9.6%", formula: "TAM 1200, CAGR = Peer-Median 9.6%", confidence: "med", rationale: "über Peer-Median", segmentGrowth: 99 },
              { segmentName: "XBOX", segmentGrowth: 3, formula: "3% unter Peer-Median 9.6%", confidence: "low", rationale: "reifer Gaming-Markt" },
            ],
          },
        };
      }
      return {
        modelUsed: "test",
        data: {
          fills: [
            { segmentName: "Server", tamSize: serverTam, tamCAGR: 9.6, tamLabel: "Server-Markt", tamSource: "IDC Pressemitteilung Server-Markt", formula: `TAM ${serverTam} aus IDC`, confidence: "med", rationale: "Marktgröße" },
          ],
        },
      };
    }) as Llm,
  });
  const server = result.ok ? result.fills.find((f: TamNaFill) => f.segmentName === "Server") : undefined;
  const xbox = result.ok ? result.fills.find((f) => f.segmentName === "XBOX") : undefined;
  const search = result.ok ? result.fills.find((f) => f.segmentName === "Search advertising") : undefined;
  const commercial = result.ok ? result.fills.find((f) => f.segmentName === "Microsoft 365 Commercial") : undefined;
  check("MSFT bleibt 200", result.ok === true, JSON.stringify(result).slice(0, 400));
  check("Retries bleiben in der Obergrenze", calls <= tamEstimateCallCeiling(4) && calls === TAM_ESTIMATE_MAX_RETRIES + 1, String(calls));
  check("Peer-CAGR wird nicht als TAM-Quelle behalten", server?.tamSource?.includes("IDC") === true && server.tamSize === serverTam);
  check("Fakt-Wachstum 31.5 wird nicht durch 99 ersetzt", server?.segmentGrowth == null);
  check("CAGR-Proxy des Server bleibt das Fakt-Wachstum", server?.tamCAGR === 31.5);
  check("XBOX-Wachstum bleibt die Schätzung", xbox?.segmentGrowth === 3 && xbox.formula?.includes("3%"));
  check("Search wird nicht aus XBOX aufgefüllt", search?.segmentGrowth == null);
  check("Fact-TAM von Microsoft 365 wird nicht überschrieben", commercial == null);
  if (result.ok) {
    check(
      "Search bleibt n/a mit Grund",
      result.naReasons.some((r) => r.segmentName === "Search advertising" && r.field === "growth" && r.reason.includes("Wachstum")),
    );
  }
}

console.log("\nmehrere Peers werden nicht gemittelt");
{
  resetTamEstimateCacheForTests();
  const result = await estimateSegmentTam({
    ticker: "SAP.DE",
    peerAnchor: null,
    peerEvidence: [
      { symbol: "ORCL", segmentName: "Services", revenueB: 4, sharePct: 10 },
      { symbol: "CRM", segmentName: "Services", revenueB: 8, sharePct: 10 },
    ],
    segments: SAP_SEGMENTS,
  }, {
    isLLMAvailable: () => true,
    callLLMJson: (async () => ({ modelUsed: "x", data: { fills: [] } })) as Llm,
  });
  const services = result.ok ? result.fills.find((f) => f.segmentName === "Services") : undefined;
  check("Services-TAM ist nicht der Mittelwert 60", result.ok === true && services?.tamSize !== 60 && services?.tamSize == null);
  check("Grund nennt die zwei Peers", result.ok === true && result.naReasons.some((r) => r.segmentName === "Services" && r.reason.includes("nicht gemittelt")));
}

console.log(failed === 0 ? "\n✅ SAP.DE TAM" : `\n❌ ${failed} fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
