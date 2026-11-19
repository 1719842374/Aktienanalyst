/**
 * Branchen-Wachstum Sektion 9: Fallback-Kette, nicht der Score.
 *
 * 1. tamCAGR, wenn quality nicht 'unreliable' und nicht die Global-Market-Konstante.
 * 2. Peer-Median nur bei n≥5; n=3–4 nur Spanne; n≤2 kein Wert.
 * 3. KI-Schätzung nur mit Quelle und Begründung.
 * 4. sonst n/a mit Grund.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-industry-growth-fallback.ts
 */
import React from "react";
import { readFileSync } from "fs";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { Section7 } from "../client/src/components/sections/Section7";
import { deriveGateInputs } from "../server/scoring-integration";
import { generateTAMAnalysis } from "../server/sector-data";
import {
  GLOBAL_MARKET_TAM_LABEL,
  GLOBAL_MARKET_TAM_SOURCE,
  industryGrowthEstimatePrompt,
  industryGrowthEstimateBody,
  resolveIndustryGrowth,
  type IndustryGrowthResolved,
} from "../shared/industry-growth";

(globalThis as any).React = React;

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

function naReason(result: IndustryGrowthResolved): string {
  return result.kind === "na" ? result.reason : "";
}

check(
  "n=5 Median, null zählt nicht als 0",
  (() => {
    const result = resolveIndustryGrowth({
      quality: "unreliable",
      tamCAGR: 16,
      tamSource: "Gartner",
      peerRevenueGrowths: [10, null, 1, Number.NaN, 4, undefined, 8, 2],
      aiEstimate: null,
    });
    return result.kind === "peer-median" && result.n === 5 && result.value === 4 && result.source === "Peer-Median (n=5)";
  })(),
);

check(
  "n=6 Median ohne Rundung",
  (() => {
    const result = resolveIndustryGrowth({
      quality: "unreliable",
      tamCAGR: null,
      peerRevenueGrowths: [1, 2, 3, 4, 5, 6],
    });
    return result.kind === "peer-median" && result.n === 6 && result.value === 3.5 && result.source === "Peer-Median (n=6)";
  })(),
);

check(
  "n=4 nur Spanne, kein Median",
  (() => {
    const result = resolveIndustryGrowth({
      quality: "unreliable",
      tamCAGR: 9,
      peerRevenueGrowths: [9, 1, 4, 8],
    });
    return result.kind === "peer-span" && result.n === 4 && result.min === 1 && result.max === 9 && result.source === "Peer-Spanne (n=4)" && !("value" in result);
  })(),
);

check(
  "n=3 nur Spanne",
  (() => {
    const result = resolveIndustryGrowth({
      quality: "weak",
      tamCAGR: null,
      peerRevenueGrowths: [3, -2, 7],
    });
    return result.kind === "peer-span" && result.n === 3 && result.min === -2 && result.max === 7 && result.source === "Peer-Spanne (n=3)";
  })(),
);

check(
  "n=2 kein Peer-Wert",
  naReason(resolveIndustryGrowth({ quality: "unreliable", tamCAGR: null, peerRevenueGrowths: [13.7, 7.7] })).includes("n=2"),
);

check(
  "n=1 kein Peer-Wert",
  naReason(resolveIndustryGrowth({ quality: "unreliable", tamCAGR: null, peerRevenueGrowths: [4] })).includes("n=1"),
);

check(
  "quality ok nutzt tamCAGR 0 und die bisherige Quelle",
  (() => {
    const result = resolveIndustryGrowth({
      quality: "ok",
      tamCAGR: 0,
      tamSource: "Gartner Enterprise Software Forecast",
      peerRevenueGrowths: [1, 2, 3, 4, 5],
    });
    return result.kind === "tam" && result.value === 0 && result.source === "Gartner Enterprise Software Forecast";
  })(),
);

check(
  "quality weak nutzt tamCAGR, Peer bleibt dahinter",
  (() => {
    const result = resolveIndustryGrowth({
      quality: "weak",
      tamCAGR: 17,
      tamSource: "BloombergNEF Energy Transition",
      tamLabel: "Global Renewable Energy",
      peerRevenueGrowths: [-0.5, -2.5, 0.4, 5.2],
    });
    return result.kind === "tam" && result.value === 17 && result.source === "BloombergNEF Energy Transition";
  })(),
);

check(
  "unreliable verwirft tamCAGR auch wenn eine Zahl da ist",
  (() => {
    const result = resolveIndustryGrowth({
      quality: "unreliable",
      tamCAGR: 16,
      tamSource: "Gartner",
      peerRevenueGrowths: [1, 2],
    });
    return result.kind === "na" && !("value" in result);
  })(),
);

