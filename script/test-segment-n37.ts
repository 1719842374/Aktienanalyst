/**
 * Tester-FAIL DoD 4, Preview pr-486, Head 9807b6dc:
 * SAP.DE POST /api/segment-tam-estimate → 422 INCOMPLETE_FILL.
 * Die Modellantwort enthält eine belegte TAM-Zahl. Die CAGR liegt außerhalb
 * −30…80 und tamSize kommt als Ziffernstring. validateTamNaFills wirft die
 * Zeile komplett weg. Weil das Fakt-Wachstum schon gesetzt ist, bleibt kein
 * Fill übrig. Der Handler antwortet nur mit {error, code}.
 *
 * Services −1,9 % ist die Fact-Rate. Spec und DoD 4 behalten eine numerische
 * Fact-Rate. Sie wird nicht durch n/a und nicht durch 0 ersetzt.
 * Aufruf: npx tsx script/test-segment-n37.ts
 */
import express from "express";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { applicableTamNaFills, type TamNaSegmentRef } from "../shared/tam-na-fill";
import { registerSegmentTamEstimateRoute } from "../server/segment-tam-estimate-route";
import { redactTamLlmShape } from "../server/tam-na-fill";

delete process.env.OPENROUTER_API_KEY;
delete process.env.FMP_API_KEY;
delete process.env.FMP_API_key;

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

interface EstimateBody {
  error?: string;
  code?: string;
  modelUsed?: string | null;
  fills?: { segmentName?: string; segmentGrowth?: number; tamSize?: number; tamCAGR?: number; tamSource?: string }[];
  naReasons?: { segmentName: string; field: string; reason: string }[];
}

const sapModel = {
  fills: [
    {
      segmentName: "Cloud",
      tamSize: "250",
      tamCAGR: 95,
      tamLabel: "Enterprise application software",
      tamSource: "IDC Enterprise Applications",
      formula: "Cloud-Umsatz gegen den von IDC belegten Enterprise-Application-Markt",
      rationale: "IDC-Marktgröße, CAGR der Antwort liegt außerhalb −30…80",
      confidence: "med",
    },
    {
      segmentName: "Software support",
      tamSize: 40,
      rationale: "kein belegter Support-Markt",
      confidence: "low",
    },
    {
      segmentName: "Software licenses",
      rationale: "kein belegter Lizenzmarkt",
      confidence: "low",
    },
    {
      segmentName: "Services",
      segmentGrowth: -1.9,
      confidence: "low",
      rationale: "",
    },
  ],
};

const msftModel = {
  fills: [
    {
      segmentName: "Server",
      tamSize: 1200,
      tamCAGR: 9.6,
      tamLabel: "Enterprise infrastructure",
      tamSource: "IDC",
      formula: "Server-Umsatz gegen den Infrastrukturmarkt",
      rationale: "IDC-Infrastrukturmarkt",
      confidence: "med",
    },
  ],
};

