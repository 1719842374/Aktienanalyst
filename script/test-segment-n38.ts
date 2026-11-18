/**
 * Kuratierte Segmente ohne YoY (NVO, Prod 18.11.2026): Button und OpenRouter-Fakten.
 * Aufruf: npx tsx --tsconfig script/tsconfig.jsx.json script/test-segment-n38.ts
 */
import React from "react";
import express from "express";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentSupplementBody } from "../client/src/components/sections/SegmentSupplementView";
import { segmentYoYGap } from "../client/src/components/sections/Section2";
import { checkSegmentMix, formulaText, notEstimableReason, priorFromGrowth } from "../shared/segment-yoy-fill";
import type { SegmentSupplement } from "../shared/segment-supplement";

(globalThis as { React?: typeof React }).React = React;
delete process.env.OPENROUTER_API_KEY;

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

const within = checkSegmentMix(
  [
    { name: "A", revenue: 500, share: 50, growth: 20 },
    { name: "B", revenue: 500, share: 50, growth: 0 },
  ],
  { totalRevenue: 1000, companyYoY: 10 },
);
gap(
  "mix-within-tolerance",
  within.revenueWithinTolerance === true
    && within.yoyWithinTolerance === true
    && within.revenueGap === 0
    && within.yoyGap === 0
    && within.text.includes("Abweichung"),
  within.text,
);

const outside = checkSegmentMix(
  [
    { name: "A", revenue: 100, share: 50, growth: 40 },
    { name: "B", revenue: 100, share: 50, growth: 0 },
  ],
  { totalRevenue: 1000, companyYoY: 10 },
);
gap(
  "mix-shows-deviation",
  outside.revenueWithinTolerance === false
    && outside.yoyWithinTolerance === false
    && outside.revenueGap === -800
    && outside.yoyGap === 10
    && outside.text.includes("Abweichung")
    && outside.text.includes("-800"),
  outside.text,
);

const partial = checkSegmentMix(
  [
    { name: "A", revenue: 500, share: 50, growth: 10 },
    { name: "B", revenue: 500, share: 50, growth: null },
  ],
  { totalRevenue: 1000, companyYoY: 10 },
);
gap(
  "mix-does-not-treat-missing-yoy-as-zero",
  partial.coveredSharePct === 50
    && partial.weightedYoY === 5
    && partial.text.includes("50")
    && !partial.text.includes("Faktor 1"),
  partial.text,
);

gap(
  "missing-facts-are-not-estimable",
  notEstimableReason(
    [{ name: "A", revenue: null, share: null, growth: null }],
    { totalRevenue: null, companyYoY: null },
  ) === "n/a — nicht schätzbar (keine Anteile, keine Segmentumsätze, kein Konzernumsatz)"
    && notEstimableReason(
      [{ name: "A", revenue: null, share: 43.6, growth: null }],
      { totalRevenue: null, companyYoY: null },
    ) === null,
  "Leere Fakten bleiben n/a, ein belegter Anteil nicht",
);

const formula = formulaText(43.6, 1000, 10);
gap(
  "formula-share-times-revenue",
  formula.includes("43.6") && formula.includes("436") && formula.includes("479.6") && formula.includes("×"),
  formula,
);
gap(
  "formula-without-growth-stays-na",
  formulaText(43.6, 1000, null).includes("nicht schätzbar") && !formulaText(null, null, 10).includes("Faktor"),
  formulaText(43.6, 1000, null),
);
gap(
  "prior-from-two-facts",
  priorFromGrowth(110, 10) === 100 && priorFromGrowth(null, 10) === null,
  String(priorFromGrowth(110, 10)),
);

gap(
  "curated-source-does-not-hide-gap",
  segmentYoYGap([{ growth: null }]) === true
    && segmentYoYGap([{ growth: 4 }]) === false
    && segmentYoYGap([{ yoyChangePercent: 2 }]) === false
    && segmentYoYGap([]) === false,
  "Lücke nur ohne numerisches YoY",
);

