/**
 * Porter Five Forces — Threat-Skala 1–5 (niedriger = geringere Bedrohung).
 * Kraft-Score = gerundeter Mittelwert der Unterpunkte, dann Clamp [1, 5].
 * Wide-Moat (scoreMoat / overallRating / moatSources) bleibt unabhängig.
 * Moat-Stärke, Quellen und Ökosystem gehen nur als Prompt-Evidenz hinein.
 *
 * Ausfuehren: npx tsx --tsconfig script/tsconfig.jsx.json script/test-porter-score.ts
 */
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MoatPorterSection } from "../client/src/components/sections/MoatPorterSection";
import {
  clampPorterThreat,
  porterThreatRatingEn,
  toSchemaPorterForce,
} from "../shared/porter-score";
import { assessEcosystem } from "../server/ecosystem-moat";
import { buildPorterFiveForcesPrompt, type PorterFiveForceInput } from "../server/llm-openrouter";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

check("clamp 1 bleibt 1", clampPorterThreat(1) === 1);
check("clamp 5 bleibt 5", clampPorterThreat(5) === 5);
check("1–10-Bleed 7 wird 5", clampPorterThreat(7) === 5);
check("1–10-Bleed 10 wird 5", clampPorterThreat(10) === 10 ? false : clampPorterThreat(10) === 5);
check("0 wird auf 1 gezogen", clampPorterThreat(0) === 1);
check("2.5 rundet auf 3", clampPorterThreat(2.5) === 3);
check("2.4 rundet auf 2", clampPorterThreat(2.4) === 2);
check("fehlender Score wird Mittel (3)", clampPorterThreat(undefined) === 3 && clampPorterThreat("nope") === 3);

check("Band Low 1–2", porterThreatRatingEn(1) === "Low" && porterThreatRatingEn(2) === "Low");
check("Band Medium genau 3", porterThreatRatingEn(3) === "Medium");
check("Band High 4–5", porterThreatRatingEn(4) === "High" && porterThreatRatingEn(5) === "High");

const fromSubs = toSchemaPorterForce({
  force: "Rivalität unter Wettbewerbern",
  score: 9,
  summary: "AMD setzt Preise unter Druck.",
  reasoning: "",
  subScores: [
    { label: "AMD-Preisdruck", score: 4 },
    { label: "CUDA-Wechselkosten", score: 2 },
  ],
});
check("Kraft-Score ist gerundeter Mittelwert, nicht der Rohwert 9", fromSubs.score === 3, `score=${fromSubs.score}`);
check("Rating folgt dem abgeleiteten Score (3 → Medium)", fromSubs.rating === "Medium");
check("leeres reasoning übernimmt summary", fromSubs.reasoning === "AMD setzt Preise unter Druck.");
check("Unterpunkte bleiben 1–5", fromSubs.subScores?.length === 2 && fromSubs.subScores.every((s) => s.score >= 1 && s.score <= 5));

const keepReason = toSchemaPorterForce({
  name: "Verhandlungsmacht Kunden",
  score: 4,
  reasoning: "Hyperscaler bündeln Volumen.",
  summary: "soll nicht überschreiben",
});
check("vorhandenes reasoning bleibt", keepReason.reasoning === "Hyperscaler bündeln Volumen.");
check("Name aus name oder force", keepReason.name === "Verhandlungsmacht Kunden" && fromSubs.name === "Rivalität unter Wettbewerbern");

const clampedSubs = toSchemaPorterForce({
  force: "Lieferanten",
  score: 1,
  subScores: [
    { label: "TSMC", score: 9 },
    { label: "HBM", score: 1 },
  ],
});
check("Unterpunkt 9 wird vor dem Mittel auf 5 geklemmt", clampedSubs.score === 3, `score=${clampedSubs.score}`);
check("Unterpunkt-Score selbst ∈ [1,5]", clampedSubs.subScores?.[0].score === 5 && clampedSubs.subScores?.[1].score === 1);

const whitespace = toSchemaPorterForce({
  force: "Substitute",
  score: 2,
  reasoning: "   ",
  summary: "Kaum Ersatz für Beschleuniger.",
});
check("whitespace-reasoning gilt als leer", whitespace.reasoning === "Kaum Ersatz für Beschleuniger." && whitespace.score === 2 && whitespace.rating === "Low");