const prompts: string[] = [];
const app = express();
app.use(express.json({ limit: "1mb" }));
registerSegmentTamEstimateRoute(app, {
  isLLMAvailable: () => true,
  callLLMJson: async (opts) => {
    prompts.push(opts.prompt);
    const data = opts.prompt.includes("MSFT")
      ? msftModel
      : opts.prompt.includes("1500")
        ? sapLiveShape
        : sapModel;
    return { modelUsed: "anthropic/claude-haiku-4.5", data };
  },
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;

async function post(body: unknown): Promise<{ status: number; json: EstimateBody }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/segment-tam-estimate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as EstimateBody;
  return { status: res.status, json };
}

const sapLiveShape = JSON.parse(readFileSync("script/fixtures/sap-de-tam-llm-shape.json", "utf8")).shape as { fills: unknown[] };

const sapLiveSegments = [
  { segmentName: "Cloud", segmentRevenue: 21, segmentShare: 57.1, segmentGrowth: 22.6, matched: true, tamSize: 1500, tamCAGR: 16 },
  { segmentName: "Software support", segmentRevenue: 10.5, segmentShare: 28.6, segmentGrowth: -6.8, matched: false, tamSize: null, tamCAGR: null },
  { segmentName: "Services", segmentRevenue: 4.3, segmentShare: 11.6, segmentGrowth: -1.9, matched: false, tamSize: null, tamCAGR: null },
  { segmentName: "Software licenses", segmentRevenue: 1, segmentShare: 2.7, segmentGrowth: -29.2, matched: false, tamSize: null, tamCAGR: null },
];

const sapSegments = [
  { segmentName: "Cloud", segmentRevenue: 15.2, segmentShare: 46, segmentGrowth: 22.6, matched: false, tamSize: null, tamCAGR: null },
  { segmentName: "Software support", segmentRevenue: 9.1, segmentShare: 28, segmentGrowth: -6.8, matched: false, tamSize: null, tamCAGR: null },
  { segmentName: "Software licenses", segmentRevenue: 4.6, segmentShare: 14, segmentGrowth: -29.2, matched: false, tamSize: null, tamCAGR: null },
  { segmentName: "Services", segmentRevenue: 3.9, segmentShare: 12, segmentGrowth: -1.9, matched: false, tamSize: null, tamCAGR: null },
];

try {
  const sap = await post({
    ticker: "SAP.DE",
    companyName: "SAP SE",
    sector: "Technology",
    industry: "Software - Application",
    currency: "EUR",
    fiscalYear: "2024",
    totalRevenue: 34.1,
    supplementGrowth: [
      { name: "Cloud", nextYearGrowthPct: 22.6, field: "nextYearGrowthPct", observations: 3, source: "FMP revenue-product-segmentation" },
      { name: "Software support", nextYearGrowthPct: -6.8, field: "reportedGrowthPct", observations: 1, source: null },
      { name: "Services", nextYearGrowthPct: -1.9, field: "reportedGrowthPct", observations: 1, source: null },
      { name: "Software licenses", nextYearGrowthPct: -29.2, field: "reportedGrowthPct", observations: 1, source: null },
    ],
    regions: [
      { name: "EMEA", revenue: 14_200_000_000, yoy: 4.1, source: "FMP" },
      { name: "Americas", revenue: 13_100_000_000, yoy: 6.4, source: "FMP" },
      { name: "APJ", revenue: 6_800_000_000, yoy: 8.2, source: "FMP" },
    ],
    segments: sapSegments,
  });
  const fills = sap.json.fills ?? [];
  const reasons = sap.json.naReasons ?? [];
  const cloud = fills.find((row) => row.segmentName === "Cloud");
  const supportReason = reasons.find((row) => row.segmentName === "Software support" && row.field === "tam");
  const licenseReason = reasons.find((row) => row.segmentName === "Software licenses" && row.field === "tam");
  const servicesGrowthReason = reasons.find((row) => row.segmentName === "Services" && row.field === "growth");
  const servicesTamReason = reasons.find((row) => row.segmentName === "Services" && row.field === "tam");
  const cloudCagrReason = reasons.find((row) => row.segmentName === "Cloud" && row.field === "cagr");
  const prompt = prompts.join("\n");

  gap(
    "sap-partial-is-200-not-422",
    sap.status === 200
      && sap.json.code !== "INCOMPLETE_FILL"
      && cloud?.tamSize === 250
      && cloud.tamCAGR == null
      && cloud.tamSource === "IDC Enterprise Applications"
      && !fills.some((row) => row.segmentGrowth === 0 || row.tamSize === 0)
      && !fills.some((row) => row.segmentName === "Software support" || row.segmentName === "Software licenses" || row.segmentName === "Services"),
    `status=${sap.status} code=${sap.json.code ?? ""} error=${sap.json.error ?? ""} cloud=${cloud ? `tam=${String(cloud.tamSize)} cagr=${String(cloud.tamCAGR)}` : "fehlt"} fills=${fills.map((row) => row.segmentName).join(",") || "leer"}`,
  );
  gap(
    "sap-open-cells-have-reasons",
    !!supportReason?.reason.startsWith("n/a")
      && !!licenseReason?.reason.startsWith("n/a")
      && !!servicesTamReason?.reason.startsWith("n/a")
      && !!cloudCagrReason?.reason.startsWith("n/a")
      && !servicesGrowthReason
      && sap.json.modelUsed === "anthropic/claude-haiku-4.5",
    `model=${String(sap.json.modelUsed)} reasons=${reasons.map((row) => `${row.segmentName}:${row.field}`).join(",") || "leer"}`,
  );
  gap(
    "sap-prompt-keeps-regions",
    prompt.includes("EMEA")
      && prompt.includes("Americas")
      && prompt.includes("APJ")
      && prompt.includes("Quelle FMP"),
    prompt.includes("Regionen") ? prompt.slice(prompt.indexOf("Regionen"), prompt.indexOf("Regionen") + 280) : "kein Regionen-Block",
  );

  prompts.length = 0;
  const live = await post({
    ticker: "SAP.DE",
    companyName: "SAP SE",
    sector: "Technology",
    industry: "Software - Application",
    currency: "USD",
    fiscalYear: "2025",
    totalRevenue: 40.3,
    coveragePct: 57.1,
    supplementGrowth: [
      { name: "Cloud", nextYearGrowthPct: 22.6, reportedGrowthPct: 22.6, field: "reportedGrowthPct", observations: 0, source: null },
      { name: "Software support", nextYearGrowthPct: -6.8, reportedGrowthPct: -6.8, field: "reportedGrowthPct", observations: 0, source: null },
      { name: "Services", nextYearGrowthPct: -1.9, reportedGrowthPct: -1.9, field: "reportedGrowthPct", observations: 0, source: null },
      { name: "Software licenses", nextYearGrowthPct: -29.2, reportedGrowthPct: -29.2, field: "reportedGrowthPct", observations: 0, source: null },
    ],
    regions: [
      { name: "EMEA", revenue: 15_013_000_000, yoy: -3.6, source: "FMP" },
      { name: "Americas", revenue: 12_744_000_000, yoy: -7.7, source: "FMP" },
      { name: "APJ", revenue: 4_781_000_000, yoy: -0.3, source: "FMP" },
    ],
    segments: sapLiveSegments,
  });
  const liveFills = live.json.fills ?? [];
  const liveReasons = live.json.naReasons ?? [];
  const liveRefs: TamNaSegmentRef[] = sapLiveSegments.map((row) => ({
    segmentName: row.segmentName,
    segmentRevenue: row.segmentRevenue,
    segmentGrowth: row.segmentGrowth,
    matched: row.matched,
    tamSize: row.tamSize,
    tamCAGR: row.tamCAGR,
  }));
  const applied = applicableTamNaFills(liveRefs, liveFills as never);
  const clientShowsRed = live.status !== 200 || !Array.isArray(live.json.fills) || (applied.length === 0 && liveReasons.length === 0);
  const openTam = ["Software support", "Services", "Software licenses"];
  gap(
    "sap-live-empty-model-is-200-with-reasons",
    !clientShowsRed
      && live.json.code !== "INCOMPLETE_FILL"
      && live.json.modelUsed === "anthropic/claude-haiku-4.5"
      && !liveFills.some((row) => row.segmentGrowth != null || row.tamSize != null)
      && openTam.every((name) => liveReasons.some((row) => row.segmentName === name && row.field === "tam" && row.reason.startsWith("n/a")))
      && openTam.every((name) => liveReasons.some((row) => row.segmentName === name && row.field === "cagr" && row.reason.includes("CAGR ohne Beleg")))
      && !liveReasons.some((row) => row.segmentName === "Services" && row.field === "growth")
      && !liveReasons.some((row) => row.segmentName === "Cloud"),
    `status=${live.status} code=${live.json.code ?? ""} model=${String(live.json.modelUsed)} fills=${liveFills.map((row) => row.segmentName).join(",") || "leer"} reasons=${liveReasons.map((row) => `${row.segmentName}:${row.field}`).join(",") || "leer"}`,
  );

  prompts.length = 0;
  const msft = await post({
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    currency: "USD",
    fiscalYear: "2025",
    totalRevenue: 281.7,
    peerAnchor: null,
    segments: [
      { segmentName: "Server", segmentRevenue: 129.4, segmentShare: 39, segmentGrowth: 31.5, matched: false, tamSize: null, tamCAGR: null },
    ],
  });
  const serverFill = (msft.json.fills ?? []).find((row) => row.segmentName === "Server");
  gap(
    "msft-server-fill-stays-200",
    msft.status === 200
      && serverFill?.tamSize === 1200
      && serverFill.tamCAGR === 9.6
      && serverFill.tamSource === "IDC"
      && msft.json.modelUsed === "anthropic/claude-haiku-4.5",
    `status=${msft.status} code=${msft.json.code ?? ""} tam=${String(serverFill?.tamSize)} cagr=${String(serverFill?.tamCAGR)} model=${String(msft.json.modelUsed)}`,
  );
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

const redacted = redactTamLlmShape({
  fills: [{ segmentName: "Cloud", tamSize: 250, tamSource: "IDC", note: "sk-live-secret-value" }],
});
gap(
  "redacted-shape-keeps-numbers-drops-keys",
  redacted.includes("\"tamSize\":250") && redacted.includes("Cloud") && !redacted.includes("sk-live"),
  redacted,
);

const section = readFileSync("client/src/components/sections/Section7.tsx", "utf8");
gap(
  "client-applies-partial-fills-and-cell-reasons",
  section.includes("naReasons")
    && section.includes("applicableTamNaFills")
    && section.includes("naTam?.reason")
    && section.includes("naCagr?.reason")
    && section.includes("growthFactsFromSupplement")
    && section.includes("regions:"),
  "Section7 übernimmt fills oder naReasons nicht pro Zelle",
);

if (gaps.length > 0) {
  console.error(`n37 RED ${gaps.length}`);
  process.exit(1);
}
console.log("n37 PASS");
