/**
 * Moat §13 — Chip „Ökosystem“ nur wenn hasEcosystem === true.
 * Heuristik auf Geschäftsmodell-Text (Beschreibung / optionale LLM-Passage),
 * kein Ticker-Hardcode. Scoring, Lynch und DCF bleiben unberührt.
 *
 * Ausfuehren: npx tsx --tsconfig script/tsconfig.jsx.json script/test-ecosystem-moat.ts
 */
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assessEcosystem, resolveEcosystem } from "../server/ecosystem-moat";
import { MoatPorterSection } from "../client/src/components/sections/MoatPorterSection";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const CHIP = "data-testid=\"chip-moat-ecosystem\"";
const NOTE = "data-testid=\"moat-ecosystem-note\"";

function moatFixture(extra: Record<string, unknown> = {}) {
  return {
    overallRating: "Narrow",
    moatSources: ["Netzwerkeffekte"],
    porterForces: [] as { name: string; rating: "Low" | "Medium" | "High"; score: number; reasoning: string }[],
    businessModelStrength: "Solide",
    sustainabilityRating: "★★★☆☆",
    ...extra,
  };
}

function renderSection(moat: ReturnType<typeof moatFixture> | undefined): string {
  const el = createElement(MoatPorterSection, {
    data: { ticker: "TEST", moatAssessment: moat } as never,
  }) as ReactElement;
  return renderToStaticMarkup(el);
}

// === Heuristik: kein Ticker, nur Textsignale ===

check(
  "leere Beschreibung → kein Ökosystem",
  assessEcosystem("").hasEcosystem === false && assessEcosystem("   ").ecosystemNote === undefined,
);

check(
  "Ticker allein (NVDA) setzt den Flag nicht",
  assessEcosystem("NVDA sells GPUs into a cyclical gaming and data-center market.").hasEcosystem === false,
);

check(
  "zyklische GPU-Beschreibung ohne Ökosystem-Sprache → false",
  assessEcosystem(
    "Designs graphics processors and data-center accelerators. Revenue is cyclical with gaming and hyperscaler capex.",
  ).hasEcosystem === false,
);

const ownEco = assessEcosystem(
  "Designs graphics processors and a software ecosystem of developer tools, SDKs and third-party applications for accelerated computing.",
);
check("eigenes Software-Ökosystem → true", ownEco.hasEcosystem === true);
check("Begründung gesetzt wenn true", typeof ownEco.ecosystemNote === "string" && ownEco.ecosystemNote.length > 0 && ownEco.ecosystemNote.length <= 180);

check(
  "fremdes Ökosystem (Lieferant) → false",
  assessEcosystem("The firm sells sensors into the Apple ecosystem and does not run its own platform.").hasEcosystem === false,
);

check(
  "part of our ecosystem → true",
  assessEcosystem("Switching costs are high because customers are part of our ecosystem of complementary devices.").hasEcosystem === true,
);

check(
  "deutsches Ökosystem → true",
  assessEcosystem("Das Geschäftsmodell ist ein Entwickler-Ökosystem mit Partnern und SDKs.").hasEcosystem === true,
);

check(
  "third-party developers ohne das Wort ecosystem → true",
  assessEcosystem("Third-party developers ship applications on the company's SDK.").hasEcosystem === true,
);

check(
  "Marken-Moat ohne Plattform → false",
  assessEcosystem("A premium luxury brand with pricing power and high gross margins.").hasEcosystem === false,
);

check(
  "Branchen-Ökosystem („in the … ecosystem“) → false",
  assessEcosystem("The company operates in the semiconductor ecosystem and sells discrete chips.").hasEcosystem === false,
);

const routeSrc = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
check(
  "analyze-route füllt hasEcosystem über resolveEcosystem",
  routeSrc.includes("resolveEcosystem(") && routeSrc.includes("hasEcosystem: ecosystem.hasEcosystem"),
);
const scoreMoatSrc = routeSrc.slice(routeSrc.indexOf("function scoreMoat"), routeSrc.indexOf("// Auftrag 08.08.2026"));
check(
  "scoreMoat bleibt ohne Ökosystem-Zuschlag",
  scoreMoatSrc.includes("function scoreMoat") && !scoreMoatSrc.includes("hasEcosystem") && !scoreMoatSrc.includes("assessEcosystem"),
);

const fromLlm = resolveEcosystem({
  description: "Cyclical semiconductor designer. No platform language here.",
  llmText: "Die Wechselkosten stammen aus einem developer ecosystem rund um die Software-Plattform.",
});
check("LLM-Text kann den Flag setzen, wenn die Beschreibung schweigt", fromLlm.hasEcosystem === true);

const descWins = resolveEcosystem({
  description: "The company runs its own platform ecosystem.",
  llmText: "",
});
check("Beschreibung allein reicht", descWins.hasEcosystem === true && !!descWins.ecosystemNote);

check(
  "resolve ohne Text → false, keine Note",
  resolveEcosystem({ description: null, llmText: null }).hasEcosystem === false
    && resolveEcosystem({ description: null, llmText: null }).ecosystemNote === undefined,
);

const src = readFileSync(new URL("../server/ecosystem-moat.ts", import.meta.url), "utf8");
check(
  "Modul enthält keine Ticker-Liste",
  !/\b(NVDA|AAPL|MSFT|GOOGL|AMZN|TSLA)\b/.test(src),
);

// === UI: Chip nur bei hasEcosystem === true ===

const withFlag = renderSection(moatFixture({
  hasEcosystem: true,
  ecosystemNote: "CUDA-ähnliche Entwicklerbasis und komplementäre Software.",
}));
check("hasEcosystem true → Chip sichtbar", withFlag.includes(CHIP) && withFlag.includes("Ökosystem"));
check("Chip sitzt bei Moat-Quellen (vor Porter's Five Forces)", (() => {
  const quellen = withFlag.indexOf("Moat-Quellen");
  const chip = withFlag.indexOf(CHIP);
  const porter = withFlag.indexOf("Five Forces");
  return quellen !== -1 && chip > quellen && porter > chip;
})());
check("Chip nutzt Source-Pill-Klassen", withFlag.includes("chip-moat-ecosystem") && /chip-moat-ecosystem[^>]*class="[^"]*px-2\.5 py-1 text-xs rounded-md border/.test(withFlag));
check("Note wird gezeigt", withFlag.includes(NOTE) && withFlag.includes("CUDA-ähnliche Entwicklerbasis"));
check("kein Nein-Chip", !withFlag.includes("Ökosystem: Nein") && !withFlag.includes("Ökosystem:Nein"));

const trueNoNote = renderSection(moatFixture({ hasEcosystem: true }));
check("true ohne Note → Chip, keine Note-Zeile", trueNoNote.includes(CHIP) && !trueNoNote.includes(NOTE));

const flaggedOff = renderSection(moatFixture({ hasEcosystem: false, ecosystemNote: "soll nicht erscheinen" }));
check("hasEcosystem false → kein Chip", !flaggedOff.includes(CHIP) && !flaggedOff.includes(">Ökosystem<"));
check("false ignoriert ecosystemNote", !flaggedOff.includes("soll nicht erscheinen") && !flaggedOff.includes(NOTE));

const missing = renderSection(moatFixture());
check("undefined Flag → kein Chip, kein Platzhalter", !missing.includes(CHIP) && !missing.includes(">Ökosystem<") && missing.includes("Netzwerkeffekte"));

const empty = renderSection(undefined);
check("kein moat → bestehende Empty-Copy", empty.includes("Keine Moat-Daten verfügbar") && !empty.includes(CHIP));

if (failed > 0) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall ecosystem-moat checks passed");
