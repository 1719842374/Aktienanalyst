/**
 * Sektion 9: tamCAGR, sonst Peer-Median/Spanne, sonst n/a. Kein fester 5-%-Wert.
 * Die gelöschte script/test-section7-sector-bar.ts bleibt gelöscht.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-s9-branchen-quelle.ts
 */
import React from "react";
import { readFileSync } from "fs";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { Section7, resolveSectorGrowthDisplay } from "../client/src/components/sections/Section7";
import { industryGrowthRejection } from "../server/industry-growth-estimate";

(globalThis as any).React = React;

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

check("n=5 Median, null ist nicht 0", (() => {
  const result = resolveSectorGrowthDisplay({ tamCAGR: null, peerRevenueGrowths: [10, null, 1, Number.NaN, 4, undefined, 8, 2] });
  return result.kind === "peer-median" && result.n === 5 && result.value === 4 && result.source === "Peer-Median (n=5)";
})());
check("n=6 Median ohne Rundung", (() => {
  const result = resolveSectorGrowthDisplay({ tamCAGR: null, peerRevenueGrowths: [1, 2, 3, 4, 5, 6] });
  return result.kind === "peer-median" && result.value === 3.5 && result.source === "Peer-Median (n=6)";
})());
check("n=4 nur Spanne", (() => {
  const result = resolveSectorGrowthDisplay({ tamCAGR: null, peerRevenueGrowths: [9, 1, 4, 8] });
  return result.kind === "peer-span" && result.n === 4 && result.min === 1 && result.max === 9 && result.source === "Peer-Spanne (n=4)" && !("value" in result);
})());
check("n=3 nur Spanne", (() => {
  const result = resolveSectorGrowthDisplay({ tamCAGR: null, peerRevenueGrowths: [3, -2, 7] });
  return result.kind === "peer-span" && result.min === -2 && result.max === 7 && result.source === "Peer-Spanne (n=3)";
})());
check("n=2 kein Wert", resolveSectorGrowthDisplay({ tamCAGR: null, peerRevenueGrowths: [13.7, 7.7] }).kind === "na");
check("n=1 kein Wert", resolveSectorGrowthDisplay({ tamCAGR: null, peerRevenueGrowths: [4] }).kind === "na");
check("tamCAGR 0 bleibt 0 und hat Vorrang", (() => {
  const result = resolveSectorGrowthDisplay({ tamCAGR: 0, tamSource: "Gartner IT Spending Forecast", peerRevenueGrowths: [1, 2, 3, 4, 5] });
  return result.kind === "tam" && result.value === 0 && result.source === "Gartner IT Spending Forecast";
})());
check("tamCAGR schlägt die Peer-Spanne", (() => {
  const result = resolveSectorGrowthDisplay({ tamCAGR: 17, tamSource: "BloombergNEF Energy Transition", peerRevenueGrowths: [-0.5, -2.5, 0.4, 5.2] });
  return result.kind === "tam" && result.value === 17 && result.source === "BloombergNEF Energy Transition";
})());
check("KI ohne Quelle ist kein Wert", (() => {
  const result = resolveSectorGrowthDisplay({ tamCAGR: null, peerRevenueGrowths: [1], ai: { value: 5, source: "", rationale: "" } });
  return result.kind === "na" && !("value" in result);
})());
check("KI mit Quelle nur wenn tamCAGR und Peers fehlen", (() => {
  const shown = resolveSectorGrowthDisplay({ tamCAGR: null, peerRevenueGrowths: [1, 2], ai: { value: 6.5, source: "IEA", rationale: "Outlook" } });
  const hidden = resolveSectorGrowthDisplay({ tamCAGR: 8, tamSource: "Katalog", peerRevenueGrowths: [], ai: { value: 6.5, source: "IEA", rationale: "Outlook" } });
  return shown.kind === "ai" && shown.value === 6.5 && hidden.kind === "tam" && hidden.value === 8;
})());
check("Global Market wird keine Zahl", (() => {
  const result = resolveSectorGrowthDisplay({
    tamCAGR: 5, tamLabel: "Global Market", tamSource: "IMF / World Bank GDP Growth Estimate", quality: "weak", peerRevenueGrowths: [],
  });
  return result.kind === "na" && !("value" in result) && result.reason.includes("Global Market");
})());
check("IMF 5 % wird keine Zahl", (() => {
  const result = resolveSectorGrowthDisplay({
    tamCAGR: 5, tamLabel: "Andere Branche", tamSource: "IMF / World Bank GDP Growth Estimate", quality: "weak", peerRevenueGrowths: [],
  });
  return result.kind === "na" && !("value" in result) && result.reason.includes("IMF");
})());
check("unreliable wird keine tam-Zahl", (() => {
  const result = resolveSectorGrowthDisplay({
    tamCAGR: 16, tamSource: "Gartner", quality: "unreliable", peerRevenueGrowths: [],
  });
  return result.kind === "na" && !("value" in result) && result.reason.includes("unzuverlässig");
})());
check("echtes 5 % aus einer anderen Quelle bleibt", (() => {
  const result = resolveSectorGrowthDisplay({
    tamCAGR: 5, tamLabel: "Global Banking Revenue Pool", tamSource: "McKinsey Global Banking Revenue", quality: "weak", peerRevenueGrowths: [],
  });
  return result.kind === "tam" && result.value === 5 && result.source === "McKinsey Global Banking Revenue";
})());
check("unreliable bleibt n/a auch mit Peer-Raten", (() => {
  const result = resolveSectorGrowthDisplay({
    tamCAGR: 16, tamSource: "Gartner", quality: "unreliable", peerRevenueGrowths: [1, 2, 3, 4, 10],
  });
  return result.kind === "na" && !("value" in result) && result.reason.includes("unzuverlässig");
})());
check("Server lehnt Global Market, IMF 5 % und unreliable ab", 
  industryGrowthRejection({ label: "Global Market", value: 8 }) === "Global Market ist keine Branchenquelle"
  && industryGrowthRejection({ source: "IMF / World Bank GDP Growth Estimate", value: 5 }) === "IMF-Pauschale 5 % ist keine Branchenquelle"
  && (industryGrowthRejection({ quality: "unreliable", source: "Gartner", value: 16 }) ?? "").includes("unzuverlässig")
  && industryGrowthRejection({ quality: "weak", label: "Global Banking Revenue Pool", source: "McKinsey Global Banking Revenue", value: 5 }) === null,
);
check("KI-Call hat AbortSignal-Timeout", readFileSync(new URL("../server/industry-growth-estimate.ts", import.meta.url), "utf8").includes("AbortSignal.timeout(SEGMENT_CHILDREN_KI_TIMEOUT_MS)"));

