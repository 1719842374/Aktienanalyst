/**
 * Nachtrag 2: einzelne n/a-Zelle, Supplement im Prompt, Einheiten, kein stiller Abbruch.
 * Aufruf: npx tsx script/test-segment-n33.ts
 */
import { readFileSync } from "node:fs";
import { countScopeRestNa, deriveTamShare, segmentNeedsLlm, TAM_NA_SHARE_WARN } from "../shared/tam-na-fill";
import { requestTamNaFills } from "../server/tam-na-fill";

delete process.env.OPENROUTER_API_KEY;

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

const nvdaRevenueUsd = 63_888_888_889;
const nvdaTamBillions = 500;
const openTam = [{
  segmentName: "Data Center",
  segmentRevenue: 63.9,
  segmentGrowth: 68.2,
  matched: true as const,
  tamSize: null,
  tamCAGR: null,
}];
gap(
  "only-tam-counts-as-na",
  segmentNeedsLlm(openTam[0]) && countScopeRestNa(openTam, null) > 0,
  `llm=${segmentNeedsLlm(openTam[0])} offene Zellen=${countScopeRestNa(openTam, null)}`,
);
const growthSetTamMissing = await requestTamNaFills({
  ticker: "NVDA",
  companyName: "NVIDIA Corporation",
  currency: "USD",
  fiscalYear: "2025",
  peerAnchor: null,
  segments: [{
    segmentName: "Data Center",
    segmentRevenue: 63.9,
    segmentGrowth: 68.2,
    matched: true,
    tamSize: null,
    tamCAGR: null,
  }],
}, {
  isLLMAvailable: () => true,
  callLLMJson: async () => ({
    modelUsed: "mock-model",
    data: {
      fills: [{
        segmentName: "Data Center",
        tamSize: 500,
        tamCAGR: 25,
        tamSource: "Gartner Data Center 2025",
        formula: "Markt für Beschleuniger",
        rationale: "Belegt",
        confidence: "med",
      }],
    },
  }),
});
const keptGrowth = growthSetTamMissing.ok
  ? growthSetTamMissing.fills.find((row) => row.segmentName === "Data Center")
  : undefined;
gap(
  "growth-set-tam-null-is-not-400",
  growthSetTamMissing.ok === true && keptGrowth?.tamSize === 500 && keptGrowth.segmentGrowth == null,
  growthSetTamMissing.ok ? `tam=${String(keptGrowth?.tamSize)} growth=${String(keptGrowth?.segmentGrowth)}` : `${growthSetTamMissing.status} ${growthSetTamMissing.error}`,
);

const prompts: string[] = [];
const result = await requestTamNaFills({
  ticker: "NVDA",
  companyName: "NVIDIA Corporation",
  sector: "Technology",
  industry: "Semiconductors",
  description: "NVIDIA baut Beschleuniger.",
  currency: "USD",
  fiscalYear: "2025",
  totalRevenue: 130.5,
  peerAnchor: {
    medianRevenueYoyPct: 34.3,
    peerCount: 5,
    p25RevenueYoyPct: 10,
    p75RevenueYoyPct: 40,
    source: "FMP income-statement",
  },
  supplementGrowth: [{
    name: "Data Center",
    nextYearGrowthPct: 68.2,
    observations: 7,
    source: "FMP revenue-product-segmentation",
  }],
  segments: [{
    segmentName: "Data Center",
    segmentRevenue: nvdaRevenueUsd,
    segmentShare: 80,
    segmentGrowth: null,
    matched: true,
    tamSize: null,
    tamCAGR: null,
  }],
} as never, {
  isLLMAvailable: () => true,
  callLLMJson: async (opts) => {
    prompts.push(opts.prompt);
    return {
      modelUsed: "mock-model",
      data: {
        fills: [{
          segmentName: "Data Center",
          segmentGrowth: 126,
          tamSize: nvdaTamBillions,
          tamCAGR: 25,
          tamSource: "Gartner Data Center 2025",
          formula: "Markt für Beschleuniger",
          rationale: "Belegt",
          confidence: "med",
        }],
      },
    };
  },
});
const prompt = prompts.join("\n");
gap(
  "no-400-when-only-tam-missing",
  result.ok === true,
  result.ok ? "ok" : `${result.status} ${result.error}`,
);
gap(
  "prompt-has-supplement-revenue-year-currency-peer",
  prompt.includes("68.2")
    && prompt.includes("7")
    && prompt.includes("Data Center")
    && prompt.includes("2025")
    && prompt.includes("USD")
    && prompt.includes("34.3")
    && prompt.includes("130.5"),
  prompt.slice(0, 500),
);
const dc = result.ok ? result.fills.find((row) => row.segmentName === "Data Center") : undefined;
gap(
  "known-supplement-growth-not-replaced",
  !!dc && dc.segmentGrowth !== 126 && dc.tamSize === nvdaTamBillions && dc.shareWarning !== true,
  dc ? `growth=${String(dc.segmentGrowth)} tam=${String(dc.tamSize)} share=${String(dc.marketShare)} warn=${String(dc.shareWarning)}` : "kein Fill",
);
const rawShare = deriveTamShare(nvdaRevenueUsd, nvdaTamBillions);
gap(
  "nvda-units-no-share-warning",
  rawShare <= TAM_NA_SHARE_WARN && Math.abs(rawShare - 12.78) < 0.05,
  `share=${rawShare} warnThreshold=${TAM_NA_SHARE_WARN}`,
);

const section = readFileSync("client/src/components/sections/Section7.tsx", "utf8");
const ui = await import("../client/src/components/sections/Section7");
const hint = (ui as { tamNaHint?: (count: number) => string | null }).tamNaHint;
gap(
  "no-silent-abort-visible-hint",
  typeof hint === "function"
    && hint(0) === "Keine N/A-Zellen"
    && hint(2) === null
    && section.includes('data-testid="tam-na-none"')
    && !/scopeNaCount === 0\) return/.test(section),
  `hint=${typeof hint === "function" ? hint(0) : "fehlt"}`,
);

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n33: OK");
