/**
 * DoD 4: SAP.DE-Supplement mit growthCount 4, nextYearGrowthPct null,
 * numerische Werte unter reportedGrowthPct. Fills dürfen nicht leer sein.
 * Eine echte Lücke bleibt n/a mit Grund, 0 ist kein Ersatz.
 * DoD 2: Regionen stehen mit Quelle im OpenRouter-Prompt, ohne neue FMP-Abfrage.
 * Aufruf: npx tsx script/test-segment-n35.ts
 */
import express from "express";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { getFmpBudgetStatus, resetFmpBudget } from "../server/analyze-helpers";
import { registerSegmentTamEstimateRoute } from "../server/segment-tam-estimate-route";

delete process.env.OPENROUTER_API_KEY;
delete process.env.FMP_API_KEY;
delete process.env.FMP_API_key;

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

const supplement = await import("../shared/segment-supplement");
const growthFactsFromSupplement = (supplement as {
  growthFactsFromSupplement?: (body: unknown) => { name: string; pct: number; field: string; observations: number; source: string | null }[];
}).growthFactsFromSupplement;

/** Echte Response-Shape von POST /api/segment-supplement (shared/segment-supplement.ts). */
const sapSupplement = {
  ticker: "SAP.DE",
  source: "fmp" as const,
  parents: [
    { name: "Cloud", percentage: 46, reportedGrowthPct: 23.1 },
    { name: "Software support", percentage: 28, reportedGrowthPct: 4.2 },
    { name: "Software licenses", percentage: 14, reportedGrowthPct: -3.5 },
    { name: "Services", percentage: 12, reportedGrowthPct: null },
  ],
  growth: [
    {
      name: "Cloud",
      reportedGrowthPct: 23.1,
      nextYearGrowthPct: null,
      observations: 1,
      source: null,
      override: false,
      label: "n/a — nicht schätzbar (1 belegte YoY-Rate(n), Median braucht mindestens zwei)",
    },
    {
      name: "Software support",
      reportedGrowthPct: 4.2,
      nextYearGrowthPct: null,
      observations: 0,
      source: null,
      override: false,
      label: "n/a — nicht schätzbar (0 belegte YoY-Rate(n), Median braucht mindestens zwei)",
    },
    {
      name: "Software licenses",
      reportedGrowthPct: -3.5,
      nextYearGrowthPct: null,
      observations: 0,
      source: null,
      override: false,
      label: "n/a — nicht schätzbar (0 belegte YoY-Rate(n), Median braucht mindestens zwei)",
    },
    {
      name: "Services",
      reportedGrowthPct: null,
      nextYearGrowthPct: null,
      observations: 0,
      source: null,
      override: false,
      label: "n/a — nicht schätzbar (0 belegte YoY-Rate(n), Median braucht mindestens zwei)",
    },
  ],
  subItems: [],
  reportedSharePct: 100,
  reportedShareReason: null,
  undisclosedNote: "n/a — nicht schätzbar, keine belegte Unterposten-Quelle. Top-Level-Segmente und ihre Summe bleiben unverändert.",
  childShareNotes: [],
  historyNote: null,
};

const facts = growthFactsFromSupplement?.(sapSupplement) ?? [];
gap(
  "sap-growth-count-4-keeps-numeric-fields",
  typeof growthFactsFromSupplement === "function"
    && sapSupplement.growth.length === 4
    && facts.length === 3
    && facts.some((row) => row.name === "Cloud" && row.pct === 23.1 && row.field === "reportedGrowthPct")
    && facts.some((row) => row.name === "Software licenses" && row.pct === -3.5 && row.field === "reportedGrowthPct")
    && !facts.some((row) => row.name === "Services")
    && !facts.some((row) => row.pct === 0),
  `helper=${typeof growthFactsFromSupplement} facts=${facts.map((row) => `${row.name}:${row.field}:${row.pct}`).join(",") || "leer"}`,
);

const zeroKept = growthFactsFromSupplement?.({
  growth: [{
    name: "Flat",
    reportedGrowthPct: 0,
    nextYearGrowthPct: null,
    observations: 2,
    source: null,
    override: false,
    label: "gemeldet",
  }],
}) ?? [];
gap(
  "real-zero-stays-missing-does-not",
  zeroKept.length === 1 && zeroKept[0]?.pct === 0 && zeroKept[0]?.field === "reportedGrowthPct",
  `rows=${zeroKept.length} pct=${String(zeroKept[0]?.pct)}`,
);

const prompts: string[] = [];
const app = express();
app.use(express.json({ limit: "1mb" }));
registerSegmentTamEstimateRoute(app, {
  isLLMAvailable: () => true,
  callLLMJson: async (opts) => {
    prompts.push(opts.prompt);
    return { modelUsed: "mock-model", data: { fills: [] } };
  },
});
const server = app.listen(0);
const port = (server.address() as AddressInfo).port;