const source = readFileSync(new URL("../client/src/components/sections/Section7.tsx", import.meta.url), "utf8");
check("Section7 enthält kein tamCAGR ?? 5", !source.includes("?? 5"));
check("KI-Route steht nicht in einem useEffect", !/useEffect\(\(\) => \{[^}]*industry-growth-estimate/s.test(source));

function render(data: Record<string, unknown>) {
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
    peerComparison: { ...(base.peerComparison ?? {}), peers: rates.map((revenueGrowth, index) => ({ ...(base.peerComparison?.peers?.[0] ?? {}), ticker: `P${index}`, revenueGrowth })) },
  };
}

const medianHtml = render(withPeers(msft, [10, 1, 4, 8, 2], { tamCAGR: null, tamSource: "" }));
check("UI n=5 zeigt Peer-Median und nicht +5.0%", medianHtml.includes("Peer-Median (n=5)") && medianHtml.includes("+4.0%") && !medianHtml.includes("+5.0%"));
const spanHtml = render(withPeers(msft, [9, 1, 4, 8], { tamCAGR: null }));
check("UI n=4 zeigt die Spanne", spanHtml.includes("Peer-Spanne (n=4)") && spanHtml.includes("+1.0%") && spanHtml.includes("+9.0%") && !spanHtml.includes("Peer-Median"));
const fewHtml = render(withPeers(msft, [13.7, 7.7], { tamCAGR: null }));
check("UI n=2 ist n/a mit Grund und Knopf, ohne +5.0%", fewHtml.includes("n=2") && fewHtml.includes("KI-Schätzung") && fewHtml.includes(">n/a<") && !fewHtml.includes("+5.0%"));
const tamHtml = render(withPeers(msft, [1, 2, 3, 4, 5, 6], { tamCAGR: 8, tamSource: "Gartner IT Spending Forecast" }));
check("UI vorhandener tamCAGR bleibt +8.0% mit Quelle", tamHtml.includes("+8.0%") && tamHtml.includes("Gartner IT Spending Forecast") && !tamHtml.includes("Peer-Median"));

const shelResolved = resolveSectorGrowthDisplay({
  tamCAGR: shel.tamAnalysis?.tamCAGR,
  tamSource: shel.tamAnalysis?.tamSource,
  peerRevenueGrowths: (shel.peerComparison?.peers ?? []).map((peer: { revenueGrowth: number | null }) => peer.revenueGrowth),
});
const shelHtml = render({ ...shel, dataSource: "fmp" });
check(
  "Fixture SHEL.L bleibt der vorhandene tamCAGR",
  shelResolved.kind === "tam" && shelResolved.value === shel.tamAnalysis.tamCAGR && shelHtml.includes(`+${Number(shel.tamAnalysis.tamCAGR).toFixed(1)}%`),
  shelResolved.kind === "tam" ? `${shelResolved.value} ${shelResolved.source}` : shelResolved.kind,
);

const msftResolved = resolveSectorGrowthDisplay({
  tamCAGR: msft.tamAnalysis?.tamCAGR ?? null,
  tamSource: msft.tamAnalysis?.tamSource ?? null,
  peerRevenueGrowths: (msft.peerComparison?.peers ?? []).map((peer: { revenueGrowth: number | null }) => peer.revenueGrowth),
});
console.log(`FIXTURE MSFT nachher: ${msftResolved.kind === "na" ? msftResolved.reason : JSON.stringify(msftResolved)}`);
console.log(`FIXTURE SHEL.L nachher: ${shelResolved.kind === "tam" ? `${shelResolved.value} ${shelResolved.source}` : shelResolved.kind}`);
console.log("FIXTURE AAPL NVO TSLA: offen, keine Offline-Fixture");

console.log(fail ? `\nFAIL ${fail}` : "\nPASS alle");
process.exit(fail ? 1 : 0);