check(
  "Global Market 5 % IMF ist kein Wert",
  (() => {
    const result = resolveIndustryGrowth({
      quality: "weak",
      tamCAGR: 5,
      tamLabel: GLOBAL_MARKET_TAM_LABEL,
      tamSource: GLOBAL_MARKET_TAM_SOURCE,
      peerRevenueGrowths: [1],
    });
    return result.kind === "na" && !("value" in result) && result.reason.includes("Global Market") && !result.reason.includes("?? 5");
  })(),
);

check(
  "KI-Schätzung nur mit Quelle und Begründung",
  (() => {
    const ok = resolveIndustryGrowth({
      quality: "unreliable",
      tamCAGR: null,
      peerRevenueGrowths: [1, 2],
      aiEstimate: { value: 6.5, source: "Unternehmensbericht", rationale: "genannte Branchenrate" },
    });
    const bare = resolveIndustryGrowth({
      quality: "unreliable",
      tamCAGR: null,
      peerRevenueGrowths: [1, 2],
      aiEstimate: { value: 5, source: "", rationale: "" },
    });
    return ok.kind === "ai" && ok.value === 6.5 && ok.label === "KI-Schätzung" && ok.source === "Unternehmensbericht"
      && bare.kind === "na" && !("value" in bare);
  })(),
);

check(
  "ohne Stufe bleibt n/a mit Grund und ohne erfundene 5",
  (() => {
    const result = resolveIndustryGrowth({ quality: "weak", tamCAGR: null, peerRevenueGrowths: [] });
    return result.kind === "na" && result.reason.length > 0 && !("value" in result);
  })(),
);

const unreliable = generateTAMAnalysis("Technology", "Software", "enterprise software", 100e9, 10, [
  { name: "Qqqqqq Alpha", revenue: 40e9, percentage: 40, growth: 5 },
  { name: "Qqqqqq Beta", revenue: 60e9, percentage: 60, growth: 8 },
]);
check(
  "Qualitätstor unreliable setzt tamCAGR, tamTotal und marketShare auf null",
  unreliable.quality === "unreliable" && unreliable.tamCAGR === null && unreliable.tamTotal === null && unreliable.marketShare === null,
  JSON.stringify({ q: unreliable.quality, cagr: unreliable.tamCAGR, total: unreliable.tamTotal, share: unreliable.marketShare }),
);

const afterGate = resolveIndustryGrowth({
  quality: unreliable.quality,
  tamCAGR: unreliable.tamCAGR,
  tamSource: unreliable.tamSource,
  tamLabel: unreliable.tamLabel,
  peerRevenueGrowths: [2, 4, 6, 8, 10],
});
check(
  "nach dem Tor zeigt die Kette den Peer-Median, nicht die verworfene CAGR",
  afterGate.kind === "peer-median" && afterGate.value === 6 && afterGate.source === "Peer-Median (n=5)",
);

const prompt = industryGrowthEstimatePrompt({ sector: "Energy", industry: "Oil & Gas", description: "integrated energy" });
check("KI-Prompt ohne :online", !prompt.systemPrompt.includes(":online") && !prompt.prompt.includes(":online"));
check("KI-Prompt ohne ?? 5 und ohne IMF-Konstante", !prompt.prompt.includes("?? 5") && !prompt.prompt.includes(GLOBAL_MARKET_TAM_SOURCE) && !prompt.systemPrompt.includes("?? 5"));

const aiBody = industryGrowthEstimateBody({ growthPct: 4.25, source: "IEA", rationale: "Outlook" }, "anthropic/claude-haiku-4.5");
check(
  "KI-Body übernimmt nur eine vollständige Schätzung",
  aiBody.label === "KI-Schätzung" && aiBody.value === 4.25 && aiBody.source === "IEA" && aiBody.rationale === "Outlook",
);
const aiRejected = industryGrowthEstimateBody({ growthPct: 5 }, null);
check("KI-Body ohne Quelle bleibt ohne Wert", aiRejected.value === undefined && typeof aiRejected.reason === "string");

const section7 = readFileSync(new URL("../client/src/components/sections/Section7.tsx", import.meta.url), "utf8");
check("Section7 enthält kein unbeschriftetes ?? 5", !section7.includes("?? 5"));

const scoreN2 = deriveGateInputs({
  impliedGStar: null,
  quarterlyRevenueChronological: null,
  annualIncome: null,
  annualBalance: null,
  subjectRevenueGrowth: 10,
  peerRevenueGrowths: [4, 6],
});
const scoreN1 = deriveGateInputs({
  impliedGStar: null,
  quarterlyRevenueChronological: null,
  annualIncome: null,
  annualBalance: null,
  subjectRevenueGrowth: 10,
  peerRevenueGrowths: [4],
});
check(
  "Score-Gate bleibt bei n≥2 und ändert sich nicht mit der S9-n-Regel",
  scoreN2.relativeGrowthDeltaYoYPp === 5 && scoreN1.relativeGrowthDeltaYoYPp === null,
  `n2=${scoreN2.relativeGrowthDeltaYoYPp} n1=${scoreN1.relativeGrowthDeltaYoYPp}`,
);