// NVDA-ähnlich: Rohwerte noch auf 1–10, Unterpunkte aber echte 1–5-Threats.
// Ø darf nicht allein wegen des 1–10-Rohwerts in Vulnerable (>3.5) rutschen.
const nvdaLike = [
  { force: "Rivalität", score: 8, subScores: [{ label: "AMD", score: 3 }, { label: "CUDA", score: 4 }] },
  { force: "Neueinsteiger", score: 7, subScores: [{ label: "Capex", score: 2 }, { label: "Stack", score: 1 }] },
  { force: "Lieferanten", score: 6, subScores: [{ label: "TSMC", score: 2 }, { label: "HBM", score: 3 }] },
  { force: "Kunden", score: 6, subScores: [{ label: "Hyperscaler", score: 3 }, { label: "Gaming", score: 3 }] },
  { force: "Substitute", score: 5, subScores: [{ label: "Custom Silicon", score: 2 }, { label: "CPU", score: 2 }] },
].map((row) => toSchemaPorterForce(row));
const nvdaAvg = nvdaLike.reduce((sum, force) => sum + force.score, 0) / nvdaLike.length;
check("NVDA-like: jeder Kraft-Score ∈ [1,5]", nvdaLike.every((f) => f.score >= 1 && f.score <= 5), JSON.stringify(nvdaLike.map((f) => f.score)));
check("NVDA-like: Rohwert 8 wird ignoriert (Mittel 3.5 → 4)", nvdaLike[0].score === 4);
check("NVDA-like: Ø nicht auto-Vulnerable", nvdaAvg <= 3.5 && nvdaAvg > 2.5, `avg=${nvdaAvg}`);

// Heuristik-Literale aus scoreMoat (alte 1–10-Reste) durch denselben Clamp.
check("Heuristik 7 → 5 High", toSchemaPorterForce({ force: "Rivalität", rating: "Hoch", score: 7 }).score === 5
  && toSchemaPorterForce({ force: "Rivalität", score: 7 }).rating === "High");
check("Heuristik 5 → 5 High (Band, nicht mehr Mittel 4–6/10)", toSchemaPorterForce({ force: "Kunden", rating: "Mittel", score: 5 }).score === 5
  && toSchemaPorterForce({ force: "Kunden", score: 5 }).rating === "High");
check("Heuristik 3 bleibt 3 Medium", toSchemaPorterForce({ force: "Lieferanten", rating: "Niedrig", score: 3 }).score === 3
  && toSchemaPorterForce({ force: "Lieferanten", score: 3 }).rating === "Medium");
check("Heuristik 2 bleibt 2 Low", toSchemaPorterForce({ force: "Substitute", score: 2 }).score === 2
  && toSchemaPorterForce({ force: "Substitute", score: 2 }).rating === "Low");

const routeSrc = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
const scoreMoatSrc = routeSrc.slice(routeSrc.indexOf("function scoreMoat"), routeSrc.indexOf("// Auftrag 08.08.2026"));
check(
  "Wide-Schwelle in scoreMoat unverändert",
  scoreMoatSrc.includes('score >= 6 ? "Wide" : score >= 3 ? "Narrow" : "None"'),
);
check("moatScore-Cap 10 bleibt der Moat-Punkte-Cap, nicht die Porter-Skala", scoreMoatSrc.includes("Math.min(score, 10)"));
check("overallRating kommt weiter aus moatStrength", routeSrc.includes("overallRating: moatAssessment.moatStrength ?? \"None\""));
check("Heuristik klemmt 3-vs-7 über clampPorterThreat", scoreMoatSrc.includes("clampPorterThreat(hasBrandMoat || hasNetworkMoat ? 3 : 7)"));
check("Payload-Map nutzt toSchemaPorterForce", routeSrc.includes("toSchemaPorterForce("));