const section = await import("../client/src/components/sections/Section2");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
client.setQueryData(["/api/segment-growth", "NVO"], { ticker: "NVO", business: [], geographic: [], source: "fixture", currency: "DKK" });
const nvoHtml = renderToStaticMarkup(React.createElement(
  QueryClientProvider,
  { client },
  React.createElement(section.SegmentEstimateBlock, {
    data: {
      ticker: "NVO",
      companyName: "Novo Nordisk A/S",
      description: "Novo Nordisk.",
      currency: "USD",
      revenue: 1000,
      revenueSegmentsSource: "curated",
      revenueSegments: [
        { name: "GLP-1 Diabetes (Ozempic/Rybelsus)", percentage: 43.6, revenue: 436, growth: null },
        { name: "Obesity Care (Wegovy/Saxenda)", percentage: 22.4, revenue: 224, growth: null },
        { name: "Insulin & Other Diabetes", percentage: 25.7, revenue: 257, growth: null },
        { name: "Rare Disease", percentage: 5.4, revenue: 54, growth: null },
        { name: "Other", percentage: 2.9, revenue: 29, growth: null },
      ],
      geoSegments: [{ name: "North America", percentage: 60, revenue: 600, growth: 8 }],
      financialStatements: { incomeStatement: { revenue: 1000, revenueGrowth: 12.5 } },
    } as never,
  }),
));
gap(
  "curated-segments-show-ki-button",
  nvoHtml.includes("button-segment-outline-product")
    && nvoHtml.includes("N/A mit KI schätzen")
    && nvoHtml.includes("Geschäftsbericht (kuratiert)")
    && nvoHtml.includes("GLP-1 Diabetes"),
  `button=${nvoHtml.includes("button-segment-outline-product")} curated=${nvoHtml.includes("Geschäftsbericht (kuratiert)")}`,
);

const covered = new QueryClient({ defaultOptions: { queries: { retry: false } } });
covered.setQueryData(["/api/segment-growth", "MSFT"], { ticker: "MSFT", business: [], geographic: [], source: "fixture", currency: "USD" });
const msftHtml = renderToStaticMarkup(React.createElement(
  QueryClientProvider,
  { client: covered },
  React.createElement(section.SegmentEstimateBlock, {
    data: {
      ticker: "MSFT",
      currency: "USD",
      revenue: 281,
      revenueSegmentsSource: "fmp",
      revenueSegments: [{ name: "Server", percentage: 40, revenue: 100, growth: 10 }],
      geoSegments: [],
    } as never,
  }),
));
gap(
  "product-button-hidden-when-yoy-exists",
  !msftHtml.includes("button-segment-outline-product") && msftHtml.includes("Server"),
  `button=${msftHtml.includes("button-segment-outline-product")}`,
);