function renderSection(data: Record<string, unknown>) {
  return renderToStaticMarkup(
    React.createElement(Router, { ssrPath: "/" },
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(Section7 as any, { data }))),
  );
}

const msft = JSON.parse(readFileSync(new URL("./fixtures/analysis-MSFT.json", import.meta.url), "utf8"));
const shel = JSON.parse(readFileSync(new URL("./fixtures/analysis-SHEL.L.json", import.meta.url), "utf8"));

function withPeers(base: any, rates: Array<number | null>, tam: Record<string, unknown>) {
  return {
    ...base,
    dataSource: "fmp",
    tamAnalysis: { ...(base.tamAnalysis ?? {}), companyGrowth: 2, ...tam },
    peerComparison: {
      ...(base.peerComparison ?? {}),
      peers: rates.map((revenueGrowth, index) => ({ ticker: `P${index}`, revenueGrowth })),
    },
  };
}

const medianHtml = renderSection(withPeers(msft, [10, 1, 4, 8, 2], { tamCAGR: null, quality: "unreliable", tamSource: "Mapping unvollständig", tamLabel: "Segment-TAM unzuverlässig" }));
check("UI n=5: Peer-Median sichtbar, kein +5.0%", medianHtml.includes("Peer-Median (n=5)") && medianHtml.includes("+4.0%") && !medianHtml.includes("+5.0%"));

const spanHtml = renderSection(withPeers(msft, [9, 1, 4, 8], { tamCAGR: null, quality: "unreliable" }));
check("UI n=4: Peer-Spanne sichtbar, kein Median-Label", spanHtml.includes("Peer-Spanne (n=4)") && spanHtml.includes("+1.0%") && spanHtml.includes("+9.0%") && !spanHtml.includes("Peer-Median"));

const fewHtml = renderSection(withPeers(msft, [13.7, 7.7], { tamCAGR: null, quality: "weak" }));
check("UI n=2: n/a, Grund, Knopf KI-Schätzung, kein +5.0%", fewHtml.includes("n=2") && fewHtml.includes("KI-Schätzung") && !fewHtml.includes("+5.0%") && fewHtml.includes(">n/a<"));

const tamHtml = renderSection(withPeers(msft, [1, 2, 3, 4, 5, 6], { tamCAGR: 8, quality: "weak", tamSource: "Gartner IT Spending Forecast" }));
check("UI tamCAGR hat Vorrang vor dem Peer-Median", tamHtml.includes("+8.0%") && !tamHtml.includes("Peer-Median"));

const shelHtml = renderSection({ ...shel, dataSource: "fmp" });
const shelResolved = resolveIndustryGrowth({
  quality: shel.tamAnalysis.quality,
  tamCAGR: shel.tamAnalysis.tamCAGR,
  tamSource: shel.tamAnalysis.tamSource,
  tamLabel: shel.tamAnalysis.tamLabel,
  peerRevenueGrowths: (shel.peerComparison?.peers ?? []).map((peer: { revenueGrowth: number | null }) => peer.revenueGrowth),
});
check(
  "Fixture SHEL.L bleibt tamCAGR 17 mit bisheriger Quelle",
  shelResolved.kind === "tam" && shelResolved.value === 17 && shelResolved.source === "BloombergNEF Energy Transition" && shelHtml.includes("+17.0%"),
  shelResolved.kind === "tam" ? `${shelResolved.value} ${shelResolved.source}` : shelResolved.kind,
);

const msftResolved = resolveIndustryGrowth({
  quality: msft.tamAnalysis?.quality ?? null,
  tamCAGR: msft.tamAnalysis?.tamCAGR ?? null,
  tamSource: msft.tamAnalysis?.tamSource ?? null,
  tamLabel: msft.tamAnalysis?.tamLabel ?? null,
  peerRevenueGrowths: (msft.peerComparison?.peers ?? []).map((peer: { revenueGrowth: number | null }) => peer.revenueGrowth),
});
console.log(`FIXTURE MSFT nachher: ${msftResolved.kind === "na" ? "n/a" : msftResolved.kind} ${msftResolved.kind === "na" ? msftResolved.reason : ""}`);
console.log(`FIXTURE SHEL.L nachher: ${shelResolved.kind} ${shelResolved.kind === "tam" ? shelResolved.value + " " + shelResolved.source : ""}`);
console.log("FIXTURE AAPL NVO TSLA: offen, keine Offline-Fixture und kein Cache-Lesepfad");

console.log(fail ? `\nFAIL ${fail}` : "\nPASS alle");
process.exit(fail ? 1 : 0);