const llmSrc = readFileSync(new URL("../server/llm-openrouter.ts", import.meta.url), "utf8");
const porterStart = llmSrc.indexOf("export interface PorterFiveForceInput");
const pestelStart = llmSrc.indexOf("generatePESTELAnalysis — NEW");
const porterSrc = llmSrc.slice(porterStart, pestelStart);
check("Porter-Prompt ohne 1-10", !/1-10|1–10/.test(porterSrc), porterSrc.match(/1[-–]10/)?.[0]);
check("Porter-Prompt ohne /10", !porterSrc.includes("/10"));
check("Porter-Parse klemmt nicht mehr auf 10", !porterSrc.includes(", 10)"));
check("Porter-Prompt verlangt 1–5 und subScores", /1–5|1-5/.test(porterSrc) && porterSrc.includes("subScores"));
check("Porter-Input führt moatStrength, moatSources, hasEcosystem, ecosystemNote", porterSrc.includes("moatStrength?:") && porterSrc.includes("moatSources?:") && porterSrc.includes("hasEcosystem?:") && porterSrc.includes("ecosystemNote?:"));
check("Parse bleibt toSchemaPorterForce", porterSrc.includes("toSchemaPorterForce({"));

const nvdaDesc =
  "Designs graphics processors and a software ecosystem of developer tools, SDKs and third-party applications for accelerated computing.";
const nvdaEco = assessEcosystem(nvdaDesc);
const nvdaSources = [
  "Hohe Bruttomarge (>60%)",
  "Starke FCF-Marge (>20%)",
  "Hoher ROE (>20%)",
  "Netzwerkeffekte",
];
const nvdaPromptInput: PorterFiveForceInput = {
  ticker: "NVDA",
  companyName: "NVIDIA Corporation",
  sector: "Technology",
  industry: "Semiconductors",
  description: nvdaDesc,
  revenue: 130e9,
  revenueGrowth: 114,
  fcfMargin: 48,
  grossMargin: 75,
  marketCap: 3000e9,
  topCatalysts: [{ name: "Blackwell", context: "Data-center ramp" }],
  moatStrength: "Wide",
  moatSources: nvdaSources,
  hasEcosystem: nvdaEco.hasEcosystem,
  ecosystemNote: nvdaEco.ecosystemNote,
};
const nvdaPrompt = buildPorterFiveForcesPrompt(nvdaPromptInput);
check("NVDA-like Beschreibung trägt eigenes Ökosystem", nvdaEco.hasEcosystem === true && typeof nvdaEco.ecosystemNote === "string");
check("NVDA-like Prompt nennt Moat-Stärke Wide", nvdaPrompt.includes("MOAT-KONTEXT") && nvdaPrompt.includes("Moat-Stärke: Wide"));
check("NVDA-like Prompt listet jede Moat-Quelle", nvdaSources.every((source) => nvdaPrompt.includes(`- ${source}`)));
check(
  "NVDA-like Prompt enthält den Ökosystem-Hinweis",
  typeof nvdaEco.ecosystemNote === "string" && nvdaPrompt.includes(`Ökosystem: ${nvdaEco.ecosystemNote}`),
);
check(
  "Prompt senkt Threat bei Neueinsteiger, Rivalität, Substituten und Wechselkosten",
  nvdaPrompt.includes("Bedrohung (Threat) zu senken")
    && nvdaPrompt.includes("Bedrohung durch Neueinsteiger")
    && nvdaPrompt.includes("Rivalität unter Wettbewerbern")
    && nvdaPrompt.includes("Bedrohung durch Substitute")
    && nvdaPrompt.includes("Wechselkosten"),
);
check("Prompt verbietet erfundenen Moat", nvdaPrompt.includes("Erfinde keinen Moat"));
check(
  "Prompt bleibt bei 1 bis 5, subScores und gerundetem Mittelwert",
  nvdaPrompt.includes("von 1 bis 5") && nvdaPrompt.includes("subScores") && nvdaPrompt.includes("gerundete") && nvdaPrompt.includes("kein zusätzlicher Cap"),
);
check("gerenderter Prompt ohne 1-10", !/1-10|1–10/.test(nvdaPrompt));

const nonePrompt = buildPorterFiveForcesPrompt({
  ...nvdaPromptInput,
  moatStrength: "None",
  moatSources: [],
  hasEcosystem: false,
  ecosystemNote: undefined,
});
check(
  "None ohne Ökosystem erfindet keinen Ökosystem-Satz",
  nonePrompt.includes("Moat-Stärke: None") && nonePrompt.includes("Moat-Quellen: keine") && !nonePrompt.includes("Ökosystem:"),
);