const segments = [
  { segmentName: "Cloud", segmentRevenue: 15.2, segmentShare: 46, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
  { segmentName: "Software support", segmentRevenue: 9.1, segmentShare: 28, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
  { segmentName: "Software licenses", segmentRevenue: 4.6, segmentShare: 14, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
  { segmentName: "Services", segmentRevenue: 3.9, segmentShare: 12, segmentGrowth: null, matched: false, tamSize: null, tamCAGR: null },
];

async function post(body: unknown): Promise<{ status: number; json: { error?: string; code?: string; fills?: { segmentName?: string; segmentGrowth?: number }[]; naReasons?: { segmentName: string; field: string; reason: string }[] } }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/segment-tam-estimate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { error?: string; code?: string; fills?: { segmentName?: string; segmentGrowth?: number }[]; naReasons?: { segmentName: string; field: string; reason: string }[] };
  return { status: res.status, json };
}

try {
  resetFmpBudget();
  const fmpBefore = getFmpBudgetStatus().today;
  const sap = await post({
    ticker: "SAP.DE",
    companyName: "SAP SE",
    currency: "EUR",
    fiscalYear: "2024",
    totalRevenue: 34.1,
    supplementGrowth: sapSupplement.growth,
    regions: [
      { name: "Germany", revenue: 18_400_000_000, yoy: 9.2, source: "FMP" },
      { name: "Americas", revenue: 11_200_000_000, yoy: null, source: "SEC" },
    ],
    segments,
  });
  const fmpAfter = getFmpBudgetStatus().today;
  const prompt = prompts.join("\n");
  const fills = sap.json.fills ?? [];
  const reasons = sap.json.naReasons ?? [];
  const servicesReason = reasons.find((row) => row.segmentName === "Services" && row.field === "growth");
  gap(
    "sap-growth-count-4-fills-not-empty",
    sap.status === 200
      && fills.length > 0
      && fills.some((row) => row.segmentName === "Cloud" && row.segmentGrowth === 23.1)
      && fills.some((row) => row.segmentName === "Software support" && row.segmentGrowth === 4.2)
      && fills.some((row) => row.segmentName === "Software licenses" && row.segmentGrowth === -3.5)
      && !fills.some((row) => row.segmentName === "Services")
      && !fills.some((row) => row.segmentGrowth === 0),
    `status=${sap.status} code=${sap.json.code ?? ""} fills=${fills.map((row) => `${row.segmentName}:${String(row.segmentGrowth)}`).join(",") || "leer"}`,
  );
  gap(
    "sap-real-gap-is-na-with-reason",
    !!servicesReason
      && servicesReason.reason.includes("n/a")
      && servicesReason.reason.includes("nextYearGrowthPct")
      && servicesReason.reason.includes("reportedGrowthPct")
      && sap.status !== 422,
    servicesReason ? servicesReason.reason : `status=${sap.status} error=${sap.json.error ?? ""}`,
  );
  gap(
    "prompt-names-reported-field",
    prompt.includes("reportedGrowthPct")
      && prompt.includes("23.1")
      && prompt.includes("4.2")
      && prompt.includes("-3.5")
      && !prompt.includes("Services: Median YoY 0"),
    prompt.slice(0, 500) || "kein Prompt",
  );
  gap(
    "prompt-has-regions-with-source",
    prompt.includes("Germany")
      && prompt.includes("Quelle FMP")
      && prompt.includes("Americas")
      && prompt.includes("Quelle SEC")
      && prompt.includes("18400000000")
      && !prompt.includes("Americas: Umsatz 0"),
    prompt.includes("Regionen") ? prompt.slice(prompt.indexOf("Regionen"), prompt.indexOf("Regionen") + 400) : "kein Regionen-Block",
  );
  gap(
    "regions-do-not-call-fmp",
    fmpAfter === fmpBefore,
    `before=${fmpBefore} after=${fmpAfter}`,
  );

  prompts.length = 0;
  const empty = await post({
    ticker: "SAP.DE",
    segments: [segments[3]],
  });
  gap(
    "no-number-and-empty-model-stays-422",
    empty.status === 422 && empty.json.code === "INCOMPLETE_FILL" && empty.json.error === "KI-Schätzung unvollständig — nichts übernommen",
    `status=${empty.status} code=${empty.json.code ?? ""} error=${empty.json.error ?? ""}`,
  );
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

const routeSrc = readFileSync("server/segment-tam-estimate-route.ts", "utf8");
const fillSrc = readFileSync("server/tam-na-fill.ts", "utf8");
const section = readFileSync("client/src/components/sections/Section7.tsx", "utf8");
gap(
  "tam-path-has-no-uncached-fmp-call",
  !routeSrc.includes("fmpSegmentationRows")
    && !routeSrc.includes("fmpGeoSegments")
    && !routeSrc.includes("fmpFetch")
    && !fillSrc.includes("fmpSegmentationRows")
    && !fillSrc.includes("fmpGeoSegments")
    && !fillSrc.includes("fmpFetch"),
  "TAM-Route oder Prompt-Builder ruft FMP auf",
);
gap(
  "client-reads-supplement-and-sends-regions",
  section.includes("growthFactsFromSupplement")
    && section.includes("geoSegments")
    && section.includes("regions:")
    && !section.includes('typeof row.nextYearGrowthPct !== "number"'),
  "Section7 filtert weiter nur nextYearGrowthPct oder schickt keine Regionen",
);

if (gaps.length > 0) {
  console.error(`n35 RED ${gaps.length}`);
  process.exit(1);
}
console.log("n35 PASS");