const deadEnd: SegmentSupplement = {
  parents: [],
  growth: [{
    name: "GLP-1 Diabetes (Ozempic/Rybelsus)",
    reportedGrowthPct: null,
    nextYearGrowthPct: null,
    observations: 0,
    source: null,
    override: false,
    label: "n/a — nicht schätzbar (0 belegte YoY-Rate(n), Median braucht mindestens zwei)",
  }],
  subItems: [],
  reportedSharePct: 100,
  reportedShareReason: null,
  undisclosedNote: "n/a",
  childShareNotes: [],
  historyNote: null,
};
const kiLine = renderToStaticMarkup(React.createElement(SegmentSupplementBody, {
  data: deadEnd,
  kiGrowth: {
    "GLP-1 Diabetes (Ozempic/Rybelsus)": { pct: 9.5, model: "mock-model", source: "Novo Nordisk Geschäftsbericht 2024" },
  },
}));
gap(
  "next-year-uses-ki-when-median-missing",
  kiLine.includes("segment-growth-ki") && kiLine.includes("9.5") && kiLine.includes("KI-Schätzung") && kiLine.includes("mock-model"),
  kiLine.slice(0, 300),
);
const medianLine = renderToStaticMarkup(React.createElement(SegmentSupplementBody, {
  data: {
    ...deadEnd,
    growth: [{ ...deadEnd.growth[0], nextYearGrowthPct: 6, observations: 3, source: "FMP revenue-product-segmentation", label: "Median" }],
  },
  kiGrowth: { "GLP-1 Diabetes (Ozempic/Rybelsus)": { pct: 9.5, model: "mock-model", source: "x" } },
}));
gap(
  "median-stays-when-two-rates-exist",
  medianLine.includes("segment-growth-estimate") && medianLine.includes("6.0") && !medianLine.includes("segment-growth-ki"),
  medianLine.slice(0, 300),
);
const naLine = renderToStaticMarkup(React.createElement(SegmentSupplementBody, { data: deadEnd }));
gap(
  "next-year-stays-na-without-ki",
  naLine.includes("nicht schätzbar") && !naLine.includes("segment-growth-ki"),
  naLine.slice(0, 240),
);

