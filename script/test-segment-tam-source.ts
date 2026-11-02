/**
 * Quellenfilter der TAM-Schätzung und Peer-Anker. Kein Netz.
 * Ausführen: npx tsx script/test-segment-tam-source.ts
 */
import { peerGrowthAnchorFromYoys } from "../shared/peer-growth-anchor";
import { retainSourcedTamNaFills, type TamNaFill } from "../shared/tam-na-fill";
import { estimateSegmentTam } from "../server/segment-tam-estimate-route";
import { statementYearsFromFmp } from "../server/segment-growth-route";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nPeer-Median");
{
  const anchor = peerGrowthAnchorFromYoys([10, 30, 20]);
  check("Median der drei Raten ist 20", anchor?.medianRevenueYoyPct === 20, String(anchor?.medianRevenueYoyPct));
  check("P25 und P75 liegen auf der Stichprobe", anchor?.p25RevenueYoyPct === 15 && anchor?.p75RevenueYoyPct === 25, JSON.stringify(anchor));
  check("leere Stichprobe ist null", peerGrowthAnchorFromYoys([]) === null);
}

console.log("\nStatements");
{
  const years = statementYearsFromFmp(
    [{ date: "2025-06-30", revenue: 100 }, { date: "2024-06-30", revenue: 80 }],
    [{ date: "2025-06-30", revenue: 100 }],
    [{ date: "2025-06-30", revenue: 900 }],
  );
  check("zwei Jahre, neuestes zuerst", years[0]?.periodKey === "2025-06-30" && years[1]?.income === 80, JSON.stringify(years));
  check("Cashflow-Umsatz liegt auf demselben Jahr", years[0]?.cashflow === 100);
}

console.log("\nQuellenfilter");
{
  const fills: TamNaFill[] = [
    { segmentName: "Server", tamSize: 500, tamCAGR: 12, confidence: "low", rationale: "" },
    { segmentName: "XBOX", segmentGrowth: 4, confidence: "med", rationale: "unter Peer-Median", formula: "4% ≈ Peer-Median" },
    { segmentName: "Other / nicht segmentiert", segmentGrowth: 9, tamSize: 40, tamCAGR: 3, tamSource: "Branche", confidence: "low", rationale: "Rest relativ zur Branche" },
  ];
  const kept = retainSourcedTamNaFills(fills);
  check("TAM ohne Quelle fällt", !kept.fills.some((f) => f.segmentName === "Server"));
  check("Grund nennt TAM ohne Quelle", kept.naReasons.some((r) => r.segmentName === "Server" && r.field === "tam" && r.reason.includes("ohne Quelle")));
  check("Wachstum mit Formel bleibt", kept.fills.find((f) => f.segmentName === "XBOX")?.segmentGrowth === 4);
  check("belegtes Other bleibt", kept.fills.find((f) => f.segmentName === "Other / nicht segmentiert")?.tamSource === "Branche");
}

console.log("\nSchätz-Route relativ zum Peer-Anker");
{
  let prompt = "";
  const result = await estimateSegmentTam({
    ticker: "MSFT",
    sector: "Technology",
    industry: "Software",
    coveragePct: 59,
    peerAnchor: { peerCount: 3, medianRevenueYoyPct: 12, p25RevenueYoyPct: 8, p75RevenueYoyPct: 18, source: "FMP income-statement Peer-Umsatz-YoY" },
    peerEvidence: [],
    segments: [
      { segmentName: "Server", segmentRevenue: 129.4, segmentShare: 39, segmentGrowth: 31.5, matched: false, tamSize: null, tamCAGR: null },
    ],
  }, {
    isLLMAvailable: () => true,
    callLLMJson: async (opts) => {
      prompt = opts.prompt;
      return {
        modelUsed: "test",
        data: { fills: [{ segmentName: "Server", tamSize: 800, tamCAGR: 11, tamLabel: "Cloud", confidence: "med", rationale: "nahe Peer-Median 12" }] },
      };
    },
  });
  check("Prompt nennt den Peer-Median", prompt.includes("PEER-ANKER") && prompt.includes("12"), prompt.slice(0, 240));
  const server = result.ok ? result.fills.find((f) => f.segmentName === "Server") : undefined;
  check("TAM ohne tamSource wird nicht übernommen", result.ok === true && server?.tamSize == null, JSON.stringify(result));
  check("CAGR-Proxy bleibt das Segment-Wachstum", server?.tamCAGR === 31.5 && server.formula?.includes("CAGR-Proxy"));
  check("Grund bleibt am Server-TAM", result.ok === true && result.naReasons.some((r) => r.field === "tam"));
}

console.log(failed === 0 ? "\n✅ Quellenfilter" : `\n❌ ${failed} fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