const step15 = routeSrc.slice(routeSrc.indexOf("// ── 15. Porter + PESTEL"), routeSrc.indexOf("// ── 16. Policy context"));
check(
  "Schritt 15 reicht Moat und Beschreibungs-Ökosystem in generatePorterFiveForces",
  step15.includes("assessEcosystem(description)")
    && step15.includes("moatStrength:")
    && step15.includes("moatSources:")
    && step15.includes("hasEcosystem: ecosystemFromDescription.hasEcosystem")
    && step15.includes("ecosystemNote: ecosystemFromDescription.ecosystemNote"),
);
check(
  "Chip-resolveEcosystem bleibt nach dem Porter-Call",
  routeSrc.indexOf("generatePorterFiveForces({") < routeSrc.indexOf("resolveEcosystem({")
    && routeSrc.includes("collectPorterNarrative(porterForces)"),
);
check("kein Post-Clamp auf dem Porter-Ø", !routeSrc.includes("porterAvg") && !/avgScore\s*=\s*Math\.min/.test(routeSrc));

function renderSection(moat: Record<string, unknown> | undefined): string {
  const el = createElement(MoatPorterSection, {
    data: { ticker: "NVDA", moatAssessment: moat } as never,
  }) as ReactElement;
  return renderToStaticMarkup(el);
}

const moderate = renderSection({
  overallRating: "Wide",
  moatSources: ["Netzwerkeffekte"],
  businessModelStrength: "Stark",
  sustainabilityRating: "★★★★★",
  porterForces: nvdaLike,
});
check("UI zeigt Ø / 5", moderate.includes(`${nvdaAvg.toFixed(1)} / 5`));
check("Ø 2.8 ist Moderate Position, nicht Vulnerable", moderate.includes("Moderate Position") && !moderate.includes(">Vulnerable<"));
check("Wide-Moat-Badge bleibt Wide", moderate.includes(">Wide<"));

const vulnerable = renderSection({
  overallRating: "Wide",
  moatSources: ["Markenstärke / Pricing Power"],
  businessModelStrength: "Stark",
  sustainabilityRating: "★★★★★",
  porterForces: [1, 2, 3, 4, 5].map((score) => ({
    name: `Force ${score}`,
    rating: porterThreatRatingEn(score),
    score,
    reasoning: "x",
  })),
});
// avg of 1..5 = 3.0 → Moderate. Use a clearly vulnerable set:
const vulnerableHtml = renderSection({
  overallRating: "Narrow",
  moatSources: ["Solide Bruttomarge (>40%)"],
  businessModelStrength: "Solide",
  sustainabilityRating: "★★★☆☆",
  porterForces: [4, 5, 4, 5, 4].map((score, i) => ({
    name: `Force ${i}`,
    rating: "High" as const,
    score,
    reasoning: "Druck",
  })),
});
check("Schwellen: 4.4 / 5 ist Vulnerable, Wide-Logik unberührt (Narrow bleibt Narrow)", vulnerableHtml.includes("4.4 / 5") && vulnerableHtml.includes("Vulnerable") && vulnerableHtml.includes(">Narrow<"));
check("1–5-Balken bleiben fünf Segmente", vulnerable.includes("Force 1") && (moderate.match(/w-3 h-3 rounded-sm/g) ?? []).length >= 25);

const uiSrc = readFileSync(new URL("../client/src/components/sections/MoatPorterSection.tsx", import.meta.url), "utf8");
const expandAt = uiSrc.indexOf("{isExpanded && (");
const expandBlock = uiSrc.slice(expandAt, expandAt + 900);
check("Unterpunkte nur im bestehenden Expand-Panel", expandBlock.includes("force.subScores") && expandBlock.includes("list-porter-subscores"));
check("Expand zeigt reasoning weiter", expandBlock.includes("force.reasoning"));
check("Schwellen ≤2.5 / ≤3.5 bleiben", uiSrc.includes("avgScore <= 2.5") && uiSrc.includes("avgScore <= 3.5") && uiSrc.includes("/ 5"));

if (failed > 0) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall porter-score checks passed");