const route = await import("../server/segment-growth-route");
const calls: { prompt: string; system: string }[] = [];
route.resetSegmentChildrenGuardsForTests();
const app = express();
app.use(express.json());
const nvoRows = [
  { name: "GLP-1 Diabetes (Ozempic/Rybelsus)", revenue: 436, share: 43.6, growth: null },
  { name: "Obesity Care (Wegovy/Saxenda)", revenue: 224, share: 22.4, growth: null },
  { name: "Insulin & Other Diabetes", revenue: 257, share: 25.7, growth: null },
  { name: "Rare Disease", revenue: 54, share: 5.4, growth: null },
  { name: "Other", revenue: 29, share: 2.9, growth: null },
];
route.registerSegmentGrowthRoute(app, {
  fmpAvailable: () => false,
  raw: async () => [],
  income: async () => [{ fiscalYear: "2025", reportedCurrency: "DKK", revenue: 309064000000 }],
  secSegments: async () => [],
  identity: async () => ({
    companyName: "Novo Nordisk A/S",
    exchange: "NYSE",
    country: "DK",
    sector: "Healthcare",
    industry: "Drug Manufacturers - General",
    description: "Novo Nordisk verkauft Ozempic, Rybelsus, Wegovy und Saxenda.",
    fiscalYear: "",
    currency: "",
  }),
  peers: async () => [],
  rateLimit: { max: 20, windowMs: 60_000 },
  llm: async (opts) => {
    calls.push({ prompt: opts.prompt, system: opts.systemPrompt ?? "" });
    const region = opts.prompt.includes("Nur Regionen");
    return {
      modelUsed: "mock-model",
      data: {
        companyEcho: "Novo Nordisk A/S",
        industryEcho: "Drug Manufacturers",
        children: (region ? [
          { name: "Europe", owner: "Novo Nordisk A/S", basis: "Fehlende Region", source: null, shareOfParentPct: null, growthPct: 4 },
        ] : nvoRows.map((row) => ({
          name: row.name,
          owner: "Novo Nordisk A/S",
          basis: "Anteil am Konzernumsatz und Konzern-YoY",
          source: "Novo Nordisk Geschäftsbericht 2024",
          shareOfParentPct: null,
          growthPct: 12.5,
        }))),
      },
    };
  },
});
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
try {
  const empty = await fetch(`http://127.0.0.1:${port}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: "NVO",
      kind: "product",
      rows: [{ name: "GLP-1 Diabetes (Ozempic/Rybelsus)", revenue: null, share: null, growth: null }],
      yahoo: { description: "Novo Nordisk.", currency: "USD" },
    }),
  });
  const emptyJson = await empty.json() as { reason?: string; items?: unknown[] };
  gap(
    "na-fallback-without-facts",
    empty.status === 200
      && calls.length === 0
      && (emptyJson.items ?? []).length === 0
      && (emptyJson.reason ?? "").includes("nicht schätzbar"),
    `status=${empty.status} calls=${calls.length} reason=${emptyJson.reason ?? ""}`,
  );

  const res = await fetch(`http://127.0.0.1:${port}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: "NVO",
      kind: "product",
      rows: nvoRows,
      yahoo: {
        description: "Novo Nordisk verkauft Ozempic, Rybelsus, Wegovy und Saxenda.",
        currency: "USD",
        fiscalYear: "2025",
        totalRevenue: 1000,
        companyYoY: 12.5,
        segments: nvoRows,
        regions: [{ name: "North America", revenue: 600, share: 60, growth: 8 }],
      },
    }),
  });
  const json = await res.json() as {
    items?: { name: string; growthPct: number | null }[];
    reason?: string;
    modelUsed?: string;
    mix?: { text?: string; revenueWithinTolerance?: boolean; yoyWithinTolerance?: boolean };
    formulas?: { name: string; text: string }[];
  };
  const prompt = calls.map((call) => call.prompt).join("\n");
  const glp = (json.formulas ?? []).find((row) => row.name.startsWith("GLP-1"));
  gap(
    "nvo-prompt-has-curated-facts",
    res.status === 200
      && prompt.includes("43.6")
      && prompt.includes("2024")
      && prompt.includes("1000")
      && prompt.includes("12.5")
      && prompt.includes("North America")
      && prompt.includes("8")
      && prompt.includes("USD")
      && prompt.includes("keine erneute Umrechnung")
      && !prompt.includes("309064000000")
      && (json.items ?? []).length === 5
      && json.modelUsed === "mock-model"
      && json.mix?.revenueWithinTolerance === true
      && json.mix?.yoyWithinTolerance === true
      && (glp?.text ?? "").includes("436")
      && (glp?.text ?? "").includes("nicht erneut") === false,
    `status=${res.status} model=${json.modelUsed ?? ""} mix=${json.mix?.text ?? ""} formula=${glp?.text ?? ""} prompt=${prompt.slice(0, 500)}`,
  );
  gap(
    "nvo-formula-marked-as-estimate-inputs",
    (glp?.text ?? "").includes("×") && (glp?.text ?? "").includes("12.5"),
    glp?.text ?? "keine Formel",
  );

  calls.length = 0;
  const unsourced = await fetch(`http://127.0.0.1:${port}/api/segment-outline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ticker: "NVO",
      kind: "geographic",
      rows: [
        { name: "Europe", revenue: 400, share: 40, growth: null },
        { name: "North America", revenue: 600, share: 60, growth: 8 },
      ],
      yahoo: {
        description: "Novo Nordisk.",
        currency: "USD",
        totalRevenue: 1000,
        companyYoY: 12.5,
        segments: nvoRows,
      },
    }),
  });
  const unsourcedJson = await unsourced.json() as {
    items?: { name: string; growthPct: number | null }[];
    reason?: string;
    mix?: { text?: string };
  };
  const regionPrompt = calls.map((call) => call.prompt).join("\n");
  const europe = (unsourcedJson.items ?? []).find((row) => row.name === "Europe");
  gap(
    "region-without-fmp-keeps-na-without-source",
    unsourced.status === 200
      && regionPrompt.includes("Europe")
      && regionPrompt.includes("43.6")
      && regionPrompt.includes("1000")
      && regionPrompt.includes("Nur Regionen")
      && (europe == null || europe.growthPct == null)
      && (unsourcedJson.reason ?? "").length > 0
      && !(unsourcedJson.items ?? []).some((row) => row.name === "North America" && row.growthPct != null && row.growthPct !== 8),
    `status=${unsourced.status} reason=${unsourcedJson.reason ?? ""} items=${JSON.stringify(unsourcedJson.items ?? [])} prompt=${regionPrompt.slice(0, 350)}`,
  );
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n38: OK");
